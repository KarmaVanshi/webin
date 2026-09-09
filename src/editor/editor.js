/**
 * The editor: everything that happens between clicking an element and seeing the change
 * again after a reload.
 *
 * The engines below it each do one thing and know nothing about the others — the picker
 * knows about pointers, the override engine about CSS, history about operations, the
 * identity module about finding an element again tomorrow. This file is where they meet,
 * and it is deliberately the only place that knows all of them.
 *
 * Two rules run through the whole file:
 *
 *   1. **Preview is not commit.** Dragging a handle repaints the page on every frame and
 *      records nothing. Only letting go writes history. Otherwise a single drag is fifty
 *      undo steps.
 *
 *   2. **Every write to the page is wrapped in `monitor.suspend`.** The theme engine
 *      watches the DOM for changes and re-stamps what it finds; an unsuspended write is
 *      an edit that triggers a re-stamp that triggers an edit.
 */

import { Emitter, uid } from '../shared/util.js';
import { OpKind, OWNED_ATTR, EditMode, Breakpoint } from '../shared/types.js';
import { scopeFromPath } from '../storage/edits.js';
import { buildIdentity, resolveIdentity } from './identity.js';
import { ElementModel, labelFor } from './model.js';
import { OverrideEngine } from './overrides.js';
import { HistoryEngine } from './history.js';
import { Picker } from './picker.js';
import { Overlay } from './overlay.js';
import { Interactions } from './interactions.js';
import { TextEditor } from './text-edit.js';
import { analyse } from './layout.js';
import { collectShadowRoots } from '../content/dom.js';
import { overlayCss } from './overlay.js';
import { overlayTokens } from '../ui/overlay-css.js';

/** How far an arrow key moves a selected element. Shift makes it a bigger step. */
const NUDGE = 1;
const NUDGE_LARGE = 10;

export class Editor extends Emitter {
  #doc;
  #view;
  #host;
  #edits;
  #monitor;

  #model;
  #overrides;
  #history;
  #picker;
  #textEditor;
  #interactions;
  #overlay = null;
  #overlayHost = null;

  #mode = EditMode.OFF;
  #selection = [];
  /**
   * Identities captured when an element was selected, not when it was edited.
   *
   * A saved identity carries a fingerprint of the element's text. Build it after an
   * inline text edit and the fingerprint describes the *new* words — which are not the
   * words that will be on the page the next time it loads, so the change would never
   * match again. Capturing at selection is what makes text edits survive a reload.
   */
  #identities = new WeakMap();
  #pending = new Map();
  /**
   * What each property was before the gesture currently under way.
   *
   * Read at commit time instead, and a drag has already overwritten it forty frames ago —
   * the "before" would be the value being committed, the two would compare equal, and the
   * whole gesture would drop out of history as a no-op.
   */
  #gestureBefore = new Map();
  /**
   * Whether the click that follows the gesture just finished should be thrown away.
   *
   * Releasing after a drag produces an ordinary `click`, and the picker cannot tell it
   * from a deliberate one — so it selects whatever the pointer happened to land on and
   * the thing being resized stops being the thing selected, at the exact moment the user
   * finishes resizing it. Set only once a gesture has actually moved, so a click that
   * stayed put still selects normally.
   */
  #swallowClick = false;
  #unmatched = [];
  #dirty = false;
  #disposers = [];

  constructor({ doc = document, view = window, host = '', editStore = null, monitor = null } = {}) {
    super();
    this.#doc = doc;
    this.#view = view;
    this.#host = host;
    this.#edits = editStore;
    // Without a monitor there is nothing watching the DOM, so nothing to suspend.
    this.#monitor = monitor ?? { suspend: (fn) => fn() };

    this.#model = new ElementModel({ doc, view });
    this.#overrides = new OverrideEngine({ doc, view });
    this.#history = new HistoryEngine();
    this.#picker = new Picker({ doc, view, host: null });
    this.#textEditor = new TextEditor({ view });
    this.#interactions = new Interactions({ doc, view });

    this.#history.on('change', () => this.emit('change'));
  }

  get mode() { return this.#mode; }
  get active() { return this.#mode !== EditMode.OFF; }
  get selection() { return [...this.#selection]; }
  get dirty() { return this.#dirty; }
  get unmatched() { return [...this.#unmatched]; }
  get overrides() { return this.#overrides; }
  get history() { return this.#history; }

  /** Everything the panel needs to draw itself. */
  state() {
    const element = this.#primary();
    return {
      mode: this.#mode,
      dirty: this.#dirty,
      history: this.#history.state(),
      unmatched: this.#unmatched.length,
      selection: element ? this.detail() : null,
    };
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  /** Applies saved changes, with no UI. Runs on every page load. */
  async reapply() {
    if (!this.#edits) return { applied: 0, parked: 0 };
    const changes = await this.#edits.changesFor(this.#host, this.#view.location?.pathname ?? '/');
    if (!changes.length) return { applied: 0, parked: 0 };

    this.#overrides.mount();

    // Resolve everything before applying anything. A text change rewrites the words its
    // own identity was fingerprinted from, so resolving as we go would break every change
    // queued behind it.
    // `querySelectorAll` does not cross a shadow boundary, so the document alone would
    // never find an element inside a web component — and on a site built from components
    // that is most of what anyone edits. Every open root is searched as well.
    const searchRoots = [this.#doc, ...collectShadowRoots(this.#doc)];
    const pools = new Map();
    const matched = [];
    for (const change of changes) {
      const tag = change.target.tag;
      if (!pools.has(tag)) {
        const pool = [];
        for (const root of searchRoots) {
          try {
            pool.push(...root.querySelectorAll(tag));
          } catch {
            // A root that cannot be queried simply contributes no candidates.
          }
        }
        pools.set(tag, pool);
      }
      const found = resolveIdentity(this.#doc, change.target, { candidates: pools.get(tag) });
      if (found.element) matched.push([change, found.element]);
      else this.#unmatched.push({ change, confidence: found.confidence, ambiguous: found.ambiguous });
    }

    this.#monitor.suspend(() => {
      for (const [change, element] of matched) {
        this.#overrides.apply(element, change);
        this.#identities.set(element, change.target);
      }
    });

    if (this.#unmatched.length) {
      this.emit('notice', {
        key: 'unmatched',
        tone: 'warning',
        message: this.#unmatched.length === 1
          ? 'One saved change could not be matched on this page.'
          : `${this.#unmatched.length} saved changes could not be matched on this page.`,
      });
    }
    this.emit('change');
    return { applied: matched.length, parked: this.#unmatched.length };
  }

  /** Opens the editor over the page. */
  enter(mode = EditMode.DESIGN) {
    this.#mode = mode === EditMode.INSPECT ? EditMode.INSPECT : EditMode.DESIGN;
    this.#overrides.mount();
    this.#mountOverlay();
    this.#overlay?.setResizable(this.#mode === EditMode.DESIGN);
    this.#overlay?.setSpacing(this.#mode === EditMode.DESIGN);

    // Wiring before the picker starts is deliberate. Both listen for pointerdown on the
    // document in the capture phase, so whoever registers first decides first — and a
    // press on a resize grip has to be claimed as a resize before the picker treats it as
    // a click on whatever happens to be underneath.
    this.#wire();
    this.#picker.setInteractive(this.#mode === EditMode.DESIGN);
    this.#picker.start({ interactive: this.#mode === EditMode.DESIGN });
    this.emit('change');
  }

  /** Closes the editor. Overrides stay: leaving the editor is not undoing your work. */
  exit() {
    this.#mode = EditMode.OFF;
    this.#picker.stop();
    this.#textEditor.cancel();
    this.#interactions.cancel();
    this.#selection = [];
    this.#unwire();
    this.#unmountOverlay();
    this.emit('change');
  }

  /** Full teardown: the page goes back to exactly what the server sent. */
  destroy() {
    this.exit();
    this.#monitor.suspend(() => this.#overrides.revertAll());
    this.#overrides.teardown();
    this.#history.reset();
    this.#pending.clear();
    this.#unmatched = [];
    this.#dirty = false;
  }

  #mountOverlay() {
    if (this.#overlay) return;
    // The editor's marks live in their own shadow root so the page cannot style them and
    // the theme cannot repaint them — the same reasoning as the panel, and a separate
    // host so neither has to care about the other's pointer-events.
    const host = this.#doc.createElement('div');
    host.setAttribute(OWNED_ATTR, '');
    host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483646;'
      + ' pointer-events: none; isolation: isolate;';
    this.#doc.documentElement.appendChild(host);

    const shadow = host.attachShadow({ mode: 'open' });
    const style = this.#doc.createElement('style');
    style.textContent = overlayTokens + overlayCss;
    shadow.append(style);

    // The overlay replaces its container's contents wholesale on every render, so it gets
    // a container of its own rather than the shadow root — otherwise the first frame
    // would take the stylesheet with it.
    const marks = this.#doc.createElement('div');
    marks.className = 'webin-marks-host';
    shadow.append(marks);

    this.#overlayHost = host;
    this.#overlay = new Overlay(marks, { view: this.#view });
  }

  #unmountOverlay() {
    this.#overlay?.destroy();
    this.#overlay = null;
    this.#overlayHost?.remove();
    this.#overlayHost = null;
  }

  // ── Wiring ─────────────────────────────────────────────────────────────

  #wire() {
    if (this.#disposers.length) return;
    const on = (target, type, handler, options) => {
      target.addEventListener(type, handler, options);
      this.#disposers.push(() => target.removeEventListener(type, handler, options));
    };

    this.#disposers.push(
      this.#picker.on('hover', (element) => this.#overlay?.setHover(element)),
      this.#picker.on('selection', (elements) => this.#select(elements)),
      this.#picker.on('activate', (element) => this.editText(element)),
      this.#interactions.on('preview', ({ element, properties }) => {
        // The first preview is the moment a press became a gesture.
        this.#swallowClick = true;
        this.#applyLive(element, properties);
      }),
      this.#interactions.on('commit', ({ properties, label }) => this.#commitStyle(properties, label)),
      this.#interactions.on('refused', ({ reason }) => this.emit('notice', { tone: 'warning', message: reason })),
      this.#interactions.on('cancel', () => this.#gestureBefore.clear()),
      this.#textEditor.on('commit', (payload) => this.#commitText(payload)),
      this.#textEditor.on('refused', ({ reason }) => this.emit('notice', { tone: 'warning', message: reason })),
    );

    // The overlay is pointer-transparent, so a grip is hit geometrically rather than by
    // letting the browser route the event. That keeps the marks layer out of the way of
    // the page entirely, which is what stops the editor from breaking the site it is on.
    on(this.#doc, 'pointerdown', this.#onPointerDown, true);
    on(this.#doc, 'click', this.#onClickCapture, true);
    on(this.#doc, 'keydown', this.#onKeyDown, true);
    // Geometry moves for reasons no mutation observer reports.
    on(this.#view, 'scroll', this.#sync, { capture: true, passive: true });
    on(this.#view, 'resize', this.#sync, { passive: true });
  }

  #unwire() {
    for (const dispose of this.#disposers) dispose();
    this.#disposers = [];
  }

  #sync = () => this.#overlay?.sync();

  #onClickCapture = (event) => {
    if (!this.#swallowClick) return;
    this.#swallowClick = false;
    event.preventDefault();
    // Immediate, not ordinary. The picker listens on this same node, and `stopPropagation`
    // only stops the event reaching *other* nodes — every remaining listener on `document`
    // still runs. That distinction is the whole bug: the drag would finish, the click
    // behind it would reach the picker, and the element being resized would stop being
    // the element selected at the exact moment the user let go of it.
    event.stopImmediatePropagation();
  };

  #onPointerDown = (event) => {
    if (this.#mode !== EditMode.DESIGN) return;
    const element = this.#primary();
    if (!element) return;

    // The panel's own presses belong to the panel, and that has to be settled before
    // anything else looks at where the pointer is. Grips are hit by coordinate, and a grip
    // drawn on a wide element passes straight under the panel — so asking about grips
    // first meant that pressing a control there began a resize instead: the swatch never
    // opened its colour picker, and dragging resized the page behind it.
    if (event.composedPath?.().some((node) => node?.hasAttribute?.(OWNED_ATTR))) return;

    // The grips are hit geometrically rather than by letting the browser route the event,
    // because the overlay is pointer-transparent — it has to be, or it would swallow every
    // click meant for the page. So the grip is never the event's target and asking what
    // was clicked would always give the wrong answer.
    const handle = this.#overlay?.handleAt(event.clientX, event.clientY);
    if (handle) {
      if (this.#interactions.beginResize(element, handle, event)) {
        event.preventDefault();
        // Claim it outright: the picker is listening on this same node, so anything short
        // of `stopImmediatePropagation` still lets it reselect whatever the grip was
        // drawn over, and the resize loses its subject mid-gesture.
        event.stopImmediatePropagation();
      }
      return;
    }

    // While the words are being edited, a press is the caret and a drag is a selection.
    // Starting a move here would slide the element out from under the sentence.
    if (this.#textEditor.active) return;

    // Dragging starts on the element itself, and only once the pointer has actually
    // travelled — `Interactions` holds a threshold so a click stays a click.
    if (event.target && element.contains?.(event.target)) {
      this.#interactions.beginDrag(element, event);
    }
  };

  #onKeyDown = (event) => {
    if (this.#mode === EditMode.OFF) return;
    if (this.#textEditor.active) return;
    if (event.composedPath?.().some((node) => node?.hasAttribute?.(OWNED_ATTR))) return;

    const meta = event.metaKey || event.ctrlKey;
    if (meta && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) this.redo(); else this.undo();
      return;
    }
    if (meta && event.key.toLowerCase() === 's') {
      event.preventDefault();
      this.save().catch(() => this.emit('notice', { tone: 'warning', message: 'Webin could not save those changes.' }));
      return;
    }
    if (event.key === 'Escape') { this.#picker.clear(); this.#select([]); return; }
    if (!this.#primary()) return;

    // The keyboard equivalent of dragging. WCAG asks for one; it is also simply the only
    // way to move something by exactly one pixel.
    const step = event.shiftKey ? NUDGE_LARGE : NUDGE;
    const moves = {
      ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
    };
    if (moves[event.key]) {
      event.preventDefault();
      this.nudge(...moves[event.key]);
    }
  };

  // ── Selection ──────────────────────────────────────────────────────────

  #select(elements) {
    this.#selection = elements.filter(Boolean);
    for (const element of this.#selection) this.#identityOf(element);
    this.#overlay?.setSelection(this.#selection);
    this.emit('change');
  }

  #primary() {
    const element = this.#selection[0];
    return element?.isConnected ? element : null;
  }

  /**
   * The identity to save for an element, captured the first time it is asked for.
   * See the field comment: this must predate any edit to the element's text.
   */
  #identityOf(element) {
    let identity = this.#identities.get(element);
    if (!identity) {
      identity = buildIdentity(element);
      this.#identities.set(element, identity);
    }
    return identity;
  }

  /** Selects an element directly, from the layers list or a remap. */
  select(element) {
    this.#picker.select(element);
  }

  selectParent() {
    this.#picker.selectParent();
  }

  /** The inspector's payload for the current selection. */
  detail() {
    const element = this.#primary();
    if (!element) return null;
    const detail = this.#model.detail(element, { fresh: true });
    return {
      ...detail,
      label: labelFor(element),
      // `detail` already carries `layout` (the computed box) and `layoutContext` (what
      // kind of layout it sits in). Naming either one `layout` here would shadow the
      // other, and the inspector needs both.
      context: analyse(element, this.#view),
      overrides: this.#overrides.overridesFor(element)[Breakpoint.ALL] ?? {},
      hidden: this.#overrides.overrideValue(element, 'display') === 'none',
      removed: this.#overrides.isRemoved(element),
      canEditText: this.#textEditor.canEdit(element),
    };
  }

  // ── Editing ────────────────────────────────────────────────────────────

  /** Repaints without recording. Used while a slider or a handle is still moving. */
  #applyLive(element, properties) {
    const target = element ?? this.#primary();
    if (!target) return;
    this.#recordBefore(target, properties);
    this.#monitor.suspend(() => {
      this.#overrides.apply(target, { kind: OpKind.STYLE, properties });
    });
    this.#overlay?.sync();
  }

  /** Snapshots the starting value of anything about to be changed, once per gesture. */
  #recordBefore(element, properties) {
    const changeId = this.#model.idOf(element);
    for (const property of Object.keys(properties)) {
      const key = `${changeId}|${property}`;
      if (!this.#gestureBefore.has(key)) {
        this.#gestureBefore.set(key, this.#currentValue(element, property));
      }
    }
  }

  /**
   * What a property is set to right now: the override if there is one, otherwise what the
   * site computes to.
   *
   * An empty computed value means the site never set the property, and the way to put
   * *that* back on undo is to delete the declaration — not to write an empty one, which
   * the validator would reject and which would leave the override standing.
   */
  #currentValue(element, property) {
    const override = this.#overrides.overrideValue(element, property);
    if (override != null) return override;
    let value = null;
    try {
      value = this.#view.getComputedStyle(element).getPropertyValue(property);
    } catch {
      value = null;
    }
    return typeof value === 'string' && value.trim() ? value : null;
  }

  /**
   * Sets one property from the inspector.
   *
   * `phase` is what separates a slider being dragged from a slider being let go: the
   * first repaints, the second is a thing you can undo.
   */
  setProperty(property, value, { phase = 'commit' } = {}) {
    const element = this.#primary();
    if (!element) return;
    if (phase === 'preview') { this.#applyLive(element, { [property]: value }); return; }
    this.#commitStyle({ [property]: value }, `${labelFor(element)} · ${property}`);
  }

  #commitStyle(properties, label) {
    const element = this.#primary();
    if (!element) return;

    // A commit with no preview before it still needs its starting values.
    this.#recordBefore(element, properties);

    this.#history.begin(label);
    const changeId = this.#model.idOf(element);
    for (const [property, value] of Object.entries(properties)) {
      const key = `${changeId}|${property}`;
      this.#history.add({ changeId, property, before: this.#gestureBefore.get(key) ?? null, after: value });
      this.#gestureBefore.delete(key);
    }

    const result = this.#monitor.suspend(() => this.#overrides.apply(element, {
      kind: OpKind.STYLE, properties,
    }));
    if (result?.rejected?.length) {
      this.emit('notice', {
        tone: 'warning',
        message: `Webin could not use ${result.rejected.map((r) => r.property).join(', ')}.`,
      });
    }
    this.#history.commit(label);
    this.#stage(element, { kind: OpKind.STYLE, properties, label });
    this.#afterEdit();
  }

  /** Moves the selection, in whatever way its layout context actually allows. */
  nudge(dx, dy) {
    const element = this.#primary();
    if (!element) return;
    const context = analyse(element, this.#view);
    const strategy = context.position === 'static' ? 'margin' : 'offset';
    let style;
    try {
      style = this.#view.getComputedStyle(element);
    } catch {
      return;
    }
    const current = (property) => Number.parseFloat(
      this.#overrides.overrideValue(element, property) ?? style.getPropertyValue(property),
    ) || 0;

    const properties = strategy === 'offset'
      ? { left: `${current('left') + dx}px`, top: `${current('top') + dy}px` }
      : { 'margin-left': `${current('margin-left') + dx}px`, 'margin-top': `${current('margin-top') + dy}px` };
    this.#commitStyle(properties, `${labelFor(element)} · move`);
  }

  hide() {
    const element = this.#primary();
    if (!element) return;
    this.#commitStyle({ display: 'none' }, `${labelFor(element)} · hide`);
  }

  unhide() {
    const element = this.#primary();
    if (!element) return;
    this.#commitStyle({ display: null }, `${labelFor(element)} · show`);
  }

  /** Takes the element out of the rendered page, reversibly. */
  remove() {
    const element = this.#primary();
    if (!element) return;
    const changeId = this.#model.idOf(element);
    this.#history.begin(`${labelFor(element)} · remove`);
    this.#history.add({ changeId, property: 'element', before: 'present', after: 'removed' });
    this.#monitor.suspend(() => this.#overrides.apply(element, { kind: OpKind.REMOVE }));
    this.#history.commit();
    this.#stage(element, { kind: OpKind.REMOVE, label: `${labelFor(element)} · remove` });
    this.#select([]);
    this.#afterEdit();
  }

  editText(element = null) {
    const target = element ?? this.#primary();
    if (!target) return false;
    return this.#textEditor.begin(target);
  }

  #commitText({ element, before, after }) {
    if (before === after) return;
    const changeId = this.#model.idOf(element);
    this.#history.begin(`${labelFor(element)} · text`);
    this.#history.add({ changeId, property: 'text', before, after });
    this.#history.commit();
    this.#stage(element, { kind: OpKind.TEXT, text: after, textBefore: before, label: `${labelFor(element)} · text` });
    this.#afterEdit();
  }

  // ── History ────────────────────────────────────────────────────────────

  undo() { this.#replay(this.#history.undo(), 'before'); }
  redo() { this.#replay(this.#history.redo(), 'after'); }

  #replay(operation, side) {
    if (!operation) return;
    this.#monitor.suspend(() => {
      for (const entry of operation.entries) {
        const element = this.#model.elementOf(entry.changeId);
        // The page may have replaced the element since. Nothing to put back.
        if (!element?.isConnected && entry.property !== 'element') continue;
        const value = entry[side];

        if (entry.property === 'text') {
          this.#overrides.apply(element, { kind: OpKind.TEXT, text: value });
        } else if (entry.property === 'element') {
          if (value === 'removed') this.#overrides.apply(element, { kind: OpKind.REMOVE });
          else this.#overrides.restore(element);
        } else {
          this.#overrides.apply(element, { kind: OpKind.STYLE, properties: { [entry.property]: value } });
        }
      }
    });
    this.#dirty = true;
    this.#afterEdit();
  }

  // ── Saving ─────────────────────────────────────────────────────────────

  /**
   * Records a change so Save has something to write. Nothing reaches storage until the
   * user asks, so a page full of experiments costs nothing until it is worth keeping.
   */
  #stage(element, partial) {
    const identity = this.#identityOf(element);
    const key = `${partial.kind}:${identity.domPath}:${identity.tag}`;
    const existing = this.#pending.get(key);
    if (existing) {
      if (partial.properties) existing.properties = { ...existing.properties, ...partial.properties };
      if (partial.text !== undefined) existing.text = partial.text;
      if (partial.label) existing.label = partial.label;
    } else {
      this.#pending.set(key, {
        id: uid('chg'),
        kind: partial.kind,
        breakpoint: Breakpoint.ALL,
        target: identity,
        label: partial.label ?? labelFor(element),
        createdAt: Date.now(),
        ...(partial.properties ? { properties: { ...partial.properties } } : {}),
        ...(partial.text !== undefined ? { text: partial.text } : {}),
        ...(partial.textBefore !== undefined ? { textBefore: partial.textBefore } : {}),
      });
    }
    this.#dirty = true;
  }

  async save() {
    if (!this.#edits) return { saved: 0 };
    const changes = [...this.#pending.values()];
    if (!changes.length) { this.#dirty = false; this.emit('change'); return { saved: 0 }; }
    await this.#edits.addAll(this.#host, this.#view.location?.pathname ?? '/', changes);
    this.#pending.clear();
    this.#dirty = false;
    this.emit('change');
    return { saved: changes.length, scope: scopeFromPath(this.#view.location?.pathname ?? '/') };
  }

  // ── Resetting ──────────────────────────────────────────────────────────

  /** Puts one element back and forgets it. */
  async resetElement() {
    const element = this.#primary();
    if (!element) return { removed: 0 };
    const identity = this.#identityOf(element);
    this.#monitor.suspend(() => this.#overrides.revert(element));
    for (const [key, change] of this.#pending) {
      if (change.target.domPath === identity.domPath) this.#pending.delete(key);
    }
    let removed = 0;
    if (this.#edits) {
      const saved = await this.#edits.changesFor(this.#host, this.#view.location?.pathname ?? '/');
      for (const change of saved) {
        if (change.target.domPath === identity.domPath) {
          await this.#edits.remove(this.#host, change.id);
          removed += 1;
        }
      }
    }
    this.#afterEdit();
    return { removed };
  }

  async resetPage() {
    this.#monitor.suspend(() => this.#overrides.revertAll());
    this.#pending.clear();
    this.#history.reset();
    this.#dirty = false;
    const result = this.#edits
      ? await this.#edits.resetPath(this.#host, this.#view.location?.pathname ?? '/')
      : { removed: 0, remaining: 0 };
    this.#select([]);
    this.emit('change');
    return result;
  }

  async resetSite() {
    this.#monitor.suspend(() => this.#overrides.revertAll());
    this.#pending.clear();
    this.#history.reset();
    this.#dirty = false;
    const result = this.#edits ? await this.#edits.resetSite(this.#host) : { removed: 0, remaining: 0 };
    this.#select([]);
    this.emit('change');
    return result;
  }

  /** Re-targets a saved change whose element could not be found. */
  remap(changeId) {
    const parked = this.#unmatched.find((entry) => entry.change.id === changeId);
    if (!parked) return false;
    this.emit('notice', { tone: 'info', message: 'Click the element this change belongs to.' });
    const off = this.#picker.on('selection', (elements) => {
      off();
      const element = elements[0];
      if (!element) return;
      const identity = buildIdentity(element);
      this.#identities.set(element, identity);
      this.#monitor.suspend(() => this.#overrides.apply(element, parked.change));
      this.#stage(element, { ...parked.change, label: parked.change.label });
      this.#unmatched = this.#unmatched.filter((entry) => entry !== parked);
      this.#afterEdit();
    });
    return true;
  }

  /**
   * Called after anything that changes the page.
   *
   * The flush comes first, and the order is the point of it. Style writes are batched onto
   * the next frame, so without it the overlay would measure the old box and the inspector
   * would describe the old value — clicking Centre would centre the heading and leave the
   * alignment control still showing Left. Not a slow update but a wrong one, and it stayed
   * wrong until something else happened to repaint the panel.
   *
   * `ensureIntact` is not paranoia either: a single-page app that swaps its body takes the
   * stylesheet with it, and a component rendering late brings a shadow root that has
   * never adopted it. Either one silently stops every override in that subtree.
   */
  #afterEdit() {
    this.#overrides.flush();
    this.#model.invalidate();
    this.#overlay?.sync();
    this.#overrides.ensureIntact();
    this.emit('change');
  }

  /** Re-adopts the override sheet into shadow roots the page has just added. */
  syncRoots() {
    this.#overrides.ensureIntact();
  }
}
