/**
 * The rest of a theme file, as rules.
 *
 * Seven colours, a radius, two fonts and a shadow kind describe a theme's *mood*. A real
 * theme file goes on for another two hundred lines describing its buttons, its cards, its
 * inputs, its nav bar, its scrollbar, its links, what happens under the pointer and what
 * happens on focus — and it does so in CSS-shaped words: `boxShadow`, `borderColor`,
 * `textTransform`, `hoverBackground`. Reducing that to a material with four numeric levers
 * kept the blur and threw the rest away, and a brutalist theme whose whole point is a
 * three-pixel black border and an offset block shadow rendered as a soft grey card.
 *
 * So the rest is read too, as declarations. Every block that describes a kind of element
 * becomes a rule against a *target* — one of the engine's structural roles, or a surface, or
 * the body, headings, links — and every declaration in it goes through the same gate as
 * the CSS the editor lets someone type: the property allowlist and the value checks hold
 * exactly as they do everywhere else. A theme may also name its own selectors outright, in
 * a `selectors` block, a `rules` list or a `css` string, and those are validated the same
 * way the site stylesheet is. Reading widely is not trusting widely.
 */

import { parseColor, toCss } from './color.js';
import { validateDeclaration, toKebab, isAllowedProperty } from './css-values.js';
import { isSafeSelector, isSafeMedia, parseStylesheet } from './css-text.js';
import { ROLES } from './types.js';

/**
 * What a rule may be written against, beyond a raw selector.
 *
 * The nine roles are decided by tag and ARIA; `surface` is the engine's own card mark,
 * decided by what an element paints; and the last three are the page's fixed furniture,
 * for which the engine writes the selector itself.
 */
export const RULE_TARGETS = Object.freeze([...ROLES, 'surface', 'body', 'heading', 'link']);

/**
 * The states a rule may be for.
 *
 * `current` is the item that is *selected* — the page you are on in a nav, the row that
 * is open — as distinct from `active`, which is the moment a button is held down.
 */
export const RULE_STATES = Object.freeze(['hover', 'active', 'focus', 'placeholder', 'current']);

/** Most rules one theme may carry, explicit and read together. */
export const RULE_LIMIT = 200;

/** Most declarations one rule may carry. */
const PROPERTY_LIMIT = 40;

/**
 * The words a file might use for each target.
 *
 * The same list the dialect reader uses for materials, with the page's furniture added.
 * A name absent here is not a target — which is the same line as ever, drawn once.
 */
const TARGET_WORDS = {
  nav: ['nav', 'navigation', 'navbar', 'menubar', 'topnav'],
  header: ['header', 'banner', 'topbar', 'masthead', 'appbar'],
  footer: ['footer', 'contentinfo'],
  sidebar: ['sidebar', 'aside', 'drawer', 'rail'],
  modal: ['modal', 'modals', 'dialog', 'sheet', 'overlay'],
  popover: ['popover', 'popovers', 'dropdown', 'dropdowns', 'tooltip', 'tooltips', 'menu', 'flyout'],
  button: ['button', 'buttons', 'btn', 'primarybutton', 'cta'],
  field: ['field', 'fields', 'input', 'inputs', 'textarea', 'select', 'textfield', 'form'],
  table: ['table', 'tables', 'grid', 'datatable'],
  surface: ['surface', 'surfaces', 'card', 'cards', 'panel', 'panels', 'window', 'windows',
    'container', 'containers', 'tile', 'tiles', 'box', 'boxes'],
  body: ['body', 'page', 'text', 'root'],
  heading: ['heading', 'headings', 'title', 'titles', 'headline', 'headlines'],
  link: ['link', 'links', 'anchor', 'anchors', 'a'],
};

/** Target, by any of the words above, or null. */
function targetOf(word) {
  const key = String(word ?? '').toLowerCase().replace(/[\s_-]+/g, '');
  if (RULE_TARGETS.includes(key)) return key;
  for (const [target, words] of Object.entries(TARGET_WORDS)) {
    if (words.includes(key)) return target;
  }
  return null;
}

/** Keys a file uses for a property, against the property it means. */
const PROPERTY_WORDS = {
  background: 'background', backgroundcolor: 'background', bg: 'background', fill: 'background',
  backgroundimage: 'background-image', image: 'background-image', gradient: 'background-image',
  backgroundrepeat: 'background-repeat', backgroundposition: 'background-position',
  backgroundsize: 'background-size', backgroundattachment: 'background-attachment',
  backgroundclip: 'background-clip', backgroundorigin: 'background-origin',
  text: 'color', color: 'color', textcolor: 'color', foreground: 'color', fg: 'color', ink: 'color',
  border: 'border', borderwidth: 'border-width', borderstyle: 'border-style',
  bordercolor: 'border-color', outline: 'outline', outlinecolor: 'outline-color',
  borderradius: 'border-radius', radius: 'border-radius', cornerradius: 'border-radius',
  rounding: 'border-radius', corners: 'border-radius',
  shadow: 'box-shadow', boxshadow: 'box-shadow', elevation: 'box-shadow', glow: 'box-shadow',
  blur: 'backdrop-filter', backdropfilter: 'backdrop-filter', backdropblur: 'backdrop-filter',
  glassblur: 'backdrop-filter', backdrop: 'backdrop-filter',
  filter: 'filter',
  fontfamily: 'font-family', family: 'font-family', font: 'font-family',
  fontweight: 'font-weight', weight: 'font-weight',
  fontsize: 'font-size', size: 'font-size',
  fontstyle: 'font-style',
  letterspacing: 'letter-spacing', tracking: 'letter-spacing',
  lineheight: 'line-height', leading: 'line-height',
  texttransform: 'text-transform', transform: 'transform',
  textdecoration: 'text-decoration', underline: 'text-decoration',
  textshadow: 'text-shadow', textalign: 'text-align',
  opacity: 'opacity', padding: 'padding', margin: 'margin', gap: 'gap',
  width: 'width', height: 'height', minheight: 'min-height', minwidth: 'min-width',
  maxwidth: 'max-width', maxheight: 'max-height',
  transition: 'transition', cursor: 'cursor',
  placeholder: 'placeholder', placeholdercolor: 'placeholder',
  caret: 'caret-color', caretcolor: 'caret-color', accentcolor: 'accent-color',
};

/** Properties whose value is a colour, and is normalised as one. */
const COLOUR_PROPS = new Set([
  'color', 'background-color', 'border-color', 'outline-color', 'caret-color', 'accent-color',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'text-decoration-color',
]);

/** Properties a bare number means in px. Everything else a bare number is left as is. */
const PX_PROPS = new Set([
  'border-radius', 'border-width', 'font-size', 'letter-spacing', 'padding', 'margin', 'gap',
  'width', 'height', 'min-height', 'min-width', 'max-width', 'max-height', 'outline-width',
]);

const BORDER_STYLES = new Set(['none', 'hidden', 'solid', 'dashed', 'dotted', 'double',
  'groove', 'ridge', 'inset', 'outset']);

/** A length token: `2px`, `0`, `.5rem`. */
const LENGTH = /^-?\d*\.?\d+(px|em|rem|%|vw|vh|ch|pt)?$/i;

/** The gradient functions a theme may paint with. Never a `url()`. */
const GRADIENT = /^(repeating-)?(linear|radial|conic)-gradient\(/i;

/** Font stacks take the same check the format applies to the theme's own fonts. */
const FONT_SAFE = /^[\w\s,'"-]{1,160}$/;

/**
 * Splits on top-level commas, leaving `rgba(0, 0, 0, 0.5)` in one piece.
 */
function splitTop(value, separator = ',') {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of String(value)) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === separator && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** Whitespace-separated tokens, keeping a colour function together. */
const tokens = (value) => splitTop(String(value).replace(/\s+/g, ' '), ' ').filter(Boolean);

/**
 * True when a value is one or more gradient layers and nothing else.
 *
 * The check is structural rather than a grammar: each layer must be a gradient function,
 * and the value as a whole must pass the same charset gate every declaration passes. That
 * is enough to make a gradient string exactly as safe as a colour.
 */
export function isGradient(value) {
  const raw = String(value ?? '').trim();
  if (!raw || raw.length > 400) return false;
  const layers = splitTop(raw);
  return layers.length > 0 && layers.every((layer) => GRADIENT.test(layer) && layer.endsWith(')'));
}

/**
 * A `border` written any of the ways files write it, as longhands.
 *
 * `"2px solid #000"` is the shorthand and is kept as one. `"rgba(255,255,255,0.18)"` is a
 * colour and means the edge's colour. `"0 0 2px 0 solid #fff"` is four widths, a style and
 * a colour — not valid CSS as written, but perfectly clear — and becomes three longhands.
 */
function borderDeclarations(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return {};
  if (/^(none|0|0px)$/i.test(raw)) return { border: 'none' };
  if (parseColor(raw)) return { 'border-color': toCss(parseColor(raw)) };

  const widths = [];
  let style = null;
  let colour = null;
  for (const token of tokens(raw)) {
    const lower = token.toLowerCase();
    if (LENGTH.test(token)) widths.push(/^-?\d*\.?\d+$/.test(token) ? `${token}px` : token);
    else if (BORDER_STYLES.has(lower)) style = lower;
    else if (parseColor(token)) colour = toCss(parseColor(token));
  }
  if (!widths.length && !style && !colour) return {};

  if (widths.length <= 1) {
    const parts = [widths[0] ?? '1px', style ?? 'solid', colour].filter(Boolean);
    return { border: parts.join(' ') };
  }
  const out = { 'border-width': widths.join(' '), 'border-style': style ?? 'solid' };
  if (colour) out['border-color'] = colour;
  return out;
}

/** A blur, from a number, a length, or a whole filter chain. */
function blurDeclarations(value) {
  if (value === false || value == null) return {};
  if (typeof value === 'number') return value > 0 ? { 'backdrop-filter': `blur(${value}px)` } : {};
  const raw = String(value).trim();
  if (!raw || /^(none|0|0px|false)$/i.test(raw)) return {};
  if (/\b(blur|saturate|brightness|contrast)\(/i.test(raw)) return { 'backdrop-filter': raw };
  if (LENGTH.test(raw)) return { 'backdrop-filter': `blur(${/^\d*\.?\d+$/.test(raw) ? `${raw}px` : raw})` };
  return {};
}

/** One value for one property, in the form the declaration gate will accept. */
function coerce(property, value) {
  if (value == null || value === '') return null;
  if (typeof value === 'boolean') {
    if (property === 'text-decoration') return value ? 'underline' : 'none';
    return null;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return PX_PROPS.has(property) ? `${value}px` : String(value);
  }
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;

  if (COLOUR_PROPS.has(property)) {
    const parsed = parseColor(raw);
    return parsed ? toCss(parsed) : null;
  }
  if (property === 'font-family') return FONT_SAFE.test(raw) ? raw : null;
  if (property === 'background-image') {
    if (/^none$/i.test(raw)) return 'none';
    return isGradient(raw) ? raw : null;
  }
  // A bare number where a length is wanted is a length in px: `radius: "12"`.
  if (PX_PROPS.has(property) && /^-?\d*\.?\d+$/.test(raw)) return `${raw}px`;
  return raw;
}

/**
 * Declarations from one CSS-flavoured block.
 *
 * Every key is looked up by the property it means; `hoverBackground` is `background` in the
 * hover state, and a `hover` block is a whole state at once. What comes out has not been
 * validated yet — that happens once, in `normaliseRule`, so an explicit rule and a read one
 * meet the same gate.
 *
 * @param {object} block
 * @param {string} target which target the block is for; the state a bare `hover` colour
 *   sets depends on it (a link's hover is its colour, a button's is its fill).
 * @returns {{base: object, states: Object<string, object>}}
 */
export function readDeclarations(block, target = 'surface') {
  const out = { base: {}, states: {} };
  if (!block || typeof block !== 'object') return out;

  const into = (bucket, property, value) => {
    if (property === 'background') {
      // A background is a colour or a gradient, and the file rarely says which.
      if (typeof value === 'string' && isGradient(value)) bucket['background-image'] = value;
      else if (typeof value === 'string' && /^none$/i.test(value.trim())) bucket['background-image'] = 'none';
      else { const c = coerce('background-color', value); if (c) bucket['background-color'] = c; }
      return;
    }
    if (property === 'border') { Object.assign(bucket, borderDeclarations(value)); return; }
    if (property === 'backdrop-filter') { Object.assign(bucket, blurDeclarations(value)); return; }
    if (property === 'placeholder') {
      const c = coerce('color', value);
      if (c) (out.states.placeholder ??= {}).color = c;
      return;
    }
    const c = coerce(property, value);
    if (c != null) bucket[property] = c;
  };

  for (const [key, value] of Object.entries(block)) {
    const flat = key.toLowerCase().replace(/[\s_-]+/g, '');

    // A state, either as a prefix (`hoverBackground`) or as a block (`hover: { … }`).
    const state = flat.match(/^(hover|active|focus|current|selected|pressed|disabled)(.*)$/);
    if (state) {
      const name = { selected: 'current', pressed: 'active' }[state[1]] ?? state[1];
      if (name === 'disabled') continue;
      // A nav's "active" item is the one you are on, not the one being clicked.
      const bucketName = name === 'active' && ['nav', 'sidebar', 'table', 'link'].includes(target) ? 'current' : name;
      const bucket = (out.states[bucketName] ??= {});
      const rest = state[2];
      if (!rest) {
        if (value && typeof value === 'object') {
          const nested = readDeclarations(value, target);
          Object.assign(bucket, nested.base);
        } else if (typeof value === 'string') {
          into(bucket, target === 'link' || target === 'heading' ? 'color' : 'background', value);
        }
        continue;
      }
      const property = PROPERTY_WORDS[rest] ?? (['ring', 'glow'].includes(rest) ? 'box-shadow' : null);
      if (property) into(bucket, property, value);
      continue;
    }

    // Variants a block may keep its real declarations under.
    if (['default', 'primary', 'main', 'base', 'normal', 'rest'].includes(flat) && value && typeof value === 'object') {
      const nested = readDeclarations(value, target);
      Object.assign(out.base, nested.base);
      for (const [s, decls] of Object.entries(nested.states)) Object.assign((out.states[s] ??= {}), decls);
      continue;
    }

    // A key the vocabulary does not know may still be a CSS property written as one —
    // `borderTopWidth`, `text-underline-offset`. Those are passed along under their own
    // name and left to the gate, which is where every other declaration is judged anyway.
    const property = PROPERTY_WORDS[flat] ?? (isAllowedProperty(toKebab(key)) ? toKebab(key) : null);
    if (!property) continue;
    if (value && typeof value === 'object' && !Array.isArray(value)) continue;
    into(out.base, property, value);
  }
  return out;
}

/** Keys that describe a state of the thing, not a different thing. */
const STATE_KEYS = new Set(['hover', 'active', 'focus', 'current', 'selected', 'pressed', 'disabled']);

/** True when a block is a set of named variants rather than a description. */
function isNested(block) {
  const entries = Object.entries(block).filter(([key]) => !STATE_KEYS.has(key.toLowerCase()));
  const objects = entries.filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v)).length;
  return objects > 0 && objects >= entries.length / 2;
}

/**
 * The block to read for a target, out of one that may hold several variants.
 *
 * `buttons: { primary, secondary, ghost }` describes the primary one first; `cards:
 * { default, hover }` is one card with a state. A materials block — `surfaces: { main,
 * glass, card, floating }` — is read for the one entry that is actually a card, since its
 * `main` is the page itself.
 */
function variantOf(block, target) {
  if (!isNested(block)) return block;
  for (const name of ['default', 'primary', 'main', 'base', 'card', 'normal']) {
    if (target === 'surface' && name === 'main') continue;
    if (block[name] && typeof block[name] === 'object') {
      // Keep the sibling state blocks beside the variant, so `cards.hover` still lands.
      const states = {};
      for (const s of ['hover', 'active', 'focus']) if (block[s] && typeof block[s] === 'object') states[s] = block[s];
      return { ...block[name], ...states };
    }
  }
  // No variant to prefer: whatever the block says directly about itself still counts —
  // `table: { background, header: {…}, row: {…} }` has a background of its own.
  return block;
}

/**
 * Rules for every kind of element the file describes, in its own words.
 *
 * Three places are looked in — `components`, `elements`, and the theme itself — and every
 * block found for a target counts. A file that says `surfaces.card` and also `cards.default`
 * has described its card twice, half in each place, and reading only one would lose the
 * other half; the rules are folded later, with the block read last answering where the
 * two disagree.
 *
 * @returns {Array<{target:string, state:string|null, properties:object}>} raw, unvalidated
 */
export function readComponentRules(source) {
  if (!source || typeof source !== 'object') return [];
  const rules = [];
  const push = (target, state, properties) => {
    if (properties && Object.keys(properties).length) rules.push({ target, state, properties });
  };

  const blocks = [source.components, source.elements, source]
    .filter((b) => b && typeof b === 'object');
  for (const block of blocks) {
    for (const [key, value] of Object.entries(block)) {
      const target = targetOf(key);
      if (!target) continue;
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      // `text: { color, headingColor }` is the body's ink and the headings' ink at once.
      if (target === 'body' && key.toLowerCase() === 'text') {
        const c = coerce('color', value.color);
        if (c) push('body', null, { color: c });
        const h = coerce('color', value.headingColor ?? value.heading);
        if (h) push('heading', null, { color: h });
        continue;
      }
      const chosen = variantOf(value, target);
      const { base, states } = readDeclarations(chosen, target);
      push(target, null, base);
      for (const [state, properties] of Object.entries(states)) push(target, state, properties);
    }
  }

  // Typography, which files write as one block about two kinds of text.
  const typography = source.typography && typeof source.typography === 'object' ? source.typography : {};
  const body = {};
  const heading = {};
  const bodyBlock = typography.body && typeof typography.body === 'object' ? typography.body : {};
  const headingBlock = typography.heading && typeof typography.heading === 'object' ? typography.heading : {};
  const first = (...values) => values.find((v) => v != null && v !== '');

  const bodySize = first(bodyBlock.size, bodyBlock.fontSize, typography.bodyFontSize, typography.fontSize, typography.baseSize);
  const bodyWeight = first(bodyBlock.weight, bodyBlock.fontWeight, typography.bodyWeight, typography.bodyFontWeight);
  const bodyLine = first(bodyBlock.lineHeight, typography.lineHeight, typography.bodyLineHeight);
  const bodySpacing = first(bodyBlock.letterSpacing, typography.bodyLetterSpacing,
    headingBlock.letterSpacing == null && typography.headingLetterSpacing == null ? typography.letterSpacing : null);
  const bodyColour = first(bodyBlock.color, typography.bodyColor, typography.color);
  const headingSpacing = first(headingBlock.letterSpacing, typography.headingLetterSpacing);
  const headingColour = first(headingBlock.color, typography.headingColor);
  const headingTransform = first(headingBlock.textTransform, typography.headingTransform);

  const set = (bucket, property, value) => { const c = coerce(property, value); if (c != null) bucket[property] = c; };
  set(body, 'font-size', bodySize);
  set(body, 'font-weight', bodyWeight);
  set(body, 'line-height', bodyLine);
  set(body, 'letter-spacing', bodySpacing);
  set(body, 'color', bodyColour);
  set(heading, 'letter-spacing', headingSpacing);
  set(heading, 'color', headingColour);
  set(heading, 'text-transform', headingTransform);
  push('body', null, body);
  push('heading', null, heading);

  // A `borders` block is the edge every surface gets.
  const borders = source.borders && typeof source.borders === 'object' ? source.borders : null;
  if (borders) {
    const edge = {};
    set(edge, 'border-width', borders.width ?? borders.borderWidth);
    if (borders.style && BORDER_STYLES.has(String(borders.style).toLowerCase())) edge['border-style'] = String(borders.style).toLowerCase();
    set(edge, 'border-color', borders.color ?? borders.borderColor);
    set(edge, 'border-radius', borders.radius ?? borders.borderRadius);
    push('surface', null, edge);
  }

  // A raw shadow on the theme's effects is the card shadow, when it is not one of ours.
  const effects = source.effects && typeof source.effects === 'object' ? source.effects : {};
  const shadow = effects.shadow ?? effects.boxShadow ?? effects.softShadow;
  if (typeof shadow === 'string' && /\d/.test(shadow)) push('surface', null, { 'box-shadow': shadow.trim() });

  return rules;
}

/**
 * Everything a file says about its scrollbar and its text selection, as selector rules.
 *
 * Both are document chrome with one instance per page, so they need no stamp and no
 * target: the selector is the same on every site.
 */
export function readChromeRules(source) {
  if (!source || typeof source !== 'object') return [];
  const rules = [];
  const colour = (v) => { const p = typeof v === 'string' ? parseColor(v) : null; return p ? toCss(p) : null; };
  const length = (v) => (typeof v === 'number' ? `${v}px` : (typeof v === 'string' && LENGTH.test(v.trim())
    ? (/^\d*\.?\d+$/.test(v.trim()) ? `${v.trim()}px` : v.trim()) : null));

  const bar = source.scrollbar ?? source.scrollbars;
  if (bar && typeof bar === 'object') {
    const width = length(bar.width ?? bar.size);
    const track = colour(bar.track ?? bar.trackColor ?? bar.background);
    const thumb = colour(bar.thumb ?? bar.thumbColor ?? bar.color);
    const hover = colour(bar.thumbHover ?? bar.hoverThumb ?? bar.hover ?? bar.thumbHoverColor);
    const radius = length(bar.radius ?? bar.borderRadius ?? bar.thumbRadius);
    if (width) rules.push({ selector: '::-webkit-scrollbar', properties: { width, height: width } });
    if (track) rules.push({ selector: '::-webkit-scrollbar-track', properties: { 'background-color': track } });
    const thumbDecls = {};
    if (thumb) thumbDecls['background-color'] = thumb;
    if (radius) thumbDecls['border-radius'] = radius;
    if (Object.keys(thumbDecls).length) rules.push({ selector: '::-webkit-scrollbar-thumb', properties: thumbDecls });
    if (hover) rules.push({ selector: '::-webkit-scrollbar-thumb:hover', properties: { 'background-color': hover } });
    if (thumb || track) {
      rules.push({ selector: 'html', properties: { 'scrollbar-color': `${thumb ?? 'auto'} ${track ?? 'transparent'}` } });
    }
  }

  const selection = source.selection ?? source.components?.selection ?? source.textSelection;
  const palette = source.palette ?? source.colors ?? source.colours ?? {};
  const selBg = selection && typeof selection === 'object'
    ? colour(selection.background ?? selection.backgroundColor ?? selection.bg)
    : colour(palette.selection ?? palette.selectionBackground);
  const selText = selection && typeof selection === 'object'
    ? colour(selection.text ?? selection.color ?? selection.foreground)
    : colour(palette.selectionText ?? palette.selectionForeground ?? palette.onSelection);
  const sel = {};
  if (selBg) sel['background-color'] = selBg;
  if (selText) sel.color = selText;
  if (Object.keys(sel).length) rules.push({ selector: '::selection', properties: sel });

  return rules;
}

/**
 * The selectors a theme names outright.
 *
 * Three spellings. `selectors` maps a selector to its declarations; `rules` is a list of
 * `{selector | target, state, media, properties}`; `css` is a stylesheet as text. All three
 * end up in the same shape and go through the same gate.
 *
 * A `selectors` entry whose value is a list of selectors is not a rule at all but a way of
 * *finding* a target — `card: [".tile", ".product"]` — and is handed back separately as
 * `detect`.
 */
export function readSelectorRules(source) {
  const rules = [];
  const detect = {};
  if (!source || typeof source !== 'object') return { rules, detect };

  const fromEntries = (block) => {
    if (!block || typeof block !== 'object' || Array.isArray(block)) return;
    for (const [key, value] of Object.entries(block)) {
      if (Array.isArray(value) || (typeof value === 'string' && targetOf(key))) {
        const target = targetOf(key);
        if (target) detect[target] = [...(detect[target] ?? []), ...(Array.isArray(value) ? value : [value])];
        continue;
      }
      if (typeof value === 'string') {
        const { properties } = parseStylesheet(`x{${value}}`).rules[0] ?? { properties: null };
        if (properties) rules.push({ selector: key, properties });
        continue;
      }
      if (!value || typeof value !== 'object') continue;
      const target = targetOf(key);
      const { base, states } = readDeclarations(value, target ?? 'surface');
      const named = target ? { target } : { selector: key };
      if (Object.keys(base).length) rules.push({ ...named, properties: base });
      for (const [state, properties] of Object.entries(states)) rules.push({ ...named, state, properties });
    }
  };
  fromEntries(source.selectors);
  fromEntries(source.overrides?.selectors);

  const list = source.rules ?? source.cssRules;
  if (Array.isArray(list)) {
    for (const entry of list) {
      if (!entry || typeof entry !== 'object') continue;
      const properties = entry.properties ?? entry.declarations ?? entry.style ?? entry.css;
      // A `rules` list is the format's own shape, so its declarations are CSS already and
      // go to the gate as written. Text is parsed the way the site stylesheet is.
      const decls = typeof properties === 'string'
        ? (parseStylesheet(`x{${properties}}`).rules[0]?.properties ?? {})
        : (properties && typeof properties === 'object' ? properties : {});
      rules.push({
        target: targetOf(entry.target ?? entry.role) ?? undefined,
        selector: typeof entry.selector === 'string' ? entry.selector : undefined,
        state: entry.state ?? undefined,
        media: entry.media ?? undefined,
        properties: decls,
      });
    }
  }

  for (const key of ['css', 'stylesheet', 'customCss', 'customCSS', 'extraCss']) {
    const text = source[key];
    if (typeof text !== 'string' || !text.trim()) continue;
    for (const rule of parseStylesheet(text).rules) {
      rules.push({ selector: rule.selector, media: rule.media, properties: rule.properties });
    }
  }

  // How a file says it finds things: `domDetection.classification` in one dialect,
  // `detect` or `match` in another.
  for (const block of [source.domDetection?.classification, source.detect, source.match, source.detection]) {
    if (!block || typeof block !== 'object') continue;
    for (const [key, value] of Object.entries(block)) {
      const target = targetOf(key);
      if (!target) continue;
      detect[target] = [...(detect[target] ?? []), ...(Array.isArray(value) ? value : [value])];
    }
  }

  return { rules, detect };
}

/**
 * One rule, rebuilt from untrusted input, or null.
 *
 * A rule names a target or a selector, never both and never neither. Its selector takes
 * the same check the site stylesheet's do; its state is one of a fixed few; its media
 * query is the small language the editor already admits; and every declaration goes
 * through `validateDeclaration`, which is the whole point.
 */
export function normaliseRule(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const target = RULE_TARGETS.includes(raw.target) ? raw.target : null;
  const selector = !target && typeof raw.selector === 'string' && isSafeSelector(raw.selector)
    ? raw.selector.trim().replace(/\s+/g, ' ')
    : null;
  if (!target && !selector) return null;

  const state = RULE_STATES.includes(raw.state) ? raw.state : null;
  const media = typeof raw.media === 'string' && isSafeMedia(raw.media) ? raw.media.trim().replace(/\s+/g, ' ') : null;

  const properties = {};
  const source = raw.properties && typeof raw.properties === 'object' ? raw.properties : {};
  for (const [key, value] of Object.entries(source).slice(0, PROPERTY_LIMIT)) {
    const checked = validateDeclaration(toKebab(key), value);
    if (checked.ok) properties[checked.property] = checked.value;
  }
  // A glass surface needs the prefixed spelling too, or Safari draws it flat.
  if (properties['backdrop-filter'] && !properties['-webkit-backdrop-filter']) {
    properties['-webkit-backdrop-filter'] = properties['backdrop-filter'];
  }
  if (!Object.keys(properties).length) return null;

  return { target, selector, state, media, properties };
}

/**
 * A list of rules, validated and capped, with rules for the same place folded together.
 *
 * Folding matters because the readers above produce a `surface` rule from three different
 * blocks — the cards, the borders, the shadow — and the engine wants one declaration list
 * per target and state, in which the later block's answer wins.
 */
export function normaliseRules(list) {
  const out = [];
  const index = new Map();
  for (const raw of Array.isArray(list) ? list : []) {
    const rule = normaliseRule(raw);
    if (!rule) continue;
    const key = `${rule.target ?? `s:${rule.selector}`}|${rule.state ?? ''}|${rule.media ?? ''}`;
    const existing = index.get(key);
    if (existing) {
      Object.assign(existing.properties, rule.properties);
      continue;
    }
    if (out.length >= RULE_LIMIT) break;
    index.set(key, rule);
    out.push(rule);
  }
  return out;
}

/**
 * How a theme finds its targets, validated: one selector list per target.
 *
 * Each selector takes the site stylesheet's check, and the ones that pass are joined into
 * a single list the engine can hand to `matches()` in one call.
 */
export function normaliseDetect(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw)) {
    const target = targetOf(key);
    if (!target || target === 'body' || target === 'heading' || target === 'link') continue;
    const list = (Array.isArray(value) ? value : [value])
      .filter((s) => typeof s === 'string' && isSafeSelector(s))
      .map((s) => s.trim().replace(/\s+/g, ' '))
      .slice(0, 12);
    if (list.length) out[target] = list.join(', ');
  }
  return out;
}

/** A theme's `transition`, from whichever block wrote it, as one `transition` value. */
export function readTransition(source) {
  if (!source || typeof source !== 'object') return null;
  const effects = source.effects ?? {};
  const motion = source.motion ?? source.animation ?? source.interaction ?? {};
  const inner = motion.default ?? motion.base ?? motion;

  let value = effects.transition ?? motion.transition ?? source.transition ?? null;
  if (typeof value !== 'string' && inner && typeof inner === 'object') {
    const duration = inner.duration ?? inner.speed;
    const easing = inner.easing ?? inner.ease ?? inner.curve;
    if (duration != null) {
      const time = typeof duration === 'number' ? `${duration}ms` : String(duration).trim();
      value = [time, easing].filter(Boolean).join(' ');
    }
  }
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw || /^(none|false|0)$/i.test(raw) || raw.length > 80) return null;
  if (!/^[\w\s.,()-]+$/.test(raw) || !/\d\s*m?s\b/.test(raw)) return null;
  // `0.2s ease` names no property, and means all of them.
  return /^[\d.]/.test(raw) ? `all ${raw}` : raw;
}
