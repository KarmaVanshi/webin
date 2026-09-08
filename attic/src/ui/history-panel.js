/**
 * History panel (§6.4).
 * Shows the grouped operations the History Engine records, newest first, with the
 * low-level before/after pairs available underneath each one.
 */

import { escapeHtml } from '../shared/util.js';
import { emptyState, button } from './controls.js';
import { icon } from './icons.js';

export function renderHistory({ list, pending }) {
  if (!list.length && !pending.length) {
    return emptyState({
      iconName: 'history',
      title: 'No changes yet',
      body: 'Edits you make appear here. Every one can be undone, redone or reverted on its own.',
    });
  }

  const items = list.map((op) => `
<div class="widt-history-item" data-interactive>
  <span class="widt-history-label">${escapeHtml(op.label)}</span>
  <button type="button" class="widt-icon-btn is-danger" data-interactive
    data-action="revert-operation" data-value="${escapeHtml(op.id)}"
    title="Revert this change" aria-label="Revert ${escapeHtml(op.label)}">${icon('reset', 13)}</button>
</div>
<div class="widt-history-detail" style="padding:0 var(--space-5) var(--space-3)">
  ${op.detail.map((d) => escapeHtml(d)).join('<br>')}
</div>`).join('');

  const undone = pending.map((op) => `
<div class="widt-history-item is-undone">
  <span class="widt-history-label">${escapeHtml(op.label)}</span>
  <span class="widt-badge widt-badge--dim">Undone</span>
</div>`).join('');

  return `${items}${undone}
<div style="display:flex;gap:var(--space-2);padding:var(--space-5)">
  ${button({ label: 'Reset page', action: 'reset-page', name: 'reset', variant: 'danger' })}
</div>`;
}
