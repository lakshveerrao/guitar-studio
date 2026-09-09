import type { EffectsParams } from '../types'
import { makeCurve, makeImpulseResponse } from './dsp'

/**
 * A pedal with true bypass switching. Subclasses wire `wetIn -> ... -> wetOut`.
 */
abstract class Pedal {
  readonly input: GainNode
  readonly output: GainNode
  protected wetIn: GainNode
  protected wetOut: GainNode
  protected ctx: AudioContext
  private enabled = false

  constructor(ctx: AudioContext) {
    this.ctx = ctx
    this.input = ctx.createGain()
    this.output = ctx.createGain()
    this.wetIn = ctx.createGain()
    this.wetOut = ctx.createGain()
    this.input.connect(this.output) // bypass by default; wetOut is attached on enable
  }

  setEnabled(on: boolean): void {
    if (on === this.enabled) return
    this.enabled = on
    if (on) {
      try {
        this.input.disconnect(this.output)
      } catch {
        /* not connected */
      }
      this.input.connect(this.wetIn)
      this.wetOut.connect(this.output)
    } else {
      try {
        this.input.disconnect(this.wetIn)
      } catch {
        /* not connected */
      }
      try {
        this.wetOut.disconnect(this.output)
      } catch {
        /* not connected */
      }
      this.input.connect(this.output)
    }
  }

  get isEnabled(): boolean {
    return this.enabled
  }
}

class CompressorPedal extends Pedal {
  private comp: DynamicsCompressorNode
  private makeup: GainNode
  constructor(ctx: AudioContext) {
    super(ctx)
    this.comp = ctx.createDynamicsCompressor()
    this.comp.attack.value = 0.004
    this.comp.release.value = 0.18
    this.comp.knee.value = 12
    this.makeup = ctx.createGain()
    this.wetIn.connect(this.comp)
    this.comp.connect(this.makeup)
    this.makeup.connect(this.wetOut)
  }
  set(p: EffectsParams['compressor']) {
    const t = this.ctx.currentTime
    this.comp.threshold.setTargetAtTime(p.threshold, t, 0.02)
    this.comp.ratio.setTargetAtTime(p.ratio, t, 0.02)
    this.makeup.gain.setTargetAtTime(Math.pow(10, p.makeup / 20), t, 0.02)
  }
}

class DrivePedal extends Pedal {
  private pre: GainNode
  private shaper: WaveShaperNode
  private tone: BiquadFilterNode
  private level: GainNode
  private kind: 'soft' | 'hard'
  constructor(ctx: AudioContext, kind: 'soft' | 'hard') {
    super(ctx)
    this.kind = kind
    this.pre = ctx.createGain()
    this.shaper = ctx.createWaveShaper()
    this.shaper.oversample = '4x'
    this.tone = ctx.createBiquadFilter()
    this.tone.type = 'lowpass'
    this.tone.Q.value = 0.6
    this.level = ctx.createGain()
    this.wetIn.connect(this.pre)
    this.pre.connect(this.shaper)
    this.shaper.connect(this.tone)
    this.tone.connect(this.level)
    this.level.connect(this.wetOut)
  }
  set(p: { drive: number; tone: number; level: number }) {
    const t = this.ctx.currentTime
    const d = p.drive / 10
    this.shaper.curve = makeCurve(this.kind === 'soft' ? 'tube' : 'fuzz', 0.15 + d * 0.85)
    this.pre.gain.setTargetAtTime(1 + d * (this.kind === 'soft' ? 6 : 14), t, 0.02)
    this.tone.frequency.setTargetAtTime(700 * Math.pow(10, p.tone / 10), t, 0.02) // 700 Hz .. 7 kHz
    const comp = 1 / (1 + d * (this.kind === 'soft' ? 1.2 : 2.2))
    this.level.gain.setTargetAtTime((p.level / 10) * 1.3 * comp, t, 0.02)
  }
}

class ChorusPedal extends Pedal {
  private delayL: DelayNode
  private delayR: DelayNode
  private lfo: OscillatorNode
  private lfoGainL: GainNode
  private lfoGainR: GainNode
  private wet: GainNode
  private dry: GainNode
  private merger: ChannelMergerNode
  constructor(ctx: AudioContext) {
    super(ctx)
    this.delayL = ctx.createDelay(0.1)
    this.delayR = ctx.createDelay(0.1)
    this.delayL.delayTime.value = 0.018
    this.delayR.delayTime.value = 0.024
    this.lfo = ctx.createOscillator()
    this.lfo.type = 'sine'
    this.lfo.frequency.value = 0.8
    this.lfoGainL = ctx.createGain()
    this.lfoGainR = ctx.createGain()
    this.lfoGainR.gain.value = -0.003
    this.lfo.connect(this.lfoGainL)
    this.lfo.connect(this.lfoGainR)
    this.lfoGainL.connect(this.delayL.delayTime)
    this.lfoGainR.connect(this.delayR.delayTime)
    this.lfo.start()
    this.merger = ctx.createChannelMerger(2)
    this.wet = ctx.createGain()
    this.dry = ctx.createGain()
    this.wetIn.connect(this.delayL)
    this.wetIn.connect(this.delayR)
    this.delayL.connect(this.merger, 0, 0)
    this.delayR.connect(this.merger, 0, 1)
    this.merger.connect(this.wet)
    this.wetIn.connect(this.dry)
    this.wet.connect(this.wetOut)
    this.dry.connect(this.wetOut)
  }
  set(p: EffectsParams['chorus']) {
    const t = this.ctx.currentTime
    this.lfo.frequency.setTargetAtTime(0.2 + (p.rate / 10) * 4.8, t, 0.05)
    const depth = (p.depth / 10) * 0.006
    this.lfoGainL.gain.setTargetAtTime(depth, t, 0.05)
    this.lfoGainR.gain.setTargetAtTime(-depth * 0.8, t, 0.05)
    const mix = p.mix / 10
    this.wet.gain.setTargetAtTime(mix, t, 0.02)
    this.dry.gain.setTargetAtTime(1 - mix * 0.5, t, 0.02)
  }
}

class DelayPedal extends Pedal {
  private delay: DelayNode
  private feedback: GainNode
  private damp: BiquadFilterNode
  private wet: GainNode
  private dry: GainNode
  constructor(ctx: AudioContext) {
    super(ctx)
    this.delay = ctx.createDelay(2)
    this.feedback = ctx.createGain()
    this.damp = ctx.createBiquadFilter()
    this.damp.type = 'lowpass'
    this.damp.frequency.value = 3200
    this.wet = ctx.createGain()
    this.dry = ctx.createGain()
    this.wetIn.connect(this.dry)
    this.wetIn.connect(this.delay)
    this.delay.connect(this.damp)
    this.damp.connect(this.feedback)
    this.feedback.connect(this.delay)
    this.damp.connect(this.wet)
    this.wet.connect(this.wetOut)
    this.dry.connect(this.wetOut)
  }
  set(p: EffectsParams['delay']) {
    const t = this.ctx.currentTime
    this.delay.delayTime.setTargetAtTime(Math.max(0.02, Math.min(1.5, p.time / 1000)), t, 0.05)
    this.feedback.gain.setTargetAtTime(Math.min(0.9, p.feedback / 10) * 0.85, t, 0.02)
    this.wet.gain.setTargetAtTime(p.mix / 10, t, 0.02)
  }
}

class ReverbPedal extends Pedal {
  private convolver: ConvolverNode
  private wet: GainNode
  private dry: GainNode
  private lastRoom = -1
  constructor(ctx: AudioContext) {
    super(ctx)
    this.convolver = ctx.createConvolver()
    this.wet = ctx.createGain()
    this.dry = ctx.createGain()
    this.wetIn.connect(this.dry)
    this.wetIn.connect(this.convolver)
    this.convolver.connect(this.wet)
    this.wet.connect(this.wetOut)
    this.dry.connect(this.wetOut)
  }
  set(p: EffectsParams['reverb']) {
    const t = this.ctx.currentTime
    const room = Math.round(p.room)
    if (room !== this.lastRoom) {
      this.lastRoom = room
      const seconds = 0.4 + (room / 10) * 3.6
      const decay = 4.5 - (room / 10) * 2.5
      this.convolver.buffer = makeImpulseResponse(this.ctx, seconds, decay)
    }
    this.wet.gain.setTargetAtTime((p.mix / 10) * 0.9, t, 0.02)
  }
}

/**
 * The pedalboard. Order:
 *   compressor -> overdrive -> distortion -> [amp is inserted here by the
 *   graph owner] -> chorus -> delay -> reverb
 */
export class EffectsChain {
  readonly compressor: CompressorPedal
  readonly overdrive: DrivePedal
  readonly distortion: DrivePedal
  readonly chorus: ChorusPedal
  readonly delay: DelayPedal
  readonly reverb: ReverbPedal
  /** pre-amp section */
  readonly preInput: GainNode
  readonly preOutput: GainNode
  /** post-amp section */
  readonly postInput: GainNode
  readonly postOutput: GainNode
  private params: EffectsParams

  constructor(ctx: AudioContext, initial: EffectsParams) {
    this.params = structuredClone(initial)
    this.compressor = new CompressorPedal(ctx)
    this.overdrive = new DrivePedal(ctx, 'soft')
    this.distortion = new DrivePedal(ctx, 'hard')
    this.chorus = new ChorusPedal(ctx)
    this.delay = new DelayPedal(ctx)
    this.reverb = new ReverbPedal(ctx)

    this.preInput = ctx.createGain()
    this.preOutput = ctx.createGain()
    this.postInput = ctx.createGain()
    this.postOutput = ctx.createGain()

    this.preInput.connect(this.compressor.input)
    this.compressor.output.connect(this.overdrive.input)
    this.overdrive.output.connect(this.distortion.input)
    this.distortion.output.connect(this.preOutput)

    this.postInput.connect(this.chorus.input)
    this.chorus.output.connect(this.delay.input)
    this.delay.output.connect(this.reverb.input)
    this.reverb.output.connect(this.postOutput)

    this.apply(initial)
  }

  get current(): EffectsParams {
    return structuredClone(this.params)
  }

  apply(p: EffectsParams): void {
    this.params = structuredClone(p)
    this.compressor.set(p.compressor)
    this.compressor.setEnabled(p.compressor.on)
    this.overdrive.set(p.overdrive)
    this.overdrive.setEnabled(p.overdrive.on)
    this.distortion.set(p.distortion)
    this.distortion.setEnabled(p.distortion.on)
    this.chorus.set(p.chorus)
    this.chorus.setEnabled(p.chorus.on)
    this.delay.set(p.delay)
    this.delay.setEnabled(p.delay.on)
    this.reverb.set(p.reverb)
    this.reverb.setEnabled(p.reverb.on)
  }
}
