import { describe, expect, it } from 'vitest'
import { DEFAULT_BINDINGS, isGamepadBinding, sanitizeBindings } from './GamepadInput'

describe('gamepad binding validation', () => {
  it('drops corrupt entries and keeps the well-formed ones', () => {
    const cleaned = sanitizeBindings([
      null,
      1,
      'x',
      { action: 'STRUM_DOWN', kind: 'button', index: 0 },
      { action: 'NOPE', kind: 'button', index: 1 },
      { action: 'BEND', kind: 'axis', index: 3, direction: 'negative', threshold: 0.15 },
      { action: 'BEND', kind: 'axis', index: 'three' },
      { action: 'VIBRATO', kind: 'button', index: -1 },
      { action: 'PALM_MUTE', kind: 'button', index: NaN },
      { action: 'VIBRATO', kind: 'button', index: 2, threshold: 5 },
    ])
    expect(cleaned).toEqual([
      { action: 'STRUM_DOWN', kind: 'button', index: 0 },
      { action: 'BEND', kind: 'axis', index: 3, direction: 'negative', threshold: 0.15 },
    ])
  })

  it('falls back to the defaults when nothing usable is stored', () => {
    expect(sanitizeBindings([null])).toEqual(DEFAULT_BINDINGS)
    expect(sanitizeBindings('garbage')).toEqual(DEFAULT_BINDINGS)
    expect(sanitizeBindings(undefined)).toEqual(DEFAULT_BINDINGS)
  })

  it('accepts every default binding', () => {
    expect(DEFAULT_BINDINGS.every(isGamepadBinding)).toBe(true)
  })
})
