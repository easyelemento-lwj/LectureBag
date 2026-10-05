import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { auth } from '../utils/firebase';
import { CloudCatalog } from '../services/drive/cloudCatalog';
import { loadDriveOAuth, requestDriveCode } from '../services/drive/driveAuth';
import type { DriveAuthChallenge, DriveConnection } from '../services/drive/types';

export function DriveConnectionPanel() {
  const { user } = useAuth();
  // Remount on UID change: no state from a previous account may be rendered.
  return user ? <DriveConnectionSession key={user.uid} user={user} /> : null;
}

function DriveConnectionSession({ user }: { user: NonNullable<ReturnType<typeof useAuth>['user']>; key?: string }) {
  const catalog = useMemo(() => new CloudCatalog(user, () => auth.currentUser?.uid), [user]);
  const [connection, setConnection] = useState<DriveConnection>();
  const [challenge, setChallenge] = useState<DriveAuthChallenge>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const active = useRef<AbortController>(null);

  useEffect(() => {
    const controller = new AbortController();
    active.current = controller;
    setBusy(true); setError(''); setChallenge(undefined);
    void Promise.all([catalog.status(controller.signal), catalog.start(controller.signal), loadDriveOAuth()])
      .then(([status, start]) => {
        if (!controller.signal.aborted) { setConnection(status); setChallenge(start); }
      }).catch(err => { if (!controller.signal.aborted) setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    const expiry = window.setTimeout(() => {
      setChallenge(undefined);
      setError('연결 요청이 만료되었습니다. 새로고침해 주세요.');
    }, 290_000);
    return () => { controller.abort(); window.clearTimeout(expiry); };
  }, [catalog, attempt]);

  async function connect() {
    if (!challenge || !active.current) return;
    const signal = active.current.signal;
    setBusy(true); setError('');
    try {
      const code = await requestDriveCode(challenge, signal);
      const result = await catalog.connect(code, challenge.state, signal);
      if (!signal.aborted) { setConnection(result); setChallenge(undefined); }
    } catch (err) {
      if (!signal.aborted) { setChallenge(undefined); setError((err as Error).message); }
    } finally { if (!signal.aborted) setBusy(false); }
  }

  async function disconnect() {
    if (!connection?.connected || !active.current) return;
    if (!window.confirm('이 LectureBag 계정의 Drive 연결을 모든 기기에서 해제합니다. Drive 원본은 유지됩니다. 계속할까요?')) return;
    const signal = active.current.signal;
    setBusy(true); setError('');
    try {
      await catalog.disconnect(connection, signal);
      if (!signal.aborted) setAttempt(n => n + 1);
    } catch (err) { if (!signal.aborted) setError((err as Error).message); }
    finally { if (!signal.aborted) setBusy(false); }
  }

  return <section className="bg-white border border-neutral-200 rounded-2xl p-4 text-neutral-900 space-y-3" aria-label="Google Drive 연결 시험">
    <h3 className="font-bold text-sm">Google Drive · 내부 연결 시험</h3>
    <p className="text-xs text-neutral-500">연결·계정 검증을 위한 개발 화면입니다. 촬영 자료 자동 업로드는 아직 활성화되지 않았습니다.</p>
    <p className="text-sm">{connection?.connected ? `연결됨: ${connection.email}` : '연결되지 않음'}</p>
    {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={busy || !challenge} onClick={connect}
        className="px-3 py-2 rounded-xl bg-neutral-900 text-white text-xs disabled:opacity-40">
        {busy ? '확인 중…' : connection?.connected ? '권한 다시 확인' : 'Google Drive 연결'}
      </button>
      {connection?.connected && <button type="button" disabled={busy} onClick={disconnect}
        className="px-3 py-2 rounded-xl bg-neutral-100 text-xs disabled:opacity-40">연결 해제</button>}
      <button type="button" disabled={busy} onClick={() => setAttempt(n => n + 1)}
        className="px-3 py-2 rounded-xl bg-neutral-100 text-xs disabled:opacity-40">새로고침</button>
    </div>
  </section>;
}
