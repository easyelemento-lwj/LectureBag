import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.lecturebag.app',
  appName: 'LectureBag',
  webDir: 'mobile-dist',
  loggingBehavior: 'none',
  server: { hostname: 'localhost', androidScheme: 'https' },
  android: { allowMixedContent: false, backgroundColor: '#000000', webContentsDebuggingEnabled: false, resolveServiceWorkerRequests: false },
  cordova: { preferences: { DisableDeploy: 'true' } },
};
export default config;
