import test from 'node:test';
import assert from 'node:assert/strict';
import { openCamera, photoGeometry } from '../src/utils/cameraQuality';

test('requests high resolution as a preference, not a requirement', async () => {
  const calls: MediaStreamConstraints[] = [];
  const stream = {} as MediaStream;
  assert.equal(await openCamera({ getUserMedia: async c => { calls.push(c!); return stream; } }, 'environment'), stream);
  assert.deepEqual(calls, [{ video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1440 } }, audio: false }]);
});

test('falls back for constraint failures but never retries permission denial', async () => {
  let count = 0;
  await openCamera({ getUserMedia: async () => {
    if (++count === 1) throw { name: 'OverconstrainedError' };
    return {} as MediaStream;
  } }, 'user');
  assert.equal(count, 2);
  count = 0;
  await assert.rejects(openCamera({ getUserMedia: async () => { count++; throw new Error('denied'); } }, 'user'));
  assert.equal(count, 1);
});

test('preserves native pixels and center crops portrait, landscape and square', () => {
  for (const [w, h] of [[1280, 720], [720, 1280], [2560, 1440], [3840, 2160]]) {
    for (const ratio of [1, 3 / 4, 4 / 3, 9 / 16, 16 / 9]) {
      const crop = photoGeometry(w, h, ratio);
      assert.ok(crop.width <= crop.sw && crop.height <= crop.sh);
      assert.ok(Math.max(crop.width, crop.height) <= 2560);
      assert.ok(Math.abs(crop.width / crop.height - ratio) < .01);
      assert.equal(crop.sx * 2 + crop.sw, w);
      assert.equal(crop.sy * 2 + crop.sh, h);
    }
  }
  assert.equal(photoGeometry(1280, 720, 16 / 9).width, 1280);
  assert.equal(photoGeometry(2560, 1440, 16 / 9).width, 2560);
  assert.throws(() => photoGeometry(0, 0, 1));
});
