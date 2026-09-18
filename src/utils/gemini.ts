import { TimetableEntry } from '../types';
import { auth } from './firebase';

const PROXY_SERVER_URL = import.meta.env.VITE_PROXY_SERVER_URL || 'https://lecturebag-production.up.railway.app';

async function requestAi<T>(path: string, body: unknown): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error('로그인 후 다시 시도해주세요.');
  const endpoint = new URL(PROXY_SERVER_URL);
  if (endpoint.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)) {
    throw new Error('안전한 AI 서버 연결이 필요합니다.');
  }
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 65_000);
  try {
    const token = await user.getIdToken();
    if (auth.currentUser?.uid !== user.uid) throw new Error('로그인 상태가 변경되었습니다.');
    const res = await fetch(new URL(path, endpoint), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body), signal: controller.signal,
    });
    if (!res.ok) {
      const messages: Record<number, string> = {
        401: '로그인을 다시 확인해주세요.', 403: '이 기능에 접근할 수 없습니다.',
        413: '파일이 너무 큽니다. 10MB 이하의 파일을 사용해주세요.',
        422: '지원되는 이미지 또는 음성 파일을 확인해주세요.',
        429: '사용 한도에 도달했습니다. 잠시 후 다시 시도해주세요.',
        503: 'AI 서비스를 잠시 사용할 수 없습니다.', 504: 'AI 처리 시간이 초과되었습니다.',
      };
      throw new Error(messages[res.status] || 'AI 요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.');
    }
    if (auth.currentUser?.uid !== user.uid) throw new Error('로그인 상태가 변경되었습니다.');
    return await res.json() as T;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('AI 처리 시간이 초과되었습니다. 다시 시도해주세요.');
    throw error;
  } finally { window.clearTimeout(timeout); }
}

export async function analyzeTimetableImage(base64Image: string): Promise<TimetableEntry[]> {
  const data = await requestAi<{ entries: TimetableEntry[] }>('/api/analyze-timetable', { base64Image });
  if (!Array.isArray(data.entries)) throw new Error('시간표 분석 결과가 올바르지 않습니다.');
  return data.entries;
}

export async function generateAiSummary(fileDataUrl: string | undefined, fileName: string): Promise<string> {
  const data = await requestAi<{ summary: string }>('/api/summarize', { fileDataUrl, fileName });
  if (typeof data.summary !== 'string') throw new Error('AI 요약 결과가 올바르지 않습니다.');
  return data.summary;
}
