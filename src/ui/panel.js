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

export class Panel extends Emitter {
  #doc;
  #host = null;
  #shadow = null;
  #root = null;
  #toastTimer = null;
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
    /** Live editor state, handed over by the runtime whenever it changes. */
    editor: null,
    /** How many hand edits this site has saved, for the reset items. */
    editCount: 0,
    /** Which inspector sections are open, and which box fields are linked. Panel state:
     *  it is about looking at the page, not about changing it. */
    sections: { layout: false, spacing: true, type: true, appearance: true, flex: false },
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

  /** Merges state and repaints. The panel is small enough that partial updates would be
   *  more machinery than they save. */
  setState(patch = {}) {
    Object.assign(this.#state, patch);
    if (!this.#root) return;
    if ('appearance' in patch) this.#applyAppearance();
    this.render();
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
    this.#root.innerHTML = `
<div class="wb-panel" data-side="${s.side === 'left' ? 'left' : 'right'}"
  data-view="${s.view}" role="dialog" aria-label="Webin" tabindex="-1">
  ${header(s)}
  ${s.menuOpen ? menu(s) : ''}
  <div class="wb-body">${s.view === 'import' ? importSheet()
    : s.view === 'preview' ? previewSheet(s)
    : s.view === 'share' ? shareSheet(s)
    : s.view === 'edit' ? renderInspector(s.editor?.selection ?? null, s)
    : gallery(s)}</div>
  ${footer(s)}
  ${s.toast ? toast(s.toast) : ''}
</div>`;
  }

  /** Opens the file picker; the change handler emits the file's text. */
  pickFile() {
    this.#shadow?.querySelector('input[type="file"]')?.click();
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
    this.emit('action', { action: trigger.dataset.action, value: trigger.dataset.value ?? null });
  };

  #onInput = (event) => {
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
    if (event.key !== 'Escape') return;
    event.preventDefault();
    if (this.#state.menuOpen) this.setState({ menuOpen: false });
    else if (this.#state.view !== 'gallery') this.setState({ view: 'gallery', share: null, preview: null });
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
  ${theme.custom ? `<button type="button" class="wb-card-del" data-action="delete"
    data-value="${escapeHtml(theme.id)}" title="Delete ${escapeHtml(theme.name)}"
    aria-label="Delete ${escapeHtml(theme.name)}">${icon('trash', 12)}</button>` : ''}
</div>`;
}

/**
 * A theme rendered in miniature — palette, corner radius and surface treatment together,
 * because those three are what actually distinguishes one movement from another.
 */
function preview(theme) {
  const p = theme.palette;
  const radius = Math.min(theme.radius ?? 4, 10);
  const backdrop = theme.effects.backdrop ?? p.background;
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
      autocomplete="off" placeholder="https://example.com/theme.css">
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
  <div class="wb-row">
    <button type="button" class="wb-btn wb-btn--primary" data-action="confirm-import">
      Keep ${many ? `${themes.length} themes` : 'this theme'}</button>
    <span style="flex:1"></span>
    <button type="button" class="wb-btn wb-btn--quiet" data-action="cancel">Discard</button>
  </div>
  <p class="wb-hint">Nothing has been saved yet.</p>
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

function footer(s) {
  if (s.view === 'edit') return renderEditorBar(s.editor ?? {});
  if (s.view !== 'gallery') {
    return `<div class="wb-foot">
      <button type="button" class="wb-btn wb-btn--quiet" data-action="cancel">${icon('back', 13)}Back</button>
      <span class="wb-foot-label"></span></div>`;
  }
  const active = s.themes.find((t) => t.id === s.activeId) ?? null;
  return `
<div class="wb-foot">
  <span class="wb-foot-label">${active
    ? `<b>${escapeHtml(active.name)}</b> applied here`
    : `${s.themes.length} themes · this site is untouched`}</span>
  ${active ? `<button type="button" class="wb-btn" data-action="share"
    title="Copy a share code">${icon('share', 12)}Share</button>` : ''}
  ${active ? `<button type="button" class="wb-btn" data-action="clear">Remove</button>` : ''}
</div>`;
}

function toast(t) {
  return `<div class="wb-toast${t.tone === 'error' ? ' wb-toast--error' : ''}" role="status" aria-live="polite">
    ${icon(t.tone === 'error' ? 'warning' : 'info', 13)}<span>${escapeHtml(t.message)}</span></div>`;
}
