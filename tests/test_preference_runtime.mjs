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


test('asynchronous preference saves stay pending until the latest acknowledgment', async () => {
  const acknowledgments = [];
  const runtime = createPreferenceRuntime({
    schema: PREFERENCE_STORE_SCHEMA,
    load: () => ({}),
    save: () => new Promise(resolve => acknowledgments.push(resolve)),
  });
  const statuses = [];
  runtime.subscribe(() => statuses.push(runtime.getPersistenceSnapshot()));
  runtime.set('appearance.theme', 'dark');
  assert.equal(runtime.getPersistenceSnapshot(), 'pending');
  runtime.set('appearance.theme', 'light');
  assert.equal(runtime.getPersistenceSnapshot(), 'pending');
  acknowledgments[0](true);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(runtime.getPersistenceSnapshot(), 'pending', 'old ACK must not confirm newer write');
  acknowledgments[1](false);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(runtime.getPersistenceSnapshot(), 'session-only');
  assert.equal(runtime.getSnapshot()['appearance.theme'], 'light');
  assert.deepEqual(statuses, ['not-written', 'pending', 'pending', 'session-only']);
  runtime.dispose();
});

test('asynchronous rejected saves stay session-only and dispose never publishes late ACK', async () => {
  let rejectWrite;
  const runtime = createPreferenceRuntime({
    schema: PREFERENCE_STORE_SCHEMA,
    load: () => ({}),
    save: () => new Promise((_, reject) => { rejectWrite = reject; }),
  });
  let calls = 0;
  runtime.subscribe(() => { calls++; });
  runtime.set('appearance.theme', 'dark');
  assert.equal(runtime.getPersistenceSnapshot(), 'pending');
  rejectWrite(new Error('disk denied'));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(runtime.getPersistenceSnapshot(), 'session-only');
  const beforeDispose = calls;
  runtime.dispose();
  assert.equal(calls, beforeDispose);
});

test('late Native acknowledgment after disposal cannot publish false saved state', async () => {
  let accept;
  const runtime = createPreferenceRuntime({
    schema: PREFERENCE_STORE_SCHEMA,
    load: () => ({}),
    save: () => new Promise(resolve => { accept = resolve; }),
  });
  let signals = 0;
  runtime.subscribe(() => { signals++; });
  runtime.set('appearance.theme', 'dark');
  const beforeDispose = signals;
  runtime.dispose();
  accept(true);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(runtime.getPersistenceSnapshot(), 'pending');
  assert.equal(signals, beforeDispose);
});


test('durable confirmation waits for actual host ACK and rejects stale or failed writes', async () => {
  const accepts = [];
  const tracker = createPreferencePersistence({
    schema: PREFERENCE_STORE_SCHEMA, load: () => ({}),
    save: () => new Promise(resolve => accepts.push(resolve)),
  });
  const first = tracker.saveConfirmed({ "regional.locale": "en-US" });
  assert.equal(tracker.getSnapshot(), "pending");
  const second = tracker.saveConfirmed({ "regional.locale": "pt-BR" });
  accepts[0](true);
  assert.equal(await first, false, "superseded ACK cannot confirm the latest state");
  assert.equal(tracker.getSnapshot(), "pending");
  accepts[1](false);
  assert.equal(await second, false);
  assert.equal(tracker.getSnapshot(), "session-only");
  const third = tracker.saveConfirmed({ "regional.locale": "en-US" });
  accepts[2](true);
  assert.equal(await third, true);
  assert.equal(tracker.getSnapshot(), "saved");
  tracker.dispose();
});

test('canonical confirmation controller preserves latest-write ownership', async () => {
  const { createPreferencePersistence } = await import('../system/services/preferences/runtime.mjs');
  const confirms = [];
  const tracker = createPreferencePersistence({
    schema: PREFERENCE_STORE_SCHEMA, load: () => ({}),
    save: () => new Promise(resolve => confirms.push(resolve)),
  });
  const observed = [];
  tracker.subscribe(state => observed.push(state));
  tracker.save({ 'appearance.theme': 'dark' });
  tracker.save({ 'appearance.theme': 'light' });
  assert.equal(tracker.getSnapshot(), 'pending');
  confirms[0](true);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(tracker.getSnapshot(), 'pending');
  confirms[1](false);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(tracker.getSnapshot(), 'session-only');
  assert.deepEqual(observed, ['not-written', 'pending', 'pending', 'session-only']);
  tracker.dispose();
});

test('canonical confirmation controller handles no store, rejected host and late disposal', async () => {
  const { createPreferencePersistence } = await import('../system/services/preferences/runtime.mjs');
  const local = createPreferencePersistence(null);
  assert.equal(local.getSnapshot(), 'not-written');
  assert.equal(local.save({ 'appearance.theme': 'dark' }), 'session-only');
  local.dispose();
  assert.throws(() => local.save({}), /disposed/);
  let reject;
  const pending = createPreferencePersistence({
    schema: PREFERENCE_STORE_SCHEMA, load: () => ({}),
    save: () => new Promise((_, failure) => { reject = failure; }),
  });
  const statuses = [];
  pending.subscribe(state => statuses.push(state));
  pending.save({ 'appearance.theme': 'dark' });
  reject(new Error('host unavailable'));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(pending.getSnapshot(), 'session-only');
  pending.dispose();
  let accept;
  const late = createPreferencePersistence({
    schema: PREFERENCE_STORE_SCHEMA, load: () => ({}),
    save: () => new Promise(resolve => { accept = resolve; }),
  });
  const seen = [];
  late.subscribe(state => seen.push(state));
  late.save({ 'appearance.theme': 'dark' });
  late.dispose();
  accept(true);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(late.getSnapshot(), 'pending');
  assert.deepEqual(seen, ['not-written', 'pending']);
});
