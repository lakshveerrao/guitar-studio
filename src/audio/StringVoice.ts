import { pluckLength, renderPluck } from './KarplusStrong'
import { fretFrequency } from '../music/tuning'

export interface PluckOptions {
  fret: number
  velocity: number
  palmMute: boolean
  legato: boolean
  decaySeconds: number
  brightness: number
  pickPosition: number
  time?: number // audio clock time to start; default now
}

interface ActiveNote {
  src: AudioBufferSourceNode
  gain: GainNode
  start: number
  end: number
  fret: number
  palmMute: boolean
}

/**
 * Notes start at least this far ahead of the audio clock. The start time is
 * chosen after the pluck has been rendered, so render time can never push a
 * note into the past (which Web Audio would clamp to "now", late).
 */
const MIN_LOOKAHEAD = 0.003

/**
 * One physical string. Owns at most one sounding note at a time (like a real
 * string) but crossfades between notes for legato. Bend and vibrato are
 * applied to the source's detune parameter in cents. The vibrato LFO is only
 * created and connected while vibrato is active: an audio-rate input on
 * `detune` forces the source onto its sample-accurate playback-rate path.
 */
export class StringVoice {
  readonly index: number
  private ctx: AudioContext
  private out: GainNode
  private active: ActiveNote | null = null
  private bendCents = 0
  private lfo: OscillatorNode | null = null
  private lfoGain: GainNode | null = null
  private lfoTarget: AudioParam | null = null
  private lfoDetachTimer: number | null = null
  private vibratoDepth = 0
  private seed = 1

  constructor(ctx: AudioContext, index: number, destination: AudioNode) {
    this.ctx = ctx
    this.index = index
    this.out = ctx.createGain()
    this.out.gain.value = 1
    this.out.connect(destination)
  }

  get ringing(): boolean {
    return !!this.active && this.ctx.currentTime < this.active.end
  }

  get currentFret(): number {
    return this.active?.fret ?? -1
  }

  /** seconds since the current note started, or Infinity */
  get age(): number {
    return this.active ? this.ctx.currentTime - this.active.start : Infinity
  }

  /** Pluck the string. Returns the audio-clock time the note actually starts. */
  pluck(o: PluckOptions): number {
    const ctx = this.ctx
    const freq = fretFrequency(this.index, o.fret)

    this.seed = (this.seed * 1103515245 + 12345) >>> 0
    const params = {
      sampleRate: ctx.sampleRate,
      frequency: freq,
      velocity: o.velocity,
      brightness: o.brightness,
      decaySeconds: o.decaySeconds,
      pickPosition: o.pickPosition,
      palmMute: o.palmMute,
      legato: o.legato,
    }
    // One allocation per note: render straight into the AudioBuffer's channel.
    const buffer = ctx.createBuffer(1, pluckLength(params), ctx.sampleRate)
    renderPluck(params, this.seed, buffer.getChannelData(0))

    // Decide the start time only now, after the render.
    const t = Math.max(o.time ?? 0, ctx.currentTime + MIN_LOOKAHEAD)

    // Stop the previous note. Real strings cannot sound two notes at once.
    if (this.active) {
      const release = o.legato ? 0.03 : 0.006
      this.release(this.active, t, release)
    }

    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.detune.value = this.bendCents
    if (this.vibratoDepth > 0) this.attachLfo(src.detune)
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(o.legato ? 0.0001 : 1, t)
    if (o.legato) gain.gain.exponentialRampToValueAtTime(1, t + 0.012)
    src.connect(gain)
    gain.connect(this.out)
    src.start(t)

    const note: ActiveNote = {
      src,
      gain,
      start: t,
      end: t + buffer.duration,
      fret: o.fret,
      palmMute: o.palmMute,
    }
    src.onended = () => {
      this.dispose(note)
      if (this.active === note) this.active = null
    }
    this.active = note
    return t
  }

  /** Damp the string (hand mute / release). */
  mute(releaseSeconds = 0.04): void {
    if (this.active) {
      this.release(this.active, this.ctx.currentTime, releaseSeconds)
      this.active = null
    }
  }

  /** Bend in semitones (0..2); applied immediately with a short smoothing. */
  setBend(semitones: number, glideSeconds = 0.02): void {
    this.bendCents = semitones * 100
    if (this.active) {
      const p = this.active.src.detune
      p.cancelScheduledValues(this.ctx.currentTime)
      p.setTargetAtTime(this.bendCents, this.ctx.currentTime, glideSeconds)
    }
  }

  /** Vibrato depth in cents (0 = off) and rate in Hz. */
  setVibrato(depthCents: number, rateHz = 5.5): void {
    const t = this.ctx.currentTime
    this.vibratoDepth = Math.max(0, depthCents)
    if (this.lfoDetachTimer !== null) {
      window.clearTimeout(this.lfoDetachTimer)
      this.lfoDetachTimer = null
    }
    if (this.vibratoDepth > 0) {
      const { lfo, lfoGain } = this.ensureLfo()
      lfoGain.gain.setTargetAtTime(this.vibratoDepth, t, 0.05)
      lfo.frequency.setTargetAtTime(rateHz, t, 0.05)
      if (this.active) this.attachLfo(this.active.src.detune)
    } else if (this.lfoGain) {
      // ramp the depth out first, then detach so the pitch does not step
      this.lfoGain.gain.setTargetAtTime(0, t, 0.05)
      this.lfoDetachTimer = window.setTimeout(() => {
        this.lfoDetachTimer = null
        this.detachLfo()
      }, 300)
    }
  }

  private ensureLfo(): { lfo: OscillatorNode; lfoGain: GainNode } {
    if (!this.lfo || !this.lfoGain) {
      this.lfo = this.ctx.createOscillator()
      this.lfo.type = 'sine'
      this.lfo.frequency.value = 5.5
      this.lfoGain = this.ctx.createGain()
      this.lfoGain.gain.value = 0 // cents of vibrato depth
      this.lfo.connect(this.lfoGain)
      this.lfo.start()
    }
    return { lfo: this.lfo, lfoGain: this.lfoGain }
  }

  private attachLfo(param: AudioParam): void {
    if (this.lfoTarget === param) return
    this.detachLfo()
    const { lfoGain } = this.ensureLfo()
    lfoGain.connect(param)
    this.lfoTarget = param
  }

  private detachLfo(): void {
    if (this.lfoTarget && this.lfoGain) {
      try {
        this.lfoGain.disconnect(this.lfoTarget)
      } catch {
        /* not connected */
      }
    }
    this.lfoTarget = null
  }

  private release(note: ActiveNote, time: number, seconds: number) {
    const g = note.gain.gain
    g.cancelScheduledValues(time)
    g.setValueAtTime(Math.max(g.value, 0.0001), time)
    g.exponentialRampToValueAtTime(0.0001, time + seconds)
    try {
      note.src.stop(time + seconds + 0.01)
    } catch {
      /* already stopped */
    }
  }

  private dispose(note: ActiveNote) {
    if (this.lfoTarget === note.src.detune) this.detachLfo()
    note.src.disconnect()
    note.gain.disconnect()
    note.src.onended = null
  }
}
