import test from 'node:test';
import assert from 'node:assert/strict';
import { DriveClient, DriveTransferError, validateSessionUri } from '../src/services/drive/driveClient';

const session = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=test';
const request = (fn: (url: string, init: RequestInit) => Response | Promise<Response>) =>
  new DriveClient(async () => 'synthetic-access', async (url, init) => fn(String(url), init!));

test('upload recovery uses acknowledged bytes and treats absent Range as zero', async () => {
  const client = request((url, init) => {
    assert.equal(url, session);
    assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer synthetic-access');
    assert.equal((init.headers as Record<string, string>)['Content-Range'], 'bytes */100');
    return new Response(null, { status: 308, headers: { Range: 'bytes=0-64' } });
  });
  assert.deepEqual(await client.probe(session, 100), { complete: false, confirmedBytes: 65 });
  assert.deepEqual(await request(() => new Response(null, { status: 308 })).probe(session, 100),
    { complete: false, confirmedBytes: 0 });
});

test('final chunk may be short and completion must match the full file size', async () => {
  const source = new Blob([new Uint8Array(262154)], { type: 'audio/mp4' });
  const client = request((_, init) => {
    assert.equal((init.headers as Record<string, string>)['Content-Range'], 'bytes 262144-262153/262154');
    assert.equal((init.body as Blob).size, 10);
    return Response.json({ id: 'drive-id', size: String(source.size) });
  });
  assert.equal((await client.sendChunk(session, source, 262144, 262144)).complete, true);
  await assert.rejects(client.sendChunk(session, source, 0, 100));
  await assert.rejects(request(() => Response.json({ id: 'id', size: '9' })).probe(session, 10));
});

test('session URIs cannot forward credentials to another origin', () => {
  for (const uri of ['https://attacker.example/upload?upload_id=x', session.replace('https:', 'http:'),
    session.replace('www.googleapis.com', 'www.googleapis.com.attacker.example'), session.replace('/upload/', '/other/')]) {
    assert.throws(() => validateSessionUri(uri));
  }
});

test('session expiry, quota and transient failures remain distinguishable', async () => {
  for (const [status, reason, code] of [[404, '', 'session_expired'], [401, '', 'needs_auth'],
    [403, 'storageQuotaExceeded', 'quota_full'], [403, 'userRateLimitExceeded', 'retry_wait'],
    [503, '', 'retry_wait'], [403, 'insufficientPermissions', 'failed']] as const) {
    const client = request(() => Response.json({ error: { errors: [{ reason }], message: 'private server text' } }, { status }));
    await assert.rejects(client.probe(session, 100), (error: DriveTransferError) => error.code === code && !error.message.includes('private'));
  }
});

test('aborted identity scope never starts a request after token resolution', async () => {
  const controller = new AbortController();
  const client = new DriveClient(async () => { controller.abort(); return 'secret'; }, async () => {
    assert.fail('must not send after account cancellation');
  });
  await assert.rejects(client.generateId(controller.signal));
});
