import type { AmpModel, AmpParams } from '../types'
import { makeCurve, type CurveKind } from './dsp'

interface ModelSpec {
  curve: CurveKind
  drive: number // base drive 0..1 at gain 5
  driveRange: number // extra drive across the gain knob
  pre: number // pre-gain multiplier
  bassOffset: number // dB shifts baked into the voicing
  midOffset: number
  trebleOffset: number
  cabinet: number // lowpass Hz
  cabResonance: number // low peaking Hz
  level: number // output trim
}

const MODELS: Record<AmpModel, ModelSpec> = {
  Clean: { curve: 'soft', drive: 0.04, driveRange: 0.12, pre: 1.2, bassOffset: 0, midOffset: 0, trebleOffset: 1, cabinet: 6500, cabResonance: 110, level: 1 },
  Warm: { curve: 'tube', drive: 0.08, driveRange: 0.18, pre: 1.4, bassOffset: 2, midOffset: 1, trebleOffset: -3, cabinet: 4200, cabResonance: 100, level: 0.95 },
  Blues: { curve: 'tube', drive: 0.18, driveRange: 0.32, pre: 2.2, bassOffset: 0, midOffset: 2.5, trebleOffset: -1, cabinet: 5200, cabResonance: 120, level: 0.8 },
  Crunch: { curve: 'tube', drive: 0.3, driveRange: 0.4, pre: 3.4, bassOffset: 1, midOffset: 3, trebleOffset: 0, cabinet: 5000, cabResonance: 120, level: 0.65 },
  Rock: { curve: 'hard', drive: 0.42, driveRange: 0.45, pre: 5, bassOffset: 2, midOffset: 1, trebleOffset: 1, cabinet: 4800, cabResonance: 110, level: 0.5 },
  Lead: { curve: 'tube', drive: 0.55, driveRange: 0.45, pre: 7, bassOffset: 0, midOffset: 4, trebleOffset: 0, cabinet: 4600, cabResonance: 130, level: 0.42 },
  Metal: { curve: 'hard', drive: 0.7, driveRange: 0.3, pre: 10, bassOffset: 4, midOffset: -5, trebleOffset: 3, cabinet: 5200, cabResonance: 95, level: 0.36 },
  Ambient: { curve: 'soft', drive: 0.03, driveRange: 0.1, pre: 1, bassOffset: -1, midOffset: -2, trebleOffset: -2, cabinet: 5000, cabResonance: 100, level: 0.9 },
}

/**
 * Amp head + cabinet:  pre-gain -> tight highpass -> waveshaper -> tone stack
 * (bass/mid/treble) -> presence -> cabinet (resonance + lowpass) -> master.
 */
export class AmpEngine {
  readonly input: GainNode
  readonly output: GainNode
  private ctx: AudioContext
  private pre: GainNode
  private tight: BiquadFilterNode
  private shaper: WaveShaperNode
  private post: GainNode
  private dcBlock: BiquadFilterNode
  private bass: BiquadFilterNode
  private mid: BiquadFilterNode
  private treble: BiquadFilterNode
  private presence: BiquadFilterNode
  private cabRes: BiquadFilterNode
  private cabLow: BiquadFilterNode
  private master: GainNode
  private params: AmpParams
  private curveKey = ''

  constructor(ctx: AudioContext, initial: AmpParams) {
    this.ctx = ctx
    this.params = { ...initial }
    this.input = ctx.createGain()
    this.pre = ctx.createGain()
    this.tight = ctx.createBiquadFilter()
    this.tight.type = 'highpass'
    this.tight.frequency.value = 70
    this.shaper = ctx.createWaveShaper()
    this.shaper.oversample = '2x'
    this.post = ctx.createGain()
    this.dcBlock = ctx.createBiquadFilter()
    this.dcBlock.type = 'highpass'
    this.dcBlock.frequency.value = 25
    this.dcBlock.Q.value = 0.5
    this.bass = ctx.createBiquadFilter()
    this.bass.type = 'lowshelf'
    this.bass.frequency.value = 180
    this.mid = ctx.createBiquadFilter()
    this.mid.type = 'peaking'
    this.mid.frequency.value = 750
    this.mid.Q.value = 0.9
    this.treble = ctx.createBiquadFilter()
    this.treble.type = 'highshelf'
    this.treble.frequency.value = 2800
    this.presence = ctx.createBiquadFilter()
    this.presence.type = 'peaking'
    this.presence.frequency.value = 4200
    this.presence.Q.value = 1
    this.cabRes = ctx.createBiquadFilter()
    this.cabRes.type = 'peaking'
    this.cabRes.frequency.value = 110
    this.cabRes.Q.value = 1.2
    this.cabRes.gain.value = 2.5
    this.cabLow = ctx.createBiquadFilter()
    this.cabLow.type = 'lowpass'
    this.cabLow.frequency.value = 5000
    this.cabLow.Q.value = 0.9
    this.master = ctx.createGain()
    this.output = ctx.createGain()

    this.input.connect(this.pre)
    this.pre.connect(this.tight)
    this.tight.connect(this.shaper)
    this.shaper.connect(this.dcBlock)
    this.dcBlock.connect(this.post)
    this.post.connect(this.bass)
    this.bass.connect(this.mid)
    this.mid.connect(this.treble)
    this.treble.connect(this.presence)
    this.presence.connect(this.cabRes)
    this.cabRes.connect(this.cabLow)
    this.cabLow.connect(this.master)
    this.master.connect(this.output)
    this.apply(this.params)
  }

  get current(): AmpParams {
    return { ...this.params }
  }

  apply(p: AmpParams): void {
    this.params = { ...p }
    const spec = MODELS[p.model]
    const t = this.ctx.currentTime
    const k = 0.02
    const g = p.gain / 10
    const drive = Math.min(1, spec.drive + spec.driveRange * g)
    // Only swap the transfer curve when model or drive actually changed
    // (every knob routes through apply); resolution 0.01.
    const curveKey = `${spec.curve}:${drive.toFixed(2)}`
    if (curveKey !== this.curveKey) {
      this.curveKey = curveKey
      this.shaper.curve = makeCurve(spec.curve, Number(drive.toFixed(2)))
    }
    this.pre.gain.setTargetAtTime(spec.pre * (0.25 + g * 1.75), t, k)
    this.tight.frequency.setTargetAtTime(drive > 0.5 ? 110 : 70, t, k)
    // Loud curves compress the signal; trim so master stays comparable
    this.post.gain.setTargetAtTime(spec.level / (0.6 + drive * 0.9), t, k)
    this.bass.gain.setTargetAtTime((p.bass - 5) * 2.4 + spec.bassOffset, t, k)
    this.mid.gain.setTargetAtTime((p.mid - 5) * 2.4 + spec.midOffset, t, k)
    this.treble.gain.setTargetAtTime((p.treble - 5) * 2.4 + spec.trebleOffset, t, k)
    this.presence.gain.setTargetAtTime((p.presence - 5) * 1.8, t, k)
    this.cabLow.frequency.setTargetAtTime(spec.cabinet + (p.presence - 5) * 250, t, k)
    this.cabRes.frequency.setTargetAtTime(spec.cabResonance, t, k)
    this.master.gain.setTargetAtTime(Math.pow(p.master / 10, 1.6) * 1.4, t, k)
  }

  setParam<K extends keyof AmpParams>(key: K, value: AmpParams[K]): void {
    this.apply({ ...this.params, [key]: value })
  }
}
