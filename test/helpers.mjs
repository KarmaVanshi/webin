/** Shared jsdom setup. Modules default to the global `window`/`document`, so those are
 *  installed before any module under test is imported. */
import { JSDOM } from 'jsdom';

export function makeDom(html = '<html><head></head><body></body></html>', options = {}) {
  const dom = new JSDOM(html, { pretendToBeVisual: true, url: 'https://example.com/', ...options });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.CSS = dom.window.CSS ?? { escape: (s) => String(s).replace(/([^\w-])/g, '\\$1') };
  globalThis.Node = dom.window.Node;
  globalThis.Element = dom.window.Element;
  return dom;
}

/**
 * jsdom has no layout engine, so every element reports a zero-sized box and the
 * editor's (correct) "do not offer invisible elements" rule would filter out the whole
 * page. This gives every element a plausible box so selection can be exercised.
 */
export function stubLayout(dom, box = { width: 200, height: 60 }) {
  const rect = { x: 0, y: 0, top: 0, left: 0, ...box };
  rect.right = rect.left + rect.width;
  rect.bottom = rect.top + rect.height;
  dom.window.Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return { ...rect, toJSON: () => rect };
  };
  return dom;
}

/** Overrides the box for specific selectors, on top of `stubLayout`. */
export function stubRects(dom, entries) {
  for (const [selector, rect] of Object.entries(entries)) {
    for (const el of dom.window.document.querySelectorAll(selector)) {
      const box = { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0, ...rect };
      box.right ||= box.left + box.width;
      box.bottom ||= box.top + box.height;
      el.getBoundingClientRect = () => ({ ...box, toJSON: () => box });
    }
  }
}

export const flush = () => new Promise((r) => setTimeout(r, 0));
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Waits for a condition instead of for a fixed number of ticks.
 *
 * Some of what the runtime does is genuinely asynchronous — decoding a share code goes
 * through `DecompressionStream`, which is a real stream and does not settle in a fixed
 * number of microtask turns. Counting `flush()` calls until a test passes produces a test
 * that fails on a slower machine, so it is better to say what is being waited for.
 */
export async function until(predicate, { timeout = 2000, label = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = predicate();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}
