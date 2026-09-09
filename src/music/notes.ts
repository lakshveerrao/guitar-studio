export const NOTE_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const
export const NOTE_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const

/** MIDI note number -> frequency (A4 = 440) */
export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

export function freqToMidi(freq: number): number {
  return 69 + 12 * Math.log2(freq / 440)
}

export function midiToName(midi: number, flats = false): string {
  const names = flats ? NOTE_NAMES_FLAT : NOTE_NAMES_SHARP
  return names[((Math.round(midi) % 12) + 12) % 12]
}

export function midiToNameWithOctave(midi: number, flats = false): string {
  const m = Math.round(midi)
  return `${midiToName(m, flats)}${Math.floor(m / 12) - 1}`
}

export function pitchClass(midi: number): number {
  return ((Math.round(midi) % 12) + 12) % 12
}

/** cents difference between two frequencies */
export function centsBetween(freq: number, ref: number): number {
  return 1200 * Math.log2(freq / ref)
}
