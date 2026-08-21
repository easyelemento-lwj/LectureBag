import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Zap,
  ZapOff,
  Grid as GridIcon,
  RotateCcw,
  Folder,
  Sliders,
  Camera as CameraIcon,
  Check,
  Sparkles,
  Info,
  MoreHorizontal,
  RefreshCw
} from 'lucide-react';
import { CapturedPhoto, FlashMode, CameraMode } from '../types';
import { playShutterSound } from '../utils/audio';
import { drawSimulatedLectureFrame } from '../utils/canvasSimulation';
import { RecentPhotosModal } from './RecentPhotosModal';

const CAMERA_MODES: CameraMode[] = ['PPT/판서', '강의노트', '교재', '문서'];

export const IosCamera: React.FC = () => {
  // State
  const [photos, setPhotos] = useState<CapturedPhoto[]>(() => {
    try {
      const saved = localStorage.getItem('lecture_snap_photos');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.error('Failed to load photos from local storage', e);
    }
    return [];
  });

  const [currentMode, setCurrentMode] = useState<CameraMode>('PPT/판서');
  const [flashMode, setFlashMode] = useState<FlashMode>('off');
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [isMenuOpen, setIsMenuOpen] = useState<boolean>(false);

  // Camera stream status
  const [hasRealCamera, setHasRealCamera] = useState<boolean | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState<boolean>(false);
  const [shutterFlash, setShutterFlash] = useState<boolean>(false);

  // UI Modals & Toasts
  const [isRecentModalOpen, setIsRecentModalOpen] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Focus Indicator State
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number } | null>(null);

  // Refs
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Save photos to localStorage whenever they update
  useEffect(() => {
    try {
      localStorage.setItem('lecture_snap_photos', JSON.stringify(photos));
    } catch (e) {
      console.error('Failed to persist photos', e);
    }
  }, [photos]);

  // Toast auto dismiss
  const showToast = useCallback((_msg: string) => {
    // Popup notifications disabled per user request
  }, []);

  // Camera initialization (Using simulated preview mode without requesting camera permission)
  useEffect(() => {
    setHasRealCamera(false);
  }, []);

  // Simulated Camera Animation Loop (runs when real camera stream is unavailable)
  useEffect(() => {
    if (hasRealCamera !== false) return;

    let time = 0;
    const renderSim = () => {
      time += 0.03;
      if (simCanvasRef.current) {
        const cvs = simCanvasRef.current;
        const ctx = cvs.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#000000';
          ctx.fillRect(0, 0, cvs.width, cvs.height);
        }
      }
      animFrameRef.current = requestAnimationFrame(renderSim);
    };

    renderSim();

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [hasRealCamera, currentMode]);

  // Capture Photo Handler
  const handleTakeSnapshot = async () => {
    if (isCapturing) return;
    setIsCapturing(true);

    // Audio and Visual Flash
    playShutterSound();
    setShutterFlash(true);
    setTimeout(() => setShutterFlash(false), 150);

    try {
      let dataUrl = '';
      const width = 1080;
      const height = 1440;

      if (canvasRef.current) {
        const canvas = canvasRef.current;
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (ctx) {
          // Plain black background
          ctx.fillStyle = '#000000';
          ctx.fillRect(0, 0, width, height);

          dataUrl = canvas.toDataURL('image/jpeg', 0.92);
        }
      }

      if (dataUrl) {
        const newPhoto: CapturedPhoto = {
          id: `photo_${Date.now()}`,
          dataUrl,
          timestamp: new Date(),
          mode: currentMode,
          width,
          height,
        };

        setPhotos((prev) => [newPhoto, ...prev]);
        showToast('사진이 저장되었습니다');
      }
    } catch (e) {
      console.error('Snapshot failed', e);
    } finally {
      setIsCapturing(false);
    }
  };

  // Viewport tap to focus
  const handleViewportTap = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setFocusPoint({ x, y });
    setTimeout(() => {
      setFocusPoint(null);
    }, 1200);
  };

  // Delete photo
  const handleDeletePhoto = (id: string) => {
    setPhotos((prev) => prev.filter((p) => p.id !== id));
    showToast('사진이 삭제되었습니다');
  };

  // Folder button click handler (per user requirement: "아직 폴더 버튼을 눌러서 나오는 것들은 구현하지 마")
  const handleFolderButtonClick = () => {
    showToast('폴더 관리 기능은 준비 중입니다');
  };

  const latestPhoto = photos[0];

  return (
    <div className="relative w-full h-screen max-w-md mx-auto bg-black text-white flex flex-col justify-between overflow-hidden select-none font-sans border-x border-neutral-900 shadow-2xl">
      {/* Hidden offscreen canvas for snapshot rendering */}
      <canvas ref={canvasRef} className="hidden" />

      {/* iOS Top Bar (Time, Battery, Flash, Grid, Camera Controls) */}
      <div className="relative z-20 py-3 px-5 bg-gradient-to-b from-black/90 via-black/40 to-transparent flex items-center justify-between">
        {/* Mode Title Header */}
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-neutral-900/80 border border-neutral-800 backdrop-blur-md">
          <span className="w-2 h-2 rounded-full bg-[#A3B18A] animate-pulse" />
          <span className="text-xs font-semibold tracking-wide text-neutral-200">강의 카메라</span>
        </div>

        {/* Grid & 3-Dot Options Menu controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowGrid((prev) => !prev)}
            className={`p-2 rounded-full transition-all active:scale-90 ${
              showGrid ? 'bg-white/20 text-white' : 'text-neutral-400 hover:text-white'
            }`}
            title="격자 표시"
          >
            <GridIcon className="w-5 h-5" />
          </button>

          {/* Circular Button with 3 Dots */}
          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsMenuOpen((prev) => !prev);
              }}
              className={`w-11 h-11 rounded-full bg-neutral-900/80 backdrop-blur-md border ${
                isMenuOpen ? 'border-white bg-neutral-800' : 'border-white/20 hover:border-white/40'
              } text-white flex items-center justify-center active:scale-90 transition-all shadow-lg`}
              title="카메라 설정 (후래쉬 / 카메라 전환)"
            >
              <MoreHorizontal className="w-5.5 h-5.5 text-white" />
            </button>

            {/* Vertical Circular Dropdown Menu extending from the 3-dot button */}
            <AnimatePresence>
              {isMenuOpen && (
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
                      const modes: FlashMode[] = ['off', 'on', 'auto'];
                      const next = modes[(modes.indexOf(flashMode) + 1) % modes.length];
                      setFlashMode(next);
                      showToast(`플래시: ${next.toUpperCase()}`);
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
                      setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'));
                      showToast(`카메라: ${facingMode === 'environment' ? '전면' : '후면'}`);
                    }}
                    className="w-10.5 h-10.5 rounded-full bg-neutral-900/90 backdrop-blur-md hover:bg-neutral-800 active:scale-90 border border-white/25 flex items-center justify-center transition-all shadow-lg"
                    title={`카메라 전환: ${facingMode === 'user' ? '전면' : '후면'}`}
                  >
                    <RefreshCw className={`w-5 h-5 text-white transition-transform duration-300 ${facingMode === 'user' ? 'rotate-180' : ''}`} />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Camera Viewport Screen (Black Screen) */}
      <div
        onClick={handleViewportTap}
        className="relative flex-1 bg-black overflow-hidden flex items-center justify-center cursor-crosshair group"
      >
        {/* Hidden Video & Canvas refs for state compatibility */}
        <video ref={videoRef} className="hidden" />
        <canvas ref={simCanvasRef} className="hidden" />

        {/* Camera HUD Grid Overlay */}
        {showGrid && (
          <div className="absolute inset-0 pointer-events-none border border-white/5 grid grid-cols-3 grid-rows-3">
            <div className="border-r border-b border-white/10" />
            <div className="border-r border-b border-white/10" />
            <div className="border-b border-white/10" />
            <div className="border-r border-b border-white/10" />
            <div className="border-r border-b border-white/10" />
            <div className="border-b border-white/10" />
            <div className="border-r border-white/10" />
            <div className="border-r border-white/10" />
            <div />
          </div>
        )}

        {/* Shutter White Flash Effect */}
        <AnimatePresence>
          {shutterFlash && (
            <motion.div
              initial={{ opacity: 0.95 }}
              animate={{ opacity: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="absolute inset-0 bg-white z-40 pointer-events-none"
            />
          )}
        </AnimatePresence>

        {/* Tap Focus Ring Indicator */}
        {focusPoint && (
          <motion.div
            initial={{ scale: 1.4, opacity: 1 }}
            animate={{ scale: 1, opacity: 0.8 }}
            exit={{ opacity: 0 }}
            className="absolute z-30 pointer-events-none w-16 h-16 border-2 border-[#A3B18A] rounded-lg flex items-center justify-center shadow-lg"
            style={{
              left: `${focusPoint.x - 32}px`,
              top: `${focusPoint.y - 32}px`,
            }}
          >
            <div className="w-1.5 h-1.5 bg-[#A3B18A] rounded-full" />
          </motion.div>
        )}

        {/* Zoom Pills Floating Overlay */}
        <div className="absolute bottom-4 z-20 flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-xs font-semibold">
          {[0.5, 1, 2].map((lvl) => (
            <button
              key={lvl}
              onClick={(e) => {
                e.stopPropagation();
                setZoomLevel(lvl);
              }}
              className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${
                zoomLevel === lvl ? 'bg-[#A3B18A] text-black font-bold scale-105' : 'text-neutral-300 hover:text-white'
              }`}
            >
              {lvl}x
            </button>
          ))}
        </div>
      </div>



      {/* Main iOS Bottom Control Bar */}
      <div className="relative z-20 bg-black pt-3 pb-10 px-8 flex items-center justify-between">
        {/* Left Button: Recent Photo Thumbnail Preview Button */}
        <button
          onClick={() => setIsRecentModalOpen(true)}
          className="relative w-20 h-20 rounded-full bg-neutral-900 border-4 border-neutral-700/60 flex items-center justify-center overflow-hidden transition-transform active:scale-95 group shadow-2xl"
          title="최근 사진 보기"
        >
          {latestPhoto ? (
            <div className="relative w-full h-full">
              <img src={latestPhoto.dataUrl} alt="Recent photo" className="w-full h-full object-cover" />
              {photos.length > 0 && (
                <span className="absolute -top-1 -right-1 bg-[#588157] text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center border-2 border-black">
                  {photos.length}
                </span>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center text-neutral-500 group-hover:text-neutral-300">
              <CameraIcon className="w-7 h-7 stroke-[1.5]" />
              <span className="text-[10px] mt-0.5">사진</span>
            </div>
          )}
        </button>

        {/* Center Button: Circular iOS Camera Shutter Button */}
        <button
          onClick={handleTakeSnapshot}
          disabled={isCapturing}
          className="relative w-20 h-20 rounded-full border-4 border-white flex items-center justify-center transition-transform active:scale-90 p-1 group shadow-2xl focus:outline-none"
          title="사진 촬영"
        >
          <div
            className={`w-full h-full rounded-full bg-white transition-all duration-150 ${
              isCapturing ? 'scale-75 bg-neutral-300' : 'group-hover:scale-95'
            }`}
          />
        </button>

        {/* Right Button: Folder Button */}
        <button
          onClick={handleFolderButtonClick}
          className="w-20 h-20 rounded-full bg-neutral-900 border-4 border-neutral-700/60 flex flex-col items-center justify-center text-[#A3B18A] hover:text-white transition-transform active:scale-95 shadow-2xl"
          title="폴더"
        >
          <Folder className="w-7 h-7 stroke-[1.8]" />
          <span className="text-[10px] mt-0.5 text-neutral-400">폴더</span>
        </button>
      </div>



      {/* Recent Photos View Modal */}
      <RecentPhotosModal
        isOpen={isRecentModalOpen}
        onClose={() => setIsRecentModalOpen(false)}
        photos={photos}
        onDeletePhoto={handleDeletePhoto}
      />
    </div>
  );
};
