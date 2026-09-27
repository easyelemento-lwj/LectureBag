/** Encoded media bytes, excluding the data URL header and Base64 expansion. */
export function dataUrlByteSize(dataUrl: string | undefined): number | null {
  if (!dataUrl) return null;
  const comma = dataUrl.indexOf(',');
  if (comma < 0 || !dataUrl.slice(0, comma).endsWith(';base64')) return null;
  const length = dataUrl.length - comma - 1;
  const padding = dataUrl.endsWith('==') ? 2 : dataUrl.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor(length * 3 / 4) - padding);
}

export function dataUrlFileSize(dataUrl: string | undefined): string {
  const bytes = dataUrlByteSize(dataUrl);
  if (bytes === null) return '용량 확인 불가';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
