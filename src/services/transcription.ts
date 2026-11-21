import { auth } from '../utils/firebase';

export async function transcript(fileId: string, audio?: Blob): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) throw new Error('로그인이 필요합니다.');
  if (audio && audio.size > 512 * 1024 * 1024) throw new Error('텍스트 변환은 파일당 512MB까지 지원합니다.');
  const token = await user.getIdToken();
  const response = await fetch(`${import.meta.env.VITE_PROXY_SERVER_URL || 'https://lecturebag-production.up.railway.app'}/api/transcriptions/${encodeURIComponent(fileId)}`, {
    method: audio ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, ...(audio ? { 'Content-Type': audio.type } : {}) },
    body: audio, signal: AbortSignal.timeout(1_560_000),
  });
  const result = await response.json();
  if (auth.currentUser?.uid !== user.uid) throw new Error('로그인 계정이 변경되었습니다.');
  if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : '텍스트 변환 서버를 확인해 주세요.');
  return result.text;
}
