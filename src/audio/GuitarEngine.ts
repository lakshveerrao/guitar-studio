import { StringVoice } from './StringVoice'
import { NUM_STRINGS } from '../music/tuning'
import type { NoteEvent, StringIndex, StrumDirection, Technique } from '../types'

export type PickupPosition = 'neck' | 'middle' | 'bridge'

export interface PlayNoteOptions {
  velocity?: number
  technique?: Technique
  palmMute?: boolean
  time?: number
  chord?: string
  source?: string
}

export interface StrumOptions {
  frets: number[] // 6 entries, -1 = skip
  direction: StrumDirection
  strength?: number // 0..1
  speed?: number // 0..1  (1 = fastest)
  palmMute?: boolean
  chord?: string
  time?: number
}

type NoteListener = (e: NoteEvent) => void

// String brightness by gauge (wound strings are darker) and pickup position
const STRING_BRIGHTNESS = [0.3, 0.38, 0.46, 0.6, 0.68, 0.76]
const STRING_DECAY = [5.2, 5.0, 4.6, 4.0, 3.6, 3.2]
const PICKUP_PICK_POSITION: Record<PickupPosition, number> = { neck: 0.3, middle: 0.2, bridge: 0.11 }

/**
 * Owns the six string voices and the "guitar" output stage (pickup
 * resonance, tone, volume). Everything downstream (amp, effects) attaches to
 * `output`. Input-agnostic: it does not know who asked for a note.
 */
export class GuitarEngine {
  readonly ctx: AudioContext
  readonly output: GainNode
  private strings: StringVoice[] = []
  private stringBus: GainNode
  private pickupPeak: BiquadFilterNode
  private pickupLow: BiquadFilterNode
  private toneFilter: BiquadFilterNode
  private volume: GainNode
  private sustain = 5 // 0..10
  private pickup: PickupPosition = 'middle'
  private vibratoDepth = 0 // cents
  private vibratoRate = 5.5
  private listeners = new Set<NoteListener>()

  constructor(ctx: AudioContext) {
    this.ctx = ctx
    this.stringBus = ctx.createGain()
    this.stringBus.gain.value = 0.55

    // Single-coil style pickup resonance
    this.pickupPeak = ctx.createBiquadFilter()
    this.pickupPeak.type = 'peaking'
    this.pickupPeak.frequency.value = 3200
    this.pickupPeak.Q.value = 1.1
    this.pickupPeak.gain.value = 4
    this.pickupLow = ctx.createBiquadFilter()
    this.pickupLow.type = 'lowpass'
    this.pickupLow.frequency.value = 6500
    this.pickupLow.Q.value = 0.7

    this.toneFilter = ctx.createBiquadFilter()
    this.toneFilter.type = 'lowpass'
    this.toneFilter.frequency.value = 8000
    this.toneFilter.Q.value = 0.5

    this.volume = ctx.createGain()
    this.volume.gain.value = 1
    this.output = ctx.createGain()

    this.stringBus.connect(this.pickupPeak)
    this.pickupPeak.connect(this.pickupLow)
    this.pickupLow.connect(this.toneFilter)
    this.toneFilter.connect(this.volume)
    this.volume.connect(this.output)

    for (let i = 0; i < NUM_STRINGS; i++) this.strings.push(new StringVoice(ctx, i, this.stringBus))
    this.setPickup('middle')
  }

  onNote(fn: NoteListener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  isRinging(string: StringIndex): boolean {
    return this.strings[string].ringing
  }

  ringingFret(string: StringIndex): number {
    return this.strings[string].currentFret
  }

  /** Play one note on one string. */
  playNote(string: StringIndex, fret: number, o: PlayNoteOptions = {}): void {
    if (fret < 0) return
    const velocity = Math.min(1, Math.max(0.05, o.velocity ?? 0.8))
    const technique: Technique = o.technique ?? 'pick'
    const legato = technique === 'hammer' || technique === 'pull'
    const palmMute = !!o.palmMute
    const sustainScale = 0.35 + (this.sustain / 10) * 1.9 // 0.35x .. 2.25x
    const fretDamp = 1 - Math.min(fret, 20) * 0.012 // higher frets ring a little shorter
    const voice = this.strings[string]
    // the voice reports the time the note is actually scheduled at (never in the past)
    const startTime = voice.pluck({
      fret,
      velocity: legato ? velocity * 0.75 : velocity,
      palmMute,
      legato,
      decaySeconds: STRING_DECAY[string] * sustainScale * fretDamp,
      brightness: STRING_BRIGHTNESS[string] + (this.pickup === 'bridge' ? 0.12 : this.pickup === 'neck' ? -0.08 : 0),
      pickPosition: PICKUP_PICK_POSITION[this.pickup],
      time: o.time,
    })
    const e: NoteEvent = {
      time: startTime,
      string,
      fret,
      velocity,
      technique,
      bend: 0,
      palmMute,
      chord: o.chord,
    }
    this.listeners.forEach((l) => l(e))
  }

  /**
   * Strum: sequential plucks with a gap that depends on speed, plus a small
   * humanised jitter and velocity ramp (the first strings hit are a bit softer).
   */
  strum(o: StrumOptions): void {
    const strength = Math.min(1, Math.max(0.1, o.strength ?? 0.8))
    const speed = Math.min(1, Math.max(0, o.speed ?? 0.6))
    const gap = 0.045 - speed * 0.03 // 45ms .. 15ms
    const order: number[] = []
    for (let i = 0; i < NUM_STRINGS; i++) order.push(i)
    if (o.direction === 'up') order.reverse()
    const active = order.filter((s) => o.frets[s] >= 0)
    // Explicit future times for every string: the small look-ahead keeps the
    // first string on the same grid as the rest (each render takes ~1 ms).
    const t0 = Math.max(o.time ?? 0, this.ctx.currentTime + 0.005)
    active.forEach((s, i) => {
      const jitter = (Math.random() - 0.5) * gap * 0.3
      const t = t0 + i * gap + Math.max(0, jitter)
      const ramp = 0.85 + (i / Math.max(1, active.length - 1)) * 0.15
      const vel = strength * ramp * (0.94 + Math.random() * 0.06)
      this.playNote(s as StringIndex, o.frets[s], {
        velocity: vel,
        technique: 'strum',
        palmMute: o.palmMute,
        time: t,
        chord: o.chord,
      })
    })
  }

  muteString(string: StringIndex, release = 0.04): void {
    this.strings[string].mute(release)
  }

  muteAll(release = 0.05): void {
    this.strings.forEach((s) => s.mute(release))
  }

  setBend(string: StringIndex | 'all', semitones: number): void {
    const v = Math.min(2, Math.max(0, semitones))
    if (string === 'all') this.strings.forEach((s) => s.setBend(v))
    else this.strings[string].setBend(v)
  }

  setVibrato(on: boolean, depthCents = 25, rate = 5.5): void {
    this.vibratoDepth = on ? depthCents : 0
    this.vibratoRate = rate
    this.strings.forEach((s) => s.setVibrato(this.vibratoDepth, this.vibratoRate))
  }

  setSustain(v: number): void {
    this.sustain = Math.min(10, Math.max(0, v))
  }

  setVolume(v: number): void {
    this.volume.gain.setTargetAtTime(Math.min(1, Math.max(0, v)), this.ctx.currentTime, 0.02)
  }

  /** Tone knob 0..10 */
  setTone(v: number): void {
    const f = 900 * Math.pow(9, Math.min(10, Math.max(0, v)) / 10) // 900 Hz .. 8.1 kHz
    this.toneFilter.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.02)
  }

  setPickup(p: PickupPosition): void {
    this.pickup = p
    const t = this.ctx.currentTime
    if (p === 'neck') {
      this.pickupPeak.frequency.setTargetAtTime(2400, t, 0.02)
      this.pickupLow.frequency.setTargetAtTime(4800, t, 0.02)
    } else if (p === 'middle') {
      this.pickupPeak.frequency.setTargetAtTime(3200, t, 0.02)
      this.pickupLow.frequency.setTargetAtTime(6500, t, 0.02)
    } else {
      this.pickupPeak.frequency.setTargetAtTime(4200, t, 0.02)
      this.pickupLow.frequency.setTargetAtTime(8000, t, 0.02)
    }
  }

  get pickupPosition(): PickupPosition {
    return this.pickup
  }
}
