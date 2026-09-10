import { describe, expect, it } from 'vitest'
import { DEFAULT_MOTION_SETTINGS, MOTION_SETTINGS_KEY, MOTION_SETTINGS_KEY_V1, decodeMotionPacket, encodeMotionPacket, loadMotionSettings, sanitizeMotionSettings } from './AiroMoteInput'

describe('AiroMote packet codec', () => {
  it('round-trips a motion packet', () => {
    const b = encodeMotionPacket({ gyro: { x: 312.5, y: -20, z: 5 }, accel: { x: 0.1, y: -0.2, z: 0.98 }, pitch: 12.34, roll: -45.6, button: true, battery: 77, stationary: true, timestamp: 123456 })
    const s = decodeMotionPacket(b, 1000)
    expect(s).not.toBeNull()
    expect(s!.gyro.x).toBeCloseTo(312.5, 1)
    expect(s!.gyro.y).toBeCloseTo(-20, 1)
    expect(s!.accel.z).toBeCloseTo(0.98, 2)
    expect(s!.pitch).toBeCloseTo(12.34, 2)
    expect(s!.roll).toBeCloseTo(-45.6, 2)
    expect(s!.button).toBe(true)
    expect(s!.stationary).toBe(true)
    expect(s!.timestamp).toBe(123456)
    expect(s!.battery).toBe(77)
  })
  it('decodes the status bits independently (bit 2 stationary, bit 5 button)', () => {
    const s = decodeMotionPacket(encodeMotionPacket({ button: true }), 0)!
    expect(s.button).toBe(true)
    expect(s.stationary).toBe(false)
    const still = decodeMotionPacket(encodeMotionPacket({ stationary: true }), 0)!
    expect(still.button).toBe(false)
    expect(still.stationary).toBe(true)
  })
  it('rejects corrupt packets', () => {
    const b = encodeMotionPacket({ gyro: { x: 100 } })
    b[20] ^= 0xff
    expect(decodeMotionPacket(b, 0)).toBeNull()
    expect(decodeMotionPacket(b.subarray(0, 31), 0)).toBeNull()
  })
})

function memoryStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init))
  return {
    map: m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  }
}

describe('motion settings persistence', () => {
  it('falls back to the defaults for corrupt JSON and repairs the stored value', () => {
    const st = memoryStorage({ [MOTION_SETTINGS_KEY]: '{not json' })
    const s = loadMotionSettings(st)
    expect(s).toEqual(DEFAULT_MOTION_SETTINGS)
    expect(JSON.parse(st.map.get(MOTION_SETTINGS_KEY)!)).toEqual(DEFAULT_MOTION_SETTINGS)
  })

  it('validates every field by type and range, never producing NaN', () => {
    const s = sanitizeMotionSettings({
      strumThreshold: 'fast',
      strumAxis: 'w',
      leadPitchSpan: 0,
      leadRollSpan: Infinity,
      leadMaxFret: 99,
      fretMode: 'solo',
      customServiceUuid: null,
      bendEnabled: 'yes',
      centres: [{ pitch: 1, roll: 190 }, 'bad'],
    })
    expect(s.strumThreshold).toBe(220)
    expect(s.strumAxis).toBe('x')
    expect(s.leadPitchSpan).toBe(70)
    expect(s.leadRollSpan).toBe(60)
    expect(s.leadMaxFret).toBe(12)
    expect(s.fretMode).toBe('lead')
    expect(s.customServiceUuid).toBe('')
    expect(s.bendEnabled).toBe(true)
    expect(s.centres).toEqual([{ pitch: 1, roll: -170 }, null])
    for (const v of Object.values(s)) if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true)
  })

  it('keeps valid stored values', () => {
    const st = memoryStorage({ [MOTION_SETTINGS_KEY]: JSON.stringify({ strumThreshold: 300, strumAxis: 'y', fretMode: 'chords', centres: [null, { pitch: 2, roll: 178 }] }) })
    const s = loadMotionSettings(st)
    expect(s.strumThreshold).toBe(300)
    expect(s.strumAxis).toBe('y')
    expect(s.fretMode).toBe('chords')
    expect(s.centres[1]).toEqual({ pitch: 2, roll: 178 })
  })

  it('migrates the old v1 key and removes it', () => {
    const st = memoryStorage({ [MOTION_SETTINGS_KEY_V1]: JSON.stringify({ strumThreshold: 280, invertStrum: true, strumAxis: 'z' }) })
    const s = loadMotionSettings(st)
    expect(s.strumThreshold).toBe(280)
    expect(s.invertStrum).toBe(true)
    expect(s.strumAxis).toBe('z')
    expect(st.map.has(MOTION_SETTINGS_KEY_V1)).toBe(false)
    expect(JSON.parse(st.map.get(MOTION_SETTINGS_KEY)!).strumThreshold).toBe(280)
  })

  it('migrates a calibrated global centre from before per-slot centres existed', () => {
    const s = sanitizeMotionSettings({ leadPitchCentre: 1.5, leadRollCentre: 178 })
    expect(s.centres).toEqual([
      { pitch: 1.5, roll: 178 },
      { pitch: 1.5, roll: 178 },
    ])
    expect(sanitizeMotionSettings({ leadPitchCentre: 0, leadRollCentre: 0 }).centres).toEqual([null, null])
  })

  it('survives a storage that throws', () => {
    const s = loadMotionSettings({
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    })
    expect(s).toEqual(DEFAULT_MOTION_SETTINGS)
  })
})
