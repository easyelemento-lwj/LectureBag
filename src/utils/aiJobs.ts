import { createStore, entries, set, update, del } from 'idb-keyval';
import { accountKey } from './accountStorage';

export interface AiJob {
  id: string; title: string; fileCount: number; fileNames: string[]; startTime: string;
  progress: number; status: 'processing' | 'completed' | 'error'; currentStep: string;
  resultFileName: string; resultSize: string; summarySnippet: string;
  files: Array<{ name: string; dataUrl?: string; summary?: string }>;
}
const store = createStore('lecturebag-ai-jobs', 'jobs');
const db = () => store;
const key = (uid: string, id: string) => accountKey(uid, `ai_job:${id}`);
export async function saveNewJob(uid: string, job: AiJob) { await set(key(uid, job.id), job, db()); }
export async function listJobs(uid: string): Promise<AiJob[]> {
  const prefix = accountKey(uid, 'ai_job:');
  return (await entries<string, AiJob>(db())).filter(([k, v]) => k.startsWith(prefix) && !!v).map(([, v]) => v);
}
export async function removeJob(uid: string, id: string) { await del(key(uid, id), db()); }
// An in-flight request must never resurrect a job deleted by cancel or another tab.
async function checkpoint(uid: string, job: AiJob) {
  let exists = false;
  await update<AiJob>(key(uid, job.id), previous => {
    exists = !!previous;
    return previous ? job : previous;
  }, db());
  if (!exists) throw new DOMException('Cancelled', 'AbortError');
}
export function jobMarkdown(job: AiJob) {
  return `# ${job.title} 통합 분석 결과\n\n` + job.files.filter(f => f.summary !== undefined)
    .map(f => `## ${f.name}\n\n${f.summary}\n\n---\n\n`).join('');
}
export function waitForJob(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException('Cancelled', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
export async function runJob(uid: string, job: AiJob, options: {
  signal: AbortSignal;
  summarize: (data: string | undefined, name: string, signal: AbortSignal) => Promise<string>;
  changed: (job: AiJob) => void;
  complete: (job: AiJob, markdown: string) => Promise<void>;
  wait?: typeof waitForJob;
}) {
  const { signal, changed } = options;
  const wait = options.wait || waitForJob;
  const check = () => { if (signal.aborted) throw new DOMException('Cancelled', 'AbortError'); };
  const publish = async () => { check(); await checkpoint(uid, job); check(); changed({ ...job }); };
  try {
    check();
    job.status = 'processing';
    let sent = false;
    for (let i = 0; i < job.files.length; i++) {
      const file = job.files[i];
      if (file.summary !== undefined) continue;
      if (sent) {
        job.currentStep = `${job.files.filter(f => f.summary !== undefined).length}/${job.fileCount}개 완료 · 다음 파일 요청 대기 중`;
        await publish();
        await wait(6200, signal);
      }
      let rateRetries = 0;
      while (true) {
        check();
        job.currentStep = `[${i + 1}/${job.fileCount}] ${file.name} 분석 중 (일시 오류는 서버에서 재시도)`;
        await publish();
        try {
          sent = true;
          const summary = await options.summarize(file.dataUrl, file.name, signal);
          check();
          file.summary = summary;
          // Keep source until the successful checkpoint; release it in the same transaction.
          file.dataUrl = undefined;
          job.progress = Math.round(job.files.filter(f => f.summary !== undefined).length / job.fileCount * 100);
          job.summarySnippet = job.files.find(f => f.summary !== undefined)?.summary?.slice(0, 150) || '';
          await publish();
          break;
        } catch (error) {
          const e = error as { code?: string; retryAfter?: number };
          if (e.code !== 'AI_RATE_LIMIT' || rateRetries++ >= 1) throw error;
          const seconds = Math.max(1, Math.min(120, e.retryAfter || 60));
          job.currentStep = `요청 간격 제한 · ${seconds}초 대기 후 자동으로 이어갑니다.`;
          await publish();
          await wait(seconds * 1000, signal);
        }
      }
    }
    check();
    await options.complete(job, jobMarkdown(job));
    check();
    job.status = 'completed';
    job.currentStep = 'AI 센터 저장 완료';
    await publish();
    await removeJob(uid, job.id);
  } catch (error) {
    if (signal.aborted || (error as Error).name === 'AbortError') return;
    job.status = 'error';
    job.currentStep = `${job.files.filter(f => f.summary !== undefined).length}/${job.fileCount}개 완료 · ${(error as Error).message} 완료된 파일은 다시 처리하지 않습니다.`;
    // Storage failure must be visible even if saving the error state also fails.
    try { await checkpoint(uid, job); } catch { /* Retain the last durable checkpoint. */ }
    if (!signal.aborted) changed({ ...job });
  }
}
