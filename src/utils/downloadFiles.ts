export interface ExportSource { id: string; name: string; dataUrl?: string; text?: string }
interface Entry { name: string; bytes: Uint8Array; type: string }
const extensions: Record<string, string> = { 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'image/jpeg': 'jpg', 'image/png': 'png',
  'image/webp': 'webp', 'application/pdf': 'pdf', 'text/markdown': 'md', 'text/plain': 'txt' };
const limit = 100 * 1024 * 1024;
function entry(source: ExportSource): Entry {
  let bytes: Uint8Array, type: string;
  if (source.text !== undefined) { bytes = new TextEncoder().encode(source.text); type = 'text/markdown'; }
  else {
    const match = /^data:([^,]*?),(.*)$/s.exec(source.dataUrl || '');
    if (!match) throw new Error(`${source.name}: 기기 원본이 없어 다운로드할 수 없습니다.`);
    type = match[1].split(';')[0].toLowerCase() || 'application/octet-stream';
    if (match[2].length > limit * 4) throw new Error('한 번에 100MB 이하로 선택해 주세요.');
    try {
      bytes = /;base64$/i.test(match[1]) ? Uint8Array.from(atob(match[2]), c => c.charCodeAt(0))
        : new TextEncoder().encode(decodeURIComponent(match[2]));
    } catch { throw new Error(`${source.name}: 원본 형식을 읽지 못했습니다.`); }
  }
  if (!bytes.length) throw new Error(`${source.name}: 원본이 비어 있습니다.`);
  let name = source.name.replace(/[\\/\x00-\x1f\x7f]/g, '_').replace(/^\.+/, '').trim().slice(0, 150) || 'LectureBag';
  const ext = extensions[type];
  if (ext) name = name.replace(/\.[a-zA-Z0-9]{1,8}$/, '') + '.' + ext;
  return { name, bytes, type };
}

const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = (n & 1) ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** ZIP STORE: no transcoding/compression; exported audio bytes remain identical. */
function zip(entries: Entry[]) {
  const parts: BlobPart[] = [], directory: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name), crc = crc32(entry.bytes);
    const header = new Uint8Array(30 + name.length), h = new DataView(header.buffer);
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x800, true);
    h.setUint16(12, 33, true); h.setUint32(14, crc, true);
    h.setUint32(18, entry.bytes.length, true); h.setUint32(22, entry.bytes.length, true); h.setUint16(26, name.length, true); header.set(name, 30);
    const central = new Uint8Array(46 + name.length), c = new DataView(central.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x800, true);
    c.setUint16(14, 33, true); c.setUint32(16, crc, true); c.setUint32(20, entry.bytes.length, true);
    c.setUint32(24, entry.bytes.length, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true); central.set(name, 46);
    parts.push(header, entry.bytes); directory.push(central); offset += header.length + entry.bytes.length;
  }
  const end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, entries.length, true); e.setUint16(10, entries.length, true);
  e.setUint32(12, directory.reduce((sum, item) => sum + item.length, 0), true); e.setUint32(16, offset, true);
  return new File([...parts, ...directory, end], 'LectureBag-selected.zip', { type: 'application/zip' });
}

export function prepareDownload(sources: ExportSource[]): File {
  const unique = [...new Map(sources.map(source => [source.id, source])).values()];
  if (!unique.length) throw new Error('선택된 파일이 없습니다.');
  if (unique.length > 500) throw new Error('한 번에 500개 이하로 선택해 주세요.');
  let total = 0;
  const names = new Set<string>();
  const entries = unique.map(source => {
    const item = entry(source); total += item.bytes.length;
    if (total > limit) throw new Error('한 번에 100MB 이하로 선택해 주세요.');
    const original = item.name;
    for (let n = 2; names.has(item.name.toLowerCase()); n++) {
      const dot = original.lastIndexOf('.');
      item.name = dot > 0 ? `${original.slice(0, dot)} (${n})${original.slice(dot)}` : `${original} (${n})`;
    }
    names.add(item.name.toLowerCase()); return item;
  });
  return entries.length === 1 ? new File([entries[0].bytes], entries[0].name, { type: entries[0].type }) : zip(entries);
}

/** Invoke directly in a click handler: sharing requires user activation. No network access. */
export async function downloadFiles(sources: ExportSource[]): Promise<string> {
  // PC library exposes browser-owned object URLs, not remote download URLs.
  let blobBytes = 0;
  const resolved: ExportSource[] = [];
  for (const source of sources) {
    if (!source.dataUrl?.startsWith('blob:')) { resolved.push(source); continue; }
    const blob = await (await fetch(source.dataUrl)).blob();
    blobBytes += blob.size;
    if (blobBytes > limit) throw new Error('한 번에 100MB 이하로 선택해 주세요.');
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('PC 사본을 읽지 못했습니다.')); reader.readAsDataURL(blob);
    });
    resolved.push({ ...source, dataUrl });
  }
  sources = resolved;
  const file = prepareDownload(sources);
  const mobile = /iPhone|iPad|iPod|Android/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (mobile && navigator.share && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return '공유 창 처리가 끝났습니다. 선택한 저장 위치를 확인해 주세요.'; }
    catch (error) {
      if ((error as Error).name === 'AbortError') return '저장을 취소했습니다.';
      throw new Error('파일 공유 창을 열지 못했습니다. 다시 누르거나 Safari에서 시도해 주세요.');
    }
  }
  const url = URL.createObjectURL(file), link = document.createElement('a');
  link.href = url; link.download = file.name;
  document.body.appendChild(link);
  try { link.click(); } finally { link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 60_000); }
  return '다운로드를 요청했습니다. 브라우저의 다운로드 목록을 확인해 주세요.';
}
