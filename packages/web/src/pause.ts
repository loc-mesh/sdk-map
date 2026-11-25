/**
 * Stop asking for map squares while the service is saying "too many".
 *
 * 🔴 WHY THIS EXISTS. The tiles service answers 429 when one browser asks for
 * squares faster than its per-minute limit. Left alone, the map library keeps
 * requesting a square for every new piece of view while the person keeps
 * dragging — every one of them refused, every one of them more load, and the
 * limit never gets the quiet minute it needs to clear.
 *
 * So the first 429 closes a gate for ten seconds. Nothing is sent while it is
 * closed: requests wait, and the ones the person drags past are cancelled by
 * the map library before they ever reach the network. When the ten seconds are
 * up ONE request goes out as a probe. If it is refused, the gate closes for
 * another ten seconds; if it succeeds, everything waiting goes.
 *
 * ⚠️ One gate per page, not per map. The service counts per credential and
 * per client address, so two maps on one page share one budget and must share
 * one pause.
 */

export type GateState = 'open' | 'paused' | 'probing';

export interface GateListener {
  (state: GateState, resumesAt: number | undefined): void;
}

export class RequestGate {
  private state: GateState = 'open';
  private resumesAt: number | undefined;
  private probeOut = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly waiting: Array<() => void> = [];
  private readonly listeners = new Set<GateListener>();

  constructor(
    private readonly pauseMs = 10_000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get current(): GateState {
    return this.state;
  }

  /** When the current pause ends, in epoch milliseconds. Undefined when not paused. */
  get resumeTime(): number | undefined {
    return this.resumesAt;
  }

  subscribe(listener: GateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Resolves when this request may go to the network. Rejects if it is cancelled first. */
  wait(signal?: AbortSignal): Promise<void> {
    if (this.state === 'open') return Promise.resolve();
    if (this.state === 'probing' && !this.probeOut) {
      this.probeOut = true;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const go = () => {
        signal?.removeEventListener('abort', cancel);
        resolve();
      };
      const cancel = () => {
        const i = this.waiting.indexOf(go);
        if (i >= 0) this.waiting.splice(i, 1);
        reject(abortError());
      };
      if (signal?.aborted) return cancel();
      signal?.addEventListener('abort', cancel, { once: true });
      this.waiting.push(go);
    });
  }

  /** The service said 429. */
  limited(): void {
    // Concurrent requests already in flight all come back 429 together; the
    // first one starts the pause and the rest must not keep extending it.
    if (this.state === 'paused') return;
    this.state = 'paused';
    this.probeOut = false;
    this.resumesAt = this.now() + this.pauseMs;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.startProbe(), this.pauseMs);
    this.emit();
  }

  /** A request came back with something other than 429. */
  succeeded(): void {
    if (this.state !== 'probing') return;
    this.state = 'open';
    this.probeOut = false;
    this.resumesAt = undefined;
    const all = this.waiting.splice(0);
    all.forEach((go) => go());
    this.emit();
  }

  /**
   * A request ended without an answer — cancelled because the person dragged
   * past it, or a network failure. If it was the probe, send another.
   */
  abandoned(): void {
    if (this.state !== 'probing') return;
    this.probeOut = false;
    this.releaseOne();
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.listeners.clear();
  }

  private startProbe(): void {
    this.timer = undefined;
    this.state = 'probing';
    this.resumesAt = undefined;
    this.emit();
    this.releaseOne();
  }

  private releaseOne(): void {
    const next = this.waiting.shift();
    if (!next) return; // the next request to arrive becomes the probe
    this.probeOut = true;
    next();
  }

  private emit(): void {
    this.listeners.forEach((l) => l(this.state, this.resumesAt));
  }
}

function abortError(): Error {
  const e = new Error('The request was cancelled.');
  e.name = 'AbortError';
  return e;
}

/** The page-wide gate every map shares. */
export const gate = new RequestGate();
