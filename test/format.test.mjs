import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normaliseTheme, themeToFile, collectionToFile, parseThemeInput,
  encodeShareCode, decodeShareCode, isShareCode, themeFileName,
} from '../src/shared/theme-format.js';

const MINIMAL = {
  name: 'Test',
  palette: { background: '#ffffff', surface: '#eeeeee', text: '#111111', textMuted: '#666666', accent: '#ff0000' },
};

test('a theme needs a palette that parses', () => {
  assert.equal(normaliseTheme(null), null);
  assert.equal(normaliseTheme({ name: 'No palette' }), null);
  assert.equal(normaliseTheme({ palette: { background: 'not-a-colour', surface: '#fff', text: '#000', textMuted: '#666', accent: '#f00' } }), null);
  assert.ok(normaliseTheme(MINIMAL));
});

test('missing border and onAccent are filled in rather than rejected', () => {
  const theme = normaliseTheme(MINIMAL);
  assert.equal(theme.palette.onAccent, '#ffffff');
  assert.equal(theme.palette.border, '#666666');
});

test('colours are normalised to one form', () => {
  const theme = normaliseTheme({
    ...MINIMAL,
    palette: { ...MINIMAL.palette, accent: 'rgb(255 0 0)', surface: 'rgba(0,0,0,0.5)' },
  });
  assert.equal(theme.palette.accent, '#ff0000');
  assert.equal(theme.palette.surface, 'rgba(0, 0, 0, 0.5)');
});

test('a font stack that could close a CSS declaration is rejected', () => {
  const hostile = normaliseTheme({ ...MINIMAL, fontFamily: 'Georgia; } html { display: none } .x {' });
  assert.equal(hostile.fontFamily, null, 'injection attempt must not survive');

  const real = normaliseTheme({ ...MINIMAL, fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif' });
  assert.equal(real.fontFamily, '"Helvetica Neue", Helvetica, Arial, sans-serif');
});

test('a raw CSS backdrop is only honoured from a theme we shipped', () => {
  const untrusted = normaliseTheme({ ...MINIMAL, effects: { backdrop: 'url(https://evil.example/x)' } });
  assert.equal(untrusted.effects.backdrop, null);

  const trusted = normaliseTheme({ ...MINIMAL, effects: { backdrop: 'linear-gradient(#000, #fff)' } }, { trusted: true });
  assert.equal(trusted.effects.backdrop, 'linear-gradient(#000, #fff)');
});

test('numbers are clamped and rubbish falls back', () => {
  const theme = normaliseTheme({ ...MINIMAL, radius: 5000, density: 'lots', shadow: 'made-up', effects: { blur: -20, weight: 4000 } });
  assert.equal(theme.radius, 60);
  assert.equal(theme.density, 1);
  assert.equal(theme.shadow, 'soft');
  assert.equal(theme.effects.blur, 0);
  assert.equal(theme.effects.weight, 900);
});

test('unknown fields are dropped', () => {
  const theme = normaliseTheme({ ...MINIMAL, evil: 'payload', effects: { evil: true } });
  assert.equal(theme.evil, undefined);
  assert.equal(theme.effects.evil, undefined);
});

test('control characters are stripped from names', () => {
  const theme = normaliseTheme({ ...MINIMAL, name: 'Bad\u0000\u001Fname' });
  assert.equal(theme.name, 'Badname');
});

test('a share code round-trips through compression', async () => {
  const theme = normaliseTheme({ ...MINIMAL, name: 'Round trip', radius: 12, shadow: 'hard' });
  const code = await encodeShareCode(theme);

  assert.ok(isShareCode(code));
  assert.ok(!/\s/.test(code), 'a code must survive being pasted into a chat window');

  const decoded = await decodeShareCode(code);
  const back = parseThemeInput(code, decoded).themes[0];
  assert.equal(back.name, 'Round trip');
  assert.equal(back.radius, 12);
  assert.equal(back.shadow, 'hard');
  assert.deepEqual(back.palette, theme.palette);
});

test('a damaged share code decodes to nothing rather than throwing', async () => {
  assert.equal(await decodeShareCode('webin:1z:!!!!not-base64!!!!'), null);
  assert.equal(await decodeShareCode('webin:1:aGVsbG8'), null, 'valid base64 that is not JSON');
  assert.equal(await decodeShareCode('just some text'), null);
});

test('a plain theme file imports, and so does a collection', () => {
  const theme = normaliseTheme(MINIMAL);
  const single = parseThemeInput(JSON.stringify(themeToFile(theme)));
  assert.equal(single.error, null);
  assert.equal(single.themes.length, 1);

  const many = parseThemeInput(JSON.stringify(collectionToFile([theme, { ...theme, id: 'other', name: 'Other' }])));
  assert.equal(many.themes.length, 2);
  assert.equal(many.themes[1].name, 'Other');
});

test('junk input reports why rather than failing silently', () => {
  // The message names what Webin will accept, which is now wider than its own format.
  assert.match(parseThemeInput('hello').error, /could not read that/);
  assert.match(parseThemeInput('{"format":"webin-theme","theme":{"name":"x"}}').error, /missing colours/);
});

test('file names are safe and recognisable', () => {
  assert.equal(themeFileName({ name: 'My Theme / v2!' }), 'my-theme-v2.webin.json');
  assert.equal(themeFileName({ name: '   ' }), 'theme.webin.json');
});
