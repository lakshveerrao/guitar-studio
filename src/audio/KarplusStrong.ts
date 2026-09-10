/**
 * Extended Karplus-Strong plucked-string renderer.
 *
 * Renders a complete pluck into a Float32Array (optionally straight into an
 * AudioBuffer channel, see `renderPluck`'s `dest`). The render is a few
 * hundred thousand multiply-adds, which takes ~1 ms on a modern machine, so it
 * is done synchronously on the main thread at pluck time and played through an
 * AudioBufferSourceNode. Pitch modulation (bend, vibrato) is applied by the
 * caller through the source's detune parameter.
 *
 * Model:
 *   excitation  : a triangular displacement whose apex sits at the pick
 *                 position blended with its derivative (the velocity pulse a
 *                 magnetic pickup senses), which gives every pluck the same
 *                 harmonic envelope with a dominant fundamental and the
 *                 pick-position notches; plus a small comb-filtered noise
 *                 burst for pick texture and pluck-to-pluck variation; the
 *                 whole burst is rounded by a lowpass that follows pick
 *                 hardness (velocity)
 *   string loop : fractional delay (linear interpolation) + one-pole
 *                 loss lowpass whose cutoff follows brightness, + a
 *                 first-order allpass for dispersion / inharmonicity
 *   damping     : per-sample loop gain derived from a target decay time
 *
 * The rendered length is capped at the point where the loop gain alone has
 * taken the signal below -60 dB (plus the 50 ms fade-out), so no inaudible
 * tail is rendered.
 */

export interface PluckParams {
  sampleRate: number
  frequency: number
  velocity: number // 0..1
  brightness: number // 0..1 (string gauge/pickup), 1 = brightest
  decaySeconds: number // time to fade by ~60 dB
  pickPosition: number // 0..0.5 fraction of string length
  palmMute: boolean
  legato: boolean // hammer-on / pull-off: soft, dark excitation
  maxSeconds?: number
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

// Deterministic PRNG so renders are reproducible for tests
function makeRng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return ((s >>> 0) / 4294967296) * 2 - 1
  }
}

/**
 * Excitation shape = displacement triangle + VELOCITY_MIX * its derivative
 * (a bipolar pulse, what a magnetic pickup senses). The triangle alone falls
 * as 1/n^2 and is too dull for an electric; the pulse falls as 1/n. The blend
 * keeps the fundamental the strongest partial (>= +3 dB over h2/h3 at every
 * pick position, measured) while restoring upper partials.
 */
const VELOCITY_MIX = 0.5
/** Peak of the comb-filtered noise burst relative to the shape's peak. */
const NOISE_MIX = 0.2
const FADE_IN_SAMPLES = 16
const FADE_OUT_SECONDS = 0.05

interface Plan {
  sr: number
  f: number
  velocity: number
  period: number
  loopGain: number
  lossA: number
  apCoef: number
  N: number
  frac: number
  bufLen: number
  totalSamples: number
}

function planPluck(p: PluckParams): Plan {
  const sr = p.sampleRate
  const f = clamp(p.frequency, 30, 4000)
  const velocity = clamp(p.velocity, 0.05, 1)
  const brightness = clamp(p.brightness, 0, 1)

  const period = sr / f

  const decay = p.palmMute ? Math.min(p.decaySeconds, 0.22) : p.decaySeconds

  // Loop gain per period for -60 dB at `decay` seconds:  g^(decay*f) = 0.001
  const periodsInDecay = decay * f
  let loopGain = Math.pow(0.001, 1 / periodsInDecay)
  if (p.palmMute) loopGain = Math.min(loopGain, 0.985)
  loopGain = clamp(loopGain, 0.8, 0.99995)

  // The loop gain is an upper bound on the per-period gain of every partial
  // (the loss lowpass only removes more), so the signal is below -60 dB once
  // loopGain^periods < 0.001. Render exactly that long plus the fade-out.
  const periodsTo60dB = Math.log(0.001) / Math.log(loopGain)
  const audibleSeconds = (periodsTo60dB * period) / sr
  const totalSeconds = Math.min(p.maxSeconds ?? 8, audibleSeconds + FADE_OUT_SECONDS)
  const totalSamples = Math.max(1, Math.floor(totalSeconds * sr))

  // Loss filter: one-pole lowpass y = (1-a) x + a y. Higher `a` = darker.
  // Brightness raises the cutoff; velocity adds brightness (harder pick);
  // low strings are naturally darker.
  let lossA = 0.55 - brightness * 0.4 - velocity * 0.1
  if (p.palmMute) lossA += 0.25
  if (p.legato) lossA += 0.08
  lossA = clamp(lossA, 0.02, 0.9)

  // Dispersion allpass (stiff-string inharmonicity), stronger on low strings.
  const apCoef = clamp(0.12 * (1 - brightness) + (p.palmMute ? 0 : 0.02), 0, 0.3)

  // Delay line length (fractional) for the target pitch. The loop filters add
  // phase delay; compute it exactly at the fundamental for the one-pole lowpass
  // and the first-order allpass so the fundamental lands on the target pitch.
  const w = (2 * Math.PI * f) / sr
  const lossDelay = Math.atan2(lossA * Math.sin(w), 1 - lossA * Math.cos(w)) / w
  const apDelay =
    -(Math.atan2(-Math.sin(w), Math.cos(w) - apCoef) - Math.atan2(apCoef * Math.sin(w), 1 - apCoef * Math.cos(w))) / w
  const delay = Math.max(2, period - lossDelay - apDelay)
  const N = Math.floor(delay)
  const frac = delay - N
  const bufLen = N + 2

  return { sr, f, velocity, period, loopGain, lossA, apCoef, N, frac, bufLen, totalSamples }
}

/** Number of samples `renderPluck` will produce for these parameters. */
export function pluckLength(p: PluckParams): number {
  return planPluck(p).totalSamples
}

/**
 * Render a pluck. When `dest` is given (e.g. an AudioBuffer channel obtained
 * with getChannelData) the samples are written straight into it and it is
 * returned; it must be exactly `pluckLength(p)` long.
 */
export function renderPluck(p: PluckParams, seed = 12345, dest?: Float32Array<ArrayBuffer>): Float32Array<ArrayBuffer> {
  const plan = planPluck(p)
  const { sr, velocity, period, loopGain, lossA, apCoef, N, frac, bufLen, totalSamples } = plan
  if (dest && dest.length !== totalSamples) throw new Error(`renderPluck: dest has ${dest.length} samples, expected ${totalSamples}`)

  // ---- Excitation ----
  const exc = new Float32Array(bufLen)
  // Displacement triangle with the apex at the pick position plus its
  // derivative (a bipolar pulse: +1 up to the apex, then a small negative
  // level so it is zero-mean). Both carry the pick-position nulls.
  const pickPos = clamp(p.pickPosition, 0.05, 0.5)
  const apex = clamp(Math.round(pickPos * period), 1, bufLen - 2)
  const fallLen = bufLen - 1 - apex
  const pulseLow = -apex / fallLen
  for (let i = 0; i < bufLen; i++) {
    const tri = i <= apex ? i / apex : (bufLen - 1 - i) / fallLen
    exc[i] = tri + VELOCITY_MIX * (i <= apex ? 1 : pulseLow)
  }
  // Noise burst for pick texture and pluck-to-pluck variation, comb-filtered
  // by the pick position and scaled relative to the shape's peak (1 + mix).
  const rng = makeRng(seed)
  const noise = new Float32Array(bufLen)
  for (let i = 0; i < bufLen; i++) noise[i] = rng()
  const pickDelay = Math.max(1, Math.round(pickPos * period))
  for (let i = bufLen - 1; i >= pickDelay; i--) noise[i] -= noise[i - pickDelay] * 0.9
  let noisePeak = 0
  for (let i = 0; i < bufLen; i++) noisePeak = Math.max(noisePeak, Math.abs(noise[i]))
  const noiseGain = noisePeak > 0 ? (NOISE_MIX * (1 + VELOCITY_MIX)) / noisePeak : 0
  for (let i = 0; i < bufLen; i++) exc[i] += noise[i] * noiseGain
  // Pick hardness: a soft pick (low velocity) rounds the corners of shape and
  // noise alike. Two one-pole passes (12 dB/oct); legato is softest.
  const excCut = p.legato ? 0.25 : 0.2 + velocity * 0.7
  for (let pass = 0; pass < 2; pass++) {
    let lp = 0
    for (let i = 0; i < bufLen; i++) {
      lp += (exc[i] - lp) * excCut
      exc[i] = lp
    }
  }
  // Remove DC and normalise the excitation peak
  let mean = 0
  for (let i = 0; i < bufLen; i++) mean += exc[i]
  mean /= bufLen
  let excPeak = 0
  for (let i = 0; i < bufLen; i++) {
    const v = exc[i] - mean
    exc[i] = v
    if (v > excPeak) excPeak = v
    else if (-v > excPeak) excPeak = -v
  }
  const excGain = (p.legato ? 0.35 : 0.25 + velocity * 0.75) / (excPeak || 1)
  for (let i = 0; i < bufLen; i++) exc[i] *= excGain

  // ---- String loop ----
  // The delay line is the output history itself: the sample fed back at step
  // n is out[n - N] (interpolated with out[n - N - 1]); before those exist it
  // comes from the excitation. This is exactly the classic ring buffer with
  // the excitation preloaded, without wrap-around checks in the hot loop.
  const out = dest ?? new Float32Array(totalSamples)
  const oneMinusFrac = 1 - frac
  const lossK = 1 - lossA
  const st = new Float64Array(3) // lossState, apX1, apY1

  const n1 = Math.min(N, totalSamples)
  for (let n = 0; n < n1; n++) {
    const delayed = exc[n + 2] * oneMinusFrac + exc[n + 1] * frac
    st[0] += (delayed - st[0]) * lossK
    const apY = -apCoef * st[0] + st[1] + apCoef * st[2]
    st[1] = st[0]
    st[2] = apY
    out[n] = apY * loopGain
  }
  if (N < totalSamples) {
    const delayed = out[0] * oneMinusFrac + exc[N + 1] * frac
    st[0] += (delayed - st[0]) * lossK
    const apY = -apCoef * st[0] + st[1] + apCoef * st[2]
    st[1] = st[0]
    st[2] = apY
    out[N] = apY * loopGain
  }

  // The peak of a pluck is in the attack (every pass through the loop loses
  // energy), so after a few periods the normalisation gain is known. Scale the
  // history and the filter state at that point: the loop is linear, so the
  // rest of the render comes out scaled without a second pass.
  const K = Math.min(totalSamples, Math.max(N + 1, Math.ceil(period * 3), FADE_IN_SAMPLES))
  stringLoop(out, N + 1, K, N, frac, lossK, apCoef, loopGain, st)

  const target = (p.legato ? 0.55 : 0.4 + velocity * 0.6) * (p.palmMute ? 0.8 : 1)
  let pk = 0
  for (let i = 0; i < K; i++) {
    const v = Math.abs(out[i]) * (i < FADE_IN_SAMPLES ? i / FADE_IN_SAMPLES : 1)
    if (v > pk) pk = v
  }
  const g = pk > 0 ? target / pk : 1
  for (let i = 0; i < K; i++) out[i] *= g
  st[0] *= g
  st[1] *= g
  st[2] *= g

  const tailPk = stringLoop(out, K, totalSamples, N, frac, lossK, apCoef, loopGain, st)

  // Short fade-in to remove any click and a gentle fade-out at the tail.
  const fadeIn = Math.min(FADE_IN_SAMPLES, totalSamples)
  for (let i = 0; i < fadeIn; i++) out[i] *= i / fadeIn
  const fadeOut = Math.min(Math.floor(sr * FADE_OUT_SECONDS), totalSamples)
  for (let i = 0; i < fadeOut; i++) out[totalSamples - 1 - i] *= i / fadeOut

  // Safety net: if the tail ever exceeded the attack peak, rescale (rare).
  if (tailPk > target * 1.001) {
    const fix = target / tailPk
    for (let i = 0; i < totalSamples; i++) out[i] *= fix
  }
  return out
}

/**
 * Hot loop of the string model over out[from, to): fractional-delay read of
 * the output history, one-pole loss lowpass, first-order dispersion allpass,
 * loop gain. `st` carries the filter state (lossState, apX1, apY1) across
 * calls. Returns the peak |sample| written. A top-level function with
 * everything in parameters so the JIT keeps the loop in registers.
 */
function stringLoop(
  out: Float32Array,
  from: number,
  to: number,
  N: number,
  frac: number,
  lossK: number,
  apCoef: number,
  loopGain: number,
  st: Float64Array,
): number {
  const oneMinusFrac = 1 - frac
  const lossA = 1 - lossK
  let ls = st[0]
  let x1 = st[1]
  let y1 = st[2]
  let hi = 0
  let lo = 0
  // the older of the two interpolation taps is last iteration's newer one
  let prev = out[from - N - 1]
  for (let n = from; n < to; n++) {
    const cur = out[n - N]
    const delayed = cur * oneMinusFrac + prev * frac
    prev = cur
    // one-pole lowpass written as ls*a + x*(1-a): shortest dependency chain
    ls = ls * lossA + delayed * lossK
    // allpass y = -a x + x1 + a y1, with the y1 term added last
    const apY = x1 - apCoef * ls + apCoef * y1
    x1 = ls
    y1 = apY
    const y = apY * loopGain
    out[n] = y
    // two rarely-taken branches are much cheaper here than Math.max(Math.abs())
    if (y > hi) hi = y
    else if (y < lo) lo = y
  }
  st[0] = ls
  st[1] = x1
  st[2] = y1
  return hi > -lo ? hi : -lo
}

/**
 * Estimate the fundamental of a rendered buffer with autocorrelation.
 * Used by tests to verify tuning accuracy of the model.
 */
export function estimateFrequency(buf: Float32Array, sampleRate: number, minF = 60, maxF = 1500): number {
  const start = Math.floor(sampleRate * 0.05)
  const len = Math.min(buf.length - start, Math.floor(sampleRate * 0.3))
  const minLag = Math.floor(sampleRate / maxF)
  const maxLag = Math.ceil(sampleRate / minF)
  let bestLag = minLag
  let best = -Infinity
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0
    for (let i = 0; i < len - lag; i++) sum += buf[start + i] * buf[start + i + lag]
    if (sum > best) {
      best = sum
      bestLag = lag
    }
  }
  // parabolic interpolation around the peak
  const ac = (lag: number) => {
    let sum = 0
    for (let i = 0; i < len - lag; i++) sum += buf[start + i] * buf[start + i + lag]
    return sum
  }
  const y0 = ac(bestLag - 1)
  const y1 = ac(bestLag)
  const y2 = ac(bestLag + 1)
  const denom = y0 - 2 * y1 + y2
  const shift = denom !== 0 ? (0.5 * (y0 - y2)) / denom : 0
  return sampleRate / (bestLag + shift)
}
