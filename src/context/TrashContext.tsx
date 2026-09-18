import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { get } from 'idb-keyval';
import { updateTrash } from '../utils/mediaStorage';
import { accountKey, documentKey } from '../utils/accountStorage';
import { MediaFile } from '../types';
import { useAuth } from '../hooks/useAuth';

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
  const [entries, setEntries] = useState<TrashEntry[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const channel = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    let cancelled = false;
    updateTrash(userId, entries => entries).then(initial => {
      if (cancelled) return;
      setEntries(initial);
      setReady(true);
      setError('');
    }).catch(() => { if (!cancelled) setError('쓰레기통을 불러오지 못했습니다. 다시 시도해 주세요.'); });
    return () => { cancelled = true; };
  }, [storageKey, userId, attempt]);

  const commit = async (change: (prev: TrashEntry[]) => TrashEntry[]): Promise<boolean> => {
    if (!ready) return false;
    try {
      const next = await updateTrash(userId, change);
      setEntries(next);
      channel.current?.postMessage('changed');
      setError('');
      return true;
    } catch {
      setError('저장 공간을 확인해 주세요. 변경 사항을 저장하지 못했습니다.');
      return false;
    }
  };
  const moveToTrash = (files: MediaFile[]) => commit(prev => {
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
  const restore = (ids: string[]) => commit(prev => restoreTrashEntries(prev, ids));

  const permanentlyDelete = (ids: string[]) => commit(prev => purgeTrashEntries(prev, ids));

  useEffect(() => {
    if (!ready) return;
    const sweep = () => {
      void updateTrash(userId, prev => purgeExpiredTrash(prev)).then(next => {
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
  }, [ready, userId]);

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

  return <TrashContext.Provider value={{ entries, moveToTrash, restore, permanentlyDelete }}>
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
