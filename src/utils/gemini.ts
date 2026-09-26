import { TimetableEntry } from '../types';
import { auth } from './firebase';

const PROXY_SERVER_URL = import.meta.env.VITE_PROXY_SERVER_URL || 'https://lecturebag-production.up.railway.app';

export class AiRequestError extends Error {
  constructor(message: string, public code: string, public retryAfter = 0) { super(message); }
}

async function requestAi<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error('로그인 후 다시 시도해주세요.');
  const endpoint = new URL(PROXY_SERVER_URL);
  if (endpoint.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)) {
    throw new Error('안전한 AI 서버 연결이 필요합니다.');
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = window.setTimeout(() => controller.abort(), 65_000);
  try {
    const token = await new Promise<string>((resolve, reject) => {
      const fail = () => reject(new DOMException('Aborted', 'AbortError'));
      if (controller.signal.aborted) return fail();
      controller.signal.addEventListener('abort', fail, { once: true });
      user.getIdToken().then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', fail));
    });
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
      const providerMessages: Record<string, string> = {
        AI_RATE_LIMIT: '요청 간격 제한으로 잠시 기다립니다.',
        AI_DAILY_QUOTA: '오늘 사용 한도에 도달했습니다. 한도 초기화 후 이어서 시도해주세요.',
        AI_MODEL_UNAVAILABLE: '서버에 설정된 AI 모델을 사용할 수 없습니다. 모델 설정 확인이 필요합니다.',
        AI_KEY_REJECTED: 'AI 서버의 키 또는 사용 권한을 확인해야 합니다.',
        AI_PROVIDER_QUOTA: 'AI 제공 서비스의 사용량 한도에 도달했습니다. 한도 또는 결제 설정을 확인해주세요.',
        AI_INPUT_REJECTED: 'AI 서비스가 자료 형식을 처리하지 못했습니다. 다른 사진이나 음성 파일로 시도해주세요.',
        AI_PROVIDER_ERROR: 'AI 제공 서비스에서 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
      };
      const payload = await res.json().catch(() => null);
      const code = payload?.detail?.code;
      if (typeof code === 'string' && Object.hasOwn(providerMessages, code)) throw new AiRequestError(providerMessages[code], code, Math.min(86400, Math.max(0, Number(res.headers.get('Retry-After')) || 0)));
      throw new Error(messages[res.status] || 'AI 요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.');
    }
    if (auth.currentUser?.uid !== user.uid) throw new Error('로그인 상태가 변경되었습니다.');
    return await res.json() as T;
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (controller.signal.aborted) throw new Error('AI 처리 시간이 초과되었습니다. 다시 시도해주세요.');
    throw error;
  } finally { window.clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
}

export async function analyzeTimetableImage(base64Image: string): Promise<TimetableEntry[]> {
  const data = await requestAi<{ entries: TimetableEntry[] }>('/api/analyze-timetable', { base64Image });
  if (!Array.isArray(data.entries)) throw new Error('시간표 분석 결과가 올바르지 않습니다.');
  return data.entries;
}

export async function generateAiSummary(fileDataUrl: string | undefined, fileName: string, signal?: AbortSignal): Promise<string> {
  const data = await requestAi<{ summary: string }>('/api/summarize', { fileDataUrl, fileName }, signal);
  if (typeof data.summary !== 'string') throw new Error('AI 요약 결과가 올바르지 않습니다.');
  return data.summary;
}
