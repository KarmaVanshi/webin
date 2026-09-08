/**
 * Design token detection.
 *
 * Reads the *rendered* page and works out what its design system actually is: which
 * colours carry text, which carry surfaces, what the spacing rhythm is, what the type
 * scale is. Nothing here parses the site's CSS — a token is only real if it is painted.
 *
 * This is what makes theming safe. A theme that blanket-overrides every element destroys
 * a page; a theme that remaps *the handful of colours the page actually uses* preserves
 * its structure and only re-skins it.
 *
 * Weighting matters more than counting. The page background is not the most *frequent*
 * background — it is the one covering the most area. Body text is not the most frequent
 * colour — it is the one covering the most characters.
 */

import { normaliseColor, parseColor, contrastRatio, luminance } from '../shared/color.js';
import { DETECT_LIMIT } from '../shared/types.js';
import { walkTree } from './dom.js';
import { collectVariables } from './variables.js';

/** Token roles a theme can remap. */
export const Role = Object.freeze({
  BACKGROUND: 'background',
  SURFACE: 'surface',
  TEXT: 'text',
  TEXT_MUTED: 'textMuted',
  ACCENT: 'accent',
  BORDER: 'border',
});

/**
 * Scans the page and returns its design system.
 * @returns {{colors:Array, backgrounds:Array, borders:Array, fonts:Array, sizes:Array,
 *            weights:Array, spacing:Array, radii:Array, shadows:Array, variables:Array,
 *            roles:object, dark:boolean, scanned:number}}
 */
export function detectTokens(root = document, view = window, { limit = DETECT_LIMIT } = {}) {
  const colors = new Tally();      // text colour, weighted by how much text it paints
  const backgrounds = new Tally(); // background colour, weighted by painted area
  const borders = new Tally();
  const fonts = new Tally();
  const sizes = new Tally();
  const weights = new Tally();
  const spacing = new Tally();
  const radii = new Tally();
  const shadows = new Tally();

  const scanned = walkTree(root, (element) => {
    let style;
    try {
      style = view.getComputedStyle(element);
    } catch {
      return null;
    }
    const rect = element.getBoundingClientRect();
    const area = Math.max(0, rect.width) * Math.max(0, rect.height);
    const textLength = ownTextLength(element);

    // Text colour only counts where there is text to colour.
    if (textLength > 0) {
      const color = normaliseColor(style.color);
      if (color) colors.add(color, textLength);
    }

    // Background only counts where something is actually painted.
    const bg = normaliseColor(style.backgroundColor);
    if (bg && !isFullyTransparent(bg) && area > 0) backgrounds.add(bg, area);

    if (Number.parseFloat(style.borderTopWidth) > 0 || Number.parseFloat(style.borderBottomWidth) > 0) {
      const border = normaliseColor(style.borderTopColor);
      if (border && !isFullyTransparent(border)) borders.add(border, 1);
    }

    if (textLength > 0) {
      const family = primaryFamily(style.fontFamily);
      if (family) fonts.add(family, textLength);
      const size = Math.round(Number.parseFloat(style.fontSize) || 0);
      if (size > 0) sizes.add(size, textLength);
      const weight = normaliseWeight(style.fontWeight);
      if (weight) weights.add(weight, textLength);
    }

    // Spacing rhythm: every non-zero padding and gap value the page uses.
    for (const value of [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft, style.rowGap, style.columnGap]) {
      const n = Math.round(Number.parseFloat(value) || 0);
      if (n > 0 && n <= 200) spacing.add(n, 1);
    }

    // A percentage radius is a circle or an ellipse, not a step on a radius scale:
    // `50%` would otherwise be tallied as 50px and turn every avatar into a rounded box.
    const radiusValue = style.borderTopLeftRadius || style.borderRadius || '0';
    if (!String(radiusValue).includes('%')) {
      const radius = Math.round(Number.parseFloat(radiusValue) || 0);
      if (radius > 0 && radius <= 200) radii.add(radius, 1);
    }

    if (style.boxShadow && style.boxShadow !== 'none') shadows.add(style.boxShadow, 1);
    return null;
  }, { limit });

  const tokens = {
    colors: colors.top(12),
    backgrounds: backgrounds.top(12),
    borders: borders.top(6),
    fonts: fonts.top(4),
    sizes: sizes.top(10).sort((a, b) => a.value - b.value),
    weights: weights.top(6).sort((a, b) => a.value - b.value),
    spacing: spacing.top(10).sort((a, b) => a.value - b.value),
    radii: radii.top(6).sort((a, b) => a.value - b.value),
    shadows: shadows.top(4),
    variables: collectVariables(root.ownerDocument ?? root, view),
    scanned,
  };
  tokens.roles = inferRoles(tokens);
  const canvas = parseColor(tokens.roles[Role.BACKGROUND] ?? '#ffffff');
  tokens.dark = canvas ? luminance(canvas) < 0.25 : false;
  return tokens;
}

/** Length of the element's own text, excluding text belonging to its children. */
function ownTextLength(element) {
  let total = 0;
  for (const node of element.childNodes) {
    if (node.nodeType === 3) total += node.nodeValue.trim().length;
  }
  return total;
}

/**
 * Works out which detected value plays which role.
 *
 * These heuristics are the difference between a theme that works and one that produces a
 * mess, so each is deliberate rather than "the most common value wins".
 */
export function inferRoles(tokens) {
  const roles = {};

  // Background: the colour covering the most area — the page's canvas.
  roles[Role.BACKGROUND] = tokens.backgrounds[0]?.value ?? null;

  // Surface: the next distinct background — cards sitting on the canvas.
  roles[Role.SURFACE] = tokens.backgrounds.find((t) => t.value !== roles[Role.BACKGROUND])?.value ?? null;

  // Text roles.
  //
  // Weight alone is the wrong signal here: one long muted caption easily outweighs the
  // body copy, and white button labels outweigh nothing but are not page text at all.
  // So candidates are first filtered to colours that could plausibly be page text —
  // readable against the page background, and not the accent — and primary text is then
  // the one that is both dark enough and used enough.
  const pageBg = parseColor(roles[Role.BACKGROUND] ?? '#ffffff') ?? { r: 255, g: 255, b: 255, a: 1 };
  const candidates = tokens.colors
    .map((t) => ({ ...t, parsed: parseColor(t.value) }))
    .filter((t) => t.parsed && t.parsed.a > 0.5)
    .map((t) => ({ ...t, contrast: contrastRatio(t.parsed, pageBg) }))
    // Below 2:1 against the canvas the colour is not painting page text — it is a label
    // sitting on some other surface, such as a button.
    .filter((t) => t.contrast >= 2)
    .filter((t) => saturationOf(t.parsed) <= 0.45);

  const primary = candidates
    .slice()
    .sort((a, b) => b.contrast * Math.log1p(b.weight) - a.contrast * Math.log1p(a.weight))[0] ?? null;
  roles[Role.TEXT] = primary?.value ?? tokens.colors[0]?.value ?? null;

  // Muted is the most-used remaining candidate that is quieter than the primary.
  roles[Role.TEXT_MUTED] = candidates
    .filter((t) => t.value !== roles[Role.TEXT] && t.contrast < (primary?.contrast ?? Infinity))
    .sort((a, b) => b.weight - a.weight)[0]?.value ?? null;

  // Accent: the colour furthest from grey. A brand colour has real chroma; body text,
  // surfaces and pastel containers do not, so chroma separates them far better than
  // frequency does — and, unlike HSL saturation, it does not mistake a pale tint for one.
  const chromatic = [...tokens.colors, ...tokens.backgrounds, ...tokens.borders]
    .map((t) => ({ ...t, parsed: parseColor(t.value) }))
    .filter((t) => t.parsed && t.parsed.a > 0.5)
    .map((t) => ({ ...t, chroma: chromaOf(t.parsed) }))
    .filter((t) => t.chroma > 0.22)
    .sort((a, b) => b.chroma * Math.log1p(b.weight) - a.chroma * Math.log1p(a.weight));
  roles[Role.ACCENT] = chromatic[0]?.value ?? null;

  roles[Role.BORDER] = tokens.borders[0]?.value ?? null;
  return roles;
}

/**
 * Chroma: how far a colour is from grey, before lightness is taken into account.
 *
 * This is the honest test for "is this a brand colour". HSL saturation is not: a pale
 * peach reports 100% saturation, which is why saturation alone paints every pastel
 * container in a site's accent.
 */
export function chromaOf(color) {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  return Math.max(r, g, b) - Math.min(r, g, b);
}

/** HSL saturation, used alongside chroma to tell a tint from a neutral. */
export function saturationOf(color) {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const l = (max + min) / 2;
  return l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
}

class Tally {
  #map = new Map();

  add(value, weight) {
    const key = String(value);
    const entry = this.#map.get(key) ?? { value, weight: 0, count: 0 };
    entry.weight += weight;
    entry.count += 1;
    // Keep the numeric type for numeric tokens so sorting and formatting stay simple.
    entry.value = value;
    this.#map.set(key, entry);
  }

  top(n) {
    return [...this.#map.values()]
      .sort((a, b) => b.weight - a.weight)
      .slice(0, n)
      .map(({ value, weight, count }) => ({ value, weight: Math.round(weight), count }));
  }
}

function isFullyTransparent(css) {
  const parsed = parseColor(css);
  return !parsed || parsed.a < 0.05;
}

function primaryFamily(family) {
  const first = String(family ?? '').split(',')[0].replace(/["']/g, '').trim();
  return first && first.length <= 40 ? first : null;
}

function normaliseWeight(weight) {
  if (weight === 'normal') return 400;
  if (weight === 'bold') return 700;
  const n = Number.parseInt(weight, 10);
  return Number.isFinite(n) ? n : null;
}
