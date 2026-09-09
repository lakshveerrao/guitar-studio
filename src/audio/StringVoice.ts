import { renderPluck } from './KarplusStrong'
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
 * One physical string. Owns at most one sounding note at a time (like a real
 * string) but crossfades between notes for legato. Bend and vibrato are
 * applied to the source's detune parameter in cents.
 */
export class StringVoice {
  readonly index: number
  private ctx: AudioContext
  private out: GainNode
  private active: ActiveNote | null = null
  private bendCents = 0
  private lfo: OscillatorNode
  private lfoGain: GainNode
  private seed = 1

  constructor(ctx: AudioContext, index: number, destination: AudioNode) {
    this.ctx = ctx
    this.index = index
    this.out = ctx.createGain()
    this.out.gain.value = 1
    this.out.connect(destination)
    this.lfo = ctx.createOscillator()
    this.lfo.type = 'sine'
    this.lfo.frequency.value = 5.5
    this.lfoGain = ctx.createGain()
    this.lfoGain.gain.value = 0 // cents of vibrato depth
    this.lfo.connect(this.lfoGain)
    this.lfo.start()
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

  pluck(o: PluckOptions): void {
    const ctx = this.ctx
    const t = Math.max(o.time ?? ctx.currentTime, ctx.currentTime)
    const freq = fretFrequency(this.index, o.fret)

    this.seed = (this.seed * 1103515245 + 12345) >>> 0
    const samples = renderPluck(
      {
        sampleRate: ctx.sampleRate,
        frequency: freq,
        velocity: o.velocity,
        brightness: o.brightness,
        decaySeconds: o.decaySeconds,
        pickPosition: o.pickPosition,
        palmMute: o.palmMute,
        legato: o.legato,
      },
      this.seed,
    )
    const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate)
    buffer.copyToChannel(samples, 0)

    // Stop the previous note. Real strings cannot sound two notes at once.
    if (this.active) {
      const release = o.legato ? 0.03 : 0.006
      this.release(this.active, t, release)
    }

    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.detune.value = this.bendCents
    this.lfoGain.connect(src.detune)
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
    this.lfoGain.gain.setTargetAtTime(depthCents, t, 0.05)
    this.lfo.frequency.setTargetAtTime(rateHz, t, 0.05)
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
    try {
      this.lfoGain.disconnect(note.src.detune)
    } catch {
      /* ignore */
    }
    note.src.disconnect()
    note.gain.disconnect()
    note.src.onended = null
  }
}
