import test from 'node:test';
import assert from 'node:assert/strict';
import { getWindowTitle } from '../system/surface/workspace/components/central/config.ts';
import { desktopReducer, initialDesktopState } from '../system/surface/workspace/components/central/desktop-state.ts';

// The rail calls this Aura; the existing pinned shortcut calls it Intelligence.
// Both must focus one managed window, preserving the current draft and geometry.
test('rail and dock Intelligence labels reuse the same app window', () => {
  let state = desktopReducer(initialDesktopState, { type:'open', title:getWindowTitle('Aura'), prompt:'Rascunho local' });
  state = desktopReducer(state, { type:'compact', title:'Aura' });
  state = desktopReducer(state, { type:'open', title:getWindowTitle('Inteligência') });
  assert.equal(state.windows.length, 1);
  assert.equal(state.windows[0].title, 'Aura');
  assert.equal(state.windows[0].initialPrompt.text, 'Rascunho local');
  assert.equal(state.windows[0].mode, 'compact');
  assert.equal(state.active, 'Aura');
});

test('dock restores a minimized Intelligence window without duplicating other apps', () => {
  let state = desktopReducer(initialDesktopState, { type:'open', title:'Loja' });
  state = desktopReducer(state, { type:'open', title:getWindowTitle('Inteligência') });
  state = desktopReducer(state, { type:'minimize', title:'Aura' });
  state = desktopReducer(state, { type:'open', title:getWindowTitle('Inteligência') });
  assert.equal(state.windows.length, 2);
  assert.equal(state.windows.filter(window => window.title === 'Aura').length, 1);
  assert.equal(state.windows.find(window => window.title === 'Aura').minimized, false);
  assert.ok(state.windows.some(window => window.title === 'Loja'));
  assert.equal(state.active, 'Aura');
});
