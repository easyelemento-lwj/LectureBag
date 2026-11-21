import { createStore, keys, delMany } from 'idb-keyval';
import { accountKey, documentKey } from './accountStorage';
import { updateTrash } from './mediaStorage';
import type { MediaFile } from '../types';

const jobs = createStore('lecturebag-ai-jobs', 'jobs');
export const isLegacySummary = (file: Pick<MediaFile, 'id' | 'name' | 'mode'>) =>
  file.id.startsWith('ai_doc_') || file.name.startsWith('[AI요약]') || Boolean(file.mode?.includes('AI 스마트 요약노트'));

/** Account-scoped, repeatable cleanup. Never touches photo/audio originals or Drive. */
export async function removeLegacySummaries(uid: string, storage: Storage = localStorage) {
  const key = accountKey(uid, 'ai_docs');
  const raw = storage.getItem(key);
  const docs: MediaFile[] = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(docs)) throw new Error('문서 목록을 확인할 수 없습니다.');
  const removed = docs.filter(isLegacySummary);
  const ids = new Set(removed.map(doc => doc.id));
  await updateTrash(uid, entries => {
    const next = entries.map(entry => {
      if (entry.file.type !== 'document' || (!isLegacySummary(entry.file) && !ids.has(entry.file.id))) return entry;
      ids.add(entry.file.id);
      return { file: { id: entry.file.id, type: 'document' as const, name: '', timestamp: entry.deletedAt }, deletedAt: entry.deletedAt, purged: true };
    });
    for (const doc of removed) {
      if (!next.some(entry => entry.file.id === doc.id)) {
        const deletedAt = new Date().toISOString();
        next.push({ file: { id: doc.id, type: 'document', name: '', timestamp: deletedAt }, deletedAt, purged: true });
      }
    }
    return next;
  }, true);
  for (const id of ids) storage.removeItem(documentKey(uid, id));
  const prefix = documentKey(uid, 'ai_doc_');
  const orphanKeys = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter((k): k is string => !!k && k.startsWith(prefix));
  orphanKeys.forEach(k => storage.removeItem(k));
  const kept = docs.filter(doc => !ids.has(doc.id));
  if (kept.length) storage.setItem(key, JSON.stringify(kept));
  else storage.removeItem(key);
  const jobPrefix = accountKey(uid, 'ai_job:');
  await delMany((await keys(jobs)).filter(k => typeof k === 'string' && k.startsWith(jobPrefix)), jobs);
}
