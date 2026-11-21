export const MAX_AUDIO_BYTES = 100 * 1024 * 1024;
export const audioExtensions: Record<string, string> = {
  'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg',
};
export function audioMime(type: string) {
  const mime = type.split(';')[0].trim().toLowerCase();
  if (!audioExtensions[mime]) throw new Error('지원하지 않는 녹음 형식입니다.');
  return mime;
}
