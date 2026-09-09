/**
 * Tiny synthesized rhythm section. 16-step patterns, one bar of 4/4.
 * K = kick, S = snare, H = closed hat, O = open hat, . = rest
 */
export type DrumStyle = 'Rock' | 'Blues' | 'Pop' | 'Funk'

interface Pattern {
  kick: string
  snare: string
  hat: string
  swing: number // 0..1 amount of eighth-note swing
}

const PATTERNS: Record<DrumStyle, Pattern> = {
  Rock: {
    kick: 'x...x...x...x.x.',
    snare: '....x.......x...',
    hat: 'x.x.x.x.x.x.x.x.',
    swing: 0,
  },
  Blues: {
    kick: 'x.....x.x.....x.',
    snare: '....x.......x...',
    hat: 'x..x..x..x..x..x',
    swing: 0.6,
  },
  Pop: {
    kick: 'x......xx.......',
    snare: '....x.......x...',
    hat: 'xxxxxxxxxxxxxxxx',
    swing: 0,
  },
  Funk: {
    kick: 'x..x..x...x..x..',
    snare: '....x..x.x..x...',
    hat: 'x.xxx.xxx.xxx.xO',
    swing: 0.15,
  },
}

export type StepListener = (step: number, time: number) => void

export class DrumMachine {
  private ctx: AudioContext
  private out: GainNode
  private noiseBuf: AudioBuffer
  private timer: number | null = null
  private nextStepTime = 0
  private step = 0
  private _running = false
  private _style: DrumStyle = 'Rock'
  private listeners = new Set<StepListener>()
  bpm = 110

  constructor(ctx: AudioContext, destination: AudioNode) {
    this.ctx = ctx
    this.out = ctx.createGain()
    this.out.gain.value = 0.7
    this.out.connect(destination)
    const len = ctx.sampleRate
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = this.noiseBuf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
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
    this.step = 0
    this.nextStepTime = this.ctx.currentTime + 0.05
    this.timer = window.setInterval(() => this.schedule(), 25)
  }

  stop() {
    this._running = false
    if (this.timer !== null) window.clearInterval(this.timer)
    this.timer = null
  }

  private schedule() {
    const p = PATTERNS[this._style]
    const sixteenth = 60 / this.bpm / 4
    while (this.nextStepTime < this.ctx.currentTime + 0.1) {
      const s = this.step % 16
      const swingOffset = s % 2 === 1 ? p.swing * sixteenth * 0.5 : 0
      const t = this.nextStepTime + swingOffset
      if (p.kick[s] === 'x') this.kick(t)
      if (p.snare[s] === 'x') this.snare(t)
      if (p.hat[s] === 'x') this.hat(t, false)
      if (p.hat[s] === 'O') this.hat(t, true)
      const st = s
      window.setTimeout(() => this.listeners.forEach((l) => l(st, t)), Math.max(0, (t - this.ctx.currentTime) * 1000))
      this.nextStepTime += sixteenth
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
