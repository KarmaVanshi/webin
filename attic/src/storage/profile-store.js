/**
 * Profiles: several independent design layers for the same site (§39).
 *
 * Profiles sit inside the site record rather than in their own key, because switching
 * profiles has to be atomic with the change data it selects — a half-applied switch
 * would leave the page showing two layers at once.
 */

import { emptyProfile, buildExport, validateImport } from './schema.js';
import { uid } from '../shared/util.js';

export class ProfileStore {
  #sites;

  constructor(siteStore) {
    this.#sites = siteStore;
  }

  /** Every profile on a site, with the active one flagged. */
  async list(host) {
    const site = await this.#sites.load(host);
    return Object.values(site.profiles).map((profile) => ({
      id: profile.id,
      name: profile.name,
      enabled: profile.enabled,
      active: profile.id === site.activeProfile,
      changeCount: Object.values(profile.scopes ?? {}).reduce((n, s) => n + s.changes.length, 0),
    }));
  }

  /** Creates a profile, optionally seeded from an existing one. */
  async create(host, name, { copyFrom = null } = {}) {
    const site = await this.#sites.load(host);
    const id = uid('prof');
    const profile = emptyProfile(id, name || 'Untitled');
    if (copyFrom && site.profiles[copyFrom]) {
      profile.scopes = structuredClone(site.profiles[copyFrom].scopes);
    }
    site.profiles[id] = profile;
    await this.#sites.save(host, site);
    return profile;
  }

  /** Switches the active profile. Unknown ids are ignored rather than throwing. */
  async activate(host, profileId) {
    const site = await this.#sites.load(host);
    if (!site.profiles[profileId]) return false;
    site.activeProfile = profileId;
    await this.#sites.save(host, site);
    return true;
  }

  /** Enables or disables a profile without deleting it (§39). */
  async setEnabled(host, profileId, enabled) {
    const site = await this.#sites.load(host);
    const profile = site.profiles[profileId];
    if (!profile) return false;
    profile.enabled = Boolean(enabled);
    await this.#sites.save(host, site);
    return true;
  }

  async rename(host, profileId, name) {
    const site = await this.#sites.load(host);
    const profile = site.profiles[profileId];
    if (!profile) return false;
    profile.name = String(name || 'Untitled').slice(0, 80);
    await this.#sites.save(host, site);
    return true;
  }

  /** Removes a profile. The last remaining profile cannot be deleted. */
  async remove(host, profileId) {
    const site = await this.#sites.load(host);
    if (!site.profiles[profileId]) return false;
    if (Object.keys(site.profiles).length <= 1) return false;
    delete site.profiles[profileId];
    if (site.activeProfile === profileId) site.activeProfile = Object.keys(site.profiles)[0];
    await this.#sites.save(host, site);
    return true;
  }

  /** Serialises a profile for backup or transfer (§92). */
  async export(host, profileId) {
    const site = await this.#sites.load(host);
    const profile = site.profiles[profileId ?? site.activeProfile];
    if (!profile) return null;
    return buildExport(host, profile.id, profile);
  }

  /**
   * Validates then installs an imported profile (§123).
   * @returns {Promise<{ok:true, profile:object, rejected:string[]}|{ok:false, reason:string}>}
   */
  async import(host, raw) {
    const result = validateImport(raw);
    if (!result.ok) return result;
    if (result.host !== host) {
      // Not fatal — a user may deliberately move a layer between sites — but it is
      // surfaced rather than silently accepted.
      result.rejected.push(`File was exported from ${result.host}, importing into ${host}.`);
    }
    const site = await this.#sites.load(host);
    const id = uid('prof');
    site.profiles[id] = { ...result.profile, id, name: `${result.profile.name || 'Imported'} (imported)` };
    await this.#sites.save(host, site);
    return { ok: true, profile: site.profiles[id], rejected: result.rejected };
  }
}
