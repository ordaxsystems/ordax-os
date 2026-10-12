import assert from 'node:assert/strict';
import test from 'node:test';
import { createWebJsonReader, WEB_JSON_READ_TIMEOUT_MS } from '../system/adapters/web/json-read.mjs';

function fixture() {
  const requests = [], timers = new Map();
  let ordinal = 0;
  const windowRef = {
    fetch: (path, options) => new Promise((resolve, reject) => requests.push({ path, options, resolve, reject })),
    setTimeout(callback, delay) {
      assert.equal(delay, WEB_JSON_READ_TIMEOUT_MS);
      const id = ++ordinal; timers.set(id, callback); return id;
    },
    clearTimeout(id) { timers.delete(id); },
  };
  return { requests, timers, reader: createWebJsonReader(windowRef) };
}
const response = value => ({ ok: true, status: 200, json: async () => value });

test('successful bounded GET carries same-origin credentials and clears its deadline', async () => {
  const f = fixture();
  try {
    const pending = f.reader.read('/auth/session');
    assert.deepEqual({
      method: f.requests[0].options.method,
      credentials: f.requests[0].options.credentials,
      cache: f.requests[0].options.cache,
      redirect: f.requests[0].options.redirect,
    }, { method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
    f.requests[0].resolve(response({ subject: 'validated-by-domain' }));
    assert.deepEqual(await pending, { ok: true, status: 200, value: { subject: 'validated-by-domain' } });
    assert.equal(f.timers.size, 0);
  } finally { f.reader.dispose(); }
});

test('cancel settles a noncooperative transport without waiting for late fetch bytes', async () => {
  const f = fixture();
  try {
    const pending = f.reader.read('/auth/session');
    f.reader.cancel();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(f.requests[0].options.signal.aborted, true);
    assert.equal(f.timers.size, 0);
    f.requests[0].reject(Error('late network rejection'));
    await Promise.resolve();
    const fresh = f.reader.read('/auth/session');
    f.requests[1].resolve(response({ subject: 'current' }));
    assert.equal((await fresh).value.subject, 'current');
  } finally { f.reader.dispose(); }
});

test('deadline also bounds a stalled JSON body after headers have arrived', async () => {
  const f = fixture();
  let resolveBody;
  const body = new Promise(resolve => { resolveBody = resolve; });
  try {
    const pending = f.reader.read('/account/spaces');
    f.requests[0].resolve({ ok: true, status: 200, json: () => body });
    await Promise.resolve();
    [...f.timers.values()][0]();
    await assert.rejects(pending, { name: 'TimeoutError' });
    assert.equal(f.requests[0].options.signal.aborted, true);
    assert.equal(f.timers.size, 0);
    resolveBody({ spaces: ['stale'] });
    await Promise.resolve();
  } finally { f.reader.dispose(); }
});

test('a new read supersedes an older one without its cleanup cancelling the fresh request', async () => {
  const f = fixture();
  try {
    const older = f.reader.read('/auth/session');
    const fresh = f.reader.read('/auth/session');
    await assert.rejects(older, { name: 'AbortError' });
    assert.equal(f.requests[1].options.signal.aborted, false);
    assert.equal(f.timers.size, 1);
    f.requests[1].resolve(response({ current: true }));
    await fresh;
    assert.equal(f.timers.size, 0);
  } finally { f.reader.dispose(); }
});

test('HTTP denial is returned without parsing a body; unsupported paths never reach fetch', async () => {
  const f = fixture();
  try {
    for (const path of ['https://example.invalid/session', '//example.invalid/session', '/x\\y', '/x#fragment']) {
      await assert.rejects(f.reader.read(path), TypeError);
    }
    assert.equal(f.requests.length, 0);
    const pending = f.reader.read('/account/spaces');
    f.requests[0].resolve({ ok: false, status: 401, json: () => { throw Error('Denial body read'); } });
    assert.deepEqual(await pending, { ok: false, status: 401, value: null });
  } finally { f.reader.dispose(); }
});

test('disposal settles a pending read and prevents new requests', async () => {
  const f = fixture();
  const pending = f.reader.read('/auth/session');
  f.reader.dispose();
  f.reader.dispose();
  await assert.rejects(pending, { name: 'AbortError' });
  await assert.rejects(f.reader.read('/auth/session'), /disposed/);
  assert.equal(f.requests.length, 1);
  assert.equal(f.timers.size, 0);
});
