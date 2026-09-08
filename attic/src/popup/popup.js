/**
 * Popup quick actions (§100).
 *
 * Everything here is a thin relay to the content script through the service worker; the
 * popup holds no state of its own beyond what it has just been told.
 */

import { Msg, Mode } from '../shared/types.js';

const $ = (id) => document.getElementById(id);

/** Sends through the worker, which knows the active tab. */
async function relay(payload) {
  try {
    return await chrome.runtime.sendMessage({ __relay: true, payload });
  } catch (error) {
    return { ok: false, reason: error?.message ?? 'The extension could not reach this page.' };
  }
}

function setStatus(text, isError = false) {
  const node = $('status');
  node.textContent = text;
  node.classList.toggle('error', isError);
}

/**
 * Two-step confirmation for destructive actions.
 *
 * A native `confirm()` is unreliable here: opening the dialog takes focus away from the
 * popup, the popup closes, and the call resolves false before the user can answer. The
 * button arms itself instead, and reverts after a few seconds if left alone.
 */
function armable(button, label, onConfirm) {
  let armed = false;
  let timer = null;
  const span = button.querySelector('span');
  const original = span.textContent;

  const disarm = () => {
    armed = false;
    button.classList.remove('armed');
    span.textContent = original;
    if (timer) clearTimeout(timer);
    timer = null;
  };

  button.addEventListener('click', async () => {
    if (!armed) {
      armed = true;
      button.classList.add('armed');
      span.textContent = 'Click again to confirm';
      timer = setTimeout(disarm, 3500);
      return;
    }
    disarm();
    await onConfirm();
  });

  return disarm;
}

async function refresh() {
  const status = await relay({ type: Msg.GET_STATUS });

  if (!status?.ok) {
    setStatus(status?.reason ?? 'This page cannot be edited.', true);
    for (const node of document.querySelectorAll('button, select')) node.disabled = true;
    $('scope').textContent = status?.restricted ? 'Browser page' : 'Not available here';
    return;
  }

  $('scope').textContent = `${status.host}${status.path}`;
  $('change-count').textContent = String(status.changeCount ?? 0);
  $('theme-name').textContent = status.theme?.name ?? 'None';

  for (const button of document.querySelectorAll('.mode')) {
    button.setAttribute('aria-checked', String(button.dataset.mode === status.mode));
  }

  const warn = $('warn');
  warn.hidden = !status.unmatched;
  if (status.unmatched) {
    warn.textContent = `${status.unmatched} saved change${status.unmatched === 1 ? '' : 's'} could not be placed on this page. Open the editor to remap them.`;
  }

  $('save').disabled = !status.dirty;
  $('save').textContent = status.dirty ? 'Save changes' : 'Saved';

  const themes = await relay({ type: Msg.LIST_THEMES });
  if (themes?.ok) {
    $('theme').innerHTML = ['<option value="">No theme</option>']
      .concat(themes.themes.map((t) =>
        `<option value="${t.id}"${t.id === themes.activeThemeId ? ' selected' : ''}>${t.name}</option>`))
      .join('');
  }

  const profiles = await relay({ type: Msg.LIST_PROFILES });
  if (profiles?.ok) {
    $('profile').innerHTML = profiles.profiles
      .map((p) => `<option value="${p.id}"${p.active ? ' selected' : ''}>${p.name} (${p.changeCount})</option>`)
      .join('');
  }
}

for (const button of document.querySelectorAll('.mode')) {
  button.addEventListener('click', async () => {
    const mode = button.dataset.mode;
    const result = await relay({ type: Msg.SET_MODE, mode: mode === 'off' ? Mode.OFF : mode });
    if (!result?.ok) return setStatus(result?.reason ?? 'Could not switch mode.', true);
    await refresh();
    // Leaving the popup open over the page being edited just gets in the way.
    if (mode !== 'off') window.close();
  });
}

$('save').addEventListener('click', async () => {
  const result = await relay({ type: Msg.SAVE });
  setStatus(result?.ok ? 'Changes saved.' : (result?.reason ?? 'Save failed.'), !result?.ok);
  await refresh();
});

$('undo').addEventListener('click', async () => {
  await relay({ type: Msg.UNDO });
  setStatus('Undone.');
  await refresh();
});

$('theme').addEventListener('change', async (event) => {
  const themeId = event.target.value;
  setStatus(themeId ? 'Applying…' : 'Clearing…');
  const result = themeId
    ? await relay({ type: Msg.APPLY_THEME, themeId })
    : await relay({ type: Msg.CLEAR_THEME });
  setStatus(result?.ok ? (themeId ? 'Theme applied. Save to keep it.' : 'Theme cleared.') : 'Could not apply.', !result?.ok);
  await refresh();
});

$('profile').addEventListener('change', async (event) => {
  await relay({ type: Msg.SET_PROFILE, profileId: event.target.value });
  setStatus('Profile switched.');
  await refresh();
});

$('new-profile').addEventListener('click', async () => {
  const name = `Profile ${new Date().toLocaleDateString()}`;
  const result = await relay({ type: Msg.CREATE_PROFILE, name });
  if (result?.ok) {
    await relay({ type: Msg.SET_PROFILE, profileId: result.profile.id });
    setStatus(`Created "${result.profile.name}".`);
    await refresh();
  }
});

$('export').addEventListener('click', async () => {
  const result = await relay({ type: Msg.EXPORT });
  if (!result?.ok || !result.data) return setStatus('Nothing to export.', true);
  const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  await chrome.downloads?.download?.({ url, filename: `${result.data.host}.webdevtools.json` })
    ?? Object.assign(document.createElement('a'), { href: url, download: `${result.data.host}.webdevtools.json` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  setStatus('Exported.');
});

$('import').addEventListener('click', () => $('file').click());

$('file').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const result = await relay({ type: Msg.IMPORT, data });
    if (!result?.ok) return setStatus(result?.reason ?? 'Import rejected.', true);
    setStatus(result.rejected?.length ? `Imported with ${result.rejected.length} skipped.` : 'Imported.');
    await refresh();
  } catch {
    setStatus('That file is not valid JSON.', true);
  } finally {
    event.target.value = '';
  }
});

armable($('reset-page'), 'Reset this page', async () => {
  const result = await relay({ type: Msg.RESET_PAGE });
  setStatus(result?.ok ? `Cleared ${result.cleared} change${result.cleared === 1 ? '' : 's'}.` : 'Reset failed.', !result?.ok);
  await refresh();
});

armable($('reset-site'), 'Reset whole site', async () => {
  const result = await relay({ type: Msg.RESET_SITE });
  setStatus(result?.ok ? `Cleared ${result.cleared} change${result.cleared === 1 ? '' : 's'}.` : 'Reset failed.', !result?.ok);
  await refresh();
});

refresh();
