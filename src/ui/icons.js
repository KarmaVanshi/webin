/**
 * Icon set — one family, one 24px grid, one 1.75 stroke, round caps and joins.
 *
 * Inlined rather than imported: the content script runs on every page and must not fetch
 * anything, and there is no bundler here to tree-shake an icon package.
 *
 * Icons are decorative. Every control that uses one also carries a visible label or an
 * `aria-label`, so the glyphs are marked `aria-hidden` below.
 */

const PATHS = {
  close: '<path d="M6 6 18 18M18 6 6 18"/>',
  more: '<circle cx="12" cy="5.5" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="18.5" r="1.4" fill="currentColor" stroke="none"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  download: '<path d="M12 4v11"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M4.5 19.5h15"/>',
  upload: '<path d="M12 19.5V8.5"/><path d="m7.5 13 4.5-4.5 4.5 4.5"/><path d="M4.5 4.5h15"/>',
  share: '<path d="M10 13.5a3.5 3.5 0 0 0 5 0l3-3a3.54 3.54 0 0 0-5-5l-1.5 1.5"/><path d="M14 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.54 3.54 0 0 0 5 5L12.5 17"/>',
  trash: '<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 12.5h9L17.5 7"/>',
  pencil: '<path d="M4.5 19.5h4l10-10a2.83 2.83 0 0 0-4-4l-10 10Z"/><path d="m14.5 7.5 2 2"/>',
  reset: '<path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1"/><path d="M20.5 4v5h-5"/>',
  camera: '<path d="M3.5 8.5h3.2l1.6-2.5h7.4l1.6 2.5h3.2v10H3.5Z"/><circle cx="12" cy="13" r="3.4"/>',
  sun: '<circle cx="12" cy="12" r="4.5"/><path d="M12 2.5v2.5M12 19v2.5M4.2 4.2 6 6M18 18l1.8 1.8M2.5 12H5M19 12h2.5M4.2 19.8 6 18M18 6l1.8-1.8"/>',
  moon: '<path d="M20 14.3A8.5 8.5 0 1 1 9.7 4a6.8 6.8 0 0 0 10.3 10.3Z"/>',
  warning: '<path d="M12 4 2.5 20.5h19Z"/><path d="M12 10v4.5"/><circle cx="12" cy="17.6" r=".6" fill="currentColor" stroke="none"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><circle cx="12" cy="8" r=".7" fill="currentColor" stroke="none"/>',
  back: '<path d="M15 5 8 12l7 7"/>',

  // ── Editor ────────────────────────────────────────────────────────────
  cursor: '<path d="M5.5 3.5v15l3.8-3.7 2.5 5.5 2.6-1.2-2.4-5.3H18Z"/>',
  move: '<path d="M12 3.5v17M3.5 12h17"/><path d="m9 6.5 3-3 3 3M9 17.5l3 3 3-3M6.5 9l-3 3 3 3M17.5 9l3 3-3 3"/>',
  text: '<path d="M5 6.5v-2h14v2M12 4.5v15M8.5 19.5h7"/>',
  undo: '<path d="M8 5 3.5 9.5 8 14"/><path d="M3.5 9.5h10a5.5 5.5 0 0 1 0 11H9"/>',
  redo: '<path d="m16 5 4.5 4.5L16 14"/><path d="M20.5 9.5h-10a5.5 5.5 0 0 0 0 11H15"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="m4 4 16 16"/><path d="M9.9 5.9A9.7 9.7 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17.4 17.4 0 0 1-3.3 4.1"/><path d="M6.4 7.7A17.4 17.4 0 0 0 2.5 12S6 18.5 12 18.5a9.4 9.4 0 0 0 3.3-.6"/><path d="M10.1 10.1a3 3 0 0 0 4.1 4.1"/>',
  link: '<path d="M9.5 14.5a3.2 3.2 0 0 0 4.6 0l2.8-2.8a3.25 3.25 0 0 0-4.6-4.6l-1 1"/><path d="M14.5 9.5a3.2 3.2 0 0 0-4.6 0l-2.8 2.8a3.25 3.25 0 0 0 4.6 4.6l1-1"/>',
  unlink: '<path d="M10.5 13.5 8.4 15.6a3.25 3.25 0 0 1-4.6-4.6l2.1-2.1"/><path d="m13.5 10.5 2.1-2.1a3.25 3.25 0 0 1 4.6 4.6l-2.1 2.1"/><path d="m3.5 3.5 17 17"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  target: '<circle cx="12" cy="12" r="7.5"/><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
  save: '<path d="M4.5 4.5h11l4 4v11h-15Z"/><path d="M8 4.5v5h7v-5"/><path d="M7.5 19.5v-6h9v6"/>',
};

/**
 * Renders an icon as inline SVG.
 * @param {keyof typeof PATHS} name
 * @param {number} size
 */
export function icon(name, size = 14) {
  const path = PATHS[name];
  if (!path) return '';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"` +
    ` stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"` +
    ` aria-hidden="true" focusable="false">${path}</svg>`;
}

export const iconNames = Object.keys(PATHS);
