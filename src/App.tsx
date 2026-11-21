/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { TrashProvider } from './context/TrashContext';
import { MainView } from './views/MainView';
import { AccentColorProvider } from './context/AccentColorContext';
import { AuthProvider } from './context/AuthContext';
import { AuthGate } from './components/AuthGate';
import { DriveSyncProvider } from './context/DriveSyncContext';
import { PcLibraryProvider } from './context/PcLibraryContext';
import { DriveLifecycleProvider } from './context/DriveLifecycleContext';
import { DriveAuthCallback } from './components/DriveAuthCallback';

import { desktopBridge } from './services/desktop';
import { lazy, Suspense, useEffect, useState } from 'react';
const FeedbackAdmin = lazy(() => import('./components/FeedbackAdmin').then(module => ({ default: module.FeedbackAdmin })));
const DesktopApproval = lazy(() => import('./components/DesktopApproval').then(module => ({ default: module.DesktopApproval })));
const pageLoading = <div role="status" className="p-8 text-neutral-500">불러오는 중…</div>;

export default function App() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const changed = () => setHash(location.hash);
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  if (location.pathname === '/drive-auth-callback') {
    return <AuthProvider><DriveAuthCallback /></AuthProvider>;
  }
  if (hash === '#admin') {
    return <AuthProvider><AuthGate><Suspense fallback={pageLoading}><FeedbackAdmin /></Suspense></AuthGate></AuthProvider>;
  }
  if (!desktopBridge() && location.hash.startsWith('#desktop-login')) {
    return <AuthProvider><AuthGate><Suspense fallback={pageLoading}><DesktopApproval /></Suspense></AuthGate></AuthProvider>;
  }
  return (
    <AuthProvider>
      <AccentColorProvider>
        <div className="app-shell absolute inset-0 w-full h-full bg-black font-sans antialiased select-none overflow-hidden">
          <AuthGate>
            <DriveSyncProvider><DriveLifecycleProvider><TrashProvider><PcLibraryProvider><MainView /></PcLibraryProvider></TrashProvider></DriveLifecycleProvider></DriveSyncProvider>
          </AuthGate>
        </div>
      </AccentColorProvider>
    </AuthProvider>
  );
}
