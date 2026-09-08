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

import { parseColor, toCss, luminance, contrastRatio } from './color.js';

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
    'fg-muted', 'neutral-content', 'base-content-secondary', 'description', 'text-dim',
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
    'card', 'popover', 'panel', 'surface', 'base-200', 'base200', 'elevated', 'muted',
    'secondary', 'surface-1', 'sidebar-background', 'b2',
  ],
  text: [
    'foreground', 'text', 'base-content', 'basecontent', 'fg', 'ink', 'body-color',
    'on-background', 'on-surface', 'text-primary', 'editor-foreground', 'bc',
  ],
  accent: [
    'primary', 'brand', 'accent', 'link', 'interactive', 'action', 'p', 'a',
  ],
  border: [
    'border', 'outline', 'divider', 'base-300', 'base300', 'rule', 'stroke', 'separator',
    'border-color', 'b3',
  ],
};

/** Prefixes a token name may carry that say nothing about its role. */
const NOISE_PREFIX = /^(--)?(color|colors|colour|theme|clr|palette|token|tokens|ui)[-.]/;

/** Normalises `--color-base-100` and `color.base.100` to the same thing. */
function normaliseName(raw) {
  let name = String(raw ?? '').trim().toLowerCase().replace(/[._\s]+/g, '-');
  name = name.replace(/^-+/, '');
  let previous;
  do {
    previous = name;
    name = name.replace(NOISE_PREFIX, '');
  } while (name !== previous);
  return name.replace(/^-+|-+$/g, '');
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
 * What kind of file this is, from its content rather than its extension.
 *
 * People paste theme files into a textarea; there is no extension to go on, and a
 * `.json` that is really a VS Code theme and a `.json` that is really a base16 scheme
 * need different readers.
 */
export function sniffFormat(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;

  if (raw.startsWith('{') || raw.startsWith('[')) {
    let json;
    try {
      json = JSON.parse(raw);
    } catch {
      return null;
    }
    return sniffJson(json);
  }

  if (/base0[0-9a-f]\s*:/i.test(raw)) return 'base16';
  if (/--[\w-]+\s*:/.test(raw) || /@plugin\s+["']daisyui/.test(raw)) return 'css-vars';
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
function inferRoles(pairs) {
  const byName = new Map();
  for (const [rawName, rawValue] of pairs) {
    const colour = readColorValue(rawValue);
    if (!colour) continue;
    const name = normaliseName(rawName);
    if (!byName.has(name)) byName.set(name, colour);
  }

  const palette = {};
  const inferred = [];
  const claimed = new Set();

  for (const role of Object.keys(ROLE_NAMES)) {
    for (const candidate of ROLE_NAMES[role]) {
      if (claimed.has(candidate)) continue;
      const colour = byName.get(candidate);
      if (!colour) continue;
      palette[role] = colour;
      claimed.add(candidate);
      inferred.push(`${role} ← --${candidate}`);
      break;
    }
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
function completePalette(palette, inferred) {
  const has = (key) => typeof palette[key] === 'string';
  const note = (key, why) => { inferred.push(`${key} ← ${why}`); };

  if (!has('background') && has('surface')) { palette.background = palette.surface; note('background', 'surface'); }
  if (!has('surface') && has('background')) { palette.surface = palette.background; note('surface', 'background'); }
  if (!has('background') || !has('text')) return null;

  const dark = luminance(parseColor(palette.background)) < 0.35;

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

/** Linear blend, `t` of the way from `a` to `b`. */
function mixCss(a, b, t) {
  const from = parseColor(a);
  const to = parseColor(b);
  if (!from || !to) return a;
  const at = (k) => Math.round(from[k] + (to[k] - from[k]) * t);
  return toCss({ r: at('r'), g: at('g'), b: at('b'), a: 1 });
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

function fromVsCode(json, name) {
  const colors = json.colors ?? {};
  const palette = {};
  const inferred = [];
  for (const role of ROLES) {
    for (const key of VSCODE_MAP[role] ?? []) {
      const colour = readColorValue(colors[key]);
      if (colour) { palette[role] = colour; inferred.push(`${role} ← ${key}`); break; }
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

// ─── Entry point ────────────────────────────────────────────────────────────

/**
 * Reads a theme file some other tool wrote.
 *
 * @param {string} text the pasted or dropped file
 * @param {{name?: string}} options a fallback name, usually from the filename or host
 * @returns {{source: string, themes: object[], inferred: string[]}|null} candidates for
 *   `normaliseTheme` — never validated themes, and never to be used without it
 */
export function adaptForeignThemes(text, { name = 'Imported theme' } = {}) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  const format = sniffFormat(raw);
  if (!format || format === 'webin') return null;

  let json = null;
  if (raw.startsWith('{') || raw.startsWith('[')) {
    try {
      json = JSON.parse(raw);
    } catch {
      return null;
    }
  }

  switch (format) {
    case 'vscode': return fromVsCode(json, name);
    case 'base16': return fromBase16(json ?? raw, name);
    case 'terminal': return fromTerminal(json, name);
    case 'dtcg': return fromDesignTokens(json, name);
    case 'css-vars': return fromCssVariables(json ?? raw, name);
    default: return null;
  }
}
