import type { MediaFile } from '../types';

// Metadata only: no file contents, URL, download or persistent file is created.
type TutorialFile = Omit<MediaFile, 'dataUrl'> & { dataUrl?: never };
export const tutorialFiles: TutorialFile[] = [
  { id: 'tour-photo-1', type: 'photo', name: '판서_01 (안내 예시).jpg', timestamp: new Date(2026, 8, 15, 10, 0), fileSize: '1.2 MB' },
  { id: 'tour-photo-2', type: 'photo', name: '판서_02 (안내 예시).jpg', timestamp: new Date(2026, 8, 15, 10, 1), fileSize: '1.4 MB' },
  { id: 'tour-audio', type: 'audio', name: '강의 녹음 (안내 예시).m4a', timestamp: new Date(2026, 8, 15, 10, 2), duration: '12:30' },
  { id: 'tour-document', type: 'document', name: '강의 요약 (안내 예시).md', timestamp: new Date(2026, 8, 15, 10, 3), fileSize: '2 KB' },
];
