/**
 * The panel — the entire user interface.
 *
 * Version 1 does one job, so it gets one surface: a card in the corner with a gallery of
 * themes, a menu for the things you do occasionally, and a footer that tells you what is
 * currently applied. No docks, no toolbar, no status bar. Clicking a theme applies it
 * immediately; there is no Apply button, because a preview you have to confirm is just a
 * slower preview.
 *
 * The panel lives in its own shadow root, which is what keeps the page from styling it —
 * and, since this extension's whole job is restyling pages, what keeps *the theme* from
 * styling it either.
 */

import { Emitter, escapeHtml } from '../shared/util.js';
import { OWNED_ATTR, APPEARANCE_ATTR } from '../shared/types.js';
import { NAME_LIMIT, backdropCss } from '../shared/theme-format.js';
import { IMAGE_ACCEPT, ImageError, readImageFile } from '../shared/image.js';
import { GROUPS } from '../themes/library.js';
import { panelCss } from './panel-css.js';
import { icon } from './icons.js';
import { renderInspector, renderEditorBar } from './inspector.js';

/**
 * Colours reach the DOM inside `style` attributes, so they are filtered down to the
 * characters a colour or gradient can be made of before they get there. Everything in a
 * theme has already been through the format validator; this is the second lock.
 */
const CSS_SAFE = /[^a-zA-Z0-9#(),.%\-\s/]/g;
const css = (value) => String(value ?? '').replace(CSS_SAFE, '').slice(0, 400);

/**
 * State keys whose change rearranges nothing, and so can be written into the DOM in place.
 *
 * Deliberately a short list. Everything else repaints, because a patch that disagrees with
 * `render()` about what the panel should look like is a bug that only shows up sometimes.
 */
const IN_PLACE = new Set(['activeId', 'toast']);

/** Whether a state value is unchanged. Objects are new each time, so they always are not. */
const settled = (before, after) => before === after
  || (before === null && after === null)
  || (before === undefined && after === undefined);

export class Panel extends Emitter {
  #doc;
  #host = null;
  #shadow = null;
  #root = null;
  #toastTimer = null;
  /**
   * What is in each code pane that has not been applied yet.
   *
   * The panes carry their text in the DOM, and a repaint that happens while the caret is
   * elsewhere — clicking the page to look at another element, say — would put the last
   * *applied* text back and throw the draft away. So the draft is kept here and drawn
   * back in, until it is applied or, for the element pane, until the selection moves on.
   */
  #drafts = { element: null, site: null };
  #state = {
    host: '',
    themes: [],
    activeId: null,
    appearance: 'light',
    forceReadable: true,
    side: 'right',
    view: 'gallery',
    share: null,
    preview: null,
    /** `{ id, name, error }` while a theme is being named. */
    rename: null,
    /** Live editor state, handed over by the runtime whenever it changes. */
    editor: null,
    /** How many hand edits this site has saved, for the reset items. */
    editCount: 0,
    /** Which inspector sections are open, and which box fields are linked. Panel state:
     *  it is about looking at the page, not about changing it. */
    sections: { styles: true, layout: false, spacing: true, type: true, appearance: true, flex: false },
    linked: { padding: true, margin: true },
    menuOpen: false,
    toast: null,
  };

  constructor({ doc = document } = {}) {
    super();
    this.#doc = doc;
  }

  get visible() { return Boolean(this.#host?.isConnected); }
  get state() { return this.#state; }
  get shadow() { return this.#shadow; }

  mount(state = {}) {
    Object.assign(this.#state, state);
    if (this.visible) { this.render(); return this.#shadow; }

    const host = this.#doc.createElement('div');
    host.setAttribute(OWNED_ATTR, '');
    // `all: initial` walls the panel off from any inherited page styling; one maximal
    // z-index at the boundary and a small scale inside.
    host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483647;'
      + ' pointer-events: none; isolation: isolate;';
    this.#doc.documentElement.appendChild(host);

    const shadow = host.attachShadow({ mode: 'open' });
    const style = this.#doc.createElement('style');
    style.textContent = panelCss;
    shadow.append(style);

    const root = this.#doc.createElement('div');
    root.className = 'wb-root';
    shadow.append(root);

    const file = this.#doc.createElement('input');
    file.type = 'file';
    file.accept = '.json,.jsonc,.css,.txt,.yaml,.yml,application/json,text/css,text/plain';
    file.hidden = true;
    // Opened from the Import sheet's button rather than shown, but a control with no name
    // is still a control with no name.
    file.setAttribute('aria-label', 'Choose a theme file');
    file.addEventListener('change', this.#onFile);
    shadow.append(file);

    // A second picker, because the two take different files and mean different things: one
    // replaces the theme, the other sets a property on the element you have selected.
    const picture = this.#doc.createElement('input');
    picture.type = 'file';
    picture.accept = IMAGE_ACCEPT;
    picture.hidden = true;
    picture.setAttribute('aria-label', 'Choose a background image');
    picture.dataset.picker = 'image';
    picture.addEventListener('change', this.#onImageFile);
    shadow.append(picture);

    this.#host = host;
    this.#shadow = shadow;
    this.#root = root;

    root.addEventListener('click', this.#onClick);
    root.addEventListener('keydown', this.#onKeyDown);
    // `input` previews, `change` commits. That distinction is the difference between a
    // slider drag being one undo step and being fifty.
    root.addEventListener('input', this.#onInput);
    root.addEventListener('change', this.#onChange);
    // Keystrokes inside the panel must never reach the page's own shortcuts.
    root.addEventListener('keyup', (event) => event.stopPropagation());
    root.addEventListener('keypress', (event) => event.stopPropagation());

    // A click on the page itself never reaches the panel's own listener, so the menu
    // needs the document to tell it when the user has moved on.
    this.#doc.addEventListener('pointerdown', this.#onOutside, true);

    this.#applyAppearance();
    this.render();
    this.#shadow.querySelector('.wb-panel')?.focus();
    return shadow;
  }

  unmount() {
    clearTimeout(this.#toastTimer);
    this.#doc.removeEventListener('pointerdown', this.#onOutside, true);
    this.#host?.remove();
    this.#host = null;
    this.#shadow = null;
    this.#root = null;
  }

  /**
   * Merges state and shows the result.
   *
   * A repaint used to rebuild the panel's whole subtree, which is fine when the panel is
   * showing something else afterwards and quietly awful when it is not: the gallery's
   * scroll position goes back to the top, whatever had keyboard focus loses it, and every
   * hover and transition restarts. Applying a theme used to do that three times over —
   * once for the new tick, once for the toast, and once more when the toast expired a few
   * seconds later, so the panel appeared to refresh itself long after the click.
   *
   * Two things answer that now. A change that alters no structure is applied to the DOM
   * directly, so it never reaches `render` at all; and `render` itself reconciles rather
   * than rebuilds, so even a real repaint keeps the nodes it still wants.
   */
  setState(patch = {}) {
    const changed = Object.keys(patch).filter((key) => !settled(this.#state[key], patch[key]));
    Object.assign(this.#state, patch);
    if (!this.#root) return;
    if ('appearance' in patch) this.#applyAppearance();
    if (!changed.length) return;
    if (changed.every((key) => IN_PLACE.has(key)) && this.#patch(changed)) return;
    this.render();
  }

  /**
   * Applies the cosmetic changes without a repaint.
   *
   * Returns false if it cannot — an unexpected view, a panel mid-rebuild — and the caller
   * falls back to a full render, so this is an optimisation and never a second source of
   * truth about what the panel should look like.
   */
  #patch(changed) {
    if (!this.#root.querySelector('.wb-panel')) return false;
    const patchers = {
      activeId: () => this.#patchActive(),
      toast: () => this.#patchToast(),
    };
    // A key with no patcher yields undefined, which is not true, which repaints. Adding to
    // `IN_PLACE` and forgetting to write the patch therefore costs a repaint, not a lie.
    return changed.every((key) => patchers[key]?.() === true);
  }

  /** Moves the tick, and retitles the footer that names what is applied. */
  #patchActive() {
    const s = this.#state;
    // Only the gallery draws the tick; any other view has to be rendered properly. The
    // menu is excluded for the same reason — its share and export items are enabled by
    // there being something applied, so it is showing `activeId` too.
    if (s.view !== 'gallery' || s.menuOpen) return false;
    for (const card of this.#root.querySelectorAll('.wb-card')) {
      const on = card.dataset.value === s.activeId;
      card.classList.toggle('is-on', on);
      card.setAttribute('aria-pressed', String(on));
      const name = card.querySelector('.wb-card-name');
      const mark = name?.querySelector('.wb-check');
      if (on && name && !mark) {
        name.insertAdjacentHTML('beforeend', `<span class="wb-check">${icon('check', 12)}</span>`);
      } else if (!on && mark) {
        mark.remove();
      }
    }
    const foot = this.#root.querySelector('.wb-foot');
    if (foot) foot.outerHTML = footer(s);
    return true;
  }

  /** The toast is a leaf at the end of the panel, so it comes and goes on its own. */
  #patchToast() {
    const panel = this.#root.querySelector('.wb-panel');
    const showing = panel.querySelector('.wb-toast');
    const next = this.#state.toast;
    if (!next) { showing?.remove(); return true; }
    if (showing) showing.outerHTML = toast(next);
    else panel.insertAdjacentHTML('beforeend', toast(next));
    return true;
  }

  toast(tone, message, timeout = 3200) {
    clearTimeout(this.#toastTimer);
    this.setState({ toast: { tone, message } });
    if (timeout > 0) {
      this.#toastTimer = setTimeout(() => this.setState({ toast: null }), timeout);
    }
  }

  render() {
    if (!this.#root) return;
    const s = this.#state;
    // What had the caret, so a repaint mid-sheet does not send focus back to the dialog
    // and lose the selection with it. A theme card has no id, so it is found again by the
    // action it carries — otherwise applying a theme with the keyboard drops you out of
    // the gallery entirely.
    const focused = this.#focused();
    // How far down the gallery had been scrolled. Worth keeping only while the panel goes
    // on showing the same thing: arriving at a new view part-way down it would be worse
    // than arriving at the top of it.
    const staying = this.#root.querySelector('.wb-panel')?.dataset.view === s.view;
    const scrolled = staying ? this.#root.querySelector('.wb-body')?.scrollTop ?? 0 : 0;
    reconcile(this.#root, `
<div class="wb-panel" data-side="${s.side === 'left' ? 'left' : 'right'}"
  data-view="${s.view}" role="dialog" aria-label="Webin" tabindex="-1">
  ${header(s)}
  ${s.menuOpen ? menu(s) : ''}
  <div class="wb-body">${s.view === 'import' ? importSheet()
    : s.view === 'preview' ? previewSheet(s)
    : s.view === 'share' ? shareSheet(s)
    : s.view === 'rename' ? renameSheet(s)
    : s.view === 'edit' ? renderInspector(s.editor?.selection ?? null, { ...s, drafts: this.#drafts })
    : gallery(s)}</div>
  ${footer(s)}
  ${s.toast ? toast(s.toast) : ''}
</div>`);

    const body = this.#root.querySelector('.wb-body');
    if (body && scrolled) body.scrollTop = scrolled;

    // A field the user was in keeps the caret; a field that has just appeared takes it, so
    // opening the rename sheet lands you in the name rather than one Tab away from it.
    // Reconciling means the first case usually needs nothing done to it — the field was
    // never removed — but a change of view really does build new controls.
    const restore = focused
      ? this.#root.querySelector(focused)
      : (staying ? null : this.#root.querySelector('[data-autofocus]'));
    if (restore && restore !== this.#shadow?.activeElement) {
      restore.focus({ preventScroll: true });
      if (!focused && typeof restore.select === 'function') restore.select();
    }
  }

  /**
   * A selector that will find whatever has focus again after a repaint.
   *
   * An id when there is one, and otherwise the action the control carries, which is how
   * every button in the panel already identifies itself to the runtime.
   */
  #focused() {
    const element = this.#shadow?.activeElement;
    if (!element || !this.#root?.contains(element)) return null;
    if (element.id) return `#${CSS.escape(element.id)}`;
    const { action, value } = element.dataset ?? {};
    if (!action) return null;
    const quote = (text) => String(text).replace(/["\\]/g, '\\$&');
    return value === undefined
      ? `[data-action="${quote(action)}"]`
      : `[data-action="${quote(action)}"][data-value="${quote(value)}"]`;
  }

  /** Opens the theme file picker; the change handler emits the file's text. */
  pickFile() {
    this.#shadow?.querySelector('input[type="file"]:not([data-picker])')?.click();
  }

  /** Opens the image picker; the change handler emits a `data:` URL. */
  pickImage() {
    this.#shadow?.querySelector('input[data-picker="image"]')?.click();
  }

  #applyAppearance() {
    const appearance = this.#state.appearance === 'dark' ? 'dark' : 'light';
    this.#host.setAttribute(APPEARANCE_ATTR, appearance);
    // `all: initial` on the host outranks any rule in the sheet, so this one goes inline.
    this.#host.style.colorScheme = appearance;
  }

  #onOutside = (event) => {
    if (!this.#state.menuOpen) return;
    // Inside the panel's shadow root the event's composed path contains the host itself.
    if (event.composedPath?.().includes(this.#host)) return;
    this.setState({ menuOpen: false });
  };

  #onFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      this.emit('action', { action: 'import', value: await file.text() });
    } catch {
      this.toast('error', 'That file could not be read.');
    }
  };

  #onImageFile = async (event) => {
    const input = event.target;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      // A photo takes a moment to decode and shrink, and a picker that closes onto nothing
      // reads as one that failed.
      this.toast('info', 'Reading that image…', 0);
      const image = await readImageFile(file, this.#doc.defaultView ?? globalThis);
      // The dimensions travel with the URL: how the picture should sit in the box depends
      // on its shape, and this is the only place that knows it.
      this.emit('action', { action: 'background-image', value: image });
    } catch (error) {
      // An `ImageError` is a sentence written for the person who picked the file; anything
      // else is a fault, and "that could not be read" is the honest summary of one.
      this.toast('error', error instanceof ImageError ? error.message : 'That image could not be read.');
    }
  };

  #onClick = (event) => {
    // Some controls are buttons — a segmented choice, a link toggle — so they never fire
    // `change` and have to be picked up here instead.
    const control = event.target.closest?.('[data-control][data-interactive]');
    if (control) {
      event.preventDefault();
      event.stopPropagation();
      this.#emitControl(control, 'commit', control.dataset.value ?? null);
      return;
    }

    const trigger = event.target.closest?.('[data-action]');
    if (!trigger) {
      // A click anywhere else in the panel dismisses the menu.
      if (this.#state.menuOpen) this.setState({ menuOpen: false });
      return;
    }
    event.preventDefault();
    event.stopPropagation();

    // The code panes carry their value in the DOM rather than in an attribute, so the
    // button that applies one has to go and fetch it. Read at the moment of the press, not
    // on every keystroke: what is in the box until then is a draft.
    const action = trigger.dataset.action;
    const scope = action === 'apply-element-css' ? 'element' : action === 'apply-site-css' ? 'site' : null;
    if (scope) {
      this.#applyCode(scope);
      return;
    }

    this.emit('action', { action, value: trigger.dataset.value ?? null });
  };

  /** Hands a code pane's text to the runtime. Applied text is no longer a draft. */
  #applyCode(scope) {
    const area = this.#shadow?.querySelector(`[data-code="${scope}"]`);
    this.#drafts[scope] = null;
    this.emit('action', { action: `apply-${scope}-css`, value: area?.value ?? '' });
  }

  /** Remembers what is in a code pane, keyed to the selection it was written for. */
  #keepDraft(area) {
    const scope = area?.dataset?.code;
    if (!scope) return;
    this.#drafts[scope] = {
      text: area.value,
      key: scope === 'element' ? (this.#state.editor?.selection?.id ?? null) : null,
    };
  }

  #onInput = (event) => {
    // The counter is written straight into the DOM rather than through `setState`, because
    // repainting the panel while someone is typing in it would take their caret with it.
    if (event.target?.id === 'wb-rename') {
      const count = this.#shadow?.querySelector('.wb-count');
      if (count) count.textContent = `${event.target.value.length}/${NAME_LIMIT}`;
      return;
    }
    if (event.target?.dataset?.code) {
      this.#keepDraft(event.target);
      return;
    }
    const control = event.target.closest?.('[data-control]');
    if (!control) return;
    // Only the continuous controls are worth previewing; a text field mid-typing is not.
    const kind = control.dataset.control;
    if (kind !== 'range' && kind !== 'color') return;
    this.#emitControl(control, 'preview');
  };

  #onChange = (event) => {
    const control = event.target.closest?.('[data-control]');
    if (!control) return;
    this.#emitControl(control, 'commit');
  };

  #emitControl(control, phase, override = null) {
    const field = control.closest('.webin-field, .webin-row') ?? control.parentElement;
    const prop = control.dataset.prop;
    this.emit('control', {
      phase,
      control: control.dataset.control,
      prop,
      side: control.dataset.side ?? null,
      value: override ?? (control.type === 'checkbox' ? control.checked : control.value),
      // A length is split across two elements: the number and the unit beside it. Whichever
      // one the user touched, the editor needs both to build a value.
      unit: field?.querySelector?.(`[data-control="unit"][data-prop="${CSS.escape(prop ?? '')}"]`)?.value ?? null,
      number: field?.querySelector?.(`[data-control="number"][data-prop="${CSS.escape(prop ?? '')}"]`)?.value ?? null,
      // Every side of a box field, so a linked change can move all four at once.
      sides: control.dataset.control === 'box'
        ? Object.fromEntries([...(field?.querySelectorAll?.('[data-control="box"]') ?? [])]
          .map((input) => [input.dataset.side, input.value]))
        : null,
    });
  }

  #onKeyDown = (event) => {
    event.stopPropagation();

    // The code panes are a code editor, however small, and the muscle memory that comes
    // with one should work: Tab indents rather than leaving the field, Shift+Tab takes the
    // indent back, and ⌘Enter applies what was written.
    const code = event.target?.dataset?.code ? event.target : null;
    if (code && event.key === 'Tab' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      indentSelection(code, event.shiftKey);
      this.#keepDraft(code);
      return;
    }
    if (code && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      this.#applyCode(code.dataset.code);
      return;
    }
    if (code && event.key === 'Escape') {
      // Leaving the box is what Escape means inside one; it is not a request to leave
      // Edit mode, and it must never throw the text away.
      event.preventDefault();
      this.#keepDraft(code);
      code.blur();
      this.#shadow?.querySelector('.wb-panel')?.focus({ preventScroll: true });
      return;
    }

    // A name is one line, so Enter means "done" rather than "new paragraph".
    if (event.key === 'Enter' && event.target?.id === 'wb-rename') {
      event.preventDefault();
      this.emit('action', { action: 'save-name' });
      return;
    }
    if (event.key === 'Enter' && event.target?.id === 'wb-preview-name') {
      event.preventDefault();
      this.emit('action', { action: 'confirm-import' });
      return;
    }
    if (event.key !== 'Escape') return;
    event.preventDefault();
    if (this.#state.menuOpen) this.setState({ menuOpen: false });
    // Leaving Edit mode is the runtime's to do: the editor has hold of the page, and a
    // panel that merely showed the gallery would leave it holding on — clicks swallowed,
    // hover marks drawn, on a page that says it is not being edited.
    else if (this.#state.view === 'edit') this.emit('action', { action: 'mode', value: 'gallery' });
    else if (this.#state.view !== 'gallery') this.setState({ view: 'gallery', share: null, preview: null, rename: null });
    else this.emit('action', { action: 'close' });
  };

  /** The import textarea's current contents. */
  get importText() {
    return this.#shadow?.querySelector('#wb-import')?.value ?? '';
  }

  /** The address in the import sheet's URL field. */
  get importUrl() {
    return this.#shadow?.querySelector('#wb-import-url')?.value ?? '';
  }

  /** The name being typed in the rename sheet. */
  get renameValue() {
    return this.#shadow?.querySelector('#wb-rename')?.value ?? '';
  }

  /** The name being typed over a single theme in the import preview. */
  get previewName() {
    return this.#shadow?.querySelector('#wb-preview-name')?.value ?? '';
  }
}

// ─── Rendering ─────────────────────────────────────────────────────────────

function header(s) {
  const dark = s.appearance === 'dark';
  return `
<div class="wb-head">
  <span class="wb-mark" aria-hidden="true"></span>
  <span class="wb-name">Webin</span>
  <span class="wb-host" title="${escapeHtml(s.host)}">${escapeHtml(s.host)}</span>
  <div class="wb-modes" role="tablist" aria-label="What Webin is doing">
    ${modeTab('gallery', 'Themes', s)}
    ${modeTab('edit', 'Edit', s)}
  </div>
  <button type="button" class="wb-icon-btn" data-action="appearance"
    title="${dark ? 'Light panel' : 'Dark panel'}" aria-label="${dark ? 'Switch panel to light' : 'Switch panel to dark'}">
    ${icon(dark ? 'sun' : 'moon', 15)}</button>
  <button type="button" class="wb-icon-btn" data-action="menu" aria-haspopup="menu"
    aria-expanded="${s.menuOpen}" title="More" aria-label="More actions">${icon('more', 15)}</button>
  <button type="button" class="wb-icon-btn" data-action="close" title="Close (Esc)"
    aria-label="Close Webin">${icon('close', 15)}</button>
</div>`;
}

/**
 * The mode switch.
 *
 * Two tabs rather than two panels: the page is the workspace either way, and a second
 * window would just be a second place to look for the same site.
 */
function modeTab(view, label, s) {
  const on = view === 'edit' ? s.view === 'edit' : s.view !== 'edit';
  return `<button type="button" class="wb-mode${on ? ' is-on' : ''}" role="tab"
    aria-selected="${on}" data-action="mode" data-value="${view}">${escapeHtml(label)}</button>`;
}

function menu(s) {
  const hasActive = Boolean(s.activeId);
  const mine = s.themes.filter((t) => t.custom).length;
  const item = (action, name, label, disabled = false) => `
    <button type="button" class="wb-menu-item" data-action="${action}" ${disabled ? 'disabled' : ''}>
      ${icon(name, 15)}<span>${label}</span></button>`;
  return `
<div class="wb-menu" role="menu">
  ${item('capture', 'camera', 'Save this page as a theme')}
  ${item('open-import', 'upload', 'Import a theme…')}
  <div class="wb-menu-sep"></div>
  <button type="button" class="wb-menu-item" data-action="readable" role="menuitemcheckbox"
    aria-checked="${s.forceReadable !== false}"
    title="Force text a theme would leave unreadable to black or white">
    ${icon('check', 15)}<span>Force readable text</span>
    <span class="wb-menu-state">${s.forceReadable !== false ? 'On' : 'Off'}</span></button>
  <div class="wb-menu-sep"></div>
  ${item('share', 'share', 'Copy share code', !hasActive)}
  ${item('export', 'download', 'Download applied theme', !hasActive)}
  ${item('export-all', 'download', `Back up my themes (${mine})`, mine === 0)}
  <div class="wb-menu-sep"></div>
  ${item('reset-page', 'reset', 'Undo my edits on this page', !s.editCount)}
  ${item('reset-site', 'reset', `Undo my edits on ${s.host || 'this site'}`, !s.editCount)}
</div>`;
}

function gallery(s) {
  const sections = GROUPS.map((group) => {
    const themes = s.themes.filter((theme) => (theme.custom ? 'custom' : theme.group) === group.id);
    if (!themes.length) return '';
    return `<h2 class="wb-section">${group.label}</h2>
      <div class="wb-grid">${themes.map((theme) => card(theme, theme.id === s.activeId)).join('')}</div>`;
  }).join('');

  return sections || '<p class="wb-empty">No themes available.</p>';
}

function card(theme, active) {
  // Delete sits beside the card rather than inside it: a button within a button is
  // invalid, and it takes the keyboard with it when it goes wrong.
  return `
<div class="wb-cell">
  <button type="button" class="wb-card${active ? ' is-on' : ''}" data-action="apply"
    data-value="${escapeHtml(theme.id)}" aria-pressed="${active}"
    title="${escapeHtml(theme.description || theme.name)}">
    ${preview(theme)}
    <span class="wb-card-name"><span>${escapeHtml(theme.name)}</span>
      ${active ? `<span class="wb-check">${icon('check', 12)}</span>` : ''}</span>
  </button>
  ${theme.custom ? `<span class="wb-card-acts">
    <button type="button" class="wb-card-act" data-action="rename"
      data-value="${escapeHtml(theme.id)}" title="Rename ${escapeHtml(theme.name)}"
      aria-label="Rename ${escapeHtml(theme.name)}">${icon('pencil', 12)}</button>
    <button type="button" class="wb-card-act wb-card-act--del" data-action="delete"
      data-value="${escapeHtml(theme.id)}" title="Delete ${escapeHtml(theme.name)}"
      aria-label="Delete ${escapeHtml(theme.name)}">${icon('trash', 12)}</button>
  </span>` : ''}
</div>`;
}

/**
 * A theme rendered in miniature — palette, corner radius and surface treatment together,
 * because those three are what actually distinguishes one movement from another.
 */
function preview(theme) {
  const p = theme.palette;
  const radius = Math.min(theme.radius ?? 4, 10);
  // A gradient longer than the style guard admits would be cut mid-function and paint
  // nothing at all; the base colour is the honest preview of one that size.
  const painted = backdropCss(theme.effects.backdrop);
  const backdrop = painted && painted.length <= 400 ? painted : (theme.effects.backdrop?.base ?? p.background);
  const translucent = theme.effects.surfaceAlpha != null;
  const border = theme.effects.borderWidth
    ? `${Math.min(theme.effects.borderWidth, 2)}px solid ${css(p.border)}`
    : `1px solid ${css(translucent ? p.border : p.background)}`;

  return `
<span class="wb-prev" style="background:${css(backdrop)}">
  <span class="wb-prev-card" style="background:${css(p.surface)};border:${border};
    border-radius:${radius}px;box-shadow:${previewShadow(theme)}${translucent ? ';opacity:.86' : ''}">
    <span class="wb-line" style="background:${css(p.text)};width:34%"></span>
    <span class="wb-pill" style="background:${css(p.accent)};border-radius:${Math.min(radius, 4)}px"></span>
  </span>
  <span class="wb-line" style="background:${css(p.text)};width:72%"></span>
  <span class="wb-line" style="background:${css(p.textMuted)};width:54%"></span>
  <span class="wb-line" style="background:${css(p.textMuted)};width:63%"></span>
</span>`;
}

function previewShadow(theme) {
  const accent = css(theme.palette.accent);
  switch (theme.shadow) {
    case 'hard': return `2px 2px 0 0 ${css(theme.palette.border)}`;
    case 'deep': return 'inset 0 1px 0 rgba(255,255,255,.6), 0 2px 4px rgba(0,0,0,.32)';
    case 'neu': return '-2px -2px 4px rgba(255,255,255,.9), 2px 2px 5px rgba(0,0,0,.16)';
    case 'glass': return '0 3px 12px rgba(0,0,0,.4)';
    case 'glow': return `0 0 0 1px ${accent}, 0 0 10px ${accent}`;
    case 'sharp': return '0 1px 0 rgba(0,0,0,.2)';
    case 'soft': return '0 2px 6px rgba(0,0,0,.16)';
    default: return 'none';
  }
}

function importSheet() {
  return `
<div class="wb-sheet">
  <label class="wb-label" for="wb-import">Paste a share code, or a theme from anywhere else</label>
  <textarea class="wb-input" id="wb-import" spellcheck="false" autocomplete="off"
    placeholder="webin:1z:… · a .webin.json file · a CSS :root block · a VS Code theme · a base16 scheme"></textarea>
  <div class="wb-row">
    <button type="button" class="wb-btn wb-btn--primary" data-action="import-text">Import</button>
    <button type="button" class="wb-btn" data-action="import-file">Choose file…</button>
  </div>

  <label class="wb-label" for="wb-import-url">Or fetch one from a web address</label>
  <div class="wb-row">
    <input class="wb-input wb-input--line" id="wb-import-url" type="url" spellcheck="false"
      autocomplete="off" placeholder="netflix.com — or any theme file">
    <button type="button" class="wb-btn" data-action="import-url">Fetch</button>
  </div>
  <p class="wb-hint">Fetching is the one thing Webin does over the network, it happens only when
    you ask, and the request carries none of your cookies.</p>

  <div class="wb-row">
    <span style="flex:1"></span>
    <button type="button" class="wb-btn wb-btn--quiet" data-action="cancel">Cancel</button>
  </div>
  <p class="wb-hint">Whatever arrives is rebuilt field by field before it is saved — colours must be
    real colours, and anything that is not part of a theme is dropped.</p>
</div>`;
}

/** Where a theme came from, in words the person importing it will recognise. */
const SOURCE_LABEL = {
  'css-vars': 'CSS custom properties',
  vscode: 'a VS Code colour theme',
  base16: 'a base16 scheme',
  terminal: 'a terminal palette',
  dtcg: 'a design-token file',
};

/**
 * What a foreign theme turned into, shown before anything is saved.
 *
 * Reading roles out of somebody else's names is guesswork, and guesswork the user cannot
 * see is guesswork they cannot correct. A share code skips this — it is already a Webin
 * theme and there is nothing to disclose.
 */
function previewSheet(s) {
  const themes = s.preview?.themes ?? [];
  const inferred = s.preview?.inferred ?? [];
  const many = themes.length > 1;
  return `
<div class="wb-sheet">
  <label class="wb-label">Read from ${escapeHtml(SOURCE_LABEL[s.preview?.source] ?? 'a theme file')}</label>
  <div class="wb-grid">
    ${themes.map((theme) => `<div class="wb-cell"><div class="wb-card is-static">
      ${preview(theme)}
      <span class="wb-card-name"><span>${escapeHtml(theme.name)}</span></span>
    </div></div>`).join('')}
  </div>
  ${inferred.length ? `<details class="wb-details">
    <summary>${inferred.length} value${inferred.length === 1 ? '' : 's'} worked out from names</summary>
    <ul class="wb-notes">${inferred.slice(0, 24).map((note) => `<li>${escapeHtml(note)}</li>`).join('')}</ul>
  </details>` : ''}
  ${many ? '' : `<div class="wb-label-row">
    <label class="wb-label" for="wb-preview-name">Call it</label>
  </div>
  <textarea id="wb-preview-name" class="wb-input wb-input--name" rows="1"
    maxlength="${NAME_LIMIT}" spellcheck="false" autocomplete="off"
    >${escapeHtml(themes[0]?.name ?? '')}</textarea>`}
  <div class="wb-row">
    <button type="button" class="wb-btn wb-btn--primary" data-action="confirm-import">
      Keep ${many ? `${themes.length} themes` : 'this theme'}</button>
    <span style="flex:1"></span>
    <button type="button" class="wb-btn wb-btn--quiet" data-action="cancel">Discard</button>
  </div>
  <p class="wb-hint">Nothing has been saved yet.</p>
</div>`;
}

/**
 * Naming a theme.
 *
 * A sheet rather than a field inside the card: the panel repaints by replacing its own
 * markup wholesale, so an input living in the gallery grid would lose focus and caret the
 * moment anything else set state. A sheet is also where every other one-thing-at-a-time
 * job in this panel already happens.
 */
function renameSheet(s) {
  const value = s.rename?.name ?? '';
  const error = s.rename?.error ?? '';
  return `
<div class="wb-sheet">
  <div class="wb-label-row">
    <label class="wb-label" for="wb-rename">Theme name</label>
    <span class="wb-count">${value.length}/${NAME_LIMIT}</span>
  </div>
  <textarea id="wb-rename" class="wb-input wb-input--name" rows="1" maxlength="${NAME_LIMIT}"
    spellcheck="false" autocomplete="off" data-autofocus
    ${error ? 'aria-describedby="wb-rename-error" aria-invalid="true"' : ''}
    >${escapeHtml(value)}</textarea>
  ${error ? `<p class="wb-error" id="wb-rename-error" role="alert">${escapeHtml(error)}</p>` : ''}
  <div class="wb-row">
    <button type="button" class="wb-btn wb-btn--primary" data-action="save-name">Save name</button>
    <span style="flex:1"></span>
    <button type="button" class="wb-btn wb-btn--quiet" data-action="cancel">Cancel</button>
  </div>
  <p class="wb-hint">Enter saves, Escape goes back.</p>
</div>`;
}

function shareSheet(s) {
  return `
<div class="wb-sheet">
  <label class="wb-label">Share code for ${escapeHtml(s.share?.name ?? 'this theme')}</label>
  <code class="wb-code">${escapeHtml(s.share?.code ?? '')}</code>
  <div class="wb-row">
    <button type="button" class="wb-btn wb-btn--primary" data-action="copy-share">Copy code</button>
    <button type="button" class="wb-btn" data-action="export">Download file</button>
    <span style="flex:1"></span>
    <button type="button" class="wb-btn wb-btn--quiet" data-action="cancel">Done</button>
  </div>
  <p class="wb-hint">Send this to anyone with Webin. They paste it into Import and get your
    exact theme.</p>
</div>`;
}

/**
 * How many changes of the user's own this site is carrying.
 *
 * Saved and unsaved are one number here on purpose. The footer answers "what have I done
 * to this site", and an edit you made a minute ago and have not pressed Save on is
 * something you did — reporting the site as untouched until it reaches storage is the
 * panel disagreeing with the page in front of you.
 */
function editCount(s) {
  return (s.editCount ?? 0) + (s.editor?.pending ?? 0);
}

function footer(s) {
  if (s.view === 'edit') return renderEditorBar(s.editor ?? {}, s);
  if (s.view !== 'gallery') {
    return `<div class="wb-foot">
      <button type="button" class="wb-btn wb-btn--quiet" data-action="cancel">${icon('back', 13)}Back</button>
      <span class="wb-foot-label"></span></div>`;
  }
  const active = s.themes.find((t) => t.id === s.activeId) ?? null;
  const edits = editCount(s);
  const made = `${edits} edit${edits === 1 ? '' : 's'}`;
  return `
<div class="wb-foot">
  <span class="wb-foot-label">${active
    ? `<b>${escapeHtml(active.name)}</b> applied here${edits ? ` · ${made}` : ''}`
    : `${s.themes.length} themes · ${edits ? `${made} here` : 'this site is untouched'}`}</span>
  ${active ? `<button type="button" class="wb-btn" data-action="share"
    title="Copy a share code">${icon('share', 12)}Share</button>` : ''}
  ${active ? `<button type="button" class="wb-btn" data-action="clear">Remove</button>` : ''}
</div>`;
}

/**
 * Tab inside a textarea: two spaces in at the caret, or in front of every selected line;
 * Shift+Tab takes up to two spaces back off each of those lines.
 */
function indentSelection(area, outdent) {
  const { value, selectionStart: start, selectionEnd: end } = area;
  const unit = '  ';
  if (!outdent && start === end) {
    area.setRangeText(unit, start, end, 'end');
    return;
  }
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = end > start && value[end - 1] === '\n' ? end - 1 : end;
  const block = value.slice(lineStart, lineEnd);
  const lines = block.split('\n');
  const changed = lines.map((line) => (outdent
    ? line.replace(/^ {1,2}/, '')
    : `${unit}${line}`)).join('\n');
  area.setRangeText(changed, lineStart, lineEnd, 'select');
  area.setSelectionRange(lineStart, lineStart + changed.length);
}

function toast(t) {
  return `<div class="wb-toast${t.tone === 'error' ? ' wb-toast--error' : ''}" role="status" aria-live="polite">
    ${icon(t.tone === 'error' ? 'warning' : 'info', 13)}<span>${escapeHtml(t.message)}</span></div>`;
}

/**
 * Redraws a container to match new HTML, keeping every node that is still wanted.
 *
 * `innerHTML =` is the obvious way to repaint, and it is what the panel used to do. It is
 * also why editing jittered. The panel repaints after every change, and a repaint threw
 * away the very control the change had come from: the caret went with it, a hover or a
 * transition restarted from nothing, and an open colour picker was left holding an input
 * that was no longer in the document — so the first drag of a colour applied and every
 * drag after it went nowhere at all.
 *
 * So the new markup is built as before and then *matched* against what is on screen: a
 * node of the same kind in the same place is updated in place, anything else is replaced,
 * and the tail is trimmed. The panel still has exactly one description of what it should
 * look like — this only changes how that description reaches the DOM.
 */
function reconcile(container, html) {
  const scratch = container.ownerDocument.createElement('div');
  scratch.innerHTML = html;
  matchChildren(container, scratch);
}

function matchChildren(current, next) {
  const have = [...current.childNodes];
  const want = [...next.childNodes];
  for (let i = 0; i < want.length; i += 1) {
    const before = have[i];
    if (!before) current.appendChild(want[i]);
    else if (alike(before, want[i])) matchNode(before, want[i]);
    else current.replaceChild(want[i], before);
  }
  for (let i = want.length; i < have.length; i += 1) have[i].remove();
}

/**
 * Whether an existing node can become the wanted one.
 *
 * Same kind, same tag, and the same job: a row is identified by what it edits, so a
 * control is never quietly rewritten into a control for something else — the values would
 * arrive at the right element and mean the wrong property.
 *
 * The base class counts as part of that job. Every template here writes its own class
 * first and any state class after it, so `wb-card is-on` is still a card — but the menu
 * appearing above the body is not the body, and matching by position alone would have
 * patched one into the other and shifted everything below.
 */
const IDENTITY = ['data-control', 'data-prop', 'data-side', 'data-action', 'data-section', 'type'];

const baseClass = (node) => (node.getAttribute('class') ?? '').trim().split(/\s+/)[0] ?? '';

function alike(a, b) {
  if (a.nodeType !== b.nodeType) return false;
  if (a.nodeType !== 1) return true;
  if (a.tagName !== b.tagName) return false;
  if (baseClass(a) !== baseClass(b)) return false;
  return IDENTITY.every((name) => a.getAttribute(name) === b.getAttribute(name));
}

function matchNode(current, next) {
  if (current.nodeType !== 1) {
    if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
    return;
  }

  for (const { name } of [...current.attributes]) {
    if (!next.hasAttribute(name)) current.removeAttribute(name);
  }
  for (const { name, value } of next.attributes) {
    if (current.getAttribute(name) !== value) current.setAttribute(name, value);
  }

  // A field the user is in is the one thing on screen the panel does not get to describe:
  // what they have typed, or the colour they are still dragging towards, is the truth
  // until they are done with it.
  const editing = current.getRootNode?.()?.activeElement === current;

  if (current.tagName === 'TEXTAREA') {
    const text = next.textContent;
    if (!editing && current.value !== text) current.value = text;
    return;
  }

  matchChildren(current, next);

  if (editing) return;
  if (current.tagName === 'INPUT') {
    if (current.type === 'checkbox' || current.type === 'radio') {
      const on = next.hasAttribute('checked');
      if (current.checked !== on) current.checked = on;
      return;
    }
    const value = next.getAttribute('value') ?? '';
    // A colour input normalises whatever it is given to `#rrggbb`, so comparing the raw
    // strings would rewrite it on every repaint. Writing to one looks like nothing and is
    // a real event to the native picker attached to it, which may be open and mid-drag.
    if (current.type === 'color') {
      if (current.value.toLowerCase() !== value.toLowerCase()) current.value = value;
      return;
    }
    // Setting `value` on an input the user is not in is what puts an undone change back on
    // screen; setting it needlessly would drop the selection inside it.
    if (current.value !== value) current.value = value;
  } else if (current.tagName === 'SELECT') {
    const chosen = [...current.options].find((option) => option.hasAttribute('selected'));
    if (chosen && current.value !== chosen.value) current.value = chosen.value;
  }
}
