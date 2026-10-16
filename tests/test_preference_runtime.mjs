import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreferenceRuntime } from '../system/services/preferences/runtime.mjs';
import { createWebPreferenceStore } from '../system/adapters/web/preferences.mjs';
import { assertPreferenceRuntimePort } from '../system/contracts/preference-runtime.mjs';
import { PREFERENCE_STORE_SCHEMA } from '../system/contracts/preference-store.mjs';

function browserStorage() {
  const records = new Map();
  return { records, getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, value) };
}
test('Web theme persists through the canonical store and reloads without unrelated keys', () => {
  const localStorage = browserStorage();
  const runtime = createPreferenceRuntime(createWebPreferenceStore({ localStorage }));
  assertPreferenceRuntimePort(runtime);
  runtime.set('appearance.theme', 'dark');
  assert.equal(runtime.getPersistenceSnapshot(), 'saved');
  runtime.dispose();
  const next = createPreferenceRuntime(createWebPreferenceStore({ localStorage }));
  assert.equal(next.getSnapshot()['appearance.theme'], 'dark');
  assert.deepEqual([...localStorage.records.keys()], ['ordax.preferences.v1']);
  next.dispose();
});
test('blocked browser storage keeps the chosen theme for the session', () => {
  const host = { get localStorage() { throw new Error('Blocked by browser policy'); } };
  const runtime = createPreferenceRuntime(createWebPreferenceStore(host));
  runtime.set('appearance.theme', 'dark');
  assert.equal(runtime.getSnapshot()['appearance.theme'], 'dark');
  assert.equal(runtime.getPersistenceSnapshot(), 'session-only');
  runtime.dispose();
});
test('corrupt stored preferences recover known defaults without an initial overwrite', () => {
  const storage = browserStorage();
  const corrupt = '{"appearance.theme":"unsupported","accessibility.motion":"reduced"}';
  storage.records.set('ordax.preferences.v1', corrupt);
  const runtime = createPreferenceRuntime(createWebPreferenceStore({ localStorage: storage }));
  assert.equal(runtime.getSnapshot()['appearance.theme'], 'light');
  assert.equal(runtime.getSnapshot()['accessibility.motion'], 'reduced');
  assert.equal(storage.records.get('ordax.preferences.v1'), corrupt);
  assert.throws(() => runtime.set('appearance.theme', 'unsupported'), TypeError);
  assert.equal(storage.records.get('ordax.preferences.v1'), corrupt);
  runtime.dispose();
});
test('failed persistence does not lose the theme or publish an unconfirmed save', () => {
  const store = { schema: PREFERENCE_STORE_SCHEMA, load: () => ({}), save() { throw new Error('Storage full'); } };
  const runtime = createPreferenceRuntime(store);
  runtime.set('appearance.theme', 'dark');
  assert.equal(runtime.getSnapshot()['appearance.theme'], 'dark');
  assert.equal(runtime.getPersistenceSnapshot(), 'session-only');
  runtime.dispose();
});
test('unknown or unchanged values issue no writes and disposal releases subscriptions', () => {
  let writes = 0;
  let calls = 0;
  const runtime = createPreferenceRuntime({
    schema: PREFERENCE_STORE_SCHEMA, load: () => ({}), save: () => { writes++; return true; },
  });
  const initial = runtime.getSnapshot();
  const unsubscribe = runtime.subscribe(() => { calls++; });
  runtime.set('unknown.preference', 'dark');
  runtime.set('appearance.theme', 'light');
  assert.equal(runtime.getSnapshot(), initial);
  assert.equal(writes, 0);
  runtime.set('appearance.theme', 'dark');
  assert.equal(writes, 1);
  assert.equal(calls, 2);
  unsubscribe();
  runtime.set('appearance.theme', 'light');
  assert.equal(calls, 2);
  runtime.dispose();
  assert.throws(() => runtime.set('appearance.theme', 'dark'));
  runtime.subscribe(() => { calls++; });
  assert.equal(calls, 2);
  assert.equal(writes, 2);
});


test('confirmed preference writes publish only after durable save', async () => {
  let release;
  const writes=[];
  const runtime=createPreferenceRuntime({
    schema:PREFERENCE_STORE_SCHEMA,
    load:()=>({}),
    save:()=>true,
    saveConfirmed:async snapshot=>{writes.push(snapshot);await new Promise(resolve=>{release=resolve;});return true;},
  });
  let notifications=0;runtime.subscribe(()=>{notifications++;});
  const operation=runtime.setManyConfirmed({'regional.locale':'en-US','memory.auto-capture':'off'});
  assert.equal(runtime.getSnapshot()['regional.locale'],'pt-BR');
  assert.equal(notifications,1);
  release();await operation;
  assert.equal(runtime.getSnapshot()['regional.locale'],'en-US');
  assert.equal(runtime.getSnapshot()['memory.auto-capture'],'off');
  assert.equal(runtime.getPersistenceSnapshot(),'saved');
  assert.equal(writes.length,1);
  assert.equal(notifications,2);
  runtime.dispose();
});

test('failed confirmed preference write leaves the authoritative snapshot unchanged', async () => {
  const runtime=createPreferenceRuntime({
    schema:PREFERENCE_STORE_SCHEMA,load:()=>({}),save:()=>true,
    saveConfirmed:async()=>{throw new Error('disk full');},
  });
  const before=runtime.getSnapshot();let notifications=0;runtime.subscribe(()=>{notifications++;});
  await assert.rejects(runtime.setManyConfirmed({'regional.locale':'en-US'}),/disk full/);
  assert.equal(runtime.getSnapshot(),before);
  assert.equal(runtime.getPersistenceSnapshot(),'session-only');
  assert.equal(notifications,1);
  runtime.dispose();
});
