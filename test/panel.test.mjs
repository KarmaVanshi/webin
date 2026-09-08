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
  const yourCards = panel.shadow.querySelectorAll('.wb-cell .wb-card-del');
  assert.equal(yourCards.length, 1, 'only your own themes can be deleted');
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
