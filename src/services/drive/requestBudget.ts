/** Metadata only: shared per origin/API/account. Never stores tokens or responses. */
export type RequestPriority = 'background' | 'interactive';
export interface BudgetState { starts: number[]; nextAt: number; until: number }
export interface BudgetPorts {
  now(): number;
  read(): BudgetState | undefined;
  write(value: BudgetState): void;
  lock<T>(work: () => T): Promise<T>;
  wait(ms: number, signal: AbortSignal): Promise<void>;
}
export class RequestCoolingDown extends Error {
  constructor(public retryAt: number) { super('요청 조절을 위해 잠시 대기합니다. 자동으로 다시 확인합니다.'); }
}
export function retryAfterMs(value: string | null, now = Date.now()) {
  const seconds = value?.trim();
  const parsed = seconds && /^\d+(\.\d+)?$/.test(seconds) ? Number(seconds) * 1000
    : seconds ? Date.parse(seconds) - now : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? Math.max(1000, parsed) : 60_000;
}
export function abortableDelay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, Math.min(ms, 2_147_483_647));
    signal.addEventListener('abort', abort, { once: true });
  });
}
interface Ticket { priority: RequestPriority; signal?: AbortSignal; resolve(): void; reject(error: unknown): void; cleanup(): void }
export class RequestBudget {
  private queue: Ticket[] = [];
  private running = false;
  private wake?: AbortController;
  constructor(private ports: BudgetPorts) {}
  private state(): BudgetState {
    const now = this.ports.now(), saved = this.ports.read();
    return { starts: (Array.isArray(saved?.starts) ? saved.starts : []).filter(t => Number.isFinite(t) && t > now - 60_000 && t <= now),
      nextAt: Number.isFinite(saved?.nextAt) ? saved!.nextAt : 0, until: Number.isFinite(saved?.until) ? saved!.until : 0 };
  }
  get retryAt() { return this.state().until; }
  async coolDown(ms: number) {
    await this.ports.lock(() => {
      const s = this.state(); this.ports.write({ ...s, until: Math.max(s.until, this.ports.now() + ms) });
    });
    this.wake?.abort();
  }
  enter(priority: RequestPriority, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      signal?.throwIfAborted();
      const abort = () => {
        this.queue = this.queue.filter(t => t !== ticket); reject(signal!.reason); this.wake?.abort();
      };
      const ticket: Ticket = { priority, signal, resolve, reject, cleanup: () => signal?.removeEventListener('abort', abort) };
      signal?.addEventListener('abort', abort, { once: true });
      this.queue.push(ticket); this.wake?.abort(); void this.drain();
    });
  }
  private async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        this.queue.sort((a, b) => Number(b.priority === 'interactive') - Number(a.priority === 'interactive'));
        const ticket = this.queue[0];
        let delay: number;
        try {
          delay = await this.ports.lock(() => {
            ticket.signal?.throwIfAborted();
            const now = this.ports.now(), s = this.state();
            if (s.until > now) throw new RequestCoolingDown(s.until);
            // Leave headroom for another device. Four reserved slots keep direct
            // actions ahead of background work, without bypassing a server cooldown.
            const limit = ticket.priority === 'interactive' ? 24 : 20;
            const due = Math.max(s.nextAt, s.starts.length >= limit ? s.starts[s.starts.length - limit] + 60_000 : 0);
            if (due > now) return due - now;
            this.ports.write({ ...s, starts: [...s.starts, now], nextAt: now + 2000 }); return 0;
          });
        } catch (error) {
          this.queue = this.queue.filter(t => t !== ticket); ticket.cleanup(); ticket.reject(error); continue;
        }
        if (delay) {
          this.wake = new AbortController();
          // A new user action interrupts the wait and is re-ranked, not appended
          // behind an entire scan. Re-read shared state after every wait.
          await this.ports.wait(Math.min(delay, 1000), this.wake.signal).catch(() => {});
          this.wake = undefined;
        } else {
          this.queue = this.queue.filter(t => t !== ticket); ticket.cleanup(); ticket.resolve();
        }
      }
    } finally { this.running = false; }
  }
}
const budgets = new Map<string, RequestBudget>();
export function accountBudget(endpoint: string, uid: string) {
  const key = `lecturebag-request-budget:${JSON.stringify([new URL(endpoint).origin, uid])}`;
  let budget = budgets.get(key);
  if (!budget) {
    let fallback: BudgetState | undefined;
    budget = new RequestBudget({ now: Date.now,
      read: () => { try { return JSON.parse(localStorage.getItem(key) || 'null') || fallback; } catch { return fallback; } },
      write: value => { fallback = value; try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* In-memory fallback. */ } },
      lock: async work => typeof navigator !== 'undefined' && navigator.locks
        ? navigator.locks.request(key, work) : work(),
      wait: abortableDelay,
    });
    budgets.set(key, budget);
  }
  return budget;
}
