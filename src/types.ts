export interface CapturedPhoto {
  id: string;
  dataUrl: string;
  timestamp: Date | string;
  mode: string;
  width: number;
  height: number;
  folderName?: string;
}

export interface MediaFile {
  id: string;
  type: 'photo' | 'audio' | 'document';
  name: string;
  dataUrl?: string;
  duration?: string;
  fileSize?: string;
  timestamp: Date | string;
  mode?: string;
  sourceFileNames?: string[];
}

export interface RecordedAudio {
  id: string;
  name: string;
  duration: string;
  timestamp: Date | string;
  size?: string;
}

export type FlashMode = 'off' | 'on' | 'auto';
export type CameraMode = 'PPT/판서' | '강의노트' | '교재' | '문서';
export type AspectRatio = '전체' | '4:3' | '16:9' | '1:1';

export interface TimetableEntry {
  subject: string;
  dayOfWeek: number; // 0: Sunday, 1: Monday, ..., 6: Saturday
  startTime: string; // "09:00"
  endTime: string;   // "11:50"
}

