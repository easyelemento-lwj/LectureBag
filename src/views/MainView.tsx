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
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppTutorial, tutorialSections, type TutorialSection } from '../components/AppTutorial';
import { useAuth } from '../hooks/useAuth';
import { useDriveSync } from '../context/DriveSyncContext';
import { motion, AnimatePresence } from 'motion/react';

import { useAppState } from '../models/useAppState';
import { CameraViewport } from './CameraViewport';
import { BottomNav } from './BottomNav';
import { RecentPhotosModal } from '../components/RecentPhotosModal';
import { RecentRecordingsModal } from '../components/RecentRecordingsModal';
import { FolderExplorerModal } from '../components/FolderExplorerModal';

export const MainView: React.FC = () => {
  const [capabilities] = useState(() => getAppCapabilities());
  const { canCapture } = capabilities;
  const state = useAppState(canCapture);
  const driveSync = useDriveSync();
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
  const audioMode = tourStep ? tourStep.chapter === 3 || tourStep.chapter === 4 : state.isAudioMode;
  // Only the presentation changes during the guide; MediaRecorder is never started.
  const recording = tourStep ? ['pause', 'resume', 'stop'].includes(tourStep.target) : state.isRecording;
  const paused = tourStep ? ['resume', 'stop'].includes(tourStep.target) : state.isPaused;
  const closeTour = (completed: boolean) => {
    if (completed) {
      state.setIsRecentModalOpen(false);
      state.setIsRecentRecordingsModalOpen(false);
      if (tourSection === 'camera' && canCapture) {
        state.setIsAudioMode(true);
        state.setIsFolderExplorerOpen(false);
      } else {
        state.setIsFolderExplorerOpen(true);
        setCompletedTour(previous => ({ section: tourSection, sequence: (previous?.sequence ?? 0) + 1 }));
      }
    }
    setTourOpen(false);
  };

  return (
    <div className="absolute inset-0 w-full h-full bg-black text-white overflow-hidden select-none font-sans">
      {state.captureError && <div role="alert" className="absolute top-16 left-4 right-4 z-[100] rounded-xl bg-red-950 p-3 text-sm">
        <p>{state.captureError}</p>
        {state.canRetryCaptureSave && <button type="button" onClick={state.retryCaptureSave} className="mt-2 underline">사진 저장 다시 시도</button>}
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

      {driveSync.enabled && !state.isFolderExplorerOpen && !audioMode && <div aria-live="polite"
        className="absolute left-3 bottom-28 z-20 max-w-[85%] rounded-lg bg-black/60 px-2 py-1 text-[11px] pointer-events-none">
        {driveSync.error || (driveSync.busy ? '사진을 기기에 저장했습니다 · Drive 업로드 중…'
          : driveSync.connection?.connected ? `Drive 자동 업로드 · 완료 ${driveSync.jobs.filter(job => job.state === 'synced').length}개 / 대기 ${driveSync.jobs.filter(job => !['synced', 'cancelled'].includes(job.state)).length + driveSync.waiting}개`
          : '사진은 기기에 저장됩니다 · 앱 센터에서 Drive 연결을 확인해 주세요.')}
      </div>}

      {/* ── Floating Bottom Navigation Bar ── */}
      <div
        className="absolute left-1/2 -translate-x-1/2 z-30"
        style={{ bottom: 'max(24px, env(safe-area-inset-bottom, 24px))' }}
      >
        <BottomNav
          isAudioMode={audioMode}
          isRecording={recording}
          isPaused={paused}
          photos={state.photos}
          recordings={state.recordings}
          captureDisabled={state.captureDisabled}
          onTakeSnapshot={state.handleTakeSnapshot}
          onStartRecording={state.handleStartRecording}
          onTogglePauseRecording={state.handleTogglePauseRecording}
          onStopRecording={state.handleStopRecording}
          onOpenRecentPhotos={() => state.setIsRecentModalOpen(true)}
          onOpenRecentRecordings={() => state.setIsRecentRecordingsModalOpen(true)}
          onOpenFolder={state.handleFolderButtonClick}
        />
      </div>

      </>}

      {/* ── Modals ── */}
      {tourOpen && <AppTutorial steps={tourSteps} index={tourIndex} onStepChange={setTourIndex} onClose={closeTour} />}

      {canCapture && <>
      <RecentPhotosModal
        isOpen={tourStep ? tourStep.chapter === 2 : state.isRecentModalOpen}
        onClose={() => state.setIsRecentModalOpen(false)}
        photos={state.photos}
        onDeletePhoto={state.handleDeletePhoto}
      />

      <RecentRecordingsModal
        isOpen={tourStep ? tourStep.chapter === 4 : state.isRecentRecordingsModalOpen}
        onClose={() => state.setIsRecentRecordingsModalOpen(false)}
        recordings={state.recordings}
        onDeleteRecording={state.handleDeleteRecording}
      />

      </>}

      <FolderExplorerModal
        canCapture={canCapture}
        onDeletePhoto={state.handleDeletePhoto}
        onDeleteRecording={state.handleDeleteRecording}
        tutorialStep={tourStep}
        completedTutorial={completedTour}
        onReplayTutorial={(section) => startTour(section, true)}
        onEnterAppCenter={enterAppCenter}
        isOpen={!canCapture || (tourStep ? tourStep.chapter >= 5 : state.isFolderExplorerOpen)}
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
      />
    </div>
  );
};
