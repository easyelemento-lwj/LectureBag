import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  Trash2,
  Download,
  Calendar,
  Image as ImageIcon,
  Camera,
  SlidersHorizontal,
  Info,
  RotateCw,
  RefreshCw,
} from 'lucide-react';
import { CapturedPhoto } from '../types';
import { useAccentColor } from '../context/AccentColorContext';
import { formatFileName } from '../utils/dateFolders';

interface RecentPhotosModalProps {
  isOpen: boolean;
  onClose: () => void;
  photos: CapturedPhoto[];
  onDeletePhoto: (id: string) => void;
}

export const RecentPhotosModal: React.FC<RecentPhotosModalProps> = ({
  isOpen,
  onClose,
  photos,
  onDeletePhoto,
}) => {
  const { accentColor } = useAccentColor();
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [showAdjust, setShowAdjust] = useState<boolean>(false);
  const [showInfo, setShowInfo] = useState<boolean>(false);

  // Photo adjustment states
  const [brightness, setBrightness] = useState<number>(100);
  const [contrast, setContrast] = useState<number>(100);
  const [rotation, setRotation] = useState<number>(0);

  if (!isOpen) return null;

  const currentPhoto = photos[selectedIndex] || photos[0];

  const handleDownload = (photo: CapturedPhoto) => {
    const link = document.createElement('a');
    link.href = photo.dataUrl;
    const fileName = formatFileName(photo.timestamp);
    link.download = `${fileName}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDelete = (id: string) => {
    onDeletePhoto(id);
    if (photos.length <= 1) {
      onClose();
    } else {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
    }
  };

  const handleResetAdjustments = () => {
    setBrightness(100);
    setContrast(100);
    setRotation(0);
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 30 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        className="absolute inset-0 z-50 bg-black text-white flex flex-col justify-between overflow-hidden font-sans select-none"
      >
        {/* iOS Top Bar */}
        <div className="py-3 px-4 bg-transparent flex items-center justify-between">
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-neutral-800/80 border border-white/10 flex items-center justify-center text-neutral-300 hover:text-white active:scale-95 transition-all"
            title="카메라 모드로 돌아가기"
          >
            <Camera className="w-4 h-4" />
          </button>
          <div className="text-center">
            <h2 className="text-xs font-bold tracking-tight text-neutral-200">최근 촬영한 사진</h2>
            <p className="text-[10px] text-neutral-400">
              {photos.length > 0 ? `${selectedIndex + 1} / ${photos.length}` : '사진 없음'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-neutral-800/80 border border-white/10 flex items-center justify-center text-neutral-300 hover:text-white active:scale-95"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content View */}
        <div className="flex-1 relative flex items-center justify-center px-4 py-2 overflow-hidden">
          {photos.length === 0 ? (
            <div className="text-center text-neutral-500 py-12">
              <ImageIcon className="w-14 h-14 mx-auto mb-3 stroke-[1.5] opacity-40" />
              <p className="text-sm font-semibold text-neutral-300">촬영된 강의 사진이 없습니다.</p>
              <p className="text-xs mt-1 text-neutral-500">하단 카메라 셔터 버튼을 눌러 사진을 찍어보세요.</p>
            </div>
          ) : (
            <div className="relative w-full h-full flex items-center justify-center">
              {/* Image preview with drag/swipe support */}
              <motion.div
                key={currentPhoto.id}
                drag={photos.length > 1 ? 'x' : false}
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={0.2}
                onDragEnd={(_, info) => {
                  const swipeThreshold = 40;
                  const velocityThreshold = 200;
                  if (info.offset.x < -swipeThreshold || info.velocity.x < -velocityThreshold) {
                    if (selectedIndex < photos.length - 1) {
                      setSelectedIndex((prev) => prev + 1);
                    }
                  } else if (info.offset.x > swipeThreshold || info.velocity.x > velocityThreshold) {
                    if (selectedIndex > 0) {
                      setSelectedIndex((prev) => prev - 1);
                    }
                  }
                }}
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.2 }}
                className="relative max-h-[50vh] md:max-h-[70vh] w-full max-w-sm md:max-w-3xl lg:max-w-5xl rounded-2xl overflow-hidden border border-white/10 bg-black shadow-2xl flex items-center justify-center cursor-grab active:cursor-grabbing touch-pan-y select-none"
              >
                <img
                  src={currentPhoto.dataUrl}
                  alt=""
                  draggable={false}
                  onError={(e) => {
                    (e.target as HTMLElement).style.display = 'none';
                  }}
                  style={{
                    filter: `brightness(${brightness}%) contrast(${contrast}%)`,
                    transform: `rotate(${rotation}deg)`,
                  }}
                  className="max-h-[50vh] md:max-h-[70vh] w-full object-contain bg-black pointer-events-none transition-all duration-150"
                />
              </motion.div>
            </div>
          )}
        </div>

        {/* Adjustment controls panel overlay if open */}
        <AnimatePresence>
          {showAdjust && currentPhoto && (
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 15 }}
              className="px-5 py-3 bg-neutral-900/95 border-t border-white/10 rounded-t-2xl max-w-xs md:max-w-md mx-auto w-full mb-1 flex flex-col gap-2.5 backdrop-blur-md"
            >
              <div className="flex items-center justify-between text-xs font-semibold text-neutral-300">
                <span>사진 조절</span>
                <button
                  onClick={handleResetAdjustments}
                  className="text-[11px] hover:underline flex items-center gap-1"
                  style={{ color: accentColor }}
                >
                  <RefreshCw className="w-3 h-3" /> 초기화
                </button>
              </div>

              {/* Brightness */}
              <div className="flex items-center gap-3 text-xs text-neutral-300">
                <span className="w-10 text-[11px]">밝기</span>
                <input
                  type="range"
                  min="50"
                  max="150"
                  value={brightness}
                  onChange={(e) => setBrightness(Number(e.target.value))}
                  className="flex-1 h-1 bg-neutral-700 rounded-lg cursor-pointer"
                  style={{ accentColor: accentColor }}
                />
                <span className="w-8 text-[10px] text-right text-neutral-400">{brightness}%</span>
              </div>

              {/* Contrast */}
              <div className="flex items-center gap-3 text-xs text-neutral-300">
                <span className="w-10 text-[11px]">대비</span>
                <input
                  type="range"
                  min="50"
                  max="150"
                  value={contrast}
                  onChange={(e) => setContrast(Number(e.target.value))}
                  className="flex-1 h-1 bg-neutral-700 rounded-lg cursor-pointer"
                  style={{ accentColor: accentColor }}
                />
                <span className="w-8 text-[10px] text-right text-neutral-400">{contrast}%</span>
              </div>

              {/* Rotate */}
              <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] text-neutral-300">회전</span>
                <button
                  onClick={() => setRotation((prev) => (prev + 90) % 360)}
                  className="px-2.5 py-1 rounded-lg bg-neutral-800 border border-white/10 text-[11px] text-neutral-200 flex items-center gap-1 hover:bg-neutral-700 active:scale-95"
                >
                  <RotateCw className="w-3 h-3" style={{ color: accentColor }} />
                  <span>{rotation}°</span>
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Photo Info panel overlay if open */}
        <AnimatePresence>
          {showInfo && currentPhoto && (
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 15 }}
              className="px-5 py-3 bg-neutral-900/95 border-t border-white/10 rounded-t-2xl max-w-xs md:max-w-md mx-auto w-full mb-1 flex flex-col gap-2 backdrop-blur-md text-xs text-neutral-300"
            >
              <div className="flex items-center justify-between font-semibold text-neutral-200 border-b border-white/10 pb-1.5">
                <span className="flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5" style={{ color: accentColor }} /> 사진 정보
                </span>
              </div>
              <div className="grid grid-cols-2 gap-y-1.5 text-[11px] pt-1">
                <span className="text-neutral-400">파일명:</span>
                <span className="text-right font-mono text-neutral-200">{formatFileName(currentPhoto.timestamp)}.jpg</span>
                <span className="text-neutral-400">촬영 일시:</span>
                <span className="text-right text-neutral-200">
                  {new Date(currentPhoto.timestamp).toLocaleDateString('ko-KR')} {new Date(currentPhoto.timestamp).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className="text-neutral-400">파일 형식:</span>
                <span className="text-right text-neutral-200">JPEG</span>
                <span className="text-neutral-400">해상도:</span>
                <span className="text-right text-neutral-200">{currentPhoto.width || 1080} × {currentPhoto.height || 1440}</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Thumbnail Strip & Consolidated 4-Button Toolbar */}
        {photos.length > 0 && (
          <div className="bg-transparent px-4 pb-6 pt-1 flex flex-col gap-3">
            {/* Horizontal thumbnail scroll */}
            {photos.length > 1 && (
              <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none max-w-xs md:max-w-md mx-auto">
                {photos.map((photo, idx) => (
                  <button
                    key={photo.id}
                    onClick={() => {
                      setSelectedIndex(idx);
                      handleResetAdjustments();
                    }}
                    className="relative flex-shrink-0 w-10 h-10 rounded-lg overflow-hidden border-2 transition-all"
                    style={
                      idx === selectedIndex
                        ? { borderColor: accentColor, transform: 'scale(1.05)' }
                        : { borderColor: 'transparent', opacity: 0.5 }
                    }
                  >
                    <img src={photo.dataUrl} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}

            {/* Integrated 4-Button Action Toolbar (Camera Style) */}
            <div className="bg-white/95 backdrop-blur-xl border border-neutral-200/90 shadow-xl rounded-full px-5 py-2.5 flex items-center justify-between max-w-[320px] md:max-w-[420px] mx-auto w-full">
              {/* Button 1: 조절 */}
              <button
                onClick={() => {
                  setShowAdjust(!showAdjust);
                  setShowInfo(false);
                }}
                className="flex items-center justify-center text-neutral-700 hover:text-black active:scale-90 transition-transform"
                title="사진 조절"
              >
                <div
                  className={`w-11 h-11 rounded-full border-2 ring-2 ring-neutral-200/60 flex items-center justify-center transition-all ${
                    showAdjust
                      ? 'bg-black text-white border-black ring-neutral-300/80'
                      : 'bg-neutral-100 border-neutral-200 text-neutral-700'
                  }`}
                >
                  <SlidersHorizontal className="w-5 h-5" />
                </div>
              </button>

              {/* Button 2: 정보 */}
              <button
                onClick={() => {
                  setShowInfo(!showInfo);
                  setShowAdjust(false);
                }}
                className="flex items-center justify-center text-neutral-700 hover:text-black active:scale-90 transition-transform"
                title="사진 정보"
              >
                <div
                  className={`w-11 h-11 rounded-full border-2 ring-2 ring-neutral-200/60 flex items-center justify-center transition-all ${
                    showInfo
                      ? 'bg-black text-white border-black ring-neutral-300/80'
                      : 'bg-neutral-100 border-neutral-200 text-neutral-700'
                  }`}
                >
                  <Info className="w-5 h-5" />
                </div>
              </button>

              {/* Button 3: 다운로드 */}
              <button
                onClick={() => handleDownload(currentPhoto)}
                className="flex items-center justify-center text-neutral-700 hover:text-black active:scale-90 transition-transform"
                title="다운로드"
              >
                <div className="w-11 h-11 rounded-full bg-neutral-100 border-2 border-neutral-200 ring-2 ring-neutral-200/60 flex items-center justify-center text-neutral-700">
                  <Download className="w-5 h-5" />
                </div>
              </button>

              {/* Button 4: 삭제 */}
              <button
                onClick={() => handleDelete(currentPhoto.id)}
                className="flex items-center justify-center text-red-600 hover:text-red-700 active:scale-90 transition-transform"
                title="삭제"
              >
                <div className="w-11 h-11 rounded-full bg-red-50 border-2 border-red-200/80 ring-2 ring-neutral-200/60 flex items-center justify-center text-red-600">
                  <Trash2 className="w-5 h-5" />
                </div>
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
};

