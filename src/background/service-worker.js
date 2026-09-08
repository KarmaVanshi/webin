/**
 * Service worker.
 *
 * Deliberately thin: open the panel, keep the badge honest, and nothing else. All page
 * knowledge lives in the content script, because the worker can be evicted at any time
 * and must never be where state is kept.
 *
 * There is no popup. Clicking the toolbar icon opens the panel on the page itself, which
 * is the only surface this version has — a popup would be a second place to look for the
 * same list of themes.
 */

import { Msg } from '../shared/types.js';

/** Pages where no extension content script can run — worth saying so plainly. */
const RESTRICTED = /^(chrome|edge|about|devtools|view-source|chrome-extension|moz-extension):/i;

chrome.action?.onClicked.addListener(async (tab) => {
  await toggle(tab);
});

chrome.commands?.onCommand.addListener(async (command) => {
  if (command !== 'toggle-panel') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await toggle(tab);
});

async function toggle(tab) {
  if (!tab?.id) return;
  if (RESTRICTED.test(tab.url ?? '')) {
    await chrome.action.setTitle({ tabId: tab.id, title: 'Webin cannot run on browser pages' });
    return;
  }
  const result = await send(tab.id, { type: Msg.TOGGLE_PANEL });
  if (!result) {
    // The content script is not there — usually a tab that predates an install or reload.
    await chrome.action.setTitle({ tabId: tab.id, title: 'Webin — reload this page to start' });
  }
}

/**
 * Relays "the theme changed" from the top document to the rest of its frames.
 * A content script cannot address its own tab; the worker can.
 */
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type === Msg.FETCH_THEME) {
    fetchTheme(message.url).then(respond, (error) => respond({ ok: false, reason: String(error?.message ?? error) }));
    return true;  // an async responder must say so, or the channel closes first.
  }
  if (!message?.__webinBroadcast || !sender.tab?.id) return false;
  chrome.tabs.sendMessage(sender.tab.id, { type: Msg.SYNC }).catch(() => {});
  updateBadge(sender.tab.id).catch(() => {});
  respond({ ok: true });
  return false;
});

/** A theme file is small. Anything of this size is not one, and is not worth reading. */
const MAX_THEME_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT = 15000;

/**
 * Fetches a theme the user pasted a URL for.
 *
 * This runs in the worker rather than the content script for two reasons: a page's CSP
 * governs fetches made from it, so half the web would refuse; and a request issued from
 * the page's context is a request the page can see. Neither is acceptable for something
 * the user asked *Webin* to go and get.
 *
 * `credentials: 'omit'` matters — the extension holds host permissions for every site, so
 * without it this would be a way to pull down a page using the user's own logged-in
 * cookies. A theme never needs them.
 */
async function fetchTheme(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl ?? ''));
  } catch {
    return { ok: false, reason: 'That is not a web address.' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, reason: 'Only http and https addresses can be fetched.' };
  }

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), FETCH_TIMEOUT);
  try {
    const response = await fetch(url.href, {
      credentials: 'omit',
      redirect: 'follow',
      signal: abort.signal,
      headers: { accept: 'text/css, application/json, text/plain, text/html;q=0.8, */*;q=0.5' },
    });
    if (!response.ok) return { ok: false, reason: `${url.host} answered ${response.status}.` };

    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > MAX_THEME_BYTES) return { ok: false, reason: 'That file is too big to be a theme.' };

    const text = await response.text();
    if (text.length > MAX_THEME_BYTES) return { ok: false, reason: 'That file is too big to be a theme.' };
    return { ok: true, text, url: response.url, host: url.host };
  } catch (error) {
    return {
      ok: false,
      reason: error?.name === 'AbortError' ? `${url.host} took too long to answer.` : `Could not reach ${url.host}.`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** The badge is a dot: this site is wearing a theme. */
async function updateBadge(tabId) {
  const status = await send(tabId, { type: Msg.GET_STATUS });
  const on = Boolean(status?.theme);
  await chrome.action.setBadgeText({ tabId, text: on ? '●' : '' });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: '#15803D' });
  await chrome.action.setTitle({
    tabId,
    title: on ? `Webin — ${status.theme.name}` : 'Webin — themes for any site',
  });
}

chrome.tabs?.onUpdated.addListener((tabId, info) => {
  if (info.status === 'complete') updateBadge(tabId).catch(() => {});
});
chrome.tabs?.onActivated.addListener(({ tabId }) => {
  updateBadge(tabId).catch(() => {});
});

/**
 * Sends to a tab's main frame, resolving to null when no content script is listening.
 *
 * The frame is named explicitly because the content script also runs in iframes — so that
 * an embedded player or advert wears the page's theme too — and without `frameId` the
 * answer could come back from an advert.
 */
async function send(tabId, payload) {
  try {
    return await chrome.tabs.sendMessage(tabId, payload, { frameId: 0 });
  } catch {
    return null;
  }
}
