import { Transport } from './Transport'

/**
 * Look-ahead scheduled metronome (Chris Wilson style): a timer wakes up every
 * 25ms and schedules any clicks that fall within the next 100ms on the audio
 * clock, so timing is sample-accurate regardless of main-thread jitter.
 *
 * Beat times come from the shared Transport grid, so the click stays locked
 * to the drum machine whichever was started first.
 */
export type BeatListener = (beat: number, time: number) => void

const LOOKAHEAD = 0.1
const TICK_MS = 25

export class Metronome {
  private ctx: AudioContext
  private out: GainNode
  private transport: Transport
  private timer: number | null = null
  private beat = 0
  private _running = false
  private listeners = new Set<BeatListener>()
  private beatsPerBar = 4
  private tapTimes: number[] = []

  constructor(ctx: AudioContext, destination: AudioNode, transport: Transport = new Transport(ctx)) {
    this.ctx = ctx
    this.transport = transport
    this.out = ctx.createGain()
    this.out.gain.value = 0.6
    this.out.connect(destination)
  }

  get bpm(): number {
    return this.transport.bpm
  }

  set bpm(v: number) {
    this.transport.bpm = v
  }

  get running(): boolean {
    return this._running
  }

  /** The shared clock this metronome schedules on. */
  get clock(): Transport {
    return this.transport
  }

  setVolume(v: number) {
    this.out.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02)
  }

  onBeat(fn: BeatListener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  start(): void {
    if (this._running) return
    this._running = true
    this.transport.acquire()
    // join the grid at the next beat (beat 0 when nothing else is running)
    this.beat = this.transport.firstStep(1)
    this.timer = window.setInterval(() => this.schedule(), TICK_MS)
  }

  stop(): void {
    if (!this._running) return
    this._running = false
    if (this.timer !== null) window.clearInterval(this.timer)
    this.timer = null
    this.transport.release()
  }

  /** Returns the detected tempo after 2+ taps, or null. */
  tap(): number | null {
    const now = performance.now()
    if (this.tapTimes.length && now - this.tapTimes[this.tapTimes.length - 1] > 2000) this.tapTimes = []
    this.tapTimes.push(now)
    if (this.tapTimes.length > 6) this.tapTimes.shift()
    if (this.tapTimes.length < 2) return null
    const intervals: number[] = []
    for (let i = 1; i < this.tapTimes.length; i++) intervals.push(this.tapTimes[i] - this.tapTimes[i - 1])
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length
    const bpm = Math.round(60000 / avg)
    this.bpm = bpm
    return this.bpm
  }

  private schedule() {
    const now = this.ctx.currentTime
    // after a stall, skip the missed beats instead of stacking them on "now"
    this.beat = this.transport.catchUp(this.beat, 1)
    while (this.transport.timeOf(this.beat, 1) < now + LOOKAHEAD) {
      const t = this.transport.timeOf(this.beat, 1)
      const b = this.beat
      this.click(t, b % this.beatsPerBar === 0)
      const delay = Math.max(0, (t - now) * 1000)
      window.setTimeout(() => this.listeners.forEach((l) => l(b, t)), delay)
      this.beat++
    }
  }

  private click(time: number, accent: boolean) {
    const osc = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    osc.type = 'square'
    osc.frequency.value = accent ? 1600 : 1100
    g.gain.setValueAtTime(0.0001, time)
    g.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.3, time + 0.001)
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.03)
    osc.connect(g)
    g.connect(this.out)
    osc.start(time)
    osc.stop(time + 0.04)
    osc.onended = () => {
      osc.disconnect()
      g.disconnect()
    }
  }
}
