import { midiToFreq, midiToName, midiToNameWithOctave } from './notes'

/** Standard tuning, index 0 = 6th string (low E) ... index 5 = 1st string (high E) */
export const STANDARD_TUNING_MIDI = [40, 45, 50, 55, 59, 64] as const // E2 A2 D3 G3 B3 E4
export const STRING_LABELS = ['E', 'A', 'D', 'G', 'B', 'e'] as const
export const STRING_NAMES_FULL = ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'] as const
export const NUM_STRINGS = 6
export const NUM_FRETS = 22
export const MAX_BEND = 2

export function openFrequency(string: number): number {
  return midiToFreq(STANDARD_TUNING_MIDI[string])
}

/** frequency = openFrequency * 2^(fret/12); bend in semitones */
export function fretFrequency(string: number, fret: number, bend = 0): number {
  return openFrequency(string) * Math.pow(2, (fret + bend) / 12)
}

export function fretMidi(string: number, fret: number): number {
  return STANDARD_TUNING_MIDI[string] + fret
}

export function fretNoteName(string: number, fret: number, flats = false): string {
  return midiToName(fretMidi(string, fret), flats)
}

export function fretNoteNameOctave(string: number, fret: number, flats = false): string {
  return midiToNameWithOctave(fretMidi(string, fret), flats)
}

/** String gauge in inches (10-46 set), used for physical-model brightness/decay */
export const STRING_GAUGES = [0.046, 0.036, 0.026, 0.017, 0.013, 0.01] as const
export const STRING_WOUND = [true, true, true, false, false, false] as const
