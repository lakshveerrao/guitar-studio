import { describe, expect, it } from 'vitest'
import { decodeMotionPacket, encodeMotionPacket } from './AiroMoteInput'

describe('AiroMote packet codec', () => {
  it('round-trips a motion packet', () => {
    const b = encodeMotionPacket({ gyro: { x: 312.5, y: -20, z: 5 }, accel: { x: 0.1, y: -0.2, z: 0.98 }, pitch: 12.34, roll: -45.6, button: true, battery: 77 })
    const s = decodeMotionPacket(b, 1000)
    expect(s).not.toBeNull()
    expect(s!.gyro.x).toBeCloseTo(312.5, 1)
    expect(s!.gyro.y).toBeCloseTo(-20, 1)
    expect(s!.accel.z).toBeCloseTo(0.98, 2)
    expect(s!.pitch).toBeCloseTo(12.34, 2)
    expect(s!.roll).toBeCloseTo(-45.6, 2)
    expect(s!.button).toBe(true)
    expect(s!.battery).toBe(77)
  })
  it('rejects corrupt packets', () => {
    const b = encodeMotionPacket({ gyro: { x: 100 } })
    b[20] ^= 0xff
    expect(decodeMotionPacket(b, 0)).toBeNull()
    expect(decodeMotionPacket(b.subarray(0, 31), 0)).toBeNull()
  })
})
