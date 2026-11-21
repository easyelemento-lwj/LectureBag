import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { User } from 'firebase/auth';
import { get, set } from 'idb-keyval';
import type { SemesterTimetable } from '../types';
import { accountKey } from '../utils/accountStorage';
import { describeTimetable, needsInitialChoice, sameTimetable, type TimetableValue } from '../utils/timetableConflict';

type Value = TimetableValue;
type Snapshot = Value & { revision: number };
type Cache = { value: Value; revision: number; requestId?: string };
type Comparison = { local: string[]; server: string[] };
export type TimetableSync = { message: string; editable: boolean; conflict: boolean; comparison?: Comparison; retry: () => void; useServer: () => void; useLocal: () => void; downloadVersions: () => void };
const empty: Value = { timetables: [], storageMode: 'default' };

async function request(user: User, body?: unknown): Promise<Snapshot> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const token = await user.getIdToken();
    const base = import.meta.env.VITE_PROXY_SERVER_URL || 'https://lecturebag-production.up.railway.app';
    const response = await fetch(`${base}/api/timetables`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: controller.signal,
      credentials: 'omit', cache: 'no-store', redirect: 'error',
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw Object.assign(new Error(typeof data?.detail === 'string' ? data.detail : '시간표 동기화에 실패했습니다.'), { status: response.status });
    return data;
  } finally { clearTimeout(timer); }
}

/** PC legacy data is never a bootstrap candidate. Pending edits survive reloads. */
export function useAccountTimetable(user: User | null, mobile: boolean) {
  const [view, setView] = useState<Value>(empty);
  const [owner, setOwner] = useState(user?.uid);
  const [status, setStatus] = useState<{ message: string; editable: boolean; conflict: boolean; comparison?: Comparison }>({ message: '시간표를 확인하고 있습니다.', editable: false, conflict: false });
  const actions = useRef<{ change: (fn: (value: Value) => Value) => void; retry: () => void; useServer: () => void; useLocal: () => void; downloadVersions: () => void }>();
  useEffect(() => {
    setOwner(user?.uid);
    setView(empty);
    setStatus({ message: '시간표를 확인하고 있습니다.', editable: false, conflict: false });
    if (!user) { actions.current = undefined; return; }
    const currentUser = user;
    const cacheKey = accountKey(user.uid, 'timetable_sync_v1');
    const legacyKey = `lecture_snap_semester_timetables_${user.uid}`;
    const modeKey = accountKey(user.uid, 'lecture_snap_storage_mode');
    let alive = true, busy = false, loaded = false, allowed = false, conflict = false;
    let cache: Cache = { value: empty, revision: 0 };
    let remoteConflict: Snapshot | undefined;
    const show = (message: string, editable = false, isConflict = false, comparison?: Comparison) => {
      allowed = editable;
      if (alive) setStatus({ message, editable, conflict: isConflict, comparison });
    };
    const markConflict = (remote?: Snapshot) => {
      conflict = true; remoteConflict = remote;
      show('이 기기와 계정의 시간표가 다릅니다. 자동 변경을 멈췄습니다. 사용할 시간표를 선택해 주세요.', false, true,
        remote ? { local: describeTimetable(cache.value), server: describeTimetable(remote) } : undefined);
    };
    const backup = async (value: Value, reason: string) => {
      // Account-scoped recovery snapshots are retained if the user switches versions.
      await set(accountKey(user.uid, `timetable_backup_${Date.now()}_${crypto.randomUUID()}`), { value, reason, savedAt: Date.now() });
    };
    async function persist() {
      // Store pending intent first; legacy data is only replaced after a successful server save/read.
      await set(cacheKey, cache);
      if (!cache.requestId && cache.revision > 0) {
        await set(legacyKey, cache.value.timetables);
        localStorage.setItem(modeKey, cache.value.storageMode);
      }
    }
    async function sync(discardPending = false) {
      if (!alive || !loaded || busy || (conflict && !discardPending)) return;
      busy = true;
      show(cache.requestId ? '시간표를 계정에 저장하고 있습니다.' : '시간표를 확인하고 있습니다.');
      try {
        if (discardPending) {
          // Fetch first: a network failure must not erase the pending local edit.
          const remote = await request(currentUser);
          if (!alive) return;
          if (!remote.revision) throw new Error('모바일 시간표가 아직 서버에 저장되지 않았습니다.');
          if (!sameTimetable(cache.value, remote)) await backup(cache.value, 'before_use_server');
          cache = { value: { timetables: remote.timetables, storageMode: remote.storageMode }, revision: remote.revision };
          conflict = false; remoteConflict = undefined;
        } else if (!cache.requestId) {
          const remote = await request(currentUser);
          if (!alive) return;
          if (remote.revision) {
            if (needsInitialChoice(cache.value, cache.revision, remote)) { await persist(); markConflict(remote); return; }
            cache = { value: { timetables: remote.timetables, storageMode: remote.storageMode }, revision: remote.revision };
          } else if (mobile && cache.value.timetables.length) {
            cache = { ...cache, revision: 0, requestId: crypto.randomUUID() };
          } else {
            await persist();
            if (!alive) return;
            show(mobile ? '시간표를 등록하면 PC에도 함께 표시됩니다.' : '모바일에서 앱을 열어 기존 시간표를 동기화해 주세요.', mobile);
            return;
          }
        }
        await persist();
        if (!alive) return;
        if (cache.requestId) {
          const result = await request(currentUser, { ...cache.value, expectedRevision: cache.revision,
            requestId: cache.requestId, source: mobile ? 'mobile' : 'desktop' });
          if (!alive) return;
          cache = { value: cache.value, revision: result.revision };
          await persist();
        }
        if (!alive) return;
        setView(cache.value);
        show('모든 기기에 같은 시간표를 사용합니다.', true);
      } catch (error) {
        if (!alive) return;
        if ((error as { status?: number }).status === 409) {
          let latest: Snapshot | undefined;
          try { latest = await request(currentUser); } catch { /* both versions remain untouched */ }
          if (alive) markConflict(latest);
        } else {
          const detail = error instanceof Error ? error.message : '';
          show(`${detail || '시간표를 동기화하지 못했습니다.'} 기기의 시간표는 유지됩니다. 다시 확인해 주세요.`);
        }
      } finally { busy = false; }
    }
    actions.current = {
      change(fn) {
        if (!alive || !loaded || !allowed || busy) return;
        const value = fn(cache.value);
        cache = { ...cache, value, requestId: cache.revision > 0 || value.timetables.length ? crypto.randomUUID() : undefined };
        setView(cache.value);
        // Both timetable and mode changes in one event are one account update.
        queueMicrotask(() => { void sync(); });
      },
      retry: () => { void sync(); },
      useServer: () => { void sync(true); },
      downloadVersions: () => {
        if (!remoteConflict || !conflict) return;
        const blob = new Blob([JSON.stringify({ format: 'lecturebag-timetable-backup-v1', savedAt: new Date().toISOString(),
          device: cache.value, account: { timetables: remoteConflict.timetables, storageMode: remoteConflict.storageMode } }, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob), link = document.createElement('a');
        link.href = url; link.download = 'lecturebag-timetable-backup.json'; link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      },
      useLocal: () => { void (async () => {
        if (!alive || busy || !conflict) return;
        busy = true;
        try {
          const remote = await request(currentUser);
          if (!alive) return;
          if (remote.revision && !sameTimetable(cache.value, remote)) await backup(remote, 'before_use_device');
          if (!alive) return;
          // Persist the intended update before sending it; the revision check prevents
          // overwriting a concurrent change after this read.
          cache = { value: cache.value, revision: remote.revision, requestId: crypto.randomUUID() };
          await persist();
          const result = await request(currentUser, { ...cache.value, expectedRevision: cache.revision,
            requestId: cache.requestId, source: mobile ? 'mobile' : 'desktop' });
          if (!alive) return;
          cache = { value: cache.value, revision: result.revision }; await persist();
          conflict = false; remoteConflict = undefined; setView(cache.value); show('모든 기기에 같은 시간표를 사용합니다.', true);
        } catch (error) {
          if (!alive) return;
          if ((error as { status?: number }).status === 409) { let latest: Snapshot | undefined; try { latest = await request(currentUser); } catch {} markConflict(latest); }
          else { conflict = true; show('시간표를 저장하지 못했습니다. 두 시간표는 유지됩니다. 다시 선택해 주세요.', false, true,
            remoteConflict ? { local: describeTimetable(cache.value), server: describeTimetable(remoteConflict) } : undefined); }
        } finally { busy = false; }
      })(); },
    };
    void (async () => {
      try {
        const saved = await get<Cache>(cacheKey);
        const legacy = mobile && (!saved || (!saved.revision && !saved.requestId && !saved.value.timetables.length)) ? await get<SemesterTimetable[]>(legacyKey) : undefined;
        if (!alive) return;
        cache = legacy?.length ? { revision: 0, value: { timetables: legacy, storageMode: localStorage.getItem(modeKey) === 'timetable' ? 'timetable' : 'default' } } : saved || { revision: 0, value: { timetables: legacy || [],
          storageMode: mobile && localStorage.getItem(modeKey) === 'timetable' ? 'timetable' : 'default' } };
        setView(cache.value);
        loaded = true;
        void sync();
      } catch { show('기기의 시간표를 읽지 못했습니다. 앱을 다시 열어 주세요.'); }
    })();
    const refresh = () => { if (document.visibilityState === 'visible') void sync(); };
    const interval = setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      alive = false; actions.current = undefined; clearInterval(interval);
      window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [user?.uid, mobile]);
  const setTimetables: Dispatch<SetStateAction<SemesterTimetable[]>> = update => actions.current?.change(value => ({
    ...value, timetables: typeof update === 'function' ? update(value.timetables) : update,
  }));
  const setStorageMode: Dispatch<SetStateAction<Value['storageMode']>> = update => actions.current?.change(value => ({
    ...value, storageMode: typeof update === 'function' ? update(value.storageMode) : update,
  }));
  const sameAccount = owner === user?.uid;
  return { ...(sameAccount ? view : empty), setTimetables, setStorageMode, timetableSync: { ...(sameAccount ? status : {
    message: '시간표를 확인하고 있습니다.', editable: false, conflict: false }),
    retry: () => actions.current?.retry(), useServer: () => actions.current?.useServer(), useLocal: () => actions.current?.useLocal(), downloadVersions: () => actions.current?.downloadVersions() } satisfies TimetableSync };
}
