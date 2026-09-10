/**
 * Shared musical clock for the metronome and the drum machine.
 *
 * Holds the tempo and the audio-clock time of "beat zero" (the origin). Every
 * client derives its event times from `origin + index * beatSeconds / stepsPerBeat`,
 * so whichever starts second lands on the grid the first one is already
 * playing (the drum bar starts on the metronome's accent and vice versa), and a
 * tempo change rebases the origin so the grid phase is continuous for both.
 *
 * Only `currentTime` is read from the context, so tests can pass a fake.
 */
export interface Clock {
  readonly currentTime: number
}

/** First events are scheduled this far ahead of the clock. */
const START_AHEAD = 0.05

/**
 * Events further in the past than this are considered missed (main-thread
 * stall, throttled background tab) and skipped rather than fired all at once.
 */
export const MAX_LATE = 0.25

const clampBpm = (v: number) => Math.min(240, Math.max(40, Math.round(v)))

export class Transport {
  private clock: Clock
  private _bpm = 110
  private origin: number | null = null
  private users = 0

  constructor(clock: Clock) {
    this.clock = clock
  }

  get bpm(): number {
    return this._bpm
  }

  /** Change tempo; the grid phase at the current time is preserved. */
  set bpm(v: number) {
    const next = clampBpm(v)
    if (next === this._bpm) return
    if (this.origin !== null) {
      const now = this.clock.currentTime
      const beats = ((now - this.origin) * this._bpm) / 60
      this.origin = now - (beats * 60) / next
    }
    this._bpm = next
  }

  get beatSeconds(): number {
    return 60 / this._bpm
  }

  /** True while at least one client is running on this grid. */
  get running(): boolean {
    return this.users > 0
  }

  /** Audio time of beat zero, or null when nothing is running. */
  get beatOrigin(): number | null {
    return this.origin
  }

  /** A client starts. The first one establishes the grid a little ahead of now. */
  acquire(): void {
    if (this.users === 0 || this.origin === null) this.origin = this.clock.currentTime + START_AHEAD
    this.users++
  }

  /** A client stops. When the last one leaves, the grid is dropped. */
  release(): void {
    this.users = Math.max(0, this.users - 1)
    if (this.users === 0) this.origin = null
  }

  /** Audio time of step `index` on a grid of `stepsPerBeat` steps per beat. */
  timeOf(index: number, stepsPerBeat: number): number {
    return (this.origin ?? this.clock.currentTime) + (index * this.beatSeconds) / stepsPerBeat
  }

  /** First step index whose time is at or after `time` (never negative). */
  stepAtOrAfter(time: number, stepsPerBeat: number): number {
    const o = this.origin ?? this.clock.currentTime
    const steps = ((time - o) * stepsPerBeat) / this.beatSeconds
    return Math.max(0, Math.ceil(steps - 1e-6))
  }

  /** Step index a client should start scheduling from right now. */
  firstStep(stepsPerBeat: number, ahead = 0.02): number {
    return this.stepAtOrAfter(this.clock.currentTime + ahead, stepsPerBeat)
  }

  /**
   * Catch-up clamp for look-ahead schedulers: if `index` is more than
   * `maxLate` seconds in the past, return the first index at or after
   * now + a small margin so the missed events are skipped instead of being
   * fired together as one thump. Otherwise `index` is returned unchanged.
   */
  catchUp(index: number, stepsPerBeat: number, maxLate = MAX_LATE): number {
    const now = this.clock.currentTime
    if (this.timeOf(index, stepsPerBeat) < now - maxLate) return this.stepAtOrAfter(now + START_AHEAD, stepsPerBeat)
    return index
  }
}
