/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { TrashProvider } from './context/TrashContext';
import { MainView } from './views/MainView';
import { AccentColorProvider } from './context/AccentColorContext';
import { AuthProvider } from './context/AuthContext';
import { AuthGate } from './components/AuthGate';

export default function App() {
  return (
    <AuthProvider>
      <AccentColorProvider>
        <div className="fixed inset-0 w-full h-full bg-black font-sans antialiased select-none overflow-hidden">
          <AuthGate>
            <TrashProvider><MainView /></TrashProvider>
          </AuthGate>
        </div>
      </AccentColorProvider>
    </AuthProvider>
  );
}


