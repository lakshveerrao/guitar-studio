/**
 * Synthesised audience: a looping bed of applause plus a swell after strums.
 * Rendered once into a buffer (hundreds of short filtered-noise claps with
 * random timing), so it costs nothing at runtime.
 */
export class Applause {
  private ctx: AudioContext
  private out: GainNode
  private swell: GainNode
  private src: AudioBufferSourceNode | null = null
  private buffer: AudioBuffer | null = null
  private _on = false
  private level = 0.35

  constructor(ctx: AudioContext, destination: AudioNode) {
    this.ctx = ctx
    this.out = ctx.createGain()
    this.out.gain.value = 0
    this.swell = ctx.createGain()
    this.swell.gain.value = 1
    this.swell.connect(this.out)
    this.out.connect(destination)
  }

  get on() {
    return this._on
  }

  setLevel(v: number) {
    this.level = v
    if (this._on) this.out.gain.setTargetAtTime(this.level, this.ctx.currentTime, 0.1)
  }

  start() {
    if (this._on) return
    this._on = true
    if (!this.buffer) this.buffer = this.render()
    const src = this.ctx.createBufferSource()
    src.buffer = this.buffer
    src.loop = true
    src.connect(this.swell)
    src.start()
    this.src = src
    this.out.gain.cancelScheduledValues(this.ctx.currentTime)
    this.out.gain.setTargetAtTime(this.level, this.ctx.currentTime, 0.6)
  }

  stop() {
    if (!this._on) return
    this._on = false
    const t = this.ctx.currentTime
    this.out.gain.setTargetAtTime(0, t, 0.4)
    const src = this.src
    this.src = null
    if (src) {
      src.stop(t + 2)
      src.onended = () => src.disconnect()
    }
  }

  /** Crowd reacts to a strum: brief rise in the applause. */
  cheer(amount = 0.6) {
    if (!this._on) return
    const t = this.ctx.currentTime
    const g = this.swell.gain
    g.cancelScheduledValues(t)
    g.setValueAtTime(g.value, t)
    g.linearRampToValueAtTime(1 + amount, t + 0.25)
    g.setTargetAtTime(1, t + 0.3, 0.9)
  }

  private render(): AudioBuffer {
    const sr = this.ctx.sampleRate
    const seconds = 6
    const len = sr * seconds
    const buf = this.ctx.createBuffer(2, len, sr)
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch)
      // ~40 people clapping at 3-5 Hz with jitter
      for (let p = 0; p < 40; p++) {
        const rate = 3 + Math.random() * 2
        const brightness = 0.25 + Math.random() * 0.5
        let t = Math.random() / rate
        while (t < seconds) {
          const start = Math.floor(t * sr)
          const decay = 0.012 + Math.random() * 0.02
          const amp = 0.05 + Math.random() * 0.08
          let lp = 0
          const n = Math.floor(sr * 0.06)
          for (let i = 0; i < n && start + i < len; i++) {
            const white = Math.random() * 2 - 1
            lp += (white - lp) * brightness
            d[start + i] += lp * amp * Math.exp(-i / (decay * sr))
          }
          t += (0.85 + Math.random() * 0.3) / rate
        }
      }
      // room: smear with a short feedback comb
      const delay = Math.floor(sr * 0.031)
      for (let i = delay; i < len; i++) d[i] += d[i - delay] * 0.35
      // seamless loop edges
      const fade = Math.floor(sr * 0.5)
      for (let i = 0; i < fade; i++) {
        const w = i / fade
        d[i] *= w
        d[len - 1 - i] *= w
      }
      let pk = 0
      for (let i = 0; i < len; i++) pk = Math.max(pk, Math.abs(d[i]))
      const g = pk > 0 ? 0.8 / pk : 1
      for (let i = 0; i < len; i++) d[i] *= g
    }
    return buf
  }
}
