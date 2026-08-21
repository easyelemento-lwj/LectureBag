/**
 * MainView.tsx — MainView equivalent
 *
 * Top-level view for LectureSnap.
 * Responsibilities:
 *   1. Calls useAppState() to get all shared state & handlers (DataModel)
 *   2. Decides layout — composes CameraViewport + BottomNav + Modals
 *   3. Renders global animations (shutter flash)
 *
 * No business logic or camera stream code lives here.
 */
import React from 'react';
import { motion, AnimatePresence } from 'motion/react';

import { useAppState } from '../models/useAppState';
import { CameraViewport } from './CameraViewport';
import { BottomNav } from './BottomNav';
import { RecentPhotosModal } from '../components/RecentPhotosModal';
import { RecentRecordingsModal } from '../components/RecentRecordingsModal';
import { FolderExplorerModal } from '../components/FolderExplorerModal';

export const MainView: React.FC = () => {
  const state = useAppState();

  return (
    <div className="relative w-full h-full bg-black text-white flex flex-col justify-between overflow-hidden select-none font-sans">

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
        isAudioMode={state.isAudioMode}
        isRecording={state.isRecording}
        isPaused={state.isPaused}
        recordingSeconds={state.recordingSeconds}
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
      <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-30">
        <BottomNav
          isAudioMode={state.isAudioMode}
          isRecording={state.isRecording}
          isPaused={state.isPaused}
          photos={state.photos}
          recordings={state.recordings}
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
      <RecentPhotosModal
        isOpen={state.isRecentModalOpen}
        onClose={() => state.setIsRecentModalOpen(false)}
        photos={state.photos}
        onDeletePhoto={state.handleDeletePhoto}
      />

      <RecentRecordingsModal
        isOpen={state.isRecentRecordingsModalOpen}
        onClose={() => state.setIsRecentRecordingsModalOpen(false)}
        recordings={state.recordings}
        onDeleteRecording={state.handleDeleteRecording}
      />

      <FolderExplorerModal
        isOpen={state.isFolderExplorerOpen}
        onClose={() => state.setIsFolderExplorerOpen(false)}
        currentDocument={state.currentDocument}
        onSelectDocument={(docName) => state.setCurrentDocument(docName)}
        showToast={state.showToast}
        photos={state.photos}
        recordings={state.recordings}
        geminiApiKey={state.geminiApiKey}
        setGeminiApiKey={state.setGeminiApiKey}
        timetableImage={state.timetableImage}
        setTimetableImage={state.setTimetableImage}
        storageMode={state.storageMode}
        setStorageMode={state.setStorageMode}
        timetableEntries={state.timetableEntries}
        setTimetableEntries={state.setTimetableEntries}
      />
    </div>
  );
};
