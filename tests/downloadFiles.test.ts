import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareDownload, downloadFiles } from '../src/utils/downloadFiles';
import { getSampleMediaFiles } from '../src/utils/dateFolders';

const audio = { id: '1', name: '녹음.m4a', dataUrl: 'data:audio/webm;codecs=opus;base64,MTIzNDU2Nzg5' };
test('explorer recording adapter preserves source bytes, real size and MIME extension', async () => {
  const [file] = getSampleMediaFiles([], [{ ...audio, name: '20261012_1000.webm', timestamp: '2026-10-12T01:00:00Z', duration: '00:10' }]);
  assert.equal(file.dataUrl, audio.dataUrl);
  assert.equal(file.name, '20261012_1000.webm');
  assert.notEqual(file.fileSize, '12.4 MB');
  assert.equal(await prepareDownload([file]).text(), '123456789');
});
test('single download preserves exact audio bytes and fixes a mismatched extension', async () => {
  const file = prepareDownload([audio]);
  assert.equal(file.name, '녹음.webm'); assert.equal(file.type, 'audio/webm');
  assert.equal(await file.text(), '123456789');
  assert.equal(prepareDownload([audio, audio]).name, file.name);
});
test('ZIP exports each selected file once with Unicode names, collision suffixes and correct CRC', async () => {
  const zip = prepareDownload([audio, { ...audio, id: '2' }, { id: '3', name: '../요약.md', text: '# 정리' }]);
  assert.equal(zip.type, 'application/zip');
  const bytes = new Uint8Array(await zip.arrayBuffer()), view = new DataView(bytes.buffer);
  let offset = 0; const names: string[] = [], bodies: string[] = [];
  while (view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true), length = view.getUint16(offset + 26, true);
    assert.equal(view.getUint16(offset + 6, true), 0x800);
    names.push(new TextDecoder().decode(bytes.slice(offset + 30, offset + 30 + length)));
    bodies.push(new TextDecoder().decode(bytes.slice(offset + 30 + length, offset + 30 + length + size)));
    if (names.length < 3) assert.equal(view.getUint32(offset + 14, true), 0xcbf43926);
    offset += 30 + length + size;
  }
  assert.deepEqual(names, ['녹음.webm', '녹음 (2).webm', '_요약.md']);
  assert.deepEqual(bodies, ['123456789', '123456789', '# 정리']);
  assert.equal(view.getUint32(offset, true), 0x02014b50);
  assert.equal(view.getUint32(bytes.length - 6, true), offset);
  assert.equal(view.getUint16(bytes.length - 12, true), 3);
});
test('missing, empty or corrupt sources fail rather than generating fake successful downloads', () => {
  for (const sources of [[], [{ id: 'a', name: 'missing' }], [{ ...audio, dataUrl: 'data:audio/mp4;base64,' }],
    [{ ...audio, dataUrl: 'data:audio/mp4;base64,!!' }], [{ ...audio, dataUrl: 'https://example.com/private' }]]) {
    assert.throws(() => prepareDownload(sources));
  }
  assert.throws(() => prepareDownload(Array.from({ length: 501 }, (_, id) => ({ ...audio, id: String(id) }))));
});
test('iPhone sharing is invoked in the click turn; cancellation is not a download success', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let called = false;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    userAgent: 'iPhone', canShare: () => true, share: ({ files }: { files: File[] }) => {
      called = true; assert.equal(files[0].name, '녹음.webm');
      return Promise.reject(new DOMException('cancel', 'AbortError'));
    },
  } });
  try { const promise = downloadFiles([audio]); assert.ok(called); assert.equal(await promise, '저장을 취소했습니다.'); }
  finally { if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor); else Reflect.deleteProperty(globalThis, 'navigator'); }
});
