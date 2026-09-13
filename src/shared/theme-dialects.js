/**
 * Reading the theme files people actually have.
 *
 * A generated theme file describes far more than seven colours. It names its materials,
 * says which blur and which corner radius each kind of element gets, gives its fonts, its
 * shadows, its hover and focus behaviour, and paints its page with a gradient — and it
 * does all of that in whatever words its author chose. `material` here is `surfaces`
 * there; `elements.navigation.material` is `navigation.background`; a blur is `28`, or
 * `"18px"`, or buried in `"blur(18px) saturate(145%)"`.
 *
 * Reading only the palette threw the rest away and rendered a rich file as a flat wash of
 * colour. This module translates those spellings into the one shape the format already
 * has. It reads; it does not trust — everything it produces is handed back through the
 * same validators as a hand-written theme, so a font stack is still checked, a colour
 * still has to parse, and every number is still clamped.
 */

import { parseColor } from './color.js';
import {
  readComponentRules, readChromeRules, readSelectorRules, readTransition, isGradient,
} from './theme-rules.js';

/** Blocks a file might keep its named materials in, most deliberate first. */
const MATERIAL_BLOCKS = ['materials', 'material', 'surfaces'];

/**
 * Element names, as files write them, against the roles the engine recognises.
 *
 * The vocabulary the engine matches on is fixed and small; this is the far longer list of
 * ways a file might spell one of those. A name absent here is simply not a role — which
 * is the same line as always, drawn once, in the one place a file's own words are read.
 */
const ROLE_WORDS = {
  nav: ['nav', 'navigation', 'navbar', 'menubar'],
  header: ['header', 'banner', 'topbar', 'masthead'],
  footer: ['footer', 'contentinfo'],
  sidebar: ['sidebar', 'aside', 'drawer', 'rail'],
  modal: ['modal', 'dialog', 'sheet', 'overlay'],
  popover: ['popover', 'dropdown', 'tooltip', 'menu', 'flyout'],
  button: ['button', 'buttons', 'btn', 'primarybutton', 'cta'],
  field: ['field', 'input', 'inputs', 'textarea', 'select', 'textfield'],
  table: ['table', 'tables', 'grid', 'datatable'],
};

/** Where a named position sits, as a percentage across and down. */
const POSITIONS = {
  'top left': [18, 16], top: [50, 12], 'top right': [82, 16],
  left: [12, 50], center: [50, 50], centre: [50, 50], right: [88, 50],
  'bottom left': [18, 84], bottom: [50, 88], 'bottom right': [82, 84],
};

/** Spots to spread a bare list of gradient colours around, when none says where it goes. */
const SPREAD = [[80, 18], [16, 32], [64, 84], [26, 72]];

/** The first key present on an object, from a list of the names it might go by. */
function pick(source, names) {
  if (!source || typeof source !== 'object') return undefined;
  for (const name of names) {
    if (source[name] !== undefined && source[name] !== null) return source[name];
  }
  return undefined;
}

/** A length in px, however it was written: `18`, `"18px"`, `"0.5px solid …"`. */
function px(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const match = value.match(/-?\d*\.?\d+/);
  return match ? Number.parseFloat(match[0]) : null;
}

/** A length in em, for the one measurement written that way. */
function em(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return null;
  const match = value.match(/(-?\d*\.?\d+)\s*em/);
  return match ? Number.parseFloat(match[1]) : null;
}

/**
 * The blur radius, wherever it is hiding.
 *
 * `backdropFilter` is a whole filter chain — `blur(28px) saturate(145%)` — and taking the
 * first number out of it would give 28 here and 145 for a file that ordered them the other
 * way round. The function named in the value is what says which number is the blur.
 */
function blurOf(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return null;
  const inside = value.match(/blur\(\s*(-?\d*\.?\d+)/i);
  if (inside) return Number.parseFloat(inside[1]);
  return /^\s*-?\d*\.?\d+\s*(px)?\s*$/.test(value) ? px(value) : null;
}

/** How see-through a fill is, or null when it is not a colour at all. */
function alphaOf(value) {
  const parsed = typeof value === 'string' ? parseColor(value) : null;
  return parsed ? parsed.a : null;
}

/** The width off a `border` shorthand — `"0.5px solid rgba(…)"` is a half-pixel edge. */
function borderWidthOf(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return null;
  if (/^\s*none\s*$/i.test(value)) return 0;
  const match = value.match(/(-?\d*\.?\d+)\s*px/);
  return match ? Number.parseFloat(match[1]) : null;
}

/** A colour taken to a given opacity, for a gradient layer that states the two apart. */
function atOpacity(value, opacity) {
  const parsed = parseColor(value);
  if (!parsed) return null;
  if (!(opacity > 0 && opacity < 1)) return value;
  return `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${(parsed.a * opacity).toFixed(3)})`;
}

/** Where a layer says it sits, as `[x, y]`. */
function positionOf(value, fallback) {
  const key = String(value ?? '').trim().toLowerCase().replace(/[-_]+/g, ' ');
  return POSITIONS[key] ?? fallback;
}

/** One material, out of whatever CSS-flavoured keys the file used to describe it. */
function readMaterial(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const fill = pick(raw, ['background', 'backgroundColor', 'fill', 'color']);
  const out = {
    blur: blurOf(pick(raw, ['blur', 'backdropFilter', 'backdropBlur', 'webkitBackdropFilter'])),
    borderWidth: borderWidthOf(pick(raw, ['borderWidth', 'border'])),
    radius: px(pick(raw, ['radius', 'borderRadius', 'cornerRadius', 'rounding'])),
    surfaceAlpha: alphaOf(fill),
  };
  // A fill written as an opaque colour says nothing about translucency — that is the
  // default already, and recording it would override the theme's own surface alpha with a
  // flat 1 for every material that happened to name a solid colour. `transparent` says
  // the opposite and is just as empty: a table whose own background is transparent is
  // painting its rows, not asking to be invisible.
  if (out.surfaceAlpha === 1 || out.surfaceAlpha === 0) out.surfaceAlpha = null;

  const kept = Object.fromEntries(Object.entries(out).filter(([, v]) => v != null));
  return Object.keys(kept).length ? kept : null;
}

/** Every material the file names, under whichever key it kept them. */
function readMaterials(source) {
  const out = {};
  for (const block of MATERIAL_BLOCKS) {
    const raw = source[block];
    if (!raw || typeof raw !== 'object') continue;
    for (const [name, value] of Object.entries(raw)) {
      const parsed = readMaterial(value);
      if (parsed && !out[name.toLowerCase()]) out[name.toLowerCase()] = parsed;
    }
  }

  // A file may describe its one raised plane inline rather than naming a set of them:
  // `surface: { background, backdropFilter, radius }` sitting at the top level is a
  // material, and the only one that theme has.
  for (const name of ['surface', 'card', 'panel', 'glass']) {
    if (out[name]) continue;
    const parsed = readMaterial(source[name]);
    if (parsed) out[name] = parsed;
  }
  return out;
}

/**
 * Which material each structural role is made of.
 *
 * Two shapes, because files use both: a role that names a material (`elements.modal.material
 * = "strong"`), and a role that describes itself inline (`navigation: { background, blur }`).
 * The second is given a material of its own, named after the role, since the alternative is
 * discarding a fully specified piece of chrome for the sake of a missing indirection.
 */
function readRoles(source, materials) {
  const blocks = [source.elements, source.components, source];
  const out = {};

  for (const [role, words] of Object.entries(ROLE_WORDS)) {
    for (const block of blocks) {
      if (out[role] || !block || typeof block !== 'object') continue;
      for (const [key, value] of Object.entries(block)) {
        if (out[role] || !words.includes(key.toLowerCase())) continue;
        if (!value || typeof value !== 'object') continue;

        const named = typeof value.material === 'string' ? value.material.toLowerCase() : null;
        if (named && materials[named]) {
          // A role may thicken its own material — a modal that is the strong material but
          // blurrier still. Those overrides belong to the role, not to the shared material.
          const own = readMaterial(value);
          if (own) {
            materials[`${role}-${named}`] = { ...materials[named], ...own };
            out[role] = `${role}-${named}`;
          } else {
            out[role] = named;
          }
          continue;
        }

        const inline = readMaterial(value) ?? readMaterial(value.primary) ?? readMaterial(value.default);
        if (inline) {
          materials[role] = inline;
          out[role] = role;
        }
      }
    }
  }
  return out;
}

/**
 * Hover, press and focus, gathered from wherever the file expressed them.
 *
 * These arrive as declarations — a `transform`, a hover fill, a focus ring's `box-shadow`
 * — and none of that can be kept as written. What is kept is the *amount*: how much
 * lighter the surface goes, how far it moves, how thick the ring is. The engine composes
 * the effect from the theme's own palette, so a number is all it needs.
 */
function readStates(source) {
  const hoverBlocks = [
    source.motion?.hover, source.effects?.hover, source.transitions?.hover,
    source.cards?.hover, source.card?.hover,
    source.elements?.button?.hover, source.buttons?.primary, source.button?.hover,
  ].filter((block) => block && typeof block === 'object');

  const out = { lift: null, border: null, scale: null, press: null, ring: null };

  for (const block of hoverBlocks) {
    const scale = px(pick(block, ['scale']));
    if (out.scale == null && scale != null && scale !== 1) out.scale = scale;

    // A lift written as a colour is the difference between the two fills, which is exactly
    // the overlay the engine paints.
    const fill = alphaOf(pick(block, ['background', 'backgroundColor']));
    if (out.lift == null && fill != null) {
      const base = alphaOf(pick(source.material?.default ?? source.surface ?? source.card ?? {},
        ['background', 'backgroundColor']));
      const delta = base != null ? Math.abs(fill - base) : null;
      if (delta) out.lift = delta;
    }
    // A lift written as a movement is a movement; the engine's own lift is the light, and
    // the travel is the scale, so a `translateY` only says that something should happen.
    if (out.lift == null && typeof pick(block, ['transform', 'lift']) === 'string') out.lift = 0.06;
    if (out.border == null && pick(block, ['border', 'borderColor']) != null) out.border = 0.14;
  }

  const press = px(pick(source.elements?.button?.active ?? source.buttons?.primary ?? {}, ['scale']));
  if (press != null && press !== 1) out.press = press;

  const ring = pick(source.elements?.input ?? source.inputs ?? source.input ?? source.effects?.focus ?? {},
    ['focusRing', 'focusGlow', 'ring', 'outline']);
  // `0 0 0 4px rgba(…)` — the ring's thickness is its spread, the last length in the list.
  const lengths = typeof ring === 'string' ? ring.match(/-?\d*\.?\d+(?=\s*px)/g) : null;
  if (lengths?.length) out.ring = Number.parseFloat(lengths[lengths.length - 1]);

  return out;
}

/**
 * The page's own gradient, as a base colour and the blobs floating over it.
 *
 * Or, when the file wrote the gradient out in full — `value: "linear-gradient(145deg, …)"`
 * — as that gradient, kept as written. A gradient function can carry nothing but colours
 * and angles, so it is read as a whole rather than taken apart and approximated; the base
 * colour, when the block names none, is the palette's own background, which the format
 * fills in once the palette is settled.
 */
function readBackdrop(source) {
  const raw = pick(source, ['backgroundStyle', 'background', 'backdrop', 'canvas']);
  if (!raw || typeof raw !== 'object') return null;

  const written = [pick(raw, ['overlay']), pick(raw, ['value', 'image', 'gradient', 'css'])]
    .filter((layer) => typeof layer === 'string' && isGradient(layer));
  const named = pick(raw, ['base', 'color', 'backgroundColor', 'from']);
  const base = named && parseColor(named) ? named : null;
  if (written.length) return { base, blobs: [], css: written };
  if (!base) return null;

  const blobs = [];
  const layers = Array.isArray(raw.layers) ? raw.layers : [];
  for (const layer of layers.slice(0, 4)) {
    if (!layer || typeof layer !== 'object') continue;
    const colour = atOpacity(pick(layer, ['color', 'background', 'fill']), layer.opacity);
    if (!colour) continue;
    const [x, y] = positionOf(layer.position, SPREAD[blobs.length] ?? [50, 50]);
    blobs.push({ color: colour, x, y, size: px(layer.blur) ?? layer.size ?? 70 });
  }

  // A gradient given as a bare list of colours says which corner it starts from and leaves
  // the rest to the renderer. Spreading them over the page is that same instruction, in
  // the terms the engine paints in.
  const stops = raw.gradient?.colors ?? raw.colors ?? raw.stops;
  if (!blobs.length && Array.isArray(stops)) {
    const anchor = positionOf(raw.gradient?.position ?? raw.position, SPREAD[0]);
    stops.slice(0, 4).forEach((stop, index) => {
      if (!parseColor(stop)) return;
      const [x, y] = index === 0 ? anchor : (SPREAD[index] ?? [50, 50]);
      blobs.push({ color: stop, x, y, size: 90 });
    });
  }

  return blobs.length ? { base, blobs } : null;
}

/** True when any value in a small block says something is switched on. */
function enabled(block) {
  if (block === true) return true;
  if (!block || typeof block !== 'object') return false;
  if (block.enabled === false) return false;
  return block.enabled === true || Object.keys(block).length > 0;
}

/**
 * Everything this file says that the format has somewhere to put.
 *
 * @param {object} source the theme object, already unwrapped from any envelope
 * @returns {object} raw values in the canonical shape — still to be validated
 */
export function readDialect(source) {
  if (!source || typeof source !== 'object') return {};

  const typography = source.typography ?? {};
  const heading = typography.heading ?? {};
  const body = typography.body ?? {};
  const pageFont = source.page?.font ?? {};

  const materials = readMaterials(source);
  const roleMap = readRoles(source, materials);

  // The radius a theme means is the one it puts on its cards, not the tightest step of its
  // scale. Where a file gives a ladder rather than a number, the middle of it is the answer.
  const radiusScale = source.radius ?? source.shape?.radius ?? source.radii ?? {};
  const radius = px(source.radius) ?? px(pick(radiusScale, ['lg', 'large', 'md', 'medium', 'default']))
    ?? px(pick(source.card ?? source.cards?.default ?? source.cards ?? {}, ['radius', 'borderRadius']))
    ?? px(pick(source.surface ?? source.surfaces ?? {}, ['radius', 'borderRadius']))
    ?? px(pick(source.effects ?? {}, ['borderRadius', 'radius']))
    ?? px(pick(source.borders ?? {}, ['radius', 'borderRadius']))
    ?? materials.default?.radius ?? materials.card?.radius ?? materials.surface?.radius ?? null;

  const surfaces = Object.values(materials);
  const blur = px(pick(source.effects ?? {}, ['blur']))
    ?? surfaces.map((m) => m.blur).find((v) => v != null) ?? null;

  const rawEffects = source.effects ?? {};

  // Everything the file says about each kind of element, and about its own selectors.
  const named = readSelectorRules(source);
  const rules = [...readComponentRules(source), ...readChromeRules(source), ...named.rules];

  return {
    radius,
    fontFamily: pick(pageFont, ['family']) ?? pick(body, ['family', 'fontFamily'])
      ?? pick(typography, ['fontFamily', 'bodyFamily', 'bodyFontFamily', 'family', 'body'])
      ?? pick(source.fonts ?? {}, ['body', 'sans', 'base']),
    displayFamily: pick(heading, ['family', 'fontFamily'])
      ?? pick(typography, ['headingFamily', 'headingFontFamily', 'displayFamily', 'displayFontFamily', 'headingFont'])
      ?? pick(source.fonts ?? {}, ['heading', 'display', 'title']),
    // A backdrop blur is what makes a surface glass; nothing else in the file has to say so.
    shadow: blur > 0 ? 'glass' : undefined,
    effects: {
      blur,
      borderWidth: borderWidthOf(pick(rawEffects, ['borderWidth', 'border']))
        ?? surfaces.map((m) => m.borderWidth).find((v) => v != null) ?? null,
      surfaceAlpha: surfaces.map((m) => m.surfaceAlpha).find((v) => v != null) ?? null,
      gradient: enabled(rawEffects.specular) || enabled(rawEffects.gradients?.surface)
        || enabled(rawEffects.edgeReflection) || enabled(rawEffects.innerHighlight),
      noise: enabled(rawEffects.noise) || enabled(source.illustration?.texture),
      glow: enabled(rawEffects.glow) || enabled(source.decorations?.particles)
        || enabled(source.decorations?.fireflies),
      tracking: em(pick(heading, ['letterSpacing']) ?? pick(typography, ['headingLetterSpacing'])
        ?? pick(pageFont, ['letterSpacing'])),
      weight: px(pick(heading, ['weight', 'fontWeight'])
        ?? pick(typography, ['headingWeight', 'headingFontWeight']) ?? pick(pageFont, ['weight'])),
      uppercase: /^uppercase$/i.test(String(pick(heading, ['textTransform']) ?? pick(typography, ['headingTransform']) ?? '')),
      backdrop: readBackdrop(source),
      transition: readTransition(source),
    },
    materials,
    roles: roleMap,
    states: readStates(source),
    rules,
    detect: named.detect,
  };
}
