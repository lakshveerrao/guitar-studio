import { describe, expect, it } from 'vitest'
import { renderApplauseChannel } from './Applause'

function lcg(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

describe('applause loop', () => {
  it('is seamless: the loop point is as loud as the rest and continuous across the wrap', () => {
    const sr = 22050
    const d = renderApplauseChannel(sr, 3, 0.5, lcg(7))
    const len = d.length
    expect(len).toBe(sr * 3)
    const rms = (from: number, to: number) => {
      let s = 0
      for (let i = from; i < to; i++) s += d[i] * d[i]
      return Math.sqrt(s / (to - from))
    }
    const seg = Math.floor(sr * 0.1)
    const overall = rms(0, len)
    const db = (v: number) => 20 * Math.log10(v / overall)
    // the old fade-to-silence put the seam at -inf dB; the bed must stay within its normal +-3 dB
    expect(db(rms(0, seg)), 'head').toBeGreaterThan(-4)
    expect(db(rms(len - seg, len)), 'tail').toBeGreaterThan(-4)
    expect(db(rms(Math.floor(len / 2), Math.floor(len / 2) + seg)), 'middle').toBeGreaterThan(-4)
    // the sample after the last one is the first one: no jump beyond a normal step
    let steps = 0
    for (let i = 1; i < len; i++) steps += Math.abs(d[i] - d[i - 1])
    const avgStep = steps / (len - 1)
    expect(Math.abs(d[0] - d[len - 1])).toBeLessThan(avgStep * 8)
    // normalised
    let pk = 0
    for (let i = 0; i < len; i++) pk = Math.max(pk, Math.abs(d[i]))
    expect(pk).toBeCloseTo(0.8, 4)
  })
})
