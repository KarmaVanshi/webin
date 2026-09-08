/**
 * The editor shell: shadow host, layout, and event delegation (§55, §79, §99).
 *
 * Everything the extension draws lives inside one closed-off shadow root attached to a
 * host on `documentElement`. That gives three guarantees the concept requires: the page
 * cannot style the editor, the editor adds nothing to the page's layout, and the editor's
 * own nodes are never selectable as page content.
 *
 * The shell owns no product logic. It renders what it is given and emits intents.
 */

import { Emitter, escapeHtml } from '../shared/util.js';
import { OWNED_ATTR, Mode, Panel } from '../shared/types.js';
import { tokens, base, APPEARANCE_ATTR } from './theme.js';
import { chromeCss } from './chrome-css.js';
import { overlayCss } from '../content/overlay/overlay.js';
import { renderToolbar } from './toolbar.js';
import { renderInspector } from './inspector.js';
import { renderHistory } from './history-panel.js';
import { renderResponsive } from './responsive.js';
import { renderDesignSystem, designSystemCss } from './design-system.js';
import { LayersPanel } from './layers.js';
import { Notices } from './notices.js';
import { icon } from './icons.js';

export class App extends Emitter {
  #doc;
  #view;
  #host = null;
  #shadow = null;
  #layers = null;
  #notices = null;
  #state = {
    mode: Mode.INSPECT,
    activePanel: Panel.INSPECTOR,
    appearance: 'light',
    layersVisible: true,
    inspectorVisible: true,
    layersWidth: 240,
    inspectorWidth: 288,
    canUndo: false,
    canRedo: false,
    dirty: false,
    breakpoint: 'all',
    viewport: 'fit',
    openSections: new Set(['layout', 'spacing', 'typography', 'appearance', 'flex', 'grid']),
  };

  constructor({ doc = document, view = window } = {}) {
    super();
    this.#doc = doc;
    this.#view = view;
  }

  get shadow() { return this.#shadow; }
  get host() { return this.#host; }
  get notices() { return this.#notices; }
  get marksLayer() { return this.#shadow?.querySelector('.widt-marks-host'); }
  get state() { return this.#state; }

  /** Builds the shadow root and its static skeleton. */
  mount() {
    if (this.#host?.isConnected) return this.#shadow;

    const host = this.#doc.createElement('div');
    host.setAttribute(OWNED_ATTR, '');
    host.setAttribute('data-widt-id-host', '');
    // One maximal z-index at the boundary; a disciplined scale inside (see MASTER.md §5).
    host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483647;' +
      ' pointer-events: none; isolation: isolate;';
    this.#doc.documentElement.appendChild(host);

    const shadow = host.attachShadow({ mode: 'open' });
    const style = this.#doc.createElement('style');
    style.textContent = tokens + base + chromeCss + designSystemCss + overlayCss;
    shadow.append(style);

    const root = this.#doc.createElement('div');
    root.className = 'widt-root';
    root.innerHTML = SKELETON;
    shadow.append(root);

    this.#host = host;
    this.#shadow = shadow;
    this.#applyAppearance();
    this.#layers = new LayersPanel({ view: this.#view, root: shadow.querySelector('.widt-layers-body') });
    this.#notices = new Notices(shadow.querySelector('.widt-notices'));
    this.#notices.on('action', (payload) => this.emit('action', payload));

    root.addEventListener('click', this.#onClick, true);
    root.addEventListener('change', this.#onChange);
    root.addEventListener('input', this.#onInput);
    root.addEventListener('keydown', this.#onKeyDown);
    root.addEventListener('pointerdown', this.#onPointerDown, true);

    // Paint the toolbar, docks and status bar for the initial state.
    this.update();
    return shadow;
  }

  unmount() {
    this.#host?.remove();
    this.#host = null;
    this.#shadow = null;
  }

  get layers() { return this.#layers; }

  /** Merges state and re-renders the affected regions. */
  update(patch = {}) {
    Object.assign(this.#state, patch);
    if (!this.#shadow) return;
    if ('appearance' in patch) this.#applyAppearance();
    this.#renderToolbar();
    this.#applyLayout();
    this.#renderStatus();
  }

  /** Redraws the Inspector with a fresh element record. */
  renderInspector(detail, extra = {}) {
    if (!this.#shadow) return;
    const body = this.#shadow.querySelector('.widt-inspector-body');
    body.innerHTML = renderInspector(detail, { ...this.#state, ...extra });
  }

  renderLayers(payload) {
    this.#layers?.render(payload);
  }

  renderHistory(payload) {
    const body = this.#shadow?.querySelector('.widt-history-body');
    if (body) body.innerHTML = renderHistory(payload);
  }

  renderDesignSystem(payload) {
    const body = this.#shadow?.querySelector('.widt-design-body');
    if (body) body.innerHTML = renderDesignSystem(payload);
  }

  renderResponsive() {
    const body = this.#shadow?.querySelector('.widt-responsive-body');
    if (!body) return;
    body.innerHTML = renderResponsive({
      viewport: this.#state.viewport,
      breakpoint: this.#state.breakpoint,
      actualWidth: this.#view.innerWidth,
      actualHeight: this.#view.innerHeight,
    });
  }

  /** Switches the right dock between Inspector, History and Responsive. */
  showPanel(panel) {
    this.#state.activePanel = panel;
    for (const node of this.#shadow.querySelectorAll('[data-panel]')) {
      node.hidden = node.dataset.panel !== panel;
    }
    const title = this.#shadow.querySelector('.widt-inspector-title');
    if (title) {
      title.textContent = { inspector: 'Inspector', history: 'History', responsive: 'Responsive', themes: 'Themes' }[panel] ?? 'Inspector';
    }
    this.#renderToolbar();
  }

  /**
   * Stamps the appearance on the shadow host, which is what the dark token block keys
   * off. `color-scheme` goes on the inline style because `all: initial` there would
   * otherwise beat any rule in the sheet; it makes native controls and scrollbars inside
   * the editor follow the chrome rather than the page.
   */
  #applyAppearance() {
    const appearance = this.#state.appearance === 'dark' ? 'dark' : 'light';
    this.#host.setAttribute(APPEARANCE_ATTR, appearance);
    this.#host.style.colorScheme = appearance;
  }

  #renderToolbar() {
    const slot = this.#shadow.querySelector('.widt-toolbar-slot');
    if (slot) slot.innerHTML = renderToolbar(this.#state);
  }

  #renderStatus() {
    const slot = this.#shadow.querySelector('.widt-status-info');
    if (!slot) return;
    const { selectionLabel, changeCount, profileName, scope } = this.#state;
    slot.innerHTML = `
<span class="widt-status-item">${icon('cursor', 11)}<span>${escapeHtml(selectionLabel ?? 'No selection')}</span></span>
<span class="widt-status-item">${icon('layers', 11)}<span>${changeCount ?? 0} change${changeCount === 1 ? '' : 's'}</span></span>
<span class="widt-status-item">${icon('profile', 11)}<span>${escapeHtml(profileName ?? 'Default')}</span></span>
<span class="widt-status-spacer"></span>
<span class="widt-status-item widt-status-path widt-mono">${escapeHtml(scope ?? '')}</span>`;
  }

  #applyLayout() {
    const left = this.#shadow.querySelector('.widt-dock--left');
    const right = this.#shadow.querySelector('.widt-dock--right');
    left.hidden = !this.#state.layersVisible;
    right.hidden = !this.#state.inspectorVisible;
    left.style.width = `${this.#state.layersWidth}px`;
    right.style.width = `${this.#state.inspectorWidth}px`;
  }

  #onClick = (event) => {
    if (this.#notices?.handleClick(event.target)) return;
    const trigger = event.target.closest?.('[data-action]');
    if (!trigger) return;
    event.preventDefault();
    event.stopPropagation();
    this.emit('action', { action: trigger.dataset.action, value: trigger.dataset.value, trigger, event });
  };

  #onChange = (event) => {
    const control = event.target.closest?.('[data-control]');
    if (!control) return;
    this.emit('control', controlPayload(control, event, 'change'));
  };

  #onInput = (event) => {
    const control = event.target.closest?.('[data-control]');
    if (!control) return;
    // Sliders and colour swatches preview live; text and number fields wait for commit.
    const live = control.dataset.control === 'range' || control.dataset.control === 'color';
    if (!live) return;
    this.emit('control', controlPayload(control, event, 'input'));
  };

  #onKeyDown = (event) => {
    // Enter commits a field without waiting for blur.
    if (event.key === 'Enter') {
      const control = event.target.closest?.('[data-control]');
      if (control) {
        event.preventDefault();
        this.emit('control', controlPayload(control, event, 'change'));
      }
    }
    // Keystrokes inside the editor's own fields must never reach the page.
    event.stopPropagation();
  };

  /** Starts a dock resize drag (§99). */
  #onPointerDown = (event) => {
    const resizer = event.target.closest?.('.widt-resizer');
    if (!resizer) return;
    event.preventDefault();
    const side = resizer.dataset.side;
    const startX = event.clientX;
    const startWidth = side === 'left' ? this.#state.layersWidth : this.#state.inspectorWidth;
    resizer.classList.add('is-active');

    const move = (e) => {
      const delta = side === 'left' ? e.clientX - startX : startX - e.clientX;
      const width = Math.max(180, Math.min(520, startWidth + delta));
      this.update(side === 'left' ? { layersWidth: width } : { inspectorWidth: width });
    };
    const up = () => {
      resizer.classList.remove('is-active');
      this.#doc.removeEventListener('pointermove', move, true);
      this.#doc.removeEventListener('pointerup', up, true);
      this.emit('action', { action: 'persist-workspace' });
    };
    this.#doc.addEventListener('pointermove', move, true);
    this.#doc.addEventListener('pointerup', up, true);
  };
}

function controlPayload(control, event, phase) {
  return {
    phase,
    control: control.dataset.control,
    prop: control.dataset.prop,
    side: control.dataset.side ?? null,
    value: control.dataset.value ?? control.value,
    checked: control.checked,
    element: control,
    event,
  };
}

const SKELETON = `
<div class="widt-toolbar-slot"></div>

<aside class="widt-dock widt-dock--left" data-interactive aria-label="Layers">
  <div class="widt-panel-head">
    <span class="widt-panel-title">Layers</span>
    <button type="button" class="widt-icon-btn" data-interactive data-action="collapse-layers"
      title="Collapse all" aria-label="Collapse all layers">${icon('layers', 13)}</button>
  </div>
  <div class="widt-panel-body widt-layers-body"></div>
  <div class="widt-resizer" data-side="left" role="separator" aria-orientation="vertical"></div>
</aside>

<aside class="widt-dock widt-dock--right" data-interactive aria-label="Inspector">
  <div class="widt-panel-head">
    <span class="widt-panel-title widt-inspector-title">Inspector</span>
    <button type="button" class="widt-icon-btn" data-interactive data-action="toggle-measure"
      title="Show measurements" aria-label="Show measurements" aria-pressed="false">${icon('spacing', 13)}</button>
  </div>
  <div class="widt-panel-body widt-inspector-body" data-panel="inspector"></div>
  <div class="widt-panel-body widt-history-body" data-panel="history" hidden></div>
  <div class="widt-panel-body widt-responsive-body" data-panel="responsive" hidden></div>
  <div class="widt-panel-body widt-design-body" data-panel="themes" hidden></div>
  <div class="widt-resizer" data-side="right" role="separator" aria-orientation="vertical"></div>
</aside>

<div class="widt-status" data-interactive><div class="widt-status-info" style="display:contents"></div></div>
<div class="widt-notices"></div>
<div class="widt-marks-host"></div>`;
