import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { AiJob, listJobs, saveNewJob, removeJob, runJob, jobMarkdown, waitForJob } from '../src/utils/aiJobs';
const job = (id: string): AiJob => ({ id, title: id, fileCount: 2, fileNames: ['one', 'two'], startTime: '', progress: 0, status: 'processing', currentStep: '', resultFileName: 'test.md', resultSize: '', summarySnippet: '', files: [{ name: 'one', dataUrl: 'data:one' }, { name: 'two', dataUrl: 'data:two' }] });
const options = () => ({ signal: new AbortController().signal, changed: () => {}, complete: async () => {}, wait: async () => {} });

test('reload resumes only unfinished files and keeps account isolation', async () => {
  const j = job('resume'); await saveNewJob('alice', j);
  await runJob('alice', j, { ...options(), summarize: async (_, name) => { if (name === 'two') throw new Error('503'); return 'first result'; } });
  assert.equal((await listJobs('bob')).length, 0);
  const saved = (await listJobs('alice')).find(j => j.id === 'resume')!;
  assert.equal(saved.status, 'error'); assert.equal(saved.files[0].dataUrl, undefined);
  assert.match(jobMarkdown(saved), /first result/);
  const called: string[] = [];
  let result = '';
  await runJob('alice', saved, { ...options(), summarize: async (_, name) => { called.push(name); return 'second result'; }, complete: async (_, md) => { result = md; } });
  assert.deepEqual(called, ['two']); assert.match(result, /first result[\s\S]*second result/);
  assert.equal((await listJobs('alice')).some(j => j.id === 'resume'), false);
});

test('cancel during request never recreates a deleted job or starts another file', async () => {
  const j = job('cancel'); await saveNewJob('alice', j);
  const controller = new AbortController(); let calls = 0; let complete = false;
  await runJob('alice', j, { ...options(), signal: controller.signal, summarize: async () => {
    calls++; controller.abort(); await removeJob('alice', j.id); return 'late result';
  }, complete: async () => { complete = true; } });
  assert.equal(calls, 1); assert.equal(complete, false);
  assert.equal((await listJobs('alice')).some(j => j.id === 'cancel'), false);
});

test('rate limit waits once, but provider and daily quota do not auto-retry', async () => {
  for (const code of ['AI_RATE_LIMIT', 'AI_PROVIDER_QUOTA', 'AI_DAILY_QUOTA']) {
    const j = job(code); await saveNewJob('alice', j); let calls = 0; const waits: number[] = [];
    await runJob('alice', j, { ...options(), summarize: async () => { calls++; throw Object.assign(new Error(code), { code, retryAfter: 60 }); }, wait: async ms => { waits.push(ms); } });
    assert.equal(calls, code === 'AI_RATE_LIMIT' ? 2 : 1);
    assert.deepEqual(waits, code === 'AI_RATE_LIMIT' ? [60000] : []);
    await removeJob('alice', j.id);
  }
});

test('failed document save retains all results and retries save without provider calls', async () => {
  const j = job('save'); await saveNewJob('alice', j);
  await runJob('alice', j, { ...options(), summarize: async () => 'saved summary', complete: async () => { throw new Error('disk full'); } });
  const saved = (await listJobs('alice')).find(j => j.id === 'save')!;
  assert.equal(saved.progress, 100); let calls = 0;
  await runJob('alice', saved, { ...options(), summarize: async () => { calls++; return ''; } });
  assert.equal(calls, 0);
});

test('abort interrupts quota delay immediately', async () => {
  const c = new AbortController(); const pending = waitForJob(60000, c.signal); c.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});
