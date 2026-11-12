import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemberPageAnchors } from '../system/services/spaces/member-page-anchors.mjs';

const members = (...ids) => ids.map(userId => ({ userId }));

test('a confirmed action can return to the exact previously loaded page window', () => {
  const anchors = createMemberPageAnchors();
  anchors.record({ cursor: null, members: members('a', 'b'), append: false });
  anchors.record({ cursor: 'b', members: members('c', 'd'), append: true });
  anchors.record({ cursor: 'd', members: members('e'), append: true });
  assert.equal(anchors.cursorFor('a'), null);
  assert.equal(anchors.cursorFor('c'), 'b');
  assert.equal(anchors.cursorFor('e'), 'd');

  // Only the selected page is read afresh; earlier pages are not reused.
  anchors.reset();
  anchors.record({ cursor: 'b', members: members('c', 'd'), append: false });
  assert.equal(anchors.cursorFor('c'), 'b');
  assert.equal(anchors.cursorFor('e'), null);
});

test('refresh from the beginning discards old page anchors and uses canonical rows', () => {
  const anchors = createMemberPageAnchors();
  anchors.record({ cursor: null, members: members('a', 'b'), append: false });
  anchors.record({ cursor: 'b', members: members('c'), append: true });
  anchors.record({ cursor: null, members: members('a', 'c'), append: false });
  assert.equal(anchors.cursorFor('c'), null);
  assert.equal(anchors.cursorFor('b'), null);
  anchors.reset();
  assert.equal(anchors.cursorFor('a'), null);
});

test('malformed and duplicate page boundaries fail without corrupting previous anchors', () => {
  const anchors = createMemberPageAnchors();
  anchors.record({ cursor: null, members: members('a'), append: false });
  assert.throws(() => anchors.record({ cursor: 'a', members: members('a'), append: true }), /unique user IDs/);
  assert.throws(() => anchors.record({ cursor: 'a', members: members('x', 'x'), append: false }), /unique user IDs/);
  assert.throws(() => anchors.record({ cursor: 42, members: members('x'), append: false }), /Invalid member page anchor/);
  assert.equal(anchors.cursorFor('a'), null);
  anchors.record({ cursor: 'a', members: members('b'), append: true });
  assert.equal(anchors.cursorFor('b'), 'a');
});
