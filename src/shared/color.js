/**
 * Colour parsing, formatting, and the readability guarantee.
 *
 * getComputedStyle hands back `rgb()` / `rgba()` (and `color(srgb ...)` in newer
 * engines), while the user types hex, the picker speaks hex, and a theme imported from
 * shadcn or DaisyUI arrives in `oklch()`. Everything funnels through the internal
 * {r,g,b,a} form so a round-trip never loses alpha.
 */

const NAMED = {
  transparent: { r: 0, g: 0, b: 0, a: 0 },
  black: { r: 0, g: 0, b: 0, a: 1 },
  white: { r: 255, g: 255, b: 255, a: 1 },
  red: { r: 255, g: 0, b: 0, a: 1 },
  green: { r: 0, g: 128, b: 0, a: 1 },
  blue: { r: 0, g: 0, b: 255, a: 1 },
  gray: { r: 128, g: 128, b: 128, a: 1 },
  grey: { r: 128, g: 128, b: 128, a: 1 },
  silver: { r: 192, g: 192, b: 192, a: 1 },
  navy: { r: 0, g: 0, b: 128, a: 1 },
  teal: { r: 0, g: 128, b: 128, a: 1 },
  orange: { r: 255, g: 165, b: 0, a: 1 },
  purple: { r: 128, g: 0, b: 128, a: 1 },
  yellow: { r: 255, g: 255, b: 0, a: 1 },
};

const clamp255 = (n) => Math.max(0, Math.min(255, Math.round(n)));
const clamp01 = (n) => Math.max(0, Math.min(1, n));

/** Pure black and pure white, the two colours the readability guarantee falls back to. */
const BLACK = Object.freeze({ r: 0, g: 0, b: 0, a: 1 });
const WHITE = Object.freeze({ r: 255, g: 255, b: 255, a: 1 });

/**
 * @param {string} input
 * @returns {{r:number,g:number,b:number,a:number}|null}
 */
export function parseColor(input) {
  if (input == null) return null;
  const value = String(input).trim().toLowerCase();
  if (!value) return null;

  if (Object.hasOwn(NAMED, value)) return { ...NAMED[value] };

  if (value.startsWith('#')) {
    const hex = value.slice(1);
    const expand = (c) => parseInt(c + c, 16);
    if ([...hex].some((c) => !/[0-9a-f]/.test(c))) return null;
    if (hex.length === 3 || hex.length === 4) {
      return {
        r: expand(hex[0]), g: expand(hex[1]), b: expand(hex[2]),
        a: hex.length === 4 ? expand(hex[3]) / 255 : 1,
      };
    }
    if (hex.length === 6 || hex.length === 8) {
      const n = (i) => parseInt(hex.slice(i, i + 2), 16);
      return { r: n(0), g: n(2), b: n(4), a: hex.length === 8 ? n(6) / 255 : 1 };
    }
    return null;
  }

  const fn = value.match(/^(rgba?|hsla?)\(([^)]*)\)$/);
  if (fn) {
    // Both comma and space syntaxes, with an optional `/ alpha`.
    const parts = fn[2].replace(/\//g, ' ').split(/[\s,]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const alpha = parts.length > 3 ? parseAlpha(parts[3]) : 1;
    if (fn[1].startsWith('rgb')) {
      const chan = (p) => (p.endsWith('%') ? (parseFloat(p) / 100) * 255 : parseFloat(p));
      return { r: clamp255(chan(parts[0])), g: clamp255(chan(parts[1])), b: clamp255(chan(parts[2])), a: alpha };
    }
    return hslToRgb(parseFloat(parts[0]), parseFloat(parts[1]) / 100, parseFloat(parts[2]) / 100, alpha);
  }

  const srgb = value.match(/^color\(\s*srgb\s+([^)]*)\)$/);
  if (srgb) {
    const parts = srgb[1].replace(/\//g, ' ').split(/\s+/).filter(Boolean);
    if (parts.length < 3) return null;
    return {
      r: clamp255(parseFloat(parts[0]) * 255),
      g: clamp255(parseFloat(parts[1]) * 255),
      b: clamp255(parseFloat(parts[2]) * 255),
      a: parts.length > 3 ? parseAlpha(parts[3]) : 1,
    };
  }

  // shadcn, DaisyUI v5 and current Tailwind palettes are authored in OKLCh. Without
  // this branch a third-party theme import would reject every colour in the file.
  const ok = value.match(/^(oklch|oklab)\(([^)]*)\)$/);
  if (ok) {
    const parts = ok[2].replace(/\//g, ' ').split(/[\s,]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const alpha = parts.length > 3 ? parseAlpha(parts[3]) : 1;
    const lightness = clamp01(numberOrPercent(parts[0], 1));
    if (!Number.isFinite(lightness)) return null;
    if (ok[1] === 'oklab') {
      return oklabToRgb(lightness, numberOrPercent(parts[1], 0.4), numberOrPercent(parts[2], 0.4), alpha);
    }
    const chroma = Math.max(0, numberOrPercent(parts[1], 0.4));
    const hue = parts[2] === 'none' ? 0 : parseFloat(parts[2]);
    if (!Number.isFinite(chroma) || !Number.isFinite(hue)) return null;
    const rad = (hue * Math.PI) / 180;
    return oklabToRgb(lightness, chroma * Math.cos(rad), chroma * Math.sin(rad), alpha);
  }

  return null;
}

function parseAlpha(part) {
  if (part === 'none') return 0;
  return clamp01(part.endsWith('%') ? parseFloat(part) / 100 : parseFloat(part));
}

/**
 * An OKLCh component may be a number or a percentage, and `100%` means something
 * different per axis: 1 for lightness, 0.4 for chroma and for the oklab a/b axes.
 */
function numberOrPercent(part, fullScale) {
  if (part === 'none') return 0;
  return part.endsWith('%') ? (parseFloat(part) / 100) * fullScale : parseFloat(part);
}

/** OKLab -> linear sRGB -> gamma-encoded sRGB (Björn Ottosson's matrices). */
function oklabToRgb(L, a, b, alpha) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;

  const gamma = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.abs(v) ** (1 / 2.4) - 0.055);
  return {
    r: clamp255(gamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s) * 255),
    g: clamp255(gamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s) * 255),
    b: clamp255(gamma(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s) * 255),
    a: alpha,
  };
}

function hslToRgb(h, s, l, a) {
  const hue = ((h % 360) + 360) % 360 / 360;
  if (s === 0) {
    const v = clamp255(l * 255);
    return { r: v, g: v, b: v, a };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const toRgb = (t) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return {
    r: clamp255(toRgb(hue + 1 / 3) * 255),
    g: clamp255(toRgb(hue) * 255),
    b: clamp255(toRgb(hue - 1 / 3) * 255),
    a,
  };
}

/** `{r,g,b,a}` -> `#rrggbb`, dropping alpha. The form every colour input speaks. */
export function toHex(color) {
  if (!color) return '#000000';
  const h = (n) => clamp255(n).toString(16).padStart(2, '0');
  return `#${h(color.r)}${h(color.g)}${h(color.b)}`;
}

/** `{r,g,b,a}` -> the shortest faithful CSS string. */
export function toCss(color) {
  if (!color) return 'transparent';
  if (color.a >= 1) return toHex(color);
  if (color.a <= 0) return 'transparent';
  return `rgba(${clamp255(color.r)}, ${clamp255(color.g)}, ${clamp255(color.b)}, ${Math.round(color.a * 1000) / 1000})`;
}

/** Convenience: normalise any CSS colour string, or return null if unparseable. */
export function normaliseColor(input) {
  const parsed = parseColor(input);
  return parsed ? toCss(parsed) : null;
}

/**
 * True when a colour paints nothing at all.
 *
 * Walking up the tree for "what is actually behind this text" means skipping every
 * ancestor that contributes no paint, and `rgba(0,0,0,0)` is what an unset background
 * computes to.
 */
export function isTransparent(input) {
  const parsed = typeof input === 'string' ? parseColor(input) : input;
  return !parsed || parsed.a <= 0.001;
}

/**
 * Composites `color` over `behind` and returns the opaque result.
 *
 * `contrastRatio` works on opaque colours only — it reads luminance and has nowhere to
 * put an alpha channel — so a translucent overlay scored directly comes out as though it
 * were solid. Anything semi-transparent has to be flattened onto its backdrop first.
 */
export function flatten(color, behind) {
  const src = typeof color === 'string' ? parseColor(color) : color;
  const dst = typeof behind === 'string' ? parseColor(behind) : behind;
  if (!src) return dst ? { ...dst } : null;
  if (!dst || src.a >= 1) return { ...src, a: 1 };

  const alpha = src.a + dst.a * (1 - src.a);
  if (alpha <= 0) return { r: 0, g: 0, b: 0, a: 0 };
  const blend = (s, d) => (s * src.a + d * dst.a * (1 - src.a)) / alpha;
  return {
    r: clamp255(blend(src.r, dst.r)),
    g: clamp255(blend(src.g, dst.g)),
    b: clamp255(blend(src.b, dst.b)),
    a: alpha,
  };
}

/** Relative luminance per WCAG, used to pick readable swatch borders and labels. */
export function luminance(color) {
  const channel = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

/** WCAG contrast ratio between two opaque colours. Flatten anything translucent first. */
export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** `{r,g,b}` -> `{h,s,l}`, so a colour can be re-lightened without losing its hue. */
export function rgbToHsl(color) {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s, l };
}

/** Parses one or many backgrounds into the list `worstContrast` scores against. */
function backgroundList(against) {
  return (Array.isArray(against) ? against : [against])
    .map((c) => (typeof c === 'string' ? parseColor(c) : c))
    .filter(Boolean);
}

/** The contrast a colour achieves against its *least* forgiving background. */
function worstContrast(candidate, backgrounds) {
  return Math.min(...backgrounds.map((bg) => contrastRatio(candidate, bg)));
}

/**
 * Returns `color` if it already clears `ratio` against every background, otherwise the
 * nearest shade of the same hue that does.
 *
 * Hue and saturation are held fixed and only lightness moves, so a theme's pink stays
 * pink — it just stops being unreadable. The search runs both ways and prefers the
 * smaller move; when neither direction can reach the ratio (a mid-grey between a light
 * and a dark background, say) it returns the most legible shade it found rather than
 * failing, because some contrast always beats none.
 *
 * That last case is a best effort, not a guarantee. When the guarantee is what matters,
 * call `ensureReadable`.
 *
 * @param {string} color
 * @param {string|string[]} against one or more backgrounds the colour must survive
 * @param {number} ratio WCAG target, 4.5 for body text
 * @returns {string}
 */
export function readableOn(color, against, ratio = 4.5) {
  const fg = parseColor(color);
  const backgrounds = backgroundList(against);
  if (!fg || !backgrounds.length) return color;

  const worst = (candidate) => worstContrast(candidate, backgrounds);
  if (worst(fg) >= ratio) return color;

  const { h, s, l } = rgbToHsl(fg);
  const shade = (lightness) => {
    const rgb = parseColor(`hsl(${h}, ${Math.round(s * 100)}%, ${Math.round(lightness * 1000) / 10}%)`);
    return rgb ? { ...rgb, a: fg.a } : fg;
  };

  let best = fg;
  let bestScore = worst(fg);
  for (const direction of [-1, 1]) {
    for (let step = 1; step <= 100; step += 1) {
      const lightness = l + direction * step * 0.01;
      if (lightness < 0 || lightness > 1) break;
      const candidate = shade(lightness);
      const score = worst(candidate);
      if (score > bestScore) { best = candidate; bestScore = score; }
      if (score >= ratio) { best = candidate; bestScore = score; break; }
    }
    if (bestScore >= ratio) break;
  }
  return toCss(best);
}

/**
 * `readableOn` with a definite answer instead of a best effort.
 *
 * Two things separate it from `readableOn`, and neither is "it searches harder" — that
 * search already sweeps lightness from 0 to 1, so black and white are in its range and it
 * finds them when they are what is needed.
 *
 * The first is alpha. `readableOn` preserves the original alpha on the shade it picks, so
 * a half-transparent grey comes back a half-transparent near-black and composites to
 * something unreadable all over again. Semi-transparent text is one of the ways text goes
 * unreadable in the first place, so the result here is always opaque.
 *
 * The second is the contract. Where no shade of the hue clears the ratio, this returns
 * plain `#000000` or `#ffffff` — whichever reads better against the backgrounds in play —
 * rather than an odd near-black expressed in the original hue. Callers that need a value
 * they can hand to a user, or write into a rule and stop worrying about, want that.
 *
 * When the backgrounds make the ratio impossible for *any* single colour — text over both
 * pure white and pure black — no function can fix it, and this returns the better of the
 * two rather than pretending.
 *
 * @param {string} color
 * @param {string|string[]} against
 * @param {number} ratio
 * @returns {string}
 */
export function ensureReadable(color, against, ratio = 4.5) {
  const backgrounds = backgroundList(against);
  if (!backgrounds.length) return color;

  const shaded = readableOn(color, against, ratio);
  const parsed = parseColor(shaded);
  if (parsed && parsed.a >= 1 && worstContrast(parsed, backgrounds) >= ratio) return shaded;

  return worstContrast(WHITE, backgrounds) > worstContrast(BLACK, backgrounds) ? '#ffffff' : '#000000';
}

/**
 * Which of black or white to force onto text sitting on `background`.
 *
 * The engine's per-element pass needs the choice, not the colour, because the two
 * outcomes are two CSS rules that already exist rather than a value to write inline.
 *
 * @returns {'dark'|'light'} `dark` meaning black ink, `light` meaning white ink
 */
export function inkFor(background) {
  const bg = typeof background === 'string' ? parseColor(background) : background;
  if (!bg) return 'dark';
  return contrastRatio(WHITE, bg) > contrastRatio(BLACK, bg) ? 'light' : 'dark';
}
