import { MediaFile, CapturedPhoto, RecordedAudio, TimetableEntry } from '../types';

export interface FolderNode {
  year: string;         // e.g. "2026년"
  halfYear: string;     // e.g. "상반기" or "하반기"
  semester: string;     // e.g. "1학기 (3월~8월)" or "2학기 (9월~2월)"
  subject: string;      // e.g. "컴퓨터구조", "자료구조", "알고리즘", "운영체제"
  month: string;        // e.g. "8월"
  day: string;          // e.g. "2일 (일)"
}

export function getFolderHierarchyFromDate(dateInput: Date | string, fileName?: string, timetableEntries?: TimetableEntry[]): FolderNode {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  const validDate = isNaN(date.getTime()) ? new Date() : date;

  const year = `${validDate.getFullYear()}년`;
  const monthNum = validDate.getMonth() + 1;
  const halfYear = monthNum <= 6 ? '상반기' : '하반기';
  
  // 1학기: 3월 ~ 8월, 2학기: 9월 ~ 2월
  const semester = (monthNum >= 3 && monthNum <= 8) ? '1학기 (3월~8월)' : '2학기 (9월~2월)';

  const month = `${monthNum}월`;

  const daysOfWeek = ['일', '월', '화', '수', '목', '금', '토'];
  const dayOfWeekIndex = validDate.getDay();
  const dayName = daysOfWeek[dayOfWeekIndex];
  const day = `${validDate.getDate()}일 (${dayName})`;

  let subject = '기타 과목';

  if (timetableEntries && timetableEntries.length > 0) {
    const currentHour = validDate.getHours();
    const currentMin = validDate.getMinutes();
    const currentTotalMins = currentHour * 60 + currentMin;

    const matchedEntry = timetableEntries.find((entry) => {
      if (entry.dayOfWeek !== dayOfWeekIndex) return false;
      
      const [startH, startM] = entry.startTime.split(':').map(Number);
      const [endH, endM] = entry.endTime.split(':').map(Number);
      
      const startTotalMins = startH * 60 + (startM || 0);
      const endTotalMins = endH * 60 + (endM || 0);
      
      return currentTotalMins >= startTotalMins && currentTotalMins <= endTotalMins;
    });

    if (matchedEntry) {
      subject = matchedEntry.subject;
    } else {
      subject = '기타 과목';
    }
  } else {
    // 기존 하드코딩된 과목 분류 로직 (Fallback)
    if (fileName) {
      const fn = fileName.toLowerCase();
      if (fn.includes('컴퓨터') || fn.includes('메모리')) subject = '컴퓨터구조';
      else if (fn.includes('자료구조') || fn.includes('트리')) subject = '자료구조';
      else if (fn.includes('알고리즘')) subject = '알고리즘';
      else if (fn.includes('운영체제') || fn.includes('프로세스')) subject = '운영체제';
      else {
        const hours = validDate.getHours();
        if (hours >= 9 && hours < 12) subject = '컴퓨터구조';
        else if (hours >= 12 && hours < 15) subject = '자료구조';
        else if (hours >= 15 && hours < 18) subject = '알고리즘';
        else subject = '운영체제';
      }
    } else {
        const hours = validDate.getHours();
        if (hours >= 9 && hours < 12) subject = '컴퓨터구조';
        else if (hours >= 12 && hours < 15) subject = '자료구조';
        else if (hours >= 15 && hours < 18) subject = '알고리즘';
        else subject = '운영체제';
    }
  }

  return { year, halfYear, semester, subject, month, day };
}

// Utility to format date into YYYYMMDD_HHmm (e.g. 20260816_1443)
export function formatFileName(dateInput: Date | string): string {
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  const validDate = isNaN(d.getTime()) ? new Date() : d;
  const yyyy = validDate.getFullYear();
  const mm = String(validDate.getMonth() + 1).padStart(2, '0');
  const dd = String(validDate.getDate()).padStart(2, '0');
  const hh = String(validDate.getHours()).padStart(2, '0');
  const min = String(validDate.getMinutes()).padStart(2, '0');
  return `${yyyy}${mm}${dd}_${hh}${min}`;
}

// Generate realistic media files from actual user photos & recordings
export function getSampleMediaFiles(capturedPhotos: CapturedPhoto[], recordings: RecordedAudio[] = []): MediaFile[] {
  const convertedPhotos: MediaFile[] = capturedPhotos.map((p) => {
    const fileName = formatFileName(p.timestamp);
    return {
      id: p.id,
      type: 'photo',
      name: `${fileName}.jpg`,
      dataUrl: p.dataUrl,
      fileSize: '2.4 MB',
      timestamp: p.timestamp,
      mode: p.mode || 'PPT/판서',
    };
  });

  const convertedRecordings: MediaFile[] = recordings.map((r) => {
    const fileName = formatFileName(r.timestamp);
    const resolvedName = r.name && r.name.match(/^\d{8}_\d{4}/) ? r.name : `${fileName}.m4a`;
    return {
      id: r.id,
      type: 'audio',
      name: resolvedName,
      duration: r.duration,
      fileSize: r.size || '12.4 MB',
      timestamp: r.timestamp,
      mode: '강의 녹음',
    };
  });

  return [...convertedRecordings, ...convertedPhotos];
}

/**
 * Fast EXIF DateTimeOriginal / DateTime parser from DataURL or ArrayBuffer
 */
export function parseExifDate(dataUrlOrBuffer: string | ArrayBuffer): Date | null {
  try {
    let bytes: Uint8Array;
    if (typeof dataUrlOrBuffer === 'string') {
      const base64Index = dataUrlOrBuffer.indexOf('base64,');
      if (base64Index === -1) return null;
      const base64 = dataUrlOrBuffer.slice(base64Index + 7);
      const binaryString = atob(base64.slice(0, 131072)); // First 128KB is enough for EXIF header
      bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
    } else {
      bytes = new Uint8Array(dataUrlOrBuffer);
    }

    // Check JPEG SOI
    if (bytes[0] !== 0xFF || bytes[1] !== 0xD8) return null;

    let offset = 2;
    while (offset < bytes.length) {
      if (bytes[offset] !== 0xFF) break;
      const marker = bytes[offset + 1];
      if (marker === 0xE1) {
        // APP1 Marker (EXIF)
        const app1Length = (bytes[offset + 2] << 8) | bytes[offset + 3];
        const exifHeader = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
        if (exifHeader === 'Exif') {
          const tiffOffset = offset + 10;
          const isLittleEndian = bytes[tiffOffset] === 0x49 && bytes[tiffOffset + 1] === 0x49; // 'II'

          const readUint16 = (pos: number) => {
            const b0 = bytes[tiffOffset + pos];
            const b1 = bytes[tiffOffset + pos + 1];
            return isLittleEndian ? (b1 << 8) | b0 : (b0 << 8) | b1;
          };

          const readUint32 = (pos: number) => {
            const b0 = bytes[tiffOffset + pos];
            const b1 = bytes[tiffOffset + pos + 1];
            const b2 = bytes[tiffOffset + pos + 2];
            const b3 = bytes[tiffOffset + pos + 3];
            return isLittleEndian
              ? (b3 << 24) | (b2 << 16) | (b1 << 8) | b0
              : (b0 << 24) | (b1 << 16) | (b2 << 8) | b3;
          };

          const firstIfdOffset = readUint32(4);
          let currentIfd = firstIfdOffset;

          // Search in IFD0 & ExifIFD
          const scanIfd = (ifdPos: number): Date | null => {
            if (ifdPos + 2 > bytes.length - tiffOffset) return null;
            const entriesCount = readUint16(ifdPos);
            let exifIfdOffset = 0;

            for (let i = 0; i < entriesCount; i++) {
              const entryPos = ifdPos + 2 + i * 12;
              if (entryPos + 12 > bytes.length - tiffOffset) break;
              const tag = readUint16(entryPos);

              // 0x9003: DateTimeOriginal, 0x0132: DateTime, 0x9004: DateTimeDigitized
              if (tag === 0x9003 || tag === 0x0132 || tag === 0x9004) {
                const valueOffset = readUint32(entryPos + 8);
                const strBytes = bytes.slice(tiffOffset + valueOffset, tiffOffset + valueOffset + 19);
                const dateStr = String.fromCharCode(...strBytes); // "YYYY:MM:DD HH:MM:SS"
                const match = dateStr.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
                if (match) {
                  const [_, y, m, d, h, min, s] = match;
                  const parsed = new Date(Number(y), Number(m) - 1, Number(d), Number(h), Number(min), Number(s));
                  if (!isNaN(parsed.getTime())) return parsed;
                }
              }

              // 0x8769: ExifIFD Pointer
              if (tag === 0x8769) {
                exifIfdOffset = readUint32(entryPos + 8);
              }
            }

            if (exifIfdOffset > 0) {
              return scanIfd(exifIfdOffset);
            }
            return null;
          };

          const result = scanIfd(currentIfd);
          if (result) return result;
        }
        offset += 2 + app1Length;
      } else if (marker === 0xD9 || marker === 0xDA) {
        break; // SOS or EOI
      } else {
        const len = (bytes[offset + 2] << 8) | bytes[offset + 3];
        offset += 2 + len;
      }
    }
  } catch {
    // ignore parse error
  }
  return null;
}

/**
 * Extract date from filename pattern (e.g. KakaoTalk_20260810_1430, 20260810_1430, IMG_20260810, etc.)
 */
export function parseFilenameDate(fileName: string): Date | null {
  if (!fileName) return null;
  // Match patterns like YYYYMMDD_HHMMSS or YYYY-MM-DD or YYYYMMDD_HHmm
  const matchWithTime = fileName.match(/(?:KakaoTalk_|IMG_|Screenshot_|photo_|rec_|AUDIO_)?(\d{4})[-_]?(\d{2})[-_]?(\d{2})[-_](\d{2})[-_]?(\d{2})(?:[-_]?(\d{2}))?/i);
  if (matchWithTime) {
    const [_, y, m, d, h, min, s] = matchWithTime;
    const yNum = Number(y);
    const mNum = Number(m);
    const dNum = Number(d);
    if (yNum >= 2000 && yNum <= 2099 && mNum >= 1 && mNum <= 12 && dNum >= 1 && dNum <= 31) {
      return new Date(yNum, mNum - 1, dNum, Number(h || 12), Number(min || 0), Number(s || 0));
    }
  }

  // Match YYYYMMDD or YYYY-MM-DD
  const matchDateOnly = fileName.match(/(?:KakaoTalk_|IMG_|Screenshot_|photo_|rec_|AUDIO_)?(\d{4})[-_.]?(\d{2})[-_.]?(\d{2})/i);
  if (matchDateOnly) {
    const [_, y, m, d] = matchDateOnly;
    const yNum = Number(y);
    const mNum = Number(m);
    const dNum = Number(d);
    if (yNum >= 2000 && yNum <= 2099 && mNum >= 1 && mNum <= 12 && dNum >= 1 && dNum <= 31) {
      return new Date(yNum, mNum - 1, dNum, 12, 0, 0);
    }
  }
  return null;
}

/**
 * Smart file date extractor:
 * 1. EXIF DateTimeOriginal in image
 * 2. Filename date pattern
 * 3. File lastModified
 * 4. Fallback to now
 */
export function extractSmartFileDate(file: File, dataUrl?: string): Date {
  if (dataUrl) {
    const exifDate = parseExifDate(dataUrl);
    if (exifDate) return exifDate;
  }

  const filenameDate = parseFilenameDate(file.name);
  if (filenameDate) return filenameDate;

  if (file.lastModified && file.lastModified > 0) {
    const d = new Date(file.lastModified);
    if (!isNaN(d.getTime()) && d.getFullYear() >= 2000) {
      return d;
    }
  }

  return new Date();
}

