import { cameraFrame } from '../utils/cameraFrame';
/**
 * useAppState.ts — DataModel equivalent
 *
 * All shared state, persistence logic, and business-logic handlers
 * used across MainView, CameraViewport, BottomNav, and CameraHUD.
 * No rendering logic lives here.
 */
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { CapturedPhoto, FlashMode, RecordedAudio, TimetableEntry, AspectRatio } from '../types';
import { saveMedia, saveCapturedPhoto, type CaptureIntent } from '../utils/mediaStorage';
import { useDriveSync } from '../context/DriveSyncContext';
import { accountKey } from '../utils/accountStorage';
import { useTrash } from '../context/TrashContext';
import { getSampleMediaFiles, getFolderHierarchyFromDate, formatFileName as captureFileName } from '../utils/dateFolders';
import { playShutterSound } from '../utils/audio';
import { drawSimulatedLectureFrame } from '../utils/canvasSimulation';
import { useDeviceType } from '../hooks/useDeviceType';
import { get, set } from 'idb-keyval';
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

  const [storageMode, setStorageMode] = useState<'default' | 'timetable'>(() => {
    return (localStorage.getItem(accountKey(uid, 'lecture_snap_storage_mode')) as 'default' | 'timetable') || 'default';
  });

  const [timetableEntries, setTimetableEntries] = useState<TimetableEntry[]>(() => {
    try {
      const saved = localStorage.getItem(accountKey(uid, 'lecture_snap_timetable_entries'));
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
    return [];
  });

  const [timetables, setTimetables] = useState<any[]>([]);

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

  useEffect(() => {
    localStorage.setItem(accountKey(uid, 'lecture_snap_storage_mode'), storageMode);
  }, [storageMode]);



  // ── Photos ─────────────────────────────────────────────────────────────
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [captureError, setCaptureError] = useState('');
  const unsavedCapture = useRef<{ photo: CapturedPhoto; intent?: CaptureIntent } | null>(null);
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
    if (captureSaving.current || !unsavedCapture.current) return;
    captureSaving.current = true;
    try { await persistCapture(unsavedCapture.current.photo, unsavedCapture.current.intent); }
    finally { captureSaving.current = false; }
  };

  const [selectedPhotoIds, setSelectedPhotoIds] = useState<string[]>([]);

  // ── Recordings ─────────────────────────────────────────────────────────
  const [recordings, setRecordings] = useState<RecordedAudio[]>([]);

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

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // ── Modal Visibility ───────────────────────────────────────────────────
  const [isRecentModalOpen, setIsRecentModalOpen] = useState<boolean>(false);
  const [isRecentRecordingsModalOpen, setIsRecentRecordingsModalOpen] = useState<boolean>(false);

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
        const ttKey = user ? `lecture_snap_semester_timetables_${user.uid}` : 'lecture_snap_semester_timetables';

        const [savedPhotos, savedRecs, savedTimetables] = await Promise.all([
          get(photosKey),
          get(recsKey),
          get(ttKey),
        ]);

        if (!isMounted) return;

        setPhotos((savedPhotos || []).filter((photo: CapturedPhoto) => !purgedIds.has(photo.id)));
        setRecordings((savedRecs || []).filter((recording: RecordedAudio) => !purgedIds.has(recording.id)));
        setTimetables(savedTimetables || []);
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

  useEffect(() => {
    if (!isDataLoaded) return;
    const ttKey = user ? `lecture_snap_semester_timetables_${user.uid}` : 'lecture_snap_semester_timetables';
    set(ttKey, timetables).catch(console.error);
  }, [timetables, isDataLoaded, user]);


  const showToast = useCallback((_msg: string) => {
    // Popup notifications disabled per user request
  }, []);

  // ── Camera stream lifecycle ───────────────────────────────────────────
  useEffect(() => {
    if (!canCapture) return;
    let cancelled = false;

    const startStream = async () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      try {
        let stream: MediaStream | null = null;
        if (cameraFacing === 'back' && window.__prewarmedCameraStream) {
          const prewarmed = window.__prewarmedCameraStream;
          window.__prewarmedCameraStream = null;
          stream = await prewarmed;
        }
        if (!stream) {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: cameraFacing === 'back' ? 'environment' : 'user' },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
            audio: false,
          });
        }
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => { videoRef.current?.play().catch(() => {}); };
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
  }, [cameraFacing, canCapture]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (audioStreamRef.current) {
        audioStreamRef.current.getTracks().forEach((t) => t.stop());
        audioStreamRef.current = null;
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  const setVideoRef = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (el && streamRef.current) {
      el.srcObject = streamRef.current;
      el.play().catch(() => {});
    }
  }, []);

  // ── Recording timer ────────────────────────────────────────────────────
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    if (isRecording && !isPaused) {
      interval = setInterval(() => setRecordingSeconds((prev) => prev + 1), 1000);
    }
    return () => { if (interval) clearInterval(interval); };
  }, [isRecording, isPaused]);

  // ── Handlers ───────────────────────────────────────────────────────────

  // 파일 이름 포맷은 모듈 레벨 formatFileName() 함수를 그대로 사용합니다.
  const formatRecordingTime = useCallback((sec: number) => {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }, []);

  const handleStartRecording = useCallback(async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!canCapture) return;
    try {
      // 1. 기기 마이크 오디오 스트림 획득
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      audioChunksRef.current = [];

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
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.start(500); // 500ms 단위로 chunk 수집
      mediaRecorderRef.current = recorder;

      setIsAudioMode(true);
      setIsRecording(true);
      setIsPaused(false);
      setRecordingSeconds(0);
      localStorage.setItem('lecture_bag_mic_permission', 'granted');
    } catch (err: any) {
      console.error('Failed to access microphone:', err);
      alert('마이크 접근 권한이 필요합니다. 기기 설정에서 마이크를 허용해주세요.');
    }
  }, [canCapture]);

  const handleTogglePauseRecording = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    const recorder = mediaRecorderRef.current;
    if (recorder) {
      if (recorder.state === 'recording') {
        recorder.pause();
        setIsPaused(true);
      } else if (recorder.state === 'paused') {
        recorder.resume();
        setIsPaused(false);
      }
    } else {
      setIsPaused((prev) => !prev);
    }
  }, []);

  const handleStopRecording = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    const recorder = mediaRecorderRef.current;
    const stream = audioStreamRef.current;
    const finalSeconds = recordingSeconds;

    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = () => {
        const mimeType = recorder.mimeType || 'audio/webm';
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        const sizeMB = (audioBlob.size / (1024 * 1024)).toFixed(1);

        const reader = new FileReader();
        reader.onloadend = () => {
          const dataUrl = reader.result as string;
          const now = new Date();
          const fileName = formatFileName(now);
          const newRec: RecordedAudio = {
            id: `rec_${now.getTime()}_${Math.floor(Math.random() * 1000)}`,
            name: `${fileName}.m4a`,
            duration: formatRecordingTime(finalSeconds > 0 ? finalSeconds : 1),
            timestamp: now.toISOString(),
            size: `${sizeMB === '0.0' ? '0.1' : sizeMB} MB`,
            dataUrl: dataUrl,
          };
          setRecordings((prev) => [newRec, ...prev]);
        };
        reader.readAsDataURL(audioBlob);

        // 오디오 트랙 해제
        if (stream) {
          stream.getTracks().forEach((t) => t.stop());
          audioStreamRef.current = null;
        }
        mediaRecorderRef.current = null;
        audioChunksRef.current = [];
      };

      recorder.stop();
    } else {
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
        audioStreamRef.current = null;
      }
      if (finalSeconds > 0) {
        const now = new Date();
        const fileName = formatFileName(now);
        const newRec: RecordedAudio = {
          id: `rec_${now.getTime()}_${Math.floor(Math.random() * 1000)}`,
          name: `${fileName}.m4a`,
          duration: formatRecordingTime(finalSeconds),
          timestamp: now.toISOString(),
          size: `${(Math.max(1, finalSeconds) * 0.12).toFixed(1)} MB`,
        };
        setRecordings((prev) => [newRec, ...prev]);
      }
    }

    setIsRecording(false);
    setIsPaused(false);
    setRecordingSeconds(0);
  }, [recordingSeconds, formatRecordingTime]);

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
    if (!canCapture || isCapturing || !user || !isDataLoaded || captureSaving.current || unsavedCapture.current) return;
    if (cameraStatus !== 'live' || !videoRef.current || videoRef.current.readyState < 2) {
      setCaptureError('카메라가 아직 준비되지 않았습니다. 카메라 권한을 확인한 뒤 다시 촬영해 주세요.');
      return;
    }
    captureSaving.current = true;
    setIsCapturing(true);
    try {
      playShutterSound();
      setShutterFlash(true);
      setTimeout(() => setShutterFlash(false), 150);

      const canvas = document.createElement('canvas');
      const video = videoRef.current;
      let dataUrl = '';

      // Match the visible crop, including landscape and installed-app viewport size.
      const bounds = video?.parentElement?.getBoundingClientRect();
      const frame = cameraFrame(bounds?.width || window.innerWidth, bounds?.height || window.innerHeight, aspectRatio);
      const scale = 1920 / Math.max(frame.width, frame.height);
      const width = Math.max(1, Math.round(frame.width * scale));
      const height = Math.max(1, Math.round(frame.height * scale));

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');

      if (video && cameraStatus === 'live' && video.readyState >= 2) {
        if (ctx) {
          if (cameraFacing === 'front') {
            ctx.translate(canvas.width, 0);
            ctx.scale(-1, 1);
          }
          // Center-crop video to aspect ratio dimensions
          const vW = video.videoWidth || 1280;
          const vH = video.videoHeight || 720;
          const targetRatio = width / height;
          const srcRatio = vW / vH;

          let sW = vW;
          let sH = vH;
          let sX = 0;
          let sY = 0;

          if (srcRatio > targetRatio) {
            sW = vH * targetRatio;
            sX = (vW - sW) / 2;
          } else {
            sH = vW / targetRatio;
            sY = (vH - sH) / 2;
          }

          ctx.drawImage(video, sX, sY, sW, sH, 0, 0, canvas.width, canvas.height);
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
        await persistCapture(newPhoto, driveSync.enabled ? {
          fileId: newPhoto.id, name: `${captureFileName(now)}_${newPhoto.id.slice(0, 8)}.${extension}`,
          capturedAt: now.toISOString(), connectionId: driveSync.connection?.connected ? driveSync.connection.connectionId : undefined,
          folderPath: storageMode === 'timetable'
            ? [hierarchy.year, hierarchy.semester, hierarchy.subject, hierarchy.month, hierarchy.day]
            : [hierarchy.year, hierarchy.halfYear, hierarchy.month, hierarchy.day],
        } : undefined);
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
    timetables, setTimetables,
    currentDocument, setCurrentDocument,
    isFolderExplorerOpen, setIsFolderExplorerOpen,
    handleFolderButtonClick,
    photos: photos.filter(photo => !trashedIds.has(photo.id)), setPhotos,
    selectedPhotoIds, setSelectedPhotoIds,
    handleDeletePhoto, handleTakeSnapshot,
    isCapturing, shutterFlash, captureError, retryCaptureSave, canRetryCaptureSave: !!unsavedCapture.current,
    captureDisabled: !isDataLoaded || isCapturing || !!unsavedCapture.current,
    recordings: recordings.filter(recording => !trashedIds.has(recording.id)),
    handleDeleteRecording, handleStartRecording,
    handleTogglePauseRecording, handleStopRecording,
    formatRecordingTime,
    isRecording, isPaused, recordingSeconds,
    videoRef, streamRef, setVideoRef,
    cameraStatus, cameraFacing, setCameraFacing,
    flashMode, aspectRatio,
    isCameraMenuOpen, setIsCameraMenuOpen,
    toggleAspectRatio, toggleFlashMode, toggleCameraFacing,
    isAudioMode, setIsAudioMode,
    isRecentModalOpen, setIsRecentModalOpen,
    isRecentRecordingsModalOpen, setIsRecentRecordingsModalOpen,
    selectedQueueItems, totalSelectedCount, showToast,
  };
}
