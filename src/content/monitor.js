/**
 * Watching the page change under us.
 *
 * Modern sites rewrite themselves constantly, so "apply the theme once at load" is not
 * enough: a YouTube feed appends a hundred cards as you scroll, and a route change swaps
 * the entire body without a navigation the browser knows about.
 *
 * The hard requirement is that watching must be cheap. The observer reports *that*
 * something relevant changed, debounced, rather than handing every record upward; and it
 * ignores the extension's own writes, so stamping cannot trigger another stamp.
 */

import { Emitter, debounce } from '../shared/util.js';
import { OWNED_ATTR, TOKEN_ATTR } from '../shared/types.js';

export class MutationMonitor extends Emitter {
  #doc;
  #view;
  #observer = null;
  #router = null;
  #suspended = 0;
  #notify;
  /** Elements inserted since the last flush, so only new work gets re-stamped. */
  #added = new Set();
  #overflowed = false;

  constructor({ doc = document, view = window, settle = 220, maxRoots = 300 } = {}) {
    super();
    this.#doc = doc;
    this.#view = view;
    this.maxRoots = maxRoots;
    // Structure changes arrive in bursts; a debounce turns a render storm into one pass.
    this.#notify = debounce(() => this.#flush(), settle);
  }

  #flush() {
    const roots = [...this.#added].filter((node) => node.isConnected);
    const full = this.#overflowed;
    this.#added.clear();
    this.#overflowed = false;
    this.emit('structure', { roots, full });
  }

  start() {
    if (this.#view.MutationObserver) {
      this.#observer = new this.#view.MutationObserver((records) => {
        if (this.#suspended > 0) return;
        let relevant = false;
        for (const record of records) {
          if (!isRelevant(record)) continue;
          relevant = true;
          if (record.type === 'childList') {
            for (const node of record.addedNodes) {
              if (node.nodeType !== 1) continue;
              if (this.#added.size >= this.maxRoots) { this.#overflowed = true; break; }
              this.#added.add(node);
            }
          } else if (record.target?.nodeType === 1) {
            // A class or style flip can repaint a whole component, so its subtree is
            // re-read as if it were new.
            if (this.#added.size >= this.maxRoots) this.#overflowed = true;
            else this.#added.add(record.target);
          }
        }
        if (relevant) this.#notify();
      });
      this.#observer.observe(this.#doc.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'hidden', 'dark', 'theme'],
      });
    }
    this.#router = watchRoute(this.#view, (url, previous) => this.emit('route', { url, previous }));
    return this;
  }

  stop() {
    this.#observer?.disconnect();
    this.#observer = null;
    this.#router?.();
    this.#router = null;
    this.#notify.cancel();
  }

  /**
   * Runs `fn` without the observer reacting to it.
   * Every write the extension makes goes through here, which is what prevents an
   * apply → observe → apply loop.
   */
  suspend(fn) {
    this.#suspended += 1;
    try {
      return fn();
    } finally {
      // Drain the records this write produced before listening again.
      this.#observer?.takeRecords();
      this.#suspended -= 1;
    }
  }
}

/** Extension-owned mutations, and our own marker attribute, are not page changes. */
function isRelevant(record) {
  if (record.type === 'attributes' && record.attributeName === TOKEN_ATTR) return false;
  const target = record.target;
  if (target?.nodeType === 1 && target.closest?.(`[${OWNED_ATTR}]`)) return false;
  if (record.type === 'childList') {
    const nodes = [...record.addedNodes, ...record.removedNodes];
    if (!nodes.length) return false;
    if (nodes.every((n) => n.nodeType === 1 && n.hasAttribute?.(OWNED_ATTR))) return false;
    // Text-only churn — a clock ticking, a view count updating — changes no colours.
    if (nodes.every((n) => n.nodeType === 3)) return false;
  }
  return true;
}

/**
 * Detects client-side navigation.
 *
 * `popstate` alone misses `pushState`, which is how most routers navigate, so both are
 * wrapped. The wrappers call through to the originals and are restored by the returned
 * disposer, so the page's own routing is untouched.
 */
export function watchRoute(view, onChange) {
  let current = view.location.href;

  const fire = () => {
    const next = view.location.href;
    if (next === current) return;
    const previous = current;
    current = next;
    onChange(next, previous);
  };

  const history = view.history;
  const originalPush = history.pushState;
  const originalReplace = history.replaceState;

  history.pushState = function pushState(...args) {
    const result = originalPush.apply(this, args);
    fire();
    return result;
  };
  history.replaceState = function replaceState(...args) {
    const result = originalReplace.apply(this, args);
    fire();
    return result;
  };

  view.addEventListener('popstate', fire);
  view.addEventListener('hashchange', fire);

  return () => {
    history.pushState = originalPush;
    history.replaceState = originalReplace;
    view.removeEventListener('popstate', fire);
    view.removeEventListener('hashchange', fire);
  };
}
