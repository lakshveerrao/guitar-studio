/**
 * Extended Karplus-Strong plucked-string renderer.
 *
 * Renders a complete pluck into a Float32Array. The render is a few hundred
 * thousand multiply-adds, which takes ~1-3ms on a modern machine, so it is
 * done synchronously on the main thread at pluck time and played through an
 * AudioBufferSourceNode. Pitch modulation (bend, vibrato) is applied by the
 * caller through the source's detune parameter.
 *
 * Model:
 *   excitation  : filtered noise burst shaped by pick hardness (velocity),
 *                 comb-filtered by pick position, with a small DC-free
 *                 "pick release" transient
 *   string loop : fractional delay (linear interpolation) + one-pole
 *                 loss lowpass whose cutoff follows brightness, + a
 *                 first-order allpass for dispersion / inharmonicity
 *   damping     : per-sample loop gain derived from a target decay time
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

export function renderPluck(p: PluckParams, seed = 12345): Float32Array<ArrayBuffer> {
  const sr = p.sampleRate
  const f = clamp(p.frequency, 30, 4000)
  const velocity = clamp(p.velocity, 0.05, 1)
  const brightness = clamp(p.brightness, 0, 1)

  const period = sr / f

  const decay = p.palmMute ? Math.min(p.decaySeconds, 0.22) : p.decaySeconds
  const totalSeconds = Math.min(p.maxSeconds ?? 8, decay * 1.15 + 0.15)
  const totalSamples = Math.floor(totalSeconds * sr)

  // Loop gain per period for -60 dB at `decay` seconds:  g^(decay*f) = 0.001
  const periodsInDecay = decay * f
  let loopGain = Math.pow(0.001, 1 / periodsInDecay)
  if (p.palmMute) loopGain = Math.min(loopGain, 0.985)
  loopGain = clamp(loopGain, 0.8, 0.99995)

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

  // ---- Excitation ----
  const rng = makeRng(seed)
  const exc = new Float32Array(bufLen)
  // Noise burst, lowpassed according to velocity (soft pick = duller)
  const excCut = p.legato ? 0.35 : 0.45 + velocity * 0.5 // 0..1
  let lp = 0
  for (let i = 0; i < bufLen; i++) {
    const n = rng()
    lp += (n - lp) * excCut
    exc[i] = lp
  }
  // Pick-position comb: subtract a copy delayed by pickPos * period
  const pickDelay = Math.max(1, Math.round(clamp(p.pickPosition, 0.05, 0.5) * period))
  for (let i = bufLen - 1; i >= pickDelay; i--) {
    exc[i] -= exc[i - pickDelay] * 0.9
  }
  // Remove DC
  let mean = 0
  for (let i = 0; i < bufLen; i++) mean += exc[i]
  mean /= bufLen
  let peak = 0
  for (let i = 0; i < bufLen; i++) {
    exc[i] -= mean
    peak = Math.max(peak, Math.abs(exc[i]))
  }
  const excGain = (p.legato ? 0.35 : 0.25 + velocity * 0.75) / (peak || 1)
  for (let i = 0; i < bufLen; i++) exc[i] *= excGain

  // ---- String loop ----
  const out = new Float32Array(totalSamples)
  const ring = new Float32Array(bufLen)
  ring.set(exc)
  let writeIdx = 0
  let lossState = 0
  let apX1 = 0
  let apY1 = 0

  for (let n = 0; n < totalSamples; n++) {
    // fractional read: sample from N and N+1 samples ago
    let r0 = writeIdx - N
    if (r0 < 0) r0 += bufLen
    let r1 = r0 - 1
    if (r1 < 0) r1 += bufLen
    const delayed = ring[r0] * (1 - frac) + ring[r1] * frac

    // loss lowpass
    lossState += (delayed - lossState) * (1 - lossA)
    let v = lossState

    // dispersion allpass: y = -a x + x1 + a y1
    const apY = -apCoef * v + apX1 + apCoef * apY1
    apX1 = v
    apY1 = apY
    v = apY * loopGain

    out[n] = v
    ring[writeIdx] = v
    writeIdx++
    if (writeIdx >= bufLen) writeIdx = 0
  }

  // Short fade-in to remove any click and a gentle fade-out at the tail.
  const fadeIn = Math.min(16, totalSamples)
  for (let i = 0; i < fadeIn; i++) out[i] *= i / fadeIn
  const fadeOut = Math.min(Math.floor(sr * 0.05), totalSamples)
  for (let i = 0; i < fadeOut; i++) out[totalSamples - 1 - i] *= i / fadeOut

  // Normalize peak with a velocity-dependent target so dynamics survive
  let pk = 0
  for (let i = 0; i < totalSamples; i++) pk = Math.max(pk, Math.abs(out[i]))
  const target = (p.legato ? 0.55 : 0.4 + velocity * 0.6) * (p.palmMute ? 0.8 : 1)
  if (pk > 0) {
    const g = target / pk
    for (let i = 0; i < totalSamples; i++) out[i] *= g
  }
  return out
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
