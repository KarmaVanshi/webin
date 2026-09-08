import test from 'node:test';
import assert from 'node:assert/strict';

import { PRESETS, GROUPS, presetById } from '../src/themes/library.js';
import { parseColor, contrastRatio } from '../src/shared/color.js';
import { SHADOW_KINDS } from '../src/shared/theme-format.js';

test('the library covers the movements it claims to', () => {
  const ids = PRESETS.map((t) => t.id);
  for (const id of ['minimal', 'flat', 'skeuomorphic', 'neumorphic', 'glass', 'bauhaus',
    'bold-type', 'brutalist', 'neon']) {
    assert.ok(ids.includes(id), `${id} is missing`);
  }
  assert.ok(PRESETS.filter((t) => t.dark).length >= 5, 'enough dark options to matter');
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
});

test('every preset belongs to a shelf the panel can show', () => {
  const groups = new Set(GROUPS.map((g) => g.id));
  for (const theme of PRESETS) {
    assert.ok(groups.has(theme.group), `${theme.id} has no shelf`);
    assert.equal(theme.custom, false, 'a shipped theme is not one of "yours"');
  }
});

test('every preset is readable', () => {
  for (const theme of PRESETS) {
    const p = theme.palette;
    const bg = parseColor(p.background);
    const surface = parseColor(p.surface);

    const check = (label, colour, against, min) => {
      const ratio = contrastRatio(parseColor(colour), against);
      assert.ok(ratio >= min, `${theme.id}: ${label} is ${ratio.toFixed(2)}:1, needs ${min}:1`);
    };

    check('text on canvas', p.text, bg, 4.5);
    check('text on surface', p.text, surface, 4.5);
    check('muted text on canvas', p.textMuted, bg, 4.5);
    check('muted text on surface', p.textMuted, surface, 4.5);
    check('label on accent', p.onAccent, parseColor(p.accent), 4.5);
    check('accent against canvas', p.accent, bg, 3);
  }
});

test('every preset is a complete, valid theme', () => {
  for (const theme of PRESETS) {
    assert.ok(theme.name.length > 0 && theme.name.length <= 42, `${theme.id} name`);
    assert.ok(theme.description.length > 0, `${theme.id} needs a description for its tooltip`);
    assert.ok(SHADOW_KINDS.includes(theme.shadow), `${theme.id} shadow`);
    assert.ok(theme.density >= 0.6 && theme.density <= 2, `${theme.id} density`);
    assert.ok(theme.radius === null || theme.radius >= 0, `${theme.id} radius`);
    assert.ok(theme.effects, `${theme.id} effects`);
  }
});

test('the movements actually differ from each other, not just in colour', () => {
  assert.equal(presetById('bauhaus').radius, 0);
  assert.equal(presetById('bauhaus').shadow, 'hard');
  assert.equal(presetById('neumorphic').shadow, 'neu');
  assert.ok(presetById('glass').effects.blur > 0);
  assert.ok(presetById('glass').effects.backdrop, 'a shipped theme may carry a backdrop');
  assert.equal(presetById('skeuomorphic').effects.gradient, true);
  assert.equal(presetById('skeuomorphic').effects.noise, true);
  assert.equal(presetById('bold-type').effects.weight, 900);
  assert.equal(presetById('bold-type').effects.uppercase, true);
  assert.equal(presetById('brutalist').effects.borderWidth, 3);
  assert.equal(presetById('neon').effects.glow, true);
  assert.equal(presetById('flat').shadow, 'none');
});

test('an unknown id is null, not a crash', () => {
  assert.equal(presetById('nope'), null);
  assert.equal(presetById(undefined), null);
});
