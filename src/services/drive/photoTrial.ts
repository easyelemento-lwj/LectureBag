import { createStore, get, set, del } from 'idb-keyval';
import { CloudCatalog } from './cloudCatalog';
import { DriveClient, DriveTransferError } from './driveClient';
import type { CloudMediaRecord } from './types';

export const TRIAL_FOLDER = 'photo-trial';
const store = () => createStore('lecturebag-drive-photo-trial', 'photos');
export interface PendingPhoto { id: string; blob: Blob; name: string; capturedAt: string; driveId?: string }
export const photoKey = (uid: string, connectionId: string) => JSON.stringify([uid, connectionId]);
export const pendingPhoto = (key: string) => get<PendingPhoto>(key, store());
export async function stagePhoto(key: string, file: File) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || !file.size || file.size > 20 * 1024 * 1024) {
    throw new Error('20MB 이하의 JPEG, PNG, WebP 사진을 선택해 주세요.');
  }
  const bitmap = await createImageBitmap(file); bitmap.close();
  if (await pendingPhoto(key)) throw new Error('이전에 보관한 사진을 먼저 업로드해 주세요.');
  const photo: PendingPhoto = { id: crypto.randomUUID(), blob: file, name: file.name,
    capturedAt: new Date().toISOString() };
  await set(key, photo, store());
  return photo;
}

export async function sha256(blob: Blob) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))]
    .map(n => n.toString(16).padStart(2, '0')).join('');
}

export function trialClient(catalog: CloudCatalog, connectionId: string, signal: AbortSignal) {
  let grant: { accessToken: string; ownerHash: string } | undefined;
  let expires = 0;
  const credentials = async () => {
    signal.throwIfAborted();
    if (!grant || Date.now() >= expires) {
      const fresh = await catalog.transferToken(connectionId, signal);
      grant = fresh; expires = Date.now() + Math.max(0, fresh.expiresIn - 60) * 1000;
    }
    signal.throwIfAborted();
    return grant;
  };
  return { client: new DriveClient(async () => (await credentials()).accessToken), credentials };
}

export async function uploadPhoto(key: string, catalog: CloudCatalog, connectionId: string,
  signal: AbortSignal, progress: (message: string) => void) {
  const photo = await pendingPhoto(key);
  if (!photo) throw new Error('보관된 사진이 없습니다.');
  const { client, credentials } = trialClient(catalog, connectionId, signal);
  const { ownerHash } = await credentials();
  const properties = { lecturebagConnectionId: connectionId, lecturebagOwner: ownerHash };
  async function folder(key: string, name: string, parent?: string) {
    const { id } = await catalog.reserveId(connectionId, key, await client.generateId(signal), signal);
    await client.folder(id, name, { ...properties, lecturebagFolderId: key }, parent, signal);
    return id;
  }
  progress('Drive 폴더 준비 중…');
  const root = await folder('root', 'LectureBag');
  const parentId = await folder(TRIAL_FOLDER, '사진 업로드 시험', root);
  if (!photo.driveId) {
    photo.driveId = await client.generateId(signal);
    await set(key, photo, store()); // Reserve locally before any original bytes leave the device.
  }
  let remote;
  try { remote = await client.metadata(photo.driveId, signal); }
  catch (error) { if (!(error instanceof DriveTransferError) || error.code !== 'not_found') throw error; }
  if (!remote) {
    const session = await client.startUpload({ id: photo.driveId, name: photo.name, mimeType: photo.blob.type,
      parentId, appProperties: { ...properties, lecturebagFileId: photo.id } }, photo.blob.size, signal);
    let offset = 0;
    while (offset < photo.blob.size) {
      const result = await client.sendChunk(session, photo.blob, offset, undefined, signal);
      if (result.confirmedBytes <= offset) throw new Error('전송이 중단됐습니다. 다시 시도해 주세요.');
      offset = result.confirmedBytes;
      progress(`업로드 ${Math.round(offset / photo.blob.size * 100)}%`);
      if (result.complete) { remote = result.file; break; }
    }
  }
  progress('원본 무결성 확인 중…');
  if (!remote || remote.id !== photo.driveId || ('trashed' in remote && remote.trashed) ||
    remote.size !== String(photo.blob.size) || remote.mimeType !== photo.blob.type ||
    !remote.sha256Checksum || remote.sha256Checksum !== await sha256(photo.blob)) {
    throw new Error('Drive 원본 검증에 실패했습니다. 기기 원본은 보관됩니다.');
  }
  progress('목록 등록 중…');
  const record = await catalog.commit({ id: photo.id, connectionId, driveFileId: photo.driveId,
    logicalFolderId: TRIAL_FOLDER, capturedAt: photo.capturedAt, sizeBytes: photo.blob.size, mimeType: photo.blob.type }, signal);
  signal.throwIfAborted();
  await del(key, store());
  return record;
}

export async function openPhoto(catalog: CloudCatalog, connectionId: string, record: CloudMediaRecord, signal: AbortSignal) {
  if (record.connectionId !== connectionId || record.kind !== 'photo' || record.sizeBytes > 20 * 1024 * 1024 ||
    !['image/jpeg', 'image/png', 'image/webp'].includes(record.mimeType)) throw new Error('지원하지 않는 사진입니다.');
  const { client } = trialClient(catalog, connectionId, signal);
  const blob = await client.download(record.driveFileId, signal);
  if (blob.size !== record.sizeBytes || record.checksumAlgorithm !== 'sha256' || await sha256(blob) !== record.checksum) {
    throw new Error('다운로드한 원본이 목록의 버전과 다릅니다.');
  }
  return new Blob([blob], { type: record.mimeType });
}
