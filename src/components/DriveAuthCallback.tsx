import { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { auth } from '../utils/firebase';
import { CloudCatalog } from '../services/drive/cloudCatalog';

// Capture and remove the one-time code before rendering third-party resources.
const query = new URLSearchParams(location.search);
const code = query.get('code');
const state = query.get('state');
const oauthError = query.get('error');
if (location.pathname === '/drive-auth-callback') history.replaceState(null, '', location.pathname);
let pending: Promise<void> | undefined;

export function DriveAuthCallback() {
  const { user, loading } = useAuth();
  const [message, setMessage] = useState('Google Drive 연결을 확인하고 있습니다…');
  useEffect(() => {
    if (loading) return;
    if (!pending) pending = (async () => {
      const saved = sessionStorage.getItem('lecturebag-drive-oauth');
      sessionStorage.removeItem('lecturebag-drive-oauth');
      let request: { uid?: string; state?: string } = {};
      try { request = JSON.parse(saved || '{}'); } catch { /* invalid stored state */ }
      if (!user || !state || request.uid !== user.uid || request.state !== state)
        throw new Error('연결 요청이나 로그인 계정을 확인하지 못했습니다. 다시 연결해 주세요.');
      if (oauthError) throw new Error('Google Drive 권한 요청이 취소되었거나 거부되었습니다.');
      if (!code) throw new Error('Google에서 연결 정보를 받지 못했습니다.');
      await new CloudCatalog(user, () => auth.currentUser?.uid).connect(code, state, undefined, true);
    })();
    void pending.then(() => { location.replace('/'); }).catch(err => setMessage(err instanceof Error ? err.message : 'Drive 연결에 실패했습니다.'));
  }, [loading, user]);
  return <main className="min-h-screen bg-white p-8 text-neutral-900"><p role="status">{message}</p><a className="mt-4 inline-block underline" href="/">LectureBag으로 돌아가기</a></main>;
}
