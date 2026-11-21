import { get } from 'idb-keyval';
import { photoRecoverySnapshot, recoverCaptureIntents, saveRecordingRecheck } from '../../utils/mediaStorage';
import { recordingCheckDescription, recheckRecordingLength } from '../../utils/recordingRecheck';
import { accountKey } from '../../utils/accountStorage';
import { formatFileName, getFolderHierarchyFromDate } from '../../utils/dateFolders';
import type { CapturedPhoto, RecordedAudio, SemesterTimetable } from '../../types';
import { audioExtensions } from './audioFormat';
import { captureBlob } from './captureUpload';
import { CloudCatalog } from './cloudCatalog';
import { trialClient } from './photoTrial';
import { IndexedDbUploadJobStore, type UploadJob } from './uploadQueue';
import type { DriveIdentity } from './types';

export type PhotoRecoveryStatus = 'registered' | 'missing' | 'pending' | 'previous' | 'deleted' | 'review' | 'audio_review' | 'invalid';
export interface PhotoRecoveryRow { id: string; kind: 'photo' | 'audio'; name: string; status: PhotoRecoveryStatus;
  audioCheck?: { description: string; elapsedMs?: number; mediaDurationMs?: number; checkedAt?: number } }
type CaptureSource = (CapturedPhoto | RecordedAudio) & { kind: 'photo' | 'audio' };
export interface PhotoRecoveryReport { rows: PhotoRecoveryRow[]; checkedAt: string }
interface Dependencies {
  jobs: () => Promise<UploadJob[]>;
  exists: (id: string) => Promise<boolean>;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Checking is read-only. Never infer remote absence from a cached inventory. */
export async function inspectPhotoRecovery(identity: DriveIdentity, catalog: CloudCatalog, signal: AbortSignal,
  injected?: Dependencies): Promise<PhotoRecoveryReport & { sources: Map<string, CaptureSource> }> {
  const assertScope = () => { signal.throwIfAborted(); catalog.assertOwner(identity.ownerUid); };
  assertScope();
  const connection = await catalog.status(signal);
  if (!connection.connected || connection.connectionId !== identity.connectionId) throw new Error('Drive 연결이 변경되었습니다. 다시 확인해 주세요.');
  const { client, credentials } = injected ? {} : trialClient(catalog, identity.connectionId, signal);
  const dependencies: Dependencies = injected || {
    jobs: () => new IndexedDbUploadJobStore().listOwner(identity.ownerUid),
    exists: async id => client!.captureExists(id, (await credentials!()).ownerHash, signal),
  };
  const local = await photoRecoverySnapshot(identity.ownerUid);
  const jobs = await dependencies.jobs();
  assertScope();
  const deleted = new Set(local.trash.filter(entry => entry.purged || !entry.restored).map(entry => entry.file.id));
  const all: CaptureSource[] = [...local.photos.map(photo => ({ ...photo, kind: 'photo' as const })),
    ...local.recordings.map(recording => ({ ...recording, kind: 'audio' as const }))];
  const ambiguous = new Set(local.photos.filter(photo => local.recordings.some(recording => recording.id === photo.id)).map(photo => photo.id));
  const photos = [...new Map(all.map(source => [source.id, source])).values()].filter(source => !deleted.has(source.id));
  const ids = photos.map(photo => photo.id).filter(id => uuid.test(id));
  const remote = new Map<string, string>();
  for (let offset = 0; offset < ids.length; offset += 50) {
    const batch = ids.slice(offset, offset + 50);
    const response = await catalog.captureAudit(identity.connectionId, batch, signal);
    assertScope();
    for (const row of response.files) {
      if (!batch.includes(row.fileId) || !['missing', 'registered', 'previous', 'deleted'].includes(row.status)) throw new Error('서버 점검 결과를 확인하지 못했습니다.');
      remote.set(row.fileId, row.status);
    }
    if (batch.some(id => !remote.has(id))) throw new Error('일부 파일의 서버 기록을 확인하지 못했습니다.');
  }
  const rows: PhotoRecoveryRow[] = [];
  const sources = new Map<string, CaptureSource>();
  for (const photo of photos) {
    assertScope();
    const date = new Date(photo.timestamp);
    const name = Number.isFinite(date.getTime()) ? `${formatFileName(date)} · ${photo.id.slice(0, 8)}` : photo.id;
    const intent = local.intents.find(item => item.fileId === photo.id);
    const history = jobs.filter(job => job.fileId === photo.id);
    let status: PhotoRecoveryStatus;
    if (!uuid.test(photo.id) || ambiguous.has(photo.id)) status = 'invalid';
    else if (remote.get(photo.id) === 'deleted') status = 'deleted';
    else if (remote.get(photo.id) === 'previous' || (intent?.connectionId && intent.connectionId !== identity.connectionId)
      || history.some(job => job.connectionId !== identity.connectionId)) status = 'previous';
    else if (remote.get(photo.id) === 'registered') status = 'registered';
    else if (history.some(job => job.state === 'synced' || job.state === 'cancelled') ||
      local.trash.some(entry => entry.file.id === photo.id && entry.cloud)) status = 'review';
    else if (intent) status = 'pending';
    else if (history.length) status = 'review';
    // Preserve the recording safety gate: interrupted/unverified recordings
    // must not be uploaded merely because their upload intent is absent.
    else if (photo.kind === 'audio' && (photo as RecordedAudio).integrity?.status !== 'duration_checked') status = 'audio_review';
    else {
      try {
        if (!Number.isFinite(date.getTime()) || !photo.dataUrl ||
          !captureBlob(photo.dataUrl).type.startsWith(photo.kind === 'photo' ? 'image/' : 'audio/')) throw new Error('Invalid capture');
        status = 'missing';
      } catch { status = 'invalid'; }
      // Fail the whole audit on an incomplete/failed Drive lookup; never call
      // network errors "missing" and never enroll an orphaned Drive original.
      if (status === 'missing' && await dependencies.exists(photo.id)) status = 'review';
    }
    const recording = photo as RecordedAudio;
    rows.push({ id: photo.id, kind: photo.kind, name, status, ...(photo.kind === 'audio' ? { audioCheck: {
      description: recordingCheckDescription(recording), elapsedMs: recording.durationMs,
      mediaDurationMs: recording.integrity?.mediaDurationMs, checkedAt: recording.integrity?.checkedAt,
    } } : {}) });
    if (status === 'missing') sources.set(photo.id, photo);
  }
  const latest = await catalog.status(signal);
  assertScope();
  if (!latest.connected || latest.connectionId !== identity.connectionId || latest.revision !== connection.revision) {
    throw new Error('점검 중 Drive 연결이 변경되었습니다. 다시 확인해 주세요.');
  }
  return { rows, sources, checkedAt: new Date().toISOString() };
}

/** Local length recheck only. Passing does not enqueue or transmit the recording. */
export async function recheckAudioRecovery(identity: DriveIdentity, fileId: string, catalog: CloudCatalog,
  signal: AbortSignal, inspect = recheckRecordingLength) {
  const guard = () => { signal.throwIfAborted(); catalog.assertOwner(identity.ownerUid); };
  guard();
  const connection = await catalog.status(signal);
  if (!connection.connected || connection.connectionId !== identity.connectionId) throw new Error('Drive 연결이 변경되었습니다.');
  const local = await photoRecoverySnapshot(identity.ownerUid);
  guard();
  const recording = local.recordings.find(item => item.id === fileId);
  if (!recording?.dataUrl || local.photos.some(item => item.id === fileId) ||
    local.trash.some(entry => entry.file.id === fileId && (!entry.restored || entry.purged))) throw new Error('재검사할 녹음 원본을 찾지 못했습니다.');
  const blob = captureBlob(recording.dataUrl);
  if (!blob.type.startsWith('audio/')) throw new Error('녹음 파일 형식을 확인해 주세요.');
  const result = await inspect(recording, blob);
  guard();
  const latest = await catalog.status(signal);
  guard();
  if (!latest.connected || latest.connectionId !== identity.connectionId || latest.revision !== connection.revision) throw new Error('검사 중 Drive 연결이 변경되었습니다.');
  await saveRecordingRecheck(identity.ownerUid, recording, result, guard);
  return result;
}

/** Re-audit after confirmation. No job reset, ID regeneration or file deletion. */
export async function repairMissingPhotos(identity: DriveIdentity, selectedIds: string[], catalog: CloudCatalog,
  signal: AbortSignal, injected?: Dependencies) {
  const report = await inspectPhotoRecovery(identity, catalog, signal, injected);
  const timetables = await get<SemesterTimetable[]>(`lecture_snap_semester_timetables_${identity.ownerUid}`) || [];
  const timetableMode = localStorage.getItem(accountKey(identity.ownerUid, 'lecture_snap_storage_mode')) === 'timetable';
  const selected = new Set(selectedIds);
  const candidates = [...report.sources.values()].filter(photo => selected.has(photo.id)).map(photo => {
    const date = new Date(photo.timestamp), hierarchy = getFolderHierarchyFromDate(date, undefined, timetables);
    const mime = captureBlob(photo.dataUrl!).type;
    const extension = photo.kind === 'audio' ? audioExtensions[mime] : mime === 'image/webp' ? 'webp' : mime === 'image/png' ? 'png' : 'jpg';
    return { source: photo, kind: photo.kind, intent: { fileId: photo.id, connectionId: identity.connectionId,
      name: `${formatFileName(date)}_${photo.id.slice(0, 8)}.${extension}`, capturedAt: date.toISOString(),
      folderPath: timetableMode ? [hierarchy.year, hierarchy.semester, hierarchy.subject, hierarchy.month, hierarchy.day]
        : [hierarchy.year, hierarchy.halfYear, hierarchy.month, hierarchy.day] } };
  });
  const count = await recoverCaptureIntents(identity.ownerUid, identity.connectionId, candidates,
    () => { signal.throwIfAborted(); catalog.assertOwner(identity.ownerUid); });
  // Do not return source bytes to the component or diagnostic output.
  return { count };
}
