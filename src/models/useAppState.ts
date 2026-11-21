import { isNativeAndroid, native } from '../services/native';
import { importNativeMedia } from '../services/nativeMedia';
import { cameraFrame } from '../utils/cameraFrame';
import { openCamera, photoGeometry } from '../utils/cameraQuality';
import { RecordingClock } from '../utils/recordingClock';
import { RecordingSession, type RecordingResult } from '../utils/recordingSession';
import { inspectRecording } from '../utils/recordingIntegrity';
import { DRAFT_LEASE_MS, listRecordingDrafts, recoverRecordingDraft, removeCommittedDraft, type RecordingDraft } from '../utils/recordingDrafts';
/**
 * useAppState.ts — DataModel equivalent
 *
 * All shared state, persistence logic, and business-logic handlers
 * used across MainView, CameraViewport, BottomNav, and CameraHUD.
 * No rendering logic lives here.
 */
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { CapturedPhoto, FlashMode, RecordedAudio, TimetableEntry, AspectRatio } from '../types';
import { saveMedia, saveCapturedPhoto, saveRecordedAudio, type CaptureIntent } from '../utils/mediaStorage';
import { audioMime, audioExtensions, MAX_AUDIO_BYTES } from '../services/drive/audioFormat';
import { useDriveSync } from '../context/DriveSyncContext';
import { accountKey } from '../utils/accountStorage';
import { useTrash } from '../context/TrashContext';
import { getSampleMediaFiles, getFolderHierarchyFromDate, formatFileName as captureFileName } from '../utils/dateFolders';
import { playShutterSound } from '../utils/audio';
import { drawSimulatedLectureFrame } from '../utils/canvasSimulation';
import { useDeviceType } from '../hooks/useDeviceType';
import { get } from 'idb-keyval';
import { useAccountTimetable } from '../hooks/useAccountTimetable';
import { compressImage } from '../utils/imageCompression';
import { useAuth } from '../hooks/useAuth';

declare global {
  interface Window {
    __prewarmedCameraStream: Promise<MediaStream> | null;
  }
}

/**
 * 파일 이름 포맷 헬퍼: YYYYMMDD_HHmm (예: 20260816_1443)
 * useState 초기화 함수에서도 사용할 수 있도록 모듈 레벨에 선언합니다.
 */
function formatFileName(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return formatFileName(new Date()); // fallback to now
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}${mm}${dd}_${hh}${min}`;
}

export function useAppState(canCapture: boolean) {
  const { user } = useAuth();
  const driveSync = useDriveSync();
  const uid = user?.uid ?? 'guest';
  const activeUid = useRef(uid);
  activeUid.current = uid;
  const { entries: trashEntries, moveToTrash } = useTrash();
  const purgedIds = useMemo(() => new Set(trashEntries.filter(entry => entry.purged).map(entry => entry.file.id)), [trashEntries]);
  const trashedIds = new Set(trashEntries.filter(entry => !entry.restored).map(entry => entry.file.id));
  const [isDataLoaded, setIsDataLoaded] = React.useState(false);
  const deviceType = useDeviceType();

  // ── Document / Folder ──────────────────────────────────────────────────
  const [currentDocument, setCurrentDocument] = useState<string>('디지털 디톡스 가이드.md');
  const [isFolderExplorerOpen, setIsFolderExplorerOpen] = useState<boolean>(!canCapture);

  // ── Gemini & Timetable ─────────────────────────────────────────────────
  const [timetableImage, setTimetableImage] = useState<string | null>(() => {
    return localStorage.getItem(accountKey(uid, 'lecture_snap_timetable_image')) || null;
  });

  const { storageMode, setStorageMode, timetables, setTimetables, timetableSync } = useAccountTimetable(user, canCapture);

  const [timetableEntries, setTimetableEntries] = useState<TimetableEntry[]>(() => {
    try {
      const saved = localStorage.getItem(accountKey(uid, 'lecture_snap_timetable_entries'));
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
    return [];
  });


  useEffect(() => {
    // Remove obsolete client-side credentials; never load another account's key.
    localStorage.removeItem('lecture_snap_gemini_api_key');
  }, []);

  useEffect(() => {
    if (timetableImage) {
      localStorage.setItem(accountKey(uid, 'lecture_snap_timetable_image'), timetableImage);
    } else {
      localStorage.removeItem(accountKey(uid, 'lecture_snap_timetable_image'));
    }
  }, [timetableImage]);




  // ── Photos ─────────────────────────────────────────────────────────────
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [captureError, setCaptureError] = useState('');
  const unsavedCapture = useRef<{ photo: CapturedPhoto; intent?: CaptureIntent } | null>(null);
  const unsavedRecording = useRef<{ uid: string; blob: Blob; recording: RecordedAudio; intent?: CaptureIntent; draftOwner?: string } | null>(null);
  const recordingContext = useRef<{ uid: string; enabled: boolean; connectionId?: string; folderPath: string[] }>();
  const recordingStarting = useRef(false);
  const captureSaving = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const persistCapture = async (photo: CapturedPhoto, intent?: CaptureIntent) => {
    if (!user) return;
    unsavedCapture.current = { photo, intent };
    try {
      await saveCapturedPhoto(user.uid, photo, intent);
      if (!mounted.current) return;
      unsavedCapture.current = null;
      setCaptureError('');
      setPhotos(prev => [photo, ...prev]);
      setSelectedPhotoIds(prev => [...prev, photo.id]);
      driveSync.wake();
    } catch {
      if (mounted.current) setCaptureError('기기에 사진을 저장하지 못했습니다. 화면을 닫지 말고 저장 공간을 확보한 뒤 다시 시도해 주세요.');
    }
  };
  const retryCaptureSave = async () => {
    if (captureSaving.current) return;
    if (unsavedRecording.current) { await persistRecording(); return; }
    if (!unsavedCapture.current) return;
    captureSaving.current = true;
    try { await persistCapture(unsavedCapture.current.photo, unsavedCapture.current.intent); }
    finally { captureSaving.current = false; }
  };

  const [selectedPhotoIds, setSelectedPhotoIds] = useState<string[]>([]);

  // ── Recordings ─────────────────────────────────────────────────────────
  const [recordings, setRecordings] = useState<RecordedAudio[]>([]);
  const [recordingSaving, setRecordingSaving] = useState(false);
  const persistRecording = async () => {
    const pending = unsavedRecording.current;
    if (!pending) return;
    if (captureSaving.current) {
      if (mounted.current && pending.uid === activeUid.current) setCaptureError('다른 기기 저장 작업이 진행 중입니다. 완료 후 녹음 기기 저장을 다시 시도해 주세요.');
      return;
    }
    captureSaving.current = true;
    if (mounted.current) setRecordingSaving(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reader.onabort = () => reject(new Error('녹음 읽기 실패'));
        reader.readAsDataURL(pending.blob);
      });
      const recording = { ...pending.recording, dataUrl };
      await saveRecordedAudio(pending.uid, recording, pending.intent);
      if (pending.draftOwner) {
        // Cleanup failure must not turn a committed original into a failed save.
        await removeCommittedDraft(pending.uid, recording.id, pending.draftOwner).catch(() => {});
      }
      unsavedRecording.current = null;
      if (mounted.current && pending.uid === activeUid.current) {
        setRecordings(prev => [recording, ...prev]); setCaptureError(recording.integrity?.warning || ''); driveSync.wake();
      }
    } catch {
      if (mounted.current && pending.uid === activeUid.current) setCaptureError('녹음을 기기에 저장하지 못했습니다. 화면을 닫지 말고 저장 공간을 확보한 뒤 저장을 다시 시도해 주세요.');
    } finally { captureSaving.current = false; if (mounted.current) setRecordingSaving(false); }
  };

  useEffect(() => {
    if (!purgedIds.size) return;
    setPhotos(prev => prev.some(photo => purgedIds.has(photo.id)) ? prev.filter(photo => !purgedIds.has(photo.id)) : prev);
    setRecordings(prev => prev.some(recording => purgedIds.has(recording.id)) ? prev.filter(recording => !purgedIds.has(recording.id)) : prev);
    setSelectedPhotoIds(prev => prev.filter(id => !purgedIds.has(id)));
  }, [purgedIds, photos, recordings]);

  // ── Camera Stream ──────────────────────────────────────────────────────
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraStatus, setCameraStatus] = useState<'loading' | 'live' | 'denied' | 'unavailable'>('loading');
  const [cameraFacing, setCameraFacing] = useState<'back' | 'front'>('back');
  const [flashMode, setFlashMode] = useState<FlashMode>('off');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('전체');
  const [isCapturing, setIsCapturing] = useState<boolean>(false);
  const [shutterFlash, setShutterFlash] = useState<boolean>(false);
  const [isCameraMenuOpen, setIsCameraMenuOpen] = useState<boolean>(false);

  // ── Audio Recording ────────────────────────────────────────────────────
  const [isAudioMode, setIsAudioMode] = useState<boolean>(false);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [recordingSeconds, setRecordingSeconds] = useState<number>(0);
  const recordingClock = useRef(new RecordingClock());

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const recordingSession = useRef<RecordingSession | null>(null);
  const [recoverableRecordings, setRecoverableRecordings] = useState<RecordingDraft[]>([]);

  useEffect(() => {
    let cancelled = false;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const drafts = await listRecordingDrafts(uid);
        const recoverable = drafts.filter(d => d.id !== recordingSession.current?.draft.id &&
          Date.now() - d.updatedAt >= DRAFT_LEASE_MS);
        if (!cancelled) setRecoverableRecordings(previous =>
          previous.length === recoverable.length && previous.every((d, i) =>
            d.uid === recoverable[i].uid && d.id === recoverable[i].id && d.updatedAt === recoverable[i].updatedAt)
            ? previous : recoverable);
      } catch { /* Retain the last known recovery list on a transient storage failure. */ }
      finally { refreshing = false; }
    };
    void refresh(); const interval = setInterval(refresh, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [uid]);

  useEffect(() => {
    if (isNativeAndroid()) return;
    // This is the web recorder safety path. A native mobile build must record
    // through its native audio service and bridge; merely ignoring pagehide in
    // a WebView can create a truncated file when iOS/Android suspends JavaScript.
    const hidden = () => { if (document.hidden) recordingSession.current?.stop('앱이 화면에서 벗어나 녹음을 안전하게 종료했습니다. 수집된 부분을 확인해 주세요.'); };
    const leaving = () => recordingSession.current?.stop('화면을 떠나 녹음을 종료했습니다.');
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', leaving);
    return () => {
      document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', leaving);
      recordingSession.current?.stop('계정 또는 녹음 화면이 변경되어 녹음을 종료했습니다.');
    };
  }, [uid]);

  const nativeRefresh = useRef<() => Promise<void>>(async () => {});
  const nativeRefreshing = useRef(false);
  nativeRefresh.current = async () => {
    if (!isNativeAndroid() || !user || !isDataLoaded || document.hidden || nativeRefreshing.current) return;
    nativeRefreshing.current = true;
    const owner = user.uid;
    const stillOwner = () => mounted.current && activeUid.current === owner;
    try {
      const status = await native.status({ uid: owner });
      if (!stillOwner()) return;
      setIsRecording(!!status.active); setIsPaused(status.active?.state === 'paused');
      setRecordingSeconds(Math.floor((status.active?.elapsedMs ?? 0) / 1000));
      const finishedRecordings = RECORDING_ENABLED ? status.finished : [];
      if (!captureSaving.current && (finishedRecordings.length || status.photos.length)) {
        captureSaving.current = true; setRecordingSaving(finishedRecordings.length > 0);
        try {
          const saved = await importNativeMedia(owner, status.photos, finishedRecordings, stillOwner);
          if (saved && stillOwner()) { setPhotos(saved.photos); setRecordings(saved.recordings); setCaptureError(saved.photoIssues ? `사진 ${saved.photoIssues}개의 기기 원본을 확인하지 못해 보존했습니다. 저장 공간과 휴지통을 확인해 주세요.` : ''); driveSync.wake(); }
        } finally { captureSaving.current = false; if (stillOwner()) setRecordingSaving(false); }
      } else if (!status.active && !finishedRecordings.length) setRecordingSaving(false);
    } catch { if (stillOwner()) setCaptureError('기기 원본 저장을 완료하지 못했습니다. 원본은 보존되며 다시 확인합니다.'); }
    finally { nativeRefreshing.current = false; }
  };
  useEffect(() => {
    if (!isNativeAndroid()) return;
    const refresh = () => { void nativeRefresh.current(); };
    refresh(); const timer = setInterval(refresh, 1000);
    document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [uid]);

  // ── Modal Visibility ───────────────────────────────────────────────────

  // ── Selection Queue ────────────────────────────────────────────────────
  const [selectedQueueItems] = useState<string[]>(['yt_1', 'insta_1']);

  // ── IndexedDB Async Loading ────────────────────────────────────────────
  useEffect(() => {
    let isMounted = true;
    async function requestPersistentStorage() {
      if (navigator.storage && navigator.storage.persist) {
        try {
          await navigator.storage.persist();
        } catch (e) {
          console.error('Failed to request persistent storage', e);
        }
      }
    }

    async function loadData() {
      try {
        setIsDataLoaded(false);
        await requestPersistentStorage();
        
        const photosKey = user ? `lecture_snap_photos_${user.uid}` : 'lecture_snap_photos';
        const recsKey = user ? `lecture_snap_recordings_${user.uid}` : 'lecture_snap_recordings';
        const [savedPhotos, savedRecs] = await Promise.all([
          get(photosKey),
          get(recsKey),
        ]);

        if (!isMounted) return;

        setPhotos((savedPhotos || []).filter((photo: CapturedPhoto) => !purgedIds.has(photo.id)));
        setRecordings((savedRecs || []).filter((recording: RecordedAudio) => !purgedIds.has(recording.id)));
      } catch (e) {
        console.error('Failed to load data from IDB:', e);
      } finally {
        if (isMounted) setIsDataLoaded(true);
      }
    }
    loadData();
    return () => { isMounted = false; };
  }, [user]);

  // ── IndexedDB Auto Save ────────────────────────────────────────────────
  useEffect(() => {
    if (!isDataLoaded) return;
    saveMedia(uid, 'photos', photos).catch(console.error);
  }, [photos, isDataLoaded, user, purgedIds]);

  useEffect(() => {
    if (!isDataLoaded) return;
    saveMedia(uid, 'recordings', recordings).catch(console.error);
  }, [recordings, isDataLoaded, user, purgedIds]);



  const showToast = useCallback((_msg: string) => {
    // Popup notifications disabled per user request
  }, []);

  // ── Camera stream lifecycle ───────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    const stopStream = () => {
      streamRef.current?.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      if (videoRef.current?.srcObject) videoRef.current.srcObject = null;
    };

    if (isNativeAndroid()) return;
    // Keep the camera permission active only while its preview is visible.
    // This releases iOS's camera privacy indicator in recording/explorer views.
    if (!canCapture || isAudioMode || isFolderExplorerOpen) {
      stopStream();
      setCameraStatus('loading');
      return;
    }

    const startStream = async () => {
      stopStream();
      try {
        let stream: MediaStream | null = null;
        if (cameraFacing === 'back' && window.__prewarmedCameraStream) {
          const prewarmed = window.__prewarmedCameraStream;
          window.__prewarmedCameraStream = null;
          stream = await prewarmed;
        }
        if (!stream) {
          stream = await openCamera(navigator.mediaDevices, cameraFacing === 'back' ? 'environment' : 'user');
        }
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          if (videoRef.current.srcObject !== stream) videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => { videoRef.current?.play().catch(() => {}); };
          if (videoRef.current.readyState >= 1 && videoRef.current.paused) videoRef.current.play().catch(() => {});
        }
        setCameraStatus('live');

      } catch (err: unknown) {
        if (cancelled) return;
        const error = err as { name?: string };
        if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError') {
          setCameraStatus('denied');
        } else {
          setCameraStatus('unavailable');
        }
      }
    };

    startStream();
    return () => { cancelled = true; };
  }, [cameraFacing, canCapture, isAudioMode, isFolderExplorerOpen]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      recordingSession.current?.stop('녹음 화면이 닫혔습니다. 수집된 부분을 보존합니다.');
    };
  }, []);

  const setVideoRef = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (el && streamRef.current) {
      if (el.srcObject !== streamRef.current) el.srcObject = streamRef.current;
      if (el.paused) el.play().catch(() => {});
    }
  }, []);

  // ── Recording timer ────────────────────────────────────────────────────
  useEffect(() => {
    if (!isRecording || isNativeAndroid()) return;
    const refresh = () => setRecordingSeconds(recordingClock.current.seconds());
    refresh();
    // This timer only refreshes the display; elapsed time never counts callbacks.
    const interval = setInterval(refresh, 250);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('pageshow', refresh);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('pageshow', refresh);
    };
  }, [isRecording, isPaused]);

  // ── Handlers ───────────────────────────────────────────────────────────

  // 파일 이름 포맷은 모듈 레벨 formatFileName() 함수를 그대로 사용합니다.
  const formatRecordingTime = useCallback((sec: number) => {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }, []);

  const finishRecording = async (result: RecordingResult, context?: typeof recordingContext.current) => {
    const { blob, elapsedMs, draft } = result;
    const visible = () => mounted.current && activeUid.current === draft.uid;
    if (visible()) { setIsRecording(false); setIsPaused(false); setRecordingSaving(true); }
    try {
      if (!blob.size) {
        if (visible()) setCaptureError('녹음된 오디오가 없습니다. 마이크 상태를 확인해 주세요.');
        return;
      }
      const integrity = await inspectRecording(blob, elapsedMs, result.warning);
      const recording: RecordedAudio = {
        id: draft.id, name: `${formatFileName(draft.startedAt)}.${audioExtensions[draft.mime]}`,
        timestamp: draft.startedAt, durationMs: elapsedMs, integrity,
        duration: formatRecordingTime(Math.floor((integrity.mediaDurationMs ?? elapsedMs) / 1000)),
        size: `${(blob.size / (1024 * 1024)).toFixed(1)} MB`,
      };
      unsavedRecording.current = { uid: draft.uid, blob, recording, draftOwner: draft.owner,
        intent: integrity.status === 'duration_checked' && context && blob.size <= MAX_AUDIO_BYTES ? {
          fileId: draft.id, name: recording.name, capturedAt: draft.startedAt,
          connectionId: context.connectionId, folderPath: context.folderPath,
        } : undefined };
      await persistRecording();
    } finally {
      if (recordingSession.current?.draft.id === draft.id) {
        recordingSession.current = null; mediaRecorderRef.current = null; audioStreamRef.current = null;
      }
      if (visible()) { setRecordingSaving(false); setRecordingSeconds(0); }
    }
  };

  const recoverInterruptedRecording = async () => {
    if (!user || recordingStarting.current || recordingSession.current || captureSaving.current || unsavedRecording.current) return;
    const draft = recoverableRecordings[0]; if (!draft) return;
    recordingStarting.current = true; setRecordingSaving(true);
    try {
      const result = await recoverRecordingDraft(user.uid, draft.id, crypto.randomUUID());
      // A crash after source commit but before draft cleanup must never duplicate the source.
      const saved = await get<RecordedAudio[]>(`lecture_snap_recordings_${user.uid}`);
      if (saved?.some(r => r.id === draft.id && r.dataUrl)) {
        await removeCommittedDraft(user.uid, draft.id, result.draft.owner);
      } else {
        await finishRecording({ ...result, elapsedMs: result.draft.elapsedMs,
          warning: '중단된 녹음에서 기기에 저장된 조각을 복구했습니다. 끝부분 누락이나 재생 불가 가능성이 있어 확인이 필요합니다.' });
      }
      if (activeUid.current === draft.uid) setRecoverableRecordings(prev => prev.filter(d => d.id !== draft.id));
    } catch { if (activeUid.current === draft.uid) setCaptureError('중간 저장 복구를 완료하지 못했습니다. 다른 창에서 녹음 중인지 확인해 주세요. 저장된 조각은 유지됩니다.'); }
    finally { recordingStarting.current = false; if (mounted.current) setRecordingSaving(false); }
  };

  const handleStartRecording = useCallback(async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!RECORDING_ENABLED) return;
    if (!canCapture || !user || !isDataLoaded || captureSaving.current || unsavedRecording.current || unsavedCapture.current || mediaRecorderRef.current || recordingStarting.current) return;
    recordingStarting.current = true;
    try {
      const hierarchy = getFolderHierarchyFromDate(new Date(), undefined, timetables);
      recordingContext.current = { uid: user.uid, enabled: driveSync.enabled,
        connectionId: driveSync.connection?.connected ? driveSync.connection.connectionId : undefined,
        folderPath: storageMode === 'timetable'
          ? [hierarchy.year, hierarchy.semester, hierarchy.subject, hierarchy.month, hierarchy.day]
          : [hierarchy.year, hierarchy.halfYear, hierarchy.month, hierarchy.day] };
      if (isNativeAndroid()) {
        const session = await native.recordingStart({ uid: user.uid, id: crypto.randomUUID(),
          startedAt: new Date().toISOString(), context: recordingContext.current });
        if (!mounted.current || activeUid.current !== user.uid) {
          await native.recordingStop({ uid: user.uid }); return;
        }
        setIsAudioMode(true); setIsRecording(true); setIsPaused(false); setRecordingSeconds(Math.floor(session.elapsedMs / 1000));
        setCaptureError(''); return;
      }
      // 1. 기기 마이크 오디오 스트림 획득
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current || activeUid.current !== user.uid) { stream.getTracks().forEach(track => track.stop()); return; }
      audioStreamRef.current = stream;

      // 2. 브라우저 지원 코덱 설정
      let options: MediaRecorderOptions = { audioBitsPerSecond: 32000 };
      if (typeof MediaRecorder !== 'undefined') {
        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
          options = { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 32000 };
        } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
          options = { mimeType: 'audio/mp4', audioBitsPerSecond: 32000 };
        } else if (MediaRecorder.isTypeSupported('audio/webm')) {
          options = { mimeType: 'audio/webm', audioBitsPerSecond: 32000 };
        }
      }

      const recorder = new MediaRecorder(stream, options);
      // Check the actual container before recording, not a guessed extension on stop.
      const mime = audioMime(recorder.mimeType);
      const draft: RecordingDraft = { id: crypto.randomUUID(), uid: user.uid, owner: crypto.randomUUID(),
        mime, startedAt: new Date().toISOString(), updatedAt: Date.now(), elapsedMs: 0, count: 0, bytes: 0 };
      const context = recordingContext.current;
      const session = new RecordingSession(recorder, draft, recordingClock.current,
        result => finishRecording(result, context), message => {
          if (mounted.current && activeUid.current === draft.uid) setCaptureError(message);
        });
      recordingSession.current = session;
      mediaRecorderRef.current = recorder;
      await session.start();
      if (!mounted.current || activeUid.current !== user.uid || document.hidden) { session.stop('계정 또는 화면이 변경되어 녹음을 종료했습니다.'); return; }

      setIsAudioMode(true);
      setIsRecording(true);
      setIsPaused(false);
      setRecordingSeconds(0);
      setCaptureError('');
      localStorage.setItem('lecture_bag_mic_permission', 'granted');
    } catch (err: any) {
      audioStreamRef.current?.getTracks().forEach(track => track.stop());
      audioStreamRef.current = null;
      mediaRecorderRef.current = null; recordingSession.current = null;
      console.error('Failed to access microphone:', err);
      if (mounted.current) setCaptureError('녹음을 시작하지 못했습니다. 마이크 권한과 기기 저장 공간을 확인해 주세요.');
    } finally { recordingStarting.current = false; }
  }, [canCapture, user, isDataLoaded, timetables, storageMode, driveSync.enabled, driveSync.connection]);

  const handleTogglePauseRecording = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (isNativeAndroid()) {
      void native.recordingPause({ uid: activeUid.current }).then(session => {
        if (!mounted.current) return;
        setIsPaused(session.state === 'paused'); setRecordingSeconds(Math.floor(session.elapsedMs / 1000));
      }).catch(() => setCaptureError('녹음 상태를 변경하지 못했습니다.'));
      return;
    }
    const recorder = mediaRecorderRef.current;
    if (recorder) {
      if (recorder.state === 'recording') {
        recordingSession.current?.pause();
        setRecordingSeconds(recordingClock.current.seconds());
        setIsPaused(true);
      } else if (recorder.state === 'paused') {
        recordingSession.current?.resume();
        setIsPaused(false);
      }
    }
  }, []);

  const handleStopRecording = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (isNativeAndroid()) {
      setRecordingSaving(true);
      void native.recordingStop({ uid: activeUid.current }).then(() => nativeRefresh.current()).catch(() => {
        setRecordingSaving(false); setCaptureError('녹음 종료 상태를 확인해 주세요.');
      });
      return;
    }
    recordingSession.current?.stop();
    setRecordingSaving(!!recordingSession.current);
    setIsRecording(false);
    setIsPaused(false);
    setRecordingSeconds(0);
  };

  const handleDeleteRecording = useCallback(async (id: string) => {
    const files = getSampleMediaFiles([], recordings).filter(file => file.id === id);
    if (files.length) await moveToTrash(files);
  }, [recordings, moveToTrash]);

  const handleDeletePhoto = useCallback(async (id: string) => {
    const files = getSampleMediaFiles(photos, []).filter(file => file.id === id);
    if (files.length && await moveToTrash(files)) {
      setSelectedPhotoIds(prev => prev.filter(item => item !== id));
    }
  }, [photos, moveToTrash]);

  const handleTakeSnapshot = async () => {
    if (!canCapture || isCapturing || !user || !isDataLoaded || captureSaving.current || unsavedCapture.current || unsavedRecording.current) return;
    if (isNativeAndroid()) {
      captureSaving.current = true; setIsCapturing(true);
      try {
        const now = new Date(), id = crypto.randomUUID();
        const hierarchy = getFolderHierarchyFromDate(now, undefined, timetables);
        const intent: CaptureIntent = { fileId: id, name: `${captureFileName(now)}_${id.slice(0, 8)}.jpg`,
          capturedAt: now.toISOString(), connectionId: driveSync.connection?.connected ? driveSync.connection.connectionId : undefined,
          folderPath: storageMode === 'timetable'
            ? [hierarchy.year, hierarchy.semester, hierarchy.subject, hierarchy.month, hierarchy.day]
            : [hierarchy.year, hierarchy.halfYear, hierarchy.month, hierarchy.day] };
        await native.photo({ uid: user.uid, id, startedAt: now.toISOString(), intent });
        setShutterFlash(true); setTimeout(() => setShutterFlash(false), 150);
      } catch { setCaptureError('사진 촬영 또는 저장에 실패했습니다. 저장된 원본은 보존됩니다.'); }
      finally { captureSaving.current = false; setIsCapturing(false); void nativeRefresh.current(); }
      return;
    }
    if (cameraStatus !== 'live' || !videoRef.current || videoRef.current.readyState < 2) {
      setCaptureError('카메라가 아직 준비되지 않았습니다. 카메라 권한을 확인한 뒤 다시 촬영해 주세요.');
      return;
    }
    captureSaving.current = true;
    setIsCapturing(true);
    try {
      // Avoid recording our own shutter sound through the active microphone.
      if (!isRecording) playShutterSound();
      setShutterFlash(true);
      setTimeout(() => setShutterFlash(false), 150);

      const canvas = document.createElement('canvas');
      const video = videoRef.current;
      let dataUrl = '';

      // Match the visible crop, including landscape and installed-app viewport size.
      const bounds = video?.parentElement?.getBoundingClientRect();
      const frame = cameraFrame(bounds?.width || window.innerWidth, bounds?.height || window.innerHeight, aspectRatio);
      const crop = photoGeometry(video?.videoWidth || 0, video?.videoHeight || 0, frame.width / frame.height);
      const { width, height } = crop;

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');

      if (video && cameraStatus === 'live' && video.readyState >= 2) {
        if (ctx) {
          if (cameraFacing === 'front') {
            ctx.translate(canvas.width, 0);
            ctx.scale(-1, 1);
          }
          ctx.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, canvas.width, canvas.height);
          dataUrl = compressImage(canvas);
        }
      }

      if (!dataUrl) throw new Error('Capture failed');
      if (dataUrl) {
        const now = new Date();
        const fileName = formatFileName(now);
        const newPhoto: CapturedPhoto = {
          id: crypto.randomUUID(),
          dataUrl,
          timestamp: now,
          mode: 'PPT/판서',
          width: canvas.width,
          height: canvas.height,
          folderName: fileName,
        };
        const hierarchy = getFolderHierarchyFromDate(now, undefined, timetables);
        const extension = dataUrl.startsWith('data:image/webp;') ? 'webp' : dataUrl.startsWith('data:image/png;') ? 'png' : 'jpg';
        // Always retain upload intent, even in a build with cloud sync disabled.
        // Upload itself still requires the enabled provider and a connected account.
        await persistCapture(newPhoto, {
          fileId: newPhoto.id, name: `${captureFileName(now)}_${newPhoto.id.slice(0, 8)}.${extension}`,
          capturedAt: now.toISOString(), connectionId: driveSync.connection?.connected ? driveSync.connection.connectionId : undefined,
          folderPath: storageMode === 'timetable'
            ? [hierarchy.year, hierarchy.semester, hierarchy.subject, hierarchy.month, hierarchy.day]
            : [hierarchy.year, hierarchy.halfYear, hierarchy.month, hierarchy.day],
        });
      }
    } catch {
      if (mounted.current) setCaptureError('사진을 만들지 못했습니다. 카메라 상태와 저장 공간을 확인해 주세요.');
    } finally {
      captureSaving.current = false;
      if (mounted.current) setIsCapturing(false);
    }
  };

  const toggleAspectRatio = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setAspectRatio((prev) => {
      const modes: AspectRatio[] = ['전체', '4:3', '16:9', '1:1'];
      return modes[(modes.indexOf(prev) + 1) % modes.length];
    });
  }, []);

  const toggleFlashMode = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    setFlashMode((prev) => {
      const modes: FlashMode[] = ['off', 'on', 'auto'];
      return modes[(modes.indexOf(prev) + 1) % modes.length];
    });
  }, []);

  const toggleCameraFacing = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    setCameraFacing((prev) => (prev === 'back' ? 'front' : 'back'));
  }, []);

  const handleFolderButtonClick = useCallback(() => {
    setIsFolderExplorerOpen(true);
  }, []);

  const totalSelectedCount = selectedPhotoIds.length + selectedQueueItems.length;

  return {
    deviceType,
    timetableImage, setTimetableImage,
    storageMode, setStorageMode,
    timetableEntries, setTimetableEntries,
    timetables, setTimetables, timetableSync,
    currentDocument, setCurrentDocument,
    isFolderExplorerOpen, setIsFolderExplorerOpen,
    handleFolderButtonClick,
    photos: photos.filter(photo => !trashedIds.has(photo.id)), setPhotos,
    selectedPhotoIds, setSelectedPhotoIds,
    handleDeletePhoto, handleTakeSnapshot,
    isCapturing, shutterFlash, captureError, retryCaptureSave, recordingSaving, canRetryCaptureSave: !!unsavedCapture.current || !!unsavedRecording.current,
    recoverableRecordingCount: recoverableRecordings.length, recoverInterruptedRecording,
    captureDisabled: !isDataLoaded || isCapturing || !!unsavedCapture.current,
    recordings: recordings.filter(recording => !trashedIds.has(recording.id)),
    handleDeleteRecording, handleStartRecording,
    handleTogglePauseRecording, handleStopRecording,
    formatRecordingTime,
    isRecording, isPaused, recordingSeconds,
    videoRef, streamRef, setVideoRef,
    cameraStatus, setNativeCameraStatus: setCameraStatus, cameraFacing, setCameraFacing,
    flashMode, aspectRatio,
    isCameraMenuOpen, setIsCameraMenuOpen,
    toggleAspectRatio, toggleFlashMode, toggleCameraFacing,
    isAudioMode, setIsAudioMode,
    selectedQueueItems, totalSelectedCount, showToast,
  };
}
import { RECORDING_ENABLED } from '../utils/featureFlags';
