import test from 'node:test';
import assert from 'node:assert/strict';
import { getWindowTitle, matchesNavigationQuery } from '../system/surface/workspace/components/central/config.ts';
import { desktopReducer, initialDesktopState } from '../system/surface/workspace/components/central/desktop-state.ts';
import { MERIDIAN_RAIL_DESTINATIONS } from '../system/services/surface/meridian-navigation.mjs';

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

test('navigation search finds canonical destinations without requiring accents', () => {
  assert.equal(matchesNavigationQuery({name:'Ajustes',target:'Configurações'},'configuracoes'),true);
  assert.equal(matchesNavigationQuery({name:'Minha conta'},'CONTA'),true);
  assert.equal(matchesNavigationQuery({name:'Continuidade'},'continuidade'),true);
  assert.equal(matchesNavigationQuery({name:'Espaços'},'espacos'),true);
  assert.equal(matchesNavigationQuery({name:'Arquivos'},'conta'),false);
});

test('rail aliases and auxiliary panel titles use the canonical resolver', () => {
  assert.equal(getWindowTitle('Inteligência'), 'Aura');
  assert.equal(getWindowTitle('Aura'), 'Aura');
  assert.equal(getWindowTitle('Configurações'), 'Configurações');
  assert.equal(getWindowTitle('Minha conta'), 'Minha conta');
  assert.equal(getWindowTitle('Perfis profissionais'), 'Espaços');
  assert.equal(MERIDIAN_RAIL_DESTINATIONS.filter(item => item.key === 'spaces').length, 1);
  assert.equal(MERIDIAN_RAIL_DESTINATIONS.some(item => item.key === 'profiles'), false);
});
