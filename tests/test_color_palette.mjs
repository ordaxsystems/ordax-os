import assert from 'node:assert/strict';
import test from 'node:test';
import { createPreferenceRuntime } from '../system/services/preferences/runtime.mjs';
import { createWebPreferenceStore } from '../system/adapters/web/preferences.mjs';
import { recoverPreferenceSnapshot } from '../system/services/preferences/catalog.mjs';
import { resolveColorAppearance, selectColorTheme, COLOR_PALETTE_PREFERENCE_ID } from '../system/services/preferences/color-palette.mjs';

test('USB colors persist through the existing store while portable light/dark remains valid', () => {
  const records = new Map();
  const localStorage = { getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, value) };
  const first = createPreferenceRuntime(createWebPreferenceStore({ localStorage }));
  first.set('accessibility.contrast', 'high');
  selectColorTheme(first, 'native');
  assert.equal(first.getSnapshot()['appearance.theme'], 'light');
  first.dispose();
  const restored = createPreferenceRuntime(createWebPreferenceStore({ localStorage }));
  assert.deepEqual(resolveColorAppearance(restored.getSnapshot()), { colorTheme: 'native', scheme: 'dark' });
  assert.equal(restored.getSnapshot()['accessibility.contrast'], 'high');
  assert.deepEqual([...records.keys()], ['ordax.preferences.v1']);
  restored.dispose();
});

test('switching back to Claro or Escuro restores that palette without changing unrelated preferences', () => {
  const runtime = createPreferenceRuntime(createWebPreferenceStore({}));
  runtime.set('accessibility.motion', 'reduced');
  for (const choice of ['native', 'light', 'native', 'dark']) {
    selectColorTheme(runtime, choice);
    assert.equal(resolveColorAppearance(runtime.getSnapshot()).colorTheme, choice);
    assert.equal(runtime.getSnapshot()['accessibility.motion'], 'reduced');
  }
  assert.equal(runtime.getSnapshot()[COLOR_PALETTE_PREFERENCE_ID], 'standard');
  assert.equal(runtime.getPersistenceSnapshot(), 'session-only');
  runtime.dispose();
});

test('invalid colors fail before a write; corrupt palette recovers without losing dark mode', () => {
  let writes = 0;
  const runtime = createPreferenceRuntime({ schema: 'ordax.preference-store/1', load: () => ({}), save: () => { writes++; return true; } });
  assert.throws(() => selectColorTheme(runtime, 'sepia'), /Unsupported/);
  assert.equal(writes, 0);
  selectColorTheme(runtime, 'native');
  selectColorTheme(runtime, 'native');
  assert.equal(writes, 1);
  const recovered = recoverPreferenceSnapshot({ 'appearance.theme': 'dark', [COLOR_PALETTE_PREFERENCE_ID]: 'corrupt' });
  assert.deepEqual(resolveColorAppearance(recovered), { colorTheme: 'dark', scheme: 'dark' });
  runtime.dispose();
});


test('Native reducer and Web runtime resolve the same three presentation colors', async () => {
  const { createSurfaceState, reduceSurfaceState } = await import('../system/surface/ui/surface-state.mjs');
  let state = createSurfaceState({ capabilityIds: [], connectivity: 'unknown' });
  const nativePreferences = {
    getSnapshot: () => state.preferences,
    set: (preferenceId, value) => { state = reduceSurfaceState(state, { type: 'preference.set', preferenceId, value }); },
  };
  const web = createPreferenceRuntime(createWebPreferenceStore({}));
  for (const choice of ['light', 'dark', 'native']) {
    selectColorTheme(nativePreferences, choice);
    selectColorTheme(web, choice);
    assert.deepEqual(resolveColorAppearance(state.preferences), resolveColorAppearance(web.getSnapshot()));
  }
  web.dispose();
});


test('Native preference transport persists the shared profile through the existing endpoint', async () => {
  const { createNativePreferenceStore } = await import('../system/adapters/native/preferences.mjs');
  let record = {};
  const calls = [];
  const host = { async fetch(path, options) {
    assert.equal(path, '/__ordax/native/preferences');
    assert.equal(options.credentials, 'same-origin');
    calls.push(options.method);
    if (options.method === 'POST') record = JSON.parse(options.body);
    return { ok: true, json: async () => ({ ...record }) };
  } };
  const runtime = createPreferenceRuntime(await createNativePreferenceStore(host));
  selectColorTheme(runtime, 'native');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(record[COLOR_PALETTE_PREFERENCE_ID], 'native');
  runtime.dispose();
  const restored = createPreferenceRuntime(await createNativePreferenceStore(host));
  assert.equal(resolveColorAppearance(restored.getSnapshot()).colorTheme, 'native');
  assert.deepEqual(calls, ['GET', 'POST', 'GET']);
  restored.dispose();
});
