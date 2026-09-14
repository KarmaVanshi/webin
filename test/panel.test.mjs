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

test('edit mode offers the arrow, the pencil and the code tool, and says which is held', async () => {
  const { panel } = await mountPanel({
    view: 'edit',
    editor: { mode: 'design', tool: 'point', dirty: false, history: {}, unmatched: 0, selection: selectionDetail() },
  });
  const tools = [...panel.shadow.querySelectorAll('[data-action="tool"]')];
  assert.deepEqual(tools.map((b) => b.dataset.value), ['point', 'edit', 'code']);
  assert.deepEqual(tools.map((b) => b.getAttribute('aria-pressed')), ['true', 'false', 'false']);
  // State is never carried by colour alone: each button is named, and the pressed one is
  // filled as well as accented.
  for (const button of tools) assert.ok(button.getAttribute('aria-label'));

  panel.setState({ editor: { mode: 'design', tool: 'edit', dirty: false, history: {}, unmatched: 0, selection: selectionDetail() } });
  const after = [...panel.shadow.querySelectorAll('[data-action="tool"]')];
  assert.deepEqual(after.map((b) => b.getAttribute('aria-pressed')), ['false', 'true', 'false']);
  assert.ok(after[1].classList.contains('is-on'));
});

test('with the arrow held the panel says the page is not being edited', async () => {
  // The arrow clears the selection, so this is the only thing the inspector can show — and
  // it has to say why it is empty rather than look like an editor that failed to load.
  const { panel } = await mountPanel({
    view: 'edit',
    editor: { mode: 'design', tool: 'point', dirty: false, history: {}, unmatched: 0, selection: null },
  });
  assert.equal(panel.shadow.querySelectorAll('[data-action="tool"]').length, 3);
  assert.match(panel.shadow.querySelector('.webin-empty').textContent, /not editing/i);
  assert.match(panel.shadow.querySelector('.webin-empty').textContent, /pencil/i);
});

test('the themes footer counts the edits, saved or not', async () => {
  // "Untouched" is a claim about the page in front of you, not about storage: an edit you
  // have not pressed Save on is still something you did.
  const { panel } = await mountPanel({ editCount: 2 });
  assert.match(panel.shadow.querySelector('.wb-foot-label').textContent, /2 edits here/);
  assert.doesNotMatch(panel.shadow.querySelector('.wb-foot-label').textContent, /untouched/);

  panel.setState({ editCount: 0, editor: { mode: 'design', tool: 'edit', history: {}, pending: 1, selection: null } });
  assert.match(panel.shadow.querySelector('.wb-foot-label').textContent, /1 edit here/);

  panel.setState({ editCount: 1 });
  assert.match(panel.shadow.querySelector('.wb-foot-label').textContent, /2 edits here/, 'saved and pending are one number');
});

test('an applied theme still names itself, and says what else was done', async () => {
  const { panel } = await mountPanel({ activeId: 'nord', editCount: 3 });
  const label = panel.shadow.querySelector('.wb-foot-label').textContent;
  assert.match(label, /Nord.*applied here/);
  assert.match(label, /3 edits/);
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

test('a colour swatch shows the colour it stands for', async () => {
  // The swatch is an `input type=color`, which speaks `#rrggbb` and nothing else, and no
  // caller was converting. So every swatch rendered black whatever colour it stood for —
  // a white background showed a black square — and a repaint then wrote that black back
  // over the colour being dragged to, which took the page with it.
  const { panel } = await mountPanel({
    view: 'edit',
    editor: {
      mode: 'design', dirty: false, history: {}, unmatched: 0,
      selection: selectionDetail({
        typography: { fontSize: '16px', fontWeight: '600', lineHeight: '24px', letterSpacing: '0px', textAlign: 'left', color: 'rgb(29, 29, 31)' },
        appearance: {
          backgroundColor: '#ffffff', opacity: '1', borderColor: 'rgb(200, 0, 0)',
          borderWidth: { top: '1px', right: '1px', bottom: '1px', left: '1px' },
          radius: { topLeft: '8px', topRight: '8px', bottomRight: '8px', bottomLeft: '8px' },
        },
      }),
    },
  });
  const swatch = (prop) => panel.shadow.querySelector(`[data-control="color"][data-prop="${prop}"]`).getAttribute('value');

  assert.equal(swatch('background-color'), '#ffffff', 'white is not black');
  assert.equal(swatch('color'), '#1d1d1f', 'and rgb() reaches the picker as hex');
  assert.equal(swatch('border-color'), '#c80000');
});

test('a colour the panel is already showing is not written over', async () => {
  // The picker is attached to this node and may be open on it. Writing a value it already
  // holds looks like nothing and is a real event to the picker mid-drag.
  const { panel } = await mountPanel({
    view: 'edit',
    editor: { mode: 'design', dirty: false, history: {}, unmatched: 0, selection: selectionDetail() },
  });
  const swatch = panel.shadow.querySelector('[data-control="color"][data-prop="background-color"]');
  const writes = [];
  Object.defineProperty(swatch, 'value', {
    get: () => '#8a8a8a',
    set: (v) => writes.push(v),
    configurable: true,
  });

  panel.setState({
    editor: { mode: 'design', dirty: true, history: {}, unmatched: 0, selection: selectionDetail() },
  });

  assert.deepEqual(writes, [], 'the swatch was left alone');
});

test('the background row offers an image as well as a colour', async () => {
  const { panel } = await mountPanel({
    view: 'edit',
    editor: { mode: 'design', dirty: false, history: {}, unmatched: 0, selection: selectionDetail() },
  });

  const row = panel.shadow.querySelector('[data-row="background-color"]');
  assert.ok(row, 'the background row is there');

  const add = row.querySelector('[data-control="image"]');
  assert.ok(add, 'and carries the button that opens the picker');
  assert.ok(add.getAttribute('aria-label')?.includes('image'), 'named, like every other icon button');

  // After the value, before the revert: what it is, another way to fill it, the way back.
  const order = [...row.querySelectorAll('input, button')].map((el) => el.dataset.control ?? el.dataset.action);
  assert.deepEqual(order, ['color', 'color-text', 'image', 'revert-prop']);
});

test('the image picker takes the formats a phone and a designer produce', async () => {
  const { panel } = await mountPanel();
  const picker = panel.shadow.querySelector('input[data-picker="image"]');
  assert.ok(picker, 'a picker of its own, separate from the theme importer');

  for (const kind of ['.png', '.jpg', '.jpeg', '.heic', '.svg']) {
    assert.ok(picker.accept.includes(kind), `${kind} is accepted`);
  }
  assert.ok(picker.hidden, 'opened by the button rather than shown');
  assert.ok(picker.getAttribute('aria-label'), 'and still named');
});

test('the theme importer and the image picker do not open each other', async () => {
  const { panel } = await mountPanel();
  const opened = [];
  for (const input of panel.shadow.querySelectorAll('input[type="file"]')) {
    input.addEventListener('click', () => opened.push(input.dataset.picker ?? 'theme'));
  }

  panel.pickFile();
  assert.deepEqual(opened, ['theme'], 'importing a theme opens the theme picker');

  panel.pickImage();
  assert.deepEqual(opened, ['theme', 'image'], 'and the + opens the image one');
});

test('the code tool shows both scopes, and the apply button carries what was typed', async () => {
  const { panel } = await mountPanel({
    view: 'edit',
    editor: {
      mode: 'design', tool: 'code', dirty: false, history: {}, unmatched: 0,
      siteRules: 0, elementCss: 'color: red;', siteCss: '',
      selection: selectionDetail(),
    },
  });

  const element = panel.shadow.querySelector('[data-code="element"]');
  const site = panel.shadow.querySelector('[data-code="site"]');
  assert.ok(element && site, 'both panes are on screen at once');
  assert.equal(element.value, 'color: red;', 'the selection’s own declarations are shown');

  // The pane carries its value in the DOM, so the button has to go and fetch it at the
  // moment of the press — what is in the box until then is a draft.
  site.value = '.card { padding: 8px }';
  const seen = [];
  panel.on('action', (payload) => seen.push(payload));
  panel.shadow.querySelector('[data-action="apply-site-css"]').click();

  assert.deepEqual(seen, [{ action: 'apply-site-css', value: '.card { padding: 8px }' }]);
});

test('what could not be written is named under the box it was typed in', async () => {
  // Never a toast: a message about the third line of what you wrote has to stay on screen
  // next to the third line of what you wrote.
  const { panel } = await mountPanel({
    view: 'edit',
    codeErrors: { site: ['"[data-webin]" is not a selector the editor will write.'] },
    editor: {
      mode: 'design', tool: 'code', dirty: false, history: {}, unmatched: 0,
      siteRules: 1, elementCss: '', siteCss: '', selection: null,
    },
  });

  assert.match(panel.shadow.querySelector('.webin-code-notes').textContent, /not a selector/);
});

test('with nothing selected the code tool still offers the site sheet', async () => {
  const { panel } = await mountPanel({
    view: 'edit',
    editor: {
      mode: 'design', tool: 'code', dirty: false, history: {}, unmatched: 0,
      siteRules: 0, elementCss: '', siteCss: '', selection: null,
    },
  });

  assert.equal(panel.shadow.querySelector('[data-code="element"]'), null);
  assert.ok(panel.shadow.querySelector('[data-code="site"]'), 'a selector needs no selection');
  assert.match(panel.shadow.querySelector('.webin-code-empty').textContent, /Click something/);
});

test('the selection head steps both ways through the tree', async () => {
  const { panel } = await mountPanel({
    view: 'edit',
    editor: {
      mode: 'design', dirty: false, history: {}, unmatched: 0,
      selection: selectionDetail({ canSelectParent: true, canSelectChild: true }),
    },
  });

  const seen = [];
  panel.on('action', (payload) => seen.push(payload));
  panel.shadow.querySelector('[data-action="select-parent"]').click();
  panel.shadow.querySelector('[data-action="select-child"]').click();

  assert.deepEqual(seen.map((a) => a.action), ['select-parent', 'select-child']);
});

test('a step with nowhere to go is offered but not live', async () => {
  // A leaf element still shows the button — the row must not shuffle sideways as the
  // selection moves — but pressing it would do nothing, so it says so.
  const { panel } = await mountPanel({
    view: 'edit',
    editor: {
      mode: 'design', dirty: false, history: {}, unmatched: 0,
      selection: selectionDetail({ canSelectParent: true, canSelectChild: false }),
    },
  });

  const parent = panel.shadow.querySelector('[data-action="select-parent"]');
  const child = panel.shadow.querySelector('[data-action="select-child"]');
  assert.equal(parent.hasAttribute('disabled'), false);
  assert.equal(child.hasAttribute('disabled'), true);
});

test('the selection head steps sideways too, and says when a side is empty', async () => {
  // Up and down alone leave every sibling but the first unreachable — the second card in a
  // row was a climb up and a guess back down. Two more buttons, same row, same rules: drawn
  // whether or not there is somewhere to go, and not live when there is not.
  const { panel } = await mountPanel({
    view: 'edit',
    editor: {
      mode: 'design', dirty: false, history: {}, unmatched: 0,
      selection: selectionDetail({ canSelectPrevious: false, canSelectNext: true }),
    },
  });

  const seen = [];
  panel.on('action', (payload) => seen.push(payload));
  const previous = panel.shadow.querySelector('[data-action="select-previous"]');
  const next = panel.shadow.querySelector('[data-action="select-next"]');
  assert.equal(previous.hasAttribute('disabled'), true);
  assert.equal(next.hasAttribute('disabled'), false);
  next.click();
  assert.deepEqual(seen.map((a) => a.action), ['select-next']);
});

test('the inspector lists the CSS the site applies, as the page names the element', async () => {
  const { panel } = await mountPanel({
    view: 'edit',
    editor: {
      mode: 'design', dirty: false, history: {}, unmatched: 0,
      selection: selectionDetail({
        styles: {
          target: 'button#cta.buy.large',
          inline: [{ property: 'color', value: 'red', important: false, overridden: false }],
          rules: [
            { selector: '.buy', source: 'site.css', media: null, declarations: [
              { property: 'padding', value: '10px 18px', important: false, overridden: false },
              { property: 'color', value: 'blue', important: false, overridden: true },
            ] },
            { selector: 'button', source: '<style>', media: '(max-width: 600px)', declarations: [
              { property: 'padding', value: '4px', important: false, overridden: true },
            ] },
          ],
          blocked: 0,
        },
      }),
    },
  });

  const sh = panel.shadow;
  assert.equal(sh.querySelector('.webin-styles-target').textContent, 'button#cta.buy.large');
  const rules = [...sh.querySelectorAll('.webin-rule .webin-rule-sel')].map((n) => n.textContent);
  assert.deepEqual(rules, ['element.style', '.buy', 'button'], 'inline first, then the rules, most powerful first');
  const struck = [...sh.querySelectorAll('.webin-decl.is-overridden')].map((n) => n.textContent.replace(/\s+/g, ' ').trim());
  assert.deepEqual(struck, ['color: blue;', 'padding: 4px;'], 'what a stronger rule beat is struck through');
  assert.match(sh.querySelector('.webin-rule-media').textContent, /max-width/);
  assert.match(sh.querySelector('[data-section="styles"] .webin-section-toggle').textContent, /Styles · 3/);
});

/** A styles payload with one rule of the site's and, optionally, one of yours. */
function stylesFixture({ own = [] } = {}) {
  return {
    target: 'button.buy',
    own,
    inline: null,
    rules: [
      { selector: '.buy', source: 'site.css', media: null, key: '[null,".buy"]', editable: true, ours: false, declarations: [
        { property: 'color', value: 'blue', important: false, overridden: own.length > 0 },
        { property: 'padding', value: '10px 18px', important: false, overridden: false },
      ] },
      { selector: '.md\\:flex', source: 'site.css', media: null, key: '[null,".md\\\\:flex"]', editable: false, ours: false, declarations: [
        { property: 'display', value: 'flex', important: false, overridden: false },
      ] },
    ],
    blocked: 0,
  };
}

test('a site rule opens for editing in place, prefilled with what the site wrote', async () => {
  const detail = selectionDetail({ id: 'el1', styles: stylesFixture() });
  const { panel } = await mountPanel({
    view: 'edit',
    editor: { mode: 'design', tool: 'edit', dirty: false, history: {}, unmatched: 0, selection: detail },
  });
  const sh = panel.shadow;
  const pencils = [...sh.querySelectorAll('[data-action="edit-rule"]')];
  assert.equal(pencils.length, 1, 'a selector the site stylesheet cannot carry has no pencil');
  assert.equal(pencils[0].dataset.value, '[null,".buy"]');

  const seen = [];
  panel.on('action', (payload) => seen.push(payload));
  pencils[0].click();
  assert.deepEqual(seen, [{ action: 'edit-rule', value: '[null,".buy"]' }]);

  // The runtime says which rule is open; the box takes the body's place, and the caret.
  panel.setState({ ruleEdit: { key: 'el1', rule: '[null,".buy"]' } });
  const area = sh.querySelector('[data-code="rule"]');
  assert.ok(area, 'the rule is a box now');
  assert.equal(area.value, 'color: blue;\npadding: 10px 18px;');
  assert.equal(sh.querySelector('[data-rule=\'[null,".buy"]\'] [data-action="edit-rule"]'), null, 'no pencil on an open rule');
  assert.equal(sh.activeElement, area, 'the pencil that vanished handed its focus to the box');

  // Typing, then a repaint — the way clicking the page does — keeps what was typed.
  area.value = 'color: red;\npadding: 10px 18px;';
  area.dispatchEvent(new sh.ownerDocument.defaultView.Event('input', { bubbles: true }));
  panel.setState({ editor: { ...panel.state.editor } });
  assert.equal(sh.querySelector('[data-code="rule"]').value, 'color: red;\npadding: 10px 18px;');

  seen.length = 0;
  sh.querySelector('[data-action="apply-rule-css"]').click();
  assert.deepEqual(seen, [{
    action: 'apply-rule-css',
    value: { selector: '.buy', media: null, base: { color: 'blue', padding: '10px 18px' }, css: 'color: red;\npadding: 10px 18px;' },
  }], 'the text goes with the rule it is a version of, and what the site said');
});

test('an open rule belongs to the element it was opened on', async () => {
  const detail = selectionDetail({ id: 'el1', styles: stylesFixture() });
  const { panel } = await mountPanel({
    view: 'edit',
    ruleEdit: { key: 'el1', rule: '[null,".buy"]' },
    editor: { mode: 'design', tool: 'edit', dirty: false, history: {}, unmatched: 0, selection: detail },
  });
  const sh = panel.shadow;
  assert.ok(sh.querySelector('[data-code="rule"]'));
  panel.setState({ editor: { ...panel.state.editor, selection: selectionDetail({ id: 'el2', styles: stylesFixture() }) } });
  assert.equal(sh.querySelector('[data-code="rule"]'), null, 'a different element, so nothing is open there');
  assert.equal(sh.querySelectorAll('[data-action="edit-rule"]').length, 1);
});

test('your version of a rule sits on top, marked as yours, with a bin beside its pencil', async () => {
  const own = [{ selector: '.buy', source: 'yours', media: null, key: '[null,".buy"]', editable: true, ours: true, declarations: [
    { property: 'color', value: 'red', important: false, overridden: false },
  ] }];
  const detail = selectionDetail({ id: 'el1', styles: stylesFixture({ own }) });
  const { panel } = await mountPanel({
    view: 'edit',
    editor: { mode: 'design', tool: 'edit', dirty: false, history: {}, unmatched: 0, selection: detail },
  });
  const sh = panel.shadow;
  const rules = [...sh.querySelectorAll('.webin-rule')];
  assert.equal(rules[0].classList.contains('is-yours'), true);
  assert.equal(rules[0].querySelector('.webin-rule-src').textContent, 'yours');
  assert.ok(rules[0].querySelector('[data-action="remove-rule"]'));
  assert.equal(rules[1].querySelector('[data-action="remove-rule"]'), null, 'the site\'s rule is not yours to remove');
  assert.match(sh.querySelector('[data-section="styles"] .webin-section-toggle').textContent, /Styles · 3/);

  // Opening yours shows the site's rule with your change written over it — in one box,
  // on the site's rule, since that is what is being edited; yours keeps its bin.
  panel.setState({ ruleEdit: { key: 'el1', rule: '[null,".buy"]' } });
  const boxes = [...sh.querySelectorAll('[data-code="rule"]')];
  assert.equal(boxes.length, 1, 'two rules with one selector, one box');
  assert.equal(boxes[0].closest('.webin-rule').classList.contains('is-yours'), false);
  assert.equal(boxes[0].value, 'color: red;\npadding: 10px 18px;');
  assert.equal(sh.querySelectorAll('[data-action="edit-rule"]').length, 0, 'no pencil anywhere for the open selector');
  assert.ok(sh.querySelector('.is-yours [data-action="remove-rule"]'));

  const seen = [];
  panel.on('action', (payload) => seen.push(payload));
  sh.querySelector('[data-action="cancel-rule"]').click();
  assert.deepEqual(seen, [{ action: 'cancel-rule', value: null }]);
});

test('a code pane keeps its draft across a repaint, and drops it once applied', async () => {
  const detail = selectionDetail({ id: 'el1' });
  const { panel } = await mountPanel({
    view: 'edit',
    editor: {
      mode: 'design', tool: 'code', dirty: false, history: {}, unmatched: 0,
      siteRules: 0, elementCss: '', siteCss: '', selection: detail,
    },
  });
  const sh = panel.shadow;
  const site = sh.querySelector('[data-code="site"]');
  site.value = 'footer { color: red }';
  site.dispatchEvent(new panel.shadow.ownerDocument.defaultView.Event('input', { bubbles: true }));

  // The caret leaves the box and the panel repaints — the way clicking the page to look at
  // another element does. What was typed is still there.
  panel.setState({ editor: { ...panel.state.editor, siteRules: 0, selection: selectionDetail({ id: 'el2' }) } });
  assert.equal(sh.querySelector('[data-code="site"]').value, 'footer { color: red }');

  const seen = [];
  panel.on('action', (payload) => seen.push(payload));
  sh.querySelector('[data-action="apply-site-css"]').click();
  assert.deepEqual(seen, [{ action: 'apply-site-css', value: 'footer { color: red }' }]);

  // Applied, the runtime hands back the canonical text, and that is what shows now.
  panel.setState({ editor: { ...panel.state.editor, siteRules: 1, siteCss: 'footer { color: red }' } });
  assert.equal(sh.querySelector('[data-code="site"]').value, 'footer { color: red }');
});

test('an element draft belongs to the element it was written for', async () => {
  const { panel } = await mountPanel({
    view: 'edit',
    editor: {
      mode: 'design', tool: 'code', dirty: false, history: {}, unmatched: 0,
      siteRules: 0, elementCss: 'color: red;', siteCss: '', selection: selectionDetail({ id: 'el1' }),
    },
  });
  const sh = panel.shadow;
  const Event = panel.shadow.ownerDocument.defaultView.Event;
  const area = sh.querySelector('[data-code="element"]');
  area.value = 'color: red;\npadding: 4px;';
  area.dispatchEvent(new Event('input', { bubbles: true }));

  panel.setState({ editor: { ...panel.state.editor, elementCss: '', selection: selectionDetail({ id: 'el2', label: 'h2' }) } });
  assert.equal(sh.querySelector('[data-code="element"]').value, '', 'another element, another box');
});

test('Tab indents inside a code pane, Escape only leaves the box, and the result is said in the pane', async () => {
  const { panel } = await mountPanel({
    view: 'edit',
    codeStatus: { site: '2 rules live' },
    editor: {
      mode: 'design', tool: 'code', dirty: false, history: {}, unmatched: 0,
      siteRules: 2, elementCss: '', siteCss: '', selection: null,
    },
  });
  const sh = panel.shadow;
  const win = panel.shadow.ownerDocument.defaultView;
  const area = sh.querySelector('[data-code="site"]');
  area.value = 'a {\n}';
  area.focus();
  area.setSelectionRange(4, 4);
  area.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  assert.equal(area.value, 'a {\n  }', 'two spaces in, and the field kept the focus');

  const seen = [];
  panel.on('action', (payload) => seen.push(payload));
  area.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.deepEqual(seen, [], 'Escape in the box is not a way out of Edit mode');
  assert.equal(panel.state.view, 'edit');

  assert.equal(sh.querySelector('.webin-code-status').textContent, '2 rules live', 'said beside the box, not in a toast over the button');
  assert.equal(sh.querySelector('.wb-toast'), null);
});

test('Escape on the panel in Edit mode asks the runtime to leave it, so the editor lets go', async () => {
  const { panel } = await mountPanel({
    view: 'edit',
    editor: { mode: 'design', tool: 'edit', dirty: false, history: {}, unmatched: 0, selection: null },
  });
  const seen = [];
  panel.on('action', (payload) => seen.push(payload));
  const win = panel.shadow.ownerDocument.defaultView;
  panel.shadow.querySelector('.wb-panel').dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.deepEqual(seen, [{ action: 'mode', value: 'gallery' }]);
});
