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
export const RULE_TARGETS = Object.freeze([...ROLES, 'surface', 'body', 'heading', 'link', 'small']);

/**
 * The states a rule may be for.
 *
 * `current` is the item that is *selected* — the page you are on in a nav, the row that
 * is open — as distinct from `active`, which is the moment a button is held down.
 */
export const RULE_STATES = Object.freeze(['hover', 'active', 'focus', 'placeholder', 'current',
  'secondary', 'secondaryHover']);

/**
 * The states that are only a way of telling one kind of a target from another.
 *
 * A theme's `buttons.secondary` is not a moment in a button's life but a different button
 * — the one that was not the page's call to action. The engine marks a button whose own
 * fill was the page's accent as primary, and `secondary` is every other one; the state is
 * meaningless on any other target, and is dropped there.
 */
const BUTTON_ONLY_STATES = new Set(['secondary', 'secondaryHover']);

/**
 * The parts of a target a rule may be written for.
 *
 * A table is the one target a file describes in pieces — its header row and its body rows
 * — and the engine writes the selector for each piece itself, the way it does for the
 * target. Nothing else has parts.
 */
export const RULE_PARTS = Object.freeze({ table: ['header', 'row'] });

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
  button: ['button', 'buttons', 'btn', 'primarybutton', 'cta', 'buttonprimary', 'secondarybutton', 'buttonsecondary',
    'ghostbutton', 'buttonghost', 'outlinebutton', 'buttonoutline'],
  field: ['field', 'fields', 'input', 'inputs', 'textarea', 'select', 'textfield', 'form'],
  table: ['table', 'tables', 'grid', 'datatable'],
  surface: ['surface', 'surfaces', 'card', 'cards', 'panel', 'panels', 'window', 'windows',
    'container', 'containers', 'tile', 'tiles', 'box', 'boxes'],
  body: ['body', 'page', 'text', 'root'],
  heading: ['heading', 'headings', 'title', 'titles', 'headline', 'headlines'],
  link: ['link', 'links', 'anchor', 'anchors', 'a'],
  small: ['small', 'caption', 'captions', 'fineprint', 'footnote', 'footnotes', 'meta'],
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
  translatey: 'transform', translatex: 'transform', lift: 'transform', translate: 'transform',
  ring: 'box-shadow', focusring: 'box-shadow',
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
 * A movement on hover, however the file wrote it: `translateY(-2px)` as CSS, `"-2px"` under
 * a `translateY` key, or a bare `-2` — the last two are a vertical travel in px.
 */
function transformOf(key, value) {
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0 ? `translateY(${value}px)` : null;
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw || /^(none|0|0px)$/i.test(raw)) return null;
  if (/\(/.test(raw)) return raw;
  if (!LENGTH.test(raw)) return null;
  const length = /^-?\d*\.?\d+$/.test(raw) ? `${raw}px` : raw;
  return key === 'translatex' ? `translateX(${length})` : `translateY(${length})`;
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

  const into = (bucket, property, value, word = '') => {
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
    if (property === 'transform') {
      const t = transformOf(word, value);
      if (t) bucket.transform = t;
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
      if (property) into(bucket, property, value, rest);
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
    into(out.base, property, value, flat);
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

/** The words a file uses for the plain button beside a primary one, and for the primary. */
const PLAIN_BUTTON_WORDS = new Set(['button', 'buttons', 'btn']);
const PRIMARY_BUTTON_WORDS = new Set(['primarybutton', 'buttonprimary', 'cta']);
const SECONDARY_BUTTON_WORDS = new Set(['secondarybutton', 'buttonsecondary', 'ghostbutton', 'buttonghost',
  'outlinebutton', 'buttonoutline']);

/** Variant names inside a buttons block that describe the button that is not the call to action. */
const SECONDARY_VARIANTS = ['secondary', 'outline', 'outlined', 'ghost', 'tertiary'];

/** The format's own levers. A material made of nothing else is not written CSS. */
const LEVER_KEYS = new Set(['borderWidth', 'blur', 'radius', 'surfaceAlpha', 'shadow']);

/**
 * The named materials a file keeps, by lower-cased name, from whichever block it used —
 * but only the ones written in CSS-shaped words. The format's own materials are four
 * numbers the engine composes from, and reading `{ blur: 28 }` back as a declaration
 * would turn every saved theme into its own duplicate on the next open.
 */
function materialBlocks(source) {
  const out = {};
  for (const key of ['materials', 'material', 'surfaces']) {
    const block = source[key];
    if (!block || typeof block !== 'object' || Array.isArray(block)) continue;
    for (const [name, value] of Object.entries(block)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      if (!Object.keys(value).some((k) => !LEVER_KEYS.has(k))) continue;
      out[name.toLowerCase()] ??= value;
    }
  }
  return out;
}

/** The first string in a block, for a `glow` a file wrote as one shadow or as a few named ones. */
function firstString(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return null;
  return Object.values(value).find((v) => typeof v === 'string') ?? null;
}

/**
 * Rules for every kind of element the file describes, in its own words.
 *
 * Two passes, in a fixed order, because the rules are folded later with the rule read
 * last answering where two disagree. First everything the file says about the theme as a
 * whole — its typography, its one shadow, its glow, its shadow scale, what happens under
 * the pointer and on focus, its named materials. Then every block that describes one kind
 * of element, which therefore wins over the general statement: a `cards.shadow` beats
 * `effects.shadow`, as it should, and a file that says `surfaces.card` and also
 * `cards.default` has described its card twice, half in each place, and both halves count.
 *
 * Three places are looked in for element blocks — `components`, `elements`, and the theme
 * itself. A block that names a material (`modal: { material: "strong" }`) is read as that
 * material's declarations with its own on top, so the material's border, shadow and blur
 * reach the page rather than only the four levers the format keeps for it.
 *
 * @returns {Array<{target:string, state:string|null, properties:object}>} raw, unvalidated
 */
export function readComponentRules(source) {
  if (!source || typeof source !== 'object') return [];
  const rules = [];
  const push = (target, state, properties, extra = {}) => {
    if (properties && Object.keys(properties).length) rules.push({ target, state, properties, ...extra });
  };
  const set = (bucket, property, value) => { const c = coerce(property, value); if (c != null) bucket[property] = c; };
  const first = (...values) => values.find((v) => v != null && v !== '');
  const object = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
  const shadowString = (v) => (typeof v === 'string' && /\d/.test(v) ? v.trim() : null);

  // ── The theme as a whole ──────────────────────────────────────────────────────────────

  // Typography, which files write as one block about two kinds of text.
  const typography = object(source.typography) ?? {};
  const body = {};
  const heading = {};
  const bodyBlock = object(typography.body) ?? {};
  const headingBlock = object(typography.heading) ?? {};

  const bodySize = first(bodyBlock.size, bodyBlock.fontSize, typography.bodyFontSize, typography.fontSize, typography.baseSize);
  const bodyWeight = first(bodyBlock.weight, bodyBlock.fontWeight, typography.bodyWeight, typography.bodyFontWeight,
    typography.fontWeight, typography.weight);
  const bodyLine = first(bodyBlock.lineHeight, typography.lineHeight, typography.bodyLineHeight);
  // A bare `letterSpacing` is the body's; the headings inherit it unless they have their own.
  const bodySpacing = first(bodyBlock.letterSpacing, typography.bodyLetterSpacing, typography.letterSpacing);
  const bodyColour = first(bodyBlock.color, typography.bodyColor, typography.color);
  const headingSpacing = first(headingBlock.letterSpacing, typography.headingLetterSpacing);
  const headingColour = first(headingBlock.color, typography.headingColor);
  const headingTransform = first(headingBlock.textTransform, typography.headingTransform);

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
  // The small print, when the file describes it: `<small>` and a figure's caption.
  const smallBlock = object(typography.small) ?? object(typography.caption) ?? object(typography.fine);
  if (smallBlock) push('small', null, readDeclarations(smallBlock, 'small').base);

  // A `borders` block is the edge every surface gets.
  const borders = object(source.borders);
  if (borders) {
    const edge = {};
    set(edge, 'border-width', borders.width ?? borders.borderWidth);
    if (borders.style && BORDER_STYLES.has(String(borders.style).toLowerCase())) edge['border-style'] = String(borders.style).toLowerCase();
    set(edge, 'border-color', borders.color ?? borders.borderColor);
    set(edge, 'border-radius', borders.radius ?? borders.borderRadius);
    push('surface', null, edge);
  }

  const effects = object(source.effects) ?? {};

  // A glow written as a shadow is the bloom on the headings, which is what the format's
  // own `glow` means; the file has said what colour and how wide.
  const glow = firstString(effects.glow ?? effects.textGlow ?? effects.headingGlow);
  if (shadowString(glow)) push('heading', null, { 'text-shadow': glow.trim() });

  // A scale of named shadows is a statement about depth: the middle of it is a card, the
  // deep end is a modal, and whatever floats is a popover. Read before the element blocks
  // so a card that names its own shadow is not overruled by the scale.
  const scale = object(source.shadows) ?? {};
  const fromScale = (...names) => shadowString(first(...names.map((n) => scale[n])));
  const cardShadow = fromScale('card', 'medium', 'md', 'default', 'soft', 'small', 'sm');
  const modalShadow = fromScale('modal', 'large', 'lg', 'deep', 'xl', 'floating', 'medium');
  const popoverShadow = fromScale('popover', 'floating', 'large', 'lg', 'medium', 'md');
  if (cardShadow) push('surface', null, { 'box-shadow': cardShadow });
  if (modalShadow) push('modal', null, { 'box-shadow': modalShadow });
  if (popoverShadow) push('popover', null, { 'box-shadow': popoverShadow });

  // What happens under the pointer, said once for the theme: a movement, a deeper shadow.
  // Cards and buttons both move; a nav bar does not, or it takes its fixed children with it.
  const hoverBlocks = [object(source.motion?.hover), object(source.effects?.hover), object(source.interaction?.hover),
    object(source.animation?.hover), object(source.transitions?.hover)].filter(Boolean);
  const hover = {};
  for (const block of hoverBlocks) {
    const moved = first(block.transform, block.lift, block.translateY, block.translate, block.move);
    const t = transformOf(block.translateY != null ? 'translatey' : 'lift', moved);
    if (t && !hover.transform) hover.transform = t;
    const shadow = shadowString(first(block.shadow, block.boxShadow, block.elevation));
    if (shadow && !hover['box-shadow']) hover['box-shadow'] = shadow;
  }
  const animation = object(source.animation) ?? {};
  const hoverTransform = transformOf('lift', first(animation.hoverTransform, animation.hover?.transform, effects.hoverTransform, effects.hoverLift));
  if (hoverTransform && !hover.transform) hover.transform = hoverTransform;
  const hoverShadow = shadowString(first(effects.hoverShadow, effects.shadowHover, animation.hoverShadow));
  if (hoverShadow && !hover['box-shadow']) hover['box-shadow'] = hoverShadow;
  push('surface', 'hover', { ...hover });
  push('button', 'hover', { ...hover });

  // The ring on focus, as written — a `0 0 0 3px rgba(…)` is a shadow, and its colour is
  // the file's, not a guess from the accent.
  const focusBlocks = [object(effects.focus), object(source.interaction?.focus), object(source.focus)].filter(Boolean);
  const ring = shadowString(first(...focusBlocks.map((b) => first(b.ring, b.focusRing, b.shadow, b.boxShadow, b.glow)),
    effects.focusRing, effects.focusGlow));
  if (ring) {
    push('field', 'focus', { 'box-shadow': ring });
    push('button', 'focus', { 'box-shadow': ring });
  }

  // An accent with a hover of its own is the button's hover and the link's.
  const palette = object(source.palette) ?? object(source.colors) ?? object(source.colours) ?? {};
  const accentHover = coerce('color', first(palette.accentHover, palette.primaryHover, palette.brandHover, palette.linkHover));
  if (accentHover) {
    push('button', 'hover', { 'background-color': accentHover });
    push('link', 'hover', { color: accentHover });
  }

  // The named materials, as declarations. A `default` material is every surface; whatever
  // `floats` is the modal and the popover; a `strong` one is the modal. Anything else is a
  // name for an element block to point at, below.
  const materials = materialBlocks(source);
  const materialRule = (name, target) => {
    const block = materials[name];
    if (!block) return;
    const { base, states } = readDeclarations(block, target);
    push(target, null, base);
    for (const [state, properties] of Object.entries(states)) push(target, state, properties);
  };
  for (const name of ['default', 'base', 'card', 'panel']) if (materials[name]) { materialRule(name, 'surface'); break; }
  for (const name of ['strong', 'elevated', 'raised']) if (materials[name]) { materialRule(name, 'modal'); break; }
  if (materials.floating) { materialRule('floating', 'modal'); materialRule('floating', 'popover'); }

  // A surface for readers who have asked their system for less transparency: the file
  // names the opaque fill it falls back to, and the blur goes with it.
  const reduced = object(source.accessibility?.reducedTransparency);
  const fallback = coerce('background-color', first(reduced?.fallbackSurface, reduced?.surface, reduced?.background));
  if (fallback) {
    push('surface', null, { 'background-color': fallback, 'backdrop-filter': 'none' },
      { media: '@media (prefers-reduced-transparency: reduce)' });
  }

  // ── Each kind of element ─────────────────────────────────────────────────────────────

  // A block that points at a material is that material with its own words on top. The
  // pointer itself is not a declaration and is left out of what is read.
  const resolved = (value) => {
    const named = typeof value.material === 'string' ? materials[value.material.toLowerCase()] : null;
    if (!named) return value;
    const merged = { ...named, ...value };
    // An element that names a material and restates only its blur means the material's
    // filter chain at that blur — `blur(30px) saturate(135%)` — not a bare blur in its place.
    const chain = first(named.backdropFilter, named.backdrop, named.filter);
    const own = first(value.blur, value.backdropBlur);
    const bare = own != null && !/\(/.test(String(own)) ? String(own).trim().replace(/px$/i, '') : null;
    if (typeof chain === 'string' && /blur\(/i.test(chain) && bare && /^\d*\.?\d+$/.test(bare)) {
      merged.backdropFilter = chain.replace(/blur\([^)]*\)/i, `blur(${bare}px)`);
      delete merged.blur;
      delete merged.backdropBlur;
      delete merged.webkitBackdropFilter;
    }
    return merged;
  };
  const rulesFor = (target, block, state = null) => {
    const { base, states } = readDeclarations(block, target);
    push(target, state, base);
    for (const [s, properties] of Object.entries(states)) {
      // A secondary button's hover is its own state, not the primary's.
      const name = state === 'secondary' ? (s === 'hover' ? 'secondaryHover' : null) : s;
      if (name) push(target, name, properties);
    }
  };

  const blocks = [source.components, source.elements, source].filter((b) => b && typeof b === 'object');
  for (const block of blocks) {
    const words = Object.keys(block).map((k) => k.toLowerCase().replace(/[\s_-]+/g, ''));
    const hasPrimary = words.some((w) => PRIMARY_BUTTON_WORDS.has(w));
    for (const [key, value] of Object.entries(block)) {
      const target = targetOf(key);
      if (!target) continue;
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const flat = key.toLowerCase().replace(/[\s_-]+/g, '');
      // `text: { color, headingColor }` is the body's ink and the headings' ink at once.
      if (target === 'body' && flat === 'text') {
        const c = coerce('color', value.color);
        if (c) push('body', null, { color: c });
        const h = coerce('color', value.headingColor ?? value.heading);
        if (h) push('heading', null, { color: h });
        continue;
      }

      // A plain `button` beside a `primaryButton` is the other kind of button, and a
      // block that calls itself the secondary one is that whatever it sits beside.
      if (target === 'button' && ((hasPrimary && PLAIN_BUTTON_WORDS.has(flat)) || SECONDARY_BUTTON_WORDS.has(flat))) {
        rulesFor('button', resolved(variantOf(value, target)), 'secondary');
        continue;
      }

      rulesFor(target, resolved(variantOf(value, target)));

      // The variants a buttons block keeps beside its primary: the first that describes
      // a button other than the call to action is the secondary button.
      if (target === 'button' && isNested(value)) {
        const variant = SECONDARY_VARIANTS.map((n) => object(value[n])).find(Boolean);
        if (variant) rulesFor('button', resolved(variant), 'secondary');
      }

      // A table's pieces: its header row and its body rows, each with states of its own.
      if (target === 'table') {
        const parts = { header: first(value.header, value.head, value.thead, value.th), row: first(value.row, value.rows, value.tr, value.td, value.cell) };
        for (const [part, piece] of Object.entries(parts)) {
          if (!object(piece)) continue;
          const { base, states } = readDeclarations(piece, target);
          push('table', null, base, { part });
          for (const [s, properties] of Object.entries(states)) push('table', s, properties, { part });
        }
      }
    }
  }

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
        part: entry.part ?? undefined,
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

  let state = RULE_STATES.includes(raw.state) ? raw.state : null;
  if (state && BUTTON_ONLY_STATES.has(state) && target !== 'button') state = null;
  const part = target && RULE_PARTS[target]?.includes(raw.part) ? raw.part : null;
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

  return { target, selector, state, part, media, properties };
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
    const key = `${rule.target ?? `s:${rule.selector}`}|${rule.part ?? ''}|${rule.state ?? ''}|${rule.media ?? ''}`;
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
    if (!target || ['body', 'heading', 'link', 'small'].includes(target)) continue;
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

  let value = effects.transition ?? motion.transition ?? source.transition
    ?? effects.hover?.transition ?? motion.hover?.transition ?? source.interaction?.transition ?? null;
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
