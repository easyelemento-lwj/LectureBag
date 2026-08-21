import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// ─── Camera Pre-Warming ────────────────────────────────────────────────────
// Request the camera stream IMMEDIATELY, before React even mounts.
// This eliminates the permission dialog delay that makes native camera apps feel slow.
// The resulting MediaStream promise is stored globally so VaultIosMain can
// attach it to a <video> element the instant it renders, achieving
// sub-native camera launch speeds.
declare global {
  interface Window {
    __prewarmedCameraStream: Promise<MediaStream> | null;
  }
}

window.__prewarmedCameraStream = navigator.mediaDevices
  ?.getUserMedia({
    video: {
      facingMode: { ideal: 'environment' },
      // Start with moderate constraints for fastest first-frame time
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
  })
  .catch(() => {
    window.__prewarmedCameraStream = null;
    return Promise.reject(new Error('Camera permission denied or unavailable'));
  }) ?? null;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
