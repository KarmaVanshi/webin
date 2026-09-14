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

import { parseColor, toCss, luminance } from './color.js';
import { adaptForeignThemes, completePalette } from './foreign-themes.js';
import { readDialect } from './theme-dialects.js';
import { normaliseRules, normaliseDetect, isGradient } from './theme-rules.js';
import { validateDeclaration } from './css-values.js';
import { ROLES } from './types.js';

/** Bumped only when an older file needs migrating. */
export const FORMAT_VERSION = 1;

/** How long a theme's name may be. Shown as a counter wherever one is typed. */
export const NAME_LIMIT = 42;

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
 * @property {Object<string, Object>} materials Named surface treatments a role may ask for.
 * @property {Object<string, string>} roles     Structural role -> material name.
 * @property {Object} states                    Hover, press and focus amounts.
 * @property {Array<{target:string|null, selector:string|null, state:string|null,
 *             media:string|null, properties:Object<string,string>}>} rules
 *   Declarations against a target or a selector of the theme's own. See theme-rules.js.
 * @property {Object<string, string>} detect   Target -> selector list that also finds it.
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
 * Other names a theme may have given a role, tried before the role is derived.
 *
 * A file that calls its raised plane `glass` has not left the surface out; it has called
 * it what the design calls it. Reading the name it used keeps the real colour instead of
 * falling back to a computed approximation of it.
 */
const PALETTE_ALIASES = {
  // Not `background` and not `text`: those two decide whether a file is a Webin theme at
  // all, and a file that spells them `canvas` and `ink` is read by the loose-JSON importer,
  // which works the roles out and says what it guessed. The rest are free to be generous.
  surface: ['glass', 'card', 'panel', 'paper', 'elevated', 'raised', 'surfaceAlt', 'cardBackground',
    'secondary', 'muted'],
  textMuted: ['textSecondary', 'textSubtle', 'mutedInk', 'inkMuted', 'mutedText', 'secondaryText',
    'textTertiary', 'muted', 'subtle'],
  accent: ['primary', 'brand', 'accentColor', 'primaryColor', 'brandColor', 'link', 'highlight'],
  onAccent: ['accentText', 'onPrimary', 'onBrand', 'buttonText', 'primaryForeground'],
  border: ['borderSoft', 'borderColor', 'divider', 'line', 'rule', 'hairline', 'stroke', 'outline'],
};

/**
 * Blocks a palette may be written in, most authoritative first.
 *
 * `palette` is our own spelling. `colors` is what almost everything else uses — every
 * hand-written theme, and every one an assistant generates. Reading only the first of
 * those was rejecting files whose colours were sitting right there under the other name,
 * with an error that said the theme had no colours at all.
 *
 * The theme object itself comes last, for the flat form: a file that writes `background`
 * and `text` directly on the theme has still named its palette, just without a block to
 * put it in. Anything at those keys that is not a colour — a `surface: { ... }` block of
 * its own, say — simply fails to parse and is passed over.
 */
const PALETTE_BLOCKS = ['palette', 'colors', 'colours'];

/**
 * How opaque a colour must be to serve as the page's canvas.
 *
 * A see-through canvas is not a canvas. `transparent` is how a hand-written theme says
 * "let what is behind show through", but a page has nothing behind it: the theme paints
 * no ground, the site's own background stays exactly where it was, and then the
 * readability guard — asked for ink that reads against a colour with no substance —
 * flips the text to black on a page that never changed. The same goes for the barely
 * there whites a glass theme uses for its surfaces, which are surfaces, not grounds.
 *
 * The threshold is the engine's own definition of an opaque background, so the format and
 * the walk agree on what counts as something to read text against.
 */
const CANVAS_MIN_ALPHA = 0.9;

/**
 * Blobs one backdrop may carry.
 *
 * Four is what a gradient of this kind actually uses, and it keeps the rendered value
 * inside the length the panel's own CSS guard allows for one declaration.
 */
const BACKDROP_BLOBS = 4;

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
  backdrop: null,      // {base, blobs[], css[]} gradient painted behind the page (glass themes)
  transition: null,    // a `transition` value for surfaces and chrome, e.g. "all 0.2s ease"
  shadowCss: null,     // the theme's shadow as the file wrote it, or "none"; replaces the kind's
  saturate: null,      // %, saturation in the backdrop filter beside the blur
  brighten: null,      // %, brightness in the backdrop filter beside the blur
  sheen: null,         // a gradient drawn over every surface, as the file wrote it
});

/**
 * A shadow a file wrote out, kept whole. `none` is kept too — it is the file saying there
 * is no shadow, which the engine's default would otherwise contradict.
 */
function shadowValue(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim().replace(/\s+/g, ' ');
  if (/^none$/i.test(raw)) return 'none';
  if (!/\d/.test(raw)) return null;
  const checked = validateDeclaration('box-shadow', raw);
  return checked.ok ? checked.value : null;
}

/** A gradient a file drew over its surfaces, checked the way every gradient is. */
function sheenValue(value) {
  return typeof value === 'string' && isGradient(value.trim()) ? value.trim() : null;
}

/**
 * What a transition may be made of: times, easings, property names, a cubic-bezier.
 * Nothing in that language can close a declaration or start a fetch.
 */
const TRANSITION_SAFE = /^[\w\s.,()-]{1,80}$/;

function transition(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim().replace(/\s+/g, ' ');
  if (!TRANSITION_SAFE.test(raw) || !/\d\s*m?s\b/.test(raw)) return null;
  // `0.2s ease` names no property, and means all of them.
  return /^[\d.]/.test(raw) ? `all ${raw}` : raw;
}

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

/**
 * A colour fit to be the page's ground, or null. See `CANVAS_MIN_ALPHA`.
 */
function canvasColour(value) {
  const parsed = parseColor(value);
  return parsed && parsed.a >= CANVAS_MIN_ALPHA ? toCss(parsed) : null;
}

/**
 * The gradient painted behind a glass theme, as data rather than as CSS.
 *
 * This used to be a raw CSS string, which meant it could only ever be honoured from a
 * preset the extension shipped: the value goes verbatim into a stylesheet injected on
 * every page, so a shared file was one `url()` away from being a tracking beacon and one
 * `}` away from writing its own rules into somebody else's site.
 *
 * Stored as a base colour and a handful of positioned blobs, none of that is reachable.
 * Every colour goes through the parser, every number is clamped, and the engine writes
 * the CSS itself — so a backdrop from a stranger's file is exactly as safe as one of
 * ours, and the trust flag no longer has anything to do with it.
 */
function backdrop(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const base = canvasColour(raw.base);

  // A gradient the file wrote out in full is kept whole. It is checked structurally —
  // gradient functions and nothing else, over the charset every value passes — which is
  // what makes a written gradient exactly as safe as a list of blobs.
  const css = (Array.isArray(raw.css) ? raw.css : [])
    .filter((layer) => typeof layer === 'string' && isGradient(layer))
    .slice(0, 3);
  if (!base && !css.length) return null;

  const blobs = [];
  const list = Array.isArray(raw.blobs) ? raw.blobs.slice(0, BACKDROP_BLOBS) : [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const color = colour(entry.color);
    if (!color) continue;
    blobs.push({
      color,
      x: num(entry.x, 0, 100, 50),
      y: num(entry.y, 0, 100, 50),
      size: num(entry.size, 5, 200, 60),
    });
  }
  // A base the block did not name is filled in from the palette by `normaliseTheme`.
  return css.length ? { base, blobs, css } : { base, blobs };
}

/**
 * The same colour with its alpha taken to nothing.
 *
 * Spelled out rather than left as the keyword: `transparent` in a gradient stop is
 * transparent *black*, so a blob faded out that way picks up a grey halo on its way to
 * nothing. Fading to the colour's own zero-alpha form is what makes the edge invisible.
 */
function fadeOut(value) {
  const c = parseColor(value);
  return c ? `rgba(${c.r}, ${c.g}, ${c.b}, 0)` : 'rgba(0, 0, 0, 0)';
}

/**
 * Renders a validated backdrop to the CSS `background` value it stands for.
 *
 * Shared by the engine, which paints it on the page, and the panel, which paints it into
 * a preview swatch — one function so the two can never drift.
 *
 * @param {{base:string, blobs:Array<{color:string,x:number,y:number,size:number}>}|null} value
 * @returns {string|null}
 */
export function backdropCss(value) {
  if (!value || typeof value !== 'object' || typeof value.base !== 'string') return null;
  const blobs = Array.isArray(value.blobs) ? value.blobs : [];
  // Gradients the file wrote out go on top, in the order it wrote them: an overlay first,
  // then the main gradient. They were checked when the theme was read; the check is
  // repeated here only because a stored theme is untrusted the moment it is read back.
  const written = (Array.isArray(value.css) ? value.css : []).filter(isGradient);
  const layers = blobs.map((b) => `radial-gradient(${b.size}% ${b.size}% at ${b.x}% ${b.y}%, `
    + `${b.color} 0%, ${fadeOut(b.color)} 60%)`);
  // The blobs go over the written gradient: they fade to nothing at their edges, so they
  // show through, whereas a written gradient is usually opaque and would hide them.
  return [...layers, ...written, value.base].join(', ');
}

function slug(value) {
  const raw = String(value ?? '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 48);
  return raw || null;
}

/**
 * How many named materials one theme may carry.
 *
 * Enough for every role to have one of its own plus a shared set to draw from. Eight was
 * cutting real files off partway: a theme that gives its nav, header, footer, sidebar,
 * modal, popover, button, field and table each a treatment has nine before it has named a
 * single shared material, and the ones past the limit were dropped silently — which reads,
 * on the page, as the last few kinds of chrome simply not being themed.
 */
const MATERIAL_LIMIT = 24;

/**
 * One named surface treatment: the same five levers `effects` already pulls, gathered
 * under a name so a role can ask for it.
 *
 * Every field is optional and every one that is left out falls back to the theme's own
 * `effects`, so a material is a difference from the theme rather than a replacement for
 * it — `{ blur: 40 }` is a legible way to say "a modal, but blurrier".
 */
function material(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  const borderWidth = num(raw.borderWidth, 0, 8);
  const blur = num(raw.blur, 0, 40);
  const surfaceAlpha = num(raw.surfaceAlpha, 0.02, 1);
  const radius = num(raw.radius, 0, 60);
  if (borderWidth != null) out.borderWidth = borderWidth;
  if (blur != null) out.blur = blur;
  if (surfaceAlpha != null) out.surfaceAlpha = surfaceAlpha;
  if (radius != null) out.radius = radius;
  if (SHADOW_KINDS.includes(raw.shadow)) out.shadow = raw.shadow;
  return Object.keys(out).length ? out : null;
}

/** The theme's named materials, as a plain object. */
function materials(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  for (const [name, value] of Object.entries(raw).slice(0, MATERIAL_LIMIT)) {
    const key = slug(name);
    const parsed = material(value);
    if (key && parsed) out[key] = parsed;
  }
  return out;
}

/**
 * Which material each structural role is made of.
 *
 * A role that names a material the theme does not have is dropped rather than guessed at,
 * and a name outside `ROLES` is not a role at all — that is the whole point of the fixed
 * vocabulary, and the line an imported file cannot talk its way across.
 */
function roles(raw, available) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  for (const role of ROLES) {
    const name = slug(raw[role]);
    if (name && Object.hasOwn(available, name)) out[role] = name;
  }
  return out;
}

const STATE_DEFAULTS = Object.freeze({
  lift: null,    // 0-0.4, how much lighter (or darker) a surface goes under the pointer
  border: null,  // 0-0.6, how much its edge strengthens with it
  scale: null,   // 0.9-1.1, the nudge on hover
  press: null,   // 0.9-1.1, the nudge while held
  ring: null,    // px, focus ring width
});

/**
 * Hover, press and focus, as numbers rather than as declarations.
 *
 * Both of the shapes this was drawn from wrote these as raw CSS — a `transform`, a
 * `box-shadow`, a `transition` string. Stored as clamped amounts, the engine composes the
 * same effects out of the theme's own palette, and none of it can carry anything but a
 * number.
 */
function states(raw) {
  if (!raw || typeof raw !== 'object') return { ...STATE_DEFAULTS };
  return {
    lift: num(raw.lift, 0, 0.4),
    border: num(raw.border, 0, 0.6),
    scale: num(raw.scale, 0.9, 1.1),
    press: num(raw.press, 0.9, 1.1),
    ring: num(raw.ring, 0, 8),
  };
}

/**
 * Rebuilds a theme from untrusted input, or returns null when it is not salvageable.
 *
 * "Salvageable" means the palette parses. Everything else has a sane default, because a
 * shared theme that is merely missing its density should still work.
 *
 * @param {unknown} raw
 * @param {{trusted?:boolean, inferred?:string[]}} options `trusted` is for presets the
 *   extension ships, which are the only themes allowed to declare themselves built-in
 *   rather than the user's. `inferred`, when given, is filled with whatever had to be
 *   worked out rather than read — so the preview can show it before anything is saved.
 * @returns {Theme|null}
 */
export function normaliseTheme(raw, { trusted = false, inferred = null } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw.theme && typeof raw.theme === 'object' ? raw.theme : raw;

  // Read what the file actually names, and let the rest be worked out.
  //
  // This used to demand all seven roles and refuse the theme over any one of them, which
  // was both stricter than the error it printed — "at least a background and a text
  // colour" — and stricter than the importer for everybody else's formats, which has
  // always completed a partial palette rather than turning it away. The gap showed up on
  // hand-written files: a glass theme names its raised plane `glass`, a flat one names it
  // `card`, and neither of them is a theme with no surface. Only the background and the
  // text are genuinely irreplaceable; everything else can be derived from those two, and
  // the same function derives it here as on the foreign path.
  //
  // The palette is also looked for under more than one name. See `PALETTE_BLOCKS`.
  const blocks = [];
  for (const key of PALETTE_BLOCKS) {
    const block = source[key];
    if (block && typeof block === 'object') blocks.push(block);
  }
  blocks.push(source);

  // First colour found for a role wins, blocks in order: the file that calls a block
  // `palette` is the more deliberate about it than one that happens to have a matching
  // key on the theme itself.
  const pick = (names, read) => {
    for (const block of blocks) {
      for (const name of names) {
        const value = read(block[name]);
        if (value) return value;
      }
    }
    return null;
  };

  const named = {};
  for (const key of PALETTE_KEYS) {
    const names = [key, ...(PALETTE_ALIASES[key] ?? [])];
    // The canvas is the one role with a floor on its opacity; everything else, surfaces
    // very much included, is free to be as see-through as the design wants.
    const value = pick(names, key === 'background' ? canvasColour : colour);
    if (value) named[key] = value;
  }

  const rawEffects = source.effects && typeof source.effects === 'object' ? source.effects : {};

  // Everything the file said in its own vocabulary. Read before the palette is completed,
  // because a gradient the file describes under some other name is still this theme's
  // ground, and its base is what fills a canvas the palette never named.
  const dialect = readDialect(source);
  const painted = backdrop(rawEffects.backdrop) ?? backdrop(dialect.effects?.backdrop);
  // A theme whose ground is a backdrop has named its canvas after all: it is the base the
  // gradient is painted over. Glass themes write `transparent` for the background and
  // mean precisely this, and refusing them for it would be reading the letter over the
  // intent — the base is a real, opaque colour, and it is what ends up behind the text.
  if (!named.background && painted?.base) named.background = painted.base;

  // Everything else the palette blocks named. A theme file lists far more colours than the
  // seven roles use — `primary`, `secondary`, `accentWarm`, half a paint chart — and those
  // leftovers are the only place to look when the role we wanted turns out unusable.
  const spare = [];
  for (const block of blocks) {
    for (const [key, value] of Object.entries(block)) {
      if (typeof value === 'string' && parseColor(value)) spare.push([key, value]);
    }
  }

  // The file's own `dark` is a better answer than anything read off the colours, when it
  // is there: a theme that says it is dark and names no canvas wants a dark one.
  const completed = completePalette(named, inferred ?? [], {
    prefersDark: source.dark === true ? true : null,
    spare,
  });
  if (!completed) return null;
  const palette = completed.palette;
  // The other way round: a gradient written without a base is painted over the canvas.
  if (painted && !painted.base) painted.base = palette.background;

  // Our own spelling wins wherever the file used it; the dialect fills in everything the
  // file said in its own words. Both go through the same validators below.
  const said = dialect.effects ?? {};
  const effects = { ...EFFECT_DEFAULTS };
  effects.borderWidth = num(rawEffects.borderWidth ?? said.borderWidth, 0, 8);
  effects.blur = num(rawEffects.blur ?? said.blur, 0, 40);
  effects.surfaceAlpha = num(rawEffects.surfaceAlpha ?? said.surfaceAlpha, 0.02, 1);
  effects.gradient = rawEffects.gradient === true || said.gradient === true;
  effects.noise = rawEffects.noise === true || said.noise === true;
  effects.glow = rawEffects.glow === true || said.glow === true;
  effects.uppercase = rawEffects.uppercase === true || said.uppercase === true;
  effects.tracking = num(rawEffects.tracking ?? said.tracking, -0.1, 0.4);
  effects.weight = num(rawEffects.weight ?? said.weight, 100, 900);
  effects.backdrop = painted;
  effects.transition = transition(rawEffects.transition) ?? transition(said.transition);
  effects.shadowCss = shadowValue(rawEffects.shadowCss) ?? shadowValue(said.shadowCss);
  effects.saturate = num(rawEffects.saturate ?? said.saturate, 0, 300);
  effects.brighten = num(rawEffects.brighten ?? said.brighten, 0, 300);
  effects.sheen = sheenValue(rawEffects.sheen) ?? sheenValue(said.sheen);

  // A border the file wants partly see-through: its opacity is applied to the palette's
  // edge colour, where the engine reads it from.
  const borderOpacity = num(rawEffects.borderOpacity ?? said.borderOpacity, 0, 1);
  if (borderOpacity != null && borderOpacity < 1) {
    const edge = parseColor(palette.border);
    if (edge && edge.a === 1) palette.border = `rgba(${edge.r}, ${edge.g}, ${edge.b}, ${borderOpacity})`;
  }

  const made = materials({ ...dialect.materials, ...source.materials });

  // Everything the file said about each kind of element, and every selector it named —
  // read by the dialect, validated here, and folded so a target has one rule per state.
  // Nothing in a rule skips the gate: see `normaliseRule`.
  const rules = normaliseRules(dialect.rules);
  const detect = normaliseDetect(dialect.detect);

  return {
    id: slug(source.id) ?? `t-${Math.random().toString(36).slice(2, 9)}`,
    name: text(source.name, NAME_LIMIT) || 'Untitled theme',
    description: text(source.description, 120),
    dark: source.dark === true,
    palette,
    radius: num(source.radius, 0, 60) ?? num(dialect.radius, 0, 60),
    density: num(source.density, 0.6, 2, 1) ?? 1,
    fontFamily: font(source.fontFamily) ?? font(dialect.fontFamily),
    displayFamily: font(source.displayFamily) ?? font(dialect.displayFamily),
    shadow: SHADOW_KINDS.includes(source.shadow) ? source.shadow
      : (SHADOW_KINDS.includes(dialect.shadow) ? dialect.shadow : 'soft'),
    effects,
    materials: made,
    roles: roles({ ...dialect.roles, ...source.roles }, made),
    states: states({ ...dialect.states, ...source.states }),
    rules,
    detect,
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
      materials: theme.materials,
      roles: theme.roles,
      states: theme.states,
      rules: theme.rules ?? [],
      detect: theme.detect ?? {},
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
export function parseThemeInput(input, decoded = null, { name = 'Imported theme', themeColor = null } = {}) {
  const text = String(input ?? '').trim();
  const raw = decoded ?? tryJson(text);

  if (raw) {
    const list = Array.isArray(raw?.themes) ? raw.themes : [raw];
    // Collected for a single theme only. A collection of twenty would produce a heap of
    // notes belonging to no one theme in particular, which tells the reader nothing.
    const notes = list.length === 1 ? [] : null;
    // A file this reader cannot make a theme of is handed on whole, variants and all: the
    // other readers work its palette out and the variants are taken from what they make.
    const themes = list.flatMap((entry) => {
      const main = normaliseTheme(entry, { inferred: notes });
      return main ? [main, ...modeVariants(entry).map((variant) => normaliseTheme(variant))] : [];
    }).filter(Boolean);
    if (themes.length) return { themes, error: null, source: 'webin', inferred: notes ?? [] };
  }

  const foreign = adaptForeignThemes(text, { name, themeColor });
  if (foreign) {
    const themes = foreign.themes.flatMap((candidate) => [
      normaliseTheme(candidate),
      ...modeVariants(candidate).map((variant) => normaliseTheme(variant)),
    ]).filter(Boolean);
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
      + 'a VS Code theme, a base16 scheme — or the address of a website to take its design from.',
  };
}

/** Where a file keeps the other modes it carries, and what it calls one at the top level. */
const MODE_BLOCKS = ['special', 'modes', 'variants', 'schemes', 'alternates'];
const MODE_KEY = /^([a-z]+?)(mode|scheme|theme|variant)$/i;

/** Most variants one file may add beside its main theme. */
const VARIANT_LIMIT = 3;

/**
 * The other modes a file carries, each as a theme of its own.
 *
 * A theme file routinely describes its night beside its day — `special.nightMode`,
 * `modes.dark`, a `sunsetMode` — and that is not a note about this theme but a second
 * theme in the same file, which the importer already knows how to offer. Each variant is
 * the file with the mode's colours laid over its palette, or over the layers of its page
 * gradient where the mode names those instead (a sunset recolours the sky), and everything
 * else — its fonts, its cards, its buttons — exactly as the file said.
 *
 * @param {object} entry the theme as it arrived, envelope or not
 * @returns {object[]} raw variants, still to be normalised like anything else
 */
export function modeVariants(entry) {
  const source = entry?.theme && typeof entry.theme === 'object' ? entry.theme : entry;
  if (!source || typeof source !== 'object') return [];
  const out = [];

  const roleWords = new Map();
  for (const key of PALETTE_KEYS) {
    roleWords.set(key.toLowerCase(), key);
    for (const alias of PALETTE_ALIASES[key] ?? []) roleWords.set(alias.toLowerCase(), key);
  }
  const flat = (k) => String(k).toLowerCase().replace(/[\s_-]+/g, '');

  // The layers of the page gradient, by the kind of thing each says it is.
  const ground = [source.background, source.backgroundStyle, source.backdrop, source.canvas]
    .find((b) => b && typeof b === 'object');
  const layerKey = ground ? ['layers', 'atmosphere', 'blobs', 'orbs', 'glows', 'lights'].find((k) => Array.isArray(ground[k])) : null;
  const layers = layerKey ? ground[layerKey] : [];
  const layerOf = (word) => layers.find((l) => l && typeof l === 'object' && typeof l.type === 'string'
    && (flat(l.type) === word || flat(l.type).startsWith(word) || word.startsWith(flat(l.type))));

  const candidates = [];
  for (const block of MODE_BLOCKS) {
    const holder = source[block];
    if (!holder || typeof holder !== 'object' || Array.isArray(holder)) continue;
    for (const [key, value] of Object.entries(holder)) candidates.push([key, value]);
  }
  for (const [key, value] of Object.entries(source)) if (MODE_KEY.test(key)) candidates.push([key, value]);

  for (const [key, value] of candidates) {
    if (out.length >= VARIANT_LIMIT) break;
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.enabled === false) continue;

    const roles = {};
    const recoloured = new Map();
    for (const [name, raw] of Object.entries(value)) {
      if (typeof raw !== 'string' || !parseColor(raw)) continue;
      const word = flat(name);
      const role = roleWords.get(word);
      if (role) { roles[role] = raw; continue; }
      const layer = layerOf(word);
      if (layer) recoloured.set(layer, raw);
    }
    if (!Object.keys(roles).length && !recoloured.size) continue;

    const mode = key.replace(MODE_KEY, '$1').replace(/[\s_-]+/g, ' ').trim() || key;
    const label = mode.charAt(0).toUpperCase() + mode.slice(1);
    const canvas = roles.background ? parseColor(roles.background) : null;
    const dark = /night|dark|midnight|dusk/i.test(mode) ? true
      : (/day|light|dawn|noon/i.test(mode) ? false
        : (canvas ? luminance(canvas) < 0.3 : source.dark === true));

    const variant = {
      ...source,
      id: slug(source.id) ? `${slug(source.id)}-${slug(mode)}` : undefined,
      name: `${text(source.name, NAME_LIMIT - label.length - 3) || 'Untitled theme'} — ${label}`,
      dark,
      palette: { ...(source.palette && typeof source.palette === 'object' ? source.palette : {}), ...roles },
    };
    // The mode's own background is the ground its gradient is painted over, too.
    if (recoloured.size || roles.background) {
      variant[layerKey ? ['background', 'backgroundStyle', 'backdrop', 'canvas'].find((k) => source[k] === ground) : null] = ground && layerKey
        ? { ...ground, ...(roles.background ? { base: roles.background } : {}),
          [layerKey]: layers.map((l) => (recoloured.has(l) ? { ...l, color: recoloured.get(l) } : l)) }
        : ground;
    }
    delete variant[undefined];
    for (const block of MODE_BLOCKS) delete variant[block];
    for (const [k] of candidates) if (MODE_KEY.test(k)) delete variant[k];
    out.push(variant);
  }
  return out;
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
