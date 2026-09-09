/**
 * Look-ahead scheduled metronome (Chris Wilson style): a timer wakes up every
 * 25ms and schedules any clicks that fall within the next 100ms on the audio
 * clock, so timing is sample-accurate regardless of main-thread jitter.
 */
export type BeatListener = (beat: number, time: number) => void

export class Metronome {
  private ctx: AudioContext
  private out: GainNode
  private timer: number | null = null
  private nextBeatTime = 0
  private beat = 0
  private _bpm = 110
  private _running = false
  private listeners = new Set<BeatListener>()
  private beatsPerBar = 4
  private tapTimes: number[] = []

  constructor(ctx: AudioContext, destination: AudioNode) {
    this.ctx = ctx
    this.out = ctx.createGain()
    this.out.gain.value = 0.6
    this.out.connect(destination)
  }

  get bpm(): number {
    return this._bpm
  }

  set bpm(v: number) {
    this._bpm = Math.min(240, Math.max(40, Math.round(v)))
  }

  get running(): boolean {
    return this._running
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
    this.beat = 0
    this.nextBeatTime = this.ctx.currentTime + 0.05
    this.timer = window.setInterval(() => this.schedule(), 25)
  }

  stop(): void {
    this._running = false
    if (this.timer !== null) window.clearInterval(this.timer)
    this.timer = null
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
    return this._bpm
  }

  private schedule() {
    const lookahead = 0.1
    while (this.nextBeatTime < this.ctx.currentTime + lookahead) {
      this.click(this.nextBeatTime, this.beat % this.beatsPerBar === 0)
      const b = this.beat
      const t = this.nextBeatTime
      const delay = Math.max(0, (t - this.ctx.currentTime) * 1000)
      window.setTimeout(() => this.listeners.forEach((l) => l(b, t)), delay)
      this.nextBeatTime += 60 / this._bpm
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
