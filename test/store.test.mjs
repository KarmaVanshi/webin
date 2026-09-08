import test from 'node:test';
import assert from 'node:assert/strict';

import { MemoryBackend } from '../src/storage/bridge.js';
import { Store, hostOf, STORAGE_VERSION } from '../src/storage/store.js';
import { normaliseTheme } from '../src/shared/theme-format.js';

const theme = (id, name = id) => normaliseTheme({
  id, name,
  palette: { background: '#ffffff', surface: '#eeeeee', text: '#111111', textMuted: '#666666', accent: '#ff0000' },
});

test('themes survive a round trip through storage', async () => {
  const store = new Store(new MemoryBackend());
  await store.saveTheme(theme('one', 'One'));
  await store.saveTheme(theme('two', 'Two'));

  const themes = await store.themes();
  assert.deepEqual(themes.map((t) => t.name), ['Two', 'One'], 'newest first');
});

test('saving the same id replaces rather than duplicates', async () => {
  const store = new Store(new MemoryBackend());
  await store.saveTheme(theme('one', 'First'));
  await store.saveTheme(theme('one', 'Renamed'));

  const themes = await store.themes();
  assert.equal(themes.length, 1);
  assert.equal(themes[0].name, 'Renamed');
});

test('an import never overwrites a theme the user already has', async () => {
  const store = new Store(new MemoryBackend());
  await store.saveTheme(theme('shared', 'Mine'));

  const [added] = await store.importThemes([theme('shared', 'Theirs')]);
  assert.notEqual(added.id, 'shared', 'the incoming theme is given its own id');

  const themes = await store.themes();
  assert.equal(themes.length, 2);
  assert.ok(themes.some((t) => t.name === 'Mine'));
  assert.ok(themes.some((t) => t.name === 'Theirs'));
});

test('a corrupted record cannot reach the engine', async () => {
  const backend = new MemoryBackend();
  await backend.set({ themes: { themes: [{ name: 'Broken', palette: { background: 'nonsense' } }, theme('good')] } });

  const themes = await new Store(backend).themes();
  assert.equal(themes.length, 1);
  assert.equal(themes[0].id, 'good');
});

test('a site remembers its theme and the CSS to inject before paint', async () => {
  const store = new Store(new MemoryBackend());
  await store.setSite('example.com', 'terminal', 'html { background: #000 }');

  const site = await store.site('example.com');
  assert.equal(site.themeId, 'terminal');
  assert.match(site.bootCss, /background/);
  assert.ok(site.at > 0);

  await store.clearSite('example.com');
  assert.equal(await store.site('example.com'), null);
});

test('one site does not affect another', async () => {
  const store = new Store(new MemoryBackend());
  await store.setSite('a.com', 'nord', '');
  await store.setSite('b.com', 'dracula', '');
  await store.clearSite('a.com');

  assert.equal(await store.site('a.com'), null);
  assert.equal((await store.site('b.com')).themeId, 'dracula');
});

test('settings default rather than fail when nothing is stored', async () => {
  const store = new Store(new MemoryBackend());
  assert.equal((await store.settings()).appearance, 'light');

  await store.saveSettings({ appearance: 'dark' });
  assert.equal((await store.settings()).appearance, 'dark');
  assert.equal((await store.settings()).side, 'right', 'an unset value keeps its default');
});

// ─── Versioning ────────────────────────────────────────────────────────────

test('every record is stamped with the storage version on the way out', async () => {
  const backend = new MemoryBackend();
  const store = new Store(backend);
  await store.saveTheme(theme('one'));
  await store.setSite('example.com', 'nord', 'html { background: #000 }');
  await store.saveSettings({ appearance: 'dark' });

  assert.equal((await backend.get('themes')).themes.v, STORAGE_VERSION);
  assert.equal((await backend.get('site:example.com'))['site:example.com'].v, STORAGE_VERSION);
  assert.equal((await backend.get('settings')).settings.v, STORAGE_VERSION);
});

test('the version stamp never leaks into what the app sees', async () => {
  const store = new Store(new MemoryBackend());
  await store.saveSettings({ appearance: 'dark' });
  await store.setSite('example.com', 'nord', '');

  assert.equal((await store.settings()).v, undefined, 'settings are settings, not records');
  assert.equal((await store.site('example.com')).v, undefined);
  assert.ok(!Object.keys(await store.settings()).includes('v'), 'no record plumbing in the settings');
});

test('records written before versioning existed still load', async () => {
  // Exactly what the first build wrote: no stamp at all.
  const backend = new MemoryBackend();
  await backend.set({
    themes: { themes: [theme('legacy', 'From before')] },
    'site:example.com': { themeId: 'terminal', bootCss: 'html {}', at: 1 },
    settings: { appearance: 'dark' },
  });
  const store = new Store(backend);

  assert.equal((await store.themes())[0].name, 'From before');
  assert.equal((await store.site('example.com')).themeId, 'terminal');
  assert.equal((await store.settings()).appearance, 'dark');
});

test('a record from a newer release is read, not mangled', async () => {
  // Storage synced from a profile running a later version, or a rollback.
  const backend = new MemoryBackend();
  await backend.set({
    'site:example.com': { v: STORAGE_VERSION + 5, themeId: 'nord', bootCss: '', somethingNew: true },
  });

  const site = await new Store(backend).site('example.com');
  assert.equal(site.themeId, 'nord', 'the fields this version understands still work');
  assert.equal(site.somethingNew, true, 'and the ones it does not are left alone');
});

test('rubbish in storage reads as nothing rather than throwing', async () => {
  const backend = new MemoryBackend();
  await backend.set({ themes: 'not an object', settings: 42, 'site:example.com': null });
  const store = new Store(backend);

  assert.deepEqual(await store.themes(), []);
  assert.equal((await store.settings()).appearance, 'light');
  assert.equal(await store.site('example.com'), null);
});

test('www is not a different website', () => {
  assert.equal(hostOf('https://www.youtube.com/watch?v=x'), 'youtube.com');
  assert.equal(hostOf('https://youtube.com/'), 'youtube.com');
  assert.equal(hostOf('not a url'), 'unknown');
});
