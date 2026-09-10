import { describe, expect, it } from 'vitest'
import { estimateFrequency, pluckLength, renderPluck, type PluckParams } from './KarplusStrong'
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

/** Magnitude of the partial at `freq` over `seconds` from the start (plain DFT bin). */
function partialLevel(buf: Float32Array, sr: number, freq: number, seconds: number): number {
  const n = Math.min(buf.length, Math.floor(sr * seconds))
  let re = 0
  let im = 0
  const w = (2 * Math.PI * freq) / sr
  for (let i = 0; i < n; i++) {
    re += buf[i] * Math.cos(w * i)
    im -= buf[i] * Math.sin(w * i)
  }
  return Math.hypot(re, im)
}

/** Autocorrelation of the first `seconds` at an integer lag. */
function autocorr(buf: Float32Array, sr: number, lag: number, seconds: number): number {
  const n = Math.min(buf.length, Math.floor(sr * seconds))
  let s = 0
  for (let i = 0; i + lag < n; i++) s += buf[i] * buf[i + lag]
  return s
}

const base = (over: Partial<PluckParams>): PluckParams => ({
  sampleRate: SR,
  frequency: 110,
  velocity: 0.85,
  brightness: 0.5,
  decaySeconds: 2,
  pickPosition: 0.2,
  palmMute: false,
  legato: false,
  maxSeconds: 0.5,
  ...over,
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
    // RMS over [from, to); samples past the end of the buffer are silence
    const rms = (b: Float32Array, from: number, to: number) => {
      let s = 0
      for (let i = from; i < Math.min(to, b.length); i++) s += b[i] * b[i]
      return Math.sqrt(s / (to - from))
    }
    const t = Math.floor(SR * 0.4)
    expect(muted.length).toBeLessThan(open.length)
    expect(rms(muted, t, t + 2000) * 4).toBeLessThan(rms(open, t, t + 2000))
    // and it is quieter already at 0.15 s, not just because the buffer ended
    const t2 = Math.floor(SR * 0.15)
    expect(t2 + 2000).toBeLessThan(muted.length)
    expect(rms(muted, t2, t2 + 2000) * 2).toBeLessThan(rms(open, t2, t2 + 2000))
  })

  it('velocity changes level', () => {
    const soft = renderPluck({ sampleRate: SR, frequency: 220, velocity: 0.2, brightness: 0.6, decaySeconds: 1, pickPosition: 0.2, palmMute: false, legato: false })
    const hard = renderPluck({ sampleRate: SR, frequency: 220, velocity: 1, brightness: 0.6, decaySeconds: 1, pickPosition: 0.2, palmMute: false, legato: false })
    const peak = (b: Float32Array) => b.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
    expect(peak(soft)).toBeLessThan(peak(hard))
  })

  it('velocity changes brightness (harder pick has more upper-partial energy)', () => {
    const f = 196
    const soft = renderPluck(base({ frequency: f, velocity: 0.2 }), 7)
    const hard = renderPluck(base({ frequency: f, velocity: 1 }), 7)
    const ratio = (b: Float32Array) => {
      const h1 = partialLevel(b, SR, f, 0.08)
      let hi = 0
      for (let n = 6; n <= 12; n++) hi += partialLevel(b, SR, f * n, 0.08)
      return hi / h1
    }
    expect(ratio(hard)).toBeGreaterThan(ratio(soft) * 1.3)
  })

  it('the fundamental is the strongest partial in the attack, for every pluck', () => {
    // string/fret/pickup combinations the app uses (pickPosition: neck 0.3, middle 0.2, bridge 0.11)
    const cases: { name: string; f: number; brightness: number; pickPosition: number }[] = [
      { name: 'A2 open, middle', f: fretFrequency(1, 0), brightness: 0.38, pickPosition: 0.2 },
      { name: 'E4 open, bridge', f: fretFrequency(5, 0), brightness: 0.88, pickPosition: 0.11 },
      { name: 'G3 fret 14, middle', f: fretFrequency(3, 14), brightness: 0.6, pickPosition: 0.2 },
      { name: 'G3 open, neck', f: fretFrequency(3, 0), brightness: 0.52, pickPosition: 0.3 },
      { name: 'E2 open, bridge', f: fretFrequency(0, 0), brightness: 0.42, pickPosition: 0.11 },
      { name: 'B3 fret 7, neck', f: fretFrequency(4, 7), brightness: 0.6, pickPosition: 0.3 },
    ]
    let seed = 1
    for (const c of cases) {
      let worst = Infinity
      for (let k = 0; k < 40; k++) {
        seed = (seed * 1103515245 + 12345) >>> 0
        const buf = renderPluck(
          { sampleRate: SR, frequency: c.f, velocity: 0.85, brightness: c.brightness, decaySeconds: 3, pickPosition: c.pickPosition, palmMute: false, legato: false, maxSeconds: 0.12 },
          seed,
        )
        const h1 = partialLevel(buf, SR, c.f, 0.08)
        const h2 = partialLevel(buf, SR, c.f * 2, 0.08)
        const h3 = partialLevel(buf, SR, c.f * 3, 0.08)
        const marginDb = 20 * Math.log10(h1 / Math.max(h2, h3))
        worst = Math.min(worst, marginDb)
        // fundamental period lag must correlate better than the octave-up lag
        const period = Math.round(SR / c.f)
        expect(autocorr(buf, SR, period, 0.08), `${c.name} seed ${seed}: period lag`).toBeGreaterThan(autocorr(buf, SR, Math.round(period / 2), 0.08))
      }
      expect(worst, `${c.name}: fundamental margin over 2nd/3rd harmonic (dB)`).toBeGreaterThan(3)
    }
  }, 60000)

  it('renders straight into a destination buffer with identical output', () => {
    const p = base({ frequency: 146.83, maxSeconds: 0.3 })
    const a = renderPluck(p, 99)
    const dest = new Float32Array(pluckLength(p))
    const b = renderPluck(p, 99, dest)
    expect(b).toBe(dest)
    expect(b.length).toBe(a.length)
    for (let i = 0; i < a.length; i += 97) expect(b[i]).toBe(a[i])
    expect(() => renderPluck(p, 99, new Float32Array(a.length + 1))).toThrow()
  })

  it('does not render an inaudible tail: length is the -60 dB time plus the fade', () => {
    const p: PluckParams = { sampleRate: SR, frequency: 82.407, velocity: 0.85, brightness: 0.3, decaySeconds: 5, pickPosition: 0.2, palmMute: false, legato: false }
    const buf = renderPluck(p, 3)
    expect(buf.length).toBe(pluckLength(p))
    expect(buf.length).toBeLessThanOrEqual(Math.floor((5 + 0.05) * SR))
    expect(buf.length).toBeGreaterThan(Math.floor(4.9 * SR))
    // the last 100 ms before the fade are at least 55 dB below the peak
    let pk = 0
    for (let i = 0; i < buf.length; i++) pk = Math.max(pk, Math.abs(buf[i]))
    const from = buf.length - Math.floor(SR * 0.15)
    const to = buf.length - Math.floor(SR * 0.05)
    let tail = 0
    for (let i = from; i < to; i++) tail = Math.max(tail, Math.abs(buf[i]))
    expect(20 * Math.log10(tail / pk)).toBeLessThan(-55)
    // the cap still applies
    expect(renderPluck({ ...p, decaySeconds: 20 }, 3).length).toBe(8 * SR)
  })

  it('normalises the peak to the velocity target', () => {
    for (const v of [0.2, 0.6, 1]) {
      for (const f of [82.4, 440, 1500]) {
        const buf = renderPluck(base({ frequency: f, velocity: v, maxSeconds: 0.4 }), 11)
        let pk = 0
        for (let i = 0; i < buf.length; i++) pk = Math.max(pk, Math.abs(buf[i]))
        expect(pk).toBeCloseTo(0.4 + v * 0.6, 2)
      }
    }
  })
})
