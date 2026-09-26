import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { saveMedia, loadImportedMedia, updateTrash } from '../src/utils/mediaStorage';
import { purgeTrashEntries } from '../src/utils/trash';

test('imported photo and audio payloads survive a fresh read and remain account scoped', async () => {
  const files = [{ id: 'image', type: 'photo', name: 'test.jpg', timestamp: new Date(), dataUrl: 'data:image/jpeg;base64,abc' }, { id: 'audio', type: 'audio', name: 'test.wav', timestamp: new Date(), dataUrl: 'data:audio/wav;base64,abc' }];
  await saveMedia('imports-owner', 'imports', files);
  assert.deepEqual(await loadImportedMedia('imports-owner'), files);
  assert.deepEqual(await loadImportedMedia('another-account'), []);
});

test('permanent deletion removes imported source and stale saves cannot resurrect it', async () => {
  const file = { id: 'import-delete', type: 'photo' as const, name: 'test.jpg', timestamp: new Date(), dataUrl: 'data:image/jpeg;base64,abc' };
  await saveMedia('imports-delete', 'imports', [file]);
  await updateTrash('imports-delete', () => [{ file, deletedAt: new Date().toISOString() }]);
  await updateTrash('imports-delete', entries => purgeTrashEntries(entries, [file.id]));
  await saveMedia('imports-delete', 'imports', [file]);
  assert.deepEqual(await loadImportedMedia('imports-delete'), []);
});
