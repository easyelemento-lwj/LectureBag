import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  Trash2,
  Mic,
  Play,
  Pause,
  ChevronLeft,
  Search,
  RotateCcw,
  RotateCw,
  Download,
} from 'lucide-react';
import { RecordedAudio } from '../types';
import { useAccentColor } from '../context/AccentColorContext';

interface RecentRecordingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  recordings: RecordedAudio[];
  onDeleteRecording: (id: string) => void;
}

// Utility to parse duration string (e.g. "2:55", "1:01", "25:55") to total seconds
const parseDuration = (durationStr?: string): number => {
  if (!durationStr) return 120;
  const parts = durationStr.split(':').map((p) => parseInt(p, 10));
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  const parsed = parseInt(durationStr, 10);
  return isNaN(parsed) ? 120 : parsed;
};

// Utility to format seconds to "M:SS"
const formatTime = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
};

export const RecentRecordingsModal: React.FC<RecentRecordingsModalProps> = ({
  isOpen,
  onClose,
  recordings,
  onDeleteRecording,
}) => {
  const { accentColor } = useAccentColor();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTimeMap, setCurrentTimeMap] = useState<Record<string, number>>({});
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(false);
  const [isSelectMode, setIsSelectMode] = useState<boolean>(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Timer effect to advance current time smoothly when playing
  useEffect(() => {
    if (!isPlaying || !expandedId) return;

    let lastTime = Date.now();
    const interval = setInterval(() => {
      const now = Date.now();
      const delta = (now - lastTime) / 1000;
      lastTime = now;

      setCurrentTimeMap((prev) => {
        const activeRec = recordings.find((r) => r.id === expandedId);
        const maxSec = parseDuration(activeRec?.duration);
        const current = prev[expandedId] || 0;

        if (current >= maxSec) {
          setIsPlaying(false);
          return { ...prev, [expandedId]: 0 };
        }
        return { ...prev, [expandedId]: Math.min(maxSec, current + delta) };
      });
    }, 50);

    return () => clearInterval(interval);
  }, [isPlaying, expandedId, recordings]);

  if (!isOpen) return null;

  const handleCardClick = (id: string) => {
    if (isSelectMode) {
      toggleSelectItem(id);
    } else {
      if (expandedId === id) {
        setExpandedId(null);
        setIsPlaying(false);
      } else {
        setExpandedId(id);
        setIsPlaying(false);
      }
    }
  };

  const togglePlayPause = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setIsPlaying((prev) => !prev);
  };

  const handleSeek = (id: string, newTime: number, e?: React.ChangeEvent<HTMLInputElement>) => {
    e?.stopPropagation();
    setCurrentTimeMap((prev) => ({ ...prev, [id]: newTime }));
  };

  const handleSkip = (id: string, seconds: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const activeRec = recordings.find((r) => r.id === id);
    const maxSec = parseDuration(activeRec?.duration);
    setCurrentTimeMap((prev) => {
      const current = prev[id] || 0;
      const updated = Math.max(0, Math.min(maxSec, current + seconds));
      return { ...prev, [id]: updated };
    });
  };

  const toggleSelectItem = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter((item) => item !== id));
    } else {
      setSelectedIds([...selectedIds, id]);
    }
  };

  const filteredRecordings = recordings.filter((rec) =>
    rec.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const allFilteredIds = filteredRecordings.map((rec) => rec.id);
  const isAllSelected = allFilteredIds.length > 0 && allFilteredIds.every((id) => selectedIds.includes(id));

  const handleSelectButtonClick = () => {
    if (!isSelectMode) {
      setIsSelectMode(true);
      setSelectedIds([]);
    } else {
      if (isAllSelected) {
        setSelectedIds([]);
      } else {
        setSelectedIds(allFilteredIds);
      }
    }
  };

  const handleBackButtonClick = () => {
    if (isSelectMode) {
      setIsSelectMode(false);
      setSelectedIds([]);
    } else {
      onClose();
    }
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
        {/* iOS Top Navigation Header */}
        <div className="py-2.5 px-4 flex items-center justify-between">
          <button
            onClick={handleBackButtonClick}
            className="w-9 h-9 rounded-full bg-neutral-900 border border-white/10 flex items-center justify-center text-white hover:bg-neutral-800 active:scale-95 transition-all"
            title={isSelectMode ? '선택 해제' : '돌아가기'}
          >
            <ChevronLeft className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsSearchOpen(!isSearchOpen)}
              className="w-9 h-9 rounded-full flex items-center justify-center transition-all active:scale-95 border"
              style={
                isSearchOpen
                  ? { backgroundColor: accentColor, color: '#000000', borderColor: accentColor }
                  : { backgroundColor: '#171717', borderColor: 'rgba(255,255,255,0.1)', color: '#FFFFFF' }
              }
              title="검색"
            >
              <Search className="w-4 h-4" />
            </button>
            <button
              onClick={handleSelectButtonClick}
              className="px-3 py-1.5 rounded-full text-xs font-semibold transition-all active:scale-95 border"
              style={
                isSelectMode
                  ? { backgroundColor: accentColor, color: '#000000', borderColor: accentColor }
                  : { backgroundColor: '#171717', borderColor: 'rgba(255,255,255,0.1)', color: '#E5E5E5' }
              }
            >
              {isSelectMode ? (isAllSelected ? '모두 해제' : '모두 선택') : '선택'}
            </button>
          </div>
        </div>

        {/* Main Header & Prompt Bar Area */}
        <div className="px-5 pt-1 pb-2">
          <h1 className="text-2xl font-bold tracking-tight text-white mb-2.5">
            {isSelectMode ? `${selectedIds.length}개 선택됨` : '최근 녹음 항목'}
          </h1>

          {/* Search Bar */}
          {isSearchOpen && (
            <div className="relative mb-2">
              <input
                type="text"
                placeholder="녹음 항목 검색..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-neutral-900 border border-neutral-800 text-white text-xs rounded-xl pl-9 pr-8 py-2 focus:outline-none"
                style={{ borderColor: accentColor }}
                autoFocus
              />
              <Search className="w-4 h-4 text-neutral-500 absolute left-3 top-2.5" />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-2.5 text-neutral-400 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Recordings List */}
        <div
          className="flex-1 overflow-y-auto px-5 w-full max-w-2xl mx-auto divide-y divide-neutral-800/80 scrollbar-none"
          style={
            isSelectMode
              ? {
                  WebkitMaskImage: 'linear-gradient(to bottom, black 0%, black calc(100% - 40px), transparent 100%)',
                  maskImage: 'linear-gradient(to bottom, black 0%, black calc(100% - 40px), transparent 100%)',
                }
              : undefined
          }
        >
          {filteredRecordings.length === 0 ? (
            <div className="my-auto text-center text-neutral-500 py-16">
              <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-neutral-900 border border-white/10 flex items-center justify-center text-neutral-400">
                <Mic className="w-6 h-6 stroke-[1.5]" />
              </div>
              <p className="text-sm font-semibold text-neutral-300">저장된 녹음이 없습니다</p>
              <p className="text-xs mt-1 text-neutral-500">
                하단 녹음 버튼을 눌러 새로운 음성 메모를 시작하세요.
              </p>
            </div>
          ) : (
            filteredRecordings.map((rec) => {
              const isExpanded = expandedId === rec.id;
              const isCurrentPlaying = isExpanded && isPlaying;
              const isSelected = selectedIds.includes(rec.id);
              const formattedDate = new Date(rec.timestamp).toLocaleDateString('ko-KR', {
                year: 'numeric',
                month: 'numeric',
                day: 'numeric',
              });

              return (
                <div
                  key={rec.id}
                  onClick={() => handleCardClick(rec.id)}
                  className="py-3 px-1 cursor-pointer select-none transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {isSelectMode && (
                        <div
                          className="w-5 h-5 rounded-full border flex items-center justify-center transition-all"
                          style={
                            isSelected
                              ? { backgroundColor: accentColor, borderColor: accentColor, color: '#000000' }
                              : { borderColor: '#525252', backgroundColor: '#171717' }
                          }
                        >
                          {isSelected && <div className="w-2 h-2 rounded-full bg-black" />}
                        </div>
                      )}

                      <div>
                        <h3 className="text-sm font-bold text-white tracking-tight">
                          {rec.name}
                        </h3>
                        <div className="flex items-center text-xs text-neutral-400 mt-1 font-mono">
                          <span>{formattedDate}</span>
                        </div>
                      </div>
                    </div>

                    <div className="text-right">
                      <span className="text-xs font-mono text-neutral-400 font-medium">
                        {rec.duration || '0:00'}
                      </span>
                    </div>
                  </div>

                  {/* Expanded playback & scrubber controls if item is active/expanded */}
                  <AnimatePresence>
                    {isExpanded && !isSelectMode && (() => {
                      const totalSec = parseDuration(rec.duration);
                      const currentSec = currentTimeMap[rec.id] || 0;
                      const progressPct = Math.min(100, Math.max(0, (currentSec / totalSec) * 100));

                      return (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="mt-3 pt-3 border-t border-neutral-800/80 flex flex-col gap-2.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {/* Drag Scrubber Slider Bar */}
                          <div className="flex flex-col gap-1">
                            <div className="relative flex items-center group py-1">
                              {/* Custom track progress bar */}
                              <div className="absolute inset-x-0 h-1.5 my-auto bg-neutral-800 rounded-full overflow-hidden pointer-events-none">
                                <div
                                  className="h-full rounded-full"
                                  style={{ width: `${progressPct}%`, backgroundColor: accentColor }}
                                />
                              </div>
                              {/* Circular thumb handle indicator */}
                              <div
                                className="absolute w-3.5 h-3.5 bg-white border-2 rounded-full shadow-md pointer-events-none -translate-x-1/2 transition-transform group-hover:scale-125"
                                style={{ left: `${progressPct}%`, borderColor: accentColor }}
                              />
                              <input
                                type="range"
                                min={0}
                                max={totalSec}
                                step={0.1}
                                value={currentSec}
                                onChange={(e) => handleSeek(rec.id, Number(e.target.value), e)}
                                className="w-full h-4 opacity-0 z-10 cursor-pointer"
                                title="강의 녹음 위치 조절"
                              />
                            </div>

                            {/* Timestamp display */}
                            <div className="flex items-center justify-between text-[11px] font-mono text-neutral-400 px-0.5">
                              <span className="font-semibold" style={{ color: accentColor }}>
                                {formatTime(currentSec)}
                              </span>
                              <span>{rec.duration || formatTime(totalSec)}</span>
                            </div>
                          </div>

                          {/* Control buttons */}
                          <div className="flex items-center justify-between pt-1 px-1">
                            {/* Skip 10s Backward */}
                            <button
                              onClick={(e) => handleSkip(rec.id, -10, e)}
                              className="flex items-center gap-1 text-xs text-neutral-400 hover:text-white px-2 py-1 rounded-lg hover:bg-neutral-900 active:scale-95 transition-all"
                              title="10초 뒤로"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              <span className="text-[10px] font-mono">-10초</span>
                            </button>

                            {/* Center Play/Pause toggle */}
                            <button
                              onClick={togglePlayPause}
                              className="w-9 h-9 rounded-full text-black flex items-center justify-center active:scale-90 transition-transform shadow-md"
                              style={{ backgroundColor: accentColor }}
                              title={isCurrentPlaying ? '일시정지' : '재생'}
                            >
                              {isCurrentPlaying ? (
                                <Pause className="w-4 h-4 fill-current" />
                              ) : (
                                <Play className="w-4 h-4 fill-current ml-0.5" />
                              )}
                            </button>

                            {/* Skip 10s Forward */}
                            <button
                              onClick={(e) => handleSkip(rec.id, 10, e)}
                              className="flex items-center gap-1 text-xs text-neutral-400 hover:text-white px-2 py-1 rounded-lg hover:bg-neutral-900 active:scale-95 transition-all"
                              title="10초 앞으로"
                            >
                              <span className="text-[10px] font-mono">+10초</span>
                              <RotateCw className="w-3.5 h-3.5" />
                            </button>

                            {/* Delete button */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (expandedId === rec.id) {
                                  setExpandedId(null);
                                  setIsPlaying(false);
                                }
                                onDeleteRecording(rec.id);
                              }}
                              className="w-8 h-8 rounded-full bg-neutral-900 border border-neutral-800 text-neutral-400 hover:text-red-400 flex items-center justify-center active:scale-90 transition-all"
                              title="녹음 삭제"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </motion.div>
                      );
                    })()}
                  </AnimatePresence>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        {isSelectMode && (
          <div className="py-2 px-8 bg-black border-t border-transparent flex items-center justify-between">
            <button
              disabled={selectedIds.length === 0}
              onClick={() => {
                selectedIds.forEach((id) => {
                  const rec = recordings.find((r) => r.id === id);
                  if (rec) {
                    const link = document.createElement('a');
                    link.href = (rec as any).dataUrl || 'data:audio/mp3;base64,';
                    link.download = rec.name.endsWith('.m4a') || rec.name.endsWith('.mp3') ? rec.name : `${rec.name}.m4a`;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                  }
                });
              }}
              className="w-9 h-9 -translate-y-2 rounded-full bg-neutral-900 border border-neutral-700/60 text-neutral-200 hover:text-white flex items-center justify-center active:scale-90 transition-all shadow-md disabled:opacity-30 disabled:pointer-events-none"
              title="선택한 항목 다운로드"
            >
              <Download className="w-[18px] h-[18px]" />
            </button>

            <button
              disabled={selectedIds.length === 0}
              onClick={() => {
                selectedIds.forEach((id) => onDeleteRecording(id));
                setSelectedIds([]);
                setIsSelectMode(false);
              }}
              className="w-9 h-9 -translate-y-2 rounded-full bg-red-950/80 border border-red-800/60 text-red-400 flex items-center justify-center active:scale-90 transition-all shadow-md disabled:opacity-30 disabled:pointer-events-none"
              title="선택한 항목 삭제"
            >
              <Trash2 className="w-[18px] h-[18px]" />
            </button>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
};

