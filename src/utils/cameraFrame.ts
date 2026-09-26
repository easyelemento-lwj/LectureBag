import type { AspectRatio } from '../types';

export function cameraFrame(width: number, height: number, mode: AspectRatio) {
  if (mode === '전체') return { width, height };
  const landscapeRatio = mode === '1:1' ? 1 : mode === '4:3' ? 4 / 3 : 16 / 9;
  const ratio = width > height ? landscapeRatio : 1 / landscapeRatio;
  const fittedWidth = Math.min(width, height * ratio);
  return { width: fittedWidth, height: fittedWidth / ratio };
}
