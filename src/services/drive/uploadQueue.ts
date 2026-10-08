import { createStore } from 'idb-keyval';
import type { DriveIdentity } from './types';

export type UploadState = 'queued' | 'uploading' | 'verifying' | 'registering' | 'synced'
  | 'offline' | 'needs_auth' | 'quota_full' | 'retry_wait' | 'failed' | 'paused' | 'cancelled';

export interface UploadSource extends DriveIdentity {
  fileId: string;
  localFileRef: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  capturedAt: string;
  logicalFolderId: string;
}

export interface UploadJob extends UploadSource {
  state: UploadState;
  revision: number;
  confirmedBytes: number;
  attempt: number;
  resumeState?: 'queued' | 'uploading' | 'verifying' | 'registering';
  retryAt?: number;
  driveFileId?: string;
  nativeTaskId?: string;
  // Reference only: session URI belongs in the platform's protected store.
  protectedSessionRef?: string;
  lease?: { token: string; expiresAt: number };
}

export function uploadKey(identity: DriveIdentity, fileId: string) {
  if (!identity.ownerUid || !identity.connectionId || !fileId) throw new Error('업로드 계정과 파일 ID가 필요합니다.');
  return JSON.stringify([identity.ownerUid, identity.connectionId, fileId]);
}

/** Native implementations must provide the same atomic compare-and-set semantics. */
export interface UploadJobStore {
  update(key: string, change: (current: UploadJob | undefined) => UploadJob): Promise<UploadJob>;
  list(identity: DriveIdentity): Promise<UploadJob[]>;
}

export class IndexedDbUploadJobStore implements UploadJobStore {
  private store = createStore('lecturebag-drive-jobs', 'jobs');

  update(key: string, change: (current: UploadJob | undefined) => UploadJob): Promise<UploadJob> {
    return this.store('readwrite', store => new Promise((resolve, reject) => {
      let result: UploadJob;
      let cause: unknown;
      const tx = store.transaction;
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(cause || tx.error || new Error('작업 저장 실패'));
      const request = store.get(key);
      request.onsuccess = () => {
        try { result = change(request.result); store.put(result, key); }
        catch (error) { cause = error; tx.abort(); }
      };
    }));
  }

  list(identity: DriveIdentity): Promise<UploadJob[]> {
    return this.store('readonly', store => new Promise((resolve, reject) => {
      const request = store.openCursor();
      const jobs: UploadJob[] = [];
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const job: UploadJob = cursor.value;
        if (job.ownerUid === identity.ownerUid && job.connectionId === identity.connectionId) jobs.push(job);
        cursor.continue();
      };
      store.transaction.oncomplete = () => resolve(jobs);
      store.transaction.onabort = store.transaction.onerror = () => reject(store.transaction.error);
    }));
  }
}

const transitions: Partial<Record<UploadState, UploadState[]>> = {
  queued: ['uploading'], uploading: ['verifying'], verifying: ['registering'], registering: ['synced'],
};
type Progress = Pick<UploadJob, 'state'> & Partial<Pick<UploadJob,
  'confirmedBytes' | 'driveFileId' | 'nativeTaskId' | 'protectedSessionRef'>>;

export class UploadQueue {
  constructor(private store: UploadJobStore, private identity: DriveIdentity, private now = Date.now) {}

  async enqueue(source: UploadSource): Promise<UploadJob> {
    this.checkIdentity(source);
    if (!source.localFileRef || !Number.isSafeInteger(source.sizeBytes) || source.sizeBytes <= 0 ||
      !Number.isFinite(Date.parse(source.capturedAt))) throw new Error('저장된 원본 파일 정보가 올바르지 않습니다.');
    return this.store.update(uploadKey(this.identity, source.fileId), current => {
      if (current) {
        for (const key of ['localFileRef', 'sizeBytes', 'mimeType', 'name', 'capturedAt', 'logicalFolderId'] as const) {
          if (current[key] !== source[key]) throw new Error('동일 ID에 다른 원본을 등록할 수 없습니다.');
        }
        // Preserve cancellation/deletion and completion even after a stale enqueue.
        return current;
      }
      return { ownerUid: source.ownerUid, connectionId: source.connectionId, fileId: source.fileId,
        localFileRef: source.localFileRef, name: source.name, mimeType: source.mimeType,
        sizeBytes: source.sizeBytes, capturedAt: source.capturedAt, logicalFolderId: source.logicalFolderId,
        state: 'queued', revision: 1, confirmedBytes: 0, attempt: 0 };
    });
  }

  list() { return this.store.list(this.identity); }

  claim(fileId: string, leaseMs = 60_000) {
    if (leaseMs < 1000 || leaseMs > 300_000) throw new Error('잘못된 잠금 시간입니다.');
    return this.store.update(uploadKey(this.identity, fileId), current => {
      const job = this.require(current);
      if (['synced', 'cancelled', 'failed', 'needs_auth', 'quota_full', 'paused', 'offline'].includes(job.state) ||
        (job.retryAt || 0) > this.now() || (job.lease?.expiresAt || 0) > this.now()) throw new Error('작업을 시작할 수 없습니다.');
      return { ...job, revision: job.revision + 1, lease: { token: crypto.randomUUID(), expiresAt: this.now() + leaseMs } };
    });
  }

  advance(fileId: string, leaseToken: string, expectedRevision: number, progress: Progress) {
    return this.store.update(uploadKey(this.identity, fileId), current => {
      const job = this.require(current);
      this.checkLease(job, leaseToken, expectedRevision);
      const resume = ['retry_wait'].includes(job.state);
      const recoveryTarget = job.resumeState === 'queued' ? 'uploading' : job.resumeState || 'uploading';
      if (progress.state !== job.state && !(transitions[job.state] || []).includes(progress.state) &&
        !(resume && progress.state === recoveryTarget)) throw new Error('허용되지 않은 업로드 상태 변경입니다.');
      if (progress.driveFileId && job.driveFileId && progress.driveFileId !== job.driveFileId) throw new Error('Drive 파일 ID 변경은 별도 복구가 필요합니다.');
      const next = { ...job, ...progress, revision: job.revision + 1 };
      if (resume) delete next.resumeState;
      if (!Number.isSafeInteger(next.confirmedBytes) || next.confirmedBytes < 0 || next.confirmedBytes > job.sizeBytes) {
        throw new Error('Drive 확인 바이트가 잘못되었습니다.');
      }
      if (['verifying', 'registering', 'synced'].includes(next.state) &&
        (next.confirmedBytes !== next.sizeBytes || !next.driveFileId)) throw new Error('원본 전송이 완료되지 않았습니다.');
      if (next.state === 'synced') { delete next.lease; delete next.protectedSessionRef; }
      return next;
    });
  }

  defer(fileId: string, leaseToken: string, expectedRevision: number,
    reason: 'offline' | 'needs_auth' | 'quota_full' | 'retry_wait' | 'failed', random = Math.random) {
    return this.store.update(uploadKey(this.identity, fileId), current => {
      const job = this.require(current);
      this.checkLease(job, leaseToken, expectedRevision);
      const attempt = job.attempt + (reason === 'retry_wait' ? 1 : 0);
      // Preserve registering: recovery must not upload the already completed original again.
      const state = reason === 'retry_wait' && attempt >= 8 ? 'failed' : reason;
      const next = { ...job, state, revision: job.revision + 1, attempt,
        resumeState: this.phase(job),
        retryAt: reason === 'retry_wait' ? this.now() + Math.min(300_000, 1000 * 2 ** attempt) + Math.floor(random() * 1000) : undefined };
      delete next.lease;
      return next;
    });
  }

  resume(fileId: string) {
    return this.store.update(uploadKey(this.identity, fileId), current => {
      const job = this.require(current);
      if (!['offline', 'needs_auth', 'quota_full', 'paused', 'failed'].includes(job.state)) throw new Error('재개 대상 작업이 아닙니다.');
      return { ...job, state: job.resumeState || 'queued', resumeState: undefined,
        revision: job.revision + 1, retryAt: undefined, attempt: 0, lease: undefined };
    });
  }

  cancel(fileId: string) {
    return this.store.update(uploadKey(this.identity, fileId), current => {
      const job = this.require(current);
      return { ...job, state: 'cancelled', revision: job.revision + 1, lease: undefined };
    });
  }

  async pauseAll() {
    for (const item of await this.list()) {
      await this.store.update(uploadKey(this.identity, item.fileId), current => {
        const job = this.require(current);
        if (['synced', 'cancelled', 'paused'].includes(job.state)) return job;
        return { ...job, resumeState: this.phase(job), state: 'paused', revision: job.revision + 1, lease: undefined };
      });
    }
  }

  renew(fileId: string, token: string, revision: number, leaseMs = 60_000) {
    if (leaseMs < 1000 || leaseMs > 300_000) throw new Error('잘못된 잠금 시간입니다.');
    return this.store.update(uploadKey(this.identity, fileId), current => {
      const job = this.require(current);
      this.checkLease(job, token, revision);
      return { ...job, revision: job.revision + 1, lease: { token, expiresAt: this.now() + leaseMs } };
    });
  }

  private phase(job: UploadJob): UploadJob['resumeState'] {
    return ['queued', 'uploading', 'verifying', 'registering'].includes(job.state)
      ? job.state as UploadJob['resumeState'] : job.resumeState || 'queued';
  }

  private checkIdentity(job: DriveIdentity) {
    if (job.ownerUid !== this.identity.ownerUid || job.connectionId !== this.identity.connectionId) throw new Error('업로드 계정이 일치하지 않습니다.');
  }
  private require(job?: UploadJob) {
    if (!job) throw new Error('업로드 작업을 찾을 수 없습니다.');
    this.checkIdentity(job);
    return job;
  }
  private checkLease(job: UploadJob, token: string, revision: number) {
    if (job.revision !== revision || job.lease?.token !== token || job.lease.expiresAt <= this.now()) {
      throw new Error('업로드 작업 소유권이 변경되었습니다.');
    }
  }
}
