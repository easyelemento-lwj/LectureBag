import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { get } from 'idb-keyval';
import { captureIntents, updateTrash } from '../utils/mediaStorage';
import { accountKey, documentKey } from '../utils/accountStorage';
import { MediaFile } from '../types';
import { useAuth } from '../hooks/useAuth';
import { useDriveLifecycle } from './DriveLifecycleContext';
import { projectTrash } from '../services/drive/trashProjection';
import { removeLegacySummaries } from '../utils/removeLegacySummaries';
import { DownloadCache } from '../services/drive/downloadCache';
import { PcLibraryStore } from '../services/drive/pcLibrary';

import { restoreTrashEntries, purgeTrashEntries, purgeExpiredTrash, type TrashEntry } from '../utils/trash';

interface TrashState {
  entries: TrashEntry[];
  moveToTrash: (files: MediaFile[]) => Promise<boolean>;
  restore: (ids: string[]) => Promise<boolean>;
  permanentlyDelete: (ids: string[]) => Promise<boolean>;
}
const TrashContext = createContext<TrashState | null>(null);

export function TrashProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const storageKey = `lecture_snap_trash_${user?.uid ?? 'guest'}`;
  return <TrashStorage key={storageKey} storageKey={storageKey} userId={user?.uid ?? 'guest'}>{children}</TrashStorage>;
}

function TrashStorage({ children, storageKey, userId }: { children: React.ReactNode; storageKey: string; userId: string; key?: string }) {
  const lifecycle = useDriveLifecycle();
  const [entries, setEntries] = useState<TrashEntry[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const channel = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    let cancelled = false;
    removeLegacySummaries(userId).then(() => updateTrash(userId, entries => entries, lifecycle.enabled)).then(initial => {
      if (cancelled) return;
      setEntries(initial);
      setReady(true);
      setError('');
    }).catch(() => { if (!cancelled) setError('쓰레기통을 불러오지 못했습니다. 다시 시도해 주세요.'); });
    return () => { cancelled = true; };
  }, [storageKey, userId, attempt, lifecycle.enabled]);

  const commit = async (change: (prev: TrashEntry[]) => TrashEntry[]): Promise<boolean> => {
    if (!ready) return false;
    try {
      const next = await updateTrash(userId, change, lifecycle.enabled);
      setEntries(next);
      channel.current?.postMessage('changed');
      setError('');
      return true;
    } catch {
      setError('저장 공간을 확인해 주세요. 변경 사항을 저장하지 못했습니다.');
      return false;
    }
  };
  const localTrash = (files: MediaFile[]) => commit(prev => {
    const ids = new Set(files.map(file => file.id));
    const added = files.filter(file => !prev.some(entry => entry.purged && entry.file.id === file.id)).map(file => ({
      file,
      deletedAt: new Date().toISOString(),
      documentContent: file.type === 'document'
        ? localStorage.getItem(documentKey(userId, file.id)) ?? prev.find(entry => entry.file.id === file.id)?.documentContent
        : undefined,
    }));
    return [...added, ...prev.filter(entry => entry.purged || !ids.has(entry.file.id))];
  });
  const projected = useMemo(() => projectTrash(entries, lifecycle.state), [entries, lifecycle.state]);
  const safeAction = async (work: () => Promise<boolean>) => {
    try { return await work(); } catch (error) { setError(error instanceof Error ? error.message : '휴지통 상태를 변경하지 못했습니다.'); return false; }
  };
  const ensureCatalog = () => {
    if (lifecycle.enabled && !lifecycle.state?.cursor) throw new Error('Drive 목록 확인을 마친 뒤 삭제·복원을 다시 시도해 주세요.');
  };
  const moveToTrash = (files: MediaFile[]) => safeAction(async () => {
    ensureCatalog();
    const cloudIds = files.filter(f => lifecycle.files.some(c => c.id === f.id)).map(f => f.id);
    const localFiles = files.filter(f => !cloudIds.includes(f.id));
    // An in-flight upload can register after a local delete. Until registered,
    // refuse this ambiguous operation instead of leaving a live Drive orphan.
    const intents = await captureIntents(userId);
    if (lifecycle.enabled && localFiles.some(f => intents.some(i => i.fileId === f.id))) {
      throw new Error('아직 Drive 등록이 완료되지 않은 자료가 있습니다. 업로드 완료 후 삭제해 주세요.');
    }
    if (cloudIds.length) {
      if (!window.confirm(`${cloudIds.length}개 파일을 모든 기기와 Google Drive의 휴지통으로 이동할까요? Drive 휴지통에서는 30일 후 영구 삭제될 수 있습니다.`)) return false;
      await lifecycle.setTrashed(cloudIds, true);
    }
    return localFiles.length ? localTrash(localFiles) : true;
  });
  const restore = (ids: string[]) => safeAction(async () => {
    ensureCatalog();
    const cloudIds = ids.filter(id => lifecycle.files.some(f => f.id === id));
    if (cloudIds.length) await lifecycle.setTrashed(cloudIds, false);
    const localIds = ids.filter(id => !cloudIds.includes(id));
    return localIds.length ? commit(prev => restoreTrashEntries(prev, localIds)) : true;
  });

  const permanentlyDelete = (ids: string[]) => safeAction(async () => {
    ensureCatalog();
    const selected = projected.filter(entry => ids.includes(entry.file.id));
    if (!selected.length || selected.length !== new Set(ids).size || selected.some(entry => entry.restored || entry.purged || entry.cloud?.pending || entry.cloud?.unavailable)) {
      throw new Error('쓰레기통의 최신 상태를 확인한 뒤 다시 삭제해 주세요.');
    }
    const intents = await captureIntents(userId);
    if (lifecycle.enabled && selected.some(entry => !entry.cloud && intents.some(intent => intent.fileId === entry.file.id))) {
      throw new Error('Drive 등록이 진행 중인 자료가 있습니다. 동기화 완료 후 완전 삭제해 주세요.');
    }
    if (!window.confirm(`${selected.length}개 파일을 완전 삭제할까요? 연결된 Google Drive 쓰레기통의 원본과 앱의 기기 사본도 삭제됩니다. 삭제 후에는 복원할 수 없습니다.`)) return false;
    const cloudIds = selected.filter(entry => entry.cloud).map(entry => entry.file.id);
    if (cloudIds.length) await lifecycle.setTrashed(cloudIds, true, true);
    const localIds = ids.filter(id => !cloudIds.includes(id));
    return localIds.length ? commit(prev => purgeTrashEntries(prev, localIds)) : true;
  });

  const confirmedPurges = useMemo(() => lifecycle.files.filter(file => !!file.purgedAt), [lifecycle.files]);
  useEffect(() => {
    if (!ready || !confirmedPurges.length) return;
    let alive = true;
    // A server-confirmed tombstone, never a pending command, removes sources.
    void updateTrash(userId, previous => {
      const markers: TrashEntry[] = confirmedPurges.map(file => ({
        file: { id: file.id, type: file.kind, name: '', timestamp: file.capturedAt },
        deletedAt: file.deletedAt || file.purgedAt!, purged: true,
      }));
      const ids = new Set(markers.map(entry => entry.file.id));
      return [...previous.filter(entry => !ids.has(entry.file.id)), ...markers];
    }, true).then(async next => {
      for (const file of confirmedPurges) {
        await new DownloadCache().purge(file);
        await new PcLibraryStore().purge(file);
      }
      if (alive) { setEntries(next); channel.current?.postMessage('changed'); }
    })
      .catch(() => { if (alive) setError('Drive 완전 삭제는 완료됐지만 기기 사본 정리를 다시 확인해야 합니다.'); });
    return () => { alive = false; };
  }, [ready, confirmedPurges, userId]);

  useEffect(() => {
    if (!ready) return;
    const sweep = () => {
      void updateTrash(userId, prev => lifecycle.enabled ? prev : purgeExpiredTrash(prev), lifecycle.enabled).then(next => {
        setEntries(next);
        channel.current?.postMessage('changed');
      }).catch(() => {
        setError('자동 삭제를 저장하지 못했습니다. 잠시 후 다시 시도합니다.');
      });
    };
    const onVisible = () => { if (document.visibilityState === 'visible') sweep(); };
    const interval = window.setInterval(sweep, 60_000);
    window.addEventListener('focus', sweep);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', sweep);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [ready, userId, lifecycle.enabled]);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const connection = new BroadcastChannel(storageKey);
    channel.current = connection;
    let cancelled = false;
    connection.onmessage = () => {
      void get<TrashEntry[]>(storageKey).then(saved => {
        if (!cancelled) setEntries(saved ?? []);
      }).catch(() => { if (!cancelled) setError('쓰레기통 동기화에 실패했습니다.'); });
    };
    return () => { cancelled = true; channel.current = null; connection.close(); };
  }, [storageKey]);

  useEffect(() => {
    const purged = entries.filter(entry => entry.purged);
    if (!purged.length) return;
    const ids = new Set(purged.map(entry => entry.file.id));
    const removeFiles = (files: MediaFile[] = []) => files.filter(file => !ids.has(file.id));
    let cancelled = false;
    let retry: number | undefined;
    const cleanup = async () => {
      try {
        const key = accountKey(userId, 'ai_docs');
        const saved = localStorage.getItem(key);
        if (saved) localStorage.setItem(key, JSON.stringify(removeFiles(JSON.parse(saved))));
        for (const entry of purged) {
          if (entry.file.type === 'document') localStorage.removeItem(documentKey(userId, entry.file.id));
        }
      } catch {
        if (!cancelled) {
          setError('삭제된 파일의 저장 공간 정리를 완료하지 못했습니다. 잠시 후 다시 시도합니다.');
          retry = window.setTimeout(() => { void cleanup(); }, 60_000);
        }
      }
    };
    void cleanup();
    return () => { cancelled = true; window.clearTimeout(retry); };
  }, [entries, userId]);

  return <TrashContext.Provider value={{ entries: projected, moveToTrash, restore, permanentlyDelete }}>
    {ready && children}
    {!ready && !error && <div className="p-8 text-center text-white">보관함을 불러오는 중입니다…</div>}
    {error && <div role="alert" className="fixed inset-x-4 top-6 z-[9999] rounded-2xl bg-rose-50 p-4 text-sm text-rose-700 shadow-lg">
      {error}
      {!ready ? <button className="ml-3 underline" onClick={() => setAttempt(value => value + 1)}>다시 시도</button>
        : <button className="ml-3 underline" onClick={() => setError('')}>닫기</button>}
    </div>}
  </TrashContext.Provider>;
}

export function useTrash() {
  const value = useContext(TrashContext);
  if (!value) throw new Error('TrashProvider is required');
  return value;
}
