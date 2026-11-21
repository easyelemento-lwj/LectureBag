import { RecordingClock } from './recordingClock';
import { appendRecordingChunk, createRecordingDraft, touchRecordingDraft, type RecordingDraft } from './recordingDrafts';

export interface RecordingResult { blob: Blob; elapsedMs: number; warning?: string; draft: RecordingDraft }
export interface RecordingJournal {
  create: typeof createRecordingDraft;
  append: typeof appendRecordingChunk;
  touch: typeof touchRecordingDraft;
}
const journal: RecordingJournal = { create: createRecordingDraft, append: appendRecordingChunk, touch: touchRecordingDraft };

/** One recorder, one finalization. All handlers exist BEFORE capture starts. */
export class RecordingSession {
  private chunks: Blob[] = [];
  private writes: Promise<void> = Promise.resolve();
  private writeFailed = false;
  private requestedStop = false;
  private finished = false;
  private warning?: string;
  private lastData = performance.now();
  private bytes = 0;
  private timer?: ReturnType<typeof setInterval>;
  private trackListeners: Array<() => void> = [];
  constructor(
    readonly recorder: MediaRecorder,
    readonly draft: RecordingDraft,
    readonly clock: RecordingClock,
    private onFinished: (result: RecordingResult) => void | Promise<void>,
    private onWarning: (message: string) => void,
    private storage = journal,
  ) {}
  async start() {
    await this.storage.create(this.draft); // Fail before recording if durable storage unavailable.
    if (this.requestedStop) { this.cleanup(); throw new Error('녹음 시작 취소됨'); }
    this.recorder.ondataavailable = e => {
      if (this.finished || !e.data.size) return;
      this.lastData = performance.now();
      const index = this.chunks.length;
      this.chunks.push(e.data); this.bytes += e.data.size;
      const elapsed = this.clock.elapsedMs();
      this.write(() => this.storage.append(this.draft.uid, this.draft.id, this.draft.owner, index, e.data, elapsed));
      // Bound live memory and the final Base64 conversion. Never discard the final chunk.
      if (this.bytes >= 95 * 1024 * 1024) this.stop('녹음 용량 한도에 도달해 중단했습니다. 수집된 원본을 보존합니다.');
    };
    this.recorder.onerror = () => this.stop('녹음 오류가 발생했습니다. 수집된 부분만 보존하며 전체 녹음 여부를 확인해야 합니다.');
    this.recorder.onstop = () => { void this.finish(); };
    for (const track of this.recorder.stream.getAudioTracks()) {
      const interrupted = () => this.stop('마이크가 중단되어 녹음을 종료했습니다. 수집된 부분을 확인해 주세요.');
      track.addEventListener('ended', interrupted); track.addEventListener('mute', interrupted);
      this.trackListeners.push(() => { track.removeEventListener('ended', interrupted); track.removeEventListener('mute', interrupted); });
    }
    try {
      this.recorder.start(1000);
      this.clock.start(); this.lastData = performance.now();
      this.timer = setInterval(() => {
        if (this.requestedStop || this.finished) return;
        if (this.recorder.state === 'inactive') { this.stop('녹음기가 예기치 않게 종료되었습니다.'); return; }
        if (this.recorder.state === 'recording' && performance.now() - this.lastData > 15_000) {
          this.stop('15초 이상 새 녹음 데이터를 받지 못해 중단했습니다. 원본을 확인해 주세요.'); return;
        }
        this.write(() => this.storage.touch(this.draft.uid, this.draft.id, this.draft.owner, this.clock.elapsedMs()));
      }, 5000);
    } catch (error) { this.cleanup(); throw error; }
  }
  private write(operation: () => Promise<void>) {
    this.writes = this.writes.then(async () => { if (!this.writeFailed) await operation(); }).catch(() => {
      this.writeFailed = true;
      this.stop('기기 중간 저장에 실패해 녹음을 중단했습니다. 화면을 닫지 말고 최종 저장을 확인해 주세요.');
    });
  }
  pause() { if (!this.requestedStop && this.recorder.state === 'recording') { this.recorder.pause(); this.clock.pause(); } }
  resume() { if (!this.requestedStop && this.recorder.state === 'paused') { this.recorder.resume(); this.clock.resume(); this.lastData = performance.now(); } }
  stop(reason?: string) {
    if (reason && !this.warning) { this.warning = reason; this.onWarning(reason); }
    if (this.requestedStop || this.finished) return;
    this.requestedStop = true; this.clock.stop();
    if (this.recorder.state !== 'inactive') this.recorder.stop();
    // Even error/ended follows final dataavailable -> stop. Do not finalize early here.
  }
  private async finish() {
    if (this.finished) return;
    this.finished = true;
    if (!this.requestedStop && !this.warning) this.warning = '녹음이 예기치 않게 종료되었습니다. 수집된 부분만 보존했습니다.';
    const elapsedMs = this.clock.stop();
    this.cleanup();
    await this.writes;
    try { await this.storage.touch(this.draft.uid, this.draft.id, this.draft.owner, elapsedMs, true, this.warning); }
    catch { this.warning ||= '녹음 중간 저장을 완료하지 못했습니다. 최종 원본 저장을 확인해 주세요.'; }
    try { await this.onFinished({ blob: new Blob(this.chunks, { type: this.draft.mime }), elapsedMs, warning: this.warning, draft: this.draft }); }
    catch { this.onWarning('녹음 마무리에 실패했습니다. 화면을 닫지 말고 기기 저장을 다시 시도해 주세요.'); }
    this.chunks = [];
  }
  private cleanup() {
    clearInterval(this.timer);
    this.trackListeners.forEach(remove => remove()); this.trackListeners = [];
    this.recorder.stream.getTracks().forEach(track => track.stop());
  }
}
