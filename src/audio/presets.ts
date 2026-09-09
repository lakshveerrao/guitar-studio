import type { AmpParams, EffectsParams, Preset } from '../types'

export const DEFAULT_EFFECTS: EffectsParams = {
  compressor: { on: false, threshold: -24, ratio: 4, makeup: 3 },
  overdrive: { on: false, drive: 4, tone: 6, level: 7 },
  distortion: { on: false, drive: 5, tone: 5, level: 6 },
  chorus: { on: false, rate: 3, depth: 4, mix: 5 },
  delay: { on: false, time: 380, feedback: 3.5, mix: 3 },
  reverb: { on: false, room: 4, mix: 3 },
}

export const DEFAULT_AMP: AmpParams = {
  model: 'Clean',
  gain: 3,
  bass: 5,
  mid: 5,
  treble: 6,
  presence: 5,
  master: 7,
  sustain: 5,
}

const fx = (over: Partial<{ [K in keyof EffectsParams]: Partial<EffectsParams[K]> }>): EffectsParams => {
  const out = structuredClone(DEFAULT_EFFECTS)
  for (const k of Object.keys(over) as (keyof EffectsParams)[]) {
    Object.assign(out[k], over[k])
  }
  return out
}

export const PRESETS: Preset[] = [
  {
    id: 'crystal-clean',
    name: 'Crystal Clean',
    amp: { model: 'Clean', gain: 2.5, bass: 5, mid: 4.5, treble: 6.5, presence: 6, master: 7, sustain: 5 },
    effects: fx({ compressor: { on: true, threshold: -22, ratio: 3, makeup: 3 }, reverb: { on: true, room: 3, mix: 2.5 } }),
  },
  {
    id: 'warm-jazz',
    name: 'Warm Jazz',
    amp: { model: 'Warm', gain: 3, bass: 6, mid: 5.5, treble: 3.5, presence: 3, master: 7, sustain: 5.5 },
    effects: fx({ compressor: { on: true, threshold: -26, ratio: 3, makeup: 4 }, reverb: { on: true, room: 4, mix: 2.5 } }),
  },
  {
    id: 'texas-blues',
    name: 'Texas Blues',
    amp: { model: 'Blues', gain: 6, bass: 5.5, mid: 6.5, treble: 5.5, presence: 5.5, master: 7, sustain: 6 },
    effects: fx({ overdrive: { on: true, drive: 3.5, tone: 6, level: 7 }, reverb: { on: true, room: 3.5, mix: 2.5 } }),
  },
  {
    id: 'classic-crunch',
    name: 'Classic Crunch',
    amp: { model: 'Crunch', gain: 6.5, bass: 5.5, mid: 6, treble: 6, presence: 5.5, master: 6.5, sustain: 6 },
    effects: fx({ reverb: { on: true, room: 3, mix: 2 } }),
  },
  {
    id: 'arena-rock',
    name: 'Arena Rock',
    amp: { model: 'Rock', gain: 7, bass: 6, mid: 5, treble: 6.5, presence: 6.5, master: 6.5, sustain: 7 },
    effects: fx({ overdrive: { on: true, drive: 4, tone: 6, level: 6.5 }, delay: { on: true, time: 420, feedback: 3, mix: 2.5 }, reverb: { on: true, room: 6, mix: 3 } }),
  },
  {
    id: 'modern-lead',
    name: 'Modern Lead',
    amp: { model: 'Lead', gain: 8, bass: 5, mid: 7, treble: 6, presence: 6, master: 6, sustain: 8.5 },
    effects: fx({ compressor: { on: true, threshold: -20, ratio: 4, makeup: 3 }, overdrive: { on: true, drive: 5, tone: 6.5, level: 6.5 }, delay: { on: true, time: 500, feedback: 4, mix: 3 }, reverb: { on: true, room: 5, mix: 3 } }),
  },
  {
    id: 'heavy',
    name: 'Heavy',
    amp: { model: 'Metal', gain: 8.5, bass: 7, mid: 3.5, treble: 7, presence: 6.5, master: 6, sustain: 8 },
    effects: fx({ distortion: { on: true, drive: 6.5, tone: 5.5, level: 6 }, reverb: { on: true, room: 2, mix: 1.5 } }),
  },
  {
    id: 'dreamy-ambient',
    name: 'Dreamy Ambient',
    amp: { model: 'Ambient', gain: 2, bass: 4.5, mid: 4, treble: 5.5, presence: 4.5, master: 7, sustain: 9 },
    effects: fx({ compressor: { on: true, threshold: -28, ratio: 3, makeup: 4 }, chorus: { on: true, rate: 2.5, depth: 5, mix: 6 }, delay: { on: true, time: 620, feedback: 6, mix: 5 }, reverb: { on: true, room: 9, mix: 6.5 } }),
  },
]
