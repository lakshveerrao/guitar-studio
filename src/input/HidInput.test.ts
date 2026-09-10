import { describe, expect, it } from 'vitest'
import { itemUsages, layoutFor } from './HidInput'

const BUTTON_PAGE = 0x09 << 16
const GENERIC_PAGE = 0x01 << 16

describe('HID report descriptor parsing', () => {
  it('parses buttons declared as a usage range given only usageMinimum / usageMaximum', () => {
    const counters = { buttons: 0, axes: 0 }
    const layout = layoutFor(
      [
        { isRange: true, usageMinimum: BUTTON_PAGE | 1, usageMaximum: BUTTON_PAGE | 12, reportSize: 1, reportCount: 12, logicalMinimum: 0, logicalMaximum: 1 },
        { isConstant: true, reportSize: 4, reportCount: 1, logicalMinimum: 0, logicalMaximum: 0 },
        { isRange: true, usageMinimum: GENERIC_PAGE | 0x30, usageMaximum: GENERIC_PAGE | 0x31, reportSize: 8, reportCount: 2, logicalMinimum: 0, logicalMaximum: 255 },
      ],
      counters,
    )
    expect(layout.buttonCount).toBe(12)
    expect(layout.axisCount).toBe(2)
    expect(layout.fields.map((f) => f.kind)).toEqual(['button', 'skip', 'axis'])
    expect(layout.fields[2].bitOffset).toBe(16)
  })

  it('parses buttons declared as a usage range that the browser already expanded into usages[]', () => {
    const counters = { buttons: 0, axes: 0 }
    const layout = layoutFor(
      [
        { isRange: true, usages: Array.from({ length: 8 }, (_, i) => BUTTON_PAGE | (i + 1)), reportSize: 1, reportCount: 8, logicalMinimum: 0, logicalMaximum: 1 },
        { isRange: false, usages: [GENERIC_PAGE | 0x39], reportSize: 4, reportCount: 1, logicalMinimum: 0, logicalMaximum: 7 },
      ],
      counters,
    )
    expect(layout.buttonCount).toBe(12) // 8 buttons + 4 hat directions
    expect(layout.fields.map((f) => f.kind)).toEqual(['button', 'hat'])
  })

  it('treats a Button-page item as buttons regardless of isRange, and honours an explicit usagePage', () => {
    expect(itemUsages({ isRange: false, usages: [BUTTON_PAGE | 1], reportSize: 1, reportCount: 1, logicalMinimum: 0, logicalMaximum: 1 })).toEqual({ page: 9, usages: [1] })
    expect(itemUsages({ usagePage: 9, usageMinimum: 1, usageMaximum: 3, reportSize: 1, reportCount: 3, logicalMinimum: 0, logicalMaximum: 1 })).toEqual({ page: 9, usages: [1, 2, 3] })
    const counters = { buttons: 0, axes: 0 }
    const layout = layoutFor([{ isRange: true, usagePage: 9, usageMinimum: 1, usageMaximum: 16, reportSize: 1, reportCount: 16, logicalMinimum: 0, logicalMaximum: 1 }], counters)
    expect(layout.buttonCount).toBe(16)
  })

  it('skips items with no usage information', () => {
    const counters = { buttons: 0, axes: 0 }
    const layout = layoutFor([{ reportSize: 8, reportCount: 1, logicalMinimum: 0, logicalMaximum: 255 }], counters)
    expect(layout.fields[0].kind).toBe('skip')
    expect(layout.buttonCount).toBe(0)
  })
})
