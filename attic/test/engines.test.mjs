import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDom, wait } from './helpers.mjs';

test('identity signatures survive class churn but distinguish siblings', async () => {
  makeDom(`<body>
    <div class="product-card"><button class="btn primary" data-testid="buy">Buy Now</button></div>
    <div class="product-card"><button class="btn primary">Add to cart</button></div></body>`);
  const id = await import('../src/content/element-model/identity.js');

  assert.ok(id.isStableClass('product-card'));
  for (const generated of ['css-1x2y3z', 'sc-bdVaJa', 'px-[13px]', 'a', 'x1234567']) {
    assert.ok(!id.isStableClass(generated), `${generated} should be rejected`);
  }
  assert.ok(!id.isStableId(':r1a:'));

  const buy = document.querySelector('[data-testid=buy]');
  const signature = id.buildIdentity(buy);
  assert.equal(signature.stableAttr, 'data-testid=buy');
  assert.equal(signature.textFingerprint, 'buy now');
  assert.equal(signature.parentSignature, 'div.product-card');

  const resolved = id.resolveIdentity(document, signature);
  assert.equal(resolved.element, buy);
  assert.ok(resolved.confidence > 0.9);

  const sibling = document.querySelectorAll('button')[1];
  assert.ok(id.scoreCandidate(sibling, signature) < id.scoreCandidate(buy, signature));
});

test('an identity matching nothing reports low confidence rather than guessing', async () => {
  makeDom('<body><section><p>unrelated</p></section></body>');
  const { resolveIdentity } = await import('../src/content/element-model/identity.js');
  const result = resolveIdentity(document, { tag: 'button', domPath: 'html>body>button', classFingerprint: ['gone'], positionHint: 0 });
  assert.equal(result.element, null);
  assert.ok(result.confidence < 0.55);
});

test('identical twins are reported ambiguous, not applied to arbitrarily', async () => {
  makeDom('<body><ul><li class="row">Same</li><li class="row">Same</li></ul></body>');
  const { buildIdentity, resolveIdentity } = await import('../src/content/element-model/identity.js');
  const first = document.querySelectorAll('li')[0];
  const signature = buildIdentity(first);
  delete signature.domPath;
  signature.positionHint = -1;
  const result = resolveIdentity(document, signature);
  assert.ok(result.ambiguous, 'twins must not be silently matched');
});

test('the design tree folds pass-through wrappers but keeps ones that paint', async () => {
  makeDom(`<body><main>
    <div class="wrap"><div class="inner"><section id="hero"><h2>Hi</h2></section></div></div>
    <div class="padded" style="padding:12px"><p>Kept</p></div></main></body>`);
  const tree = await import('../src/content/element-model/tree.js');
  const main = document.querySelector('main');
  assert.ok(tree.isPassThroughWrapper(document.querySelector('.wrap'), window));
  assert.ok(!tree.isPassThroughWrapper(document.querySelector('.padded'), window));
  assert.equal(tree.treeChildren(main, window)[0].id, 'hero');
  assert.equal(tree.unwrap(document.querySelector('.wrap'), window).id, 'hero');
});

test('repeated components are detected structurally', async () => {
  const dom = makeDom('<body><ul><li class="card"><span>A</span></li><li class="card"><span>B</span></li><li class="card"><span>C</span></li><li class="other"><b>D</b></li></ul></body>');
  const { stubRects } = await import('./helpers.mjs');
  stubRects(dom, { '.card': { width: 200, height: 100 }, '.other': { width: 90, height: 40 } });
  const { findSimilar } = await import('../src/content/element-model/tree.js');
  assert.equal(findSimilar(document.querySelector('.card'), window).length, 2);
});

test('layers get meaningful names, and only plain text is editable', async () => {
  makeDom('<body><header><h1>Site</h1></header><li class="card"><span>A</span></li><div id="mixed">text <b>b</b></div></body>');
  const { labelFor, singleLineText } = await import('../src/content/element-model/model.js');
  assert.equal(labelFor(document.querySelector('header')), 'Header');
  assert.equal(labelFor(document.querySelector('h1')), 'H1 · Site');
  assert.equal(labelFor(document.querySelector('li')), 'li · A');
  assert.equal(singleLineText(document.querySelector('li')), null, 'an element with children is not text-editable');
  assert.equal(singleLineText(document.querySelector('span')), 'A');
});

test('grid track maths handles nested functions', async () => {
  const layout = await import('../src/content/inspector-engine/layout.js');
  assert.equal(layout.countTracks('100px 1fr 2fr'), 3);
  assert.equal(layout.countTracks('repeat(3, minmax(0, 1fr))'), 1);
  assert.equal(layout.countTracks('minmax(0, 1fr) 200px'), 2);
  assert.equal(layout.countTracks('none'), 0);
});

test('movement strategy speaks the element own layout language', async () => {
  const { movementStrategy, alignmentStrategy } = await import('../src/content/inspector-engine/layout.js');
  assert.equal(movementStrategy({ positionKind: 'absolute' }).kind, 'offset');
  assert.equal(movementStrategy({ isGridChild: true }).kind, 'grid');
  assert.equal(movementStrategy({ isFlexChild: true }).kind, 'flex-order');
  assert.equal(movementStrategy({}).kind, 'margin', 'flow elements move by margin, never by injected absolute positioning');
  assert.equal(alignmentStrategy({ isFlexChild: true, parentFlex: { direction: 'row' } }).horizontal.property, 'justify-content');
  assert.equal(alignmentStrategy({ isGridChild: true }).horizontal.property, 'justify-self');
});

test('drag maps pointer position onto grid tracks', async () => {
  const { trackEdges, trackIndexAt } = await import('../src/content/visual-editor/interactions.js');
  const edges = trackEdges('100px 200px 100px', 10);
  assert.deepEqual(edges, [0, 110, 320]);
  assert.equal(trackIndexAt(edges, 0), 0);
  assert.equal(trackIndexAt(edges, 150), 1);
  assert.equal(trackIndexAt(edges, 999), 2);
  assert.equal(trackIndexAt(edges, -50), 0);
});

test('the override stylesheet writes attribute rules and scoped media queries', async () => {
  makeDom('<html><head></head><body><div id="t"></div></body></html>');
  const { OverrideStylesheet, ensureWid, STYLE_ID } = await import('../src/content/override-engine/stylesheet.js');
  const el = document.getElementById('t');
  const wid = ensureWid(el);
  assert.equal(ensureWid(el), wid, 'the id is reused, not regenerated');

  const sheet = new OverrideStylesheet(document);
  sheet.mount();
  const result = sheet.set(wid, { width: '380px', 'border-radius': '16px', behavior: 'evil' });
  assert.equal(result.applied.length, 2);
  assert.equal(result.rejected[0].property, 'behavior');

  sheet.set(wid, { padding: '16px' }, { breakpoint: 'mobile' });
  sheet.flush();
  const css = document.getElementById(STYLE_ID).textContent;
  assert.match(css, /\[data-widt-id="w\d+"\]/);
  assert.match(css, /max-width: 480px/);
  assert.ok(css.indexOf('width: 380px') < css.indexOf('@media'), 'unscoped rules come first so scoped ones win');
});

test('all five override levels apply and revert exactly', async () => {
  makeDom(`<html><head><style>#t{width:100px}</style></head><body>
    <div id="t">Hello</div><aside class="side">x</aside>
    <a id="lnk" href="/a" aria-label="Go">L</a><div id="mixed">text <b>bold</b></div></body></html>`);
  const { OverrideEngine } = await import('../src/content/override-engine/override-engine.js');
  const engine = new OverrideEngine({ doc: document, view: window });
  engine.mount();
  const t = document.getElementById('t');
  const link = document.getElementById('lnk');

  assert.ok(engine.apply(t, { kind: 'style', breakpoint: 'all', properties: { width: '380px' } }).ok);
  assert.equal(engine.overrideValue(t, 'width'), '380px');

  assert.ok(engine.apply(link, { kind: 'attribute', attributes: { 'aria-label': 'Buy now' } }).ok);
  assert.ok(!engine.apply(link, { kind: 'attribute', attributes: { href: 'javascript:alert(1)' } }).ok);
  assert.ok(!engine.apply(link, { kind: 'attribute', attributes: { onclick: 'x' } }).ok);

  assert.ok(engine.apply(t, { kind: 'text', text: 'Goodbye' }).ok);
  assert.equal(t.textContent, 'Goodbye');
  assert.ok(!engine.apply(document.getElementById('mixed'), { kind: 'text', text: 'x' }).ok);
  assert.ok(document.getElementById('mixed').querySelector('b'), 'child elements are never destroyed');

  const side = document.querySelector('.side');
  engine.apply(side, { kind: 'hide' });
  engine.stylesheet.flush();
  assert.match(document.getElementById('widt-overrides').textContent, /display: none !important/);
  assert.ok(side.isConnected, 'hide leaves the DOM intact');

  engine.apply(side, { kind: 'remove' });
  assert.ok(!side.isConnected);
  engine.restore(side);
  assert.equal(side.previousElementSibling.id, 't', 'restored to its original slot');

  engine.revertAll();
  engine.stylesheet.flush();
  assert.equal(t.textContent, 'Hello');
  assert.equal(link.getAttribute('aria-label'), 'Go');
  assert.ok(!t.hasAttribute('data-widt-id'), 'no trace left on the page');
  assert.equal(document.getElementById('widt-overrides').textContent, '');
});

test('history groups a gesture into one reversible operation', async () => {
  const { HistoryEngine } = await import('../src/content/history/history-engine.js');
  const history = new HistoryEngine();

  history.begin('Moved Product Card');
  for (let i = 0; i < 50; i += 1) history.add({ changeId: 'c1', property: 'left', before: '0px', after: `${i}px` });
  history.add({ changeId: 'c1', property: 'top', before: '0px', after: '20px' });
  const op = history.commit();
  assert.equal(op.entries.length, 2, '50 preview frames collapse to 2 properties');
  assert.equal(op.entries[0].after, '49px');
  assert.equal(history.list()[0].label, 'Moved Product Card');

  history.begin('No-op');
  history.add({ changeId: 'c2', property: 'left', before: '0px', after: '0px' });
  assert.equal(history.commit(), null, 'a gesture that changed nothing is not recorded');

  assert.equal(history.undo().id, op.id);
  assert.ok(history.canRedo && !history.canUndo);
  assert.equal(history.redo().id, op.id);

  history.begin('Outer');
  history.begin('Inner');
  history.add({ changeId: 'c3', property: 'x', before: '1', after: '2' });
  assert.equal(history.commit(), null, 'a nested commit does not close the transaction');
  assert.ok(history.commit());

  const target = history.list()[0].id;
  assert.ok(history.revertOperation(target));
  assert.ok(!history.list().some((o) => o.id === target));
});

test('the monitor coalesces bursts and ignores the extension own writes', async () => {
  makeDom('<html><body><div id="a"></div></body></html>');
  const { MutationMonitor } = await import('../src/content/mutation-monitor/monitor.js');
  const monitor = new MutationMonitor({ doc: document, view: window });
  let structure = 0;
  monitor.on('structure', () => { structure += 1; });
  monitor.start();

  const a = document.getElementById('a');
  a.append(document.createElement('span'), document.createElement('span'));
  await wait(140);
  assert.equal(structure, 1, 'a burst becomes one notification');

  monitor.suspend(() => a.setAttribute('data-widt-id', 'w1'));
  const owned = document.createElement('div');
  owned.setAttribute('data-widt-owned', '');
  document.body.append(owned);
  await wait(140);
  assert.equal(structure, 1, 'suspended and extension-owned mutations are ignored');

  a.append(document.createElement('p'));
  await wait(140);
  assert.equal(structure, 2, 'real page mutations still fire');
  monitor.stop();
});

test('client-side navigation is detected and the patch is reversible', async () => {
  const dom = makeDom('<html><body></body></html>', { url: 'https://x.com/one' });
  const { watchRoute } = await import('../src/content/mutation-monitor/monitor.js');
  const seen = [];
  const stop = watchRoute(dom.window, (url, previous) => seen.push([previous, url]));
  dom.window.history.pushState({}, '', '/two');
  dom.window.history.replaceState({}, '', '/three');
  assert.equal(seen.length, 2);
  assert.match(seen[0][1], /\/two$/);
  stop();
  dom.window.history.pushState({}, '', '/four');
  assert.equal(seen.length, 2, 'the History API is restored on stop');
});
