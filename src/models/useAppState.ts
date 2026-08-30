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
import { get, set } from 'idb-keyval';
import { compressImage } from '../utils/imageCompression';

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
  const [isDataLoaded, setIsDataLoaded] = React.useState(false);
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

  const [timetables, setTimetables] = useState<any[]>([]);

  useEffect(() => {
    // ── Obsolete LocalStorage Keys Clean-up ────────────────────────────────
    try {
      localStorage.removeItem('lecture_snap_timetable_entries');
      localStorage.removeItem('lecture_snap_timetable_image');
      localStorage.removeItem('doc_sample_1');
      localStorage.removeItem('ai_doc_sample_1');
    } catch (e) {
      console.error('Failed to clean obsolete localStorage keys:', e);
    }
  }, []);

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



  // ── Photos ─────────────────────────────────────────────────────────────
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);

  const [selectedPhotoIds, setSelectedPhotoIds] = useState<string[]>([]);

  // ── Recordings ─────────────────────────────────────────────────────────
  const [recordings, setRecordings] = useState<RecordedAudio[]>([]);

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
        await requestPersistentStorage();
        
        const [savedPhotos, savedRecs, savedTimetables] = await Promise.all([
          get('lecture_snap_photos'),
          get('lecture_snap_recordings'),
          get('lecture_snap_semester_timetables'),
        ]);

        if (savedPhotos) setPhotos(savedPhotos);
        if (savedRecs) setRecordings(savedRecs);
        if (savedTimetables) setTimetables(savedTimetables);
      } catch (e) {
        console.error('Failed to load data from IDB:', e);
      } finally {
        setIsDataLoaded(true);
      }
    }
    loadData();
  }, []);

  // ── IndexedDB Auto Save ────────────────────────────────────────────────
  useEffect(() => {
    if (!isDataLoaded) return;
    set('lecture_snap_photos', photos).catch(console.error);
  }, [photos, isDataLoaded]);

  useEffect(() => {
    if (!isDataLoaded) return;
    set('lecture_snap_recordings', recordings).catch(console.error);
  }, [recordings, isDataLoaded]);

  useEffect(() => {
    if (!isDataLoaded) return;
    set('lecture_snap_semester_timetables', timetables).catch(console.error);
  }, [timetables, isDataLoaded]);


  const showToast = useCallback((_msg: string) => {
    // Popup notifications disabled per user request
  }, []);

  // ── Camera stream lifecycle & Initial Mic Permission ───────────────────
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

        // 순차적 권한 요청: 카메라 권한이 승인된 후, 마이크 권한이 아직 요청되지 않은 경우 마이크 권한 요청
        const micPerm = localStorage.getItem('lecture_bag_mic_permission');
        if (!micPerm && navigator.mediaDevices?.getUserMedia) {
          setTimeout(async () => {
            try {
              const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
              audioStream.getTracks().forEach((t) => t.stop());
              localStorage.setItem('lecture_bag_mic_permission', 'granted');
            } catch (micErr: any) {
              if (micErr?.name === 'NotAllowedError' || micErr?.name === 'PermissionDeniedError') {
                localStorage.setItem('lecture_bag_mic_permission', 'denied');
              }
            }
          }, 300);
        }
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

  const handleStartRecording = useCallback(async (e?: React.MouseEvent) => {
    e?.stopPropagation();
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
  }, []);

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
        dataUrl = compressImage(canvas);
      }
    } else {
      // Camera offline fallback: Fill snapshot with solid black
      if (ctx) {
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, width, height);
        dataUrl = compressImage(canvas);
      }
    }

    if (dataUrl) {
      const now = new Date();
      const fileName = formatFileName(now);
      const newPhoto: CapturedPhoto = {
        id: `photo_${now.getTime()}_${Math.floor(Math.random() * 1000)}`,
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
    timetables, setTimetables,
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
