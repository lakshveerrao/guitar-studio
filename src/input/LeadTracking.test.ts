import { beforeEach, describe, expect, it } from 'vitest'
import { AiroMoteInput, encodeMotionPacket } from './AiroMoteInput'
import { InputManager } from './InputManager'
import { store } from '../state/store'
import { GuitarController } from './GuitarController'
void GuitarController
import type { Action } from '../types'

const dev = AiroMoteInput.device(1)

function feed(pitch: number, roll: number, t: number) {
  dev.feed(encodeMotionPacket({ pitch, roll }), t)
}

describe('lead-mode fret tracking', () => {
  beforeEach(() => {
    AiroMoteInput.setSettings({ fretMode: 'lead', leadMaxFret: 12, leadPitchSpan: 60, leadRollSpan: 60, legatoOnMove: true })
    dev.setRole('fret')
    dev.leaveLead() // forget whatever the previous test tracked
    // the neutral pose is per device; nothing is tracked until it is known
    dev.setCentre({ pitch: 0, roll: 0 })
    store.set({ frets: [0, 0, 0, 0, 0, 0], ringing: [false, false, false, false, false, false], pluckStamp: [0, 0, 0, 0, 0, 0] })
  })

  it('tilt walks the hand along the neck and roll picks the string', () => {
    const acts: Action[] = []
    const off = InputManager.onAction((a) => acts.push(a))
    // settle at centre: fret 6 on the G string (index 3 of 0..5 -> 1-rollT maps 0.5 -> 2.5 -> round 3)
    for (let i = 0; i < 20; i++) feed(0, 0, i * 10)
    let lead = dev.status.lead!
    expect(lead.fret).toBe(6)
    // tilt fully forward -> highest fret; roll fully one way -> outer string
    for (let i = 0; i < 25; i++) feed(30, 30, 300 + i * 10)
    lead = dev.status.lead!
    expect(lead.fret).toBe(12)
    expect(lead.string).toBe(0)
    const frets = store.get().frets
    expect(frets[0]).toBe(12)
    expect(frets.filter((f) => f === -1).length).toBe(5)
    off()
    // silent moves fret without sounding a note
    const played = acts.filter((a) => a.type === 'FRET_NOTE' && a.play)
    expect(played.length).toBe(0)
  })

  it('moving while the note rings triggers legato', () => {
    for (let i = 0; i < 20; i++) feed(0, 0, i * 10)
    const s = dev.status.lead!.string
    const ringing = [false, false, false, false, false, false]
    ringing[s] = true
    const pluckStamp = [0, 0, 0, 0, 0, 0]
    pluckStamp[s] = 400 // plucked shortly before the move, well inside the legato window
    store.set({ ringing, pluckStamp })
    const acts: Action[] = []
    const off = InputManager.onAction((a) => acts.push(a))
    for (let i = 0; i < 25; i++) feed(12, 0, 500 + i * 10) // slide up a couple of frets on the same string
    off()
    const legato = acts.filter((a) => a.type === 'FRET_NOTE' && a.play && a.string === s)
    expect(legato.length).toBeGreaterThan(0)
    // the request is legato-only: the engine must never turn it into a fresh pick
    expect(legato.every((a) => a.type === 'FRET_NOTE' && a.legatoOnly)).toBe(true)
  })

  it('does not ask for legato once the previous note is older than the legato window', () => {
    for (let i = 0; i < 20; i++) feed(0, 0, i * 10)
    const s = dev.status.lead!.string
    const ringing = [false, false, false, false, false, false]
    ringing[s] = true // the store still says ringing (strings decay for seconds) ...
    const pluckStamp = [0, 0, 0, 0, 0, 0]
    pluckStamp[s] = 0 // ... but the pluck is 2.5 s old
    store.set({ ringing, pluckStamp })
    const acts: Action[] = []
    const off = InputManager.onAction((a) => acts.push(a))
    for (let i = 0; i < 25; i++) feed(12, 0, 2500 + i * 10)
    off()
    const moved = acts.filter((a) => a.type === 'FRET_NOTE' && a.string === s && a.fret > 6)
    expect(moved.length).toBeGreaterThan(0)
    expect(moved.every((a) => a.type === 'FRET_NOTE' && a.play === false)).toBe(true)
  })

  it('holds its position until the centre is known and seeds from the first sample', () => {
    dev.setCentre(null)
    for (let i = 0; i < 10; i++) feed(25, 0, i * 10)
    expect(dev.status.lead).toBeNull()
    expect(store.get().frets).toEqual([0, 0, 0, 0, 0, 0])
    const acts: Action[] = []
    const off = InputManager.onAction((a) => acts.push(a))
    dev.setCentre({ pitch: 0, roll: 0 })
    feed(25, 0, 200) // far up the neck on the first packet
    off()
    // no walk from (low E, open): the very first fretting is already at the hand's position
    const fretted = acts.filter((a) => a.type === 'FRET_NOTE' && a.fret >= 0)
    expect(fretted.length).toBe(1)
    expect(fretted[0].type === 'FRET_NOTE' && fretted[0].fret).toBeGreaterThanOrEqual(10)
  })
})
