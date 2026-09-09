import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDom, flush } from './helpers.mjs';

import { PRESETS } from '../src/themes/library.js';
import { normaliseTheme } from '../src/shared/theme-format.js';
import { APPEARANCE_ATTR, OWNED_ATTR } from '../src/shared/types.js';

async function mountPanel(extra = {}) {
  const dom = makeDom();
  const { Panel } = await import('../src/ui/panel.js');
  const panel = new Panel({ doc: dom.window.document });
  panel.mount({ host: 'example.com', themes: [...PRESETS], activeId: null, ...extra });
  return { dom, panel };
}

const mine = normaliseTheme({
  id: 'mine', name: 'My theme',
  palette: { background: '#ffffff', surface: '#eeeeee', text: '#111111', textMuted: '#666666', accent: '#ff0000' },
});

test('the panel is one surface with three zones and nothing else', async () => {
  const { panel } = await mountPanel();
  const shadow = panel.shadow;

  assert.equal(shadow.querySelectorAll('.wb-panel').length, 1);
  assert.ok(shadow.querySelector('.wb-head'));
  assert.ok(shadow.querySelector('.wb-body'));
  assert.ok(shadow.querySelector('.wb-foot'));
  assert.equal(shadow.querySelectorAll('.wb-menu').length, 0, 'the menu is closed until asked for');
});

test('the panel cannot be styled by the page it is sitting on', async () => {
  const { panel, dom } = await mountPanel();
  const host = dom.window.document.querySelector(`[${OWNED_ATTR}]`);

  assert.ok(host.shadowRoot, 'it lives in a shadow root');
  assert.match(host.getAttribute('style'), /all: initial/);
  assert.ok(panel.shadow.querySelector('style').textContent.includes(':host'));
});

test('themes are shelved, and your own get their own shelf', async () => {
  const { panel } = await mountPanel({ themes: [...PRESETS, mine] });
  const sections = [...panel.shadow.querySelectorAll('.wb-section')].map((n) => n.textContent.trim());

  assert.deepEqual(sections, ['Essentials', 'Movements', 'Dark', 'Yours']);
  const yourCards = panel.shadow.querySelectorAll('.wb-cell .wb-card-act--del');
  assert.equal(yourCards.length, 1, 'only your own themes can be deleted');
  assert.equal(panel.shadow.querySelectorAll('[data-action="rename"]').length, 1,
    'and only your own can be renamed — the presets are the extension\'s, not yours');
});

test('the applied theme is stated, not just implied', async () => {
  const { panel } = await mountPanel({ activeId: 'nord' });

  const card = panel.shadow.querySelector('[data-value="nord"]');
  assert.equal(card.getAttribute('aria-pressed'), 'true');
  assert.ok(card.classList.contains('is-on'));
  assert.match(panel.shadow.querySelector('.wb-foot-label').textContent, /Nord.*applied/);
  assert.ok(panel.shadow.querySelector('[data-action="clear"]'), 'and can be removed');
});

test('with nothing applied the footer says so and offers no Remove', async () => {
  const { panel } = await mountPanel();
  assert.match(panel.shadow.querySelector('.wb-foot-label').textContent, /this site is untouched/);
  assert.equal(panel.shadow.querySelector('[data-action="clear"]'), null);
});

test('each preview is drawn from its own theme, so the gallery is honest', async () => {
  const { panel } = await mountPanel();
  const bauhaus = panel.shadow.querySelector('[data-value="bauhaus"] .wb-prev');
  const terminal = panel.shadow.querySelector('[data-value="terminal"] .wb-prev');

  assert.match(bauhaus.getAttribute('style'), /#f0f0f0/i);
  assert.match(bauhaus.querySelector('.wb-prev-card').getAttribute('style'), /box-shadow:2px 2px 0 0/);
  assert.match(terminal.getAttribute('style'), /#020617/i);
});

test('a hostile theme name reaches the DOM as text', async () => {
  const hostile = normaliseTheme({ ...mine, id: 'x', name: '"><img src=x onerror=alert(1)>' });
  const { panel } = await mountPanel({ themes: [hostile] });

  assert.equal(panel.shadow.querySelectorAll('img').length, 0);
  assert.equal(panel.shadow.querySelector('.wb-card-name span').textContent, '"><img src=x onerror=alert(1)>');
});

test('a hostile colour cannot break out of a style attribute', async () => {
  // The format validator would already have rejected this; the panel filters again.
  const smuggled = { ...mine, id: 'y', palette: { ...mine.palette, background: 'red;} body{display:none' } };
  const { panel } = await mountPanel({ themes: [smuggled] });

  const style = panel.shadow.querySelector('.wb-prev').getAttribute('style');
  assert.ok(!style.includes('{'), 'no braces survive');
  assert.ok(!style.includes(';}'), 'no rule can be closed');
});

test('actions are emitted rather than handled here', async () => {
  const { panel } = await mountPanel();
  const seen = [];
  panel.on('action', (payload) => seen.push(payload));

  panel.shadow.querySelector('[data-value="terminal"]').click();
  panel.shadow.querySelector('[data-action="menu"]').click();
  await flush();

  assert.deepEqual(seen[0], { action: 'apply', value: 'terminal' });
  assert.deepEqual(seen[1], { action: 'menu', value: null });
});

test('the menu holds the occasional actions, and closes on Escape', async () => {
  const { dom, panel } = await mountPanel({ menuOpen: true });
  const actions = [...panel.shadow.querySelectorAll('.wb-menu-item')]
    .map((item) => item.dataset.action);
  for (const expected of ['capture', 'open-import', 'readable', 'share', 'export', 'export-all']) {
    assert.ok(actions.includes(expected), `the menu should offer "${expected}", got ${actions}`);
  }

  panel.shadow.querySelector('.wb-panel').dispatchEvent(
    new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
  );
  assert.equal(panel.state.menuOpen, false);
});

test('sharing and exporting need something to share', async () => {
  const { panel } = await mountPanel({ menuOpen: true });
  const share = panel.shadow.querySelector('[data-action="share"]');
  assert.ok(share.hasAttribute('disabled'), 'nothing applied, nothing to share');

  panel.setState({ activeId: 'nord' });
  assert.equal(panel.shadow.querySelector('[data-action="share"]').hasAttribute('disabled'), false);
});

test('the import sheet takes a pasted code or a file', async () => {
  const { panel } = await mountPanel({ view: 'import' });

  assert.ok(panel.shadow.querySelector('#wb-import'));
  assert.ok(panel.shadow.querySelector('[data-action="import-text"]'));
  assert.ok(panel.shadow.querySelector('[data-action="import-file"]'));
  assert.equal(panel.shadow.querySelectorAll('.wb-card').length, 0, 'the gallery steps aside');

  panel.shadow.querySelector('#wb-import').value = 'webin:1:abc';
  assert.equal(panel.importText, 'webin:1:abc');
});

test('the panel chrome flips light and dark independently of the page', async () => {
  const { dom, panel } = await mountPanel();
  const host = dom.window.document.querySelector(`[${OWNED_ATTR}]`);
  assert.equal(host.getAttribute(APPEARANCE_ATTR), 'light');

  panel.setState({ appearance: 'dark' });
  assert.equal(host.getAttribute(APPEARANCE_ATTR), 'dark');
  assert.equal(host.style.colorScheme, 'dark');
});

test('a toast tells the user what happened and goes away', async () => {
  const { panel } = await mountPanel();
  panel.toast('error', 'That did not work', 20);

  const toast = panel.shadow.querySelector('.wb-toast');
  assert.match(toast.textContent, /That did not work/);
  assert.equal(toast.getAttribute('role'), 'status');
  assert.ok(toast.classList.contains('wb-toast--error'));

  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(panel.shadow.querySelector('.wb-toast'), null);
});

test('unmounting leaves nothing behind', async () => {
  const { dom, panel } = await mountPanel();
  panel.unmount();
  assert.equal(dom.window.document.querySelectorAll(`[${OWNED_ATTR}]`).length, 0);
  assert.equal(panel.visible, false);
});

test('every control has an accessible name', async () => {
  const { panel } = await mountPanel({ activeId: 'nord', menuOpen: true });
  for (const button of panel.shadow.querySelectorAll('button')) {
    const named = button.textContent.trim().length > 0
      || button.getAttribute('aria-label')
      || button.getAttribute('title');
    assert.ok(named, `a control with no name: ${button.outerHTML.slice(0, 80)}`);
  }
});

/** The inspector's payload, shaped as `Editor.detail()` returns it. */
function selectionDetail(overrides = {}) {
  return {
    label: 'button.buy',
    identity: { domPath: 'html>body>main>button' },
    layout: {
      display: 'inline-block', position: 'static', width: 140, height: 44,
      declaredWidth: '140px', declaredHeight: '44px', zIndex: 'auto',
      left: 'auto', top: 'auto',
    },
    context: { self: 'block', parentLayout: 'flex', position: 'static' },
    spacing: {
      padding: { top: '8px', right: '16px', bottom: '8px', left: '16px' },
      margin: { top: '0px', right: '0px', bottom: '0px', left: '0px' },
      gap: '0px',
    },
    typography: {
      fontSize: '16px', fontWeight: '600', lineHeight: '24px', letterSpacing: '0px',
      textAlign: 'center', color: '#7a7a7a',
    },
    appearance: {
      backgroundColor: '#8a8a8a', opacity: '1', borderColor: '#cccccc',
      borderWidth: { top: '1px', right: '1px', bottom: '1px', left: '1px' },
      radius: { topLeft: '8px', topRight: '8px', bottomRight: '8px', bottomLeft: '8px' },
    },
    hidden: false,
    canEditText: true,
    ...overrides,
  };
}

test('the inspector names every control it renders', async () => {
  // The editor adds far more controls than the gallery ever had, and an icon button with
  // no name is invisible to anyone not looking at it.
  const { panel } = await mountPanel({
    view: 'edit',
    editor: { mode: 'design', dirty: true, history: {}, unmatched: 1, selection: selectionDetail() },
  });

  const controls = panel.shadow.querySelectorAll('button, input, select, textarea');
  assert.ok(controls.length > 15, `expected a populated inspector, got ${controls.length} controls`);

  for (const control of controls) {
    const id = control.getAttribute('id');
    const label = id ? panel.shadow.querySelector(`label[for="${id}"]`) : null;
    const named = control.textContent.trim().length > 0
      || control.getAttribute('aria-label')
      || control.getAttribute('aria-labelledby')
      || control.getAttribute('title')
      || label;
    assert.ok(named, `a control with no name: ${control.outerHTML.slice(0, 90)}`);
  }
});

test('the inspector says when text on this element cannot be read', async () => {
  // Grey on grey. The warning has to carry the number and an icon, because a colour on
  // its own says nothing to somebody who cannot see it.
  const { panel } = await mountPanel({
    view: 'edit',
    editor: { mode: 'design', dirty: false, history: {}, unmatched: 0, selection: selectionDetail() },
  });
  const note = panel.shadow.querySelector('.webin-note--warn');
  assert.ok(note, 'a failing contrast should be reported');
  assert.match(note.textContent, /\d\.\d+:1/, 'with the actual ratio');
  assert.ok(note.querySelector('svg'), 'and an icon, not just a colour');
  assert.ok(note.querySelector('[data-action="fix-contrast"]'), 'and a way to fix it');
});

test('the inspector stays quiet when the contrast is fine', async () => {
  const { panel } = await mountPanel({
    view: 'edit',
    editor: {
      mode: 'design', dirty: false, history: {}, unmatched: 0,
      selection: selectionDetail({
        typography: { ...selectionDetail().typography, color: '#111111' },
        appearance: { ...selectionDetail().appearance, backgroundColor: '#ffffff' },
      }),
    },
  });
  assert.equal(panel.shadow.querySelector('.webin-note--warn'), null);
});

test('with nothing selected the editor says what to do', async () => {
  const { panel } = await mountPanel({
    view: 'edit',
    editor: { mode: 'design', dirty: false, history: {}, unmatched: 0, selection: null },
  });
  const empty = panel.shadow.querySelector('.webin-empty');
  assert.ok(empty, 'an empty state, not a blank panel');
  assert.match(empty.textContent, /click/i);
});

// ─── Applying a theme must not refresh the panel ────────────────────────────

test('applying a theme moves the tick without rebuilding the panel', async () => {
  // A repaint throws away the gallery's scroll position, whatever had keyboard focus, and
  // every hover and transition with them. Applying a theme changes a tick and a line of
  // footer text, so it has no business doing any of that.
  const { panel } = await mountPanel();
  const body = panel.shadow.querySelector('.wb-body');
  const cards = [...panel.shadow.querySelectorAll('.wb-card')];
  const target = cards[cards.length - 1];

  panel.setState({ activeId: target.dataset.value });
  await flush();

  assert.equal(panel.shadow.querySelector('.wb-body'), body, 'the same body element, not a new one');
  assert.equal(target.classList.contains('is-on'), true);
  assert.equal(target.getAttribute('aria-pressed'), 'true');
  assert.ok(target.querySelector('.wb-check'), 'and it is ticked');
  assert.equal(panel.shadow.querySelectorAll('.wb-card.is-on').length, 1, 'only one at a time');
});

test('the tick moves off the theme that had it', async () => {
  const { panel } = await mountPanel();
  const [first, second] = panel.shadow.querySelectorAll('.wb-card');

  panel.setState({ activeId: first.dataset.value });
  assert.equal(first.classList.contains('is-on'), true);

  panel.setState({ activeId: second.dataset.value });
  assert.equal(first.classList.contains('is-on'), false, 'the old tick is taken away');
  assert.equal(first.querySelector('.wb-check'), null);
  assert.equal(second.classList.contains('is-on'), true);
});

test('the footer keeps up with what is applied', async () => {
  const { panel } = await mountPanel();
  assert.match(panel.shadow.querySelector('.wb-foot').textContent, /this site is untouched/);

  const card = panel.shadow.querySelector('.wb-card');
  panel.setState({ activeId: card.dataset.value });
  assert.match(panel.shadow.querySelector('.wb-foot').textContent, /applied here/);
  assert.ok(panel.shadow.querySelector('[data-action="share"]'), 'and offers to share it');
});

test('a toast comes and goes without disturbing the panel', async () => {
  // The toast used to repaint everything twice: once arriving and once expiring, so the
  // panel appeared to refresh itself seconds after the click that caused it.
  const { panel } = await mountPanel();
  const body = panel.shadow.querySelector('.wb-body');

  panel.toast('info', 'Nord applied', 0);
  assert.match(panel.shadow.querySelector('.wb-toast').textContent, /Nord applied/);
  assert.equal(panel.shadow.querySelector('.wb-body'), body);

  panel.setState({ toast: null });
  assert.equal(panel.shadow.querySelector('.wb-toast'), null, 'gone again');
  assert.equal(panel.shadow.querySelector('.wb-body'), body, 'and the panel never moved');
});

test('setting state to what it already is does nothing at all', async () => {
  const { panel } = await mountPanel({ view: 'gallery' });
  const body = panel.shadow.querySelector('.wb-body');

  panel.setState({ view: 'gallery', menuOpen: false, activeId: null });
  assert.equal(panel.shadow.querySelector('.wb-body'), body);
});

test('a change that does rearrange the panel still repaints it', async () => {
  // The body element itself is reused — a repaint reconciles rather than rebuilds, which
  // is what keeps a control the user is holding alive across it. What has to change is
  // what the body *contains*.
  const { panel } = await mountPanel();
  assert.equal(panel.shadow.querySelector('#wb-import'), null);

  panel.setState({ view: 'import' });
  assert.ok(panel.shadow.querySelector('#wb-import'), 'a new view is a new body');
  assert.equal(panel.shadow.querySelector('.wb-panel').dataset.view, 'import');
  assert.equal(panel.shadow.querySelector('.wb-card'), null, 'and the gallery is gone');
});

test('an open menu is repainted rather than patched behind its own back', async () => {
  // The menu's share and export items are enabled by there being something applied, so it
  // is showing `activeId` too and cannot be left out of the update.
  const { panel } = await mountPanel({ menuOpen: true });
  assert.ok(panel.shadow.querySelector('[data-action="share"]').hasAttribute('disabled'));

  panel.setState({ activeId: 'nord' });
  assert.equal(panel.shadow.querySelector('[data-action="share"]').hasAttribute('disabled'), false);
});

test('a repaint keeps the control the change came from', async () => {
  // This is what made editing jitter. The panel repaints after every change, and a repaint
  // used to throw away the very control the change had come from — so the caret left the
  // field, and an open colour picker was left holding an input no longer in the document.
  // The first drag of a colour applied and every drag after it went nowhere.
  const { panel } = await mountPanel({
    view: 'edit',
    editor: { mode: 'design', dirty: false, history: {}, unmatched: 0, selection: selectionDetail() },
  });
  const swatch = panel.shadow.querySelector('[data-control="color"][data-prop="color"]');
  const size = panel.shadow.querySelector('[data-control="number"][data-prop="font-size"]');
  const body = panel.shadow.querySelector('.wb-body');
  assert.ok(swatch && size);

  panel.setState({
    editor: {
      mode: 'design', dirty: true, history: {}, unmatched: 0,
      selection: selectionDetail({
        typography: { fontSize: '22px', fontWeight: '600', lineHeight: '24px', letterSpacing: '0px', textAlign: 'center', color: '#112233' },
      }),
    },
  });

  assert.equal(panel.shadow.querySelector('[data-control="color"][data-prop="color"]'), swatch,
    'the swatch the picker is attached to is still the one on the page');
  assert.equal(panel.shadow.querySelector('[data-control="number"][data-prop="font-size"]'), size);
  assert.equal(panel.shadow.querySelector('.wb-body'), body);
  assert.equal(size.getAttribute('value'), '22', 'and it is showing the new value');
});

test('a control keeps its own id from one repaint to the next', async () => {
  // The panel finds the control that had focus by id. An id that has just been renumbered
  // finds nothing, so the caret left the field on every change that reached the page.
  const { panel } = await mountPanel({
    view: 'edit',
    editor: { mode: 'design', dirty: false, history: {}, unmatched: 0, selection: selectionDetail() },
  });
  const before = panel.shadow.querySelector('[data-control="number"][data-prop="font-size"]').id;
  panel.setState({ view: 'gallery' });
  panel.setState({
    view: 'edit',
    editor: { mode: 'design', dirty: true, history: {}, unmatched: 0, selection: selectionDetail() },
  });
  const after = panel.shadow.querySelector('[data-control="number"][data-prop="font-size"]').id;

  assert.ok(before, 'the field has an id at all');
  assert.equal(after, before);
  assert.ok(panel.shadow.querySelector(`label[for="${after}"]`), 'and its label still points at it');
});

test('what the user is typing is never overwritten by a repaint', async () => {
  const { panel } = await mountPanel({ view: 'rename', rename: { id: 'nord', name: 'Nord', error: '' } });
  const field = panel.shadow.querySelector('#wb-rename');
  field.focus();
  field.value = 'Half-typed nam';

  panel.setState({ toast: { tone: 'info', message: 'Saved' } });
  panel.render();

  assert.equal(panel.shadow.querySelector('#wb-rename'), field);
  assert.equal(field.value, 'Half-typed nam', 'the half-finished name survived');
});
