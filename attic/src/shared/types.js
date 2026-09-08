/**
 * Shared vocabulary for every context (service worker, content script, UI, popup).
 *
 * The concept describes six systems connected through a shared element model and a
 * shared operation model (Build Concept §132). These constants and typedefs are that
 * shared vocabulary; nothing here has behaviour, so every context can import it freely.
 */

/** Current on-disk schema version. Migrations live in storage/schema.js (§121, §122). */
export const SCHEMA_VERSION = 1;

/** Attribute stamped on page elements so generated CSS can target them (§33 Level 1). */
export const WID_ATTR = 'data-widt-id';

/** Marks nodes the extension itself owns, so the inspector never offers them for editing. */
export const OWNED_ATTR = 'data-widt-owned';

/** Editing modes (§6). */
export const Mode = Object.freeze({
  OFF: 'off',
  INSPECT: 'inspect',
  DESIGN: 'design',
});

/** Panels the workspace can show (§6.3, §6.4). */
export const Panel = Object.freeze({
  LAYERS: 'layers',
  INSPECTOR: 'inspector',
  HISTORY: 'history',
  RESPONSIVE: 'responsive',
  THEMES: 'themes',
});

/** Override operation kinds (§33). Ordered by the level they act on. */
export const OpKind = Object.freeze({
  STYLE: 'style',
  ATTRIBUTE: 'attribute',
  TEXT: 'text',
  HIDE: 'hide',
  REMOVE: 'remove',
  /** A whole-page token remap (§49, §87). Broad base beneath per-element overrides. */
  THEME: 'theme',
});

/** Breakpoints a change can be scoped to (§50). */
export const Breakpoint = Object.freeze({
  ALL: 'all',
  DESKTOP: 'desktop',
  TABLET: 'tablet',
  MOBILE: 'mobile',
});

/** Max viewport width for each scoped breakpoint; ALL is unscoped. */
export const BREAKPOINT_MAX = Object.freeze({
  [Breakpoint.MOBILE]: 480,
  [Breakpoint.TABLET]: 1024,
  [Breakpoint.DESKTOP]: null,
});

/** Viewport presets for Responsive mode (§6.3). */
export const VIEWPORT_PRESETS = Object.freeze([
  { id: 'fit', label: 'Fit', width: null, height: null },
  { id: 'desktop', label: 'Desktop', width: 1440, height: 900 },
  { id: 'laptop', label: 'Laptop', width: 1280, height: 800 },
  { id: 'tablet', label: 'Tablet', width: 768, height: 1024 },
  { id: 'mobile', label: 'Mobile', width: 390, height: 844 },
]);

/** Message kinds exchanged between popup, service worker and content script (§80). */
export const Msg = Object.freeze({
  SET_MODE: 'SET_MODE',
  GET_STATUS: 'GET_STATUS',
  SAVE: 'SAVE',
  RESET_PAGE: 'RESET_PAGE',
  RESET_SITE: 'RESET_SITE',
  RESET_SELECTION: 'RESET_SELECTION',
  UNDO: 'UNDO',
  REDO: 'REDO',
  SET_PROFILE: 'SET_PROFILE',
  CREATE_PROFILE: 'CREATE_PROFILE',
  DELETE_PROFILE: 'DELETE_PROFILE',
  LIST_PROFILES: 'LIST_PROFILES',
  EXPORT: 'EXPORT',
  IMPORT: 'IMPORT',
  FACTORY_RESET: 'FACTORY_RESET',
  PING: 'PING',
  APPLY_THEME: 'APPLY_THEME',
  CLEAR_THEME: 'CLEAR_THEME',
  LIST_THEMES: 'LIST_THEMES',
  SAVE_THEME: 'SAVE_THEME',
  DETECT_TOKENS: 'DETECT_TOKENS',
});

/** Why a saved change could not be reapplied (§85, §101). */
export const MatchStatus = Object.freeze({
  APPLIED: 'applied',
  LOW_CONFIDENCE: 'low-confidence',
  NOT_FOUND: 'not-found',
});

/**
 * Confidence floor for silently reapplying a saved change (§85 step 3-5).
 * Below this the change is parked and surfaced to the user rather than guessed at.
 */
export const CONFIDENCE_THRESHOLD = 0.55;

/**
 * @typedef {Object} Identity Multi-signal element signature (§35).
 * @property {string} tag
 * @property {string|null} id
 * @property {string|null} stableAttr  e.g. "data-testid=submit"
 * @property {string|null} semanticAttr e.g. "aria-label=Buy now"
 * @property {string[]} classFingerprint Stable-looking classes only.
 * @property {string|null} textFingerprint Normalised leading text.
 * @property {string|null} parentSignature
 * @property {string} domPath Structural path from the document root.
 * @property {number} positionHint Index among same-tag siblings.
 */

/**
 * @typedef {Object} Change A persisted user modification (§37, §84).
 * @property {string} id
 * @property {string} kind One of OpKind.
 * @property {Identity} target
 * @property {string} breakpoint One of Breakpoint.
 * @property {Object<string,string>} [properties] For OpKind.STYLE.
 * @property {Object<string,string|null>} [attributes] For OpKind.ATTRIBUTE.
 * @property {string} [text] For OpKind.TEXT.
 * @property {string} [label] Human-readable summary for the history panel.
 * @property {number} createdAt
 */

/**
 * @typedef {Object} Operation A reversible history entry (§42, §43).
 * @property {string} id
 * @property {string} label Grouped, user-facing description ("Moved Product Card").
 * @property {Array<{changeId:string, before:Object|null, after:Object|null}>} entries
 * @property {number} at
 */

/** Attribute carrying an element's detected token memberships, e.g. "tc0 bg1 r2". */
export const TOKEN_ATTR = 'data-widt-tokens';

/**
 * Ceiling on how many elements token detection and stamping will touch (§71, §72).
 * Large pages get a representative sample rather than an exhaustive one; the scale of a
 * site's design system is legible from a few thousand nodes.
 */
export const TOKEN_SCAN_LIMIT = 5000;
