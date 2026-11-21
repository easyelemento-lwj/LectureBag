/** Active elapsed time, independent of UI ticks and wall-clock adjustments.
 * This is not proof that the OS captured audio while the app was suspended.
 */
export class RecordingClock {
  private accumulated = 0;
  private since: number | undefined;
  private state: 'idle' | 'running' | 'paused' | 'stopped' = 'idle';
  constructor(private now: () => number = () => performance.now()) {}
  start() { this.accumulated = 0; this.since = this.now(); this.state = 'running'; }
  elapsedMs() {
    return this.accumulated + (this.since === undefined ? 0 : Math.max(0, this.now() - this.since));
  }
  seconds() { return Math.floor(this.elapsedMs() / 1000); }
  pause() {
    if (this.state !== 'running') return;
    this.accumulated = this.elapsedMs(); this.since = undefined; this.state = 'paused';
  }
  resume() {
    if (this.state !== 'paused') return;
    this.since = this.now(); this.state = 'running';
  }
  stop() {
    if (this.state !== 'stopped') { this.accumulated = this.elapsedMs(); this.since = undefined; this.state = 'stopped'; }
    return this.accumulated;
  }
}
