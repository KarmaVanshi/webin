/**
 * CSS value parsing, formatting and validation (§62, §63).
 *
 * Two rules drive this module:
 *   - Preserve the author's unit wherever possible (§63). If a site declares `2rem`,
 *     nudging the value should produce `2.5rem`, not `40px`.
 *   - Validate before applying (§62). A malformed value must never reach the page —
 *     page content is untrusted input and so is anything typed into the inspector (§74).
 */

export const LENGTH_UNITS = ['px', '%', 'rem', 'em', 'vw', 'vh', 'ch', 'pt'];
export const KEYWORD_UNITS = ['auto', 'none', 'inherit', 'initial', 'unset'];

const NUMBER = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)`;
const DIMENSION_RE = new RegExp(`^(${NUMBER})\\s*([a-z%]*)$`, 'i');
const CONTROL_CHARS = /[\x00-\x1F\x7F]/;

/**
 * Splits a dimension into number and unit.
 * @param {string} value
 * @returns {{number:number, unit:string, keyword:string|null}|null}
 */
export function parseDimension(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const lower = raw.toLowerCase();
  if (KEYWORD_UNITS.includes(lower)) return { number: 0, unit: '', keyword: lower };

  const match = raw.match(DIMENSION_RE);
  if (!match) return null;
  const number = Number.parseFloat(match[1]);
  if (!Number.isFinite(number)) return null;
  const unit = match[2].toLowerCase();
  const extra = ['fr', 's', 'ms', 'deg'];
  if (unit && !LENGTH_UNITS.includes(unit) && !extra.includes(unit)) return null;
  return { number, unit, keyword: null };
}

/** Formats a number + unit back into CSS, trimming float noise. */
export function formatDimension(number, unit = 'px') {
  if (!Number.isFinite(number)) return null;
  const rounded = Math.round(number * 1000) / 1000;
  if (rounded === 0 && unit !== '%') return unit === '' ? '0' : '0px';
  return `${rounded}${unit}`;
}

/**
 * Applies a delta to a dimension while keeping its unit (§63).
 * Used by number-input steppers and by drag/resize when the author used a relative unit.
 */
export function nudgeDimension(value, delta, fallbackUnit = 'px') {
  const parsed = parseDimension(value);
  if (!parsed || parsed.keyword) return formatDimension(delta, fallbackUnit);
  return formatDimension(parsed.number + delta, parsed.unit || fallbackUnit);
}

/** Converts a dimension to pixels where the conversion is knowable without layout. */
export function toPixels(value, context = {}) {
  const parsed = parseDimension(value);
  if (!parsed || parsed.keyword) return null;
  const {
    fontSize = 16, rootFontSize = 16,
    viewportWidth = 0, viewportHeight = 0, parentSize = 0,
  } = context;
  switch (parsed.unit) {
    case '':
    case 'px': return parsed.number;
    case 'rem': return parsed.number * rootFontSize;
    case 'em': return parsed.number * fontSize;
    case 'vw': return (parsed.number / 100) * viewportWidth;
    case 'vh': return (parsed.number / 100) * viewportHeight;
    case 'pt': return parsed.number * (96 / 72);
    case '%': return parentSize ? (parsed.number / 100) * parentSize : null;
    default: return null;
  }
}

/**
 * How long a `background-image` value may be.
 *
 * A picture chosen in the inspector is stored as a `data:` URL, because a declaration is
 * the only place an edit has to put it. This is the real ceiling on that, and the image
 * reader sizes its output to fit — it is exported so the two cannot drift apart, which is
 * exactly how the picker came to produce a value the gate below then threw away.
 */
export const MAX_IMAGE_VALUE = 1_600_000;

/**
 * The one shape a `url()` may take: an inline image, base64, and nothing else.
 *
 * `isSafeValue` refuses every URL because a URL in a value is a fetch the page did not ask
 * for — a beacon that fires on whatever site the edit is saved against. A `data:` URL
 * makes no request at all, so it gives that rule nothing to protect against, and it is the
 * only way an edit can hold a picture.
 *
 * Anchored, and over a charset that cannot express a second declaration: base64 has no
 * `;`, `{`, `<` or whitespace, so there is no room after the payload for anything else.
 * Base64 specifically — a plain `data:image/svg+xml,<svg …>` would let the markup be
 * written out in the open, and refusing it costs nothing, since everything the picker
 * produces is encoded anyway.
 */
const IMAGE_DATA_URL = /^url\("data:image\/(png|jpeg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}"\)$/;

/**
 * True for a `background-image` holding an inline image this extension produced.
 *
 * Kept separate from `isSafeValue` rather than folded into it, so the blanket rule against
 * URLs stays blanket everywhere else.
 */
export function isSafeImageValue(value) {
  const raw = String(value ?? '').trim();
  if (raw.length > MAX_IMAGE_VALUE) return false;
  if (CONTROL_CHARS.test(raw)) return false;
  return IMAGE_DATA_URL.test(raw);
}

/**
 * Rejects values that could smuggle extra declarations or fetches into the page (§74).
 * Anything containing a declaration separator, a comment, or a URL is refused outright.
 */
export function isSafeValue(value) {
  if (value == null) return false;
  const raw = String(value);
  if (raw.length > 512) return false;
  if (CONTROL_CHARS.test(raw)) return false;
  if (/[;{}<>]/.test(raw)) return false;
  if (raw.includes('/*') || raw.includes('*/')) return false;
  if (/url\s*\(/i.test(raw)) return false;
  if (/expression\s*\(/i.test(raw)) return false;
  if (/@import/i.test(raw)) return false;
  return true;
}

/** Property names the override engine will write. Anything outside this list is refused (§107). */
export const ALLOWED_PROPERTIES = new Set([
  // Layout
  'display', 'position', 'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'top', 'right', 'bottom', 'left', 'z-index', 'overflow', 'overflow-x', 'overflow-y', 'box-sizing',
  'float', 'clear', 'visibility', 'aspect-ratio',
  // Flex
  'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-content', 'align-self',
  'flex-grow', 'flex-shrink', 'flex-basis', 'order', 'gap', 'row-gap', 'column-gap',
  // Grid
  'grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row',
  'grid-column-start', 'grid-column-end', 'grid-row-start', 'grid-row-end',
  'justify-items', 'justify-self', 'place-items',
  // Spacing
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  // Typography
  'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing',
  'text-align', 'text-transform', 'text-decoration', 'text-decoration-line', 'white-space',
  'word-break', 'overflow-wrap', 'color',
  // Appearance
  'background-color', 'background-image', 'background-size', 'background-position',
  'background-repeat', 'background-attachment', 'background-clip', 'background-origin',
  'opacity', 'box-shadow', 'text-shadow', 'filter', 'mix-blend-mode',
  // A backdrop blur is a filter on what is behind the box rather than on the box. Both
  // spellings, because Safari still wants the prefix and a theme that asks for glass
  // should get it there too.
  'backdrop-filter', '-webkit-backdrop-filter',
  'border', 'border-width', 'border-style', 'border-color',
  'border-top', 'border-right', 'border-bottom', 'border-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-radius', 'border-top-left-radius', 'border-top-right-radius',
  'border-bottom-right-radius', 'border-bottom-left-radius',
  'outline', 'outline-color', 'outline-width', 'outline-style', 'outline-offset',
  // Text decoration and a few more typographic longhands a theme file tends to name.
  'text-decoration-color', 'text-decoration-style', 'text-underline-offset', 'font-variant',
  'font-stretch', 'text-indent', 'vertical-align', 'list-style',
  // The page's own chrome: the scrollbar, the caret, a form control's tint.
  'scrollbar-color', 'scrollbar-width', 'caret-color', 'accent-color', 'cursor',
  // Motion. `transition` cannot fetch anything and cannot name a rule, and a theme that
  // says how fast its hover should be is saying something worth honouring.
  'transition', 'transition-property', 'transition-duration', 'transition-timing-function',
  'transition-delay',
  // Transform
  'transform', 'transform-origin', 'rotate', 'scale', 'translate',
  // SVG / media (§104, §105)
  'fill', 'stroke', 'stroke-width', 'object-fit', 'object-position',
  // Layout escape hatch used by hide (§23)
  'pointer-events',
  // Only reachable from written CSS, and only useful there: a generated box needs
  // `content` before it exists at all. Safe for the same reason every other value is —
  // `isSafeValue` refuses a `url()`, so this cannot become a fetch.
  'content',
]);

/** True when the property may be written by the override engine. */
export function isAllowedProperty(property) {
  return ALLOWED_PROPERTIES.has(String(property).toLowerCase().trim());
}

/**
 * Gate every declaration through this before it reaches a stylesheet.
 * @returns {{ok:true, property:string, value:string}|{ok:false, reason:string}}
 */
export function validateDeclaration(property, value) {
  const prop = String(property ?? '').toLowerCase().trim();
  if (!prop) return { ok: false, reason: 'Empty property name.' };
  if (!isAllowedProperty(prop)) return { ok: false, reason: `"${prop}" is not an editable property.` };
  const val = String(value ?? '').trim();
  if (!val) return { ok: false, reason: 'Empty value.' };

  // A background may be a picture. Every other value, and every other property, keeps the
  // rule that a `url()` is refused outright.
  if (prop === 'background-image' && /^url\s*\(/i.test(val)) {
    return isSafeImageValue(val)
      ? { ok: true, property: prop, value: val }
      : { ok: false, reason: 'Only an inline image can be used as a background.' };
  }

  if (!isSafeValue(val)) return { ok: false, reason: 'Value contains characters that are not allowed.' };
  return { ok: true, property: prop, value: val };
}

/** camelCase -> kebab-case, for reading values off a computed-style object. */
export function toKebab(name) {
  return String(name).replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/** kebab-case -> camelCase. */
export function toCamel(name) {
  return String(name).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/** Extracts `var(--name)` references from a declared value (§53). */
export function extractVarRefs(value) {
  const refs = [];
  const re = /var\(\s*(--[\w-]+)/g;
  let m;
  while ((m = re.exec(String(value ?? ''))) !== null) refs.push(m[1]);
  return refs;
}

/**
 * Splits a box-shadow into editable parts (§22).
 * Handles the common `<color>? x y blur? spread? inset?` forms; returns null for
 * multi-layer or otherwise unrepresentable shadows so the UI can fall back to raw text.
 */
export function parseShadow(value) {
  const raw = String(value ?? '').trim();
  if (!raw || raw === 'none') return null;
  // Bail out on multiple comma-separated layers outside of colour functions.
  let depth = 0;
  for (const ch of raw) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) return null;
  }

  let rest = raw;
  let inset = false;
  if (/(^|\s)inset(\s|$)/i.test(rest)) {
    inset = true;
    rest = rest.replace(/(^|\s)inset(\s|$)/i, ' ').trim();
  }

  let color = null;
  const colorMatch = rest.match(/(rgba?\([^)]*\)|hsla?\([^)]*\)|#[0-9a-f]{3,8}|\b[a-z]+\b(?![\d(]))/i);
  if (colorMatch) {
    color = colorMatch[0];
    rest = (rest.slice(0, colorMatch.index) + rest.slice(colorMatch.index + colorMatch[0].length)).trim();
  }

  const lengths = rest.split(/\s+/).filter(Boolean);
  if (lengths.length < 2) return null;
  const num = (i) => (lengths[i] ? parseDimension(lengths[i]) : null);
  const x = num(0);
  const y = num(1);
  if (!x || !y) return null;
  return {
    x: x.number, y: y.number,
    blur: num(2)?.number ?? 0,
    spread: num(3)?.number ?? 0,
    color: color ?? 'rgba(0, 0, 0, 0.2)',
    inset,
  };
}

/** Rebuilds a box-shadow string from parsed parts. */
export function formatShadow(shadow) {
  if (!shadow) return 'none';
  const parts = [
    formatDimension(shadow.x ?? 0),
    formatDimension(shadow.y ?? 0),
    formatDimension(shadow.blur ?? 0),
    formatDimension(shadow.spread ?? 0),
    shadow.color ?? 'rgba(0, 0, 0, 0.2)',
  ];
  if (shadow.inset) parts.push('inset');
  return parts.join(' ');
}

/** Splits a computed 4-part shorthand (`margin`, `padding`) into sides. */
export function parseBox(top, right, bottom, left) {
  return {
    top: parseDimension(top)?.number ?? 0,
    right: parseDimension(right)?.number ?? 0,
    bottom: parseDimension(bottom)?.number ?? 0,
    left: parseDimension(left)?.number ?? 0,
  };
}
