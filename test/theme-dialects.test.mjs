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

// ── What a file says about the theme as a whole, kept as it said it ─────────

test('a shadow the file wrote out is the theme\'s shadow, and `none` means none', () => {
  assert.equal(readDialect({ effects: { shadow: '3px 3px 0px #000' } }).effects.shadowCss, '3px 3px 0px #000');
  assert.equal(readDialect({ effects: { boxShadow: 'none' } }).effects.shadowCss, 'none');
  assert.equal(readDialect({ effects: { shadow: false } }).effects.shadowCss, 'none');
  assert.equal(readDialect({ effects: { shadow: 'soft' } }).effects.shadowCss, null, 'a kind is not a value');

  const theme = normaliseTheme({ palette: PALETTE, effects: { softShadow: '0 10px 30px rgba(0,0,0,0.2)' } });
  assert.equal(theme.effects.shadowCss, '0 10px 30px rgba(0,0,0,0.2)');
  assert.equal(normaliseTheme({ palette: PALETTE, effects: { shadow: '0 0 0 url(x)' } }).effects.shadowCss, null,
    'and it goes through the gate like every value');
});

test('saturation, brightness, a drawn sheen, and a border opacity are levers too', () => {
  const theme = normaliseTheme({
    palette: { ...PALETTE, border: '#c8cfb1' },
    effects: {
      blur: 20, saturation: 145, brightness: 102, borderOpacity: 0.55,
      specular: { enabled: true, gradient: 'linear-gradient(135deg, rgba(255,255,255,0.2), rgba(255,255,255,0))' },
    },
  });
  assert.equal(theme.effects.saturate, 145);
  assert.equal(theme.effects.brighten, 102);
  assert.equal(theme.effects.sheen, 'linear-gradient(135deg, rgba(255,255,255,0.2), rgba(255,255,255,0))');
  assert.equal(theme.palette.border, 'rgba(200, 207, 177, 0.55)');
});

test('grain is grain under any name, unless the file says there is none', () => {
  assert.equal(readDialect({ graphics: { noise: 'subtle' } }).effects.noise, true);
  assert.equal(readDialect({ effects: { texture: 'subtle-crt-scanlines' } }).effects.noise, true);
  assert.equal(readDialect({ decoration: { texture: { type: 'paper_grain', opacity: 0.04 } } }).effects.noise, true);
  assert.equal(readDialect({ effects: { texture: 'none' } }).effects.noise, false);
  assert.equal(readDialect({ effects: { noise: { enabled: false } } }).effects.noise, false);
});

test('a hover lift stated as an amount is that amount', () => {
  const { states } = readDialect({ interaction: { hover: { backgroundIncrease: 0.025, borderIncrease: 0.06 } } });
  assert.equal(states.lift, 0.025);
  assert.equal(states.border, 0.06);
});

test('blobs are kept beside a written gradient, and sit above it', () => {
  const theme = normaliseTheme({
    palette: PALETTE,
    backgroundStyle: {
      base: '#F4EEDB',
      gradient: 'linear-gradient(160deg, #A9D4E8 0%, #F4EEDB 100%)',
      atmosphere: [{ color: '#F6D98B', opacity: 0.28, position: 'top-right', blur: '100px' }],
    },
  });
  const { backdrop } = theme.effects;
  assert.equal(backdrop.css.length, 1);
  assert.equal(backdrop.blobs.length, 1, 'the sunlight is not dropped for the sky');
  assert.equal(readDialect({ effects: { background: 'linear-gradient(135deg, #000, #fff)' } }).effects.backdrop.css[0],
    'linear-gradient(135deg, #000, #fff)', 'a gradient under the effects is the ground');
});

test('the general statement comes first, so the specific one wins', () => {
  const { rules } = normaliseTheme({
    palette: PALETTE,
    effects: { shadow: '3px 3px 0 #000', glow: '0 0 8px rgba(0,255,102,0.35)', hoverShadow: '0 14px 36px rgba(0,0,0,0.2)' },
    shadows: { medium: '0 12px 32px rgba(0,0,0,0.1)', deep: '0 22px 55px rgba(0,0,0,0.2)' },
    animation: { hoverTransform: 'translateY(-2px)' },
    components: { card: { shadow: '4px 4px 0 #000' } },
    typography: { fontWeight: 400, letterSpacing: '-0.02em', headingLetterSpacing: '0.1em' },
  });
  const find = (target, state = null) => rules.find((r) => r.target === target && r.state === state)?.properties;
  assert.equal(find('surface')['box-shadow'], '4px 4px 0 #000', 'the card\'s own shadow beats the scale and the theme\'s');
  assert.equal(find('modal')['box-shadow'], '0 22px 55px rgba(0,0,0,0.2)', 'the deep end of the scale is the modal');
  assert.equal(find('heading')['text-shadow'], '0 0 8px rgba(0,255,102,0.35)');
  assert.deepEqual(find('surface', 'hover'), { transform: 'translateY(-2px)', 'box-shadow': '0 14px 36px rgba(0,0,0,0.2)' });
  assert.equal(find('body')['font-weight'], '400');
  assert.equal(find('body')['letter-spacing'], '-0.02em', 'a bare letterSpacing is the body\'s even beside a heading one');
  assert.equal(find('heading')['letter-spacing'], '0.1em');
});

test('an element that names a material is that material with its own words on top', () => {
  const { rules } = normaliseTheme({
    palette: PALETTE,
    material: {
      default: { background: 'rgba(255,255,255,0.075)', backdropFilter: 'blur(28px) saturate(145%)', border: '0.5px solid rgba(255,255,255,0.18)', boxShadow: '0 12px 40px rgba(0,0,0,0.18)', radius: 20 },
      soft: { backdropFilter: 'blur(24px) saturate(135%)', boxShadow: '0 8px 30px rgba(0,0,0,0.12)' },
      floating: { background: 'rgba(255,255,255,0.11)', boxShadow: '0 24px 75px rgba(0,0,0,0.3)' },
    },
    elements: { navigation: { material: 'soft', blur: 30, radius: 0 }, card: { material: 'default', radius: 16 } },
  });
  const find = (target) => rules.find((r) => r.target === target && !r.state)?.properties;
  assert.equal(find('nav')['backdrop-filter'], 'blur(30px) saturate(135%)', 'its own blur, inside the material\'s chain');
  assert.equal(find('nav')['box-shadow'], '0 8px 30px rgba(0,0,0,0.12)');
  assert.equal(find('surface')['border-radius'], '16px');
  assert.equal(find('surface')['box-shadow'], '0 12px 40px rgba(0,0,0,0.18)');
  assert.equal(find('popover')['box-shadow'], '0 24px 75px rgba(0,0,0,0.3)', 'whatever floats is the popover');
  assert.equal(find('modal')['background-color'], 'rgba(255, 255, 255, 0.11)', 'and the modal');
});

test('secondary buttons, table parts, a focus ring and an accent hover', () => {
  const { rules } = normaliseTheme({
    palette: { ...PALETTE, accentHover: '#409CFF' },
    buttons: {
      primary: { background: '#527A5B', text: '#fff' },
      secondary: { background: '#F6D98B', text: '#4B543F', hover: '#EFCB76' },
    },
    table: { header: { background: 'rgba(255,255,255,0.07)' }, row: { background: 'rgba(255,255,255,0.025)', hoverBackground: 'rgba(255,255,255,0.065)' } },
    interaction: { focus: { ring: '0 0 0 3px rgba(10,132,255,0.18)' } },
  });
  const find = (target, state = null, part = null) => rules.find((r) => r.target === target && r.state === state && r.part === part)?.properties;
  assert.equal(find('button')['background-color'], '#527a5b');
  assert.equal(find('button', 'secondary')['background-color'], '#f6d98b');
  assert.equal(find('button', 'secondaryHover')['background-color'], '#efcb76');
  assert.equal(find('button', 'hover')['background-color'], '#409cff', '`palette.accentHover`');
  assert.equal(find('link', 'hover').color, '#409cff');
  assert.equal(find('button', 'focus')['box-shadow'], '0 0 0 3px rgba(10,132,255,0.18)');
  assert.equal(find('field', 'focus')['box-shadow'], '0 0 0 3px rgba(10,132,255,0.18)');
  assert.equal(find('table', null, 'header')['background-color'], 'rgba(255, 255, 255, 0.07)');
  assert.equal(find('table', 'hover', 'row')['background-color'], 'rgba(255, 255, 255, 0.065)');
  assert.equal(normaliseTheme({ palette: PALETTE, rules: [{ target: 'nav', state: 'secondary', properties: { color: '#fff' } }] }).rules[0].state,
    null, 'a secondary state means nothing on anything but a button');
});
