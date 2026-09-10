import { Transport } from './Transport'

/**
 * Tiny synthesized rhythm section. 16-step patterns, one bar of 4/4.
 * K = kick, S = snare, H = closed hat, O = open hat, . = rest
 *
 * Step times come from the shared Transport grid (16th notes), so the bar
 * lines up with the metronome's accent whichever was started first.
 */
export type DrumStyle = 'Rock' | 'Blues' | 'Pop' | 'Funk'

export interface Pattern {
  kick: string
  snare: string
  hat: string
  /**
   * Swing amount 0..1: how far the swung steps are pushed late, as a fraction
   * of one sixteenth. With `swingGrid` 8, 0.667 puts the off-beat eighth on
   * the triplet (a shuffle).
   */
  swing: number
  /**
   * Which steps are swung.
   *   8  = eighth-note swing: only the off-beat eighths (steps 2, 6, 10, 14)
   *        are delayed by `swing` sixteenths.
   *   16 = sixteenth-note swing: every odd sixteenth (1, 3, 5, ...) is delayed
   *        by half of `swing` sixteenths.
   */
  swingGrid: 8 | 16
}

export const PATTERNS: Record<DrumStyle, Pattern> = {
  Rock: {
    kick: 'x...x...x...x.x.',
    snare: '....x.......x...',
    hat: 'x.x.x.x.x.x.x.x.',
    swing: 0,
    swingGrid: 8,
  },
  Blues: {
    // straight eighths on the hat, shuffled by the eighth-note swing; the
    // kick's "and" hits (steps 6 and 14) swing with it
    kick: 'x.....x.x.....x.',
    snare: '....x.......x...',
    hat: 'x.x.x.x.x.x.x.x.',
    swing: 0.667,
    swingGrid: 8,
  },
  Pop: {
    kick: 'x......xx.......',
    snare: '....x.......x...',
    hat: 'xxxxxxxxxxxxxxxx',
    swing: 0,
    swingGrid: 8,
  },
  Funk: {
    kick: 'x..x..x...x..x..',
    snare: '....x..x.x..x...',
    hat: 'x.xxx.xxx.xxx.xO',
    swing: 0.15,
    swingGrid: 16,
  },
}

/** Seconds a step is delayed by the pattern's swing (see Pattern). */
export function swingOffset(p: Pick<Pattern, 'swing' | 'swingGrid'>, step: number, sixteenth: number): number {
  const s = ((step % 16) + 16) % 16
  if (p.swingGrid === 8) return s % 4 === 2 ? p.swing * sixteenth : 0
  return s % 2 === 1 ? p.swing * sixteenth * 0.5 : 0
}

export type StepListener = (step: number, time: number) => void

const STEPS_PER_BEAT = 4
const LOOKAHEAD = 0.1
const TICK_MS = 25

export class DrumMachine {
  private ctx: AudioContext
  private out: GainNode
  private transport: Transport
  private noiseBuf: AudioBuffer
  private timer: number | null = null
  private step = 0
  private _running = false
  private _style: DrumStyle = 'Rock'
  private listeners = new Set<StepListener>()

  constructor(ctx: AudioContext, destination: AudioNode, transport: Transport = new Transport(ctx)) {
    this.ctx = ctx
    this.transport = transport
    this.out = ctx.createGain()
    this.out.gain.value = 0.7
    this.out.connect(destination)
    const len = ctx.sampleRate
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = this.noiseBuf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
  }

  get bpm(): number {
    return this.transport.bpm
  }
  set bpm(v: number) {
    this.transport.bpm = v
  }

  get running() {
    return this._running
  }
  get style() {
    return this._style
  }
  set style(s: DrumStyle) {
    this._style = s
  }

  /** The shared clock this drum machine schedules on. */
  get clock(): Transport {
    return this.transport
  }

  setVolume(v: number) {
    this.out.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02)
  }

  onStep(fn: StepListener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  start() {
    if (this._running) return
    this._running = true
    this.transport.acquire()
    // join the grid at the next sixteenth (step 0 when nothing else is running)
    this.step = this.transport.firstStep(STEPS_PER_BEAT)
    this.timer = window.setInterval(() => this.schedule(), TICK_MS)
  }

  stop() {
    if (!this._running) return
    this._running = false
    if (this.timer !== null) window.clearInterval(this.timer)
    this.timer = null
    this.transport.release()
  }

  private schedule() {
    const p = PATTERNS[this._style]
    const sixteenth = this.transport.beatSeconds / STEPS_PER_BEAT
    const now = this.ctx.currentTime
    // after a stall, skip the missed steps instead of stacking them on "now"
    this.step = this.transport.catchUp(this.step, STEPS_PER_BEAT)
    while (this.transport.timeOf(this.step, STEPS_PER_BEAT) < now + LOOKAHEAD) {
      const s = this.step % 16
      const t = this.transport.timeOf(this.step, STEPS_PER_BEAT) + swingOffset(p, s, sixteenth)
      if (p.kick[s] === 'x') this.kick(t)
      if (p.snare[s] === 'x') this.snare(t)
      if (p.hat[s] === 'x') this.hat(t, false)
      if (p.hat[s] === 'O') this.hat(t, true)
      window.setTimeout(() => this.listeners.forEach((l) => l(s, t)), Math.max(0, (t - now) * 1000))
      this.step++
    }
  }

  private kick(t: number) {
    const osc = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    osc.frequency.setValueAtTime(150, t)
    osc.frequency.exponentialRampToValueAtTime(48, t + 0.09)
    g.gain.setValueAtTime(1, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35)
    osc.connect(g)
    g.connect(this.out)
    osc.start(t)
    osc.stop(t + 0.4)
    osc.onended = () => {
      osc.disconnect()
      g.disconnect()
    }
  }

  private snare(t: number) {
    const n = this.ctx.createBufferSource()
    n.buffer = this.noiseBuf
    const bp = this.ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 1800
    bp.Q.value = 0.8
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0.7, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18)
    n.connect(bp)
    bp.connect(g)
    g.connect(this.out)
    n.start(t)
    n.stop(t + 0.2)
    const osc = this.ctx.createOscillator()
    const og = this.ctx.createGain()
    osc.frequency.setValueAtTime(220, t)
    osc.frequency.exponentialRampToValueAtTime(150, t + 0.05)
    og.gain.setValueAtTime(0.5, t)
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.1)
    osc.connect(og)
    og.connect(this.out)
    osc.start(t)
    osc.stop(t + 0.12)
    n.onended = () => {
      n.disconnect()
      bp.disconnect()
      g.disconnect()
    }
    osc.onended = () => {
      osc.disconnect()
      og.disconnect()
    }
  }

  private hat(t: number, open: boolean) {
    const n = this.ctx.createBufferSource()
    n.buffer = this.noiseBuf
    const hp = this.ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 7000
    const g = this.ctx.createGain()
    const dur = open ? 0.25 : 0.045
    g.gain.setValueAtTime(open ? 0.28 : 0.22, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + dur)
    n.connect(hp)
    hp.connect(g)
    g.connect(this.out)
    n.start(t)
    n.stop(t + dur + 0.02)
    n.onended = () => {
      n.disconnect()
      hp.disconnect()
      g.disconnect()
    }
  }
}
