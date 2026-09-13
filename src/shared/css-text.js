/**
 * CSS as text, in and out.
 *
 * The inspector edits one property at a time through a widget that knows what that
 * property means. This is the other way in: the declarations as they would be written, for
 * the things a widget cannot reach — a property with no control of its own, a `::before`,
 * a `:nth-child`, a breakpoint.
 *
 * Text is not a way around the rules. Everything parsed here goes through
 * `validateDeclaration`, the same gate the widgets use, so the property allowlist and the
 * value checks hold exactly as they do everywhere else. What text buys is reach and speed,
 * never permission — a declaration refused in the inspector is refused here, and says why.
 */

import { validateDeclaration, toKebab } from './css-values.js';

/** Longest stylesheet the editor will hold, in characters. */
export const SHEET_LIMIT = 20000;

/** Most rules one site stylesheet may carry. */
const RULE_LIMIT = 200;

/**
 * What a selector may be made of.
 *
 * Deliberately a charset rather than a grammar: a selector is handed to the browser to
 * match with, so the only question here is whether it can carry something that is not a
 * selector. Braces, semicolons, at-signs and comment markers are what would end the rule
 * early and start something else, and none of them appear in any selector.
 */
const SELECTOR_SAFE = /^[\w\s.#\-[\]='":()>+~*,^$|]+$/;

/**
 * Media queries, on the same reasoning, with the words one is actually made of.
 *
 * A breakpoint is the main thing the element picker cannot express — you cannot click on
 * "narrow" — so it is worth admitting, and it is a small enough language to admit safely.
 */
const MEDIA_SAFE = /^@media[\w\s().,:<=>-]*$/i;

/** The extension's own nodes are not a legitimate target, however the selector spells it. */
const OURS = /webin/i;

/** Comments are stripped rather than parsed; nothing downstream has a use for them. */
const COMMENTS = /\/\*[\s\S]*?\*\//g;

/**
 * `{ borderRadius: '8px' }` as the CSS someone would have typed.
 *
 * Property names come back in the spelling CSS uses, not the spelling JavaScript uses, so
 * what is shown is what could be pasted somewhere else and still work.
 */
export function formatDeclarations(properties) {
  if (!properties || typeof properties !== 'object') return '';
  return Object.entries(properties)
    .map(([property, value]) => `${toKebab(property)}: ${value};`)
    .join('\n');
}

/**
 * A block of declarations, validated one at a time.
 *
 * A bad line does not spoil the block. Someone typing five declarations and misspelling one
 * property wants the four to land and to be told about the fifth — refusing the lot would
 * make the editor harder to use without making it any safer, since the four were each
 * checked on their own merits anyway.
 *
 * @returns {{properties: Object<string,string>, errors: string[]}}
 */
export function parseDeclarations(text) {
  const properties = {};
  const errors = [];

  for (const piece of String(text ?? '').replace(COMMENTS, '').split(';')) {
    const line = piece.trim();
    if (!line) continue;

    const colon = line.indexOf(':');
    if (colon < 1) {
      errors.push(`"${clip(line)}" is not a declaration.`);
      continue;
    }

    const property = line.slice(0, colon).trim();
    // `!important` is not the author's to give: the editor decides when a rule needs it,
    // from what the site's own stylesheets are doing. Accepting it in the text would let a
    // declaration outrank the guarantees the engine puts after it.
    const value = line.slice(colon + 1).replace(/!\s*important\s*$/i, '').trim();

    const checked = validateDeclaration(property, value);
    if (checked.ok) properties[checked.property] = checked.value;
    else errors.push(`${property}: ${checked.reason}`);
  }

  return { properties, errors };
}

/** True when a media query is one the editor will write. See `MEDIA_SAFE`. */
export function isSafeMedia(media) {
  const raw = String(media ?? '').trim();
  return raw.length > 0 && raw.length <= 200 && MEDIA_SAFE.test(raw);
}

/** True when a selector is a selector and nothing else. */
export function isSafeSelector(selector) {
  const raw = String(selector ?? '').trim();
  if (!raw || raw.length > 400) return false;
  if (OURS.test(raw)) return false;
  return SELECTOR_SAFE.test(raw);
}

/** `[{selector, properties}]` back to the stylesheet someone would have written. */
export function formatStylesheet(rules) {
  return (Array.isArray(rules) ? rules : [])
    .map((rule) => {
      const body = formatDeclarations(rule.properties).split('\n').map((l) => `  ${l}`).join('\n');
      const inner = rule.media ? `${rule.media} {\n  ${rule.selector} {\n${body}\n  }\n}` : null;
      return inner ?? `${rule.selector} {\n${body}\n}`;
    })
    .join('\n\n');
}

/**
 * A whole stylesheet: rules, and the reasons any of them were refused.
 *
 * Written as a scan rather than a regex over the whole text because a rule body and a
 * media query nest, and a pattern that matches balanced braces is the kind of thing that
 * is wrong in a way nobody notices for a year.
 *
 * @returns {{rules: Array<{selector:string, media:string|null, properties:object}>, errors: string[]}}
 */
export function parseStylesheet(text) {
  const source = String(text ?? '').replace(COMMENTS, '').slice(0, SHEET_LIMIT);
  const rules = [];
  const errors = [];
  readBlocks(source, null, rules, errors);
  return { rules: rules.slice(0, RULE_LIMIT), errors };
}

/** One level of blocks, recursing once for the inside of a media query. */
function readBlocks(source, media, rules, errors) {
  let index = 0;

  while (index < source.length && rules.length < RULE_LIMIT) {
    const open = source.indexOf('{', index);
    if (open === -1) {
      if (source.slice(index).trim()) errors.push(`"${clip(source.slice(index))}" is not a rule.`);
      return;
    }

    const prelude = source.slice(index, open).trim();
    const close = matchingBrace(source, open);
    if (close === -1) {
      errors.push(`"${clip(prelude)}" is never closed.`);
      return;
    }

    const body = source.slice(open + 1, close);
    index = close + 1;

    if (prelude.startsWith('@')) {
      // One level only. A media query inside a media query is legal CSS and is not worth
      // the parser it would take, so it is refused plainly rather than half-supported.
      if (media || !MEDIA_SAFE.test(prelude)) {
        errors.push(`"${clip(prelude)}" is not something the editor can use.`);
        continue;
      }
      readBlocks(body, prelude.replace(/\s+/g, ' '), rules, errors);
      continue;
    }

    if (!isSafeSelector(prelude)) {
      errors.push(`"${clip(prelude)}" is not a selector the editor will write.`);
      continue;
    }

    const { properties, errors: bad } = parseDeclarations(body);
    errors.push(...bad.map((reason) => `${clip(prelude)} — ${reason}`));
    if (Object.keys(properties).length) rules.push({ selector: prelude, media, properties });
  }
}

/** The index of the `}` that closes the `{` at `open`, or -1. */
function matchingBrace(source, open) {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * An attribute nothing on any page carries, so `:not([…])` matches everything and adds
 * one attribute's worth of specificity each time it is named. See `raise`.
 */
const RAISE = '[data-webin-raise]';

/**
 * A selector, made to outrank the theme without changing what it matches.
 *
 * The theme paints with attribute selectors — `[data-webin~="tx1"]`, specificity (0,1,0),
 * and (0,2,0) for its hover and fill rules — and every one of them is `!important`. A
 * rule typed as `footer { color: red }` is (0,0,1): marked `!important` too, it still
 * loses on specificity, the panel says "1 rule live", and nothing on the page changes.
 * Wrapping the selector in `:is()` and naming an attribute nobody has, twice, lifts it by
 * (0,2,0) — so the same rule now beats the theme on any tie and keeps its own specificity
 * on top, and ordinary specificity still works *between* the author's rules.
 *
 * Pseudo-elements cannot sit inside `:is()`, so a trailing `::before` or `::placeholder`
 * stays outside it; a selector that is only a pseudo-element — `::selection` — is left
 * exactly as written.
 */
function raise(selector) {
  return splitTop(selector).map((one) => {
    const match = one.match(/^(.*?)(::[\w-]+(?:\([^)]*\))?)$/);
    const base = (match ? match[1] : one).trim();
    const pseudo = match ? match[2] : '';
    if (!base) return one;
    return `:is(${base}):not(${RAISE}):not(${RAISE})${pseudo}`;
  }).join(', ');
}

/** Splits a selector list at top-level commas, leaving `:is(a, b)` in one piece. */
function splitTop(text) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of String(text)) {
    if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) { parts.push(current.trim()); current = ''; } else current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/**
 * Rules as the CSS that gets injected.
 *
 * Every declaration is marked `!important`, because the whole reason to write one of these
 * is to overrule what the site already says. Marking them all keeps ordinary specificity
 * working *between* the author's own rules, which is what they will expect. Each selector
 * is also raised above the theme's — see `raise` — since a rule that cannot beat the theme
 * is a rule that does nothing while the panel says it is live.
 */
export function stylesheetCss(rules) {
  return (Array.isArray(rules) ? rules : [])
    .map((rule) => {
      const body = Object.entries(rule.properties)
        .map(([property, value]) => `${property}: ${value} !important;`)
        .join(' ');
      const inner = `${raise(rule.selector)} { ${body} }`;
      return rule.media ? `${rule.media} { ${inner} }` : inner;
    })
    .join('\n');
}

function clip(value) {
  const raw = String(value).trim().replace(/\s+/g, ' ');
  return raw.length > 40 ? `${raw.slice(0, 40)}…` : raw;
}
