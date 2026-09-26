import test from 'node:test';
import assert from 'node:assert/strict';
import { getAppCapabilities, prewarmCapture } from '../src/utils/appCapabilities';

const desktop = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0 Safari/537.36', platform: 'MacIntel', maxTouchPoints: 0 };
const iphone = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1', platform: 'iPhone', maxTouchPoints: 5 };

test('desktop browsers, including touch Windows, use only the file workspace', () => {
  for (const environment of [desktop,
    { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0', platform: 'Win32', maxTouchPoints: 10 },
    { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/140.0', platform: 'Linux x86_64' },
  ]) {
    const capabilities = getAppCapabilities(environment);
    assert.equal(capabilities.canCapture, false);
    assert.equal(capabilities.initialScreen, 'explorer');
    assert.deepEqual(capabilities.tutorialSections, ['explorer', 'apps']);
  }
});

test('phones and tablets retain capture, including iPad desktop user agent', () => {
  for (const environment of [iphone,
    { userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/140.0 Mobile Safari/537.36' },
    { userAgent: 'Mozilla/5.0 (Linux; Android 15; SM-X710) Chrome/140.0 Safari/537.36' },
    { ...desktop, maxTouchPoints: 5 },
    { userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)' },
  ]) {
    assert.equal(getAppCapabilities(environment).canCapture, true);
    assert.deepEqual(getAppCapabilities(environment).tutorialSections, ['camera', 'explorer', 'apps']);
  }
});

test('window resize, rotation and installed mode do not change product capabilities', () => {
  for (const environment of [desktop, iphone]) {
    for (const [width, height, standalone] of [[390, 844, false], [1440, 900, false], [844, 390, true]]) {
      const runtime = { ...environment, width, height, standalone };
      assert.deepEqual(getAppCapabilities(runtime), getAppCapabilities(environment));
    }
  }
  assert.equal(getAppCapabilities({ ...desktop, nativePlatform: 'ios' }).canCapture, true);
  assert.equal(getAppCapabilities({ ...desktop, nativePlatform: 'android' }).canCapture, true);
});

test('desktop warmup never accesses camera or microphone, even if permissions are granted', () => {
  let calls = 0;
  const media = { getUserMedia: async () => { calls++; throw new Error('must not run'); } };
  assert.equal(prewarmCapture(false, media), null);
  assert.equal(prewarmCapture(true, undefined), null);
  assert.equal(calls, 0);
});

test('mobile warmup requests camera then microphone and releases the permission-only mic stream', async () => {
  const calls: MediaStreamConstraints[] = []; let stopped = 0;
  const stream = { getTracks: () => [{ stop: () => { stopped++; } }] } as unknown as MediaStream;
  const media = { getUserMedia: async (constraints: MediaStreamConstraints) => { calls.push(constraints); return stream; } };
  assert.equal(await prewarmCapture(true, media), stream);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 2);
  assert.equal(calls[0].audio, false);
  assert.deepEqual(calls[1], { audio: true });
  assert.equal(stopped, 1);
});
