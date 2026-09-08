/**
 * The command toolbar (§59).
 * Context-sensitive: tools that cannot act on the current selection are disabled rather
 * than hidden, so the toolbar never changes shape under the pointer.
 */

import { Mode, Panel } from '../shared/types.js';
import { icon } from './icons.js';
import { escapeHtml } from '../shared/util.js';

const TOOLS = [
  { id: Mode.INSPECT, label: 'Inspect', icon: 'inspect', title: 'Inspect — read the page, clicks still work' },
  { id: Mode.DESIGN, label: 'Design', icon: 'cursor', title: 'Design — select and edit elements' },
];

const PANELS = [
  { id: Panel.LAYERS, icon: 'layers', title: 'Layers' },
  { id: Panel.INSPECTOR, icon: 'spacing', title: 'Inspector' },
  { id: Panel.THEMES, icon: 'palette', title: 'Themes and design system' },
  { id: Panel.HISTORY, icon: 'history', title: 'History' },
  { id: Panel.RESPONSIVE, icon: 'responsive', title: 'Responsive' },
];

export function renderToolbar(state) {
  const { mode, activePanel, canUndo, canRedo, dirty, hasSelection, layersVisible, inspectorVisible,
    appearance = 'light' } = state;
  const dark = appearance === 'dark';

  const modes = TOOLS.map((tool) => `
    <button type="button" class="widt-tool${mode === tool.id ? ' is-on' : ''}" data-interactive
      data-action="set-mode" data-value="${tool.id}"
      role="radio" aria-checked="${mode === tool.id}" title="${escapeHtml(tool.title)}">
      ${icon(tool.icon, 14)}<span>${tool.label}</span>
    </button>`).join('');

  const panels = PANELS.map((panel) => {
    const on = panel.id === Panel.LAYERS ? layersVisible
      : panel.id === Panel.INSPECTOR ? inspectorVisible
      : activePanel === panel.id;
    return `<button type="button" class="widt-tool widt-tool--icon${on ? ' is-on' : ''}" data-interactive
      data-action="toggle-panel" data-value="${panel.id}"
      title="${escapeHtml(panel.title)}" aria-label="${escapeHtml(panel.title)}" aria-pressed="${on}">
      ${icon(panel.icon, 14)}</button>`;
  }).join('');

  return `
<div class="widt-toolbar" data-interactive role="toolbar" aria-label="Web Interface DevTools">
  <span class="widt-brand"><span class="widt-brand-dot"></span><span>DevTools</span></span>
  <span class="widt-divider"></span>
  <div style="display:flex;gap:2px" role="radiogroup" aria-label="Mode">${modes}</div>
  <span class="widt-divider"></span>
  ${panels}
  <span class="widt-divider"></span>
  <button type="button" class="widt-tool widt-tool--icon" data-interactive data-action="undo"
    title="Undo (Ctrl+Z)" aria-label="Undo" ${canUndo ? '' : 'disabled'}>${icon('undo', 14)}</button>
  <button type="button" class="widt-tool widt-tool--icon" data-interactive data-action="redo"
    title="Redo (Ctrl+Shift+Z)" aria-label="Redo" ${canRedo ? '' : 'disabled'}>${icon('redo', 14)}</button>
  <button type="button" class="widt-tool widt-tool--icon" data-interactive data-action="hide-selected"
    title="Hide selected (Delete)" aria-label="Hide selected element" ${hasSelection ? '' : 'disabled'}>${icon('eyeOff', 14)}</button>
  <span class="widt-divider"></span>
  <button type="button" class="widt-btn widt-btn--primary" data-interactive data-action="save"
    title="Save changes for this page (Ctrl+S)">
    ${icon('save', 13)}<span>Save${dirty ? ' •' : ''}</span></button>
  <button type="button" class="widt-tool widt-tool--icon${dark ? ' is-on' : ''}" data-interactive
    data-action="toggle-appearance"
    title="${dark ? 'Switch to light mode' : 'Switch to dark mode'}"
    aria-label="${dark ? 'Switch to light mode' : 'Switch to dark mode'}" aria-pressed="${dark}">
    ${icon(dark ? 'sun' : 'moon', 14)}</button>
  <button type="button" class="widt-tool widt-tool--icon" data-interactive data-action="close"
    title="Close editor (Esc)" aria-label="Close editor">${icon('close', 14)}</button>
</div>`;
}
