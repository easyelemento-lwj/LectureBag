import type { User } from 'firebase/auth';
import type { CloudMediaRecord, DriveAuthChallenge, DriveConnection } from './types';
import { accountBudget, RequestCoolingDown, retryAfterMs, type RequestPriority } from './requestBudget';

const messages: Record<string, string> = {
  DRIVE_FILE_NOT_TRASHED: '휴지통 이동이 완료된 파일만 완전 삭제할 수 있습니다. 최신 상태를 확인해 주세요.',
  DRIVE_PURGE_CANNOT_CANCEL: '이미 요청한 완전 삭제는 중단할 수 없습니다. 처리 결과를 확인해 주세요.',
  DRIVE_DISABLED: 'Drive 내부 테스트가 활성화되지 않은 계정입니다.',
  DRIVE_NOT_CONFIGURED: 'Drive 서버 설정이 필요합니다.',
  DRIVE_STORAGE_UNAVAILABLE: 'Drive 연결 정보를 잠시 불러올 수 없습니다. 다시 시도해 주세요.',
  DRIVE_ACCOUNT_MISMATCH: '기존 Drive 연결을 해제한 뒤 다른 계정을 연결해 주세요.',
  DRIVE_LIBRARY_RECOVERY_REQUIRED: '기존 Drive 보관함의 연결 확인이 필요합니다. 중복 폴더를 만들지 않도록 연결을 중단했습니다. 기존 폴더를 삭제하지 말고 운영자에게 문의해 주세요.',
  DRIVE_CONNECTION_CHANGED: '연결 상태가 변경되었습니다. 새로고침해 주세요.',
  DRIVE_AUTH_EXPIRED: '연결 요청이 만료되었습니다. 다시 시도해 주세요.',
  DRIVE_AUTH_MISMATCH: '로그인 상태를 확인하고 다시 연결해 주세요.',
  DRIVE_NEEDS_AUTH: 'Google Drive 권한을 다시 확인해 주세요.',
  DRIVE_OAUTH_CLIENT_REJECTED: 'Drive 서버의 OAuth 클라이언트 ID 또는 보안 비밀번호를 확인해 주세요.',
  DRIVE_OAUTH_CODE_REJECTED: '연결 요청이 만료되었거나 이미 사용됐습니다. 새로고침 후 다시 연결해 주세요.',
  DRIVE_OFFLINE_CONSENT_REQUIRED: 'Google 계정에서 기존 LectureBag 권한을 확인한 뒤 다시 동의해 주세요.',
  DRIVE_SCOPE_REQUIRED: 'Google Drive 파일 접근 권한을 허용해 주세요.',
  DRIVE_PERSONAL_ACCOUNT_REQUIRED: '현재 연결 시험은 개인 Google 계정을 지원합니다.',
  DRIVE_RATE_LIMITED: '요청 조절을 위해 잠시 대기합니다. 저장된 파일은 유지되며 자동으로 재개합니다.',
  DRIVE_SYNC_RESET_REQUIRED: '동기화 기준을 다시 확인해야 합니다.',
  DRIVE_WATCH_LIMIT: '다른 기기의 알림 연결이 많습니다. 잠시 후 다시 연결합니다.',
  DRIVE_SYNC_NOT_AVAILABLE: '자동 동기화 서버 업데이트가 필요합니다. 저장된 PC 사본은 계속 열 수 있습니다.',
  DRIVE_AUTH_REQUIRED: '로그인 상태를 다시 확인해 주세요.',
  DRIVE_FILE_BUSY: '다른 삭제·복원 작업을 확인 중입니다. 잠시 후 다시 시도합니다.',
  DRIVE_FILE_CONFLICT: '다른 곳에서 파일 상태가 바뀌었습니다. 최신 목록을 확인한 뒤 다시 선택해 주세요.',
  DRIVE_OPERATION_CONFLICT: '삭제·복원 요청이 일치하지 않습니다. 최신 목록을 확인해 주세요.',
  DRIVE_PARENT_TRASHED: '상위 폴더가 Drive 휴지통에 있습니다. Drive에서 상위 폴더를 먼저 복원해 주세요.',
  DRIVE_FILE_NOT_REGISTERED: '동기화 목록에 등록되지 않은 파일입니다.',
  DRIVE_NOT_FOUND_OR_INACCESSIBLE: 'Drive 원본을 찾거나 접근할 수 없습니다. 권한과 휴지통을 확인해 주세요.',
  DRIVE_ACCESS_DENIED: 'Drive 파일 접근 권한을 확인해 주세요.',
  DRIVE_FILE_NOT_OWNED: '이 앱에서 관리하는 Drive 원본인지 확인하지 못했습니다.',
  DRIVE_TRASH_NOT_CONFIRMED: 'Drive 휴지통 상태를 확인 중입니다. 다시 시도합니다.',
  DRIVE_LIFECYCLE_NOT_AVAILABLE: '삭제·복원 동기화 서버 업데이트가 필요합니다. 파일은 변경하지 않았습니다.',
};

export class CatalogError extends Error {
  constructor(public code: string, public retryable: boolean, public httpStatus?: number, public retryAt?: number) {
    super(messages[code] || 'Drive 요청을 완료하지 못했습니다. 다시 시도해 주세요.');
  }
}

/** One client belongs to one Firebase user; late responses can never switch owners. */
export class CloudCatalog {
  constructor(private user: User, private currentUid: () => string | undefined,
    private endpoint = import.meta.env.VITE_PROXY_SERVER_URL || 'https://lecturebag-production.up.railway.app',
    private priority: RequestPriority = 'background') {}

  withPriority(priority: RequestPriority) { return new CloudCatalog(this.user, this.currentUid, this.endpoint, priority); }
  async deferRequests(ms: number) {
    if (typeof window !== 'undefined') await accountBudget(this.endpoint, this.user.uid).coolDown(ms);
  }
  assertRequestReady() {
    this.assertOwner(this.user.uid);
    const until = typeof window !== 'undefined' ? accountBudget(this.endpoint, this.user.uid).retryAt : 0;
    if (until > Date.now()) throw new CatalogError('DRIVE_RATE_LIMITED', true, 429, until);
  }

  assertOwner(ownerUid: string) {
    if (ownerUid !== this.user.uid || this.currentUid() !== this.user.uid) throw new Error('로그인 상태가 변경되었습니다.');
  }

  private async request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const base = new URL(this.endpoint);
    if (base.username || base.password || (base.protocol !== 'https:' &&
      !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)))) {
      throw new Error('안전한 서버 연결이 필요합니다.');
    }
    const checkUser = () => {
      if (this.currentUid() !== this.user.uid) throw new Error('로그인 상태가 변경되었습니다.');
      signal?.throwIfAborted();
    };
    checkUser();
    const budget = typeof window !== 'undefined' ? accountBudget(this.endpoint, this.user.uid) : undefined;
    try { await budget?.enter(/^\/api\/drive\/(auth|connect|disconnect)/.test(path) || path.startsWith('/api/cloud-files/trash')
      ? 'interactive' : this.priority, signal); }
    catch (e) { if (e instanceof RequestCoolingDown) throw new CatalogError('DRIVE_RATE_LIMITED', true, 429, e.retryAt); throw e; }
    checkUser();
    const token = await this.user.getIdToken();
    checkUser();
    const combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000);
    const response = await fetch(new URL(path, base), {
      method: body === undefined ? 'GET' : 'POST', credentials: 'omit', cache: 'no-store',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Requested-With': 'XmlHttpRequest' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: combined,
    });
    const data = await response.json().catch(() => null);
    checkUser();
    let retryAt: number | undefined;
    if (response.status === 429) {
      const delay = retryAfterMs(response.headers.get('Retry-After')); retryAt = Date.now() + delay;
      await budget?.coolDown(delay);
    }
    if (!response.ok) throw new CatalogError(data?.detail?.code ||
      (response.status === 404 && /^\/api\/cloud-files\/(inventory|reconcile|trash)/.test(path) ? 'DRIVE_LIFECYCLE_NOT_AVAILABLE'
        : response.status === 404 && path.startsWith('/api/cloud-files/changes') ? 'DRIVE_SYNC_NOT_AVAILABLE'
        : response.status === 401 ? 'DRIVE_AUTH_REQUIRED' : response.status === 429 ? 'DRIVE_RATE_LIMITED' : 'DRIVE_REQUEST_FAILED'), response.status === 429 || response.status >= 500, response.status, retryAt);
    return data as T;
  }

  status(signal?: AbortSignal) { return this.request<DriveConnection>('/api/drive/status', undefined, signal); }
  captureAudit(connectionId: string, fileIds: string[], signal?: AbortSignal) {
    return this.request<{ files: Array<{ fileId: string; status: 'missing' | 'registered' | 'previous' | 'deleted' }> }>(
      '/api/cloud-files/capture-audit', { connectionId, fileIds }, signal);
  }
  inventory(connectionId: string, cursor?: string, signal?: AbortSignal) {
    return this.request<CloudInventory>(`/api/cloud-files/inventory?${new URLSearchParams({ connectionId, ...(cursor ? { cursor } : {}) })}`, undefined, signal);
  }
  reconcile(connectionId: string, cursor?: string, signal?: AbortSignal) {
    return this.request<CloudInventory>('/api/cloud-files/reconcile', { connectionId, cursor }, signal);
  }
  trash(body: { connectionId: string; fileId: string; operationId: string; revision: number; trashed: boolean; purge?: boolean; purgeConfirmed?: boolean }, signal?: AbortSignal) {
    return this.request<CloudMediaRecord>('/api/cloud-files/trash', body, signal);
  }
  prepareTrash(connectionId: string, operations: Array<{ fileId: string; operationId: string; revision: number; trashed: boolean; purge?: boolean; purgeConfirmed?: boolean }>, signal?: AbortSignal) {
    return this.request<{ operations: Array<{ operationId: string; done?: boolean; code?: string }> }>(
      '/api/cloud-files/trash/prepare', { connectionId, operations: operations.map(op => ({
        connectionId, fileId: op.fileId, operationId: op.operationId, revision: op.revision, trashed: op.trashed, ...(op.purge ? { purge: true, purgeConfirmed: op.purgeConfirmed } : {}),
      })) }, signal);
  }
  cancelTrash(body: { connectionId: string; fileId: string; operationId: string; revision: number; trashed: boolean }, signal?: AbortSignal) {
    return this.request<CloudMediaRecord>('/api/cloud-files/trash/cancel', body, signal);
  }
  syncHead(connectionId: string, signal?: AbortSignal) {
    return this.request<CloudSyncCursor>(`/api/cloud-files/changes/head?${new URLSearchParams({ connectionId })}`, undefined, signal);
  }
  changes(connectionId: string, cursor: string, wait = 0, signal?: AbortSignal) {
    return this.request<CloudChanges>(`/api/cloud-files/changes?${new URLSearchParams({ connectionId, cursor, wait: String(wait) })}`, undefined, signal);
  }
  transferToken(connectionId: string, signal?: AbortSignal) {
    return this.request<{ accessToken: string; expiresIn: number; ownerHash: string }>('/api/drive/transfer-token', { connectionId }, signal);
  }
  reserveId(connectionId: string, key: string, candidate: string, signal?: AbortSignal) {
    return this.request<{ id: string }>('/api/drive/reserve-id', { connectionId, key, candidate }, signal);
  }
  start(signal?: AbortSignal) { return this.request<DriveAuthChallenge>('/api/drive/auth/start', {}, signal); }
  connect(code: string, state: string, signal?: AbortSignal, redirect = false) {
    return this.request<DriveConnection>('/api/drive/connect', { code, state, redirect }, signal);
  }
  disconnect(connection: DriveConnection, signal?: AbortSignal) {
    return this.request<DriveConnection>('/api/drive/disconnect', {
      connectionId: connection.connectionId, revision: connection.revision,
    }, signal);
  }
  list(folderId: string, cursor?: string, signal?: AbortSignal) {
    const query = new URLSearchParams({ folderId, limit: '50' });
    if (cursor) query.set('cursor', cursor);
    return this.request<{ files: CloudMediaRecord[]; nextCursor: string | null }>(`/api/cloud-files?${query}`, undefined, signal);
  }
  commit(file: Pick<CloudMediaRecord, 'id' | 'connectionId' | 'driveFileId' | 'logicalFolderId' | 'capturedAt' | 'sizeBytes' | 'mimeType'>,
    signal?: AbortSignal) {
    return this.request<CloudMediaRecord>('/api/cloud-files/commit', file, signal);
  }
}

export interface CloudSyncCursor { cursor: string; sequence: number }
export interface CloudInventory { files: CloudMediaRecord[]; nextCursor: string | null; issues?: Array<{ fileId: string; code: string }> }
export interface CloudChanges extends CloudSyncCursor {
  changes: Array<{ sequence: number; file: CloudMediaRecord; folder?: { id: string; name: string; logicalFolderId: string; parentId?: string } | null }>;
  hasMore: boolean;
}
