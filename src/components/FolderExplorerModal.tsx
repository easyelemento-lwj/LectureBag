import React, { useState, useMemo, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Search,
  Settings,
  SlidersHorizontal,
  X,
  ArrowLeft,
  Image as ImageIcon,
  Mic,
  Play,
  Pause,
  FileText,
  Plus,
  Check,
  Volume2,
  FileAudio,
  HardDrive,
  User,
  CalendarDays,
  Info,
  Pencil,
  Shield,
  Smartphone,
  Upload,
  Trash2,
  Sparkles,
  Brain,
  Download,
  Filter,
  Cpu,
  Clock,
  Loader2,
  CheckCircle2,
  Activity
} from 'lucide-react';
import { CapturedPhoto, MediaFile, RecordedAudio, TimetableEntry } from '../types';
import { getFolderHierarchyFromDate, getSampleMediaFiles, extractSmartFileDate } from '../utils/dateFolders';
import { useAccentColor } from '../context/AccentColorContext';
import { analyzeTimetableImage, generateAiSummary } from '../utils/gemini';
import { MarkdownViewer } from './MarkdownViewer';

export const getPersistedAiDocs = (): MediaFile[] => {
  try {
    const saved = localStorage.getItem('lecture_snap_ai_docs');
    if (saved) {
      const parsed: MediaFile[] = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        // Filter out fake/sample data if present
        const realDocs = parsed.filter(
          (d) => d.id !== 'ai_doc_sample_1' && !d.name.includes('컴퓨터구조_12주차_핵심요약')
        );
        if (realDocs.length !== parsed.length) {
          localStorage.setItem('lecture_snap_ai_docs', JSON.stringify(realDocs));
          localStorage.removeItem('doc_sample_1');
          localStorage.removeItem('ai_doc_sample_1');
        }
        return realDocs.map((d) => ({
          ...d,
          timestamp: new Date(d.timestamp),
        }));
      }
    }
  } catch (e) {
    console.error(e);
  }
  return [];
};

interface FolderExplorerModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentDocument: string;
  onSelectDocument: (docName: string) => void;
  showToast: (msg: string) => void;
  photos?: CapturedPhoto[];
  recordings?: RecordedAudio[];
  geminiApiKey: string;
  setGeminiApiKey: React.Dispatch<React.SetStateAction<string>>;
  timetableImage: string | null;
  setTimetableImage: React.Dispatch<React.SetStateAction<string | null>>;
  storageMode: 'default' | 'timetable';
  setStorageMode: React.Dispatch<React.SetStateAction<'default' | 'timetable'>>;
  timetableEntries: TimetableEntry[];
  setTimetableEntries: React.Dispatch<React.SetStateAction<TimetableEntry[]>>;
}

// ── Custom iOS Floating Glassmorphism Calendar Popover ────────────────────────
interface CustomIosCalendarPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  selectedDateStr: string; // "YYYY-MM-DD"
  onSelectDate: (dateStr: string) => void;
  accentColor?: string;
}

const CustomIosCalendarPopover: React.FC<CustomIosCalendarPopoverProps> = ({
  isOpen,
  onClose,
  selectedDateStr,
  onSelectDate,
  accentColor = '#3B82F6',
}) => {
  const selectedDate = useMemo(() => {
    const parts = (selectedDateStr || '').split('-').map(Number);
    if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
      return new Date(parts[0], parts[1] - 1, parts[2]);
    }
    return new Date();
  }, [selectedDateStr]);

  const [viewYear, setViewYear] = useState<number>(() => selectedDate.getFullYear());
  const [viewMonth, setViewMonth] = useState<number>(() => selectedDate.getMonth());
  const [isMonthYearPickerOpen, setIsMonthYearPickerOpen] = useState<boolean>(false);

  useEffect(() => {
    setViewYear(selectedDate.getFullYear());
    setViewMonth(selectedDate.getMonth());
  }, [selectedDate]);

  if (!isOpen) return null;

  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();
  const totalSlots = Math.ceil((firstDayOfWeek + daysInMonth) / 7) * 7;

  const handlePrevMonth = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const handleNextMonth = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const handleSelectDay = (day: number, isPrev = false, isNext = false) => {
    let y = viewYear;
    let m = viewMonth;
    if (isPrev) {
      if (m === 0) { y -= 1; m = 11; } else { m -= 1; }
    } else if (isNext) {
      if (m === 11) { y += 1; m = 0; } else { m += 1; }
    }
    const formatted = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    onSelectDate(formatted);
  };

  const handleSetToday = (e: React.MouseEvent) => {
    e.stopPropagation();
    const today = new Date();
    const formatted = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    onSelectDate(formatted);
    setViewYear(today.getFullYear());
    setViewMonth(today.getMonth());
  };

  const isToday = (y: number, m: number, d: number) => {
    const today = new Date();
    return today.getFullYear() === y && today.getMonth() === m && today.getDate() === d;
  };

  const isSelected = (y: number, m: number, d: number) => {
    return selectedDate.getFullYear() === y && selectedDate.getMonth() === m && selectedDate.getDate() === d;
  };

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs select-none"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 12 }}
          transition={{ type: 'spring', damping: 25, stiffness: 350 }}
          className="bg-white/95 backdrop-blur-2xl border border-neutral-200/90 shadow-2xl rounded-3xl p-5 w-[330px] text-neutral-850"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-4 pb-2 border-b border-neutral-100">
            <button
              onClick={() => setIsMonthYearPickerOpen((prev) => !prev)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-neutral-100 hover:bg-neutral-200/80 font-bold text-sm text-neutral-900 transition-all active:scale-95 cursor-pointer shadow-2xs"
            >
              <span>{viewYear}년 {viewMonth + 1}월</span>
              <ChevronDown className={`w-3.5 h-3.5 text-neutral-500 transition-transform duration-200 ${isMonthYearPickerOpen ? 'rotate-180' : ''}`} />
            </button>

            <div className="flex items-center gap-1">
              <button
                onClick={handlePrevMonth}
                className="w-8 h-8 rounded-full bg-neutral-100 hover:bg-neutral-200/80 flex items-center justify-center text-neutral-600 hover:text-black transition-all active:scale-90 cursor-pointer"
                title="이전 달"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={handleNextMonth}
                className="w-8 h-8 rounded-full bg-neutral-100 hover:bg-neutral-200/80 flex items-center justify-center text-neutral-600 hover:text-black transition-all active:scale-90 cursor-pointer"
                title="다음 달"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Body */}
          {isMonthYearPickerOpen ? (
            /* Month & Year Selection Grid */
            <div className="space-y-4 py-1">
              <div className="flex items-center justify-between px-3">
                <button
                  onClick={() => setViewYear((y) => y - 1)}
                  className="w-7 h-7 rounded-full bg-neutral-100 flex items-center justify-center text-neutral-600 active:scale-90 cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="font-bold text-base text-neutral-900">{viewYear}년</span>
                <button
                  onClick={() => setViewYear((y) => y + 1)}
                  className="w-7 h-7 rounded-full bg-neutral-100 flex items-center justify-center text-neutral-600 active:scale-90 cursor-pointer"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {Array.from({ length: 12 }, (_, i) => i).map((m) => {
                  const isCurrentViewMonth = viewMonth === m;
                  return (
                    <button
                      key={m}
                      onClick={() => {
                        setViewMonth(m);
                        setIsMonthYearPickerOpen(false);
                      }}
                      className={`py-2.5 rounded-2xl text-xs font-bold transition-all active:scale-95 cursor-pointer ${
                        isCurrentViewMonth
                          ? 'bg-black text-white shadow-md'
                          : 'bg-neutral-100/70 hover:bg-neutral-200/80 text-neutral-700'
                      }`}
                    >
                      {m + 1}월
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            /* Standard Day Grid */
            <div>
              <div className="grid grid-cols-7 gap-1 text-center mb-2">
                {['일', '월', '화', '수', '목', '금', '토'].map((wd, i) => (
                  <span
                    key={wd}
                    className={`text-[11px] font-bold py-1 ${
                      i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-neutral-400'
                    }`}
                  >
                    {wd}
                  </span>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-1 text-center">
                {Array.from({ length: totalSlots }, (_, idx) => {
                  let dayNumber = 0;
                  let isPrev = false;
                  let isNext = false;

                  if (idx < firstDayOfWeek) {
                    isPrev = true;
                    dayNumber = daysInPrevMonth - firstDayOfWeek + idx + 1;
                  } else if (idx >= firstDayOfWeek + daysInMonth) {
                    isNext = true;
                    dayNumber = idx - (firstDayOfWeek + daysInMonth) + 1;
                  } else {
                    dayNumber = idx - firstDayOfWeek + 1;
                  }

                  const targetYear = isPrev ? (viewMonth === 0 ? viewYear - 1 : viewYear) : isNext ? (viewMonth === 11 ? viewYear + 1 : viewYear) : viewYear;
                  const targetMonth = isPrev ? (viewMonth === 0 ? 11 : viewMonth - 1) : isNext ? (viewMonth === 11 ? 0 : viewMonth + 1) : viewMonth;

                  const sel = isSelected(targetYear, targetMonth, dayNumber);
                  const today = isToday(targetYear, targetMonth, dayNumber);

                  return (
                    <button
                      key={idx}
                      onClick={() => handleSelectDay(dayNumber, isPrev, isNext)}
                      className={`relative w-9 h-9 mx-auto flex items-center justify-center text-xs rounded-full transition-all active:scale-90 cursor-pointer ${
                        sel
                          ? 'bg-black text-white shadow-md font-bold scale-105'
                          : isPrev || isNext
                          ? 'text-neutral-300 hover:bg-neutral-100/60'
                          : 'text-neutral-800 hover:bg-neutral-100 font-medium'
                      }`}
                    >
                      <span>{dayNumber}</span>
                      {today && !sel && (
                        <span
                          className="absolute bottom-1 w-1 h-1 rounded-full"
                          style={{ backgroundColor: accentColor }}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Footer Controls */}
          <div className="flex items-center justify-between pt-3.5 mt-3 border-t border-neutral-100">
            <button
              onClick={handleSetToday}
              className="text-[11px] font-bold text-neutral-600 hover:text-black px-3 py-1.5 rounded-full bg-neutral-100 hover:bg-neutral-200/80 transition-all active:scale-95 cursor-pointer"
            >
              오늘로 설정
            </button>
            <button
              onClick={onClose}
              className="text-[11px] font-bold text-white bg-black hover:bg-neutral-800 px-4 py-1.5 rounded-full transition-all active:scale-95 shadow-xs cursor-pointer"
            >
              완료
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

// Helper component for Folder cards that handle click for navigation and hold/long-press for selection
interface HoldableFolderCardProps {
  onNavigate: () => void;
  onSelect: () => void;
  children: React.ReactNode;
  className?: string;
}

const HoldableFolderCard: React.FC<HoldableFolderCardProps> = ({
  onNavigate,
  onSelect,
  children,
  className = '',
}) => {
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const isLongPressRef = useRef<boolean>(false);
  const touchHandledRef = useRef<boolean>(false);

  const handleStart = () => {
    isLongPressRef.current = false;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      isLongPressRef.current = true;
      onSelect();
    }, 450);
  };

  const handleEnd = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!isLongPressRef.current) {
      onNavigate();
    }
  };

  const handleCancel = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  return (
    <div
      onTouchStart={() => {
        touchHandledRef.current = true;
        handleStart();
      }}
      onTouchEnd={() => {
        handleEnd();
        setTimeout(() => {
          touchHandledRef.current = false;
        }, 300);
      }}
      onTouchCancel={handleCancel}
      onMouseDown={() => {
        if (!touchHandledRef.current) handleStart();
      }}
      onMouseUp={() => {
        if (!touchHandledRef.current) handleEnd();
      }}
      onMouseLeave={handleCancel}
      className={className}
    >
      {children}
    </div>
  );
};

// Helper component for File items (Photos/Audio) where click selects in selection mode, or normal action otherwise, and hold enters/toggles selection mode
interface HoldableFileCardProps {
  isSelectionMode: boolean;
  onSelect: () => void;
  onClickNormal: () => void;
  children: React.ReactNode;
  className?: string;
}

const HoldableFileCard: React.FC<HoldableFileCardProps> = ({
  isSelectionMode,
  onSelect,
  onClickNormal,
  children,
  className = '',
}) => {
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const isLongPressRef = useRef<boolean>(false);
  const touchHandledRef = useRef<boolean>(false);

  const handleStart = () => {
    isLongPressRef.current = false;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      isLongPressRef.current = true;
      onSelect();
    }, 450);
  };

  const handleEnd = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!isLongPressRef.current) {
      if (isSelectionMode) {
        onSelect();
      } else {
        onClickNormal();
      }
    }
  };

  const handleCancel = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  return (
    <div
      onTouchStart={() => {
        touchHandledRef.current = true;
        handleStart();
      }}
      onTouchEnd={() => {
        handleEnd();
        setTimeout(() => {
          touchHandledRef.current = false;
        }, 300);
      }}
      onTouchCancel={handleCancel}
      onMouseDown={() => {
        if (!touchHandledRef.current) handleStart();
      }}
      onMouseUp={() => {
        if (!touchHandledRef.current) handleEnd();
      }}
      onMouseLeave={handleCancel}
      className={className}
    >
      {children}
    </div>
  );
};

export const FolderExplorerModal: React.FC<FolderExplorerModalProps> = ({
  isOpen,
  onClose,
  currentDocument,
  onSelectDocument,
  showToast,
  photos = [],
  recordings = [],
  geminiApiKey,
  setGeminiApiKey,
  timetableImage,
  setTimetableImage,
  storageMode,
  setStorageMode,
  timetableEntries,
  setTimetableEntries
}) => {
  const { accentColor } = useAccentColor();
  // Folder Navigation Level Path:
  // Level 0: [] -> Root (Years list)
  // Level 1: ['2026년'] -> Half-years list
  // Level 2: ['2026년', '하반기'] -> Months list
  // Level 3: ['2026년', '하반기', '8월'] -> Days list
  // Level 4: ['2026년', '하반기', '8월', '2일 (일)'] -> List layout of files (Photos & Audio)
  const [navPath, setNavPath] = useState<string[]>([]);
  const [isPathExpanded, setIsPathExpanded] = useState<boolean>(false);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [activeSettingDetail, setActiveSettingDetail] = useState<'profile' | 'timetable' | 'ai_center' | 'ai_process' | 'settings' | 'about' | null>(null);

  // Timetable upload & storage mode state
  const timetableInputRef = useRef<HTMLInputElement | null>(null);
  const [isOcrLoading, setIsOcrLoading] = useState<boolean>(false);

  // Selection Mode state
  const [isSelectionMode, setIsSelectionMode] = useState<boolean>(false);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [isAiStartingBubbleOpen, setIsAiStartingBubbleOpen] = useState<boolean>(false);

  // Rename & Info Modal States for AI Documents
  const [renameModalItem, setRenameModalItem] = useState<MediaFile | null>(null);
  const [newDocName, setNewDocName] = useState<string>('');
  const [infoModalItem, setInfoModalItem] = useState<MediaFile | null>(null);

  // AI Processing Session State (Only active processing items remain here)
  const cancelledSessionsRef = useRef<Set<string>>(new Set());
  const [aiSessions, setAiSessions] = useState<Array<{
    id: string;
    title: string;
    fileCount: number;
    fileNames: string[];
    startTime: string;
    progress: number;
    status: 'processing' | 'completed';
    currentStep: string;
    resultFileName: string;
    resultSize: string;
    summarySnippet: string;
  }>>([]);

  // Actual processing happens inside startAiSummaryProcess

  // Dynamic media files list combining photos & audio & documents
  const [mediaList, setMediaList] = useState<MediaFile[]>(() => [
    ...getPersistedAiDocs(),
    ...getSampleMediaFiles(photos, recordings),
  ]);

  const selectedFileIds = selectedItemIds.filter((id) => !id.startsWith('folder_'));

  const selectedExplorerFiles = useMemo(() => {
    return mediaList.filter(
      (m) =>
        selectedFileIds.includes(m.id) &&
        (m.type === 'photo' || m.type === 'audio')
    );
  }, [mediaList, selectedFileIds]);

  const selectedAiDocs = useMemo(() => {
    return mediaList.filter(
      (m) =>
        selectedFileIds.includes(m.id) &&
        (m.type === 'document' || m.name.endsWith('.md'))
    );
  }, [mediaList, selectedFileIds]);

  const hasSelectedAiDocs = selectedAiDocs.length > 0;
  const selectedMediaCount = activeSettingDetail === 'ai_center' ? selectedAiDocs.length : selectedExplorerFiles.length;

  const handleSaveNewName = () => {
    if (!renameModalItem) return;
    const trimmed = newDocName.trim();
    if (!trimmed) {
      showToast('변경할 파일 이름을 입력해주세요.');
      return;
    }
    const finalName = trimmed.endsWith('.md') ? trimmed : `${trimmed}.md`;
    setMediaList((prev) => {
      const updated = prev.map((m) => (m.id === renameModalItem.id ? { ...m, name: finalName } : m));
      const aiOnly = updated.filter((item) => item.type === 'document' || item.name.endsWith('.md'));
      try {
        localStorage.setItem('lecture_snap_ai_docs', JSON.stringify(aiOnly));
      } catch (e) {
        console.error(e);
      }
      return updated;
    });
    showToast(`문서 이름이 '${finalName}'(으)로 변경되었습니다.`);
    setRenameModalItem(null);
  };

  const startAiSummaryProcess = () => {
    if (!geminiApiKey) {
      showToast('Gemini API Key가 필요합니다. 설정에서 API Key를 등록해주세요.');
      return;
    }

    setIsAiStartingBubbleOpen(true);
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toTimeString().slice(0, 5);

    const selectedFiles = [...selectedExplorerFiles].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    const firstFileName = selectedFiles[0]?.name?.replace(/\.[^/.]+$/, '') || '자료';
    const fileNames = selectedFiles.map((f) => f.name);
    const cleanTitle = `${firstFileName}${selectedFiles.length > 1 ? `_외_${selectedFiles.length - 1}개` : ''}`;
    const mdFileName = `${dateStr}_${cleanTitle}_요약.md`;

    const newSessionId = `session_${Date.now()}`;
    const newSession = {
      id: newSessionId,
      title: `${dateStr}_${cleanTitle}`,
      fileCount: selectedFiles.length || 1,
      fileNames: fileNames.length > 0 ? fileNames : ['선택자료_01.jpg', '음성녹음_01.m4a'],
      startTime: timeStr,
      progress: 0,
      status: 'processing' as const,
      currentStep: '자료 스캔 및 분석 준비 중...',
      resultFileName: mdFileName,
      resultSize: '...',
      summarySnippet: `# ${cleanTitle} AI 통합 요약\n- 분석 준비 중...`,
    };

    setAiSessions((prev) => [newSession, ...prev]);

    setTimeout(() => {
      setIsAiStartingBubbleOpen(false);
      setSelectedItemIds([]);
      setIsSelectionMode(false);
      
      // ✨ AI 시작 직후 바로 실시간 프로세스 화면으로 이동하여 진행/오류 여부를 확인하게 함
      setIsSettingsOpen(true);
      setActiveSettingDetail('ai_process');
      
      showToast('⚡ AI 정리가 시작되었습니다! 실시간 진행 상황을 확인하세요.');
    }, 1000);

    // 백그라운드 실제 분석 진행
    (async () => {
      try {
        let fullMarkdown = `# ${cleanTitle} 통합 분석 결과\n\n`;
        let snippet = '';

        for (let i = 0; i < selectedFiles.length; i++) {
          if (cancelledSessionsRef.current.has(newSessionId)) {
            cancelledSessionsRef.current.delete(newSessionId);
            return;
          }

          const file = selectedFiles[i];
          const currentProgress = Math.round(((i) / selectedFiles.length) * 100);
          
          setAiSessions(prev => prev.map(s => s.id === newSessionId ? {
            ...s,
            progress: currentProgress,
            currentStep: `[${i + 1}/${selectedFiles.length}] ${file.name} 분석 중...`,
          } : s));

          const summary = await generateAiSummary(file.dataUrl, file.name, geminiApiKey);
          
          if (cancelledSessionsRef.current.has(newSessionId)) {
            cancelledSessionsRef.current.delete(newSessionId);
            return;
          }
          
          fullMarkdown += `## ${file.name}\n\n${summary}\n\n---\n\n`;
          if (i === 0) {
            snippet = summary.substring(0, 150) + '...';
          }
        }

        const finalSize = `${(new Blob([fullMarkdown]).size / 1024).toFixed(1)} KB`;
        
        // localStorage에 문서 저장
        localStorage.setItem(`doc_${newSessionId}`, fullMarkdown);

        setAiSessions(prev => prev.map(s => s.id === newSessionId ? {
          ...s,
          progress: 100,
          status: 'completed',
          currentStep: 'AI 센터 인덱싱 및 저장 완료',
          resultSize: finalSize,
          summarySnippet: snippet,
        } : s));

        setMediaList(prev => {
          const newDoc: MediaFile = {
            id: `ai_doc_${newSessionId}`,
            type: 'document',
            name: mdFileName,
            fileSize: finalSize,
            timestamp: new Date(),
            mode: 'AI 스마트 요약노트',
            sourceFileNames: fileNames,
          };
          const updated = [newDoc, ...prev];
          const aiOnly = updated.filter((item) => item.type === 'document' || item.name.endsWith('.md'));
          try {
            localStorage.setItem('lecture_snap_ai_docs', JSON.stringify(aiOnly));
          } catch (e) {
            console.error(e);
          }
          return updated;
        });

        showToast(`🎉 [${mdFileName}] AI 정리가 완료되어 AI 센터에 저장되었습니다!`);

      } catch (err: any) {
        setAiSessions(prev => prev.map(s => s.id === newSessionId ? {
          ...s,
          status: 'error',
          currentStep: `오류 발생: ${err.message}`,
        } : s));
        showToast(`❌ AI 정리 중 오류가 발생했습니다: ${err.message}`);
      }
    })();
  };

  const toggleSelectItem = (id: string) => {
    setSelectedItemIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const getAllDescendantIdsForPath = (
    year?: string,
    l1?: string,
    l2?: string,
    l3?: string,
    l4?: string
  ) => {
    const matchingFiles = organizedFiles.filter((item) => {
      if (year && item.hierarchy.year !== year) return false;
      if (storageMode === 'default') {
        if (l1 && item.hierarchy.halfYear !== l1) return false;
        if (l2 && item.hierarchy.month !== l2) return false;
        if (l3 && item.hierarchy.day !== l3) return false;
      } else {
        if (l1 && item.hierarchy.semester !== l1) return false;
        if (l2 && item.hierarchy.subject !== l2) return false;
        if (l3 && item.hierarchy.month !== l3) return false;
        if (l4 && item.hierarchy.day !== l4) return false;
      }
      return true;
    });

    return matchingFiles.map((file) => file.id);
  };

  const handleFolderHoldSelect = (
    folderId: string,
    pathParams: { year?: string; l1?: string; l2?: string; l3?: string; l4?: string }
  ) => {
    if (!isSelectionMode) {
      setIsSelectionMode(true);
      showToast('선택 모드가 시작되었습니다.');
    }

    const descendantIds = getAllDescendantIdsForPath(
      pathParams.year,
      pathParams.l1,
      pathParams.l2,
      pathParams.l3,
      pathParams.l4
    );

    const allTargetIds = Array.from(new Set([folderId, ...descendantIds]));

    setSelectedItemIds((prev) => {
      const descendantSelectedCount = descendantIds.filter((id) => prev.includes(id)).length;
      const isAllDescendantsSelected = descendantIds.length > 0 && descendantSelectedCount === descendantIds.length;
      const isFolderExplicitlySelected = prev.includes(folderId);

      const isCurrentlySelected = isFolderExplicitlySelected || isAllDescendantsSelected;

      if (isCurrentlySelected) {
        return prev.filter((id) => !allTargetIds.includes(id));
      } else {
        return Array.from(new Set([...prev, ...allTargetIds]));
      }
    });
  };

  // External file import & confirmation states
  const externalFileInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingImportFiles, setPendingImportFiles] = useState<MediaFile[]>([]);
  const [isCustomDateOverride, setIsCustomDateOverride] = useState<boolean>(false);
  const [isCalendarPopoverOpen, setIsCalendarPopoverOpen] = useState<boolean>(false);
  const [importTargetDate, setImportTargetDate] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  });
  const [showAddConfirmModal, setShowAddConfirmModal] = useState<boolean>(false);

  const handleTimetableFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!geminiApiKey) {
        alert("Gemini API Key가 필요합니다. 환경설정에서 API Key를 입력해주세요.");
        return;
      }
      
      const reader = new FileReader();
      reader.onload = async (event) => {
        if (event.target?.result) {
          const base64Str = event.target.result as string;
          setTimetableImage(base64Str);
          setIsOcrLoading(true);
          
          try {
            const parsedEntries = await analyzeTimetableImage(base64Str, geminiApiKey);
            setTimetableEntries(parsedEntries);
            setStorageMode('timetable');
            setNavPath([]);
            alert(`시간표가 성공적으로 인식되었습니다! (${parsedEntries.length}개 과목 저장됨)`);
          } catch (error: any) {
            console.error(error);
            alert(`시간표 인식에 실패했습니다: ${error.message || error}`);
          } finally {
            setIsOcrLoading(false);
          }
        }
      };
      reader.readAsDataURL(file);
    }
  };

  // Search & Filter state
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFileFilters, setSelectedFileFilters] = useState<('photo' | 'audio' | 'document')[]>([]);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [previewPhoto, setPreviewPhoto] = useState<MediaFile | null>(null);
  const [previewDoc, setPreviewDoc] = useState<MediaFile | null>(null);

  // Helper to ensure mutually exclusive mode execution (Search, Selection, File Import, Settings, More Menu)
  const closeOtherModes = (activeMode: 'search' | 'selection' | 'fileAdd' | 'settings' | 'moreMenu') => {
    if (activeMode !== 'search') {
      setIsSearchOpen(false);
      setSearchQuery('');
    }
    if (activeMode !== 'selection') {
      setIsSelectionMode(false);
      setSelectedItemIds([]);
    }
    if (activeMode !== 'fileAdd') {
      setPendingImportFiles([]);
      setShowAddConfirmModal(false);
    }
    if (activeMode !== 'settings' && activeMode !== 'selection') {
      setIsSettingsOpen(false);
      setActiveSettingDetail(null);
    } else if (activeMode === 'selection' && activeSettingDetail !== 'ai_center') {
      setIsSettingsOpen(false);
      setActiveSettingDetail(null);
    }
    if (activeMode !== 'moreMenu') {
      setIsMoreMenuOpen(false);
    }
  };

  const handleFileHoldSelect = (fileId: string) => {
    if (!isSelectionMode) {
      closeOtherModes('selection');
      setIsSelectionMode(true);
      showToast('선택 모드가 시작되었습니다.');
    }
    toggleSelectItem(fileId);
  };

  // Toggle helper for multi-selection file filter
  const toggleFileFilter = (type: 'photo' | 'audio' | 'document') => {
    setSelectedFileFilters((prev) => {
      let next: ('photo' | 'audio' | 'document')[];
      if (prev.includes(type)) {
        next = prev.filter((t) => t !== type);
      } else {
        next = [...prev, type];
      }

      // If both active filters ('photo', 'audio') are selected OR none are selected, reset to 'all' ([])
      if (next.length === 0 || next.length === 2) {
        return [];
      }
      return next;
    });
  };

  const selectedMediaFiles = useMemo(() => {
    const rawSelected = mediaList.filter((m) => selectedFileIds.includes(m.id));
    // Deduplicate AI summary documents that have identical names across multiple folders
    const seenNames = new Set<string>();
    return rawSelected.filter((file) => {
      const isAiDoc = file.name.startsWith('[AI요약]') || file.mode?.includes('AI 스마트 요약노트');
      if (isAiDoc) {
        if (seenNames.has(file.name)) return false;
        seenNames.add(file.name);
      }
      return true;
    });
  }, [mediaList, selectedFileIds]);

  // Reset selection state when switching views (AI Center / Settings tab changes)
  React.useEffect(() => {
    setIsSelectionMode(false);
    setSelectedItemIds([]);
  }, [activeSettingDetail, isSettingsOpen]);

  // Re-sync photos, recordings and persisted AI docs when modal opens or files change
  React.useEffect(() => {
    if (isOpen) {
      setMediaList([
        ...getPersistedAiDocs(),
        ...getSampleMediaFiles(photos, recordings),
      ]);
    }
  }, [isOpen, photos, recordings]);

  // Reset path expansion on navPath change
  React.useEffect(() => {
    setIsPathExpanded(false);
  }, [navPath]);

  // Compute folder hierarchy and item counts for File Explorer (Photos & Audio ONLY)
  const organizedFiles = useMemo(() => {
    return mediaList
      .filter((file) => file.type === 'photo' || file.type === 'audio')
      .map((file) => ({
        ...file,
        hierarchy: getFolderHierarchyFromDate(file.timestamp, file.name, timetableEntries)
      }));
  }, [mediaList, timetableEntries]);

  // Filtered organized files based on global selectedFileFilters bubble selection
  const filteredOrganizedFiles = useMemo(() => {
    if (selectedFileFilters.length === 0) return organizedFiles;
    return organizedFiles.filter((item) => selectedFileFilters.includes(item.type as any));
  }, [organizedFiles, selectedFileFilters]);

  const currentYear = navPath[0] || null;
  const currentLevel1 = navPath[1] || null; // halfYear (default) OR semester (timetable)
  const currentLevel2 = navPath[2] || null; // month (default) OR subject (timetable)
  const currentLevel3 = navPath[3] || null; // day (default) OR month (timetable)
  const currentLevel4 = navPath[4] || null; // day (timetable)

  // Searched files filter based on searchQuery and selectedFileFilters within CURRENT NAV PATH (Vault location)
  const searchedFiles = useMemo(() => {
    if (!isSearchOpen && !searchQuery.trim()) return [];
    const q = searchQuery.trim().toLowerCase();

    // First, filter by current Vault location (navPath)
    const currentVaultFiles = filteredOrganizedFiles.filter((item) => {
      if (currentYear && item.hierarchy.year !== currentYear) return false;
      if (storageMode === 'default') {
        if (currentLevel1 && item.hierarchy.halfYear !== currentLevel1) return false;
        if (currentLevel2 && item.hierarchy.month !== currentLevel2) return false;
        if (currentLevel3 && item.hierarchy.day !== currentLevel3) return false;
      } else {
        if (currentLevel1 && item.hierarchy.semester !== currentLevel1) return false;
        if (currentLevel2 && item.hierarchy.subject !== currentLevel2) return false;
        if (currentLevel3 && item.hierarchy.month !== currentLevel3) return false;
        if (currentLevel4 && item.hierarchy.day !== currentLevel4) return false;
      }
      return true;
    });

    return currentVaultFiles.filter((item) => {
      if (!q) return true;
      const nameMatch = item.name ? String(item.name).toLowerCase().includes(q) : false;
      const dateMatch = item.dateString ? String(item.dateString).toLowerCase().includes(q) : false;
      const yearMatch = item.hierarchy?.year ? String(item.hierarchy.year).toLowerCase().includes(q) : false;
      const halfYearMatch = item.hierarchy?.halfYear ? String(item.hierarchy.halfYear).toLowerCase().includes(q) : false;
      const monthMatch = item.hierarchy?.month ? String(item.hierarchy.month).toLowerCase().includes(q) : false;
      const dayMatch = item.hierarchy?.day ? String(item.hierarchy.day).toLowerCase().includes(q) : false;
      const semesterMatch = item.hierarchy?.semester ? String(item.hierarchy.semester).toLowerCase().includes(q) : false;
      const subjectMatch = item.hierarchy?.subject ? String(item.hierarchy.subject).toLowerCase().includes(q) : false;
      const modeMatch = item.mode ? String(item.mode).toLowerCase().includes(q) : false;

      return (
        nameMatch ||
        dateMatch ||
        yearMatch ||
        halfYearMatch ||
        monthMatch ||
        dayMatch ||
        semesterMatch ||
        subjectMatch ||
        modeMatch
      );
    });
  }, [
    filteredOrganizedFiles,
    searchQuery,
    isSearchOpen,
    currentYear,
    currentLevel1,
    currentLevel2,
    currentLevel3,
    currentLevel4,
    storageMode
  ]);

  // Breadcrumb navigation helper
  const navigateToLevel = (depth: number) => {
    if (depth < 0) {
      setNavPath([]);
    } else {
      setNavPath(navPath.slice(0, depth + 1));
    }
  };

  // Helper to count items in a path prefix
  const getItemCountInPath = (
    year?: string,
    l1?: string,
    l2?: string,
    l3?: string,
    l4?: string
  ) => {
    return filteredOrganizedFiles.filter((item) => {
      if (year && item.hierarchy.year !== year) return false;
      if (storageMode === 'default') {
        if (l1 && item.hierarchy.halfYear !== l1) return false;
        if (l2 && item.hierarchy.month !== l2) return false;
        if (l3 && item.hierarchy.day !== l3) return false;
      } else {
        if (l1 && item.hierarchy.semester !== l1) return false;
        if (l2 && item.hierarchy.subject !== l2) return false;
        if (l3 && item.hierarchy.month !== l3) return false;
        if (l4 && item.hierarchy.day !== l4) return false;
      }
      return true;
    }).length;
  };

  // Helper to count selected items in a path prefix
  const getSelectedCountInPath = (
    year?: string,
    l1?: string,
    l2?: string,
    l3?: string,
    l4?: string
  ) => {
    return filteredOrganizedFiles.filter((item) => {
      if (year && item.hierarchy.year !== year) return false;
      if (storageMode === 'default') {
        if (l1 && item.hierarchy.halfYear !== l1) return false;
        if (l2 && item.hierarchy.month !== l2) return false;
        if (l3 && item.hierarchy.day !== l3) return false;
      } else {
        if (l1 && item.hierarchy.semester !== l1) return false;
        if (l2 && item.hierarchy.subject !== l2) return false;
        if (l3 && item.hierarchy.month !== l3) return false;
        if (l4 && item.hierarchy.day !== l4) return false;
      }
      return selectedItemIds.includes(item.id);
    }).length;
  };

  // Dynamic Folders computation
  const dynamicYears = useMemo(() => {
    const set = new Set<string>();
    filteredOrganizedFiles.forEach((f) => {
      if (f.hierarchy.year) set.add(f.hierarchy.year);
    });
    if (storageMode === 'timetable' && set.size === 0) {
      set.add('2026년');
    }
    return Array.from(set).sort().reverse();
  }, [filteredOrganizedFiles, storageMode]);

  const dynamicLevel1 = useMemo(() => {
    if (!currentYear) return [];
    const set = new Set<string>();

    filteredOrganizedFiles.forEach((f) => {
      if (f.hierarchy.year === currentYear) {
        if (storageMode === 'default') {
          if (f.hierarchy.halfYear) set.add(f.hierarchy.halfYear);
        } else {
          if (f.hierarchy.semester) set.add(f.hierarchy.semester);
        }
      }
    });

    if (storageMode === 'timetable') {
      set.add('1학기 (3월~8월)');
      set.add('2학기 (9월~2월)');
    }

    return Array.from(set).sort();
  }, [filteredOrganizedFiles, currentYear, storageMode]);

  const dynamicLevel2 = useMemo(() => {
    if (!currentYear || !currentLevel1) return [];
    const set = new Set<string>();

    if (storageMode === 'timetable') {
      // 1. Add all subjects directly from the recognized timetable
      timetableEntries.forEach((entry) => {
        if (entry.subject && entry.subject.trim()) {
          set.add(entry.subject.trim());
        }
      });
    }

    filteredOrganizedFiles.forEach((f) => {
      if (f.hierarchy.year === currentYear) {
        if (storageMode === 'default' && f.hierarchy.halfYear === currentLevel1) {
          if (f.hierarchy.month) set.add(f.hierarchy.month);
        } else if (storageMode === 'timetable' && f.hierarchy.semester === currentLevel1) {
          if (f.hierarchy.subject) set.add(f.hierarchy.subject);
        }
      }
    });

    return Array.from(set).sort((a, b) => {
      const numA = parseInt(a, 10);
      const numB = parseInt(b, 10);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return a.localeCompare(b);
    });
  }, [filteredOrganizedFiles, currentYear, currentLevel1, storageMode, timetableEntries]);

  const dynamicLevel3 = useMemo(() => {
    if (!currentYear || !currentLevel1 || !currentLevel2) return [];
    const set = new Set<string>();
    filteredOrganizedFiles.forEach((f) => {
      if (f.hierarchy.year === currentYear) {
        if (storageMode === 'default' && f.hierarchy.halfYear === currentLevel1 && f.hierarchy.month === currentLevel2) {
          if (f.hierarchy.day) set.add(f.hierarchy.day);
        } else if (storageMode === 'timetable' && f.hierarchy.semester === currentLevel1 && f.hierarchy.subject === currentLevel2) {
          if (f.hierarchy.month) set.add(f.hierarchy.month);
        }
      }
    });

    return Array.from(set).sort((a, b) => {
      const numA = parseInt(a, 10);
      const numB = parseInt(b, 10);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return a.localeCompare(b);
    });
  }, [filteredOrganizedFiles, currentYear, currentLevel1, currentLevel2, storageMode]);

  const dynamicLevel4 = useMemo(() => {
    if (storageMode !== 'timetable' || !currentYear || !currentLevel1 || !currentLevel2 || !currentLevel3) return [];
    const set = new Set<string>();
    filteredOrganizedFiles.forEach((f) => {
      if (
        f.hierarchy.year === currentYear &&
        f.hierarchy.semester === currentLevel1 &&
        f.hierarchy.subject === currentLevel2 &&
        f.hierarchy.month === currentLevel3
      ) {
        if (f.hierarchy.day) set.add(f.hierarchy.day);
      }
    });
    return Array.from(set).sort((a, b) => {
      const numA = parseInt(a, 10);
      const numB = parseInt(b, 10);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return a.localeCompare(b);
    });
  }, [filteredOrganizedFiles, currentYear, currentLevel1, currentLevel2, currentLevel3, storageMode]);

  // Current level files list
  const dayFiles = useMemo(() => {
    return filteredOrganizedFiles.filter((item) => {
      if (storageMode === 'default') {
        if (currentYear && item.hierarchy.year !== currentYear) return false;
        if (currentLevel1 && item.hierarchy.halfYear !== currentLevel1) return false;
        if (currentLevel2 && item.hierarchy.month !== currentLevel2) return false;
        if (currentLevel3 && item.hierarchy.day !== currentLevel3) return false;
      } else {
        if (currentYear && item.hierarchy.year !== currentYear) return false;
        if (currentLevel1 && item.hierarchy.semester !== currentLevel1) return false;
        if (currentLevel2 && item.hierarchy.subject !== currentLevel2) return false;
        if (currentLevel3 && item.hierarchy.month !== currentLevel3) return false;
        if (currentLevel4 && item.hierarchy.day !== currentLevel4) return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        if (!item.name.toLowerCase().includes(q) && !item.type.toLowerCase().includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [filteredOrganizedFiles, storageMode, currentYear, currentLevel1, currentLevel2, currentLevel3, currentLevel4, searchQuery]);

  // Distinct detected dates in pending files
  const distinctDetectedDates = useMemo(() => {
    const dates = new Set<string>();
    pendingImportFiles.forEach((f) => {
      const d = new Date(f.timestamp);
      if (!isNaN(d.getTime())) {
        dates.add(`${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`);
      }
    });
    return Array.from(dates);
  }, [pendingImportFiles]);

  // Handler for external file import change (multiple files selection with smart date extraction)
  const handleExternalFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files: File[] = Array.from(e.target.files || []);
    if (files.length === 0) return;

    closeOtherModes('fileAdd');

    const readPromises = files.map((file, idx) => {
      return new Promise<MediaFile>((resolve) => {
        const isImage = file.type.startsWith('image/') || /\.(heic|heif|jpg|jpeg|png|gif|webp)$/i.test(file.name);
        const reader = new FileReader();
        reader.onload = (event) => {
          const dataUrl = event.target?.result as string;
          const smartDate = extractSmartFileDate(file, isImage ? dataUrl : undefined);
          resolve({
            id: `imported_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 6)}`,
            type: isImage ? 'photo' : 'audio',
            name: file.name,
            dataUrl: isImage ? dataUrl : undefined,
            fileSize: `${(file.size / (1024 * 1024)).toFixed(1)} MB`,
            timestamp: smartDate,
            duration: isImage ? undefined : '04:15',
            mode: isImage ? '사진' : '녹음'
          });
        };
        reader.readAsDataURL(file);
      });
    });

    Promise.all(readPromises).then((importedList) => {
      setPendingImportFiles(importedList);
      setIsCustomDateOverride(false);
      setImportTargetDate(getInitialDateFromNavPath());
      showToast(`${importedList.length}개 파일이 선택되었습니다. 원본 촬영일 기준 자동 분류 또는 날짜를 지정하여 저장하세요.`);
    });
  };

  // Helper to trigger file import from top + menu (Always clickable)
  const handleStartImportingFile = () => {
    closeOtherModes('fileAdd');
    if (externalFileInputRef.current) {
      externalFileInputRef.current.value = '';
      externalFileInputRef.current.click();
    }
  };

  // Helper to get default YYYY-MM-DD from current navigation path or today
  const getInitialDateFromNavPath = () => {
    const now = new Date();
    let yearNum = now.getFullYear();
    let monthNum = now.getMonth() + 1;
    let dayNum = now.getDate();

    if (navPath.length >= 1 && navPath[0].includes('년')) {
      const parsedY = parseInt(navPath[0].replace(/[^0-9]/g, ''));
      if (!isNaN(parsedY) && parsedY > 2000) yearNum = parsedY;
    }

    let monthStr = '';
    let dayStr = '';

    if (storageMode === 'default') {
      monthStr = navPath[2] || '';
      dayStr = navPath[3] || '';
    } else {
      monthStr = navPath[3] || '';
      dayStr = navPath[4] || '';
    }

    if (monthStr) {
      const parsedM = parseInt(monthStr.replace(/[^0-9]/g, ''));
      if (!isNaN(parsedM) && parsedM >= 1 && parsedM <= 12) {
        monthNum = parsedM;
      }
    }

    if (dayStr) {
      const parsedD = parseInt(dayStr.replace(/[^0-9]/g, ''));
      if (!isNaN(parsedD) && parsedD >= 1 && parsedD <= 31) {
        dayNum = parsedD;
      }
    }

    return `${yearNum}-${String(monthNum).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
  };

  // Click handler on + button at the last level folder ('총 n개 파일' 옆)
  const handleLastFolderPlusClick = () => {
    closeOtherModes('fileAdd');
    if (pendingImportFiles.length === 0) {
      if (externalFileInputRef.current) {
        externalFileInputRef.current.value = '';
        externalFileInputRef.current.click();
      }
      return;
    }
    handleConfirmSaveToFolder();
  };

  // Confirm save imported files (Option 2: Smart Auto Multi-Date classification + optional single date override)
  const handleConfirmSaveToFolder = () => {
    if (pendingImportFiles.length === 0) return;

    let newSavedFiles: MediaFile[] = [];

    if (isCustomDateOverride) {
      // Override all files with importTargetDate
      const now = new Date();
      let targetDate = now;
      if (importTargetDate) {
        const parts = importTargetDate.split('-').map(Number);
        if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
          targetDate = new Date(parts[0], parts[1] - 1, parts[2], now.getHours(), now.getMinutes(), now.getSeconds());
        }
      }

      newSavedFiles = pendingImportFiles.map((file, idx) => ({
        ...file,
        id: `saved_${Date.now()}_${idx}`,
        timestamp: targetDate
      }));

      const dateFormatted = `${targetDate.getFullYear()}년 ${targetDate.getMonth() + 1}월 ${targetDate.getDate()}일`;
      showToast(`🎉 [${newSavedFiles.length}개 파일]이 ${dateFormatted} 폴더에 성공적으로 저장되었습니다!`);
    } else {
      // Smart Auto Mode: Each file preserves its own detected timestamp
      newSavedFiles = pendingImportFiles.map((file, idx) => ({
        ...file,
        id: `saved_${Date.now()}_${idx}`,
        timestamp: file.timestamp
      }));

      const summaryText = distinctDetectedDates.length > 1
        ? `${distinctDetectedDates.length}개 날짜 폴더에 각각`
        : `${distinctDetectedDates[0] || '해당 일자'} 폴더에`;

      showToast(`🎉 [${newSavedFiles.length}개 파일]이 원본 촬영일 기준 ${summaryText} 자동 분류되어 저장되었습니다!`);
    }

    setMediaList((prev) => [...newSavedFiles, ...prev]);
    setPendingImportFiles([]);
    setShowAddConfirmModal(false);
  };

  const handleAudioPlayToggle = (id: string, name: string) => {
    if (playingAudioId === id) {
      setPlayingAudioId(null);
      showToast('녹음 재생이 일시정지 되었습니다');
    } else {
      setPlayingAudioId(id);
      showToast(`'${name}' 녹음 재생 중...`);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 30 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        className="absolute inset-0 z-50 bg-[#F7F7F8] text-neutral-900 flex flex-col justify-between overflow-hidden font-sans select-none"
      >
        {/* 1. Header Bar */}
        <div className="py-3 px-5 bg-white border-b border-neutral-200/80 flex items-center justify-between shadow-2xs">
          <button
            onClick={() => {
              if (navPath.length > 0) {
                setNavPath(navPath.slice(0, navPath.length - 1));
              } else {
                onClose();
              }
            }}
            className="w-9 h-9 rounded-full bg-[#EFEFEF] hover:bg-[#E2E2E2] flex items-center justify-center text-neutral-700 active:scale-95 transition-transform"
            title="뒤로가기"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-2 relative">
            {/* 플러스 (외부 파일 추가) 버튼 */}
            <button
              onClick={handleStartImportingFile}
              className="w-9 h-9 rounded-full bg-[#EFEFEF] hover:bg-[#E2E2E2] flex items-center justify-center text-neutral-700 active:scale-95 transition-transform"
              title="외부 파일 추가"
            >
              <Plus className="w-4.5 h-4.5 stroke-[2.5]" />
            </button>

            {/* 돋보기 (Search) 버튼 */}
            <button
              onClick={() => {
                if (!isSearchOpen) {
                  closeOtherModes('search');
                  setIsSearchOpen(true);
                } else {
                  setIsSearchOpen(false);
                  setSearchQuery('');
                }
              }}
              className={`w-9 h-9 rounded-full flex items-center justify-center active:scale-95 transition-all ${
                isSearchOpen
                  ? 'bg-neutral-900 text-white shadow-xs'
                  : 'bg-[#EFEFEF] hover:bg-[#E2E2E2] text-neutral-700'
              }`}
              title="검색"
            >
              <Search className="w-4.5 h-4.5 stroke-[2]" />
            </button>

            {/* 설정 (Settings) 버튼 */}
            <button
              onClick={() => {
                if (!isSettingsOpen) {
                  closeOtherModes('settings');
                  setIsSettingsOpen(true);
                } else {
                  setIsSettingsOpen(false);
                  setActiveSettingDetail(null);
                }
              }}
              className="w-9 h-9 rounded-full bg-[#EFEFEF] hover:bg-[#E2E2E2] flex items-center justify-center text-neutral-800 active:scale-95 transition-transform"
              title="설정"
            >
              <svg
                viewBox="0 0 24 24"
                className="w-5 h-5 text-neutral-800"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="9" y1="7" x2="9" y2="11" strokeWidth="2.5" />
                <line x1="15" y1="7" x2="15" y2="11" strokeWidth="2.5" />
                <path d="M 4 12 A 8 8 0 0 0 20 12" strokeWidth="2.3" />
              </svg>
            </button>

            {/* 닫기 (Close) 버튼 */}
            <button
              onClick={onClose}
              className="w-9 h-9 rounded-full bg-[#EFEFEF] hover:bg-[#E2E2E2] flex items-center justify-center text-neutral-700 active:scale-95 transition-transform"
              title="닫기"
            >
              <X className="w-4.5 h-4.5" />
            </button>
          </div>
        </div>

        {/* Search Bar Input Container */}
        <AnimatePresence>
          {isSearchOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="px-5 pt-2 overflow-hidden"
            >
              <div className="bg-white border border-neutral-200/90 rounded-2xl p-2.5 shadow-2xs flex items-center gap-2">
                <Search className="w-4 h-4 text-neutral-400 flex-shrink-0 ml-1" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  autoFocus
                  className="w-full bg-transparent text-xs text-neutral-900 focus:outline-none font-sans"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="p-1 rounded-full text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 transition-colors"
                    title="지우기"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Hidden File Input for External File Selection */}
        <input
          type="file"
          ref={externalFileInputRef}
          onChange={handleExternalFileChange}
          accept="image/*,audio/*,.heic,.heif"
          multiple
          className="hidden"
        />

        {/* Pending Imported Files Indicator Banner with Smart Date Auto/Override Selector */}
        {pendingImportFiles.length > 0 && (
          <div className="px-5 pt-3 pb-0">
            <div className="bg-white/95 backdrop-blur-xl border border-neutral-200/90 shadow-md rounded-3xl sm:rounded-full px-4 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs text-neutral-800 transition-all">
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <span className="w-2 h-2 rounded-full bg-black animate-pulse flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="font-bold text-xs text-neutral-900">
                      {pendingImportFiles.length}개 파일 저장 대기 중
                    </p>
                    {!isCustomDateOverride && (
                      <span className="text-[10px] bg-neutral-100 text-neutral-600 font-semibold px-2 py-0.5 rounded-full border border-neutral-200/60">
                        {distinctDetectedDates.length > 1
                          ? `${distinctDetectedDates.length}개 날짜 감지됨`
                          : distinctDetectedDates[0] || '촬영일 자동 감지'}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] font-medium text-neutral-500 truncate mt-0.5">
                    {pendingImportFiles.length === 1
                      ? pendingImportFiles[0].name
                      : `${pendingImportFiles[0].name} 외 ${pendingImportFiles.length - 1}개`}
                  </p>
                </div>
              </div>

              {/* Date Mode & Action Buttons */}
              <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap justify-between sm:justify-end flex-shrink-0">
                {isCustomDateOverride ? (
                  <div className="flex items-center gap-1.5 bg-neutral-100/90 hover:bg-neutral-150 border border-neutral-200/80 px-3 py-1 rounded-full shadow-2xs transition-all">
                    <button
                      onClick={() => setIsCalendarPopoverOpen(true)}
                      className="flex items-center gap-1.5 text-[11px] font-bold text-neutral-800 hover:text-black cursor-pointer"
                      title="달력에서 날짜 선택"
                    >
                      <CalendarDays className="w-3.5 h-3.5" style={{ color: accentColor }} />
                      <span>
                        {(() => {
                          const parts = (importTargetDate || '').split('-').map(Number);
                          if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
                            return `${parts[0]}. ${String(parts[1]).padStart(2, '0')}. ${String(parts[2]).padStart(2, '0')}.`;
                          }
                          return importTargetDate;
                        })()}
                      </span>
                      <ChevronDown className="w-3 h-3 text-neutral-500" />
                    </button>
                    <button
                      onClick={() => setIsCustomDateOverride(false)}
                      className="text-[10px] text-neutral-500 hover:text-neutral-900 bg-neutral-200/60 hover:bg-neutral-200 px-1.5 py-0.5 rounded-full font-bold transition-colors cursor-pointer ml-1"
                      title="촬영일 기준 자동 분류로 전환"
                    >
                      자동
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setIsCustomDateOverride(true);
                      setIsCalendarPopoverOpen(true);
                    }}
                    className="flex items-center gap-1.5 text-[11px] font-bold text-neutral-700 bg-neutral-100 hover:bg-neutral-200/80 border border-neutral-200/80 px-3 py-1.5 rounded-full shadow-2xs transition-all active:scale-95 cursor-pointer"
                    title="특정 날짜로 일괄 변경"
                  >
                    <CalendarDays className="w-3.5 h-3.5" style={{ color: accentColor }} />
                    <span>날짜 직접 지정</span>
                  </button>
                )}

                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => {
                      setPendingImportFiles([]);
                      showToast('선택한 파일 목록이 취소되었습니다.');
                    }}
                    className="text-xs font-bold text-neutral-500 hover:text-neutral-900 bg-neutral-100 hover:bg-neutral-200/80 px-3 py-1.5 rounded-full transition-all active:scale-95 cursor-pointer"
                  >
                    취소
                  </button>
                  <button
                    onClick={handleConfirmSaveToFolder}
                    className="text-xs font-bold text-white bg-black hover:bg-neutral-800 px-4 py-1.5 rounded-full transition-all active:scale-95 shadow-sm cursor-pointer flex items-center gap-1"
                  >
                    <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                    저장
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Custom iOS-Style Glassmorphism Calendar Popover Modal */}
        <CustomIosCalendarPopover
          isOpen={isCalendarPopoverOpen}
          onClose={() => setIsCalendarPopoverOpen(false)}
          selectedDateStr={importTargetDate}
          onSelectDate={(newDate) => {
            setImportTargetDate(newDate);
          }}
          accentColor={accentColor}
        />

        {/* Selection Mode Notice Banner (Camera Floating Style) */}
        {isSelectionMode && (
          <div className="px-5 pt-3 pb-0">
            <div className="bg-white/95 backdrop-blur-xl border border-neutral-200/90 shadow-md rounded-full px-4 py-2 flex items-center justify-between text-xs text-neutral-800">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-black animate-pulse flex-shrink-0" />
                <span className="font-bold text-xs">{selectedExplorerFiles.length}개 항목 선택됨</span>
              </div>
              <button
                onClick={() => {
                  setIsSelectionMode(false);
                  setSelectedItemIds([]);
                  showToast('선택 모드가 종료되었습니다.');
                }}
                className="text-xs font-bold text-neutral-500 hover:text-neutral-900 px-2.5 py-0.5 rounded-lg transition-colors bg-neutral-100 hover:bg-neutral-200"
              >
                취소
              </button>
            </div>
          </div>
        )}

        {/* 2. Directory Bar directly below Header showing current path/location */}
        <div className="px-5 pt-3 pb-1.5">
          <div className="bg-[#1C1C1E] text-white rounded-2xl p-3 flex items-center justify-between shadow-xs">
            <div className="flex items-center gap-2 overflow-x-auto scrollbar-none py-0.5 max-w-[82%] font-sans">
              <button
                onClick={() => setNavPath([])}
                className="flex items-center gap-1 flex-shrink-0 text-xs font-bold hover:underline"
                style={{ color: accentColor }}
              >
                <FolderOpen className="w-4 h-4 flex-shrink-0" style={{ color: accentColor }} />
                <span>Vault</span>
              </button>

              {navPath.length === 0 ? null : navPath.length > 2 && !isPathExpanded ? (
                <>
                  {/* First Directory Segment */}
                  <span className="text-neutral-500 font-light text-xs flex-shrink-0">/</span>
                  <button
                    onClick={() => setNavPath(navPath.slice(0, 1))}
                    className="text-xs flex-shrink-0 whitespace-nowrap font-medium text-neutral-300 hover:text-white"
                  >
                    {navPath[0]}
                  </button>

                  {/* Ellipsis for Middle Directories */}
                  <span className="text-neutral-500 font-light text-xs flex-shrink-0">/</span>
                  <button
                    onClick={() => setIsPathExpanded(true)}
                    className="text-[11px] font-bold bg-neutral-800 hover:bg-neutral-700 px-1.5 py-0.5 rounded flex-shrink-0 transition-colors"
                    style={{ color: accentColor }}
                    title="전체 경로 펼치기"
                  >
                    ...
                  </button>

                  {/* Last Directory Segment */}
                  <span className="text-neutral-500 font-light text-xs flex-shrink-0">/</span>
                  <button
                    onClick={() => setNavPath(navPath.slice(0, navPath.length))}
                    className="text-xs flex-shrink-0 whitespace-nowrap font-bold text-white underline underline-offset-2"
                  >
                    {navPath[navPath.length - 1]}
                  </button>
                </>
              ) : (
                navPath.map((segment, idx) => (
                  <React.Fragment key={idx}>
                    <span className="text-neutral-500 font-light text-xs flex-shrink-0">/</span>
                    <button
                      onClick={() => {
                        setNavPath(navPath.slice(0, idx + 1));
                        setIsPathExpanded(false);
                      }}
                      className={`text-xs flex-shrink-0 whitespace-nowrap transition-colors ${
                        idx === navPath.length - 1
                          ? 'font-bold text-white underline underline-offset-2'
                          : 'font-medium text-neutral-300 hover:text-white'
                      }`}
                    >
                      {segment}
                    </button>
                  </React.Fragment>
                ))
              )}
            </div>

            <div className="bg-neutral-800 text-neutral-300 text-[10px] font-semibold px-2.5 py-1 rounded-lg flex items-center gap-1 flex-shrink-0 border border-white/10">
              <span>Level {navPath.length}</span>
            </div>
          </div>
        </div>

        {/* 3. File Type Filter Bubble Bar directly below Vault Bubble */}
        <div className="px-5 pt-1.5 pb-1.5">
          <div className="bg-white/95 backdrop-blur-xl border border-neutral-200/90 rounded-2xl p-1.5 shadow-2xs flex items-center justify-between gap-1.5 text-xs">
            <button
              onClick={() => setSelectedFileFilters([])}
              className={`flex-1 py-1.5 px-2.5 rounded-xl font-bold text-xs transition-all active:scale-95 flex items-center justify-center gap-1.5 ${
                selectedFileFilters.length === 0
                  ? 'bg-neutral-900 text-white shadow-2xs'
                  : 'bg-transparent text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'
              }`}
            >
              <span>전체</span>
            </button>
            <button
              onClick={() => toggleFileFilter('photo')}
              className={`flex-1 py-1.5 px-2.5 rounded-xl font-bold text-xs transition-all active:scale-95 flex items-center justify-center gap-1.5 ${
                selectedFileFilters.includes('photo')
                  ? 'bg-neutral-900 text-white shadow-2xs'
                  : 'bg-transparent text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'
              }`}
            >
              <ImageIcon className="w-3.5 h-3.5" />
              <span>사진</span>
            </button>
            <button
              onClick={() => toggleFileFilter('audio')}
              className={`flex-1 py-1.5 px-2.5 rounded-xl font-bold text-xs transition-all active:scale-95 flex items-center justify-center gap-1.5 ${
                selectedFileFilters.includes('audio')
                  ? 'bg-neutral-900 text-white shadow-2xs'
                  : 'bg-transparent text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'
              }`}
            >
              <Mic className="w-3.5 h-3.5" />
              <span>녹음</span>
            </button>
          </div>
        </div>

        {/* 4. Main Folder Navigation & List Layout Content View */}
        <div className="flex-1 overflow-y-auto px-5 pt-1.5 pb-3 space-y-3 scrollbar-none">
          {/* SEARCH MODE VIEW */}
          {(isSearchOpen || searchQuery.trim().length > 0) ? (
            <div className="space-y-3">
              {/* Searched Files List */}
              {searchedFiles.length === 0 ? (
                <div className="p-8 bg-white rounded-2xl border border-neutral-200/80 text-center space-y-3 my-2">
                  <div className="w-12 h-12 rounded-2xl bg-neutral-100 flex items-center justify-center mx-auto text-neutral-400">
                    <Search className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-neutral-800">검색 결과가 없습니다</h4>
                    <p className="text-xs text-neutral-500 mt-1 max-w-xs mx-auto">
                      {searchQuery.trim()
                        ? `'${searchQuery}' 검색어와 일치하는 파일이 없습니다.`
                        : '검색어를 입력해 원하는 파일이나 폴더를 찾아보세요.'}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
                  {searchedFiles.map((item) => {
                    const isSelected = selectedItemIds.includes(item.id);
                    const isAudio = item.type === 'audio';
                    const isPhoto = item.type === 'photo';

                    const dateObj = new Date(item.timestamp);
                    const formattedTime = dateObj.toLocaleTimeString('ko-KR', {
                      hour: '2-digit',
                      minute: '2-digit'
                    });

                    // 경로 문자열 생성
                    const pathString = storageMode === 'default'
                      ? `${item.hierarchy?.year || ''} > ${item.hierarchy?.halfYear || ''} > ${item.hierarchy?.month || ''} > ${item.hierarchy?.day || ''}`
                      : `${item.hierarchy?.year || ''} > ${item.hierarchy?.semester || ''} > ${item.hierarchy?.subject || ''} > ${item.hierarchy?.month || ''} > ${item.hierarchy?.day || ''}`;

                    const photoSrc = item.dataUrl || item.url;

                    return (
                      <HoldableFileCard
                        key={item.id}
                        isSelectionMode={isSelectionMode}
                        onSelect={() => handleFileHoldSelect(item.id)}
                        onClickNormal={() => {
                          if (isPhoto) {
                            setPreviewPhoto(item);
                          } else if (isAudio) {
                            handleAudioPlayToggle(item.id, item.name);
                          } else {
                            setPreviewDoc(item);
                          }
                        }}
                        className={`p-3 bg-white rounded-2xl border transition-all cursor-pointer flex items-center justify-between active:scale-[0.99] ${
                          isSelected ? 'border-neutral-900 bg-neutral-50 shadow-xs' : 'border-neutral-200/80'
                        }`}
                      >
                        <div className="flex items-center gap-3 overflow-hidden min-w-0 flex-1">
                          {/* File Thumbnail or Icon */}
                          {isPhoto ? (
                            photoSrc ? (
                              <img
                                src={photoSrc}
                                alt={item.name}
                                className="w-10 h-10 rounded-xl object-cover border border-neutral-200/80 flex-shrink-0"
                              />
                            ) : (
                              <div className="w-10 h-10 rounded-xl bg-neutral-100 border border-neutral-200 text-neutral-600 flex items-center justify-center flex-shrink-0">
                                <ImageIcon className="w-5 h-5" />
                              </div>
                            )
                          ) : isAudio ? (
                            <button
                              onClick={(e) => {
                                if (isSelectionMode) {
                                  e.stopPropagation();
                                  handleFileHoldSelect(item.id);
                                } else {
                                  e.stopPropagation();
                                  handleAudioPlayToggle(item.id, item.name);
                                }
                              }}
                              className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-all active:scale-90 ${
                                playingAudioId === item.id
                                  ? 'bg-neutral-800 text-white animate-pulse'
                                  : 'bg-neutral-100 text-neutral-700 border border-neutral-200'
                              }`}
                            >
                              {playingAudioId === item.id ? (
                                <Pause className="w-5 h-5 fill-current" />
                              ) : (
                                <Play className="w-5 h-5 fill-current ml-0.5" />
                              )}
                            </button>
                          ) : (
                            <div className="w-10 h-10 rounded-xl bg-neutral-100 border border-neutral-200 text-neutral-600 flex items-center justify-center flex-shrink-0">
                              <FileText className="w-5 h-5" />
                            </div>
                          )}

                          {/* File Details */}
                          <div className="truncate min-w-0 flex-1">
                            <h5 className="text-xs font-bold truncate text-neutral-900">
                              {item.name}
                            </h5>

                            {/* Path Badge */}
                            <div className="text-[10px] text-neutral-500 font-medium truncate mt-0.5">
                              {pathString}
                            </div>

                            <div className="flex items-center gap-2 mt-0.5 text-[10px] text-neutral-400">
                              <span>{formattedTime}</span>
                              <span>•</span>
                              <span>{item.fileSize || (isAudio ? item.duration || '03:20' : '1.5 MB')}</span>
                            </div>
                          </div>
                        </div>
                      </HoldableFileCard>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <>
              {/* LEVEL 0: Root (Year Selection) */}
          {navPath.length === 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
              {dynamicYears.length === 0 ? (
                <div className="p-8 bg-white rounded-2xl border border-neutral-200/80 text-center space-y-3 col-span-full">
                  <div className="w-12 h-12 rounded-2xl bg-neutral-100 flex items-center justify-center mx-auto text-neutral-400">
                    <FolderOpen className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-neutral-800">저장된 데이터가 없습니다</h4>
                    <p className="text-xs text-neutral-500 mt-1 max-w-xs mx-auto">
                      새로운 강의 사진 촬영이나 녹음을 진행하시면 촬영/녹음 날짜 기준의 연도, 학기, 월, 일자 폴더가 자동으로 생성됩니다.
                    </p>
                  </div>
                  <div className="pt-2 flex justify-center gap-2">
                    <button
                      onClick={handleStartImportingFile}
                      className="px-4 py-2 bg-neutral-900 text-white rounded-xl text-xs font-semibold hover:bg-neutral-800 active:scale-95 transition-all shadow-xs"
                    >
                      + 외부 파일 가져오기
                    </button>
                  </div>
                </div>
              ) : (
                dynamicYears.map((yr) => {
                  const count = getItemCountInPath(yr);
                  const selectedCount = getSelectedCountInPath(yr);
                  const folderId = `folder_L0_${yr}`;
                  const isFolderExplicitlySelected = selectedItemIds.includes(folderId);
                  const isSelected = count > 0 ? selectedCount === count : isFolderExplicitlySelected;
                  const hasSelectedItems = selectedCount > 0 || (count === 0 && isFolderExplicitlySelected);

                  return (
                    <HoldableFolderCard
                      key={yr}
                      onNavigate={() => setNavPath([yr])}
                      onSelect={() => handleFolderHoldSelect(folderId, { year: yr })}
                      className={`h-full p-3.5 bg-white rounded-2xl border shadow-2xs hover:border-neutral-300 transition-all cursor-pointer flex items-center justify-between gap-2 active:scale-[0.99] ${
                        isSelected ? 'border-neutral-200 bg-neutral-50' : 'border-neutral-200/80'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="w-10 h-10 rounded-xl bg-[#1C1C1E] flex items-center justify-center font-bold text-sm shadow-xs flex-shrink-0" style={{ color: accentColor }}>
                          <Folder className="w-5 h-5" style={{ fill: `${accentColor}33` }} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h4 className="text-sm font-bold text-neutral-900 truncate whitespace-nowrap">{yr}</h4>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            handleFolderHoldSelect(folderId, { year: yr });
                          }}
                          className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-all cursor-pointer active:scale-95 whitespace-nowrap ${
                            isSelected 
                              ? 'bg-neutral-900 text-white border-neutral-900' 
                              : hasSelectedItems 
                              ? 'bg-white text-neutral-900 border-2 border-neutral-900 font-bold' 
                              : 'bg-neutral-100 text-neutral-700 border-neutral-200'
                          }`}
                        >
                          {hasSelectedItems ? `파일 ${count}개 중 ${selectedCount}개 선택됨` : `파일 ${count}개`}
                        </span>
                      </div>
                    </HoldableFolderCard>
                  );
                })
              )}
            </div>
          )}

          {/* LEVEL 1: Year Selected -> Half-Year (default) OR Semester (timetable) */}
          {navPath.length === 1 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
              {dynamicLevel1.length === 0 ? (
                <div className="p-6 bg-white rounded-2xl border border-neutral-200/80 text-center text-xs text-neutral-500 col-span-full">
                  해당 연도에 포함된 데이터 폴더가 없습니다.
                </div>
              ) : (
                dynamicLevel1.map((item) => {
                  const count = getItemCountInPath(currentYear!, item);
                  const selectedCount = getSelectedCountInPath(currentYear!, item);
                  const folderId = `folder_L1_${currentYear}_${item}`;
                  const isFolderExplicitlySelected = selectedItemIds.includes(folderId);
                  const isSelected = count > 0 ? selectedCount === count : isFolderExplicitlySelected;
                  const hasSelectedItems = selectedCount > 0 || (count === 0 && isFolderExplicitlySelected);

                  return (
                    <HoldableFolderCard
                      key={item}
                      onNavigate={() => setNavPath([...navPath, item])}
                      onSelect={() => handleFolderHoldSelect(folderId, { year: currentYear!, l1: item })}
                      className={`h-full p-3.5 bg-white rounded-2xl border shadow-2xs hover:border-neutral-300 transition-all cursor-pointer flex items-center justify-between gap-2 active:scale-[0.99] ${
                        isSelected ? 'border-neutral-200 bg-neutral-50' : 'border-neutral-200/80'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="w-10 h-10 rounded-xl bg-[#1C1C1E] flex items-center justify-center font-bold text-sm shadow-xs flex-shrink-0" style={{ color: accentColor }}>
                          <Folder className="w-5 h-5" style={{ fill: `${accentColor}33` }} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h4 className="text-sm font-bold text-neutral-900 truncate whitespace-nowrap">{item}</h4>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            handleFolderHoldSelect(folderId, { year: currentYear!, l1: item });
                          }}
                          className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-all cursor-pointer active:scale-95 whitespace-nowrap ${
                            isSelected 
                              ? 'bg-neutral-900 text-white border-neutral-900' 
                              : hasSelectedItems 
                              ? 'bg-white text-neutral-900 border-2 border-neutral-900 font-bold' 
                              : 'bg-neutral-100 text-neutral-700 border-neutral-200'
                          }`}
                        >
                          {hasSelectedItems ? `파일 ${count}개 중 ${selectedCount}개 선택됨` : `파일 ${count}개`}
                        </span>
                      </div>
                    </HoldableFolderCard>
                  );
                })
              )}
            </div>
          )}

          {/* LEVEL 2: 
              - Default Mode: Half-Year -> Month Selection
              - Timetable Mode: Semester -> Subject Selection
          */}
          {navPath.length === 2 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
              {dynamicLevel2.length === 0 ? (
                <div className="p-6 bg-white rounded-2xl border border-neutral-200/80 text-center text-xs text-neutral-500 col-span-full">
                  폴더가 없습니다.
                </div>
              ) : storageMode === 'default' ? (
                dynamicLevel2.map((mo) => {
                  const count = getItemCountInPath(currentYear!, currentLevel1!, mo);
                  const selectedCount = getSelectedCountInPath(currentYear!, currentLevel1!, mo);
                  const folderId = `folder_L2_${currentYear}_${currentLevel1}_${mo}`;
                  const isFolderExplicitlySelected = selectedItemIds.includes(folderId);
                  const isSelected = count > 0 ? selectedCount === count : isFolderExplicitlySelected;
                  const hasSelectedItems = selectedCount > 0 || (count === 0 && isFolderExplicitlySelected);

                  return (
                    <HoldableFolderCard
                      key={mo}
                      onNavigate={() => setNavPath([...navPath, mo])}
                      onSelect={() => handleFolderHoldSelect(folderId, { year: currentYear!, l1: currentLevel1!, l2: mo })}
                      className={`h-full p-3.5 bg-white rounded-2xl border shadow-2xs hover:border-neutral-300 transition-all cursor-pointer flex items-center justify-between gap-2 active:scale-[0.99] ${
                        isSelected ? 'border-neutral-200 bg-neutral-50' : 'border-neutral-200/80'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="w-10 h-10 rounded-xl bg-[#1C1C1E] flex items-center justify-center font-bold text-sm shadow-xs flex-shrink-0" style={{ color: accentColor }}>
                          <Folder className="w-5 h-5" style={{ fill: `${accentColor}33` }} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h4 className="text-sm font-bold text-neutral-900 truncate whitespace-nowrap">{mo}</h4>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            handleFolderHoldSelect(folderId, { year: currentYear!, l1: currentLevel1!, l2: mo });
                          }}
                          className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-all cursor-pointer active:scale-95 whitespace-nowrap ${
                            isSelected 
                              ? 'bg-neutral-900 text-white border-neutral-900' 
                              : hasSelectedItems 
                              ? 'bg-white text-neutral-900 border-2 border-neutral-900 font-bold' 
                              : 'bg-neutral-100 text-neutral-700 border-neutral-200'
                          }`}
                        >
                          {hasSelectedItems ? `파일 ${count}개 중 ${selectedCount}개 선택됨` : `파일 ${count}개`}
                        </span>
                      </div>
                    </HoldableFolderCard>
                  );
                })
              ) : (
                dynamicLevel2.map((sub) => {
                  const count = getItemCountInPath(currentYear!, currentLevel1!, sub);
                  const selectedCount = getSelectedCountInPath(currentYear!, currentLevel1!, sub);
                  const folderId = `folder_L2_${currentYear}_${currentLevel1}_${sub}`;
                  const isFolderExplicitlySelected = selectedItemIds.includes(folderId);
                  const isSelected = count > 0 ? selectedCount === count : isFolderExplicitlySelected;
                  const hasSelectedItems = selectedCount > 0 || (count === 0 && isFolderExplicitlySelected);

                  return (
                    <HoldableFolderCard
                      key={sub}
                      onNavigate={() => setNavPath([...navPath, sub])}
                      onSelect={() => handleFolderHoldSelect(folderId, { year: currentYear!, l1: currentLevel1!, l2: sub })}
                      className={`h-full p-3.5 bg-white rounded-2xl border shadow-2xs hover:border-neutral-300 transition-all cursor-pointer flex items-center justify-between gap-2 active:scale-[0.99] ${
                        isSelected ? 'border-neutral-200 bg-neutral-50' : 'border-neutral-200/80'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="w-10 h-10 rounded-xl bg-[#1C1C1E] flex items-center justify-center font-bold text-sm shadow-xs flex-shrink-0" style={{ color: accentColor }}>
                          <Folder className="w-5 h-5" style={{ fill: `${accentColor}33` }} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h4 className="text-sm font-bold text-neutral-900 truncate whitespace-nowrap">{sub}</h4>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            handleFolderHoldSelect(folderId, { year: currentYear!, l1: currentLevel1!, l2: sub });
                          }}
                          className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-all cursor-pointer active:scale-95 whitespace-nowrap ${
                            isSelected 
                              ? 'bg-neutral-900 text-white border-neutral-900' 
                              : hasSelectedItems 
                              ? 'bg-white text-neutral-900 border-2 border-neutral-900 font-bold' 
                              : 'bg-neutral-100 text-neutral-700 border-neutral-200'
                          }`}
                        >
                          {hasSelectedItems ? `파일 ${count}개 중 ${selectedCount}개 선택됨` : `파일 ${count}개`}
                        </span>
                      </div>
                    </HoldableFolderCard>
                  );
                })
              )}
            </div>
          )}

          {/* LEVEL 3: 
              - Default Mode: Month -> Day Selection
              - Timetable Mode: Subject -> Month Selection
          */}
          {navPath.length === 3 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
              {dynamicLevel3.length === 0 ? (
                <div className="p-6 bg-white rounded-2xl border border-neutral-200/80 text-center text-xs text-neutral-500 col-span-full">
                  폴더가 없습니다.
                </div>
              ) : storageMode === 'default' ? (
                dynamicLevel3.map((dy) => {
                  const count = getItemCountInPath(currentYear!, currentLevel1!, currentLevel2!, dy);
                  const selectedCount = getSelectedCountInPath(currentYear!, currentLevel1!, currentLevel2!, dy);
                  const folderId = `folder_L3_${currentYear}_${currentLevel1}_${currentLevel2}_${dy}`;
                  const isFolderExplicitlySelected = selectedItemIds.includes(folderId);
                  const isSelected = count > 0 ? selectedCount === count : isFolderExplicitlySelected;
                  const hasSelectedItems = selectedCount > 0 || (count === 0 && isFolderExplicitlySelected);

                  return (
                    <HoldableFolderCard
                      key={dy}
                      onNavigate={() => setNavPath([...navPath, dy])}
                      onSelect={() => handleFolderHoldSelect(folderId, { year: currentYear!, l1: currentLevel1!, l2: currentLevel2!, l3: dy })}
                      className={`h-full p-3.5 bg-white rounded-2xl border shadow-2xs hover:border-neutral-300 transition-all cursor-pointer flex items-center justify-between gap-2 active:scale-[0.99] ${
                        isSelected ? 'border-neutral-200 bg-neutral-50' : 'border-neutral-200/80'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="w-10 h-10 rounded-xl bg-[#1C1C1E] flex items-center justify-center font-bold text-sm shadow-xs flex-shrink-0" style={{ color: accentColor }}>
                          <Folder className="w-5 h-5" style={{ fill: `${accentColor}33` }} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h4 className="text-sm font-bold text-neutral-900 truncate whitespace-nowrap">{dy}</h4>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            handleFolderHoldSelect(folderId, { year: currentYear!, l1: currentLevel1!, l2: currentLevel2!, l3: dy });
                          }}
                          className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-all cursor-pointer active:scale-95 whitespace-nowrap ${
                            isSelected 
                              ? 'bg-neutral-900 text-white border-neutral-900' 
                              : hasSelectedItems 
                              ? 'bg-white text-neutral-900 border-2 border-neutral-900 font-bold' 
                              : 'bg-neutral-100 text-neutral-700 border-neutral-200'
                          }`}
                        >
                          {hasSelectedItems ? `파일 ${count}개 중 ${selectedCount}개 선택됨` : `파일 ${count}개`}
                        </span>
                      </div>
                    </HoldableFolderCard>
                  );
                })
              ) : (
                dynamicLevel3.map((mo) => {
                  const count = getItemCountInPath(currentYear!, currentLevel1!, currentLevel2!, mo);
                  const selectedCount = getSelectedCountInPath(currentYear!, currentLevel1!, currentLevel2!, mo);
                  const folderId = `folder_L3_${currentYear}_${currentLevel1}_${currentLevel2}_${mo}`;
                  const isFolderExplicitlySelected = selectedItemIds.includes(folderId);
                  const isSelected = count > 0 ? selectedCount === count : isFolderExplicitlySelected;
                  const hasSelectedItems = selectedCount > 0 || (count === 0 && isFolderExplicitlySelected);

                  return (
                    <HoldableFolderCard
                      key={mo}
                      onNavigate={() => setNavPath([...navPath, mo])}
                      onSelect={() => handleFolderHoldSelect(folderId, { year: currentYear!, l1: currentLevel1!, l2: currentLevel2!, l3: mo })}
                      className={`h-full p-3.5 bg-white rounded-2xl border shadow-2xs hover:border-neutral-300 transition-all cursor-pointer flex items-center justify-between gap-2 active:scale-[0.99] ${
                        isSelected ? 'border-neutral-200 bg-neutral-50' : 'border-neutral-200/80'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="w-10 h-10 rounded-xl bg-[#1C1C1E] flex items-center justify-center font-bold text-sm shadow-xs flex-shrink-0" style={{ color: accentColor }}>
                          <Folder className="w-5 h-5" style={{ fill: `${accentColor}33` }} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h4 className="text-sm font-bold text-neutral-900 truncate whitespace-nowrap">{mo}</h4>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            handleFolderHoldSelect(folderId, { year: currentYear!, l1: currentLevel1!, l2: mo });
                          }}
                          className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-all cursor-pointer active:scale-95 whitespace-nowrap ${
                            isSelected 
                              ? 'bg-neutral-900 text-white border-neutral-900' 
                              : hasSelectedItems 
                              ? 'bg-white text-neutral-900 border-2 border-neutral-900 font-bold' 
                              : 'bg-neutral-100 text-neutral-700 border-neutral-200'
                          }`}
                        >
                          {hasSelectedItems ? `파일 ${count}개 중 ${selectedCount}개 선택됨` : `파일 ${count}개`}
                        </span>
                      </div>
                    </HoldableFolderCard>
                  );
                })
              )}
            </div>
          )}

          {/* LEVEL 4:
              - Default Mode: FILE LIST LAYOUT (Level 4 is Day view for Default Mode)
              - Timetable Mode: Month -> Day Selection
          */}
          {navPath.length === 4 && storageMode === 'timetable' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
              {dynamicLevel4.length === 0 ? (
                <div className="p-6 bg-white rounded-2xl border border-neutral-200/80 text-center text-xs text-neutral-500 col-span-full">
                  폴더가 없습니다.
                </div>
              ) : (
                dynamicLevel4.map((dy) => {
                  const count = getItemCountInPath(
                    currentYear!,
                    currentLevel1!,
                    currentLevel2!,
                    currentLevel3!,
                    dy
                  );
                  const selectedCount = getSelectedCountInPath(
                    currentYear!,
                    currentLevel1!,
                    currentLevel2!,
                    currentLevel3!,
                    dy
                  );
                  const folderId = `folder_L4_${currentYear}_${currentLevel1}_${currentLevel2}_${currentLevel3}_${dy}`;
                  const isFolderExplicitlySelected = selectedItemIds.includes(folderId);
                  const isSelected = count > 0 ? selectedCount === count : isFolderExplicitlySelected;
                  const hasSelectedItems = selectedCount > 0 || (count === 0 && isFolderExplicitlySelected);

                  return (
                    <HoldableFolderCard
                      key={dy}
                      onNavigate={() => setNavPath([...navPath, dy])}
                      onSelect={() => handleFolderHoldSelect(folderId, { year: currentYear!, l1: currentLevel1!, l2: currentLevel2!, l3: currentLevel3!, l4: dy })}
                      className={`h-full p-3.5 bg-white rounded-2xl border shadow-2xs hover:border-neutral-300 transition-all cursor-pointer flex items-center justify-between gap-2 active:scale-[0.99] ${
                        isSelected ? 'border-neutral-200 bg-neutral-50' : 'border-neutral-200/80'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="w-10 h-10 rounded-xl bg-[#1C1C1E] flex items-center justify-center font-bold text-sm shadow-xs flex-shrink-0" style={{ color: accentColor }}>
                          <Folder className="w-5 h-5" style={{ fill: `${accentColor}33` }} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h4 className="text-sm font-bold text-neutral-900 truncate whitespace-nowrap">{dy}</h4>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            handleFolderHoldSelect(folderId, { year: currentYear!, l1: currentLevel1!, l2: currentLevel2!, l3: currentLevel3!, l4: dy });
                          }}
                          className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-all cursor-pointer active:scale-95 whitespace-nowrap ${
                            isSelected 
                              ? 'bg-neutral-900 text-white border-neutral-900' 
                              : hasSelectedItems 
                              ? 'bg-white text-neutral-900 border-2 border-neutral-900 font-bold' 
                              : 'bg-neutral-100 text-neutral-700 border-neutral-200'
                          }`}
                        >
                          {hasSelectedItems ? `파일 ${count}개 중 ${selectedCount}개 선택됨` : `파일 ${count}개`}
                        </span>
                      </div>
                    </HoldableFolderCard>
                  );
                })
              )}
            </div>
          )}

          {/* FILE LIST LAYOUT:
              - Default Mode at Level 4 (navPath.length === 4)
              - Timetable Mode at Level 5 (navPath.length === 5)
          */}
          {((storageMode === 'default' && navPath.length === 4) ||
            (storageMode === 'timetable' && navPath.length === 5)) && (
            <div className="space-y-3">
              {/* LIST LAYOUT (사진, 녹음, 문서 파일 리스트) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
                {dayFiles.length === 0 ? (
                  <div className="text-center py-10 bg-white rounded-2xl border border-neutral-200/80 p-6">
                    <FileAudio className="w-10 h-10 text-neutral-300 mx-auto mb-2 stroke-[1.5]" />
                    <p className="text-xs font-bold text-neutral-700">저장된 파일이 없습니다.</p>
                    <p className="text-[11px] text-neutral-400 mt-1">
                      오른쪽 상단 + 버튼을 눌러 테스트용 파일이나 녹음을 추가해보세요.
                    </p>
                  </div>
                ) : (
                  dayFiles.map((item) => {
                    const isPhoto = item.type === 'photo';
                    const isAudio = item.type === 'audio';
                    const isDoc = item.type === 'document';
                    const isSelected = selectedItemIds.includes(item.id);
                    const formattedTime = new Date(item.timestamp).toLocaleTimeString('ko-KR', {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit'
                    });

                    return (
                      <HoldableFileCard
                        key={item.id}
                        isSelectionMode={isSelectionMode}
                        onSelect={() => handleFileHoldSelect(item.id)}
                        onClickNormal={() => {
                          if (isPhoto) {
                            setPreviewPhoto(item);
                          } else if (isAudio) {
                            handleAudioPlayToggle(item.id, item.name);
                          } else {
                            setPreviewDoc(item);
                          }
                        }}
                        className={`h-full p-3.5 rounded-2xl border transition-all flex items-center justify-between shadow-2xs text-neutral-800 cursor-pointer ${
                          isSelected
                            ? 'border-neutral-900 bg-neutral-50 shadow-xs'
                            : 'bg-white border-neutral-200/80 hover:border-neutral-300'
                        }`}
                      >
                        {/* File Thumbnail & Details */}
                        <div className="flex items-center gap-3 overflow-hidden mr-2">
                          {/* Left Icon / Thumbnail */}
                          {isPhoto ? (
                            item.dataUrl ? (
                              <img
                                src={item.dataUrl}
                                alt={item.name}
                                onClick={(e) => {
                                  if (isSelectionMode) {
                                    e.stopPropagation();
                                    handleFileHoldSelect(item.id);
                                  } else {
                                    e.stopPropagation();
                                    setPreviewPhoto(item);
                                  }
                                }}
                                className="w-10 h-10 rounded-xl object-cover flex-shrink-0 border border-neutral-200 cursor-pointer shadow-xs active:scale-95"
                              />
                            ) : (
                              <div
                                className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 font-bold"
                                style={{ backgroundColor: `${accentColor}20`, color: accentColor }}
                              >
                                <ImageIcon className="w-5 h-5" />
                              </div>
                            )
                          ) : isAudio ? (
                            <button
                              onClick={(e) => {
                                if (isSelectionMode) {
                                  e.stopPropagation();
                                  handleFileHoldSelect(item.id);
                                } else {
                                  e.stopPropagation();
                                  handleAudioPlayToggle(item.id, item.name);
                                }
                              }}
                              className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-all active:scale-90 ${
                                playingAudioId === item.id
                                  ? 'bg-neutral-800 text-white animate-pulse'
                                  : 'bg-neutral-100 text-neutral-700 border border-neutral-200'
                              }`}
                            >
                              {playingAudioId === item.id ? (
                                <Pause className="w-5 h-5 fill-current" />
                              ) : (
                                <Play className="w-5 h-5 fill-current ml-0.5" />
                              )}
                            </button>
                          ) : (
                            <div className="w-10 h-10 rounded-xl bg-neutral-100 border border-neutral-200 text-neutral-600 flex items-center justify-center flex-shrink-0">
                              <FileText className="w-5 h-5" />
                            </div>
                          )}

                          {/* File Details */}
                          <div className="truncate">
                            <h5 className="text-xs font-bold truncate text-neutral-900">
                              {item.name}
                            </h5>

                            <div className="flex items-center gap-2 mt-1 text-[10px] text-neutral-400">
                              <span>{formattedTime}</span>
                              <span>•</span>
                              <span>{item.fileSize || (isAudio ? item.duration || '03:20' : '1.5 MB')}</span>
                            </div>
                          </div>
                        </div>
                      </HoldableFileCard>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* Catch-All Fallback View */}
          {((storageMode === 'default' && navPath.length > 4) ||
            (storageMode === 'timetable' && navPath.length > 5)) && (
            <div className="p-8 bg-white rounded-2xl border border-neutral-200/80 text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-neutral-100 flex items-center justify-center mx-auto text-neutral-400">
                <FolderOpen className="w-6 h-6" />
              </div>
              <h4 className="text-sm font-bold text-neutral-800">폴더 위치를 찾을 수 없습니다</h4>
              <p className="text-xs text-neutral-500 max-w-xs mx-auto">
                최상위 루트로 이동하거나 새로운 사진/녹음 데이터를 추가해 보세요.
              </p>
              <button
                onClick={() => setNavPath([])}
                className="px-4 py-2 bg-neutral-900 text-white rounded-xl text-xs font-semibold hover:bg-black transition-all shadow-xs"
              >
                최상위 Vault 폴더로 이동
              </button>
            </div>
          )}
            </>
          )}

        </div>





        {/* Settings Screen Modal */}
        <AnimatePresence>
          {isSettingsOpen && (
            <motion.div
              initial={{ opacity: 0, y: '100%' }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 220 }}
              className="absolute inset-0 z-50 bg-[#F7F7F8] text-neutral-900 flex flex-col justify-between overflow-hidden font-sans"
            >
              {/* Settings Header */}
              <div className="py-3 px-5 bg-white border-b border-neutral-200/80 flex items-center justify-between shadow-2xs">
                <button
                  onClick={() => {
                    if (activeSettingDetail === 'ai_process') {
                      setActiveSettingDetail('ai_center');
                    } else if (activeSettingDetail) {
                      setActiveSettingDetail(null);
                    } else {
                      setIsSettingsOpen(false);
                    }
                  }}
                  className="w-9 h-9 rounded-full bg-[#EFEFEF] hover:bg-[#E2E2E2] flex items-center justify-center text-neutral-700 active:scale-95 transition-transform"
                  title="뒤로가기"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <h3 className="text-base font-bold text-neutral-900">
                  {activeSettingDetail === 'profile'
                    ? '회원정보'
                    : activeSettingDetail === 'timetable'
                    ? '시간표 등록'
                    : activeSettingDetail === 'ai_center'
                    ? 'AI 센터'
                    : activeSettingDetail === 'ai_process'
                    ? 'AI 프로세스 현황'
                    : activeSettingDetail === 'settings'
                    ? '환경설정'
                    : activeSettingDetail === 'about'
                    ? '앱 설명'
                    : 'APP CENTRE'}
                </h3>
                <button
                  onClick={() => {
                    setActiveSettingDetail(null);
                    setIsSettingsOpen(false);
                  }}
                  className="w-9 h-9 rounded-full bg-[#EFEFEF] hover:bg-[#E2E2E2] flex items-center justify-center text-neutral-700 active:scale-95 transition-transform"
                  title="닫기"
                >
                  <X className="w-4.5 h-4.5" />
                </button>
              </div>

              {/* Settings Main Content List */}
              <div className="flex-1 overflow-y-auto px-5 pt-3 pb-4 space-y-4">
                {activeSettingDetail === null && (
                  <div className="space-y-3">
                    <p className="text-[11px] font-bold text-neutral-400 px-1 tracking-wider uppercase">
                      계정 및 앱 관리
                    </p>

                    {/* Grouped Settings List */}
                    <div className="bg-white rounded-2xl border border-neutral-200/80 divide-y divide-neutral-100 shadow-2xs overflow-hidden">
                      {/* 1. 회원정보 (User Profile) */}
                      <button
                        onClick={() => setActiveSettingDetail('profile')}
                        className="w-full p-4 flex items-center justify-between hover:bg-neutral-50 active:bg-neutral-100 transition-colors text-left"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-pink-500/10 text-pink-500 flex items-center justify-center">
                            <User className="w-5 h-5" />
                          </div>
                          <div>
                            <h4 className="text-sm font-bold text-neutral-900">회원정보</h4>
                            <p className="text-[11px] text-neutral-400 mt-0.5">
                              easyelemento@gmail.com
                            </p>
                          </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-neutral-400" />
                      </button>

                      {/* 2. 시간표 등록 (Timetable Registration) */}
                      <button
                        onClick={() => setActiveSettingDetail('timetable')}
                        className="w-full p-4 flex items-center justify-between hover:bg-neutral-50 active:bg-neutral-100 transition-colors text-left"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
                            <CalendarDays className="w-5 h-5" />
                          </div>
                          <div>
                            <h4 className="text-sm font-bold text-neutral-900">시간표 등록</h4>
                            <p className="text-[11px] text-neutral-400 mt-0.5">
                              수업 시간표 등록 및 과목별 매핑 설정
                            </p>
                          </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-neutral-400" />
                      </button>

                      {/* 3. AI 센터 (AI Center) */}
                      <button
                        onClick={() => setActiveSettingDetail('ai_center')}
                        className="w-full p-4 flex items-center justify-between hover:bg-neutral-50 active:bg-neutral-100 transition-colors text-left"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-purple-500/10 text-purple-600 flex items-center justify-center">
                            <Sparkles className="w-5 h-5" />
                          </div>
                          <div>
                            <h4 className="text-sm font-bold text-neutral-900">AI 센터</h4>
                            <p className="text-[11px] text-neutral-400 mt-0.5">
                              사진/음성 AI 정리 요약 및 마크다운 생성 설정
                            </p>
                          </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-neutral-400" />
                      </button>

                      {/* 4. 환경설정 (Preferences / Settings) */}
                      <button
                        onClick={() => setActiveSettingDetail('settings')}
                        className="w-full p-4 flex items-center justify-between hover:bg-neutral-50 active:bg-neutral-100 transition-colors text-left"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-neutral-500/10 text-neutral-700 flex items-center justify-center">
                            <SlidersHorizontal className="w-5 h-5" />
                          </div>
                          <div>
                            <h4 className="text-sm font-bold text-neutral-900">환경설정</h4>
                            <p className="text-[11px] text-neutral-400 mt-0.5">
                              시스템 옵션 및 환경설정
                            </p>
                          </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-neutral-400" />
                      </button>

                      {/* 5. 앱 설명 (App Description) */}
                      <button
                        onClick={() => setActiveSettingDetail('about')}
                        className="w-full p-4 flex items-center justify-between hover:bg-neutral-50 active:bg-neutral-100 transition-colors text-left"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-600 flex items-center justify-center">
                            <Info className="w-5 h-5" />
                          </div>
                          <div>
                            <h4 className="text-sm font-bold text-neutral-900">앱 설명</h4>
                            <p className="text-[11px] text-neutral-400 mt-0.5">
                              Vault 시간 자동 정렬 시스템 및 버전에 관한 정보
                            </p>
                          </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-neutral-400" />
                      </button>
                    </div>
                  </div>
                )}

                {/* Sub-view: 회원정보 */}
                {activeSettingDetail === 'profile' && (
                  <div className="space-y-3">
                    <div className="bg-white p-5 rounded-2xl border border-neutral-200/80 shadow-2xs space-y-4">
                      <div className="flex items-center gap-4">
                        <div className="w-14 h-14 rounded-full bg-pink-500/10 text-pink-500 flex items-center justify-center font-bold text-lg shadow-xs">
                          <User className="w-7 h-7" />
                        </div>
                        <div>
                          <h4 className="text-base font-bold text-neutral-900">easyelemento</h4>
                          <p className="text-xs text-neutral-500">easyelemento@gmail.com</p>
                          <span className="inline-block mt-1 bg-pink-100 text-pink-800 text-[10px] font-bold px-2 py-0.5 rounded-md">
                            프리미엄 회원
                          </span>
                        </div>
                      </div>

                      <div className="border-t border-neutral-100 pt-3 space-y-2 text-xs">
                        <div className="flex justify-between text-neutral-600">
                          <span>가입 날짜</span>
                          <span className="font-semibold text-neutral-900">2026.08.01</span>
                        </div>
                        <div className="flex justify-between text-neutral-600">
                          <span>저장 공간</span>
                          <span className="font-semibold text-neutral-900">12.4 GB / 100 GB</span>
                        </div>
                        <div className="flex justify-between text-neutral-600">
                          <span>자동 동기화</span>
                          <span className="font-semibold text-emerald-600">활성화됨</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Sub-view: 시간표 등록 */}
                {activeSettingDetail === 'timetable' && (
                  <div className="space-y-3">
                    <input
                      type="file"
                      ref={timetableInputRef}
                      onChange={handleTimetableFileChange}
                      accept="image/*,.heic,.heif"
                      className="hidden"
                    />
                    <div className="bg-white p-5 rounded-2xl border border-neutral-200/80 shadow-2xs space-y-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
                          <CalendarDays className="w-5 h-5" />
                        </div>
                        <div>
                          <h4 className="text-sm font-bold text-neutral-900">시간표 등록 모드</h4>
                          <p className="text-[11px] text-neutral-400">강의 시간 기준 자동 분류 시스템</p>
                        </div>
                      </div>

                      <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-200/60 text-xs text-neutral-600 space-y-1.5">
                        <p className="font-bold text-neutral-800">
                          • 현재 설정된 모드:{' '}
                          <span
                            className="font-bold"
                            style={{ color: storageMode === 'timetable' ? accentColor : '#404040' }}
                          >
                            {storageMode === 'timetable' ? '시간표 모드 (연도 → 학기 → 과목 → 달 → 일)' : '디폴트 모드 (연도 → 상하반기 → 달 → 일)'}
                          </span>
                        </p>
                        <p className="text-neutral-500">• 디폴트 모드: 연도 → 상하반기 → 달 → 일 순 자동 분류</p>
                        <p className="text-neutral-500">• 시간표 모드: 시간표 사진을 등록하면 강의 시간에 맞게 사진 및 녹음 파일이 [연도 → 1학기/2학기 → 과목 → 달 → 일] 순의 하위 폴더로 자동 연결되어 저장됩니다.</p>
                      </div>

                      {/* Storage Mode Toggle Buttons inside Settings */}
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          onClick={() => {
                            setStorageMode('default');
                            setNavPath([]);
                            showToast('디폴트 모드로 전환되었습니다.');
                          }}
                          className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all ${
                            storageMode === 'default'
                              ? 'bg-black text-white shadow-xs'
                              : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                          }`}
                        >
                          디폴트 모드 적용
                        </button>
                        <button
                          onClick={() => {
                            setStorageMode('timetable');
                            setNavPath([]);
                            showToast('시간표 모드 (연도 → 학기 → 과목 → 달 → 일)로 전환되었습니다.');
                          }}
                          className="flex-1 py-2 rounded-xl text-xs font-bold transition-all"
                          style={
                            storageMode === 'timetable'
                              ? { backgroundColor: accentColor, color: '#000000' }
                              : { backgroundColor: '#F5F5F5', color: '#525252' }
                          }
                        >
                          시간표 모드 적용
                        </button>
                      </div>

                      {timetableImage ? (
                        <div className="space-y-3 pt-1">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-neutral-800 flex items-center gap-1.5">
                              <Check className="w-4 h-4 text-emerald-600 stroke-[2.5]" />
                              등록된 시간표 사진
                            </span>
                            <button
                              onClick={() => {
                                setTimetableImage(null);
                                setTimetableEntries([]);
                                showToast('시간표 사진이 삭제되었습니다.');
                              }}
                              className="text-[11px] text-rose-500 font-semibold hover:underline flex items-center gap-1"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              삭제
                            </button>
                          </div>
                          <div className="relative rounded-xl overflow-hidden border border-neutral-200/80 bg-neutral-900 aspect-4/3 max-h-56">
                            <img
                              src={timetableImage}
                              alt="등록된 시간표"
                              className="w-full h-full object-contain"
                            />
                          </div>

                          {/* Recognized Timetable Subjects List */}
                          {timetableEntries.length > 0 && (
                            <div className="bg-neutral-50 rounded-xl p-3 border border-neutral-200/80 space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-[11px] font-bold text-neutral-700">
                                  📋 인식된 과목 목록 ({timetableEntries.length}개)
                                </span>
                                <span className="text-[10px] text-emerald-600 font-bold bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                                  폴더 자동 연결됨
                                </span>
                              </div>
                              <div className="max-h-40 overflow-y-auto space-y-1 divide-y divide-neutral-100">
                                {timetableEntries.map((entry, idx) => {
                                  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
                                  return (
                                    <div key={idx} className="flex items-center justify-between text-xs pt-1.5 first:pt-0">
                                      <div className="flex items-center gap-1.5 font-bold text-neutral-800">
                                        <span className="w-5 h-5 rounded-md bg-neutral-200 text-neutral-700 flex items-center justify-center text-[10px] font-black">
                                          {dayNames[entry.dayOfWeek] || '월'}
                                        </span>
                                        <span>{entry.subject}</span>
                                      </div>
                                      <span className="text-[11px] text-neutral-500 font-mono">
                                        {entry.startTime} ~ {entry.endTime}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                          <button
                            onClick={() => timetableInputRef.current?.click()}
                            disabled={isOcrLoading}
                            className={`w-full text-xs font-bold py-2.5 rounded-xl transition-all flex items-center justify-center gap-2 border ${
                              isOcrLoading
                                ? 'bg-neutral-200 text-neutral-400 border-neutral-200 cursor-not-allowed'
                                : 'bg-neutral-100 text-neutral-800 hover:bg-neutral-200 active:scale-98 border-neutral-200/80'
                            }`}
                          >
                            {isOcrLoading ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Upload className="w-4 h-4 text-neutral-600" />
                            )}
                            <span>{isOcrLoading ? 'AI 분석 중...' : '시간표 사진 변경하기'}</span>
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => timetableInputRef.current?.click()}
                          disabled={isOcrLoading}
                          className={`w-full text-xs font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2 shadow-xs ${
                            isOcrLoading
                              ? 'bg-neutral-700 text-neutral-400 cursor-not-allowed'
                              : 'bg-neutral-900 text-white hover:bg-black active:scale-98'
                          }`}
                        >
                          {isOcrLoading ? (
                            <Loader2 className="w-4 h-4 animate-spin text-neutral-400" />
                          ) : (
                            <Upload className="w-4 h-4" style={{ color: accentColor }} />
                          )}
                          <span>{isOcrLoading ? '시간표 분석 중...' : '시간표 가져오기 / 사진 업로드'}</span>
                        </button>
                      )}
                    </div>
                    {/* OCR Loading Overlay */}
                    {isOcrLoading && (
                      <div className="p-4 bg-neutral-900 text-white rounded-2xl flex items-center gap-3 shadow-lg animate-pulse">
                        <Loader2 className="w-6 h-6 animate-spin text-emerald-400 shrink-0" />
                        <div>
                          <h5 className="text-xs font-bold">Google Gemini AI 분석 진행 중...</h5>
                          <p className="text-[11px] text-neutral-300 mt-0.5">시간표 이미지를 읽고 과목 및 강의 시간을 추출하고 있습니다.</p>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Sub-view: AI 센터 */}
                {activeSettingDetail === 'ai_center' && (() => {
                  const aiDocs = mediaList.filter((m) => m.type === 'document' || m.name.endsWith('.md'));
                  return (
                    <div className="space-y-3">
                      {/* AI Center Toolbar */}
                      <div className="bg-white p-3 rounded-2xl border border-neutral-200/80 shadow-2xs flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            title="검색"
                            onClick={() => showToast('검색 기능 준비 중입니다.')}
                            className="w-10 h-10 rounded-full bg-neutral-100 hover:bg-neutral-200/80 active:scale-95 text-neutral-700 transition-all flex items-center justify-center"
                          >
                            <Search className="w-5 h-5 text-neutral-700" />
                          </button>

                          <button
                            type="button"
                            title="필터"
                            onClick={() => showToast('필터 기능 준비 중입니다.')}
                            className="w-10 h-10 rounded-full bg-neutral-100 hover:bg-neutral-200/80 active:scale-95 text-neutral-700 transition-all flex items-center justify-center"
                          >
                            <Filter className="w-5 h-5 text-neutral-700" />
                          </button>

                          <button
                            type="button"
                            title="프로세스 현황 보기"
                            onClick={() => setActiveSettingDetail('ai_process')}
                            className="relative w-10 h-10 rounded-full bg-neutral-100 hover:bg-neutral-200/80 active:scale-95 text-neutral-700 transition-all flex items-center justify-center"
                          >
                            <Cpu className="w-5 h-5 text-neutral-700" />
                          </button>
                        </div>
                      </div>

                      {/* Selection Mode Notice Banner in AI Center */}
                      {isSelectionMode && (
                        <div className="bg-neutral-900 text-white border border-neutral-800 shadow-md rounded-2xl px-4 py-2.5 flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full bg-neutral-300 animate-pulse flex-shrink-0" />
                            <span className="font-bold text-xs text-white">{selectedAiDocs.length}개 문서 선택됨</span>
                          </div>
                          <button
                            onClick={() => {
                              setIsSelectionMode(false);
                              setSelectedItemIds([]);
                              showToast('선택 모드가 종료되었습니다.');
                            }}
                            className="text-xs font-bold text-neutral-300 hover:text-white px-2.5 py-1 rounded-lg transition-colors bg-white/10 hover:bg-white/20"
                          >
                            취소
                          </button>
                        </div>
                      )}

                      {/* AI Summary Markdown Files List */}
                      <div className="space-y-2.5">
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
                          {aiDocs.length === 0 ? (
                            <div className="p-8 bg-white rounded-2xl border border-neutral-200/80 text-center text-xs text-neutral-500">
                              저장된 AI 마크다운 문서가 없습니다.
                            </div>
                          ) : (
                            aiDocs.map((doc) => {
                              const isSelected = selectedItemIds.includes(doc.id);
                              return (
                                <HoldableFileCard
                                  key={doc.id}
                                  isSelectionMode={isSelectionMode}
                                  onSelect={() => handleFileHoldSelect(doc.id)}
                                  onClickNormal={() => {
                                    setPreviewDoc(doc);
                                  }}
                                  className={`p-3.5 sm:p-4 rounded-2xl border transition-all flex items-center justify-between cursor-pointer active:scale-[0.99] group ${
                                    isSelected
                                      ? 'border-neutral-900 bg-neutral-100/90 shadow-xs'
                                      : 'bg-white border-neutral-200/80 shadow-2xs hover:border-neutral-400 hover:shadow-sm'
                                  }`}
                                >
                                  <div className="flex items-center gap-3 min-w-0 flex-1">
                                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-neutral-900 to-neutral-800 text-amber-300 flex items-center justify-center shrink-0 shadow-xs group-hover:scale-105 transition-transform">
                                      <Sparkles className="w-4 h-4" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-1.5">
                                        <h4 className="text-xs sm:text-sm font-bold text-neutral-900 leading-snug truncate">
                                          {doc.name}
                                        </h4>
                                        <span className="px-1.5 py-0.2 rounded-md bg-neutral-100 border border-neutral-200 text-[10px] font-bold text-neutral-600 shrink-0">
                                          MD
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-2 text-[11px] text-neutral-400 mt-1">
                                        <span>
                                          {doc.timestamp instanceof Date
                                            ? doc.timestamp.toLocaleString('ko-KR', {
                                                month: '2-digit',
                                                day: '2-digit',
                                                hour: '2-digit',
                                                minute: '2-digit',
                                              })
                                            : String(doc.timestamp || '방금 전')}
                                        </span>
                                        {doc.fileSize && (
                                          <>
                                            <span>•</span>
                                            <span>{doc.fileSize}</span>
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                </HoldableFileCard>
                              );
                            })
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Sub-view: AI 프로세스 현황 */}
                {activeSettingDetail === 'ai_process' && (
                  <div className="space-y-4">
                    {/* Section 1: 진행 중인 AI 정리 세션 */}
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between px-1">
                        <span className="text-xs font-bold text-neutral-500 uppercase tracking-wider">
                          진행 중인 AI 정리 ({aiSessions.filter((s) => s.status !== 'completed').length})
                        </span>
                      </div>

                      {aiSessions.filter((s) => s.status !== 'completed').length === 0 ? (
                        <div className="p-6 bg-white rounded-2xl border border-neutral-200/80 text-center space-y-2">
                          <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
                          <p className="text-xs font-bold text-neutral-700">현재 진행 중인 AI 정리 작업이 없습니다.</p>
                          <p className="text-[11px] text-neutral-400">
                            사진이나 음성 자료를 선택하고 AI 요약을 실행하면 이곳에서 실시간 경과를 확인할 수 있습니다.
                          </p>
                        </div>
                      ) : (
                        aiSessions
                          .filter((s) => s.status !== 'completed')
                          .map((session) => (
                            <div
                              key={session.id}
                              className="bg-white p-4 rounded-2xl border border-neutral-200 shadow-2xs space-y-3 relative overflow-hidden"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                  <span className="w-2 h-2 rounded-full bg-neutral-900 shrink-0" />
                                  <h4 className="text-sm font-bold text-neutral-900 leading-snug truncate">
                                    {session.title}
                                  </h4>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <span className="text-xs font-extrabold text-neutral-800 bg-neutral-100 px-2.5 py-1 rounded-full border border-neutral-200 shrink-0">
                                    {session.progress}%
                                  </span>
                                  <button
                                    onClick={() => {
                                      cancelledSessionsRef.current.add(session.id);
                                      setAiSessions((prev) => prev.filter((s) => s.id !== session.id));
                                      showToast(`'${session.title}' AI 정리 세션이 취소되었습니다.`);
                                    }}
                                    className="text-xs font-bold text-neutral-600 hover:text-rose-600 bg-neutral-100 hover:bg-rose-50 px-2.5 py-1 rounded-full border border-neutral-200/80 transition-colors active:scale-95 cursor-pointer flex items-center gap-1"
                                    title="AI 정리 취소"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                    <span>{session.status === 'error' ? '닫기' : '취소'}</span>
                                  </button>
                                </div>
                              </div>

                              {/* Progress bar */}
                              <div className="w-full h-2.5 bg-neutral-100 rounded-full overflow-hidden">
                                <motion.div
                                  className="h-full bg-neutral-900"
                                  initial={{ width: 0 }}
                                  animate={{ width: `${session.progress}%` }}
                                  transition={{ duration: 0.5 }}
                                />
                              </div>
                            </div>
                          ))
                      )}
                    </div>
                  </div>
                )}

                {/* Sub-view: 환경설정 */}
                {activeSettingDetail === 'settings' && (
                  <div className="space-y-3">
                    <div className="bg-white p-5 rounded-2xl border border-neutral-200/80 shadow-2xs space-y-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-neutral-500/10 text-neutral-700 flex items-center justify-center">
                          <SlidersHorizontal className="w-5 h-5" />
                        </div>
                        <div>
                          <h4 className="text-sm font-bold text-neutral-900">환경설정</h4>
                          <p className="text-[11px] text-neutral-400">시스템 옵션 및 API 연동</p>
                        </div>
                      </div>

                      <div className="space-y-2 pt-2 border-t border-neutral-100">
                        <label className="text-xs font-bold text-neutral-800 block">Gemini API Key</label>
                        <p className="text-[11px] text-neutral-500 mb-2">시간표 자동 인식을 위해 Google Gemini API Key가 필요합니다.</p>
                        <input
                          type="password"
                          value={geminiApiKey}
                          onChange={(e) => setGeminiApiKey(e.target.value)}
                          placeholder="AIzaSy..."
                          className="w-full bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-2.5 text-xs text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent transition-all"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Sub-view: 앱 설명 */}
                {activeSettingDetail === 'about' && (
                  <div className="space-y-3">
                    <div className="bg-white p-5 rounded-2xl border border-neutral-200/80 shadow-2xs space-y-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-600 flex items-center justify-center">
                          <Info className="w-5 h-5" />
                        </div>
                        <div>
                          <h4 className="text-sm font-bold text-neutral-900">Vault Camera & Audio v1.2.0</h4>
                          <p className="text-[11px] text-neutral-400">자동 파일 분류 시스템</p>
                        </div>
                      </div>

                      <div className="text-xs text-neutral-600 space-y-2 leading-relaxed border-t border-neutral-100 pt-3">
                        <p className="font-semibold text-neutral-900">
                          Vault 시스템은 사진 촬영 시각 및 녹음 시각에 따라 파일을 규칙적으로 자동 저장하는 스마트 앨범입니다.
                        </p>
                        <div className="bg-neutral-50 p-3 rounded-xl border border-neutral-200/60 space-y-1 text-[11px]">
                          <p className="font-bold text-neutral-800">📁 폴더 구조 규칙 (디폴트 모드)</p>
                          <p className="text-neutral-600">연도 → 상하반기 (1~6월 / 7~12월) → 달 → 일</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>


            </motion.div>
          )}
        </AnimatePresence>

        {/* Photo View Modal */}
        <AnimatePresence>
          {previewPhoto && (
            <motion.div
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.2 }}
              className="absolute inset-0 z-50 bg-black/95 backdrop-blur-md p-4 flex flex-col items-center justify-between"
            >
              <div className="w-full flex items-center justify-between text-white py-3 px-4">
                <span className="text-xs font-bold truncate max-w-[220px]">{previewPhoto.name}</span>
                <button
                  onClick={() => setPreviewPhoto(null)}
                  className="w-8 h-8 rounded-full bg-neutral-800/80 hover:bg-neutral-700 flex items-center justify-center text-white transition-all active:scale-90"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {previewPhoto.dataUrl && (
                <div className="flex-1 w-full flex items-center justify-center py-4 overflow-hidden">
                  <img
                    src={previewPhoto.dataUrl}
                    alt={previewPhoto.name}
                    className="max-h-full max-w-full object-contain rounded-2xl border border-white/20 shadow-2xl"
                  />
                </div>
              )}

              <div className="w-full text-center pb-6 text-[11px] text-neutral-400">
                <p>촬영 일시: {new Date(previewPhoto.timestamp).toLocaleString('ko-KR')}</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Document Preview Modal (iOS Design System) */}
        <AnimatePresence>
          {previewDoc && (
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 30 }}
              transition={{ type: 'spring', damping: 25, stiffness: 220 }}
              className="absolute inset-0 z-50 bg-[#F7F7F8] text-neutral-900 flex flex-col justify-between overflow-hidden font-sans select-none"
            >
              {/* iOS Top Navigation Header */}
              <div className="py-3 px-5 bg-white border-b border-neutral-200/80 flex items-center justify-between shadow-2xs flex-shrink-0">
                <button
                  onClick={() => setPreviewDoc(null)}
                  className="w-9 h-9 rounded-full bg-[#EFEFEF] hover:bg-[#E2E2E2] flex items-center justify-center text-neutral-700 active:scale-95 transition-transform"
                  title="뒤로가기"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>

                <div className="flex items-center gap-2 max-w-[200px] sm:max-w-md truncate">
                  <div className="w-6 h-6 rounded-lg bg-neutral-100 border border-neutral-200 flex items-center justify-center shrink-0">
                    <Sparkles className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                  </div>
                  <h3 className="text-sm sm:text-base font-bold text-neutral-900 truncate">
                    {previewDoc.name}
                  </h3>
                </div>

                <button
                  onClick={() => setPreviewDoc(null)}
                  className="w-9 h-9 rounded-full bg-[#EFEFEF] hover:bg-[#E2E2E2] flex items-center justify-center text-neutral-700 active:scale-95 transition-transform"
                  title="닫기"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Main Markdown Body with MarkdownViewer */}
              <div className="p-3 sm:p-5 flex-1 overflow-hidden flex flex-col min-h-0">
                {(() => {
                  const docKey = previewDoc.id.replace('ai_doc_', 'doc_');
                  const content =
                    localStorage.getItem(docKey) ||
                    localStorage.getItem(previewDoc.id) ||
                    (previewDoc as any).content ||
                    '# 요약 문서 내용이 없습니다.\n\n문서의 내용을 불러올 수 없습니다.';

                  return (
                    <MarkdownViewer
                      content={content}
                      title={previewDoc.name}
                      timestamp={previewDoc.timestamp}
                      fileSize={previewDoc.fileSize}
                      sourceFiles={previewDoc.sourceFileNames}
                      accentColor={accentColor}
                      showToast={showToast}
                    />
                  );
                })()}
              </div>

              {/* iOS Bottom Action Bar */}
              <div className="p-4 bg-white border-t border-neutral-200/80 flex items-center gap-3 shadow-2xs flex-shrink-0">
                <button
                  onClick={() => {
                    const docKey = previewDoc.id.replace('ai_doc_', 'doc_');
                    localStorage.removeItem(docKey);
                    localStorage.removeItem(previewDoc.id);
                    setMediaList((prev) => {
                      const updated = prev.filter((item) => item.id !== previewDoc.id);
                      const aiOnly = updated.filter((item) => item.type === 'document' || item.name.endsWith('.md'));
                      try {
                        localStorage.setItem('lecture_snap_ai_docs', JSON.stringify(aiOnly));
                      } catch (e) {
                        console.error(e);
                      }
                      return updated;
                    });
                    setPreviewDoc(null);
                    showToast('AI 센터에서 마크다운 문서가 삭제되었습니다.');
                  }}
                  className="flex-1 py-3 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200/80 rounded-2xl text-xs font-bold transition-all active:scale-95 flex items-center justify-center gap-1.5 shadow-2xs"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>문서 삭제</span>
                </button>

                <button
                  onClick={() => setPreviewDoc(null)}
                  className="flex-1 py-3 bg-neutral-900 hover:bg-black text-white rounded-2xl text-xs font-bold transition-all active:scale-95 shadow-xs"
                >
                  닫기
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* '여기에 추가하시겠습니까?' Confirm Dialog Modal */}
        <AnimatePresence>
          {showAddConfirmModal && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-6"
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                className="bg-white rounded-3xl p-6 shadow-2xl max-w-xs w-full text-center border border-neutral-100"
              >
                <div className="w-12 h-12 rounded-2xl bg-black text-white flex items-center justify-center mx-auto mb-3 shadow-md">
                  <Plus className="w-6 h-6 stroke-[2.5]" />
                </div>

                <h3 className="text-base font-bold text-neutral-900">
                  여기에 추가하시겠습니까?
                </h3>

                <p className="text-xs text-neutral-500 mt-2 leading-relaxed">
                  {pendingImportFiles.length > 0 ? (
                    <>
                      <span className="font-semibold text-neutral-800">
                        {pendingImportFiles.length === 1
                          ? `[${pendingImportFiles[0].name}]`
                          : `[${pendingImportFiles[0].name}] 외 ${pendingImportFiles.length - 1}개`}
                      </span>
                      <br />
                      선택한 {pendingImportFiles.length}개 파일을 현재 폴더에 저장합니다.
                    </>
                  ) : (
                    '불러온 파일들을 현재 위치의 폴더에 저장합니다.'
                  )}
                </p>

                <div className="flex items-center gap-2.5 mt-5">
                  <button
                    onClick={() => setShowAddConfirmModal(false)}
                    className="flex-1 py-2.5 rounded-xl bg-[#F2F2F7] hover:bg-neutral-200 text-neutral-700 text-xs font-bold transition-all active:scale-95"
                  >
                    아니오
                  </button>
                  <button
                    onClick={handleConfirmSaveToFolder}
                    className="flex-1 py-2.5 rounded-xl bg-black hover:bg-neutral-800 text-white text-xs font-bold transition-all active:scale-95 shadow-xs"
                  >
                    예
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Multi-Selection Mode Bottom Floating Action Toolbar */}
        <AnimatePresence>
          {isSelectionMode && (
            <motion.div
              initial={{ y: 80, opacity: 0, x: '-50%' }}
              animate={{ y: 0, opacity: 1, x: '-50%' }}
              exit={{ y: 80, opacity: 0, x: '-50%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="absolute bottom-6 left-1/2 z-[65]"
            >
              <div className="bg-white/95 backdrop-blur-xl border border-neutral-200/90 text-neutral-800 shadow-2xl rounded-full px-4 py-2.5 flex items-center justify-center gap-3.5">
                {/* 1. 다운로드 버튼 */}
                <button
                  onClick={() => {
                    const count = activeSettingDetail === 'ai_center' ? selectedAiDocs.length : selectedExplorerFiles.length;
                    if (count === 0) {
                      showToast('선택된 항목이 없습니다.');
                    } else {
                      showToast(`${count}개 항목 다운로드 시작`);
                    }
                  }}
                  className="w-11 h-11 rounded-full bg-neutral-100 border-2 border-neutral-200 ring-2 ring-neutral-200/60 text-neutral-800 hover:bg-neutral-200 active:scale-90 transition-all flex items-center justify-center shadow-md"
                  title="다운로드"
                >
                  <Download className="w-5 h-5 stroke-[2]" />
                </button>

                {/* 2. AI 버튼 (AI 센터가 아닐 때만 노출) */}
                {activeSettingDetail !== 'ai_center' && (
                  <button
                    onClick={() => {
                      if (selectedExplorerFiles.length === 0) {
                        showToast('선택된 항목이 없습니다.');
                      } else {
                        startAiSummaryProcess();
                      }
                    }}
                    className="w-11 h-11 rounded-full bg-neutral-900 border-2 border-neutral-800 ring-2 ring-neutral-700/60 text-white hover:bg-black active:scale-90 transition-all flex items-center justify-center shadow-md"
                    title="AI 스마트 요약"
                  >
                    <Sparkles className="w-5 h-5 stroke-[2]" style={{ color: accentColor }} />
                  </button>
                )}

                {/* 2.5 이름 바꾸기 버튼 (AI 센터이거나 AI 문서가 선택되었을 때) */}
                {(activeSettingDetail === 'ai_center' || hasSelectedAiDocs) && (
                  <button
                    disabled={selectedAiDocs.length > 1}
                    onClick={() => {
                      if (selectedAiDocs.length > 1) {
                        showToast('2개 이상 선택된 경우 이름 바꾸기를 할 수 없습니다.');
                        return;
                      }
                      if (selectedAiDocs.length === 0) {
                        showToast('선택된 AI 문서가 없습니다.');
                      } else {
                        setRenameModalItem(selectedAiDocs[0]);
                        setNewDocName(selectedAiDocs[0].name);
                      }
                    }}
                    className={`w-11 h-11 rounded-full transition-all flex items-center justify-center ${
                      selectedAiDocs.length > 1
                        ? 'bg-neutral-100/60 border-2 border-neutral-200/50 ring-2 ring-neutral-200/30 text-neutral-300 cursor-not-allowed'
                        : 'bg-neutral-100 border-2 border-neutral-200 ring-2 ring-neutral-200/60 text-neutral-800 hover:bg-neutral-200 active:scale-90 shadow-md'
                    }`}
                    title={selectedAiDocs.length > 1 ? '1개의 문서만 선택 시 이용 가능' : '이름 바꾸기'}
                  >
                    <Pencil className="w-5 h-5 stroke-[2]" />
                  </button>
                )}

                {/* 2.6 정보 보기 버튼 (AI 센터이거나 AI 문서가 선택되었을 때) */}
                {(activeSettingDetail === 'ai_center' || hasSelectedAiDocs) && (
                  <button
                    disabled={selectedAiDocs.length > 1}
                    onClick={() => {
                      if (selectedAiDocs.length > 1) {
                        showToast('2개 이상 선택된 경우 정보 보기를 할 수 없습니다.');
                        return;
                      }
                      if (selectedAiDocs.length === 0) {
                        showToast('선택된 AI 문서가 없습니다.');
                      } else {
                        setInfoModalItem(selectedAiDocs[0]);
                      }
                    }}
                    className={`w-11 h-11 rounded-full transition-all flex items-center justify-center ${
                      selectedAiDocs.length > 1
                        ? 'bg-neutral-100/60 border-2 border-neutral-200/50 ring-2 ring-neutral-200/30 text-neutral-300 cursor-not-allowed'
                        : 'bg-neutral-100 border-2 border-neutral-200 ring-2 ring-neutral-200/60 text-neutral-800 hover:bg-neutral-200 active:scale-90 shadow-md'
                    }`}
                    title={selectedAiDocs.length > 1 ? '1개의 문서만 선택 시 이용 가능' : '정보 보기'}
                  >
                    <Info className="w-5 h-5 stroke-[2]" />
                  </button>
                )}

                {/* 3. 삭제 버튼 */}
                <button
                  onClick={() => {
                    const isAiCenter = activeSettingDetail === 'ai_center';
                    const targetItems = isAiCenter ? selectedAiDocs : selectedExplorerFiles;
                    if (targetItems.length === 0) {
                      showToast('선택된 항목이 없습니다.');
                    } else {
                      const targetIds = targetItems.map((item) => item.id);
                      targetIds.forEach((id) => {
                        const docKey = id.replace('ai_doc_', 'doc_');
                        localStorage.removeItem(docKey);
                        localStorage.removeItem(id);
                      });
                      setMediaList((prev) => {
                        const updated = prev.filter((item) => !targetIds.includes(item.id));
                        const aiOnly = updated.filter((item) => item.type === 'document' || item.name.endsWith('.md'));
                        try {
                          localStorage.setItem('lecture_snap_ai_docs', JSON.stringify(aiOnly));
                        } catch (e) {
                          console.error(e);
                        }
                        return updated;
                      });
                      setSelectedItemIds((prev) => prev.filter((id) => !targetIds.includes(id)));
                      showToast(`${targetIds.length}개 항목이 삭제되었습니다.`);
                    }
                  }}
                  className="w-11 h-11 rounded-full bg-rose-50 border-2 border-rose-200 ring-2 ring-rose-200/60 text-rose-500 hover:bg-rose-100 active:scale-90 transition-all flex items-center justify-center shadow-md"
                  title="삭제"
                >
                  <Trash2 className="w-5 h-5 stroke-[2]" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* AI Starting Bubble (Appears for ~2 seconds then disappears automatically) */}
        <AnimatePresence>
          {isAiStartingBubbleOpen && (
            <div className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-xs pointer-events-none">
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: -10 }}
                transition={{ type: 'spring', damping: 25, stiffness: 350 }}
                className="pointer-events-auto bg-[#F2F2F7] text-neutral-900 border border-black/[0.06] shadow-2xl rounded-[28px] px-6 py-7 max-w-xs w-full relative overflow-hidden flex flex-col items-center text-center space-y-4"
              >
                <div className="w-16 h-16 rounded-[22px] bg-[#18181A] shadow-lg shadow-black/10 flex items-center justify-center mx-auto">
                  <Brain className="w-8 h-8 text-[#FFE195] stroke-[1.8]" />
                </div>

                <div className="space-y-1.5 pt-1">
                  <h4 className="font-bold text-[#1C1C1E] text-[15px] tracking-tight">
                    AI 정리를 시작합니다...
                  </h4>
                  <p className="text-xs text-[#8E8E93] font-medium">
                    AI 정리가 완료되면 알려드릴게요!
                  </p>
                </div>

                {/* Animated 2-second progress bar */}
                <div className="w-full bg-[#E5E5EA] h-[5px] rounded-full overflow-hidden mt-2">
                  <motion.div
                    className="bg-[#18181A] h-full rounded-full"
                    initial={{ width: '0%' }}
                    animate={{ width: '100%' }}
                    transition={{ duration: 2.0, ease: 'linear' }}
                  />
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
        {/* AI Document Rename Modal */}
        <AnimatePresence>
          {renameModalItem && (
            <div className="absolute inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                className="bg-white w-full max-w-sm rounded-2xl p-5 shadow-2xl border border-neutral-200 space-y-4"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-neutral-100 text-neutral-800 flex items-center justify-center font-bold">
                      <Pencil className="w-4 h-4" />
                    </div>
                    <h3 className="text-base font-bold text-neutral-900">문서 이름 바꾸기</h3>
                  </div>
                  <button
                    onClick={() => setRenameModalItem(null)}
                    className="w-8 h-8 rounded-full bg-neutral-100 hover:bg-neutral-200 text-neutral-500 flex items-center justify-center"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-neutral-500 mb-1.5">
                    새 문서 이름
                  </label>
                  <input
                    type="text"
                    value={newDocName}
                    onChange={(e) => setNewDocName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleSaveNewName();
                      }
                    }}
                    placeholder="문서 이름을 입력하세요"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-neutral-300 focus:border-neutral-900 focus:outline-none text-sm text-neutral-900 font-medium"
                    autoFocus
                  />
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={() => setRenameModalItem(null)}
                    className="flex-1 py-2.5 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-xs font-bold transition-all"
                  >
                    취소
                  </button>
                  <button
                    onClick={handleSaveNewName}
                    className="flex-1 py-2.5 rounded-xl bg-neutral-900 hover:bg-black text-white text-xs font-bold transition-all shadow-xs"
                  >
                    저장
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* AI Document Info Modal */}
        <AnimatePresence>
          {infoModalItem && (
            <div className="absolute inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                className="bg-white w-full max-w-sm rounded-2xl p-5 shadow-2xl border border-neutral-200 flex flex-col max-h-[82vh]"
              >
                {/* Fixed Header */}
                <div className="flex items-center justify-between border-b border-neutral-100 pb-3 flex-shrink-0">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-neutral-100 text-neutral-800 flex items-center justify-center font-bold">
                      <Info className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-neutral-900">문서 정보</h3>
                      <p className="text-[11px] text-neutral-400">상세 메타데이터 프로필</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setInfoModalItem(null)}
                    className="w-8 h-8 rounded-full bg-neutral-100 hover:bg-neutral-200 text-neutral-500 flex items-center justify-center"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto space-y-2.5 text-xs py-3 pr-1 my-1">
                  <div className="p-3 bg-neutral-50 rounded-xl space-y-1 border border-neutral-100">
                    <span className="text-[11px] font-semibold text-neutral-400 block mb-0.5">문서명</span>
                    <span className="font-bold text-neutral-900 break-all text-sm leading-snug">{infoModalItem.name}</span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-100">
                      <span className="text-[11px] font-semibold text-neutral-400 block mb-0.5">종류</span>
                      <span className="font-bold text-neutral-800">AI 마크다운 (.md)</span>
                    </div>
                    <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-100">
                      <span className="text-[11px] font-semibold text-neutral-400 block mb-0.5">파일 크기</span>
                      <span className="font-bold text-neutral-800">{infoModalItem.fileSize || '3.8 KB'}</span>
                    </div>
                  </div>

                  <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-100 space-y-0.5">
                    <span className="text-[11px] font-semibold text-neutral-400 block">생성 / 저장 일시</span>
                    <span className="font-bold text-neutral-800">
                      {infoModalItem.timestamp instanceof Date
                        ? infoModalItem.timestamp.toLocaleString('ko-KR', {
                            year: 'numeric',
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })
                        : String(infoModalItem.timestamp || '방금 전')}
                    </span>
                  </div>

                  <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-100 space-y-0.5">
                    <span className="text-[11px] font-semibold text-neutral-400 block">저장 위치</span>
                    <span className="font-bold text-neutral-900">AI 센터 Vault / 스마트 요약함</span>
                  </div>

                  {/* AI Source Files List */}
                  <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-200/80 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-neutral-900 flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-neutral-700" />
                        생성 시 사용된 원본 파일
                      </span>
                      <span className="text-[10px] font-bold text-neutral-700 bg-neutral-200/60 px-2 py-0.5 rounded-full">
                        총 {(infoModalItem.sourceFileNames || ['강의_사진_162000.jpg', '강의_음성녹음_01.m4a']).length}개
                      </span>
                    </div>
                    <div className="space-y-1.5 pt-0.5">
                      {(infoModalItem.sourceFileNames && infoModalItem.sourceFileNames.length > 0
                        ? infoModalItem.sourceFileNames
                        : ['강의_사진_162000.jpg', '강의_음성녹음_01.m4a']
                      ).map((fileName, idx) => {
                        const fnLower = fileName.toLowerCase();
                        const isAudio = fnLower.endsWith('.m4a') || fnLower.endsWith('.mp3') || fnLower.includes('녹음') || fnLower.includes('음성');
                        const isImg = fnLower.endsWith('.jpg') || fnLower.endsWith('.png') || fnLower.endsWith('.jpeg') || fnLower.includes('사진') || fnLower.includes('판서');
                        return (
                          <div
                            key={idx}
                            className="flex items-center gap-2 p-2 bg-white rounded-lg border border-neutral-200/80 shadow-2xs"
                          >
                            <div className="w-6 h-6 rounded-md bg-neutral-100 flex items-center justify-center text-neutral-700 flex-shrink-0">
                              {isAudio ? (
                                <FileAudio className="w-3.5 h-3.5" />
                              ) : isImg ? (
                                <ImageIcon className="w-3.5 h-3.5" />
                              ) : (
                                <FileText className="w-3.5 h-3.5" />
                              )}
                            </div>
                            <span className="text-xs font-semibold text-neutral-800 truncate flex-1">{fileName}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Fixed Footer */}
                <div className="pt-2 flex-shrink-0 border-t border-neutral-100">
                  <button
                    onClick={() => setInfoModalItem(null)}
                    className="w-full py-2.5 rounded-xl bg-neutral-900 hover:bg-black text-white text-xs font-bold transition-all shadow-xs"
                  >
                    확인
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </motion.div>
    </AnimatePresence>
  );
};
