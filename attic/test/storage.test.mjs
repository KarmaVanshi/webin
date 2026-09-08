import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryBackend, readKey, writeKey, KEY, isSiteKey, hostFromSiteKey } from '../src/storage/bridge.js';
import * as schema from '../src/storage/schema.js';
import { SiteStore, matchScope, scopeSpecificity, normalisePath, scopeFromUrl } from '../src/storage/site-store.js';
import { ProfileStore } from '../src/storage/profile-store.js';
import { WorkspaceStore } from '../src/storage/workspace-store.js';

const styleChange = (path = 'p1', props = { width: '10px' }) =>
  ({ kind: 'style', target: { tag: 'div', domPath: path }, breakpoint: 'all', properties: props });

test('bridge clones on read so callers cannot mutate the store', async () => {
  const b = new MemoryBackend();
  await writeKey(b, 'k', { n: 1 });
  const first = await readKey(b, 'k');
  first.n = 99;
  assert.equal((await readKey(b, 'k')).n, 1);
  assert.equal(await readKey(b, 'missing', 'fallback'), 'fallback');
  assert.ok(isSiteKey(KEY.site('a.com')));
  assert.equal(hostFromSiteKey(KEY.site('a.com')), 'a.com');
});

test('a storage failure degrades instead of throwing', async () => {
  const broken = { get: () => Promise.reject(new Error('quota')), set: () => Promise.reject(new Error('quota')) };
  assert.equal(await readKey(broken, 'k', 'fallback'), 'fallback');
  assert.equal(await writeKey(broken, 'k', 1), false);
});

test('changes are validated and bad ones dropped, not the whole site', () => {
  const { site, rejected } = schema.validateSite({
    profiles: { default: { name: 'D', scopes: { '*': { changes: [
      { id: 'a', kind: 'hide', target: { tag: 'aside' } },
      { id: 'b', kind: 'style', target: { tag: 'div' }, properties: 'not-a-map' },
      { nonsense: true },
    ] } } } },
  }, 'x.com');
  assert.equal(site.profiles.default.scopes['*'].changes.length, 1);
  assert.equal(rejected.length, 2);
});

test('imports are validated before anything is applied', () => {
  assert.ok(!schema.validateImport({ format: 'something-else' }).ok);
  assert.ok(!schema.validateImport({ format: 'web-interface-devtools/customisation', schemaVersion: 99, host: 'x' }).ok);
  const roundTrip = schema.validateImport(schema.buildExport('x.com', 'default', schema.emptyProfile('default', 'D')));
  assert.ok(roundTrip.ok);
  assert.equal(roundTrip.host, 'x.com');
});

test('path scopes match and order by specificity', () => {
  assert.ok(matchScope('*', '/anything'));
  assert.ok(matchScope('/products', '/products/'));
  assert.ok(matchScope('/products/*', '/products/42'));
  assert.ok(!matchScope('/products/*', '/productsX'));
  assert.ok(scopeSpecificity('/a/b') > scopeSpecificity('/a/*'));
  assert.ok(scopeSpecificity('/a/*') > scopeSpecificity('*'));
  assert.equal(normalisePath('/a/b/?q=1#h'), '/a/b');
  assert.deepEqual(scopeFromUrl('https://x.com/a/b?q=1'), { host: 'x.com', path: '/a/b' });
});

test('edits to one element fold into a single change', async () => {
  const store = new SiteStore(new MemoryBackend());
  await store.addChange('x.com', '/p', styleChange('p1', { width: '10px' }));
  await store.addChange('x.com', '/p', styleChange('p1', { color: 'red' }));
  const changes = await store.changesForPath('x.com', '/p');
  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0].properties, { width: '10px', color: 'red' });
});

test('broader scopes apply to a page, least specific first', async () => {
  const store = new SiteStore(new MemoryBackend());
  await store.addChange('x.com', '/p', styleChange('p1'));
  await store.addChange('x.com', '/p', { kind: 'hide', target: { tag: 'aside', domPath: 'p2' }, breakpoint: 'all' }, { scope: '*' });
  const changes = await store.changesForPath('x.com', '/p');
  assert.equal(changes.length, 2);
  assert.equal(changes[0].scope, '*');
});

test('resetting a page leaves site-wide and section scopes alone', async () => {
  const store = new SiteStore(new MemoryBackend());
  await store.addChange('x.com', '/p', styleChange('p1'));
  await store.addChange('x.com', '/p', styleChange('p2'), { scope: '*' });
  await store.addChange('x.com', '/p', styleChange('p3'), { scope: '/p/*' });
  const result = await store.resetPath('x.com', '/p');
  assert.equal(result.cleared, 1);
  assert.equal(result.remaining, 2);
  assert.equal((await store.changesForPath('x.com', '/p')).length, 2);
  assert.equal(await store.resetSite('x.com'), 2);
});

test('a record from a newer schema is never guessed at', async () => {
  const backend = new MemoryBackend();
  await backend.set({ [KEY.site('x.com')]: { schemaVersion: 999, profiles: {} } });
  const store = new SiteStore(backend);
  const site = await store.load('x.com');
  assert.ok(site.readOnly);
  assert.match(site.rejected[0], /newer than this build/);
});

test('profiles are independent design layers', async () => {
  const backend = new MemoryBackend();
  const sites = new SiteStore(backend);
  const profiles = new ProfileStore(sites);
  await sites.addChange('x.com', '/p', styleChange('p1'));

  const copy = await profiles.create('x.com', 'Minimal', { copyFrom: 'default' });
  assert.equal(copy.scopes['/p'].changes.length, 1);
  await profiles.activate('x.com', copy.id);
  assert.equal((await profiles.list('x.com')).find((p) => p.active).id, copy.id);

  await profiles.setEnabled('x.com', copy.id, false);
  assert.equal(await sites.activeProfile('x.com'), null, 'a disabled profile applies nothing');

  await profiles.setEnabled('x.com', copy.id, true);
  assert.ok(!(await profiles.remove('x.com', 'nope')));
  await profiles.remove('x.com', copy.id);
  assert.equal((await profiles.list('x.com')).length, 1);
  assert.ok(!(await profiles.remove('x.com', 'default')), 'the last profile cannot be deleted');
});

test('workspace state is separate from customisation data', async () => {
  const backend = new MemoryBackend();
  const ws = new WorkspaceStore(backend);
  await ws.saveWorkspace({ layersWidth: 300 });
  const state = await ws.loadWorkspace();
  assert.equal(state.layersWidth, 300);
  assert.equal(state.inspectorWidth, 288, 'defaults fill the rest');
});
