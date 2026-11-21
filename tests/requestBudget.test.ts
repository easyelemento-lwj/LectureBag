import test from 'node:test';
import assert from 'node:assert/strict';
import { RequestBudget, RequestCoolingDown, retryAfterMs, type BudgetState, type BudgetPorts } from '../src/services/drive/requestBudget';
import { nextSyncDelay, retrySyncDelay } from '../src/services/drive/syncPolicy';
import { DriveClient, DriveTransferError } from '../src/services/drive/driveClient';

function clock() {
  let time = 100_000, saved: BudgetState | undefined;
  const waits: Array<{ until: number; resolve(): void }> = [];
  const ports: BudgetPorts = { now: () => time, read: () => saved, write: s => { saved = s; }, lock: async work => work(),
    wait: (ms, signal) => new Promise<void>((resolve, reject) => {
      const item = { until: time + ms, resolve: () => { signal.removeEventListener('abort', abort); resolve(); } };
      const abort = () => { const i = waits.indexOf(item); if (i >= 0) waits.splice(i, 1); reject(signal.reason); };
      signal.addEventListener('abort', abort, { once: true }); waits.push(item);
    }) };
  return { ports, state: () => saved, now: () => time, advance: async (ms: number) => {
    time += ms;
    for (const item of waits.splice(0)) { if (item.until <= time) item.resolve(); else waits.push(item); }
    await new Promise<void>(resolve => setImmediate(resolve));
  }, settle: () => new Promise<void>(resolve => setImmediate(resolve)) };
}
test('Retry-After accepts seconds and HTTP dates, rejects malformed values, and preserves long cooldowns', () => {
  assert.equal(retryAfterMs('45', 0), 45_000);
  assert.equal(retryAfterMs('Thu, 01 Jan 1970 00:02:00 GMT', 30_000), 90_000);
  assert.equal(retryAfterMs(null), 60_000); assert.equal(retryAfterMs('nonsense'), 60_000);
  assert.equal(retryAfterMs('3600'), 3_600_000); assert.equal(retryAfterMs('0'), 1000);
});
test('background requests are paced; direct actions overtake queued scans without bypassing cooldown', async () => {
  const c = clock(), gate = new RequestBudget(c.ports), order: string[] = [];
  await gate.enter('background');
  const bg = gate.enter('background').then(() => { order.push('background'); });
  await c.settle();
  const manual = gate.enter('interactive').then(() => { order.push('manual'); });
  await c.settle(); await c.advance(2000); await manual;
  assert.deepEqual(order, ['manual']); await c.advance(2000); await bg;
  assert.deepEqual(order, ['manual', 'background']);
  await gate.coolDown(60_000);
  await assert.rejects(gate.enter('interactive'), RequestCoolingDown);
});
test('cooldown is shared with another tab/reload and does not consume additional slots', async () => {
  const c = clock(), first = new RequestBudget(c.ports), second = new RequestBudget(c.ports);
  await first.enter('background'); await first.coolDown(90_000);
  await assert.rejects(second.enter('background'), (e: RequestCoolingDown) => e.retryAt === c.now() + 90_000);
  await assert.rejects(new RequestBudget(c.ports).enter('interactive'), RequestCoolingDown);
  assert.equal(c.state()!.starts.length, 1);
  await c.advance(90_000); await second.enter('background');
  assert.equal(c.state()!.starts.length, 1);
});
test('cancellation removes queued requests and never dispatches them later', async () => {
  const c = clock(), gate = new RequestBudget(c.ports), abort = new AbortController();
  await gate.enter('background');
  const queued = gate.enter('background', abort.signal); const rejected = assert.rejects(queued);
  abort.abort(); await rejected; await c.advance(10_000);
  assert.equal(c.state()!.starts.length, 1);
});
test('rolling budget leaves reserved capacity for direct actions', async () => {
  const c = clock(), gate = new RequestBudget(c.ports);
  for (let i = 0; i < 20; i++) { await gate.enter('background'); await c.advance(2000); }
  let ran = false; const bg = gate.enter('background').then(() => { ran = true; }); await c.settle();
  await gate.enter('interactive'); await c.settle(); assert.equal(ran, false);
  await c.advance(22_000); await bg; assert.equal(ran, true);
});
test('two accounts use independent budgets and background/retry policy includes jitter', async () => {
  const a = clock(), b = clock(); await new RequestBudget(a.ports).coolDown(60_000);
  await new RequestBudget(b.ports).enter('background');
  assert.equal(nextSyncDelay(false, 0), 60_000); assert.equal(nextSyncDelay(true, 0), 300_000);
  assert.ok(nextSyncDelay(false, 0.5) > 60_000);
  assert.equal(retrySyncDelay(1, 190_000, 100_000, 0), 90_000);
});
test('direct Drive throttling forwards cooldown and is distinct from missing permissions', async () => {
  for (const status of [429, 403]) {
    let delay = 0;
    const client = new DriveClient(async () => 'synthetic', async () => Response.json({ error: { errors: [{ reason: 'userRateLimitExceeded' }] } },
      { status, headers: { 'Retry-After': '77' } }), async ms => { delay = ms; });
    await assert.rejects(client.metadata('synthetic-file'), (e: DriveTransferError) => e.httpStatus === 429 && e.code === 'retry_wait' && !!e.retryAt);
    assert.equal(delay, 77_000);
  }
});
