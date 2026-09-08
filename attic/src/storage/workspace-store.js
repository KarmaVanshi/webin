/**
 * Workspace state and settings (§91).
 *
 * Deliberately separate from customisation data: panel widths and the last selected
 * element are conveniences, and losing them must never look like losing design work.
 * Resetting a site's changes leaves this untouched, and vice versa.
 */

import { KEY, readKey, writeKey } from './bridge.js';
import { defaultWorkspace, defaultSettings, migrate } from './schema.js';
import { SCHEMA_VERSION } from '../shared/types.js';

export class WorkspaceStore {
  #backend;

  constructor(backend) {
    this.#backend = backend;
  }

  async loadWorkspace() {
    const raw = await readKey(this.#backend, KEY.workspace, null);
    return { ...defaultWorkspace(), ...(raw ? migrate(raw) : {}) };
  }

  async saveWorkspace(patch) {
    const current = await this.loadWorkspace();
    const next = { ...current, ...patch };
    await writeKey(this.#backend, KEY.workspace, next);
    return next;
  }

  async loadSettings() {
    const raw = await readKey(this.#backend, KEY.settings, null);
    return { ...defaultSettings(), ...(raw ? migrate(raw) : {}) };
  }

  async saveSettings(patch) {
    const current = await this.loadSettings();
    const next = { ...current, ...patch };
    await writeKey(this.#backend, KEY.settings, next);
    return next;
  }

  /**
   * Themes the user has captured (§92).
   *
   * Global rather than per-site on purpose: the point of saving a theme is to use it
   * somewhere else. Capped so a runaway save loop cannot fill local storage.
   */
  async loadThemes() {
    const raw = await readKey(this.#backend, KEY.themes, null);
    return Array.isArray(raw?.themes) ? raw.themes : [];
  }

  async saveTheme(theme) {
    const themes = await this.loadThemes();
    const index = themes.findIndex((t) => t.id === theme.id);
    if (index >= 0) themes[index] = theme;
    else themes.unshift(theme);
    const capped = themes.slice(0, 40);
    await writeKey(this.#backend, KEY.themes, { schemaVersion: SCHEMA_VERSION, themes: capped });
    return capped;
  }

  async deleteTheme(themeId) {
    const themes = (await this.loadThemes()).filter((t) => t.id !== themeId);
    await writeKey(this.#backend, KEY.themes, { schemaVersion: SCHEMA_VERSION, themes });
    return themes;
  }

  /** Factory reset: clears every key the extension owns (§44). */
  async factoryReset() {
    await this.#backend.clear();
  }
}
