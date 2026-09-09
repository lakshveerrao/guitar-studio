import type { ChordDef } from '../types'
import { fretMidi } from './tuning'
import { midiToName, pitchClass } from './notes'

const c = (id: string, name: string, frets: number[], group: ChordDef['group'], fingers?: number[]): ChordDef => ({
  id,
  name,
  frets,
  group,
  fingers,
})

export const CHORDS: ChordDef[] = [
  // open chords
  c('E', 'E', [0, 2, 2, 1, 0, 0], 'open', [0, 2, 3, 1, 0, 0]),
  c('Em', 'Em', [0, 2, 2, 0, 0, 0], 'open', [0, 2, 3, 0, 0, 0]),
  c('A', 'A', [-1, 0, 2, 2, 2, 0], 'open', [0, 0, 1, 2, 3, 0]),
  c('Am', 'Am', [-1, 0, 2, 2, 1, 0], 'open', [0, 0, 2, 3, 1, 0]),
  c('D', 'D', [-1, -1, 0, 2, 3, 2], 'open', [0, 0, 0, 1, 3, 2]),
  c('Dm', 'Dm', [-1, -1, 0, 2, 3, 1], 'open', [0, 0, 0, 2, 3, 1]),
  c('G', 'G', [3, 2, 0, 0, 0, 3], 'open', [2, 1, 0, 0, 0, 3]),
  c('C', 'C', [-1, 3, 2, 0, 1, 0], 'open', [0, 3, 2, 0, 1, 0]),
  // sevenths
  c('E7', 'E7', [0, 2, 0, 1, 0, 0], 'seventh', [0, 2, 0, 1, 0, 0]),
  c('A7', 'A7', [-1, 0, 2, 0, 2, 0], 'seventh', [0, 0, 2, 0, 3, 0]),
  c('D7', 'D7', [-1, -1, 0, 2, 1, 2], 'seventh', [0, 0, 0, 2, 1, 3]),
  c('G7', 'G7', [3, 2, 0, 0, 0, 1], 'seventh', [3, 2, 0, 0, 0, 1]),
  c('C7', 'C7', [-1, 3, 2, 3, 1, 0], 'seventh', [0, 3, 2, 4, 1, 0]),
  c('B7', 'B7', [-1, 2, 1, 2, 0, 2], 'seventh', [0, 2, 1, 3, 0, 4]),
  // barre
  c('F', 'F', [1, 3, 3, 2, 1, 1], 'barre', [1, 3, 4, 2, 1, 1]),
  c('Bm', 'Bm', [-1, 2, 4, 4, 3, 2], 'barre', [0, 1, 3, 4, 2, 1]),
  c('Fm', 'Fm', [1, 3, 3, 1, 1, 1], 'barre', [1, 3, 4, 1, 1, 1]),
  c('Bb', 'Bb', [-1, 1, 3, 3, 3, 1], 'barre', [0, 1, 2, 3, 4, 1]),
  // power chords
  c('E5', 'E5', [0, 2, 2, -1, -1, -1], 'power', [0, 1, 2, 0, 0, 0]),
  c('A5', 'A5', [-1, 0, 2, 2, -1, -1], 'power', [0, 0, 1, 2, 0, 0]),
  c('D5', 'D5', [-1, -1, 0, 2, 3, -1], 'power', [0, 0, 0, 1, 2, 0]),
  c('G5', 'G5', [3, 5, 5, -1, -1, -1], 'power', [1, 3, 4, 0, 0, 0]),
  c('C5', 'C5', [-1, 3, 5, 5, -1, -1], 'power', [0, 1, 3, 4, 0, 0]),
  c('F5', 'F5', [1, 3, 3, -1, -1, -1], 'power', [1, 3, 4, 0, 0, 0]),
  c('B5', 'B5', [-1, 2, 4, 4, -1, -1], 'power', [0, 1, 3, 4, 0, 0]),
  // major 7
  c('Cmaj7', 'Cmaj7', [-1, 3, 2, 0, 0, 0], 'maj7', [0, 3, 2, 0, 0, 0]),
  c('Dmaj7', 'Dmaj7', [-1, -1, 0, 2, 2, 2], 'maj7', [0, 0, 0, 1, 1, 1]),
  c('Emaj7', 'Emaj7', [0, 2, 1, 1, 0, 0], 'maj7', [0, 3, 1, 2, 0, 0]),
  c('Fmaj7', 'Fmaj7', [-1, -1, 3, 2, 1, 0], 'maj7', [0, 0, 3, 2, 1, 0]),
  c('Gmaj7', 'Gmaj7', [3, 2, 0, 0, 0, 2], 'maj7', [3, 2, 0, 0, 0, 1]),
  c('Amaj7', 'Amaj7', [-1, 0, 2, 1, 2, 0], 'maj7', [0, 0, 2, 1, 3, 0]),
  // minor 7
  c('Am7', 'Am7', [-1, 0, 2, 0, 1, 0], 'min7', [0, 0, 2, 0, 1, 0]),
  c('Em7', 'Em7', [0, 2, 0, 0, 0, 0], 'min7', [0, 2, 0, 0, 0, 0]),
  c('Dm7', 'Dm7', [-1, -1, 0, 2, 1, 1], 'min7', [0, 0, 0, 2, 1, 1]),
  c('Bm7', 'Bm7', [-1, 2, 0, 2, 0, 2], 'min7', [0, 1, 0, 2, 0, 3]),
  c('Gm7', 'Gm7', [3, 5, 3, 3, 3, 3], 'min7', [1, 3, 1, 1, 1, 1]),
  // sus2
  c('Asus2', 'Asus2', [-1, 0, 2, 2, 0, 0], 'sus2', [0, 0, 1, 2, 0, 0]),
  c('Dsus2', 'Dsus2', [-1, -1, 0, 2, 3, 0], 'sus2', [0, 0, 0, 1, 2, 0]),
  c('Esus2', 'Esus2', [0, 2, 4, 4, 0, 0], 'sus2', [0, 1, 3, 4, 0, 0]),
  c('Csus2', 'Csus2', [-1, 3, 0, 0, 1, 3], 'sus2', [0, 2, 0, 0, 1, 3]),
  // sus4
  c('Asus4', 'Asus4', [-1, 0, 2, 2, 3, 0], 'sus4', [0, 0, 1, 2, 3, 0]),
  c('Dsus4', 'Dsus4', [-1, -1, 0, 2, 3, 3], 'sus4', [0, 0, 0, 1, 2, 3]),
  c('Esus4', 'Esus4', [0, 2, 2, 2, 0, 0], 'sus4', [0, 1, 2, 3, 0, 0]),
  c('Gsus4', 'Gsus4', [3, 3, 0, 0, 1, 3], 'sus4', [2, 3, 0, 0, 1, 4]),
]

export const CHORD_GROUPS: { id: ChordDef['group']; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'seventh', label: '7th' },
  { id: 'barre', label: 'Barre' },
  { id: 'power', label: 'Power' },
  { id: 'maj7', label: 'Maj7' },
  { id: 'min7', label: 'Min7' },
  { id: 'sus2', label: 'Sus2' },
  { id: 'sus4', label: 'Sus4' },
]

export function chordById(id: string): ChordDef | undefined {
  return CHORDS.find((x) => x.id === id)
}

/** Unique pitch classes in the chord, ordered from the lowest sounding string. */
export function chordNoteNames(frets: number[], flats = false): string[] {
  const seen = new Set<number>()
  const out: string[] = []
  frets.forEach((f, s) => {
    if (f < 0) return
    const m = fretMidi(s, f)
    const pc = pitchClass(m)
    if (!seen.has(pc)) {
      seen.add(pc)
      out.push(midiToName(m, flats))
    }
  })
  return out
}
