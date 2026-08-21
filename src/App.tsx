/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { MainView } from './views/MainView';
import { AccentColorProvider } from './context/AccentColorContext';

export default function App() {
  return (
    <AccentColorProvider>
      <div className="w-full h-screen bg-black font-sans antialiased select-none overflow-hidden flex flex-col">
        <MainView />
      </div>
    </AccentColorProvider>
  );
}



