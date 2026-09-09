export interface ScaleDef {
  id: string
  name: string
  intervals: number[]
}

export const SCALES: ScaleDef[] = [
  { id: 'major', name: 'Major', intervals: [0, 2, 4, 5, 7, 9, 11] },
  { id: 'minor', name: 'Natural Minor', intervals: [0, 2, 3, 5, 7, 8, 10] },
  { id: 'pentMinor', name: 'Minor Pentatonic', intervals: [0, 3, 5, 7, 10] },
  { id: 'pentMajor', name: 'Major Pentatonic', intervals: [0, 2, 4, 7, 9] },
  { id: 'blues', name: 'Blues', intervals: [0, 3, 5, 6, 7, 10] },
  { id: 'dorian', name: 'Dorian', intervals: [0, 2, 3, 5, 7, 9, 10] },
  { id: 'mixolydian', name: 'Mixolydian', intervals: [0, 2, 4, 5, 7, 9, 10] },
]

export function scalePitchClasses(root: number, scale: ScaleDef): Set<number> {
  return new Set(scale.intervals.map((i) => (root + i) % 12))
}
