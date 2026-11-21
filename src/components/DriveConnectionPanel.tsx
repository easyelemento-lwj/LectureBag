import { LastChecked } from "./LastChecked";
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from '../hooks/useAuth';
import { auth } from '../utils/firebase';
import { CloudCatalog } from '../services/drive/cloudCatalog';
import { loadDriveOAuth, requestDriveCode, startDriveRedirect } from '../services/drive/driveAuth';
import { isNativeAndroid } from '../services/native';
import type { DriveAuthChallenge, DriveConnection } from '../services/drive/types';
import { notifyDriveChanged, useDriveSync } from '../context/DriveSyncContext';
import { useDriveLifecycle } from '../context/DriveLifecycleContext';
import { usePcLibrary } from '../context/PcLibraryContext';
import { desktopBridge } from '../services/desktop';
import { syncActionMessage } from '../utils/syncActionMessage';
import { archivePreviousDriveCaptures, trashKey } from '../utils/mediaStorage';
import { Cloud, AlertCircle, ChevronRight } from 'lucide-react';
import { PhotoRecoveryPanel } from './PhotoRecoveryPanel';
import { getAppCapabilities } from '../utils/appCapabilities';

type DrivePanelProps = { onOpen?: () => void; management?: boolean; children?: ReactNode };

export function DriveConnectionPanel(props: DrivePanelProps) {
  const { user } = useAuth();
  // Remount on UID change: no state from a previous account may be rendered.
  return user ? <DriveConnectionSession key={user.uid} user={user} {...props} /> : null;
}

function DriveConnectionSession({ user, onOpen, management = !onOpen, children }: DrivePanelProps & { user: NonNullable<ReturnType<typeof useAuth>['user']>; key?: string }) {
  const desktop = desktopBridge();
  const sync = useDriveSync();
  const lifecycle = useDriveLifecycle();
  const pc = usePcLibrary();
  const catalog = useMemo(() => new CloudCatalog(user, () => auth.currentUser?.uid), [user]);
  const [connection, setConnection] = useState<DriveConnection>();
  const [challenge, setChallenge] = useState<DriveAuthChallenge>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const active = useRef<AbortController>(null);
  const [cleaning, setCleaning] = useState(false);

  async function cleanPreviousCaptures() {
    if (!connection?.connected || !connection.connectionId || cleaning) return;
    if (!window.confirm('이 기기의 이전 Drive 연결 자료를 앱 쓰레기통으로 옮깁니다. 현재 연결의 자료와 새 촬영 자료는 유지하며 Google Drive 파일은 변경하지 않습니다. 계속할까요?')) return;
    setCleaning(true); setError('');
    try {
      const latest = await catalog.withPriority('interactive').status();
      catalog.assertOwner(user.uid);
      if (!latest.connected || latest.connectionId !== connection.connectionId) throw new Error('Drive 연결이 변경되었습니다. 다시 확인해 주세요.');
      await archivePreviousDriveCaptures(user.uid, latest.connectionId);
      if (typeof BroadcastChannel !== 'undefined') {
        const channel = new BroadcastChannel(trashKey(user.uid)); channel.postMessage('changed'); channel.close();
      }
      sync.wake();
    } catch (err) { setError(err instanceof Error ? err.message : '이전 자료를 정리하지 못했습니다.'); }
    finally { setCleaning(false); }
  }

  useEffect(() => {
    const controller = new AbortController();
    active.current = controller;
    setBusy(true); setError(''); setChallenge(undefined);
    void Promise.all([catalog.status(controller.signal), desktop ? undefined : catalog.start(controller.signal), desktop ? undefined : loadDriveOAuth()])
      .then(([status, start]) => {
        if (!controller.signal.aborted) { setConnection(status); setChallenge(start); }
      }).catch(err => { if (!controller.signal.aborted) setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    const expiry = window.setTimeout(() => {
      if (!desktop) setChallenge(undefined);
    }, 290_000);
    return () => { controller.abort(); window.clearTimeout(expiry); };
  }, [catalog, attempt, desktop]);

  async function connect() {
    if (!challenge || !active.current) return;
    if (!isNativeAndroid()) {
      try { startDriveRedirect(challenge, user.uid); }
      catch { setError('Google Drive 연결 화면을 열지 못했습니다.'); }
      return;
    }
    const signal = active.current.signal;
    setBusy(true); setError('');
    try {
      const code = await requestDriveCode(challenge, signal);
      const result = await catalog.connect(code, challenge.state, signal);
      if (!signal.aborted) { setConnection(result); setChallenge(undefined); notifyDriveChanged(user.uid); }
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
      if (!signal.aborted) { notifyDriveChanged(user.uid); setAttempt(n => n + 1); }
    } catch (err) { if (!signal.aborted) setError((err as Error).message); }
    finally { if (!signal.aborted) setBusy(false); }
  }

  const currentJobs = sync.connection?.connectionId && sync.connection.connectionId === connection?.connectionId
    ? sync.jobs : [];
  const pendingCount = currentJobs.filter(job => !['synced', 'cancelled'].includes(job.state)).length + sync.waiting;
  const problemCount = currentJobs.filter(job => ['needs_auth', 'quota_full', 'failed', 'paused'].includes(job.state)).length;
  const pausedPurges = lifecycle.state?.operations.filter(operation => operation.purge && !operation.purgeConfirmed).length || 0;
  const lifecycleError = lifecycle.error || lifecycle.state?.operations.find(operation => operation.error)?.error || lifecycle.state?.notice;
  const combinedError = error || sync.error || lifecycleError || pc.error
    || (lifecycle.files.some(file => file.driveUnavailable) ? '접근할 수 없는 Drive 원본이 있습니다. 권한과 원본 상태를 확인해 주세요.' : '');
  const syncAlert = combinedError
    ? { tone: 'error', label: '동기화 확인 필요', detail: combinedError }
    : !busy && connection && !connection.connected
      ? { tone: 'error', label: 'Drive 연결 필요', detail: '자동 업로드와 삭제·복원 동기화가 멈춰 있습니다.' }
      : problemCount > 0
        ? { tone: 'error', label: `업로드 문제 ${problemCount}개`, detail: '기기 원본은 보존되어 있습니다. 다시 시도를 눌러 주세요.' }
        : pendingCount > 0 || sync.busy || lifecycle.busy || pc.busy || !!lifecycle.state?.operations.some(operation => !operation.purge || operation.purgeConfirmed)
          ? { tone: 'pending', label: '동기화 중', detail: '자료와 삭제·복원 상태를 최신으로 맞추고 있습니다.' }
          : undefined;
  const retrying = busy || sync.busy || lifecycle.busy || pc.busy;
  const retryAll = () => {
    setError('');
    if (error || !connection?.connected) setAttempt(value => value + 1);
    sync.retry();
    lifecycle.refresh();
    if (pc.available && pc.library && pc.error) pc.start();
  };

  const warning = syncAlert?.tone === 'error';
  const failed = currentJobs.some(job => job.state === 'failed');
  const connecting = !connection && busy;
  const status = connecting ? '확인 중' : warning ? connection?.connected ? '확인 필요' : '연결 필요'
    : syncAlert ? '동기화 중' : connection?.connected ? '연결됨' : '연결 필요';
  const manageConnection = () => {
    if (desktop) { void desktop.openWeb().catch(() => setError('기본 브라우저를 열지 못했습니다.')); return; }
    if (!challenge) { setAttempt(n => n + 1); return; }
    void connect();
  };
  return <section className="relative rounded-3xl border border-neutral-200/70 bg-white p-5 text-neutral-900 shadow-2xs" aria-label="Google Drive 연결 관리">
    {onOpen && <button type="button" onClick={onOpen} aria-label="Google Drive 연결 관리 열기" className="absolute inset-0 z-10 rounded-3xl focus-visible:outline-2 focus-visible:outline-blue-600" />}
    <div className="flex items-center gap-3">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-neutral-100"><Cloud aria-hidden="true" className="h-6 w-6 text-neutral-600" /></div>
      <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-2 gap-y-1"><h3 className="text-sm font-semibold">Google Drive</h3>
        <span role="status" className={'shrink-0 rounded-full px-2.5 py-1 text-[11px] ' + (warning ? failed ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700' : status === '연결됨' ? 'bg-blue-50 text-blue-700' : 'bg-neutral-100 text-neutral-500')}>{status}</span>
      </div>
        <p className="mt-1 break-all text-xs text-neutral-500">{connection?.email || '자료를 모든 기기에서 함께 보관하세요'}</p>
      </div>
      {onOpen && <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-neutral-400" />}
    </div>
    {management && <div className="mt-5 flex flex-wrap gap-2 text-xs text-neutral-500">
          <button type="button" disabled={busy || !connection?.connected} onClick={manageConnection} className="min-h-11 rounded-full bg-[#EFEFEF] px-4 text-xs text-neutral-700 enabled:hover:bg-[#E2E2E2] enabled:active:bg-[#E2E2E2] enabled:active:scale-90 transition-[background-color,transform] motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500 disabled:opacity-50">{desktop ? '브라우저에서 연결 관리' : '권한 다시 확인'}</button>
          <button type="button" disabled={busy || !connection?.connected} onClick={disconnect} className="min-h-11 rounded-full bg-[#EFEFEF] px-4 text-xs text-neutral-700 enabled:hover:bg-[#E2E2E2] enabled:active:bg-[#E2E2E2] enabled:active:scale-90 transition-[background-color,transform] motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500 disabled:opacity-50">연결 해제</button>
          {pc.available && <button type="button" disabled={pc.busy || !pc.library} onClick={pc.library?.enabled ? pc.pause : pc.start} className="min-h-11 rounded-full bg-[#EFEFEF] px-4 text-xs text-neutral-700 enabled:hover:bg-[#E2E2E2] enabled:active:bg-[#E2E2E2] enabled:active:scale-90 transition-[background-color,transform] motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500 disabled:opacity-50">{pc.library?.enabled ? '자동 보관 일시정지' : '자동 보관 다시 시작'}</button>}
    </div>}
    {management && <div className="mt-4 border-t border-neutral-100 pt-1"><LastChecked checkedAt={lifecycle.state?.checkedAt} plain /></div>}
    {management && pausedPurges > 0 && <p role="status" className="mt-4 rounded-2xl bg-amber-50 p-4 text-xs text-amber-800">완전 삭제 요청 {pausedPurges}개가 일시 보류되어 있습니다. 자동으로 영구 삭제하지 않으며 다른 동기화는 계속합니다. 파일 탐색기에서 동기화 상태를 열고 대기 작업을 중단할 수 있습니다.</p>}
    {management && !connection?.connected && <p className="mt-3 text-xs leading-relaxed text-neutral-500">기존 보관함을 다시 열려면 이전에 연결했던 Google 계정을 선택해 주세요. 다른 계정은 기존 보관함과 연결되지 않을 수 있습니다.</p>}
    {warning && <div className="mt-4 rounded-2xl bg-neutral-50 p-4">
      <p className={'flex items-center gap-2 text-xs font-medium ' + (failed ? 'text-red-700' : 'text-amber-700')}><AlertCircle aria-hidden="true" className="h-4 w-4 shrink-0" />
        {error || syncActionMessage(combinedError, currentJobs.map(job => job.state), connection?.connected === false).replace('Google Drive 버블에서 ', '')}</p>
      {!onOpen && !retrying && <button type="button" onClick={retryAll} className="mt-3 flex min-h-11 items-center justify-center gap-2 rounded-full bg-white px-5 text-xs font-semibold shadow-2xs">다시 시도</button>}
    </div>}
    {!onOpen && !connection?.connected && !busy && <button type="button" onClick={manageConnection} className="mt-4 min-h-11 rounded-full bg-neutral-900 px-5 text-xs font-semibold text-white">{!desktop && !challenge ? '연결 준비' : 'Google Drive 연결'}</button>}
    {!management && <div className="mt-4 border-t border-neutral-100 pt-1"><LastChecked checkedAt={lifecycle.state?.checkedAt} plain /></div>}
    {management && connection?.connected && sync.previousConnection > 0 && <div className="mt-4 rounded-2xl bg-neutral-50 p-4 text-xs text-neutral-500">
      <p>이전 Drive 연결의 기기 자료 {sync.previousConnection}개가 남아 있습니다. 필요 없는 자료는 앱 쓰레기통으로 옮길 수 있습니다.</p>
      <button type="button" disabled={cleaning || busy} onClick={() => void cleanPreviousCaptures()} className="mt-3 min-h-11 rounded-full bg-[#EFEFEF] px-4 text-neutral-700 enabled:hover:bg-[#E2E2E2] enabled:active:bg-[#E2E2E2] disabled:opacity-50">{cleaning ? '정리 중…' : '이전 기기 자료 정리'}</button>
    </div>}
    {management && connection?.connected && connection.connectionId && getAppCapabilities().canCapture &&
      <PhotoRecoveryPanel key={`${user.uid}:${connection.connectionId}`} identity={{ ownerUid: user.uid, connectionId: connection.connectionId }} catalog={catalog.withPriority('interactive')} />}
    {management && children}
  </section>;
}
