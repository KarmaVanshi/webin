/**
 * End-to-end acceptance (§95 user journey, §127 milestone, §128 criteria).
 *
 * The milestone the concept calls the proof of the product:
 *   "Select any normal website element, visually change it, reload the page,
 *    and see the modification come back automatically."
 *
 * These tests drive the real Editor — the same code paths the browser runs — over a
 * jsdom page, and share one storage backend across two Editor instances to represent a
 * reload.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDom, stubLayout, flush, wait } from './helpers.mjs';
import { MemoryBackend } from '../src/storage/bridge.js';
import { Msg, Mode } from '../src/shared/types.js';

const PAGE = `<html><head><style>.card{width:280px;border-radius:8px;padding:16px}</style></head>
<body>
  <header><h1>Shop</h1></header>
  <main>
    <div class="product-card card" data-testid="card-1"><h3>Widget</h3>
      <button class="btn primary" data-testid="buy">Buy Now</button></div>
    <aside class="sidebar"><p>Promotions</p></aside>
  </main>
</body></html>`;

async function makeEditor(backend, url = 'https://shop.test/products') {
  stubLayout(makeDom(PAGE, { url }));
  const { Editor } = await import('../src/content/main.js');
  const editor = new Editor({ doc: document, view: window, backend });
  return editor;
}

test('journey: select, edit, save, reload, and the change comes back', async () => {
  const backend = new MemoryBackend();

  // ── Session one: open the editor and edit an element ──────────────────
  const editor = await makeEditor(backend);
  await editor.boot();
  await editor.open(Mode.DESIGN);
  assert.equal(editor.mode, Mode.DESIGN);

  const shadow = document.querySelector('[data-widt-id-host]').shadowRoot;
  assert.ok(shadow.querySelector('.widt-toolbar'), 'the workspace is up');

  // Click the card, exactly as a user would.
  const card = document.querySelector('.product-card');
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true, composed: true, button: 0 }));
  await flush();

  assert.match(shadow.querySelector('.widt-inspector-body').innerHTML, /product-card|div/,
    'the inspector shows the selection');

  // Change the width through the real control, as the panel would.
  const widthInput = [...shadow.querySelectorAll('[data-control="number"]')]
    .find((input) => input.dataset.prop === 'width');
  assert.ok(widthInput, 'the inspector offers a width field');
  widthInput.value = '380';
  widthInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  await flush();

  const css = document.getElementById('widt-overrides').textContent;
  assert.match(css, /width: 380px/, 'the page updates immediately');
  assert.match(card.getAttribute('data-widt-id') ?? '', /^w\d+$/, 'only a marker attribute is added');

  // Hide the sidebar, the concept's own example scenario (§96).
  document.querySelector('.sidebar').dispatchEvent(
    new window.MouseEvent('click', { bubbles: true, composed: true, button: 0 }));
  await flush();
  shadow.querySelector('[data-action="hide-selected"]').click();
  await flush();
  assert.match(document.getElementById('widt-overrides').textContent, /display: none !important/);

  // Save.
  await editor.handleMessage({ type: Msg.SAVE });
  const status = await editor.handleMessage({ type: Msg.GET_STATUS });
  assert.equal(status.dirty, false);
  assert.ok(status.changeCount >= 2, `expected saved changes, got ${status.changeCount}`);

  // ── Session two: a fresh page load with the same storage ──────────────
  const reloaded = await makeEditor(backend);
  await reloaded.boot();
  await flush();

  const reappliedCss = document.getElementById('widt-overrides').textContent;
  assert.match(reappliedCss, /width: 380px/, 'the width override returns after reload');
  assert.match(reappliedCss, /display: none !important/, 'the hidden sidebar stays hidden');

  const after = await reloaded.handleMessage({ type: Msg.GET_STATUS });
  assert.equal(after.unmatched, 0, 'both saved changes found their elements');
});

test('a saved change is scoped to its page, not the whole site', async () => {
  const backend = new MemoryBackend();
  const editor = await makeEditor(backend, 'https://shop.test/products');
  await editor.boot();
  await editor.open(Mode.DESIGN);

  const shadow = document.querySelector('[data-widt-id-host]').shadowRoot;
  document.querySelector('.product-card').dispatchEvent(
    new window.MouseEvent('click', { bubbles: true, composed: true, button: 0 }));
  await flush();
  const input = [...shadow.querySelectorAll('[data-control="number"]')].find((i) => i.dataset.prop === 'width');
  input.value = '380';
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
  await flush();
  await editor.handleMessage({ type: Msg.SAVE });

  // A different page on the same site must not inherit it.
  const other = await makeEditor(backend, 'https://shop.test/checkout');
  await other.boot();
  await flush();
  assert.equal(document.getElementById('widt-overrides').textContent, '',
    'the /products change does not leak onto /checkout');
});

test('reset returns the page to exactly what the site rendered', async () => {
  const backend = new MemoryBackend();
  const editor = await makeEditor(backend);
  await editor.boot();
  await editor.open(Mode.DESIGN);

  const shadow = document.querySelector('[data-widt-id-host]').shadowRoot;
  const card = document.querySelector('.product-card');
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true, composed: true, button: 0 }));
  await flush();
  const input = [...shadow.querySelectorAll('[data-control="number"]')].find((i) => i.dataset.prop === 'width');
  input.value = '380';
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
  await flush();
  await editor.handleMessage({ type: Msg.SAVE });

  const result = await editor.handleMessage({ type: Msg.RESET_PAGE });
  assert.ok(result.ok);
  assert.equal(document.getElementById('widt-overrides').textContent, '');
  assert.ok(!card.hasAttribute('data-widt-id'), 'the marker attribute is removed too');

  const reloaded = await makeEditor(backend);
  await reloaded.boot();
  await flush();
  assert.equal(document.getElementById('widt-overrides').textContent, '', 'the reset survives a reload');
});

test('undo and redo move the page between states', async () => {
  const backend = new MemoryBackend();
  const editor = await makeEditor(backend);
  await editor.boot();
  await editor.open(Mode.DESIGN);

  const shadow = document.querySelector('[data-widt-id-host]').shadowRoot;
  document.querySelector('.product-card').dispatchEvent(
    new window.MouseEvent('click', { bubbles: true, composed: true, button: 0 }));
  await flush();
  const input = [...shadow.querySelectorAll('[data-control="number"]')].find((i) => i.dataset.prop === 'width');
  input.value = '380';
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
  await flush();
  assert.match(document.getElementById('widt-overrides').textContent, /width: 380px/);

  await editor.handleMessage({ type: Msg.UNDO });
  await flush();
  assert.ok(!document.getElementById('widt-overrides').textContent.includes('width: 380px'), 'undo removes it');

  await editor.handleMessage({ type: Msg.REDO });
  await flush();
  assert.match(document.getElementById('widt-overrides').textContent, /width: 380px/, 'redo restores it');
});

test('a client-side route change re-scopes the editor', async () => {
  const backend = new MemoryBackend();
  const editor = await makeEditor(backend, 'https://shop.test/products');
  await editor.boot();

  let status = await editor.handleMessage({ type: Msg.GET_STATUS });
  assert.equal(status.path, '/products');

  window.history.pushState({}, '', '/settings');
  await wait(30);

  status = await editor.handleMessage({ type: Msg.GET_STATUS });
  assert.equal(status.path, '/settings', 'the editor follows History API navigation');
});

test('a saved change whose element is gone is reported, never guessed at', async () => {
  const backend = new MemoryBackend();
  const { SiteStore } = await import('../src/storage/site-store.js');
  const store = new SiteStore(backend);
  await store.addChange('shop.test', '/products', {
    kind: 'style', breakpoint: 'all', label: 'Hero banner',
    target: { tag: 'section', domPath: 'html>body>section', classFingerprint: ['hero-banner'], positionHint: 0 },
    properties: { width: '900px' },
  });

  const editor = await makeEditor(backend, 'https://shop.test/products');
  await editor.boot();
  const status = await editor.handleMessage({ type: Msg.GET_STATUS });
  assert.equal(status.unmatched, 1, 'the orphaned change is counted');
  assert.equal(document.getElementById('widt-overrides').textContent, '',
    'and nothing is applied to an unrelated element');
});

test('switching profile swaps the whole design layer', async () => {
  const backend = new MemoryBackend();
  const { SiteStore } = await import('../src/storage/site-store.js');
  const { ProfileStore } = await import('../src/storage/profile-store.js');
  const sites = new SiteStore(backend);
  const profiles = new ProfileStore(sites);

  const target = { tag: 'div', domPath: 'html>body>main>div', classFingerprint: ['card', 'product-card'],
    stableAttr: 'data-testid=card-1', positionHint: 0 };
  await sites.addChange('shop.test', '/products', { kind: 'style', breakpoint: 'all', target, properties: { width: '380px' } });
  const minimal = await profiles.create('shop.test', 'Minimal');
  await profiles.activate('shop.test', minimal.id);
  sites.invalidate();
  await sites.addChange('shop.test', '/products', { kind: 'style', breakpoint: 'all', target, properties: { width: '200px' } });

  const editor = await makeEditor(backend, 'https://shop.test/products');
  await editor.boot();
  await flush();
  assert.match(document.getElementById('widt-overrides').textContent, /width: 200px/, 'the active profile applies');

  const list = await editor.handleMessage({ type: Msg.LIST_PROFILES });
  const other = list.profiles.find((p) => !p.active);
  await editor.handleMessage({ type: Msg.SET_PROFILE, profileId: other.id });
  await flush();
  assert.match(document.getElementById('widt-overrides').textContent, /width: 380px/, 'switching swaps the layer');
});

test('journey: the editor opens light, and a chosen dark chrome comes back', async () => {
  const backend = new MemoryBackend();

  const editor = await makeEditor(backend);
  await editor.boot();
  await editor.open(Mode.DESIGN);

  const host = document.querySelector('[data-widt-id-host]');
  assert.equal(host.getAttribute('data-widt-appearance'), 'light', 'light is what a new user gets');

  // Flip it the way a user does: the toolbar button.
  host.shadowRoot.querySelector('[data-action="toggle-appearance"]')
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true, composed: true, button: 0 }));
  await flush();
  assert.equal(host.getAttribute('data-widt-appearance'), 'dark');
  assert.equal(host.style.colorScheme, 'dark');

  editor.close();

  // ── Reload ────────────────────────────────────────────────────────────
  const next = await makeEditor(backend);
  await next.boot();
  await next.open(Mode.DESIGN);

  const reopened = document.querySelector('[data-widt-id-host]');
  assert.equal(reopened.getAttribute('data-widt-appearance'), 'dark', 'the choice is remembered');
  assert.match(reopened.shadowRoot.querySelector('[data-action="toggle-appearance"]').outerHTML,
    /Switch to light mode/, 'and the toggle now offers the way back');
  next.destroy();
});
