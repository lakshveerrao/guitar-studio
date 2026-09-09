import type { StringIndex } from '../types'

export interface RiffStep {
  string: StringIndex
  fret: number
  beat: number // position in beats from start (0-based)
}

export interface RiffDef {
  id: string
  name: string
  description: string
  bpm: number
  lengthBeats: number
  steps: RiffStep[]
}

/* All riffs below are original practice patterns. */
export const RIFFS: RiffDef[] = [
  {
    id: 'basic-rock',
    name: 'Basic Rock',
    description: 'Open low E with movement on the A string. Straight eighth feel.',
    bpm: 100,
    lengthBeats: 8,
    steps: [
      { string: 0, fret: 0, beat: 0 },
      { string: 0, fret: 0, beat: 1 },
      { string: 1, fret: 2, beat: 2 },
      { string: 1, fret: 2, beat: 3 },
      { string: 0, fret: 0, beat: 4 },
      { string: 0, fret: 0, beat: 5 },
      { string: 1, fret: 4, beat: 6 },
      { string: 1, fret: 2, beat: 7 },
    ],
  },
  {
    id: 'blues-walk',
    name: 'Blues Walk',
    description: 'Walking line on the A and D strings in the key of A.',
    bpm: 96,
    lengthBeats: 8,
    steps: [
      { string: 1, fret: 0, beat: 0 },
      { string: 1, fret: 4, beat: 1 },
      { string: 2, fret: 2, beat: 2 },
      { string: 2, fret: 4, beat: 3 },
      { string: 2, fret: 5, beat: 4 },
      { string: 2, fret: 4, beat: 5 },
      { string: 2, fret: 2, beat: 6 },
      { string: 1, fret: 4, beat: 7 },
    ],
  },
  {
    id: 'power-run',
    name: 'Power Chord Run',
    description: 'Root and fifth movement for E5, G5, A5 and C5 on the low strings.',
    bpm: 110,
    lengthBeats: 8,
    steps: [
      { string: 0, fret: 0, beat: 0 },
      { string: 1, fret: 2, beat: 0.5 },
      { string: 0, fret: 3, beat: 2 },
      { string: 1, fret: 5, beat: 2.5 },
      { string: 1, fret: 0, beat: 4 },
      { string: 2, fret: 2, beat: 4.5 },
      { string: 1, fret: 3, beat: 6 },
      { string: 2, fret: 5, beat: 6.5 },
    ],
  },
  {
    id: 'pentatonic',
    name: 'Pentatonic Exercise',
    description: 'A minor pentatonic, first position, ascending then descending.',
    bpm: 90,
    lengthBeats: 16,
    steps: [
      { string: 0, fret: 5, beat: 0 },
      { string: 0, fret: 8, beat: 1 },
      { string: 1, fret: 5, beat: 2 },
      { string: 1, fret: 7, beat: 3 },
      { string: 2, fret: 5, beat: 4 },
      { string: 2, fret: 7, beat: 5 },
      { string: 3, fret: 5, beat: 6 },
      { string: 3, fret: 7, beat: 7 },
      { string: 4, fret: 5, beat: 8 },
      { string: 4, fret: 8, beat: 9 },
      { string: 5, fret: 5, beat: 10 },
      { string: 5, fret: 8, beat: 11 },
      { string: 5, fret: 5, beat: 12 },
      { string: 4, fret: 8, beat: 13 },
      { string: 4, fret: 5, beat: 14 },
      { string: 3, fret: 7, beat: 15 },
    ],
  },
  {
    id: 'chromatic',
    name: 'Chromatic Warm-Up',
    description: 'Four-finger chromatic pattern across the top three strings.',
    bpm: 80,
    lengthBeats: 12,
    steps: [
      { string: 3, fret: 1, beat: 0 },
      { string: 3, fret: 2, beat: 1 },
      { string: 3, fret: 3, beat: 2 },
      { string: 3, fret: 4, beat: 3 },
      { string: 4, fret: 1, beat: 4 },
      { string: 4, fret: 2, beat: 5 },
      { string: 4, fret: 3, beat: 6 },
      { string: 4, fret: 4, beat: 7 },
      { string: 5, fret: 1, beat: 8 },
      { string: 5, fret: 2, beat: 9 },
      { string: 5, fret: 3, beat: 10 },
      { string: 5, fret: 4, beat: 11 },
    ],
  },
]
