/**
 * Reading a theme somebody else's tool wrote.
 *
 * Webin's own format is seven named colours and a handful of numbers. Almost every design
 * system in circulation is also, underneath, a small set of named colours — so a shadcn
 * `:root` block, a VS Code colour theme, a base16 scheme and a design-token file are all
 * the same document in different notation. This module is the notation layer.
 *
 * Two rules hold the whole thing together:
 *
 *   1. An adapter never produces a Theme. It produces a *candidate* — a plain object in
 *      the shape of one — which the caller then puts through `normaliseTheme`. That keeps
 *      exactly one validator in the codebase, so a hostile CSS file gets the same
 *      treatment as a hostile share code and nothing here has to be trusted.
 *
 *   2. Roles are inferred from names, and names are the least trustworthy part of any
 *      theme file. So inference is ordered by how strongly a name implies a role, every
 *      guess is reported back in `inferred`, and the UI shows the result before it saves
 *      anything. A guessed theme the user can see is fine; a guessed theme applied behind
 *      their back is not.
 */

import { parseColor, toCss, luminance, contrastRatio, flatten, isTransparent, rgbToHsl } from './color.js';
import { looksLikeHtml, readHtml, themeFromWebsite } from './website-theme.js';

/** Roles a theme needs, in the order the adapters try to fill them. */
const ROLES = ['background', 'surface', 'text', 'textMuted', 'accent', 'onAccent', 'border'];

/**
 * Name → role, most specific first.
 *
 * Order is the whole design here. In shadcn `--primary` is the brand and `--accent` is a
 * muted hover background, so `primary` has to be tried first or every imported shadcn
 * theme comes out with a grey accent. Likewise `muted-foreground` must be tested before
 * `muted`, or the caption colour is read as a panel fill.
 */
const ROLE_NAMES = {
  textMuted: [
    'muted-foreground', 'mutedforeground', 'text-muted', 'text-secondary', 'foreground-muted',
    'fg-muted', 'muted-fg', 'fg-subtle', 'text-subtle', 'foreground-secondary', 'fg-secondary',
    'neutral-content', 'base-content-secondary', 'description', 'text-dim',
    'subtle', 'text-tertiary', 'on-surface-variant', 'nc',
  ],
  onAccent: [
    'primary-foreground', 'primaryforeground', 'on-primary', 'primary-content',
    'accent-foreground', 'on-accent', 'button-foreground', 'pc', 'ac',
  ],
  background: [
    'background', 'bg', 'base-100', 'base100', 'canvas', 'page', 'body-bg', 'backdrop',
    'surface-0', 'editor-background', 'b1',
  ],
  surface: [
    'card', 'popover', 'panel', 'paper', 'sheet', 'surface', 'base-200', 'base200', 'elevated', 'muted',
    'secondary', 'surface-1', 'sidebar-background', 'b2',
  ],
  text: [
    'foreground', 'text', 'base-content', 'basecontent', 'fg', 'ink', 'body-color',
    'on-background', 'on-surface', 'text-primary', 'editor-foreground', 'bc',
  ],
  accent: [
    'primary', 'brand', 'accent', 'link', 'interactive', 'action',
    'button-surface', 'button-background', 'button-bg', 'p', 'a',
  ],
  border: [
    'border', 'outline', 'divider', 'base-300', 'base300', 'rule', 'stroke', 'separator',
    'border-color', 'b3',
  ],
};

/** Prefixes a token name may carry that say nothing about its role. */
const NOISE_PREFIX = /^(--)?(color|colors|colour|theme|clr|palette|token|tokens|ui)[-.]/;

/**
 * Segments that say nothing about a role wherever they appear.
 *
 * GitHub's Primer writes `--bgColor-default`, which normalises to `bg-color-default`.
 * Stripping `color` only when it leads means that name never reduces to `bg`, and a
 * design system used by millions of pages imports as nothing. The word is noise in the
 * middle of a name for exactly the reason it is noise at the front of one.
 */
const NOISE_SEGMENT = /^(color|colors|colour|colours|clr|theme|palette|token|tokens|ui|css|var|global|semantic|scale)$/;

/**
 * Trailing words that name a variant of a role rather than a role.
 *
 * `bg-default` and `bg` are the same token; `canvas-default` is the canvas. Stripped from
 * the end only — `base-100` keeps its `100`, which is what tells daisyUI's surfaces apart.
 */
const VARIANT_SUFFIX = /^(default|rest|normal|regular|base|solid|plain|main|std|standard|1|100|light)$/;

/**
 * Words that make a token a *state* rather than a role.
 *
 * This is what stops GitHub importing with a bright red page. Primer ships
 * `--bgColor-danger-emphasis` alongside `--bgColor-default`, and a loose tail match reads
 * the first one it happens to see whose name ends in `bg`. A danger colour is never the
 * background of a page, a success colour is never its text, and a name carrying one of
 * these words is describing a status, not a surface.
 */
/**
 * Segments that qualify a role by where it is used rather than by what it is.
 *
 * These separate a design system's tokens from a single component's decoration. GitHub
 * declares both `--fgColor-accent` and `--testimonial-accent-color`; the two end in the
 * same word and only one of them is the site's accent. A token qualified by `fg` or `bg`
 * is describing the role generally, so it is preferred over one qualified by the name of
 * whatever happened to need a colour that day.
 */
const USAGE_PREFIX = /^(fg|bg|foreground|background|text|border|surface|fill|stroke|ink|on|content)$/;

const STATE_SEGMENT = new Set([
  'danger', 'error', 'critical', 'warning', 'caution', 'success', 'positive', 'negative',
  'attention', 'severe', 'info', 'notice', 'done', 'closed', 'merged', 'draft', 'sponsors',
  'upsell', 'premium', 'promo', 'sale', 'new', 'beta', 'hover', 'active', 'focus', 'pressed',
  'disabled', 'visited', 'selected', 'checked', 'invalid', 'required', 'placeholder',
  'inverse', 'inverted', 'emphasis', 'overlay', 'shadow', 'scrollbar', 'skeleton', 'tooltip',
  'badge', 'toast', 'alert', 'highlight', 'syntax', 'diff', 'graph', 'avatar', 'logo', 'ad',
]);

/** Normalises `--color-base-100` and `color.base.100` to the same thing. */
function normaliseName(raw) {
  // `--PanelForeground` and `--panel-foreground` are one name written two ways, and real
  // design systems mix both — Netflix ships `Accordion-HeadlineForeground`. Splitting the
  // camel humps before lowercasing means a compound word is read as its parts.
  let name = String(raw ?? '').trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[._\s]+/g, '-');
  name = name.replace(/^-+/, '');
  let previous;
  do {
    previous = name;
    name = name.replace(NOISE_PREFIX, '');
  } while (name !== previous);
  name = name.replace(/^-+|-+$/g, '');

  // A name reduced to nothing by segment-stripping was only ever noise, so the original
  // stands rather than becoming the empty string and colliding with every other one.
  const kept = name.split('-').filter((segment) => segment && !NOISE_SEGMENT.test(segment));
  return kept.length ? kept.join('-') : name;
}

/** True for a token naming a status rather than a role. */
function namesAState(name) {
  return name.split('-').some((segment) => STATE_SEGMENT.has(segment));
}

/** `bg-default` -> `bg`. The role a variant is a variant of. */
function withoutVariant(name) {
  const segments = name.split('-');
  while (segments.length > 1 && VARIANT_SUFFIX.test(segments[segments.length - 1])) segments.pop();
  return segments.join('-');
}

/**
 * A colour, whatever notation it arrived in.
 *
 * The one form `parseColor` cannot know about is shadcn's: three bare numbers that are
 * the inside of an `hsl()` the stylesheet supplies. `221.2 83.2% 53.3%` is a colour only
 * if you already know the convention, so it is recognised here rather than there.
 */
export function readColorValue(raw) {
  const value = String(raw ?? '').trim().replace(/;$/, '').trim();
  if (!value) return null;

  const direct = parseColor(value);
  if (direct) return toCss(direct);

  const bareHsl = value.match(/^(-?[\d.]+)\s*,?\s+(-?[\d.]+)%\s*,?\s+(-?[\d.]+)%$/);
  if (bareHsl) {
    const parsed = parseColor(`hsl(${bareHsl[1]}, ${bareHsl[2]}%, ${bareHsl[3]}%)`);
    if (parsed) return toCss(parsed);
  }

  // base16 files write hex without the hash.
  if (/^[0-9a-f]{6}$/i.test(value) || /^[0-9a-f]{3}$/i.test(value)) {
    const parsed = parseColor(`#${value}`);
    if (parsed) return toCss(parsed);
  }
  return null;
}

/** `0.5rem` / `8px` / `8` -> 8. Anything else -> null. */
function readLength(raw) {
  const value = String(raw ?? '').trim();
  const match = value.match(/^(-?[\d.]+)(px|rem|em)?$/);
  if (!match) return null;
  const n = Number.parseFloat(match[1]);
  if (!Number.isFinite(n)) return null;
  return match[2] === 'rem' || match[2] === 'em' ? n * 16 : n;
}

// ─── Format sniffing ────────────────────────────────────────────────────────

/**
 * JSON with the things people actually write in it.
 *
 * VS Code themes, and most editor config, are JSONC: `//` and block comments, and trailing
 * commas. That is not JSON, so `JSON.parse` refuses it — and it refused it during
 * *sniffing*, which meant a commented theme came back not as a broken VS Code theme but as
 * a file of no recognised kind at all.
 *
 * The scan has to know where strings are. `"$schema": "vscode://schemas/color-theme"` is
 * the first line of every generated VS Code theme, and a regex that strips `//` to the end
 * of the line eats half of it.
 */
export function stripJsonc(text) {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (inString) {
      // A backslash escapes whatever follows, a closing quote included, so both go through.
      if (char === '\\') { out += char + (next ?? ''); i += 1; continue; }
      if (char === '"') inString = false;
      out += char;
      continue;
    }
    if (char === '"') { inString = true; out += char; continue; }
    if (char === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      out += '\n';                       // keep the line count, so parse errors still point somewhere
      continue;
    }
    if (char === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 1;
      continue;
    }
    out += char;
  }
  // Taking comments out routinely manufactures a trailing comma: the last live declaration
  // ends in one and everything after it was commented out. That is the common shape of a
  // theme exported by VS Code's own "Generate Color Theme From Current Settings".
  return out.replace(/,(\s*[}\]])/g, '$1');
}

/**
 * Reads JSON, and JSONC if plain JSON will not have it. Strict first, so a file that parses
 * today is never put through the stripper and cannot be changed by it. Returns `undefined`
 * rather than `null` when the text is not JSON at all, because `null` is a thing JSON says.
 */
function parseJsonish(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    // Might be JSONC. Fall through.
  }
  try {
    return JSON.parse(stripJsonc(raw));
  } catch {
    return undefined;
  }
}

/**
 * What kind of file this is, from its content rather than its extension.
 *
 * People paste theme files into a textarea; there is no extension to go on, and a
 * `.json` that is really a VS Code theme and a `.json` that is really a base16 scheme
 * need different readers.
 */
export function sniffFormat(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;

  // No `starts with {` gate: a JSONC file may open with a comment. Anything that does not
  // read as JSON falls through to the text formats below, which is where a stylesheet
  // beginning with its own block comment needs to end up.
  const json = parseJsonish(raw);
  if (json !== undefined) return sniffJson(json);

  if (/base0[0-9a-f]\s*:/i.test(raw)) return 'base16';

  // A web page is checked before the stylesheet formats, not after. A page routinely
  // contains a `--var: value` somewhere in its inline styles, and reading the whole
  // document as a stylesheet on the strength of that is how a site's markup gets parsed
  // as a palette. A page is a page; its CSS is fetched and read separately.
  if (looksLikeHtml(raw)) return 'html';

  if (/--[\w-]+\s*:/.test(raw) || /@plugin\s+["']daisyui/.test(raw)) return 'css-vars';

  // A plain stylesheet with no custom properties at all is still a design — most of the
  // web is exactly that — so it goes to the reader that looks at what is painted.
  if (/\{[^{}]*\b(color|background|background-color)\s*:/i.test(raw)) return 'stylesheet';
  return null;
}

function sniffJson(json) {
  if (!json || typeof json !== 'object') return null;
  if (json.format === 'webin-theme' || json.format === 'webin-collection') return 'webin';
  if (json.palette && typeof json.palette === 'object') return 'webin';
  if (json.colors && typeof json.colors === 'object'
    && Object.keys(json.colors).some((k) => k.includes('.'))) return 'vscode';
  if (Object.keys(json).some((k) => /^base0[0-9a-f]$/i.test(k))) return 'base16';
  if (Array.isArray(json.schemes) || (json.background && json.foreground && json.black)) return 'terminal';
  if (hasDesignTokens(json)) return 'dtcg';
  if (Object.keys(json).some((k) => k.startsWith('--'))) return 'css-vars';

  // Last: a file that is simply full of colours, under whatever names its author liked.
  // Hand-written and generated theme files rarely match a published format — they invent
  // a vocabulary (`canvas`, `paper`, `ink`, `blossom`) and nest it however reads nicely.
  // There is still a theme in there, and the role matcher already knows most of those
  // words, so the shape is worth reading rather than refusing.
  if (looseColours(json).length >= MIN_LOOSE_COLOURS) return 'json';
  return null;
}

/** Enough colours to be a palette rather than a stray hex in some unrelated document. */
const MIN_LOOSE_COLOURS = 3;

/**
 * Every leaf anywhere in a JSON file whose value parses as a colour, named by its path.
 *
 * Named by the whole path rather than the leaf key because the role matcher reads names
 * from the tail inwards: `theme-colors-canvas` still answers to `canvas`, while
 * `surfaces-card-background` stays distinguishable from the page's own background.
 *
 * `parseColor` is the test for whether a leaf counts, which is the honest one — a string
 * is a colour exactly when the thing that has to render it can read it.
 */
function looseColours(node, path = [], out = [], skip = null) {
  if (!node || typeof node !== 'object' || path.length > 8) return out;
  for (const [key, child] of Object.entries(node)) {
    if (skip?.test(key.replace(/[-_\s]/g, ''))) continue;
    if (typeof child === 'string') {
      if (parseColor(child)) out.push([[...path, key].join('-'), child]);
    } else if (child && typeof child === 'object') {
      looseColours(child, [...path, key], out, skip);
    }
  }
  return out;
}

/** Branches belonging to the mode this file is not, given the mode it says it is. */
const OTHER_MODE = {
  light: /^(night|dark)(mode|theme)?$/i,
  dark: /^(day|light)(mode|theme)?$/i,
};

/**
 * Which of the two a file says it is, or null when it does not say.
 *
 * Worth asking because a theme file routinely carries both, and a loose walk has no other
 * way to tell that `special.nightMode.surface` is not this theme's surface. Reading it as
 * one is how a light theme comes out with dark panels — the colour is real, correctly
 * named, and belongs to the other half of the file.
 */
function declaredMode(json) {
  const said = json?.mode ?? json?.theme?.mode ?? json?.appearance ?? json?.theme?.appearance;
  if (typeof said === 'string') {
    const word = said.trim().toLowerCase();
    if (word === 'light' || word === 'dark') return word;
  }
  const dark = json?.dark ?? json?.theme?.dark;
  if (typeof dark === 'boolean') return dark ? 'dark' : 'light';
  return null;
}

function hasDesignTokens(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 6) return false;
  if (node.$value !== undefined || (node.value !== undefined && node.type !== undefined)) return true;
  return Object.values(node).some((child) => hasDesignTokens(child, depth + 1));
}

// ─── Extracting name/value pairs ────────────────────────────────────────────

/**
 * Every custom property in a stylesheet, with the selector block it came from.
 *
 * A theme file routinely carries two themes — `:root` and `.dark` — so the block matters
 * as much as the declaration.
 */
function cssVariableBlocks(text) {
  const blocks = [];
  // Non-greedy body match; nested blocks (@media, @layer) simply yield their inner rules,
  // which is the right answer for a file that wraps its palette in a layer.
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  let match = rulePattern.exec(text);
  while (match) {
    const selector = match[1].trim().replace(/\s+/g, ' ');
    const pairs = [];
    const declPattern = /(--[\w-]+)\s*:\s*([^;]+)/g;
    let decl = declPattern.exec(match[2]);
    while (decl) {
      pairs.push([decl[1], decl[2].trim()]);
      decl = declPattern.exec(match[2]);
    }
    if (pairs.length) blocks.push({ selector, pairs });
    match = rulePattern.exec(text);
  }
  return blocks;
}

/** Flattens a design-token tree to `path -> value`, keeping only colours and lengths. */
function flattenTokens(node, path = [], out = []) {
  if (!node || typeof node !== 'object' || path.length > 8) return out;
  const value = node.$value ?? (node.type !== undefined ? node.value : undefined);
  if (value !== undefined && typeof value !== 'object') {
    out.push([path.join('-'), String(value)]);
    return out;
  }
  for (const [key, child] of Object.entries(node)) {
    if (key.startsWith('$')) continue;
    flattenTokens(child, [...path, key], out);
  }
  return out;
}

// ─── Role inference ─────────────────────────────────────────────────────────

/**
 * Fills the seven roles from a list of `[name, colour]` pairs.
 *
 * A name is only accepted for a role if it matches one of that role's known names — no
 * fuzzy substring matching, which is how `--primary-foreground` ends up as the accent.
 * Roles are resolved in `ROLE_NAMES` key order so the specific ones claim their names
 * before the general ones get a chance.
 */
/**
 * Whether a colour can do the job of the role it was read for.
 *
 * Only the accent is checked, and only against a background already known. A theme file
 * naming a white `--button-background` on a white page — GOV.UK does — has named a real
 * colour for a real button, and an accent nobody can see. Rejecting it here lets the next
 * name in the role's list have its turn instead of the palette keeping an invisible one.
 */
function roleUsable(role, colour, palette) {
  if (role !== 'accent' || !palette.background) return true;
  const front = parseColor(colour);
  const behind = parseColor(palette.background);
  if (!front || !behind) return true;
  return contrastRatio(flatten(front, behind), behind) >= ACCENT_MIN_CONTRAST;
}

function inferRoles(pairs) {
  const byName = new Map();
  for (const [rawName, rawValue] of pairs) {
    const colour = readColorValue(rawValue);
    // `transparent` is a real CSS value and a real declaration, but it names no colour, so
    // a role filled from one would be a role that is not filled at all.
    if (!colour || isTransparent(colour)) continue;
    const name = normaliseName(rawName);
    if (!byName.has(name)) byName.set(name, colour);
  }

  const palette = {};
  const inferred = [];
  const claimed = new Set();

  // Names indexed twice: as written, and with any trailing variant word removed, so
  // `--bgColor-default` answers to `bg` without `--bg` losing its priority over it.
  const byRoleName = new Map();
  for (const [name, colour] of byName) {
    if (namesAState(name)) continue;
    if (!byRoleName.has(name)) byRoleName.set(name, { colour, name });
    const stem = withoutVariant(name);
    if (stem !== name && !byRoleName.has(stem)) byRoleName.set(stem, { colour, name });
  }

  for (const role of Object.keys(ROLE_NAMES)) {
    for (const candidate of ROLE_NAMES[role]) {
      const hit = byRoleName.get(candidate);
      if (!hit || claimed.has(hit.name) || !roleUsable(role, hit.colour, palette)) continue;
      palette[role] = hit.colour;
      claimed.add(hit.name);
      claimed.add(candidate);
      inferred.push(`${role} ← --${hit.name}`);
      break;
    }
  }

  // Second pass, for the roles the first one could not fill. A real site's design system
  // namespaces everything — Netflix ships `--hcw--local-design--Button-Surface` — so an
  // exact match finds nothing at all and the page imports as no theme rather than as the
  // theme it plainly is. Here a name counts if one of its trailing segments is a name we
  // know, longest tail first, so `button-foreground` is still read as the label on a
  // button before `foreground` is read as body text.
  //
  // This runs second on purpose. Exact names always win, which is what keeps
  // `--primary-foreground` from being claimed as the accent.
  const roleOfName = new Map();
  for (const role of Object.keys(ROLE_NAMES)) {
    for (const candidate of ROLE_NAMES[role]) {
      if (!roleOfName.has(candidate)) roleOfName.set(candidate, role);
    }
  }

  // Each variable is resolved by its *longest* recognisable tail rather than by role
  // order, so `Button-Surface` is read as a button fill — a brand colour — before the
  // bare word `surface` can claim it as a panel.
  const found = new Map();
  for (const [name, colour] of byName) {
    // A status colour is not a role, however its name ends. Without this the first
    // `--bgColor-danger-emphasis` in the file becomes the page background.
    if (namesAState(name) || claimed.has(name)) continue;
    const segments = withoutVariant(name).split('-').filter(Boolean);
    for (let start = 0; start < segments.length; start += 1) {
      const tail = segments.slice(start).join('-');
      const role = roleOfName.get(tail);
      if (!role) continue;
      // Fewer discarded leading segments is a closer match, so `bg` beats `button-bg`
      // for the page background regardless of which the file happens to list first. Where
      // two names are equally close, the one qualified by a usage word wins.
      const usage = start > 0 && USAGE_PREFIX.test(segments[start - 1]) ? 0 : 1;
      const previous = found.get(role);
      const better = !previous || start < previous.distance
        || (start === previous.distance && usage < previous.usage);
      if (better && !claimed.has(tail)) found.set(role, { colour, tail, distance: start, usage });
      break;
    }
  }
  for (const role of Object.keys(ROLE_NAMES)) {
    if (palette[role] || !found.has(role)) continue;
    const { colour, tail } = found.get(role);
    if (!roleUsable(role, colour, palette)) continue;
    palette[role] = colour;
    claimed.add(tail);
    inferred.push(`${role} ← a name ending in ${tail}`);
  }
  return { palette, inferred, byName };
}

/**
 * Fills whatever the file did not name.
 *
 * A theme missing its muted text or its border is still a usable theme, and refusing it
 * would reject most real files — VS Code themes in particular name a hundred editor
 * colours and none of the seven things asked for here by those names. Anything derived
 * rather than read is reported, so the preview can say so.
 */
export function completePalette(palette, inferred, { prefersDark = null, spare = [] } = {}) {
  const has = (key) => typeof palette[key] === 'string';
  const note = (key, why) => { inferred.push(`${key} ← ${why}`); };

  // A surface can stand in for a missing canvas, but only a solid one. The raised plane
  // of a glass theme is a sheet of near-transparent white; promoting that to the page's
  // ground gives a canvas that paints nothing and reads as blinding white to every
  // contrast check downstream.
  if (!has('background') && has('surface') && (parseColor(palette.surface)?.a ?? 0) >= 0.9) {
    palette.background = palette.surface;
    note('background', 'surface');
  }
  if (!has('surface') && has('background')) { palette.surface = palette.background; note('surface', 'background'); }

  // A glass theme's ground.
  //
  // A file that writes `background: transparent` has not failed to name its canvas; it has
  // said the canvas is not its own — something behind is meant to provide it. Where that
  // something is a backdrop the base supplies the ground, and where there is no backdrop
  // there is still enough on the page to work one out: light ink means a dark page, and
  // the accent says which dark. Refusing the file instead was pedantry — it named its ink,
  // its panels and its brand colour, and every one of those points the same way.
  //
  // One colour is still not a theme, so this needs the text *and* something else to stand
  // on. A palette holding nothing but a text colour has no page to put the text on, and
  // saying so remains the right answer.
  const supporting = ['surface', 'accent', 'border', 'textMuted', 'onAccent'].filter(has);
  if (!has('background') && has('text') && supporting.length) {
    const wantsDark = prefersDark ?? (luminance(parseColor(palette.text)) > 0.5);
    palette.background = groundFor(has('accent') ? parseColor(palette.accent) : null, wantsDark);
    note('background', wantsDark
      ? 'a dark ground, since the text is light and the theme names no canvas'
      : 'a light ground, since the text is dark and the theme names no canvas');
  }

  if (!has('background') || !has('text')) return null;

  const dark = luminance(parseColor(palette.background)) < 0.35;

  // Last line of defence: an accent that vanishes into the page is not one, however it
  // was arrived at.
  if (has('accent') && !roleUsable('accent', palette.accent, palette)) delete palette.accent;

  // Before giving up: a file whose named accent was unusable often names another brand
  // colour that is perfectly usable. A theme file listing `accent: #F6D98B` — a pale
  // yellow that disappears on cream — alongside `primary: #527A5B` has a brand colour;
  // reaching past both of them for the body text makes the whole theme monochrome, which
  // is a worse reading of the file than either colour would have been.
  if (!has('accent') && spare.length) {
    const rescued = pickAccent(spare, palette);
    if (rescued) { palette.accent = rescued.colour; note('accent', rescued.why); }
  }
  if (!has('accent')) { palette.accent = palette.text; note('accent', 'text, for want of a brand colour'); }
  if (!has('textMuted')) {
    // Halfway between the text and its background is what a caption is, near enough.
    palette.textMuted = mixCss(palette.text, palette.background, 0.35);
    note('textMuted', 'text mixed toward the background');
  }
  if (!has('border')) {
    palette.border = mixCss(palette.text, palette.background, dark ? 0.78 : 0.82);
    note('border', 'a faint line between text and background');
  }
  if (!has('onAccent')) {
    const accent = parseColor(palette.accent);
    const white = parseColor('#ffffff');
    const black = parseColor('#000000');
    palette.onAccent = contrastRatio(white, accent) >= contrastRatio(black, accent) ? '#ffffff' : '#000000';
    note('onAccent', 'whichever of black or white reads on the accent');
  }
  return { palette, dark };
}

/**
 * A canvas for a theme that named none: the accent's own hue, taken to one end or the
 * other of the lightness range.
 *
 * Tinted rather than neutral because a grey ground under a blue theme looks like a
 * mistake, and because the accent is the one colour such a file always has. The saturation
 * is held well down — this is a page, not a poster.
 */
function groundFor(accent, dark) {
  if (!accent) return dark ? '#101216' : '#fafafa';
  const { h, s } = rgbToHsl(accent);
  const hsl = `hsl(${Math.round(h)}, ${Math.round(Math.min(s, 0.45) * 100)}%, ${dark ? 7 : 97}%)`;
  const parsed = parseColor(hsl);
  return parsed ? toCss(parsed) : (dark ? '#101216' : '#fafafa');
}

/** Linear blend, `t` of the way from `a` to `b`. */
function mixCss(a, b, t) {
  const from = parseColor(a);
  const to = parseColor(b);
  if (!from || !to) return a;
  const at = (k) => Math.round(from[k] + (to[k] - from[k]) * t);
  return toCss({ r: at('r'), g: at('g'), b: at('b'), a: 1 });
}

/**
 * How well a candidate reads as a theme somebody designed.
 *
 * Two readers can both produce a palette from the same website and only one of them be
 * right, so there has to be a way to tell. Rather than guessing per site which reader to
 * trust, both run and the better answer wins — and "better" is decided on the properties
 * a real palette has, none of which depend on where it came from.
 */
function paletteQuality(theme) {
  const background = parseColor(theme?.palette?.background);
  const text = parseColor(theme?.palette?.text);
  if (!background || !text) return -Infinity;

  // Readable body text is the strongest evidence a palette was read rather than
  // assembled: unrelated colours pulled from one stylesheet rarely contrast.
  let score = Math.min(contrastRatio(flatten(text, background), background), 21);

  // A translucent background is not a background. It is a colour that was sitting on top
  // of one, read as though nothing were underneath.
  if (background.a < 0.99) score -= 12;

  const accent = parseColor(theme.palette.accent);
  if (accent && toCss(accent) !== toCss(text)) score += 4;

  // A palette that collapsed to two or three colours is mostly derivation.
  score += new Set(Object.values(theme.palette).map((value) => String(value).toLowerCase())).size;
  return score;
}

/** The better of two readings of the same document, or whichever one exists. */
function betterOf(a, b) {
  if (!a?.themes?.length) return b?.themes?.length ? b : null;
  if (!b?.themes?.length) return a;
  const rate = (result) => Math.max(...result.themes.map(paletteQuality))
    // A reader that found the site's light *and* dark themes understood more of it.
    + (result.themes.length > 1 ? 1 : 0);
  return rate(b) > rate(a) ? b : a;
}

/** Turns an inferred palette into a candidate object for `normaliseTheme`. */
function candidateFrom({ palette, inferred, name, extras = {} }) {
  const completed = completePalette(palette, inferred);
  if (!completed) return null;
  return {
    name,
    description: extras.description ?? '',
    dark: extras.dark ?? completed.dark,
    palette: completed.palette,
    radius: extras.radius ?? null,
    density: 1,
    fontFamily: extras.fontFamily ?? null,
    displayFamily: null,
    shadow: extras.shadow ?? 'soft',
    author: extras.author ?? null,
  };
}

// ─── Adapters ───────────────────────────────────────────────────────────────

function fromCssVariables(text, name) {
  const blocks = typeof text === 'string'
    ? cssVariableBlocks(text)
    : [{ selector: ':root', pairs: Object.entries(text) }];
  if (!blocks.length) return null;

  // A theme file usually holds a light palette and a dark one. Both are worth having, so
  // blocks are grouped by whether their selector reads as dark.
  const light = [];
  const dark = [];
  for (const block of blocks) {
    (/\bdark\b|prefers-color-scheme:\s*dark/i.test(block.selector) ? dark : light).push(...block.pairs);
  }

  const themes = [];
  const inferred = [];
  for (const [pairs, suffix, isDark] of [[light, '', false], [dark, ' Dark', true]]) {
    if (!pairs.length) continue;
    const roles = inferRoles(pairs);
    const notes = [...roles.inferred];
    const radius = readLength(
      roles.byName.get('radius') ?? findRaw(pairs, ['--radius', '--radius-box', '--rounded-box', '--border-radius']),
    );
    const candidate = candidateFrom({
      palette: roles.palette,
      inferred: notes,
      name: `${name}${suffix}`,
      extras: { radius, dark: isDark || undefined },
    });
    if (candidate) {
      themes.push(candidate);
      inferred.push(...notes.map((n) => `${name}${suffix}: ${n}`));
    }
  }
  return themes.length ? { source: 'css-vars', themes, inferred } : null;
}

function findRaw(pairs, names) {
  for (const wanted of names) {
    const hit = pairs.find(([n]) => normaliseName(n) === normaliseName(wanted));
    if (hit) return hit[1];
  }
  return null;
}

/**
 * VS Code colour themes.
 *
 * These name editor parts, not design roles, so the mapping is explicit rather than
 * inferred: the editor background is the canvas, the sidebar is a raised surface, a
 * button fill is the accent.
 */
const VSCODE_MAP = {
  background: ['editor.background', 'editorPane.background', 'tab.activeBackground'],
  surface: ['sideBar.background', 'editorWidget.background', 'panel.background', 'activityBar.background'],
  text: ['editor.foreground', 'foreground', 'sideBar.foreground'],
  textMuted: ['descriptionForeground', 'disabledForeground', 'editorLineNumber.foreground'],
  accent: ['button.background', 'textLink.foreground', 'focusBorder', 'activityBarBadge.background'],
  onAccent: ['button.foreground', 'activityBarBadge.foreground'],
  border: ['panel.border', 'editorGroup.border', 'contrastBorder', 'input.border'],
};

/**
 * The palette a VS Code theme file *shows*, not the subset it declares.
 *
 * VS Code's own "Developer: Generate Color Theme From Current Settings" writes the whole
 * resolved palette and then comments out every value that came from a built-in default,
 * leaving a handful of live declarations behind. Read as JSONC, that file is a theme of
 * eleven colours. Read the way the person exporting it reads it, it is the complete
 * palette of the theme they were looking at when they exported.
 *
 * So the commented declarations are harvested as well. Anything the file states outright
 * still wins, because that is the part the theme's author chose rather than inherited.
 */
function vsCodeColours(json, raw) {
  const declared = (json?.colors && typeof json.colors === 'object') ? json.colors : {};
  if (!raw.includes('//')) return declared;

  // Only comments that are shaped like a declaration are revived; prose stays a comment.
  // If reviving them yields something that will not parse, `parseJsonish` gives up and the
  // file is read exactly as it was before.
  const revived = parseJsonish(raw.replace(/^([ \t]*)\/\/(?=[ \t]*"[^"\n]+"[ \t]*:)/gm, '$1'));
  const inherited = revived?.colors;
  if (!inherited || typeof inherited !== 'object') return declared;
  return { ...inherited, ...declared };
}

/** Below this, an accent is the same colour as the page it is sitting on. */
const ACCENT_MIN_CONTRAST = 1.5;

/**
 * Whether a colour can actually do the job of the role it was read for.
 *
 * An editor gets away with things a web page does not. VS Code's high-contrast buttons are
 * black on a black canvas, told apart by a bright border — but a page has nothing to draw
 * that border on, so taking `button.background` at face value gives an accent nobody can
 * see. Where a candidate cannot work, the next key in the role's list gets its turn, and if
 * none of them can, the role is derived like any other missing one.
 */
function vsCodeRoleWorks(role, colour, palette) {
  const against = role === 'accent' ? palette.background
    : role === 'onAccent' ? palette.accent
      : null;
  if (!against) return true;
  const front = parseColor(colour);
  const behind = parseColor(against);
  // Not a pair we can judge is not a pair we refuse.
  if (!front || !behind) return true;
  const ratio = contrastRatio(flatten(front, behind), behind);
  return ratio >= (role === 'accent' ? ACCENT_MIN_CONTRAST : 4.5);
}

function fromVsCode(json, name) {
  const colors = json.colors ?? {};
  const palette = {};
  const inferred = [];
  for (const role of ROLES) {
    for (const key of VSCODE_MAP[role] ?? []) {
      const colour = readColorValue(colors[key]);
      if (!colour || !vsCodeRoleWorks(role, colour, palette)) continue;
      palette[role] = colour;
      inferred.push(`${role} ← ${key}`);
      break;
    }
  }
  const candidate = candidateFrom({
    palette,
    inferred,
    name: typeof json.name === 'string' && json.name ? json.name : name,
    extras: { dark: json.type ? json.type !== 'light' : undefined, shadow: 'sharp' },
  });
  return candidate ? { source: 'vscode', themes: [candidate], inferred } : null;
}

/**
 * base16 and base24 schemes.
 *
 * These are the most precisely specified of the lot: base00 is always the darkest
 * background and base05 always the default text, so no inference is needed at all.
 */
const BASE16_MAP = {
  background: 'base00', surface: 'base01', border: 'base02', textMuted: 'base03',
  text: 'base05', accent: 'base0d',
};

function fromBase16(source, name) {
  const values = new Map();
  if (typeof source === 'string') {
    const pattern = /(base[0-9a-f]{2})\s*:\s*["']?#?([0-9a-fA-F]{6})["']?/gi;
    let match = pattern.exec(source);
    while (match) { values.set(match[1].toLowerCase(), `#${match[2]}`); match = pattern.exec(source); }
  } else {
    for (const [key, value] of Object.entries(source)) {
      if (/^base[0-9a-f]{2}$/i.test(key)) values.set(key.toLowerCase(), readColorValue(value));
    }
  }
  if (!values.size) return null;

  const palette = {};
  const inferred = [];
  for (const [role, key] of Object.entries(BASE16_MAP)) {
    const colour = values.get(key);
    if (colour) { palette[role] = colour; inferred.push(`${role} ← ${key}`); }
  }
  const themeName = typeof source === 'object' && typeof source.scheme === 'string'
    ? source.scheme
    : (typeof source === 'string' && source.match(/scheme\s*:\s*["']?([^"'\n]+)/)?.[1]?.trim()) || name;
  const candidate = candidateFrom({
    palette,
    inferred,
    name: themeName,
    extras: { author: typeof source === 'object' ? source.author ?? null : null, shadow: 'none' },
  });
  return candidate ? { source: 'base16', themes: [candidate], inferred } : null;
}

/** Windows Terminal and iTerm-style palettes. One file may carry a whole shelf of them. */
function fromTerminal(json, name) {
  const schemes = Array.isArray(json.schemes) ? json.schemes : [json];
  const themes = [];
  const inferred = [];
  for (const scheme of schemes) {
    const background = readColorValue(scheme.background);
    const text = readColorValue(scheme.foreground);
    if (!background || !text) continue;
    const palette = { background, text };
    const surface = readColorValue(scheme.black ?? scheme.brightBlack);
    const accent = readColorValue(scheme.blue ?? scheme.brightBlue ?? scheme.purple ?? scheme.cyan);
    const muted = readColorValue(scheme.brightBlack ?? scheme.white);
    if (surface && surface !== background) palette.surface = surface;
    if (accent) palette.accent = accent;
    if (muted) palette.textMuted = muted;
    const candidate = candidateFrom({
      palette,
      inferred,
      name: typeof scheme.name === 'string' && scheme.name ? scheme.name : name,
      // A terminal palette is a terminal palette: monospace, square, flat.
      extras: { shadow: 'none', radius: 0, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
    });
    if (candidate) themes.push(candidate);
  }
  return themes.length ? { source: 'terminal', themes, inferred } : null;
}

/** W3C design tokens, Style Dictionary output, Figma Tokens exports. */
function fromDesignTokens(json, name) {
  const pairs = flattenTokens(json);
  if (!pairs.length) return null;
  const roles = inferRoles(pairs);
  const inferred = [...roles.inferred];
  const radius = readLength(findRaw(pairs, ['radius', 'border-radius', 'radius-md', 'corner-radius']));
  const candidate = candidateFrom({
    palette: roles.palette,
    inferred,
    name: typeof json.name === 'string' ? json.name : name,
    extras: { radius },
  });
  return candidate ? { source: 'dtcg', themes: [candidate], inferred } : null;
}

/**
 * An accent out of the colours a file named but we had no role for.
 *
 * Names first, in the order `ROLE_NAMES.accent` lists them, so a file that says `primary`
 * gets its primary rather than whatever happens to be most saturated. Only when nothing is
 * recognisably named does it come down to looking at the colours themselves.
 *
 * @param {Array<[string, string]>} spare `[name, colour]` pairs left over
 * @returns {{colour:string, why:string}|null}
 */
function pickAccent(spare, palette) {
  const byTail = new Map();
  for (const [rawName, value] of spare) {
    const name = normaliseName(rawName);
    if (namesAState(name)) continue;
    const segments = withoutVariant(name).split('-').filter(Boolean);
    const tail = segments[segments.length - 1];
    if (tail && !byTail.has(tail)) byTail.set(tail, value);
  }

  for (const candidate of ROLE_NAMES.accent) {
    const value = byTail.get(candidate);
    if (value && roleUsable('accent', value, palette)) {
      return { colour: value, why: `--${candidate}, the accent the file named being unusable` };
    }
  }

  const colourful = mostColourful(spare, palette.background);
  return colourful ? { colour: colourful, why: 'the most colourful thing in the file' } : null;
}

/**
 * The most saturated colour in the file that would read against the page.
 *
 * State colours are skipped by name: a danger red is the most colourful thing in plenty of
 * files and is never the brand. Near-greys are skipped because a theme whose accent is
 * grey has no accent, and anything that fails a 3:1 contrast against the ground is skipped
 * because an accent is for links and fills, which have to be seen.
 */
function mostColourful(pairs, background) {
  const ground = parseColor(background);
  if (!ground) return null;

  let best = null;
  for (const [rawName, value] of pairs) {
    if (rawName.toLowerCase().split('-').some((segment) => STATE_SEGMENT.has(segment))) continue;
    const colour = parseColor(value);
    if (!colour || colour.a < 0.9) continue;
    const { s } = rgbToHsl(colour);
    if (s < 0.2) continue;
    if (contrastRatio(colour, ground) < 3) continue;
    if (!best || s > best.saturation) best = { saturation: s, value };
  }
  return best?.value ?? null;
}

/**
 * A theme out of a JSON file that belongs to no format at all.
 *
 * The same three steps as every other reader — gather `[name, colour]` pairs, match them
 * to roles, complete what is missing — differing only in how loosely the pairs are found.
 */
function fromLooseJson(json, name) {
  const pairs = looseColours(json, [], [], OTHER_MODE[declaredMode(json)] ?? null);
  if (pairs.length < MIN_LOOSE_COLOURS) return null;
  const roles = inferRoles(pairs);
  const inferred = [...roles.inferred];

  // A file that names a dozen colours has a brand colour somewhere among them, whatever it
  // called them. Without this the fallback makes the accent the body text, and a theme
  // built out of forest, moss, blossom and sky comes out monochrome — which is not a
  // cautious reading of the file so much as a wrong one.
  if (!roles.palette.accent && roles.palette.background) {
    const guess = mostColourful(pairs, roles.palette.background);
    if (guess) {
      roles.palette.accent = guess;
      inferred.push('accent ← the most colourful thing in the file, none being named as one');
    }
  }
  const titled = json?.name ?? json?.theme?.name;
  const candidate = candidateFrom({
    palette: roles.palette,
    inferred,
    name: typeof titled === 'string' && titled.trim() ? titled : name,
  });
  if (!candidate) return null;

  // The file's own blocks are carried through underneath the candidate, so the reader that
  // knows how to translate them still gets to see them. Without this a file rescued by its
  // colours arrives with nothing else: no radius, no fonts, no materials, no gradient —
  // everything it said about how it should look, discarded on the way in.
  const inner = json?.theme && typeof json.theme === 'object' ? json.theme : json;
  return { source: 'json', themes: [{ ...inner, ...candidate }], inferred };
}

// ─── Entry point ────────────────────────────────────────────────────────────

/**
 * Reads a theme file some other tool wrote.
 *
 * @param {string} text the pasted or dropped file
 * @param {{name?: string, themeColor?: string|null}} options a fallback name, usually from
 *   the filename or host, and the `<meta name="theme-color">` of the page it came from
 * @returns {{source: string, themes: object[], inferred: string[]}|null} candidates for
 *   `normaliseTheme` — never validated themes, and never to be used without it
 */
export function adaptForeignThemes(text, { name = 'Imported theme', themeColor = null } = {}) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  const format = sniffFormat(raw);
  if (!format || format === 'webin') return null;

  const json = parseJsonish(raw);

  switch (format) {
    case 'vscode': return fromVsCode({ ...json, colors: vsCodeColours(json, raw) }, name);
    case 'base16': return fromBase16(json ?? raw, name);
    case 'terminal': return fromTerminal(json, name);
    case 'dtcg': return fromDesignTokens(json, name);
    case 'css-vars': return readStyles(json ?? raw, name, themeColor);
    case 'json': return fromLooseJson(json, name);
    case 'stylesheet': return themeFromWebsite(raw, { name, themeColor });
    case 'html': return fromHtml(raw, name, themeColor);
    default: return null;
  }
}

/**
 * A stylesheet, read both ways.
 *
 * A file of custom properties is a theme written down, and a file of rules is a theme
 * being used, and plenty of stylesheets are both. GitHub's palette exists only as
 * variables; Netflix's exists only as declarations. Running both readers and keeping the
 * better answer removes the need to know in advance which kind of file arrived.
 */
function readStyles(source, name, themeColor) {
  const tokens = fromCssVariables(source, name);
  if (typeof source !== 'string') return tokens;
  return betterOf(tokens, themeFromWebsite(source, { name, themeColor }));
}

/**
 * A whole web page.
 *
 * What the page carries inline is usually a fraction of its design — the rest is in the
 * stylesheets it links, which only the service worker can fetch. So this reads what is
 * there and the caller decides whether to go and get the rest; either way the page is
 * never handed to the token readers as raw markup, which would parse its HTML as
 * declarations.
 */
function fromHtml(raw, name, themeColor) {
  const page = readHtml(raw);
  if (!page.css.trim()) return null;
  return readStyles(page.css, name, themeColor ?? page.themeColor);
}

