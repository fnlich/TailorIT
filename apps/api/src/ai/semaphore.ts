export type AiPriority = 'interactive' | 'background';

interface Waiter {
  priority: AiPriority;
  grant(): void;
}

/**
 * The seat's concurrency: `total` slots, of which background work may use at most `backgroundMax`, and only while
 * no interactive request is waiting. FIFO within each priority. A waiter whose signal aborts leaves the line.
 */
export class PrioritySemaphore {
  private active = 0;
  private activeBackground = 0;
  private readonly lines: Record<AiPriority, Waiter[]> = { interactive: [], background: [] };

  constructor(
    private readonly total: number,
    private readonly backgroundMax: number,
  ) {}

  /** Resolves with a release function (call it exactly once; extra calls are ignored). */
  acquire(priority: AiPriority, signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(abortReason(signal));
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        const line = this.lines[priority];
        const index = line.indexOf(waiter);
        if (index >= 0) line.splice(index, 1);
        reject(abortReason(signal!));
        // A background waiter may have been blocked only by this interactive one.
        this.drain();
      };
      const waiter: Waiter = {
        priority,
        grant: () => {
          signal?.removeEventListener('abort', onAbort);
          resolve(this.releaser(priority));
        },
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.lines[priority].push(waiter);
      this.drain();
    });
  }

  get stats() {
    return {
      active: this.active,
      activeBackground: this.activeBackground,
      waitingInteractive: this.lines.interactive.length,
      waitingBackground: this.lines.background.length,
    };
  }

  private drain(): void {
    while (this.active < this.total) {
      const background = this.activeBackground < this.backgroundMax ? this.lines.background[0] : undefined;
      const next = this.lines.interactive[0] ?? background;
      if (!next) return;
      this.lines[next.priority].shift();
      this.active += 1;
      if (next.priority === 'background') this.activeBackground += 1;
      next.grant();
    }
  }

  private releaser(priority: AiPriority): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      if (priority === 'background') this.activeBackground -= 1;
      this.drain();
    };
  }
}

function abortReason(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const error = new Error('The wait was cancelled.');
  error.name = 'AbortError';
  return error;
}
