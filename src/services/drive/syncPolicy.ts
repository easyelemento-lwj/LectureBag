import { desktopBridge } from '../desktop';
// Electron keeps timers running when hidden; its explicit visibility takes priority.
export const syncIsHidden = () => desktopBridge()?.isBackground() || document.visibilityState === 'hidden';
export const SYNC_INTERVAL = 60_000;
export const BACKGROUND_SYNC_INTERVAL = 300_000;
export const DRIVE_OBSERVE_INTERVAL = 300_000;
export function nextSyncDelay(hidden: boolean, random = Math.random()) {
  const base = hidden ? BACKGROUND_SYNC_INTERVAL : SYNC_INTERVAL;
  return base + Math.floor(base * 0.1 * random);
}
export function retrySyncDelay(failures: number, retryAt = 0, now = Date.now(), random = Math.random()) {
  return Math.max(retryAt - now, Math.min(300_000, 30_000 * 2 ** Math.min(Math.max(failures - 1, 0), 4))) + Math.floor(random * 5000);
}
