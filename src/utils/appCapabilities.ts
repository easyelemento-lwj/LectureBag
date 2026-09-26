/** Product capabilities are independent of viewport size and installed-web-app mode. */
export interface AppEnvironment {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  userAgentData?: { mobile?: boolean };
  // A future native shell can supply its platform without changing the web UI.
  nativePlatform?: 'ios' | 'android' | 'web';
}

export function getAppCapabilities(environment: AppEnvironment = navigator) {
  const mobile = environment.nativePlatform === 'ios' || environment.nativePlatform === 'android'
    || /Android|iPhone|iPad|iPod/i.test(environment.userAgent)
    || environment.userAgentData?.mobile === true
    // iPadOS can identify itself as a Mac, including with a keyboard attached.
    || (/Mac/i.test(environment.platform || environment.userAgent) && (environment.maxTouchPoints || 0) > 1);
  return {
    canCapture: mobile,
    initialScreen: mobile ? 'camera' as const : 'explorer' as const,
    tutorialSections: mobile ? ['camera', 'explorer', 'apps'] as const : ['explorer', 'apps'] as const,
  };
}

/** Permission warm-up is a mobile-only action, also before React/login mounts. */
export function prewarmCapture(
  canCapture: boolean,
  mediaDevices?: Pick<MediaDevices, 'getUserMedia'>,
): Promise<MediaStream> | null {
  if (!canCapture || !mediaDevices?.getUserMedia) return null;
  const camera = mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  const microphone = async () => {
    try {
      const stream = await mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
    } catch { /* A permission denial must not block file management. */ }
  };
  void camera.then(microphone, microphone);
  return camera;
}
