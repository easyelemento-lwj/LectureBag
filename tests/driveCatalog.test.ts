import test from 'node:test';
import assert from 'node:assert/strict';
import type { User } from 'firebase/auth';
import { CloudCatalog } from '../src/services/drive/cloudCatalog';

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
