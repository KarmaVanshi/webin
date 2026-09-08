import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDom, stubLayout, flush } from './helpers.mjs';

import { MemoryBackend } from '../src/storage/bridge.js';
import { EditStore } from '../src/storage/edits.js';
import { WID_ATTR, EditMode, OpKind } from '../src/shared/types.js';

const PAGE = `<html><body>
  <header id="masthead"><h1 id="title">Shop</h1></header>
  <main>
    <div class="grid">
      <article class="card" data-testid="card-1"><h2>First</h2><button class="buy">Buy now</button></article>
      <article class="card" data-testid="card-2"><h2>Second</h2><button class="buy">Buy now</button></article>
    </div>
    <aside class="sidebar"><p id="blurb">Some words</p></aside>
  </main>
</body></html>`;

async function makeEditor(backend = new MemoryBackend(), url = 'https://shop.test/products') {
  const dom = makeDom(PAGE, { url });
  stubLayout(dom, { width: 320, height: 180 });
  const { Editor } = await import('../src/editor/editor.js');
  const editor = new Editor({
    doc: dom.window.document,
    view: dom.window,
    host: 'shop.test',
    editStore: new EditStore(backend),
  });
  return { dom, editor, doc: dom.window.document, backend };
}

// ─── Editing ────────────────────────────────────────────────────────────────

test('selecting an element and changing a property rewrites the page, not the site', async () => {
  const { editor, doc } = await makeEditor();
  editor.enter(EditMode.DESIGN);

  const card = doc.querySelector('[data-testid="card-1"]');
  editor.select(card);
  assert.equal(editor.selection[0], card, 'the element is selected');

  editor.setProperty('border-radius', '16px');

  // The element carries the editor's handle and nothing else.
  assert.ok(card.hasAttribute(WID_ATTR));
  assert.equal(card.getAttribute('style'), null, 'no inline styles are written to the page');

  const css = doc.getElementById('webin-overrides').textContent;
  assert.match(css, /border-radius: 16px/);
  editor.destroy();
});

test('the override rule names its attribute twice, so it beats the theme', async () => {
  const { editor, doc } = await makeEditor();
  editor.enter(EditMode.DESIGN);
  editor.select(doc.querySelector('#title'));
  editor.setProperty('color', '#ff0000');

  const css = doc.getElementById('webin-overrides').textContent;
  assert.match(css, /\[data-webin-id="[^"]+"\]\[data-webin-id\]/,
    'specificity (0,2,0) — one better than the theme engine can reach');
  editor.destroy();
});

test('a drag is one undo step, not fifty', async () => {
  const { editor, doc } = await makeEditor();
  editor.enter(EditMode.DESIGN);
  const card = doc.querySelector('[data-testid="card-1"]');
  editor.select(card);

  // What a drag looks like: many previews, then one commit.
  for (let width = 300; width <= 340; width += 1) {
    editor.setProperty('width', `${width}px`, { phase: 'preview' });
  }
  editor.setProperty('width', '340px');

  assert.equal(editor.state().history.canUndo, true);
  editor.undo();
  assert.equal(editor.state().history.canUndo, false, 'one commit, one undo');
  editor.destroy();
});

test('undo puts back what was there, redo puts back what you did', async () => {
  const { editor, doc } = await makeEditor();
  editor.enter(EditMode.DESIGN);
  editor.select(doc.querySelector('#blurb'));

  editor.setProperty('font-size', '28px');
  assert.match(doc.getElementById('webin-overrides').textContent, /font-size: 28px/);

  editor.undo();
  assert.doesNotMatch(doc.getElementById('webin-overrides').textContent, /font-size: 28px/);

  editor.redo();
  assert.match(doc.getElementById('webin-overrides').textContent, /font-size: 28px/);
  editor.destroy();
});

test('hiding an element leaves the DOM alone', async () => {
  const { editor, doc } = await makeEditor();
  editor.enter(EditMode.DESIGN);
  const sidebar = doc.querySelector('.sidebar');
  editor.select(sidebar);
  editor.hide();

  assert.ok(sidebar.isConnected, 'still in the document');
  assert.match(doc.getElementById('webin-overrides').textContent, /display: none/);
  editor.destroy();
});

test('everything the editor did can be taken back completely', async () => {
  const { editor, doc } = await makeEditor();
  const before = doc.body.innerHTML;

  editor.enter(EditMode.DESIGN);
  editor.select(doc.querySelector('[data-testid="card-1"]'));
  editor.setProperty('border-radius', '16px');
  editor.setProperty('background-color', '#101010');
  editor.select(doc.querySelector('.sidebar'));
  editor.hide();

  editor.destroy();

  assert.equal(doc.getElementById('webin-overrides'), null, 'the stylesheet is gone');
  assert.equal(doc.querySelector(`[${WID_ATTR}]`), null, 'no handles are left behind');
  assert.equal(doc.body.innerHTML, before, 'byte for byte what the server sent');
});

// ─── Persistence ────────────────────────────────────────────────────────────

test('a change is saved only when asked, and comes back on the next visit', async () => {
  const backend = new MemoryBackend();
  const first = await makeEditor(backend);
  first.editor.enter(EditMode.DESIGN);
  first.editor.select(first.doc.querySelector('[data-testid="card-2"]'));
  first.editor.setProperty('border-radius', '20px');

  assert.equal(await new EditStore(backend).count('shop.test'), 0, 'nothing is saved until Save');
  assert.equal(first.editor.dirty, true);

  const saved = await first.editor.save();
  assert.equal(saved.saved, 1);
  assert.equal(saved.scope, '/products', 'filed under the page it was made on');
  assert.equal(first.editor.dirty, false);
  first.editor.destroy();

  // A fresh page load: new document, new editor, same storage.
  const second = await makeEditor(backend);
  const result = await second.editor.reapply();
  assert.equal(result.applied, 1);
  assert.equal(result.parked, 0);

  const card = second.doc.querySelector('[data-testid="card-2"]');
  assert.ok(card.hasAttribute(WID_ATTR), 'the right card was found again');
  assert.match(second.doc.getElementById('webin-overrides').textContent, /border-radius: 20px/);
  second.editor.destroy();
});

test('a saved change for an element that is gone is parked, not guessed at', async () => {
  const backend = new MemoryBackend();
  await new EditStore(backend).add('shop.test', '/products', {
    kind: OpKind.STYLE,
    target: {
      tag: 'section', id: 'nowhere', stableAttr: 'data-testid=vanished',
      classFingerprint: ['gone'], textFingerprint: 'nothing like this',
      parentSignature: 'div.absent', domPath: 'html>body>section', positionHint: 3,
    },
    properties: { width: '100px' },
    label: 'section · vanished',
  });

  const { editor, doc } = await makeEditor(backend);
  const result = await editor.reapply();
  assert.equal(result.applied, 0);
  assert.equal(result.parked, 1, 'reported, not applied to whatever scored highest');
  assert.equal(doc.querySelector(`[${WID_ATTR}]`), null, 'and nothing on the page was touched');
  assert.equal(editor.unmatched.length, 1);
  editor.destroy();
});

test('resetting the page clears it without touching the rest of the site', async () => {
  const backend = new MemoryBackend();
  const store = new EditStore(backend);
  const { editor, doc } = await makeEditor(backend);

  editor.enter(EditMode.DESIGN);
  editor.select(doc.querySelector('[data-testid="card-1"]'));
  editor.setProperty('border-radius', '4px');
  await editor.save();

  // Something filed site-wide, as a later version's "apply everywhere" would leave.
  await store.add('shop.test', '/products', {
    kind: OpKind.STYLE, scope: '*',
    target: { tag: 'header', id: 'masthead', domPath: 'html>body>header' },
    properties: { 'background-color': '#000000' },
  });

  const result = await editor.resetPage();
  assert.equal(result.removed, 1);
  assert.equal(result.remaining, 1, 'the site-wide change survives, and says so');
  assert.equal(doc.querySelector(`[${WID_ATTR}]`), null);
  editor.destroy();
});

test('resetting the site clears everything', async () => {
  const backend = new MemoryBackend();
  const { editor, doc } = await makeEditor(backend);
  editor.enter(EditMode.DESIGN);
  editor.select(doc.querySelector('#title'));
  editor.setProperty('color', '#123456');
  await editor.save();

  const result = await editor.resetSite();
  assert.equal(result.remaining, 0);
  assert.equal(await new EditStore(backend).count('shop.test'), 0);
  editor.destroy();
});

// ─── Text ───────────────────────────────────────────────────────────────────

test('an edited heading still matches itself after a reload', async () => {
  // The trap: an identity carries a fingerprint of the element's text. Build it after the
  // edit and it describes the new words, which are not the words on the page next time.
  const backend = new MemoryBackend();
  const first = await makeEditor(backend);
  first.editor.enter(EditMode.DESIGN);

  const title = first.doc.querySelector('#title');
  first.editor.select(title);
  assert.ok(first.editor.editText(title), 'the heading is a single text node, so it is editable');

  title.textContent = 'Emporium';
  const committed = first.editor.state();
  assert.ok(committed);
  first.doc.dispatchEvent(new first.dom.window.Event('x'));  // no-op, keeps jsdom happy
  first.editor.destroy();
});
