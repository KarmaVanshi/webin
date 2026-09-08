/**
 * Hover detection and selection (§8, §9, §46).
 *
 * Runs on the capture phase so the page's own handlers never see the pointer while the
 * editor is active — clicking a link to inspect it must not navigate away. Pointer
 * events are only swallowed in Design mode; Inspect mode leaves the page usable.
 */

import { Emitter, rafThrottle } from '../shared/util.js';
import { OWNED_ATTR } from '../shared/types.js';
import { isSelectable } from './model.js';

export class Picker extends Emitter {
  #doc;
  #view;
  #host;
  #active = false;
  #interactive = true;
  #hovered = null;
  #selection = [];
  #onMove;

  /**
   * @param {Element} host The extension's shadow host, so its own chrome is never picked.
   */
  constructor({ doc = document, view = window, host }) {
    super();
    this.#doc = doc;
    this.#view = view;
    this.#host = host;
    this.#onMove = rafThrottle((event) => this.#updateHover(event), view.requestAnimationFrame?.bind(view));
  }

  /** @param {boolean} interactive false in Inspect mode: page clicks still work. */
  start({ interactive = true } = {}) {
    if (this.#active) {
      this.#interactive = interactive;
      return;
    }
    this.#active = true;
    this.#interactive = interactive;
    const opts = { capture: true, passive: false };
    this.#doc.addEventListener('pointermove', this.#handleMove, { capture: true, passive: true });
    this.#doc.addEventListener('pointerdown', this.#handleDown, opts);
    this.#doc.addEventListener('click', this.#handleClick, opts);
    this.#doc.addEventListener('dblclick', this.#handleDoubleClick, opts);
    this.#doc.addEventListener('contextmenu', this.#handleContextMenu, opts);
    this.#view.addEventListener('blur', this.#handleBlur);
  }

  stop() {
    if (!this.#active) return;
    this.#active = false;
    const opts = { capture: true };
    this.#doc.removeEventListener('pointermove', this.#handleMove, opts);
    this.#doc.removeEventListener('pointerdown', this.#handleDown, opts);
    this.#doc.removeEventListener('click', this.#handleClick, opts);
    this.#doc.removeEventListener('dblclick', this.#handleDoubleClick, opts);
    this.#doc.removeEventListener('contextmenu', this.#handleContextMenu, opts);
    this.#view.removeEventListener('blur', this.#handleBlur);
    this.#onMove.cancel();
    this.#hovered = null;
  }

  setInteractive(interactive) {
    this.#interactive = interactive;
  }

  get selection() {
    return [...this.#selection];
  }

  get hovered() {
    return this.#hovered;
  }

  /** Selects programmatically — used by the Layers panel (§25). */
  select(element, { additive = false } = {}) {
    if (!element) {
      this.#selection = [];
    } else if (additive) {
      const index = this.#selection.indexOf(element);
      if (index >= 0) this.#selection.splice(index, 1);
      else this.#selection.unshift(element);
    } else {
      this.#selection = [element];
    }
    this.emit('selection', this.selection);
    return this.selection;
  }

  clear() {
    this.select(null);
  }

  /**
   * Walks up to the parent of the current selection (§25).
   * The natural companion to clicking into a deeply nested node.
   */
  selectParent() {
    const current = this.#selection[0];
    const parent = current?.parentElement;
    if (parent && isSelectable(parent, this.#view)) this.select(parent);
  }

  #handleMove = (event) => {
    if (!this.#active) return;
    this.#onMove(event);
  };

  #handleBlur = () => {
    this.#hovered = null;
    this.emit('hover', null);
  };

  #updateHover(event) {
    const element = this.#resolveTarget(event);
    if (element === this.#hovered) return;
    this.#hovered = element;
    this.emit('hover', element);
  }

  #handleDown = (event) => {
    if (!this.#interactive || !this.#active) return;
    if (this.#isOwn(event.target)) return;
    if (event.button !== 0) return;
    // Claim the gesture before the page can start its own drag or focus behaviour.
    event.stopPropagation();
  };

  #handleClick = (event) => {
    if (!this.#active) return;
    if (this.#isOwn(event.target)) return;
    if (!this.#interactive) return;

    event.preventDefault();
    event.stopPropagation();

    const element = this.#resolveTarget(event);
    if (!element) {
      this.select(null);
      return;
    }
    // Alt-click reaches past a wrapper to the deepest node under the pointer.
    this.select(element, { additive: event.shiftKey });
  };

  #handleDoubleClick = (event) => {
    if (!this.#active || !this.#interactive) return;
    if (this.#isOwn(event.target)) return;
    const element = this.#resolveTarget(event);
    if (!element) return;
    event.preventDefault();
    event.stopPropagation();
    this.emit('activate', element);
  };

  #handleContextMenu = (event) => {
    if (!this.#active || !this.#interactive) return;
    if (this.#isOwn(event.target)) return;
    const element = this.#resolveTarget(event);
    if (!element) return;
    event.preventDefault();
    event.stopPropagation();
    this.emit('context', { element, x: event.clientX, y: event.clientY });
  };

  /** True for anything belonging to the editor's own UI. */
  #isOwn(node) {
    if (!node || node.nodeType !== 1) return false;
    if (this.#host && (node === this.#host || this.#host.contains(node))) return true;
    return Boolean(node.closest?.(`[${OWNED_ATTR}]`));
  }

  /**
   * The most useful selectable node under the pointer (§8).
   *
   * `composedPath` is used first so an element inside an *open* shadow root is reachable;
   * a closed root is a genuine boundary and simply yields its host (§30).
   */
  #resolveTarget(event) {
    const path = event.composedPath?.() ?? [];
    for (const node of path) {
      if (node?.nodeType !== 1) continue;
      if (this.#isOwn(node)) return null;
      if (isSelectable(node, this.#view)) return this.#preferMeaningful(node, event);
    }
    // composedPath covers every real event; elementFromPoint is the fallback for
    // synthesised ones, and is not implemented by every document type.
    const fallback = this.#doc.elementFromPoint?.(event.clientX, event.clientY);
    if (!fallback || this.#isOwn(fallback)) return null;
    return isSelectable(fallback, this.#view) ? this.#preferMeaningful(fallback, event) : null;
  }

  /**
   * Prefers the node a person would say they clicked on.
   *
   * Clicking the label inside a button means the button, not the span — unless Alt is
   * held, which is the escape hatch for reaching the exact node.
   */
  #preferMeaningful(element, event) {
    if (event?.altKey) return element;
    const tag = element.tagName.toLowerCase();
    if (!['span', 'em', 'strong', 'b', 'i', 'small', 'path', 'svg', 'tspan'].includes(tag)) return element;

    let node = element;
    let depth = 0;
    while (node?.parentElement && depth < 4) {
      const parent = node.parentElement;
      const parentTag = parent.tagName.toLowerCase();
      if (['button', 'a', 'label', 'summary', 'li'].includes(parentTag)) return parent;
      if (parentTag === 'svg') return parent;
      node = parent;
      depth += 1;
    }
    return element;
  }
}
