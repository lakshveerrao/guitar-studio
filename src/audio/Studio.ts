import { AudioSystem } from './AudioSystem'
import { GuitarEngine } from './GuitarEngine'
import { AmpEngine } from './AmpEngine'
import { EffectsChain } from './EffectsChain'
import { Metronome } from './Metronome'
import { DrumMachine } from './DrumMachine'
import { Applause } from './Applause'
import { Transport } from './Transport'
import { DEFAULT_AMP, DEFAULT_EFFECTS } from './presets'

/**
 * The complete signal graph, built once after the audio context is unlocked:
 *
 *   GuitarEngine -> [compressor -> overdrive -> distortion] -> AmpEngine
 *     -> [chorus -> delay -> reverb] -> master -> limiter -> analyser -> out
 *
 *   Metronome / DrumMachine -> master (they bypass the guitar chain, and
 *   share one Transport grid so click and beat stay aligned)
 */
export class Studio {
  readonly ctx: AudioContext
  readonly guitar: GuitarEngine
  readonly amp: AmpEngine
  readonly effects: EffectsChain
  readonly transport: Transport
  readonly metronome: Metronome
  readonly drums: DrumMachine
  readonly applause: Applause
  readonly analyser: AnalyserNode
  private master: GainNode
  private limiter: DynamicsCompressorNode

  constructor(ctx: AudioContext) {
    this.ctx = ctx
    this.master = ctx.createGain()
    this.master.gain.value = 0.9
    this.limiter = ctx.createDynamicsCompressor()
    this.limiter.threshold.value = -4
    this.limiter.knee.value = 4
    this.limiter.ratio.value = 12
    this.limiter.attack.value = 0.002
    this.limiter.release.value = 0.12
    this.analyser = ctx.createAnalyser()
    this.analyser.fftSize = 1024
    this.analyser.smoothingTimeConstant = 0.7

    this.guitar = new GuitarEngine(ctx)
    this.effects = new EffectsChain(ctx, DEFAULT_EFFECTS)
    this.amp = new AmpEngine(ctx, DEFAULT_AMP)

    this.guitar.output.connect(this.effects.preInput)
    this.effects.preOutput.connect(this.amp.input)
    this.amp.output.connect(this.effects.postInput)
    this.effects.postOutput.connect(this.master)
    this.master.connect(this.limiter)
    this.limiter.connect(this.analyser)
    this.analyser.connect(ctx.destination)

    this.transport = new Transport(ctx)
    this.metronome = new Metronome(ctx, this.master, this.transport)
    this.drums = new DrumMachine(ctx, this.master, this.transport)
    this.applause = new Applause(ctx, this.master)
  }

  setMasterVolume(v: number) {
    this.master.gain.setTargetAtTime(Math.min(1, Math.max(0, v)), this.ctx.currentTime, 0.02)
  }
}

let studio: Studio | null = null
const readyListeners = new Set<(s: Studio) => void>()

export function getStudio(): Studio | null {
  return studio
}

/** Unlock audio (call from a user gesture) and build the graph once. */
export async function ensureStudio(): Promise<Studio> {
  const ctx = await AudioSystem.unlock()
  if (!studio) {
    studio = new Studio(ctx)
    if (import.meta.env.DEV) (window as unknown as { __studio: Studio }).__studio = studio
    readyListeners.forEach((l) => l(studio!))
  }
  return studio
}

export function onStudioReady(fn: (s: Studio) => void): () => void {
  if (studio) fn(studio)
  readyListeners.add(fn)
  return () => readyListeners.delete(fn)
}
