/** Prefer sharper frames without making high resolution a device requirement. */
export async function openCamera(media: Pick<MediaDevices, 'getUserMedia'>, facing: 'environment' | 'user') {
  const request = (width: number, height: number) => media.getUserMedia({
    video: { facingMode: { ideal: facing }, width: { ideal: width }, height: { ideal: height } },
    audio: false,
  });
  try {
    return await request(2560, 1440);
  } catch (error) {
    // Permission/device failures should not trigger another permission request.
    if ((error as { name?: string })?.name !== 'OverconstrainedError') throw error;
    return request(1280, 720);
  }
}

/** Preserve the visible center crop, never enlarging source pixels. */
export function photoGeometry(sourceWidth: number, sourceHeight: number, ratio: number) {
  if (![sourceWidth, sourceHeight, ratio].every(n => Number.isFinite(n) && n > 0)) {
    throw new Error('Camera frame is not ready');
  }
  const sw = Math.min(sourceWidth, sourceHeight * ratio);
  const sh = Math.min(sourceHeight, sourceWidth / ratio);
  const scale = Math.min(1, 2560 / Math.max(sw, sh));
  return { sx: (sourceWidth - sw) / 2, sy: (sourceHeight - sh) / 2, sw, sh,
    width: Math.max(1, Math.floor(sw * scale)), height: Math.max(1, Math.floor(sh * scale)) };
}
