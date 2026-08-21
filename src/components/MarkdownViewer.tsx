import React, { useState, useMemo } from 'react';
import {
  Copy,
  Check,
  Download,
  FileText,
  Sparkles,
  Info,
  AlertTriangle,
  AlertCircle,
  Flame,
  CheckSquare,
  Square,
  ExternalLink,
  Eye,
  FileCode2,
  Hash,
  Quote,
  Layers,
  Clock
} from 'lucide-react';

interface MarkdownViewerProps {
  content: string;
  title?: string;
  timestamp?: Date | string;
  fileSize?: string;
  sourceFiles?: string[];
  accentColor?: string;
  showToast?: (msg: string) => void;
}

export type FontSizeLevel = 'sm' | 'base' | 'lg';

// ── Inline Markdown Tokenizer & Renderer ──────────────────────────────────────
export const MarkdownInlineRenderer: React.FC<{ text: string }> = ({ text }) => {
  const elements = useMemo(() => {
    const tokens: React.ReactNode[] = [];
    let remaining = text;
    let keyIdx = 0;

    while (remaining.length > 0) {
      // 1. Inline code: `code`
      const codeMatch = remaining.match(/^`([^`]+)`/);
      if (codeMatch) {
        tokens.push(
          <code
            key={`code-${keyIdx++}`}
            className="px-1.5 py-0.5 mx-0.5 rounded-md bg-neutral-100 border border-neutral-200/90 text-neutral-900 font-mono text-[0.88em] font-semibold select-all"
          >
            {codeMatch[1]}
          </code>
        );
        remaining = remaining.slice(codeMatch[0].length);
        continue;
      }

      // 2. Bold text: **bold** or __bold__
      const boldMatch = remaining.match(/^(\*\*|__)(.*?)\1/);
      if (boldMatch) {
        tokens.push(
          <strong key={`bold-${keyIdx++}`} className="font-bold text-neutral-900 tracking-tight">
            <MarkdownInlineRenderer text={boldMatch[2]} />
          </strong>
        );
        remaining = remaining.slice(boldMatch[0].length);
        continue;
      }

      // 3. Strikethrough: ~~text~~
      const strikeMatch = remaining.match(/^~~(.*?)~~/);
      if (strikeMatch) {
        tokens.push(
          <del key={`strike-${keyIdx++}`} className="line-through text-neutral-400 opacity-90">
            <MarkdownInlineRenderer text={strikeMatch[1]} />
          </del>
        );
        remaining = remaining.slice(strikeMatch[0].length);
        continue;
      }

      // 4. Italic text: *italic* or _italic_
      const italicMatch = remaining.match(/^(\*|_)(.*?)\1/);
      if (italicMatch) {
        tokens.push(
          <em key={`italic-${keyIdx++}`} className="italic text-neutral-700">
            <MarkdownInlineRenderer text={italicMatch[2]} />
          </em>
        );
        remaining = remaining.slice(italicMatch[0].length);
        continue;
      }

      // 5. Markdown Links: [label](url)
      const linkMatch = remaining.match(/^\[(.*?)\]\((.*?)\)/);
      if (linkMatch) {
        tokens.push(
          <a
            key={`link-${keyIdx++}`}
            href={linkMatch[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 text-blue-600 hover:text-blue-700 underline underline-offset-2 hover:opacity-90 font-medium transition-colors"
          >
            {linkMatch[1]}
            <ExternalLink className="w-2.5 h-2.5 inline ml-0.5 opacity-70" />
          </a>
        );
        remaining = remaining.slice(linkMatch[0].length);
        continue;
      }

      // 6. Plain text until next special markdown symbol
      const nextSpecial = remaining.search(/[`\*_~\[]/);
      if (nextSpecial === -1) {
        tokens.push(remaining);
        break;
      } else if (nextSpecial === 0) {
        tokens.push(remaining[0]);
        remaining = remaining.slice(1);
      } else {
        tokens.push(remaining.slice(0, nextSpecial));
        remaining = remaining.slice(nextSpecial);
      }
    }

    return tokens;
  }, [text]);

  return <>{elements}</>;
};

// ── Code Block with Copy Button (macOS Terminal Card Style) ────────────────────
const CodeBlock: React.FC<{ code: string; language: string; fontLevel: FontSizeLevel }> = ({
  code,
  language,
  fontLevel,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const lineCount = code.trim().split('\n').length;

  const fontClass = useMemo(() => {
    switch (fontLevel) {
      case 'sm':
        return 'text-[11px] leading-relaxed';
      case 'lg':
        return 'text-[14.5px] leading-relaxed';
      case 'base':
      default:
        return 'text-[12.5px] leading-relaxed';
    }
  }, [fontLevel]);

  return (
    <div className="my-4 rounded-2xl bg-[#1C1C1E] border border-neutral-800 shadow-md overflow-hidden font-mono text-neutral-100">
      {/* Code Header Bar */}
      <div className="flex items-center justify-between px-3.5 py-2.5 bg-[#2C2C2E] border-b border-neutral-700/60 text-neutral-300 text-[11px]">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-[#FF5F56]" />
            <div className="w-2.5 h-2.5 rounded-full bg-[#FFBD2E]" />
            <div className="w-2.5 h-2.5 rounded-full bg-[#27C93F]" />
          </div>
          <span className="font-semibold text-neutral-200 ml-1.5 uppercase tracking-wider text-[10px]">
            {language || 'code'}
          </span>
          <span className="text-[10px] text-neutral-400">({lineCount} lines)</span>
        </div>

        <button
          onClick={handleCopy}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-neutral-100 transition-all active:scale-95 text-[11px] font-semibold"
          title="코드 복사"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-emerald-400 font-bold">복사됨</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5 text-neutral-300" />
              <span>복사</span>
            </>
          )}
        </button>
      </div>

      {/* Code Content */}
      <div className={`p-4 overflow-x-auto text-neutral-200 font-mono select-all ${fontClass}`}>
        <pre className="whitespace-pre">{code}</pre>
      </div>
    </div>
  );
};

// ── Markdown Table Component (iOS Clean Card Table) ───────────────────────────
const TableBlock: React.FC<{ rows: string[]; fontLevel: FontSizeLevel }> = ({ rows, fontLevel }) => {
  const parseRow = (rowStr: string) => {
    const trimmed = rowStr.trim().replace(/^\|/, '').replace(/\|$/, '');
    return trimmed.split('|').map((c) => c.trim());
  };

  if (rows.length < 2) return null;

  const headerCells = parseRow(rows[0]);
  const isSeparator = (str: string) => /^[:\-\|\s]+$/.test(str);
  const dataRows = rows.slice(1).filter((r) => !isSeparator(r));

  const tableFontClass = useMemo(() => {
    switch (fontLevel) {
      case 'sm':
        return 'text-[11.5px]';
      case 'lg':
        return 'text-[15px]';
      case 'base':
      default:
        return 'text-[13px]';
    }
  }, [fontLevel]);

  return (
    <div className="my-4 overflow-x-auto rounded-2xl border border-neutral-200/90 bg-white shadow-2xs">
      <table className={`w-full text-left border-collapse ${tableFontClass}`}>
        <thead>
          <tr className="bg-neutral-100/80 border-b border-neutral-200 text-neutral-800 font-bold">
            {headerCells.map((cell, idx) => (
              <th key={idx} className="py-2.5 px-3.5 font-bold tracking-tight">
                <MarkdownInlineRenderer text={cell} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100 text-neutral-700">
          {dataRows.map((row, rIdx) => {
            const cells = parseRow(row);
            return (
              <tr
                key={rIdx}
                className="hover:bg-neutral-50 transition-colors odd:bg-white even:bg-neutral-50/60"
              >
                {cells.map((cell, cIdx) => (
                  <td key={cIdx} className="py-2.5 px-3.5 leading-relaxed font-normal">
                    <MarkdownInlineRenderer text={cell} />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

// ── GitHub Style Alert / Callout Block (iOS Pastel Cards) ──────────────────────
const AlertCallout: React.FC<{ type: string; lines: string[]; fontLevel: FontSizeLevel }> = ({
  type,
  lines,
  fontLevel,
}) => {
  const config = useMemo(() => {
    switch (type.toUpperCase()) {
      case 'NOTE':
        return {
          icon: <Info className="w-4 h-4 text-blue-600 shrink-0" />,
          title: '참고 (Note)',
          borderColor: 'border-blue-200',
          bg: 'bg-blue-50/80',
          textColor: 'text-blue-950',
          titleColor: 'text-blue-700',
        };
      case 'TIP':
        return {
          icon: <Sparkles className="w-4 h-4 text-emerald-600 shrink-0" />,
          title: '핵심 팁 (Tip)',
          borderColor: 'border-emerald-200',
          bg: 'bg-emerald-50/80',
          textColor: 'text-emerald-950',
          titleColor: 'text-emerald-700',
        };
      case 'IMPORTANT':
        return {
          icon: <AlertCircle className="w-4 h-4 text-purple-600 shrink-0" />,
          title: '중요 (Important)',
          borderColor: 'border-purple-200',
          bg: 'bg-purple-50/80',
          textColor: 'text-purple-950',
          titleColor: 'text-purple-700',
        };
      case 'WARNING':
        return {
          icon: <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />,
          title: '주의 (Warning)',
          borderColor: 'border-amber-200',
          bg: 'bg-amber-50/80',
          textColor: 'text-amber-950',
          titleColor: 'text-amber-700',
        };
      case 'CAUTION':
        return {
          icon: <Flame className="w-4 h-4 text-rose-600 shrink-0" />,
          title: '경고 (Caution)',
          borderColor: 'border-rose-200',
          bg: 'bg-rose-50/80',
          textColor: 'text-rose-950',
          titleColor: 'text-rose-700',
        };
      default:
        return {
          icon: <Quote className="w-4 h-4 text-neutral-600 shrink-0" />,
          title: '인용',
          borderColor: 'border-neutral-200',
          bg: 'bg-neutral-50',
          textColor: 'text-neutral-800',
          titleColor: 'text-neutral-800',
        };
    }
  }, [type]);

  const bodyFontClass = useMemo(() => {
    switch (fontLevel) {
      case 'sm':
        return 'text-[12px] leading-relaxed';
      case 'lg':
        return 'text-[16px] leading-relaxed';
      case 'base':
      default:
        return 'text-[14px] leading-relaxed';
    }
  }, [fontLevel]);

  return (
    <div className={`my-3.5 p-4 rounded-2xl border ${config.borderColor} ${config.bg} shadow-2xs space-y-1.5`}>
      <div className="flex items-center gap-2 font-bold text-xs">
        {config.icon}
        <span className={`${config.titleColor} font-extrabold tracking-tight`}>{config.title}</span>
      </div>
      <div className={`space-y-1 ${config.textColor} pl-6 font-normal ${bodyFontClass}`}>
        {lines.map((l, i) => (
          <p key={i}>
            <MarkdownInlineRenderer text={l} />
          </p>
        ))}
      </div>
    </div>
  );
};

// ── Main Document Renderer (iOS Design System) ────────────────────────────────
export const MarkdownViewer: React.FC<MarkdownViewerProps> = ({
  content,
  title,
  timestamp,
  fileSize,
  sourceFiles = [],
  accentColor = '#E3FF00',
  showToast,
}) => {
  const [viewMode, setViewMode] = useState<'rendered' | 'raw'>('rendered');
  const [fontSizeLevel, setFontSizeLevel] = useState<FontSizeLevel>('base');
  const [copied, setCopied] = useState(false);

  // Character and word count
  const stats = useMemo(() => {
    const text = content.trim();
    const charCount = text.length;
    const wordCount = text ? text.split(/\s+/).length : 0;
    const readingTimeMin = Math.max(1, Math.ceil(wordCount / 200));
    return { charCount, wordCount, readingTimeMin };
  }, [content]);

  const handleCopyAll = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    if (showToast) showToast('전체 마크다운 내용이 복사되었습니다.');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadFile = () => {
    const fileName = title ? (title.endsWith('.md') ? title : `${title}.md`) : 'AI_요약문서.md';
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    if (showToast) showToast(`'${fileName}' 파일이 다운로드되었습니다.`);
  };

  // Font size typography styles depending on fontSizeLevel
  const fontStyles = useMemo(() => {
    switch (fontSizeLevel) {
      case 'sm':
        return {
          h1: 'text-lg sm:text-xl font-extrabold text-neutral-900',
          h2: 'text-base sm:text-lg font-bold text-neutral-900',
          h3: 'text-sm sm:text-base font-bold text-neutral-850',
          h4: 'text-xs sm:text-sm font-semibold text-neutral-800',
          body: 'text-[12.5px] leading-relaxed text-neutral-800',
          list: 'text-[12.5px] leading-relaxed text-neutral-800',
          quote: 'text-[12px] leading-relaxed text-neutral-700',
          raw: 'text-[11.5px] leading-relaxed',
        };
      case 'lg':
        return {
          h1: 'text-2xl sm:text-3xl font-extrabold text-neutral-900',
          h2: 'text-xl sm:text-2xl font-bold text-neutral-900',
          h3: 'text-lg sm:text-xl font-bold text-neutral-850',
          h4: 'text-base sm:text-lg font-semibold text-neutral-800',
          body: 'text-[17px] leading-relaxed text-neutral-800',
          list: 'text-[17px] leading-relaxed text-neutral-800',
          quote: 'text-[16px] leading-relaxed text-neutral-700',
          raw: 'text-[15px] leading-relaxed',
        };
      case 'base':
      default:
        return {
          h1: 'text-xl sm:text-2xl font-extrabold text-neutral-900',
          h2: 'text-lg sm:text-xl font-bold text-neutral-900',
          h3: 'text-base sm:text-lg font-bold text-neutral-850',
          h4: 'text-sm sm:text-base font-semibold text-neutral-800',
          body: 'text-[14.5px] leading-relaxed text-neutral-800',
          list: 'text-[14.5px] leading-relaxed text-neutral-800',
          quote: 'text-[14px] leading-relaxed text-neutral-700',
          raw: 'text-[13px] leading-relaxed',
        };
    }
  }, [fontSizeLevel]);

  // Parse lines into blocks with dynamic font styles
  const renderedBlocks = useMemo(() => {
    if (!content) return [];

    const lines = content.split('\n');
    const blocks: React.ReactNode[] = [];
    let i = 0;
    let blockKey = 0;

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      // 1. Empty lines
      if (trimmed === '') {
        i++;
        continue;
      }

      // 2. Fenced Code Block: ```lang
      if (trimmed.startsWith('```')) {
        const lang = trimmed.slice(3).trim();
        const codeLines: string[] = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith('```')) {
          codeLines.push(lines[i]);
          i++;
        }
        i++; // skip closing ```
        blocks.push(
          <CodeBlock
            key={`code-block-${blockKey++}`}
            code={codeLines.join('\n')}
            language={lang}
            fontLevel={fontSizeLevel}
          />
        );
        continue;
      }

      // 3. Table Block: lines starting with |
      if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
        const tableLines: string[] = [];
        while (i < lines.length && lines[i].trim().startsWith('|')) {
          tableLines.push(lines[i].trim());
          i++;
        }
        blocks.push(
          <TableBlock
            key={`table-${blockKey++}`}
            rows={tableLines}
            fontLevel={fontSizeLevel}
          />
        );
        continue;
      }

      // 4. GitHub Alerts & Blockquotes: > [!NOTE] or > quote
      if (trimmed.startsWith('>')) {
        const quoteLines: string[] = [];
        let alertType: string | null = null;

        while (i < lines.length && lines[i].trim().startsWith('>')) {
          const rawQuote = lines[i].trim().replace(/^>\s?/, '');
          if (quoteLines.length === 0) {
            const alertMatch = rawQuote.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i);
            if (alertMatch) {
              alertType = alertMatch[1];
              i++;
              continue;
            }
          }
          quoteLines.push(rawQuote);
          i++;
        }

        if (alertType) {
          blocks.push(
            <AlertCallout
              key={`alert-${blockKey++}`}
              type={alertType}
              lines={quoteLines}
              fontLevel={fontSizeLevel}
            />
          );
        } else {
          blocks.push(
            <div
              key={`quote-${blockKey++}`}
              className={`my-3.5 pl-4 py-2 border-l-4 border-neutral-800 bg-neutral-100/70 rounded-r-2xl italic ${fontStyles.quote}`}
            >
              {quoteLines.map((ql, qIdx) => (
                <p key={qIdx}>
                  <MarkdownInlineRenderer text={ql} />
                </p>
              ))}
            </div>
          );
        }
        continue;
      }

      // 5. Headings: #, ##, ###, ####, #####, ######
      const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const headingText = headingMatch[2];

        if (level === 1) {
          blocks.push(
            <div key={`h1-${blockKey++}`} className="pt-4 pb-2 border-b border-neutral-200 mb-3">
              <h1 className={`${fontStyles.h1} flex items-center gap-2.5 tracking-tight`}>
                <span
                  className="w-2.5 h-6 rounded-full inline-block shrink-0"
                  style={{ backgroundColor: accentColor && accentColor !== '#E3FF00' ? accentColor : '#000000' }}
                />
                <MarkdownInlineRenderer text={headingText} />
              </h1>
            </div>
          );
        } else if (level === 2) {
          blocks.push(
            <div key={`h2-${blockKey++}`} className="pt-4 pb-2 border-b border-neutral-100 mb-2.5">
              <h2 className={`${fontStyles.h2} flex items-center gap-2 tracking-tight`}>
                <Hash className="w-4 h-4 text-neutral-400 shrink-0" />
                <MarkdownInlineRenderer text={headingText} />
              </h2>
            </div>
          );
        } else if (level === 3) {
          blocks.push(
            <h3
              key={`h3-${blockKey++}`}
              className={`pt-3 ${fontStyles.h3} flex items-center gap-2 mb-1.5`}
            >
              <span className="w-2 h-2 rounded-full bg-neutral-900 inline-block shrink-0" />
              <MarkdownInlineRenderer text={headingText} />
            </h3>
          );
        } else {
          blocks.push(
            <h4
              key={`h4-${blockKey++}`}
              className={`pt-2 ${fontStyles.h4} mb-1`}
            >
              <MarkdownInlineRenderer text={headingText} />
            </h4>
          );
        }
        i++;
        continue;
      }

      // 6. Horizontal Rules: --- or ***
      if (/^(\-{3,}|\*{3,}|\_{3,})$/.test(trimmed)) {
        blocks.push(
          <div key={`hr-${blockKey++}`} className="my-5 relative flex items-center justify-center">
            <div className="w-full border-t border-neutral-200" />
            <div className="absolute px-3 bg-[#F7F7F8] text-neutral-400 text-xs font-mono">§ § §</div>
          </div>
        );
        i++;
        continue;
      }

      // 7. Checkboxes / Task lists: - [ ] or - [x]
      const taskMatch = line.match(/^(\s*)[-\*]\s+\[([ xX])\]\s+(.*)$/);
      if (taskMatch) {
        const isChecked = taskMatch[2].toLowerCase() === 'x';
        const taskText = taskMatch[3];
        const indentLevel = Math.floor(taskMatch[1].length / 2);

        blocks.push(
          <div
            key={`task-${blockKey++}`}
            className={`flex items-start gap-2.5 py-1 ${fontStyles.list}`}
            style={{ paddingLeft: `${indentLevel * 18}px` }}
          >
            {isChecked ? (
              <CheckSquare className="w-4 h-4 text-emerald-600 shrink-0 mt-1" />
            ) : (
              <Square className="w-4 h-4 text-neutral-400 shrink-0 mt-1" />
            )}
            <span className={isChecked ? 'line-through text-neutral-400' : 'text-neutral-800'}>
              <MarkdownInlineRenderer text={taskText} />
            </span>
          </div>
        );
        i++;
        continue;
      }

      // 8. Unordered Lists: -, *, +
      const ulMatch = line.match(/^(\s*)[-\*\+]\s+(.*)$/);
      if (ulMatch) {
        const indentLevel = Math.floor(ulMatch[1].length / 2);
        const itemText = ulMatch[2];

        blocks.push(
          <div
            key={`ul-${blockKey++}`}
            className={`flex items-start gap-2.5 py-1 ${fontStyles.list}`}
            style={{ paddingLeft: `${indentLevel * 18}px` }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-neutral-900 shrink-0 mt-2.5" />
            <div className="flex-1">
              <MarkdownInlineRenderer text={itemText} />
            </div>
          </div>
        );
        i++;
        continue;
      }

      // 9. Ordered Lists: 1. 2. 3.
      const olMatch = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
      if (olMatch) {
        const indentLevel = Math.floor(olMatch[1].length / 2);
        const num = olMatch[2];
        const itemText = olMatch[3];

        blocks.push(
          <div
            key={`ol-${blockKey++}`}
            className={`flex items-start gap-2.5 py-1 ${fontStyles.list}`}
            style={{ paddingLeft: `${indentLevel * 18}px` }}
          >
            <span className="px-1.5 py-0.5 rounded-md bg-neutral-200/90 text-neutral-900 text-[0.8em] font-bold shrink-0 mt-0.5">
              {num}
            </span>
            <div className="flex-1">
              <MarkdownInlineRenderer text={itemText} />
            </div>
          </div>
        );
        i++;
        continue;
      }

      // 10. Standard Paragraphs
      blocks.push(
        <p key={`p-${blockKey++}`} className={`py-1 font-normal ${fontStyles.body}`}>
          <MarkdownInlineRenderer text={line} />
        </p>
      );
      i++;
    }

    return blocks;
  }, [content, fontStyles, fontSizeLevel, accentColor]);

  return (
    <div className="flex flex-col h-full space-y-3 font-sans text-neutral-900">
      {/* iOS Top Toolbar Card */}
      <div className="p-2.5 sm:p-3 bg-white rounded-2xl border border-neutral-200/80 shadow-2xs flex flex-wrap items-center justify-between gap-2">
        {/* iOS Segmented Control (Rendered View vs Raw Markdown) */}
        <div className="flex items-center bg-[#EFEFEF] p-1 rounded-xl border border-neutral-200/60">
          <button
            onClick={() => setViewMode('rendered')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              viewMode === 'rendered'
                ? 'bg-white text-neutral-900 shadow-xs scale-100'
                : 'text-neutral-500 hover:text-neutral-900'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>렌더링 뷰</span>
          </button>

          <button
            onClick={() => setViewMode('raw')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              viewMode === 'raw'
                ? 'bg-white text-neutral-900 shadow-xs scale-100'
                : 'text-neutral-500 hover:text-neutral-900'
            }`}
          >
            <FileCode2 className="w-3.5 h-3.5" />
            <span>마크다운 원본</span>
          </button>
        </div>

        {/* Action Controls: Font size, Copy All, Download */}
        <div className="flex items-center gap-2 ml-auto">
          {/* iOS Font Size Adjuster (A- / A / A+) */}
          <div className="flex items-center bg-[#EFEFEF] p-1 rounded-xl border border-neutral-200/60 gap-1">
            <button
              onClick={() => {
                setFontSizeLevel('sm');
                if (showToast) showToast('글자 크기: 작게 (A-)');
              }}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all active:scale-95 ${
                fontSizeLevel === 'sm'
                  ? 'bg-white text-neutral-900 shadow-xs scale-105'
                  : 'text-neutral-500 hover:text-neutral-900'
              }`}
              title="글자 크기 작게 (12.5px)"
            >
              A-
            </button>
            <button
              onClick={() => {
                setFontSizeLevel('base');
                if (showToast) showToast('글자 크기: 보통 (A)');
              }}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all active:scale-95 ${
                fontSizeLevel === 'base'
                  ? 'bg-white text-neutral-900 shadow-xs scale-105'
                  : 'text-neutral-500 hover:text-neutral-900'
              }`}
              title="글자 크기 보통 (14.5px)"
            >
              A
            </button>
            <button
              onClick={() => {
                setFontSizeLevel('lg');
                if (showToast) showToast('글자 크기: 크게 (A+)');
              }}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all active:scale-95 ${
                fontSizeLevel === 'lg'
                  ? 'bg-white text-neutral-900 shadow-xs scale-105'
                  : 'text-neutral-500 hover:text-neutral-900'
              }`}
              title="글자 크기 크게 (17px)"
            >
              A+
            </button>
          </div>

          {/* Copy Full Document Button */}
          <button
            onClick={handleCopyAll}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-neutral-100 hover:bg-neutral-200/80 active:scale-95 text-neutral-800 text-xs font-bold transition-all border border-neutral-200/80 shadow-2xs"
            title="문서 전체 복사"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600" />
                <span className="text-emerald-600 font-bold">복사됨</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-neutral-600" />
                <span className="hidden sm:inline">전체 복사</span>
              </>
            )}
          </button>

          {/* Download File Button */}
          <button
            onClick={handleDownloadFile}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-neutral-900 hover:bg-black active:scale-95 text-white text-xs font-bold transition-all shadow-xs"
            title=".md 파일 다운로드"
          >
            <Download className="w-3.5 h-3.5 text-white" />
            <span className="hidden sm:inline">.md 저장</span>
          </button>
        </div>
      </div>

      {/* iOS Meta Information Bar */}
      <div className="px-4 py-2.5 bg-white rounded-2xl border border-neutral-200/80 shadow-2xs flex flex-wrap items-center justify-between text-xs text-neutral-500 gap-2">
        <div className="flex items-center gap-2">
          <span className="px-2.5 py-0.5 rounded-full bg-neutral-100 border border-neutral-200/80 text-neutral-800 font-bold flex items-center gap-1.5 text-[11px]">
            <Sparkles className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
            AI 스마트 정리노트
          </span>
          {fileSize && (
            <span className="bg-neutral-100 px-2 py-0.5 rounded-lg text-neutral-600 font-medium text-[11px]">
              {fileSize}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 text-neutral-500 font-medium text-[11px]">
          <span>약 {stats.charCount}자</span>
          <span>•</span>
          <span>읽는 시간 약 {stats.readingTimeMin}분</span>
        </div>
      </div>

      {/* Source Files Badges if available */}
      {sourceFiles.length > 0 && (
        <div className="px-4 py-2 bg-white rounded-2xl border border-neutral-200/80 shadow-2xs flex items-center gap-1.5 overflow-x-auto scrollbar-none text-[11px]">
          <span className="text-neutral-400 font-bold shrink-0">분석 원본:</span>
          {sourceFiles.map((sf, idx) => (
            <span
              key={idx}
              className="px-2.5 py-0.5 rounded-lg bg-neutral-100 border border-neutral-200 text-neutral-700 truncate max-w-[150px] shrink-0 font-medium"
              title={sf}
            >
              {sf}
            </span>
          ))}
        </div>
      )}

      {/* Main Reading Card */}
      <div className="flex-1 overflow-y-auto bg-white rounded-3xl border border-neutral-200/80 shadow-2xs p-5 sm:p-7 space-y-2 select-text">
        {viewMode === 'rendered' ? (
          <div className="space-y-2 text-neutral-900 transition-all duration-150">
            {renderedBlocks.length > 0 ? (
              renderedBlocks
            ) : (
              <div className="text-center py-16 text-neutral-400 text-xs font-medium">
                문서 내용이 비어있습니다.
              </div>
            )}
          </div>
        ) : (
          /* Raw Markdown View (Dark macOS Terminal card for raw code editing/inspection) */
          <div className={`rounded-2xl bg-[#1C1C1E] p-4 border border-neutral-800 font-mono text-neutral-200 overflow-x-auto leading-relaxed select-all shadow-md ${fontStyles.raw}`}>
            <pre className="whitespace-pre-wrap">{content}</pre>
          </div>
        )}
      </div>
    </div>
  );
};
