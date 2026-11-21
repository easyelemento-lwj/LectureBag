import { getAppCapabilities } from '../utils/appCapabilities';
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
import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { AppTutorial, tutorialSections, type TutorialSection } from '../components/AppTutorial';
import { useAuth } from '../hooks/useAuth';
import { motion, AnimatePresence } from 'motion/react';

import { useAppState } from '../models/useAppState';
import { CameraViewport } from './CameraViewport';
import { BottomNav } from './BottomNav';
const FolderExplorerModal = lazy(() => import('../components/FolderExplorerModal').then(module => ({ default: module.FolderExplorerModal })));

export const MainView: React.FC = () => {
  const [capabilities] = useState(() => getAppCapabilities());
  const { canCapture } = capabilities;
  const state = useAppState(canCapture);
  const { user } = useAuth();
  const tourOwner = user?.uid ?? 'guest';
  const seenTours = useRef(new Set<TutorialSection>());
  const hasSeenTour = useCallback((section: TutorialSection) => {
    if (seenTours.current.has(section)) return true;
    try {
      return localStorage.getItem(`lecturebag_app_tutorial_v4:${tourOwner}:${section}`) === 'seen'
        || localStorage.getItem(`lecturebag_app_tutorial_v3:${tourOwner}`) === 'done';
    } catch { return false; }
  }, [tourOwner]);
  const [tourSection, setTourSection] = useState<TutorialSection>(capabilities.initialScreen);
  const [tourOpen, setTourOpen] = useState(() => !hasSeenTour(capabilities.initialScreen));
  const [tourIndex, setTourIndex] = useState(0);
  const [completedTour, setCompletedTour] = useState<{ section: TutorialSection; sequence: number } | null>(null);
  const startTour = useCallback((section: TutorialSection, replay = false) => {
    if (!capabilities.tutorialSections.some(allowed => allowed === section)) return;
    if (!replay && hasSeenTour(section)) return;
    seenTours.current.add(section);
    try { localStorage.setItem(`lecturebag_app_tutorial_v4:${tourOwner}:${section}`, 'seen'); } catch { /* Keep the session marker. */ }
    setTourSection(section);
    setTourIndex(0);
    setTourOpen(true);
  }, [hasSeenTour, tourOwner, capabilities]);
  useEffect(() => {
    if (!tourOpen) return;
    seenTours.current.add(tourSection);
    try { localStorage.setItem(`lecturebag_app_tutorial_v4:${tourOwner}:${tourSection}`, 'seen'); } catch { /* Keep the session marker. */ }
  }, [tourOpen, tourSection, tourOwner]);
  useEffect(() => {
    if (state.isFolderExplorerOpen && !tourOpen) startTour('explorer');
  }, [state.isFolderExplorerOpen, tourOpen, startTour]);
  const enterAppCenter = useCallback(() => startTour('apps'), [startTour]);
  const tourSteps = tutorialSections[tourSection];
  const tourStep = tourOpen ? tourSteps[tourIndex] : undefined;
  const audioMode = RECORDING_ENABLED && (tourStep ? tourStep.chapter === 3 || tourStep.chapter === 4 : state.isAudioMode);
  // Only the presentation changes during the guide; MediaRecorder is never started.
  const recording = tourStep ? ['pause', 'resume', 'stop'].includes(tourStep.target) : state.isRecording;
  const paused = tourStep ? ['resume', 'stop'].includes(tourStep.target) : state.isPaused;
  const explorerVisible = !canCapture || (tourStep ? tourStep.chapter >= 5 : state.isFolderExplorerOpen);
  const [explorerLoaded, setExplorerLoaded] = useState(!canCapture);
  useEffect(() => { if (explorerVisible) setExplorerLoaded(true); }, [explorerVisible]);
  const closeTour = (completed: boolean) => {
    if (completed) {
      if (tourSection === 'camera' && canCapture) {
        state.setIsAudioMode(RECORDING_ENABLED);
        state.setIsFolderExplorerOpen(false);
      } else {
        state.setIsFolderExplorerOpen(true);
        setCompletedTour(previous => ({ section: tourSection, sequence: (previous?.sequence ?? 0) + 1 }));
      }
    }
    setTourOpen(false);
  };

  return (
    <div className="camera-shell absolute inset-0 w-full h-full bg-black text-white overflow-hidden select-none font-sans">
      {!state.isRecording && !state.recordingSaving && state.recoverableRecordingCount > 0 && <div role="status" className="absolute bottom-32 left-4 right-4 z-[100] rounded-xl bg-amber-950 p-3 text-sm">
        <p>중간 저장된 녹음 {state.recoverableRecordingCount}개가 있습니다. 복구 파일은 끝부분이 없거나 재생이 안 될 수 있습니다.</p>
        <button type="button" onClick={state.recoverInterruptedRecording} className="mt-2 underline">중단된 녹음 기기에 복구</button>
      </div>}
      {state.captureError && <div role="alert" className="absolute bottom-32 left-4 right-4 z-[100] rounded-xl bg-red-950 p-3 text-sm">
        <p>{state.captureError}</p>
        {state.canRetryCaptureSave && <button type="button" onClick={state.retryCaptureSave} className="mt-2 underline">기기 저장 다시 시도</button>}
      </div>}

      {/* Global Shutter Flash Animation */}
      <AnimatePresence>
        {canCapture && state.shutterFlash && (
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
      {canCapture && <>
      <CameraViewport
        setVideoRef={state.setVideoRef}
        cameraStatus={state.cameraStatus}
        onNativeCameraStatus={state.setNativeCameraStatus}
        cameraFacing={state.cameraFacing}
        flashMode={state.flashMode}
        aspectRatio={state.aspectRatio}
        isCameraMenuOpen={state.isCameraMenuOpen}
        isAudioMode={audioMode}
        suspended={explorerVisible}
        isRecording={recording}
        isPaused={paused}
        recordingSeconds={tourStep ? 12 : state.recordingSeconds}
        formatRecordingTime={state.formatRecordingTime}
        onToggleAspectRatio={state.toggleAspectRatio}
        onToggleFlash={state.toggleFlashMode}
        onToggleCameraFacing={state.toggleCameraFacing}
        onToggleCameraMenu={(e) => {
          e.stopPropagation();
          state.setIsCameraMenuOpen((prev) => !prev);
        }}
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
          recordingTime={state.formatRecordingTime(state.recordingSeconds)}
          recordingSaving={state.recordingSaving}
          captureDisabled={state.captureDisabled}
          onTakeSnapshot={state.handleTakeSnapshot}
          onStartRecording={state.handleStartRecording}
          onTogglePauseRecording={state.handleTogglePauseRecording}
          onStopRecording={state.handleStopRecording}
          onSwitchMode={() => {
            if (tourStep) return;
            state.setIsAudioMode(!state.isAudioMode);
          }}
          onOpenFolder={state.handleFolderButtonClick}
        />
      </div>

      </>}

      {/* ── Modals ── */}
      {tourOpen && <AppTutorial steps={tourSteps} index={tourIndex} onStepChange={setTourIndex} onClose={closeTour} />}


      {(explorerVisible || explorerLoaded) && <Suspense fallback={<div role="status" className="absolute inset-0 z-50 grid place-items-center bg-white text-neutral-500">자료 불러오는 중…</div>}>
      <FolderExplorerModal
        canCapture={canCapture}
        onDeletePhoto={state.handleDeletePhoto}
        onDeleteRecording={state.handleDeleteRecording}
        tutorialStep={tourStep}
        completedTutorial={completedTour}
        onReplayTutorial={(section) => startTour(section, true)}
        onEnterAppCenter={enterAppCenter}
        isOpen={explorerVisible}
        onClose={() => { if (canCapture) state.setIsFolderExplorerOpen(false); }}
        currentDocument={state.currentDocument}
        onSelectDocument={(docName) => state.setCurrentDocument(docName)}
        showToast={state.showToast}
        photos={state.photos}
        recordings={state.recordings}
        timetableImage={state.timetableImage}
        setTimetableImage={state.setTimetableImage}
        storageMode={state.storageMode}
        setStorageMode={state.setStorageMode}
        timetables={state.timetables}
        setTimetables={state.setTimetables}
        timetableSync={state.timetableSync}
      />
      </Suspense>}
    </div>
  );
};
import { RECORDING_ENABLED } from '../utils/featureFlags';
