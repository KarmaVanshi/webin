/**
 * Where hand edits live.
 *
 * A theme and a set of per-element edits are two different things the user can want on
 * one site, and either should be removable without disturbing the other — so they get
 * separate records rather than two fields of one. `site:<host>` stays exactly what it
 * was; edits go to `edits:<host>`, and nothing needs migrating.
 *
 * Within a host, changes are filed under a *scope*: the path they were made on, or `*`
 * for the whole site. Loading a page collects every scope that matches, least specific
 * first, so a site-wide tweak applies everywhere and a page-specific one wins on its own
 * page.
 */

import { KEY, readKey, writeKey, deleteKey } from './bridge.js';
import { uid } from '../shared/util.js';
import { Breakpoint, OpKind } from '../shared/types.js';
import { MAX_IMAGE_VALUE } from '../shared/css-values.js';
import { SHEET_LIMIT } from '../shared/css-text.js';

export const EDITS_VERSION = 1;

/** The scope meaning "everywhere on this site". */
export const SITE_SCOPE = '*';

/** A page with more saved changes than this is not a page anyone is still editing. */
const MAX_CHANGES = 400;

/**
 * How long a stored declaration's value may be.
 *
 * Everything is short except a background holding an inline picture, which is enormous by
 * the standards of every other declaration and already has a hard ceiling of its own at
 * the gate that let it in. Truncating one would be worse than refusing it: a half a
 * `data:` URL is not a shorter picture, it is an invalid value the browser silently drops,
 * so the edit would apply, save, and then come back after a reload having quietly stopped
 * working.
 */
const valueLimit = (property) => (property === 'background-image' ? MAX_IMAGE_VALUE : 400);

const KINDS = new Set(Object.values(OpKind));

/** The scope a change made on `pathname` belongs to by default. */
export function scopeFromPath(pathname) {
  const path = String(pathname ?? '/').split(/[?#]/)[0] || '/';
  // A trailing slash is not a different page.
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

/**
 * How specific a scope is. Site-wide is least specific, so it is applied first and
 * anything page-specific lands on top of it.
 */
export function scopeSpecificity(scope) {
  if (scope === SITE_SCOPE) return 0;
  if (scope.endsWith('/*')) return 1;
  return 2;
}

/** Whether a saved scope covers the page being loaded. */
export function matchScope(scope, path) {
  if (scope === SITE_SCOPE) return true;
  if (scope.endsWith('/*')) return path.startsWith(scope.slice(0, -1));
  return scope === path;
}

/**
 * Whether two changes are about the same element.
 *
 * Editing a card's width and then its radius should be one saved record, not two, or the
 * file grows a row per keystroke and reapplying it re-resolves the same element over and
 * over. The strongest available signal decides.
 */
export function sameTarget(a, b) {
  if (!a || !b) return false;
  if (a.id && b.id) return a.id === b.id;
  if (a.stableAttr && b.stableAttr) return a.stableAttr === b.stableAttr;
  return Boolean(a.domPath) && a.domPath === b.domPath && a.tag === b.tag;
}

/** Rebuilds a change from stored data, dropping anything unrecognised. */
function normaliseChange(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!KINDS.has(raw.kind)) return null;
  const target = raw.target;
  if (!target || typeof target !== 'object' || typeof target.tag !== 'string') return null;

  const change = {
    id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 64) : uid('chg'),
    kind: raw.kind,
    breakpoint: Object.values(Breakpoint).includes(raw.breakpoint) ? raw.breakpoint : Breakpoint.ALL,
    target: {
      tag: target.tag.toLowerCase().slice(0, 40),
      id: str(target.id, 60),
      stableAttr: str(target.stableAttr, 160),
      semanticAttr: str(target.semanticAttr, 160),
      classFingerprint: Array.isArray(target.classFingerprint)
        ? target.classFingerprint.filter((c) => typeof c === 'string').slice(0, 12).map((c) => c.slice(0, 40))
        : [],
      textFingerprint: str(target.textFingerprint, 60),
      parentSignature: str(target.parentSignature, 120),
      domPath: str(target.domPath, 400),
      positionHint: Number.isFinite(raw.target.positionHint) ? raw.target.positionHint : 0,
    },
    label: str(raw.label, 80) ?? '',
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
  };

  if (raw.properties && typeof raw.properties === 'object') {
    change.properties = {};
    for (const [property, value] of Object.entries(raw.properties)) {
      if (typeof property === 'string' && typeof value === 'string') {
        const key = property.slice(0, 60);
        change.properties[key] = value.slice(0, valueLimit(key));
      }
    }
  }
  if (raw.attributes && typeof raw.attributes === 'object') {
    change.attributes = {};
    for (const [name, value] of Object.entries(raw.attributes)) {
      if (typeof name === 'string' && typeof value === 'string') {
        change.attributes[name.slice(0, 60)] = value.slice(0, 2048);
      }
    }
  }
  if (typeof raw.text === 'string') change.text = raw.text.slice(0, 4000);
  // The text as it was before the edit. Kept because a saved identity carries a
  // fingerprint of the element's text, and after the edit that fingerprint describes the
  // new words — so matching on a later visit has to be able to try the old ones too.
  if (typeof raw.textBefore === 'string') change.textBefore = raw.textBefore.slice(0, 4000);
  return change;
}

function str(value, max) {
  return typeof value === 'string' && value ? value.slice(0, max) : null;
}

function emptyRecord(host) {
  return { v: EDITS_VERSION, host, updatedAt: Date.now(), scopes: {} };
}

export class EditStore {
  #backend;

  constructor(backend) {
    this.#backend = backend;
  }

  /** Everything saved for a host, rebuilt field by field. */
  async load(host) {
    const raw = await readKey(this.#backend, KEY.edits(host), null);
    if (!raw || typeof raw !== 'object') return emptyRecord(host);
    const scopes = {};
    for (const [scope, entry] of Object.entries(raw.scopes ?? {})) {
      const changes = (Array.isArray(entry?.changes) ? entry.changes : [])
        .map(normaliseChange)
        .filter(Boolean);
      const sheet = typeof entry?.sheet === 'string' ? entry.sheet.slice(0, SHEET_LIMIT) : '';
      if (changes.length || sheet) scopes[String(scope).slice(0, 200)] = { changes, sheet };
    }
    return { v: EDITS_VERSION, host, updatedAt: raw.updatedAt ?? Date.now(), scopes };
  }

  async #write(host, record) {
    // A stylesheet with no element changes beside it is still work somebody did. Counting
    // only the changes would delete the record the moment a site was styled by hand alone.
    const total = Object.values(record.scopes)
      .reduce((n, s) => n + s.changes.length + (s.sheet ? 1 : 0), 0);
    if (total === 0) return deleteKey(this.#backend, KEY.edits(host));
    return writeKey(this.#backend, KEY.edits(host), { ...record, v: EDITS_VERSION, updatedAt: Date.now() });
  }

  /**
   * The changes that apply to one page, least specific scope first.
   *
   * Order is the point: a site-wide change is applied before the page-specific one that
   * refines it, so the more specific edit is the one that ends up in the stylesheet last.
   */
  async changesFor(host, path) {
    const record = await this.load(host);
    const scope = scopeFromPath(path);
    return Object.entries(record.scopes)
      .filter(([name]) => matchScope(name, scope))
      .sort((a, b) => scopeSpecificity(a[0]) - scopeSpecificity(b[0]))
      .flatMap(([name, entry]) => entry.changes.map((change) => ({ ...change, scope: name })));
  }

  /**
   * The stylesheet saved for whichever scope covers this path.
   *
   * Scopes are tried from the most specific outward, the same way element changes are, so
   * a sheet written for one page beats one written for the whole site.
   */
  async sheetFor(host, path) {
    const record = await this.load(host);
    const scope = scopeFromPath(path);
    const match = Object.entries(record.scopes)
      .filter(([name, entry]) => entry.sheet && matchScope(name, scope))
      .sort((a, b) => scopeSpecificity(b[0]) - scopeSpecificity(a[0]))[0];
    return match?.[1].sheet ?? '';
  }

  /** Saves the stylesheet for the scope this path belongs to. */
  async saveSheet(host, path, css) {
    const record = await this.load(host);
    const scope = scopeFromPath(path);
    const entry = record.scopes[scope] ?? { changes: [], sheet: '' };
    entry.sheet = String(css ?? '').slice(0, SHEET_LIMIT);
    if (!entry.changes.length && !entry.sheet) delete record.scopes[scope];
    else record.scopes[scope] = entry;
    await this.#write(host, record);
    return entry.sheet;
  }

  /** Adds a change, or folds it into the one already saved for that element. */
  async add(host, path, change) {
    const scope = change.scope ?? scopeFromPath(path);
    const record = await this.load(host);
    const entry = record.scopes[scope] ?? { changes: [] };
    const incoming = normaliseChange(change);
    if (!incoming) return null;

    const existing = entry.changes.find((c) => c.kind === incoming.kind
      && c.breakpoint === incoming.breakpoint
      && sameTarget(c.target, incoming.target));

    if (existing) {
      existing.target = incoming.target;
      existing.label = incoming.label || existing.label;
      if (incoming.properties) existing.properties = { ...existing.properties, ...incoming.properties };
      if (incoming.attributes) existing.attributes = { ...existing.attributes, ...incoming.attributes };
      if (incoming.text !== undefined) existing.text = incoming.text;
      // The first edit knows the original text; later ones must not overwrite it.
      if (incoming.textBefore !== undefined && existing.textBefore === undefined) {
        existing.textBefore = incoming.textBefore;
      }
    } else {
      if (entry.changes.length >= MAX_CHANGES) entry.changes.shift();
      entry.changes.push(incoming);
    }

    record.scopes[scope] = entry;
    await this.#write(host, record);
    return existing ?? incoming;
  }

  /** Saves a batch in one write — what Save does with everything pending. */
  async addAll(host, path, changes) {
    let last = null;
    for (const change of changes) last = await this.add(host, path, change);
    return last;
  }

  async remove(host, changeId) {
    const record = await this.load(host);
    let removed = false;
    for (const [scope, entry] of Object.entries(record.scopes)) {
      const next = entry.changes.filter((c) => c.id !== changeId);
      if (next.length !== entry.changes.length) removed = true;
      // The scope's stylesheet is not one of its changes, and taking one change away must
      // not take the sheet with it.
      if (next.length || entry.sheet) record.scopes[scope] = { changes: next, sheet: entry.sheet ?? '' };
      else delete record.scopes[scope];
    }
    if (removed) await this.#write(host, record);
    return removed;
  }

  /**
   * Clears one page.
   *
   * Site-wide changes are left alone and reported instead, because "reset this page" that
   * silently wiped every other page too would be a nasty surprise — the UI can offer
   * "reset the site" separately once it knows there is something left.
   */
  async resetPath(host, path) {
    const record = await this.load(host);
    const scope = scopeFromPath(path);
    const removed = record.scopes[scope]?.changes.length ?? 0;
    delete record.scopes[scope];
    const remaining = Object.values(record.scopes).reduce((n, s) => n + s.changes.length, 0);
    await this.#write(host, record);
    return { removed, remaining };
  }

  async resetSite(host) {
    const record = await this.load(host);
    const removed = Object.values(record.scopes).reduce((n, s) => n + s.changes.length, 0);
    await deleteKey(this.#backend, KEY.edits(host));
    return { removed, remaining: 0 };
  }

  /**
   * Whether a host has anything saved at all, for the badge and the panel footer.
   *
   * A stylesheet counts as one thing, the same way `#write` counts it: a site styled by
   * hand alone is a site with edits, and the button that removes them has to know so.
   */
  async count(host) {
    const record = await this.load(host);
    return Object.values(record.scopes).reduce((n, s) => n + s.changes.length + (s.sheet ? 1 : 0), 0);
  }
}
