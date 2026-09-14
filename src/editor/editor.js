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
import { OpKind, OWNED_ATTR, EditMode, EditTool, Breakpoint } from '../shared/types.js';
import { SiteStylesheet } from './site-sheet.js';
import { formatDeclarations, parseDeclarations } from '../shared/css-text.js';
import { scopeFromPath } from '../storage/edits.js';
import { buildIdentity, resolveIdentity } from './identity.js';
import { ElementModel, labelFor, isSelectable, firstSelectableChild, selectableSibling } from './model.js';
import { appliedStyles } from './cascade.js';
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

/** The applied styles, or nothing: a page's stylesheets can throw for reasons of their own. */
function safeStyles(element, view, own) {
  try {
    return appliedStyles(element, view, own);
  } catch {
    return null;
  }
}

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
  /**
   * Whether the editor has hold of the page at all.
   *
   * Kept here rather than in the panel because it is not a way of looking at the page: the
   * picker, the overlay, the gestures and the keyboard all have to agree about it, and
   * with the arrow held every one of them lets go.
   */
  #tool = EditTool.POINT;
  #site;
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
    this.#site = new SiteStylesheet(doc);
    this.#history = new HistoryEngine();
    this.#picker = new Picker({ doc, view, host: null });
    this.#textEditor = new TextEditor({ view });
    this.#interactions = new Interactions({ doc, view });

    this.#history.on('change', () => this.emit('change'));
  }

  get mode() { return this.#mode; }
  get tool() { return this.#tool; }
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
      tool: this.#tool,
      dirty: this.#dirty,
      // Changes made but not yet saved. The panel counts these alongside the ones already
      // in storage, so "what have I done to this site" is answered before you press Save.
      pending: this.#pending.size,
      history: this.#history.state(),
      unmatched: this.#unmatched.length,
      // How many rules the site stylesheet is carrying, so the code tool can say when
      // there is something written that the selection does not show.
      siteRules: this.#site.rules.length,
      // Both scopes of the code tool. Kept here rather than fetched separately so that
      // every repaint the panel already does carries the current text with it.
      elementCss: element ? this.elementCss() : '',
      siteCss: this.#site.text,
      selection: element ? this.detail() : null,
    };
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  /** Applies saved changes, with no UI. Runs on every page load. */
  async reapply() {
    if (!this.#edits) return { applied: 0, parked: 0 };
    const path = this.#view.location?.pathname ?? '/';

    // The stylesheet first. It is not anchored to an element, so it has nothing to wait
    // for, and it should be painting before the page has finished settling.
    this.restoreSiteCss(await this.#edits.sheetFor(this.#host, path));

    const changes = await this.#edits.changesFor(this.#host, path);
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
    // Opening Edit mode is asking to edit, so it opens holding the pencil. The arrow is
    // how you put the editor down again, not how you find it.
    this.#tool = this.#mode === EditMode.DESIGN ? EditTool.EDIT : EditTool.POINT;
    this.#overrides.mount();
    this.#site.mount();
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
    this.#tool = EditTool.POINT;
    this.#picker.stop();
    this.#textEditor.cancel();
    this.#interactions.cancel();
    this.#selection = [];
    this.#unwire();
    this.#unmountOverlay();
    this.emit('change');
  }

  /**
   * Picks the editor up, or puts it down.
   *
   * Putting it down is the whole point of the arrow, so it is thorough: any open text edit
   * is committed, the selection goes, the highlight goes, the gestures are cancelled and
   * the picker stops listening — the page is a page again. What it does not touch is the
   * work: every change already made stays on the page, because letting go of a tool is not
   * a way of undoing what it did.
   */
  setTool(tool) {
    const next = tool === EditTool.EDIT || tool === EditTool.CODE ? tool : EditTool.POINT;
    if (next === this.#tool) return;
    this.#tool = next;
    this.#applyTool();
    this.emit('change');
  }

  /**
   * Makes the page agree with the tool being held.
   *
   * Every layer that can touch the page is switched from one place, because a picker that
   * is still hovering while the overlay has stopped drawing is a page that highlights
   * things it will not let you select.
   */
  #applyTool() {
    const engaged = this.#engaged();
    // The code tool selects but does not drag. A resize grip is a way of writing a width,
    // and someone who has chosen to write their widths does not need two of them — nor a
    // handle sitting over the element they are trying to read the box of.
    const editing = this.#tool === EditTool.EDIT && this.#mode === EditMode.DESIGN;
    if (engaged) {
      this.#picker.setInteractive(true);
      this.#picker.start({ interactive: true });
    } else {
      this.#textEditor.commit();
      this.#interactions.cancel();
      // Order matters: clearing while the picker is still running is what lets the
      // selection event through to the overlay. Stopping first would drop it.
      this.#picker.clear();
      this.#picker.stop();
      this.#overlay?.setHover(null);
    }
    this.#overlay?.setResizable(editing);
    this.#overlay?.setSpacing(editing);
  }

  /** True while a tool that touches the page is held. */
  #engaged() {
    return this.#mode === EditMode.DESIGN
      && (this.#tool === EditTool.EDIT || this.#tool === EditTool.CODE);
  }

  /** Full teardown: the page goes back to exactly what the server sent. */
  destroy() {
    this.exit();
    this.#monitor.suspend(() => this.#overrides.revertAll());
    this.#overrides.teardown();
    this.#site.teardown();
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
    if (this.#mode !== EditMode.DESIGN || this.#tool !== EditTool.EDIT) return;
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
    if (event.composedPath?.().some((node) => node?.hasAttribute?.(OWNED_ATTR))) return;
    // With the arrow held the editor has let go of the page, and that has to include the
    // keyboard: a site's own search box, its shortcuts and its undo are its own again.
    if (!this.#engaged()) return;

    // Enter means "done", and it is claimed here — on the document, in the capture phase —
    // rather than left to the element being typed in. A site's own Enter handler sits
    // above that element and would run first: a form submits, a link is followed, the page
    // navigates, and the panel goes with it. So while the pencil is held the page never
    // sees this key at all. What it does is finish the words and put the editor down;
    // Shift+Enter is left alone, because inside a text edit that is a line break.
    if (event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      if (this.#textEditor.active) this.#textEditor.commit();
      this.setTool(EditTool.POINT);
      return;
    }
    if (this.#textEditor.active) return;

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

  /** Steps into the selection — the way back down from `selectParent`. */
  selectChild() {
    this.#picker.selectChild();
  }

  /** Steps sideways: `1` for the next sibling, `-1` for the previous. */
  selectSibling(direction = 1) {
    this.#picker.selectSibling(direction < 0 ? -1 : 1);
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
      canSelectParent: isSelectable(element.parentElement, this.#view),
      canSelectChild: !!firstSelectableChild(element, this.#view),
      canSelectPrevious: !!selectableSibling(element, -1, this.#view),
      canSelectNext: !!selectableSibling(element, 1, this.#view),
      // What the site's own CSS says about this element, rule by rule — the browser's
      // Styles pane, in the column. Read here rather than in the model because it is
      // about the stylesheets, not the element, and is wanted fresh on every selection.
      styles: safeStyles(element, this.#view, this.#site.rules),
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

  /**
   * Sets several properties as a single change.
   *
   * A background image is four declarations — the picture, how it is sized, where it sits
   * and whether it tiles — and they are one decision. Committed one at a time they would
   * be four steps to undo, and three of the four would leave the page in a state nobody
   * asked for on the way back.
   *
   * @param {Object<string, string|null>} properties
   * @param {string} what named in the history entry, in place of a property name
   */
  setProperties(properties, what) {
    const element = this.#primary();
    if (!element || !Object.keys(properties).length) return;
    this.#commitStyle(properties, `${labelFor(element)} · ${what}`);
  }

  /**
   * Drops overrides and lets the site's own values through again (§51).
   *
   * Recorded like any other change, so it is undoable — reverting is a decision, not an
   * escape from the history.
   */
  clearProperties(properties) {
    const element = this.#primary();
    if (!element || !properties.length) return;
    this.#commitStyle(
      Object.fromEntries(properties.map((property) => [property, null])),
      `${labelFor(element)} · revert`,
      { discrete: true },
    );
  }

  // ── Written CSS ────────────────────────────────────────────────────────

  /** The selection's own overrides, as the CSS someone would have typed. */
  elementCss() {
    const element = this.#primary();
    if (!element) return '';
    return formatDeclarations(this.#overrides.overridesFor(element)[Breakpoint.ALL] ?? {});
  }

  /**
   * Replaces the selection's overrides with what was written.
   *
   * A property that was there and is not any more has been deleted on purpose, so it is
   * reverted rather than left standing — otherwise the text would say one thing and the
   * page would show another, and the only way back would be finding the row in the
   * inspector. Setting and reverting go in together as one entry, because one edit to one
   * block of text is one thing the user did and should take one undo.
   *
   * @returns {{ok:boolean, applied:number, removed:number, errors:string[]}}
   */
  applyElementCss(css) {
    const element = this.#primary();
    if (!element) return { ok: false, applied: 0, removed: 0, errors: ['Nothing is selected.'] };

    const { properties, errors } = parseDeclarations(css);
    const before = this.#overrides.overridesFor(element)[Breakpoint.ALL] ?? {};
    const removed = Object.keys(before).filter((property) => !(property in properties));

    const change = { ...properties };
    for (const property of removed) change[property] = null;
    if (!Object.keys(change).length) return { ok: true, applied: 0, removed: 0, errors };

    this.#commitStyle(change, `${labelFor(element)} · written CSS`, { discrete: true });
    return { ok: true, applied: Object.keys(properties).length, removed: removed.length, errors };
  }

  /** The site's own stylesheet, as written. */
  siteCss() {
    return this.#site.text;
  }

  /**
   * Replaces the site stylesheet.
   *
   * Not part of the undo history, and deliberately so: the history is a list of changes to
   * elements, and folding a block of text somebody is still writing into it would mean an
   * undo halfway through a rule. The text is its own record, and the way back from it is
   * to edit it.
   *
   * @returns {{rules:number, errors:string[]}}
   */
  applySiteCss(css) {
    const result = this.#monitor.suspend(() => this.#site.set(css));
    this.#afterSheet();
    return result;
  }

  /**
   * After the site stylesheet changes. A rule can resize the selection — a wider padding
   * moves every edge — so the marks are re-measured, and what the model remembers about
   * the element is stale, the same as after an element edit.
   */
  #afterSheet() {
    this.#model.invalidate();
    this.#overlay?.sync();
    this.#dirty = true;
    this.emit('change');
  }

  /**
   * Your version of one of the site's rules.
   *
   * The Styles list shows a rule as the site wrote it; this is what happens when it is
   * edited there. `base` is the site's own declarations for that selector, and only what
   * differs from them is written — see `parseDeclarations` — as a rule with the same
   * selector and breakpoint in the site stylesheet, where it outranks the site's. Written
   * back to exactly what the site said, the rule is removed again, so there is nothing
   * left over from a change of mind.
   *
   * Not undoable, for the same reason the site stylesheet is not: it is text the user
   * owns, and the way back from it is to edit it.
   *
   * @param {{selector:string, media?:string|null, base?:object}} rule the site's rule;
   *   `media` is the bare condition, as the Styles list shows it
   * @returns {{ok:boolean, written:number, rules:number, errors:string[]}}
   */
  applyRuleCss({ selector, media = null, base = {} }, css) {
    const { properties, errors } = parseDeclarations(css, { base });
    const result = this.#monitor.suspend(() => this.#site.setRule({
      selector,
      media: media ? `@media ${media}` : null,
      properties,
    }));
    this.#afterSheet();
    return {
      ok: true,
      written: Object.keys(properties).length,
      rules: result.rules,
      errors: [...errors, ...result.errors],
    };
  }

  /** Takes your version of a rule out of the site stylesheet, leaving the site's own. */
  removeRule({ selector, media = null }) {
    const result = this.#monitor.suspend(() => this.#site.setRule({
      selector,
      media: media ? `@media ${media}` : null,
      properties: {},
    }));
    this.#afterSheet();
    return result;
  }

  /** Puts a saved stylesheet back, on load, without marking the page unsaved. */
  restoreSiteCss(css) {
    if (!css) return;
    this.#site.mount();
    this.#monitor.suspend(() => this.#site.set(css));
  }

  #commitStyle(properties, label, { discrete = false } = {}) {
    const element = this.#primary();
    if (!element) return;

    // A commit with no preview before it still needs its starting values.
    this.#recordBefore(element, properties);

    this.#history.begin(label, { discrete });
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
    const path = this.#view.location?.pathname ?? '/';

    // The stylesheet is saved whether or not any element changed, and its own state is
    // what decides — a sheet emptied on purpose has to be able to save as empty.
    const sheetChanged = this.#site.text !== (await this.#edits.sheetFor(this.#host, path));
    if (sheetChanged) await this.#edits.saveSheet(this.#host, path, this.#site.text);

    const changes = [...this.#pending.values()];
    if (!changes.length) {
      this.#dirty = false;
      this.emit('change');
      return { saved: sheetChanged ? 1 : 0, scope: scopeFromPath(path) };
    }
    await this.#edits.addAll(this.#host, path, changes);
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
    this.#monitor.suspend(() => { this.#overrides.revertAll(); this.#site.clear(); });
    this.#pending.clear();
    this.#history.reset();
    this.#dirty = false;
    const path = this.#view.location?.pathname ?? '/';
    const result = this.#edits ? await this.#edits.resetPath(this.#host, path) : { removed: 0, remaining: 0 };
    // A sheet written for the whole site is not this page's to remove, and it comes back
    // the moment the page's own is gone — the same as it would on the next load.
    if (this.#edits) this.restoreSiteCss(await this.#edits.sheetFor(this.#host, path));
    this.#select([]);
    this.emit('change');
    return result;
  }

  async resetSite() {
    // The stylesheet goes with the element changes: storage forgets both, and a sheet
    // still painting a page that storage says is untouched would be a lie on the page.
    this.#monitor.suspend(() => { this.#overrides.revertAll(); this.#site.clear(); });
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
