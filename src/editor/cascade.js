/**
 * Cascade awareness (§51, §52, §53, §61).
 *
 * The Inspector's promise is that it tells the truth about *why* a value is what it is:
 * which rule declared it, whether an inline style or `!important` is in play, and
 * whether the number came from a CSS variable. That honesty is also what lets the
 * Override Engine pick the smallest intervention that will actually win (§52).
 */

import { extractVarRefs } from '../shared/css-values.js';
import { isSafeMedia, isSafeSelector } from '../shared/css-text.js';
import { OWNED_ATTR } from '../shared/types.js';
import { STYLE_ID } from './override-sheet.js';

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

  // A component's styles live in its shadow root, not in the document. Reading only
  // `document.styleSheets` means every element inside a web component looks unstyled —
  // and an override engine that believes nothing is competing writes no `!important` and
  // quietly loses. Both scopes count.
  const root = element.getRootNode?.();
  const scopes = [view.document.styleSheets];
  if (root && root !== view.document) {
    if (root.styleSheets) scopes.push(root.styleSheets);
    if (root.adoptedStyleSheets?.length) scopes.push(root.adoptedStyleSheets);
  }

  // Our own sheets — theme, overrides, site stylesheet — are reported separately. A
  // constructed one says so itself; a <style> of ours carries the owned mark, and is
  // found from the element rather than through `ownerNode`, which not every engine fills in.
  const owned = new Set();
  for (const scope of [view.document, root && root !== view.document ? root : null]) {
    for (const node of scope?.querySelectorAll?.(`style[${OWNED_ATTR}], #${STYLE_ID}`) ?? []) {
      if (node.sheet) owned.add(node.sheet);
    }
  }

  for (const scope of scopes) {
    for (const sheet of scope) {
      if (owned.has(sheet) || sheet.ownerNode?.id === STYLE_ID || sheet[OURS] === true) continue;
      let list;
      try {
        list = sheet.cssRules;
      } catch {
        blockedSheets += 1;
        continue;
      }
      collectRules(list, element, rules, sheet, view);
    }
  }

  rules.sort((a, b) => compareSpecificity(a.specificity, b.specificity) || a.order - b.order);
  return { rules, blockedSheets };
}

/** Marks a constructed stylesheet as one of ours, since it has no owner node to check. */
const OURS = Symbol.for('webin.ownSheet');

/** Whether a media query holds here. An engine with no `matchMedia` is taken at its word. */
function mediaMatches(view, query) {
  if (typeof view?.matchMedia !== 'function') return true;
  try {
    return view.matchMedia(query).matches;
  } catch {
    return false;
  }
}

/**
 * `pure` says whether every condition this rule sits inside is a media query. A rule
 * under `@supports` or `@container` shows its condition in the same place, but it is not
 * a breakpoint the editor could write back, so such a rule is not offered for editing.
 */
function collectRules(list, element, out, sheet, view, media = null, pure = true) {
  for (const rule of list) {
    // CSSMediaRule / CSSSupportsRule / CSSLayerBlockRule all nest further rules.
    if (rule.cssRules && !rule.selectorText) {
      const nextMedia = rule.conditionText ? [media, rule.conditionText].filter(Boolean).join(' and ') : media;
      if (rule.media && !mediaMatches(view, rule.conditionText || rule.media.mediaText)) continue;
      collectRules(rule.cssRules, element, out, sheet, view, nextMedia, pure && (Boolean(rule.media) || !rule.conditionText));
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
        pureMedia: pure,
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

/** Most rules and declarations the styles list will carry for one element. */
const STYLES_RULE_LIMIT = 40;
const STYLES_DECLARATION_LIMIT = 60;

/**
 * Splits `color: red; padding: 4px 8px` into `[property, value]` pairs, leaving a
 * `rgba(…)` or a `url(…)` with a `;` inside its quotes in one piece.
 */
function splitDeclarations(cssText) {
  const out = [];
  let depth = 0;
  let quote = null;
  let current = '';
  const flush = () => {
    const colon = current.indexOf(':');
    if (colon > 0) {
      const property = current.slice(0, colon).trim();
      const value = current.slice(colon + 1).replace(/!\s*important\s*$/i, '').trim();
      if (property && value) out.push([property, value]);
    }
    current = '';
  };
  for (const ch of String(cssText ?? '')) {
    if (quote) { current += ch; if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; current += ch; continue; }
    if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ';' && depth === 0) { flush(); continue; }
    current += ch;
  }
  flush();
  return out;
}

/** The shorthand a longhand belongs to, so `padding` can be seen to outrank `padding-top`. */
function shorthandOf(property) {
  const match = property.match(/^(padding|margin|border|background|font|flex|grid|outline|overflow|text-decoration|transition|animation|inset|gap)(-|$)/);
  return match ? match[1] : null;
}

/**
 * A rule's identity in the Styles list: its media query and its selector, and nothing
 * else. It is what an edit names, and it is a string so it can ride on a button.
 */
export function ruleKey(media, selector) {
  return JSON.stringify([media ?? null, selector]);
}

/** The two halves of a `ruleKey`, or null for anything that was not one. */
export function parseRuleKey(key) {
  try {
    const [media, selector] = JSON.parse(String(key));
    return typeof selector === 'string' ? { media: media ?? null, selector } : null;
  } catch {
    return null;
  }
}

/** The site's spelling of a breakpoint — the condition alone, no `@media` — from ours. */
const bareMedia = (media) => (media ? String(media).replace(/^@media\s+/i, '').trim() : null);

/** Whether the site stylesheet could carry a rule with this selector and breakpoint. */
const canWrite = (selector, media, pure = true) => isSafeSelector(selector)
  && (!media || (pure && isSafeMedia(`@media ${media}`)));

/**
 * The CSS the site itself applies to an element, as a browser's Styles pane would list it,
 * with what you have written over it on top.
 *
 * The inspector's rows show what a property *computes* to; this shows where that came
 * from — every rule that matches, most powerful first, with each declaration as the
 * author wrote it and struck through where something stronger has overridden it. The
 * element is named the way the page named it: tag, id and classes.
 *
 * Three kinds of rule, in the order they win. `own` is the site stylesheet — the rules you
 * wrote, whether typed in the code tool or made by editing one of the site's rules here —
 * and comes first, since every one of those is raised and `!important`. Then the
 * element's inline style, then the site's rules. Webin's theme and per-element overrides
 * are left out: the question this answers is "what does the site say, and what have I
 * said back", and what the theme said is in the rows.
 *
 * Each entry carries a `key` (see `ruleKey`) and `editable`: whether the site stylesheet
 * could hold a rule with that selector and breakpoint, which is what editing it means.
 *
 * @param {Array<{selector:string, media:string|null, properties:object}>} own the site
 *   stylesheet's parsed rules
 * @returns {{ target:string, own:Array, inline:Array|null, rules:Array, blocked:number }}
 */
export function appliedStyles(element, view = window, own = []) {
  const tag = element.tagName.toLowerCase();
  const classes = [...(element.classList ?? [])].map((c) => `.${c}`).join('');
  const target = `${tag}${element.id ? `#${element.id}` : ''}${classes}`;

  const { rules, blockedSheets } = matchingRules(element, view);
  // Most powerful first, which is the order a person reads a cascade in.
  const ordered = rules.slice(-STYLES_RULE_LIMIT).reverse();

  const entries = [];

  // Yours. A rule in the site stylesheet reaches the page raised by two attributes'
  // worth of specificity and marked important on every line — see `stylesheetCss` — so
  // it is ranked exactly that way here, rather than assumed to win.
  (Array.isArray(own) ? own : []).forEach((rule, index) => {
    const media = bareMedia(rule.media);
    if (media && !mediaMatches(view, media)) return;
    let matches = false;
    try {
      matches = element.matches(rule.selector);
    } catch {
      return;
    }
    if (!matches) return;
    const declarations = Object.entries(rule.properties ?? {})
      .map(([property, value]) => ({ property, value, important: false }));
    if (!declarations.length) return;
    const [ids, cls, types] = specificity(rule.selector);
    entries.push({
      selector: rule.selector,
      source: 'yours',
      media,
      key: ruleKey(media, rule.selector),
      inline: false,
      ours: true,
      editable: true,
      specificity: [ids, cls + 2, types],
      order: 1_000_000 + index,
      declarations,
    });
  });

  const inlineText = element.getAttribute?.('style') ?? '';
  const inlineDecls = splitDeclarations(inlineText)
    .filter(([property]) => !/^data-webin|^--webin/.test(property))
    .map(([property, value]) => ({
      property, value,
      important: element.style?.getPropertyPriority(property) === 'important',
    }));
  if (inlineDecls.length) {
    entries.push({
      selector: 'element.style', source: 'inline', media: null, key: null,
      inline: true, ours: false, editable: false, specificity: [0, 0, 0], order: 0,
      declarations: inlineDecls,
    });
  }

  for (const rule of ordered) {
    const declarations = splitDeclarations(rule.style?.cssText ?? '')
      .slice(0, STYLES_DECLARATION_LIMIT)
      .map(([property, value]) => ({
        property, value,
        important: rule.style.getPropertyPriority(property) === 'important',
      }));
    if (!declarations.length) continue;
    const source = rule.href ? rule.href.split('/').pop()?.split('?')[0] || rule.href : '<style>';
    entries.push({
      selector: rule.selector,
      source,
      media: rule.media,
      key: ruleKey(rule.media, rule.selector),
      inline: false,
      ours: false,
      editable: canWrite(rule.selector, rule.media, rule.pureMedia !== false),
      specificity: rule.specificity,
      order: rule.order,
      declarations,
    });
  }

  // Who wins each property. `!important` outranks everything without it, and yours are
  // all important; within a tier an inline style beats any rule; among rules, specificity
  // and then source order, yours being adopted after the site's own sheets.
  const strength = (entry, declaration) => [
    declaration.important || entry.ours ? 1 : 0,
    entry.inline ? 1 : 0,
    ...entry.specificity,
    entry.order,
  ];
  const stronger = (a, b) => {
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return a[i] > b[i];
    return false;
  };
  const winners = new Map();
  for (const entry of entries) {
    for (const declaration of entry.declarations) {
      const score = strength(entry, declaration);
      const current = winners.get(declaration.property);
      if (!current || stronger(score, current.score)) winners.set(declaration.property, { score, declaration });
    }
  }
  for (const entry of entries) {
    for (const declaration of entry.declarations) {
      const score = strength(entry, declaration);
      const best = winners.get(declaration.property);
      let overridden = best && best.declaration !== declaration;
      // A shorthand set by something stronger overrides the longhand too.
      const shorthand = shorthandOf(declaration.property);
      if (!overridden && shorthand && shorthand !== declaration.property) {
        const wider = winners.get(shorthand);
        if (wider && stronger(wider.score, score)) overridden = true;
      }
      declaration.overridden = Boolean(overridden);
    }
  }

  // The ranking fields have done their work; what leaves here is what the panel shows.
  for (const entry of entries) {
    delete entry.specificity;
    delete entry.order;
  }
  const inline = entries.find((e) => e.inline) ?? null;
  return {
    target,
    own: entries.filter((e) => e.ours),
    inline: inline ? inline.declarations : null,
    rules: entries.filter((e) => !e.inline && !e.ours),
    blocked: blockedSheets,
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
  // Our selector names the attribute twice and an id nobody has —
  // `[data-webin-id="w1"][data-webin-id]:not(#webin-raise)` — so it scores (1,2,0).
  // Comparing against anything lower here would add `!important` to every ordinary rule
  // we already beat, which is how an override engine becomes impossible to reason about.
  const needsImportant = compareSpecificity(strongest, [1, 2, 0]) >= 0;
  return {
    important: needsImportant,
    reason: needsImportant ? `An author rule matches with equal or higher specificity.` : null,
  };
}
