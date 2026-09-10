import { describe, expect, it } from 'vitest'
import { Transport } from './Transport'

class FakeClock {
  currentTime = 0
}

const BEAT = 60 / 110
const SIXTEENTH = BEAT / 4

describe('Transport grid', () => {
  it('first client establishes the grid just ahead of now, starting at step 0', () => {
    const clock = new FakeClock()
    const tr = new Transport(clock)
    expect(tr.running).toBe(false)
    clock.currentTime = 10
    tr.acquire()
    expect(tr.running).toBe(true)
    expect(tr.beatOrigin).toBeCloseTo(10.05, 9)
    expect(tr.firstStep(1)).toBe(0)
    expect(tr.firstStep(4)).toBe(0)
    expect(tr.timeOf(0, 1)).toBeCloseTo(10.05, 9)
    expect(tr.timeOf(4, 4)).toBeCloseTo(10.05 + BEAT, 9)
  })

  it('a second client (drums after metronome) joins the running grid in the future, on a sixteenth', () => {
    const clock = new FakeClock()
    const tr = new Transport(clock)
    clock.currentTime = 10
    tr.acquire() // metronome: origin 10.05
    clock.currentTime = 11.35 // somewhere inside beat 2
    tr.acquire() // drums
    const step = tr.firstStep(4)
    const t = tr.timeOf(step, 4)
    expect(t).toBeGreaterThanOrEqual(clock.currentTime + 0.02)
    expect(t - clock.currentTime).toBeLessThan(0.02 + SIXTEENTH)
    // on the metronome's grid: an integer number of sixteenths from the origin
    const n = (t - 10.05) / SIXTEENTH
    expect(Math.abs(n - Math.round(n))).toBeLessThan(1e-9)
    // bar starts (step % 16 === 0) coincide with metronome accents (beat % 4 === 0)
    const barStart = step + ((16 - (step % 16)) % 16)
    expect(tr.timeOf(barStart, 4)).toBeCloseTo(tr.timeOf(barStart / 4, 1), 9)
    expect((barStart / 4) % 4).toBe(0)
  })

  it('the metronome joining running drums lands on the next beat of the drum grid', () => {
    const clock = new FakeClock()
    const tr = new Transport(clock)
    clock.currentTime = 3
    tr.acquire() // drums
    clock.currentTime = 4.2
    tr.acquire() // metronome
    const beat = tr.firstStep(1)
    const t = tr.timeOf(beat, 1)
    expect(t).toBeGreaterThanOrEqual(4.22)
    expect(t - 4.22).toBeLessThan(BEAT)
    expect(tr.timeOf(beat * 4, 4)).toBeCloseTo(t, 9)
  })

  it('a tempo change preserves the grid phase for everyone', () => {
    const clock = new FakeClock()
    const tr = new Transport(clock)
    clock.currentTime = 10
    tr.acquire()
    clock.currentTime = 12
    const beatsElapsed = ((12 - 10.05) * 110) / 60
    tr.bpm = 140
    expect(tr.bpm).toBe(140)
    // beat 4 now lands (4 - beatsElapsed) beats after now at the new tempo
    expect(tr.timeOf(4, 1) - 12).toBeCloseTo(((4 - beatsElapsed) * 60) / 140, 9)
    // and the two subdivisions still agree
    expect(tr.timeOf(16, 4)).toBeCloseTo(tr.timeOf(4, 1), 9)
  })

  it('bpm is rounded and clamped, and unchanged values do not move the origin', () => {
    const clock = new FakeClock()
    const tr = new Transport(clock)
    tr.acquire()
    const origin = tr.beatOrigin
    tr.bpm = 110.4
    expect(tr.bpm).toBe(110)
    expect(tr.beatOrigin).toBe(origin)
    tr.bpm = 500
    expect(tr.bpm).toBe(240)
    tr.bpm = 1
    expect(tr.bpm).toBe(40)
  })

  it('catchUp skips beats missed during a stall instead of returning them all', () => {
    const clock = new FakeClock()
    const tr = new Transport(clock)
    clock.currentTime = 10
    tr.acquire()
    // beat 3 is due at 10.05 + 3 beats; a 3 s stall has passed it
    clock.currentTime = 10.05 + 3 * BEAT + 3
    const next = tr.catchUp(3, 1)
    expect(next).toBeGreaterThan(3)
    expect(tr.timeOf(next, 1)).toBeGreaterThanOrEqual(clock.currentTime)
    expect(tr.timeOf(next, 1) - clock.currentTime).toBeLessThan(0.05 + BEAT)
    expect(tr.timeOf(next - 1, 1)).toBeLessThan(clock.currentTime + 0.05)
    // within tolerance (a late tick, not a stall) nothing is skipped
    clock.currentTime = 10.05 + 3 * BEAT + 0.1
    expect(tr.catchUp(3, 1)).toBe(3)
    expect(tr.catchUp(12, 4)).toBe(12) // the same beat on the sixteenth grid
  })

  it('the grid is dropped when the last client stops', () => {
    const clock = new FakeClock()
    const tr = new Transport(clock)
    clock.currentTime = 1
    tr.acquire()
    tr.acquire()
    tr.release()
    expect(tr.running).toBe(true)
    expect(tr.beatOrigin).toBeCloseTo(1.05, 9)
    tr.release()
    expect(tr.running).toBe(false)
    expect(tr.beatOrigin).toBeNull()
    tr.release() // extra release is harmless
    clock.currentTime = 20
    tr.acquire()
    expect(tr.beatOrigin).toBeCloseTo(20.05, 9)
    expect(tr.firstStep(4)).toBe(0)
  })
})
