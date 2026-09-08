/**
 * Mutation and navigation monitoring (§29, §41, §67, §68).
 *
 * Modern pages rewrite themselves constantly, so "apply the saved changes once at load"
 * is not enough — a saved override has to find its element again when a modal opens or a
 * route renders (§40, §67).
 *
 * The hard requirement is that watching must be cheap. The observer therefore reports
 * *that* something relevant changed, coalesced onto a frame, rather than handing every
 * mutation record upward; and it ignores the extension's own writes so applying an
 * override cannot trigger another reapplication (§71).
 */

import { Emitter, rafThrottle, debounce } from '../../shared/util.js';
import { WID_ATTR, OWNED_ATTR } from '../../shared/types.js';

export class MutationMonitor extends Emitter {
  #doc;
  #view;
  #observer = null;
  #resizeObserver = null;
  #router = null;
  #suspended = 0;
  #notifyStructure;
  #notifyGeometry;
  #watched = new Set();

  constructor({ doc = document, view = window } = {}) {
    super();
    this.#doc = doc;
    this.#view = view;
    // Structure changes settle in bursts; a short debounce turns a render storm into one
    // reapplication pass.
    this.#notifyStructure = debounce(() => this.emit('structure'), 80);
    this.#notifyGeometry = rafThrottle(() => this.emit('geometry'), view.requestAnimationFrame?.bind(view));
  }

  start() {
    this.#startMutations();
    this.#startGeometry();
    this.#startRouter();
    return this;
  }

  stop() {
    this.#observer?.disconnect();
    this.#observer = null;
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
    this.#router?.();
    this.#router = null;
    this.#view.removeEventListener('scroll', this.#onScroll, true);
    this.#view.removeEventListener('resize', this.#onResize);
    this.#notifyStructure.cancel();
    this.#notifyGeometry.cancel();
    this.#watched.clear();
  }

  /**
   * Runs `fn` without the observer reacting to it.
   * Every write the extension makes goes through here, which is what prevents an
   * apply -> observe -> apply loop.
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

  /** Track an element's size so the overlay follows it as content reflows (§29). */
  watch(element) {
    if (!element || this.#watched.has(element)) return;
    this.#watched.add(element);
    this.#resizeObserver?.observe(element);
  }

  unwatch(element) {
    if (!element) return;
    this.#watched.delete(element);
    this.#resizeObserver?.unobserve(element);
  }

  unwatchAll() {
    for (const element of this.#watched) this.#resizeObserver?.unobserve(element);
    this.#watched.clear();
  }

  #startMutations() {
    if (!this.#view.MutationObserver) return;
    this.#observer = new this.#view.MutationObserver((records) => {
      if (this.#suspended > 0) return;
      if (!records.some((r) => isRelevant(r))) return;
      this.#notifyStructure();
    });
    this.#observer.observe(this.#doc.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'id', 'hidden', 'aria-hidden'],
    });
  }

  #onScroll = () => this.#notifyGeometry();

  #onResize = () => {
    this.#notifyGeometry();
    this.emit('viewport', { width: this.#view.innerWidth, height: this.#view.innerHeight });
  };

  #startGeometry() {
    // Capture phase catches scrolling inside nested containers, not just the page (§112).
    this.#view.addEventListener('scroll', this.#onScroll, true);
    this.#view.addEventListener('resize', this.#onResize);
    if (this.#view.ResizeObserver) {
      this.#resizeObserver = new this.#view.ResizeObserver(() => this.#notifyGeometry());
    }
  }

  #startRouter() {
    this.#router = watchRoute(this.#view, (url, previous) => this.emit('route', { url, previous }));
  }
}

/** Extension-owned mutations, and our own marker attribute, are not page changes. */
function isRelevant(record) {
  if (record.type === 'attributes' && record.attributeName === WID_ATTR) return false;
  const target = record.target;
  if (target?.nodeType === 1 && target.closest?.(`[${OWNED_ATTR}]`)) return false;
  if (record.type === 'childList') {
    const nodes = [...record.addedNodes, ...record.removedNodes];
    if (nodes.length && nodes.every((n) => n.nodeType === 1 && n.hasAttribute?.(OWNED_ATTR))) return false;
    // Text-only churn (a clock ticking) does not change what can be selected.
    if (nodes.length && nodes.every((n) => n.nodeType === 3)) return false;
  }
  return true;
}

/**
 * Detects client-side navigation (§41, §68).
 *
 * `popstate` alone misses `pushState`, which is how most routers navigate, so both are
 * wrapped. The wrappers are restored when the returned disposer runs, and they call
 * through to the originals so the page's own routing is untouched.
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
