/**
 * The theme file format: one schema, one validator, one pair of codecs.
 *
 * A theme is the only thing this extension saves, and — because themes are meant to be
 * shared — it is also the only untrusted input it accepts. Everything that arrives from
 * outside (a pasted share code, a dropped `.json`, a theme from a friend) is rebuilt from
 * scratch here field by field: unknown keys are dropped, colours must parse, numbers are
 * clamped, and font stacks are matched against a conservative character set.
 *
 * That last one is not paranoia. Theme values end up inside a stylesheet that the
 * extension injects into every page, so an unchecked font family is a CSS injection with
 * extra steps.
 */

import { parseColor, toCss } from './color.js';
import { adaptForeignThemes } from './foreign-themes.js';

/** Bumped only when an older file needs migrating. */
export const FORMAT_VERSION = 1;

const SHARE_PREFIX = 'webin:1:';
const SHARE_PREFIX_Z = 'webin:1z:';

/**
 * @typedef {Object} Theme
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {boolean} dark
 * @property {{background:string, surface:string, text:string, textMuted:string,
 *             accent:string, onAccent:string, border:string}} palette
 * @property {number|null} radius     Target corner radius in px.
 * @property {number} density         Multiplier applied to the page's padding rhythm.
 * @property {string|null} fontFamily Body font stack.
 * @property {string|null} displayFamily Heading font stack.
 * @property {string} shadow          One of SHADOW_KINDS.
 * @property {Object} effects
 * @property {string|null} author
 * @property {boolean} custom         True for anything not shipped with the extension.
 */

/** Surface treatments a theme can ask for. Rendering lives in the engine. */
export const SHADOW_KINDS = Object.freeze([
  'none',   // flat design, swiss
  'soft',   // ordinary modern elevation
  'sharp',  // thin, tight drop
  'hard',   // offset block shadow (bauhaus, brutalism)
  'deep',   // layered realistic depth (skeuomorphism)
  'neu',    // dual light/dark soft shadow (neumorphism)
  'glass',  // translucent edge + backdrop blur
  'glow',   // neon bloom
]);

const PALETTE_KEYS = ['background', 'surface', 'text', 'textMuted', 'accent', 'onAccent', 'border'];

/**
 * Font stacks are the one free-text value that reaches CSS, so they take the strictest
 * check in the file: letters, digits, spaces, quotes, commas and hyphens only. That
 * admits every real family name and admits nothing that can close a declaration.
 */
const FONT_SAFE = /^[\w\s,'"-]{1,160}$/;

/** Control characters have no business in a name and would break the panel's layout. */
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;

const EFFECT_DEFAULTS = Object.freeze({
  borderWidth: null,   // px, forced on stamped surfaces
  blur: null,          // px, backdrop blur for translucent surfaces
  surfaceAlpha: null,  // 0-1, translucency of surfaces
  gradient: false,     // sheen gradient on surfaces
  noise: false,        // grain texture over the canvas
  glow: false,         // accent bloom
  uppercase: false,    // uppercase headings
  tracking: null,      // heading letter-spacing in em, -0.1 to 0.4
  weight: null,        // heading font-weight
  backdrop: null,      // CSS gradient painted behind the page (glass themes)
});

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/** Numbers arrive as strings from JSON written by hand; null means "not set". */
function num(value, lo, hi, fallback = null) {
  const n = typeof value === 'number' ? value : Number.parseFloat(value);
  if (!Number.isFinite(n)) return fallback;
  return clamp(n, lo, hi);
}

function text(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(CONTROL_CHARS, '').trim().slice(0, max);
}

function font(value) {
  const raw = text(value, 160);
  if (!raw || !FONT_SAFE.test(raw)) return null;
  return raw;
}

/** A colour is only accepted if the parser understands it; the output is normalised. */
function colour(value) {
  const parsed = parseColor(value);
  return parsed ? toCss(parsed) : null;
}

function slug(value) {
  const raw = String(value ?? '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 48);
  return raw || null;
}

/**
 * Rebuilds a theme from untrusted input, or returns null when it is not salvageable.
 *
 * "Salvageable" means the palette parses. Everything else has a sane default, because a
 * shared theme that is merely missing its density should still work.
 *
 * @param {unknown} raw
 * @param {{trusted?:boolean}} options `trusted` is for presets the extension ships, which
 *   are allowed to carry raw CSS backdrops and to declare themselves built-in.
 * @returns {Theme|null}
 */
export function normaliseTheme(raw, { trusted = false } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw.theme && typeof raw.theme === 'object' ? raw.theme : raw;

  const palette = {};
  for (const key of PALETTE_KEYS) {
    const value = colour(source.palette?.[key]);
    if (!value) {
      // Two are recoverable: a theme without them is still usable.
      if (key === 'onAccent') { palette[key] = '#ffffff'; continue; }
      if (key === 'border') { palette[key] = null; continue; }
      return null;
    }
    palette[key] = value;
  }
  palette.border ??= palette.textMuted;

  const effects = { ...EFFECT_DEFAULTS };
  const rawEffects = source.effects && typeof source.effects === 'object' ? source.effects : {};
  effects.borderWidth = num(rawEffects.borderWidth, 0, 8);
  effects.blur = num(rawEffects.blur, 0, 40);
  effects.surfaceAlpha = num(rawEffects.surfaceAlpha, 0.02, 1);
  effects.gradient = rawEffects.gradient === true;
  effects.noise = rawEffects.noise === true;
  effects.glow = rawEffects.glow === true;
  effects.uppercase = rawEffects.uppercase === true;
  effects.tracking = num(rawEffects.tracking, -0.1, 0.4);
  effects.weight = num(rawEffects.weight, 100, 900);
  // A backdrop is raw CSS, so it is only honoured from a preset the extension shipped.
  effects.backdrop = trusted && typeof rawEffects.backdrop === 'string' ? rawEffects.backdrop : null;

  return {
    id: slug(source.id) ?? `t-${Math.random().toString(36).slice(2, 9)}`,
    name: text(source.name, 42) || 'Untitled theme',
    description: text(source.description, 120),
    dark: source.dark === true,
    palette,
    radius: num(source.radius, 0, 60),
    density: num(source.density, 0.6, 2, 1) ?? 1,
    fontFamily: font(source.fontFamily),
    displayFamily: font(source.displayFamily),
    shadow: SHADOW_KINDS.includes(source.shadow) ? source.shadow : 'soft',
    effects,
    author: text(source.author, 40) || null,
    custom: trusted ? source.custom === true : true,
  };
}

/** The on-disk / on-clipboard form. Compact but still readable when opened in an editor. */
export function themeToFile(theme) {
  return {
    format: 'webin-theme',
    version: FORMAT_VERSION,
    theme: {
      id: theme.id,
      name: theme.name,
      description: theme.description,
      dark: theme.dark,
      palette: theme.palette,
      radius: theme.radius,
      density: theme.density,
      fontFamily: theme.fontFamily,
      displayFamily: theme.displayFamily,
      shadow: theme.shadow,
      effects: theme.effects,
      author: theme.author,
    },
  };
}

/** A backup of everything the user has made. */
export function collectionToFile(themes) {
  return {
    format: 'webin-collection',
    version: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    themes: themes.map((t) => themeToFile(t).theme),
  };
}

/**
 * Reads whatever the user pasted or dropped.
 *
 * Three things can arrive here: one of our own theme files or collections, a share code
 * (decoded first, since that is async, and handed in as `decoded`), or a theme some other
 * tool wrote — a shadcn `:root` block, a VS Code colour theme, a base16 scheme, a
 * design-token export.
 *
 * The foreign path is deliberately last and deliberately narrow. An adapter only ever
 * produces a *candidate* object, which comes straight back through `normaliseTheme` here,
 * so a CSS file from the internet is validated by exactly the same code as a share code
 * from a friend. Nothing skips the gate.
 *
 * `source` and `inferred` are for the UI: a theme that had to be guessed at should be
 * shown to the user before it is saved, along with what was guessed.
 *
 * @returns {{themes:Theme[], error:string|null, source:string, inferred:string[]}}
 */
export function parseThemeInput(input, decoded = null, { name = 'Imported theme' } = {}) {
  const text = String(input ?? '').trim();
  const raw = decoded ?? tryJson(text);

  if (raw) {
    const list = Array.isArray(raw?.themes) ? raw.themes : [raw];
    const themes = list.map((entry) => normaliseTheme(entry)).filter(Boolean);
    if (themes.length) return { themes, error: null, source: 'webin', inferred: [] };
  }

  const foreign = adaptForeignThemes(text, { name });
  if (foreign) {
    const themes = foreign.themes.map((candidate) => normaliseTheme(candidate)).filter(Boolean);
    if (themes.length) {
      return { themes, error: null, source: foreign.source, inferred: foreign.inferred };
    }
  }

  const empty = { themes: [], source: 'none', inferred: [] };
  if (raw || foreign) {
    return { ...empty, error: 'That theme is missing colours Webin needs — at least a background and a text colour.' };
  }
  return {
    ...empty,
    error: 'Webin could not read that. Paste a share code, a .webin.json file, a CSS :root block, '
      + 'a VS Code theme, or a base16 scheme.',
  };
}

function tryJson(value) {
  if (!value.startsWith('{') && !value.startsWith('[')) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/** True for anything that looks like a share code, so the UI can route it before parsing. */
export function isShareCode(value) {
  const trimmed = String(value ?? '').trim();
  return trimmed.startsWith(SHARE_PREFIX) || trimmed.startsWith(SHARE_PREFIX_Z);
}

/**
 * Encodes a theme as a single pasteable string.
 *
 * Deflate first when the platform has CompressionStream — a theme is repetitive JSON and
 * compresses to roughly a third — and fall back to plain base64 so a code can always be
 * produced. Both forms decode.
 */
export async function encodeShareCode(theme) {
  const json = JSON.stringify(themeToFile(theme));
  const bytes = new TextEncoder().encode(json);
  const deflated = await deflate(bytes);
  return deflated
    ? SHARE_PREFIX_Z + toBase64Url(deflated)
    : SHARE_PREFIX + toBase64Url(bytes);
}

/** @returns {object|null} the decoded file, or null when the code is not readable. */
export async function decodeShareCode(code) {
  const trimmed = String(code ?? '').trim().replace(/\s+/g, '');
  const compressed = trimmed.startsWith(SHARE_PREFIX_Z);
  if (!compressed && !trimmed.startsWith(SHARE_PREFIX)) return null;
  const body = trimmed.slice((compressed ? SHARE_PREFIX_Z : SHARE_PREFIX).length);
  try {
    const bytes = fromBase64Url(body);
    const plain = compressed ? await inflate(bytes) : bytes;
    if (!plain) return null;
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    return null;
  }
}

async function deflate(bytes) {
  if (typeof CompressionStream !== 'function') return null;
  try {
    return await pump(new CompressionStream('deflate-raw'), bytes);
  } catch {
    return null;
  }
}

async function inflate(bytes) {
  if (typeof DecompressionStream !== 'function') return null;
  try {
    return await pump(new DecompressionStream('deflate-raw'), bytes);
  } catch {
    return null;
  }
}

async function pump(transform, bytes) {
  const writer = transform.writable.getWriter();
  // A damaged payload rejects on the write side as well as the read side. The reader's
  // rejection is the one we act on, so the writer's is silenced rather than left to
  // surface as an unhandled rejection.
  const ignore = () => {};
  writer.write(bytes).catch(ignore);
  writer.close().catch(ignore);
  const chunks = [];
  const reader = transform.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
  return out;
}

/** Base64url keeps a code safe to paste into a chat window or a URL. */
export function toBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** A filename that will not collide and will not surprise. */
export function themeFileName(theme) {
  const base = theme.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'theme';
  return `${base}.webin.json`;
}
