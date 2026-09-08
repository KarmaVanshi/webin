/**
 * Direct text editing (§18).
 *
 * `contenteditable` is turned on for the duration of the edit and removed afterwards, so
 * the attribute never persists on the page. Only elements holding a single text node are
 * eligible — anything else would risk destroying child elements (see `singleTextNode`).
 */

import { Emitter, normaliseText } from '../shared/util.js';
import { singleTextNode } from './overrides.js';

export class TextEditor extends Emitter {
  #view;
  #session = null;

  constructor({ view = window } = {}) {
    super();
    this.#view = view;
  }

  get active() {
    return this.#session !== null;
  }

  get element() {
    return this.#session?.element ?? null;
  }

  /** True when this element's text can be edited safely. */
  canEdit(element) {
    return Boolean(element && singleTextNode(element));
  }

  /**
   * Enters edit mode on an element.
   * @returns {boolean} false when the element's content is structured.
   */
  begin(element) {
    if (this.#session) this.commit();
    const node = singleTextNode(element);
    if (!node) {
      this.emit('refused', { element, reason: 'This element contains more than plain text.' });
      return false;
    }

    const original = node.nodeValue;
    const priorEditable = element.getAttribute('contenteditable');
    const priorSpellcheck = element.getAttribute('spellcheck');

    element.setAttribute('contenteditable', 'plaintext-only');
    element.setAttribute('spellcheck', 'false');
    this.#session = { element, node, original, priorEditable, priorSpellcheck };

    element.addEventListener('keydown', this.#onKey, true);
    element.addEventListener('blur', this.#onBlur, true);
    element.addEventListener('paste', this.#onPaste, true);

    element.focus({ preventScroll: true });
    selectAll(element, this.#view);
    this.emit('begin', { element, text: original });
    return true;
  }

  /** Commits the edit and emits the before/after pair for history and persistence. */
  commit() {
    const session = this.#session;
    if (!session) return null;
    this.#teardown();

    const text = normaliseText(session.element.textContent);
    // Restore the node reference: contenteditable may have replaced the text node.
    session.element.textContent = text;

    if (text === normaliseText(session.original)) {
      this.emit('cancel', { element: session.element });
      return null;
    }
    const result = { element: session.element, before: session.original, after: text };
    this.emit('commit', result);
    return result;
  }

  /** Abandons the edit, restoring the original text. */
  cancel() {
    const session = this.#session;
    if (!session) return;
    this.#teardown();
    session.element.textContent = session.original;
    this.emit('cancel', { element: session.element });
  }

  #teardown() {
    const { element, priorEditable, priorSpellcheck } = this.#session;
    element.removeEventListener('keydown', this.#onKey, true);
    element.removeEventListener('blur', this.#onBlur, true);
    element.removeEventListener('paste', this.#onPaste, true);

    if (priorEditable == null) element.removeAttribute('contenteditable');
    else element.setAttribute('contenteditable', priorEditable);
    if (priorSpellcheck == null) element.removeAttribute('spellcheck');
    else element.setAttribute('spellcheck', priorSpellcheck);

    element.blur?.();
    this.#session = null;
  }

  #onKey = (event) => {
    event.stopPropagation();
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.cancel();
    }
  };

  #onBlur = () => {
    if (this.#session) this.commit();
  };

  /** Paste is forced to plain text — pasted markup must never enter the page (§74). */
  #onPaste = (event) => {
    event.preventDefault();
    const text = event.clipboardData?.getData('text/plain') ?? '';
    this.#view.document.execCommand?.('insertText', false, normaliseText(text));
  };
}

function selectAll(element, view) {
  const range = view.document.createRange();
  range.selectNodeContents(element);
  const selection = view.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}
