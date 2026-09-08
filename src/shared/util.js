/** Small dependency-free primitives shared by every context. */

let counter = 0;

/**
 * Short unique id. Not cryptographic — it only has to be unique among the changes saved
 * for one site, which is at most a few hundred.
 */
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
    const handlers = this.#handlers.get(type);
    if (!handlers) return;
    // Copied before dispatch: a one-shot listener that unsubscribes itself would
    // otherwise mutate the set mid-iteration. The editor's remap flow does exactly that.
    for (const handler of [...handlers]) {
      try {
        handler(payload);
      } catch (err) {
        // One bad listener must not take the others down with it.
        console.error(`[webin] handler for "${type}" threw`, err);
      }
    }
  }

  clear() {
    this.#handlers.clear();
  }
}

/**
 * Collapses a burst of calls into one, `ms` after the last.
 *
 * The returned function carries `.cancel()`, because a debounced callback that fires
 * after teardown is a bug that only shows up under a page navigation, and `.flush()`,
 * for the case where the work has to happen now — saving, or committing a gesture.
 */
export function debounce(fn, ms) {
  let timer = null;
  const debounced = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  };
  debounced.cancel = () => {
    clearTimeout(timer);
    timer = null;
  };
  debounced.flush = (...args) => {
    clearTimeout(timer);
    timer = null;
    fn(...args);
  };
  return debounced;
}

/**
 * Coalesces calls onto one animation frame.
 *
 * The selection overlay redraws from `getBoundingClientRect`, so a scroll that fires a
 * hundred events must still only measure once per frame.
 */
export function rafThrottle(fn, raf = null) {
  let frame = null;
  let lastArgs = null;
  const schedule = raf ?? ((cb) => globalThis.requestAnimationFrame?.(cb) ?? setTimeout(cb, 16));
  const throttled = (...args) => {
    lastArgs = args;
    if (frame !== null) return;
    frame = schedule(() => {
      frame = null;
      fn(...lastArgs);
    });
  };
  throttled.cancel = () => {
    if (frame !== null) globalThis.cancelAnimationFrame?.(frame);
    frame = null;
  };
  return throttled;
}

/** Clamp `n` into [min, max]. */
export function clamp(n, min, max) {
  return n < min ? min : n > max ? max : n;
}

/** Round to `places` decimals. A CSS value with a long float tail reads as noise. */
export function round(n, places = 2) {
  const factor = 10 ** places;
  return Math.round(n * factor) / factor;
}

/** Structural equality for the plain JSON-shaped objects this codebase passes around. */
export function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) => deepEqual(a[key], b[key]));
}

/** Deep clone of JSON-shaped data. */
export function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/**
 * Escapes text for interpolation into HTML.
 *
 * Every string that reaches the panel goes through here. Theme names arrive from files
 * and share codes other people wrote, so they are markup until proven otherwise.
 */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Collapses whitespace and trims — used for text fingerprints and element labels. */
export function normaliseText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/** Truncates for display, adding an ellipsis. */
export function truncate(value, max = 40) {
  const text = String(value ?? '');
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
