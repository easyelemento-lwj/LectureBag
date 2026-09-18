/**
 * MainView.tsx — MainView equivalent
 *
 * Top-level view for LectureBag.
 * Responsibilities:
 *   1. Calls useAppState() to get all shared state & handlers (DataModel)
 *   2. Decides layout — composes CameraViewport + BottomNav + Modals
 *   3. Renders global animations (shutter flash)
 *
 * No business logic or camera stream code lives here.
 */
import React, { useCallback, useState } from 'react';
import { CircleHelp } from 'lucide-react';
import { AppTutorial, tutorialSteps } from '../components/AppTutorial';
import { useAuth } from '../hooks/useAuth';
import { motion, AnimatePresence } from 'motion/react';

import { useAppState } from '../models/useAppState';
import { CameraViewport } from './CameraViewport';
import { BottomNav } from './BottomNav';
import { RecentPhotosModal } from '../components/RecentPhotosModal';
import { RecentRecordingsModal } from '../components/RecentRecordingsModal';
import { FolderExplorerModal } from '../components/FolderExplorerModal';

export const MainView: React.FC = () => {
  const state = useAppState();
  const { user } = useAuth();
  const tourKey = `lecturebag_app_tutorial_v3:${user?.uid ?? 'guest'}`;
  const [tourOpen, setTourOpen] = useState(() => {
    try { return localStorage.getItem(tourKey) !== 'done'; } catch { return true; }
  });
  const [tourIndex, setTourIndex] = useState(0);
  const restartTour = () => { setTourIndex(0); setTourOpen(true); };
  const tourStep = tourOpen ? tutorialSteps[tourIndex] : undefined;
  const audioMode = tourStep ? tourStep.chapter === 3 || tourStep.chapter === 4 : state.isAudioMode;
  // Only the presentation changes during the guide; MediaRecorder is never started.
  const recording = tourStep ? ['pause', 'resume', 'stop'].includes(tourStep.target) : state.isRecording;
  const paused = tourStep ? ['resume', 'stop'].includes(tourStep.target) : state.isPaused;
  const closeTour = useCallback((completed: boolean) => {
    setTourOpen(false);
    if (completed) {
      try { localStorage.setItem(tourKey, 'done'); } catch { /* Guide remains available without storage. */ }
    }
  }, [tourKey]);

  return (
    <div className="fixed inset-0 w-full h-full bg-black text-white overflow-hidden select-none font-sans">

      {/* Global Shutter Flash Animation */}
      <AnimatePresence>
        {state.shutterFlash && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.9 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 bg-white z-50 pointer-events-none"
          />
        )}
      </AnimatePresence>

      {/* ── Main Viewport (Camera / Audio) ── */}
      <CameraViewport
        setVideoRef={state.setVideoRef}
        cameraStatus={state.cameraStatus}
        cameraFacing={state.cameraFacing}
        flashMode={state.flashMode}
        aspectRatio={state.aspectRatio}
        isCameraMenuOpen={state.isCameraMenuOpen}
        isAudioMode={audioMode}
        isRecording={recording}
        isPaused={paused}
        recordingSeconds={tourStep ? 12 : state.recordingSeconds}
        formatRecordingTime={state.formatRecordingTime}
        onStartRecording={state.handleStartRecording}
        onStopRecording={state.handleStopRecording}
        onToggleAspectRatio={state.toggleAspectRatio}
        onToggleFlash={state.toggleFlashMode}
        onToggleCameraFacing={state.toggleCameraFacing}
        onToggleCameraMenu={(e) => {
          e.stopPropagation();
          state.setIsCameraMenuOpen((prev) => !prev);
        }}
        onExitAudioMode={() => state.setIsAudioMode(false)}
      />

      {/* ── Floating Bottom Navigation Bar ── */}
      <div
        className="absolute left-1/2 -translate-x-1/2 z-30"
        style={{ bottom: 'max(24px, env(safe-area-inset-bottom, 24px))' }}
      >
        <BottomNav
          isAudioMode={audioMode}
          isRecording={recording}
          isPaused={paused}
          photos={tourStep ? [] : state.photos}
          recordings={tourStep ? [] : state.recordings}
          onTakeSnapshot={state.handleTakeSnapshot}
          onStartRecording={state.handleStartRecording}
          onTogglePauseRecording={state.handleTogglePauseRecording}
          onStopRecording={state.handleStopRecording}
          onOpenRecentPhotos={() => state.setIsRecentModalOpen(true)}
          onOpenRecentRecordings={() => state.setIsRecentRecordingsModalOpen(true)}
          onOpenFolder={state.handleFolderButtonClick}
        />
      </div>

      {/* ── Modals ── */}
      {!state.isAudioMode && !state.isFolderExplorerOpen && !state.isRecentModalOpen && !state.isRecentRecordingsModalOpen && (
        <>
          <button
            type="button"
            onClick={restartTour}
            aria-label="앱 전체 튜토리얼 다시 보기"
            className="absolute right-4 z-30 flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-neutral-900/80 text-white shadow-lg hover:bg-neutral-700"
            style={{ bottom: 'max(128px, calc(env(safe-area-inset-bottom) + 104px))' }}
          ><CircleHelp size={20} /></button>

        </>
      )}

      {tourOpen && <AppTutorial index={tourIndex} onStepChange={setTourIndex} onClose={closeTour} />}

      <RecentPhotosModal
        isOpen={tourStep ? tourStep.chapter === 2 : state.isRecentModalOpen}
        onClose={() => state.setIsRecentModalOpen(false)}
        photos={tourStep ? [] : state.photos}
        onDeletePhoto={state.handleDeletePhoto}
      />

      <RecentRecordingsModal
        isOpen={tourStep ? tourStep.chapter === 4 : state.isRecentRecordingsModalOpen}
        onClose={() => state.setIsRecentRecordingsModalOpen(false)}
        recordings={tourStep ? [] : state.recordings}
        onDeleteRecording={state.handleDeleteRecording}
      />

      <FolderExplorerModal
        onDeletePhoto={state.handleDeletePhoto}
        onDeleteRecording={state.handleDeleteRecording}
        key={tourOpen ? 'tutorial' : 'app'}
        tutorialStep={tourStep}
        onReplayTutorial={restartTour}
        isOpen={tourStep ? tourStep.chapter >= 5 : state.isFolderExplorerOpen}
        onClose={() => state.setIsFolderExplorerOpen(false)}
        currentDocument={state.currentDocument}
        onSelectDocument={(docName) => state.setCurrentDocument(docName)}
        showToast={state.showToast}
        photos={tourStep ? [] : state.photos}
        recordings={tourStep ? [] : state.recordings}
        timetableImage={tourStep ? null : state.timetableImage}
        setTimetableImage={state.setTimetableImage}
        storageMode={state.storageMode}
        setStorageMode={state.setStorageMode}
        timetables={tourStep ? [] : state.timetables}
        setTimetables={state.setTimetables}
      />
    </div>
  );
};
