import { useSyncExternalStore } from 'react'
import type { AmpParams, EffectsParams, InputSource } from '../types'
import { DEFAULT_AMP, DEFAULT_EFFECTS } from '../audio/presets'
import type { PickupPosition } from '../audio/GuitarEngine'
import type { DrumStyle } from '../audio/DrumMachine'
import type { MotionDeviceStatus, MotionState } from '../input/AiroMoteInput'
import type { HidState } from '../input/HidInput'

export type PlayMode = 'chord' | 'fretboard'
export type Tab = 'play' | 'chords' | 'amp' | 'effects' | 'riffs' | 'looper' | 'controller'
export type RecorderState = 'idle' | 'recording' | 'playing'

export interface TrainerState {
  riffId: string
  running: boolean
  stepIndex: number
  correct: number
  missed: number
  bpm: number
  target: { string: number; fret: number } | null
  lastResult: 'hit' | 'miss' | null
}

export interface AppState {
  audioReady: boolean
  mode: PlayMode
  chordId: string | null
  frets: number[]
  ringing: boolean[]
  pluckStamp: number[] // performance.now() of last pluck per string, for animation
  selectedString: number
  palmMute: boolean
  bend: number
  bendString: number | null
  vibrato: boolean
  vibratoDepth: number // cents
  vibratoRate: number
  strumSpeed: number // 0..1
  strumStrength: number // 0..1
  showNotes: boolean
  flats: boolean
  amp: AmpParams
  effects: EffectsParams
  presetId: string | null
  guitarVolume: number // 0..10
  guitarTone: number // 0..10
  pickup: PickupPosition
  masterVolume: number // 0..1
  bpm: number
  metronomeOn: number // 0 = off, else 1
  beat: number
  beatStamp: number
  drumsRunning: boolean
  drumStyle: DrumStyle
  drumVolume: number
  recorder: RecorderState
  recorderLoop: boolean
  recordedEvents: number
  recordDuration: number
  playheadStamp: number
  trainer: TrainerState
  inputSource: InputSource
  lastNote: { string: number; fret: number } | null
  lastTechnique: string
  strumStamp: number
  strumDir: 'down' | 'up'
  crowdOn: boolean
  showPlayer: boolean
  showStage: boolean
  gamepadName: string | null
  motionState: MotionState
  motionName: string | null
  motionError: string | null
  motionSettingsVersion: number
  motionDevices: MotionDeviceStatus[]
  hidState: HidState
  hidName: string | null
  hidError: string | null
  tab: Tab
  helpOpen: boolean
  settingsOpen: boolean
}

const initial: AppState = {
  audioReady: false,
  mode: 'fretboard',
  chordId: null,
  frets: [0, 0, 0, 0, 0, 0],
  ringing: [false, false, false, false, false, false],
  pluckStamp: [0, 0, 0, 0, 0, 0],
  selectedString: 5,
  palmMute: false,
  bend: 0,
  bendString: null,
  vibrato: false,
  vibratoDepth: 25,
  vibratoRate: 5.5,
  strumSpeed: 0.6,
  strumStrength: 0.8,
  showNotes: false,
  flats: false,
  amp: DEFAULT_AMP,
  effects: DEFAULT_EFFECTS,
  presetId: null,
  guitarVolume: 10,
  guitarTone: 8,
  pickup: 'middle',
  masterVolume: 0.9,
  bpm: 110,
  metronomeOn: 0,
  beat: 0,
  beatStamp: 0,
  drumsRunning: false,
  drumStyle: 'Rock',
  drumVolume: 0.7,
  recorder: 'idle',
  recorderLoop: false,
  recordedEvents: 0,
  recordDuration: 0,
  playheadStamp: 0,
  trainer: {
    riffId: 'basic-rock',
    running: false,
    stepIndex: 0,
    correct: 0,
    missed: 0,
    bpm: 100,
    target: null,
    lastResult: null,
  },
  inputSource: 'none',
  lastNote: null,
  lastTechnique: '',
  strumStamp: 0,
  strumDir: 'down',
  crowdOn: false,
  showPlayer: true,
  showStage: true,
  gamepadName: null,
  motionState: 'disconnected',
  motionName: null,
  motionError: null,
  motionSettingsVersion: 0,
  motionDevices: [
    { state: 'disconnected', name: null, error: null, role: 'both', battery: null, protocol: null, lastRaw: null, packets: 0, lead: null },
    { state: 'disconnected', name: null, error: null, role: 'fret', battery: null, protocol: null, lastRaw: null, packets: 0, lead: null },
  ],
  hidState: 'disconnected',
  hidName: null,
  hidError: null,
  tab: 'play',
  helpOpen: false,
  settingsOpen: false,
}

let state: AppState = initial
const listeners = new Set<() => void>()

export const store = {
  get: () => state,
  set: (patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => {
    const p = typeof patch === 'function' ? patch(state) : patch
    state = { ...state, ...p }
    listeners.forEach((l) => l())
  },
  subscribe: (l: () => void) => {
    listeners.add(l)
    return () => listeners.delete(l)
  },
}

if (import.meta.env.DEV && typeof window !== 'undefined') (window as unknown as { __store: typeof store }).__store = store

export function useStore<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(state), () => selector(state))
}
