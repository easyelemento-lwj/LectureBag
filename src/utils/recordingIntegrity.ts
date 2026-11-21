export interface RecordingIntegrity {
  status: 'duration_checked' | 'needs_review';
  mediaDurationMs?: number;
  warning?: string;
  issues?: Array<'duration_unreadable' | 'missing_elapsed' | 'duration_mismatch' | 'recording_warning'>;
  recordingWarning?: string;
  checkedAt?: number;
}

/** Inspect WebM timestamps without expanding a long recording into a huge PCM buffer.
 * This checks container timing, NOT that every spoken word or sample is intact.
 */
export function webmTimelineMs(buffer: ArrayBuffer): number {
  const b = new Uint8Array(buffer), view = new DataView(buffer);
  let scale = 1_000_000, cluster = 0, first: number | undefined, last: number | undefined, delta = 0;
  let audio = false, blocks = 0;
  const masters = new Set([0x1a45dfa3, 0x18538067, 0x1549a966, 0x1654ae6b, 0xae, 0x1f43b675, 0xa0]);
  function vint(p: number, id = false) {
    let n = 1, mask = 128;
    while (n <= 8 && !(b[p] & mask)) { n++; mask >>= 1; }
    if (n > 8 || p + n > b.length) throw new Error('불완전한 WebM 헤더');
    let value = BigInt(id ? b[p] : b[p] & (mask - 1));
    for (let i = 1; i < n; i++) value = (value << 8n) | BigInt(b[p + i]);
    const unknown = !id && value === (1n << BigInt(7 * n)) - 1n;
    if (!unknown && value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('WebM 범위 오류');
    return { n, value: Number(value), unknown };
  }
  function uint(s: number, e: number) {
    if (e - s > 6) throw new Error('WebM 시간 범위 오류');
    let value = 0; for (let p = s; p < e; p++) value = value * 256 + b[p]; return value;
  }
  function walk(s: number, e: number, depth = 0) {
    if (depth > 8) throw new Error('WebM 중첩 오류');
    for (let p = s; p < e;) {
      const id = vint(p, true), size = vint(p + id.n), start = p + id.n + size.n;
      const end = size.unknown ? e : start + size.value;
      if (start > end || end > e) throw new Error('WebM 끝부분 누락');
      // Streaming WebM has successive unknown-sized Clusters. They are siblings,
      // not infinitely nested masters extending to EOF.
      if (size.unknown) {
        if (id.value !== 0x18538067 && id.value !== 0x1f43b675) throw new Error('WebM 크기 확인 불가');
        p = start; continue;
      }
      if (id.value === 0x2ad7b1) scale = uint(start, end);
      if (id.value === 0xe7) cluster = uint(start, end);
      if (id.value === 0x86) audio ||= new TextDecoder().decode(b.subarray(start, end)) === 'A_OPUS';
      if (id.value === 0xa3 || id.value === 0xa1) {
        const track = vint(start);
        if (start + track.n + 3 >= end) throw new Error('빈 WebM 오디오 블록');
        const time = cluster + view.getInt16(start + track.n);
        if (last !== undefined && time < last) throw new Error('WebM 시간 역행');
        if (last !== undefined) delta = time - last;
        first ??= time; last = time; blocks++;
      }
      if (masters.has(id.value)) walk(start, end, depth + 1);
      p = end;
    }
  }
  walk(0, b.length);
  if (!audio || blocks < 2 || !scale || last === undefined || first === undefined) throw new Error('WebM 길이 확인 불가');
  // Last packet duration is estimated from the preceding interval, capped at 120 ms.
  return (last - first) * scale / 1e6 + Math.min(120, delta * scale / 1e6);
}

export function compareRecordingDuration(elapsedMs: number, mediaDurationMs?: number, reason?: string): RecordingIntegrity {
  const valid = Number.isFinite(mediaDurationMs) && mediaDurationMs! > 0;
  const elapsedValid = Number.isFinite(elapsedMs) && elapsedMs > 0;
  const mismatch = valid && elapsedValid && Math.abs(mediaDurationMs! - elapsedMs) > Math.max(3000, elapsedMs * 0.01);
  const issues: NonNullable<RecordingIntegrity['issues']> = [];
  if (!valid) issues.push('duration_unreadable');
  if (!elapsedValid) issues.push('missing_elapsed');
  if (mismatch) issues.push('duration_mismatch');
  if (reason) issues.push('recording_warning');
  const format = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
  const warning = [reason, !elapsedValid ? '비교할 녹음 시간 기록이 없습니다.' : '', !valid ? '파일 길이를 확인하지 못했습니다.' : mismatch
    ? `녹음 시간 ${format(elapsedMs)}와 파일 길이 약 ${format(mediaDurationMs!)}가 다릅니다.` : ''].filter(Boolean).join(' ');
  return { status: warning ? 'needs_review' : 'duration_checked', mediaDurationMs: valid ? mediaDurationMs : undefined,
    issues, recordingWarning: reason, checkedAt: Date.now(),
    warning: warning ? `${warning} 원본은 기기에 보존하며 자동 업로드를 보류합니다. 최근 녹음에서 확인·내보내기 해주세요.` : undefined };
}

function metadataDuration(blob: Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio(), url = URL.createObjectURL(blob);
    const cleanup = () => { clearTimeout(timer); audio.onloadedmetadata = audio.onerror = null; audio.removeAttribute('src'); audio.load(); URL.revokeObjectURL(url); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('길이 확인 시간 초과')); }, 8000);
    audio.onloadedmetadata = () => { const duration = audio.duration * 1000; cleanup(); resolve(duration); };
    audio.onerror = () => { cleanup(); reject(new Error('파일 길이 확인 실패')); };
    audio.preload = 'metadata'; audio.src = url;
  });
}
export async function inspectRecording(blob: Blob, elapsedMs: number, reason?: string): Promise<RecordingIntegrity> {
  try {
    const duration = blob.type.split(';')[0] === 'audio/webm'
      ? webmTimelineMs(await blob.arrayBuffer()) : await metadataDuration(blob);
    return compareRecordingDuration(elapsedMs, duration, reason);
  } catch { return compareRecordingDuration(elapsedMs, undefined, reason); }
}
