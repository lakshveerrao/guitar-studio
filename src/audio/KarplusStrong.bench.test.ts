import { describe, expect, it } from 'vitest'
import { renderPluck } from './KarplusStrong'

/**
 * Cost of a synchronous pluck render. Reports timing (ms per render) so the
 * numbers can be tracked; only structural facts are asserted so the test is
 * not flaky on slow machines. Note that vitest's harness roughly triples the
 * time compared with plain Node (which is what the browser's JIT matches).
 */
const SR = 44100
const LOW_E = {
  sampleRate: SR,
  frequency: 82.407,
  velocity: 0.85,
  brightness: 0.3,
  decaySeconds: 5,
  pickPosition: 0.2,
  palmMute: false,
  legato: false,
}

function stats(times: number[]) {
  const s = times.slice().sort((a, b) => a - b)
  const median = s[Math.floor(s.length / 2)]
  const p90 = s[Math.floor(s.length * 0.9)]
  const mean = s.reduce((a, b) => a + b, 0) / s.length
  return { median, p90, mean }
}

describe('renderPluck cost', () => {
  it('renders a 5 s low-E note (reports ms per render)', () => {
    for (let i = 0; i < 10; i++) renderPluck(LOW_E, 1 + i)
    const N = 40
    const times: number[] = []
    let len = 0
    for (let i = 0; i < N; i++) {
      const t0 = performance.now()
      const out = renderPluck(LOW_E, 1000 + i)
      times.push(performance.now() - t0)
      len = out.length
    }
    const { median, p90, mean } = stats(times)
    // eslint-disable-next-line no-console
    console.log(
      `renderPluck 5 s decay @44100: ${len} samples (${(len / SR).toFixed(2)} s)  median ${median.toFixed(2)} ms  p90 ${p90.toFixed(2)} ms  mean ${mean.toFixed(2)} ms`,
    )
    expect(len).toBeGreaterThan(SR * 2)
  })

  it('renders an Em strum (6 strings at sustain 5)', () => {
    const STRING_BRIGHTNESS = [0.3, 0.38, 0.46, 0.6, 0.68, 0.76]
    const STRING_DECAY = [5.2, 5.0, 4.6, 4.0, 3.6, 3.2]
    const freqs = [82.407, 123.47, 164.81, 196.0, 246.94, 329.63]
    const times: number[] = []
    let total = 0
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now()
      total = 0
      for (let s = 0; s < 6; s++) {
        total += renderPluck(
          {
            sampleRate: SR,
            frequency: freqs[s],
            velocity: 0.8,
            brightness: STRING_BRIGHTNESS[s],
            decaySeconds: STRING_DECAY[s] * 1.3,
            pickPosition: 0.2,
            palmMute: false,
            legato: false,
          },
          5000 + i * 6 + s,
        ).length
      }
      times.push(performance.now() - t0)
    }
    const { median, p90 } = stats(times)
    // eslint-disable-next-line no-console
    console.log(`Em strum (6 strings, sustain 5): ${total} samples (${(total / SR).toFixed(1)} s audio)  median ${median.toFixed(2)} ms  p90 ${p90.toFixed(2)} ms`)
    expect(total).toBeGreaterThan(0)
  })
})
