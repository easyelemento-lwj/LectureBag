import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '../hooks/useAuth';
import { auth } from '../utils/firebase';
import { useDriveSync } from './DriveSyncContext';
import { CloudCatalog, CatalogError } from '../services/drive/cloudCatalog';
import { nextSyncDelay, retrySyncDelay, syncIsHidden } from '../services/drive/syncPolicy';
import { LifecycleStore, syncLifecycle, type LifecycleState } from '../services/drive/lifecycle';
import type { CloudMediaRecord } from '../services/drive/types';
import { collection, getFirestore, onSnapshot, query, where } from 'firebase/firestore';
import { announceLifecycle, readSharedOperation, sharedOperations } from '../services/drive/sharedLifecycle';
import type { TrashOperation } from '../services/drive/lifecycle';

interface LifecycleView {
  enabled: boolean; busy: boolean; connected?: boolean; state?: LifecycleState; files: CloudMediaRecord[]; error: string;
  setTrashed: (ids: string[], trashed: boolean, purge?: boolean) => Promise<void>; cancel: (operationId: string) => void; refresh: () => void;
}
const Context = createContext<LifecycleView>({ enabled: false, busy: false, files: [], error: '', setTrashed: async () => {}, cancel: () => {}, refresh: () => {} });
export const useDriveLifecycle = () => useContext(Context);
export function DriveLifecycleProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (!user || import.meta.env.VITE_DRIVE_INTERNAL_PREVIEW !== 'true') return <>{children}</>;
  return <Session key={user.uid} user={user}>{children}</Session>;
}

function Session({ user, children }: { user: NonNullable<ReturnType<typeof useAuth>['user']>; children: ReactNode; key?: string }) {
  const sync = useDriveSync();
  const catalog = useMemo(() => new CloudCatalog(user, () => auth.currentUser?.uid), [user]);
  const store = useMemo(() => new LifecycleStore(), []);
  const [state, setState] = useState<LifecycleState>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [shared, setShared] = useState<{ connectionId: string; operations: TrashOperation[] }>();
  const [watchError, setWatchError] = useState('');
  const reconcileRequested = useRef(false);
  const run = useRef<(force?: boolean) => void>(() => {});
  const connectionId = sync.connection?.connected ? sync.connection.connectionId : undefined;
  const stateRef = useRef(state); stateRef.current = state;
  useEffect(() => {
    if (!connectionId) return;
    let alive = true;
    let previous = new Set<string>();
    const source = query(collection(getFirestore(auth.app), 'users', user.uid, 'driveFileIntents'),
      where('connectionId', '==', connectionId));
    const unsubscribe = onSnapshot(source, snapshot => {
      if (!alive || auth.currentUser?.uid !== user.uid) return;
      const operations = snapshot.docs.flatMap(doc => {
        const op = readSharedOperation(doc.data(), connectionId);
        return op ? [op] : [];
      });
      const next = new Set(operations.map(op => op.operationId));
      const completed = [...previous].some(id => !next.has(id));
      previous = next;
      setShared({ connectionId, operations }); setWatchError('');
      // Completion commits together with the catalog change; fetch it now,
      // without waiting for the ordinary one-minute background interval.
      if (completed && !snapshot.metadata.fromCache) run.current(true);
    }, () => {
      if (alive) setWatchError('다른 기기의 삭제·복원 상태를 연결하지 못했습니다. 새로고침해 주세요.');
    });
    return () => { alive = false; unsubscribe(); };
  }, [connectionId, user.uid]);
  useEffect(() => {
    let alive = true;
    void store.last(user.uid).then(saved => { if (alive && saved) setState(saved); }).catch(() => {});
    return () => { alive = false; };
  }, [store, user.uid]);
  useEffect(() => {
    setBusy(false);
    reconcileRequested.current = false;
    if (!connectionId) return;
    const scope = { ownerUid: user.uid, connectionId };
    let alive = true, running = false, again = false, nextRun = 0, failures = 0;
    const controller = new AbortController();
    const reload = async () => {
      try { const saved = await store.read(scope); if (alive) setState(saved); }
      catch { if (alive) setError('기기 동기화 기록을 읽지 못했습니다. 저장소를 확인해 주세요.'); }
    };
    const pulse = (force = false) => {
      if (!alive) return;
      if (running) { again ||= force; return; }
      if (!force && Date.now() < nextRun) { void reload(); return; }
      running = true;
      setBusy(true);
      const work = async () => {
        if (!navigator.onLine) { setError('인터넷 연결 후 다시 확인해 주세요. 마지막 확인 상태는 유지됩니다.'); await reload(); return; }
        // Reset inside the worker lock: a running background pass must not
        // overwrite the manual refresh before its queued turn starts.
        if (reconcileRequested.current) {
          reconcileRequested.current = false;
          await store.change(scope, s => ({ ...s, reconciledAt: 0, notice: undefined,
            operations: s.operations.map(op => ({ ...op, retryAt: 0 })) }));
        }
        // Each scoped server route validates the current connection itself.
        // A separate status request before every pass duplicated that work.
        const client = force ? catalog.withPriority('interactive') : catalog;
        await announceLifecycle(client, store, scope, controller.signal, reload);
        await syncLifecycle(client, store, scope, controller.signal, reload, force);
        nextRun = Date.now() + nextSyncDelay(syncIsHidden()); failures = 0;
        if (alive) setError('');
      };
      const task = navigator.locks
        ? force
          ? navigator.locks.request(`lecturebag-lifecycle:${user.uid}`, { signal: controller.signal }, () => work())
          : navigator.locks.request(`lecturebag-lifecycle:${user.uid}`, { ifAvailable: true }, lock => lock ? work() : reload())
        : work();
      void task.catch(e => { if (alive && !controller.signal.aborted) {
        failures++; nextRun = Date.now() + retrySyncDelay(failures, e instanceof CatalogError ? e.retryAt : undefined);
        setError(e instanceof Error ? e.message : '삭제 동기화 상태를 확인하지 못했습니다.');
      } })
        .finally(() => { running = false; if (!alive) return; setBusy(false); void reload(); if (again) { again = false; pulse(true); } });
    };
    run.current = pulse;
    const visible = () => { if (document.visibilityState === 'visible') pulse(true); };
    const online = () => pulse(true);
    const interval = window.setInterval(() => pulse(), 5000);
    window.addEventListener('online', online);
    window.addEventListener('lecturebag-desktop-wake', online);
    document.addEventListener('visibilitychange', visible);
    void store.activate(scope).then(reload).then(() => pulse()).catch(() => { if (alive) setError('동기화 저장소를 열지 못했습니다.'); });
    return () => {
      alive = false; controller.abort(); run.current = () => {};
      window.clearInterval(interval); window.removeEventListener('online', online);
      window.removeEventListener('lecturebag-desktop-wake', online);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [connectionId, catalog, store, user.uid, sync.wake]);

  const scopedState = state?.ownerUid === user.uid && (!connectionId || state.connectionId === connectionId) ? state : undefined;
  const visibleState = useMemo(() => scopedState ? { ...scopedState, operations: sharedOperations(scopedState.operations,
    connectionId && shared?.connectionId === connectionId ? shared.operations : []) } : undefined, [scopedState, shared, connectionId]);
  const setTrashed = async (ids: string[], trashed: boolean, purge = false) => {
    const current = stateRef.current;
    if (!current || !current.cursor || sync.connection?.connected === false ||
      (connectionId && current.connectionId !== connectionId)) throw new Error('Drive를 연결하고 목록 확인을 마친 뒤 다시 시도해 주세요.');
    catalog.assertOwner(user.uid);
    if (visibleState?.operations.some(op => ids.includes(op.fileId))) throw new Error('선택한 파일의 삭제·복원이 진행 중입니다.');
    const saved = await store.enqueue(current, ids, trashed, purge);
    catalog.assertOwner(user.uid); setState(saved); run.current(true);
  };
  return <Context.Provider value={{ enabled: true, busy, connected: sync.connection?.connected, state: visibleState, files: visibleState?.files || [],
    error: error || (connectionId ? watchError : ''), setTrashed, cancel: operationId => {
      if (auth.currentUser?.uid !== user.uid) return;
      const scope = stateRef.current;
      if (!scope) return;
      void store.change(scope, s => ({ ...s, operations: s.operations.map(op => op.operationId === operationId && !op.purge
        ? { ...op, cancelRequested: true, retryAt: 0 } : op) })).then(saved => { setState(saved); run.current(true); })
        .catch(() => setError('중단 요청을 기기에 저장하지 못했습니다.'));
    }, refresh: () => {
      if (auth.currentUser?.uid !== user.uid) return;
      if (!navigator.onLine) { setError('인터넷 연결 후 다시 확인해 주세요. 마지막 확인 상태는 유지됩니다.'); return; }
      if (!connectionId) {
        setError(sync.connection?.connected === false ? 'Drive 연결이 필요합니다. 앱 센터에서 연결을 확인해 주세요.' : 'Drive 연결을 확인 중입니다. 잠시 후 다시 눌러 주세요.');
        sync.wake(); return;
      }
      setError(''); setBusy(true); reconcileRequested.current = true;
      run.current(true);
    } }}>{children}</Context.Provider>;
}
