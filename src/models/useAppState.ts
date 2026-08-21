/**
 * useAppState.ts — DataModel equivalent
 *
 * All shared state, persistence logic, and business-logic handlers
 * used across MainView, CameraViewport, BottomNav, and CameraHUD.
 * No rendering logic lives here.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { CapturedPhoto, FlashMode, RecordedAudio, TimetableEntry, AspectRatio } from '../types';
import { playShutterSound } from '../utils/audio';
import { drawSimulatedLectureFrame } from '../utils/canvasSimulation';
import { useDeviceType } from '../hooks/useDeviceType';

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

export function useAppState() {
  const deviceType = useDeviceType();

  // ── Document / Folder ──────────────────────────────────────────────────
  const [currentDocument, setCurrentDocument] = useState<string>('디지털 디톡스 가이드.md');
  const [isFolderExplorerOpen, setIsFolderExplorerOpen] = useState<boolean>(false);

  // ── Gemini & Timetable ─────────────────────────────────────────────────
  const [geminiApiKey, setGeminiApiKey] = useState<string>(() => {
    return localStorage.getItem('lecture_snap_gemini_api_key') || '';
  });
  
  const [timetableImage, setTimetableImage] = useState<string | null>(() => {
    return localStorage.getItem('lecture_snap_timetable_image') || null;
  });

  const [storageMode, setStorageMode] = useState<'default' | 'timetable'>(() => {
    return (localStorage.getItem('lecture_snap_storage_mode') as 'default' | 'timetable') || 'default';
  });

  const [timetableEntries, setTimetableEntries] = useState<TimetableEntry[]>(() => {
    try {
      const saved = localStorage.getItem('lecture_snap_timetable_entries');
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
    return [];
  });

  useEffect(() => {
    localStorage.setItem('lecture_snap_gemini_api_key', geminiApiKey);
  }, [geminiApiKey]);

  useEffect(() => {
    if (timetableImage) {
      localStorage.setItem('lecture_snap_timetable_image', timetableImage);
    } else {
      localStorage.removeItem('lecture_snap_timetable_image');
    }
  }, [timetableImage]);

  useEffect(() => {
    localStorage.setItem('lecture_snap_storage_mode', storageMode);
  }, [storageMode]);

  useEffect(() => {
    localStorage.setItem('lecture_snap_timetable_entries', JSON.stringify(timetableEntries));
  }, [timetableEntries]);

  // ── Photos ─────────────────────────────────────────────────────────────
  const [photos, setPhotos] = useState<CapturedPhoto[]>(() => {
    try {
      const saved = localStorage.getItem('lecture_snap_photos');
      if (saved) {
        const parsed: CapturedPhoto[] = JSON.parse(saved);
        // Migrate: 기존 저장 항목의 id·folderName을 YYYYMMDD_HHmm 포맷으로 통일
        return parsed.map((p) => {
          const ts = p.timestamp ?? new Date();
          const name = formatFileName(ts);
          return {
            ...p,
            id: p.id.startsWith('photo_') && !/^photo_\d{8}_\d{4}$/.test(p.id)
              ? `photo_${name}`
              : p.id,
            folderName: p.folderName ?? name,
          };
        });
      }
    } catch (e) {
      console.error(e);
    }
    // 기본 샘플 데이터도 포맷 적용
    const sampleTime = new Date(Date.now() - 3600000);
    return [
      {
        id: `photo_${formatFileName(sampleTime)}`,
        dataUrl:
          'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200"><rect width="300" height="200" fill="%231c1c1e"/><text x="50%" y="50%" fill="%23ffffff" font-size="14" font-family="sans-serif" text-anchor="middle">PPT 슬라이드 #1</text></svg>',
        timestamp: sampleTime,
        mode: 'PPT/판서',
        width: 1080,
        height: 1440,
        folderName: formatFileName(sampleTime),
      },
    ];
  });

  const [selectedPhotoIds, setSelectedPhotoIds] = useState<string[]>([]);

  // ── Recordings ─────────────────────────────────────────────────────────
  const [recordings, setRecordings] = useState<RecordedAudio[]>(() => {
    try {
      const saved = localStorage.getItem('lecture_snap_recordings');
      if (saved) {
        const parsed: RecordedAudio[] = JSON.parse(saved);
        // Migrate: 기존 name이 구형 포맷이면 YYYYMMDD_HHmm.m4a 로 변환
        return parsed.map((r) => {
          const ts = r.timestamp ?? new Date();
          const name = formatFileName(ts);
          const needsMigration = !r.name.match(/^\d{8}_\d{4}/);
          return {
            ...r,
            id: r.id.startsWith('rec_') && !/^rec_\d{8}_\d{4}$/.test(r.id)
              ? `rec_${name}`
              : r.id,
            name: needsMigration ? `${name}.m4a` : r.name,
          };
        });
      }
    } catch (e) {
      console.error(e);
    }
    // 기본 샘플 데이터도 포맷 적용
    const sampleTime = new Date(Date.now() - 86400000);
    return [
      {
        id: `rec_${formatFileName(sampleTime)}`,
        name: `${formatFileName(sampleTime)}.m4a`,
        duration: '45:12',
        timestamp: sampleTime.toISOString(),
        size: '18.4 MB',
      },
    ];
  });

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

  // ── Modal Visibility ───────────────────────────────────────────────────
  const [isRecentModalOpen, setIsRecentModalOpen] = useState<boolean>(false);
  const [isRecentRecordingsModalOpen, setIsRecentRecordingsModalOpen] = useState<boolean>(false);

  // ── Selection Queue ────────────────────────────────────────────────────
  const [selectedQueueItems] = useState<string[]>(['yt_1', 'insta_1']);

  const showToast = useCallback((_msg: string) => {
    // Popup notifications disabled per user request
  }, []);

  // ── Camera stream lifecycle ────────────────────────────────────────────
  useEffect(() => {
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
  }, [cameraFacing]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  const setVideoRef = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (el && streamRef.current) {
      el.srcObject = streamRef.current;
      el.play().catch(() => {});
    }
  }, []);

  // ── LocalStorage persistence ───────────────────────────────────────────
  useEffect(() => {
    try {
      localStorage.setItem('lecture_snap_photos', JSON.stringify(photos));
    } catch (e) {
      console.error(e);
      if (e instanceof DOMException && e.name === 'QuotaExceededError') {
        alert('기기 저장 공간이 부족합니다. 오래된 사진을 삭제해주세요.');
      }
    }
  }, [photos]);

  useEffect(() => {
    try {
      localStorage.setItem('lecture_snap_recordings', JSON.stringify(recordings));
    } catch (e) {
      console.error(e);
      if (e instanceof DOMException && e.name === 'QuotaExceededError') {
        alert('기기 저장 공간이 부족합니다. 오래된 녹음 파일을 삭제해주세요.');
      }
    }
  }, [recordings]);

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

  const handleStartRecording = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    setIsAudioMode(true);
    setIsRecording(true);
    setIsPaused(false);
    setRecordingSeconds(0);
  }, []);

  const handleTogglePauseRecording = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    setIsPaused((prev) => !prev);
  }, []);

  const handleStopRecording = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (recordingSeconds > 0) {
      const now = new Date();
      const fileName = formatFileName(now); // e.g. '20260816_1443'
      const newRec: RecordedAudio = {
        id: `rec_${fileName}`,
        name: `${fileName}.m4a`,
        duration: formatRecordingTime(recordingSeconds),
        timestamp: now.toISOString(),
        size: `${(Math.max(1, recordingSeconds) * 0.12).toFixed(1)} MB`,
      };
      setRecordings((prev) => [newRec, ...prev]);
    }
    setIsRecording(false);
    setIsPaused(false);
    setRecordingSeconds(0);
  }, [recordingSeconds, formatRecordingTime]);

  const handleDeleteRecording = useCallback((id: string) => {
    setRecordings((prev) => prev.filter((r) => r.id !== id));
    showToast('녹음 파일이 삭제되었습니다');
  }, [showToast]);

  const handleDeletePhoto = useCallback((id: string) => {
    setPhotos((prev) => prev.filter((p) => p.id !== id));
    setSelectedPhotoIds((prev) => prev.filter((i) => i !== id));
    showToast('사진이 삭제되었습니다');
  }, [showToast]);

  const handleTakeSnapshot = useCallback(() => {
    if (isCapturing) return;
    setIsCapturing(true);
    playShutterSound();
    setShutterFlash(true);
    setTimeout(() => setShutterFlash(false), 150);

    const canvas = document.createElement('canvas');
    const video = videoRef.current;
    let dataUrl = '';

    // Determine target canvas dimensions based on current aspect ratio
    let width = 1080;
    let height = 1440; // 4:3 default (3:4 portrait)
    if (aspectRatio === '1:1') {
      width = 1080;
      height = 1080;
    } else if (aspectRatio === '16:9') {
      width = 1080;
      height = 1920;
    } else if (aspectRatio === '전체') {
      // Full screen ratio based on viewport
      const vRatio = window.innerWidth / (window.innerHeight || 1);
      if (vRatio > 1) {
        // Landscape full screen
        width = 1920;
        height = Math.round(1920 / vRatio);
      } else {
        // Portrait full screen
        height = 1920;
        width = Math.round(1920 * vRatio);
      }
    }

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
        dataUrl = canvas.toDataURL('image/jpeg', 0.92);
      }
    } else {
      // Camera offline fallback: Fill snapshot with solid black
      if (ctx) {
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, width, height);
        dataUrl = canvas.toDataURL('image/jpeg', 0.92);
      }
    }

    if (dataUrl) {
      const now = new Date();
      const fileName = formatFileName(now); // e.g. '20260816_1443'
      const newPhoto: CapturedPhoto = {
        id: `photo_${fileName}`,
        dataUrl,
        timestamp: now,
        mode: 'PPT/판서',
        width: canvas.width,
        height: canvas.height,
        folderName: fileName,
      };
      setPhotos((prev) => [newPhoto, ...prev]);
      setSelectedPhotoIds((prev) => [...prev, newPhoto.id]);
    }

    setIsCapturing(false);
    showToast('강의 사진이 촬영되어 저장되었습니다');
  }, [isCapturing, cameraStatus, cameraFacing, aspectRatio, showToast]);

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
    geminiApiKey, setGeminiApiKey,
    timetableImage, setTimetableImage,
    storageMode, setStorageMode,
    timetableEntries, setTimetableEntries,
    currentDocument, setCurrentDocument,
    isFolderExplorerOpen, setIsFolderExplorerOpen,
    handleFolderButtonClick,
    photos, setPhotos,
    selectedPhotoIds, setSelectedPhotoIds,
    handleDeletePhoto, handleTakeSnapshot,
    isCapturing, shutterFlash,
    recordings,
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
