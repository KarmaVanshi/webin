/**
 * Responsive panel (§6.3, §50).
 *
 * Two distinct things live here, and the panel keeps them distinct:
 *   - a *viewport preset*, which only changes what you are looking at;
 *   - a *breakpoint scope*, which changes where the next edit gets written.
 */

import { VIEWPORT_PRESETS, Breakpoint, BREAKPOINT_MAX } from '../shared/types.js';
import { escapeHtml } from '../shared/util.js';
import { icon } from './icons.js';

export function renderResponsive({ viewport, breakpoint, actualWidth, actualHeight }) {
  const presets = VIEWPORT_PRESETS.map((preset) => `
<button type="button" class="widt-viewport${preset.id === viewport ? ' is-on' : ''}" data-interactive
  data-action="set-viewport" data-value="${preset.id}" aria-pressed="${preset.id === viewport}">
  <span>${escapeHtml(preset.label)}</span>
  <span class="widt-viewport-size widt-mono">${preset.width ? `${preset.width} × ${preset.height}` : 'window'}</span>
</button>`).join('');

  const scopes = [Breakpoint.ALL, Breakpoint.DESKTOP, Breakpoint.TABLET, Breakpoint.MOBILE].map((id) => {
    const max = BREAKPOINT_MAX[id];
    const range = id === Breakpoint.ALL ? 'every width' : max ? `≤ ${max}px` : '> 1024px';
    return `
<button type="button" class="widt-viewport${id === breakpoint ? ' is-on' : ''}" data-interactive
  data-action="set-breakpoint" data-value="${id}" aria-pressed="${id === breakpoint}">
  <span style="text-transform:capitalize">${id}</span>
  <span class="widt-viewport-size widt-mono">${range}</span>
</button>`;
  }).join('');

  return `
<div class="widt-viewport-list">
  <p class="widt-label" style="margin:0 0 var(--space-1)">Preview size</p>
  ${presets}
</div>
<div class="widt-viewport-list" style="border-top:1px solid var(--hairline)">
  <p class="widt-label" style="margin:0 0 var(--space-1)">Edits apply to</p>
  ${scopes}
  <p class="widt-hint" style="margin-top:var(--space-2)">
    New changes are written for the selected width range. “Every width” keeps them unscoped.</p>
</div>
<div class="widt-viewport-list" style="border-top:1px solid var(--hairline)">
  <div class="widt-status-item">${icon('info', 13)}
    <span class="widt-mono">Window ${actualWidth} × ${actualHeight}</span></div>
</div>`;
}
