import { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { desktopCallback, desktopVerificationCode, parseDesktopHandoff } from '../services/desktop';

/** Only rendered in the user's normal browser; approval is never automatic. */
export function DesktopApproval() {
  const { user, signOut } = useAuth();
  const [handoff] = useState(() => parseDesktopHandoff(location.hash));
  const [code, setCode] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { if (handoff) void desktopVerificationCode(handoff.state).then(setCode); }, [handoff]);
  const cancel = () => { history.replaceState(null, '', location.pathname); location.reload(); };
  async function approve() {
    if (!user || !handoff || busy) return;
    setBusy(true); setError('');
    try {
      const token = await user.getIdToken();
      const endpoint = import.meta.env.VITE_PROXY_SERVER_URL || 'https://lecturebag-production.up.railway.app';
      const response = await fetch(new URL('/api/desktop/session', endpoint), {
        method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20_000),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Requested-With': 'XmlHttpRequest' },
        body: JSON.stringify({ challenge: handoff.challenge }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(response.status === 404 ? '설치형 앱 로그인 서버가 아직 활성화되지 않았습니다. 서버와 시험 사이트 업데이트 후 다시 시도해 주세요.'
        : response.status === 403 ? '이 계정은 설치형 앱 내부 시험 대상이 아니거나 허용된 시험 주소가 아닙니다.'
        : response.status === 429 ? '로그인 요청이 많습니다. 잠시 후 앱에서 다시 시작해 주세요.' : '로그인 승인을 완료하지 못했습니다. 앱에서 다시 시작해 주세요.');
      const target = desktopCallback(handoff, result?.code);
      history.replaceState(null, '', location.pathname);
      location.replace(target);
    } catch (e) { setError(e instanceof Error ? e.message : '로그인 승인에 실패했습니다.'); setBusy(false); }
  }
  return <main className="min-h-dvh bg-neutral-50 p-6 text-neutral-900 flex items-center justify-center">
    <section className="w-full max-w-lg space-y-5 rounded-2xl border border-neutral-200 bg-white p-7">
      <p className="font-bold">LectureBag · 설치형 PC 앱</p>
      <h1 className="text-2xl font-bold">이 PC의 로그인을 승인할까요?</h1>
      {!handoff ? <p role="alert">올바르지 않은 요청입니다. 설치형 앱에서 로그인을 다시 시작해 주세요.</p> : <>
        <p className="text-sm text-neutral-600">방금 직접 실행한 LectureBag 앱에 표시된 코드와 같은지 확인하세요. 다른 사람이 보낸 링크라면 승인하지 마세요.</p>
        <p aria-label="로그인 확인 코드" className="rounded-xl bg-neutral-100 p-4 text-center font-mono text-3xl tracking-widest">{code || '…'}</p>
        <p className="break-all text-sm">로그인할 계정: {user?.email || user?.uid}</p>
        <p className="text-sm text-neutral-600">승인하면 PC 앱에 로그인 상태가 유지됩니다. Drive 연결과 자동 보관 설정은 앱에서 별도로 확인합니다.</p>
        <button className="rounded-xl bg-neutral-900 px-4 py-3 text-white disabled:opacity-40" disabled={busy || !code} onClick={() => void approve()}>이 PC 로그인 승인</button>
        <button className="ml-3 text-sm underline" disabled={busy} onClick={() => void signOut()}>다른 계정 사용</button>
      </>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <button className="block text-sm underline" disabled={busy} onClick={cancel}>취소하고 웹 앱으로 돌아가기</button>
    </section>
  </main>;
}
