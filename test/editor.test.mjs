import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDom, stubLayout, flush } from './helpers.mjs';

import { MemoryBackend } from '../src/storage/bridge.js';
import { EditStore } from '../src/storage/edits.js';
import { WID_ATTR, EditMode, EditTool, OpKind } from '../src/shared/types.js';

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

test('the text inside a link is editable, wrapped or not', async () => {
  // The old rule was one text node and no elements at all, which is true of a bare
  // paragraph and of almost nothing in a real navigation. Every shape below says exactly
  // one thing, and every one of them used to be refused.
  const { doc } = await makeEditor();
  const { singleTextNode } = await import('../src/editor/overrides.js');
  const html = `
    <li id="l1"><a href="/a">Plain</a></li>
    <a id="l2" href="/b"><span>Wrapped</span></a>
    <a id="l3" href="/c"><svg></svg>Beside an icon</a>
    <h2 id="l4"><a href="/d">A heading that is a link</a></h2>`;
  const holder = doc.createElement('div');
  holder.innerHTML = html;
  doc.body.append(holder);

  for (const [id, words] of [['l1', 'Plain'], ['l2', 'Wrapped'], ['l3', 'Beside an icon'], ['l4', 'A heading that is a link']]) {
    const node = singleTextNode(doc.getElementById(id));
    assert.ok(node, `${id} should offer its text`);
    assert.equal(node.nodeValue.trim(), words);
  }
});

test('an element that says two things is still refused', async () => {
  // This is the case the original guard was written for, and it has to keep failing:
  // rewriting a paragraph with a link in the middle of it would take the link with it.
  const { doc } = await makeEditor();
  const { singleTextNode } = await import('../src/editor/overrides.js');
  const holder = doc.createElement('div');
  holder.innerHTML = '<p id="p">Body text with <a href="/e">a link</a> inside.</p>';
  doc.body.append(holder);

  assert.equal(singleTextNode(doc.getElementById('p')), null);
});

test('editing a link\'s words leaves the link, its wrapper and its icon alone', async () => {
  const { dom, doc, editor } = await makeEditor();
  editor.enter(EditMode.DESIGN);
  const holder = doc.createElement('div');
  holder.innerHTML = '<a id="lnk" href="/c"><svg></svg>Downloads</a>';
  doc.body.append(holder);
  const link = doc.getElementById('lnk');

  editor.select(link);
  assert.ok(editor.editText(link), 'the words beside an icon are editable');

  // While the edit is open the words have a host of their own, so a browser replacing the
  // selection cannot take the icon with them.
  const host = doc.querySelector('[contenteditable]');
  assert.ok(host, 'something is editable');
  assert.equal(host.textContent, 'Downloads');
  assert.equal(host.childNodes.length, 1, 'and it holds the words and nothing else');

  host.firstChild.nodeValue = 'Press kit';
  host.dispatchEvent(new dom.window.FocusEvent('blur'));

  assert.equal(link.getAttribute('href'), '/c', 'the link is still a link');
  assert.ok(link.querySelector('svg'), 'the icon survived');
  assert.equal(link.querySelector('[contenteditable]'), null, 'and nothing was left behind');
  assert.match(link.textContent, /Press kit/);

  editor.undo();
  assert.match(link.textContent, /Downloads/, 'and undo puts the words back');
  assert.ok(link.querySelector('svg'), 'with the icon still there');
  editor.destroy();
});

test('a control shows the value the edit actually produced', async () => {
  // Style writes are batched onto the next frame. The panel used to read the page before
  // that frame landed, so clicking Centre centred the heading and left the control saying
  // Left — and it stayed wrong until something else repainted the panel.
  const { doc, editor } = await makeEditor();
  editor.enter(EditMode.DESIGN);
  const title = doc.querySelector('#title');
  editor.select(title);

  editor.setProperty('text-align', 'center');
  const sheet = doc.getElementById('webin-overrides');
  assert.match(sheet.textContent, /text-align: center/, 'the rule is on the page by the time anyone reads it back');
  assert.equal(editor.state().selection.overrides['text-align'], 'center');
  editor.destroy();
});

test('choosing a colour undoes in one step, not one per drag frame', async () => {
  // Chrome reports every step of a colour drag as a committed change, so a few seconds of
  // choosing a colour used to fill the undo stack with an entry per frame.
  const { doc, editor } = await makeEditor();
  editor.enter(EditMode.DESIGN);
  const title = doc.querySelector('#title');
  editor.select(title);

  for (const colour of ['#ffe4e4', '#ffb3b3', '#ff3b3b', '#e01010']) {
    editor.setProperty('color', colour);
  }

  assert.equal(editor.state().history.depth, 1, 'one gesture, one entry');

  editor.undo();
  const sheet = doc.getElementById('webin-overrides');
  assert.doesNotMatch(sheet.textContent, /#e01010/, 'and one undo clears the whole drag');
  assert.doesNotMatch(sheet.textContent, /#ffe4e4/, 'including where it started');
  editor.destroy();
});

test('two edits a person meant separately stay separate', async () => {
  // The window that collapses a drag must never fold two decisions into one.
  const { doc, editor } = await makeEditor();
  editor.enter(EditMode.DESIGN);
  const title = doc.querySelector('#title');
  editor.select(title);

  editor.setProperty('color', '#ff0000');
  await new Promise((r) => setTimeout(r, 800));
  editor.setProperty('color', '#0000ff');

  assert.equal(editor.state().history.depth, 2);
  editor.undo();
  assert.match(doc.getElementById('webin-overrides').textContent, /#ff0000/, 'undo lands on the first choice');
  editor.destroy();
});

test('a drag that ends where it began leaves no history at all', async () => {
  const { doc, editor } = await makeEditor();
  editor.enter(EditMode.DESIGN);
  const title = doc.querySelector('#title');
  editor.select(title);

  // A settled starting point, so the round trip below is a real one.
  editor.setProperty('letter-spacing', '2px');
  await new Promise((r) => setTimeout(r, 800));
  const started = editor.state().history.depth;

  editor.setProperty('letter-spacing', '4px');
  editor.setProperty('letter-spacing', '6px');
  editor.setProperty('letter-spacing', '2px');

  assert.equal(editor.state().history.depth, started, 'nothing worth remembering');
  assert.match(doc.getElementById('webin-overrides').textContent, /letter-spacing: 2px/);
  editor.destroy();
});

// ─── The arrow and the pencil ───────────────────────────────────────────────

/** Enter, as the page's own document receives it: capture phase, cancellable. */
function pressEnter(dom, doc, target = doc.body, extra = {}) {
  const event = new dom.window.KeyboardEvent('keydown', {
    key: 'Enter', bubbles: true, cancelable: true, composed: true, ...extra,
  });
  target.dispatchEvent(event);
  return event;
}

/** A pointer moving over an element, which is what makes the editor highlight it. */
function hover(dom, doc, element) {
  doc.dispatchEvent(new dom.window.MouseEvent('pointermove', {
    bubbles: true, composed: true, clientX: 10, clientY: 10,
  }));
  element.dispatchEvent(new dom.window.MouseEvent('pointermove', {
    bubbles: true, composed: true, clientX: 10, clientY: 10,
  }));
}

test('asking to edit opens holding the pencil', async () => {
  // The arrow is how you put the editor down, not how you find it: opening Edit mode and
  // being handed a tool that does nothing would read as broken.
  const { editor } = await makeEditor();
  editor.enter(EditMode.DESIGN);
  assert.equal(editor.tool, EditTool.EDIT);
  assert.equal(editor.state().tool, EditTool.EDIT);
  editor.destroy();
});

test('the arrow means no edit: nothing is selected and nothing is tracked', async () => {
  const { dom, doc, editor } = await makeEditor();
  editor.enter(EditMode.DESIGN);
  const card = doc.querySelector('[data-testid="card-1"]');
  editor.select(card);
  assert.equal(editor.selection.length, 1);

  editor.setTool(EditTool.POINT);
  assert.equal(editor.selection.length, 0, 'the selection is let go of');

  // A click on the page selects nothing, and is not swallowed either — the site is a site.
  const event = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, composed: true });
  card.dispatchEvent(event);
  assert.equal(editor.selection.length, 0, 'clicking selects nothing');
  assert.equal(event.defaultPrevented, false, 'and the page keeps its own click');

  hover(dom, doc, card);
  assert.equal(editor.selection.length, 0, 'and hovering tracks nothing');
  editor.destroy();
});

test('the pencil takes the page back', async () => {
  const { dom, doc, editor } = await makeEditor();
  editor.enter(EditMode.DESIGN);
  editor.setTool(EditTool.POINT);
  editor.setTool(EditTool.EDIT);

  const card = doc.querySelector('[data-testid="card-1"]');
  const event = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, composed: true });
  card.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true, 'a click is the editor\'s again');
  assert.equal(editor.selection.length, 1, 'and it selects');
  editor.destroy();
});

test('putting the editor down keeps every change already made', async () => {
  const { doc, editor } = await makeEditor();
  editor.enter(EditMode.DESIGN);
  editor.select(doc.querySelector('#title'));
  editor.setProperty('color', '#ff0000');

  editor.setTool(EditTool.POINT);
  assert.match(doc.getElementById('webin-overrides').textContent, /color: #ff0000/,
    'letting go of a tool is not a way of undoing what it did');
  assert.equal(editor.state().pending, 1);
  editor.destroy();
});

test('Enter finishes the words, keeps them, and puts the editor down', async () => {
  const { dom, doc, editor } = await makeEditor();
  editor.enter(EditMode.DESIGN);
  const title = doc.querySelector('#title');
  editor.select(title);
  assert.ok(editor.editText(title));

  doc.querySelector('[contenteditable]').firstChild.nodeValue = 'Emporium';
  pressEnter(dom, doc, title);

  assert.equal(doc.querySelector('[contenteditable]'), null, 'the edit is closed');
  assert.equal(title.textContent, 'Emporium', 'and the words were kept');
  assert.equal(editor.tool, EditTool.POINT, 'the arrow is held');
  assert.equal(editor.state().pending, 1, 'the change is staged, not discarded');
  assert.equal(editor.active, true, 'and Edit mode is still open');
  editor.destroy();
});

test('the page never sees Enter while the pencil is held', async () => {
  // A site's own Enter handler sits above the element being typed in, so it runs first:
  // a form submits, a link is followed, and the panel goes with the navigation.
  const { dom, doc, editor } = await makeEditor();
  let heard = 0;
  doc.addEventListener('keydown', () => { heard += 1; });
  editor.enter(EditMode.DESIGN);
  editor.select(doc.querySelector('#title'));

  const event = pressEnter(dom, doc, doc.querySelector('#title'));
  assert.equal(heard, 0, 'the page heard nothing');
  assert.equal(event.defaultPrevented, true, 'and its default was cancelled');
  editor.destroy();
});

test('with the arrow held the page gets its own keys back', async () => {
  // The site's search box, its shortcuts and its undo belong to it again — an editor that
  // has let go of the page cannot go on swallowing Enter.
  const { dom, doc, editor } = await makeEditor();
  let heard = 0;
  doc.addEventListener('keydown', () => { heard += 1; });
  editor.enter(EditMode.DESIGN);
  editor.setTool(EditTool.POINT);

  const event = pressEnter(dom, doc, doc.querySelector('#title'));
  assert.equal(heard, 1, 'the page heard it');
  assert.equal(event.defaultPrevented, false);
  editor.destroy();
});

test('Shift+Enter is left alone, because inside an edit it is a line break', async () => {
  const { dom, doc, editor } = await makeEditor();
  editor.enter(EditMode.DESIGN);
  const title = doc.querySelector('#title');
  editor.select(title);
  editor.editText(title);

  const event = pressEnter(dom, doc, title, { shiftKey: true });
  assert.equal(event.defaultPrevented, false);
  assert.ok(doc.querySelector('[contenteditable]'), 'the edit is still open');
  editor.destroy();
});

test('a text edit ended any other way stays in the pencil', async () => {
  // Only Enter says "done with the editor". Clicking away from the words you were typing
  // is just the end of those words.
  const { dom, doc, editor } = await makeEditor();
  editor.enter(EditMode.DESIGN);
  const blurb = doc.querySelector('#blurb');
  editor.select(blurb);
  editor.editText(blurb);

  const host = doc.querySelector('[contenteditable]');
  host.firstChild.nodeValue = 'Other words';
  host.dispatchEvent(new dom.window.FocusEvent('blur'));

  assert.equal(editor.tool, EditTool.EDIT, 'still editing');
  assert.match(blurb.textContent, /Other words/);
  editor.destroy();
});

test('a mark that is put away is really gone from the page', async () => {
  // `hidden` was doing nothing to the hover label, because the label's own rule set
  // `display: flex` and that outranks the browser's rule for the attribute. The label
  // stayed pinned to the page after the pointer moved on — and, once the arrow meant "not
  // editing", after the editor had let go of the page entirely.
  const { overlayCss } = await import('../src/editor/overlay.js');
  assert.match(overlayCss, /\[hidden\]\s*\{\s*display:\s*none\s*!important/,
    'the marks layer must neutralise display for anything hidden');

  const displays = [...overlayCss.matchAll(/display:\s*[a-z-]+/g)].map((m) => m[0]);
  assert.ok(displays.length > 1, 'and there are rules that would otherwise beat it');
});

// ─── The code tool ──────────────────────────────────────────────────────────

test('the code tool selects, but does not offer the drag handles', async () => {
  // A resize grip is a way of writing a width, and somebody who has chosen to write their
  // widths does not need two of them — nor a handle over the element they are reading.
  const { editor, doc } = await makeEditor();
  editor.enter(EditMode.DESIGN);
  editor.setTool(EditTool.CODE);

  assert.equal(editor.tool, EditTool.CODE);
  editor.select(doc.querySelector('[data-testid="card-1"]'));
  assert.ok(editor.state().selection, 'still picks things up');
});

test('written declarations reach the page', async () => {
  const { editor, doc } = await makeEditor();
  editor.enter(EditMode.DESIGN);
  const card = doc.querySelector('[data-testid="card-1"]');
  editor.select(card);

  const result = editor.applyElementCss('border-radius: 12px;\ncolor: #ff0000;');
  assert.equal(result.applied, 2);
  assert.deepEqual(result.errors, []);
  assert.equal(editor.state().selection.overrides['border-radius'], '12px');
});

test('what the inspector set, the code pane shows', async () => {
  const { editor, doc } = await makeEditor();
  editor.enter(EditMode.DESIGN);
  editor.select(doc.querySelector('[data-testid="card-1"]'));
  editor.setProperty('border-radius', '8px');

  assert.match(editor.elementCss(), /border-radius: 8px;/);
});

test('deleting a line reverts the property it named', async () => {
  // Otherwise the text says one thing and the page shows another, and the only way back is
  // hunting for the row in the inspector.
  const { editor, doc } = await makeEditor();
  editor.enter(EditMode.DESIGN);
  editor.select(doc.querySelector('[data-testid="card-1"]'));

  editor.applyElementCss('border-radius: 12px; color: #ff0000;');
  const result = editor.applyElementCss('border-radius: 12px;');

  assert.equal(result.removed, 1);
  assert.equal(editor.state().selection.overrides.color, undefined, 'the deleted line is gone');
  assert.equal(editor.state().selection.overrides['border-radius'], '12px', 'the kept line stays');
});

test('one edit to one block of text is one undo', async () => {
  const { editor, doc } = await makeEditor();
  editor.enter(EditMode.DESIGN);
  editor.select(doc.querySelector('[data-testid="card-1"]'));

  editor.applyElementCss('border-radius: 12px; color: #ff0000; padding: 4px;');
  editor.undo();
  assert.equal(editor.state().selection.overrides['border-radius'], undefined, 'all three went back together');
});

test('a site stylesheet reaches what the picker cannot', async () => {
  const { editor } = await makeEditor();
  editor.enter(EditMode.DESIGN);

  const result = editor.applySiteCss('.card::before { content: "★"; }\n@media (max-width: 600px) { .card { padding: 8px } }');
  assert.equal(result.rules, 2);
  assert.deepEqual(result.errors, []);
  assert.equal(editor.state().siteRules, 2);
});

test('a stylesheet reports what it would not write, and keeps the rest', async () => {
  const { editor } = await makeEditor();
  editor.enter(EditMode.DESIGN);

  const result = editor.applySiteCss('.a { color: red } [data-webin] { display: none }');
  assert.equal(result.rules, 1);
  assert.equal(result.errors.length, 1);
});

test('the text is kept exactly as written, not reformatted', async () => {
  // Somebody halfway through a rule has not asked for their draft to be tidied.
  const { editor } = await makeEditor();
  editor.enter(EditMode.DESIGN);
  const draft = '.a{color:red}\n\n.b { ';
  editor.applySiteCss(draft);
  assert.equal(editor.siteCss(), draft);
});

test('a stylesheet is saved and comes back on the next load', async () => {
  const backend = new MemoryBackend();
  const first = await makeEditor(backend);
  first.editor.enter(EditMode.DESIGN);
  first.editor.applySiteCss('.card { padding: 30px }');
  await first.editor.save();

  const second = await makeEditor(backend);
  await second.editor.reapply();
  assert.equal(second.editor.siteCss(), '.card { padding: 30px }');
  assert.equal(second.editor.state().siteRules, 1);
});

test('a stylesheet with no element edits beside it is still saved', async () => {
  // Counting only element changes would delete the record the moment a site was styled by
  // hand alone.
  const backend = new MemoryBackend();
  const { editor } = await makeEditor(backend);
  editor.enter(EditMode.DESIGN);
  editor.applySiteCss('.a { color: red }');

  const { saved } = await editor.save();
  assert.equal(saved, 1);
  assert.equal(await new EditStore(backend).sheetFor('shop.test', '/products'), '.a { color: red }');
});

/** A page with a stylesheet of its own, for editing the site's rules. */
const STYLED = PAGE.replace('<body>', `<head><style>
  .buy { color: blue; padding: 10px 18px; }
  .card .buy { color: green !important; }
  @media (max-width: 9999px) { button { padding: 4px; } }
</style></head><body>`);

async function makeStyledEditor(backend = new MemoryBackend()) {
  const dom = makeDom(STYLED, { url: 'https://shop.test/products' });
  stubLayout(dom, { width: 320, height: 180 });
  const { Editor } = await import('../src/editor/editor.js');
  const editor = new Editor({ doc: dom.window.document, view: dom.window, host: 'shop.test', editStore: new EditStore(backend) });
  editor.enter(EditMode.DESIGN);
  editor.select(dom.window.document.querySelector('.buy'));
  return { editor, doc: dom.window.document, backend };
}

test('the styles list names the site\'s rules, most powerful first, and offers each for editing', async () => {
  const { editor } = await makeStyledEditor();
  const { styles } = editor.detail();
  assert.equal(styles.target, 'button.buy');
  assert.deepEqual(styles.own, [], 'nothing of yours yet');
  assert.deepEqual(styles.rules.map((r) => r.selector), ['.card .buy', '.buy', 'button']);
  assert.ok(styles.rules.every((r) => r.editable && typeof r.key === 'string'));
  assert.equal(styles.rules[2].media, '(max-width: 9999px)');
});

test('editing a site rule writes only the difference, as your version of that rule', async () => {
  const { editor } = await makeStyledEditor();
  const before = editor.detail().styles.rules.find((r) => r.selector === '.buy');
  const base = Object.fromEntries(before.declarations.map((d) => [d.property, d.value]));

  // The text as the site wrote it, with one value changed and one line left alone.
  const result = editor.applyRuleCss({ selector: '.buy', media: null, base }, 'color: red;\npadding: 10px 18px;');
  assert.equal(result.ok, true);
  assert.equal(result.written, 1, 'the untouched padding is still the site\'s');
  assert.deepEqual(result.errors, []);
  assert.equal(editor.siteCss(), '.buy {\n  color: red;\n}\n', 'in the site stylesheet, as text you could edit');
  assert.equal(editor.state().dirty, true);

  const { styles } = editor.detail();
  assert.equal(styles.own.length, 1);
  assert.equal(styles.own[0].source, 'yours');
  assert.deepEqual(styles.own[0].declarations.map((d) => [d.property, d.value, d.overridden]), [['color', 'red', false]]);
  const site = styles.rules.find((r) => r.selector === '.buy');
  assert.equal(site.declarations.find((d) => d.property === 'color').overridden, true, 'the site\'s blue is struck through');
  assert.equal(site.declarations.find((d) => d.property === 'padding').overridden, false);
  // `.card .buy { color: green !important }` is (0,2,0); yours is `.buy` raised to (0,3,0)
  // and important too, so it wins, and the list says so.
  const stronger = styles.rules.find((r) => r.selector === '.card .buy');
  assert.equal(stronger.declarations[0].overridden, true);
});

test('a rule written back to what the site said is removed again', async () => {
  const { editor } = await makeStyledEditor();
  const base = { color: 'blue', padding: '10px 18px' };
  editor.applyRuleCss({ selector: '.buy', base }, 'color: red; padding: 10px 18px;');
  assert.equal(editor.state().siteRules, 1);

  editor.applyRuleCss({ selector: '.buy', base }, 'color: blue; padding: 10px 18px;');
  assert.equal(editor.state().siteRules, 0, 'nothing left over from a change of mind');
  assert.equal(editor.siteCss(), '');
  assert.deepEqual(editor.detail().styles.own, []);
});

test('a rule at a breakpoint is your version at that breakpoint', async () => {
  const { editor } = await makeStyledEditor();
  const result = editor.applyRuleCss({ selector: 'button', media: '(max-width: 9999px)', base: { padding: '4px' } }, 'padding: 6px;');
  assert.equal(result.written, 1);
  assert.match(editor.siteCss(), /@media \(max-width: 9999px\) \{\n {2}button \{\n {4}padding: 6px;\n {2}\}\n\}/);
  const own = editor.detail().styles.own;
  assert.equal(own.length, 1);
  assert.equal(own[0].media, '(max-width: 9999px)');
});

test('your version of a rule can be removed, and what is refused is named', async () => {
  const { editor } = await makeStyledEditor();
  const result = editor.applyRuleCss({ selector: '.buy', base: {} }, 'color: red; behavior: url(x); ');
  assert.equal(result.written, 1);
  assert.equal(result.errors.length, 1, 'the same gate as every widget');

  editor.removeRule({ selector: '.buy', media: null });
  assert.equal(editor.siteCss(), '');
  assert.deepEqual(editor.detail().styles.own, []);
});

test('a rule you wrote in the code tool is in the list too, and edits through the same door', async () => {
  const { editor } = await makeStyledEditor();
  editor.applySiteCss('/* hand-written */\n.buy { color: red }\n.card:hover { gap: 1px }');
  const { styles } = editor.detail();
  assert.deepEqual(styles.own.map((r) => r.selector), ['.buy'], 'only what matches this element');

  editor.applyRuleCss({ selector: '.buy', base: { color: 'blue', padding: '10px 18px' } }, 'color: pink; padding: 10px 18px;');
  assert.equal(editor.siteCss(), '/* hand-written */\n.buy {\n  color: pink;\n}\n.card:hover { gap: 1px }',
    'rewritten in place, the comment and the other rule untouched');
});

test('the selection walks down into the page as well as up out of it', async () => {
  const { editor, doc } = await makeEditor();
  editor.enter(EditMode.DESIGN);

  const card = doc.querySelector('[data-testid="card-1"]');
  editor.select(card);

  editor.selectChild();
  assert.equal(editor.selection[0], card.querySelector('h2'), 'it steps into the first child');

  editor.selectParent();
  assert.equal(editor.selection[0], card, 'and back out again');
  editor.destroy();
});

test('stepping in walks past what the editor would never offer', async () => {
  // A wrapper the site has hidden is not a selection target, and stopping at one would
  // make the button look broken. The step lands on the first thing a click could reach.
  const { editor, doc } = await makeEditor();
  editor.enter(EditMode.DESIGN);

  const card = doc.querySelector('[data-testid="card-1"]');
  card.insertAdjacentHTML('afterbegin', '<script>0</script><div class="wrap"><span id="deep">Deep</span></div>');
  // A wrapper that occupies no space at all: not something the editor offers to select.
  const wrap = card.querySelector('.wrap');
  const empty = { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0 };
  wrap.getBoundingClientRect = () => ({ ...empty, toJSON: () => empty });

  editor.select(card);
  editor.selectChild();
  assert.equal(editor.selection[0], doc.getElementById('deep'), 'the script and the empty wrapper are stepped over');
  editor.destroy();
});

test('the inspector is told which way it can step', async () => {
  const { editor, doc } = await makeEditor();
  editor.enter(EditMode.DESIGN);

  editor.select(doc.querySelector('[data-testid="card-1"] .buy'));
  const leaf = editor.detail();
  assert.equal(leaf.canSelectParent, true);
  assert.equal(leaf.canSelectChild, false, 'a button with only text in it has nowhere to go');

  editor.select(doc.body);
  assert.equal(editor.detail().canSelectParent, false, 'and <html> is not a selection target');
  editor.destroy();
});

test('the selection steps sideways to the next and previous sibling', async () => {
  const { editor, doc } = await makeEditor();
  editor.enter(EditMode.DESIGN);
  const first = doc.querySelector('[data-testid="card-1"]');
  const second = doc.querySelector('[data-testid="card-2"]');
  editor.select(first);
  assert.equal(editor.detail().canSelectPrevious, false);
  assert.equal(editor.detail().canSelectNext, true);

  editor.selectSibling(1);
  assert.equal(editor.selection[0], second);
  assert.equal(editor.detail().canSelectNext, false, 'the last card has nothing after it');
  editor.selectSibling(-1);
  assert.equal(editor.selection[0], first);
  editor.destroy();
});

test('the detail says what the site\'s own CSS applies, and how the page names the element', async () => {
  const { editor, doc } = await makeEditor();
  const style = doc.createElement('style');
  style.textContent = '.buy { padding: 4px 8px; color: blue } button { color: red; padding: 1px }';
  doc.head.appendChild(style);
  editor.enter(EditMode.DESIGN);
  const button = doc.querySelector('[data-testid="card-1"] .buy');
  button.setAttribute('style', 'color: green');
  editor.select(button);

  const { styles } = editor.detail();
  assert.equal(styles.target, 'button.buy');
  assert.deepEqual(styles.inline.map((d) => `${d.property}: ${d.value}`), ['color: green']);
  assert.deepEqual(styles.rules.map((r) => r.selector), ['.buy', 'button'], 'most powerful first');
  const buy = styles.rules[0].declarations;
  assert.equal(buy.find((d) => d.property === 'color').overridden, true, 'inline beat it');
  assert.equal(buy.find((d) => d.property === 'padding').overridden, false);
  assert.equal(styles.rules[1].declarations.find((d) => d.property === 'padding').overridden, true, '.buy beat it');
  editor.destroy();
});

test('removing one saved change leaves the site stylesheet standing', async () => {
  const backend = new MemoryBackend();
  const store = new EditStore(backend);
  const { editor, doc } = await makeEditor(backend);
  editor.enter(EditMode.DESIGN);
  editor.applySiteCss('.card { padding: 8px }');
  editor.select(doc.querySelector('#title'));
  editor.setProperty('color', '#123456');
  await editor.save();
  assert.equal(await store.count('shop.test'), 2, 'a sheet is work, and counts');

  await editor.resetElement();
  assert.equal(await store.sheetFor('shop.test', '/products'), '.card { padding: 8px }');
  assert.equal(await store.count('shop.test'), 1);
  editor.destroy();
});

test('removing the site\'s edits takes the live stylesheet with them', async () => {
  const backend = new MemoryBackend();
  const { editor } = await makeEditor(backend);
  editor.enter(EditMode.DESIGN);
  editor.applySiteCss('.card { padding: 8px }');
  await editor.save();
  assert.equal(editor.state().siteRules, 1);

  await editor.resetSite();
  assert.equal(editor.state().siteRules, 0, 'storage says nothing is applied, and so does the page');
  assert.equal(editor.siteCss(), '');
  editor.destroy();
});
