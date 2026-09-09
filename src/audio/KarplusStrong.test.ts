import { describe, expect, it } from 'vitest'
import { estimateFrequency, renderPluck } from './KarplusStrong'
import { fretFrequency, openFrequency } from '../music/tuning'
import { centsBetween } from '../music/notes'

const SR = 44100

describe('tuning math', () => {
  it('open strings match standard tuning', () => {
    expect(openFrequency(0)).toBeCloseTo(82.407, 2)
    expect(openFrequency(1)).toBeCloseTo(110.0, 2)
    expect(openFrequency(2)).toBeCloseTo(146.832, 2)
    expect(openFrequency(3)).toBeCloseTo(195.998, 2)
    expect(openFrequency(4)).toBeCloseTo(246.942, 2)
    expect(openFrequency(5)).toBeCloseTo(329.628, 2)
  })
  it('fret 12 doubles the open frequency, fret 5 on low E equals open A', () => {
    expect(fretFrequency(0, 12)).toBeCloseTo(openFrequency(0) * 2, 6)
    expect(fretFrequency(0, 5)).toBeCloseTo(openFrequency(1), 6)
    expect(fretFrequency(1, 7)).toBeCloseTo(fretFrequency(2, 2), 6)
    expect(fretFrequency(5, 5)).toBeCloseTo(440, 6)
  })
})

describe('Karplus-Strong string model', () => {
  it('renders every fret 0-20 on every string within 3 cents of the target pitch', () => {
    for (let s = 0; s < 6; s++) {
      for (let fret = 0; fret <= 20; fret++) {
        const target = fretFrequency(s, fret)
        const buf = renderPluck({
          sampleRate: SR,
          frequency: target,
          velocity: 0.8,
          brightness: 0.4 + s * 0.1,
          decaySeconds: 2,
          pickPosition: 0.18,
          palmMute: false,
          legato: false,
          maxSeconds: 0.6,
        })
        const est = estimateFrequency(buf, SR)
        const cents = Math.abs(centsBetween(est, target))
        expect(cents, `string ${s} fret ${fret}: est ${est.toFixed(2)} vs ${target.toFixed(2)}`).toBeLessThan(3)
      }
    }
  }, 60000)

  it('palm mute decays much faster than an open note', () => {
    const open = renderPluck({ sampleRate: SR, frequency: 110, velocity: 0.8, brightness: 0.5, decaySeconds: 3, pickPosition: 0.2, palmMute: false, legato: false })
    const muted = renderPluck({ sampleRate: SR, frequency: 110, velocity: 0.8, brightness: 0.5, decaySeconds: 3, pickPosition: 0.2, palmMute: true, legato: false })
    const rms = (b: Float32Array, from: number, to: number) => {
      let s = 0
      for (let i = from; i < to; i++) s += b[i] * b[i]
      return Math.sqrt(s / (to - from))
    }
    const t = Math.floor(SR * 0.4)
    expect(muted.length).toBeLessThan(open.length)
    expect(rms(muted, t, Math.min(muted.length, t + 2000)) * 4).toBeLessThan(rms(open, t, t + 2000))
  })

  it('velocity changes level', () => {
    const soft = renderPluck({ sampleRate: SR, frequency: 220, velocity: 0.2, brightness: 0.6, decaySeconds: 1, pickPosition: 0.2, palmMute: false, legato: false })
    const hard = renderPluck({ sampleRate: SR, frequency: 220, velocity: 1, brightness: 0.6, decaySeconds: 1, pickPosition: 0.2, palmMute: false, legato: false })
    const peak = (b: Float32Array) => b.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
    expect(peak(soft)).toBeLessThan(peak(hard))
  })
})
