/**
 * Synthesised audience: a looping bed of applause plus a swell after strums.
 * Rendered once into a buffer (hundreds of short filtered-noise claps with
 * random timing), so it costs nothing at runtime.
 */

/** Loop length of the applause bed. */
const LOOP_SECONDS = 6
/** Length of the crossfade that joins the loop's tail into its head. */
const XFADE_SECONDS = 0.5
/** Fade-out lasts ~4 time constants; the source is released after that. */
const RELEASE_MS = 2500

/**
 * Render one channel of a seamless applause loop. The claps are generated
 * `xfade` seconds past the loop end, the room comb runs over that whole
 * stretch (so the samples that become the loop head already carry the
 * comb's history), and the overhang is equal-power crossfaded into the
 * head. Sample `len - 1` therefore continues into sample 0 without a dip.
 */
export function renderApplauseChannel(sr: number, seconds = LOOP_SECONDS, xfade = XFADE_SECONDS, random: () => number = Math.random): Float32Array<ArrayBuffer> {
  const len = Math.floor(sr * seconds)
  const fade = Math.floor(sr * xfade)
  const tlen = len + fade
  const total = tlen / sr
  const tmp = new Float32Array(tlen)
  // ~40 people clapping at 3-5 Hz with jitter
  for (let p = 0; p < 40; p++) {
    const rate = 3 + random() * 2
    const brightness = 0.25 + random() * 0.5
    let t = random() / rate
    while (t < total) {
      const start = Math.floor(t * sr)
      const decay = 0.012 + random() * 0.02
      const amp = 0.05 + random() * 0.08
      let lp = 0
      const n = Math.floor(sr * 0.06)
      for (let i = 0; i < n && start + i < tlen; i++) {
        const white = random() * 2 - 1
        lp += (white - lp) * brightness
        tmp[start + i] += lp * amp * Math.exp(-i / (decay * sr))
      }
      t += (0.85 + random() * 0.3) / rate
    }
  }
  // room: smear with a short feedback comb (before the crossfade)
  const delay = Math.floor(sr * 0.031)
  for (let i = delay; i < tlen; i++) tmp[i] += tmp[i - delay] * 0.35
  const d = new Float32Array(len)
  d.set(tmp.subarray(0, len))
  // equal-power crossfade of the overhang into the head
  for (let i = 0; i < fade; i++) {
    const x = ((i / fade) * Math.PI) / 2
    d[i] = tmp[i] * Math.sin(x) + tmp[len + i] * Math.cos(x)
  }
  let pk = 0
  for (let i = 0; i < len; i++) pk = Math.max(pk, Math.abs(d[i]))
  const g = pk > 0 ? 0.8 / pk : 1
  for (let i = 0; i < len; i++) d[i] *= g
  return d
}

export class Applause {
  private ctx: AudioContext
  private out: GainNode
  private swell: GainNode
  private src: AudioBufferSourceNode | null = null
  private buffer: AudioBuffer | null = null
  private releaseTimer: number | null = null
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
    // A restart inside the fade-out window reuses the still-playing source
    // (only `out` is automated), so the bed never doubles up.
    if (this.releaseTimer !== null) {
      window.clearTimeout(this.releaseTimer)
      this.releaseTimer = null
    }
    if (!this.src) {
      const src = this.ctx.createBufferSource()
      src.buffer = this.buffer
      src.loop = true
      src.connect(this.swell)
      src.start()
      this.src = src
    }
    const t = this.ctx.currentTime
    this.out.gain.cancelScheduledValues(t)
    this.out.gain.setTargetAtTime(this.level, t, 0.6)
  }

  stop() {
    if (!this._on) return
    this._on = false
    const t = this.ctx.currentTime
    this.out.gain.cancelScheduledValues(t)
    this.out.gain.setTargetAtTime(0, t, 0.4)
    // release the source once the fade is inaudible
    this.releaseTimer = window.setTimeout(() => {
      this.releaseTimer = null
      const src = this.src
      this.src = null
      if (src) {
        try {
          src.stop()
        } catch {
          /* already stopped */
        }
        src.disconnect()
      }
    }, RELEASE_MS)
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
    const len = Math.floor(sr * LOOP_SECONDS)
    const buf = this.ctx.createBuffer(2, len, sr)
    for (let ch = 0; ch < 2; ch++) buf.getChannelData(ch).set(renderApplauseChannel(sr))
    return buf
  }
}
