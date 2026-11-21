import { uploadSource as captureSource } from '../../utils/mediaStorage';
import { MAX_AUDIO_BYTES, audioExtensions } from './audioFormat';
import { MAX_PHOTO_BYTES } from './imageLimits';
import { captureBlob } from './captureUpload';
import { checkConnection } from './cloudBrowser';
import type { CloudCatalog } from './cloudCatalog';
import { DownloadCache } from './downloadCache';
import { DriveTransferError } from './driveClient';
import { sha256, trialClient } from './photoTrial';
import type { CloudMediaRecord, DriveIdentity } from './types';

export function supportedPhoto(file: CloudMediaRecord) {
  return file.kind === 'photo' && ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimeType) &&
    Number.isSafeInteger(file.sizeBytes) && file.sizeBytes > 0 && file.sizeBytes <= MAX_PHOTO_BYTES &&
    file.checksumAlgorithm === 'sha256' && /^[a-f0-9]{64}$/.test(file.checksum || '') &&
    Number.isSafeInteger(file.revision) && file.revision > 0;
}

export function supportedMedia(file: CloudMediaRecord) {
  return supportedPhoto(file) || (file.kind === 'audio' && !!audioExtensions[file.mimeType] &&
    Number.isSafeInteger(file.sizeBytes) && file.sizeBytes > 0 && file.sizeBytes <= MAX_AUDIO_BYTES &&
    file.checksumAlgorithm === 'sha256' && /^[a-f0-9]{64}$/.test(file.checksum || '') &&
    Number.isSafeInteger(file.revision) && file.revision > 0);
}

export class MediaResolver {
  constructor(private catalog: CloudCatalog, private identity: DriveIdentity, private cache = new DownloadCache()) {}

  async photo(record: CloudMediaRecord, signal: AbortSignal) {
    if (!supportedPhoto(record)) throw new DriveTransferError('failed');
    return this.media(record, signal);
  }

  async media(record: CloudMediaRecord, signal: AbortSignal) {
    const guard = () => { signal.throwIfAborted(); this.catalog.assertOwner(this.identity.ownerUid); };
    guard();
    if (record.ownerUid !== this.identity.ownerUid || record.connectionId !== this.identity.connectionId ||
      record.deletedAt || record.purgedAt || !supportedMedia(record)) throw new DriveTransferError('failed');
    await checkConnection(this.catalog, this.identity, signal);
    const { client, credentials } = trialClient(this.catalog, this.identity.connectionId, signal);
    const { ownerHash } = await credentials();
    const remote = await client.metadata(record.driveFileId, signal);
    guard();
    // Check remote access/version even on cache hits. No offline authorization bypass.
    const props = remote.appProperties;
    if (remote.trashed) throw new DriveTransferError('not_found');
    if (!remote.ownedByMe || remote.id !== record.driveFileId || remote.size !== String(record.sizeBytes) ||
      remote.mimeType !== record.mimeType || remote.sha256Checksum !== record.checksum ||
      !remote.parents?.includes(record.driveParentId) || props?.lecturebagConnectionId !== this.identity.connectionId ||
      props?.lecturebagFileId !== record.id || props?.lecturebagOwner !== ownerHash) throw new DriveTransferError('failed');
    const matches = async (blob: Blob) => blob.size === record.sizeBytes && await sha256(blob) === record.checksum;
    let local: Awaited<ReturnType<typeof captureSource>>;
    try { local = await captureSource(this.identity.ownerUid, record.id); } catch { /* Local storage is optional for remote reads. */ }
    const finish = async <T,>(result: T) => {
      await checkConnection(this.catalog, this.identity, signal); guard(); return result;
    };
    guard();
    if (local?.dataUrl) {
      try {
        const blob = captureBlob(local.dataUrl);
        const valid = await matches(blob); guard();
        if (valid) return finish({ blob, source: 'local' as const, cacheSaved: false });
      } catch (error) { guard(); /* A stale local copy never overwrites the Drive version. */ }
    }
    let cached;
    try { cached = await this.cache.read(record); } catch { /* Optional browser storage may be unavailable. */ }
    guard();
    let validCache = false;
    try { validCache = cached && await matches(cached.blob); } catch { /* Corrupt cache: re-download, never delete a source. */ }
    if (validCache) {
      guard();
      try { await this.cache.write(record, cached.blob); } catch { /* Still usable in memory. */ }
      guard(); return finish({ blob: new Blob([cached.blob], { type: record.mimeType }), source: 'cache' as const, cacheSaved: true });
    }
    if (cached) { try { await this.cache.remove(record); } catch { /* Never delete an original. */ } }
    guard();
    const downloaded = await client.download(record.driveFileId, signal, record.sizeBytes);
    if (!await matches(downloaded)) throw new DriveTransferError('failed');
    guard();
    const blob = new Blob([downloaded], { type: record.mimeType });
    let cacheSaved = false;
    try { cacheSaved = await this.cache.write(record, blob); } catch { /* Quota failure doesn't fail a verified preview. */ }
    guard();
    return finish({ blob, source: 'download' as const, cacheSaved });
  }
}
