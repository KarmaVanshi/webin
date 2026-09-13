/**
 * End-to-end journeys, in jsdom: the paths a real person actually takes.
 * Each one starts from a page and a fresh runtime and drives the real panel controls.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDom, stubLayout, flush, until } from './helpers.mjs';

import { MemoryBackend } from '../src/storage/bridge.js';
import { encodeShareCode } from '../src/shared/theme-format.js';
import { presetById } from '../src/themes/library.js';
import { OWNED_ATTR, TOKEN_ATTR } from '../src/shared/types.js';

const PAGE = `<html><body style="background-color:#ffffff">
  <header style="background-color:#f2f2f2;color:#0f0f0f"><h1>A website</h1></header>
  <main style="background-color:#ffffff;color:#0f0f0f">
    <p style="color:#606060">Body copy that is long enough to carry some weight in detection.</p>
    <a href="#" style="color:#1a73e8">A link that should stay a link</a>
    <button style="background-color:#1a73e8;color:#ffffff">Call to action</button>
  </main>
</body></html>`;

/** The runtime imports the panel, which needs a DOM at import time, so it loads late. */
async function makeRuntime(backend, url = 'https://example.com/') {
  const dom = makeDom(PAGE, { url });
  stubLayout(dom, { width: 600, height: 200 });
  const { Webin } = await import('../src/content/runtime.js');
  return { dom, webin: new Webin({ doc: dom.window.document, view: dom.window, backend }) };
}

const click = async (shadow, selector) => {
  const node = shadow.querySelector(selector);
  assert.ok(node, `expected to find ${selector}`);
  node.click();
  await flush();
  await flush();
};

test('open the panel, pick a theme, and the page changes', async () => {
  const backend = new MemoryBackend();
  const { dom, webin } = await makeRuntime(backend);
  await webin.boot();
  await webin.open();

  const shadow = webin.panel.shadow;
  assert.ok(shadow.querySelector('.wb-panel'), 'the panel is on screen');
  assert.equal(shadow.querySelectorAll('.wb-card').length, 18, 'every shipped theme is offered');
  assert.match(shadow.querySelector('.wb-host').textContent, /example\.com/);

  await click(shadow, '[data-action="apply"][data-value="terminal"]');

  assert.equal(webin.active.id, 'terminal');
  assert.ok(dom.window.document.querySelectorAll(`[${TOKEN_ATTR}]`).length > 0, 'the page is stamped');
  assert.match(webin.engine.css, /Webin — Terminal/);

  // What the user asked for happened. How many rules that took was a report on the engine,
  // and it was the only thing the message said out loud.
  assert.equal(webin.panel.shadow.querySelector('.wb-toast span').textContent, 'Terminal applied');

  const site = await backend.get('site:example.com');
  assert.equal(site['site:example.com'].themeId, 'terminal');
  assert.match(site['site:example.com'].bootCss, /background-color: #020617/i);

  webin.destroy();
});

test('the theme comes back on the next visit, before the page paints', async () => {
  const backend = new MemoryBackend();
  const first = await makeRuntime(backend);
  await first.webin.boot();
  await first.webin.open();
  await click(first.webin.panel.shadow, '[data-action="apply"][data-value="nord"]');
  first.webin.destroy();

  // A second visit: same store, new page, no UI opened at all.
  const second = await makeRuntime(backend);
  await second.webin.boot();

  assert.equal(second.webin.active.id, 'nord');
  assert.ok(second.dom.window.document.querySelectorAll(`[${TOKEN_ATTR}]`).length > 0);
  second.webin.destroy();
});

test('removing a theme puts the site back and forgets it', async () => {
  const backend = new MemoryBackend();
  const { dom, webin } = await makeRuntime(backend);
  await webin.boot();
  await webin.open();
  await click(webin.panel.shadow, '[data-action="apply"][data-value="bauhaus"]');
  await click(webin.panel.shadow, '[data-action="clear"]');

  assert.equal(webin.active, null);
  assert.equal(dom.window.document.querySelectorAll(`[${TOKEN_ATTR}]`).length, 0);
  assert.deepEqual(await backend.get('site:example.com'), {});
  webin.destroy();
});

test('a share code from a friend imports, applies and is kept', async () => {
  const backend = new MemoryBackend();
  const { webin } = await makeRuntime(backend);
  await webin.boot();
  await webin.open();

  const code = await encodeShareCode({ ...presetById('neon'), id: 'gift', name: 'From Sam', custom: true });
  webin.panel.emit('action', { action: 'import', value: code });
  // Decoding goes through DecompressionStream, which is a real stream: wait for the
  // result rather than for a guessed number of ticks.
  await until(() => webin.active, { label: 'the imported theme to be applied' });

  assert.equal(webin.active.name, 'From Sam', 'an imported theme is applied straight away');
  const stored = await backend.get('themes');
  assert.equal(stored.themes.themes.length, 1);
  assert.equal(stored.themes.themes[0].name, 'From Sam');

  // And it is in the gallery, under the user's own shelf.
  const cards = [...webin.panel.shadow.querySelectorAll('.wb-card-name')].map((n) => n.textContent.trim());
  assert.ok(cards.some((name) => name.includes('From Sam')));
  webin.destroy();
});

test('a theme from another tool is shown before anything is saved', async () => {
  // Roles are guessed out of somebody else's names, so the guess gets looked at first.
  // A share code skips this; it is already a Webin theme with nothing to disclose.
  const backend = new MemoryBackend();
  const { webin } = await makeRuntime(backend);
  await webin.boot();
  await webin.open();

  const shadow = webin.panel.shadow;
  webin.panel.emit('action', {
    action: 'import',
    value: ':root { --background: #ffffff; --foreground: #101014; --primary: #6d28d9; --radius: 12px; }',
  });
  await flush();
  await flush();

  assert.equal(webin.panel.state.view, 'preview', 'it stops to show its working');
  assert.equal((await backend.get(['themes'])).themes, undefined, 'and saves nothing yet');
  assert.ok(shadow.querySelector('[data-action="confirm-import"]'), 'with a way to accept it');
  assert.ok(shadow.querySelector('.wb-card.is-static'), 'and a picture of what you would get');

  await click(shadow, '[data-action="confirm-import"]');

  const saved = (await backend.get(['themes'])).themes.themes;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].palette.accent, '#6d28d9');
  assert.equal(saved[0].radius, 12);
  assert.equal(webin.active?.id, saved[0].id, 'and it is applied, so you can see it');
});

test('discarding an imported theme keeps nothing', async () => {
  const backend = new MemoryBackend();
  const { webin } = await makeRuntime(backend);
  await webin.boot();
  await webin.open();

  webin.panel.emit('action', {
    action: 'import',
    value: '{"colors":{"editor.background":"#101014","editor.foreground":"#e8e8ea"}}',
  });
  await flush();
  await flush();
  assert.equal(webin.panel.state.view, 'preview');

  await click(webin.panel.shadow, '[data-action="cancel"]');
  assert.equal(webin.panel.state.view, 'gallery');
  assert.equal(webin.panel.state.preview, null);
  assert.equal((await backend.get(['themes'])).themes, undefined);
});

test('a damaged share code says so instead of failing silently', async () => {
  const backend = new MemoryBackend();
  const { webin } = await makeRuntime(backend);
  await webin.boot();
  await webin.open();

  webin.panel.emit('action', { action: 'import', value: 'webin:1z:brokenbrokenbroken' });
  await flush();
  await flush();

  const toast = webin.panel.shadow.querySelector('.wb-toast');
  assert.ok(toast, 'the user is told');
  assert.match(toast.textContent, /damaged/);
  assert.equal(webin.active, null);
  webin.destroy();
});

test('capture this page, then share what you captured', async () => {
  const backend = new MemoryBackend();
  const { webin } = await makeRuntime(backend);
  await webin.boot();
  await webin.open();

  webin.panel.emit('action', { action: 'capture' });
  await flush();
  await flush();

  const stored = (await backend.get('themes')).themes.themes;
  assert.equal(stored.length, 1);
  assert.equal(stored[0].name, 'Example');
  assert.equal(stored[0].palette.background, '#ffffff');

  // Apply it, then produce a code for it.
  await click(webin.panel.shadow, `[data-action="apply"][data-value="${stored[0].id}"]`);
  await click(webin.panel.shadow, '[data-action="share"]');

  const code = webin.panel.shadow.querySelector('.wb-code');
  assert.ok(code, 'the share sheet is shown');
  assert.match(code.textContent, /^webin:1/);
  webin.destroy();
});

test('deleting one of your own themes removes it from the site too', async () => {
  const backend = new MemoryBackend();
  const { dom, webin } = await makeRuntime(backend);
  await webin.boot();
  await webin.open();

  webin.panel.emit('action', { action: 'capture' });
  await flush();
  await flush();
  const id = (await backend.get('themes')).themes.themes[0].id;

  await click(webin.panel.shadow, `[data-action="apply"][data-value="${id}"]`);
  assert.equal(webin.active.id, id);

  await click(webin.panel.shadow, `[data-action="delete"][data-value="${id}"]`);
  assert.equal(webin.active, null, 'a deleted theme cannot stay applied');
  assert.equal(dom.window.document.querySelectorAll(`[${TOKEN_ATTR}]`).length, 0);
  assert.equal((await backend.get('themes')).themes.themes.length, 0);
  webin.destroy();
});

test('a theme deleted between visits does not haunt the site', async () => {
  const backend = new MemoryBackend();
  const { webin } = await makeRuntime(backend);
  await webin.boot();
  await webin.open();
  webin.panel.emit('action', { action: 'capture' });
  await flush();
  await flush();
  const id = (await backend.get('themes')).themes.themes[0].id;
  await click(webin.panel.shadow, `[data-action="apply"][data-value="${id}"]`);
  webin.destroy();

  // Wipe the theme behind the site's back, as a sync from another device might.
  await backend.set({ themes: { themes: [] } });

  const second = await makeRuntime(backend);
  await second.webin.boot();
  assert.equal(second.webin.active, null);
  assert.deepEqual(await backend.get('site:example.com'), {}, 'the dangling record is cleaned up');
  second.webin.destroy();
});

test('content the page adds later is themed too', async () => {
  const backend = new MemoryBackend();
  const { dom, webin } = await makeRuntime(backend);
  await webin.boot();
  await webin.open();
  await click(webin.panel.shadow, '[data-action="apply"][data-value="midnight"]');

  const card = dom.window.document.createElement('div');
  card.style.backgroundColor = '#f2f2f2';
  card.style.color = '#0f0f0f';
  card.textContent = 'Loaded on scroll';
  dom.window.document.body.appendChild(card);

  // The observer is debounced; give it time to settle.
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.ok(card.hasAttribute(TOKEN_ATTR), 'the new card wears the theme');
  webin.destroy();
});

test('edit an element through the panel, reload, and the change is still there', async () => {
  // The whole product in one test: pick a thing, change it, keep it, come back.
  const backend = new MemoryBackend();
  const first = await makeRuntime(backend);
  await first.webin.boot();
  await first.webin.open();

  await click(first.webin.panel.shadow, '[data-action="mode"][data-value="edit"]');
  assert.equal(first.webin.panel.state.view, 'edit');
  assert.ok(first.webin.panel.shadow.querySelector('.webin-empty'), 'nothing selected yet');

  const button = first.dom.window.document.querySelector('button');
  first.webin.editor.select(button);
  await flush();

  const shadow = first.webin.panel.shadow;
  assert.ok(shadow.querySelector('.webin-selection'), 'the inspector shows the selection');

  // Type into the radius field the way a person would.
  const radius = shadow.querySelector('[data-control="number"][data-prop="border-radius"]');
  assert.ok(radius, 'the appearance section offers a radius');
  radius.value = '18';
  radius.dispatchEvent(new first.dom.window.Event('change', { bubbles: true }));
  await flush();

  const sheet = first.dom.window.document.getElementById('webin-overrides');
  assert.match(sheet.textContent, /border-radius: 18px/, 'the page changes immediately');
  assert.equal(first.webin.editor.dirty, true, 'and is marked unsaved');

  await click(shadow, '[data-action="save"]');
  first.webin.destroy();

  // A fresh visit.
  const second = await makeRuntime(backend);
  await second.webin.boot();
  await flush();

  const restored = second.dom.window.document.getElementById('webin-overrides');
  assert.ok(restored, 'the override sheet is back');
  assert.match(restored.textContent, /border-radius: 18px/, 'and so is the change');
  second.webin.destroy();
});

test('leaving edit mode keeps your work; resetting the page does not', async () => {
  const backend = new MemoryBackend();
  const { dom, webin } = await makeRuntime(backend);
  await webin.boot();
  await webin.open();

  await click(webin.panel.shadow, '[data-action="mode"][data-value="edit"]');
  webin.editor.select(dom.window.document.querySelector('header'));
  await flush();
  webin.editor.setProperty('background-color', '#123456');
  await click(webin.panel.shadow, '[data-action="save"]');

  // Back to the gallery: the edit stays on the page.
  await click(webin.panel.shadow, '[data-action="mode"][data-value="gallery"]');
  assert.equal(webin.panel.state.view, 'gallery');
  assert.match(dom.window.document.getElementById('webin-overrides').textContent, /#123456/);

  await click(webin.panel.shadow, '[data-action="mode"][data-value="edit"]');
  await webin.editor.resetPage();
  // The sheet stays mounted — the editor is still open and will want it again — but it
  // no longer says anything, and the element carries no handle.
  assert.equal(dom.window.document.getElementById('webin-overrides').textContent.trim(), '');
  assert.equal(dom.window.document.querySelector('[data-webin-id]'), null);

  // Closing the editor is what takes the last trace away.
  webin.destroy();
  assert.equal(dom.window.document.getElementById('webin-overrides'), null);
});

test('closing the panel from edit mode stops the editing, and keeps the work', async () => {
  const backend = new MemoryBackend();
  const { dom, webin } = await makeRuntime(backend);
  await webin.boot();
  await webin.open();

  await click(webin.panel.shadow, '[data-action="mode"][data-value="edit"]');
  const header = dom.window.document.querySelector('header');
  webin.editor.select(header);
  await flush();
  webin.editor.setProperty('background-color', '#123456');
  await click(webin.panel.shadow, '[data-action="save"]');

  const doc = dom.window.document;
  assert.equal(webin.editor.state().mode, 'design', 'editing before the close');
  assert.equal(doc.querySelectorAll(`div[${OWNED_ATTR}]`).length, 2,
    'panel host and overlay host are both up');

  // Close the way the X button does.
  await click(webin.panel.shadow, '[data-action="close"]');

  assert.equal(webin.panel.visible, false, 'the panel is gone');
  assert.equal(webin.editor.state().mode, 'off', 'and the editor has left edit mode');
  assert.equal(webin.editor.state().selection, null, 'nothing is selected any more');
  assert.equal(doc.querySelectorAll(`div[${OWNED_ATTR}]`).length, 0,
    'no panel host and no overlay host left on the page');

  // The picker is deaf: a press on the page selects nothing.
  header.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }));
  header.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await flush();
  assert.equal(webin.editor.state().selection, null, 'clicking the page no longer selects');

  // But the work survives — closing is not undoing.
  assert.match(doc.getElementById('webin-overrides').textContent, /#123456/,
    'the saved edit is still applied');

  // Reopening lands on the gallery, not on an inspector with no editor behind it.
  await webin.open();
  assert.equal(webin.panel.state.view, 'gallery');
  assert.ok(webin.panel.shadow.querySelector('.wb-card'), 'the gallery is what comes back');
  webin.destroy();
});

test('a theme and a hand edit can both be on, and the hand edit wins', async () => {
  const backend = new MemoryBackend();
  const { dom, webin } = await makeRuntime(backend);
  await webin.boot();
  await webin.open();
  await click(webin.panel.shadow, '[data-action="apply"][data-value="midnight"]');

  await click(webin.panel.shadow, '[data-action="mode"][data-value="edit"]');
  const header = dom.window.document.querySelector('header');
  webin.editor.select(header);
  await flush();
  webin.editor.setProperty('background-color', '#ff00ff');

  // The theme stamps its own attribute; the edit stamps a different one. Both are on the
  // element, and the override's selector is written to outrank the theme's.
  assert.ok(header.hasAttribute('data-webin-id'), 'the edit marks it');
  const overrides = dom.window.document.getElementById('webin-overrides').textContent;
  assert.match(overrides, /\[data-webin-id="[^"]+"\]\[data-webin-id\][^{]*\{[^}]*#ff00ff/);
  webin.destroy();
});

test('name a theme you captured, and the new name sticks', async () => {
  const backend = new MemoryBackend();
  const { dom, webin } = await makeRuntime(backend);
  await webin.boot();
  await webin.open();

  // Capture names it after the site, which is a guess, not a decision.
  webin.panel.emit('action', { action: 'capture' });
  await flush(); await flush();
  const captured = (await backend.get('themes')).themes.themes[0];
  assert.equal(captured.name, 'Example', 'named after where it came from');

  await click(webin.panel.shadow, `[data-action="rename"][data-value="${captured.id}"]`);
  assert.equal(webin.panel.state.view, 'rename');
  const field = webin.panel.shadow.querySelector('#wb-rename');
  assert.ok(field, 'the sheet offers a name field');
  assert.equal(field.value, 'Example', 'prefilled with what it is called now');
  assert.equal(webin.panel.shadow.querySelector('label[for="wb-rename"]').textContent.trim(),
    'Theme name', 'with a visible label, not a placeholder');

  field.value = 'Sunday Reading';
  await click(webin.panel.shadow, '[data-action="save-name"]');

  assert.equal(webin.panel.state.view, 'gallery', 'and it goes back on its own');
  const saved = (await backend.get('themes')).themes.themes.find((t) => t.id === captured.id);
  assert.equal(saved.name, 'Sunday Reading');
  assert.match(webin.panel.shadow.textContent, /Sunday Reading/);
  webin.destroy();
});

test('an empty name is refused, and says so next to the field', async () => {
  const backend = new MemoryBackend();
  const { webin } = await makeRuntime(backend);
  await webin.boot();
  await webin.open();
  webin.panel.emit('action', { action: 'capture' });
  await flush(); await flush();
  const mine = (await backend.get('themes')).themes.themes[0];

  await click(webin.panel.shadow, `[data-action="rename"][data-value="${mine.id}"]`);
  webin.panel.shadow.querySelector('#wb-rename').value = '   ';
  await click(webin.panel.shadow, '[data-action="save-name"]');

  assert.equal(webin.panel.state.view, 'rename', 'it stays put rather than saving nothing');
  const error = webin.panel.shadow.querySelector('#wb-rename-error');
  assert.ok(error, 'the reason is next to the field');
  assert.match(error.textContent, /needs a name/);
  assert.equal(webin.panel.shadow.querySelector('#wb-rename').getAttribute('aria-describedby'),
    'wb-rename-error', 'and is announced with it');
  assert.equal((await backend.get('themes')).themes.themes[0].name, mine.name, 'nothing was saved');
  webin.destroy();
});

test('an imported theme can be named before it is kept', async () => {
  const backend = new MemoryBackend();
  const { webin } = await makeRuntime(backend);
  await webin.boot();
  await webin.open();

  webin.panel.emit('action', {
    action: 'import',
    value: ':root { --background: #101010; --foreground: #f5f5f5; --primary: #3366ff; }',
  });
  await flush(); await flush();
  assert.equal(webin.panel.state.view, 'preview');

  const field = webin.panel.shadow.querySelector('#wb-preview-name');
  assert.ok(field, 'a single theme is offered under a name you can change');
  field.value = 'Borrowed Blue';
  await click(webin.panel.shadow, '[data-action="confirm-import"]');

  const themes = (await backend.get('themes')).themes.themes;
  assert.equal(themes.length, 1);
  assert.equal(themes[0].name, 'Borrowed Blue');
  webin.destroy();
});

test('the panel toggles and Escape closes it', async () => {
  const backend = new MemoryBackend();
  const { dom, webin } = await makeRuntime(backend);
  await webin.boot();

  assert.equal(await webin.toggle(), true);
  assert.equal(webin.panel.visible, true);
  assert.equal(await webin.toggle(), false);
  assert.equal(webin.panel.visible, false);

  await webin.open();
  const event = new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
  webin.panel.shadow.querySelector('.wb-panel').dispatchEvent(event);
  await flush();
  assert.equal(webin.panel.visible, false, 'Escape closes the panel');
  webin.destroy();
});

test('the panel survives a theme that is trying to break it', async () => {
  const backend = new MemoryBackend();
  const { webin } = await makeRuntime(backend);
  await webin.boot();
  await webin.open();

  const hostile = JSON.stringify({
    format: 'webin-theme',
    theme: {
      name: '<img src=x onerror=alert(1)>',
      palette: { background: '#fff', surface: '#eee', text: '#000', textMuted: '#666', accent: '#f00' },
    },
  });
  webin.panel.emit('action', { action: 'import', value: hostile });
  await flush();
  await flush();

  assert.equal(webin.panel.shadow.querySelectorAll('img').length, 0, 'the name is text, not markup');
  const names = [...webin.panel.shadow.querySelectorAll('.wb-card-name span')].map((n) => n.textContent);
  assert.ok(names.includes('<img src=x onerror=alert(1)>'),
    'and it is still shown verbatim, so the user can see what they imported');
  webin.destroy();
});

test('the theme and the edits are removed separately, each from its own tab', async () => {
  // Briefly Remove took both, which read as tidy and was the panel deciding for the user
  // which of their changes to discard. They are two different changes to the site.
  const backend = new MemoryBackend();
  const { dom, webin } = await makeRuntime(backend);
  await webin.boot();
  await webin.open();

  await click(webin.panel.shadow, '[data-action="apply"][data-value="nord"]');
  await click(webin.panel.shadow, '[data-action="mode"][data-value="edit"]');
  webin.editor.select(dom.window.document.querySelector('header'));
  await flush();
  webin.editor.setProperty('background-color', '#123456');
  await click(webin.panel.shadow, '[data-action="save"]');
  const sheet = () => dom.window.document.getElementById('webin-overrides').textContent;

  // Removing the theme from the Themes tab leaves the hand edit standing.
  await click(webin.panel.shadow, '[data-action="mode"][data-value="gallery"]');
  await click(webin.panel.shadow, '[data-action="clear"]');
  await flush();
  assert.equal(webin.active, null, 'the theme is gone');
  assert.match(sheet(), /#123456/, 'and the edit is not');

  // Removing the edits from the Edit tab is the other half.
  await click(webin.panel.shadow, '[data-action="mode"][data-value="edit"]');
  await click(webin.panel.shadow, '[data-action="reset-site"]');
  await flush();
  assert.equal(sheet().trim(), '', 'now the edit is gone too');
  assert.equal(dom.window.document.querySelector('[data-webin-id]'), null);

  // And neither comes back on the next visit.
  const second = await makeRuntime(backend);
  await second.webin.boot();
  await flush();
  const restored = second.dom.window.document.getElementById('webin-overrides');
  assert.ok(!restored || !restored.textContent.includes('#123456'));
});

test('a value you changed offers its way back to the site\'s own', async () => {
  const backend = new MemoryBackend();
  const { dom, webin } = await makeRuntime(backend);
  await webin.boot();
  await webin.open();
  await click(webin.panel.shadow, '[data-action="mode"][data-value="edit"]');
  webin.editor.select(dom.window.document.querySelector('header'));
  await flush();

  // The control keeps its place in the layout always, so the field beside it never
  // changes width; only its enabled state comes and goes.
  const revert = () => webin.panel.shadow
    .querySelector('[data-action="revert-prop"][data-value="background-color"]:not([disabled])');
  assert.equal(revert(), null, 'nothing to revert until something is changed');

  webin.editor.setProperty('background-color', '#123456');
  await flush();
  assert.ok(revert(), 'a changed value offers the way back');

  await click(webin.panel.shadow, '[data-action="revert-prop"][data-value="background-color"]');
  await flush();
  assert.doesNotMatch(dom.window.document.getElementById('webin-overrides').textContent, /#123456/);
  assert.equal(revert(), null, 'and the control goes quiet with it');

  // Reverting is a decision, not an escape from the history.
  webin.editor.undo();
  await flush();
  assert.match(dom.window.document.getElementById('webin-overrides').textContent, /#123456/);
});
