/**
 * Direct text editing (§18).
 *
 * `contenteditable` is turned on for the duration of the edit and removed afterwards, so
 * the attribute never persists on the page. Only elements that say exactly one thing are
 * eligible — anything else would risk destroying structure the user did not mean to touch
 * (see `singleTextNode`).
 *
 * The edit is anchored on the text node, not on the element. Those are usually the same
 * thing for a paragraph and almost never the same thing for a link: the words of
 * `<li><a>Home</a></li>` live two levels down, and `<a><svg/>Download</a>` keeps its icon
 * as a sibling of the words. So `contenteditable` goes on the element that directly holds
 * the text, only the text run is selected, and the result is written back into that node —
 * which is what lets the text inside a link be edited without the link, its wrapper or its
 * icon being flattened away.
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

  /** The element `contenteditable` is actually on — the text's own parent. */
  get host() {
    return this.#session?.host ?? null;
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

    // The words may belong to a descendant. Editing there keeps the caret inside the run
    // the user aimed at and puts the wrapper, and anything beside it, out of reach.
    const parent = node.parentElement ?? element;
    const original = node.nodeValue;

    // When anything else shares that parent — the icon in `<a><svg/>Download</a>` — the
    // text gets a host of its own for the length of the edit. Chrome deletes the whole
    // editing host when a replacement covers all of its text, so without this the first
    // keystroke takes the icon with it. Verified in Chromium, not guessed at: the same
    // keystroke into a host holding only the words leaves its siblings alone.
    const wrapper = parent.childNodes.length > 1
      ? wrap(node, parent)
      : null;
    const host = wrapper ?? parent;

    const priorEditable = host.getAttribute('contenteditable');
    const priorSpellcheck = host.getAttribute('spellcheck');

    host.setAttribute('contenteditable', 'plaintext-only');
    host.setAttribute('spellcheck', 'false');
    this.#session = {
      element,
      host,
      wrapper,
      node,
      original,
      priorEditable,
      priorSpellcheck,
      // What was already inside the host. Anything else found there afterwards was put
      // there by the browser during the edit, and does not belong to the page.
      kept: new Set(host.querySelectorAll('*')),
    };

    host.addEventListener('keydown', this.#onKey, true);
    host.addEventListener('blur', this.#onBlur, true);
    host.addEventListener('paste', this.#onPaste, true);

    host.focus({ preventScroll: true });
    selectText(node, this.#view);
    this.emit('begin', { element, text: original });
    return true;
  }

  /** Commits the edit and emits the before/after pair for history and persistence. */
  commit() {
    const session = this.#session;
    if (!session) return null;
    this.#teardown();

    const text = normaliseText(readText(session.host));
    // contenteditable may have split, merged or replaced the text node; settle the host
    // back to exactly the shape it had, holding the new words.
    const node = settle(session, text);
    if (node) session.node = node;

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
    settle(session, session.original);
    this.emit('cancel', { element: session.element });
  }

  #teardown() {
    const { host, priorEditable, priorSpellcheck } = this.#session;
    host.removeEventListener('keydown', this.#onKey, true);
    host.removeEventListener('blur', this.#onBlur, true);
    host.removeEventListener('paste', this.#onPaste, true);

    if (priorEditable == null) host.removeAttribute('contenteditable');
    else host.setAttribute('contenteditable', priorEditable);
    if (priorSpellcheck == null) host.removeAttribute('spellcheck');
    else host.setAttribute('spellcheck', priorSpellcheck);

    host.blur?.();
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

/** Every text node under a node, in document order. */
function textNodesIn(root) {
  const found = [];
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) found.push(child);
      else if (child.nodeType === 1) walk(child);
    }
  };
  walk(root);
  return found;
}

/** What the host currently says. */
function readText(host) {
  return textNodesIn(host).map((node) => node.nodeValue).join('');
}

/**
 * Puts the host back the way it was, holding `text`.
 *
 * An editing session can leave more behind than the words: a stray `<br>` from a shifted
 * return, a text node split in two by an insertion. Whatever it left, the host ends up
 * with the nodes it started with plus one text node — so the page's own structure comes
 * through the edit untouched, and the change that gets recorded is only the change to the
 * words.
 */
function settle(session, text) {
  const { host, kept, wrapper } = session;
  for (const node of [...host.querySelectorAll('*')]) {
    if (!kept.has(node)) node.remove();
  }

  const nodes = textNodesIn(host);
  let target = nodes.includes(session.node) ? session.node : nodes[0];
  if (target) {
    for (const node of nodes) if (node !== target) node.remove();
    target.nodeValue = text;
  } else {
    target = host.ownerDocument.createTextNode(text);
    host.appendChild(target);
  }

  // The borrowed host goes away again, leaving the page's own markup as it was found.
  if (wrapper) wrapper.parentNode?.replaceChild(target, wrapper);
  return target;
}

/** Gives a text node a host of its own, in the place it already occupies. */
function wrap(node, parent) {
  const wrapper = parent.ownerDocument.createElement('span');
  parent.replaceChild(wrapper, node);
  wrapper.appendChild(node);
  return wrapper;
}

/** Selects the text run itself, so typing replaces the words and nothing beside them. */
function selectText(node, view) {
  const range = view.document.createRange();
  range.selectNodeContents(node);
  const selection = view.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}
