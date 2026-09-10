import { describe, expect, it } from 'vitest'
import { PATTERNS, swingOffset } from './DrumMachine'

const hits = (row: string) => [...row].map((c, i) => (c !== '.' ? i : -1)).filter((i) => i >= 0)

describe('drum patterns', () => {
  it('every row is one 16-step bar', () => {
    for (const p of Object.values(PATTERNS)) {
      expect(p.kick).toHaveLength(16)
      expect(p.snare).toHaveLength(16)
      expect(p.hat).toHaveLength(16)
    }
  })

  it('Blues hat divides the bar evenly (straight eighths, shuffled by swing)', () => {
    expect(hits(PATTERNS.Blues.hat)).toEqual([0, 2, 4, 6, 8, 10, 12, 14])
    expect(PATTERNS.Blues.swingGrid).toBe(8)
  })

  it('eighth-note swing delays only the off-beat eighths (steps 2, 6, 10, 14)', () => {
    const p = { swing: 0.667, swingGrid: 8 as const }
    for (let s = 0; s < 16; s++) {
      expect(swingOffset(p, s, 1), `step ${s}`).toBe(s % 4 === 2 ? 0.667 : 0)
    }
    expect(swingOffset(p, 18, 0.1)).toBeCloseTo(0.0667, 9) // wraps per bar
  })

  it('sixteenth-note swing delays every odd sixteenth by half the amount', () => {
    const p = { swing: 0.15, swingGrid: 16 as const }
    for (let s = 0; s < 16; s++) {
      expect(swingOffset(p, s, 1), `step ${s}`).toBe(s % 2 === 1 ? 0.075 : 0)
    }
    expect(PATTERNS.Funk.swingGrid).toBe(16)
  })

  it('Blues shuffle: hat intervals alternate long/short and stay consistent across the bar line', () => {
    const p = PATTERNS.Blues
    const times = hits(p.hat).map((s) => s + swingOffset(p, s, 1))
    times.push(16 + swingOffset(p, 0, 1)) // first hat of the next bar
    const intervals = times.slice(1).map((t, i) => t - times[i])
    for (let i = 0; i < intervals.length; i++) {
      expect(intervals[i], `interval ${i}`).toBeCloseTo(i % 2 === 0 ? 2.667 : 1.333, 9)
    }
    // the kick's "and" hits swing with the hat
    for (const s of hits(p.kick)) expect(swingOffset(p, s, 1)).toBe(s % 4 === 2 ? p.swing : 0)
  })

  it('straight styles have no swing', () => {
    expect(PATTERNS.Rock.swing).toBe(0)
    expect(PATTERNS.Pop.swing).toBe(0)
  })
})
