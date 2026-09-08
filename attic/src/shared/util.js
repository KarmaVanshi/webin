/** Small dependency-free primitives shared by every context. */

let counter = 0;

/** Short unique id. Not cryptographic — only needs to be unique within a profile. */
export function uid(prefix = 'x') {
  counter = (counter + 1) % 1e6;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** Minimal typed event emitter. Returns an unsubscribe function from `on`. */
export class Emitter {
  #handlers = new Map();

  on(type, handler) {
    if (!this.#handlers.has(type)) this.#handlers.set(type, new Set());
    this.#handlers.get(type).add(handler);
    return () => this.off(type, handler);
  }

  off(type, handler) {
    this.#handlers.get(type)?.delete(handler);
  }

  emit(type, payload) {
    const set = this.#handlers.get(type);
    if (!set) return;
    // Copy so a handler may unsubscribe during dispatch.
    for (const handler of [...set]) {
      try {
        handler(payload);
      } catch (err) {
        console.error(`[webin] handler for "${type}" threw`, err);
      }
    }
  }

  clear() {
    this.#handlers.clear();
  }
}

/** Trailing-edge debounce. */
export function debounce(fn, ms) {
  let timer = null;
  const wrapped = (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  };
  wrapped.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  wrapped.flush = (...args) => {
    if (timer) clearTimeout(timer);
    timer = null;
    fn(...args);
  };
  return wrapped;
}

/**
 * Coalesces calls onto one animation frame.
 * Overlay geometry updates run through this so scrolling never queues layout work
 * faster than the compositor can drain it (§71).
 */
export function rafThrottle(fn, raf = globalThis.requestAnimationFrame) {
  let frame = null;
  let lastArgs = null;
  const wrapped = (...args) => {
    lastArgs = args;
    if (frame !== null) return;
    frame = raf(() => {
      frame = null;
      fn(...lastArgs);
    });
  };
  wrapped.cancel = () => {
    if (frame !== null && globalThis.cancelAnimationFrame) globalThis.cancelAnimationFrame(frame);
    frame = null;
  };
  return wrapped;
}

/** Clamp `n` into [min, max]. */
export function clamp(n, min, max) {
  return n < min ? min : n > max ? max : n;
}

/** Round to `places` decimals, dropping trailing zeroes. */
export function round(n, places = 2) {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/** Structural equality for the plain JSON-shaped objects used across the codebase. */
export function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual(a[k], b[k]));
}

/** Deep clone of JSON-shaped data. */
export function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/** Escapes text for safe insertion into an HTML template string. */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Collapses whitespace and trims — used for text fingerprints and labels. */
export function normaliseText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/** Truncates for display, adding an ellipsis. */
export function truncate(value, max = 40) {
  const s = String(value ?? '');
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
