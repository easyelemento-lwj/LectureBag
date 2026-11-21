import test from 'node:test';
import assert from 'node:assert/strict';
import type { User } from 'firebase/auth';
import { CloudCatalog, CatalogError } from '../src/services/drive/cloudCatalog';

test('local/cache owner checks reject another user even without a network request', () => {
  let current = 'alice';
  const user = { uid: 'alice' } as User;
  const catalog = new CloudCatalog(user, () => current, 'https://api.example');
  catalog.assertOwner('alice');
  assert.throws(() => catalog.assertOwner('bob'));
  current = 'bob'; assert.throws(() => catalog.assertOwner('alice'));
});

test('catalog refuses requests when the Firebase account changes before token acquisition', async () => {
  let uid = 'alice';
  let calls = 0;
  const user = { uid, getIdToken: async () => { uid = 'bob'; return 'synthetic-token'; } } as unknown as User;
  const original = globalThis.fetch;
  globalThis.fetch = async () => { calls++; return Response.json({}); };
  try {
    const client = new CloudCatalog(user, () => uid, 'https://api.example');
    await assert.rejects(client.status(), /로그인 상태/);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

test('catalog rejects late responses from a previous account', async () => {
  let uid = 'alice';
  const user = { uid, getIdToken: async () => 'synthetic-token' } as unknown as User;
  const original = globalThis.fetch;
  globalThis.fetch = async (_, init) => {
    assert.equal((init!.headers as Record<string, string>).Authorization, 'Bearer synthetic-token');
    assert.equal(init!.credentials, 'omit');
    uid = 'bob';
    return Response.json({ connected: true, email: 'private@example.com' });
  };
  try {
    await assert.rejects(new CloudCatalog(user, () => uid, 'https://api.example').status(), /로그인 상태/);
  } finally { globalThis.fetch = original; }
});

test('catalog disallows insecure remote origins and never displays arbitrary server details', async () => {
  const user = { uid: 'alice', getIdToken: async () => 'synthetic-token' } as unknown as User;
  await assert.rejects(new CloudCatalog(user, () => 'alice', 'http://api.example').status(), /안전한 서버/);
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ detail: 'PRIVATE-TOKEN' }, { status: 500 });
  try {
    await assert.rejects(new CloudCatalog(user, () => 'alice', 'https://api.example').status(),
      (error: Error) => !error.message.includes('PRIVATE'));
  } finally { globalThis.fetch = original; }
});

test('change feed authenticates by header and classifies revoked auth versus an old server', async () => {
  const user = { uid: 'alice', getIdToken: async () => 'synthetic-token' } as unknown as User;
  const original = globalThis.fetch; let status = 401;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, '/api/cloud-files/changes');
    assert.equal(url.searchParams.get('cursor'), 'opaque+cursor');
    assert.equal(url.searchParams.get('wait'), '20');
    assert.ok(!url.href.includes('synthetic-token'));
    assert.equal((init!.headers as Record<string, string>).Authorization, 'Bearer synthetic-token');
    return Response.json({ detail: 'PRIVATE' }, { status });
  };
  const catalog = new CloudCatalog(user, () => 'alice', 'https://api.example');
  try {
    await assert.rejects(catalog.changes('conn', 'opaque+cursor', 20), (error: CatalogError) => error.httpStatus === 401 && error.code === 'DRIVE_AUTH_REQUIRED' && !error.message.includes('PRIVATE'));
    status = 404;
    await assert.rejects(catalog.changes('conn', 'opaque+cursor', 20), (error: CatalogError) => error.code === 'DRIVE_SYNC_NOT_AVAILABLE');
  } finally { globalThis.fetch = original; }
});

test('independent catalog clients share browser cooldown, including manual retry', async () => {
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  const user = { uid: crypto.randomUUID(), getIdToken: async () => 'synthetic' } as unknown as User;
  const oldFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ detail: { code: 'DRIVE_RATE_LIMITED' } },
    { status: 429, headers: { 'Retry-After': '81' } }); };
  try {
    const a = new CloudCatalog(user, () => user.uid, 'https://budget.example');
    const b = new CloudCatalog(user, () => user.uid, 'https://budget.example');
    await assert.rejects(a.status(), (e: CatalogError) => e.httpStatus === 429 && e.retryAt! >= Date.now() + 80_000);
    await assert.rejects(b.withPriority('interactive').status(), (e: CatalogError) => e.httpStatus === 429);
    assert.equal(calls, 1, 'second subsystem must not hit the server while cooling down');
  } finally {
    globalThis.fetch = oldFetch;
    if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow); else Reflect.deleteProperty(globalThis, 'window');
  }
});
