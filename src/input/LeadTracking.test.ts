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
    AiroMoteInput.setSettings({ fretMode: 'lead', leadMaxFret: 12, leadPitchSpan: 60, leadRollSpan: 60, leadPitchCentre: 0, leadRollCentre: 0, legatoOnMove: true })
    dev.setRole('fret')
    store.set({ frets: [0, 0, 0, 0, 0, 0], ringing: [false, false, false, false, false, false] })
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
    store.set({ ringing })
    const acts: Action[] = []
    const off = InputManager.onAction((a) => acts.push(a))
    for (let i = 0; i < 25; i++) feed(12, 0, 500 + i * 10) // slide up a couple of frets on the same string
    off()
    const legato = acts.filter((a) => a.type === 'FRET_NOTE' && a.play && a.string === s)
    expect(legato.length).toBeGreaterThan(0)
  })
})
