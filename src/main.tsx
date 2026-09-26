import { getAppCapabilities, prewarmCapture } from './utils/appCapabilities';
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Credentials from older versions must not survive logout or a shared-browser login.
try { localStorage.removeItem('lecture_snap_gemini_api_key'); } catch { /* Storage may be disabled. */ }

// Request browser permissions only on mobile, once per launch outside React effects.
// The browser remembers previous permission decisions; no custom gate is needed.
declare global {
  interface Window {
    __prewarmedCameraStream: Promise<MediaStream> | null;
  }
}

window.__prewarmedCameraStream = prewarmCapture(getAppCapabilities().canCapture, navigator.mediaDevices);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
