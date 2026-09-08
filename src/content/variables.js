/**
 * CSS custom property discovery.
 *
 * This module is the reason the extension works on YouTube.
 *
 * A site built out of web components — YouTube, most of Google, anything Polymer or Lit —
 * keeps its real UI inside shadow roots, where a stylesheet in the document cannot reach.
 * But those sites almost always paint from a handful of custom properties declared on
 * `:root` (`--yt-spec-base-background`, `--yt-spec-text-primary`, and so on), and custom
 * properties *do* inherit across shadow boundaries. Redefining twenty variables therefore
 * re-skins tens of thousands of nodes the extension can never select, for the cost of one
 * rule block.
 *
 * Two ways of finding them, in order:
 *   1. Enumerate the computed style of the root element. Chromium lists custom properties
 *      there, which gives the *resolved* value including anything a dark-mode class has
 *      already switched.
 *   2. Failing that, read the declarations out of same-origin stylesheets.
 *
 * Only variables whose value is a colour are kept. A variable holding a length or a
 * gradient is not something a palette can be mapped onto.
 */

import { parseColor } from '../shared/color.js';

/** Root-ish selectors whose declarations apply to (nearly) the whole document. */
const ROOT_SELECTOR = /(^|,)\s*(:root|html|body|\*)\b/i;

/**
 * Ceilings so a pathological site cannot turn discovery into a hang.
 * YouTube declares well over four hundred `--yt-spec-*` properties on its root, and a cap
 * below that silently drops the ones a theme most needs.
 */
const MAX_VARIABLES = 1200;
const MAX_RULES_PER_SHEET = 4000;

/**
 * @returns {Array<{name:string, value:string, parsed:object}>} colour-valued custom
 *   properties visible at the root, in declaration order.
 */
export function collectVariables(doc = document, view = window) {
  const root = doc.documentElement;
  if (!root) return [];

  let names = [];
  let computed = null;
  try {
    computed = view.getComputedStyle(root);
    names = enumerate(computed);
  } catch {
    return [];
  }

  // Older engines do not list custom properties in a computed style. Fall back to reading
  // the author's own sheets — we still resolve each value through the computed style, so
  // a variable defined in terms of another one comes back substituted either way.
  if (!names.length) names = fromStyleSheets(doc);

  const seen = new Set();
  const out = [];
  for (const name of names) {
    if (seen.has(name) || out.length >= MAX_VARIABLES) continue;
    seen.add(name);
    let value;
    try {
      value = computed.getPropertyValue(name).trim();
    } catch {
      continue;
    }
    if (!value || value.length > 64) continue;
    const parsed = parseColor(value);
    // Fully transparent variables are scrims and spacers, not palette entries.
    if (!parsed || parsed.a < 0.04) continue;
    out.push({ name, value, parsed });
  }
  return out;
}

function enumerate(computed) {
  const names = [];
  const length = computed.length ?? 0;
  for (let i = 0; i < length; i += 1) {
    const name = computed.item(i);
    if (name && name.startsWith('--')) names.push(name);
  }
  return names;
}

/** Reads custom property names off root-level rules in same-origin stylesheets. */
function fromStyleSheets(doc) {
  const names = [];
  for (const sheet of doc.styleSheets ?? []) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // cross-origin sheet; not readable, and not ours to worry about
    }
    if (!rules) continue;
    collectFromRules(rules, names, 0);
    if (names.length >= MAX_VARIABLES) break;
  }
  return names;
}

function collectFromRules(rules, names, depth) {
  const limit = Math.min(rules.length, MAX_RULES_PER_SHEET);
  for (let i = 0; i < limit; i += 1) {
    const rule = rules[i];
    // A style rule with declarations.
    if (rule.style && rule.selectorText && ROOT_SELECTOR.test(rule.selectorText)) {
      for (let j = 0; j < rule.style.length; j += 1) {
        const name = rule.style.item(j);
        if (name.startsWith('--')) names.push(name);
      }
    }
    // Media and supports blocks wrap the rules that matter on responsive sites.
    if (rule.cssRules && depth < 2) collectFromRules(rule.cssRules, names, depth + 1);
    if (names.length >= MAX_VARIABLES) return;
  }
}
