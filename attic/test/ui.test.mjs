import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDom } from './helpers.mjs';
import * as controls from '../src/ui/controls.js';
import { icon, iconNames } from '../src/ui/icons.js';
import { tokens, base } from '../src/ui/theme.js';
import { chromeCss } from '../src/ui/chrome-css.js';
import { overlayCss } from '../src/content/overlay/overlay.js';
import { renderToolbar } from '../src/ui/toolbar.js';
import { renderInspector } from '../src/ui/inspector.js';
import { renderHistory } from '../src/ui/history-panel.js';
import { renderResponsive } from '../src/ui/responsive.js';
import { parseColor, contrastRatio } from '../src/shared/color.js';

const ALL_CSS = tokens + base + chromeCss + overlayCss;

/** The light palette lives on bare `:host`; the dark one only overrides its colours. */
const lightBlock = () => tokens.slice(tokens.indexOf(':host {'), tokens.indexOf(':host(['));
const darkBlock = () => tokens.slice(tokens.indexOf(':host(['));
const tokenValue = (block, name) => block.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1].trim();
/** Resolves a token as the browser would: the dark block, else the light default. */
const resolve = (block, name) => tokenValue(block, name) ?? tokenValue(lightBlock(), name);
const ratio = (block, fg, bg) =>
  contrastRatio(parseColor(resolve(block, fg)), parseColor(resolve(block, bg)));

test('the stylesheet is well formed and every token it uses is defined', () => {
  assert.equal((ALL_CSS.match(/{/g) ?? []).length, (ALL_CSS.match(/}/g) ?? []).length);
  const defined = new Set([...tokens.matchAll(/(--[\w-]+):/g)].map((m) => m[1]));
  const used = new Set([...ALL_CSS.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
  assert.deepEqual([...used].filter((v) => !defined.has(v)), []);
});

test('the design system decisions are honoured in the tokens', () => {
  assert.match(darkBlock(), /--accent: #22C55E/, 'chrome accent from the generated palette');
  assert.match(tokens, /--selection: #6366F1/, 'page marks use the product icon colour');
  assert.match(tokens, /--text-body: 12px/, '12px is the body floor');
  assert.match(base, /:focus-visible/, 'focus rings are replaced, never removed');
  assert.ok(!/outline:\s*none\s*;?\s*}/.test(base.replace(/:focus\s*{\s*outline: none;\s*}/, '')),
    'no control is left without a focus indicator');
  assert.match(base, /prefers-reduced-motion/);
});

test('icons are one consistent family and never carry meaning alone', () => {
  assert.ok(iconNames.length >= 25);
  for (const name of iconNames) {
    const svg = icon(name);
    assert.match(svg, /stroke-width="1.75"/, `${name} keeps the family stroke weight`);
    assert.match(svg, /aria-hidden="true"/, `${name} is decorative at the call site`);
    assert.equal((svg.match(/</g) ?? []).length, (svg.match(/>/g) ?? []).length, `${name} is balanced`);
  }
  assert.equal(icon('does-not-exist'), '');
});

test('every control has a visible label and an accessible name', () => {
  const number = controls.numberField({ label: 'Width', prop: 'width', value: 320, unit: 'px' });
  assert.match(number, /<label class="widt-label" for="widt-c\d+"/);
  assert.match(number, /aria-label="Width unit"/);

  const seg = controls.segmented({ label: 'Align', prop: 'text-align', value: 'left',
    options: [{ value: 'left', label: 'Left', icon: 'align' }, { value: 'right', label: 'Right', icon: 'align' }] });
  assert.match(seg, /role="radiogroup"/);
  assert.match(seg, /aria-checked="true"/);
  assert.match(seg, /aria-label="Left"/, 'an icon-only segment still announces itself');

  const btn = controls.iconButton({ name: 'eye', action: 'hide', title: 'Hide element', pressed: false });
  assert.match(btn, /aria-label="Hide element"/);
  assert.match(btn, /aria-pressed="false"/);

  const box = controls.boxField({ label: 'Padding', prop: 'padding', values: { top: 8, right: 8, bottom: 8, left: 8 }, linked: true });
  assert.match(box, /aria-label="Padding top"/);
  assert.match(box, /aria-pressed="true"/);
});

test('user content in a control is escaped', () => {
  const field = controls.textField({ label: 'Alt', prop: '@alt', value: '"><img src=x onerror=alert(1)>' });
  assert.ok(!field.includes('<img'), 'page-supplied text cannot break out of the attribute');
  assert.match(field, /&quot;&gt;&lt;img/);
});

test('mixed values across a multi-selection are shown as mixed', () => {
  const field = controls.numberField({ label: 'Radius', prop: 'border-radius', value: controls.MIXED });
  assert.match(field, /placeholder="Mixed"/);
  assert.match(field, /data-mixed/);
});

test('the toolbar reflects mode, history and dirty state', () => {
  const html = renderToolbar({ mode: 'design', activePanel: 'inspector', canUndo: false, canRedo: true,
    dirty: true, hasSelection: false, layersVisible: true, inspectorVisible: true });
  assert.match(html, /role="toolbar"/);
  assert.match(html, /data-value="design"[^>]*role="radio" aria-checked="true"/s);
  assert.match(html.replace(/\n/g, ' '), /data-action="undo"[^>]*disabled/);
  assert.match(html, /Save •/);
});

test('the inspector explains where a value comes from', () => {
  const detail = fixtureDetail();
  const html = renderInspector(detail, {
    openSections: new Set(['layout', 'typography', 'appearance', 'spacing', 'flex']),
    overrides: { all: { width: '380px' } },
    provenance: { width: { computed: '140px', declared: '140px', source: 'override', selector: '.btn', important: true, varRef: '--btn-w' } },
  });
  assert.match(html, /button · Buy Now/);
  assert.match(html, /1 edit/);
  assert.match(html, /Yours/, 'an override is labelled as the user’s own');
  assert.match(html, /!important/);
  assert.match(html, /--btn-w/, 'a CSS variable is a first-class value');
  assert.match(html, /Contrast 3.1:1/, 'an accessibility regression is surfaced');
});

test('the inspector only shows layout sections that apply', () => {
  const flex = renderInspector(fixtureDetail(), { openSections: new Set() });
  assert.match(flex, /Flex container/);
  assert.ok(!flex.includes('Grid container'));

  const grid = fixtureDetail();
  grid.layoutContext = { self: 'grid', isFlexChild: false, isGridChild: false,
    grid: { templateColumns: '1fr 1fr', templateRows: 'auto', columnGap: '8px', rowGap: '8px', columnCount: 2 } };
  const gridHtml = renderInspector(grid, { openSections: new Set() });
  assert.match(gridHtml, /Grid container/);
  assert.ok(!gridHtml.includes('Flex container'));
});

test('empty and multi states are explained rather than blank', () => {
  assert.match(renderInspector(null, { openSections: new Set() }), /Nothing selected/);
  assert.match(renderHistory({ list: [], pending: [] }), /No changes yet/);
  const multi = renderInspector(fixtureDetail(), { openSections: new Set(), multi: 3, shared: { 'border-radius': '8px' } });
  assert.match(multi, /3 elements selected/);
  assert.match(multi, /placeholder="Mixed"/);
});

test('the responsive panel separates preview size from edit scope', () => {
  const html = renderResponsive({ viewport: 'mobile', breakpoint: 'tablet', actualWidth: 1440, actualHeight: 900 });
  assert.match(html, /Preview size/);
  assert.match(html, /Edits apply to/);
  assert.match(html, /390 × 844/);
  assert.match(html, /≤ 1024px/);
});

test('the shell isolates itself from the page it floats over', async () => {
  makeDom('<html><body><div id="p">page</div></body></html>');
  const { App } = await import('../src/ui/app.js');
  const app = new App({ doc: document, view: window });
  const shadow = app.mount();

  assert.equal(app.host.getAttribute('data-widt-owned'), '');
  assert.equal(app.host.style.zIndex, '2147483647', 'one maximal z-index at the boundary');
  assert.equal(app.host.style.isolation, 'isolate', 'and a self-contained scale inside');
  assert.equal(app.host.style.pointerEvents, 'none', 'the page stays reachable through the layer');
  assert.ok(shadow.querySelector('.widt-toolbar'));
  assert.ok(shadow.querySelector('.widt-marks-host'));
  assert.ok(document.getElementById('p'), 'the page is untouched');

  let action = null;
  app.on('action', (payload) => { action = payload; });
  shadow.querySelector('[data-action="set-mode"]').click();
  assert.equal(action.action, 'set-mode');

  app.showPanel('history');
  assert.equal(shadow.querySelector('[data-panel="history"]').hidden, false);
  assert.equal(shadow.querySelector('.widt-inspector-title').textContent, 'History');

  app.notices.show({ tone: 'error', title: 'Cannot inspect', text: 'Restricted iframe.' });
  assert.equal(shadow.querySelector('.widt-notice').getAttribute('aria-live'), 'assertive');

  app.unmount();
  assert.equal(document.querySelector('[data-widt-owned]'), null);
});

test('layers render lazily and reveal the selection', async () => {
  makeDom('<html><body><header><h1>T</h1></header><main><section id="s"><p>a</p></section></main></body></html>');
  const { LayersPanel } = await import('../src/ui/layers.js');
  const root = document.createElement('div');
  const panel = new LayersPanel({ view: window, root });

  panel.render({ root: document.body, selection: [], hovered: null });
  assert.match(root.innerHTML, /role="tree"/);
  assert.match(root.innerHTML, /Header/);
  assert.ok(!root.innerHTML.includes('H1 · T'), 'collapsed branches cost nothing');

  const h1 = document.querySelector('h1');
  panel.reveal(h1, document.body);
  panel.render({ root: document.body, selection: [h1], hovered: null });
  assert.match(root.innerHTML, /H1 · T/);
  assert.match(root.innerHTML, /aria-selected="true"/);

  const key = root.querySelector('[data-action="select-layer"]').dataset.value;
  assert.equal(panel.elementFor(key), document.querySelector('header'));
});

function fixtureDetail() {
  return {
    label: 'button · Buy Now', classes: ['btn', 'primary'],
    attributes: { 'aria-label': 'Buy' }, identity: { domPath: 'html>body>button' },
    geometry: { width: 140, height: 44 },
    layout: { display: 'inline-flex', position: 'static', width: 140, height: 44, declaredWidth: '140px',
      declaredHeight: 'auto', overflow: 'visible', zIndex: 'auto', left: 'auto', top: 'auto' },
    spacing: { padding: { top: 8, right: 16, bottom: 8, left: 16 }, margin: { top: 0, right: 0, bottom: 0, left: 0 }, gap: '0px' },
    typography: { fontFamily: '"Inter", sans-serif', fontSize: '16px', fontWeight: '600', lineHeight: '1.2',
      letterSpacing: '0px', textAlign: 'center', textTransform: 'none', color: '#ffffff' },
    appearance: { backgroundColor: '#111111', opacity: '1',
      radius: { topLeft: '8px', topRight: '8px', bottomRight: '8px', bottomLeft: '8px' },
      borderWidth: { top: 0 }, borderStyle: 'none', borderColor: '#000000',
      shadow: { x: 0, y: 4, blur: 20, spread: 0, color: 'rgba(0,0,0,0.2)', inset: false } },
    accessibility: { accessibleName: 'Buy', attributes: {} },
    layoutContext: { self: 'flex', isFlexChild: false, isGridChild: false,
      flex: { direction: 'row', wrap: 'nowrap', justifyContent: 'center', alignItems: 'center', gap: '8px' } },
    svg: null, image: null, contrast: 3.1,
  };
}

test('light is the default appearance and dark only redefines colour', () => {
  const light = lightBlock();
  const dark = darkBlock();

  // The default block has to be complete on its own: the dark block is an override, so
  // anything defined only there would be missing until the user toggles.
  const lightNames = new Set([...light.matchAll(/(--[\w-]+):/g)].map((m) => m[1]));
  const darkOnly = [...dark.matchAll(/(--[\w-]+):/g)].map((m) => m[1]).filter((n) => !lightNames.has(n));
  assert.deepEqual(darkOnly, [], 'every dark token has a light default');

  assert.equal(tokenValue(light, '--surface'), '#FFFFFF', 'panels are light by default');
  assert.equal(tokenValue(dark, '--surface'), '#1B2336');
  assert.match(dark, /^:host\(\[data-widt-appearance="dark"\]\)/, 'dark is keyed off the host attribute');

  // Density, type and the page marks must not move when the appearance changes.
  for (const name of ['--space-5', '--text-body', '--control-h', '--selection', '--measure']) {
    assert.equal(tokenValue(dark, name), undefined, `${name} does not follow the appearance`);
  }
});

test('both appearances stay legible', () => {
  for (const [label, block] of [['light', lightBlock()], ['dark', darkBlock()]]) {
    for (const [fg, bg, floor] of [
      ['--fg', '--surface', 4.5], ['--fg-muted', '--surface', 4.5], ['--fg-dim', '--surface', 3],
      ['--fg', '--bg', 4.5], ['--accent', '--surface', 4.5], ['--on-accent', '--accent', 4.5],
      ['--danger', '--surface', 4.5], ['--warning', '--surface', 4.5],
      ['--ring', '--surface', 4.5], ['--on-selection', '--selection-strong', 4.5],
      ['--on-measure', '--measure', 4.5],
    ]) {
      const value = ratio(block, fg, bg);
      assert.ok(value >= floor, `${label}: ${fg} on ${bg} is ${value?.toFixed(2)}, below ${floor}`);
    }
  }
});

test('the appearance toggle names the state it moves to, and the shell stamps it', async () => {
  const inLight = renderToolbar({ mode: 'inspect', activePanel: 'inspector', appearance: 'light' });
  assert.match(inLight, /data-action="toggle-appearance"/);
  assert.match(inLight, /title="Switch to dark mode"/);
  assert.match(inLight, /aria-pressed="false"/);

  const inDark = renderToolbar({ mode: 'inspect', activePanel: 'inspector', appearance: 'dark' });
  assert.match(inDark, /title="Switch to light mode"/);
  assert.match(inDark, /aria-pressed="true"/);

  makeDom();
  const { App } = await import('../src/ui/app.js');
  const app = new App({ doc: document, view: window });
  app.mount();
  assert.equal(app.state.appearance, 'light', 'light unless the workspace says otherwise');
  assert.equal(app.host.getAttribute('data-widt-appearance'), 'light');
  assert.equal(app.host.style.colorScheme, 'light', 'native controls follow the chrome, not the page');

  app.update({ appearance: 'dark' });
  assert.equal(app.host.getAttribute('data-widt-appearance'), 'dark');
  assert.equal(app.host.style.colorScheme, 'dark');
  app.unmount();
});
