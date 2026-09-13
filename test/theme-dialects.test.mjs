import test from 'node:test';
import assert from 'node:assert/strict';

import { readDialect } from '../src/shared/theme-dialects.js';
import { normaliseTheme } from '../src/shared/theme-format.js';

const PALETTE = { background: '#101418', surface: '#1b2028', text: '#ffffff', accent: '#0A84FF' };

test('a blur is found wherever the file put it', () => {
  // `blur(28px) saturate(145%)` is a filter chain, not a number. Taking the first one out
  // of it would read 28 here and 145 for a file that ordered the two the other way round.
  assert.equal(readDialect({ surface: { backdropFilter: 'blur(28px) saturate(145%)' } }).effects.blur, 28);
  assert.equal(readDialect({ surface: { backdropFilter: 'saturate(145%) blur(12px)' } }).effects.blur, 12);
  assert.equal(readDialect({ surfaces: { glass: { blur: '18px' } } }).effects.blur, 18);
  assert.equal(readDialect({ effects: { blur: 30 } }).effects.blur, 30);
});

test('an edge written as a shorthand is still an edge', () => {
  assert.equal(readDialect({ surface: { border: '0.5px solid rgba(255,255,255,0.18)' } }).effects.borderWidth, 0.5);
  assert.equal(readDialect({ surface: { border: 'none' } }).effects.borderWidth, 0);
});

test('a material keeps its translucency and drops what says nothing', () => {
  const { materials } = readDialect({
    material: {
      default: { background: 'rgba(255,255,255,0.075)', backdropFilter: 'blur(28px)', radius: 20 },
      solid: { background: '#ff0000' },
      empty: { background: 'transparent' },
    },
  });

  assert.deepEqual(materials.default, { blur: 28, radius: 20, surfaceAlpha: 0.075 });
  // An opaque fill is the default already; `transparent` is a table painting its rows, not
  // a request to be invisible. Recording either would overwrite the theme's own alpha.
  assert.equal(materials.solid, undefined);
  assert.equal(materials.empty, undefined);
});

test('a role that names a material gets it, and one that describes itself gets its own', () => {
  const { roles, materials } = readDialect({
    material: { soft: { background: 'rgba(255,255,255,0.045)', blur: 24 } },
    elements: {
      navigation: { material: 'soft', radius: 0, blur: 30 },
      modal: { material: 'soft' },
    },
    inputs: { background: 'rgba(255,255,255,0.06)', radius: 14 },
  });

  // The nav thickens the material it names — that override belongs to the nav, not to
  // every other role built out of `soft`.
  assert.equal(roles.nav, 'nav-soft');
  assert.equal(materials['nav-soft'].blur, 30);
  assert.equal(materials['nav-soft'].radius, 0);
  assert.equal(materials.soft.blur, 24, 'the shared material is untouched');

  assert.equal(roles.modal, 'soft', 'naming a material and nothing else just uses it');
  assert.equal(roles.field, 'inputs' in {} ? null : 'field', 'a self-describing role gets a material of its own');
  assert.equal(materials.field.radius, 14);
});

test('states arrive as declarations and are kept as amounts', () => {
  const { states } = readDialect({
    material: { default: { background: 'rgba(255,255,255,0.075)' } },
    elements: {
      button: {
        hover: { background: 'rgba(255,255,255,0.11)', border: 'rgba(255,255,255,0.25)' },
        active: { scale: 0.985 },
      },
      input: { focusRing: '0 0 0 3px rgba(10,132,255,0.17)' },
    },
  });

  assert.ok(Math.abs(states.lift - 0.035) < 1e-9, 'the lift is the difference between the two fills');
  assert.equal(states.press, 0.985);
  assert.equal(states.ring, 3, 'a ring is as thick as its spread, the last length in the shadow');
  assert.equal(states.border, 0.14);
});

test('a page gradient is read as a base and the blobs over it', () => {
  const { effects } = readDialect({
    background: {
      base: '#F4EEDB',
      layers: [
        { type: 'sky', position: 'top', color: '#A9D4E8', opacity: 0.55 },
        { type: 'sunlight', position: 'top-right', color: '#F6D98B', opacity: 0.32, blur: '90px' },
      ],
    },
  });

  assert.equal(effects.backdrop.base, '#F4EEDB');
  assert.deepEqual(effects.backdrop.blobs[0], { color: 'rgba(169, 212, 232, 0.550)', x: 50, y: 12, size: 70 });
  assert.equal(effects.backdrop.blobs[1].x, 82, 'top-right and "top right" are one position');
  assert.equal(effects.backdrop.blobs[1].size, 90, 'a layer as soft as it is wide');
});

test('a gradient given as a bare list of colours is spread over the page', () => {
  const { effects } = readDialect({
    backgroundStyle: { base: '#FFF7FC', gradient: { type: 'radial', colors: ['#FFE8F3', '#F2E9FF'], position: 'top right' } },
  });

  assert.equal(effects.backdrop.blobs.length, 2);
  assert.deepEqual([effects.backdrop.blobs[0].x, effects.backdrop.blobs[0].y], [82, 16], 'the first sits where it says');
});

test('our own spelling always wins over the file’s', () => {
  const theme = normaliseTheme({
    palette: PALETTE,
    radius: 4,
    effects: { blur: 6 },
    typography: { fontFamily: 'Inter' },
    surface: { backdropFilter: 'blur(30px)', radius: 20 },
  });

  assert.equal(theme.radius, 4, 'the canonical field is not overridden by the dialect');
  assert.equal(theme.effects.blur, 6);
  assert.equal(theme.fontFamily, 'Inter', 'and the dialect still fills what was left unsaid');
});

test('a dialect value is validated exactly like a written one', () => {
  const theme = normaliseTheme({
    palette: PALETTE,
    surface: { radius: 9999, backdropFilter: 'blur(400px)' },
    typography: { fontFamily: 'Inter"; background: url(evil)' },
  });

  assert.equal(theme.radius, 60, 'clamped');
  assert.equal(theme.effects.blur, 40, 'clamped');
  assert.equal(theme.fontFamily, null, 'a font stack that could close a declaration is refused');
});
