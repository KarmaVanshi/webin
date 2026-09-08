/**
 * Storage schema, validation and migrations (§69, §70, §121, §122, §123).
 *
 * Customisation data outlives the extension version that wrote it, so every record
 * carries a schema version and every read runs through `migrate`. Corrupt or foreign
 * data is rejected rather than partially applied — a bad import must never reach the
 * override engine (§123).
 */

import { SCHEMA_VERSION, OpKind, Breakpoint } from '../shared/types.js';

/** Scope pattern meaning "every path on this site" (§38). */
export const SITE_SCOPE = '*';

/** An empty, valid site record. */
export function emptySite(host) {
  return {
    schemaVersion: SCHEMA_VERSION,
    host,
    activeProfile: 'default',
    profiles: { default: emptyProfile('default', 'Default') },
    updatedAt: Date.now(),
  };
}

/** An empty, valid profile record (§39). */
export function emptyProfile(id, name) {
  return { id, name, enabled: true, createdAt: Date.now(), scopes: {} };
}

/** Default extension settings. */
export function defaultSettings() {
  return {
    schemaVersion: SCHEMA_VERSION,
    autoApply: true,
    showMeasurements: true,
    highlightOverridden: true,
    confirmDestructive: true,
    reducedMotion: false,
  };
}

/** Default per-site workspace state — panel geometry, not customisation data (§91). */
export function defaultWorkspace() {
  return {
    schemaVersion: SCHEMA_VERSION,
    mode: 'inspect',
    // Light is the default chrome; dark is opt-in and remembered from then on.
    appearance: 'light',
    layersWidth: 240,
    inspectorWidth: 288,
    layersVisible: true,
    inspectorVisible: true,
    activePanel: 'inspector',
    viewport: 'fit',
    breakpoint: Breakpoint.ALL,
    expandedSections: ['layout', 'spacing', 'typography', 'appearance'],
  };
}

const KINDS = new Set(Object.values(OpKind));
const BREAKPOINTS = new Set(Object.values(Breakpoint));

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStringMap = (v) =>
  isPlainObject(v) && Object.values(v).every((x) => typeof x === 'string' || x === null);

/**
 * Validates one change record (§123).
 * @returns {{ok:true, value:object}|{ok:false, reason:string}}
 */
export function validateChange(change) {
  if (!isPlainObject(change)) return { ok: false, reason: 'Change is not an object.' };
  if (typeof change.id !== 'string' || !change.id) return { ok: false, reason: 'Change is missing an id.' };
  if (!KINDS.has(change.kind)) return { ok: false, reason: `Unknown change kind "${change.kind}".` };
  if (!isPlainObject(change.target)) return { ok: false, reason: 'Change is missing a target identity.' };
  if (typeof change.target.tag !== 'string' || !change.target.tag) {
    return { ok: false, reason: 'Target identity is missing a tag.' };
  }
  if (change.breakpoint != null && !BREAKPOINTS.has(change.breakpoint)) {
    return { ok: false, reason: `Unknown breakpoint "${change.breakpoint}".` };
  }
  if (change.kind === OpKind.STYLE && !isStringMap(change.properties)) {
    return { ok: false, reason: 'Style change needs a string map of properties.' };
  }
  if (change.kind === OpKind.ATTRIBUTE && !isStringMap(change.attributes)) {
    return { ok: false, reason: 'Attribute change needs a string map of attributes.' };
  }
  if (change.kind === OpKind.TEXT && typeof change.text !== 'string') {
    return { ok: false, reason: 'Text change needs a text value.' };
  }
  if (change.kind === OpKind.THEME) {
    // The whole theme is stored, not just its id: a preset could be renamed and a saved
    // theme could be deleted, and neither should silently change how a page looks.
    if (!isPlainObject(change.theme) || !isPlainObject(change.theme.palette)) {
      return { ok: false, reason: 'Theme change needs an embedded theme with a palette.' };
    }
    const required = ['background', 'surface', 'text', 'textMuted', 'accent', 'onAccent', 'border'];
    const missing = required.filter((key) => typeof change.theme.palette[key] !== 'string');
    if (missing.length) return { ok: false, reason: `Theme palette is missing: ${missing.join(', ')}.` };
  }
  return {
    ok: true,
    value: {
      ...change,
      breakpoint: change.breakpoint ?? Breakpoint.ALL,
      createdAt: Number.isFinite(change.createdAt) ? change.createdAt : Date.now(),
    },
  };
}

/**
 * Validates a whole site record, dropping individual bad changes rather than the site.
 * @returns {{site:object, rejected:string[]}}
 */
export function validateSite(raw, host) {
  const rejected = [];
  if (!isPlainObject(raw)) return { site: emptySite(host), rejected: ['Site record was not an object.'] };

  const site = emptySite(host);
  site.host = typeof raw.host === 'string' ? raw.host : host;
  site.updatedAt = Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now();

  const profiles = isPlainObject(raw.profiles) ? raw.profiles : {};
  const cleaned = {};
  for (const [id, profile] of Object.entries(profiles)) {
    if (!isPlainObject(profile)) {
      rejected.push(`Profile "${id}" was not an object.`);
      continue;
    }
    const next = emptyProfile(id, typeof profile.name === 'string' ? profile.name : id);
    next.enabled = profile.enabled !== false;
    next.createdAt = Number.isFinite(profile.createdAt) ? profile.createdAt : Date.now();

    const scopes = isPlainObject(profile.scopes) ? profile.scopes : {};
    for (const [pattern, scope] of Object.entries(scopes)) {
      const changes = Array.isArray(scope?.changes) ? scope.changes : [];
      const kept = [];
      for (const change of changes) {
        const result = validateChange(change);
        if (result.ok) kept.push(result.value);
        else rejected.push(`${id}${pattern}: ${result.reason}`);
      }
      next.scopes[pattern] = { changes: kept };
    }
    cleaned[id] = next;
  }

  site.profiles = Object.keys(cleaned).length ? cleaned : { default: emptyProfile('default', 'Default') };
  site.activeProfile = Object.hasOwn(site.profiles, raw.activeProfile)
    ? raw.activeProfile
    : Object.keys(site.profiles)[0];
  return { site, rejected };
}

/**
 * Upgrades a record written by an older version (§122).
 * Each step is keyed by the version it upgrades *from*, so a v1 record read by a
 * future v3 build runs 1->2 then 2->3.
 */
const MIGRATIONS = {
  // 1: (record) => ({ ...record, schemaVersion: 2, /* ... */ }),
};

/** Runs a record forward to SCHEMA_VERSION. Unknown future versions are left alone. */
export function migrate(record) {
  if (!isPlainObject(record)) return record;
  let current = record;
  let version = Number.isFinite(current.schemaVersion) ? current.schemaVersion : 1;
  while (version < SCHEMA_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) {
      // No path forward: stamp the version so the validator can salvage what it can.
      current = { ...current, schemaVersion: SCHEMA_VERSION };
      break;
    }
    current = step(current);
    version = current.schemaVersion;
  }
  return current;
}

/** True when a record was written by a build newer than this one. */
export function isFutureVersion(record) {
  return isPlainObject(record) && Number.isFinite(record.schemaVersion) && record.schemaVersion > SCHEMA_VERSION;
}

/** Shape of an exported customisation file (§92). */
export function buildExport(host, profileId, profile) {
  return {
    format: 'web-interface-devtools/customisation',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: Date.now(),
    host,
    profileId,
    profile,
  };
}

/**
 * Validates an imported file before anything is applied (§123).
 * @returns {{ok:true, host:string, profile:object, rejected:string[]}|{ok:false, reason:string}}
 */
export function validateImport(raw) {
  if (!isPlainObject(raw)) return { ok: false, reason: 'File is not valid JSON object data.' };
  if (raw.format !== 'web-interface-devtools/customisation') {
    return { ok: false, reason: 'File is not a Web Interface DevTools customisation.' };
  }
  if (isFutureVersion(raw)) {
    return { ok: false, reason: `File uses schema v${raw.schemaVersion}; this build understands v${SCHEMA_VERSION}.` };
  }
  if (typeof raw.host !== 'string' || !raw.host) return { ok: false, reason: 'File is missing a host.' };
  const migrated = migrate(raw);
  const wrapper = { profiles: { imported: migrated.profile }, activeProfile: 'imported' };
  const { site, rejected } = validateSite(wrapper, migrated.host);
  return { ok: true, host: migrated.host, profile: site.profiles.imported, rejected };
}
