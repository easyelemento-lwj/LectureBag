# Desktop workspace and mobile capture

`src/utils/appCapabilities.ts` selects product capabilities once at startup. Viewport size continues to control responsive layout, not whether camera/recording is enabled.

- Desktop browsers: file explorer as home, imports/playback/AI/app center retained. No camera or recording views, startup permissions, camera stream initialization or capture/record handlers. Root shows the app logo and has no close-to-camera action; folder back and app-center back/close remain available.
- Phones/tablets: existing camera and recording flows in both a browser and a home-screen web app. Android, iPhone/iPad user agents, mobile client hints and iPadOS's Mac user agent with multiple touch points are recognized. A touchscreen Windows PC remains desktop.
- Desktop tutorials: explorer and app center only. Mobile camera tutorial progress is not marked by a desktop visit. Manual replay follows the same policy.
- Device classification is a UI policy, not an authorization boundary. Spoofed or ambiguous user agents can affect it. Chrome mobile emulation must include the mobile user agent, not only resize the viewport.
- A future native adapter can provide `nativePlatform: 'ios' | 'android'` to the capability resolver. Native camera/audio/background services and cloud sync are separate work; neither is added here.

Validation:

- `npm run lint`, `npm test`, `npm run build`.
- On macOS with Chrome: `node scripts/check_platform_ui.mjs /path/to/build` (defaults to `dist`). Set `CHROME_BIN` for another Chrome binary.
- The browser test uses isolated temporary browser storage, mocked authentication and denied media requests; it never uses a real account or device streams. It checks desktop, iPhone, Android home-screen-style and iPad desktop-UA environments, first tutorials, permission calls, resize/rotation, and desktop app-center navigation/replay. Real iOS/Android hardware validation remains necessary for OS permission and recording behavior.
