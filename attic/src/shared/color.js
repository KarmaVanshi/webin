/**
 * Colour parsing and formatting (§19).
 *
 * getComputedStyle hands back `rgb()` / `rgba()` (and `color(srgb ...)` in newer
 * engines), while the user types hex and the picker speaks hex. Everything funnels
 * through the internal {r,g,b,a} form so a round-trip never loses alpha.
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
    if (hex.length === 3 || hex.length === 4) {
      return {
        r: expand(hex[0]), g: expand(hex[1]), b: expand(hex[2]),
        a: hex.length === 4 ? expand(hex[3]) / 255 : 1,
      };
    }
    if (hex.length === 6 || hex.length === 8) {
      const n = (i) => parseInt(hex.slice(i, i + 2), 16);
      if ([...hex].some((c) => !/[0-9a-f]/.test(c))) return null;
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

  return null;
}

function parseAlpha(part) {
  return clamp01(part.endsWith('%') ? parseFloat(part) / 100 : parseFloat(part));
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

/** `{r,g,b,a}` -> `#rrggbb`, dropping alpha. Used to seed `<input type="color">`. */
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

/** Relative luminance per WCAG, used to pick readable swatch borders and labels. */
export function luminance(color) {
  const channel = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

/** WCAG contrast ratio between two opaque colours (§106). */
export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** True when a colour is fully transparent — computed styles report this constantly. */
export function isTransparent(input) {
  const c = parseColor(input);
  return !c || c.a === 0;
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

/**
 * Returns `color` if it already clears `ratio` against every background, otherwise the
 * nearest shade of the same hue that does (§106).
 *
 * Hue and saturation are held fixed and only lightness moves, so a theme's pink stays
 * pink — it just stops being unreadable. The search runs both ways and prefers the
 * smaller move; when neither direction can reach the ratio (a mid-grey between a light
 * and a dark background, say) it returns the most legible shade it found rather than
 * failing, because some contrast always beats none.
 *
 * @param {string} color
 * @param {string|string[]} against one or more backgrounds the colour must survive
 * @param {number} ratio WCAG target, 4.5 for body text
 * @returns {string}
 */
export function readableOn(color, against, ratio = 4.5) {
  const fg = parseColor(color);
  const backgrounds = (Array.isArray(against) ? against : [against])
    .map((c) => parseColor(c))
    .filter(Boolean);
  if (!fg || !backgrounds.length) return color;

  const worst = (candidate) => Math.min(...backgrounds.map((bg) => contrastRatio(candidate, bg)));
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
