/**
 * Everything the extension remembers, which is deliberately very little:
 *
 *   - `themes`     the user's own themes: captured, imported, or sent by a friend.
 *   - `site:<host>` which theme that site wears, plus the slice of CSS that can be
 *                   injected before the page paints.
 *   - `settings`   panel appearance and position.
 *
 * Themes are global and sites are per-host, which is the split the product needs: the
 * point of saving a theme is to use it somewhere else.
 */

import { KEY, readKey, writeKey, deleteKey } from './bridge.js';
import { normaliseTheme } from '../shared/theme-format.js';

/**
 * The shape of a stored record. Every write carries it as `v`.
 *
 * This exists so a later release can change the shape of what is on disk. You cannot
 * migrate data you cannot identify, and a stamp is impossible to retrofit onto the
 * records already sitting in someone's browser — so it goes in before the first upload,
 * while there is nothing to migrate.
 */
export const STORAGE_VERSION = 1;

/**
 * One entry per version, keyed by the version it upgrades *from*.
 *
 * Empty today. When version 2 arrives, add `1: (record) => ...` returning the version-2
 * shape and bump STORAGE_VERSION; `migrate` will walk a record of any age forward
 * through every step in turn.
 */
const MIGRATIONS = {};

/** Stamps a record on its way to disk. */
const stamp = (record) => ({ ...record, v: STORAGE_VERSION });

/**
 * Brings a stored record up to the current shape and hands back its contents.
 *
 * Two cases have to survive, and both are silent failures if they are not thought about:
 *   - a record written before versioning existed carries no `v`, and is version 1 — that
 *     is what the first release wrote;
 *   - a record written by a *newer* release (storage synced from another profile, or the
 *     user rolled back) is left alone rather than mangled. Reading one is safe because
 *     every consumer either re-validates what it gets or ignores fields it does not know.
 */
function migrate(record) {
  if (!record || typeof record !== 'object') return null;
  const { v, ...value } = record;
  let version = Number.isInteger(v) ? v : 1;
  let current = value;
  while (version < STORAGE_VERSION) {
    current = MIGRATIONS[version]?.(current) ?? current;
    version += 1;
  }
  return current;
}

/** A runaway import loop must not be able to fill local storage. */
const MAX_THEMES = 80;

export const DEFAULT_SETTINGS = Object.freeze({
  appearance: 'light',   // the panel's own light/dark chrome
  side: 'right',         // which edge the panel docks to
  forceReadable: true,   // rescue text a theme would leave unreadable
});

export class Store {
  #backend;

  constructor(backend) {
    this.#backend = backend;
  }

  // ── The user's themes ──────────────────────────────────────────────────

  /** Stored themes, re-validated on read: a corrupted record cannot reach the engine. */
  async themes() {
    const record = migrate(await readKey(this.#backend, KEY.themes, null));
    const list = Array.isArray(record?.themes) ? record.themes : [];
    return list.map((entry) => normaliseTheme(entry)).filter(Boolean);
  }

  /** Saves (or replaces, by id) one theme and returns the new list. */
  async saveTheme(theme) {
    const themes = await this.themes();
    const index = themes.findIndex((t) => t.id === theme.id);
    if (index >= 0) themes[index] = theme;
    else themes.unshift(theme);
    return this.#writeThemes(themes);
  }

  /**
   * Saves several at once, which is what importing a collection does.
   * An incoming theme whose id already exists is given a fresh one rather than silently
   * overwriting something the user made.
   */
  async importThemes(incoming, existingIds = null) {
    const themes = await this.themes();
    const ids = existingIds ?? new Set(themes.map((t) => t.id));
    const added = [];
    for (const theme of incoming) {
      const copy = ids.has(theme.id) ? { ...theme, id: `${theme.id}-${Math.random().toString(36).slice(2, 6)}` } : theme;
      ids.add(copy.id);
      themes.unshift(copy);
      added.push(copy);
    }
    await this.#writeThemes(themes);
    return added;
  }

  async deleteTheme(id) {
    const themes = (await this.themes()).filter((t) => t.id !== id);
    return this.#writeThemes(themes);
  }

  async #writeThemes(themes) {
    const capped = themes.slice(0, MAX_THEMES);
    await writeKey(this.#backend, KEY.themes, stamp({ themes: capped }));
    return capped;
  }

  // ── Per-site state ─────────────────────────────────────────────────────

  /** @returns {{themeId:string, bootCss:string, at:number}|null} */
  async site(host) {
    return migrate(await readKey(this.#backend, KEY.site(host), null));
  }

  /**
   * @param {string} host
   * @param {string} themeId
   * @param {string} bootCss the root-level CSS, injected on the next load before paint.
   */
  async setSite(host, themeId, bootCss) {
    return writeKey(this.#backend, KEY.site(host), stamp({ themeId, bootCss, at: Date.now() }));
  }

  async clearSite(host) {
    return deleteKey(this.#backend, KEY.site(host));
  }

  // ── Settings ───────────────────────────────────────────────────────────

  async settings() {
    return { ...DEFAULT_SETTINGS, ...(migrate(await readKey(this.#backend, KEY.settings, null)) ?? {}) };
  }

  async saveSettings(patch) {
    const next = { ...(await this.settings()), ...patch };
    await writeKey(this.#backend, KEY.settings, stamp(next));
    return next;
  }
}

/**
 * The host a theme is remembered against.
 *
 * `www.` is dropped so a theme applied on `www.example.com` still applies on
 * `example.com`, which is the same site to everyone except a URL parser.
 */
export function hostOf(href) {
  try {
    return new URL(href).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}
