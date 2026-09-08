/**
 * Everything the panel looks like.
 *
 * Scoped to a shadow root, so the page cannot reach these rules and — more importantly —
 * the theme the extension is applying to the page cannot reach them either. The panel has
 * to stay legible while the site behind it turns into Bauhaus.
 *
 * Light is the default and dark is a toggle. Both live in one sheet: `:host` carries the
 * whole light palette plus every appearance-independent value, and the dark block
 * redefines only the colours. Nothing outside this file may hard-code a colour, or the
 * toggle leaves it behind.
 */

export const panelCss = /* css */ `
:host {
  /* ── Light appearance (default) ───────────────────────────────────── */
  --bg: #F3F5F8;
  --surface: #FFFFFF;
  --raised: #F7F9FC;
  --muted: #EBEEF3;

  --fg: #0F172A;
  --fg-muted: #4A5568;
  --fg-dim: #6B7280;

  --border: #C7CEDA;
  --hairline: #E4E8EE;

  --accent: #15803D;
  --accent-hover: #166534;
  --on-accent: #FFFFFF;
  --accent-dim: rgba(21, 128, 61, 0.12);

  --danger: #B91C1C;
  --danger-dim: rgba(185, 28, 28, 0.10);

  --ring: #0F172A;
  --shadow: 0 1px 2px rgba(15, 23, 42, 0.08), 0 12px 34px rgba(15, 23, 42, 0.18);
  --pop-shadow: 0 8px 28px rgba(15, 23, 42, 0.22);
  --preview-edge: rgba(15, 23, 42, 0.16);

  /* ── Appearance-independent ───────────────────────────────────────── */
  --space-1: 2px;
  --space-2: 4px;
  --space-3: 6px;
  --space-4: 8px;
  --space-5: 12px;
  --space-6: 16px;

  --radius-sm: 4px;
  --radius: 8px;
  --radius-lg: 12px;

  --text-micro: 11px;
  --text-body: 12px;
  --text-md: 13px;

  --font-sans: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;

  --ease: cubic-bezier(0.2, 0, 0.2, 1);
  --dur: 130ms;
}

:host([data-webin-appearance="dark"]) {
  --bg: #0F172A;
  --surface: #171F32;
  --raised: #1E2739;
  --muted: #262F44;

  --fg: #F8FAFC;
  --fg-muted: #A3B0C2;
  --fg-dim: #7A8699;

  --border: #46536B;
  --hairline: #2A3346;

  --accent: #22C55E;
  --accent-hover: #16A34A;
  --on-accent: #06210F;
  --accent-dim: rgba(34, 197, 94, 0.16);

  --danger: #F87171;
  --danger-dim: rgba(248, 113, 113, 0.14);

  --ring: #FFFFFF;
  --shadow: 0 12px 40px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.05);
  --pop-shadow: 0 10px 30px rgba(0, 0, 0, 0.6);
  --preview-edge: rgba(255, 255, 255, 0.18);
}

*, *::before, *::after { box-sizing: border-box; }

.wb-root {
  position: fixed;
  inset: 0;
  pointer-events: none;
  font-family: var(--font-sans);
  font-size: var(--text-body);
  line-height: 1.45;
  color: var(--fg);
  -webkit-font-smoothing: antialiased;
}

button, input, textarea { font: inherit; color: inherit; margin: 0; }
button { cursor: pointer; background: none; border: none; padding: 0; }
:focus { outline: none; }
:focus-visible { outline: 2px solid var(--ring); outline-offset: 1px; border-radius: var(--radius-sm); }

/* ── The panel ──────────────────────────────────────────────────────── */

.wb-panel {
  pointer-events: auto;
  position: absolute;
  bottom: 16px;
  right: 16px;
  width: 320px;
  max-height: min(600px, calc(100vh - 32px));
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow);
  overflow: hidden;
  animation: wb-in var(--dur) var(--ease);
}
.wb-panel[data-side="left"] { right: auto; left: 16px; }

@keyframes wb-in {
  from { opacity: 0; transform: translateY(6px) scale(0.99); }
  to { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: reduce) {
  .wb-panel { animation: none; }
  .wb-root *, .wb-root *::before, .wb-root *::after { transition-duration: 0.01ms !important; }
}

/* ── Header ─────────────────────────────────────────────────────────── */

.wb-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: 0 var(--space-3) 0 var(--space-5);
  height: 38px;
  flex: none;
  border-bottom: 1px solid var(--hairline);
  background: var(--surface);
}
.wb-mark {
  width: 9px; height: 9px; flex: none;
  border-radius: 3px;
  background: var(--accent);
}
.wb-name { font-size: var(--text-md); font-weight: 650; letter-spacing: -0.01em; }
.wb-host {
  flex: 1; min-width: 0;
  font-family: var(--font-mono);
  font-size: var(--text-micro);
  color: var(--fg-dim);
  text-align: right;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.wb-icon-btn {
  flex: none;
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px;
  border-radius: var(--radius-sm);
  color: var(--fg-muted);
  transition: background var(--dur) var(--ease), color var(--dur) var(--ease);
}
.wb-icon-btn:hover { background: var(--muted); color: var(--fg); }
.wb-icon-btn[aria-expanded="true"] { background: var(--muted); color: var(--fg); }

/* ── Gallery ────────────────────────────────────────────────────────── */

.wb-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  background: var(--bg);
}
.wb-body::-webkit-scrollbar { width: 10px; }
.wb-body::-webkit-scrollbar-track { background: transparent; }
.wb-body::-webkit-scrollbar-thumb {
  background: var(--border); border-radius: 6px;
  border: 3px solid transparent; background-clip: content-box;
}

.wb-section {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: var(--space-4) var(--space-5) var(--space-2);
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--fg-dim);
  background: var(--bg);
}

.wb-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
  padding: 0 var(--space-5) var(--space-5);
}

.wb-cell { position: relative; display: flex; min-width: 0; }

.wb-card {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--hairline);
  border-radius: var(--radius);
  background: var(--surface);
  text-align: left;
  transition: border-color var(--dur) var(--ease), transform var(--dur) var(--ease);
}
.wb-card:hover { border-color: var(--border); }
.wb-card:active { transform: scale(0.985); }
.wb-card.is-on { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }

/* The preview is the theme rendered in miniature: palette, radius and shadow together. */
.wb-prev {
  display: flex;
  flex-direction: column;
  gap: 3px;
  height: 58px;
  padding: 6px;
  border: 1px solid var(--preview-edge);
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.wb-prev-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  padding: 4px 5px;
  margin-bottom: 3px;
  border: 1px solid transparent;
}
.wb-line { height: 3px; border-radius: 2px; }
.wb-pill { width: 16px; height: 7px; flex: none; }

.wb-card-name {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-micro);
  font-weight: 600;
  color: var(--fg);
  min-width: 0;
}
.wb-card-name span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wb-check { margin-left: auto; color: var(--accent); display: inline-flex; flex: none; }

/* Deleting one of your own themes is a hover affordance, not a permanent control. */
.wb-card-del {
  position: absolute;
  top: 3px; right: 3px;
  width: 20px; height: 20px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--fg-dim);
  opacity: 0;
  transition: opacity var(--dur) var(--ease), color var(--dur) var(--ease);
}
.wb-cell:hover .wb-card-del, .wb-card-del:focus-visible { opacity: 1; }
.wb-card-del:hover { color: var(--danger); background: var(--danger-dim); }

/* ── Footer ─────────────────────────────────────────────────────────── */

.wb-foot {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-3) var(--space-3) var(--space-5);
  min-height: 38px;
  border-top: 1px solid var(--hairline);
  background: var(--surface);
}
.wb-foot-label {
  flex: 1; min-width: 0;
  font-size: var(--text-micro);
  color: var(--fg-muted);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.wb-foot-label b { color: var(--fg); font-weight: 650; }

.wb-btn {
  flex: none;
  display: inline-flex; align-items: center; gap: var(--space-2);
  height: 26px;
  padding: 0 var(--space-4);
  border-radius: var(--radius-sm);
  border: 1px solid var(--hairline);
  background: var(--raised);
  color: var(--fg);
  font-size: var(--text-micro);
  font-weight: 600;
  transition: background var(--dur) var(--ease), border-color var(--dur) var(--ease);
}
.wb-btn:hover { background: var(--muted); border-color: var(--border); }
.wb-btn--primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.wb-btn--primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
.wb-btn--quiet { background: transparent; border-color: transparent; color: var(--fg-muted); }
.wb-btn--quiet:hover { background: var(--muted); color: var(--fg); }
.wb-btn[disabled] { opacity: 0.45; pointer-events: none; }

/* ── Menu ───────────────────────────────────────────────────────────── */

.wb-menu {
  position: absolute;
  top: 40px;
  right: var(--space-3);
  z-index: 3;
  width: 216px;
  padding: var(--space-2);
  background: var(--surface);
  border: 1px solid var(--hairline);
  border-radius: var(--radius);
  box-shadow: var(--pop-shadow);
}
.wb-menu-item {
  display: flex; align-items: center; gap: var(--space-4);
  width: 100%;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-sm);
  font-size: var(--text-body);
  color: var(--fg);
  text-align: left;
}
.wb-menu-item:hover { background: var(--muted); }
.wb-menu-item[disabled] { opacity: 0.4; pointer-events: none; }
.wb-menu-item svg { color: var(--fg-dim); flex: none; }
.wb-menu-sep { height: 1px; margin: var(--space-2) var(--space-3); background: var(--hairline); }

/* A checkable menu item states its setting in words as well as by the tick, because a
   tick that is merely dimmer than another tick is not a state anyone can read. */
.wb-menu-item[role="menuitemcheckbox"][aria-checked="false"] svg { opacity: 0.25; }
.wb-menu-state {
  margin-left: auto;
  font-size: var(--text-micro);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--fg-dim);
}
.wb-menu-item[role="menuitemcheckbox"][aria-checked="true"] .wb-menu-state { color: var(--accent); }

/* ── Import sheet ───────────────────────────────────────────────────── */
/* A single-line variant of the textarea, for the URL field. */
.wb-input--line { min-height: 0; height: 30px; resize: none; white-space: nowrap; flex: 1; }

/* A card in the import preview is a picture, not a control: it must not look pressable. */
.wb-card.is-static { cursor: default; }
.wb-card.is-static:hover { border-color: var(--hairline); transform: none; }

.wb-details { font-size: var(--text-micro); color: var(--fg-dim); }
.wb-details > summary { cursor: pointer; padding: var(--space-2) 0; }
.wb-details > summary:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
.wb-notes {
  margin: 0; padding: 0 0 var(--space-2) var(--space-4);
  display: flex; flex-direction: column; gap: 2px;
  font-family: var(--font-mono);
  list-style: none;
}


.wb-sheet { padding: var(--space-5); background: var(--bg); }
.wb-label {
  display: block;
  margin-bottom: var(--space-3);
  font-size: var(--text-micro);
  font-weight: 600;
  color: var(--fg-muted);
}
.wb-input {
  width: 100%;
  min-height: 92px;
  padding: var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--fg);
  font-family: var(--font-mono);
  font-size: var(--text-micro);
  line-height: 1.5;
  resize: vertical;
}
.wb-input::placeholder { color: var(--fg-dim); }
.wb-row { display: flex; align-items: center; gap: var(--space-3); margin-top: var(--space-4); }
.wb-hint {
  margin: var(--space-4) 0 0;
  font-size: var(--text-micro);
  color: var(--fg-dim);
  line-height: 1.5;
}
.wb-code {
  display: block;
  margin-top: var(--space-3);
  padding: var(--space-4);
  max-height: 88px;
  overflow: auto;
  overflow-wrap: anywhere;
  background: var(--surface);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--fg-muted);
}

/* ── Empty and toast ────────────────────────────────────────────────── */

.wb-empty {
  padding: var(--space-6) var(--space-5);
  text-align: center;
  color: var(--fg-dim);
  font-size: var(--text-micro);
}

.wb-toast {
  position: absolute;
  left: var(--space-5);
  right: var(--space-5);
  bottom: 46px;
  z-index: 4;
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-4);
  border-radius: var(--radius);
  background: var(--fg);
  color: var(--surface);
  font-size: var(--text-micro);
  line-height: 1.45;
  box-shadow: var(--pop-shadow);
  animation: wb-in var(--dur) var(--ease);
}
.wb-toast--error { background: var(--danger); color: #FFFFFF; }
.wb-toast svg { flex: none; margin-top: 1px; }


/* ── Editor: mode switch ────────────────────────────────────────────── */
/* Two tabs in the header, because the page is the workspace either way and a second
   window would only be a second place to look for the same site. */
.wb-modes {
  display: flex; gap: 1px; padding: 1px;
  background: var(--muted);
  border-radius: var(--radius-sm);
}
.wb-mode {
  padding: 2px var(--space-3);
  border-radius: 3px;
  font-size: var(--text-micro);
  font-weight: 600;
  color: var(--fg-dim);
  letter-spacing: 0.01em;
}
.wb-mode:hover { color: var(--fg); }
.wb-mode.is-on { background: var(--surface); color: var(--fg); }
.wb-mode:focus-visible { outline: 2px solid var(--ring); outline-offset: 1px; }

/* Editing needs the room; browsing themes does not. */
.wb-panel[data-view="edit"] { width: 360px; }

/* ── Editor: the selected element ───────────────────────────────────── */
.webin-selection {
  display: flex; flex-direction: column; gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--hairline);
}
.webin-selection-id { display: flex; align-items: baseline; gap: var(--space-3); }
.webin-selection-label {
  flex: 1; min-width: 0;
  font-size: var(--text-body); font-weight: 600; color: var(--fg);
  /* An element label can be any length the site's markup makes it. */
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.webin-selection-size { font-size: var(--text-micro); color: var(--fg-dim); flex: none; }

/* ── Editor: sections ───────────────────────────────────────────────── */
.webin-section { border-bottom: 1px solid var(--hairline); }
.webin-section-head { margin: 0; display: flex; align-items: center; }
.webin-section-toggle {
  flex: 1; display: flex; align-items: center; gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  font-size: var(--text-micro); font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.05em; color: var(--fg-dim); text-align: left;
}
.webin-section-toggle:hover { color: var(--fg); }
.webin-section-toggle:focus-visible { outline: 2px solid var(--ring); outline-offset: -2px; }
.webin-caret { display: inline-flex; transition: transform var(--dur) var(--ease); color: var(--fg-dim); }
.webin-caret.is-open { transform: rotate(90deg); }
.webin-section-body {
  display: flex; flex-direction: column; gap: var(--space-3);
  padding: 0 var(--space-4) var(--space-4);
}

/* ── Editor: control rows ───────────────────────────────────────────── */
.webin-row { display: grid; grid-template-columns: 92px 1fr; align-items: center; gap: var(--space-3); }
/* A row of buttons is a row, not a labelled control — and this has to come after the rule
   above, or the grid wins and the buttons are spread across its columns. */
.webin-row--actions { display: flex; gap: var(--space-2); padding: 0; }
.webin-row--compact { grid-template-columns: 92px 1fr; }
.webin-row--box { grid-template-columns: 1fr; gap: var(--space-2); }
.webin-row--readonly { grid-template-columns: 92px 1fr; }
.webin-label { font-size: var(--text-micro); color: var(--fg-dim); }
.webin-field { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
.webin-hint { grid-column: 1 / -1; margin: 0; font-size: var(--text-micro); color: var(--fg-dim); }
.webin-mono { font-family: var(--font-mono); }

.webin-input, .webin-select, .webin-unit {
  min-width: 0; height: 26px; padding: 0 var(--space-2);
  border: 1px solid var(--hairline); border-radius: var(--radius-sm);
  background: var(--surface); color: var(--fg);
  font-size: var(--text-micro); font-family: inherit;
}
.webin-input { flex: 1; }
.webin-input--tiny { width: 100%; text-align: center; padding: 0 2px; }
.webin-input:focus-visible, .webin-select:focus-visible, .webin-unit:focus-visible,
.webin-range:focus-visible, .webin-swatch:focus-visible {
  outline: 2px solid var(--ring); outline-offset: 1px; border-color: var(--accent);
}
/* A number input's spinner steals width the value needs. */
.webin-input[type="number"] { -moz-appearance: textfield; appearance: textfield; }
.webin-input[type="number"]::-webkit-outer-spin-button,
.webin-input[type="number"]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.webin-unit { width: 46px; flex: none; color: var(--fg-dim); }
.webin-select { width: 100%; }
/* "Mixed" across a multiple selection: shown as absence, never as a real value. */
.webin-input[data-mixed="true"]::placeholder { color: var(--fg-dim); font-style: italic; }

.webin-swatch-wrap {
  flex: none; width: 26px; height: 26px;
  border: 1px solid var(--hairline); border-radius: var(--radius-sm);
  overflow: hidden;
  /* Chequerboard, so a translucent colour reads as translucent rather than as pale. */
  background-image:
    linear-gradient(45deg, var(--muted) 25%, transparent 25%, transparent 75%, var(--muted) 75%),
    linear-gradient(45deg, var(--muted) 25%, transparent 25%, transparent 75%, var(--muted) 75%);
  background-size: 8px 8px;
  background-position: 0 0, 4px 4px;
}
.webin-swatch { width: 100%; height: 100%; padding: 0; border: 0; background: none; cursor: pointer; }
.webin-swatch::-webkit-color-swatch-wrapper { padding: 0; }
.webin-swatch::-webkit-color-swatch { border: 0; }

.webin-range { flex: 1; accent-color: var(--accent); }
.webin-output { flex: none; min-width: 42px; text-align: right; font-size: var(--text-micro); color: var(--fg-dim); }

.webin-segmented { display: flex; gap: 1px; padding: 1px; background: var(--muted); border-radius: var(--radius-sm); }
.webin-seg {
  flex: 1; min-height: 24px; padding: 0 var(--space-2);
  border-radius: 3px; font-size: var(--text-micro); color: var(--fg-dim);
  display: inline-flex; align-items: center; justify-content: center;
}
.webin-seg:hover { color: var(--fg); }
.webin-seg.is-on { background: var(--surface); color: var(--fg); }
.webin-seg:focus-visible { outline: 2px solid var(--ring); outline-offset: 1px; }

.webin-box-head { display: flex; align-items: center; justify-content: space-between; }
.webin-box-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--space-2); }
.webin-box-cell { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.webin-box-tag { font-size: 9px; color: var(--fg-dim); letter-spacing: 0.04em; }

.webin-readonly { font-size: var(--text-micro); color: var(--fg); }
.webin-source { font-size: 9px; color: var(--fg-dim); text-transform: uppercase; letter-spacing: 0.04em; }
.webin-badge { padding: 1px 4px; border-radius: 3px; background: var(--muted); font-size: 9px; color: var(--fg-dim); }

.webin-btn {
  height: 26px; padding: 0 var(--space-4);
  border: 1px solid var(--hairline); border-radius: var(--radius-sm);
  background: var(--surface); color: var(--fg);
  font-size: var(--text-micro); font-weight: 600;
  display: inline-flex; align-items: center; gap: var(--space-2);
}
.webin-btn:hover:not([disabled]) { background: var(--muted); }
.webin-btn[disabled] { opacity: 0.45; pointer-events: none; }
.webin-btn:focus-visible { outline: 2px solid var(--ring); outline-offset: 1px; }
.webin-btn--primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.webin-btn--primary:hover:not([disabled]) { filter: brightness(1.08); }
.webin-btn--danger { color: var(--danger); border-color: var(--danger); }
.webin-btn--tiny { height: 22px; padding: 0 var(--space-3); }

/* WCAG 2.2 asks for 24 CSS px of pointer target. The glyph is smaller than that on
   purpose; the button is not. */
.webin-icon-btn {
  min-width: 26px; min-height: 26px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: var(--radius-sm); color: var(--fg-dim);
}
.webin-icon-btn:hover { background: var(--muted); color: var(--fg); }
.webin-icon-btn.is-on { background: var(--muted); color: var(--accent); }
.webin-icon-btn:focus-visible { outline: 2px solid var(--ring); outline-offset: 1px; }
.webin-icon-btn--danger:hover { color: var(--danger); }

/* ── Editor: contrast note ──────────────────────────────────────────── */
/* Colour is never the only signal here: there is an icon and the ratio in figures. */
.webin-note {
  grid-column: 1 / -1;
  display: flex; align-items: center; gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  background: var(--muted);
  font-size: var(--text-micro); color: var(--fg-dim);
}
.webin-note b { color: var(--fg); font-variant-numeric: tabular-nums; }
.webin-note--warn { background: var(--danger-dim); color: var(--fg); }
.webin-note--warn svg { color: var(--danger); }
.webin-note .webin-btn { margin-left: auto; flex: none; }

/* ── Editor: empty state and bar ────────────────────────────────────── */
.webin-empty {
  display: flex; flex-direction: column; align-items: center; gap: var(--space-3);
  padding: var(--space-6) var(--space-5);
  text-align: center;
}
.webin-empty-icon { color: var(--fg-dim); opacity: 0.5; }
.webin-empty-title { font-size: var(--text-body); font-weight: 600; color: var(--fg); }
.webin-empty-body { font-size: var(--text-micro); color: var(--fg-dim); max-width: 30ch; line-height: 1.5; }

.webin-bar {
  display: flex; align-items: center; gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border-top: 1px solid var(--hairline);
  background: var(--raised);
}
.webin-bar-gap { flex: 1; }

/* Visually hidden, still read aloud. */
.webin-sr {
  position: absolute; width: 1px; height: 1px;
  padding: 0; margin: -1px; overflow: hidden;
  clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
`;
