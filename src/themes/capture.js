/**
 * Capturing a page's own look as a reusable theme.
 *
 * This is how the library grows past what ships with the extension: find a site whose
 * design you like, capture it, and wear it everywhere else — or send it to a friend.
 *
 * A captured palette is lifted off a real page, and real pages are frequently already
 * illegible, so every colour that will carry text is passed through the contrast
 * guarantee on the way out. Capturing a bad contrast decision and re-applying it
 * elsewhere would be inheriting someone else's bug.
 */

import { normaliseTheme } from '../shared/theme-format.js';
import { parseColor, luminance, readableOn } from '../shared/color.js';
import { Role } from '../content/tokens.js';
import { mix } from '../content/engine.js';

/**
 * @param {object} tokens from detectTokens()
 * @param {string} name
 * @returns {import('../shared/theme-format.js').Theme}
 */
export function themeFromTokens(tokens, name = 'This page') {
  const roles = tokens.roles ?? {};
  const background = roles[Role.BACKGROUND] ?? '#FFFFFF';
  const dark = luminance(parseColor(background) ?? { r: 255, g: 255, b: 255 }) < 0.3;
  const surface = roles[Role.SURFACE] ?? background;
  const text = roles[Role.TEXT] ?? (dark ? '#F8FAFC' : '#111111');
  const accent = roles[Role.ACCENT] ?? (dark ? '#60A5FA' : '#2563EB');
  const readable = (color) => readableOn(color, [background, surface]);

  const dominantRadius = [...(tokens.radii ?? [])].sort((a, b) => b.weight - a.weight)[0]?.value ?? null;

  return normaliseTheme({
    id: `mine-${Date.now().toString(36)}`,
    name,
    description: 'Captured from a page you liked.',
    dark,
    palette: {
      background,
      surface,
      text: readable(text),
      textMuted: readable(roles[Role.TEXT_MUTED] ?? mix(text, background, 0.35)),
      accent,
      onAccent: readableOn(dark ? '#0B1120' : '#FFFFFF', [accent]),
      border: roles[Role.BORDER] ?? mix(background, text, 0.14),
    },
    radius: dominantRadius,
    density: 1,
    // Detection reports one family name; a theme needs a stack, or the capture breaks on
    // any machine that does not happen to have that font.
    fontFamily: tokens.fonts?.[0]?.value ? `${tokens.fonts[0].value}, system-ui, sans-serif` : null,
    shadow: tokens.shadows?.length ? 'soft' : 'none',
  });
}
