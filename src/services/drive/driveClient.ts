/** Foreground Drive transport. Native background transfers use OS adapters,
 * not this fetch loop. All offsets must come from Drive's acknowledged Range.
 */
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const CHUNK_UNIT = 256 * 1024;

export class DriveTransferError extends Error {
  constructor(public code: 'needs_auth' | 'quota_full' | 'retry_wait' | 'not_found' | 'failed' | 'session_expired') {
    super(code); this.name = 'DriveTransferError';
  }
}

export interface RemoteFile {
  id: string; size: string; mimeType: string; md5Checksum?: string; sha256Checksum?: string;
}
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
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(id)) throw new DriveTransferError('failed');
  return id;
}

export class DriveClient {
  constructor(private accessToken: () => Promise<string>, private fetcher: typeof fetch = fetch) {}

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
    if (response.status === 429 || response.status >= 500 || reasons.some((r: string) => ['rateLimitExceeded', 'userRateLimitExceeded'].includes(r))) {
      throw new DriveTransferError('retry_wait');
    }
    throw new DriveTransferError('failed');
  }

  async generateId(signal?: AbortSignal): Promise<string> {
    const response = await this.request(`${DRIVE_API}/files/generateIds?count=1&space=drive&type=files`, { signal });
    const data = await response.json();
    return validId(data.ids?.[0] || '');
  }

  async metadata(id: string, signal?: AbortSignal): Promise<RemoteFile & { trashed?: boolean; appProperties?: Record<string, string> }> {
    return (await this.request(`${DRIVE_API}/files/${validId(id)}?fields=id,size,mimeType,sha256Checksum,trashed,appProperties`, { signal })).json();
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

  async download(id: string, signal?: AbortSignal): Promise<Blob> {
    return (await this.request(`${DRIVE_API}/files/${validId(id)}?alt=media`, { signal })).blob();
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
