/**
 * Service worker (§79).
 *
 * Deliberately thin: lifecycle, the keyboard command, and message relay. All page
 * knowledge lives in the content script, because the worker can be evicted at any time
 * and must never be the place where editor state is kept.
 */

import { Msg, Mode } from '../shared/types.js';

/** Pages where no extension content script can run — worth saying so plainly (§101). */
const RESTRICTED = /^(chrome|edge|about|devtools|view-source|chrome-extension|moz-extension):/i;

/** Toggle the editor from the keyboard (§58). */
chrome.commands?.onCommand.addListener(async (command) => {
  if (command !== 'toggle-editor') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  const status = await send(tab.id, { type: Msg.GET_STATUS });
  const next = status?.mode && status.mode !== Mode.OFF ? Mode.OFF : Mode.DESIGN;
  await send(tab.id, { type: Msg.SET_MODE, mode: next });
});

/**
 * Relay from the popup, which cannot message a tab directly without knowing its id.
 * Returning `true` keeps the response channel open for the async reply.
 */
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!message?.__relay) return false;
  (async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return respond({ ok: false, reason: 'No active tab.' });
    if (RESTRICTED.test(tab.url ?? '')) {
      return respond({ ok: false, reason: 'Browser pages cannot be edited.', restricted: true });
    }
    const result = await send(tab.id, message.payload);
    respond(result ?? { ok: false, reason: 'The page did not respond. Try reloading it.' });
  })();
  return true;
});

/** Badge shows how many saved changes are live on the current tab. */
async function updateBadge(tabId) {
  const status = await send(tabId, { type: Msg.GET_STATUS });
  const count = status?.changeCount ?? 0;
  await chrome.action.setBadgeText({ tabId, text: count ? String(count) : '' });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: status?.unmatched ? '#F59E0B' : '#22C55E' });
}

chrome.tabs?.onUpdated.addListener((tabId, info) => {
  if (info.status === 'complete') updateBadge(tabId).catch(() => {});
});
chrome.tabs?.onActivated.addListener(({ tabId }) => {
  updateBadge(tabId).catch(() => {});
});

/** Sends to a tab, resolving to null when no content script is listening. */
async function send(tabId, payload) {
  try {
    return await chrome.tabs.sendMessage(tabId, payload);
  } catch {
    return null;
  }
}
