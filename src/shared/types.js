/**
 * Shared vocabulary for every context (service worker, content script, panel UI).
 *
 * Two features live in this extension: a theme, which repaints a whole page, and an
 * editor, which changes one element at a time. They share this file and almost nothing
 * else — the theme stamps `data-webin`, the editor stamps `data-webin-id`, and an
 * element may carry both.
 */

/** Marks nodes the extension itself owns, so the theme never re-skins its own UI. */
export const OWNED_ATTR = 'data-webin-owned';

/** Attribute carrying an element's detected token memberships, e.g. "bg1 tx0 sf". */
export const TOKEN_ATTR = 'data-webin';

/**
 * Attribute the editor stamps on an element the user has changed by hand.
 *
 * It is the only mark the editor leaves on a page, and the handle every override rule
 * selects on. Sweeping these is what makes "reset" provably complete.
 */
export const WID_ATTR = 'data-webin-id';

/** Stamped on the panel host so the chrome's dark block can key off it. */
export const APPEARANCE_ATTR = 'data-webin-appearance';

/** Element ids for the sheets the extension owns. */
export const THEME_STYLE_ID = 'webin-theme';
export const BOOT_STYLE_ID = 'webin-boot';
export const EDIT_STYLE_ID = 'webin-overrides';

/**
 * Ceiling on how many elements a scan will touch.
 *
 * Detection only needs a representative sample — the scale of a site's design system is
 * legible from a couple of thousand nodes — while stamping has to reach everything the
 * user can actually see, so it gets a much larger budget. YouTube's home page is roughly
 * 12k elements; the stamp limit is set above that deliberately.
 */
export const DETECT_LIMIT = 2500;
export const STAMP_LIMIT = 20000;

/**
 * How well a saved change must match a candidate element before it is applied.
 *
 * Below this the change is parked rather than guessed at: putting someone's saved button
 * width on the wrong button is worse than applying nothing and saying so.
 */
export const CONFIDENCE_THRESHOLD = 0.55;

/** Messages exchanged between the service worker and the content script. */
export const Msg = Object.freeze({
  TOGGLE_PANEL: 'TOGGLE_PANEL',
  GET_STATUS: 'GET_STATUS',
  PING: 'PING',
  /** Sent to a tab's iframes when the top document changes theme. */
  SYNC: 'SYNC',
  /** Content script asks the worker to fetch a theme the user pasted a URL for. */
  FETCH_THEME: 'FETCH_THEME',
});

/** The kinds of change the editor can save. One record, one kind. */
export const OpKind = Object.freeze({
  STYLE: 'style',
  ATTRIBUTE: 'attribute',
  TEXT: 'text',
  HIDE: 'hide',
  REMOVE: 'remove',
});

/**
 * What the editor is doing to the page.
 *
 * `inspect` reads but never intercepts a click, so links still work; `design` takes the
 * pointer, because a click has to mean "select this" rather than "follow this".
 */
export const EditMode = Object.freeze({
  OFF: 'off',
  INSPECT: 'inspect',
  DESIGN: 'design',
});

/**
 * Which viewport an edit applies to.
 *
 * Version one only ever writes `ALL`. The field exists anyway, and the override sheet
 * already serialises the media queries, so per-breakpoint editing can be switched on
 * later without touching a single saved record.
 */
export const Breakpoint = Object.freeze({
  ALL: 'all',
  DESKTOP: 'desktop',
  TABLET: 'tablet',
  MOBILE: 'mobile',
});

/** Upper bound in px for each breakpoint. Desktop is a floor, and is handled separately. */
export const BREAKPOINT_MAX = Object.freeze({
  [Breakpoint.MOBILE]: 480,
  [Breakpoint.TABLET]: 1024,
});

/** Marks on a stamped element. Kept two characters so the attribute stays small. */
export const Mark = Object.freeze({
  /** Nearest painted background is the theme accent — text on it must flip. */
  ON_ACCENT: 'on',
  /** The element paints its own opaque background: a card, bar, or panel. */
  SURFACE: 'sf',
  /**
   * The readability guarantee. Text that fails contrast against what is actually painted
   * behind it is forced to black or white, whichever wins. Two marks, two rules, however
   * many elements need them.
   */
  INK_DARK: 'kd',
  INK_LIGHT: 'kl',
});

/**
 * Elements a theme must never repaint. Re-colouring a video, a canvas or an image
 * destroys content rather than re-skinning chrome, and forcing a radius onto a `<video>`
 * is how a player ends up with clipped controls.
 */
export const UNTOUCHABLE = Object.freeze([
  'img', 'video', 'canvas', 'svg', 'iframe', 'embed', 'object', 'picture', 'source',
  'audio', 'track', 'map', 'area', 'script', 'style', 'link', 'meta', 'noscript', 'template',
]);

/** @typedef {import('./theme-format.js').Theme} Theme */
