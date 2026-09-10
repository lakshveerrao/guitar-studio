import { beforeEach, describe, expect, it } from 'vitest'
import { AiroMoteInput, angleDelta, encodeMotionPacket } from './AiroMoteInput'
import { InputManager } from './InputManager'
import { store } from '../state/store'
import { GuitarController } from './GuitarController'
void GuitarController
import type { Action } from '../types'

const dev0 = AiroMoteInput.device(0)
const dev1 = AiroMoteInput.device(1)

function record(fn: () => void): Action[] {
  const acts: Action[] = []
  const off = InputManager.onAction((a) => acts.push(a))
  try {
    fn()
  } finally {
    off()
  }
  return acts
}

/** Feed a half-sine swing on gyro X (peak deg/s) lasting `durMs`, sampled every `stepMs`, then `restMs` of stillness. */
function swing(dev: typeof dev0, opts: { t0: number; durMs: number; peak: number; stepMs: number; restMs: number; roll?: (phase: number) => number }): number {
  let t = opts.t0
  for (; t <= opts.t0 + opts.durMs; t += opts.stepMs) {
    const phase = (t - opts.t0) / opts.durMs
    const rate = opts.peak * Math.sin(Math.PI * phase)
    dev.feed(encodeMotionPacket({ gyro: { x: rate }, roll: opts.roll ? opts.roll(phase) : 180 }), t)
  }
  const end = opts.t0 + opts.durMs + opts.restMs
  for (; t <= end; t += opts.stepMs) dev.feed(encodeMotionPacket({ gyro: { x: 0 }, roll: opts.roll ? opts.roll(0) : 180 }), t)
  return t
}

function resetAll() {
  dev0.detachExternal()
  dev1.detachExternal()
  dev0.setRole('both')
  dev1.setRole('fret')
  dev0.setCentre(null)
  dev1.setCentre(null)
  AiroMoteInput.setSettings({ strumAxis: 'x', strumThreshold: 220, invertStrum: false, bendEnabled: true, chordTwist: true, buttonMute: true, fretMode: 'lead', leadMaxFret: 12, leadPitchSpan: 60, leadRollSpan: 60, legatoOnMove: true })
  store.set({ frets: [0, 0, 0, 0, 0, 0], ringing: [false, false, false, false, false, false], pluckStamp: [0, 0, 0, 0, 0, 0], bend: 0, vibrato: false, palmMute: false })
}

describe('neutral pose (centre) capture', () => {
  beforeEach(resetAll)

  it('averages the first stationary packets wrap-safely with roll resting near +-178', () => {
    dev0.attachExternal('sim')
    expect(dev0.centre).toBeNull()
    const acts = record(() => {
      for (let i = 0; i < 30; i++) {
        // the upside-down sensor jitters between +178 and -178 at rest
        const roll = i % 2 ? 178 : -178
        dev0.feed(encodeMotionPacket({ pitch: 0.5, roll, stationary: true }), i * 10)
      }
    })
    expect(dev0.centre).not.toBeNull()
    expect(Math.abs(angleDelta(dev0.centre!.roll, 180))).toBeLessThan(1)
    expect(dev0.centre!.pitch).toBeCloseTo(0.5, 1)
    expect(dev0.status.centre).toEqual(dev0.centre)
    // no bend was ever emitted while resting, before or after the capture
    expect(acts.filter((a) => a.type === 'BEND' && a.amount > 0).length).toBe(0)
    // the centre is persisted per slot
    expect(AiroMoteInput.currentSettings.centres[0]).toEqual(dev0.centre)
    expect(AiroMoteInput.currentSettings.centres[1]).toBeNull()
  })

  it('falls back to all packets when the firmware never flags stationary', () => {
    dev0.attachExternal('sim')
    for (let i = 0; i < 60; i++) dev0.feed(encodeMotionPacket({ pitch: 2, roll: 179 }), i * 10)
    expect(dev0.centre).not.toBeNull()
    expect(Math.abs(angleDelta(dev0.centre!.roll, 179))).toBeLessThan(0.5)
  })

  it('bends relative to the captured centre, not to 0', () => {
    dev0.attachExternal('sim')
    for (let i = 0; i < 30; i++) dev0.feed(encodeMotionPacket({ roll: 178, stationary: true }), i * 10)
    const rest = record(() => dev0.feed(encodeMotionPacket({ roll: -179 }), 400))
    expect(rest.filter((a) => a.type === 'BEND').length).toBe(0)
    const bent = record(() => dev0.feed(encodeMotionPacket({ roll: 178 + 50 - 360 }), 500)) // 50 deg past the centre
    const bend = bent.find((a) => a.type === 'BEND')
    expect(bend && bend.type === 'BEND' && bend.amount).toBeCloseTo(1.3, 1)
    const back = record(() => dev0.feed(encodeMotionPacket({ roll: 178 }), 600))
    expect(back.some((a) => a.type === 'BEND' && a.amount === 0)).toBe(true)
  })

  it('keeps an existing centre across reconnects and "Set centre here" replaces it', () => {
    dev0.setCentre({ pitch: 0, roll: 170 })
    dev0.attachExternal('sim')
    for (let i = 0; i < 60; i++) dev0.feed(encodeMotionPacket({ roll: -170, stationary: true }), i * 10)
    expect(dev0.centre!.roll).toBe(170)
    dev0.calibrateLead()
    expect(dev0.centre!.roll).toBe(-170)
  })
})

describe('strum detection (signed peak, rate independent)', () => {
  beforeEach(() => {
    resetAll()
    dev0.setCentre({ pitch: 0, roll: 180 })
    dev0.attachExternal('sim')
  })

  for (const hz of [30, 110]) {
    it(`a 150 ms swing fires exactly one strum at ${hz} packets/s`, () => {
      const stepMs = 1000 / hz
      const acts = record(() => swing(dev0, { t0: 100, durMs: 150, peak: 600, stepMs, restMs: 300 }))
      const strums = acts.filter((a) => a.type === 'STRUM_DOWN' || a.type === 'STRUM_UP')
      expect(strums.length).toBe(1)
      expect(strums[0].type).toBe('STRUM_DOWN')
      // fired at (or just after) the peak, not at the end of the swing
      expect(strums[0].type === 'STRUM_DOWN' && (strums[0].strength ?? 0)).toBeGreaterThan(0.9)
    })

    it(`two swings in the same direction both fire at ${hz} packets/s`, () => {
      const stepMs = 1000 / hz
      const acts = record(() => {
        const t = swing(dev0, { t0: 100, durMs: 150, peak: 500, stepMs, restMs: 120 })
        swing(dev0, { t0: t, durMs: 150, peak: 500, stepMs, restMs: 120 })
      })
      expect(acts.filter((a) => a.type === 'STRUM_DOWN').length).toBe(2)
      expect(acts.filter((a) => a.type === 'STRUM_UP').length).toBe(0)
    })
  }

  it('alternating down/up strokes at 8 per second are all detected at 30 packets/s', () => {
    const acts = record(() => {
      // gyro.x = 600 sin(2 pi 4 t): 4 full cycles = 8 strokes in one second
      for (let t = 12; t <= 1012; t += 33) {
        dev0.feed(encodeMotionPacket({ gyro: { x: 600 * Math.sin(2 * Math.PI * 4 * (t / 1000)) }, roll: 180 }), t)
      }
    })
    const strums = acts.filter((a) => a.type === 'STRUM_DOWN' || a.type === 'STRUM_UP').map((a) => a.type)
    expect(strums.length).toBe(8)
    for (let i = 1; i < strums.length; i++) expect(strums[i]).not.toBe(strums[i - 1])
  })

  it('the stopping rebound of a stroke does not fire a second strum', () => {
    const acts = record(() => {
      const samples = [0, 300, 550, 400, 150, -90, -60, -20, 0, 0, 0, 0, 0, 0, 0, 0]
      samples.forEach((x, i) => dev0.feed(encodeMotionPacket({ gyro: { x }, roll: 180 }), 100 + i * 33))
    })
    expect(acts.filter((a) => a.type === 'STRUM_DOWN' || a.type === 'STRUM_UP').length).toBe(1)
  })
})

describe('bend / strum axis separation', () => {
  beforeEach(() => {
    resetAll()
    dev0.setCentre({ pitch: 0, roll: 180 })
    dev0.attachExternal('sim')
  })

  it('emits no bend during a strum swing that also rolls the wrist (shared X axis)', () => {
    const acts = record(() => {
      // roll rises to 60 deg past the centre in the middle of the swing and comes back
      swing(dev0, { t0: 100, durMs: 150, peak: 600, stepMs: 9, restMs: 400, roll: (p) => 180 + 60 * Math.sin(Math.PI * p) })
    })
    expect(acts.filter((a) => a.type === 'STRUM_DOWN').length).toBe(1)
    expect(acts.filter((a) => a.type === 'BEND').length).toBe(0)
  })

  it('still bends when the wrist is rolled while the strum hand is at rest', () => {
    const acts = record(() => {
      for (let i = 0; i < 10; i++) dev0.feed(encodeMotionPacket({ roll: 180 + 50 }), 1000 + i * 10)
    })
    expect(acts.some((a) => a.type === 'BEND' && a.amount > 1)).toBe(true)
  })
})

describe('lead mode lifecycle', () => {
  beforeEach(() => {
    resetAll()
    dev1.setCentre({ pitch: 0, roll: 0 })
    dev1.attachExternal('sim-fret')
    dev0.attachExternal('sim-strum')
    dev0.setCentre({ pitch: 0, roll: 0 })
  })

  it('restores the strings it muted when the role changes, and clears the tracked position', () => {
    for (let i = 0; i < 10; i++) dev1.feed(encodeMotionPacket({ pitch: 10, roll: 0 }), i * 10)
    expect(dev1.status.lead).not.toBeNull()
    expect(store.get().frets.filter((f) => f === -1).length).toBe(5)
    dev1.setRole('strum')
    expect(store.get().frets).toEqual([0, 0, 0, 0, 0, 0])
    expect(dev1.status.lead).toBeNull()
  })

  it('restores the strings when lead mode is switched off in the settings', () => {
    for (let i = 0; i < 10; i++) dev1.feed(encodeMotionPacket({ pitch: 10, roll: 0 }), i * 10)
    expect(store.get().frets.filter((f) => f === -1).length).toBe(5)
    AiroMoteInput.setSettings({ fretMode: 'chords' })
    expect(store.get().frets).toEqual([0, 0, 0, 0, 0, 0])
    expect(dev1.status.lead).toBeNull()
  })

  it('restores the strings on disconnect and does not clobber a fingering the user changed', () => {
    for (let i = 0; i < 10; i++) dev1.feed(encodeMotionPacket({ pitch: 10, roll: 0 }), i * 10)
    // the user re-fretted one of the muted strings by hand in the meantime
    InputManager.dispatch({ type: 'FRET_NOTE', string: 0, fret: 3, play: false }, 'mouse')
    dev1.detachExternal()
    const frets = store.get().frets
    expect(frets[0]).toBe(3)
    expect(frets.filter((f) => f === -1).length).toBe(0)
  })

  it('the fret-hand button holds vibrato in lead mode', () => {
    dev1.feed(encodeMotionPacket({ button: true }), 10)
    expect(store.get().vibrato).toBe(true)
    dev1.feed(encodeMotionPacket({ button: false }), 20)
    expect(store.get().vibrato).toBe(false)
  })
})

describe('role assignment', () => {
  beforeEach(resetAll)

  it('splits two connected devices into strum/fret and returns a lone survivor to both', () => {
    dev0.attachExternal('a')
    expect(dev0.status.role).toBe('both')
    dev1.attachExternal('b')
    expect(dev0.status.role).toBe('strum')
    expect(dev1.status.role).toBe('fret')
    dev1.detachExternal()
    expect(dev0.status.role).toBe('both')
    dev1.attachExternal('b')
    expect(dev0.status.role).toBe('strum')
    dev0.detachExternal()
    expect(dev1.status.role).toBe('both')
  })
})
