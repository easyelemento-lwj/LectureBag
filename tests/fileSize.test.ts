import test from 'node:test';
import assert from 'node:assert/strict';
import { dataUrlByteSize, dataUrlFileSize } from '../src/utils/fileSize';
import { getSampleMediaFiles } from '../src/utils/dateFolders';

test('photo size uses decoded bytes, including Base64 padding and excluding MIME header', () => {
  for (const size of [0, 1, 2, 3, 1023, 1024, 1048576]) {
    const data = `data:image/webp;base64,${Buffer.alloc(size).toString('base64')}`;
    assert.equal(dataUrlByteSize(data), size);
  }
  assert.equal(dataUrlFileSize('data:image/jpeg;base64,YQ=='), '1 B');
  assert.equal(dataUrlFileSize(`data:image/jpeg;base64,${Buffer.alloc(1024).toString('base64')}`), '1.0 KB');
  assert.equal(dataUrlFileSize(`data:image/webp;base64,${Buffer.alloc(1048576).toString('base64')}`), '1.00 MB');
  assert.equal(dataUrlFileSize(undefined), '용량 확인 불가');
});

test('existing captured photos display their actual payload size in the explorer', () => {
  const [photo] = getSampleMediaFiles([{ id: 'existing-photo', dataUrl: 'data:image/jpeg;base64,YWJj', timestamp: new Date(), mode: 'PPT/판서', width: 1920, height: 1080 }], []);
  assert.equal(photo.fileSize, '3 B');
});
