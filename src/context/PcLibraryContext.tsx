import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '../hooks/useAuth';
import { auth } from '../utils/firebase';
import { getAppCapabilities } from '../utils/appCapabilities';
import { CloudCatalog, CatalogError } from '../services/drive/cloudCatalog';
import { driveReadError } from '../services/drive/cloudBrowser';
import { DriveTransferError } from '../services/drive/driveClient';
import { PcLibraryStore, type PcLibraryState } from '../services/drive/pcLibrary';
import { syncPcLibrary, type PcProgress } from '../services/drive/pcSync';
import { useDriveSync } from './DriveSyncContext';
import { nextSyncDelay, retrySyncDelay, syncIsHidden } from '../services/drive/syncPolicy';

interface PcState { available: boolean; library?: PcLibraryState; progress?: PcProgress; busy: boolean; watching: boolean; error: string; start: () => void; pause: () => void; rescan: () => void }
const empty: PcState = { available: false, busy: false, watching: false, error: '', start: () => {}, pause: () => {}, rescan: () => {} };
const Context = createContext<PcState>(empty);
export const usePcLibrary = () => useContext(Context);
export function PcLibraryProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth(); const [desktop] = useState(() => !getAppCapabilities().canCapture);
  if (!desktop || !user || import.meta.env.VITE_DRIVE_INTERNAL_PREVIEW !== 'true') return <>{children}</>;
  return <Session key={user.uid} user={user}>{children}</Session>;
}
function Session({ user, children }: { user: NonNullable<ReturnType<typeof useAuth>['user']>; children: ReactNode; key?: string }) {
  const catalog = useMemo(() => new CloudCatalog(user, () => auth.currentUser?.uid), [user]);
  const remote = useDriveSync(); const store = useMemo(() => new PcLibraryStore(), []);
  const [state, setState] = useState<PcState>({ ...empty, available: true });
  const actions = useRef({ start: (_fullScan = false) => {}, pause: () => {}, block: () => {} });
  useEffect(() => {
    let alive = true, running = false, working = false, setting = false, active: AbortController | undefined, failures = 0, nextRun = 0;
    let rerun = false, fullScan = false, requested = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const update = (value: Partial<PcState>) => { if (alive) setState(prev => ({ ...prev, ...value })); };
    const refresh = async () => { const library = await store.state(user.uid); if (alive) update({ library }); };
    const accessLost = (error: unknown) => error instanceof DriveTransferError && (error.code === 'needs_auth' || error.httpStatus === 403) ||
      error instanceof CatalogError && (error.httpStatus === 401 || error.httpStatus === 403 ||
        ['DRIVE_NEEDS_AUTH', 'DRIVE_SCOPE_REQUIRED', 'DRIVE_CONNECTION_CHANGED', 'DRIVE_DISABLED'].includes(error.code));
    const pause = async (block = false) => {
      rerun = false; active?.abort(); clearTimeout(retry); update({ watching: false }); if (block) update({ library: undefined });
      await store.pause(user.uid, block); await refresh();
      if (block) update({ error: '연결 상태가 변경되어 PC 사본 접근을 중단했습니다. 연결 확인 후 다시 활성화해 주세요.' });
    };
    const run = async () => {
      if (!alive || running || setting || failures >= 3 || Date.now() < nextRun) return;
      const current = await store.state(user.uid);
      if (!alive || running || !current?.enabled || current.blocked) return;
      if (!navigator.onLine) { update({ error: '오프라인 · 내려받은 PC 사본은 계속 열 수 있습니다.' }); return; }
      if (!navigator.locks) { update({ error: '안전한 다중 창 동기화를 위해 최신 PC Chrome 또는 Edge를 사용해 주세요.' }); return; }
      running = true; const controller = new AbortController(); active = controller; update({ error: '' });
      try {
        await navigator.locks.request(`lecturebag-pc-sync:${user.uid}`, { ifAvailable: true }, async lock => {
          if (!lock) { update({ error: '다른 창에서 PC 동기화를 진행 중입니다.' }); return; }
          working = true; update({ busy: true, watching: false });
          const forced = fullScan; fullScan = false;
          const progress = (progress: PcProgress) => {
            if (!controller.signal.aborted) update({ progress });
          };
          const client = requested ? catalog.withPriority('interactive') : catalog; requested = false;
          await syncPcLibrary(client, current, store, controller.signal, progress, refresh, { fullScan: forced });
          failures = 0;
          nextRun = Date.now() + nextSyncDelay(syncIsHidden());
          update({ watching: true });
        });
      } catch (error) {
        if (!controller.signal.aborted && alive) {
          if (accessLost(error)) await pause(true);
          else {
            if (error instanceof CatalogError && error.code === 'DRIVE_SYNC_NOT_AVAILABLE') {
              // A rolled-back/old server may accept registrations without journal
              // entries. Re-bootstrap after upgrade instead of trusting an old cursor.
              await store.invalidateCursor(current); fullScan = true;
            }
            const throttled = (error instanceof CatalogError || error instanceof DriveTransferError) && error.httpStatus === 429;
            if (!throttled) failures++;
            const quota = error instanceof DOMException && error.name === 'QuotaExceededError';
            if (quota || error instanceof DriveTransferError && ['failed', 'quota_full'].includes(error.code) ||
              error instanceof CatalogError && !error.retryable) failures = 3;
            update({ error: quota ? 'PC 저장 공간이 부족합니다. 저장된 원본은 유지됩니다. 공간을 확보한 뒤 다시 동기화해 주세요.'
              : `${driveReadError(error)} 완료된 파일과 중간 조각은 유지됩니다.${failures >= 3 ? ' 자동 재시도를 중단했습니다.' : ''}` });
            if (throttled || failures < 3) {
              const delay = retrySyncDelay(failures, error instanceof CatalogError || error instanceof DriveTransferError ? error.retryAt : undefined);
              nextRun = Date.now() + delay; clearTimeout(retry); retry = setTimeout(pulse, delay + 10);
            }
          }
        }
      } finally {
        running = false; working = false; if (active === controller) active = undefined;
        await refresh(); update({ busy: false });
        if (rerun && alive && !setting) { rerun = false; pulse(); }
      }
    };
    actions.current = {
      start: (force = false) => { if (setting || working) return; setting = true; fullScan ||= force; requested = true; rerun = true; active?.abort();
        // Called directly in a click gesture. Denial doesn't pretend persistence was granted.
        const persistence = navigator.storage?.persist?.().catch(() => false) ?? Promise.resolve(false);
        const controller = new AbortController(); active = controller; update({ busy: true, error: '' });
        void (async () => {
          const connection = await catalog.withPriority('interactive').status(controller.signal); controller.signal.throwIfAborted(); catalog.assertOwner(user.uid);
          const persistent = await persistence; controller.signal.throwIfAborted();
          await store.configure(user.uid, connection, true, persistent); failures = 0; nextRun = 0; clearTimeout(retry); await refresh();
        })().catch(async error => { if (!controller.signal.aborted) {
          if (accessLost(error)) await pause(true).catch(() => update({ library: undefined }));
          update({ error: driveReadError(error) });
          if (error instanceof CatalogError && error.httpStatus === 429) {
            clearTimeout(retry); retry = setTimeout(() => { if (alive) actions.current.start(force); }, retrySyncDelay(1, error.retryAt));
          }
        } })
          .finally(() => { setting = false; if (active === controller) active = undefined; update({ busy: false }); if (alive) pulse(); });
      },
      pause: () => { void pause().catch(() => update({ error: '동기화 중지 상태를 저장하지 못했습니다.' })); },
      block: () => { void pause(true).catch(() => update({ error: '연결 변경 상태를 저장하지 못했습니다. 이 창을 닫아 주세요.' })); },
    };
    const pulse = () => { if (running) { rerun = true; return; } void run().catch(() => update({ error: 'PC 보관소를 확인하지 못했습니다.' })); };
    const online = () => { failures = 0; nextRun = 0; pulse(); };
    const offline = () => { active?.abort(); update({ watching: false, error: '오프라인 · 내려받은 PC 사본은 계속 열 수 있습니다. 연결되면 자동으로 이어받습니다.' }); };
    const visibility = () => { if (document.visibilityState === 'visible') { nextRun = 0; void refresh().catch(() => {}); pulse(); } };
    const changed = (uid: string) => { if (uid === user.uid) actions.current.block(); };
    const event = (e: Event) => changed((e as CustomEvent<string>).detail);
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('lecturebag-drive-changed') : undefined;
    if (channel) channel.onmessage = e => changed(e.data);
    window.addEventListener('lecturebag-drive-changed', event); window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    window.addEventListener('lecturebag-desktop-wake', online);
    document.addEventListener('visibilitychange', visibility);
    // Local-only refresh lets follower tabs observe the lock owner's new files.
    const interval = setInterval(() => { void refresh().catch(() => {}); if (!running) pulse(); }, 5000);
    void refresh().then(run).catch(() => update({ error: 'PC 보관소를 읽지 못했습니다.' }));
    return () => { alive = false; active?.abort(); clearInterval(interval); clearTimeout(retry); channel?.close();
      window.removeEventListener('lecturebag-drive-changed', event); window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
      window.removeEventListener('lecturebag-desktop-wake', online);
      document.removeEventListener('visibilitychange', visibility); };
  }, [catalog, store, user.uid]);
  useEffect(() => {
    // A new PC starts keeping this account's connected library automatically.
    // Existing paused or blocked libraries still require an explicit restart.
    if (remote.connection?.connected && !state.library && !state.busy) {
      let cancelled = false;
      void store.state(user.uid).then(library => {
        if (!cancelled && !library) actions.current.start();
      }).catch(() => {});
      return () => { cancelled = true; };
    }
  }, [remote.connection, state.library, store, user.uid]);
  useEffect(() => {
    if (remote.connection && state.library && !state.library.blocked && (!remote.connection.connected ||
      remote.connection.connectionId !== state.library.connection.connectionId)) actions.current.block();
  }, [remote.connection, state.library]);
  return <Context.Provider value={{ ...state, start: () => actions.current.start(), rescan: () => actions.current.start(true), pause: () => actions.current.pause() }}>{children}</Context.Provider>;
}
