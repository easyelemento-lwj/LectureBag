import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraFrame } from '../src/utils/cameraFrame';

test('camera frame fits portrait, landscape and short windows at the selected ratio', () => {
  for (const [w, h] of [[390, 844], [1440, 900], [900, 800], [800, 900]]) {
    assert.deepEqual(cameraFrame(w, h, '전체'), { width: w, height: h });
    for (const mode of ['1:1', '4:3', '16:9'] as const) {
      const result = cameraFrame(w, h, mode);
      const ratio = mode === '1:1' ? 1 : mode === '4:3' ? 4 / 3 : 16 / 9;
      assert.ok(Math.abs(result.width / result.height - (w > h ? ratio : 1 / ratio)) < 0.00001);
      assert.ok(result.width <= w + 0.001 && result.height <= h + 0.001);
    }
  }
});
