/**
 * Frame-time watchdog: if the average frame over a 2 s window exceeds the
 * budget, fire once (the caller halves the draw range). Ignores hitches from
 * tab switches and the first moments after load (shader compile, uploads).
 */
export class PerfGuard {
  private sum = 0;
  private frames = 0;
  private warmup: number;
  tripped = false;

  constructor(private budgetMs = 28, private windowS = 2, warmupS = 1.5, disabled = false) {
    this.warmup = warmupS;
    this.tripped = disabled;
  }

  /** Returns true exactly once, on the frame the guard trips. */
  tick(delta: number): boolean {
    if (this.tripped) return false;
    if (delta > 0.25) return false; // backgrounded / paused, not slow
    if (this.warmup > 0) { this.warmup -= delta; return false; }
    this.sum += delta;
    this.frames++;
    if (this.sum < this.windowS) return false;
    const avgMs = (this.sum / this.frames) * 1000;
    this.sum = 0;
    this.frames = 0;
    if (avgMs > this.budgetMs) {
      this.tripped = true;
      return true;
    }
    return false;
  }
}
