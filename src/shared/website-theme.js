/**
 * Reading a theme off a website.
 *
 * `foreign-themes.js` reads theme *files* — documents written to be themes, where a name
 * like `--primary` is a promise about a role. This module reads the other thing a user
 * points Webin at: an ordinary website, which promises nothing.
 *
 * The distinction matters more than it sounds. Most of the web ships no design tokens at
 * all. BBC, Apple, Hacker News and Amazon have no `--background` to find, and the sites
 * that do have one mostly bury it in a linked stylesheet the page itself never spells
 * out. Handed such a page, a token reader finds nothing and reports that the site has no
 * theme — which is plainly false, because the site is sitting there being looked at.
 *
 * So this reads what the site actually paints. Every colour declaration in the CSS is
 * collected with the selector that carried it, and the seven roles are decided by two
 * kinds of evidence:
 *
 *   1. **Authority.** `body { background: #fff }` is not a colour the site happens to
 *      use, it is the colour of the page. A handful of selectors carry that weight —
 *      `html`, `body`, `:root`, the framework mount points — and when one of them speaks
 *      it is believed over any amount of counting.
 *
 *   2. **Frequency.** Failing that, a colour used by two hundred rules is the site's
 *      colour and a colour used once is an accident. Counting declarations is a crude
 *      instrument that turns out to be a very good one, because a design system's whole
 *      purpose is to make the same few colours appear over and over.
 *
 * Everything read here is a candidate, exactly as in `foreign-themes.js`: this module
 * never produces a Theme, only an object shaped like one, and `normaliseTheme` remains
 * the single gate that a colour off the open internet has to pass.
 */

import { parseColor, toCss, luminance, contrastRatio, flatten } from './color.js';

/** How many linked stylesheets are worth following. Past this it is diminishing returns. */
export const MAX_STYLESHEETS = 12;

// ─── Reading the HTML ───────────────────────────────────────────────────────

/** True for a document that is a web page rather than a stylesheet or a theme file. */
export function looksLikeHtml(text) {
  const head = String(text ?? '').slice(0, 4000);
  return /<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>]|<meta\s|<link\s/i.test(head);
}

/** Everything in a page that bears on how it looks. */
export function readHtml(text, baseUrl = null) {
  const html = String(text ?? '');

  // Scripts first, and unconditionally. A page's inline JSON routinely contains both CSS
  // text and `style="…"` fragments, and reading those as declarations means importing a
  // colour from a data blob that never gets painted.
  const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ');

  const css = [];
  for (const block of markup.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) css.push(block[1]);

  // Inline style attributes are declarations without a selector. They are worth having —
  // a hero section frequently carries the brand colour this way and nowhere else — but
  // each is attached to one element, so they get a selector that says as much rather than
  // being allowed to speak for the page.
  for (const attr of markup.matchAll(/\sstyle\s*=\s*["']([^"']{0,2000})["']/gi)) {
    if (attr[1].includes(':')) css.push(`[style]{${attr[1]}}`);
  }

  // The pre-CSS web is still the web. Hacker News puts its orange in `bgcolor` and its
  // text colour in `<body text=…>`, and a reader that only knows stylesheets sees a site
  // with no design at all. These attributes are exactly declarations, so they are handed
  // on as declarations.
  const body = markup.match(/<body\b[^>]*>/i)?.[0] ?? '';
  const bodyDeclarations = [
    ['background-color', attribute(body, 'bgcolor')],
    ['color', attribute(body, 'text')],
  ].filter(([, value]) => value).map(([property, value]) => `${property}:${value}`);
  if (bodyDeclarations.length) css.push(`body{${bodyDeclarations.join(';')}}`);

  const linkColour = attribute(body, 'link');
  if (linkColour) css.push(`a{color:${linkColour}}`);

  for (const cell of markup.matchAll(/<(?:table|td|tr|th|font)\b[^>]*\b(bgcolor|color)\s*=\s*["']?([^"'\s>]+)/gi)) {
    const property = cell[1].toLowerCase() === 'bgcolor' ? 'background-color' : 'color';
    css.push(`[${cell[1].toLowerCase()}]{${property}:${cell[2]}}`);
  }

  return {
    css: css.join('\n'),
    links: stylesheetLinks(markup, baseUrl),
    themeColor: metaThemeColor(markup),
    title: markup.match(/<title[^>]*>([^<]{1,200})</i)?.[1]?.trim() || null,
  };
}

/**
 * The stylesheets a page links, in the order it links them.
 *
 * `data-href` is read alongside `href` because that is how a site with more than one
 * theme parks the ones it is not currently wearing — GitHub ships six that way — and a
 * parked stylesheet is still a design worth importing.
 */
export function stylesheetLinks(html, baseUrl = null) {
  const seen = new Set();
  const links = [];
  for (const match of String(html ?? '').matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const rel = attribute(tag, 'rel');
    if (!rel || !/\bstylesheet\b/i.test(rel)) continue;
    // A print stylesheet describes the page on paper, which is not the page.
    const media = attribute(tag, 'media');
    if (media && /\bprint\b/i.test(media) && !/\ball\b|\bscreen\b/i.test(media)) continue;

    const absolute = resolve(attribute(tag, 'href') ?? attribute(tag, 'data-href'), baseUrl);
    if (!absolute || seen.has(absolute)) continue;
    seen.add(absolute);
    links.push(absolute);
  }
  return links;
}

/**
 * `<meta name="theme-color">`.
 *
 * This is the one place on the open web where a site states its brand colour outright,
 * in a machine-readable field, on purpose. When a page offers it, it beats anything that
 * could be inferred by counting.
 */
function metaThemeColor(html) {
  for (const tag of String(html ?? '').matchAll(/<meta\b[^>]*>/gi)) {
    if (!/name\s*=\s*["']?theme-color/i.test(tag[0])) continue;
    const colour = parseColor(attribute(tag[0], 'content') ?? '');
    if (colour && colour.a > 0.5) return toCss({ ...colour, a: 1 });
  }
  return null;
}

function attribute(tag, name) {
  const quoted = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
  if (quoted) return quoted[1];
  const bare = tag.match(new RegExp(`\\b${name}\\s*=\\s*([^\\s>]+)`, 'i'));
  return bare ? bare[1] : null;
}

function resolve(href, baseUrl) {
  const value = String(href ?? '').trim();
  if (!value || value.startsWith('data:') || value.startsWith('#')) return null;
  try {
    return baseUrl ? new URL(value, baseUrl).href : new URL(value).href;
  } catch {
    return null;
  }
}

// ─── Reading the CSS ────────────────────────────────────────────────────────

/** Properties that put a colour on the page. Shorthands included; they are picked apart. */
const COLOUR_PROPERTIES = new Set([
  'color', 'background', 'background-color', 'border', 'border-color', 'border-top',
  'border-top-color', 'border-bottom', 'border-bottom-color', 'border-left-color',
  'border-right-color', 'border-block-color', 'border-inline-color', 'outline-color', 'fill',
]);

/** Selectors that are not describing one component but the page itself. */
const PAGE_SELECTOR = /^(html|body|:root|html\s*,\s*body|body\s*,\s*html|html\s+body)$/i;
const APP_SELECTOR = /^(#root|#app|#__next|#__nuxt|main|\.app|\.page|\.site|\.layout|#main-content)$/i;

/** A link is the one component every site has and every site colours with its accent. */
const LINK_SELECTOR = /(^|[\s,>])a(:link|:visited)?([\s,:.[]|$)/i;
const BUTTON_SELECTOR = /(button|\.btn|\[type=["']?submit|\.button|\.cta)/i;

/** Strips comments, so a commented-out palette is not read as a live one. */
function withoutComments(css) {
  return String(css ?? '').replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/**
 * Splits a stylesheet into what it paints by default and what it paints in dark mode.
 *
 * A modern site ships both in one file, and taking the union would blend two themes into
 * a palette that is neither. Brace-balanced rather than regex-matched, because a media
 * block contains rules, which contain braces.
 */
export function splitByColourScheme(css) {
  const text = withoutComments(css);
  const opener = /@media[^{]*prefers-color-scheme\s*:\s*dark[^{]*\{/gi;
  let light = '';
  let dark = '';
  let cursor = 0;
  let match = opener.exec(text);
  while (match) {
    light += text.slice(cursor, match.index);
    let depth = 1;
    let i = opener.lastIndex;
    while (i < text.length && depth > 0) {
      if (text[i] === '{') depth += 1;
      else if (text[i] === '}') depth -= 1;
      i += 1;
    }
    dark += `${text.slice(opener.lastIndex, i - 1)}\n`;
    cursor = i;
    opener.lastIndex = i;
    match = opener.exec(text);
  }
  light += text.slice(cursor);

  // Class-based dark mode is the other half of the convention: a rule whose selector says
  // dark belongs to the dark theme wherever in the file it sits.
  const classDark = [];
  const rest = [];
  for (const rule of rules(light)) {
    (/(^|[\s,])(\.dark|\[data-theme=["']?dark|\[data-mode=["']?dark|\.theme-dark|html\.dark)/i.test(rule.selector)
      ? classDark
      : rest).push(rule);
  }
  return { light: rest, dark: [...classDark, ...rules(dark)] };
}

/** Every `selector { … }` in a stylesheet, at-rules yielding their inner rules. */
function rules(css) {
  const found = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match = pattern.exec(css);
  while (match) {
    const selector = match[1].trim().replace(/\s+/g, ' ');
    // `@media …` head text arrives as a selector when the block nests; it selects
    // nothing, so it is not a rule.
    if (selector && !selector.startsWith('@') && match[2].includes(':')) {
      found.push({ selector, body: match[2] });
    }
    match = pattern.exec(css);
  }
  return found;
}

/** Every `--name: value` in the sheet, so `var(--name)` can be resolved to a colour. */
function customProperties(css) {
  const map = new Map();
  const pattern = /(--[\w-]+)\s*:\s*([^;}]+)/g;
  let match = pattern.exec(css);
  while (match) {
    // First writing wins, matching the cascade closely enough: a base palette is declared
    // before the overrides that re-theme it.
    if (!map.has(match[1])) map.set(match[1], match[2].trim());
    match = pattern.exec(css);
  }
  return map;
}

/** Resolves `var(--a, var(--b, #fff))` against the sheet's own declarations. */
function resolveVars(value, vars, depth = 0) {
  if (depth > 6 || !value.includes('var(')) return value;
  const replaced = value.replace(
    /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)/g,
    (whole, name, fallback) => vars.get(name) ?? fallback ?? whole,
  );
  return replaced === value ? value : resolveVars(replaced, vars, depth + 1);
}

/** The colour in a declaration, whether it is the whole value or part of a shorthand. */
function colourIn(value) {
  const text = String(value ?? '');
  const hasNotation = /#|rgba?\(|hsla?\(|oklch|oklab|lab\(|lch\(|hwb\(|color\(/i.test(text);
  if (!hasNotation && /\b(inherit|currentcolor|initial|unset|revert|none|transparent)\b/i.test(text)) return null;

  // Functional notations first: `rgb(0 0 0 / 50%)` would otherwise be split on spaces.
  const functional = text.match(/\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*(?:\([^()]*\)[^()]*)*\)/i);
  if (functional) {
    const parsed = parseColor(functional[0]);
    if (parsed) return parsed;
  }
  const hex = text.match(/#[0-9a-f]{3,8}\b/i);
  if (hex) {
    const parsed = parseColor(hex[0]);
    if (parsed) return parsed;
  }
  // A bare keyword — `background: white`. Only the first few tokens are considered, or
  // the word `solid` in a border shorthand starts looking like a colour.
  for (const token of text.trim().split(/\s+/).slice(0, 4)) {
    if (!/^[a-z]{3,20}$/i.test(token)) continue;
    const parsed = parseColor(token);
    if (parsed) return parsed;
  }
  return null;
}

/**
 * Every colour the sheet paints, with what painted it.
 *
 * One entry per declaration rather than per distinct colour: the count is the evidence.
 */
function observations(ruleList) {
  const vars = customProperties(ruleList.map((r) => r.body).join(';'));
  const out = [];
  const brand = [];
  for (const { selector, body } of ruleList) {
    for (const declaration of body.split(';')) {
      const split = declaration.indexOf(':');
      if (split < 0) continue;
      const property = declaration.slice(0, split).trim().toLowerCase();
      const value = resolveVars(declaration.slice(split + 1).trim(), vars);

      // A gradient is where a site keeps the colours it is proudest of. They make poor
      // flat backgrounds — a gradient has no single colour — so its stops are offered as
      // brand candidates only, never as the page.
      if (/gradient\(/i.test(value)) {
        for (const stop of colourStops(value)) brand.push(stop);
        continue;
      }
      if (property.startsWith('--')) {
        // A custom property holding a plain colour is a palette entry by definition, even
        // when its name means nothing here. Stripe's indigo exists nowhere else.
        const token = colourIn(value);
        if (token && token.a > 0.5) brand.push(token);
        continue;
      }
      if (!COLOUR_PROPERTIES.has(property)) continue;
      const colour = colourIn(value);
      if (!colour || colour.a <= 0.05) continue;
      out.push({ selector, property, colour });
    }
  }
  return { list: out, brand };
}

/** Every colour inside a gradient or other multi-colour value. */
function colourStops(value) {
  const found = [];
  for (const match of String(value).matchAll(/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab)\([^()]*\)/gi)) {
    const parsed = parseColor(match[0]);
    if (parsed && parsed.a > 0.5) found.push(parsed);
  }
  return found;
}

// ─── Choosing the seven ─────────────────────────────────────────────────────

const BACKGROUND_PROPERTIES = new Set(['background', 'background-color']);
const BORDER_PROPERTIES = new Set([
  'border', 'border-color', 'border-top', 'border-top-color', 'border-bottom',
  'border-bottom-color', 'border-left-color', 'border-right-color', 'border-block-color',
  'border-inline-color', 'outline-color',
]);

/** Counts colours, noting the heaviest selector each was seen on. */
function tally(list) {
  const counts = new Map();
  for (const { colour, selector } of list) {
    const key = toCss(colour);
    const entry = counts.get(key) ?? { colour, key, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count);
}

/**
 * How much colour a colour actually has, 0–1.
 *
 * Deliberately not HSL saturation, which is measured relative to lightness and so calls
 * Stripe's near-black navy `#061b31` a 78% saturated colour. Plain channel spread is what
 * the eye reports: navy is nearly grey, indigo is not. Getting this wrong means reading a
 * site's prose as its brand colour, or refusing its brand colour for being too plain.
 */
function chroma(colour) {
  const max = Math.max(colour.r, colour.g, colour.b);
  const min = Math.min(colour.r, colour.g, colour.b);
  return (max - min) / 255;
}

/**
 * The page's own background.
 *
 * Authority first — whatever `body` says it is. Failing that the most-declared opaque
 * background colour, which on a site with no page-level rule is the colour of its cards,
 * its header and its footer, and therefore the colour the page reads as.
 */
function pickBackground(list, preferDark) {
  const backgrounds = list.filter((o) => BACKGROUND_PROPERTIES.has(o.property));
  const opaque = (entry) => entry.colour.a >= 0.9;

  const fromPage = tally(backgrounds.filter((o) => PAGE_SELECTOR.test(o.selector))).find(opaque);
  if (fromPage) return { colour: fromPage.colour, why: 'the page background' };

  const fromApp = tally(backgrounds.filter((o) => APP_SELECTOR.test(o.selector))).find(opaque);
  if (fromApp) return { colour: fromApp.colour, why: 'the app container background' };

  // With no page-level rule to go on, counting alone will happily nominate a brand colour
  // that happens to be everywhere. A page is a surface things sit on, and surfaces are
  // overwhelmingly close to white or black, so a near-neutral candidate is taken first
  // and a vivid one only when the site truly has nothing else.
  const counted = tally(backgrounds).filter(opaque);
  const neutral = counted.find((entry) => chroma(entry.colour) < 0.25);
  if (neutral) return { colour: neutral.colour, why: 'the most-used background colour' };
  if (counted[0]) return { colour: counted[0].colour, why: 'the only background colour on the page' };
  return { colour: parseColor(preferDark ? '#111111' : '#ffffff'), why: 'nothing said, so plain' };
}

/** Body text. Authority first again, then the most-declared colour that can be read. */
function pickText(list, background) {
  const colours = list.filter((o) => o.property === 'color');
  const readable = (entry) => contrastRatio(flatten(entry.colour, background), background) >= 3;

  const fromPage = tally(colours.filter((o) => PAGE_SELECTOR.test(o.selector))).find(readable);
  if (fromPage) return { colour: fromPage.colour, why: 'the page text colour' };

  const fromApp = tally(colours.filter((o) => APP_SELECTOR.test(o.selector))).find(readable);
  if (fromApp) return { colour: fromApp.colour, why: 'the app container text colour' };

  // Among common colours, prefer the one that reads best rather than merely well: body
  // text is nearly always the highest-contrast thing on a page.
  //
  // Neutrality is weighed alongside contrast because a saturated colour is a link, a
  // warning or a brand mark, not prose. Wikipedia's red for broken links contrasts
  // beautifully against its white page and is emphatically not its body text.
  const score = (entry) => {
    const flat = flatten(entry.colour, background);
    return contrastRatio(flat, background) * Math.log(entry.count + 1) * (1 - chroma(flat) * 0.7);
  };
  const best = tally(colours).filter(readable).slice(0, 12).sort((a, b) => score(b) - score(a))[0];

  // Body text is not a vivid colour. When the only readable candidates on offer are
  // saturated — which happens when a site loads its real stylesheet from script and all
  // that can be seen is its link colours — the honest answer is ink chosen for the
  // background, not the red the page happened to reveal.
  // Merely readable is not good enough here. Nothing authoritative named this colour, so
  // a grey that scrapes past 3:1 is far more likely to be the site's captions than its
  // prose — Hacker News declares its subtext and lets the browser paint the rest black.
  // Where the best guess is that weak, ink chosen for the background is the truer answer.
  if (best && chroma(flatten(best.colour, background)) <= 0.35
    && contrastRatio(flatten(best.colour, background), background) >= 4.5) {
    return { colour: best.colour, why: 'the most-used readable text colour' };
  }
  return {
    colour: parseColor(luminance(background) < 0.35 ? '#f5f5f5' : '#171717'),
    why: best ? 'ink for the background, the page having named no plain text colour' : 'contrast with the background',
  };
}

/**
 * A raised panel: a background that is nearly, but not quite, the page.
 *
 * "Nearly" is the whole definition. A card is told from the page by a shade, not by a
 * colour, so anything with real contrast against the background is something else — a
 * banner, a footer, an advert — and not what `surface` means.
 */
function pickSurface(list, background) {
  const found = tally(list.filter((o) => BACKGROUND_PROPERTIES.has(o.property)))
    .filter((entry) => entry.colour.a >= 0.9)
    .filter((entry) => {
      const ratio = contrastRatio(entry.colour, background);
      return ratio > 1.01 && ratio < 1.9;
    });
  return found[0] ? { colour: found[0].colour, why: 'a panel a shade off the page' } : null;
}

/**
 * The brand colour.
 *
 * Links and buttons are where a site puts it, and `<meta name="theme-color">` is where a
 * site declares it. Failing all three, the most-used colour with actual saturation wins:
 * a page's greys are its structure and its one coloured thing is its accent.
 */
function pickAccent(list, background, themeColor, brand = [], text = null) {
  // An accent that is the body text colour is not an accent. Plenty of sites style their
  // navigation links in the same ink as their prose, so the link colour — normally the
  // best evidence there is — has to be checked against the text before it is believed,
  // or Stripe imports with a navy accent and its indigo is never found.
  const distinct = (colour) => !text || Math.abs(colour.r - text.r) + Math.abs(colour.g - text.g)
    + Math.abs(colour.b - text.b) > 36;
  const usable = (colour) => {
    const flat = flatten(colour, background);
    return contrastRatio(flat, background) >= 1.6 && chroma(flat) >= 0.12 && distinct(flat);
  };

  if (themeColor) {
    const parsed = parseColor(themeColor);
    if (parsed && usable(parsed)) return { colour: parsed, why: 'the theme-color the page declares' };
  }

  const links = tally(list.filter((o) => o.property === 'color' && LINK_SELECTOR.test(o.selector)))
    .find((entry) => usable(entry.colour));
  if (links) return { colour: links.colour, why: 'the link colour' };

  const buttons = tally(list.filter((o) => BACKGROUND_PROPERTIES.has(o.property) && BUTTON_SELECTOR.test(o.selector)))
    .find((entry) => usable(entry.colour));
  if (buttons) return { colour: buttons.colour, why: 'the button colour' };

  // Saturation is weighed against frequency rather than filtered by it: a strong brand
  // colour used twenty times beats a faint tint used two hundred.
  const coloured = tally(list)
    .filter((entry) => usable(entry.colour))
    .map((entry) => ({ ...entry, score: chroma(flatten(entry.colour, background)) * Math.log(entry.count + 1) }))
    .sort((a, b) => b.score - a.score);
  if (coloured[0]) return { colour: coloured[0].colour, why: 'the most-used colour on the page' };

  // Last: colours the site names but never paints flat — gradient stops and palette
  // tokens. Stripe's indigo lives only inside a `linear-gradient`, so a reader that
  // insists on a plain declaration decides Stripe has no brand colour.
  const named = tally(brand.map((colour) => ({ colour, selector: '', property: 'color' })))
    .filter((entry) => usable(entry.colour))
    .sort((a, b) => chroma(flatten(b.colour, background)) * Math.log(b.count + 1)
      - chroma(flatten(a.colour, background)) * Math.log(a.count + 1));
  return named[0] ? { colour: named[0].colour, why: 'a colour the palette names but never paints flat' } : null;
}

/** Rules. The most-declared border colour, whatever it is being drawn around. */
function pickBorder(list, background) {
  const found = tally(list.filter((o) => BORDER_PROPERTIES.has(o.property)))
    .find((entry) => contrastRatio(flatten(entry.colour, background), background) < 4.5);
  return found ? { colour: flatten(found.colour, background), why: 'the most-used border colour' } : null;
}

/** A caption: readable, but deliberately less so than body text. */
function pickMuted(list, background, text) {
  const full = contrastRatio(text, background);
  const found = tally(list.filter((o) => o.property === 'color'))
    .map((entry) => ({ ...entry, flat: flatten(entry.colour, background) }))
    .find((entry) => {
      const ratio = contrastRatio(entry.flat, background);
      return ratio >= 2.2 && ratio < full - 0.4;
    });
  return found ? { colour: found.flat, why: 'the most-used secondary text colour' } : null;
}

// ─── Assembly ───────────────────────────────────────────────────────────────

function mixColour(a, b, t) {
  const at = (k) => Math.round(a[k] + (b[k] - a[k]) * t);
  return { r: at('r'), g: at('g'), b: at('b'), a: 1 };
}

/** The corner the site rounds most of its boxes to. */
function dominantRadius(ruleList) {
  const counts = new Map();
  for (const { body } of ruleList) {
    for (const match of body.matchAll(/border-radius\s*:\s*([^;]+)/gi)) {
      const value = match[1].trim().split(/\s+/)[0].match(/^([\d.]+)(px|rem|em)?$/);
      if (!value) continue;
      const px = Math.round(Number(value[1]) * (value[2] === 'rem' || value[2] === 'em' ? 16 : 1));
      // A pill is a shape, not a corner radius, and copying it onto every box is wrong.
      if (!Number.isFinite(px) || px > 32) continue;
      counts.set(px, (counts.get(px) ?? 0) + 1);
    }
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : null;
}

/** The font stack the site sets on its body, if it sets one. */
function dominantFont(ruleList) {
  const clean = (stack) => stack.trim().replace(/\s+/g, ' ').slice(0, 200);
  for (const { selector, body } of ruleList) {
    if (!PAGE_SELECTOR.test(selector)) continue;
    const match = body.match(/font-family\s*:\s*([^;]+)/i);
    if (match && !/var\(|inherit/i.test(match[1])) return clean(match[1]);
  }
  const counts = new Map();
  for (const { body } of ruleList) {
    for (const match of body.matchAll(/font-family\s*:\s*([^;]+)/gi)) {
      if (/var\(|inherit/i.test(match[1])) continue;
      const stack = clean(match[1]);
      counts.set(stack, (counts.get(stack) ?? 0) + 1);
    }
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : null;
}

/**
 * Builds one candidate theme from one set of rules.
 *
 * Every colour that survives is flattened opaque before it is written down. A page can
 * perfectly well paint its header `rgba(22, 22, 22, 0.7)` — Netflix does — but a *theme*
 * background is the bottom of the stack with nothing behind it, so a translucent one is
 * a background that was never actually chosen.
 */
function candidateFrom(ruleList, { name, themeColor, dark }) {
  const { list, brand } = observations(ruleList);
  // One colour is enough. A page that says only `body { background: #eee }` has told us
  // the most important thing about how it looks, and the rest of the palette is derived
  // from it exactly as it would be for a theme file that named no border. Demanding more
  // evidence than that turns every small, plain, hand-written page into an import failure.
  if (!list.length) return null;

  const backgroundPick = pickBackground(list, dark);
  const background = flatten(backgroundPick.colour, parseColor(dark ? '#000000' : '#ffffff'));
  const textPick = pickText(list, background);
  const text = flatten(textPick.colour, background);
  // A page whose text does not stand off its background is a page this has misread.
  if (contrastRatio(text, background) < 1.8) return null;

  const isDark = luminance(background) < 0.35;
  const notes = [`background ← ${backgroundPick.why}`, `text ← ${textPick.why}`];

  const surface = pickSurface(list, background);
  notes.push(surface ? `surface ← ${surface.why}` : 'surface ← the page background');

  const accent = pickAccent(list, background, themeColor, brand, text);
  notes.push(accent ? `accent ← ${accent.why}` : 'accent ← text, for want of a brand colour');
  const accentColour = accent ? flatten(accent.colour, background) : text;

  const border = pickBorder(list, background);
  notes.push(border ? `border ← ${border.why}` : 'border ← a faint line between text and background');

  const muted = pickMuted(list, background, text);
  notes.push(muted ? `textMuted ← ${muted.why}` : 'textMuted ← text mixed toward the background');

  const white = parseColor('#ffffff');
  const black = parseColor('#000000');

  return {
    candidate: {
      name,
      description: '',
      dark: isDark,
      palette: {
        background: toCss(background),
        surface: toCss(surface ? flatten(surface.colour, background) : background),
        text: toCss(text),
        textMuted: toCss(muted ? muted.colour : mixColour(text, background, 0.35)),
        accent: toCss(accentColour),
        onAccent: contrastRatio(white, accentColour) >= contrastRatio(black, accentColour) ? '#ffffff' : '#000000',
        border: toCss(border ? border.colour : mixColour(text, background, isDark ? 0.78 : 0.82)),
      },
      radius: dominantRadius(ruleList),
      density: 1,
      fontFamily: dominantFont(ruleList),
      displayFamily: null,
      shadow: ruleList.some((r) => /box-shadow\s*:\s*(?!\s*none)/i.test(r.body)) ? 'soft' : 'none',
      author: null,
    },
    notes,
  };
}

/**
 * Reads a website's CSS as one or two themes.
 *
 * @param {string} css every stylesheet the page uses, concatenated
 * @param {{name?: string, themeColor?: string|null}} options
 * @returns {{source: string, themes: object[], inferred: string[]}|null} candidates for
 *   `normaliseTheme` — never validated themes, and never to be used without it
 */
export function themeFromWebsite(css, { name = 'Website', themeColor = null } = {}) {
  const { light, dark } = splitByColourScheme(css);
  const themes = [];
  const inferred = [];

  for (const [ruleList, suffix, isDark] of [[light, '', false], [dark, ' Dark', true]]) {
    if (!ruleList.length) continue;
    const built = candidateFrom(ruleList, { name: `${name}${suffix}`, themeColor, dark: isDark });
    if (!built) continue;
    themes.push(built.candidate);
    inferred.push(...built.notes.map((note) => `${name}${suffix}: ${note}`));
  }

  // A dark half that resolved to the same palette as the light half is not a second
  // theme, it is the same theme counted twice.
  if (themes.length === 2
    && themes[0].palette.background === themes[1].palette.background
    && themes[0].palette.text === themes[1].palette.text) {
    themes.length = 1;
    inferred.length = Math.ceil(inferred.length / 2);
  }
  return themes.length ? { source: 'website', themes, inferred } : null;
}
