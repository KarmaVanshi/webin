/**
 * Styling for the editor chrome — toolbar, docks, tree, inspector rows, controls.
 * Values come from design-system/web-interface-devtools/MASTER.md; see the deviations
 * section there before changing any of them.
 */

export const chromeCss = /* css */ `
/* ─── Toolbar (§59) ─────────────────────────────────────────────────────── */
.widt-toolbar {
  position: absolute;
  top: var(--space-5);
  left: 50%;
  transform: translateX(-50%);
  z-index: var(--z-bar);
  display: flex;
  align-items: center;
  gap: var(--space-2);
  max-width: calc(100vw - var(--space-7));
  padding: var(--space-2);
  background: var(--surface);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-panel);
}

.widt-brand {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: 0 var(--space-3) 0 var(--space-2);
  color: var(--fg-muted);
  font-size: var(--text-micro);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  white-space: nowrap;
}
.widt-brand-dot { width: 8px; height: 8px; border-radius: 2px; background: var(--selection); flex: none; }

.widt-divider { width: 1px; align-self: stretch; margin: 0 var(--space-1); background: var(--hairline); }

.widt-tool {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  height: var(--button-h);
  padding: 0 var(--space-4);
  color: var(--fg-muted);
  font-size: var(--text-body);
  font-weight: 500;
  white-space: nowrap;
  border-radius: var(--radius);
  transition: background var(--dur) var(--ease), color var(--dur) var(--ease);
}
.widt-tool:hover { background: var(--muted); color: var(--fg); }
.widt-tool.is-on { background: var(--accent-dim); color: var(--accent); }
.widt-tool[disabled] { opacity: 0.4; cursor: not-allowed; }
.widt-tool--icon { padding: 0; width: var(--button-h); justify-content: center; }

/* ─── Docked panels (§99) ───────────────────────────────────────────────── */
.widt-dock {
  position: absolute;
  top: 0;
  bottom: 26px;
  z-index: var(--z-dock);
  display: flex;
  flex-direction: column;
  background: var(--surface);
  box-shadow: var(--shadow-panel);
  overflow: hidden;
}
.widt-dock--left { left: 0; border-right: 1px solid var(--hairline); }
.widt-dock--right { right: 0; border-left: 1px solid var(--hairline); }
.widt-dock[hidden] { display: none; }

.widt-panel-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex: none;
  height: 34px;
  padding: 0 var(--space-3) 0 var(--space-5);
  border-bottom: 1px solid var(--hairline);
}
.widt-panel-title {
  flex: 1;
  min-width: 0;
  font-size: var(--text-micro);
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--fg-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.widt-panel-body { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; }

/* Drag edge to resize a dock (§99) */
.widt-resizer { position: absolute; top: 0; bottom: 0; width: 5px; cursor: ew-resize; z-index: 1; }
.widt-resizer:hover, .widt-resizer.is-active { background: var(--selection-soft); }
.widt-dock--left .widt-resizer { right: 0; }
.widt-dock--right .widt-resizer { left: 0; }

/* ─── Layers tree (§25) ─────────────────────────────────────────────────── */
.widt-tree { padding: var(--space-2) 0 var(--space-6); }

.widt-tree-row {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  width: 100%;
  height: 22px;
  padding-right: var(--space-3);
  color: var(--fg-muted);
  font-size: var(--text-body);
  text-align: left;
  white-space: nowrap;
}
.widt-tree-row:hover { background: var(--muted); color: var(--fg); }
.widt-tree-row.is-selected { background: var(--selection-soft); color: var(--fg); }
.widt-tree-row.is-hovered { background: var(--selection-dim); }
.widt-tree-row.is-hidden { opacity: 0.45; }

.widt-tree-twist {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  color: var(--fg-dim);
  border-radius: var(--radius-sm);
}
.widt-tree-twist:hover { color: var(--fg); background: var(--surface-raised); }
.widt-tree-twist .widt-icon { transition: transform var(--dur) var(--ease); }
.widt-tree-twist.is-open .widt-icon { transform: rotate(90deg); }

.widt-tree-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.widt-tree-badge { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }

/* ─── Inspector (§60) ───────────────────────────────────────────────────── */
.widt-selection-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-5);
  border-bottom: 1px solid var(--hairline);
  background: var(--surface-raised);
}
.widt-selection-name {
  flex: 1;
  min-width: 0;
  font-size: var(--text-md);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.widt-selection-meta { flex: none; color: var(--fg-dim); font-size: var(--text-micro); }

.widt-section { border-bottom: 1px solid var(--hairline); }
.widt-section-head { display: flex; align-items: center; margin: 0; }
.widt-section-toggle {
  flex: 1;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--control-h);
  padding: var(--space-3) var(--space-5);
  color: var(--fg-dim);
  font-size: var(--text-micro);
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.widt-section-toggle:hover { color: var(--fg); }
.widt-caret { display: inline-flex; transition: transform var(--dur) var(--ease); }
.widt-caret.is-open { transform: rotate(90deg); }
.widt-section-body { padding: 0 var(--space-5) var(--space-5); }

/* ─── Rows and fields (§62) ─────────────────────────────────────────────── */
.widt-row { display: grid; grid-template-columns: 74px 1fr; align-items: center; gap: var(--space-3); margin-bottom: var(--space-3); }
.widt-row--compact { grid-template-columns: 74px 1fr; }
.widt-row--box { display: block; }
.widt-row--readonly { grid-template-columns: 74px 1fr auto; }

.widt-label {
  min-width: 0;
  color: var(--fg-muted);
  font-size: var(--text-body);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.widt-field { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
.widt-field--number { gap: 0; }
.widt-field--slider { gap: var(--space-3); }

.widt-input, .widt-select, .widt-unit {
  height: var(--control-h);
  min-width: 0;
  padding: 0 var(--space-3);
  color: var(--fg);
  background: var(--bg);
  border: 1px solid var(--hairline);
  border-radius: var(--radius);
  font-size: var(--text-body);
  transition: border-color var(--dur) var(--ease), background var(--dur) var(--ease);
}
.widt-input { flex: 1; width: 100%; }
.widt-input:hover, .widt-select:hover, .widt-unit:hover { border-color: var(--border); }
.widt-input:focus-visible, .widt-select:focus-visible, .widt-unit:focus-visible { border-color: var(--selection); }
.widt-input::placeholder { color: var(--fg-dim); font-style: italic; }
.widt-input[data-mixed] { font-style: italic; }
.widt-input--tiny { padding: 0 var(--space-2); text-align: center; }

/* Number spinners waste horizontal space at this density. */
.widt-input[type="number"]::-webkit-outer-spin-button,
.widt-input[type="number"]::-webkit-inner-spin-button { appearance: none; margin: 0; }
.widt-input[type="number"] { appearance: textfield; }

.widt-field--number .widt-input { border-radius: var(--radius) 0 0 var(--radius); border-right: none; }
.widt-unit {
  flex: none;
  width: 48px;
  padding-right: var(--space-2);
  border-radius: 0 var(--radius) var(--radius) 0;
  color: var(--fg-muted);
  font-size: var(--text-micro);
}

.widt-select { flex: 1; width: 100%; }

.widt-field--color { gap: var(--space-3); }
.widt-swatch-wrap {
  flex: none;
  width: var(--control-h);
  height: var(--control-h);
  border-radius: var(--radius);
  border: 1px solid var(--border);
  overflow: hidden;
  /* Checkerboard shows through a translucent colour, so alpha is visible. */
  background-image:
    linear-gradient(45deg, var(--muted) 25%, transparent 25%),
    linear-gradient(-45deg, var(--muted) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, var(--muted) 75%),
    linear-gradient(-45deg, transparent 75%, var(--muted) 75%);
  background-size: 8px 8px;
  background-position: 0 0, 0 4px, 4px -4px, -4px 0;
}
.widt-swatch {
  display: block;
  width: 200%;
  height: 200%;
  margin: -50% 0 0 -50%;
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
}

.widt-segmented {
  display: flex;
  min-width: 0;
  padding: 2px;
  background: var(--bg);
  border: 1px solid var(--hairline);
  border-radius: var(--radius);
}
.widt-seg {
  flex: 1;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 20px;
  padding: 0 var(--space-2);
  color: var(--fg-muted);
  font-size: var(--text-micro);
  border-radius: var(--radius-sm);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: background var(--dur) var(--ease), color var(--dur) var(--ease);
}
.widt-seg:hover { color: var(--fg); }
.widt-seg.is-on { background: var(--selection-strong); color: var(--on-selection); }

.widt-range { flex: 1; min-width: 0; height: var(--control-h); accent-color: var(--selection); cursor: pointer; }
.widt-output { flex: none; width: 46px; text-align: right; color: var(--fg-muted); font-size: var(--text-micro); }

.widt-box-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-2); }
.widt-box-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--space-2); }
.widt-box-cell { position: relative; display: block; }
.widt-box-cell .widt-input { width: 100%; padding-right: 14px; }
.widt-box-tag {
  position: absolute;
  top: 50%;
  right: var(--space-2);
  transform: translateY(-50%);
  color: var(--fg-dim);
  font-size: 9px;
  font-weight: 600;
  pointer-events: none;
}

.widt-hint { grid-column: 1 / -1; margin: var(--space-1) 0 0; color: var(--fg-dim); font-size: var(--text-micro); }
.widt-readonly { min-width: 0; color: var(--fg); font-size: var(--text-body); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.widt-source { flex: none; color: var(--fg-dim); font-size: 10px; }

/* ─── Buttons and badges ────────────────────────────────────────────────── */
.widt-icon-btn {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--control-h);
  height: var(--control-h);
  color: var(--fg-muted);
  border-radius: var(--radius);
  transition: background var(--dur) var(--ease), color var(--dur) var(--ease);
}
.widt-icon-btn:hover { background: var(--muted); color: var(--fg); }
.widt-icon-btn.is-on { background: var(--accent-dim); color: var(--accent); }
.widt-icon-btn.is-danger:hover { background: var(--danger-dim); color: var(--danger); }

.widt-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  height: var(--button-h);
  padding: 0 var(--space-5);
  color: var(--fg);
  background: var(--muted);
  border: 1px solid transparent;
  border-radius: var(--radius);
  font-size: var(--text-body);
  font-weight: 500;
  white-space: nowrap;
  transition: background var(--dur) var(--ease), color var(--dur) var(--ease);
}
.widt-btn:hover { background: var(--surface-raised); }
.widt-btn--primary { background: var(--accent); color: var(--on-accent); font-weight: 600; }
.widt-btn--primary:hover { background: var(--accent-hover); }
.widt-btn--danger { color: var(--danger); background: var(--danger-dim); }
.widt-btn--danger:hover { background: var(--danger-hover); }
.widt-btn[disabled] { opacity: 0.4; cursor: not-allowed; }

.widt-badge {
  flex: none;
  padding: 1px var(--space-2);
  border-radius: var(--radius-sm);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.02em;
  white-space: nowrap;
}
.widt-badge--accent { background: var(--accent-dim); color: var(--accent); }
.widt-badge--warn { background: var(--warning-dim); color: var(--warning); }
.widt-badge--dim { background: var(--muted); color: var(--fg-dim); }

/* ─── Status bar ────────────────────────────────────────────────────────── */
.widt-status {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: var(--z-bar);
  display: flex;
  align-items: center;
  gap: var(--space-5);
  height: 26px;
  padding: 0 var(--space-5);
  background: var(--surface);
  border-top: 1px solid var(--hairline);
  color: var(--fg-muted);
  font-size: var(--text-micro);
}
.widt-status-item { display: inline-flex; align-items: center; gap: var(--space-2); white-space: nowrap; }
.widt-status-spacer { flex: 1; }
.widt-status-path { min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--fg-dim); }

/* ─── Notices (§101, §102) ──────────────────────────────────────────────── */
.widt-notices {
  position: absolute;
  right: var(--space-5);
  bottom: 34px;
  z-index: var(--z-pop);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  width: 320px;
  max-width: calc(100vw - var(--space-7));
}
.widt-notice {
  display: flex;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-5);
  background: var(--surface-raised);
  border: 1px solid var(--hairline);
  border-left: 3px solid var(--fg-dim);
  border-radius: var(--radius);
  box-shadow: var(--shadow-pop);
}
.widt-notice--warning { border-left-color: var(--warning); }
.widt-notice--error { border-left-color: var(--danger); }
.widt-notice--success { border-left-color: var(--accent); }
.widt-notice-icon { flex: none; color: var(--fg-muted); padding-top: 1px; }
.widt-notice-body { flex: 1; min-width: 0; }
.widt-notice-title { margin: 0; font-size: var(--text-body); font-weight: 600; }
.widt-notice-text { margin: var(--space-1) 0 0; color: var(--fg-muted); font-size: var(--text-micro); overflow-wrap: anywhere; }
.widt-notice-actions { display: flex; gap: var(--space-2); margin-top: var(--space-3); }

/* ─── Empty states (§8) ─────────────────────────────────────────────────── */
.widt-empty { padding: var(--space-7) var(--space-6); text-align: center; }
.widt-empty-icon { display: inline-flex; color: var(--fg-dim); }
.widt-empty-title { margin: var(--space-4) 0 var(--space-2); font-size: var(--text-body); font-weight: 600; }
.widt-empty-body { margin: 0; color: var(--fg-dim); font-size: var(--text-micro); line-height: 1.5; }

/* ─── History (§6.4) ────────────────────────────────────────────────────── */
.widt-history-item {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  width: 100%;
  padding: var(--space-3) var(--space-5);
  border-bottom: 1px solid var(--hairline);
  text-align: left;
}
.widt-history-item:hover { background: var(--muted); }
.widt-history-label { flex: 1; min-width: 0; font-size: var(--text-body); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.widt-history-detail { color: var(--fg-dim); font-size: var(--text-micro); overflow-wrap: anywhere; }
.widt-history-item.is-undone { opacity: 0.45; }

/* ─── Responsive (§6.3) ─────────────────────────────────────────────────── */
.widt-viewport-list { display: grid; gap: var(--space-2); padding: var(--space-5); }
.widt-viewport {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--hairline);
  border-radius: var(--radius);
  font-size: var(--text-body);
  color: var(--fg-muted);
}
.widt-viewport:hover { border-color: var(--border); color: var(--fg); }
.widt-viewport.is-on { border-color: var(--selection); background: var(--selection-dim); color: var(--fg); }
.widt-viewport-size { color: var(--fg-dim); font-size: var(--text-micro); }

/* At narrow widths the docks would leave no page visible; overlay them instead. */
@media (max-width: 900px) {
  .widt-dock { max-width: 60vw; }
  .widt-brand span { display: none; }
}
`;
