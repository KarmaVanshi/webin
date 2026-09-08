/**
 * The Override Engine (§33).
 *
 * Converts a user's change into the smallest safe modification of the live page, across
 * five levels: CSS, attributes, text, hide, and local removal. Every level is
 * reversible — `revert` must restore the page to exactly what the site rendered, because
 * that promise is what makes the whole product non-destructive (§133).
 */

import { OpKind, Breakpoint, WID_ATTR, OWNED_ATTR } from '../shared/types.js';
import { OverrideStylesheet, ensureWid, clearWid } from './override-sheet.js';
import { requiredStrength } from './cascade.js';
import { normaliseText } from '../shared/util.js';

/** Attributes the user may edit. Anything that can execute or navigate is excluded (§74). */
export const EDITABLE_ATTRS = new Set([
  'aria-label', 'aria-hidden', 'title', 'alt', 'placeholder', 'role', 'href', 'target', 'rel', 'lang',
]);

/** Values that would turn an edited attribute into script execution. */
function isSafeAttrValue(name, value) {
  if (value == null) return true;
  const v = String(value);
  if (v.length > 2048) return false;
  if (/[\x00-\x1F\x7F]/.test(v)) return false;
  if (name === 'href' || name === 'target' || name === 'rel') {
    return !/^\s*(javascript|data|vbscript):/i.test(v);
  }
  return true;
}

export class OverrideEngine {
  #doc;
  #view;
  #stylesheet;
  /** Original state per element, so revert is exact rather than approximate. */
  #originals = new WeakMap();
  /** Elements currently removed from the DOM, with the comment marking their slot. */
  #removed = new Map();
  /** Every element this engine has touched, so `revertAll` can find them again. */
  #touched = new Set();

  constructor({ doc = document, view = window } = {}) {
    this.#doc = doc;
    this.#view = view;
    this.#stylesheet = new OverrideStylesheet(doc);
  }

  mount() {
    this.#stylesheet.mount();
  }

  get stylesheet() {
    return this.#stylesheet;
  }

  /** Re-asserts the stylesheet after page scripts mutate the head (§29). */
  ensureIntact() {
    return this.#stylesheet.ensureMounted();
  }

  /**
   * Applies one change to one element.
   * @returns {{ok:boolean, applied?:string[], rejected?:Array, reason?:string}}
   */
  apply(element, change) {
    if (!element || element.nodeType !== 1) return { ok: false, reason: 'No element to apply to.' };
    if (element.hasAttribute(OWNED_ATTR)) return { ok: false, reason: 'Cannot edit the editor itself.' };

    switch (change.kind) {
      case OpKind.STYLE: return this.#applyStyle(element, change);
      case OpKind.ATTRIBUTE: return this.#applyAttributes(element, change);
      case OpKind.TEXT: return this.#applyText(element, change);
      case OpKind.HIDE: return this.#applyHide(element);
      case OpKind.REMOVE: return this.#applyRemove(element);
      default: return { ok: false, reason: `Unknown change kind "${change.kind}".` };
    }
  }

  /** Level 1 — CSS (§33). */
  #applyStyle(element, change) {
    const wid = ensureWid(element);
    this.#touched.add(element);
    const breakpoint = change.breakpoint ?? Breakpoint.ALL;

    // Decide `!important` per property, not per rule: pushing harder than necessary is
    // exactly what makes an override engine hard to reason about later (§52).
    const applied = [];
    const rejected = [];
    for (const [property, value] of Object.entries(change.properties ?? {})) {
      const strength = value == null
        ? { important: false }
        : safely(() => requiredStrength(element, property, this.#view), { important: true });
      const result = this.#stylesheet.set(wid, { [property]: value }, { breakpoint, important: strength.important });
      applied.push(...result.applied);
      rejected.push(...result.rejected);
    }
    return { ok: rejected.length === 0, applied, rejected };
  }

  /** Level 2 — attributes (§33). */
  #applyAttributes(element, change) {
    const original = this.#originalFor(element);
    const applied = [];
    const rejected = [];

    for (const [name, value] of Object.entries(change.attributes ?? {})) {
      const attr = name.toLowerCase();
      if (!EDITABLE_ATTRS.has(attr)) {
        rejected.push({ property: attr, reason: `"${attr}" is not an editable attribute.` });
        continue;
      }
      if (!isSafeAttrValue(attr, value)) {
        rejected.push({ property: attr, reason: 'Value is not allowed for this attribute.' });
        continue;
      }
      if (!Object.hasOwn(original.attributes, attr)) {
        original.attributes[attr] = element.getAttribute(attr);
      }
      if (value == null) element.removeAttribute(attr);
      else element.setAttribute(attr, String(value));
      applied.push(attr);
    }
    this.#touched.add(element);
    return { ok: rejected.length === 0, applied, rejected };
  }

  /**
   * Level 3 — text (§18, §33).
   *
   * Only the first text node is rewritten, and only when the element's text is a single
   * node. Rewriting `textContent` would destroy child elements, which would be a
   * structural edit dressed up as a text edit.
   */
  #applyText(element, change) {
    const target = singleTextNode(element);
    if (!target) return { ok: false, reason: 'This element does not contain a single editable text node.' };

    const original = this.#originalFor(element);
    if (original.text == null) original.text = target.nodeValue;
    target.nodeValue = String(change.text ?? '');
    this.#touched.add(element);
    return { ok: true, applied: ['text'] };
  }

  /** Level 4a — hide, reversibly, leaving the DOM intact (§23). */
  #applyHide(element) {
    const wid = ensureWid(element);
    this.#touched.add(element);
    this.#stylesheet.set(wid, { display: 'none' }, { important: true });
    return { ok: true, applied: ['display'] };
  }

  /**
   * Level 4b — local removal (§24).
   *
   * A comment node marks the slot, so the element goes back exactly where it was even if
   * siblings changed around it.
   */
  #applyRemove(element) {
    if (this.#removed.has(element)) return { ok: true, applied: ['remove'] };
    const marker = this.#doc.createComment(' web-interface-devtools: element removed ');
    element.parentNode?.replaceChild(marker, element);
    this.#removed.set(element, marker);
    this.#touched.add(element);
    return { ok: true, applied: ['remove'] };
  }

  /** Puts a locally removed element back (§24). */
  restore(element) {
    const marker = this.#removed.get(element);
    if (!marker) return false;
    marker.parentNode?.replaceChild(element, marker);
    this.#removed.delete(element);
    return true;
  }

  /** True when the element is currently removed from the page. */
  isRemoved(element) {
    return this.#removed.has(element);
  }

  /** Reverts one element to what the site rendered, across every level (§44). */
  revert(element) {
    if (!element) return false;
    this.restore(element);

    const wid = element.getAttribute?.(WID_ATTR);
    if (wid) {
      for (const breakpoint of Object.values(Breakpoint)) this.#stylesheet.remove(wid, null, breakpoint);
      clearWid(element);
    }

    const original = this.#originals.get(element);
    if (original) {
      for (const [name, value] of Object.entries(original.attributes)) {
        if (value == null) element.removeAttribute(name);
        else element.setAttribute(name, value);
      }
      if (original.text != null) {
        const node = singleTextNode(element);
        if (node) node.nodeValue = original.text;
      }
      this.#originals.delete(element);
    }
    this.#touched.delete(element);
    return true;
  }

  /** Reverts every element this engine has touched (§44). */
  revertAll() {
    for (const element of [...this.#touched]) this.revert(element);
    for (const element of [...this.#removed.keys()]) this.restore(element);
    this.#stylesheet.clear();
    this.#stylesheet.flush();
    // Any stragglers stamped before a reload still carry the attribute.
    for (const node of this.#doc.querySelectorAll(`[${WID_ATTR}]`)) clearWid(node);
    this.#touched.clear();
  }

  /** Removes the stylesheet and every mark. Used when the editor is switched off. */
  teardown() {
    this.revertAll();
    this.#stylesheet.unmount();
  }

  /** Current override values for an element, keyed by breakpoint. */
  overridesFor(element) {
    const wid = element?.getAttribute?.(WID_ATTR);
    return wid ? this.#stylesheet.get(wid) : {};
  }

  /** The override value of a single property, or null. */
  overrideValue(element, property, breakpoint = Breakpoint.ALL) {
    const wid = element?.getAttribute?.(WID_ATTR);
    return wid ? this.#stylesheet.valueOf(wid, property, breakpoint) : null;
  }

  #originalFor(element) {
    let original = this.#originals.get(element);
    if (!original) {
      original = { attributes: {}, text: null };
      this.#originals.set(element, original);
    }
    return original;
  }
}

/** The single text node of an element, or null when its content is structured. */
export function singleTextNode(element) {
  const children = [...element.childNodes];
  const texts = children.filter((n) => n.nodeType === 3 && normaliseText(n.nodeValue));
  const elements = children.filter((n) => n.nodeType === 1);
  if (texts.length === 1 && elements.length === 0) return texts[0];
  return null;
}

/** Runs a cascade query that may throw on an exotic page, with a safe default. */
function safely(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
