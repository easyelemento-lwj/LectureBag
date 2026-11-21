import test from 'node:test';
import assert from 'node:assert/strict';
import { hasFullSeekRange, prepareAudioPlayback } from '../src/utils/prepareAudioPlayback';

const fixture = (duration: number, ranges: number[][]) => ({ duration,
  seekable: { length: ranges.length, start: (i: number) => ranges[i][0], end: (i: number) => ranges[i][1] } });
test('playback requires a finite duration and a continuous full seek range', () => {
  assert.equal(hasFullSeekRange(fixture(Infinity, [[0, Infinity]])), false);
  assert.equal(hasFullSeekRange(fixture(975, [[0, Infinity]])), false);
  assert.equal(hasFullSeekRange(fixture(975, [[0, 30]])), false);
  assert.equal(hasFullSeekRange(fixture(975, [[0, 30], [900, 975]])), false);
  assert.equal(hasFullSeekRange(fixture(975, [[0, 975]])), true);
});
test('preparation rejects remote URLs and already cancelled work before touching the player', async () => {
  const audio = {} as HTMLAudioElement;
  await assert.rejects(prepareAudioPlayback(audio, 'https://example.invalid/audio', new AbortController().signal));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(prepareAudioPlayback(audio, 'blob:local', controller.signal));
});
