/** Shared DSP helpers for waveshaping and impulse-response generation. */

export type CurveKind = 'soft' | 'tube' | 'hard' | 'fuzz'

const curveCache = new Map<string, Float32Array<ArrayBuffer>>()

/**
 * Build a waveshaper transfer curve. `amount` is 0..1.
 */
export function makeCurve(kind: CurveKind, amount: number, samples = 4097): Float32Array<ArrayBuffer> {
  const key = `${kind}:${amount.toFixed(3)}`
  const cached = curveCache.get(key)
  if (cached) return cached
  const curve = new Float32Array(samples)
  const a = Math.max(0.0001, Math.min(1, amount))
  for (let i = 0; i < samples; i++) {
    // odd sample count: the centre sample is exactly x = 0, so silence stays at 0 (no DC offset)
    const x = (i * 2) / (samples - 1) - 1
    let y: number
    switch (kind) {
      case 'soft': {
        const k = 1 + a * 14
        y = Math.tanh(x * k) / Math.tanh(k)
        break
      }
      case 'tube': {
        // asymmetric: positive half clips softer than negative half
        const k = 1 + a * 22
        const bias = 0.12 * a
        const xx = x + bias
        y = Math.tanh(xx * k) / Math.tanh(k) - Math.tanh(bias * k) / Math.tanh(k)
        break
      }
      case 'hard': {
        const k = 1 + a * 40
        const yy = x * k
        y = Math.max(-1, Math.min(1, yy))
        // round the knees a little
        y = Math.sign(y) * (1 - Math.pow(1 - Math.abs(y), 1.6))
        break
      }
      case 'fuzz': {
        const k = 1 + a * 60
        y = ((3 + k) * x * 20 * (Math.PI / 180)) / (Math.PI + k * Math.abs(x))
        y = Math.max(-1, Math.min(1, y))
        break
      }
    }
    curve[i] = y
  }
  curveCache.set(key, curve)
  return curve
}

/** Generate a stereo exponentially-decaying noise impulse response. */
export function makeImpulseResponse(ctx: AudioContext, seconds: number, decay: number, preDelay = 0.01): AudioBuffer {
  const sr = ctx.sampleRate
  const len = Math.max(1, Math.floor(sr * seconds))
  const buf = ctx.createBuffer(2, len, sr)
  const pre = Math.floor(sr * preDelay)
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    let lp = 0
    for (let i = 0; i < len; i++) {
      if (i < pre) {
        d[i] = 0
        continue
      }
      const t = (i - pre) / (len - pre)
      const env = Math.pow(1 - t, decay)
      // early reflections are brighter, tail darkens: simple lowpass whose
      // coefficient tightens over time
      const n = Math.random() * 2 - 1
      lp += (n - lp) * (0.9 - t * 0.6)
      d[i] = lp * env
    }
  }
  return buf
}

export const dbToGain = (db: number) => Math.pow(10, db / 20)
