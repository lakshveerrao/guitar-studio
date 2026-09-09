import { store } from '../state/store'
import { GamepadInput } from './GamepadInput'
import { AiroMoteInput } from './AiroMoteInput'

/**
 * WebHID input: connect / disconnect a Bluetooth (or USB) HID controller directly.
 *
 * Input reports are parsed with the device's own report descriptor
 * (navigator.hid exposes it as `collections[].inputReports[].items`):
 *   usage page 0x09 (Button)          -> buttons[]
 *   usage page 0x01 (Generic Desktop) -> axes[] for X/Y/Z/Rx/Ry/Rz/Slider/Dial/Wheel, hat switch -> dpad buttons
 * The result is fed through the same button/axis mappings as the Gamepad API,
 * so everything configured in the CONTROLLER tab applies to HID devices too.
 *
 * If a report starts with the AiroMote packet magic (0xA5) it is a future
 * AiroMote HID firmware streaming motion packets; those are handed to the
 * AiroMote gesture engine instead.
 */

export type HidState = 'unsupported' | 'disconnected' | 'connecting' | 'connected' | 'error'

export interface HidSnapshot {
  connected: boolean
  name: string
  vendorId: number
  productId: number
  buttons: number[]
  axes: number[]
  reports: number
}

type HidItem = {
  isRange?: boolean
  isConstant?: boolean
  hasNull?: boolean
  usagePage?: number
  usages?: number[]
  usageMinimum?: number
  usageMaximum?: number
  reportSize: number
  reportCount: number
  logicalMinimum: number
  logicalMaximum: number
}
type HidReportInfo = { reportId: number; items: HidItem[] }
type HidCollection = { usagePage: number; usage: number; inputReports: HidReportInfo[]; children: HidCollection[] }
type HidDeviceLike = {
  opened: boolean
  productName: string
  vendorId: number
  productId: number
  collections: HidCollection[]
  open(): Promise<void>
  close(): Promise<void>
  forget?: () => Promise<void>
  addEventListener(type: 'inputreport', fn: (ev: { reportId: number; data: DataView }) => void): void
  removeEventListener(type: 'inputreport', fn: (ev: { reportId: number; data: DataView }) => void): void
}
type HidLike = {
  requestDevice(opts: { filters: Array<Record<string, unknown>> }): Promise<HidDeviceLike[]>
  getDevices(): Promise<HidDeviceLike[]>
  addEventListener(type: 'disconnect', fn: (ev: { device: HidDeviceLike }) => void): void
}

const USAGE_PAGE_GENERIC = 0x01
const USAGE_PAGE_BUTTON = 0x09
const AXIS_USAGES = [0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38] // X Y Z Rx Ry Rz Slider Dial Wheel
const USAGE_HAT = 0x39

interface Field {
  kind: 'button' | 'axis' | 'hat' | 'skip'
  index: number // button or axis index
  bitOffset: number
  size: number
  count: number
  min: number
  max: number
}

interface ReportLayout {
  fields: Field[]
  buttonCount: number
  axisCount: number
}

/** Walk a report descriptor into bit-level fields for one report id. */
function layoutFor(items: HidItem[], counters: { buttons: number; axes: number }): ReportLayout {
  const fields: Field[] = []
  let bit = 0
  for (const it of items) {
    const size = it.reportSize
    const count = it.reportCount
    if (it.isConstant) {
      fields.push({ kind: 'skip', index: 0, bitOffset: bit, size, count, min: 0, max: 0 })
      bit += size * count
      continue
    }
    const usages = it.isRange && it.usageMinimum !== undefined && it.usageMaximum !== undefined
      ? Array.from({ length: it.usageMaximum - it.usageMinimum + 1 }, (_, i) => (it.usageMinimum as number) + i)
      : (it.usages ?? []).map((u) => u & 0xffff)
    const page = it.usagePage ?? (usages.length ? (it.usages ?? [])[0] >>> 16 : 0)
    if (page === USAGE_PAGE_BUTTON || (usages.length && (it.usages ?? [])[0] >>> 16 === USAGE_PAGE_BUTTON)) {
      fields.push({ kind: 'button', index: counters.buttons, bitOffset: bit, size, count, min: it.logicalMinimum, max: it.logicalMaximum })
      counters.buttons += count
    } else if (page === USAGE_PAGE_GENERIC && usages.some((u) => u === USAGE_HAT)) {
      fields.push({ kind: 'hat', index: counters.buttons, bitOffset: bit, size, count, min: it.logicalMinimum, max: it.logicalMaximum })
      counters.buttons += 4 // up right down left
    } else if (page === USAGE_PAGE_GENERIC && usages.some((u) => AXIS_USAGES.includes(u))) {
      fields.push({ kind: 'axis', index: counters.axes, bitOffset: bit, size, count, min: it.logicalMinimum, max: it.logicalMaximum })
      counters.axes += count
    } else {
      fields.push({ kind: 'skip', index: 0, bitOffset: bit, size, count, min: 0, max: 0 })
    }
    bit += size * count
  }
  return { fields, buttonCount: counters.buttons, axisCount: counters.axes }
}

function readBits(data: DataView, bitOffset: number, size: number, signed: boolean): number {
  let value = 0
  for (let i = 0; i < size; i++) {
    const b = bitOffset + i
    const byte = b >> 3
    if (byte >= data.byteLength) break
    const bitVal = (data.getUint8(byte) >> (b & 7)) & 1
    value |= bitVal << i
  }
  if (signed && size < 32 && value & (1 << (size - 1))) value -= 1 << size
  return value
}

class HidInputImpl {
  private device: HidDeviceLike | null = null
  private layouts = new Map<number, ReportLayout>()
  private snapshot: HidSnapshot = { connected: false, name: '', vendorId: 0, productId: 0, buttons: [], axes: [], reports: 0 }
  private listeners = new Set<(s: HidSnapshot) => void>()
  private listening = false

  get supported(): boolean {
    return typeof navigator !== 'undefined' && 'hid' in navigator && typeof window !== 'undefined' && window.isSecureContext
  }

  get current(): HidSnapshot {
    return this.snapshot
  }

  onSnapshot(fn: (s: HidSnapshot) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** Must run from a user gesture: opens the browser HID picker. */
  async connect(): Promise<void> {
    if (!this.supported) {
      this.setState('unsupported', 'WebHID needs Chrome or Edge over HTTPS.')
      return
    }
    this.setState('connecting')
    try {
      const hid = (navigator as unknown as { hid: HidLike }).hid
      const devices = await hid.requestDevice({
        // gamepads, joysticks and multi-axis controllers on the Generic Desktop page
        filters: [
          { usagePage: USAGE_PAGE_GENERIC, usage: 0x05 },
          { usagePage: USAGE_PAGE_GENERIC, usage: 0x04 },
          { usagePage: USAGE_PAGE_GENERIC, usage: 0x08 },
        ],
      })
      if (!devices.length) {
        this.setState('disconnected')
        return
      }
      await this.open(devices[0])
    } catch (e) {
      const msg = (e as Error).message || 'Could not connect'
      if (/cancel|No device selected/i.test(msg)) this.setState('disconnected')
      else this.setState('error', msg)
    }
  }

  /** Re-open a previously permitted device without the picker (page reload). */
  async reconnectPermitted(): Promise<boolean> {
    if (!this.supported) return false
    try {
      const hid = (navigator as unknown as { hid: HidLike }).hid
      const devices = await hid.getDevices()
      if (!devices.length) return false
      await this.open(devices[0])
      return true
    } catch {
      return false
    }
  }

  async disconnect(): Promise<void> {
    const d = this.device
    this.device = null
    if (d) {
      d.removeEventListener('inputreport', this.onReport)
      try {
        if (d.opened) await d.close()
      } catch {
        /* ignore */
      }
    }
    this.releaseAll()
    this.snapshot = { ...this.snapshot, connected: false, buttons: [], axes: [] }
    this.emit()
    this.setState('disconnected')
  }

  async forget(): Promise<void> {
    const d = this.device
    await this.disconnect()
    try {
      await d?.forget?.()
    } catch {
      /* not supported everywhere */
    }
    this.snapshot = { connected: false, name: '', vendorId: 0, productId: 0, buttons: [], axes: [], reports: 0 }
    store.set({ hidName: null })
    this.emit()
  }

  private async open(device: HidDeviceLike) {
    if (this.device && this.device !== device) await this.disconnect()
    if (!device.opened) await device.open()
    this.device = device
    this.layouts.clear()
    const counters = { buttons: 0, axes: 0 }
    const visit = (c: HidCollection) => {
      for (const r of c.inputReports ?? []) this.layouts.set(r.reportId, layoutFor(r.items, counters))
      for (const ch of c.children ?? []) visit(ch)
    }
    device.collections.forEach(visit)
    device.addEventListener('inputreport', this.onReport)
    this.snapshot = {
      connected: true,
      name: device.productName || `HID ${device.vendorId.toString(16)}:${device.productId.toString(16)}`,
      vendorId: device.vendorId,
      productId: device.productId,
      buttons: Array(counters.buttons).fill(0),
      axes: Array(counters.axes).fill(0),
      reports: 0,
    }
    if (!this.listening) {
      this.listening = true
      ;(navigator as unknown as { hid: HidLike }).hid.addEventListener('disconnect', (ev) => {
        if (ev.device === this.device) void this.disconnect()
      })
    }
    store.set({ hidName: this.snapshot.name })
    this.setState('connected')
    this.emit()
  }

  private onReport = (ev: { reportId: number; data: DataView }) => {
    const data = ev.data
    // AiroMote motion packets over HID: hand to the motion engine
    if (data.byteLength >= 32 && data.getUint8(0) === 0xa5) {
      AiroMoteInput.device(0).feed(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
      return
    }
    const layout = this.layouts.get(ev.reportId) ?? this.layouts.get(0)
    if (!layout) return
    const buttons = this.snapshot.buttons.slice()
    const axes = this.snapshot.axes.slice()
    for (const f of layout.fields) {
      if (f.kind === 'skip') continue
      for (let i = 0; i < f.count; i++) {
        const raw = readBits(data, f.bitOffset + i * f.size, f.size, f.min < 0)
        if (f.kind === 'button') buttons[f.index + i] = raw ? 1 : 0
        else if (f.kind === 'axis') {
          const range = f.max - f.min || 1
          axes[f.index + i] = ((raw - f.min) / range) * 2 - 1
        } else if (f.kind === 'hat') {
          // 0..7 clockwise from up; out of range = centred
          const dir = raw - f.min
          const centred = dir < 0 || dir > 7
          const up = !centred && (dir === 7 || dir === 0 || dir === 1)
          const right = !centred && dir >= 1 && dir <= 3
          const down = !centred && dir >= 3 && dir <= 5
          const left = !centred && dir >= 5 && dir <= 7
          buttons[f.index] = up ? 1 : 0
          buttons[f.index + 1] = right ? 1 : 0
          buttons[f.index + 2] = down ? 1 : 0
          buttons[f.index + 3] = left ? 1 : 0
        }
      }
    }
    this.snapshot = { ...this.snapshot, buttons, axes, reports: this.snapshot.reports + 1 }
    this.emit()
    GamepadInput.processExternal('hid', buttons, axes)
  }

  private releaseAll() {
    GamepadInput.processExternal('hid', this.snapshot.buttons.map(() => 0), this.snapshot.axes.map(() => 0))
  }

  private setState(state: HidState, error?: string) {
    store.set({ hidState: state, hidError: error ?? null })
  }

  private emit() {
    this.listeners.forEach((l) => l(this.snapshot))
  }
}

export const HidInput = new HidInputImpl()
if (import.meta.env.DEV && typeof window !== 'undefined') (window as unknown as { __hid: HidInputImpl }).__hid = HidInput
