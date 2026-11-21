import './recordingDisc.css';

/** Decorative motion only: timing and recording remain owned by the recorder. */
export function RecordingDisc({ paused, time }: { paused: boolean; time: string }) {
  return <div className="recording-disc-display" data-paused={paused}>
    <div className="recording-disc" aria-hidden="true">
      <img className="recording-disc-logo" src="/lecturebag-logo.png" alt="" draggable={false} />
    </div>
    <div className="recording-disc-time" role="timer" aria-label={`녹음 시간 ${time}`}>{time}</div>
  </div>;
}
