import assert from 'node:assert/strict';
import test from 'node:test';
import { createUuidIdempotencyKey } from '../system/services/idempotency/uuid.mjs';

test('UUID idempotency helper validates and normalizes browser-generated keys', () => {
  const key = createUuidIdempotencyKey({ randomUUID: () => 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' });
  assert.equal(key, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
});

test('UUID idempotency helper fails closed when secure UUID generation is unavailable or invalid', () => {
  assert.throws(() => createUuidIdempotencyKey(null), /unavailable/);
  assert.throws(() => createUuidIdempotencyKey({ randomUUID: () => 'not-a-uuid' }), /invalid value/);
});
