/**
 * The design tree (§25, §26, §88).
 *
 * The raw DOM is technically accurate and visually useless — `div > div > span > div` is
 * not a structure anyone recognises. This module builds the tree the Layers panel shows:
 * the same elements, but with pass-through wrappers folded away so what remains reads
 * like the page looks.
 *
 * Children are resolved lazily, one level at a time, so a page with thousands of nodes
 * costs only what the user has actually expanded (§72).
 */

import { isSelectable, labelFor } from './model.js';
import { OWNED_ATTR } from '../../shared/types.js';

/** Tags that never appear in the design tree. */
const SKIP_TAGS = new Set(['script', 'style', 'link', 'meta', 'noscript', 'template', 'br', 'head', 'title']);

/**
 * A wrapper is a single-child element that adds no visible identity of its own.
 * Folding these away is what turns DOM noise into a readable outline (§26).
 */
export function isPassThroughWrapper(element, view = window) {
  if (element.children.length !== 1) return false;
  if (element.id) return false;
  const tag = element.tagName.toLowerCase();
  if (!['div', 'span', 'section'].includes(tag)) return false;
  // Text of its own means it is not merely a container.
  if ([...element.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim())) return false;

  const style = view.getComputedStyle(element);
  // An engine that does not resolve a property returns an empty string; treat that as
  // "not set" rather than as a value, so a missing report never keeps a wrapper alive.
  const unset = (v) => !v || v === 'none' || v === 'auto';
  const px = (v) => Number.parseFloat(v) || 0;

  // A wrapper that paints, spaces or positions is doing visible work — keep it.
  if (!unset(style.backgroundImage)) return false;
  if (px(style.borderTopWidth) || px(style.borderRightWidth)) return false;
  if (px(style.borderBottomWidth) || px(style.borderLeftWidth)) return false;
  if (px(style.paddingTop) || px(style.paddingRight)) return false;
  if (px(style.paddingBottom) || px(style.paddingLeft)) return false;
  if (style.position && style.position !== 'static' && style.position !== 'relative') return false;
  if (style.display && (style.display.includes('grid') || style.display.includes('flex'))) return false;
  if (!isTransparent(style.backgroundColor)) return false;
  return true;
}

/** True for an unset, `transparent`, or fully transparent computed background. */
function isTransparent(value) {
  if (!value || value === 'transparent') return true;
  const match = value.replace(/\s+/g, '').match(/^rgba\(\d+,\d+,\d+,(0|0?\.0+)\)$/);
  return Boolean(match);
}

/** Direct children that belong in the tree, with pass-through wrappers folded away. */
export function treeChildren(element, view = window, { fold = true } = {}) {
  const out = [];
  for (const child of element.children) {
    if (SKIP_TAGS.has(child.tagName.toLowerCase())) continue;
    if (child.hasAttribute?.(OWNED_ATTR)) continue;
    out.push(fold ? unwrap(child, view) : child);
  }
  return out;
}

/** Descends through pass-through wrappers to the first element that carries meaning. */
export function unwrap(element, view = window, limit = 6) {
  let node = element;
  let depth = 0;
  while (depth < limit && isPassThroughWrapper(node, view)) {
    const only = node.children[0];
    if (!only || SKIP_TAGS.has(only.tagName.toLowerCase())) break;
    node = only;
    depth += 1;
  }
  return node;
}

/**
 * One level of the tree, ready to render.
 * @returns {Array<{element:Element, label:string, tag:string, expandable:boolean, selectable:boolean}>}
 */
export function buildLevel(element, view = window, { fold = true } = {}) {
  return treeChildren(element, view, { fold }).map((child) => ({
    element: child,
    label: labelFor(child),
    tag: child.tagName.toLowerCase(),
    expandable: treeChildren(child, view, { fold }).length > 0,
    selectable: isSelectable(child, view),
  }));
}

/**
 * The chain from the document root down to `element`, so selecting on the page can
 * reveal and highlight the matching node in the Layers panel (§25).
 */
export function ancestryOf(element, root, view = window) {
  const chain = [];
  let node = element;
  while (node && node !== root && node.nodeType === 1) {
    chain.unshift(node);
    node = node.parentElement;
  }
  if (root) chain.unshift(root);
  return chain;
}

/**
 * A high-level outline of the page (§88) — the landmark structure, not every node.
 * Used by the Layers panel's "Outline" view to orient the user before they edit.
 */
export function pageOutline(root, view = window, { maxDepth = 3 } = {}) {
  const outline = [];
  const walk = (element, depth) => {
    if (depth > maxDepth) return;
    for (const child of treeChildren(element, view)) {
      if (!isSelectable(child, view)) continue;
      const rect = child.getBoundingClientRect();
      // Only structural blocks earn a line in the outline.
      if (rect.height < 40 && depth > 0) continue;
      outline.push({ element: child, label: labelFor(child), depth, height: Math.round(rect.height) });
      walk(child, depth + 1);
    }
  };
  walk(root, 0);
  return outline;
}

/**
 * Structurally similar siblings — the rule-based repeated-component detector (§48, §89).
 * Deliberately not AI: it compares tag, class signature, child shape and size.
 */
export function findSimilar(element, view = window, { limit = 60 } = {}) {
  const parent = element.parentElement;
  if (!parent) return [];
  const signature = structureSignature(element);
  const rect = element.getBoundingClientRect();

  return [...parent.children]
    .filter((sibling) => sibling !== element)
    .filter((sibling) => structureSignature(sibling) === signature)
    .filter((sibling) => {
      const r = sibling.getBoundingClientRect();
      const wide = Math.abs(r.width - rect.width) <= Math.max(8, rect.width * 0.15);
      const tall = Math.abs(r.height - rect.height) <= Math.max(8, rect.height * 0.25);
      return wide && tall;
    })
    .slice(0, limit);
}

/** Tag + stable-ish class set + immediate child tags — enough to recognise a repeated card. */
export function structureSignature(element) {
  const classes = [...(element.classList ?? [])]
    .filter((c) => c.length <= 30)
    .sort()
    .join('.');
  const childTags = [...element.children].map((c) => c.tagName.toLowerCase()).join(',');
  return `${element.tagName.toLowerCase()}|${classes}|${childTags}`;
}
