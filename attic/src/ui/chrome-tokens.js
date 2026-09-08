/**
 * Design tokens and base styling for the editor chrome.
 *
 * Follows design-system/web-interface-devtools/MASTER.md (Minimalism & Swiss Style,
 * "code dark + run green", density 9/10) plus the deviations recorded at the end of
 * that file. Read it before changing a value here.
 *
 * Light is the default appearance and dark is the toggle (§59). The two live in one
 * sheet: `:host` carries the whole light palette plus every appearance-independent
 * value, and `:host([data-widt-appearance="dark"])` redefines only the colours. Nothing
 * outside this file may hard-code a colour, or the toggle leaves it behind.
 *
 * Everything is scoped to a shadow root, so the page cannot reach these rules and these
 * rules cannot reach the page (§55).
 */

export const APPEARANCE_ATTR = 'data-widt-appearance';

export const tokens = /* css */ `
:host {
  /* ─── Light appearance (default) ─────────────────────────────────────── */

  /* Surfaces: panels sit on --surface, recessed controls on --bg */
  --bg: #EEF1F5;
  --surface: #FFFFFF;
  --surface-raised: #F4F6F9;
  --muted: #E9ECF2;

  /* Text — every value clears 4.5:1 on the surface it is used on */
  --fg: #0F172A;
  --fg-muted: #475569;
  --fg-dim: #64748B;

  /* Lines: --border for real separators, --hairline for internal rhythm */
  --border: #C4CCD8;
  --hairline: #E3E7ED;

  /* Extension chrome accent (active tool, primary action, committed state).
     Darker than the dark-mode green: the light green is unreadable on white. */
  --accent: #15803D;
  --accent-hover: #166534;
  --on-accent: #FFFFFF;
  --accent-dim: rgba(21, 128, 61, 0.12);

  --danger: #DC2626;
  --danger-dim: rgba(220, 38, 38, 0.10);
  --danger-hover: rgba(220, 38, 38, 0.18);
  --warning: #B45309;
  --warning-dim: rgba(180, 83, 9, 0.12);

  /* The focus ring has to beat the chrome behind it, so it flips with the palette. */
  --ring: #0F172A;

  --shadow-panel: 0 1px 2px rgba(15, 23, 42, 0.06), 0 8px 24px rgba(15, 23, 42, 0.12);
  --shadow-pop: 0 12px 32px rgba(15, 23, 42, 0.20);

  /* ─── Appearance-independent ─────────────────────────────────────────── */

  /* Marks drawn on the host page — matches the product icon. These do not follow the
     chrome appearance: they are read against the page, not against the panels. */
  --selection: #6366F1;
  --selection-soft: rgba(99, 102, 241, 0.18);
  --selection-dim: rgba(99, 102, 241, 0.10);
  /* Outlines can sit at the icon colour, but 11px white on it is only 4.47:1. Anything
     that carries a label takes the deeper indigo instead. */
  --selection-strong: #4F46E5;
  --on-selection: #FFFFFF;
  --measure: #F59E0B;
  --on-measure: #1A1205;

  /* Density 9/10 */
  --space-1: 2px;
  --space-2: 4px;
  --space-3: 6px;
  --space-4: 8px;
  --space-5: 12px;
  --space-6: 16px;
  --space-7: 24px;

  --radius-sm: 3px;
  --radius: 5px;
  --radius-lg: 8px;

  /* 12px is the body floor; 11px is reserved for uppercase micro-labels */
  --text-micro: 11px;
  --text-body: 12px;
  --text-md: 13px;

  --control-h: 24px;
  --button-h: 28px;

  --font-sans: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;

  --ease: cubic-bezier(0.2, 0, 0.2, 1);
  --dur: 140ms;

  /* Internal stacking scale; the host itself owns the one maximal z-index */
  --z-marks: 10;
  --z-dock: 20;
  --z-bar: 30;
  --z-pop: 50;
}

/* ─── Dark appearance (toggle) ─────────────────────────────────────────── */
:host([data-widt-appearance="dark"]) {
  --bg: #0F172A;
  --surface: #1B2336;
  --surface-raised: #212B41;
  --muted: #272F42;

  --fg: #F8FAFC;
  --fg-muted: #94A3B8;
  --fg-dim: #64748B;

  --border: #475569;
  --hairline: #2A3348;

  --accent: #22C55E;
  --accent-hover: #16A34A;
  --on-accent: #0F172A;
  --accent-dim: rgba(34, 197, 94, 0.14);

  /* Lighter than the light-mode red: #EF4444 is only 4.16:1 on the dark panel. */
  --danger: #F87171;
  --danger-dim: rgba(239, 68, 68, 0.14);
  --danger-hover: rgba(239, 68, 68, 0.24);
  --warning: #F59E0B;
  --warning-dim: rgba(245, 158, 11, 0.16);

  --ring: #FFFFFF;

  --shadow-panel: 0 8px 24px rgba(0, 0, 0, 0.45), 0 1px 0 rgba(255, 255, 255, 0.04) inset;
  --shadow-pop: 0 12px 32px rgba(0, 0, 0, 0.55);
}
`;

export const base = /* css */ `
*, *::before, *::after { box-sizing: border-box; }

.widt-root {
  position: fixed;
  inset: 0;
  pointer-events: none;
  font-family: var(--font-sans);
  font-size: var(--text-body);
  line-height: 1.45;
  color: var(--fg);
  -webkit-font-smoothing: antialiased;
}

/* Only real controls take the pointer; the rest of the layer lets the page through. */
.widt-root [data-interactive] { pointer-events: auto; }

button, input, select, textarea {
  font: inherit;
  color: inherit;
  margin: 0;
}

button { cursor: pointer; background: none; border: none; padding: 0; }

/* Never remove the focus ring — replace it. Applies to every control below. */
:focus { outline: none; }
:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 1px;
  border-radius: var(--radius-sm);
}

::-webkit-scrollbar { width: 9px; height: 9px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--muted); border-radius: 5px; border: 2px solid transparent; background-clip: content-box; }
::-webkit-scrollbar-thumb:hover { background: var(--border); background-clip: content-box; }

.widt-mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.widt-sr {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}

@media (prefers-reduced-motion: reduce) {
  .widt-root *, .widt-root *::before, .widt-root *::after {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}
`;
