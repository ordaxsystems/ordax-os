import test from 'node:test';
import assert from 'node:assert/strict';
import { moveDesktopShortcutFocus, moveDockFocus } from '../system/services/surface/dock-navigation.mjs';

function dockFixture() {
  const items = Array.from({ length: 4 }, (_, index) => ({
    disabled: index === 1,
    hidden: false,
    visible: index !== 3,
    focusOptions: null,
    scrolled: false,
    getClientRects() { return this.visible ? [{}] : []; },
    closest(selector) { return selector === 'button' ? this : null; },
    focus(options) { this.focusOptions = options; },
    scrollIntoView() { this.scrolled = true; },
  }));
  const container = { querySelectorAll() { return items; } };
  const event = (key, target, modifiers = {}) => ({
    key,
    target,
    ...modifiers,
    prevented: false,
    preventDefault() { this.prevented = true; },
  });
  return { items, container, event };
}

test('shared dock keyboard navigation skips unavailable items and wraps without activating them', () => {
  const { items, container, event } = dockFixture();
  const move = event('ArrowRight', items[2]);

  assert.equal(moveDockFocus(move, container, 'button'), true);
  assert.equal(move.prevented, true);
  assert.deepEqual(items[0].focusOptions, { preventScroll: true });
  assert.equal(items[0].scrolled, true);
  assert.equal(items[1].focusOptions, null);
  assert.equal(items[3].focusOptions, null);
});

test('Home and End move to the first and last visible dock items; modified keys are left alone', () => {
  const { items, container, event } = dockFixture();
  const home = event('Home', items[2]);
  const end = event('End', items[0]);

  assert.equal(moveDockFocus(home, container, 'button'), true);
  assert.equal(items[0].focusOptions.preventScroll, true);
  assert.equal(moveDockFocus(end, container, 'button'), true);
  assert.equal(items[2].focusOptions.preventScroll, true);

  const modified = event('ArrowRight', items[0], { ctrlKey: true });
  assert.equal(moveDockFocus(modified, container, 'button'), false);
  assert.equal(modified.prevented, false);
});

test('shared desktop shortcut navigation follows visible geometry without activating apps', () => {
  const positions = [[0, 0], [0, 100], [100, 0], [100, 100], [0, 200]];
  const items = positions.map(([left, top]) => ({
    disabled: false,
    hidden: false,
    visible: true,
    focusOptions: null,
    scrolled: false,
    getClientRects() { return this.visible ? [{}] : []; },
    getBoundingClientRect() { return { left, top, width: 50, height: 50 }; },
    closest(selector) { return selector === '[data-desktop-app]' ? this : null; },
    focus(options) { this.focusOptions = options; },
    scrollIntoView(options) { this.scrolled = options; },
  }));
  const container = { querySelectorAll() { return items; } };
  const event = (key, target, modifiers = {}) => ({
    key, target, ...modifiers, prevented: false,
    preventDefault() { this.prevented = true; },
  });

  const right = event('ArrowRight', items[0]);
  assert.equal(moveDesktopShortcutFocus(right, container, '[data-desktop-app]'), true);
  assert.deepEqual(items[2].focusOptions, { preventScroll: true });
  assert.deepEqual(items[2].scrolled, { block: 'nearest', inline: 'nearest' });
  assert.equal(right.prevented, true);

  const down = event('ArrowDown', items[0]);
  assert.equal(moveDesktopShortcutFocus(down, container, '[data-desktop-app]'), true);
  assert.deepEqual(items[1].focusOptions, { preventScroll: true });

  const end = event('End', items[0]);
  assert.equal(moveDesktopShortcutFocus(end, container, '[data-desktop-app]'), true);
  assert.deepEqual(items[4].focusOptions, { preventScroll: true });

  const boundary = event('ArrowRight', items[3]);
  assert.equal(moveDesktopShortcutFocus(boundary, container, '[data-desktop-app]'), false);
  assert.equal(boundary.prevented, false);
  const modified = event('ArrowDown', items[0], { altKey: true });
  assert.equal(moveDesktopShortcutFocus(modified, container, '[data-desktop-app]'), false);
});
