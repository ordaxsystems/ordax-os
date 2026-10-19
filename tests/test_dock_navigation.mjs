import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { moveDesktopShortcutFocus, moveDockFocus, scrollDockFromWheel } from '../system/services/surface/dock-navigation.mjs';

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

test('desktop mouse wheel scrolls a dock only while horizontal overflow can consume it', () => {
  const dock = { scrollWidth: 900, clientWidth: 360, scrollLeft: 0 };
  const wheel = (deltaX, deltaY, deltaMode = 0) => ({
    deltaX, deltaY, deltaMode, prevented: false,
    preventDefault() { this.prevented = true; },
  });

  const down = wheel(0, 120);
  assert.equal(scrollDockFromWheel(down, dock), true);
  assert.equal(dock.scrollLeft, 120);
  assert.equal(down.prevented, true);

  const line = wheel(0, 3, 1);
  assert.equal(scrollDockFromWheel(line, dock), true);
  assert.equal(dock.scrollLeft, 168);

  const trackpad = wheel(80, 15);
  assert.equal(scrollDockFromWheel(trackpad, dock), true);
  assert.equal(dock.scrollLeft, 248);

  dock.scrollLeft = 539;
  const atEnd = wheel(0, 20);
  assert.equal(scrollDockFromWheel(atEnd, dock), true);
  assert.equal(dock.scrollLeft, 540);
  const beyondEnd = wheel(0, 20);
  assert.equal(scrollDockFromWheel(beyondEnd, dock), false);
  assert.equal(beyondEnd.prevented, false);
});

test('desktop wheel does not hijack a dock without overflow or at the current edge', () => {
  const wheel = (deltaY) => ({ deltaX: 0, deltaY, deltaMode: 0, prevented: false, preventDefault() { this.prevented = true; } });
  const noOverflow = wheel(40);
  assert.equal(scrollDockFromWheel(noOverflow, { scrollWidth: 300, clientWidth: 300, scrollLeft: 0 }), false);
  assert.equal(noOverflow.prevented, false);
  const atStart = wheel(-40);
  assert.equal(scrollDockFromWheel(atStart, { scrollWidth: 500, clientWidth: 300, scrollLeft: 0 }), false);
  assert.equal(atStart.prevented, false);
});

test('Web and Native bind the same wheel behavior and release it with their dock lifecycle', async () => {
  const [native, web] = await Promise.all([
    readFile(new URL('../system/surface/ui/surface.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../system/surface/workspace/components/central/meridian-navigation.tsx', import.meta.url), 'utf8'),
  ]);
  for (const [host, source] of [['Native', native], ['Web', web]]) {
    assert.match(source, /scrollDockFromWheel/);
    assert.match(source, /addEventListener\(['"]wheel['"],\s*\w+,\s*\{\s*passive:\s*false\s*\}\)/,
      `${host} allows the shared handler to consume mouse-wheel input only when needed`);
    assert.match(source, /removeEventListener\(['"]wheel['"],\s*\w+\)/,
      `${host} removes the dock listener when its presentation unmounts`);
  }
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
