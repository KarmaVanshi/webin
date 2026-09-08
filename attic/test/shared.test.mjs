import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deepEqual, round, normaliseText, debounce, Emitter, escapeHtml, truncate } from '../src/shared/util.js';
import { parseColor, toHex, toCss, contrastRatio, isTransparent, readableOn, rgbToHsl } from '../src/shared/color.js';
import * as css from '../src/shared/css-values.js';

test('deepEqual compares nested structures', () => {
  assert.ok(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }));
  assert.ok(!deepEqual({ a: 1 }, { a: 1, b: 2 }));
  assert.ok(!deepEqual([1, 2], [2, 1]));
});

test('Emitter survives a handler that throws', () => {
  const e = new Emitter();
  const seen = [];
  e.on('x', () => { throw new Error('boom'); });
  e.on('x', (v) => seen.push(v));
  e.emit('x', 1);
  assert.deepEqual(seen, [1]);
});

test('Emitter allows unsubscribing during dispatch', () => {
  const e = new Emitter();
  const seen = [];
  const off = e.on('x', () => { off(); seen.push('a'); });
  e.on('x', () => seen.push('b'));
  e.emit('x');
  assert.deepEqual(seen, ['a', 'b']);
});

test('escapeHtml neutralises markup', () => {
  assert.equal(escapeHtml('<img src=x onerror=1>'), '&lt;img src=x onerror=1&gt;');
  assert.equal(escapeHtml(`"'&`), '&quot;&#39;&amp;');
});

test('colour parsing round-trips every common notation', () => {
  assert.deepEqual(parseColor('#fff'), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(parseColor('#1a2b3c'), { r: 26, g: 43, b: 60, a: 1 });
  assert.deepEqual(parseColor('rgb(1, 2, 3)'), { r: 1, g: 2, b: 3, a: 1 });
  assert.deepEqual(parseColor('rgba(1 2 3 / 50%)'), { r: 1, g: 2, b: 3, a: 0.5 });
  assert.deepEqual(parseColor('hsl(0, 100%, 50%)'), { r: 255, g: 0, b: 0, a: 1 });
  assert.equal(parseColor('not-a-colour'), null);
  assert.equal(toHex(parseColor('rgb(255,0,0)')), '#ff0000');
  assert.equal(toCss(parseColor('rgba(0,0,0,0.5)')), 'rgba(0, 0, 0, 0.5)');
  assert.ok(isTransparent('rgba(0, 0, 0, 0)'));
});

test('contrast ratio matches the WCAG extremes', () => {
  assert.equal(Math.round(contrastRatio(parseColor('#000'), parseColor('#fff'))), 21);
  assert.equal(Math.round(contrastRatio(parseColor('#fff'), parseColor('#fff'))), 1);
});

test('dimensions keep the author unit', () => {
  assert.equal(css.parseDimension('2.5rem').unit, 'rem');
  assert.equal(css.nudgeDimension('2rem', 0.5), '2.5rem');
  assert.equal(css.nudgeDimension('50%', 10), '60%');
  assert.equal(css.parseDimension('auto').keyword, 'auto');
  assert.equal(css.parseDimension('junk'), null);
  assert.equal(css.toPixels('2rem', { rootFontSize: 16 }), 32);
});

test('unsafe values are refused before reaching a stylesheet', () => {
  assert.ok(!css.isSafeValue('red; background: blue'));
  assert.ok(!css.isSafeValue('url(https://evil.test/x.png)'));
  assert.ok(!css.isSafeValue('red /* } */'));
  assert.ok(!css.isSafeValue('expression(alert(1))'));
  assert.ok(!css.isSafeValue('a'.repeat(600)));
  assert.ok(css.isSafeValue('16px'));
  assert.ok(css.isSafeValue('rgba(0, 0, 0, 0.5)'));
});

test('only allow-listed properties may be written', () => {
  assert.ok(!css.validateDeclaration('behavior', 'x').ok);
  assert.ok(!css.validateDeclaration('-moz-binding', 'x').ok);
  assert.equal(css.validateDeclaration('Font-Size', ' 16px ').property, 'font-size');
  assert.equal(css.validateDeclaration('Font-Size', ' 16px ').value, '16px');
});

test('shadows parse and re-serialise', () => {
  const s = css.parseShadow('0 4px 20px rgba(0,0,0,0.2)');
  assert.deepEqual([s.x, s.y, s.blur, s.inset], [0, 4, 20, false]);
  assert.equal(css.formatShadow(s), '0px 4px 20px 0px rgba(0,0,0,0.2)');
  assert.equal(css.parseShadow('0 1px 2px #000, 0 2px 4px #000'), null, 'multi-layer bails out');
  assert.equal(css.parseShadow('none'), null);
  assert.ok(css.parseShadow('inset 0 2px 4px #000').inset);
});

test('CSS variable references are extracted', () => {
  assert.deepEqual(css.extractVarRefs('var(--a) calc(var(--b) * 2)'), ['--a', '--b']);
  assert.deepEqual(css.extractVarRefs('16px'), []);
});

test('readableOn leaves a colour alone when it is already legible', () => {
  assert.equal(readableOn('#0369A1', '#FFFFFF'), '#0369A1');
  assert.equal(readableOn('#FFFFFF', '#020617'), '#FFFFFF');
});

test('readableOn darkens to the target without losing the hue', () => {
  const fixed = readableOn('#EC4899', '#FFFFFF');
  assert.ok(contrastRatio(parseColor(fixed), parseColor('#FFFFFF')) >= 4.5,
    'a pink that could not carry text now can');
  const before = rgbToHsl(parseColor('#EC4899'));
  const after = rgbToHsl(parseColor(fixed));
  assert.ok(Math.abs(before.h - after.h) < 4, 'it is still the same pink, just deeper');
  assert.ok(after.l < before.l, 'reached by lowering lightness, not by washing the colour out');
});

test('readableOn satisfies every background it is given', () => {
  const fixed = readableOn('#93C5FD', ['#FFFFFF', '#F5F5F0']);
  for (const bg of ['#FFFFFF', '#F5F5F0']) {
    assert.ok(contrastRatio(parseColor(fixed), parseColor(bg)) >= 4.5, `legible on ${bg}`);
  }
});

test('readableOn returns its best effort when the target is unreachable', () => {
  // Trapped between black and white there is no 4.5:1 shade; returning something more
  // legible still beats returning the original.
  const fixed = readableOn('#808080', ['#000000', '#FFFFFF']);
  assert.ok(parseColor(fixed), 'still a usable colour rather than a failure');
});
