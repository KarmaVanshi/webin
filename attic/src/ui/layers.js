/**
 * Layers panel (§25, §26, §72).
 *
 * Renders the design tree, not the raw DOM — pass-through wrappers are folded away by
 * `tree.js` so the list reads like the page looks.
 *
 * Children are resolved only for expanded branches. On a page with thousands of nodes
 * the panel costs what the user has opened, not what the document contains (§72).
 */

import { buildLevel, ancestryOf } from '../content/element-model/tree.js';
import { escapeHtml, truncate } from '../shared/util.js';
import { icon } from './icons.js';
import { emptyState } from './controls.js';
import { WID_ATTR } from '../shared/types.js';

export class LayersPanel {
  #view;
  #root;
  /** @type {Set<Element>} */
  #expanded = new Set();
  /** @type {WeakMap<Element,string>} */
  #keys = new WeakMap();
  #keySeq = 0;
  /** @type {Map<string,Element>} */
  #byKey = new Map();

  constructor({ view = window, root }) {
    this.#view = view;
    this.#root = root;
  }

  /** Opens every ancestor of `element` so the selection is visible (§25). */
  reveal(element, root) {
    for (const node of ancestryOf(element, root, this.#view)) {
      if (node !== element) this.#expanded.add(node);
    }
  }

  toggle(key) {
    const element = this.#byKey.get(key);
    if (!element) return;
    if (this.#expanded.has(element)) this.#expanded.delete(element);
    else this.#expanded.add(element);
  }

  elementFor(key) {
    return this.#byKey.get(key) ?? null;
  }

  collapseAll() {
    this.#expanded.clear();
  }

  /** Drops references to elements that have left the document (§73). */
  prune() {
    for (const element of [...this.#expanded]) if (!element.isConnected) this.#expanded.delete(element);
    for (const [key, element] of [...this.#byKey]) if (!element.isConnected) this.#byKey.delete(key);
  }

  render({ root, selection, hovered }) {
    this.prune();
    this.#byKey.clear();
    if (!root) {
      this.#root.innerHTML = emptyState({ iconName: 'layers', title: 'Nothing to show', body: 'This page has no inspectable content yet.' });
      return;
    }
    const selected = new Set(selection);
    const rows = this.#renderLevel(root, 0, selected, hovered);
    this.#root.innerHTML = `<div class="widt-tree" role="tree" aria-label="Page layers">${rows}</div>`;
  }

  #renderLevel(parent, depth, selected, hovered) {
    if (depth > 24) return '';
    return buildLevel(parent, this.#view)
      .map((node) => this.#renderRow(node, depth, selected, hovered))
      .join('');
  }

  #renderRow(node, depth, selected, hovered) {
    const { element, label, expandable, selectable } = node;
    const key = this.#keyFor(element);
    this.#byKey.set(key, element);

    const open = this.#expanded.has(element);
    const isSelected = selected.has(element);
    const overridden = element.hasAttribute?.(WID_ATTR);
    const hidden = !node.selectable;

    const twist = expandable
      ? `<button type="button" class="widt-tree-twist${open ? ' is-open' : ''}" data-interactive
          data-action="toggle-layer" data-value="${key}" tabindex="-1"
          aria-label="${open ? 'Collapse' : 'Expand'} ${escapeHtml(label)}">${icon('chevron', 10)}</button>`
      : '<span class="widt-tree-twist" aria-hidden="true"></span>';

    const row = `
<div role="treeitem" aria-level="${depth + 1}" aria-selected="${isSelected}"
  ${expandable ? `aria-expanded="${open}"` : ''}>
  <button type="button"
    class="widt-tree-row${isSelected ? ' is-selected' : ''}${element === hovered ? ' is-hovered' : ''}${hidden ? ' is-hidden' : ''}"
    data-interactive data-action="select-layer" data-value="${key}"
    style="padding-left:${depth * 11 + 4}px" ${selectable ? '' : 'aria-disabled="true"'}>
    ${twist}
    <span class="widt-tree-label">${escapeHtml(truncate(label, 40))}</span>
    ${overridden ? '<span class="widt-tree-badge" title="Has your changes"></span>' : ''}
  </button>
  ${open ? `<div role="group">${this.#renderLevel(element, depth + 1, selected, hovered)}</div>` : ''}
</div>`;
    return row;
  }

  #keyFor(element) {
    let key = this.#keys.get(element);
    if (!key) {
      this.#keySeq += 1;
      key = `l${this.#keySeq}`;
      this.#keys.set(element, key);
    }
    return key;
  }
}
