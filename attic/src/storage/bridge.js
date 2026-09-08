/**
 * The only place that touches `chrome.storage` (§69).
 *
 * Everything above this file works against a plain async key/value interface, which is
 * what makes the stores testable in Node and what would make a different backing store
 * (IndexedDB, for a large dataset) a change confined to this module.
 */

/** In-memory backing store — used by tests and by any context without the storage API. */
export class MemoryBackend {
  #data = new Map();

  async get(keys) {
    const list = Array.isArray(keys) ? keys : [keys];
    const out = {};
    for (const key of list) if (this.#data.has(key)) out[key] = structuredClone(this.#data.get(key));
    return out;
  }

  async set(items) {
    for (const [key, value] of Object.entries(items)) this.#data.set(key, structuredClone(value));
  }

  async remove(keys) {
    for (const key of Array.isArray(keys) ? keys : [keys]) this.#data.delete(key);
  }

  async keys() {
    return [...this.#data.keys()];
  }

  async clear() {
    this.#data.clear();
  }
}

/** `chrome.storage.local` backing store. */
export class ChromeBackend {
  #area;

  constructor(area) {
    this.#area = area;
  }

  get(keys) { return this.#area.get(keys); }
  set(items) { return this.#area.set(items); }
  remove(keys) { return this.#area.remove(keys); }
  async keys() { return Object.keys(await this.#area.get(null)); }
  clear() { return this.#area.clear(); }
}

/** Picks the real backend when one is available, memory otherwise. */
export function createBackend() {
  const area = globalThis.chrome?.storage?.local;
  return area ? new ChromeBackend(area) : new MemoryBackend();
}

export const KEY = {
  settings: 'settings',
  workspace: 'workspace',
  site: (host) => `site:${host}`,
  history: (host) => `history:${host}`,
  themes: 'themes',
};

/** True for keys that hold a site record. */
export function isSiteKey(key) {
  return typeof key === 'string' && key.startsWith('site:');
}

/** Extracts the host from a site key. */
export function hostFromSiteKey(key) {
  return key.slice('site:'.length);
}

/**
 * Reads one key, returning `fallback` when absent.
 * Storage failures are surfaced as the fallback rather than thrown: a quota error or a
 * revoked permission must degrade to "no customisations" and not break the page.
 */
export async function readKey(backend, key, fallback = null) {
  try {
    const result = await backend.get(key);
    return Object.hasOwn(result, key) ? result[key] : fallback;
  } catch (err) {
    console.warn('[web-interface-devtools] storage read failed', key, err);
    return fallback;
  }
}

/** Writes one key. Returns false when the write failed (quota, revoked permission). */
export async function writeKey(backend, key, value) {
  try {
    await backend.set({ [key]: value });
    return true;
  } catch (err) {
    console.warn('[web-interface-devtools] storage write failed', key, err);
    return false;
  }
}

/** Deletes one key. */
export async function deleteKey(backend, key) {
  try {
    await backend.remove(key);
    return true;
  } catch (err) {
    console.warn('[web-interface-devtools] storage delete failed', key, err);
    return false;
  }
}
