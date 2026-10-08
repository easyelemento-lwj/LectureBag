import { createStore, get, set, del } from 'idb-keyval';
import { bindCapture, captureIntents, captureSource } from '../../utils/mediaStorage';
import { CloudCatalog, CatalogError } from './cloudCatalog';
import { DriveTransferError } from './driveClient';
import { sha256, trialClient } from './photoTrial';
import { UploadQueue, uploadKey, type UploadJob } from './uploadQueue';
import type { DriveIdentity } from './types';

// Same-origin private IndexedDB, NOT an OS keychain. Never render/log these URIs.
const sessions = createStore('lecturebag-drive-sessions', 'sessions');
export const folderKey = (path: string[]) => sha256(new Blob([JSON.stringify(path)]));
export function captureBlob(dataUrl: string) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw new DriveTransferError('failed');
  const bytes = Uint8Array.from(atob(match[2]), char => char.charCodeAt(0));
  if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new DriveTransferError('failed');
  return new Blob([bytes], { type: match[1] });
}

export async function enqueueCaptures(identity: DriveIdentity, queue: UploadQueue) {
  const known = new Set((await queue.list()).map(job => job.fileId));
  for (const intent of await captureIntents(identity.ownerUid)) {
    if (known.has(intent.fileId)) continue;
    if (intent.connectionId && intent.connectionId !== identity.connectionId) continue;
    const source = await captureSource(identity.ownerUid, intent.fileId);
    if (!source) continue;
    const bound = await bindCapture(identity.ownerUid, intent.fileId, identity.connectionId);
    const blob = captureBlob(source.dataUrl);
    await queue.enqueue({ ...identity, fileId: bound.fileId, localFileRef: bound.fileId, name: bound.name,
      mimeType: blob.type, sizeBytes: blob.size, capturedAt: bound.capturedAt,
      logicalFolderId: await folderKey(bound.folderPath) });
  }
}

function failureState(error: unknown): 'needs_auth' | 'quota_full' | 'retry_wait' | 'failed' {
  if (error instanceof DriveTransferError) {
    return ['needs_auth', 'quota_full', 'retry_wait'].includes(error.code)
      ? error.code as 'needs_auth' | 'quota_full' | 'retry_wait' : 'failed';
  }
  if (error instanceof CatalogError) {
    if (['DRIVE_NEEDS_AUTH', 'DRIVE_CONNECTION_CHANGED', 'DRIVE_AUTH_MISMATCH', 'DRIVE_DISABLED'].includes(error.code)) return 'needs_auth';
    return error.retryable ? 'retry_wait' : 'failed';
  }
  return error instanceof TypeError || (error as Error)?.name === 'TimeoutError' ? 'retry_wait' : 'failed';
}

/** One claimed job at a time. Source and connection are checked before each remote operation. */
export async function uploadCapture(identity: DriveIdentity, queue: UploadQueue, fileId: string,
  catalog: CloudCatalog, signal: AbortSignal, onProgress: (job: UploadJob) => void = () => {}) {
  let job = await queue.claim(fileId, 300_000);
  const key = uploadKey(identity, fileId);
  const { client, credentials } = trialClient(catalog, identity.connectionId, signal);
  let checkedAt = 0;
  const advance = async (progress: Parameters<UploadQueue['advance']>[3]) => {
    job = await queue.advance(fileId, job.lease!.token, job.revision, progress); onProgress(job);
  };
  const check = async () => {
    signal.throwIfAborted();
    if (!await captureSource(identity.ownerUid, fileId)) {
      await queue.cancel(fileId); throw new DOMException('Source removed', 'AbortError');
    }
    job = await queue.renew(fileId, job.lease!.token, job.revision, 180_000);
    if (Date.now() - checkedAt > 15_000) {
      const current = await catalog.status(AbortSignal.any([signal, AbortSignal.timeout(45_000)]));
      if (!current.connected || current.connectionId !== identity.connectionId) throw new DriveTransferError('needs_auth');
      checkedAt = Date.now();
    }
    signal.throwIfAborted();
  };
  // Keep the lease longer than a single bounded request, including response body reads.
  const remoteCall = async <T,>(call: (requestSignal: AbortSignal) => Promise<T>) => {
    await check();
    return call(AbortSignal.any([signal, AbortSignal.timeout(45_000)]));
  };
  try {
    await check();
    const intent = (await captureIntents(identity.ownerUid)).find(item => item.fileId === fileId);
    if (!intent || intent.connectionId !== identity.connectionId) throw new DriveTransferError('failed');
    const source = await captureSource(identity.ownerUid, fileId);
    if (!source) throw new DriveTransferError('failed');
    const blob = captureBlob(source.dataUrl);
    if (blob.size !== job.sizeBytes || blob.type !== job.mimeType) throw new DriveTransferError('failed');
    const checksum = await sha256(blob);
    if (job.state === 'retry_wait') await advance({ state: job.resumeState === 'queued' ? 'uploading' : job.resumeState || 'uploading' });
    if (job.state === 'queued') await advance({ state: 'uploading' });
    if (!job.driveFileId) await advance({ state: 'uploading', driveFileId: await remoteCall(s => client.generateId(s)) });
    // Durable ID precedes any byte transmission. Completed remote files are never re-uploaded.
    let remote;
    try { remote = await remoteCall(s => client.metadata(job.driveFileId!, s)); }
    catch (error) { if (!(error instanceof DriveTransferError) || error.code !== 'not_found') throw error; }
    if (!remote) {
      if (job.state !== 'uploading') throw new DriveTransferError('not_found');
      let session = await get<string>(key, sessions);
      let offset = 0;
      if (session) {
        try {
          const probe = await remoteCall(s => client.probe(session!, blob.size, s));
          offset = probe.confirmedBytes;
          if (probe.complete) remote = probe.file;
        } catch (error) {
          if (!(error instanceof DriveTransferError) || error.code !== 'session_expired') throw error;
          // Re-check after expired session: a lost final response may have completed the file.
          try { remote = await remoteCall(s => client.metadata(job.driveFileId!, s)); }
          catch (next) { if (!(next instanceof DriveTransferError) || next.code !== 'not_found') throw next; }
          await del(key, sessions); session = undefined;
        }
      }
      if (!remote && !session) {
        const { ownerHash } = await credentials();
        const properties = { lecturebagConnectionId: identity.connectionId, lecturebagOwner: ownerHash };
        const folder = async (key: string, name: string, parent?: string) => {
          const candidate = await remoteCall(s => client.generateId(s));
          const { id } = await remoteCall(s => catalog.reserveId(identity.connectionId, key, candidate, s));
          await remoteCall(s => client.folder(id, name, { ...properties, lecturebagFolderId: key }, parent, s));
          return id;
        };
        let parentId = await folder('root', 'LectureBag');
        for (let i = 0; i < intent.folderPath.length; i++) {
          parentId = await folder(await folderKey(intent.folderPath.slice(0, i + 1)), intent.folderPath[i], parentId);
        }
        session = await remoteCall(s => client.startUpload({ id: job.driveFileId!, name: job.name,
          mimeType: job.mimeType, parentId, appProperties: { ...properties, lecturebagFileId: fileId } }, blob.size, s));
        await set(key, session, sessions);
      }
      while (!remote && offset < blob.size) {
        const result = await remoteCall(s => client.sendChunk(session!, blob, offset, undefined, s));
        if (result.confirmedBytes <= offset) throw new DriveTransferError('retry_wait');
        offset = result.confirmedBytes;
        await advance({ state: 'uploading', confirmedBytes: offset });
        if (result.complete) remote = result.file;
      }
      if (!remote) throw new DriveTransferError('retry_wait');
    }
    if (job.state === 'uploading') await advance({ state: 'verifying', confirmedBytes: blob.size });
    if (!remote || remote.id !== job.driveFileId || ('trashed' in remote && remote.trashed) ||
      remote.size !== String(blob.size) || remote.mimeType !== blob.type || remote.sha256Checksum !== checksum) {
      throw new DriveTransferError('failed');
    }
    if (job.state === 'verifying') await advance({ state: 'registering' });
    await remoteCall(s => catalog.commit({ id: fileId, connectionId: identity.connectionId,
      driveFileId: job.driveFileId!, logicalFolderId: job.logicalFolderId, capturedAt: job.capturedAt,
      sizeBytes: blob.size, mimeType: blob.type }, s));
    await check();
    await advance({ state: 'synced' });
    await del(key, sessions);
    // Keep the local camera original. Cloud success is never permission to delete it.
  } catch (error) {
    if (job.state !== 'synced') {
      try { job = await queue.defer(fileId, job.lease!.token, job.revision,
        signal.aborted ? 'retry_wait' : failureState(error)); onProgress(job); } catch { /* Cancelled or reclaimed lease wins. */ }
    }
    if ((await queue.list()).find(item => item.fileId === fileId)?.state === 'cancelled') await del(key, sessions);
    throw error;
  }
}
