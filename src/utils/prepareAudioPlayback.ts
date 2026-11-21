import { webmTimelineMs } from './recordingIntegrity';
import { MAX_AUDIO_BYTES } from '../services/drive/audioFormat';

const finiteDuration = (audio: HTMLAudioElement) => Number.isFinite(audio.duration) && audio.duration > 0;
export function hasFullSeekRange(audio: Pick<HTMLAudioElement, 'duration' | 'seekable'>) {
  if (!Number.isFinite(audio.duration) || audio.duration <= 0) return false;
  const range = audio.seekable;
  // Require one continuous range rather than just a last endpoint.
  for (let i = 0; i < range.length; i++) {
    if (range.start(i) <= 0.1 && Number.isFinite(range.end(i)) && range.end(i) >= audio.duration - 0.1) return true;
  }
  return false;
}

function waitForAudio(audio: HTMLAudioElement, ready: () => boolean, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const events = ['loadedmetadata', 'durationchange', 'seeked', 'canplay', 'progress', 'error'];
    const clean = () => { events.forEach(event => audio.removeEventListener(event, check)); signal.removeEventListener('abort', check); clearTimeout(timer); };
    const check = () => {
      if (signal.aborted) { clean(); reject(signal.reason ?? new DOMException('Aborted', 'AbortError')); }
      else if (audio.error) { clean(); reject(new Error('녹음 파일 재생 준비에 실패했습니다.')); }
      else if (ready()) { clean(); resolve(); }
    };
    const timer = setTimeout(() => { clean(); reject(new Error('녹음 길이·탐색 범위 확인 시간이 초과되었습니다.')); }, 15_000);
    events.forEach(event => audio.addEventListener(event, check)); signal.addEventListener('abort', check); check();
  });
}

/** Prepare the SAME verified local Blob, without re-encoding, changing cache bytes,
 * or silently playing audio. The owner revokes its original URL on close.
 */
export async function prepareAudioPlayback(audio: HTMLAudioElement, url: string, signal: AbortSignal): Promise<number> {
  if (!url.startsWith('blob:')) throw new Error('검증된 기기 오디오만 재생할 수 있습니다.');
  signal.throwIfAborted();
  audio.pause(); audio.src = url; audio.load();
  await waitForAudio(audio, () => audio.readyState >= 1, signal);
  if (!finiteDuration(audio)) {
    // Streaming MediaRecorder WebM often has no Duration. A bounded local seek
    // beyond its measured last packet lets the browser discover EOF and index it.
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error('기기 녹음 원본을 읽지 못했습니다.');
    const blob = await response.blob();
    if (!blob.size || blob.size > MAX_AUDIO_BYTES) throw new Error('녹음 재생 준비 용량을 초과했습니다.');
    const timelineMs = webmTimelineMs(await blob.arrayBuffer());
    signal.throwIfAborted();
    if (!Number.isFinite(timelineMs) || timelineMs <= 0) throw new Error('녹음 길이를 확인하지 못했습니다.');
    audio.currentTime = timelineMs / 1000 + 1;
    await waitForAudio(audio, () => finiteDuration(audio) && !audio.seeking, signal);
  }
  await waitForAudio(audio, () => hasFullSeekRange(audio) && !audio.seeking, signal);
  signal.throwIfAborted();
  if (audio.currentTime !== 0) {
    audio.currentTime = 0;
    await waitForAudio(audio, () => !audio.seeking && audio.currentTime < 0.1, signal);
  }
  return audio.duration;
}
