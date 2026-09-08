/**
 * Sites, path scopes and the changes stored against them (§37, §38).
 *
 * A site's customisations are not one flat list. They are keyed by a path scope, so
 * `example.com` can carry one set of changes for every page and a different set for
 * `/dashboard` (§38). When a page loads, every matching scope contributes, applied from
 * least to most specific so a page-level change wins over a site-wide one.
 */

import { KEY, readKey, writeKey, deleteKey } from './bridge.js';
import { SITE_SCOPE, emptySite, validateSite, migrate, isFutureVersion } from './schema.js';
import { uid } from '../shared/util.js';

/**
 * Does a stored scope pattern cover this path?
 * Patterns are `*` (whole site), an exact path, or a prefix ending in `/*`.
 */
export function matchScope(pattern, path) {
  if (pattern === SITE_SCOPE) return true;
  const normalisedPath = normalisePath(path);
  if (pattern.endsWith('/*')) {
    const prefix = normalisePath(pattern.slice(0, -2));
    return normalisedPath === prefix || normalisedPath.startsWith(`${prefix}/`);
  }
  return normalisePath(pattern) === normalisedPath;
}

/** Higher is more specific; drives both apply order and conflict resolution. */
export function scopeSpecificity(pattern) {
  if (pattern === SITE_SCOPE) return 0;
  const segments = normalisePath(pattern).split('/').filter(Boolean).length;
  return pattern.endsWith('/*') ? segments * 2 + 1 : segments * 2 + 2;
}

/** Trailing slashes are noise for matching; `/a/` and `/a` are the same page. */
export function normalisePath(path) {
  const raw = String(path ?? '/');
  const withoutQuery = raw.split(/[?#]/)[0];
  if (withoutQuery === '/' || withoutQuery === '') return '/';
  return withoutQuery.replace(/\/+$/, '') || '/';
}

/** Derives the storage host and path scope from a URL (§38). */
export function scopeFromUrl(url) {
  try {
    const parsed = new URL(url);
    return { host: parsed.hostname, path: normalisePath(parsed.pathname) };
  } catch {
    return { host: 'unknown', path: '/' };
  }
}

export class SiteStore {
  #backend;
  #cache = new Map();

  constructor(backend) {
    this.#backend = backend;
  }

  /** Loads a site record, migrating and validating it (§121-§123). */
  async load(host) {
    if (this.#cache.has(host)) return this.#cache.get(host);
    const raw = await readKey(this.#backend, KEY.site(host), null);
    let site;
    let rejected = [];
    if (!raw) {
      site = emptySite(host);
    } else if (isFutureVersion(raw)) {
      // Never guess at a newer schema — surface it and leave the stored data untouched.
      site = emptySite(host);
      rejected = [`Saved data uses schema v${raw.schemaVersion}, newer than this build.`];
      site.readOnly = true;
    } else {
      const result = validateSite(migrate(raw), host);
      site = result.site;
      rejected = result.rejected;
    }
    site.rejected = rejected;
    this.#cache.set(host, site);
    return site;
  }

  /** Persists a site record. */
  async save(host, site) {
    const record = { ...site, updatedAt: Date.now() };
    delete record.rejected;
    delete record.readOnly;
    this.#cache.set(host, { ...site, updatedAt: record.updatedAt });
    return writeKey(this.#backend, KEY.site(host), record);
  }

  /** Drops the in-memory copy so the next read hits storage. */
  invalidate(host) {
    if (host) this.#cache.delete(host);
    else this.#cache.clear();
  }

  /** The profile a page should apply, or null when it is disabled (§39). */
  async activeProfile(host) {
    const site = await this.load(host);
    const profile = site.profiles[site.activeProfile];
    return profile?.enabled ? profile : null;
  }

  /**
   * Every change that applies to `path`, ordered least-specific first (§38, §40).
   * Each entry keeps its scope so the UI can show where a change came from.
   */
  async changesForPath(host, path) {
    const profile = await this.activeProfile(host);
    if (!profile) return [];
    return collectScopedChanges(profile, path);
  }

  /** Adds a change to a scope, replacing any earlier change of the same kind on the same target. */
  async addChange(host, path, change, { scope = null } = {}) {
    const site = await this.load(host);
    const profile = site.profiles[site.activeProfile];
    if (!profile) return null;
    const pattern = scope ?? normalisePath(path);
    const bucket = (profile.scopes[pattern] ??= { changes: [] });
    const record = { ...change, id: change.id || uid('chg') };

    const index = bucket.changes.findIndex(
      (c) => c.kind === record.kind && c.breakpoint === record.breakpoint && sameTarget(c.target, record.target),
    );
    if (index >= 0) {
      // Merge style properties so editing width then radius yields one change, not two.
      const existing = bucket.changes[index];
      bucket.changes[index] = mergeChange(existing, record);
    } else {
      bucket.changes.push(record);
    }
    await this.save(host, site);
    return bucket.changes[index >= 0 ? index : bucket.changes.length - 1];
  }

  /** Removes a single change by id from every scope. */
  async removeChange(host, changeId) {
    const site = await this.load(host);
    const profile = site.profiles[site.activeProfile];
    if (!profile) return false;
    let removed = false;
    for (const bucket of Object.values(profile.scopes)) {
      const before = bucket.changes.length;
      bucket.changes = bucket.changes.filter((c) => c.id !== changeId);
      if (bucket.changes.length !== before) removed = true;
    }
    if (removed) await this.save(host, site);
    return removed;
  }

  /** Removes every change of one kind across all scopes — used when clearing a theme. */
  async removeChangesOfKind(host, kind) {
    const site = await this.load(host);
    const profile = site.profiles[site.activeProfile];
    if (!profile) return 0;
    let removed = 0;
    for (const [pattern, bucket] of Object.entries(profile.scopes)) {
      const before = bucket.changes.length;
      bucket.changes = bucket.changes.filter((c) => c.kind !== kind);
      removed += before - bucket.changes.length;
      if (!bucket.changes.length) delete profile.scopes[pattern];
    }
    if (removed) await this.save(host, site);
    return removed;
  }

  /** Replaces the whole change list for one scope — used by undo/redo replay. */
  async setScopeChanges(host, pattern, changes) {
    const site = await this.load(host);
    const profile = site.profiles[site.activeProfile];
    if (!profile) return false;
    if (changes.length) profile.scopes[pattern] = { changes };
    else delete profile.scopes[pattern];
    await this.save(host, site);
    return true;
  }

  /**
   * Reset for the current page only (§44).
   *
   * Only the scope written *exactly* for this path is cleared. Broader scopes — the
   * site-wide `*` and section prefixes like `/products/*` — also apply here but govern
   * other pages too, so removing them would silently reset pages the user never asked
   * about. Those are reported back as `remaining` so the UI can offer "Reset site".
   *
   * @returns {Promise<{cleared:number, remaining:number}>}
   */
  async resetPath(host, path) {
    const site = await this.load(host);
    const profile = site.profiles[site.activeProfile];
    if (!profile) return { cleared: 0, remaining: 0 };

    const exact = normalisePath(path);
    let cleared = 0;
    let remaining = 0;
    for (const pattern of Object.keys(profile.scopes)) {
      const count = profile.scopes[pattern].changes.length;
      if (pattern !== SITE_SCOPE && normalisePath(pattern.replace(/\/\*$/, '')) === exact && !pattern.endsWith('/*')) {
        cleared += count;
        delete profile.scopes[pattern];
      } else if (matchScope(pattern, path)) {
        remaining += count;
      }
    }
    await this.save(host, site);
    return { cleared, remaining };
  }

  /** Reset every change on the site, keeping the profile itself (§44). */
  async resetSite(host) {
    const site = await this.load(host);
    let cleared = 0;
    for (const profile of Object.values(site.profiles)) {
      for (const bucket of Object.values(profile.scopes)) cleared += bucket.changes.length;
      profile.scopes = {};
    }
    await this.save(host, site);
    return cleared;
  }

  /** Removes the site record entirely. */
  async forget(host) {
    this.#cache.delete(host);
    return deleteKey(this.#backend, KEY.site(host));
  }

  /** All hosts that currently hold customisations. */
  async listHosts() {
    const keys = await this.#backend.keys();
    return keys.filter((k) => k.startsWith('site:')).map((k) => k.slice('site:'.length));
  }
}

/** Changes from every scope matching `path`, least specific first. */
export function collectScopedChanges(profile, path) {
  return Object.entries(profile.scopes ?? {})
    .filter(([pattern]) => matchScope(pattern, path))
    .sort((a, b) => scopeSpecificity(a[0]) - scopeSpecificity(b[0]))
    .flatMap(([pattern, bucket]) => bucket.changes.map((change) => ({ ...change, scope: pattern })));
}

/** Two identities describe the same element when their strong signals agree. */
export function sameTarget(a, b) {
  if (!a || !b) return false;
  if (a.tag !== b.tag) return false;
  if (a.id && b.id) return a.id === b.id;
  if (a.stableAttr && b.stableAttr) return a.stableAttr === b.stableAttr;
  return a.domPath === b.domPath;
}

/** Later edits to the same target fold into the existing change (§43). */
function mergeChange(existing, incoming) {
  const merged = { ...existing, ...incoming, id: existing.id };
  if (existing.properties || incoming.properties) {
    merged.properties = { ...existing.properties, ...incoming.properties };
  }
  if (existing.attributes || incoming.attributes) {
    merged.attributes = { ...existing.attributes, ...incoming.attributes };
  }
  return merged;
}
