import type { RecordedAudio } from '../types';
import { inspectRecording, type RecordingIntegrity } from './recordingIntegrity';

/** Never compare duration against itself: old display strings may come from the
 * media metadata, not the recording clock. Only durationMs is a trusted clock. */
export function recordingCheckDescription(recording: Pick<RecordedAudio, 'integrity' | 'durationMs'>): string {
  const check = recording.integrity;
  if (!check) return '검사 기록 없음';
  if (check.status === 'duration_checked') return '녹음 길이 대조 통과';
  if (check.issues?.length) return check.issues.map(issue => ({
    duration_unreadable: '파일 길이 검사 실패', missing_elapsed: '비교할 녹음 시간 기록 없음',
    duration_mismatch: '녹음 시간과 파일 길이 불일치', recording_warning: '녹음 중 경고 기록 있음',
  })[issue]).join(' · ');
  if (check.warning?.startsWith('파일 길이를 확인하지 못했습니다.')) return '파일 길이 검사 실패';
  if (/^녹음 시간 \d+:\d+와 파일 길이 약 \d+:\d+가 다릅니다\./.test(check.warning || '')) return '녹음 시간과 파일 길이 불일치';
  return '이전 검사 미통과 · 상세 원인 기록 부족';
}

export function preservedRecordingWarning(check?: RecordingIntegrity): string | undefined {
  if (!check || check.status === 'duration_checked') return undefined;
  if (check.recordingWarning) return check.recordingWarning;
  if (check.issues) return check.issues.includes('recording_warning') ? '이전 녹음 중 경고가 기록되었습니다.' : undefined;
  // Only known old duration-only warnings can be cleared by a duration recheck.
  const suffix = ' 원본은 기기에 보존하며 자동 업로드를 보류합니다. 최근 녹음에서 확인·내보내기 해주세요.';
  const warning = check.warning?.replace(suffix, '') || '';
  if (warning === '파일 길이를 확인하지 못했습니다.' || /^녹음 시간 \d+:\d+와 파일 길이 약 \d+:\d+가 다릅니다\.$/.test(warning)) return undefined;
  return warning || '이전 검사에서 확인이 필요했으나 상세 원인 기록이 없습니다.';
}

export async function recheckRecordingLength(recording: RecordedAudio, blob: Blob,
  inspect = inspectRecording): Promise<RecordingIntegrity> {
  return inspect(blob, recording.durationMs ?? NaN, preservedRecordingWarning(recording.integrity));
}
