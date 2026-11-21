import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDesktopHandoff, desktopCallback, desktopVerificationCode } from '../src/services/desktop.ts';

const state = 's'.repeat(43), challenge = 'c'.repeat(43);
const valid = `#desktop-login?port=49152&state=${state}&challenge=${challenge}`;
test('desktop browser approval rejects arbitrary redirect URLs and malformed handoffs', () => {
  assert.deepEqual(parseDesktopHandoff(valid), { port: 49152, state, challenge });
  for (const hash of [valid + '&redirect=https://evil.test', valid + '&port=1234', valid.replace('49152', '80'),
    valid.replace('49152', '65536'), valid.replace('49152', '5e3'), valid.replace(state, 'short'), '#desktop-login']) assert.equal(parseDesktopHandoff(hash), undefined);
  const target = new URL(desktopCallback(parseDesktopHandoff(valid)!, 'a'.repeat(43)));
  assert.equal(target.origin, 'http://127.0.0.1:49152');
  assert.equal(target.searchParams.get('state'), state);
  assert.throws(() => desktopCallback(parseDesktopHandoff(valid)!, 'javascript:evil'));
});
test('browser and native app show the same code derived from state', async () => {
  const { createHash } = await import('node:crypto');
  assert.equal(await desktopVerificationCode(state), createHash('sha256').update(state).digest('hex').slice(0, 6).toUpperCase());
});
