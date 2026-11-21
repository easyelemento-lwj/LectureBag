import { useEffect, useMemo, useState } from 'react';
import { usePcLibrary } from '../context/PcLibraryContext';
import { useAuth } from './useAuth';
import { auth } from '../utils/firebase';
import { PcLibraryStore } from '../services/drive/pcLibrary';
import { downloadKey } from '../services/drive/downloadCache';
import type { MediaFile } from '../types';

/** Adapt verified PC copies to the existing date-folder explorer, never local imports. */
export function usePcExplorerMedia(enabled: boolean) {
  const sync = usePcLibrary();
  const { user } = useAuth();
  const lib = sync.library;
  const [loaded, setLoaded] = useState<{ scope: string; urls: Record<string, string> }>({ scope: '', urls: {} });
  const scope = enabled && lib && !lib.blocked && lib.uid === user?.uid
    ? `${user.uid}:${lib.connection.connectionId}:${lib.generation}` : '';
  const files = useMemo(() => scope && lib ? lib.files.filter(f =>
    !f.deletedAt && !f.purgedAt) : [], [scope, lib]);
  const signature = JSON.stringify(files.map(f => [downloadKey(f), lib?.saved[f.id], f.driveUnavailable, lib?.unavailable.includes(f.id)]));
  useEffect(() => {
    let active = true;
    const urls: Record<string, string> = {};
    setLoaded({ scope, urls: {} });
    const store = new PcLibraryStore();
    void (async () => {
      for (const file of files) {
        if (!active || auth.currentUser?.uid !== file.ownerUid) return;
        if (lib?.saved[file.id] !== downloadKey(file)) continue;
        try {
          const blob = await store.read(file);
          if (!active || auth.currentUser?.uid !== file.ownerUid) return;
          if (blob) {
            urls[file.id] = URL.createObjectURL(blob);
            setLoaded({ scope, urls: { ...urls } });
          }
        } catch { /* Keep metadata visible; restarting sync can repair missing copies. */ }
      }
    })();
    return () => { active = false; Object.values(urls).forEach(url => URL.revokeObjectURL(url)); };
  }, [scope, signature]);
  const media: MediaFile[] = files.map(file => ({
    id: file.id, type: file.kind, name: file.name, timestamp: file.capturedAt,
    fileSize: `${(file.sizeBytes / 1024 / 1024).toFixed(2)} MB`,
    dataUrl: loaded.scope === scope && !file.driveUnavailable && !lib?.unavailable.includes(file.id) ? loaded.urls[file.id] : undefined,
  }));
  return { sync, media, scope };
}
