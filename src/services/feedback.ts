import { auth } from '../utils/firebase';

export interface FeedbackItem { id: string; rating: number; comment: string; createdAt: string; read: boolean }
export interface FeedbackPage { items: FeedbackItem[]; cursor: string | null }

export async function feedbackRequest<T>(path = '', body?: unknown, signal?: AbortSignal): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error('로그인이 필요합니다.');
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = window.setTimeout(abort, 20000);
  try {
    const token = await user.getIdToken();
    const base = import.meta.env.VITE_PROXY_SERVER_URL || 'https://lecturebag-production.up.railway.app';
    const response = await fetch(`${base}/api/feedback${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error',
    });
    const data = await response.json().catch(() => null);
    if (response.status === 404 || response.status === 405 || (response.ok && !data)) {
      throw new Error('피드백 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    }
    if (!response.ok) throw new Error(typeof data?.detail === 'string' ? data.detail : '의견을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    return data as T;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('연결 시간이 초과되었습니다. 다시 시도해 주세요.');
    throw error;
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export function feedbackCsv(items: FeedbackItem[]) {
  const cell = (value: string) => `"${(/^[\s]*[=+\-@]/.test(value) ? "'" + value : value).replaceAll('"', '""')}"`;
  return '\uFEFF' + [['작성 시각', '별점', '한줄평', '상태'], ...items.map(item =>
    [item.createdAt, String(item.rating), item.comment, item.read ? '읽음' : '새 의견'])].map(row => row.map(cell).join(',')).join('\r\n');
}
