/**
 * Composition root: the only file that knows about all the others.
 *
 * Detection, the engine, the store, the observer and the panel are each independent and
 * meet here. What lives in this file is the flows that cross them — applying a theme,
 * remembering it, putting it back on the next visit, keeping it on content the site adds
 * later, and moving themes in and out of the extension.
 */

import { Msg, BOOT_STYLE_ID, OWNED_ATTR } from '../shared/types.js';
import { debounce } from '../shared/util.js';
import {
  parseThemeInput, isShareCode, decodeShareCode, encodeShareCode,
  themeToFile, collectionToFile, themeFileName, normaliseTheme,
} from '../shared/theme-format.js';
import { createBackend } from '../storage/bridge.js';
import { Store, StorageError, hostOf } from '../storage/store.js';
import { PRESETS, presetById } from '../themes/library.js';
import { themeFromTokens } from '../themes/capture.js';
import { detectTokens } from './tokens.js';
import { ThemeEngine } from './engine.js';
import { MutationMonitor } from './monitor.js';
import { Panel } from '../ui/panel.js';
import { EditStore } from '../storage/edits.js';
import { Editor } from '../editor/editor.js';
import { parseRuleKey } from '../editor/cascade.js';
import { ensureReadable } from '../shared/color.js';
import { EditMode } from '../shared/types.js';
import { backgroundFit } from '../shared/image.js';

/**
 * Properties a single inspector row is responsible for, beyond its own name.
 *
 * `background-color` is the only one so far: the `+` beside it writes four declarations,
 * and its revert has to take all four back.
 */
const REVERT_FAMILY = Object.freeze({
  'background-color': [
    'background-image', 'background-size', 'background-position',
    'background-repeat', 'background-attachment',
  ],
});

/**
 * Sites that render after the first paint need a second look. Two passes cover every
 * framework worth naming without turning into a polling loop.
 */
const SETTLE_PASSES = [400, 1600];

export class Webin {
  #doc;
  #view;
  #store;
  #engine;
  #monitor;
  #panel;

  #host;
  #edits;
  /**
   * Built the first time the user asks to edit something.
   *
   * A page that is only wearing a theme should not pay for the editor at all — no
   * overlay, no picker, no listeners — so this stays null until Edit mode is entered, or
   * until a saved change turns up that has to be put back.
   */
  #editor = null;
  /** Tokens read from the page *before* any theme touched it. */
  #tokens = null;
  #active = null;
  #settings = null;
  #timers = new Set();

  /** False inside an iframe: only the top document owns the panel. */
  #isTop;

  constructor({ doc = document, view = window, backend = null } = {}) {
    this.#doc = doc;
    this.#view = view;
    this.#isTop = isTopFrame(view);
    // A frame wears the theme of the page it is embedded in, not its own. An advertising
    // or comment iframe that keeps its white background is the one bright rectangle in an
    // otherwise dark page, and it is the first thing anybody notices.
    this.#host = hostOf(this.#isTop ? view.location.href : topOrigin(view) ?? view.location.href);
    this.#store = new Store(backend ?? createBackend());
    this.#engine = new ThemeEngine({ doc, view });
    this.#monitor = new MutationMonitor({ doc, view });
    this.#panel = new Panel({ doc });
    this.#edits = new EditStore(backend ?? createBackend());
    this.#panel.on('action', (payload) => { this.#onAction(payload).catch(reportError); });
    this.#panel.on('control', (payload) => { this.#onControl(payload); });
  }

  get host() { return this.#host; }
  get active() { return this.#active; }
  get panel() { return this.#panel; }
  get engine() { return this.#engine; }
  get editor() { return this.#editor; }

  /**
   * Runs on every page load, with no UI.
   *
   * The cached root CSS goes in first and synchronously. It is the part of a theme that
   * needs no knowledge of the page — the custom properties and the canvas — so it can be
   * applied before the document has a body, which is what stops a dark theme flashing
   * white on every load.
   */
  async boot() {
    // A tracking pixel is not worth a design pass.
    if (!this.#isTop && (this.#view.innerWidth < 60 || this.#view.innerHeight < 60)) return;

    this.#settings = await this.#store.settings();
    const site = await this.#store.site(this.#host);
    if (site?.bootCss) this.#injectBoot(site.bootCss);

    this.#monitor.on('structure', this.#onStructure);
    this.#monitor.on('route', this.#onRoute);
    this.#monitor.start();

    if (site?.themeId) {
      await this.#whenReady();
      const theme = await this.#findTheme(site.themeId);
      // A theme the user deleted must not keep haunting the site it was applied to.
      if (theme) this.#applyNow(theme);
      else await this.#store.clearSite(this.#host);
    }
    this.#removeBoot();

    // Hand edits go on after the theme, so that where the two disagree, the thing the
    // user did by hand is the thing they see.
    if (this.#isTop && await this.#edits.count(this.#host)) {
      await this.#whenReady();
      await this.#ensureEditor().reapply();
    }
  }

  /** Opens or closes the panel. Only the top document has one. */
  async toggle() {
    if (!this.#isTop) return false;
    if (this.#panel.visible) { this.close(); return false; }
    await this.open();
    return true;
  }

  async open() {
    if (!this.#isTop) return;
    this.#settings ??= await this.#store.settings();
    this.#panel.mount(await this.#panelState());
  }

  /**
   * Closing the panel also leaves edit mode. The editor is a separate object with its own
   * capture-phase listeners on the document, so unmounting the panel on its own would take
   * the controls away and leave the picker, the resize grips and the overlay still live on
   * a page with nothing on screen to explain them. `exit()` does not revert anything, so
   * the work stays applied — only the editing stops.
   */
  close() {
    // Unmount first: `exit()` emits `change`, and that handler skips a panel that has gone.
    this.#panel.unmount();
    this.#editor?.exit();
    // Panel state outlives the unmount, so a close from the inspector would otherwise
    // reopen onto an inspector wired to an editor that is no longer running.
    this.#panel.setState({ view: 'gallery', menuOpen: false });
  }

  /** Full teardown: panel gone, theme reverted, observers stopped. */
  destroy() {
    for (const timer of this.#timers) clearTimeout(timer);
    this.#timers.clear();
    this.close();
    this.#editor?.destroy();
    this.#editor = null;
    this.#monitor.stop();
    this.#engine.clear();
    this.#removeBoot();
  }

  async handleMessage(message) {
    // Messages go to every frame in the tab. A frame only listens for the one that tells
    // it the page it is embedded in has changed theme; the top document answers the rest.
    if (!this.#isTop) {
      if (message?.type === Msg.SYNC) await this.#sync();
      return { ok: true, frame: true };
    }
    switch (message?.type) {
      case Msg.TOGGLE_PANEL:
        return { ok: true, open: await this.toggle() };
      case Msg.GET_STATUS:
        return {
          ok: true,
          host: this.#host,
          open: this.#panel.visible,
          theme: this.#active ? { id: this.#active.id, name: this.#active.name } : null,
        };
      case Msg.PING:
        return { ok: true };
      default:
        return { ok: false, reason: 'Unknown message.' };
    }
  }

  // ── Applying ───────────────────────────────────────────────────────────

  /**
   * Detects and applies in one synchronous block.
   *
   * Detection has to read the page as the site's authors wrote it, so any theme already
   * applied is removed first. Doing that in the same task as the re-apply means the
   * browser never gets a frame in which to paint the un-themed page — the user sees one
   * change, not a flash of the original.
   */
  #applyNow(theme) {
    return this.#monitor.suspend(() => {
      const tokens = this.#pristineTokens();
      const result = this.#engine.apply(theme, tokens, {
        forceReadable: this.#settings?.forceReadable !== false,
      });
      this.#active = theme;
      this.#schedule();
      return result;
    });
  }

  #pristineTokens() {
    if (this.#tokens) return this.#tokens;
    if (this.#engine.active) this.#engine.clear();
    this.#removeBoot();
    this.#tokens = detectTokens(this.#doc, this.#view);
    return this.#tokens;
  }

  /** Extra passes for sites that finish rendering after load or after a route change. */
  #schedule() {
    for (const delay of SETTLE_PASSES) {
      const timer = setTimeout(() => {
        this.#timers.delete(timer);
        if (this.#active) this.#monitor.suspend(() => this.#engine.restamp());
      }, delay);
      this.#timers.add(timer);
    }
  }

  #onStructure = ({ roots, full }) => {
    // The editor's sheet has to follow new shadow roots even when no theme is applied.
    this.#editor?.syncRoots();
    if (!this.#active) return;
    this.#monitor.suspend(() => {
      if (full || !roots.length) this.#engine.restamp();
      else this.#engine.restampFrom(roots);
    });
  };

  #onRoute = debounce(() => {
    this.#editor?.syncRoots();
    if (!this.#active) return;
    this.#monitor.suspend(() => this.#engine.restamp());
    this.#schedule();
  }, 60);

  async #applyThemeById(id) {
    const theme = await this.#findTheme(id);
    if (!theme) { this.#panel.toast('error', 'That theme is no longer available.'); return; }

    this.#applyNow(theme);
    await this.#store.setSite(this.#host, theme.id, this.#engine.rootCss);
    this.#broadcast();
    this.#panel.setState({ activeId: theme.id, view: 'gallery', menuOpen: false });
    // What the user wants to know is that the thing they clicked took effect. The rule and
    // variable counts were a report on the engine, not an answer to that.
    this.#panel.toast('info', `${theme.name} applied`);
  }

  /**
   * Removes the theme, and only the theme.
   *
   * A theme and a hand edit are two different kinds of change, and which one you want gone
   * is a decision only the user can make — so each has its own control on the tab it
   * belongs to: the theme goes from Themes, the edits go from Edit. Briefly this button
   * took both, which read as tidy and was actually the panel choosing for them.
   */
  async #clearTheme() {
    this.#monitor.suspend(() => this.#engine.clear());
    this.#removeBoot();
    this.#active = null;
    await this.#store.clearSite(this.#host);
    this.#broadcast();
    await this.#refresh({ activeId: null, menuOpen: false });
    const edits = this.#panel.state.editCount ?? 0;
    this.#panel.toast('info', edits
      ? `Theme removed. Your ${edits} change${edits === 1 ? '' : 's'} are still applied.`
      : `${this.#host} is back to normal.`);
  }

  /**
   * Brings this frame in line with what the page is wearing.
   * Only iframes run this: they have no panel of their own, so a theme applied in the top
   * document reaches them as a message rather than as a click.
   */
  async #sync() {
    const site = await this.#store.site(this.#host);
    if (site?.themeId) {
      if (this.#active?.id === site.themeId) return;
      const theme = await this.#findTheme(site.themeId);
      if (theme) this.#applyNow(theme);
      return;
    }
    if (this.#active) {
      this.#monitor.suspend(() => this.#engine.clear());
      this.#active = null;
    }
  }

  /** Tells this tab's iframes to catch up. Routed through the worker, which knows the tab. */
  #broadcast() {
    try {
      globalThis.chrome?.runtime?.sendMessage?.({ __webinBroadcast: true });
    } catch {
      // No worker, no frames to tell.
    }
  }

  async #findTheme(id) {
    return presetById(id) ?? (await this.#store.themes()).find((theme) => theme.id === id) ?? null;
  }

  async #panelState() {
    return {
      host: this.#host,
      themes: [...PRESETS, ...(await this.#store.themes())],
      activeId: this.#active?.id ?? null,
      appearance: this.#settings?.appearance ?? 'light',
      side: this.#settings?.side ?? 'right',
      forceReadable: this.#settings?.forceReadable !== false,
      editor: this.#editorState(),
      editCount: await this.#edits.count(this.#host),
    };
  }

  async #refresh(patch = {}) {
    this.#panel.setState({ ...(await this.#panelState()), ...patch });
  }

  // ── Panel actions ──────────────────────────────────────────────────────

  async #onAction({ action, value }) {
    switch (action) {
      case 'apply': return this.#applyThemeById(value);
      case 'clear': return this.#clearTheme();
      case 'close': return this.close();
      case 'menu': return this.#panel.setState({ menuOpen: !this.#panel.state.menuOpen });
      case 'cancel': return this.#panel.setState({ view: 'gallery', share: null, preview: null, rename: null, menuOpen: false });
      case 'appearance': return this.#toggleAppearance();
      case 'readable': return this.#toggleReadable();
      case 'mode': return this.#setMode(value);
      case 'tool': return this.#setTool(value);
      case 'select-parent': return this.#withEditor((e) => e.selectParent());
      case 'select-child': return this.#withEditor((e) => e.selectChild());
      case 'select-previous': return this.#withEditor((e) => e.selectSibling(-1));
      case 'select-next': return this.#withEditor((e) => e.selectSibling(1));
      case 'hide': return this.#withEditor((e) => e.hide());
      case 'unhide': return this.#withEditor((e) => e.unhide());
      case 'remove': return this.#withEditor((e) => e.remove());
      case 'edit-text': return this.#withEditor((e) => e.editText());
      case 'undo': return this.#withEditor((e) => e.undo());
      case 'redo': return this.#withEditor((e) => e.redo());
      case 'fix-contrast': return this.#fixContrast();
      case 'show-unmatched': return this.#remapNext();
      case 'toggle-section': return this.#toggleSection(value);
      case 'save': return this.#saveEdits();
      case 'revert-prop': return this.#revertProperty(value);
      case 'reset-element': return this.#resetEdits('element');
      case 'reset-page': return this.#resetEdits('page');
      case 'reset-site': return this.#resetEdits('site');
      case 'capture': return this.#capture();
      case 'open-import': return this.#panel.setState({ view: 'import', menuOpen: false });
      case 'import-file': return this.#panel.pickFile();
      case 'background-image': return this.#setBackgroundImage(value);
      case 'apply-element-css': return this.#applyCss('element', value);
      case 'apply-site-css': return this.#applyCss('site', value);
      case 'edit-rule': return this.#editRule(value);
      case 'cancel-rule': return this.#panel.setState({ ruleEdit: null });
      case 'apply-rule-css': return this.#applyRule(value);
      case 'remove-rule': return this.#removeRule(value);
      case 'import-text': return this.#import(this.#panel.importText);
      case 'import-url': return this.#importFromUrl(this.#panel.importUrl);
      case 'confirm-import': return this.#confirmImport();
      case 'import': return this.#import(value);
      case 'rename': return this.#openRename(value);
      case 'save-name': return this.#saveName();
      case 'delete': return this.#delete(value);
      case 'share': return this.#share();
      case 'copy-share': return this.#copyShare();
      case 'export': return this.#export();
      case 'export-all': return this.#exportAll();
      default: return undefined;
    }
  }

  async #toggleAppearance() {
    const appearance = this.#panel.state.appearance === 'dark' ? 'light' : 'dark';
    this.#settings = await this.#store.saveSettings({ appearance });
    this.#panel.setState({ appearance, menuOpen: false });
  }

  // ── The editor ─────────────────────────────────────────────────────────

  /**
   * Builds the editor the first time it is needed.
   *
   * A page wearing only a theme never gets here, so it never pays for the overlay, the
   * picker or their listeners.
   */
  #ensureEditor() {
    if (this.#editor) return this.#editor;
    this.#editor = new Editor({
      doc: this.#doc,
      view: this.#view,
      host: this.#host,
      editStore: this.#edits,
      monitor: this.#monitor,
    });
    this.#editor.on('change', () => {
      if (this.#panel.visible) this.#panel.setState({ editor: this.#editorState() });
    });
    this.#editor.on('notice', ({ tone, message }) => {
      this.#panel.toast(tone === 'warning' ? 'error' : 'info', message);
    });
    return this.#editor;
  }

  #withEditor(fn) {
    if (!this.#editor) return undefined;
    return fn(this.#editor);
  }

  #editorState() {
    return this.#editor ? this.#editor.state() : null;
  }

  /** Switches the panel between the theme gallery and the inspector. */
  async #setMode(value) {
    if (value === 'edit') {
      const editor = this.#ensureEditor();
      editor.enter(EditMode.DESIGN);
      this.#panel.setState({ view: 'edit', menuOpen: false, editor: this.#editorState() });
      return;
    }
    this.#editor?.exit();
    this.#panel.setState({ view: 'gallery', menuOpen: false });
  }

  /**
   * Picks up the arrow or the pencil.
   *
   * Only meaningful inside Edit mode, which is the only place the switch is drawn, so an
   * absent editor here means a stale click and nothing to do.
   */
  /**
   * Applies one of the two written-CSS panes.
   *
   * Whatever parses is applied and whatever does not is listed under the box it came from,
   * rather than announced in a toast that disappears — a message about the third line of
   * what you typed needs to stay on screen next to the third line of what you typed.
   */
  #applyCss(scope, css) {
    this.#withEditor((editor) => {
      const result = scope === 'site' ? editor.applySiteCss(css) : editor.applyElementCss(css);
      const errors = result.errors ?? [];

      // Said in the pane's own header, not in a toast. A toast lands on the button that
      // was just pressed and hides it for three seconds, so the second press hit the
      // toast and did nothing — which read as the apply button being broken.
      let status;
      if (scope === 'site') {
        status = errors.length
          ? `${result.rules} rule${result.rules === 1 ? '' : 's'} applied, ${errors.length} refused`
          : `${result.rules} rule${result.rules === 1 ? '' : 's'} live`;
      } else if (!result.ok) {
        status = errors[0] ?? 'Nothing is selected';
      } else {
        const changed = result.applied + result.removed;
        status = errors.length
          ? `${changed} applied, ${errors.length} refused`
          : `${changed} declaration${changed === 1 ? '' : 's'} applied`;
      }

      this.#panel.setState({
        editor: this.#editorState(),
        codeErrors: { ...(this.#panel.state.codeErrors ?? {}), [scope]: errors },
        codeStatus: { ...(this.#panel.state.codeStatus ?? {}), [scope]: status },
      });
    });
  }

  /**
   * Opens one of the site's rules for editing, in place, in the Styles list.
   *
   * Panel state rather than editor state: which rule is open is about looking, and it is
   * tied to the element it was opened on, so selecting something else closes it without
   * anything having to be told.
   */
  #editRule(key) {
    const id = this.#panel.state.editor?.selection?.id ?? null;
    if (!id || !key) return;
    this.#panel.setState({
      ruleEdit: { key: id, rule: key },
      codeErrors: { ...(this.#panel.state.codeErrors ?? {}), rule: [] },
      codeStatus: { ...(this.#panel.state.codeStatus ?? {}), rule: null },
    });
  }

  /**
   * Writes your version of a site rule. Clean, the rule closes and the list shows the
   * result — yours at the top, the site's beaten line struck through. Anything refused is
   * named under the box and the box stays open, next to the line it is about.
   */
  #applyRule(value) {
    const { selector, media = null, base = {}, css = '' } = value ?? {};
    if (!selector) return;
    this.#withEditor((editor) => {
      const result = editor.applyRuleCss({ selector, media, base }, css);
      const errors = result.errors ?? [];
      const status = errors.length
        ? `${result.written} written, ${errors.length} refused`
        : null;
      this.#panel.setState({
        editor: this.#editorState(),
        ruleEdit: errors.length ? this.#panel.state.ruleEdit : null,
        codeErrors: { ...(this.#panel.state.codeErrors ?? {}), rule: errors },
        codeStatus: { ...(this.#panel.state.codeStatus ?? {}), rule: status },
      });
    });
  }

  /** Takes your version of a rule out again, leaving the site's own in the list. */
  #removeRule(key) {
    const rule = parseRuleKey(key);
    if (!rule) return;
    this.#withEditor((editor) => {
      editor.removeRule(rule);
      const open = this.#panel.state.ruleEdit;
      this.#panel.setState({
        editor: this.#editorState(),
        ruleEdit: open && open.rule === key ? null : open,
      });
    });
  }

  #setTool(value) {
    this.#withEditor((editor) => editor.setTool(value));
    if (this.#panel.state.view === 'edit') this.#panel.setState({ editor: this.#editorState() });
  }

  /**
   * Turns a control event into a style change.
   *
   * The panel reports what the user touched; deciding what that means in CSS is this
   * function's job, and it is the only place that knows the two are different things.
   */
  #onControl({ phase, control, prop, side, value, unit, number, sides }) {
    const editor = this.#editor;
    if (!editor || !prop) return;

    switch (control) {
      case 'number':
        return editor.setProperty(prop, withUnit(value, unit), { phase });
      case 'unit':
        // Changing px to rem is only a change if there is a number to carry over.
        return number === '' || number == null
          ? undefined
          : editor.setProperty(prop, withUnit(number, value), { phase });
      case 'range':
        // The one slider so far is opacity, which is a ratio the user reads as a percentage.
        return editor.setProperty(
          prop,
          prop === 'opacity' ? String(Number(value) / 100) : withUnit(value, 'px'),
          { phase },
        );
      case 'color':
      case 'color-text':
        return editor.setProperty(prop, String(value).trim(), { phase });
      case 'segment':
      case 'select':
      case 'text':
        return editor.setProperty(prop, String(value), { phase: 'commit' });
      case 'box':
        return this.#setBox(prop, side, value, sides);
      case 'link':
        return this.#toggleLink(prop);
      case 'image':
        // The picker is modal and asynchronous; what comes back arrives as an action.
        return this.#panel.pickImage();
      default:
        return undefined;
    }
  }

  /** Padding and margin, either one side at a time or all four together. */
  #setBox(prop, side, value, sides) {
    const linked = this.#panel.state.linked?.[prop] !== false;
    const length = withUnit(value, 'px');
    if (linked) {
      this.#editor.setProperty(prop, length);
      return;
    }
    if (side) {
      this.#editor.setProperty(`${prop}-${side}`, length);
      return;
    }
    for (const [name, sideValue] of Object.entries(sides ?? {})) {
      this.#editor.setProperty(`${prop}-${name}`, withUnit(sideValue, 'px'));
    }
  }

  /**
   * Links or unlinks a box field's four sides.
   *
   * This is panel state, not page state — it changes what the *next* edit means, not what
   * the page looks like — which is why it never reaches the editor or the history stack.
   */
  #toggleLink(prop) {
    const linked = { ...this.#panel.state.linked };
    linked[prop] = linked[prop] === false;
    this.#panel.setState({ linked });
  }

  #toggleSection(id) {
    const sections = { ...this.#panel.state.sections };
    sections[id] = !sections[id];
    this.#panel.setState({ sections });
  }

  /** Takes the contrast warning's advice. */
  #fixContrast() {
    const detail = this.#editor?.state().selection;
    if (!detail) return;
    const backdrop = detail.appearance?.backgroundColor ?? '#ffffff';
    const fixed = ensureReadable(detail.typography?.color ?? '#000000', [backdrop]);
    this.#editor.setProperty('color', fixed);
    this.#panel.toast('info', `Text set to ${fixed}.`);
  }

  /**
   * Offers to re-point a saved change whose element could not be found.
   *
   * The alternative — applying it to whatever scored highest — is how somebody's saved
   * button width ends up on the wrong button, which is worse than not applying it.
   */
  #remapNext() {
    const parked = this.#editor?.unmatched ?? [];
    if (!parked.length) { this.#panel.toast('info', 'Everything you saved was found.'); return; }
    const [next] = parked;
    if (this.#panel.state.view !== 'edit') this.#setMode('edit');
    this.#editor.remap(next.change.id);
    this.#panel.toast('info', `Click the element “${next.change.label || next.change.target.tag}” belongs to.`, 0);
  }

  async #saveEdits() {
    if (!this.#editor) return;
    const { saved, scope } = await this.#editor.save();
    if (saved) await this.#refresh({ view: 'edit' });
    this.#panel.toast('info', saved
      ? `Saved ${saved} change${saved === 1 ? '' : 's'} for ${scope === '*' ? this.#host : scope}.`
      : 'Nothing to save.');
  }

  /**
   * Puts one property back to whatever the site itself says.
   *
   * Undo steps back a gesture at a time, which is the wrong tool for "none of this": after
   * a few adjustments the site's own value is several presses away and nobody is counting
   * them. A shorthand takes its longhands with it, so reverting Padding reverts the side
   * that was set on its own too.
   */
  #revertProperty(prop) {
    const detail = this.#editor?.state().selection;
    if (!detail || !prop) return;
    // One row in the inspector, so one thing to undo. The background row can hold a colour
    // or a picture, and a revert that took the colour away and left the image behind would
    // be a revert that did not revert.
    const family = REVERT_FAMILY[prop] ?? [];
    const properties = Object.keys(detail.overrides ?? {})
      .filter((key) => key === prop || key.startsWith(`${prop}-`) || family.includes(key));
    if (!properties.length) return;
    this.#editor.clearProperties(properties);
    this.#panel.toast('info', `${prop} is back to the site's own value.`);
  }

  /**
   * Puts a picked image behind the selected element, sized to fit it.
   *
   * Several declarations rather than one. `background-image` alone would tile a photo at
   * its natural size across the box, which is almost never what somebody choosing a
   * background meant. How it should be sized is not a constant either — see
   * `backgroundFit`, which is given the picture's shape and the box's and decides between
   * filling the box and showing the whole picture. The colour underneath is left exactly
   * as it was, so it still shows through a transparent PNG and still shows if the image
   * ever fails to paint.
   */
  #setBackgroundImage(image) {
    const url = typeof image === 'string' ? image : image?.url;
    if (!url) return;
    this.#ensureEditor();
    const detail = this.#editor?.state().selection;
    if (!detail) {
      this.#panel.toast('error', 'Select something first, then choose an image for it.');
      return;
    }

    // `tag` is lowercase here, as the model reports it.
    const page = detail.tag === 'body' || detail.tag === 'html';
    const fit = backgroundFit(typeof image === 'string' ? {} : image, detail.layout, {
      page,
      viewport: detail.geometry?.viewport ?? null,
    });
    this.#editor.setProperties({ 'background-image': `url("${url}")`, ...fit }, 'background image');

    // Which way it was sized is worth saying: it is a judgement about the picture, and the
    // person who just chose it is the one who can tell whether it was the right one.
    this.#panel.toast('info', page
      ? 'Image set as the page background, filling the screen.'
      : fit['background-size'] === 'contain'
        ? 'Image set as the background, sized to fit whole.'
        : 'Image set as the background, filling the box.');
  }

  async #resetEdits(scale) {
    // Reachable from the menu without ever entering Edit mode, so the editor may not
    // exist yet — and it has to, because reverting is its job.
    this.#ensureEditor();
    if (scale === 'element') {
      const { removed } = await this.#editor.resetElement();
      this.#panel.toast('info', removed ? 'That element is back to normal.' : 'Nothing to undo here.');
      return;
    }
    const result = scale === 'site'
      ? await this.#editor.resetSite()
      : await this.#editor.resetPage();
    await this.#refresh({ menuOpen: false });
    this.#panel.toast('info', result.remaining
      ? `This page is back to normal. ${result.remaining} change${result.remaining === 1 ? '' : 's'} still apply across the site.`
      : `${this.#host} is back to normal.`);
  }

  /**
   * Turns the readability guarantee on or off.
   *
   * It changes what the page looks like, not just the panel, so the theme is re-applied
   * rather than left until the next visit — a setting whose effect you have to reload to
   * see reads as a setting that did not work.
   */
  async #toggleReadable() {
    const forceReadable = this.#panel.state.forceReadable === false;
    this.#settings = await this.#store.saveSettings({ forceReadable });
    this.#panel.setState({ forceReadable, menuOpen: false });
    if (this.#active) {
      const theme = this.#active;
      const result = this.#applyNow(theme);
      await this.#store.setSite(this.#host, theme.id, this.#engine.rootCss);
      this.#broadcast();
      this.#panel.toast('info', forceReadable
        ? `Readable text is on — ${result.rules} rules applied.`
        : 'Readable text is off. Themes are shown exactly as written.');
      return;
    }
    this.#panel.toast('info', forceReadable
      ? 'Readable text is on.'
      : 'Readable text is off.');
  }

  /**
   * Runs a write to the store, and says so when it did not land.
   *
   * The browser can refuse a write — its storage is full, or the extension was reloaded
   * under this page — and a theme the user has just been told is theirs must not quietly
   * be gone on the next visit. Resolves to `undefined` in that case, after telling them;
   * every caller treats that as "stop here".
   */
  async #persist(work) {
    try {
      return await work();
    } catch (error) {
      if (!(error instanceof StorageError)) throw error;
      this.#panel.toast('error', 'Could not save — the browser refused to store it. Delete a theme you no longer use and try again.');
      return undefined;
    }
  }

  /** Captures the current page's design as a theme of the user's own. */
  async #capture() {
    const tokens = this.#tokens ?? this.#monitor.suspend(() => this.#pristineTokens());
    const theme = themeFromTokens(tokens, titleCase(this.#host));
    if (!(await this.#persist(() => this.#store.saveTheme(theme)))) return;
    await this.#refresh({ menuOpen: false });
    this.#panel.toast('info', `Saved “${theme.name}”. It is yours to use anywhere.`);
  }

  /**
   * Reads pasted or dropped input.
   *
   * A share code and one of our own files are already Webin themes: there is nothing to
   * disclose, so they save straight away as they always have. Anything read out of
   * somebody else's format had roles guessed from names, so it stops at a preview first.
   */
  async #import(text, { name, themeColor = null, origin = null } = {}) {
    const raw = String(text ?? '').trim();
    if (!raw) {
      this.#panel.toast('error', origin
        ? `${origin} has no styling Webin could read.`
        : 'Paste a share code or a theme file first.');
      return;
    }

    const shareCode = isShareCode(raw);
    const decoded = shareCode ? await decodeShareCode(raw) : null;
    if (shareCode && !decoded) {
      this.#panel.toast('error', 'That share code is damaged — ask for it again.');
      return;
    }

    const { themes, error, source, inferred } = parseThemeInput(raw, decoded, {
      name: name ?? titleCase(this.#host),
      themeColor,
    });
    if (error) {
      // A failed paste and a failed website are different problems, and telling someone
      // who typed an address to try pasting a base16 scheme helps nobody.
      this.#panel.toast('error', origin
        ? `Webin could not find a design on ${origin}. Sites that build their page after `
          + 'it loads keep their colours out of reach.'
        : error);
      return;
    }

    if (source !== 'webin') {
      this.#panel.setState({ view: 'preview', preview: { themes, source, inferred }, menuOpen: false });
      return;
    }
    await this.#keep(themes);
  }

  /** Saves themes that have been read and, where necessary, looked at. */
  async #keep(themes) {
    const added = await this.#persist(() => this.#store.importThemes(themes));
    if (!added) return;
    await this.#refresh({ view: 'gallery', preview: null });
    // One theme means they want to see it; a collection means they were restoring.
    if (added.length === 1) await this.#applyThemeById(added[0].id);
    this.#panel.toast('info', added.length === 1
      ? `Imported “${added[0].name}”.`
      : `Imported ${added.length} themes.`);
  }

  async #confirmImport() {
    const themes = this.#panel.state.preview?.themes ?? [];
    if (!themes.length) { this.#panel.setState({ view: 'gallery', preview: null }); return; }
    // A single theme is offered under a name you can type over before it is kept. A
    // collection is not: naming six themes one field at a time is not naming, it is a form.
    const typed = themes.length === 1 ? this.#panel.previewName.trim() : '';
    await this.#keep(typed ? [{ ...themes[0], name: typed }] : themes);
  }

  /**
   * Fetches a theme from an address the user typed.
   *
   * The request is made by the service worker, not from here: a page's own CSP governs
   * what its content script may fetch, and a request issued from the page's context is a
   * request the page can observe. Neither belongs in a feature the user asked Webin for.
   */
  async #importFromUrl(input) {
    const address = String(input ?? '').trim();
    if (!address) { this.#panel.toast('error', 'Type a web address first.'); return; }

    const url = withScheme(address);
    if (!url) { this.#panel.toast('error', 'That does not look like a web address.'); return; }

    this.#panel.toast('info', `Fetching from ${url.host}…`, 0);
    let result;
    try {
      result = await globalThis.chrome?.runtime?.sendMessage?.({ type: Msg.FETCH_THEME, url: url.href });
    } catch {
      result = null;
    }
    if (!result?.ok) {
      this.#panel.toast('error', result?.reason ?? 'Webin could not fetch that address.');
      return;
    }
    // `origin` is passed so a failure can be phrased in terms of the site. Someone who
    // typed an address is not helped by being told to try pasting a base16 scheme.
    await this.#import(result.text, {
      name: titleCase(result.host ?? url.host),
      themeColor: result.themeColor ?? null,
      origin: result.host ?? url.host,
    });
  }

  /**
   * Naming a theme you own.
   *
   * Themes arrive named after wherever they came from — the host for a capture, the file
   * for an import — which is a reasonable guess and rarely the name you want to see in a
   * gallery of your own. Presets are not renameable: they are the extension's, not yours.
   */
  async #openRename(id) {
    const theme = (await this.#store.themes()).find((t) => t.id === id);
    if (!theme) return;
    this.#panel.setState({ view: 'rename', rename: { id, name: theme.name, error: '' }, menuOpen: false });
  }

  async #saveName() {
    const pending = this.#panel.state.rename;
    if (!pending) return;
    const name = this.#panel.renameValue.trim();
    // Kept in state so the field comes back with what they typed, not with the old name.
    if (!name) {
      this.#panel.setState({ rename: { ...pending, name: '', error: 'A theme needs a name.' } });
      return;
    }
    const theme = (await this.#store.themes()).find((t) => t.id === pending.id);
    if (!theme) { this.#panel.setState({ view: 'gallery', rename: null }); return; }

    // Back through the one validator, so a name typed by hand is checked exactly as a name
    // that arrived in a share code would be: capped, and stripped of control characters.
    const renamed = normaliseTheme({ ...theme, name });
    if (!renamed) {
      this.#panel.setState({ rename: { ...pending, name, error: 'That name cannot be used.' } });
      return;
    }
    if (!(await this.#persist(() => this.#store.saveTheme(renamed)))) return;
    // The footer names the applied theme, so it has to hear about this too.
    if (this.#active?.id === renamed.id) this.#active = { ...this.#active, name: renamed.name };
    await this.#refresh({ view: 'gallery', rename: null });
    this.#panel.toast('info', `Now called “${renamed.name}”.`);
  }

  async #delete(id) {
    const themes = await this.#store.themes();
    const theme = themes.find((t) => t.id === id);
    if (!(await this.#persist(() => this.#store.deleteTheme(id)))) return;
    if (this.#active?.id === id) await this.#clearTheme();
    await this.#refresh();
    this.#panel.toast('info', `Deleted “${theme?.name ?? 'theme'}”.`);
  }

  async #share() {
    if (!this.#active) return;
    const code = await encodeShareCode(this.#active);
    this.#panel.setState({ view: 'share', share: { name: this.#active.name, code }, menuOpen: false });
  }

  async #copyShare() {
    const code = this.#panel.state.share?.code;
    if (!code) return;
    try {
      await this.#view.navigator.clipboard.writeText(code);
      this.#panel.toast('info', 'Share code copied. Paste it to a friend.');
    } catch {
      this.#panel.toast('error', 'Copy was blocked — select the code above and copy it.');
    }
  }

  #export() {
    if (!this.#active) return;
    this.#download(themeFileName(this.#active), themeToFile(this.#active));
    this.#panel.setState({ menuOpen: false });
  }

  async #exportAll() {
    const themes = await this.#store.themes();
    if (!themes.length) return;
    this.#download('my-themes.webin.json', collectionToFile(themes));
    this.#panel.setState({ menuOpen: false });
    this.#panel.toast('info', `Backed up ${themes.length} theme${themes.length === 1 ? '' : 's'}.`);
  }

  /**
   * Hands the user a file.
   *
   * The link lives inside the panel's closed shadow root for the moment it exists, not in
   * the page's body: a blob URL is readable by anything on the page's origin, and an
   * anchor appended to the body is one `MutationObserver` away from the page fetching the
   * user's themes before the URL is revoked. Inside the closed root there is nothing for
   * the page to observe, so the URL is never anywhere the page can read it.
   */
  #download(name, payload) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = this.#doc.createElement('a');
    link.href = url;
    link.download = name;
    (this.#panel.shadow ?? this.#doc.documentElement).appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ── Boot CSS ───────────────────────────────────────────────────────────

  #injectBoot(css) {
    if (this.#doc.getElementById(BOOT_STYLE_ID)) return;
    const style = this.#doc.createElement('style');
    style.id = BOOT_STYLE_ID;
    style.setAttribute(OWNED_ATTR, '');
    style.textContent = css;
    // At document_start there is no head yet, and documentElement takes a style fine.
    (this.#doc.head ?? this.#doc.documentElement).appendChild(style);
  }

  #removeBoot() {
    this.#doc.getElementById(BOOT_STYLE_ID)?.remove();
  }

  #whenReady() {
    if (this.#doc.readyState !== 'loading') return Promise.resolve();
    return new Promise((resolve) => {
      this.#doc.addEventListener('DOMContentLoaded', () => resolve(), { once: true });
    });
  }
}

/** Cross-origin frames cannot read `window.top`, so the check has to be defensive. */
function isTopFrame(view) {
  try {
    return view.top === view.self;
  } catch {
    return false;
  }
}

/** The origin of the page this frame is embedded in, deepest ancestor last. */
function topOrigin(view) {
  try {
    const chain = view.location.ancestorOrigins;
    return chain?.length ? chain[chain.length - 1] : null;
  } catch {
    return null;
  }
}

/** `16` + `px` -> `16px`. An empty value, a keyword or an already-suffixed one is left alone. */
function withUnit(value, unit) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (!unit || /[a-z%]$/i.test(raw)) return raw;
  return `${raw}${unit}`;
}

/** Accepts what people actually paste, which is often missing its scheme. */
function withScheme(address) {
  for (const candidate of [address, `https://${address}`]) {
    try {
      const url = new URL(candidate);
      if (url.protocol === 'http:' || url.protocol === 'https:') return url;
    } catch {
      // Try the next form.
    }
  }
  return null;
}

function titleCase(host) {
  const base = host.split('.')[0] ?? host;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function reportError(error) {
  console.warn('[webin]', error);
}
