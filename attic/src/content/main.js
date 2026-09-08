/**
 * Composition root (§79, §132).
 *
 * The six systems are built independently and only meet here, through the shared element
 * model and the shared operation model. This file owns the flows that cross them:
 * selection, the edit pipeline (§82), persistence, reapplication (§40) and shortcuts.
 */

import { Mode, Panel, OpKind, Breakpoint, Msg, MatchStatus } from '../shared/types.js';
import { debounce, uid, truncate, clone } from '../shared/util.js';
import { validateDeclaration, formatDimension, formatShadow, parseShadow } from '../shared/css-values.js';
import { parseColor, toCss, contrastRatio } from '../shared/color.js';

import { createBackend } from '../storage/bridge.js';
import { SiteStore, scopeFromUrl } from '../storage/site-store.js';
import { ProfileStore } from '../storage/profile-store.js';
import { WorkspaceStore } from '../storage/workspace-store.js';

import { ElementModel, isSelectable, labelFor } from './element-model/model.js';
import { buildIdentity, resolveIdentity } from './element-model/identity.js';
import { findSimilar } from './element-model/tree.js';
import { OverrideEngine } from './override-engine/override-engine.js';
import { explainProperty } from './inspector-engine/cascade.js';
import { Picker } from './selector/picker.js';
import { Overlay } from './overlay/overlay.js';
import { Interactions } from './visual-editor/interactions.js';
import { TextEditor } from './visual-editor/text-edit.js';
import { HistoryEngine } from './history/history-engine.js';
import { MutationMonitor } from './mutation-monitor/monitor.js';
import { detectTokens } from './design-system/tokens.js';
import { ThemeEngine, PRESETS, presetById, themeFromTokens } from './design-system/themes.js';
import { App } from '../ui/app.js';

/** Style categories a copy/paste carries (§45). */
const STYLE_CATEGORIES = {
  typography: ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-align', 'text-transform', 'color'],
  colors: ['color', 'background-color'],
  border: ['border-width', 'border-style', 'border-color'],
  radius: ['border-radius'],
  shadow: ['box-shadow'],
  spacing: ['padding', 'margin', 'gap'],
  layout: ['display', 'width', 'height'],
};

export class Editor {
  #doc;
  #view;
  #mode = Mode.OFF;

  #model;
  #engine;
  #history;
  #monitor;
  #picker;
  #overlay;
  #interactions;
  #textEditor;
  #themes;
  #app;

  #sites;
  #profiles;
  #workspace;

  #scope;
  #selection = [];
  #clipboard = null;
  #dirty = false;
  #measure = false;
  #breakpoint = Breakpoint.ALL;
  #unmatched = [];
  #started = false;
  /** Changes edited but not yet written to storage — Save is explicit (§119, §120). */
  #pending = [];
  /** Cached design tokens for this page; invalidated when the DOM changes materially. */
  #tokens = null;
  #scanning = false;

  /**
   * @param {{doc?:Document, view?:Window, backend?:object}} options
   *   `backend` exists so tests can hand the same store to two Editor instances and
   *   prove a change survives a reload; in the browser it is always chrome.storage.
   */
  constructor({ doc = document, view = window, backend = null } = {}) {
    this.#doc = doc;
    this.#view = view;
    this.#scope = scopeFromUrl(view.location.href);

    const store = backend ?? createBackend();
    this.#sites = new SiteStore(store);
    this.#profiles = new ProfileStore(this.#sites);
    this.#workspace = new WorkspaceStore(store);

    this.#model = new ElementModel({ doc, view });
    this.#engine = new OverrideEngine({ doc, view });
    this.#history = new HistoryEngine();
    this.#monitor = new MutationMonitor({ doc, view });
    this.#interactions = new Interactions({ doc, view });
    this.#textEditor = new TextEditor({ view });
    this.#themes = new ThemeEngine({ doc, view });
  }

  get mode() { return this.#mode; }

  /**
   * Applies saved customisations without showing any UI (§40).
   * This is what runs on every page load; the editor chrome is only built when the user
   * actually opens it.
   */
  async boot() {
    this.#engine.mount();
    await this.#reapply({ silent: true });
    this.#monitor.on('structure', this.#onStructure);
    this.#monitor.on('route', this.#onRoute);
    this.#monitor.start();
  }

  /** Opens the editor UI (§6). */
  async open(mode = Mode.DESIGN) {
    if (!this.#started) await this.#startUi();
    this.#setMode(mode);
  }

  /** Closes the UI but leaves saved overrides applied. */
  close() {
    this.#setMode(Mode.OFF);
    this.#picker?.stop();
    this.#overlay?.hide();
    this.#app?.unmount();
    this.#started = false;
  }

  /** Full teardown: UI gone and every override reverted. */
  destroy() {
    this.close();
    this.#monitor.stop();
    this.#themes.clear();
    this.#engine.teardown();
  }

  async #startUi() {
    const saved = await this.#workspace.loadWorkspace();

    this.#app = new App({ doc: this.#doc, view: this.#view });
    this.#app.mount();
    this.#app.update({
      appearance: saved.appearance === 'dark' ? 'dark' : 'light',
      layersWidth: saved.layersWidth,
      inspectorWidth: saved.inspectorWidth,
      layersVisible: saved.layersVisible,
      inspectorVisible: saved.inspectorVisible,
      openSections: new Set(saved.expandedSections),
      breakpoint: saved.breakpoint,
      scope: `${this.#scope.host}${this.#scope.path}`,
    });
    this.#breakpoint = saved.breakpoint ?? Breakpoint.ALL;

    this.#overlay = new Overlay(this.#app.marksLayer, { view: this.#view });
    this.#picker = new Picker({ doc: this.#doc, view: this.#view, host: this.#app.host });

    this.#wire();
    this.#started = true;

    this.#refreshLayers();
    this.#refreshStatus();
    this.#app.renderInspector(null);
    this.#reportUnmatched();
  }

  #wire() {
    this.#picker.on('hover', (element) => this.#overlay.setHover(element));
    this.#picker.on('selection', (selection) => this.#onSelection(selection));
    this.#picker.on('activate', (element) => this.#beginTextEdit(element));

    this.#app.on('action', (payload) => this.#onAction(payload));
    this.#app.on('control', (payload) => this.#onControl(payload));

    this.#interactions.on('preview', ({ element, properties }) => this.#applyLive(element, properties));
    this.#interactions.on('commit', ({ element, properties, label }) => this.#commitGesture(element, properties, label));
    this.#interactions.on('cancel', () => this.#refreshInspector());
    this.#interactions.on('refused', ({ reason }) => this.#notify('warning', 'Cannot resize', reason));

    this.#textEditor.on('commit', ({ element, before, after }) => this.#commitText(element, before, after));
    this.#textEditor.on('refused', ({ reason }) => this.#notify('warning', 'Cannot edit text', reason));

    this.#history.on('change', (state) => {
      this.#app.update({ canUndo: state.canUndo, canRedo: state.canRedo });
      if (this.#app.state.activePanel === Panel.HISTORY) this.#refreshHistory();
    });

    this.#monitor.on('geometry', () => this.#overlay?.sync());
    this.#monitor.on('viewport', () => this.#app.renderResponsive());

    // The marks layer owns the resize grips, so gestures start here (§11).
    this.#app.shadow.addEventListener('pointerdown', this.#onMarkPointerDown, true);
    this.#doc.addEventListener('keydown', this.#onKey, true);
  }

  // ── Mode ────────────────────────────────────────────────────────────────

  #setMode(mode) {
    this.#mode = mode;
    if (mode === Mode.OFF) return;
    // Inspect leaves the page clickable; Design takes the pointer (§6.1, §6.2).
    this.#picker.start({ interactive: mode === Mode.DESIGN });
    this.#overlay.show();
    this.#overlay.setResizable(mode === Mode.DESIGN);
    this.#overlay.setSpacing(mode === Mode.DESIGN);
    this.#app.update({ mode });
  }

  // ── Selection ───────────────────────────────────────────────────────────

  #onSelection(selection) {
    this.#selection = selection;
    this.#overlay.setSelection(selection);
    for (const element of selection) this.#monitor.watch(element);
    if (selection[0]) {
      this.#app.layers.reveal(selection[0], this.#doc.body);
      this.#refreshLayers();
    }
    this.#refreshInspector();
    this.#refreshStatus();
  }

  get #primary() { return this.#selection[0] ?? null; }

  #refreshInspector() {
    if (!this.#started) return;
    const element = this.#primary;
    if (!element) {
      this.#app.renderInspector(null);
      return;
    }
    const detail = this.#model.detail(element, { fresh: true });
    detail.contrast = this.#contrastFor(element);

    this.#app.renderInspector(detail, {
      overrides: this.#engine.overridesFor(element),
      provenance: this.#provenanceFor(element, ['width', 'padding', 'color', 'background-color']),
      multi: this.#selection.length,
      shared: this.#selection.length > 1 ? this.#sharedValues() : {},
      breakpoint: this.#breakpoint,
    });
  }

  /** Provenance for the handful of properties the panel explains (§61). */
  #provenanceFor(element, properties) {
    const out = {};
    for (const property of properties) {
      try {
        out[property] = explainProperty(element, property, this.#view, {
          overrideValue: this.#engine.overrideValue(element, property, this.#breakpoint),
        });
      } catch {
        // A page whose stylesheets cannot be read still gets a usable inspector (§32).
      }
    }
    return out;
  }

  /** Text contrast against the nearest painted background (§106). */
  #contrastFor(element) {
    try {
      const style = this.#view.getComputedStyle(element);
      const fg = parseColor(style.color);
      if (!fg) return null;
      let node = element;
      while (node) {
        const bg = parseColor(this.#view.getComputedStyle(node).backgroundColor);
        if (bg && bg.a > 0.5) return contrastRatio(fg, bg);
        node = node.parentElement;
      }
      return null;
    } catch {
      return null;
    }
  }

  /** Values common to a multi-selection; differing ones are omitted so the UI shows "Mixed" (§47). */
  #sharedValues() {
    const properties = ['width', 'border-radius', 'font-size', 'color', 'background-color'];
    const shared = {};
    for (const property of properties) {
      const values = this.#selection.map((el) => this.#view.getComputedStyle(el).getPropertyValue(property).trim());
      if (values.length && values.every((v) => v === values[0])) shared[property] = values[0];
    }
    return shared;
  }

  // ── The edit pipeline (§82) ─────────────────────────────────────────────

  /** Preview only: applied to the page, not recorded, not persisted (§83). */
  #applyLive(element, properties) {
    this.#monitor.suspend(() => {
      this.#engine.apply(element, { kind: OpKind.STYLE, breakpoint: this.#breakpoint, properties });
    });
    this.#overlay.sync();
  }

  /**
   * A committed style edit: applied, recorded as one history entry, and persisted.
   * Every element in the selection receives it, so multi-select editing is one call (§46).
   */
  #commitStyle(properties, label) {
    const targets = this.#selection;
    if (!targets.length) return;

    this.#history.begin(label ?? `Changed ${Object.keys(properties).join(', ')}`);
    for (const element of targets) {
      const before = {};
      for (const property of Object.keys(properties)) {
        before[property] = this.#engine.overrideValue(element, property, this.#breakpoint)
          ?? this.#view.getComputedStyle(element).getPropertyValue(property).trim();
      }

      const result = this.#monitor.suspend(() =>
        this.#engine.apply(element, { kind: OpKind.STYLE, breakpoint: this.#breakpoint, properties }));

      for (const { property, reason } of result.rejected ?? []) {
        this.#notify('warning', `Cannot set ${property}`, reason);
      }
      for (const [property, value] of Object.entries(properties)) {
        if (result.rejected?.some((r) => r.property === property)) continue;
        this.#history.add({ changeId: this.#model.idOf(element), property, before: before[property], after: value });
      }
      this.#stage(element, { kind: OpKind.STYLE, properties });
    }
    this.#history.commit();
    this.#afterEdit();
  }

  #commitGesture(element, properties, label) {
    this.#selection = [element];
    this.#commitStyle(properties, label);
  }

  #commitText(element, before, after) {
    this.#history.begin(`Edited text on ${labelFor(element)}`);
    this.#history.add({ changeId: this.#model.idOf(element), property: 'text', before, after });
    this.#history.commit();
    this.#stage(element, { kind: OpKind.TEXT, text: after });
    this.#afterEdit();
  }

  /** Queues a change for persistence against the element's saved identity (§35, §119). */
  #stage(element, partial) {
    const change = {
      id: uid('chg'),
      kind: partial.kind,
      target: buildIdentity(element),
      breakpoint: this.#breakpoint,
      label: partial.label ?? labelFor(element),
      createdAt: Date.now(),
      ...partial,
    };
    this.#pending.push(change);
    this.#dirty = true;
    this.#autosaveHint();
  }

  #autosaveHint = debounce(() => {
    this.#app?.update({ dirty: this.#dirty });
  }, 120);

  /**
   * Post-edit refresh.
   *
   * Edits do not only arrive from the workspace — the popup and the keyboard command can
   * undo, apply a theme or reset with the UI closed, in which case there is no overlay or
   * panel to update. The model still has to be invalidated either way.
   */
  #afterEdit() {
    this.#model.invalidate(this.#primary);
    if (!this.#started) return;
    this.#overlay.sync();
    this.#refreshInspector();
    this.#refreshStatus();
    this.#app.update({ dirty: this.#dirty });
  }

  // ── Control input (§62) ─────────────────────────────────────────────────

  #onControl(payload) {
    const element = this.#primary;
    if (!element) return;
    const { control, prop, value, side, phase } = payload;

    // Attribute edits are addressed with a leading @ (§33 Level 2).
    if (prop?.startsWith('@')) {
      if (phase !== 'change') return;
      this.#commitAttribute(element, prop.slice(1), value);
      return;
    }

    switch (control) {
      case 'number': {
        const unit = payload.element.parentElement?.querySelector('[data-control="unit"]')?.value ?? 'px';
        const formatted = formatDimension(Number(value), unit);
        if (formatted) this.#commitStyle({ [prop]: formatted });
        break;
      }
      case 'unit': {
        const input = payload.element.parentElement?.querySelector('[data-control="number"]');
        const formatted = formatDimension(Number(input?.value ?? 0), value);
        if (formatted) this.#commitStyle({ [prop]: formatted });
        break;
      }
      case 'box':
        this.#commitBoxSide(prop, side, value);
        break;
      case 'color':
      case 'color-text': {
        const parsed = parseColor(value);
        if (!parsed) return;
        const css = toCss(parsed);
        if (phase === 'input') this.#applyLive(element, { [prop]: css });
        else this.#commitStyle({ [prop]: css });
        break;
      }
      case 'range':
        this.#commitRange(prop, Number(value), phase);
        break;
      case 'segment':
      case 'select':
      case 'text': {
        if (prop.startsWith('shadow-')) {
          this.#commitShadow(prop, value);
          return;
        }
        const check = validateDeclaration(prop, value);
        if (!check.ok) {
          this.#notify('warning', 'Value not applied', check.reason);
          return;
        }
        this.#commitStyle({ [prop]: check.value });
        break;
      }
      default:
        break;
    }
  }

  #commitBoxSide(prop, side, value) {
    if (prop === 'border-radius-corners') {
      const map = { top: 'border-top-left-radius', right: 'border-top-right-radius', bottom: 'border-bottom-right-radius', left: 'border-bottom-left-radius' };
      this.#commitStyle({ [map[side]]: formatDimension(Number(value), 'px') });
      return;
    }
    const linked = this.#app.state.linked?.[prop];
    if (linked) {
      this.#commitStyle({ [prop]: formatDimension(Number(value), 'px') });
      return;
    }
    this.#commitStyle({ [`${prop}-${side}`]: formatDimension(Number(value), 'px') });
  }

  #commitRange(prop, value, phase) {
    const element = this.#primary;
    if (prop === 'opacity') {
      const css = String(value / 100);
      if (phase === 'input') this.#applyLive(element, { opacity: css });
      else this.#commitStyle({ opacity: css });
      return;
    }
    if (prop.startsWith('shadow-')) this.#commitShadow(prop, value, phase);
  }

  /** Shadow parts are edited individually and reassembled into one declaration (§22). */
  #commitShadow(prop, value, phase = 'change') {
    const element = this.#primary;
    const current = parseShadow(this.#view.getComputedStyle(element).boxShadow) ?? { x: 0, y: 0, blur: 0, spread: 0, color: 'rgba(0,0,0,0.2)', inset: false };
    const key = prop.replace('shadow-', '');
    const next = { ...current };
    if (key === 'inset') next.inset = value === 'true';
    else if (key === 'color') next.color = toCss(parseColor(value) ?? { r: 0, g: 0, b: 0, a: 0.2 });
    else next[key] = Number(value);

    const css = formatShadow(next);
    if (phase === 'input') this.#applyLive(element, { 'box-shadow': css });
    else this.#commitStyle({ 'box-shadow': css }, 'Changed shadow');
  }

  #commitAttribute(element, name, value) {
    const before = element.getAttribute(name);
    const result = this.#monitor.suspend(() =>
      this.#engine.apply(element, { kind: OpKind.ATTRIBUTE, attributes: { [name]: value } }));
    if (!result.ok) {
      this.#notify('warning', `Cannot set ${name}`, result.rejected?.[0]?.reason ?? result.reason);
      return;
    }
    this.#history.begin(`Changed ${name}`);
    this.#history.add({ changeId: this.#model.idOf(element), property: name, before, after: value });
    this.#history.commit();
    this.#stage(element, { kind: OpKind.ATTRIBUTE, attributes: { [name]: value } });
    this.#afterEdit();
  }

  // ── Actions ─────────────────────────────────────────────────────────────

  async #onAction({ action, value, trigger }) {
    switch (action) {
      case 'set-mode': this.#setMode(value); break;
      case 'close': this.close(); break;
      case 'undo': this.#undo(); break;
      case 'redo': this.#redo(); break;
      case 'save': await this.#save(); break;

      case 'toggle-panel': this.#togglePanel(value); break;
      case 'toggle-appearance': await this.#toggleAppearance(); break;
      case 'toggle-section': this.#toggleSection(value); break;
      case 'toggle-measure': this.#toggleMeasure(trigger); break;
      case 'collapse-layers': this.#app.layers.collapseAll(); this.#refreshLayers(); break;

      case 'select-layer': this.#selectFromLayers(value); break;
      case 'toggle-layer': this.#app.layers.toggle(value); this.#refreshLayers(); break;
      case 'select-parent': this.#picker.selectParent(); break;
      case 'select-similar': this.#selectSimilar(); break;

      case 'hide-selected': this.#hideSelected(); break;
      case 'remove-selected': this.#removeSelected(); break;
      case 'reset-selected': this.#resetSelected(); break;
      case 'reset-page': await this.#resetPage(); break;
      case 'copy-style': this.#copyStyle(); break;
      case 'paste-style': this.#pasteStyle(); break;
      case 'add-shadow': this.#commitStyle({ 'box-shadow': '0 4px 12px rgba(0, 0, 0, 0.15)' }, 'Added shadow'); break;
      case 'view-css': this.#showCss(); break;

      case 'detect-tokens': await this.#detectTokens({ force: true }); break;
      case 'apply-theme': await this.#applyTheme(value); break;
      case 'clear-theme': await this.#clearTheme(); break;
      case 'save-theme': await this.#saveCurrentAsTheme(); break;

      case 'set-breakpoint': this.#setBreakpoint(value); break;
      case 'set-viewport': this.#setViewport(value); break;
      case 'revert-operation': this.#revertOperation(value); break;
      case 'remap-change': this.#beginRemap(value); break;
      case 'persist-workspace': await this.#persistWorkspace(); break;
      default: break;
    }
  }

  #togglePanel(panel) {
    if (panel === Panel.LAYERS) {
      this.#app.update({ layersVisible: !this.#app.state.layersVisible });
    } else if (panel === Panel.INSPECTOR && this.#app.state.activePanel === Panel.INSPECTOR) {
      this.#app.update({ inspectorVisible: !this.#app.state.inspectorVisible });
    } else {
      this.#app.update({ inspectorVisible: true });
      this.#app.showPanel(panel);
      if (panel === Panel.HISTORY) this.#refreshHistory();
      if (panel === Panel.RESPONSIVE) this.#app.renderResponsive();
      if (panel === Panel.THEMES) this.#refreshDesignSystem();
    }
    this.#persistWorkspace();
  }

  /**
   * Flips the editor chrome between light and dark (§59). This is the editor's own
   * appearance only — it touches nothing on the page and is not a change, so it never
   * marks the workspace dirty or enters history.
   */
  async #toggleAppearance() {
    const appearance = this.#app.state.appearance === 'dark' ? 'light' : 'dark';
    this.#app.update({ appearance });
    await this.#persistWorkspace();
  }

  #toggleSection(id) {
    const open = this.#app.state.openSections;
    if (open.has(id)) open.delete(id);
    else open.add(id);
    this.#refreshInspector();
    this.#persistWorkspace();
  }

  #toggleMeasure(trigger) {
    this.#measure = !this.#measure;
    this.#overlay.setMeasurements(this.#measure);
    trigger?.setAttribute('aria-pressed', String(this.#measure));
    trigger?.classList.toggle('is-on', this.#measure);
  }

  #selectFromLayers(key) {
    const element = this.#app.layers.elementFor(key);
    if (element && isSelectable(element, this.#view)) this.#picker.select(element);
  }

  /** Rule-based repeated-component selection (§48, §90). */
  #selectSimilar() {
    const element = this.#primary;
    if (!element) return;
    const similar = findSimilar(element, this.#view);
    if (!similar.length) {
      this.#notify('info', 'No similar elements', 'Nothing else in this container shares its structure.');
      return;
    }
    this.#picker.select(element);
    for (const node of similar) this.#picker.select(node, { additive: true });
    this.#notify('info', `${similar.length + 1} elements selected`, 'Edits now apply to all of them.');
  }

  #hideSelected() {
    if (!this.#selection.length) return;
    this.#history.begin(`Hid ${labelFor(this.#primary)}`);
    for (const element of this.#selection) {
      this.#monitor.suspend(() => this.#engine.apply(element, { kind: OpKind.HIDE }));
      this.#history.add({ changeId: this.#model.idOf(element), property: 'display', before: 'visible', after: 'none' });
      this.#stage(element, { kind: OpKind.HIDE });
    }
    this.#history.commit();
    this.#afterEdit();
  }

  #removeSelected() {
    if (!this.#selection.length) return;
    const targets = [...this.#selection];
    this.#history.begin(`Removed ${labelFor(targets[0])}`);
    for (const element of targets) {
      this.#monitor.suspend(() => this.#engine.apply(element, { kind: OpKind.REMOVE }));
      this.#history.add({ changeId: this.#model.idOf(element), property: 'element', before: 'present', after: null });
      this.#stage(element, { kind: OpKind.REMOVE });
    }
    this.#history.commit();
    this.#picker.clear();
    this.#notify('success', 'Element removed', 'It is removed locally only — the site is unchanged. Undo restores it.');
    this.#afterEdit();
  }

  #resetSelected() {
    if (!this.#selection.length) return;
    for (const element of this.#selection) this.#monitor.suspend(() => this.#engine.revert(element));
    this.#dirty = true;
    this.#refreshLayers();
    this.#afterEdit();
  }

  async #resetPage() {
    const { cleared, remaining } = await this.#sites.resetPath(this.#scope.host, this.#scope.path);
    this.#monitor.suspend(() => { this.#engine.revertAll(); this.#themes.clear(); });
    this.#history.reset();
    this.#pending = [];
    this.#dirty = false;
    await this.#reapply({ silent: true });
    this.#refreshLayers();
    this.#afterEdit();
    this.#notify('success', `Reset this page`,
      remaining
        ? `${cleared} change${cleared === 1 ? '' : 's'} cleared. ${remaining} still come from site-wide rules.`
        : `${cleared} change${cleared === 1 ? '' : 's'} cleared.`);
  }

  /** Copy/paste style (§45). */
  #copyStyle() {
    const element = this.#primary;
    if (!element) return;
    const style = this.#view.getComputedStyle(element);
    const captured = {};
    for (const properties of Object.values(STYLE_CATEGORIES)) {
      for (const property of properties) {
        const value = style.getPropertyValue(property).trim();
        if (value) captured[property] = value;
      }
    }
    this.#clipboard = captured;
    this.#notify('success', 'Style copied', `${Object.keys(captured).length} properties from ${labelFor(element)}.`);
  }

  #pasteStyle() {
    if (!this.#clipboard) {
      this.#notify('info', 'Nothing to paste', 'Copy a style from another element first.');
      return;
    }
    this.#commitStyle(clone(this.#clipboard), 'Pasted style');
  }

  #showCss() {
    const css = this.#engine.stylesheet.toCss();
    this.#notify('info', 'Your override CSS', css || 'No overrides on this page yet.', { timeout: 12000 });
  }

  #setBreakpoint(value) {
    this.#breakpoint = value;
    this.#app.update({ breakpoint: value });
    this.#app.renderResponsive();
    this.#persistWorkspace();
  }

  /**
   * Viewport preview (§6.3).
   * Implemented by constraining the document rather than by resizing the window, which an
   * extension cannot do for the user's actual browser.
   */
  #setViewport(id) {
    const preset = { fit: null, desktop: [1440, 900], laptop: [1280, 800], tablet: [768, 1024], mobile: [390, 844] }[id];
    const root = this.#doc.documentElement;
    if (!preset) {
      root.style.removeProperty('max-width');
      root.style.removeProperty('margin');
      root.style.removeProperty('border');
    } else {
      root.style.setProperty('max-width', `${preset[0]}px`, 'important');
      root.style.setProperty('margin', '0 auto', 'important');
      root.style.setProperty('border', '1px solid rgba(99,102,241,0.4)', 'important');
    }
    this.#app.update({ viewport: id });
    this.#app.renderResponsive();
    this.#overlay.sync();
  }

  // ── Themes and design tokens (§49, §87) ─────────────────────────────────

  /**
   * Scans the page for its real design tokens.
   * Cached, because the scan touches thousands of nodes and the answer only changes when
   * the page materially does (§71).
   */
  async #detectTokens({ force = false } = {}) {
    if (this.#tokens && !force) return this.#tokens;
    this.#scanning = true;
    this.#refreshDesignSystem();
    // Yield a frame so the "reading this page" state actually paints before the scan.
    await new Promise((resolve) => (this.#view.requestAnimationFrame ?? setTimeout)(resolve));
    try {
      this.#tokens = detectTokens(this.#doc.body ?? this.#doc.documentElement, this.#view);
    } catch (error) {
      this.#notify('warning', 'Could not read this page', error?.message ?? 'The scan failed.');
      this.#tokens = null;
    } finally {
      this.#scanning = false;
      this.#refreshDesignSystem();
    }
    return this.#tokens;
  }

  /** Applies a theme by id, from the presets or the user's saved ones. */
  async #applyTheme(themeId) {
    const theme = await this.#findTheme(themeId);
    if (!theme) {
      this.#notify('warning', 'Theme not found', 'It may have been deleted.');
      return;
    }
    const tokens = await this.#detectTokens();
    if (!tokens) return;

    const before = this.#themes.active;
    const result = this.#monitor.suspend(() => this.#themes.apply(theme, tokens));

    this.#history.begin(`Applied theme “${theme.name}”`);
    this.#history.add({ changeId: 'theme', property: 'theme', before: before?.id ?? null, after: theme.id });
    this.#history.commit();

    // A theme is a change like any other: staged, saved explicitly, reapplied on load.
    this.#pending = this.#pending.filter((c) => c.kind !== OpKind.THEME);
    this.#pending.push({
      id: uid('chg'), kind: OpKind.THEME, breakpoint: Breakpoint.ALL,
      target: { tag: 'html', domPath: 'html' },
      themeId: theme.id, theme, label: `Theme: ${theme.name}`, createdAt: Date.now(),
    });
    this.#dirty = true;

    this.#refreshDesignSystem();
    this.#afterEdit();
    this.#notify('success', `“${theme.name}” applied`,
      `${result.rules} rules remapped across ${result.stamped} elements. Individual edits still win over the theme.`);
  }

  async #clearTheme() {
    const previous = this.#themes.active;
    this.#monitor.suspend(() => this.#themes.clear());
    this.#pending = this.#pending.filter((c) => c.kind !== OpKind.THEME);
    await this.#sites.removeChangesOfKind(this.#scope.host, OpKind.THEME);
    if (previous) {
      this.#history.begin('Cleared theme');
      this.#history.add({ changeId: 'theme', property: 'theme', before: previous.id, after: null });
      this.#history.commit();
    }
    this.#refreshDesignSystem();
    this.#afterEdit();
  }

  /** Captures the page's current look as a reusable theme (§92). */
  async #saveCurrentAsTheme() {
    const tokens = await this.#detectTokens({ force: true });
    if (!tokens) return;
    const name = `${this.#scope.host} ${new Date().toLocaleDateString()}`;
    const theme = themeFromTokens(tokens, name);
    await this.#workspace.saveTheme(theme);
    this.#refreshDesignSystem();
    this.#notify('success', 'Saved as a theme', `“${theme.name}” can now be applied to any site.`);
  }

  async #findTheme(themeId) {
    return presetById(themeId) ?? (await this.#workspace.loadThemes()).find((t) => t.id === themeId) ?? null;
  }

  async #allThemes() {
    return [...PRESETS, ...(await this.#workspace.loadThemes())];
  }

  async #refreshDesignSystem() {
    if (!this.#started) return;
    this.#app.renderDesignSystem({
      themes: await this.#allThemes(),
      activeThemeId: this.#themes.active?.id ?? null,
      tokens: this.#tokens,
      scanning: this.#scanning,
    });
  }

  // ── History ─────────────────────────────────────────────────────────────

  #undo() {
    const operation = this.#history.undo();
    if (!operation) return;
    this.#replay(operation, 'before');
  }

  #redo() {
    const operation = this.#history.redo();
    if (!operation) return;
    this.#replay(operation, 'after');
  }

  #revertOperation(id) {
    const operation = this.#history.revertOperation(id);
    if (!operation) return;
    this.#replay(operation, 'before');
  }

  /** Applies one side of a recorded operation (§42). */
  #replay(operation, side) {
    this.#monitor.suspend(() => {
      for (const entry of operation.entries) {
        if (entry.property === 'theme') {
          const id = entry[side];
          const theme = id ? (presetById(id) ?? this.#themes.active) : null;
          if (theme && this.#tokens) this.#themes.apply(theme, this.#tokens);
          else this.#themes.clear();
          continue;
        }
        const element = this.#model.elementOf(entry.changeId);
        if (!element) continue;
        if (entry.property === 'text') {
          this.#engine.apply(element, { kind: OpKind.TEXT, text: entry[side] });
        } else if (entry.property === 'element') {
          if (side === 'before') this.#engine.restore(element);
          else this.#engine.apply(element, { kind: OpKind.REMOVE });
        } else if (entry.property === 'display' && entry.after === 'none') {
          if (side === 'before') this.#engine.stylesheet.remove(element.getAttribute('data-widt-id'), 'display', this.#breakpoint);
          else this.#engine.apply(element, { kind: OpKind.HIDE });
        } else {
          this.#engine.apply(element, {
            kind: OpKind.STYLE, breakpoint: this.#breakpoint, properties: { [entry.property]: entry[side] },
          });
        }
      }
    });
    this.#dirty = true;
    this.#afterEdit();
    this.#refreshLayers();
  }

  // ── Persistence (§40, §119) ─────────────────────────────────────────────

  async #save() {
    const pending = this.#pending;
    if (!pending.length) {
      this.#notify('info', 'Nothing to save', 'No new changes since the last save.');
      return;
    }
    for (const change of pending) {
      await this.#sites.addChange(this.#scope.host, this.#scope.path, change);
    }
    this.#pending = [];
    this.#dirty = false;
    // Save is reachable from the popup with the workspace closed.
    this.#app?.update({ dirty: false });
    this.#refreshStatus();
    this.#notify('success', 'Saved', `${pending.length} change${pending.length === 1 ? '' : 's'} saved for ${this.#scope.host}${this.#scope.path}.`);
  }

  /**
   * Finds and applies every saved change for this URL (§40, §85).
   * Low-confidence matches are parked, not guessed at.
   */
  async #reapply({ silent = false } = {}) {
    const changes = await this.#sites.changesForPath(this.#scope.host, this.#scope.path);
    this.#unmatched = [];
    let applied = 0;

    // A theme is page-wide, so it is applied first and never goes through identity
    // matching — and it must land *before* per-element overrides so those still win.
    const themeChange = changes.find((c) => c.kind === OpKind.THEME);
    if (themeChange?.theme) {
      const tokens = await this.#detectTokens();
      if (tokens) this.#monitor.suspend(() => this.#themes.apply(themeChange.theme, tokens));
    } else if (this.#themes.active) {
      this.#monitor.suspend(() => this.#themes.clear());
    }

    this.#monitor.suspend(() => {
      for (const change of changes) {
        if (change.kind === OpKind.THEME) { applied += 1; continue; }
        const match = resolveIdentity(this.#doc, change.target);
        if (!match.element) {
          this.#unmatched.push({ change, status: match.confidence > 0 ? MatchStatus.LOW_CONFIDENCE : MatchStatus.NOT_FOUND, confidence: match.confidence });
          continue;
        }
        if (match.ambiguous) {
          this.#unmatched.push({ change, status: MatchStatus.LOW_CONFIDENCE, confidence: match.confidence });
          continue;
        }
        this.#engine.apply(match.element, change);
        applied += 1;
      }
    });

    if (!silent) this.#reportUnmatched();
    return { applied, unmatched: this.#unmatched.length };
  }

  /** Surfaces changes that could not be placed, with a way to fix them (§85, §86, §101). */
  #reportUnmatched() {
    if (!this.#unmatched.length || !this.#app) return;
    for (const entry of this.#unmatched.slice(0, 3)) {
      const name = entry.change.label ?? entry.change.target.tag;
      this.#app.notices.show({
        tone: 'warning',
        key: `unmatched:${entry.change.id}`,
        title: 'Saved change could not be placed',
        text: entry.status === MatchStatus.LOW_CONFIDENCE
          ? `“${truncate(name, 32)}” has several possible matches on this page (${Math.round(entry.confidence * 100)}% confidence).`
          : `“${truncate(name, 32)}” no longer exists on this page.`,
        actions: [{ label: 'Choose element', action: 'remap-change', value: entry.change.id, variant: 'primary' }],
      });
    }
  }

  /** Remap flow: the next click assigns a new identity to an orphaned change (§86). */
  #beginRemap(changeId) {
    const entry = this.#unmatched.find((u) => u.change.id === changeId);
    if (!entry) return;
    this.#notify('info', 'Pick the replacement', 'Click the element this saved change should apply to.');
    const once = (selection) => {
      const element = selection[0];
      if (!element) return;
      this.#picker.off('selection', once);
      const change = { ...entry.change, target: buildIdentity(element) };
      this.#monitor.suspend(() => this.#engine.apply(element, change));
      this.#sites.removeChange(this.#scope.host, change.id);
      this.#stage(element, change);
      this.#unmatched = this.#unmatched.filter((u) => u.change.id !== changeId);
      this.#notify('success', 'Change remapped', 'Save to keep the new target.');
      this.#afterEdit();
    };
    this.#picker.on('selection', once);
    this.#setMode(Mode.DESIGN);
  }

  async #persistWorkspace() {
    const s = this.#app.state;
    await this.#workspace.saveWorkspace({
      layersWidth: s.layersWidth, inspectorWidth: s.inspectorWidth,
      layersVisible: s.layersVisible, inspectorVisible: s.inspectorVisible,
      activePanel: s.activePanel, appearance: s.appearance,
      breakpoint: this.#breakpoint, viewport: s.viewport,
      expandedSections: [...s.openSections],
    });
  }

  // ── Reactions ───────────────────────────────────────────────────────────

  #onStructure = async () => {
    // Dynamic content may have brought back an element a saved change belongs to (§67).
    this.#engine.ensureIntact();
    // Dynamic content arrives unstamped, so it would miss the theme entirely (§67).
    if (this.#themes.active) this.#monitor.suspend(() => this.#themes.restamp(this.#tokens ?? {}));
    await this.#reapply({ silent: true });
    this.#model.sweep();
    if (this.#started) {
      this.#refreshLayers();
      this.#overlay.sync();
    }
  };

  #onRoute = async ({ url }) => {
    // A client-side route is a different page for scoping purposes (§68).
    this.#scope = scopeFromUrl(url);
    this.#tokens = null;
    this.#monitor.suspend(() => { this.#engine.revertAll(); this.#themes.clear(); });
    await this.#reapply({ silent: !this.#started });
    if (this.#started) {
      this.#picker.clear();
      this.#app.update({ scope: `${this.#scope.host}${this.#scope.path}` });
      this.#refreshLayers();
      this.#refreshStatus();
    }
  };

  #onMarkPointerDown = (event) => {
    if (this.#mode !== Mode.DESIGN) return;
    const handle = this.#overlay.handleAt(event.clientX, event.clientY);
    if (!handle || !this.#primary) return;
    event.preventDefault();
    event.stopPropagation();
    this.#interactions.beginResize(this.#primary, handle, event);
  };

  #beginTextEdit(element) {
    if (this.#mode !== Mode.DESIGN) return;
    this.#textEditor.begin(element);
  }

  /** Keyboard shortcuts (§58). Never fire while the user is typing into a field. */
  #onKey = (event) => {
    if (this.#mode === Mode.OFF) return;
    if (this.#textEditor.active) return;
    const meta = event.metaKey || event.ctrlKey;

    if (event.key === 'Escape') {
      if (this.#interactions.active) return; // the gesture handles its own cancel
      this.#picker.clear();
      return;
    }
    if (meta && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) this.#redo();
      else this.#undo();
      return;
    }
    if (meta && event.key.toLowerCase() === 's') {
      event.preventDefault();
      this.#save();
      return;
    }
    if (meta && event.key.toLowerCase() === 'c' && this.#primary) {
      event.preventDefault();
      this.#copyStyle();
      return;
    }
    if (meta && event.key.toLowerCase() === 'v' && this.#primary) {
      event.preventDefault();
      this.#pasteStyle();
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && this.#primary) {
      event.preventDefault();
      this.#hideSelected();
      return;
    }
    if (event.key === 'Enter' && this.#primary && this.#textEditor.canEdit(this.#primary)) {
      event.preventDefault();
      this.#beginTextEdit(this.#primary);
    }
  };

  // ── Rendering helpers ───────────────────────────────────────────────────

  #refreshLayers() {
    if (!this.#started) return;
    this.#app.renderLayers({ root: this.#doc.body, selection: this.#selection, hovered: this.#picker.hovered });
  }

  #refreshHistory() {
    this.#app.renderHistory({ list: this.#history.list(), pending: this.#history.pending() });
  }

  async #refreshStatus() {
    if (!this.#started) return;
    const profile = await this.#sites.activeProfile(this.#scope.host);
    const changes = await this.#sites.changesForPath(this.#scope.host, this.#scope.path);
    this.#app.update({
      selectionLabel: this.#primary ? truncate(labelFor(this.#primary), 24) : 'No selection',
      // Drives the toolbar's selection-dependent tools; without it Hide stays disabled.
      hasSelection: this.#selection.length > 0,
      changeCount: changes.length + (this.#pending.length),
      profileName: profile?.name ?? 'Disabled',
      scope: `${this.#scope.host}${this.#scope.path}`,
    });
  }

  /** Notices need the workspace; without it the message goes to the console instead. */
  #notify(tone, title, text, extra = {}) {
    if (this.#app) this.#app.notices.show({ tone, title, text, ...extra });
    else if (tone === 'warning' || tone === 'error') console.warn(`[web-interface-devtools] ${title}: ${text ?? ''}`);
  }

  /** Handles a message from the popup or service worker (§80). */
  async handleMessage(message) {
    switch (message.type) {
      case Msg.PING: return { ok: true, mode: this.#mode };
      case Msg.GET_STATUS: {
        const changes = await this.#sites.changesForPath(this.#scope.host, this.#scope.path);
        const profile = await this.#sites.activeProfile(this.#scope.host);
        return {
          ok: true, mode: this.#mode, host: this.#scope.host, path: this.#scope.path,
          changeCount: changes.length, unmatched: this.#unmatched.length,
          profile: profile ? { id: profile.id, name: profile.name } : null,
          theme: this.#themes.active ? { id: this.#themes.active.id, name: this.#themes.active.name } : null,
          dirty: this.#dirty,
        };
      }
      case Msg.SET_MODE:
        if (message.mode === Mode.OFF) this.close();
        else await this.open(message.mode);
        return { ok: true, mode: this.#mode };
      case Msg.SAVE: await this.#save(); return { ok: true };
      case Msg.UNDO: this.#undo(); return { ok: true };
      case Msg.REDO: this.#redo(); return { ok: true };
      case Msg.RESET_PAGE: {
        const result = await this.#sites.resetPath(this.#scope.host, this.#scope.path);
        this.#monitor.suspend(() => { this.#engine.revertAll(); this.#themes.clear(); });
        this.#history.reset();
        this.#pending = [];
        this.#dirty = false;
        await this.#reapply({ silent: true });
        return { ok: true, ...result };
      }
      case Msg.RESET_SITE: {
        const cleared = await this.#sites.resetSite(this.#scope.host);
        this.#monitor.suspend(() => { this.#engine.revertAll(); this.#themes.clear(); });
        this.#history.reset();
        this.#pending = [];
        this.#dirty = false;
        return { ok: true, cleared };
      }
      case Msg.LIST_PROFILES: return { ok: true, profiles: await this.#profiles.list(this.#scope.host) };
      case Msg.SET_PROFILE: {
        await this.#profiles.activate(this.#scope.host, message.profileId);
        this.#monitor.suspend(() => { this.#engine.revertAll(); this.#themes.clear(); });
        await this.#reapply({ silent: true });
        return { ok: true };
      }
      case Msg.CREATE_PROFILE: {
        const profile = await this.#profiles.create(this.#scope.host, message.name, { copyFrom: message.copyFrom });
        return { ok: true, profile: { id: profile.id, name: profile.name } };
      }
      case Msg.DETECT_TOKENS: return { ok: true, tokens: await this.#detectTokens({ force: message.force }) };
      case Msg.LIST_THEMES:
        return { ok: true, themes: await this.#allThemes(), activeThemeId: this.#themes.active?.id ?? null };
      case Msg.APPLY_THEME: await this.#applyTheme(message.themeId); return { ok: true };
      case Msg.CLEAR_THEME: await this.#clearTheme(); return { ok: true };
      case Msg.SAVE_THEME: await this.#saveCurrentAsTheme(); return { ok: true };
      case Msg.EXPORT: return { ok: true, data: await this.#profiles.export(this.#scope.host, message.profileId) };
      case Msg.IMPORT: return this.#profiles.import(this.#scope.host, message.data);
      case Msg.FACTORY_RESET:
        this.#monitor.suspend(() => this.#engine.revertAll());
        await this.#workspace.factoryReset();
        this.#sites.invalidate();
        return { ok: true };
      default:
        return { ok: false, reason: `Unknown message "${message.type}".` };
    }
  }
}
