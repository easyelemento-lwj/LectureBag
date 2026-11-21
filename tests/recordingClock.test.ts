import test from 'node:test';
import assert from 'node:assert/strict';
import { RecordingClock } from '../src/utils/recordingClock';

test('delayed UI updates do not lose elapsed seconds, including a ten minute interval', () => {
  let now = 100; const clock = new RecordingClock(() => now);
  clock.start(); now += 10 * 60 * 1000 + 789;
  assert.equal(clock.seconds(), 600); assert.equal(clock.stop(), 600789);
  now += 3000; assert.equal(clock.elapsedMs(), 600789);
});
test('pauses exclude only paused time and preserve fractional active seconds', () => {
  let now = 0; const clock = new RecordingClock(() => now);
  clock.start(); now = 650; clock.pause(); now = 10650;
  assert.equal(clock.elapsedMs(), 650); clock.pause(); clock.resume(); clock.resume();
  now += 550; clock.pause(); assert.equal(clock.seconds(), 1);
  now += 20000; assert.equal(clock.stop(), 1200);
  clock.resume(); now += 1000; assert.equal(clock.stop(), 1200);
});
test('stop uses elapsed time even without a display tick; a new recording resets the clock', () => {
  let now = 1000; const clock = new RecordingClock(() => now);
  assert.equal(clock.seconds(), 0); clock.start(); now += 2750;
  assert.equal(clock.stop(), 2750); clock.start(); assert.equal(clock.seconds(), 0);
  now += 320; assert.equal(clock.stop(), 320);
});
test('system wall clock changes cannot affect the injected monotonic recording clock', () => {
  let time = 0; const clock = new RecordingClock(() => time), original = Date.now;
  try {
    clock.start(); Date.now = () => -100000; time = 2100; assert.equal(clock.seconds(), 2);
    Date.now = () => 9999999999999; time = 5100; assert.equal(clock.stop(), 5100);
  } finally { Date.now = original; }
});
