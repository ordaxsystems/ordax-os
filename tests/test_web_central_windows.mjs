import test from 'node:test';
import assert from 'node:assert/strict';
import { desktopReducer, initialDesktopState } from '../system/surface/workspace/components/central/desktop-state.ts';

const dispatch = (state, type, title) => desktopReducer(state, { type, title });
function pair() {
  let state = dispatch(initialDesktopState, 'open', 'Aura');
  state = dispatch(state, 'compact', 'Aura');
  state = dispatch(state, 'open', 'Configurações');
  return dispatch(state, 'compact', 'Configurações');
}

test('compact selection survives opening and closing an upper app without reordering tiled panes', () => {
  let state = pair();
  const order = state.windows.map(window => window.title);
  state = dispatch(state, 'focus', 'Aura');
  assert.equal(state.compactActive, 'Aura');
  assert.deepEqual(state.windows.map(window => window.title), order);
  state = dispatch(state, 'open', 'Projetos');
  assert.equal(state.active, 'Projetos');
  assert.equal(state.compactActive, 'Aura');
  state = dispatch(state, 'close', 'Projetos');
  assert.equal(state.active, 'Aura');
  assert.equal(state.compactActive, 'Aura');
});

test('minimize, close and restore select only available compact windows', () => {
  let state = pair();
  state = dispatch(state, 'minimize', 'Configurações');
  assert.equal(state.compactActive, 'Aura');
  assert.equal(state.windows.find(window => window.title === 'Configurações').mode, 'compact');
  state = dispatch(state, 'open', 'Configurações');
  assert.equal(state.compactActive, 'Configurações');
  state = dispatch(state, 'restore', 'Configurações');
  assert.equal(state.compactActive, 'Aura');
  assert.equal(state.windows.find(window => window.title === 'Configurações').mode, 'maximized');
  state = dispatch(state, 'close', 'Aura');
  assert.equal(state.compactActive, null);
});

test('switching a collapsed compact panel retains collapse and mounted window records', () => {
  let state = pair();
  const window = state.windows.find(window => window.title === 'Aura');
  state = desktopReducer(state, { type: 'toggle-compact', collapsed: true });
  state = dispatch(state, 'focus', 'Aura');
  assert.equal(state.compactCollapsed, true);
  assert.equal(state.windows.find(pane => pane.title === 'Aura'), window);
  assert.equal(dispatch(state, 'focus', 'unknown'), state);
});

test('show desktop clears compact selection; explicit dock restore selects and reveals it', () => {
  const before = JSON.stringify(initialDesktopState);
  let state = desktopReducer(pair(), { type: 'show-desktop' });
  assert.equal(state.compactActive, null);
  assert.equal(state.active, null);
  assert.ok(state.windows.every(window => window.minimized));
  state = dispatch(state, 'open', 'Aura');
  assert.equal(state.compactActive, 'Aura');
  assert.equal(state.compactCollapsed, false);
  assert.equal(JSON.stringify(initialDesktopState), before);
});
