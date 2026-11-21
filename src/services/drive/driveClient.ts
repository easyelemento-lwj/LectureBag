/** Foreground Drive transport. Native background transfers use OS adapters,
 * not this fetch loop. All offsets must come from Drive's acknowledged Range.
 */
import { retryAfterMs } from './requestBudget';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const CHUNK_UNIT = 256 * 1024;

export class DriveTransferError extends Error {
  constructor(public code: 'needs_auth' | 'quota_full' | 'retry_wait' | 'not_found' | 'failed' | 'session_expired', public httpStatus?: number, public retryAt?: number) {
    super(code); this.name = 'DriveTransferError';
  }
}
export class DriveRangeUnavailable extends Error {}

export interface RemoteFile {
  id: string; size: string; mimeType: string; md5Checksum?: string; sha256Checksum?: string;
}
export interface DriveFolder { id: string; name: string; logicalFolderId: string }
export type TransferProgress = { complete: false; confirmedBytes: number }
  | { complete: true; confirmedBytes: number; file: RemoteFile };

export function validateSessionUri(uri: string) {
  let parsed: URL;
  try { parsed = new URL(uri); }
  catch { throw new DriveTransferError('failed'); }
  if (parsed.origin !== 'https://www.googleapis.com' || parsed.username || parsed.password ||
    parsed.pathname !== '/upload/drive/v3/files' || parsed.hash ||
    parsed.searchParams.get('uploadType') !== 'resumable' || !parsed.searchParams.get('upload_id')) {
    throw new DriveTransferError('failed');
  }
  return parsed.href;
}

function validId(id: string) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(id)) throw new DriveTransferError('failed');
  return id;
}

export class DriveClient {
  // Native browser fetch must retain its Window receiver, not this DriveClient.
  constructor(private accessToken: () => Promise<string>, private fetcher: typeof fetch = (input, init) => globalThis.fetch(input, init),
    private onRateLimit?: (ms: number) => Promise<void>) {}

  private async request(url: string, init: RequestInit, allowIncomplete = false): Promise<Response> {
    init.signal?.throwIfAborted();
    const token = await this.accessToken();
    init.signal?.throwIfAborted();
    if (!token) throw new DriveTransferError('needs_auth');
    let response: Response;
    try {
      response = await this.fetcher(url, { ...init, redirect: 'error', credentials: 'omit', cache: 'no-store',
        headers: { ...init.headers, Authorization: `Bearer ${token}` } });
    } catch (error) {
      if (init.signal?.aborted) throw error;
      throw new DriveTransferError('retry_wait');
    }
    if (response.ok || (allowIncomplete && response.status === 308)) return response;
    if (response.status === 401) throw new DriveTransferError('needs_auth');
    if (response.status === 404) throw new DriveTransferError(allowIncomplete ? 'session_expired' : 'not_found');
    const payload = await response.json().catch(() => null);
    const reasons = (payload?.error?.errors || []).map((error: { reason?: string }) => error.reason);
    if (reasons.includes('storageQuotaExceeded')) throw new DriveTransferError('quota_full');
    if (response.status === 429 || reasons.some((r: string) => ['rateLimitExceeded', 'userRateLimitExceeded'].includes(r))) {
      const delay = retryAfterMs(response.headers.get('Retry-After'));
      await this.onRateLimit?.(delay);
      throw new DriveTransferError('retry_wait', 429, Date.now() + delay);
    }
    if (response.status >= 500) throw new DriveTransferError('retry_wait', response.status);
    throw new DriveTransferError('failed', response.status);
  }

  async generateId(signal?: AbortSignal): Promise<string> {
    const response = await this.request(`${DRIVE_API}/files/generateIds?count=1&space=drive&type=files`, { signal });
    const data = await response.json();
    return validId(data.ids?.[0] || '');
  }

  async metadata(id: string, signal?: AbortSignal): Promise<RemoteFile & { trashed?: boolean; ownedByMe?: boolean; parents?: string[]; appProperties?: Record<string, string> }> {
    return (await this.request(`${DRIVE_API}/files/${validId(id)}?fields=id,size,mimeType,sha256Checksum,trashed,ownedByMe,parents,appProperties`, { signal })).json();
  }

  /** Discover only this connection's app-created folders, one bounded page at a time. */
  async captureExists(fileId: string, ownerHash: string, signal?: AbortSignal): Promise<boolean> {
    validId(fileId);
    if (!/^[a-f0-9]{64}$/.test(ownerHash)) throw new DriveTransferError('failed');
    // Include trash and previous connections. A completed upload whose catalog
    // commit was lost must never be duplicated by the repair tool.
    const q = [`appProperties has { key='lecturebagFileId' and value='${fileId}' }`,
      `appProperties has { key='lecturebagOwner' and value='${ownerHash}' }`].join(' and ');
    const params = new URLSearchParams({ q, spaces: 'drive', corpora: 'user', pageSize: '1',
      fields: 'nextPageToken,incompleteSearch,files(id)' });
    const data = await (await this.request(`${DRIVE_API}/files?${params}`, { signal })).json();
    if (data.incompleteSearch || !Array.isArray(data.files)) throw new DriveTransferError('retry_wait');
    return data.files.length > 0 || !!data.nextPageToken;
  }

  async folders(connectionId: string, ownerHash: string, parentId?: string, pageToken?: string, signal?: AbortSignal) {
    validId(connectionId);
    if (!/^[a-f0-9]{64}$/.test(ownerHash)) throw new DriveTransferError('failed');
    const q = ["mimeType = 'application/vnd.google-apps.folder'", 'trashed = false', "'me' in owners",
      `appProperties has { key='lecturebagConnectionId' and value='${connectionId}' }`,
      `appProperties has { key='lecturebagOwner' and value='${ownerHash}' }`,
      parentId ? `'${validId(parentId)}' in parents` : "appProperties has { key='lecturebagFolderId' and value='root' }"];
    const params = new URLSearchParams({ q: q.join(' and '), spaces: 'drive', corpora: 'user',
      pageSize: '50', orderBy: 'name_natural',
      fields: 'nextPageToken,incompleteSearch,files(id,name,mimeType,trashed,ownedByMe,parents,appProperties)' });
    if (pageToken) params.set('pageToken', pageToken);
    const data = await (await this.request(`${DRIVE_API}/files?${params}`, { signal })).json();
    signal?.throwIfAborted();
    if (data.incompleteSearch) throw new DriveTransferError('retry_wait');
    if ((data.files !== undefined && !Array.isArray(data.files)) ||
      (data.nextPageToken !== undefined && typeof data.nextPageToken !== 'string')) throw new DriveTransferError('failed');
    const folders: DriveFolder[] = (data.files || []).map(file => {
      const p = file.appProperties;
      if (file.trashed || !file.ownedByMe || file.mimeType !== 'application/vnd.google-apps.folder' ||
        typeof file.name !== 'string' || p?.lecturebagConnectionId !== connectionId || p?.lecturebagOwner !== ownerHash ||
        typeof p?.lecturebagFolderId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(p.lecturebagFolderId) ||
        (parentId ? !file.parents?.includes(parentId) : p?.lecturebagFolderId !== 'root')) throw new DriveTransferError('failed');
      return { id: validId(file.id), name: file.name, logicalFolderId: p.lecturebagFolderId };
    });
    return { folders, nextPageToken: data.nextPageToken as string | undefined };
  }

  async folder(id: string, name: string, properties: Record<string, string>, parentId?: string, signal?: AbortSignal) {
    try {
      const existing = await this.metadata(id, signal);
      if (existing.trashed || existing.mimeType !== 'application/vnd.google-apps.folder' ||
        Object.entries(properties).some(([key, value]) => existing.appProperties?.[key] !== value)) throw new DriveTransferError('failed');
      return;
    } catch (error) { if (!(error instanceof DriveTransferError) || error.code !== 'not_found') throw error; }
    try {
      await this.request(`${DRIVE_API}/files?fields=id`, { method: 'POST', signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: validId(id), name,
          mimeType: 'application/vnd.google-apps.folder', appProperties: properties,
          ...(parentId ? { parents: [validId(parentId)] } : {}) }) });
    } catch (error) {
      // A concurrent creator or lost response may already have created this reserved ID.
      const existing = await this.metadata(id, signal);
      if (existing.trashed || existing.mimeType !== 'application/vnd.google-apps.folder' ||
        Object.entries(properties).some(([key, value]) => existing.appProperties?.[key] !== value)) throw error;
    }
  }

  async download(id: string, signal?: AbortSignal, maxBytes?: number): Promise<Blob> {
    const response = await this.request(`${DRIVE_API}/files/${validId(id)}?alt=media`, { signal });
    if (maxBytes === undefined) return response.blob();
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new DriveTransferError('failed');
    if (Number(response.headers.get('Content-Length')) > maxBytes || !response.body) {
      await response.body?.cancel(); throw new DriveTransferError('failed');
    }
    const reader = response.body.getReader();
    const chunks: BlobPart[] = [];
    let size = 0;
    try {
      while (true) {
        signal?.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) throw new DriveTransferError('failed');
        chunks.push(value);
      }
      return new Blob(chunks);
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }

  /** Bounded verified range. Never infer a saved offset from UI progress. */
  async downloadRange(id: string, offset: number, total: number, signal: AbortSignal) {
    if (!Number.isSafeInteger(total) || total < 1 || !Number.isSafeInteger(offset) || offset < 0 || offset >= total) throw new DriveTransferError('failed');
    const end = Math.min(total - 1, offset + 4 * 1024 * 1024 - 1);
    const response = await this.request(`${DRIVE_API}/files/${validId(id)}?alt=media`, { signal, headers: { Range: `bytes=${offset}-${end}` } });
    const full = response.status === 200;
    if (!full && (response.status !== 206 || response.headers.get('Content-Range') !== `bytes ${offset}-${end}/${total}`)) {
      await response.body?.cancel(); throw new DriveRangeUnavailable('범위 응답을 확인할 수 없습니다.');
    }
    const expected = full ? total : end - offset + 1;
    if (!response.body || Number(response.headers.get('Content-Length')) > expected) { await response.body?.cancel(); throw new DriveTransferError('failed'); }
    const reader = response.body.getReader(), parts: BlobPart[] = []; let received = 0;
    try {
      while (true) { signal.throwIfAborted(); const { value, done } = await reader.read(); if (done) break;
        received += value.byteLength; if (received > expected) throw new DriveTransferError('failed'); parts.push(value); }
      if (received !== expected) throw new DriveTransferError('retry_wait');
      return { blob: new Blob(parts), full };
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }

  async startUpload(metadata: { id: string; name: string; mimeType: string; parentId: string; appProperties: Record<string, string> },
    sizeBytes: number, signal?: AbortSignal) {
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) throw new DriveTransferError('failed');
    const response = await this.request(`${DRIVE_UPLOAD}?uploadType=resumable&fields=id,size,mimeType,md5Checksum,sha256Checksum`, {
      method: 'POST', signal, headers: { 'Content-Type': 'application/json',
        'X-Upload-Content-Type': metadata.mimeType, 'X-Upload-Content-Length': String(sizeBytes) },
      body: JSON.stringify({ id: validId(metadata.id), name: metadata.name, mimeType: metadata.mimeType,
        parents: [validId(metadata.parentId)], appProperties: metadata.appProperties }),
    });
    // Store only in the platform's protected session store, not in logs or Firestore.
    return validateSessionUri(response.headers.get('Location') || '');
  }

  async probe(sessionUri: string, total: number, signal?: AbortSignal): Promise<TransferProgress> {
    if (!Number.isSafeInteger(total) || total <= 0) throw new DriveTransferError('failed');
    const response = await this.request(validateSessionUri(sessionUri), {
      method: 'PUT', signal, headers: { 'Content-Range': `bytes */${total}` }, body: new Blob([]),
    }, true);
    return this.progress(response, total);
  }

  async sendChunk(sessionUri: string, source: Blob, offset: number, chunkSize = CHUNK_UNIT * 16,
    signal?: AbortSignal): Promise<TransferProgress> {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= source.size ||
      !Number.isSafeInteger(chunkSize) || chunkSize <= 0 || chunkSize % CHUNK_UNIT) throw new DriveTransferError('failed');
    const end = Math.min(source.size, offset + chunkSize);
    const response = await this.request(validateSessionUri(sessionUri), {
      method: 'PUT', signal, headers: { 'Content-Type': source.type || 'application/octet-stream',
        'Content-Range': `bytes ${offset}-${end - 1}/${source.size}` }, body: source.slice(offset, end),
    }, true);
    return this.progress(response, source.size);
  }

  private async progress(response: Response, total: number): Promise<TransferProgress> {
    if (response.status === 308) {
      const range = response.headers.get('Range');
      if (!range) return { complete: false, confirmedBytes: 0 };
      const match = /^bytes=0-(\d+)$/.exec(range);
      const count = match ? Number(match[1]) + 1 : NaN;
      if (!Number.isSafeInteger(count) || count < 1 || count > total) throw new DriveTransferError('failed');
      return { complete: false, confirmedBytes: count };
    }
    const file: RemoteFile = await response.json();
    if (!file.id || file.size !== String(total)) throw new DriveTransferError('failed');
    return { complete: true, confirmedBytes: total, file };
  }
}
