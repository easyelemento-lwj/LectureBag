import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '../hooks/useAuth';
import { auth } from '../utils/firebase';
import { captureIntents } from '../utils/mediaStorage';
import { CloudCatalog } from '../services/drive/cloudCatalog';
import { enqueueCaptures, uploadCapture } from '../services/drive/captureUpload';
import { IndexedDbUploadJobStore, UploadQueue, type UploadJob } from '../services/drive/uploadQueue';
import type { DriveConnection } from '../services/drive/types';

const EVENT = 'lecturebag-drive-changed';
export function notifyDriveChanged(uid: string) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: uid }));
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(EVENT); channel.postMessage(uid); channel.close();
  }
}
interface SyncState {
  enabled: boolean;
  connection?: DriveConnection;
  jobs: UploadJob[];
  waiting: number;
  previousConnection: number;
  busy: boolean;
  error: string;
  wake: () => void;
  retry: () => void;
}
const empty: SyncState = { enabled: false, jobs: [], waiting: 0, previousConnection: 0,
  busy: false, error: '', wake: () => {}, retry: () => {} };
const DriveSyncContext = createContext<SyncState>(empty);
export const useDriveSync = () => useContext(DriveSyncContext);

export function DriveSyncProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (import.meta.env.VITE_DRIVE_INTERNAL_PREVIEW !== 'true' || !user) return <>{children}</>;
  return <DriveSyncSession key={user.uid} user={user}>{children}</DriveSyncSession>;
}

function DriveSyncSession({ children, user }: { children: ReactNode; user: NonNullable<ReturnType<typeof useAuth>['user']>; key?: string }) {
  const catalog = useMemo(() => new CloudCatalog(user, () => auth.currentUser?.uid), [user]);
  const [state, setState] = useState<SyncState>({ ...empty, enabled: true });
  const run = useRef<(retry?: boolean) => void>(() => {});
  const wake = useCallback(() => run.current(), []);
  const retry = useCallback(() => run.current(true), []);
  useEffect(() => {
    const store = new IndexedDbUploadJobStore();
    let alive = true, running = false, again = false, retryRequested = false;
    let active: AbortController | undefined;
    const update = (value: Partial<SyncState>) => { if (alive) setState(prev => ({ ...prev, ...value })); };
    const pulse = (retry = false) => {
      retryRequested ||= retry;
      if (!alive) return;
      if (running) { again = true; return; }
      running = true;
      const controller = new AbortController(); active = controller;
      const signal = controller.signal;
      const work = async () => {
        const intents = await captureIntents(user.uid);
        update({ waiting: intents.filter(item => !item.connectionId).length });
        if (!navigator.onLine) { update({ busy: false, error: '오프라인 · 사진은 기기에 보관됩니다.' }); return; }
        update({ error: '' });
        const connection = await catalog.status(signal);
        signal.throwIfAborted(); update({ connection });
        if (!connection.connected || !connection.connectionId) { update({ jobs: [], busy: false }); return; }
        const identity = { ownerUid: user.uid, connectionId: connection.connectionId };
        const queue = new UploadQueue(store, identity);
        const shouldRetry = retryRequested; retryRequested = false;
        await enqueueCaptures(identity, queue);
        signal.throwIfAborted();
        const refresh = async () => {
          const jobs = await queue.list();
          signal.throwIfAborted();
          update({ jobs, waiting: 0, previousConnection: intents.filter(item => item.connectionId && item.connectionId !== identity.connectionId).length });
        };
        for (const job of await queue.list()) {
          if (job.state === 'offline' || (shouldRetry && ['needs_auth', 'quota_full', 'paused', 'failed'].includes(job.state))) await queue.resume(job.fileId);
        }
        await refresh();
        const candidates = (await queue.list()).filter(job => ['queued', 'uploading', 'verifying', 'registering', 'retry_wait'].includes(job.state)
          && (job.retryAt || 0) <= Date.now() && (job.lease?.expiresAt || 0) <= Date.now()).slice(0, 3);
        for (const job of candidates) {
          signal.throwIfAborted(); update({ busy: true });
          try {
            await uploadCapture(identity, queue, job.fileId, catalog, signal, progress => {
              if (alive && !signal.aborted) setState(prev => ({ ...prev,
                jobs: prev.jobs.map(item => item.fileId === progress.fileId ? progress : item) }));
            });
          } catch { if (signal.aborted) break; /* Durable job carries a safe categorized error. */ }
          await refresh();
        }
      };
      const locked = navigator.locks
        ? navigator.locks.request(`lecturebag-capture-sync:${user.uid}`, { ifAvailable: true }, lock => lock ? work() : Promise.resolve())
        : work();
      void locked.catch(() => {
        if (!signal.aborted) update({ error: 'Drive 상태를 확인하지 못했습니다. 기기 원본을 보관하고 다시 시도합니다.' });
      }).finally(() => {
        running = false; update({ busy: false });
        if (again && alive) { again = false; pulse(); }
      });
    };
    run.current = pulse;
    const changed = (uid: string) => {
      if (uid !== user.uid) return;
      active?.abort(); update({ connection: undefined, jobs: [] }); pulse(true);
    };
    const onChanged = (event: Event) => changed((event as CustomEvent<string>).detail);
    const online = () => pulse();
    const visible = () => { if (document.visibilityState === 'visible') pulse(); };
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(EVENT) : undefined;
    if (channel) channel.onmessage = event => changed(event.data);
    window.addEventListener(EVENT, onChanged);
    window.addEventListener('online', online);
    document.addEventListener('visibilitychange', visible);
    const interval = window.setInterval(() => pulse(), 30_000);
    pulse();
    return () => {
      alive = false; active?.abort(); run.current = () => {};
      window.clearInterval(interval); channel?.close();
      window.removeEventListener(EVENT, onChanged); window.removeEventListener('online', online);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [catalog, user.uid]);
  return <DriveSyncContext.Provider value={{ ...state, wake, retry }}>{children}</DriveSyncContext.Provider>;
}
