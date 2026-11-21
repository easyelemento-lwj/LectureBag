import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Sparkles,
  X,
  FileText,
  ImageIcon,
  Mic,
  Copy,
  Check,
  Bookmark,
  Send,
  RefreshCw,
  Tag,
  ListCheck,
  Zap,
  ChevronRight,
  BrainCircuit,
  MessageSquare,
} from 'lucide-react';
import { MediaFile } from '../types';

interface AiSummaryBubbleModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedFiles: MediaFile[];
  accentColor?: string;
  showToast?: (msg: string) => void;
  onAutoSave?: (summaryTitle: string, targetTimestamps: Date[]) => void;
}

export const AiSummaryBubbleModal: React.FC<AiSummaryBubbleModalProps> = ({
  isOpen,
  onClose,
  selectedFiles,
  accentColor = '#E3FF00',
  showToast,
  onAutoSave,
}) => {
  const [isLoading, setIsLoading] = useState(true);
  const [loadingStep, setLoadingStep] = useState(0);
  const [activeTab, setActiveTab] = useState<'summary' | 'bullets' | 'actions'>('summary');
  const [copied, setCopied] = useState(false);
  const [customPrompt, setCustomPrompt] = useState('');
  const [chatMessages, setChatMessages] = useState<Array<{ role: 'user' | 'ai'; text: string }>>([]);
  const [isAnswering, setIsAnswering] = useState(false);

  // Group file counts by type
  const photoCount = selectedFiles.filter((f) => f.type === 'photo').length;
  const audioCount = selectedFiles.filter((f) => f.type === 'audio').length;
  const docCount = selectedFiles.filter((f) => f.type === 'document').length;

  // Extract unique folder dates/locations from selected files
  const fileTimestamps = selectedFiles
    .map((f) => (f.timestamp ? new Date(f.timestamp) : null))
    .filter((d): d is Date => d !== null);

  const uniqueDateLabels = Array.from(
    new Set(
      fileTimestamps.map((d) =>
        d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })
      )
    )
  );
  const isMultiFolder = uniqueDateLabels.length > 1;

  useEffect(() => {
    if (isOpen) {
      setIsLoading(true);
      setLoadingStep(0);
      setChatMessages([]);
      setCustomPrompt('');

      const timer1 = setTimeout(() => setLoadingStep(1), 400);
      const timer2 = setTimeout(() => setLoadingStep(2), 800);
      const timer3 = setTimeout(() => {
        setLoadingStep(3);
        setIsLoading(false);
      }, 1200);

      return () => {
        clearTimeout(timer1);
        clearTimeout(timer2);
        clearTimeout(timer3);
      };
    }
  }, [isOpen, selectedFiles]);

  const handleCopy = () => {
    const summaryText = `[AI 스마트 파일 요약]\n선택된 파일: ${selectedFiles.map((f) => f.name).join(', ')}\n\n• 주요 내용: 선택한 ${selectedFiles.length}개 파일의 주요 핵심 내용이 정리되었습니다.\n• 관련 키워드: #강의요약 #핵심정리 #스마트폴더`;
    navigator.clipboard.writeText(summaryText);
    setCopied(true);
    if (showToast) showToast('요약 내용이 클립보드에 복사되었습니다.');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAskAi = (promptText?: string) => {
    const q = promptText || customPrompt;
    if (!q.trim()) return;

    const userMsg = q;
    setChatMessages((prev) => [...prev, { role: 'user', text: userMsg }]);
    if (!promptText) setCustomPrompt('');
    setIsAnswering(true);

    setTimeout(() => {
      let answer = `'${userMsg}' 요청에 따른 분석 결과입니다: `;
      if (userMsg.includes('3줄')) {
        answer = `1. 선택된 ${selectedFiles.length}개 파일의 핵심 개념을 통합 분석했습니다.\n2. 중요 일정 및 관련 과제 항목 2건이 추출되었습니다.\n3. 핵심 녹음 파일 및 문서 데이터가 복습 노트에 자동 연동되었습니다.`;
      } else if (userMsg.includes('시험') || userMsg.includes('문제')) {
        answer = `📝 예상 시험 문제:\nQ1. 선택된 강의 노터의 주요 메인 프로세스는 무엇인가?\nQ2. 녹음 파일 12분 지점에서 강조된 3가지 핵심 규칙을 설명하시오.`;
      } else {
        answer = `선택하신 ${selectedFiles.map((f) => f.name).join(', ')} 파일 데이터를 바탕으로 답변을 구성했습니다. 추가 정리가 필요하시면 알려주세요!`;
      }

      setChatMessages((prev) => [...prev, { role: 'ai', text: answer }]);
      setIsAnswering(false);
    }, 800);
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 30 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 30 }}
          transition={{ type: 'spring', damping: 25, stiffness: 350 }}
          className="w-full max-w-lg bg-white/95 backdrop-blur-2xl border border-neutral-200/90 shadow-2xl rounded-3xl overflow-hidden flex flex-col max-h-[88vh]"
        >
          {/* Header */}
          <div className="p-4 sm:p-5 pb-3 border-b border-neutral-100 flex items-center justify-between bg-gradient-to-r from-neutral-900 via-neutral-800 to-neutral-900 text-white relative overflow-hidden">
            <div className="absolute -right-8 -top-8 w-28 h-28 bg-white/10 rounded-full blur-xl pointer-events-none" />
            <div className="flex items-center gap-3 z-10">
              <div className="w-10 h-10 rounded-2xl bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center shadow-inner">
                <Sparkles className="w-5 h-5 animate-pulse" style={{ color: accentColor }} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-base text-white">AI 스마트 파일 요약</h3>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-white/20 text-white backdrop-blur-xs border border-white/20">
                    {selectedFiles.length}개 선택됨
                  </span>
                </div>
                <p className="text-[11px] text-neutral-300 mt-0.5">
                  선택한 파일의 핵심 정보와 핵심 요점을 AI가 자동으로 분석합니다.
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-all active:scale-90 z-10"
              title="닫기"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Selected File Badges Bar */}
          <div className="px-4 py-2.5 bg-neutral-50/80 border-b border-neutral-100 flex items-center gap-2 overflow-x-auto scrollbar-none">
            <span className="text-[10px] font-bold text-neutral-400 flex-shrink-0">분석 대상:</span>
            {photoCount > 0 && (
              <span className="px-2.5 py-1 rounded-xl bg-amber-50 border border-amber-200/70 text-amber-700 text-[11px] font-semibold flex items-center gap-1 flex-shrink-0">
                <ImageIcon className="w-3 h-3" /> 사진 {photoCount}개
              </span>
            )}
            {audioCount > 0 && (
              <span className="px-2.5 py-1 rounded-xl bg-neutral-100 border border-neutral-200 text-neutral-700 text-[11px] font-semibold flex items-center gap-1 flex-shrink-0">
                <Mic className="w-3 h-3" /> 녹음 {audioCount}개
              </span>
            )}
            {docCount > 0 && (
              <span className="px-2.5 py-1 rounded-xl bg-neutral-100 border border-neutral-200 text-neutral-700 text-[11px] font-semibold flex items-center gap-1 flex-shrink-0">
                <FileText className="w-3 h-3" /> 문서 {docCount}개
              </span>
            )}
            {selectedFiles.map((file) => (
              <span
                key={file.id}
                className="px-2.5 py-1 rounded-xl bg-white border border-neutral-200/80 text-neutral-700 text-[11px] font-medium truncate max-w-[140px] flex-shrink-0 shadow-2xs"
              >
                {file.name}
              </span>
            ))}
          </div>

          {/* Footer Actions */}
          <div className="p-3 sm:p-4 border-t border-neutral-100 bg-neutral-50/80 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <button
                onClick={handleCopy}
                className="flex-1 py-2.5 px-3 rounded-2xl bg-white hover:bg-neutral-100 border border-neutral-200 text-neutral-800 text-xs font-bold transition-all active:scale-95 flex items-center justify-center gap-1.5 shadow-2xs"
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-600" />
                    <span className="text-emerald-600">복사됨</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 text-neutral-600" />
                    <span>요약 복사</span>
                  </>
                )}
              </button>

              <button
                onClick={() => {
                  const summaryTitle = `[AI요약] ${selectedFiles[0]?.name || '파일'}${selectedFiles.length > 1 ? `_외_${selectedFiles.length - 1}개` : ''}`;
                  if (onAutoSave) {
                    onAutoSave(summaryTitle, fileTimestamps);
                  } else if (showToast) {
                    showToast('AI 센터에 AI 요약 마크다운(.md) 문서가 저장되었습니다.');
                  }
                  onClose();
                }}
                className="flex-1 py-2.5 px-3 rounded-2xl bg-neutral-900 hover:bg-black text-white text-xs font-bold transition-all active:scale-95 flex items-center justify-center gap-1.5 shadow-xs"
              >
                <Zap className="w-4 h-4 text-amber-300 fill-amber-300" />
                <span>AI 센터에 바로 저장</span>
              </button>
            </div>

            <div className="flex items-center justify-center gap-1 text-[10px] text-neutral-400 font-medium pt-0.5">
              <span>💡 생성된 AI 요약 마크다운(.md) 문서 파일은 모두 AI 센터에 자동 저장됩니다.</span>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
