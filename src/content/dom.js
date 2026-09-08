/**
 * One tree walk, shared by detection and stamping.
 *
 * Both passes need exactly the same traversal rules — descend into open shadow roots,
 * never touch the extension's own nodes, never touch media — so they share one walker
 * rather than two that drift apart. The visitor returns the context its children inherit,
 * which is what lets the engine track "the nearest painted background is the accent"
 * without a second pass.
 */

import { OWNED_ATTR, UNTOUCHABLE } from '../shared/types.js';

const SKIP_TAGS = new Set(UNTOUCHABLE);

/** Returned by a visitor to skip an element's subtree. */
export const SKIP = Symbol('skip');

/**
 * Depth-first walk of `root`, entering open shadow roots.
 *
 * @param {Node} root Document, Element or ShadowRoot to start from.
 * @param {(element:Element, context:any) => any} visit
 * @param {{limit?:number, context?:any}} options
 * @returns {number} how many elements were visited.
 */
export function walkTree(root, visit, { limit = 5000, context = null } = {}) {
  const start = root?.documentElement ?? root;
  if (!start) return 0;

  const stack = [[start, context]];
  let seen = 0;

  while (stack.length && seen < limit) {
    const [node, parentContext] = stack.pop();
    if (!node || node.nodeType !== 1) continue;

    const tag = node.tagName?.toLowerCase?.();
    if (!tag || SKIP_TAGS.has(tag)) continue;
    if (node.hasAttribute?.(OWNED_ATTR)) continue;

    seen += 1;
    const childContext = visit(node, parentContext);
    if (childContext === SKIP) continue;

    // A component's shadow tree is part of the page as far as the user is concerned, and
    // it inherits from its host — so it inherits the walk's context too.
    const shadow = openShadow(node);
    if (shadow) pushChildren(stack, shadow, childContext);
    pushChildren(stack, node, childContext);
  }
  return seen;
}

function pushChildren(stack, parent, context) {
  const children = parent.children;
  if (!children) return;
  for (let i = children.length - 1; i >= 0; i -= 1) stack.push([children[i], context]);
}

/** A closed shadow root is invisible to us by design; only open roots come back. */
function openShadow(element) {
  try {
    return element.shadowRoot ?? null;
  } catch {
    return null;
  }
}

/**
 * Every open shadow root in the tree, so a stylesheet can be adopted into each one.
 * Capped: a page that builds ten thousand shadow roots is a page where the variable
 * remap is doing the work anyway.
 */
export function collectShadowRoots(root = document, limit = 4000) {
  const roots = [];
  walkTree(root, (element) => {
    const shadow = openShadow(element);
    if (shadow) roots.push(shadow);
    return null;
  }, { limit });
  return roots;
}
