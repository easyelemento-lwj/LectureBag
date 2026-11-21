import { Capacitor, registerPlugin } from '@capacitor/core';
import type { CaptureIntent } from '../utils/mediaStorage';

export const isNativeAndroid = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
export interface NativeSession {
  uid: string; id: string; startedAt: string; elapsedMs: number;
  state: 'recording' | 'paused' | 'finished';
  uri?: string; mediaDurationMs?: number; warning?: string;
  context?: { connectionId?: string; folderPath: string[] };
}
export interface NativePhoto {
  uid: string; id: string; uri: string; startedAt: string; width: number; height: number;
  intent?: CaptureIntent;
}
interface NativePlugin {
  cameraStart(options: { x: number; y: number; width: number; height: number; viewportWidth: number; facing: string; flash: string }): Promise<void>;
  cameraStop(): Promise<void>;
  photo(options: { uid: string; id: string; startedAt: string; intent: CaptureIntent }): Promise<NativePhoto>;
  recordingStart(options: Omit<NativeSession, 'state' | 'elapsedMs'>): Promise<NativeSession>;
  recordingPause(options: { uid: string }): Promise<NativeSession>;
  recordingStop(options: { uid: string }): Promise<void>;
  status(options: { uid: string }): Promise<{ active?: NativeSession; finished: NativeSession[]; photos: NativePhoto[] }>;
  acknowledge(options: { uid: string; id: string; kind: 'photo' | 'recording' }): Promise<void>;
  account(): Promise<{ uid: string | null }>;
  logout(): Promise<void>;
  signIn(): Promise<{ idToken: string; uid: string }>;
  authorizeDrive(options: { clientId: string }): Promise<{ code: string }>;
}
export const native = registerPlugin<NativePlugin>('LectureBag');
export function validNativeMediaUri(uri: string): boolean {
  const id = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
  return new RegExp(`^file:///data/(?:user/[0-9]+|data)/com\\.lecturebag\\.app/files/recordings/[a-f0-9]{64}/(?:${id}\\.m4a|photos/${id}\\.jpg)$`).test(uri);
}
/** Only consume plugin-owned internal files; never accept a remote URL as a source. */
export async function nativeBlob(uri: string): Promise<Blob> {
  if (!validNativeMediaUri(uri)) throw new Error('기기 원본 경로를 확인하지 못했습니다.');
  const response = await fetch(Capacitor.convertFileSrc(uri));
  if (!response.ok) throw new Error('기기 원본을 읽지 못했습니다.');
  return response.blob();
}
export function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result));
    reader.onerror = reader.onabort = () => reject(new Error('원본 읽기 실패')); reader.readAsDataURL(blob);
  });
}
