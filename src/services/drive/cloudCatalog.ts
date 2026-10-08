import type { User } from 'firebase/auth';
import type { CloudMediaRecord, DriveAuthChallenge, DriveConnection } from './types';

const messages: Record<string, string> = {
  DRIVE_DISABLED: 'Drive 내부 테스트가 활성화되지 않은 계정입니다.',
  DRIVE_NOT_CONFIGURED: 'Drive 서버 설정이 필요합니다.',
  DRIVE_STORAGE_UNAVAILABLE: 'Drive 연결 정보를 잠시 불러올 수 없습니다. 다시 시도해 주세요.',
  DRIVE_ACCOUNT_MISMATCH: '기존 Drive 연결을 해제한 뒤 다른 계정을 연결해 주세요.',
  DRIVE_CONNECTION_CHANGED: '연결 상태가 변경되었습니다. 새로고침해 주세요.',
  DRIVE_AUTH_EXPIRED: '연결 요청이 만료되었습니다. 다시 시도해 주세요.',
  DRIVE_AUTH_MISMATCH: '로그인 상태를 확인하고 다시 연결해 주세요.',
  DRIVE_NEEDS_AUTH: 'Google Drive 권한을 다시 확인해 주세요.',
  DRIVE_OAUTH_CLIENT_REJECTED: 'Drive 서버의 OAuth 클라이언트 ID 또는 보안 비밀번호를 확인해 주세요.',
  DRIVE_OAUTH_CODE_REJECTED: '연결 요청이 만료되었거나 이미 사용됐습니다. 새로고침 후 다시 연결해 주세요.',
  DRIVE_OFFLINE_CONSENT_REQUIRED: 'Google 계정에서 기존 LectureBag 권한을 확인한 뒤 다시 동의해 주세요.',
  DRIVE_SCOPE_REQUIRED: 'Google Drive 파일 접근 권한을 허용해 주세요.',
  DRIVE_PERSONAL_ACCOUNT_REQUIRED: '현재 연결 시험은 개인 Google 계정을 지원합니다.',
  DRIVE_RATE_LIMITED: '요청이 많습니다. 잠시 후 다시 시도해 주세요.',
};

export class CatalogError extends Error {
  constructor(public code: string, public retryable: boolean) {
    super(messages[code] || 'Drive 요청을 완료하지 못했습니다. 다시 시도해 주세요.');
  }
}

/** One client belongs to one Firebase user; late responses can never switch owners. */
export class CloudCatalog {
  constructor(private user: User, private currentUid: () => string | undefined,
    private endpoint = import.meta.env.VITE_PROXY_SERVER_URL || 'https://lecturebag-production.up.railway.app') {}

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
    if (!response.ok) throw new CatalogError(data?.detail?.code || 'DRIVE_REQUEST_FAILED', response.status === 429 || response.status >= 500);
    return data as T;
  }

  status(signal?: AbortSignal) { return this.request<DriveConnection>('/api/drive/status', undefined, signal); }
  transferToken(connectionId: string, signal?: AbortSignal) {
    return this.request<{ accessToken: string; expiresIn: number; ownerHash: string }>('/api/drive/transfer-token', { connectionId }, signal);
  }
  reserveId(connectionId: string, key: string, candidate: string, signal?: AbortSignal) {
    return this.request<{ id: string }>('/api/drive/reserve-id', { connectionId, key, candidate }, signal);
  }
  start(signal?: AbortSignal) { return this.request<DriveAuthChallenge>('/api/drive/auth/start', {}, signal); }
  connect(code: string, state: string, signal?: AbortSignal) {
    return this.request<DriveConnection>('/api/drive/connect', { code, state }, signal);
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
