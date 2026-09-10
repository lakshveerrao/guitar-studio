import { describe, expect, it } from 'vitest'
import { makeCurve } from './dsp'

/** Slope of the transfer curve at x = 0 (central difference). */
function slopeAtZero(c: Float32Array): number {
  const mid = (c.length - 1) / 2
  const dx = 2 / (c.length - 1)
  return (c[mid + 1] - c[mid - 1]) / (2 * dx)
}

const DRIVES = [0.0001, 0.08, 0.2, 0.5, 0.775, 0.91, 1]

describe('waveshaper curves', () => {
  it('every curve maps silence to exactly 0 and is monotonic', () => {
    for (const kind of ['soft', 'tube', 'hard', 'fuzz'] as const) {
      for (const a of DRIVES) {
        const c = makeCurve(kind, a)
        expect(c[(c.length - 1) / 2], `${kind} ${a}`).toBe(0)
        let monotonic = true
        for (let i = 1; i < c.length; i++) if (c[i] < c[i - 1]) monotonic = false
        expect(monotonic, `${kind} ${a} monotonic`).toBe(true)
      }
    }
  })

  it('tube: small-signal gain >= 1, rising with drive, and never a rectifier', () => {
    let prev = 0
    for (const a of DRIVES) {
      const c = makeCurve('tube', a)
      const s = slopeAtZero(c)
      expect(s, `slope at drive ${a}`).toBeGreaterThanOrEqual(1)
      expect(s, `slope rises at drive ${a}`).toBeGreaterThan(prev)
      prev = s
      const posMax = c[c.length - 1]
      const negMin = c[0]
      // asymmetric: positive half clips earlier, but both halves stay well
      // clear of zero and the DC (posMax + negMin) is bounded
      expect(posMax, `posMax at drive ${a}`).toBeGreaterThan(0.5)
      expect(-negMin, `negMin at drive ${a}`).toBeGreaterThan(posMax)
      expect(-negMin, `negMin at drive ${a}`).toBeLessThan(1.5)
      expect(Math.abs(posMax + negMin), `dc at drive ${a}`).toBeLessThan(0.9)
    }
    // the audit's worst case: drive 1 had slope 0.37 and posMax 0.008
    const full = makeCurve('tube', 1)
    expect(slopeAtZero(full)).toBeGreaterThan(15)
    expect(full[full.length - 1]).toBeGreaterThan(0.55)
  })

  it('fuzz: reaches exactly +/-1 at x = +/-1, is odd, and never exceeds 1', () => {
    for (const a of DRIVES) {
      const c = makeCurve('fuzz', a)
      expect(c[c.length - 1], `drive ${a}`).toBeCloseTo(1, 6)
      expect(c[0], `drive ${a}`).toBeCloseTo(-1, 6)
      let maxAbs = 0
      let oddError = 0
      for (let i = 0; i < c.length; i++) {
        maxAbs = Math.max(maxAbs, Math.abs(c[i]))
        oddError = Math.max(oddError, Math.abs(c[i] + c[c.length - 1 - i]))
      }
      expect(maxAbs, `drive ${a} bounded`).toBeLessThanOrEqual(1 + 1e-6)
      expect(oddError, `drive ${a} odd symmetry`).toBeLessThan(1e-6)
      expect(slopeAtZero(c)).toBeGreaterThanOrEqual(1)
    }
  })

  it('caches curves per kind and amount', () => {
    expect(makeCurve('soft', 0.3)).toBe(makeCurve('soft', 0.3))
    expect(makeCurve('soft', 0.3)).not.toBe(makeCurve('soft', 0.31))
  })
})
