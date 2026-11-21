import { useEffect, useMemo, useRef } from 'react';
import { useAuth } from './useAuth';
import { useDriveLifecycle } from '../context/DriveLifecycleContext';
import { auth } from '../utils/firebase';
import { CloudCatalog } from '../services/drive/cloudCatalog';
import { MediaResolver } from '../services/drive/mediaResolver';
import { downloadKey } from '../services/drive/downloadCache';
import type { MediaFile } from '../types';

/** Fetch a mobile-only missing original on demand; never replace the captured source. */
export function useCloudFileOpen() {
  const { user } = useAuth();
  const life = useDriveLifecycle();
  const state = useRef(life.state); state.current = life.state;
  const catalog = useMemo(() => user ? new CloudCatalog(user, () => auth.currentUser?.uid) : undefined, [user]);
  const urls = useRef(new Map<string, string>());
  const controller = useRef(new AbortController());
  useEffect(() => {
    controller.current = new AbortController();
    return () => { controller.current.abort(); urls.current.forEach(url => URL.revokeObjectURL(url)); urls.current.clear(); };
  }, [user?.uid, life.state?.connectionId]);
  return async (file: MediaFile): Promise<MediaFile> => {
    const current = state.current;
    const record = current?.files.find(f => f.id === file.id);
    if (!record) return file;
    const permitted = () => {
      const latest = state.current?.files.find(f => f.id === file.id);
      if (!latest || latest.deletedAt || latest.purgedAt || latest.driveUnavailable || latest.connectionId !== record.connectionId ||
        latest.revision !== record.revision || state.current?.operations.some(op => op.fileId === file.id && op.trashed)) {
        throw new Error('파일 상태가 변경되었습니다. 휴지통과 동기화 상태를 확인해 주세요.');
      }
    };
    permitted();
    if (file.dataUrl) return file;
    if (!catalog || !user || record.ownerUid !== user.uid) throw new Error('로그인 상태를 확인해 주세요.');
    const key = downloadKey(record);
    let url = urls.current.get(key);
    if (!url) {
      const result = await new MediaResolver(catalog, current!).media(record, controller.current.signal);
      permitted(); controller.current.signal.throwIfAborted();
      url = URL.createObjectURL(result.blob); urls.current.set(key, url);
    }
    return { ...file, dataUrl: url };
  };
}
