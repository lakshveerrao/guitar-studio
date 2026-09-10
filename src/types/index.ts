export type StringIndex = 0 | 1 | 2 | 3 | 4 | 5 // 0 = low E (6th), 5 = high E (1st)

export type Technique = 'pick' | 'hammer' | 'pull' | 'strum'

export type StrumDirection = 'down' | 'up'

export interface NoteEvent {
  time: number // seconds on the audio clock
  string: StringIndex
  fret: number
  velocity: number
  technique: Technique
  bend: number
  palmMute: boolean
  chord?: string
  /** A dead thud on a muted string: not a musical note, ignored by the recorder and the trainer. */
  dead?: boolean
}

export interface StringState {
  fret: number // -1 = muted, 0 = open
  velocity: number
  ringing: boolean
  bend: number // semitones 0..2
  lastPlucked: number // audio time
}

export type Action =
  | { type: 'STRUM_DOWN'; strength?: number; speed?: number }
  | { type: 'STRUM_UP'; strength?: number; speed?: number }
  | { type: 'PICK_STRING'; string: StringIndex; velocity?: number }
  /**
   * Fret a string. `play` sounds it; with `legatoOnly` the note is only sounded as a
   * hammer-on / pull-off while the string still rings inside the legato window,
   * otherwise the fret changes silently (the strum hand sounds it).
   */
  | { type: 'FRET_NOTE'; string: StringIndex; fret: number; play?: boolean; velocity?: number; legatoOnly?: boolean }
  | { type: 'RELEASE_FRET'; string: StringIndex }
  | { type: 'PALM_MUTE'; on: boolean }
  | { type: 'BEND'; amount: number; string?: StringIndex }
  | { type: 'VIBRATO'; on: boolean; depth?: number }
  | { type: 'SELECT_CHORD'; index?: number; delta?: number; id?: string }
  | { type: 'MUTE_ALL' }
  | { type: 'TOGGLE_RECORD' }

export type InputSource = 'mouse' | 'touch' | 'keyboard' | 'gamepad' | 'motion' | 'playback' | 'trainer' | 'none'

export interface ChordDef {
  id: string
  name: string
  frets: number[] // index 0 = low E (6th) ... 5 = high E. -1 muted
  fingers?: number[] // 0 none
  group: 'open' | 'seventh' | 'power' | 'maj7' | 'min7' | 'sus2' | 'sus4' | 'barre'
}

export type AmpModel = 'Clean' | 'Warm' | 'Blues' | 'Crunch' | 'Rock' | 'Lead' | 'Metal' | 'Ambient'

export interface AmpParams {
  model: AmpModel
  gain: number // 0..10
  bass: number
  mid: number
  treble: number
  presence: number
  master: number
  sustain: number
}

export interface EffectsParams {
  compressor: { on: boolean; threshold: number; ratio: number; makeup: number }
  overdrive: { on: boolean; drive: number; tone: number; level: number }
  distortion: { on: boolean; drive: number; tone: number; level: number }
  chorus: { on: boolean; rate: number; depth: number; mix: number }
  delay: { on: boolean; time: number; feedback: number; mix: number }
  reverb: { on: boolean; room: number; mix: number }
}

export interface Preset {
  id: string
  name: string
  amp: AmpParams
  effects: EffectsParams
}

export type GamepadActionId =
  | 'STRUM_DOWN'
  | 'STRUM_UP'
  | 'PICK_1'
  | 'PICK_2'
  | 'PICK_3'
  | 'PICK_4'
  | 'PICK_5'
  | 'PICK_6'
  | 'NEXT_CHORD'
  | 'PREV_CHORD'
  | 'PALM_MUTE'
  | 'BEND'
  | 'VIBRATO'

export interface GamepadBinding {
  action: GamepadActionId
  kind: 'button' | 'axis'
  index: number
  direction?: 'positive' | 'negative' // for axes
  threshold?: number
}
