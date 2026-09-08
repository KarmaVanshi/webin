/**
 * Tokens for the selection overlay.
 *
 * The overlay has its own shadow root, separate from the panel's, so it cannot inherit
 * the panel's tokens and has to carry its own. That is not duplication for its own sake:
 * these marks are drawn *over an arbitrary website*, so they answer to a different
 * question than the panel does. The panel has to look like Webin. The overlay has to stay
 * visible on top of a black hero image, a white article and a neon gradient alike, which
 * is why it does not follow the light/dark chrome and does not use the theme's colours.
 *
 * Everything here is a mark, not a surface: one blue for selection, one amber for
 * measurement, and enough shadow under the labels that they read against anything.
 */
export const overlayTokens = /* css */ `
:host {
  /* Selection. Blue because it is the one hue almost no site uses for large fills. */
  --selection: #2563eb;
  --selection-strong: #1d4ed8;
  --selection-dim: rgba(37, 99, 235, 0.14);
  --on-selection: #ffffff;

  /* Measurement rules and their badges. */
  --measure: #b45309;
  --on-measure: #ffffff;

  /* Spacing bands: margin outside, padding inside, the Figma convention. */
  --margin-band: rgba(249, 168, 37, 0.28);
  --padding-band: rgba(56, 161, 105, 0.28);

  --shadow-pop: 0 2px 10px rgba(0, 0, 0, 0.35);
  --radius-sm: 4px;
  --space-3: 6px;
  --text-micro: 11px;
  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;

  /* One stacking context, one scale inside it. */
  --z-marks: 1;
}
`;
