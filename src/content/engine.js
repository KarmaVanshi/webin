/**
 * The theme engine.
 *
 * A theme is not a stylesheet that overwrites the page. It is a *remapping of the values
 * the page already paints with* — which is the difference between re-skinning a site and
 * flattening it.
 *
 * Applying one is four steps:
 *   1. Detect what the page actually uses (tokens.js).
 *   2. Build a value→value mapping that preserves the page's own structure: the canvas
 *      stays the canvas, cards stay raised, buttons stay accented, links stay links.
 *   3. Remap the page's root custom properties. On a web-component site this does most of
 *      the work, because those variables reach inside shadow roots and selectors do not.
 *   4. Stamp every element with the ids of the tokens it uses, and write one rule per
 *      token.
 *
 * That last step is what keeps this cheap: rules are O(tokens) — a few dozen — not
 * O(elements), however large the page is.
 */

import { TOKEN_ATTR, WID_ATTR, Mark, STAMP_LIMIT } from '../shared/types.js';
import {
  parseColor, toCss, normaliseColor, luminance, contrastRatio, readableOn,
  ensureReadable, inkFor, flatten,
} from '../shared/color.js';
import { Role, saturationOf, chromaOf } from './tokens.js';
import { walkTree, collectShadowRoots, SKIP } from './dom.js';
import { SheetRegistry } from './sheets.js';

/** A colour this saturated is chromatic rather than neutral. */
const CHROMATIC = 0.3;

/**
 * A brand colour is far from grey, not merely tinted. A pastel is a *surface* — a pale
 * peach container, a pink card — and painting every one of them with the theme accent
 * turns a page into a poster. Chroma separates the two; HSL saturation does not, since a
 * pastel reports as fully saturated.
 */
const BRAND_CHROMA = 0.22;

function isBrand(colour) {
  return saturationOf(colour) > CHROMATIC && chromaOf(colour) >= BRAND_CHROMA;
}

/** Above this contrast against the canvas, a neutral is ink rather than paper. */
const INK = 3;

/** Smallest box that can wear a card treatment. Below this it is a chip or a dot. */
const SURFACE_MIN = { width: 48, height: 28 };

/** WCAG AA for body text. The floor the readability guarantee holds text above. */
const READABLE = 4.5;

export class ThemeEngine {
  #doc;
  #view;
  #sheets;
  #stamped = new Set();
  #active = null;
  #index = null;
  #mapping = null;
  /** Marks that have appeared so far, and therefore need a rule. */
  #used = new Set();
  /** Whether unreadable text gets forced to black or white. A user setting. */
  #forceReadable = true;

  constructor({ doc = document, view = window } = {}) {
    this.#doc = doc;
    this.#view = view;
    this.#sheets = new SheetRegistry(doc);
  }

  get active() { return this.#active; }
  get css() { return this.#sheets.css; }

  /**
   * The part of the applied theme that needs no stamping, for caching against the site.
   * Injected on the next load before the page paints.
   */
  get rootCss() {
    return this.#active && this.#mapping ? rootCss(this.#active, this.#mapping) : '';
  }

  /**
   * Applies a theme against freshly detected tokens.
   * @returns {{rules:number, stamped:number, variables:number, roots:number}}
   */
  apply(theme, tokens, { limit = STAMP_LIMIT, forceReadable = true } = {}) {
    this.#forceReadable = forceReadable !== false;
    this.#unstamp();
    // Stamping has to read the page as the site painted it, so whatever theme is already
    // applied is emptied out first. This happens in the same task as the re-write below,
    // so the browser never gets a frame in which to paint the bare page.
    this.#sheets.update('');
    this.#active = theme;
    this.#mapping = buildMapping(tokens, theme);
    this.#used = new Set();
    this.#index = {
      bg: indexOf(this.#mapping.backgrounds), tx: indexOf(this.#mapping.texts), bd: indexOf(this.#mapping.borders),
      rd: indexOf(this.#mapping.radii), pd: indexOf(this.#mapping.paddings), gp: indexOf(this.#mapping.gaps),
    };

    this.#stampTree(this.#doc, this.#rootContext(), limit, { bare: true });
    this.#writeCss();
    const roots = this.#syncRoots(limit);

    return {
      rules: this.#used.size,
      stamped: this.#stamped.size,
      variables: this.#mapping.variables.length,
      roots,
    };
  }

  /**
   * Re-stamps the whole page. Used after a client-side navigation, where the body has
   * been replaced wholesale.
   */
  restamp({ limit = STAMP_LIMIT } = {}) {
    if (!this.#active) return 0;
    const before = this.#used.size;
    this.#stampTree(this.#doc, this.#rootContext(), limit);
    if (this.#used.size !== before) this.#writeCss();
    this.#syncRoots(limit);
    return this.#stamped.size;
  }

  /**
   * Re-stamps only the subtrees that were just inserted.
   *
   * This is the difference between a themed infinite feed and an unusable one: a full
   * walk of YouTube costs a couple of hundred milliseconds and the observer fires every
   * few hundred while you scroll, so the only affordable pass is one over the new nodes.
   *
   * @param {Element[]} roots elements the page has just added.
   */
  restampFrom(roots, { limit = 4000 } = {}) {
    if (!this.#active || !roots.length) return 0;
    const before = this.#used.size;
    let budget = limit;
    for (const root of roots) {
      if (budget <= 0) break;
      if (!root.isConnected) continue;
      budget -= this.#stampTree(root, this.#inheritedContext(root), budget);
    }
    if (this.#used.size !== before) this.#writeCss();
    this.#syncRoots(2000);
    return this.#stamped.size;
  }

  /** Removes the theme entirely: stylesheets gone, every stamp removed. */
  clear() {
    this.#sheets.clear();
    this.#unstamp();
    this.#active = null;
    this.#mapping = null;
    this.#used = new Set();
  }

  #writeCss() {
    this.#sheets.update(buildCss(this.#active, this.#mapping, this.#used, this.#index));
  }

  #syncRoots(limit) {
    const roots = collectShadowRoots(this.#doc, limit);
    this.#sheets.sync(roots);
    return roots.length;
  }

  #unstamp() {
    for (const element of this.#stamped) element.removeAttribute?.(TOKEN_ATTR);
    // Catch anything stamped before a reload or by a previous instance.
    for (const element of this.#doc.querySelectorAll?.(`[${TOKEN_ATTR}]`) ?? []) {
      element.removeAttribute(TOKEN_ATTR);
    }
    this.#stamped.clear();
  }

  /**
   * Walks a tree and records, per element, which mapped tokens it uses.
   * One attribute per element; the rules that read it are written once each.
   *
   * There are two situations, and they need opposite readings of the same value:
   *
   *   - **bare** — an `apply()`, where the theme's stylesheet has just been emptied. Every
   *     value on the page is the site's own, so a value is looked up directly.
   *   - **themed** — a re-stamp while the theme is live. Now a value may be one the theme
   *     itself produced, so the reverse table is consulted first: a colour this theme
   *     outputs is already correct and must not be mistaken for a page token that happens
   *     to look the same. (White is the obvious trap — the page's canvas and the theme's
   *     card colour are both `#ffffff` often enough to matter.)
   *
   * In the themed case an element that already carries a stamp is left exactly as it is.
   * That is what stops values drifting: a padding of 16 becomes 18, and re-reading 18 as
   * if it were a page token would map it to 20, then 22, on every pass.
   *
   * @returns {number} elements visited.
   */
  #stampTree(root, context, limit, { bare = false } = {}) {
    const mapping = this.#mapping;
    const index = this.#index;
    const used = this.#used;
    const forceReadable = this.#forceReadable;
    // Index -> page token, precomputed: the surface test needs it on every element.
    const bgTokens = [...index.bg.keys()];
    const txTokens = [...index.tx.keys()];
    const base = context ?? this.#rootContext();
    const resolve = bare
      ? (ids, reverse, value) => (value != null && ids.has(value) ? ids.get(value) : null)
      : (ids, reverse, value) => {
        if (value == null) return null;
        const original = reverse.get(value);
        if (original != null) return ids.get(original) ?? null;
        return ids.has(value) ? ids.get(value) : null;
      };

    return walkTree(root, (element, above) => {
      // The context threaded down the tree answers two questions an element cannot answer
      // alone: is it sitting on an accent fill, and what colour is actually painted behind
      // it. Both are inherited until something opaque overrides them.
      const parent = above ?? base;
      const onAccentAbove = parent.onAccent;

      // The root and the body are painted by the theme's own root rules, so stamping them
      // adds nothing — and would re-read the canvas the theme just set as if it were a
      // page token.
      const tag = element.tagName;
      if (tag === 'HTML' || tag === 'BODY') return parent;

      // An element the user has edited by hand belongs to them now. Stamping reads live
      // computed styles, so a re-stamp would read the colour they just chose and file it
      // as one of the site's own tokens — and then remap it on the next theme change.
      if (element.hasAttribute(WID_ATTR)) return parent;

      // An element the theme has already stamped keeps what it was given.
      if (!bare) {
        const existing = element.getAttribute(TOKEN_ATTR);
        if (existing) {
          const marks = existing.split(' ');
          for (const mark of marks) used.add(mark);
          return {
            onAccent: marks.includes(Mark.ON_ACCENT),
            bg: paintedFromMarks(marks, bgTokens, mapping, parent.bg),
          };
        }
      }

      let style;
      try {
        style = this.#view.getComputedStyle(element);
      } catch {
        return SKIP;
      }

      const marks = [];
      const bg = normaliseColor(style.backgroundColor);
      const bgParsed = parseColor(style.backgroundColor);
      const bgId = resolve(index.bg, mapping.reverse.backgrounds, bg);
      if (bgId != null) marks.push(`bg${bgId}`);

      // An opaque background is a new surface and answers for its whole subtree. Anything
      // see-through leaves the answer to whatever is showing through it.
      const opaque = bgParsed ? bgParsed.a >= 0.9 : false;
      // The page token this background stands for, whichever form it is currently in.
      const original = bgId == null ? null : bgTokens[bgId];
      const onAccent = opaque && original != null
        ? mapping.backgrounds.get(original) === mapping.accent
        : onAccentAbove;
      if (onAccent) marks.push(Mark.ON_ACCENT);

      // What this element will *actually* be painted with once the theme is on: the
      // theme's value where the background was remapped, the site's own where it was not,
      // composited onto whatever is behind it where it is see-through. Measuring text
      // against the theme's canvas instead of this is what lets grey-on-grey through.
      const paintedBg = paintBackground(bgId, original, bgParsed, mapping, parent.bg);

      // Only a box that paints its own opaque, non-canvas background is a card. Shadows,
      // blur and forced borders apply to those and nothing else — putting a drop shadow on
      // every stamped element is how a theme turns a page into soup.
      // The longhand first; some engines only report the shorthand for a shared radius.
      const cornerValue = style.borderTopLeftRadius || style.borderRadius || '0';
      const rounded = String(cornerValue).includes('%');
      const corner = rounded ? Infinity : Math.round(Number.parseFloat(cornerValue) || 0);
      if (opaque && bgId != null && original !== mapping.canvas) {
        const rect = element.getBoundingClientRect();
        // A pill or a circle is a chip, a tag or an avatar. Handing it a card's corner
        // radius is how an avatar comes out as a rounded square.
        const isPill = corner * 2 >= Math.min(rect.width, rect.height);
        if (!isPill && rect.width >= SURFACE_MIN.width && rect.height >= SURFACE_MIN.height) {
          marks.push(Mark.SURFACE);
        }
      }

      const textValue = normaliseColor(style.color);
      const textId = resolve(index.tx, mapping.reverse.texts, textValue);
      if (textId != null) marks.push(`tx${textId}`);

      if (Number.parseFloat(style.borderTopWidth) > 0) {
        const borderId = resolve(index.bd, mapping.reverse.borders, normaliseColor(style.borderTopColor));
        if (borderId != null) marks.push(`bd${borderId}`);
      }

      const radiusId = rounded ? null : resolve(index.rd, mapping.reverse.radii, corner);
      if (radiusId != null) marks.push(`rd${radiusId}`);

      // Only uniform padding is remapped — scaling one side of an asymmetric box is how a
      // theme silently wrecks a layout.
      const pad = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']
        .map((k) => Math.round(Number.parseFloat(style[k]) || 0));
      if (pad.every((v) => v === pad[0])) {
        const padId = resolve(index.pd, mapping.reverse.paddings, pad[0]);
        if (padId != null) marks.push(`pd${padId}`);
      }

      const gap = Math.round(Number.parseFloat(style.rowGap) || 0);
      if (gap > 0) {
        const gapId = resolve(index.gp, mapping.reverse.gaps, gap);
        if (gapId != null) marks.push(`gp${gapId}`);
      }

      // ── The readability guarantee ──────────────────────────────────────
      // Only elements holding text of their own are checked. A wrapper passes its colour
      // down by inheritance, and whichever descendant actually renders the words gets
      // measured on its own terms — against the background painted at *that* depth.
      if (forceReadable && paintedBg && hasOwnText(element)) {
        const ink = onAccent
          ? mapping.onAccent
          : (textId != null ? mapping.texts.get(txTokens[textId]) : textValue);
        const inkParsed = ink ? parseColor(ink) : null;
        if (inkParsed) {
          // Translucent text is one of the ways text goes unreadable, so it is composited
          // before it is judged rather than scored as though it were solid.
          const painted = inkParsed.a >= 0.999 ? inkParsed : flatten(inkParsed, paintedBg);
          if (painted && contrastRatio(painted, paintedBg) < READABLE) {
            marks.push(inkFor(paintedBg) === 'light' ? Mark.INK_LIGHT : Mark.INK_DARK);
          }
        }
      }

      if (marks.length) {
        const value = marks.join(' ');
        if (element.getAttribute(TOKEN_ATTR) !== value) element.setAttribute(TOKEN_ATTR, value);
        this.#stamped.add(element);
        for (const mark of marks) used.add(mark);
      } else if (bare && element.hasAttribute(TOKEN_ATTR)) {
        // Only a full pass over a bare page may take a stamp away. A pass over a themed
        // page has no business deciding that a stamp it did not place is now wrong.
        element.removeAttribute(TOKEN_ATTR);
        this.#stamped.delete(element);
      }

      return { onAccent, bg: paintedBg };
    }, { limit, context: base });
  }

  /** The canvas the theme paints, and so the backdrop every walk starts against. */
  #rootContext() {
    const theme = this.#active;
    return { onAccent: false, bg: theme ? parseColor(theme.palette.background) : null };
  }

  /**
   * The context for a freshly inserted subtree, read off the stamps its ancestors already
   * carry. A subtree walk has no ancestor context of its own, and asking for computed
   * styles all the way up would cost more than it saves.
   */
  #inheritedContext(element) {
    const bgTokens = [...this.#index.bg.keys()];
    let onAccent = null;
    let bg = null;
    for (let node = element.parentElement; node; node = node.parentElement) {
      const marks = node.getAttribute?.(TOKEN_ATTR);
      if (!marks) continue;
      const list = marks.split(' ');
      if (onAccent === null) onAccent = list.includes(Mark.ON_ACCENT);
      if (bg === null) bg = paintedFromMarks(list, bgTokens, this.#mapping, null);
      if (onAccent !== null && bg !== null) break;
    }
    return { onAccent: onAccent === true, bg: bg ?? this.#rootContext().bg };
  }
}

/**
 * True when the element renders text itself, rather than only through a descendant.
 *
 * The distinction matters: a `<section>` wrapping a paragraph inherits its colour down,
 * and it is the paragraph that has to be legible. Checking both would mark the wrapper on
 * the strength of a background its child overrides.
 */
function hasOwnText(element) {
  const children = element.childNodes;
  if (!children) return false;
  for (let i = 0; i < children.length; i += 1) {
    const node = children[i];
    if (node.nodeType === 3 && node.data && node.data.trim()) return true;
  }
  return false;
}

/**
 * The opaque colour an element's box ends up painted with.
 *
 * Three cases, and the third is the one that matters: a background the theme recognised
 * becomes the theme's value, a background it did not keeps the site's own — and a page
 * with more background colours than the detector tallies has plenty of those — while
 * anything see-through is composited onto whatever is behind it.
 */
function paintBackground(bgId, original, bgParsed, mapping, behind) {
  if (!bgParsed || bgParsed.a <= 0.001) return behind;
  const remapped = bgId != null && original != null ? mapping.backgrounds.get(original) : null;
  const painted = remapped ? parseColor(remapped) : bgParsed;
  if (!painted) return behind;
  if (painted.a >= 0.999) return painted;
  return flatten(painted, behind) ?? behind;
}

/** The same question, answered from stamps an earlier pass already wrote. */
function paintedFromMarks(marks, bgTokens, mapping, behind) {
  const mark = marks.find((m) => /^bg\d+$/.test(m));
  if (!mark) return behind;
  const token = bgTokens[Number.parseInt(mark.slice(2), 10)];
  const painted = token == null ? null : parseColor(mapping.backgrounds.get(token));
  if (!painted) return behind;
  return painted.a >= 0.999 ? painted : (flatten(painted, behind) ?? behind);
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
 */
export function buildMapping(tokens, theme) {
  const p = theme.palette;
  const mapping = {
    backgrounds: new Map(), texts: new Map(), borders: new Map(),
    radii: new Map(), paddings: new Map(), gaps: new Map(), variables: [],
  };

  const pageBg = tokens.roles?.[Role.BACKGROUND] ?? null;
  const pageSurface = tokens.roles?.[Role.SURFACE] ?? null;
  mapping.canvas = pageBg;

  // A glass theme paints its gradient on the root and needs the page's own canvas to get
  // out of the way, or every full-width container hides it.
  const canvasFill = theme.effects.backdrop ? 'transparent' : p.background;
  const surfaceFill = withAlpha(p.surface, theme.effects.surfaceAlpha);

  // ── Backgrounds ──────────────────────────────────────────────────────
  const backgrounds = tokens.backgrounds
    .map((t) => ({ ...t, parsed: parseColor(t.value) }))
    .filter((t) => t.parsed);
  const lums = backgrounds.map((t) => luminance(t.parsed));
  const minLum = Math.min(...lums, 1);
  const span = Math.max(0.0001, Math.max(...lums, 0) - minLum);

  for (const token of backgrounds) {
    if (token.value === pageBg) { mapping.backgrounds.set(token.value, canvasFill); continue; }
    if (token.value === pageSurface) { mapping.backgrounds.set(token.value, surfaceFill); continue; }
    if (isBrand(token.parsed)) { mapping.backgrounds.set(token.value, p.accent); continue; }
    const t = (luminance(token.parsed) - minLum) / span;
    // Translucent backgrounds stay translucent: they are overlays and dividers, and
    // making them opaque covers content.
    const blended = mix(p.background, p.surface, t);
    mapping.backgrounds.set(token.value, withAlpha(blended, theme.effects.surfaceAlpha ?? token.parsed.a));
  }

  // ── Text ─────────────────────────────────────────────────────────────
  // Every colour that ends up carrying text is passed through the contrast guarantee
  // first. A theme is free to choose a pretty accent; it is not free to choose an
  // unreadable one, and the shade that reads well as a *fill* is rarely the shade that
  // reads well as *text* on that same theme's paper.
  const readable = (color) => readableOn(color, [p.background, p.surface]);
  const linkColor = readable(p.accent);

  const textTokens = tokens.colors
    .map((t) => ({ ...t, parsed: parseColor(t.value) }))
    .filter((t) => t.parsed);
  const pageBgParsed = parseColor(pageBg ?? '#ffffff') ?? { r: 255, g: 255, b: 255, a: 1 };
  const contrasts = textTokens.map((t) => contrastRatio(t.parsed, pageBgParsed));
  const maxContrast = Math.max(...contrasts, 1);

  for (const [i, token] of textTokens.entries()) {
    if (token.value === tokens.roles?.[Role.TEXT]) { mapping.texts.set(token.value, readable(p.text)); continue; }
    if (token.value === tokens.roles?.[Role.TEXT_MUTED]) { mapping.texts.set(token.value, readable(p.textMuted)); continue; }
    if (saturationOf(token.parsed) > CHROMATIC) { mapping.texts.set(token.value, linkColor); continue; }  // any tint of text is a link
    // Quieter on the page stays quieter in the theme — but never quieter than legible.
    mapping.texts.set(token.value, readable(mix(p.text, p.textMuted, 1 - contrasts[i] / maxContrast)));
  }

  // Text sitting on an accent fill must stay legible.
  mapping.accent = p.accent;
  mapping.onAccent = readableOn(p.onAccent, [p.accent]);

  // ── Borders ──────────────────────────────────────────────────────────
  for (const token of tokens.borders) mapping.borders.set(token.value, p.border);

  // ── Radius ───────────────────────────────────────────────────────────
  if (theme.radius != null && tokens.radii.length) {
    // Scale relative to the page's dominant radius, so a pill stays a pill.
    const dominant = [...tokens.radii].sort((a, b) => b.weight - a.weight)[0].value || 1;
    const factor = theme.radius / dominant;
    const ceiling = theme.radius * 3 + 8;
    for (const token of tokens.radii) {
      mapping.radii.set(token.value, Math.round(Math.min(token.value * factor, ceiling)));
    }
  }

  // ── Density ──────────────────────────────────────────────────────────
  if (theme.density != null && theme.density !== 1) {
    for (const token of tokens.spacing) {
      mapping.paddings.set(token.value, Math.round(token.value * theme.density));
      mapping.gaps.set(token.value, Math.round(token.value * theme.density));
    }
  }

  // ── Custom properties ────────────────────────────────────────────────
  mapping.variables = mapVariables(tokens, theme, mapping, { canvasFill, readable, pageBgParsed });

  // The same table read backwards, so a second pass over an already-themed page can tell
  // which token a themed value came from.
  mapping.reverse = {
    backgrounds: reverseOf(mapping.backgrounds),
    texts: reverseOf(mapping.texts),
    borders: reverseOf(mapping.borders),
    radii: reverseOf(mapping.radii),
    paddings: reverseOf(mapping.paddings),
    gaps: reverseOf(mapping.gaps),
  };

  return mapping;
}

function reverseOf(map) {
  const reverse = new Map();
  for (const [from, to] of map) if (!reverse.has(to)) reverse.set(to, from);
  return reverse;
}

/**
 * Remaps the page's root custom properties.
 *
 * Classification is by the colour itself, because a variable's name tells you nothing
 * reliable. A chromatic value is the brand. A neutral that contrasts with the canvas is
 * ink; one that sits close to the canvas is paper. That test is polarity-symmetric, which
 * is why an "inverse" pair — dark text on a light chip inside a dark site — still comes
 * out the right way round: the light chip reads as ink, its dark label reads as paper, and
 * the theme's own ink and paper preserve the relationship.
 */
function mapVariables(tokens, theme, mapping, { canvasFill, readable, pageBgParsed }) {
  const p = theme.palette;
  const out = [];
  const paper = [];

  // A variable that holds a colour the page actually paints with is mapped through the
  // element table, not re-derived. Otherwise a card drawn from `var(--surface)` and a card
  // with the colour written into its stylesheet come out two different shades of the same
  // theme, and the page looks subtly broken in a way nobody can name.
  for (const variable of tokens.variables) {
    const contrast = contrastRatio(variable.parsed, pageBgParsed);
    const alpha = variable.parsed.a;

    if (isBrand(variable.parsed)) {
      out.push({ name: variable.name, value: withAlpha(mapping.backgrounds.get(variable.value) ?? p.accent, alpha) });
      continue;
    }
    if (contrast >= INK) {
      const known = mapping.texts.get(variable.value) ?? mapping.borders.get(variable.value);
      // Ink: the further from the canvas, the closer to the theme's primary text.
      const t = Math.min(1, (contrast - INK) / 12);
      out.push({ name: variable.name, value: withAlpha(known ?? readable(mix(p.textMuted, p.text, t)), alpha) });
      continue;
    }
    const known = mapping.backgrounds.get(variable.value) ?? mapping.borders.get(variable.value);
    if (known) out.push({ name: variable.name, value: withAlpha(known, alpha) });
    else paper.push(variable);
  }

  // Whatever is left is paper the detector never saw painted. It is ordered by its own
  // lightness so a site's sense of elevation survives: the value nearest the canvas
  // becomes the theme's canvas, the furthest becomes its surface.
  if (paper.length) {
    const distance = paper.map((v) => Math.abs(luminance(v.parsed) - luminance(pageBgParsed)));
    const max = Math.max(...distance, 0.0001);
    for (const [i, variable] of paper.entries()) {
      const t = distance[i] / max;
      const value = t < 0.02 && canvasFill === 'transparent'
        ? 'transparent'
        : withAlpha(mix(p.background, p.surface, t), variable.parsed.a);
      out.push({ name: variable.name, value });
    }
  }
  return out;
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

/** Re-applies a source alpha to a theme colour, so overlays stay overlays. */
export function withAlpha(color, alpha) {
  if (alpha == null || alpha >= 1) return color;
  const parsed = parseColor(color);
  if (!parsed) return color;
  return toCss({ ...parsed, a: Math.max(0, Math.min(1, alpha)) });
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

// ─── CSS generation ────────────────────────────────────────────────────────

const SHADOWS = {
  none: 'none',
  soft: '0 1px 2px rgba(0, 0, 0, 0.04), 0 6px 20px rgba(0, 0, 0, 0.08)',
  sharp: '0 1px 0 rgba(0, 0, 0, 0.16)',
};

/**
 * The page's own grain, for skeuomorphic themes. Inlined as a data URI because the
 * content script must not fetch anything.
 */
const NOISE = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)' opacity='0.055'/%3E%3C/svg%3E\")";

/** Headings are the one structural selector a theme is allowed to use directly. */
const HEADINGS = 'h1, h2, h3, h4, h5, h6';

/**
 * Elements that must keep their own font: icon fonts render as tofu in anything else, and
 * code loses its alignment.
 */
const FONT_EXCLUDE = ':not(code):not(pre):not(kbd):not(samp)' +
  ':not([class*="icon"]):not([class*="Icon"]):not([class*="fa-"]):not([class*="material-"])';

export function buildCss(theme, mapping, used, index) {
  const p = theme.palette;
  const attr = (mark) => `[${TOKEN_ATTR}~="${mark}"]`;
  const rules = [];

  // ── Root, before anything else ───────────────────────────────────────
  rules.push(rootCss(theme, mapping));

  // ── Per-token rules ──────────────────────────────────────────────────
  const emit = (prefix, map, property, format = (v) => v) => {
    const ids = index?.[prefix];
    if (!ids) return;
    for (const [from, to] of map) {
      const id = ids.get(from);
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

  // ── Surfaces ─────────────────────────────────────────────────────────
  const surface = surfaceCss(theme, mapping);
  if (surface.length && used.has(Mark.SURFACE)) {
    rules.push(`${attr(Mark.SURFACE)} { ${surface.join(' ')} }`);
  }

  // Text on an accented fill has to stay readable — a link included, which would
  // otherwise keep its own accent colour and vanish into the fill behind it. This comes
  // after the text rules and matches at equal specificity, so it wins on order.
  if (used.has(Mark.ON_ACCENT)) {
    rules.push(`${attr(Mark.ON_ACCENT)} { color: ${mapping.onAccent} !important; }`);
  }

  // The readability guarantee, last of the colour rules so that at equal specificity it
  // outranks every one of them. Two marks and two rules cover the whole page, however
  // many elements needed rescuing — the same arithmetic the rest of the engine runs on.
  if (used.has(Mark.INK_DARK)) rules.push(`${attr(Mark.INK_DARK)} { color: #000 !important; }`);
  if (used.has(Mark.INK_LIGHT)) rules.push(`${attr(Mark.INK_LIGHT)} { color: #fff !important; }`);

  // ── Type ─────────────────────────────────────────────────────────────
  if (theme.fontFamily) {
    rules.push(`body *${FONT_EXCLUDE} { font-family: inherit !important; }`);
  }
  const heading = [];
  if (theme.displayFamily) heading.push(`font-family: ${theme.displayFamily} !important;`);
  if (theme.effects.weight) heading.push(`font-weight: ${theme.effects.weight} !important;`);
  if (theme.effects.uppercase) heading.push('text-transform: uppercase !important;');
  if (theme.effects.tracking != null) heading.push(`letter-spacing: ${theme.effects.tracking}em !important;`);
  if (theme.effects.glow) heading.push(`text-shadow: 0 0 14px ${withAlpha(p.accent, 0.45)} !important;`);
  if (heading.length) rules.push(`${HEADINGS} { ${heading.join(' ')} }`);

  return `/* Webin — ${theme.name} */\n${rules.join('\n')}`;
}

/**
 * The part of a theme that needs no stamping: the root variables and the canvas.
 *
 * This is also exactly the part that can be cached and injected before the page paints,
 * which is what stops a dark theme flashing white on load.
 */
export function rootCss(theme, mapping) {
  const p = theme.palette;
  const lines = [];

  if (mapping.variables.length) {
    const declarations = mapping.variables.map((v) => `${v.name}: ${v.value} !important;`).join(' ');
    lines.push(`:root { ${declarations} }`);
  }

  const canvas = theme.effects.backdrop
    ? `background: ${theme.effects.backdrop} !important; background-attachment: fixed !important;`
    : `background-color: ${p.background} !important;`;
  lines.push(`html { ${canvas} color-scheme: ${theme.dark ? 'dark' : 'light'} !important; }`);

  const body = [];
  body.push(theme.effects.backdrop
    ? 'background-color: transparent !important;'
    : `background-color: ${p.background} !important;`);
  // Guarded, exactly as the stamped text rules are. Body colour is inherited by every
  // element that carries no text stamp of its own, so an unchecked value here is a hole
  // straight through the guarantee.
  body.push(`color: ${ensureReadable(p.text, [p.background, p.surface])} !important;`);
  if (theme.fontFamily) body.push(`font-family: ${theme.fontFamily} !important;`);
  if (theme.effects.noise) body.push(`background-image: ${NOISE} !important;`);
  lines.push(`body { ${body.join(' ')} }`);

  return lines.join('\n');
}

/** Declarations that give a card its treatment, per the theme's shadow kind. */
function surfaceCss(theme, mapping) {
  const p = theme.palette;
  const out = [];
  const border = theme.effects.borderWidth;

  switch (theme.shadow) {
    case 'hard':
      out.push(`box-shadow: 4px 4px 0 0 ${p.border} !important;`);
      break;
    case 'deep':
      out.push('box-shadow: inset 0 1px 0 rgba(255,255,255,0.55), 0 1px 2px rgba(0,0,0,0.28), 0 8px 18px rgba(0,0,0,0.20) !important;');
      break;
    case 'neu':
      // Soft UI is one surface lit from the top left; a border would defeat the illusion.
      out.push('box-shadow: -6px -6px 14px rgba(255,255,255,0.85), 6px 6px 14px rgba(0,0,0,0.13) !important;');
      out.push('border-color: transparent !important;');
      break;
    case 'glass':
      out.push(`box-shadow: 0 8px 32px ${withAlpha('#000000', 0.28)} !important;`);
      out.push(`border: 1px solid ${p.border} !important;`);
      break;
    case 'glow':
      out.push(`box-shadow: 0 0 0 1px ${withAlpha(p.accent, 0.35)}, 0 0 24px ${withAlpha(p.accent, 0.18)} !important;`);
      break;
    default:
      if (SHADOWS[theme.shadow] && theme.shadow !== 'none') out.push(`box-shadow: ${SHADOWS[theme.shadow]} !important;`);
      break;
  }

  if (theme.effects.blur) {
    out.push(`backdrop-filter: blur(${theme.effects.blur}px) !important;`);
    out.push(`-webkit-backdrop-filter: blur(${theme.effects.blur}px) !important;`);
  }
  if (theme.effects.gradient) {
    out.push('background-image: linear-gradient(180deg, rgba(255,255,255,0.30), rgba(0,0,0,0.06)) !important;');
  }
  if (border != null && theme.shadow !== 'glass' && theme.shadow !== 'neu') {
    out.push(`border: ${border}px solid ${p.border} !important;`);
  }
  if (theme.radius != null) out.push(`border-radius: ${theme.radius}px !important;`);
  return out;
}
