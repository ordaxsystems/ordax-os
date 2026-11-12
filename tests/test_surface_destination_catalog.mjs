import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SURFACE_DESTINATIONS,
  SURFACE_DESTINATION_IDS,
  getSurfaceDestination,
  getSurfaceWindowTitle,
  resolveSurfaceWindowTitle,
} from '../system/services/surface/destination-catalog.mjs';
import { HOME_SHORTCUTS } from '../system/services/preferences/home-shortcuts.mjs';

test('surface destination catalog owns unique stable ids', () => {
  assert.equal(new Set(SURFACE_DESTINATION_IDS).size, SURFACE_DESTINATION_IDS.length);
  assert.deepEqual(Object.keys(SURFACE_DESTINATIONS), [...SURFACE_DESTINATION_IDS]);
});

test('home shortcuts derive names from the canonical destination catalog', () => {
  assert.deepEqual(
    HOME_SHORTCUTS.map(({ id, name }) => ({ id, name })),
    SURFACE_DESTINATION_IDS.map(id => ({ id, name: getSurfaceDestination(id).label })),
  );
});

test('intelligence presentation resolves to the managed Aura window', () => {
  assert.equal(getSurfaceDestination('intelligence').label, 'Inteligência');
  assert.equal(getSurfaceWindowTitle('intelligence'), 'Aura');
});

test('unknown destination ids fail closed', () => {
  for (const id of ['missing-destination', '__proto__', 'constructor', 'toString']) {
    assert.throws(() => getSurfaceDestination(id), /Unknown Surface destination/);
  }
});

test('managed window titles resolve canonical labels without changing auxiliary panels', () => {
  for (const id of SURFACE_DESTINATION_IDS) {
    const { label, windowTitle } = getSurfaceDestination(id);
    assert.equal(resolveSurfaceWindowTitle(label), windowTitle);
    assert.equal(resolveSurfaceWindowTitle(windowTitle), windowTitle);
  }
  assert.equal(resolveSurfaceWindowTitle('Configurações'), 'Configurações');
  assert.equal(resolveSurfaceWindowTitle('Minha conta'), 'Minha conta');
  assert.throws(() => resolveSurfaceWindowTitle(undefined), /Invalid Surface window title/);
});
