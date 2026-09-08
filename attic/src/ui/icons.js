/**
 * Icon set — Phosphor-style outline glyphs, hand-inlined.
 *
 * One family, one 24px grid, one 1.75 stroke weight, round caps and joins, per the
 * design system's icon rules. They are inlined rather than imported because the content
 * script runs on every page and must not fetch anything (§74), and because the build has
 * no bundler to tree-shake an icon package.
 *
 * Icons are decorative here: every control that uses one also carries a visible label or
 * an `aria-label`, so the glyphs are marked `aria-hidden` at the call site.
 */

const PATHS = {
  cursor: '<path d="M5 3.5 19 11l-6.2 1.8L11 19z"/>',
  move: '<path d="M12 4v16M4 12h16"/><path d="m9 7 3-3 3 3M9 17l3 3 3-3M7 9l-3 3 3 3M17 9l3 3-3 3"/>',
  resize: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M14 10h-4v4"/>',
  text: '<path d="M5 6.5V5h14v1.5M12 5v14M9.5 19h5"/>',
  spacing: '<rect x="3" y="3" width="18" height="18" rx="2"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
  align: '<path d="M4 4v16M9 8h11M9 16h7"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
  inspect: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.5 4v5h5"/><path d="M12 8v4.5l3 1.8"/>',
  undo: '<path d="M4 9h10a5.5 5.5 0 0 1 0 11h-4"/><path d="m8 5-4 4 4 4"/>',
  redo: '<path d="M20 9H10a5.5 5.5 0 0 0 0 11h4"/><path d="m16 5 4 4-4 4"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M4 4.5 20 20"/><path d="M9.4 5.9A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3.3 4"/><path d="M6.3 7.8A16.7 16.7 0 0 0 2.5 12S6 18.5 12 18.5a9.5 9.5 0 0 0 3.8-.8"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  trash: '<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 12.5h9L17.5 7"/>',
  save: '<path d="M5 3.5h11L20.5 8v12.5h-15Z"/><path d="M8.5 3.5v6h7v-6M8 20.5V14h8v6.5"/>',
  reset: '<path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1"/><path d="M20.5 4v5h-5"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  close: '<path d="M6 6 18 18M18 6 6 18"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  paste: '<rect x="5" y="5" width="14" height="16" rx="2"/><path d="M9 5V3.5h6V5"/><path d="M9 11h6M9 15h4"/>',
  responsive: '<rect x="2.5" y="5" width="13" height="10" rx="1.5"/><rect x="17" y="9" width="4.5" height="10" rx="1.5"/>',
  warning: '<path d="M12 4 2.5 20.5h19Z"/><path d="M12 10v4.5"/><circle cx="12" cy="17.6" r=".6" fill="currentColor" stroke="none"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><circle cx="12" cy="8" r=".7" fill="currentColor" stroke="none"/>',
  link: '<path d="M10 13.5a3.5 3.5 0 0 0 5 0l3-3a3.54 3.54 0 0 0-5-5l-1.5 1.5"/><path d="M14 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.54 3.54 0 0 0 5 5L12.5 17"/>',
  unlink: '<path d="M9.5 14.5 6 18M6 6l12 12M14.5 9.5 18 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
  profile: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 9v11"/>',
  palette: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.3 0 2.1-.9 2.1-1.9 0-.6-.2-1-.6-1.4-.3-.4-.5-.8-.5-1.3 0-1 .8-1.8 1.8-1.8h1.4c2.4 0 4.3-1.9 4.3-4.3 0-3.6-3.9-6.3-8.5-6.3Z"/><circle cx="7.6" cy="11.2" r="1.1"/><circle cx="10.2" cy="7.6" r="1.1"/><circle cx="14.6" cy="7.9" r="1.1"/>',
  sun: '<circle cx="12" cy="12" r="4.5"/><path d="M12 2.5v2.5M12 19v2.5M4.2 4.2 6 6M18 18l1.8 1.8M2.5 12H5M19 12h2.5M4.2 19.8 6 18M18 6l1.8-1.8"/>',
  moon: '<path d="M20 14.3A8.5 8.5 0 1 1 9.7 4a6.8 6.8 0 0 0 10.3 10.3Z"/>',
  target: '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.5"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3"/>',
};

/**
 * Renders an icon as inline SVG.
 * @param {keyof typeof PATHS} name
 * @param {number} size
 */
export function icon(name, size = 14) {
  const path = PATHS[name];
  if (!path) return '';
  return `<svg class="widt-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"` +
    ` stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"` +
    ` aria-hidden="true" focusable="false">${path}</svg>`;
}

export const iconNames = Object.keys(PATHS);
