import assert from 'node:assert/strict';
import test from 'node:test';
import { createPreferenceRuntime } from '../system/services/preferences/runtime.mjs';
import { createWebPreferenceStore } from '../system/adapters/web/preferences.mjs';
import { recoverPreferenceSnapshot } from '../system/services/preferences/catalog.mjs';
import { resolveWebAppearance, selectWebColorTheme, WEB_PALETTE_PREFERENCE_ID } from '../system/services/preferences/web-palette.mjs';

test('USB colors persist through the existing store while portable light/dark remains valid', () => {
  const records = new Map();
  const localStorage = { getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, value) };
  const first = createPreferenceRuntime(createWebPreferenceStore({ localStorage }));
  first.set('accessibility.contrast', 'high');
  selectWebColorTheme(first, 'native');
  assert.equal(first.getSnapshot()['appearance.theme'], 'light');
  first.dispose();
  const restored = createPreferenceRuntime(createWebPreferenceStore({ localStorage }));
  assert.deepEqual(resolveWebAppearance(restored.getSnapshot()), { colorTheme: 'native', scheme: 'dark' });
  assert.equal(restored.getSnapshot()['accessibility.contrast'], 'high');
  assert.deepEqual([...records.keys()], ['ordax.preferences.v1']);
  restored.dispose();
});

test('switching back to Claro or Escuro restores that palette without changing unrelated preferences', () => {
  const runtime = createPreferenceRuntime(createWebPreferenceStore({}));
  runtime.set('accessibility.motion', 'reduced');
  for (const choice of ['native', 'light', 'native', 'dark']) {
    selectWebColorTheme(runtime, choice);
    assert.equal(resolveWebAppearance(runtime.getSnapshot()).colorTheme, choice);
    assert.equal(runtime.getSnapshot()['accessibility.motion'], 'reduced');
  }
  assert.equal(runtime.getSnapshot()[WEB_PALETTE_PREFERENCE_ID], 'standard');
  assert.equal(runtime.getPersistenceSnapshot(), 'session-only');
  runtime.dispose();
});

test('invalid colors fail before a write; corrupt palette recovers without losing dark mode', () => {
  let writes = 0;
  const runtime = createPreferenceRuntime({ schema: 'ordax.preference-store/1', load: () => ({}), save: () => { writes++; return true; } });
  assert.throws(() => selectWebColorTheme(runtime, 'sepia'), /Unsupported/);
  assert.equal(writes, 0);
  selectWebColorTheme(runtime, 'native');
  selectWebColorTheme(runtime, 'native');
  assert.equal(writes, 1);
  const recovered = recoverPreferenceSnapshot({ 'appearance.theme': 'dark', [WEB_PALETTE_PREFERENCE_ID]: 'corrupt' });
  assert.deepEqual(resolveWebAppearance(recovered), { colorTheme: 'dark', scheme: 'dark' });
  runtime.dispose();
});
