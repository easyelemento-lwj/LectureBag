import { CloudBrowser, checkConnection } from './cloudBrowser';
import { CloudCatalog, CatalogError, type CloudChanges } from './cloudCatalog';
import { DriveRangeUnavailable, DriveTransferError } from './driveClient';
import { DownloadCache, downloadKey } from './downloadCache';
import { supportedMedia } from './mediaResolver';
import { PcLibraryStore, type PcFolder, type PcLibraryState } from './pcLibrary';
import { trialClient, sha256 } from './photoTrial';
import type { CloudMediaRecord } from './types';

export interface PcProgress { phase: 'scanning' | 'checking' | 'downloading' | 'complete'; total: number; done: number; bytes: number; totalBytes: number; name?: string; unsupported: number; unavailable: number }
/** Bootstrap the app catalog, not every Drive folder. Trash stays excluded from
 * the active PC list; the separate lifecycle catalog retains it for restoration. */
export async function scanRegisteredLibrary(catalog: CloudCatalog, expected: PcLibraryState, signal: AbortSignal) {
  const files = new Map<string, CloudMediaRecord>(), folders = new Map<string, PcFolder>();
  const cursors = new Set<string>(); let cursor: string | undefined;
  do {
    signal.throwIfAborted(); catalog.assertOwner(expected.uid);
    const page = await catalog.inventory(expected.connection.connectionId!, cursor, signal);
    signal.throwIfAborted(); catalog.assertOwner(expected.uid);
    if (!Array.isArray(page.files) || page.files.length > 50 || (page.nextCursor !== null && typeof page.nextCursor !== 'string')) throw new Error('잘못된 등록 목록');
    for (const f of page.files) {
      if (!f || f.ownerUid !== expected.uid || f.connectionId !== expected.connection.connectionId ||
        typeof f.id !== 'string' || !f.id || typeof f.driveParentId !== 'string' || typeof f.logicalFolderId !== 'string' ||
        typeof f.name !== 'string' || typeof f.driveFileId !== 'string' || !Number.isSafeInteger(f.revision) || f.revision < 1 ||
        !Number.isSafeInteger(f.sizeBytes) || f.sizeBytes < 1 || files.has(f.id)) throw new Error('등록 목록 계정 또는 파일 불일치');
      files.set(f.id, f);
      if (!f.deletedAt && !f.purgedAt) folders.set(f.driveParentId,
        expected.folders.find(p => p.id === f.driveParentId) || { id: f.driveParentId, logicalFolderId: f.logicalFolderId,
          name: f.logicalFolderId === 'photo-trial' ? '사진 업로드 시험' : '동기화 자료' });
    }
    cursor = page.nextCursor || undefined;
    if (cursor && (cursors.has(cursor) || cursors.size >= 2000)) throw new Error('반복된 등록 목록 커서');
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return { folders: [...folders.values()], files: [...files.values()].filter(f => !f.deletedAt && !f.purgedAt) };
}
export async function scanPcLibrary(browser: CloudBrowser, signal: AbortSignal) {
  const root = await browser.root(signal);
  const folders: PcFolder[] = root ? [{ ...root }] : [], files = new Map<string, CloudMediaRecord>();
  const seen = new Set<string>();
  for (let index = 0; index < folders.length; index++) {
    signal.throwIfAborted(); const folder = folders[index];
    if (seen.has(folder.id) || folders.length > 10_000) throw new Error('폴더 순환 또는 동기화 한도 초과'); seen.add(folder.id);
    let cursor: string | undefined; const fileCursors = new Set<string>();
    do {
      const page = await browser.files(folder, cursor, signal);
      for (const file of page.files) { if (files.has(file.id)) throw new Error('중복 파일 ID'); files.set(file.id, file); }
      if (files.size > 100_000) throw new Error('한 번에 동기화할 수 있는 파일 수를 초과했습니다.');
      cursor = page.nextCursor || undefined;
      if (cursor && fileCursors.has(cursor)) throw new Error('반복된 파일 커서'); if (cursor) fileCursors.add(cursor);
    } while (cursor);
    let token: string | undefined; const folderCursors = new Set<string>();
    do {
      const page = await browser.folders(folder.id, token, signal);
      folders.push(...page.folders.map(child => ({ ...child, parentId: folder.id })));
      token = page.nextPageToken;
      if (token && folderCursors.has(token)) throw new Error('반복된 폴더 커서'); if (token) folderCursors.add(token);
    } while (token);
  }
  return { folders, files: [...files.values()] };
}

export async function syncPcLibrary(catalog: CloudCatalog, expected: PcLibraryState, store: PcLibraryStore,
  signal: AbortSignal, progress: (p: PcProgress) => void, updated: () => Promise<void>,
  options: { firstPage?: CloudChanges; fullScan?: boolean } = {}) {
  const identity = { ownerUid: expected.uid, connectionId: expected.connection.connectionId! };
  const guard = () => { signal.throwIfAborted(); catalog.assertOwner(identity.ownerUid); };
  guard();
  const status: PcProgress = { phase: expected.syncCursor && !options.fullScan ? 'checking' : 'scanning', total: 0, done: 0, bytes: 0, totalBytes: 0, unsupported: 0, unavailable: 0 };
  progress({ ...status });
  let local = await store.state(expected.uid);
  let fullScan = options.fullScan || !local?.syncCursor;
  const bootstrap = async () => {
    // Capture cursor BEFORE scanning: registrations racing the scan are replayed.
    const head = await catalog.syncHead(identity.connectionId, signal); guard();
    const snapshot = await scanRegisteredLibrary(catalog, expected, signal); guard();
    await checkConnection(catalog, identity, signal); guard();
    local = await store.snapshot(expected, snapshot.folders, snapshot.files, head); await updated();
  };
  if (fullScan) await bootstrap();
  const catchUp = async (first?: CloudChanges) => {
    for (let count = 0; count < 2000; count++) {
      guard();
      const after = local!.syncCursor!;
      const page = first || await catalog.changes(identity.connectionId, after.cursor, 0, signal); first = undefined;
      guard(); local = await store.applyChanges(expected, after, page); await updated();
      if (!page.hasMore) return;
    }
    throw new Error('변경 목록 한도를 초과했습니다. 저장된 커서부터 다시 시작합니다.');
  };
  try { await catchUp(fullScan ? undefined : options.firstPage); }
  catch (error) {
    if (!(error instanceof CatalogError) || error.code !== 'DRIVE_SYNC_RESET_REQUIRED') throw error;
    fullScan = true; await bootstrap(); await catchUp();
  }
  // Persist metadata first so the UI can show download-pending rows immediately.
  // Only pending originals need Drive metadata/download calls on an incremental pass.
  const unavailable = new Set(local!.unavailable);
  const files = local!.files.filter(file => !file.deletedAt && !file.purgedAt && !file.driveUnavailable && supportedMedia(file) && (fullScan ||
    (!unavailable.has(file.id) && local!.saved[file.id] !== downloadKey(file))));
  status.total = files.length; status.unsupported = local!.files.filter(f => !supportedMedia(f)).length;
  status.unavailable = local!.unavailable.filter(id => local!.files.some(f => f.id === id)).length;
  status.totalBytes = files.reduce((n, file) => n + file.sizeBytes, 0); status.phase = 'downloading';
  const { client, credentials } = trialClient(catalog, identity.connectionId, signal);
  const ownerHash = files.length ? (await credentials()).ownerHash : ''; const cache = new DownloadCache();
  const verifyRemote = async (file: CloudMediaRecord) => {
    const remote = await client.metadata(file.driveFileId, AbortSignal.any([signal, AbortSignal.timeout(30_000)])); guard();
    const p = remote.appProperties;
    if (remote.trashed || !remote.ownedByMe || remote.id !== file.driveFileId || remote.size !== String(file.sizeBytes) ||
      remote.mimeType !== file.mimeType || remote.sha256Checksum !== file.checksum || !remote.parents?.includes(file.driveParentId) ||
      p?.lecturebagFileId !== file.id || p?.lecturebagConnectionId !== identity.connectionId || p?.lecturebagOwner !== ownerHash) throw new DriveTransferError('not_found');
  };
  for (const file of files) {
    guard(); status.name = file.name; progress({ ...status });
    try {
      await verifyRemote(file);
      let blob = await store.read(file); guard();
      if (!blob) {
        const cached = await cache.read(file).catch(() => undefined);
        if (cached?.blob.size === file.sizeBytes && await sha256(cached.blob) === file.checksum) blob = cached.blob;
        if (!blob) {
          let partial = await store.partial(file);
          while (partial.offset < file.sizeBytes) {
            guard();
            const timeout = AbortSignal.any([signal, AbortSignal.timeout(120_000)]);
            try {
              const result = await client.downloadRange(file.driveFileId, partial.offset, file.sizeBytes, timeout); guard();
              if (result.full) { blob = new Blob([result.blob], { type: file.mimeType }); break; }
              await store.append(expected, file, partial.offset, result.blob); partial = await store.partial(file);
              progress({ ...status, bytes: status.bytes + partial.offset });
            } catch (error) {
              if (!(error instanceof DriveRangeUnavailable)) throw error;
              blob = new Blob([await client.download(file.driveFileId, timeout, file.sizeBytes)], { type: file.mimeType }); break;
            }
          }
          if (!blob) {
            try { blob = await store.assembled(file); }
            catch (error) { await store.discardPartial(expected, file); throw error; }
          }
        }
        guard(); await verifyRemote(file); await checkConnection(catalog, identity, signal); guard();
        await store.commit(expected, file, blob); await updated();
      }
      status.done++; status.bytes += file.sizeBytes;
      if (unavailable.has(file.id)) status.unavailable--;
    } catch (error) {
      if (error instanceof DriveTransferError && (error.code === 'not_found' || error.httpStatus === 403)) {
        await store.unavailable(expected, file.id); await updated(); if (!unavailable.has(file.id)) status.unavailable++;
      } else throw error;
    }
    progress({ ...status });
  }
  guard(); await checkConnection(catalog, identity, signal);
  status.phase = 'complete'; status.name = undefined; progress({ ...status });
}
