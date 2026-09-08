/**
 * The theme system (§49, §87, §90).
 *
 * A theme is not a stylesheet that overwrites the page. It is a *remapping of the tokens
 * the page already uses* — which is the difference between re-skinning a site and
 * flattening it.
 *
 * Applying one is three steps:
 *   1. Detect the page's real tokens (tokens.js).
 *   2. Build a value→value mapping that preserves the page's own structure: the canvas
 *      stays the canvas, cards stay raised, buttons stay accented, links stay links.
 *   3. Stamp each element with the token ids it uses, and write one rule per token.
 *
 * That last step is what keeps this cheap. Rules are O(tokens) — a couple of dozen — not
 * O(elements), however large the page is (§71).
 *
 * The theme sheet is deliberately weaker than the override sheet: both use attribute
 * selectors of equal specificity, and the override sheet is kept last in the document, so
 * an edit you made by hand always beats the theme underneath it.
 */

import { TOKEN_ATTR, OWNED_ATTR, TOKEN_SCAN_LIMIT } from '../../shared/types.js';
import { parseColor, toCss, normaliseColor, luminance, contrastRatio, readableOn } from '../../shared/color.js';
import { Role, saturationOf } from './tokens.js';

export const THEME_STYLE_ID = 'widt-theme';

/** Stamp marking an element whose nearest painted background is the theme accent. */
const ON_ACCENT_MARK = 'on';

/**
 * Themes ship with the extension. Palettes are taken from the project's design data
 * rather than invented; see design-system/web-interface-devtools/MASTER.md.
 *
 * @typedef {{id:string, name:string, description:string, dark:boolean,
 *            palette:{background:string, surface:string, text:string, textMuted:string,
 *                     accent:string, onAccent:string, border:string},
 *            radius:number|null, fontFamily:string|null, shadow:string|null,
 *            density:number|null}} Theme
 */
export const PRESETS = Object.freeze([
  {
    id: 'editorial', name: 'Editorial', description: 'Near-black on paper with a pink accent.', dark: false,
    palette: { background: '#FAFAFA', surface: '#FFFFFF', text: '#09090B', textMuted: '#475569', accent: '#BE185D', onAccent: '#FFFFFF', border: '#E4E4E7' },
    radius: 2, fontFamily: 'Georgia, "Times New Roman", serif', shadow: 'none', density: 1.1,
  },
  {
    id: 'sage', name: 'Sage', description: 'Warm neutral paper with a calm teal.', dark: false,
    palette: { background: '#F5F5F0', surface: '#FFFFFF', text: '#0F172A', textMuted: '#475569', accent: '#0E7490', onAccent: '#FFFFFF', border: '#EDEEEF' },
    radius: 10, fontFamily: null, shadow: 'soft', density: 1,
  },
  {
    id: 'contrast', name: 'High Contrast', description: 'Navy and blue, maximum legibility.', dark: false,
    palette: { background: '#F8FAFC', surface: '#FFFFFF', text: '#020617', textMuted: '#334155', accent: '#0369A1', onAccent: '#FFFFFF', border: '#E2E8F0' },
    radius: 4, fontFamily: null, shadow: 'sharp', density: 1,
  },
  {
    id: 'terminal', name: 'Terminal', description: 'Deep dark with a success green.', dark: true,
    palette: { background: '#020617', surface: '#0E1223', text: '#F8FAFC', textMuted: '#94A3B8', accent: '#22C55E', onAccent: '#0F172A', border: '#334155' },
    radius: 4, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', shadow: 'none', density: 1,
  },
  {
    id: 'reading', name: 'Reading', description: 'Book brown on warm page amber.', dark: false,
    palette: { background: '#FFFBEB', surface: '#FFFFFF', text: '#1C1917', textMuted: '#78716C', accent: '#B45309', onAccent: '#FFFFFF', border: '#EEEDED' },
    radius: 6, fontFamily: 'Georgia, "Times New Roman", serif', shadow: 'none', density: 1.25,
  },
  {
    id: 'blossom', name: 'Blossom', description: 'Soft pink surfaces with a trust blue.', dark: false,
    palette: { background: '#FDF2F8', surface: '#FFFFFF', text: '#0F172A', textMuted: '#475569', accent: '#075985', onAccent: '#FFFFFF', border: '#FCE9F2' },
    radius: 16, fontFamily: null, shadow: 'soft', density: 1,
  },
]);

const SHADOWS = {
  none: 'none',
  soft: '0 4px 16px rgba(0, 0, 0, 0.08)',
  sharp: '0 2px 0 rgba(0, 0, 0, 0.9)',
};

/** Finds a preset by id. */
export function presetById(id) {
  return PRESETS.find((t) => t.id === id) ?? null;
}

/**
 * Builds the value→value mapping for a theme against a page's detected tokens.
 *
 * Each rule below exists because the naive version breaks something:
 *   - a saturated background is a button, not a surface — it maps to the accent, or the
 *     page's calls to action turn into flat grey boxes;
 *   - a saturated text colour is a link — same reasoning;
 *   - other backgrounds interpolate between canvas and surface by their own lightness
 *     order, so a page's sense of elevation survives the reskin;
 *   - other text colours interpolate between text and muted by contrast, so a caption
 *     stays quieter than a heading.
 *
 * @returns {{backgrounds:Map, texts:Map, borders:Map, radii:Map, paddings:Map, gaps:Map,
 *            accent:string, onAccent:string}}
 */
export function buildMapping(tokens, theme) {
  const p = theme.palette;
  const mapping = { backgrounds: new Map(), texts: new Map(), borders: new Map(), radii: new Map(), paddings: new Map(), gaps: new Map() };

  const pageBg = tokens.roles?.[Role.BACKGROUND] ?? null;
  const pageSurface = tokens.roles?.[Role.SURFACE] ?? null;

  // ── Backgrounds ──────────────────────────────────────────────────────
  const bgLum = tokens.backgrounds
    .map((t) => ({ ...t, parsed: parseColor(t.value) }))
    .filter((t) => t.parsed);
  const lums = bgLum.map((t) => luminance(t.parsed));
  const minLum = Math.min(...lums, 1);
  const maxLum = Math.max(...lums, 0);
  const span = Math.max(0.0001, maxLum - minLum);

  for (const token of bgLum) {
    if (token.value === pageBg) { mapping.backgrounds.set(token.value, p.background); continue; }
    if (token.value === pageSurface) { mapping.backgrounds.set(token.value, p.surface); continue; }
    if (saturationOf(token.parsed) > 0.3) { mapping.backgrounds.set(token.value, p.accent); continue; }
    const t = (luminance(token.parsed) - minLum) / span;
    mapping.backgrounds.set(token.value, mix(p.background, p.surface, t));
  }

  // ── Text ─────────────────────────────────────────────────────────────
  // Every colour that ends up carrying text is passed through the contrast guarantee
  // first (§106). A theme is free to choose a pretty accent; it is not free to choose an
  // unreadable one, and the shade that reads well as a *fill* is rarely the shade that
  // reads well as *text* on that same theme's paper.
  const readable = (color) => readableOn(color, [p.background, p.surface]);

  // A saturated text colour is a link. It keeps the accent hue so links still look like
  // links, at whatever lightness clears 4.5:1 on the surfaces it can land on.
  const linkColor = readable(p.accent);

  const themeBg = parseColor(p.background) ?? { r: 255, g: 255, b: 255, a: 1 };
  const textTokens = tokens.colors
    .map((t) => ({ ...t, parsed: parseColor(t.value) }))
    .filter((t) => t.parsed);
  const pageBgParsed = parseColor(pageBg ?? '#ffffff') ?? themeBg;
  const contrasts = textTokens.map((t) => contrastRatio(t.parsed, pageBgParsed));
  const maxContrast = Math.max(...contrasts, 1);

  for (const [index, token] of textTokens.entries()) {
    if (token.value === tokens.roles?.[Role.TEXT]) { mapping.texts.set(token.value, readable(p.text)); continue; }
    if (token.value === tokens.roles?.[Role.TEXT_MUTED]) { mapping.texts.set(token.value, readable(p.textMuted)); continue; }
    if (saturationOf(token.parsed) > 0.3) { mapping.texts.set(token.value, linkColor); continue; }
    // Quieter on the page stays quieter in the theme — but never quieter than legible.
    const t = 1 - contrasts[index] / maxContrast;
    mapping.texts.set(token.value, readable(mix(p.text, p.textMuted, t)));
  }

  // Text sitting on an accent background must stay legible (§106).
  mapping.accent = p.accent;
  mapping.onAccent = readableOn(p.onAccent, [p.accent]);

  // ── Borders ──────────────────────────────────────────────────────────
  for (const token of tokens.borders) mapping.borders.set(token.value, p.border);

  // ── Radius ───────────────────────────────────────────────────────────
  if (theme.radius != null && tokens.radii.length) {
    // Scale relative to the page's dominant radius, so a pill stays a pill.
    const dominant = [...tokens.radii].sort((a, b) => b.weight - a.weight)[0].value || 1;
    const factor = theme.radius / dominant;
    for (const token of tokens.radii) {
      mapping.radii.set(token.value, Math.round(Math.min(token.value * factor, 999)));
    }
  }

  // ── Density ──────────────────────────────────────────────────────────
  if (theme.density != null && theme.density !== 1) {
    for (const token of tokens.spacing) {
      mapping.paddings.set(token.value, Math.round(token.value * theme.density));
      mapping.gaps.set(token.value, Math.round(token.value * theme.density));
    }
  }

  return mapping;
}

/** Linear mix of two CSS colours. */
export function mix(a, b, t) {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return a;
  const k = Math.max(0, Math.min(1, t));
  return toCss({
    r: ca.r + (cb.r - ca.r) * k,
    g: ca.g + (cb.g - ca.g) * k,
    b: ca.b + (cb.b - ca.b) * k,
    a: ca.a + (cb.a - ca.a) * k,
  });
}

export class ThemeEngine {
  #doc;
  #view;
  #style = null;
  #stamped = new Set();
  #active = null;

  constructor({ doc = document, view = window } = {}) {
    this.#doc = doc;
    this.#view = view;
  }

  get active() {
    return this.#active;
  }

  /**
   * Applies a theme against freshly detected tokens.
   * @returns {{rules:number, stamped:number}}
   */
  apply(theme, tokens, { limit = TOKEN_SCAN_LIMIT } = {}) {
    this.clear();
    const mapping = buildMapping(tokens, theme);
    const ids = this.#stamp(mapping, limit);
    const css = this.#buildCss(theme, mapping, ids);

    this.#style = this.#doc.createElement('style');
    this.#style.id = THEME_STYLE_ID;
    this.#style.setAttribute(OWNED_ATTR, '');
    this.#style.textContent = css;
    // Insert first so per-element overrides, which come later, always win.
    const head = this.#doc.head ?? this.#doc.documentElement;
    head.insertBefore(this.#style, head.firstChild);

    this.#active = theme;
    return { rules: ids.size, stamped: this.#stamped.size };
  }

  /** Restamps newly inserted elements so dynamic content picks the theme up (§67). */
  restamp(tokens, { limit = TOKEN_SCAN_LIMIT } = {}) {
    if (!this.#active) return 0;
    const mapping = buildMapping(tokens, this.#active);
    return this.#stamp(mapping, limit).size;
  }

  /** Removes the theme entirely: stylesheet gone, every stamp removed. */
  clear() {
    this.#style?.remove();
    this.#style = null;
    for (const element of this.#stamped) element.removeAttribute?.(TOKEN_ATTR);
    // Catch anything stamped before a reload.
    for (const element of this.#doc.querySelectorAll(`[${TOKEN_ATTR}]`)) element.removeAttribute(TOKEN_ATTR);
    this.#stamped.clear();
    this.#active = null;
  }

  /** The generated CSS, for the read-only source view (§116). */
  toCss() {
    return this.#style?.textContent ?? '';
  }

  /**
   * Walks the page and records, per element, which mapped tokens it uses.
   * One attribute per element; the rules that read it are written once each.
   */
  #stamp(mapping, limit) {
    const ids = new Set();
    const index = {
      bg: indexOf(mapping.backgrounds), tx: indexOf(mapping.texts), bd: indexOf(mapping.borders),
      rd: indexOf(mapping.radii), pd: indexOf(mapping.paddings), gp: indexOf(mapping.gaps),
    };
    this.#ids = index;

    let seen = 0;
    // Each entry carries whether the nearest *painted* ancestor background is the accent.
    // Deciding that during the walk is what lets a nested card inside an accent panel keep
    // its own text colour; a descendant selector cannot express "nearest background" (§106).
    const stack = [[this.#doc.body ?? this.#doc.documentElement, false]];
    while (stack.length && seen < limit) {
      const [element, inheritedOnAccent] = stack.pop();
      if (!element || element.nodeType !== 1) continue;
      if (element.hasAttribute?.(OWNED_ATTR)) continue;
      seen += 1;

      let style;
      try {
        style = this.#view.getComputedStyle(element);
      } catch {
        continue;
      }

      const marks = [];
      const bg = normaliseColor(style.backgroundColor);
      if (bg && index.bg.has(bg)) marks.push(`bg${index.bg.get(bg)}`);

      // An opaque background is a new surface and answers for its whole subtree. Anything
      // see-through leaves the answer to whatever is showing through it.
      const bgParsed = parseColor(style.backgroundColor);
      const onAccent = bgParsed && bgParsed.a >= 1
        ? mapping.backgrounds.get(bg) === mapping.accent
        : inheritedOnAccent;
      if (onAccent) marks.push(ON_ACCENT_MARK);

      const color = normaliseColor(style.color);
      if (color && index.tx.has(color)) marks.push(`tx${index.tx.get(color)}`);
      const border = normaliseColor(style.borderTopColor);
      if (border && index.bd.has(border) && Number.parseFloat(style.borderTopWidth) > 0) {
        marks.push(`bd${index.bd.get(border)}`);
      }
      const radius = Math.round(Number.parseFloat(style.borderTopLeftRadius) || 0);
      if (index.rd.has(radius)) marks.push(`rd${index.rd.get(radius)}`);

      // Only uniform padding is remapped — scaling one side of an asymmetric box is how a
      // theme silently wrecks a layout.
      const pad = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'].map((k) => Math.round(Number.parseFloat(style[k]) || 0));
      if (pad.every((v) => v === pad[0]) && index.pd.has(pad[0])) marks.push(`pd${index.pd.get(pad[0])}`);

      const gap = Math.round(Number.parseFloat(style.rowGap) || 0);
      if (gap > 0 && index.gp.has(gap)) marks.push(`gp${index.gp.get(gap)}`);

      if (marks.length) {
        element.setAttribute(TOKEN_ATTR, marks.join(' '));
        this.#stamped.add(element);
        for (const mark of marks) ids.add(mark);
      }

      const children = element.children;
      for (let i = children.length - 1; i >= 0; i -= 1) stack.push([children[i], onAccent]);
    }
    return ids;
  }

  #ids = null;

  #buildCss(theme, mapping, used) {
    const rules = [];
    const attr = (mark) => `[${TOKEN_ATTR}~="${mark}"]`;

    const emit = (prefix, map, property, format = (v) => v) => {
      const index = this.#ids[prefix];
      for (const [from, to] of map) {
        const id = index.get(from);
        if (id == null || !used.has(`${prefix}${id}`)) continue;
        rules.push(`${attr(`${prefix}${id}`)} { ${property}: ${format(to)} !important; }`);
      }
    };

    emit('bg', mapping.backgrounds, 'background-color');
    emit('tx', mapping.texts, 'color');
    emit('bd', mapping.borders, 'border-color');
    emit('rd', mapping.radii, 'border-radius', (v) => `${v}px`);
    emit('pd', mapping.paddings, 'padding', (v) => `${v}px`);
    emit('gp', mapping.gaps, 'gap', (v) => `${v}px`);

    // Text on an accented fill has to stay readable (§106) — a link included, which would
    // otherwise keep its own accent colour and vanish into the fill behind it. This comes
    // after the text rules and matches at equal specificity, so it wins on order.
    if (used.has(ON_ACCENT_MARK)) {
      rules.push(`${attr(ON_ACCENT_MARK)} { color: ${mapping.onAccent} !important; }`);
    }

    // Page-wide settings that need no stamping.
    const root = [];
    if (theme.palette.background) root.push(`background-color: ${theme.palette.background} !important`);
    if (theme.fontFamily) root.push(`font-family: ${theme.fontFamily} !important`);
    if (root.length) rules.unshift(`html, body { ${root.join('; ')}; }`);
    if (theme.fontFamily) {
      // Leave icon fonts and code alone; re-facing those breaks glyphs and alignment.
      rules.push(`body *:not(code):not(pre):not([class*="icon"]):not([class*="fa-"]) { font-family: inherit !important; }`);
    }
    if (theme.shadow && SHADOWS[theme.shadow]) {
      rules.push(`[${TOKEN_ATTR}] { box-shadow: ${SHADOWS[theme.shadow]}; }`);
    }

    return `/* Web Interface DevTools — theme: ${theme.name} */\n${rules.join('\n')}`;
  }
}

function indexOf(map) {
  const index = new Map();
  let i = 0;
  for (const key of map.keys()) {
    index.set(key, i);
    i += 1;
  }
  return index;
}

/** Captures the page's current look as a theme the user can reuse (§92). */
export function themeFromTokens(tokens, name = 'My theme') {
  const roles = tokens.roles ?? {};
  const bg = roles[Role.BACKGROUND] ?? '#FFFFFF';
  const isDark = (luminance(parseColor(bg) ?? { r: 255, g: 255, b: 255 })) < 0.3;
  const surface = roles[Role.SURFACE] ?? bg;
  const text = roles[Role.TEXT] ?? (isDark ? '#FFFFFF' : '#111111');
  const accent = roles[Role.ACCENT] ?? '#6366F1';
  // A captured palette is lifted off a real page, and real pages are often already
  // illegible. Capturing one should not carry that forward as a reusable theme (§106).
  const readable = (color) => readableOn(color, [bg, surface]);
  return {
    id: `custom-${Date.now().toString(36)}`,
    name,
    description: 'Captured from this page.',
    dark: isDark,
    palette: {
      background: bg,
      surface,
      text: readable(text),
      textMuted: readable(roles[Role.TEXT_MUTED] ?? mix(text, bg, 0.4)),
      accent,
      onAccent: readableOn(isDark ? '#0F172A' : '#FFFFFF', [accent]),
      border: roles[Role.BORDER] ?? mix(bg, text, 0.12),
    },
    radius: [...tokens.radii].sort((a, b) => b.weight - a.weight)[0]?.value ?? null,
    fontFamily: tokens.fonts[0]?.value ?? null,
    shadow: tokens.shadows.length ? 'soft' : 'none',
    density: 1,
    custom: true,
  };
}
