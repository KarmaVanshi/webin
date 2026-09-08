/**
 * Cascade awareness (§51, §52, §53, §61).
 *
 * The Inspector's promise is that it tells the truth about *why* a value is what it is:
 * which rule declared it, whether an inline style or `!important` is in play, and
 * whether the number came from a CSS variable. That honesty is also what lets the
 * Override Engine pick the smallest intervention that will actually win (§52).
 */

import { extractVarRefs } from '../../shared/css-values.js';
import { STYLE_ID } from '../override-engine/stylesheet.js';

export const Source = Object.freeze({
  OVERRIDE: 'override',
  INLINE: 'inline',
  AUTHOR: 'author',
  DEFAULT: 'default',
});

/**
 * Specificity of a selector as [id, class, type] (§52).
 * Deliberately approximate: it ignores `:is()`/`:where()` internals, which is
 * acceptable because it is only ever used to decide how hard the override must push.
 */
export function specificity(selector) {
  const cleaned = String(selector)
    .replace(/\\./g, ' ')
    .replace(/:where\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' [] ');

  const ids = (cleaned.match(/#[\w-]+/g) ?? []).length;
  const classes =
    (cleaned.match(/\.[\w-]+/g) ?? []).length +
    (cleaned.match(/\[\]/g) ?? []).length +
    (cleaned.match(/:(?!:)(?!where)[\w-]+/g) ?? []).length;
  const types =
    (cleaned.match(/(^|[\s>+~(])([a-z][\w-]*)/gi) ?? []).length +
    (cleaned.match(/::[\w-]+/g) ?? []).length;
  return [ids, classes, types];
}

/** Compares two specificity triples. */
export function compareSpecificity(a, b) {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/**
 * Every author rule that matches this element, most powerful last.
 *
 * Cross-origin stylesheets throw on `cssRules` access; those are skipped and counted so
 * the UI can say the picture is incomplete rather than imply it is whole (§32, §101).
 */
export function matchingRules(element, view = window) {
  const rules = [];
  let blockedSheets = 0;

  for (const sheet of view.document.styleSheets) {
    if (sheet.ownerNode?.id === STYLE_ID) continue; // our own overrides are reported separately
    let list;
    try {
      list = sheet.cssRules;
    } catch {
      blockedSheets += 1;
      continue;
    }
    collectRules(list, element, rules, sheet, view);
  }

  rules.sort((a, b) => compareSpecificity(a.specificity, b.specificity) || a.order - b.order);
  return { rules, blockedSheets };
}

function collectRules(list, element, out, sheet, view, media = null) {
  for (const rule of list) {
    // CSSMediaRule / CSSSupportsRule / CSSLayerBlockRule all nest further rules.
    if (rule.cssRules && !rule.selectorText) {
      const nextMedia = rule.conditionText ? [media, rule.conditionText].filter(Boolean).join(' and ') : media;
      if (rule.media && !view.matchMedia(rule.conditionText || rule.media.mediaText).matches) continue;
      collectRules(rule.cssRules, element, out, sheet, view, nextMedia);
      continue;
    }
    if (!rule.selectorText) continue;
    for (const selector of splitSelectors(rule.selectorText)) {
      let matches = false;
      try {
        matches = element.matches(selector);
      } catch {
        continue; // selector uses syntax this engine cannot test
      }
      if (!matches) continue;
      out.push({
        selector,
        specificity: specificity(selector),
        media,
        order: out.length,
        style: rule.style,
        href: sheet.href ?? null,
      });
    }
  }
}

/** Splits a selector list without breaking on commas inside `:is(...)`. */
export function splitSelectors(selectorText) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of selectorText) {
    if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/**
 * Where one property's value actually comes from (§51, §61).
 * @returns {{computed:string, declared:string|null, source:string, selector:string|null,
 *            important:boolean, varRef:string|null, overridden:boolean}}
 */
export function explainProperty(element, property, view = window, { overrideValue = null } = {}) {
  const computed = view.getComputedStyle(element).getPropertyValue(property).trim();

  const inline = element.style?.getPropertyValue(property)?.trim() || null;
  const inlineImportant = element.style?.getPropertyPriority(property) === 'important';

  const { rules } = matchingRules(element, view);
  let declared = null;
  let selector = null;
  let important = false;
  for (const rule of rules) {
    const value = rule.style.getPropertyValue(property)?.trim();
    if (!value) continue;
    const isImportant = rule.style.getPropertyPriority(property) === 'important';
    // Later in the sorted list wins, but an !important rule beats non-important ones.
    if (!declared || isImportant || !important) {
      declared = value;
      selector = rule.selector;
      important = isImportant;
    }
  }

  let source = Source.DEFAULT;
  if (overrideValue != null) source = Source.OVERRIDE;
  else if (inline) source = Source.INLINE;
  else if (declared) source = Source.AUTHOR;

  const effectiveDeclared = inline ?? declared;
  const varRef = effectiveDeclared ? (extractVarRefs(effectiveDeclared)[0] ?? null) : null;

  return {
    computed,
    declared: effectiveDeclared,
    source,
    selector: inline ? 'style=""' : selector,
    important: inline ? inlineImportant : important,
    varRef,
    overridden: overrideValue != null,
    overrideValue,
  };
}

/**
 * Resolves a CSS variable to its value and the element that defines it (§53).
 * @returns {{name:string, value:string, definedOn:Element|null}|null}
 */
export function resolveVariable(element, name, view = window) {
  const value = view.getComputedStyle(element).getPropertyValue(name).trim();
  if (!value) return null;
  let node = element;
  while (node && node.nodeType === 1) {
    if (node.style?.getPropertyValue(name)) return { name, value, definedOn: node };
    const own = view.getComputedStyle(node).getPropertyValue(name).trim();
    const parentValue = node.parentElement
      ? view.getComputedStyle(node.parentElement).getPropertyValue(name).trim()
      : '';
    if (own && own !== parentValue) return { name, value, definedOn: node };
    node = node.parentElement;
  }
  return { name, value, definedOn: view.document.documentElement };
}

/**
 * How hard an override must push to beat the existing cascade (§52).
 * The engine always writes an attribute selector (0,1,0 plus the tag), so the only
 * question is whether `!important` is required. It is used sparingly and only when the
 * existing declaration would otherwise win.
 */
export function requiredStrength(element, property, view = window) {
  const explained = explainProperty(element, property, view);
  if (explained.source === Source.INLINE) {
    return { important: true, reason: 'An inline style is set on this element.' };
  }
  if (explained.important) {
    return { important: true, reason: `"${explained.selector}" declares this !important.` };
  }
  const { rules } = matchingRules(element, view);
  const strongest = rules
    .filter((r) => r.style.getPropertyValue(property))
    .reduce((max, r) => (compareSpecificity(r.specificity, max) > 0 ? r.specificity : max), [0, 0, 0]);
  // Our selector is `[data-widt-id="..."]` — one attribute, i.e. (0,1,0).
  const needsImportant = compareSpecificity(strongest, [0, 1, 0]) >= 0;
  return {
    important: needsImportant,
    reason: needsImportant ? `An author rule matches with equal or higher specificity.` : null,
  };
}
