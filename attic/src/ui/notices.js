/**
 * Error and status notices (§101, §102).
 *
 * The concept's rule is "never silently fail": when an element cannot be inspected, a
 * saved change cannot be matched, or a feature does not apply to what is selected, the
 * reason is stated and — where there is one — an action is offered.
 */

import { icon } from './icons.js';
import { escapeHtml, uid, Emitter } from '../shared/util.js';

const ICONS = { error: 'warning', warning: 'warning', success: 'check', info: 'info' };

export class Notices extends Emitter {
  #container;
  #items = new Map();

  constructor(container) {
    super();
    this.#container = container;
  }

  /**
   * @param {{tone?:string, title:string, text?:string, actions?:Array<{label:string, action:string, value?:string}>,
   *          timeout?:number, key?:string}} notice
   */
  show(notice) {
    // A keyed notice replaces its predecessor instead of stacking duplicates.
    if (notice.key) {
      for (const [id, item] of this.#items) if (item.key === notice.key) this.dismiss(id);
    }
    const id = uid('note');
    this.#items.set(id, { ...notice, id, key: notice.key ?? null });
    this.#render();
    // Only self-dismiss informational notices; anything needing a decision stays put.
    const timeout = notice.timeout ?? (notice.actions?.length ? 0 : 4500);
    if (timeout > 0) setTimeout(() => this.dismiss(id), timeout);
    return id;
  }

  dismiss(id) {
    if (this.#items.delete(id)) this.#render();
  }

  clear() {
    this.#items.clear();
    this.#render();
  }

  /** Routes a click inside the notice stack. Returns true when it was handled. */
  handleClick(target) {
    const button = target.closest?.('[data-notice-action]');
    if (!button) return false;
    const { noticeId, noticeAction, noticeValue } = button.dataset;
    if (noticeAction === 'dismiss') {
      this.dismiss(noticeId);
      return true;
    }
    this.emit('action', { action: noticeAction, value: noticeValue, id: noticeId });
    this.dismiss(noticeId);
    return true;
  }

  #render() {
    const items = [...this.#items.values()].slice(-4);
    this.#container.innerHTML = items.map((item) => {
      const tone = item.tone ?? 'info';
      const actions = (item.actions ?? []).map((a) => `
        <button type="button" class="widt-btn ${a.variant ? `widt-btn--${a.variant}` : ''}" data-interactive
          data-notice-action="${escapeHtml(a.action)}" data-notice-id="${item.id}"
          ${a.value ? `data-notice-value="${escapeHtml(a.value)}"` : ''}>
          <span>${escapeHtml(a.label)}</span></button>`).join('');

      return `
<div class="widt-notice widt-notice--${tone}" data-interactive role="${tone === 'error' ? 'alert' : 'status'}"
  aria-live="${tone === 'error' ? 'assertive' : 'polite'}">
  <span class="widt-notice-icon">${icon(ICONS[tone] ?? 'info', 15)}</span>
  <div class="widt-notice-body">
    <p class="widt-notice-title">${escapeHtml(item.title)}</p>
    ${item.text ? `<p class="widt-notice-text">${escapeHtml(item.text)}</p>` : ''}
    <div class="widt-notice-actions">${actions}
      <button type="button" class="widt-btn" data-interactive data-notice-action="dismiss"
        data-notice-id="${item.id}"><span>${item.actions?.length ? 'Skip' : 'Dismiss'}</span></button>
    </div>
  </div>
</div>`;
    }).join('');
  }
}
