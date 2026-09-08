/**
 * The theme library.
 *
 * Each preset is a design *position*, not a colour scheme: the palette, the corner
 * radius, the shadow treatment, the type and the density all move together, because that
 * is what makes Neumorphism read as neumorphism rather than as grey. The style specs
 * behind the trend group (Skeuomorphism, Flat, Neumorphism, Glassmorphism, Bauhaus, Bold
 * Typography, Brutalism, Cyberpunk) come from the project's UI style dataset, so the
 * values here are the canonical ones for each movement rather than an impression of them.
 *
 * Presets are pushed through the same validator as an imported theme. A shipped theme and
 * a theme a friend sent are then, by construction, the same kind of object — there is no
 * second code path to keep in sync, and a typo in a hex value below fails at import time
 * instead of on someone's screen.
 */

import { normaliseTheme } from '../shared/theme-format.js';

const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const GROTESK = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const SERIF = 'Georgia, "Times New Roman", Times, serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

/** Display order and section headings in the panel. */
export const GROUPS = Object.freeze([
  { id: 'essential', label: 'Essentials' },
  { id: 'trend', label: 'Movements' },
  { id: 'dark', label: 'Dark' },
  { id: 'custom', label: 'Yours' },
]);

const RAW = [
  // ── Essentials ───────────────────────────────────────────────────────────
  {
    group: 'essential', id: 'minimal', name: 'Minimal', description: 'Swiss discipline: white, one red, no ornament.',
    palette: { background: '#FFFFFF', surface: '#F7F7F7', text: '#111111', textMuted: '#5C5C5C', accent: '#D6002A', onAccent: '#FFFFFF', border: '#E2E2E2' },
    radius: 0, density: 1.2, fontFamily: GROTESK, shadow: 'none', effects: { tracking: -0.01 },
  },
  {
    group: 'essential', id: 'editorial', name: 'Editorial', description: 'Near-black on paper with a printer’s pink.',
    palette: { background: '#FAFAFA', surface: '#FFFFFF', text: '#09090B', textMuted: '#475569', accent: '#BE185D', onAccent: '#FFFFFF', border: '#E4E4E7' },
    radius: 2, density: 1.1, fontFamily: SERIF, shadow: 'none',
  },
  {
    group: 'essential', id: 'sage', name: 'Sage', description: 'Warm neutral paper with a calm teal.',
    palette: { background: '#F5F5F0', surface: '#FFFFFF', text: '#0F172A', textMuted: '#475569', accent: '#0E7490', onAccent: '#FFFFFF', border: '#E4E5E0' },
    radius: 10, density: 1, fontFamily: SANS, shadow: 'soft',
  },
  {
    group: 'essential', id: 'reading', name: 'Reading', description: 'Book brown on warm amber, set loose.',
    palette: { background: '#FFFBEB', surface: '#FFFEF8', text: '#1C1917', textMuted: '#6B625B', accent: '#B45309', onAccent: '#FFFFFF', border: '#EDE6D4' },
    radius: 6, density: 1.3, fontFamily: SERIF, shadow: 'none',
  },
  {
    group: 'essential', id: 'blossom', name: 'Blossom', description: 'Soft pink surfaces, deep rose accent.',
    palette: { background: '#FDF2F8', surface: '#FFFFFF', text: '#0F172A', textMuted: '#475569', accent: '#9D174D', onAccent: '#FFFFFF', border: '#FBE3EF' },
    radius: 16, density: 1, fontFamily: SANS, shadow: 'soft',
  },
  {
    group: 'essential', id: 'contrast', name: 'High Contrast', description: 'Maximum legibility. Black, white, one blue.',
    palette: { background: '#FFFFFF', surface: '#FFFFFF', text: '#000000', textMuted: '#2B2B2B', accent: '#0033A0', onAccent: '#FFFFFF', border: '#000000' },
    radius: 4, density: 1.1, fontFamily: SANS, shadow: 'sharp', effects: { borderWidth: 1 },
  },

  // ── Movements ────────────────────────────────────────────────────────────
  {
    group: 'trend', id: 'flat', name: 'Flat', description: 'Solid colour, no gradients, no shadows.',
    palette: { background: '#ECF0F1', surface: '#FFFFFF', text: '#2C3E50', textMuted: '#566573', accent: '#C0392B', onAccent: '#FFFFFF', border: '#D5DBDB' },
    radius: 2, density: 1.05, fontFamily: SANS, shadow: 'none',
  },
  {
    group: 'trend', id: 'skeuomorphic', name: 'Skeuomorphic', description: 'Linen, stitched leather and real depth.',
    palette: { background: '#C3B9A6', surface: '#F5F1E8', text: '#2B2620', textMuted: '#4A423A', accent: '#8B5A2B', onAccent: '#FFF8E7', border: '#A99A83' },
    radius: 8, density: 1.1, fontFamily: SANS, shadow: 'deep', effects: { gradient: true, noise: true, borderWidth: 1 },
  },
  {
    group: 'trend', id: 'neumorphic', name: 'Neumorphic', description: 'Soft UI: one surface, light pressed into it.',
    palette: { background: '#E0E5EC', surface: '#E0E5EC', text: '#2C3141', textMuted: '#565E70', accent: '#6D5DFC', onAccent: '#FFFFFF', border: '#CDD3DD' },
    radius: 16, density: 1.2, fontFamily: SANS, shadow: 'neu',
  },
  {
    group: 'trend', id: 'glass', name: 'Glass', description: 'Frosted panels floating over colour.', dark: true,
    palette: { background: '#101A34', surface: '#25324F', text: '#F8FAFC', textMuted: '#C3CBE0', accent: '#38BDF8', onAccent: '#06121F', border: 'rgba(255,255,255,0.28)' },
    radius: 18, density: 1.15, fontFamily: SANS, shadow: 'glass',
    effects: {
      blur: 16, surfaceAlpha: 0.18,
      backdrop: 'radial-gradient(60% 60% at 15% 10%, #4338CA 0%, rgba(67,56,202,0) 60%), radial-gradient(55% 55% at 85% 25%, #DB2777 0%, rgba(219,39,119,0) 60%), radial-gradient(70% 70% at 50% 100%, #0EA5E9 0%, rgba(14,165,233,0) 60%), #101A34',
    },
  },
  {
    group: 'trend', id: 'bauhaus', name: 'Bauhaus', description: 'Primary red, hard shadows, right angles.',
    palette: { background: '#F0F0F0', surface: '#FFFFFF', text: '#121212', textMuted: '#3D3D3D', accent: '#D02020', onAccent: '#FFFFFF', border: '#121212' },
    radius: 0, density: 1.1, fontFamily: GROTESK, shadow: 'hard',
    effects: { borderWidth: 2, uppercase: true, weight: 900, tracking: -0.02 },
  },
  {
    group: 'trend', id: 'bold-type', name: 'Bold Type', description: 'Headlines at full volume, everything else silent.',
    palette: { background: '#FFFFFF', surface: '#FFFFFF', text: '#000000', textMuted: '#3A3A3A', accent: '#E02900', onAccent: '#FFFFFF', border: '#111111' },
    radius: 0, density: 1.35, fontFamily: GROTESK, shadow: 'none',
    effects: { uppercase: true, weight: 900, tracking: -0.03 },
  },
  {
    group: 'trend', id: 'brutalist', name: 'Brutalist', description: 'Raw HTML energy: fat borders, link blue.',
    palette: { background: '#FFFFFF', surface: '#FAFAF7', text: '#000000', textMuted: '#2E2E2E', accent: '#0000EE', onAccent: '#FFFFFF', border: '#000000' },
    radius: 0, density: 1, fontFamily: MONO, shadow: 'hard', effects: { borderWidth: 3, weight: 800 },
  },
  {
    group: 'trend', id: 'neon', name: 'Neon', description: 'Cyberpunk night: bloom, magenta, scanline dark.', dark: true,
    palette: { background: '#0A0118', surface: '#170C2E', text: '#EDE9FE', textMuted: '#B4A8DC', accent: '#FF2E88', onAccent: '#12000A', border: '#3A1D6E' },
    radius: 4, density: 1, fontFamily: MONO, shadow: 'glow', effects: { glow: true, tracking: 0.02 },
  },

  // ── Dark ─────────────────────────────────────────────────────────────────
  {
    group: 'dark', id: 'midnight', name: 'Midnight', description: 'Neutral dark that any site can wear.', dark: true,
    palette: { background: '#0B1120', surface: '#131C31', text: '#E8EEF7', textMuted: '#9AAAC4', accent: '#5B9DF9', onAccent: '#041022', border: '#22304A' },
    radius: 10, density: 1, fontFamily: SANS, shadow: 'soft',
  },
  {
    group: 'dark', id: 'terminal', name: 'Terminal', description: 'Deep dark, monospace, run green.', dark: true,
    palette: { background: '#020617', surface: '#0C1223', text: '#F8FAFC', textMuted: '#94A3B8', accent: '#22C55E', onAccent: '#04140A', border: '#1F2A44' },
    radius: 4, density: 1, fontFamily: MONO, shadow: 'none',
  },
  {
    group: 'dark', id: 'nord', name: 'Nord', description: 'Arctic blue-grey, low glare, long sessions.', dark: true,
    palette: { background: '#2E3440', surface: '#3B4252', text: '#ECEFF4', textMuted: '#C2CBDA', accent: '#88C0D0', onAccent: '#2E3440', border: '#4C566A' },
    radius: 6, density: 1, fontFamily: SANS, shadow: 'soft',
  },
  {
    group: 'dark', id: 'dracula', name: 'Dracula', description: 'Purple night with a candy accent.', dark: true,
    palette: { background: '#282A36', surface: '#343746', text: '#F8F8F2', textMuted: '#C7C9DB', accent: '#BD93F9', onAccent: '#21222C', border: '#44475A' },
    radius: 8, density: 1, fontFamily: SANS, shadow: 'soft',
  },
];

/**
 * Validated presets, in display order.
 * `group` lives outside the theme format — it is a shelf in the panel, not a property of
 * the theme itself, and a theme someone shares carries no shelf with it.
 */
export const PRESETS = Object.freeze(RAW.map((entry) => {
  const theme = normaliseTheme(entry, { trusted: true });
  if (!theme) throw new Error(`Preset "${entry.id}" is not a valid theme`);
  return Object.freeze({ ...theme, group: entry.group, custom: false });
}));

export function presetById(id) {
  return PRESETS.find((theme) => theme.id === id) ?? null;
}
