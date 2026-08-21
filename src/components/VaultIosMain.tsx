import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  BookOpen,
  Image,
  SlidersHorizontal,
  FileText,
  FolderOpen,
  Sparkles,
  Youtube,
  AlignLeft,
  ChevronDown,
  Folder,
  Plus,
  Trash2,
  Download,
  Camera,
  X,
  Zap,
  ZapOff,
  Grid as GridIcon,
  RotateCcw,
  RefreshCw,
  Mic,
  Square,
  Pause,
  Play,
  Volume2,
  Activity,
  Radio,
  MoreHorizontal
} from 'lucide-react';
import { CapturedPhoto, FlashMode, RecordedAudio } from '../types';
import { playShutterSound } from '../utils/audio';
import { useAccentColor } from '../context/AccentColorContext';
import { RecentPhotosModal } from './RecentPhotosModal';
import { RecentRecordingsModal } from './RecentRecordingsModal';
import { FolderExplorerModal } from './FolderExplorerModal';

export const VaultIosMain: React.FC = () => {
  const { accentColor } = useAccentColor();
  // Current document selection state
  const [currentDocument, setCurrentDocument] = useState<string>('디지털 디톡스 가이드.md');
  const [isFolderExplorerOpen, setIsFolderExplorerOpen] = useState<boolean>(false);
  const [isCameraMenuOpen, setIsCameraMenuOpen] = useState<boolean>(false);

  // Photos state from LocalStorage
  const [photos, setPhotos] = useState<CapturedPhoto[]>(() => {
    try {
      const saved = localStorage.getItem('lecture_snap_photos');
      if (saved) {
        const parsed: CapturedPhoto[] = JSON.parse(saved);
        // Clean up dataUrl if it was generated with old watermark canvas
        const cleanCanvas = document.createElement('canvas');
        cleanCanvas.width = 1080;
        cleanCanvas.height = 1440;
        const ctx = cleanCanvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#000000';
          ctx.fillRect(0, 0, 1080, 1440);
        }
        const cleanDataUrl = cleanCanvas.toDataURL('image/jpeg', 0.92);

        return parsed.map((p) => ({
          ...p,
          dataUrl: p.dataUrl.startsWith('data:image/svg') ? p.dataUrl : cleanDataUrl,
        }));
      }
    } catch (e) {
      console.error(e);
    }
    return [
      {
        id: 'sample_1',
        dataUrl: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200"><rect width="300" height="200" fill="%231c1c1e"/><text x="50%" y="50%" fill="%23ffffff" font-size="14" font-family="sans-serif" text-anchor="middle">PPT 슬라이드 #1</text></svg>',
        timestamp: new Date(Date.now() - 3600000),
        mode: 'PPT/판서',
        width: 1080,
        height: 1440
      }
    ];
  });

  // Audio Recordings state from LocalStorage
  const [recordings, setRecordings] = useState<RecordedAudio[]>(() => {
    try {
      const saved = localStorage.getItem('lecture_snap_recordings');
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
    return [
      {
        id: 'rec_sample_1',
        name: '컴퓨터구조 12주차 강의 녹음.m4a',
        duration: '45:12',
        timestamp: new Date(Date.now() - 86400000).toISOString(),
        size: '18.4 MB'
      }
    ];
  });

  const [selectedPhotoIds, setSelectedPhotoIds] = useState<string[]>([]);
  const [selectedQueueItems, setSelectedQueueItems] = useState<string[]>(['yt_1', 'insta_1']);

  // Camera Stream Refs & Status
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraStatus, setCameraStatus] = useState<'loading' | 'live' | 'denied' | 'unavailable'>('loading');

  // Modal & Camera States
  const [isCameraOpen, setIsCameraOpen] = useState<boolean>(false);
  const [isRecentModalOpen, setIsRecentModalOpen] = useState<boolean>(false);
  const [isRecentRecordingsModalOpen, setIsRecentRecordingsModalOpen] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [flashMode, setFlashMode] = useState<FlashMode>('off');
  const [aspectRatio, setAspectRatio] = useState<'4:3' | '16:9' | '1:1'>('4:3');
  const [cameraFacing, setCameraFacing] = useState<'back' | 'front'>('back');
  const [showGrid, setShowGrid] = useState<boolean>(false);
  const [isCapturing, setIsCapturing] = useState<boolean>(false);
  const [shutterFlash, setShutterFlash] = useState<boolean>(false);

  // Audio Recording States
  const [isAudioMode, setIsAudioMode] = useState<boolean>(false);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [recordingSeconds, setRecordingSeconds] = useState<number>(0);

  const showToast = useCallback((_msg: string) => {
    // Popup notifications disabled per user request
  }, []);

  // ─── Camera Stream Attachment ──────────────────────────────────────────────
  // Pick up the pre-warmed stream from main.tsx (started before React mounted)
  // and attach it to the video element the moment this component renders.
  // Falls back to requesting a new stream if pre-warm failed, and handles
  // switching cameras when the user toggles front/back.
  useEffect(() => {
    let cancelled = false;

    const startStream = async () => {
      // Stop any existing stream first
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }

      try {
        let stream: MediaStream | null = null;

        // Use the globally pre-warmed stream if this is the initial back-camera load
        if (cameraFacing === 'back' && window.__prewarmedCameraStream) {
          const prewarmed = window.__prewarmedCameraStream;
          window.__prewarmedCameraStream = null; // consume it once
          stream = await prewarmed;
        }

        // If no pre-warmed stream available (camera flip / permission retry), request fresh
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

        if (cancelled) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          // Play as soon as the video element has enough data
          videoRef.current.onloadedmetadata = () => {
            videoRef.current?.play().catch(() => {});
          };
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

    return () => {
      cancelled = true;
    };
  }, [cameraFacing]);

  // Cleanup stream on component unmount
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    };
  }, []);

  // Update video srcObject when videoRef mounts after the stream is ready
  const setVideoRef = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (el && streamRef.current) {
      el.srcObject = streamRef.current;
      el.play().catch(() => {});
    }
  }, []);

  // Sync Record Timer
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    if (isRecording && !isPaused) {
      interval = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRecording, isPaused]);

  // Sync LocalStorage Recordings with Error Handling
  useEffect(() => {
    try {
      localStorage.setItem('lecture_snap_recordings', JSON.stringify(recordings));
    } catch (e) {
      console.error('Failed to save recordings to localStorage:', e);
      if (e instanceof DOMException && e.name === 'QuotaExceededError') {
        alert('기기 저장 공간이 부족하여 녹음 파일을 저장할 수 없습니다. 오래된 항목을 삭제해주세요.');
      }
    }
  }, [recordings]);

  const formatRecordingTime = useCallback((sec: number) => {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }, []);

  const handleStartRecording = useCallback((e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setIsAudioMode(true);
    setIsRecording(true);
    setIsPaused(false);
    setRecordingSeconds(0);
  }, []);

  const handleTogglePauseRecording = useCallback((e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setIsPaused((prev) => !prev);
  }, []);

  const handleStopRecording = useCallback((e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (recordingSeconds > 0) {
      const finalTime = formatRecordingTime(recordingSeconds);
      const now = new Date();
      const newRec: RecordedAudio = {
        id: `rec_${Date.now()}`,
        name: `강의 녹음 (${now.getMonth() + 1}/${now.getDate()} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')})`,
        duration: finalTime,
        timestamp: now.toISOString(),
        size: `${(Math.max(1, recordingSeconds) * 0.12).toFixed(1)} MB`
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

  const toggleAspectRatio = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setAspectRatio((prev) => {
      const modes: ('4:3' | '16:9' | '1:1')[] = ['4:3', '16:9', '1:1'];
      const next = modes[(modes.indexOf(prev) + 1) % modes.length];
      showToast(`화면 비율: ${next}`);
      return next;
    });
  }, [showToast]);

  const toggleFlashMode = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    setFlashMode((prev) => {
      const modes: FlashMode[] = ['off', 'on', 'auto'];
      const next = modes[(modes.indexOf(prev) + 1) % modes.length];
      const flashLabel = next === 'on' ? '켜짐' : next === 'auto' ? '자동' : '꺼짐';
      showToast(`플래시: ${flashLabel}`);
      return next;
    });
  }, [showToast]);

  const toggleCameraFacing = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    setCameraFacing((prev) => {
      const next = prev === 'back' ? 'front' : 'back';
      showToast(next === 'front' ? '전면 카메라로 전환' : '후면 카메라로 전환');
      return next;
    });
  }, [showToast]);

  // Sync LocalStorage Photos with Error Handling
  useEffect(() => {
    try {
      localStorage.setItem('lecture_snap_photos', JSON.stringify(photos));
    } catch (e) {
      console.error('Failed to save photos to localStorage:', e);
      if (e instanceof DOMException && e.name === 'QuotaExceededError') {
        alert('기기 저장 공간이 부족하여 사진을 저장할 수 없습니다. 오래된 항목을 삭제해주세요.');
      }
    }
  }, [photos]);

  const handleFolderButtonClick = () => {
    setIsFolderExplorerOpen(true);
  };

  const toggleSelectAllQueue = () => {
    if (selectedQueueItems.length === 2 && selectedPhotoIds.length === photos.length) {
      setSelectedQueueItems([]);
      setSelectedPhotoIds([]);
    } else {
      setSelectedQueueItems(['yt_1', 'insta_1']);
      setSelectedPhotoIds(photos.map((p) => p.id));
    }
  };

  const togglePhotoSelect = (id: string) => {
    setSelectedPhotoIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const toggleQueueItem = (id: string) => {
    setSelectedQueueItems((prev) =>
        prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const handleDeletePhoto = (id: string) => {
    setPhotos((prev) => prev.filter((p) => p.id !== id));
    setSelectedPhotoIds((prev) => prev.filter((i) => i !== id));
    showToast('사진이 삭제되었습니다');
  };

  const handleSynthesize = () => {
    const totalSelected = selectedPhotoIds.length + selectedQueueItems.length;
    if (totalSelected === 0) {
      showToast('체계화할 수집 미디어를 선택해주세요');
      return;
    }
    showToast(`${totalSelected}개의 수집 미디어가 지식 문서로 정리되었습니다!`);
  };

  // Capture Snapshot Handler — grabs a real frame from the camera stream
  const handleTakeSnapshot = () => {
    if (isCapturing) return;
    setIsCapturing(true);

    playShutterSound();
    setShutterFlash(true);
    setTimeout(() => setShutterFlash(false), 150);

    const canvas = document.createElement('canvas');
    const video = videoRef.current;
    let dataUrl = '';

    if (video && cameraStatus === 'live' && video.readyState >= 2) {
      // Capture from the live camera feed
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        if (cameraFacing === 'front') {
          ctx.translate(canvas.width, 0);
          ctx.scale(-1, 1);
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        dataUrl = canvas.toDataURL('image/jpeg', 0.92);
      }
    } else {
      // Fallback: black canvas when camera is unavailable
      canvas.width = 1080;
      canvas.height = 1440;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        dataUrl = canvas.toDataURL('image/jpeg', 0.92);
      }
    }

    if (dataUrl) {
      const newPhoto: CapturedPhoto = {
        id: `photo_${Date.now()}`,
        dataUrl,
        timestamp: new Date(),
        mode: 'PPT/판서',
        width: canvas.width,
        height: canvas.height,
      };
      setPhotos((prev) => [newPhoto, ...prev]);
      setSelectedPhotoIds((prev) => [...prev, newPhoto.id]);
    }

    setIsCapturing(false);
    showToast('강의 사진이 촬영되어 저장되었습니다');
  };

  const totalSelectedCount = selectedPhotoIds.length + selectedQueueItems.length;

  // Tap focus state for camera viewport
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number } | null>(null);

  const handleViewportTap = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isRecording) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setFocusPoint({ x, y });
    setTimeout(() => setFocusPoint(null), 1200);
  };

  return (
    <div className="relative w-full h-full bg-black text-white flex flex-col justify-between overflow-hidden select-none font-sans">
      
      {/* Shutter Flash Animation */}
      <AnimatePresence>
        {shutterFlash && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.9 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 bg-white z-50 pointer-events-none"
          />
        )}
      </AnimatePresence>

      {/* 2. Main Center Screen Viewport: Camera OR Audio Frequency Visualizer */}
      <div
        onClick={handleViewportTap}
        className="relative flex-1 bg-black overflow-hidden flex items-center justify-center select-none my-2"
      >
        {isAudioMode ? (
          /* Audio Waveform / Frequency Spectrum Visualizer Mode (Minimal & Clean Aesthetic) */
          <div className="relative w-full h-full bg-neutral-950 flex flex-col items-center justify-between py-6 px-6 select-none overflow-hidden">
            
            {/* Top-Left Return to Camera Button */}
            <div className="absolute top-4 left-4 z-40 flex items-center gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (isRecording) {
                    handleStopRecording(e);
                  }
                  setIsAudioMode(false);
                }}
                className="bg-neutral-900/80 backdrop-blur-md border border-white/20 hover:border-white/40 text-neutral-300 hover:text-white w-11 h-11 rounded-full flex items-center justify-center active:scale-95 transition-all shadow-lg"
                title="카메라 모드로 돌아가기"
              >
                <Camera className="w-5 h-5" />
              </button>
            </div>

            {/* Central Minimal Visualizer */}
            <div className="relative flex flex-col items-center justify-center my-auto w-full max-w-xs">
              
              {/* Minimal Mic Badge */}
              <div className="w-16 h-16 rounded-full bg-neutral-900 border border-white/10 flex items-center justify-center text-neutral-300 mb-6 shadow-inner">
                <Mic className="w-7 h-7" style={{ color: isRecording ? (!isPaused ? '#D30000' : accentColor) : '#737373' }} />
              </div>

              {/* Clean Monochromatic Waveform Bars */}
              <div className="flex items-center justify-center gap-1.5 h-14 w-full px-4">
                {[30, 65, 25, 85, 45, 95, 70, 40, 80, 55, 90, 75, 60, 80, 30, 65, 45, 85, 25, 55].map((baseH, idx) => {
                  const h = !isRecording ? 10 : isPaused ? 12 : baseH;
                  return (
                    <div
                      key={idx}
                      style={{
                        height: `${h}%`,
                        transition: 'height 0.15s ease-in-out',
                      }}
                      className={`w-1 rounded-full ${
                        !isRecording
                          ? 'bg-neutral-850'
                          : isPaused
                          ? 'bg-neutral-800'
                          : idx % 3 === 0
                          ? 'bg-[#D30000]'
                          : 'bg-neutral-300'
                      }`}
                    />
                  );
                })}
              </div>

              {/* Digital Timer with Clean iOS Typography */}
              <div className="mt-6 font-mono text-4xl font-bold tracking-widest text-white">
                {formatRecordingTime(recordingSeconds)}
              </div>
            </div>

            {/* Bottom Minimal Info */}
            <div className="text-[10px] text-neutral-500 flex items-center gap-1.5 font-mono">
              <Activity className="w-3 h-3 text-neutral-400" />
              <span>
                {isRecording
                  ? isPaused
                    ? '녹음 일시정지됨'
                    : '실시간 오디오 수집 중'
                  : '음성 녹음 대기 중 (저장 완료)'}
              </span>
            </div>
          </div>
        ) : (
          /* Normal Camera Viewport Mode */
          <>
            {/* Live Camera Feed */}
            {cameraStatus === 'live' && (
              <video
                ref={setVideoRef}
                autoPlay
                playsInline
                muted
                className={`absolute inset-0 w-full h-full object-cover ${
                  cameraFacing === 'front' ? 'scale-x-[-1]' : ''
                }`}
                style={{ zIndex: 1 }}
              />
            )}
            {/* Camera Permission Denied Banner */}
            {cameraStatus === 'denied' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10 pointer-events-none">
                <div className="bg-neutral-900/90 backdrop-blur-md border border-white/10 rounded-2xl px-6 py-4 flex flex-col items-center gap-2 text-center max-w-[220px]">
                  <Camera className="w-8 h-8 text-neutral-400" />
                  <p className="text-sm text-neutral-300 leading-snug">카메라 접근 권한이 필요합니다</p>
                  <p className="text-[11px] text-neutral-500">브라우저 설정에서 카메라 권한을 허용해 주세요</p>
                </div>
              </div>
            )}
            {/* Top-Left Audio Recording Button */}
            <div className="absolute top-4 left-4 z-40 flex items-center gap-2">
              <button
                onClick={handleStartRecording}
                className="bg-neutral-900/80 backdrop-blur-md border border-white/20 hover:border-white/40 text-white w-11 h-11 rounded-full flex items-center justify-center active:scale-95 transition-all shadow-lg"
                title="음성 녹음 시작"
              >
                <Mic className="w-5 h-5 text-[#D30000]" />
              </button>
            </div>

            {/* Top-Right Camera Controls */}
            <div className="absolute top-4 right-4 z-40 flex items-center gap-2.5">
              <button
                onClick={toggleAspectRatio}
                className="bg-neutral-900/80 backdrop-blur-md border border-white/20 hover:border-white/40 text-white text-xs font-bold px-3.5 h-11 rounded-full flex items-center justify-center active:scale-90 transition-all shadow-lg"
                title="카메라 비율"
              >
                <span>{aspectRatio}</span>
              </button>

              {/* Circular Button with 3 Horizontal Dots */}
              <div className="relative">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsCameraMenuOpen((prev) => !prev);
                  }}
                  className={`w-11 h-11 rounded-full bg-neutral-900/80 backdrop-blur-md border ${
                    isCameraMenuOpen ? 'border-white bg-neutral-800' : 'border-white/20 hover:border-white/40'
                  } text-white flex items-center justify-center active:scale-90 transition-all shadow-lg`}
                  title="카메라 설정 (후래쉬 / 카메라 전환)"
                >
                  <MoreHorizontal className="w-5.5 h-5.5 text-white" />
                </button>

                {/* Vertical Dropdown Popup Menu extending from the 3-dot button */}
                <AnimatePresence>
                  {isCameraMenuOpen && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.85, y: -6 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.85, y: -6 }}
                      transition={{ duration: 0.15 }}
                      onClick={(e) => e.stopPropagation()}
                      className="absolute left-1/2 -translate-x-1/2 top-full mt-2 z-50 flex flex-col items-center gap-2.5 select-none"
                    >
                      {/* Flash Circular Button */}
                      <button
                        onClick={() => {
                          toggleFlashMode();
                        }}
                        className="w-10.5 h-10.5 rounded-full bg-neutral-900/90 backdrop-blur-md hover:bg-neutral-800 active:scale-90 border border-white/25 flex items-center justify-center transition-all shadow-lg relative"
                        title={`후래쉬: ${flashMode.toUpperCase()}`}
                      >
                        {flashMode === 'on' ? (
                          <Zap className="w-5 h-5 fill-current text-yellow-400" />
                        ) : flashMode === 'auto' ? (
                          <div className="relative flex items-center justify-center">
                            <Zap className="w-5 h-5 text-yellow-400" />
                            <span className="absolute -bottom-1 -right-1 text-[8px] font-bold text-yellow-400">A</span>
                          </div>
                        ) : (
                          <ZapOff className="w-5 h-5 text-neutral-400" />
                        )}
                      </button>

                      {/* Camera Facing Flip Circular Button */}
                      <button
                        onClick={() => {
                          toggleCameraFacing();
                        }}
                        className="w-10.5 h-10.5 rounded-full bg-neutral-900/90 backdrop-blur-md hover:bg-neutral-800 active:scale-90 border border-white/25 flex items-center justify-center transition-all shadow-lg"
                        title={`카메라 전환: ${cameraFacing === 'front' ? '전면' : '후면'}`}
                      >
                        <RefreshCw className={`w-5 h-5 text-white transition-transform duration-300 ${cameraFacing === 'front' ? 'rotate-180' : ''}`} />
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>


            {/* Focus Box on Tap */}
            <AnimatePresence>
              {focusPoint && (
                <motion.div
                  initial={{ scale: 1.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  style={{
                    left: focusPoint.x - 24,
                    top: focusPoint.y - 24,
                    borderColor: accentColor,
                    boxShadow: `0 0 12px ${accentColor}80`
                  }}
                  className="absolute w-12 h-12 border-2 rounded-md pointer-events-none z-30"
                >
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1 w-1.5 h-0.5" style={{ backgroundColor: accentColor }} />
                  <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1 w-1.5 h-0.5" style={{ backgroundColor: accentColor }} />
                </motion.div>
              )}
            </AnimatePresence>



            {/* Camera Status Indicator Dot */}
            <div
              className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/50 backdrop-blur-md border border-white/10 text-[11px] font-medium shadow-md"
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  cameraStatus === 'live'
                    ? 'bg-green-400 animate-pulse'
                    : cameraStatus === 'loading'
                    ? 'bg-yellow-400 animate-pulse'
                    : 'bg-red-500'
                }`}
              />
              <span className="text-neutral-300">
                {cameraStatus === 'live'
                  ? '카메라 연결됨'
                  : cameraStatus === 'loading'
                  ? '카메라 연결 중...'
                  : '카메라 오프라인'}
              </span>
            </div>

            {/* Bottom Mode Pill */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 bg-neutral-900/80 backdrop-blur-md px-3 py-1 rounded-full border border-white/15 text-[11px] font-medium flex items-center gap-1.5 shadow-md" style={{ color: accentColor }}>
              <Sparkles className="w-3 h-3" style={{ color: accentColor }} />
              <span>PPT / 판서 자동 보정 모드</span>
            </div>
          </>
        )}
      </div>

      {/* 3. Floating Bottom Navigation Bar Toolbar */}
      <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-30">
        {isAudioMode ? (
          isRecording ? (
            /* Recording Active Mode Toolbar (4 Buttons) */
            <div className="bg-white/95 backdrop-blur-xl border border-neutral-200/90 shadow-xl rounded-full px-5 py-2 flex items-center justify-between gap-5">
              
              {/* Button 1 (Far Left): Recent Recordings Button */}
              <button
                onClick={() => setIsRecentRecordingsModalOpen(true)}
                className="w-12 h-12 rounded-full bg-neutral-100 border-2 border-neutral-200 ring-2 ring-neutral-200/60 flex items-center justify-center text-[#333333] hover:text-black active:scale-90 transition-all shadow-md relative"
                title="최근 녹음 파일"
              >
                <Volume2 className="w-5 h-5 text-[#333333] stroke-[2]" />
                {recordings.length > 0 && (
                  <span className="absolute -top-1 -right-1 bg-black text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center border border-white">
                    {recordings.length}
                  </span>
                )}
              </button>

              {/* Button 2: Pause / Resume Toggle Button */}
              <button
                onClick={handleTogglePauseRecording}
                className="w-12 h-12 rounded-full bg-white text-[#333333] flex items-center justify-center active:scale-90 transition-all border-2 border-neutral-200 ring-2 ring-neutral-200/60 hover:bg-neutral-100 shadow-md"
                title={isPaused ? '녹음 재개' : '녹음 일시정지'}
              >
                {isPaused ? (
                  <Play className="w-5 h-5 text-[#333333] fill-transparent stroke-[2] ml-0.5" />
                ) : (
                  <Pause className="w-5 h-5 text-[#333333] fill-transparent stroke-[2]" />
                )}
              </button>

              {/* Button 3: Complete / Stop Recording Button */}
              <button
                onClick={handleStopRecording}
                className="w-12 h-12 rounded-full bg-white text-[#333333] flex items-center justify-center shadow-md active:scale-90 transition-all border-2 border-neutral-200 ring-2 ring-neutral-200/60 hover:bg-neutral-100"
                title="녹음 완전 정지 및 저장"
              >
                <Square className="w-5 h-5 text-[#333333] fill-transparent stroke-[2]" />
              </button>

              {/* Button 4 (Far Right): Folder Explorer Button */}
              <button
                onClick={handleFolderButtonClick}
                className="w-12 h-12 rounded-full bg-neutral-100 border-2 border-neutral-200 ring-2 ring-neutral-200/60 flex items-center justify-center text-[#333333] hover:text-black active:scale-90 transition-all shadow-md"
                title="폴더 탐색기"
              >
                <Folder className="w-5 h-5 text-[#333333] stroke-[2]" />
              </button>

            </div>
          ) : (
            /* Audio Mode Idle / Stopped Toolbar */
            <div className="bg-white/95 backdrop-blur-xl border border-neutral-200/90 shadow-xl rounded-full px-6 py-2 flex items-center justify-between gap-6">
              {/* Left: Recent Recordings Button */}
              <button
                onClick={() => setIsRecentRecordingsModalOpen(true)}
                className="w-12 h-12 rounded-full bg-neutral-100 border-2 border-neutral-200 ring-2 ring-neutral-200/60 flex items-center justify-center text-[#333333] hover:text-black active:scale-90 transition-all shadow-lg relative"
                title="최근 녹음 파일"
              >
                <Volume2 className="w-5 h-5 text-[#333333] stroke-[2]" />
                {recordings.length > 0 && (
                  <span className="absolute -top-1 -right-1 bg-black text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center border border-white">
                    {recordings.length}
                  </span>
                )}
              </button>

              {/* Center: Record Start Button */}
              <button
                onClick={handleStartRecording}
                className="w-12 h-12 rounded-full bg-white flex items-center justify-center shadow-lg active:scale-90 transition-all border-2 border-neutral-200 ring-2 ring-neutral-200/60 p-0"
                title="새 녹음 시작"
              >
                <div className="w-8.5 h-8.5 rounded-full border-[2.5px] border-[#D30000] bg-white" />
              </button>

              {/* Right: Folder Explorer Button */}
              <button
                onClick={handleFolderButtonClick}
                className="w-12 h-12 rounded-full bg-neutral-100 border-2 border-neutral-200 ring-2 ring-neutral-200/60 flex items-center justify-center text-[#333333] hover:text-black active:scale-90 transition-all shadow-lg"
                title="폴더 탐색기"
              >
                <Folder className="w-5 h-5 text-[#333333] stroke-[2]" />
              </button>
            </div>
          )
        ) : (
          /* Camera Mode Toolbar (3 Buttons) */
          <div className="bg-white/95 backdrop-blur-xl border border-neutral-200/90 shadow-xl rounded-full px-6 py-2 flex items-center justify-between gap-6">
            
            {/* Left: Recent Photos Button */}
            <button
              onClick={() => setIsRecentModalOpen(true)}
              className="w-13 h-13 rounded-full bg-neutral-100 border-2 border-neutral-200 ring-2 ring-neutral-200/60 flex items-center justify-center text-[#333333] hover:text-black active:scale-90 transition-all shadow-lg relative"
              title="최근 찍은 사진"
            >
              <Image className="w-5.5 h-5.5 text-[#333333] stroke-[2]" />
              {photos.length > 0 && (
                <span className="absolute -top-1 -right-1 bg-black text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center border border-white">
                  {photos.length}
                </span>
              )}
            </button>

            {/* Center: Circular Camera Button */}
            <button
              onClick={handleTakeSnapshot}
              className="w-13 h-13 rounded-full bg-black text-white flex items-center justify-center shadow-lg active:scale-90 transition-all border-2 border-white ring-2 ring-neutral-200/60 p-0"
              title="카메라 촬영"
            >
              <div className="w-10.5 h-10.5 rounded-full border border-white/40 bg-white" />
            </button>

            {/* Right: Folder Button */}
            <button
              onClick={handleFolderButtonClick}
              className="w-13 h-13 rounded-full bg-neutral-100 border-2 border-neutral-200 ring-2 ring-neutral-200/60 flex items-center justify-center text-[#333333] hover:text-black active:scale-90 transition-all shadow-lg"
              title="폴더 탐색기"
            >
              <Folder className="w-5.5 h-5.5 text-[#333333] stroke-[2]" />
            </button>

          </div>
        )}
      </div>



      {/* Recent Photos View Modal */}
      <RecentPhotosModal
        isOpen={isRecentModalOpen}
        onClose={() => setIsRecentModalOpen(false)}
        photos={photos}
        onDeletePhoto={handleDeletePhoto}
      />

      {/* Recent Audio Recordings Modal */}
      <RecentRecordingsModal
        isOpen={isRecentRecordingsModalOpen}
        onClose={() => setIsRecentRecordingsModalOpen(false)}
        recordings={recordings}
        onDeleteRecording={handleDeleteRecording}
      />

      {/* Folder Explorer Modal */}
      <FolderExplorerModal
        isOpen={isFolderExplorerOpen}
        onClose={() => setIsFolderExplorerOpen(false)}
        currentDocument={currentDocument}
        onSelectDocument={(docName) => setCurrentDocument(docName)}
        showToast={showToast}
        photos={photos}
        recordings={recordings}
      />
    </div>
  );
};

