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

import { TOKEN_ATTR, WID_ATTR, Mark, RoleMark, ROLES, STAMP_LIMIT } from '../shared/types.js';
import {
  parseColor, toCss, normaliseColor, luminance, contrastRatio, readableOn,
  ensureReadable, inkFor, flatten,
} from '../shared/color.js';
import { backdropCss } from '../shared/theme-format.js';
import { Role, saturationOf, chromaOf } from './tokens.js';
import { walkTree, collectShadowRoots, SKIP } from './dom.js';
import { roleOf } from './roles.js';
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
  /** Roles the active theme actually styles, so the walk looks for nothing else. */
  #roles = new Set();
  /** `[target, selector]` pairs the theme uses to find its targets, beyond tag and ARIA. */
  #detect = [];
  /** What each target's own rule paints it, for the readability guarantee. See `ruleFills`. */
  #fills = {};
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
    this.#roles = wantedRoles(theme);
    this.#detect = Object.entries(theme.detect ?? {});
    this.#fills = ruleFills(theme);
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
    this.#roles = new Set();
    this.#detect = [];
    this.#fills = {};
    this.#used = new Set();
  }

  #writeCss() {
    this.#sheets.update(buildCss(this.#active, this.#mapping, this.#used, this.#index, this.#fills));
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
    const wanted = this.#roles;
    const detect = this.#detect;
    const fills = this.#fills;
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
            bg: paintedFromMarks(marks, bgTokens, mapping, parent.bg, fills),
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

      // What the document says this element is, when the theme has asked about it. Read
      // before anything is measured, because it costs a tag comparison and settles the
      // treatment for chrome that no amount of looking at colour would identify.
      let role = roleOf(element, wanted);
      // Then what the theme says it is, for a theme that ships its own way of finding
      // things — `card: [".tile", ".product"]`. Tag and ARIA are asked first because they
      // are facts about the document; a selector list is the theme's guess, and it is only
      // consulted where the document has not already answered.
      let foundSurface = false;
      for (const [target, selector] of detect) {
        if (target === 'surface' ? foundSurface : role) continue;
        let hit = false;
        try { hit = element.matches(selector); } catch { /* a selector this engine cannot test */ }
        if (!hit) continue;
        if (target === 'surface') foundSurface = true;
        else role = target;
      }
      if (role) marks.push(RoleMark[role]);

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
      // A button whose own fill was the page's accent is its call to action. The mark is
      // what lets a theme's `secondary` button rule find every other button, and it is
      // decided here, from the page, before any rule repaints the fill.
      if (role === 'button' && opaque && original != null && mapping.backgrounds.get(original) === mapping.accent) {
        marks.push(Mark.PRIMARY);
      }

      // Only a box that paints its own opaque, non-canvas background is a card. Shadows,
      // blur and forced borders apply to those and nothing else — putting a drop shadow on
      // every stamped element is how a theme turns a page into soup.
      // The longhand first; some engines only report the shorthand for a shared radius.
      const cornerValue = style.borderTopLeftRadius || style.borderRadius || '0';
      const rounded = String(cornerValue).includes('%');
      const corner = rounded ? Infinity : Math.round(Number.parseFloat(cornerValue) || 0);
      let isSurface = foundSurface;
      if (!isSurface && opaque && bgId != null && original !== mapping.canvas) {
        const rect = element.getBoundingClientRect();
        // A pill or a circle is a chip, a tag or an avatar. Handing it a card's corner
        // radius is how an avatar comes out as a rounded square.
        const isPill = corner * 2 >= Math.min(rect.width, rect.height);
        isSurface = !isPill && rect.width >= SURFACE_MIN.width && rect.height >= SURFACE_MIN.height;
      }
      if (isSurface) marks.push(Mark.SURFACE);

      // What this element will *actually* be painted with once the theme is on: the
      // theme's value where the background was remapped, the site's own where it was not,
      // composited onto whatever is behind it where it is see-through. Measuring text
      // against the theme's canvas instead of this is what lets grey-on-grey through.
      //
      // A target the theme's own rules paint is painted with what the rule says, and that
      // answer outranks every one of the above: the rule is written after the token pass
      // and wins on the page, so it has to win here too, or the guard measures text against
      // a fill that is not there. An element painted by a rule is no longer "on the accent"
      // either, whatever its own background was mapped to.
      const fill = (role && fills[role]) || (isSurface && fills.surface) || null;
      const paintedBg = fill?.bg
        ? paintFill(fill.bg, parent.bg)
        : paintBackground(bgId, original, bgParsed, mapping, parent.bg);
      const onAccentHere = fill?.bg ? false : onAccent;
      if (fill?.bg && marks.includes(Mark.ON_ACCENT)) marks.splice(marks.indexOf(Mark.ON_ACCENT), 1);

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
        // The ink is whatever will actually be on the page: a rule's colour where the
        // theme wrote one for this kind of thing, the token pass's where it did not.
        const ruleInk = fill?.color
          ?? (tag === 'A' && !onAccentHere ? fills.link?.color : null)
          ?? (/^H[1-6]$/.test(tag) ? fills.heading?.color : null)
          ?? null;
        const ink = ruleInk ?? (onAccentHere
          ? mapping.onAccent
          : (textId != null ? mapping.texts.get(txTokens[textId]) : textValue));
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

      return { onAccent: onAccentHere, bg: paintedBg };
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
      if (bg === null) bg = paintedFromMarks(list, bgTokens, this.#mapping, null, this.#fills);
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

/** A rule's own fill, composited onto what is behind it where it is see-through. */
function paintFill(fill, behind) {
  if (fill.a <= 0.001) return behind;
  if (fill.a >= 0.999) return fill;
  return flatten(fill, behind) ?? behind;
}

/** The same question, answered from stamps an earlier pass already wrote. */
function paintedFromMarks(marks, bgTokens, mapping, behind, fills = null) {
  // A rule's fill first, for the same reason it comes first on a fresh walk.
  if (fills) {
    for (const mark of marks) {
      const target = mark === Mark.SURFACE ? 'surface' : MARK_ROLE[mark];
      const fill = target ? fills[target] : null;
      if (fill?.bg) return paintFill(fill.bg, behind);
    }
  }
  const mark = marks.find((m) => /^bg\d+$/.test(m));
  if (!mark) return behind;
  const token = bgTokens[Number.parseInt(mark.slice(2), 10)];
  const painted = token == null ? null : parseColor(mapping.backgrounds.get(token));
  if (!painted) return behind;
  return painted.a >= 0.999 ? painted : (flatten(painted, behind) ?? behind);
}

/** Mark -> role, the other way round from `RoleMark`. */
const MARK_ROLE = Object.fromEntries(Object.entries(RoleMark).map(([role, mark]) => [mark, role]));

/**
 * The roles a theme styles, by material or by rule or by a selector list of its own.
 *
 * Anything outside this set is never looked for, so a theme with no roles pays nothing.
 */
function wantedRoles(theme) {
  const out = new Set(Object.keys(theme.roles ?? {}));
  for (const rule of theme.rules ?? []) if (rule.target && ROLES.includes(rule.target)) out.add(rule.target);
  for (const target of Object.keys(theme.detect ?? {})) if (ROLES.includes(target)) out.add(target);
  return out;
}

/**
 * What each target's base rule paints it: `{ bg, color }`, parsed, or nothing.
 *
 * The readability guarantee measures text against what is actually painted, and a rule
 * that fills every button black has changed what is painted. Read once when the theme is
 * applied, so the walk can ask in constant time.
 */
function ruleFills(theme) {
  const out = {};
  for (const rule of theme.rules ?? []) {
    if (!rule.target || rule.state || rule.part || rule.media) continue;
    const entry = out[rule.target] ?? (out[rule.target] = { bg: null, color: null, painted: false });
    const bg = rule.properties['background-color'];
    if (bg) { entry.bg = parseColor(bg); entry.painted = true; }
    // A gradient fill paints the box too, but with no one colour to measure against; the
    // guard falls back to what is behind, and the fill is still held to be the rule's.
    if (rule.properties['background-image'] && rule.properties['background-image'] !== 'none') entry.painted = true;
    if (rule.properties.color) entry.color = parseColor(rule.properties.color);
  }
  return out;
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

export function buildCss(theme, mapping, used, index, fills = ruleFills(theme)) {
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

  // ── Roles and states ─────────────────────────────────────────────────
  // After the generic surface rule and before the guarantees below it. Every selector
  // here is one attribute at the same specificity as every other, so this block is
  // reading as "a modal may differ from an ordinary card" — and the two rules that follow
  // it are reading as "and neither of them may make the text unreadable".
  rules.push(...roleCss(theme, mapping, used, fills));
  rules.push(...stateCss(theme, used));

  // What the theme's file said about each kind of element, in its own words. After the
  // materials and the composed states, so that where a theme both names a material and
  // writes a declaration, the declaration — the more specific thing it said — wins.
  rules.push(...targetRuleCss(theme, used));

  // Selection and scrollbar are the page's own chrome, and belong to whatever theme is
  // on. Neither needs a stamp: there is one of each per document.
  rules.push(`::selection { background: ${p.accent} !important; color: ${mapping.onAccent} !important; }`);
  rules.push(`* { scrollbar-color: ${p.border} transparent; }`);

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

  // ── Motion ───────────────────────────────────────────────────────────
  // One transition for everything the theme touches, so a hover it wrote arrives at the
  // speed it asked for. Last of the composed rules, and only where a stamp exists.
  if (theme.effects.transition) {
    const moving = [used.has(Mark.SURFACE) ? attr(Mark.SURFACE) : null,
      ...Object.values(RoleMark).filter((m) => used.has(m)).map(attr),
      `a:not(${attr(Mark.ON_ACCENT)})`].filter(Boolean);
    rules.push(`${moving.join(', ')} { transition: ${theme.effects.transition} !important; }`);
  }
  // The theme's keyframes, every one it carries: a rule names one of them by the name
  // the file gave it, and the code tool can name the rest.
  rules.push(...keyframesCss(theme));

  // ── The theme's own selectors ────────────────────────────────────────
  // Last of all, after the guarantees, exactly as the site stylesheet someone types is:
  // a selector the theme named is the theme asking for that element outright, and the
  // answer to "but the guard said" is the same one the editor gives — you asked for it.
  rules.push(...selectorRuleCss(theme));

  // After everything, so that at equal specificity it wins over every animation above: a
  // reader who has asked their system for less motion gets none of the theme's.
  rules.push(...reducedMotionCss(theme, used));

  return `/* Webin — ${theme.name} */\n${rules.join('\n')}`;
}

/**
 * What the theme's keyframes are written under on the page.
 *
 * The theme's sheet is adopted after the site's own, so a `@keyframes fadeIn` of ours
 * would replace the site's `fadeIn` for every element that uses it — its toasts, its
 * spinners — and not only for the ones the theme animates. Under a prefix, the two never
 * meet: the theme's rules name the prefixed block, and the site's keep naming theirs.
 */
const KEYFRAME_PREFIX = 'wb-';

/** The names the theme's keyframes go by, before the prefix. */
function keyframeNames(theme) {
  return Object.keys(theme.motion?.keyframes ?? {});
}

/**
 * An `animation` value with every keyframes name of the theme's own prefixed.
 *
 * A name is a whole word between spaces or commas. A word that names none of the theme's
 * keyframes is left as written — a time, a curve, a keyword, or a block the site defines.
 */
function animationValue(value, names) {
  let out = String(value);
  for (const name of names) {
    out = out.replace(new RegExp(`(^|[\\s,])${name}(?=[\\s,]|$)`, 'g'), `$1${KEYFRAME_PREFIX}${name}`);
  }
  return out;
}

/** The properties whose value may name a keyframes block. */
const NAMES_KEYFRAMES = new Set(['animation', 'animation-name']);

/** A rule's declarations, every one marked `!important`, as the token rules are. */
function declarations(properties, names = []) {
  return Object.entries(properties)
    .map(([property, value]) => `${property}: ${NAMES_KEYFRAMES.has(property) ? animationValue(value, names) : value} !important;`)
    .join(' ');
}

/**
 * The theme's `@keyframes` blocks, under the prefix.
 *
 * Nothing inside is `!important`: a declaration in a keyframe cannot be, and one marked so
 * is ignored, which would leave the animation with nothing to animate.
 */
function keyframesCss(theme) {
  const out = [];
  for (const [name, stops] of Object.entries(theme.motion?.keyframes ?? {})) {
    const body = Object.entries(stops)
      .map(([stop, properties]) => `${stop} { ${Object.entries(properties).map(([p, v]) => `${p}: ${v};`).join(' ')} }`)
      .join(' ');
    out.push(`@keyframes ${KEYFRAME_PREFIX}${name} { ${body} }`);
  }
  return out;
}

/** True for a rule that sets something in motion. */
function animates(rule) {
  return Object.keys(rule.properties ?? {}).some((p) => NAMES_KEYFRAMES.has(p));
}

/**
 * Every selector the theme animates, told to hold still under `prefers-reduced-motion`.
 *
 * One rule for all of them, at the end of the sheet, so it wins on order at the same
 * specificity as the rules it silences. The theme's transition is left alone: a hover
 * that arrives in a quarter of a second is not the kind of motion the setting is about.
 */
function reducedMotionCss(theme, used) {
  const selectors = new Set();
  for (const rule of theme.rules ?? []) {
    if (!animates(rule)) continue;
    const selector = rule.target ? targetSelector(rule.target, rule.state, used, rule.part ?? null) : rule.selector;
    if (selector) selectors.add(selector);
  }
  if (!selectors.size) return [];
  return [`@media (prefers-reduced-motion: reduce) { ${[...selectors].join(', ')} { animation: none !important; } }`];
}

/**
 * How a state is written onto a selector.
 *
 * `current` is the item you are on — a nav link with `aria-current`, a selected row — and
 * is matched by what the document says plus the two or three class names the whole web
 * agrees on for it. `focus` is `:focus-visible`, so a button clicked with the mouse does
 * not light up and a field tabbed into does.
 */
const STATE_SUFFIX = {
  hover: ':hover',
  active: ':active',
  focus: ':focus-visible',
  placeholder: '::placeholder',
  // The page's call to action, and every button that was not; see `Mark.PRIMARY`.
  primary: `[${TOKEN_ATTR}~="pr"]`,
  secondary: `:not([${TOKEN_ATTR}~="pr"])`,
  secondaryHover: `:not([${TOKEN_ATTR}~="pr"]):hover`,
};

/** The pieces of a table a rule may be for, inside the table's own mark. */
const PART_SUFFIX = {
  header: ' :is(thead, th)',
  row: ' tbody tr',
};
const CURRENT = ['[aria-current]', '[aria-selected="true"]', '[aria-pressed="true"]',
  '.active', '.is-active', '.selected', '.current'];

/**
 * The selector for a target in a state, or null when nothing on the page carries it.
 *
 * Roles and surfaces are their marks; the page's furniture is its own tag. A link rule is
 * held back from links on an accent fill, which have to keep the accent's ink or vanish.
 */
function targetSelector(target, state, used, part = null) {
  const attr = (mark) => `[${TOKEN_ATTR}~="${mark}"]`;
  let bases;
  if (target === 'surface') {
    if (!used.has(Mark.SURFACE)) return null;
    bases = [attr(Mark.SURFACE)];
  } else if (RoleMark[target]) {
    if (!used.has(RoleMark[target])) return null;
    bases = [attr(RoleMark[target])];
  } else if (target === 'body') {
    bases = ['body'];
  } else if (target === 'heading') {
    bases = HEADINGS.split(', ');
  } else if (target === 'link') {
    bases = [`a:not(${attr(Mark.ON_ACCENT)})`];
  } else if (target === 'small') {
    bases = ['small', 'figcaption'];
  } else {
    return null;
  }

  if (part) {
    const inside = PART_SUFFIX[part];
    if (!inside) return null;
    bases = bases.map((base) => `${base}${inside}`);
  }
  if (!state) return bases.join(', ');
  if (state === 'current') {
    // A nav is current *inside* itself; a link or a button is current itself.
    const inside = ['nav', 'sidebar', 'table', 'header', 'footer', 'popover', 'modal', 'surface'].includes(target);
    return bases.flatMap((base) => CURRENT.map((c) => (inside ? `${base} ${c}` : `${base}${c}`))).join(', ');
  }
  const suffix = STATE_SUFFIX[state];
  return suffix ? bases.map((base) => `${base}${suffix}`).join(', ') : null;
}

/** The rules written against targets, base state first so a hover can override it. */
function targetRuleCss(theme, used) {
  const out = [];
  const names = keyframeNames(theme);
  const list = (theme.rules ?? []).filter((rule) => rule.target);
  const ordered = [...list.filter((r) => !r.state), ...list.filter((r) => r.state)];
  for (const rule of ordered) {
    const selector = targetSelector(rule.target, rule.state, used, rule.part ?? null);
    if (!selector) continue;
    const inner = `${selector} { ${declarations(rule.properties, names)} }`;
    out.push(rule.media ? `${rule.media} { ${inner} }` : inner);
  }
  return out;
}

/** The rules written against the theme's own selectors, as written. */
function selectorRuleCss(theme) {
  const out = [];
  const names = keyframeNames(theme);
  for (const rule of theme.rules ?? []) {
    if (!rule.selector) continue;
    const inner = `${rule.selector} { ${declarations(rule.properties, names)} }`;
    out.push(rule.media ? `${rule.media} { ${inner} }` : inner);
  }
  return out;
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

  // Built here from the theme's own data rather than taken as a string: see `backdropCss`.
  const painted = backdropCss(theme.effects.backdrop);
  const canvas = painted
    ? `background: ${painted} !important; background-attachment: fixed !important;`
    : `background-color: ${p.background} !important;`;
  lines.push(`html { ${canvas} color-scheme: ${theme.dark ? 'dark' : 'light'} !important; }`);

  const body = [];
  body.push(painted
    ? 'background-color: transparent !important;'
    : `background-color: ${p.background} !important;`);
  // Guarded, exactly as the stamped text rules are. Body colour is inherited by every
  // element that carries no text stamp of its own, so an unchecked value here is a hole
  // straight through the guarantee.
  //
  // The surface is judged as it will be *painted*, not as it was written down — the same
  // rule the per-element pass follows. A glass theme's panel is a sheet of near-invisible
  // white, and scoring that as solid white asks the guard to find one ink that reads on a
  // dark page and on white at the same time. There isn't one, so it picked black, and a
  // dark theme came out with black body text on a dark ground. Composited onto the canvas
  // it is standing on, that panel is dark, and white wins as it should.
  body.push(`color: ${ensureReadable(p.text, [p.background, paintedSurface(theme)])} !important;`);
  if (theme.fontFamily) body.push(`font-family: ${theme.fontFamily} !important;`);
  if (theme.effects.noise) body.push(`background-image: ${NOISE} !important;`);
  lines.push(`body { ${body.join(' ')} }`);

  return lines.join('\n');
}

/**
 * The theme's surface colour as it ends up on the page: at the translucency the theme
 * asked for, composited onto the canvas behind it when it is see-through.
 *
 * `buildMapping` computes the same fill for the surface token; this is that value taken
 * the one step further that a contrast check needs, since contrast has nowhere to put an
 * alpha channel.
 */
function paintedSurface(theme) {
  const p = theme.palette;
  const fill = withAlpha(p.surface, theme.effects.surfaceAlpha);
  const parsed = parseColor(fill);
  if (!parsed || parsed.a >= 0.999) return fill;
  const behind = parseColor(p.background);
  const composited = behind ? flatten(parsed, behind) : null;
  return composited ? toCss(composited) : fill;
}

/**
 * A theme's own surface treatment, or a named material's difference from it.
 *
 * A material names only what it changes, so everything it leaves out is inherited from the
 * theme — which is what makes `{ blur: 40 }` a legible way to say "a modal, but blurrier"
 * rather than a second theme that has to repeat itself.
 */
function surfaceSpec(theme, name = null) {
  const base = {
    shadow: theme.shadow,
    shadowCss: theme.effects.shadowCss ?? null,
    borderWidth: theme.effects.borderWidth,
    blur: theme.effects.blur,
    saturate: theme.effects.saturate ?? null,
    brighten: theme.effects.brighten ?? null,
    surfaceAlpha: theme.effects.surfaceAlpha,
    gradient: theme.effects.gradient,
    sheen: theme.effects.sheen ?? null,
    radius: theme.radius,
  };
  const material = name ? theme.materials?.[name] : null;
  return material ? { ...base, ...material } : base;
}

/** Declarations that give a card its treatment, per the theme's shadow kind. */
function surfaceCss(theme, mapping, spec = surfaceSpec(theme)) {
  const p = theme.palette;
  const out = [];
  const border = spec.borderWidth;

  // A shadow the file wrote out is the theme's shadow, whatever kind the theme was read
  // as; `none` is the file saying so, and the kind's default would contradict it.
  if (spec.shadowCss) {
    out.push(`box-shadow: ${spec.shadowCss} !important;`);
    if (spec.shadow === 'glass') out.push(`border: 1px solid ${p.border} !important;`);
    if (spec.shadow === 'neu') out.push('border-color: transparent !important;');
  } else switch (spec.shadow) {
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
      if (SHADOWS[spec.shadow] && spec.shadow !== 'none') out.push(`box-shadow: ${SHADOWS[spec.shadow]} !important;`);
      break;
  }

  if (spec.blur) {
    // Saturation and brightness ride in the same filter chain, when the theme names them:
    // the frosted look most glass themes describe is a blur *and* a lift in saturation.
    const chain = [`blur(${spec.blur}px)`];
    if (spec.saturate != null && spec.saturate !== 100) chain.push(`saturate(${spec.saturate}%)`);
    if (spec.brighten != null && spec.brighten !== 100) chain.push(`brightness(${spec.brighten}%)`);
    out.push(`backdrop-filter: ${chain.join(' ')} !important;`);
    out.push(`-webkit-backdrop-filter: ${chain.join(' ')} !important;`);
  }
  if (spec.sheen) {
    out.push(`background-image: ${spec.sheen} !important;`);
  } else if (spec.gradient) {
    out.push(`background-image: ${SHEEN} !important;`);
  }
  if (border != null && spec.shadow !== 'glass' && spec.shadow !== 'neu') {
    out.push(`border: ${border}px solid ${p.border} !important;`);
  }
  if (spec.radius != null) out.push(`border-radius: ${spec.radius}px !important;`);
  return out;
}

/** The sheen laid over a surface when a theme asks for `gradient`. */
const SHEEN = 'linear-gradient(180deg, rgba(255,255,255,0.30), rgba(0,0,0,0.06))';

/**
 * The rules that give each structural role its material.
 *
 * Two rules per role, and the split matters. The treatment — blur, edge, corner, shadow —
 * applies to every element in the role. The *fill* is held back from anything the token
 * pass already painted, because that pass is what turns a site's primary button into the
 * theme's accent, and a material that painted over it would throw the accent away and
 * hand back a grey slab.
 */
function roleCss(theme, mapping, used, fills = {}) {
  const rules = [];
  const attr = (mark) => `[${TOKEN_ATTR}~="${mark}"]`;

  for (const [role, name] of Object.entries(theme.roles ?? {})) {
    const mark = RoleMark[role];
    if (!mark || !used.has(mark)) continue;

    const spec = surfaceSpec(theme, name);
    const declarations = surfaceCss(theme, mapping, spec);
    if (declarations.length) rules.push(`${attr(mark)} { ${declarations.join(' ')} }`);

    // A role the theme's own rules paint has its fill already; the material's would only
    // outrank it, since this selector is the more specific of the two.
    if (fills[role]?.painted) continue;
    const fill = withAlpha(theme.palette.surface, spec.surfaceAlpha);
    // `*=` reads the whole attribute, so this is "carries no background mark at all".
    rules.push(`${attr(mark)}:not([${TOKEN_ATTR}*="bg"]) { background-color: ${fill} !important; }`);
  }
  return rules;
}

/**
 * Hover, press and focus.
 *
 * Composed from the theme's own palette out of clamped amounts, never from a declaration
 * a theme wrote down. The lift is an overlay rather than a recomputed colour: an element's
 * real fill depends on what the token pass gave it and on what is showing through it, and
 * a translucent wash over the top comes out right on all of them without having to know
 * which. Where a theme also asks for a sheen, both layers are stacked so hovering does not
 * take the sheen away.
 *
 * Movement is kept to buttons and cards. A nav bar or a modal that grows under the pointer
 * takes its fixed-position descendants with it, and a page whose chrome moves when the
 * mouse crosses it is a page that feels broken.
 */
function stateCss(theme, used) {
  const p = theme.palette;
  const s = theme.states ?? {};
  const rules = [];
  const attr = (mark) => `[${TOKEN_ATTR}~="${mark}"]`;

  const present = (role) => used.has(RoleMark[role]) && Boolean(theme.roles?.[role]);
  const hoverable = [Mark.SURFACE, 'button', 'field', 'nav', 'modal', 'popover']
    .map((key) => (key === Mark.SURFACE ? (used.has(Mark.SURFACE) ? Mark.SURFACE : null)
      : (present(key) ? RoleMark[key] : null)))
    .filter(Boolean);
  const movable = [
    used.has(Mark.SURFACE) ? Mark.SURFACE : null,
    present('button') ? RoleMark.button : null,
  ].filter(Boolean);

  if (hoverable.length && (s.lift != null || s.border != null)) {
    const declarations = [];
    if (s.lift != null) {
      // White on a dark theme, black on a light one: a lift has to read as "closer to the
      // light" either way, and a white wash over a pale card does nothing at all.
      const ink = theme.dark ? '255, 255, 255' : '0, 0, 0';
      const wash = `rgba(${ink}, ${s.lift})`;
      const overlay = `linear-gradient(${wash}, ${wash})`;
      const sheen = theme.effects.sheen ?? (theme.effects.gradient ? SHEEN : null);
      declarations.push(`background-image: ${sheen ? `${overlay}, ${sheen}` : overlay} !important;`);
    }
    if (s.border != null) {
      declarations.push(`border-color: ${mix(p.border, p.text, s.border)} !important;`);
    }
    rules.push(`${hoverable.map((m) => `${attr(m)}:hover`).join(', ')} { ${declarations.join(' ')} }`);
  }

  if (movable.length && s.scale != null) {
    rules.push(`${movable.map((m) => `${attr(m)}:hover`).join(', ')} `
      + `{ transform: scale(${s.scale}) !important; }`);
  }
  if (movable.length && s.press != null) {
    rules.push(`${movable.map((m) => `${attr(m)}:active`).join(', ')} `
      + `{ transform: scale(${s.press}) !important; }`);
  }

  // The ring goes on `outline`, not on a shadow: a focus ring drawn as a box-shadow has to
  // replace whatever shadow the surface already had, and an outline sits beside it.
  const focusable = ['button', 'field'].filter(present).map((role) => RoleMark[role]);
  if (focusable.length && s.ring) {
    rules.push(`${focusable.map((m) => `${attr(m)}:focus-visible`).join(', ')} `
      + `{ outline: ${s.ring}px solid ${withAlpha(p.accent, 0.55)} !important; outline-offset: 2px !important; }`);
  }

  return rules;
}
