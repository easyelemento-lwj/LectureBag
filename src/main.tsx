import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Credentials from older versions must not survive logout or a shared-browser login.
try { localStorage.removeItem('lecture_snap_gemini_api_key'); } catch { /* Storage may be disabled. */ }

// Request native browser permissions once per app launch, outside React effects.
// The browser remembers previous permission decisions; no custom gate is needed.
declare global {
  interface Window {
    __prewarmedCameraStream: Promise<MediaStream> | null;
  }
}

const requestMicrophonePermission = async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Permission check only. The recording button starts actual recording.
    stream.getTracks().forEach(track => track.stop());
  } catch {
    // A denied or unavailable microphone does not block the app.
    // Starting a recording allows the user to retry through the existing flow.
  }
};

window.__prewarmedCameraStream = null;
if (navigator.mediaDevices?.getUserMedia) {
  const cameraRequest = navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
  });
  window.__prewarmedCameraStream = cameraRequest;
  // Wait for the camera decision before requesting microphone access.
  // Handle rejection here even if the camera view has not mounted yet.
  void cameraRequest.then(requestMicrophonePermission, () => {
    window.__prewarmedCameraStream = null;
    return requestMicrophonePermission();
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
