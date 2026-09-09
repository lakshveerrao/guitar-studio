import { InputManager } from './InputManager'
import { store } from '../state/store'
import type { StringIndex } from '../types'

/**
 * AiroMote ESP32 motion controllers over Web Bluetooth. Up to two devices.
 *
 * Protocol (kept in sync with the AiroMote firmware / @aero/protocol):
 *   32-byte packets, magic 0xA5, version 1, CRC-16/CCITT-FALSE over bytes 0..29
 *   MOTION (0x01): accel i16 milli-g @12, gyro i16 tenths deg/s @18,
 *                  pitch/roll i16 hundredths deg @24/26, battery u8 @28
 *   status byte @4: bit5 = button pressed
 *
 * Gesture mapping per device role (device-agnostic Actions go through InputManager):
 *   strum hand : swing down / up (gyro) -> STRUM_DOWN / STRUM_UP, button -> PALM_MUTE
 *   fret hand  : wrist roll -> BEND, quick twist -> NEXT/PREV chord, button -> VIBRATO
 *   both       : all of the above on one device (button = palm mute)
 */

export const BLE_SERVICE_UUID = '7a3e0001-4d6f-7469-6f6e-416572304d43'
export const BLE_TX_CHAR_UUID = '7a3e0002-4d6f-7469-6f6e-416572304d43'
export const BLE_RX_CHAR_UUID = '7a3e0003-4d6f-7469-6f6e-416572304d43'
export const BLE_NAME_PREFIX = 'AiroMote-'
/** Nordic UART service, common on ESP32 / Arduino BLE sketches */
export const NUS_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e'
export const NUS_TX_CHAR_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'
const BATTERY_SERVICE_UUID = '0000180f-0000-1000-8000-00805f9b34fb'
const DEVICE_INFO_SERVICE_UUID = '0000180a-0000-1000-8000-00805f9b34fb'
export type BleProtocol = 'airomote' | 'uart' | 'raw' | null
export const MAX_DEVICES = 2
const PACKET_SIZE = 32
const MAGIC = 0xa5
const TYPE_MOTION = 0x01
const FLAG_BUTTON = 1 << 5

export type MotionState = 'unsupported' | 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error'
export type MotionRole = 'both' | 'strum' | 'fret'
/** What a dedicated fret-hand controller does: step through chords, or track the hand along the neck. */
export type FretMode = 'chords' | 'lead'

export interface MotionSample {
  gyro: { x: number; y: number; z: number } // deg/s
  accel: { x: number; y: number; z: number } // g
  pitch: number // deg
  roll: number // deg
  button: boolean
  battery: number | null
  receivedAt: number
}

export interface MotionSettings {
  acceptAllDevices: boolean // show every Bluetooth device in the picker
  customServiceUuid: string // optional extra GATT service to subscribe to
  strumThreshold: number // deg/s that fires a strum (default 220)
  strumAxis: 'x' | 'y' | 'z' // gyro axis used for the strum swing
  invertStrum: boolean
  bendEnabled: boolean
  chordTwist: boolean
  buttonMute: boolean
  fretMode: FretMode
  leadMaxFret: number // highest fret reachable by tilting (5..22)
  leadPitchSpan: number // degrees of tilt that cover the whole range
  leadRollSpan: number // degrees of roll that cover the six strings
  leadPitchCentre: number // calibrated neutral tilt
  leadRollCentre: number // calibrated neutral roll
  legatoOnMove: boolean // moving while a note rings plays hammer-on / pull-off
}

export interface MotionDeviceStatus {
  state: MotionState
  name: string | null
  error: string | null
  role: MotionRole
  battery: number | null
  protocol: BleProtocol
  lastRaw: string | null // hex of the latest notification when the protocol is not AiroMote
  packets: number
  lead: { string: number; fret: number } | null // tracked neck position in lead mode
}

const SETTINGS_KEY = 'guitar-studio.airomote.settings.v2'

function crc16(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffff
  for (let i = start; i < end; i++) {
    crc ^= bytes[i] << 8
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  return crc
}

/** Decode one 32-byte AiroMote packet; returns null for non-motion or corrupt packets. */
export function decodeMotionPacket(b: Uint8Array, receivedAt: number): MotionSample | null {
  if (b.length !== PACKET_SIZE || b[0] !== MAGIC) return null
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength)
  if (view.getUint16(PACKET_SIZE - 2, true) !== crc16(b, 0, PACKET_SIZE - 2)) return null
  if (b[2] !== TYPE_MOTION) return null
  const battery = b[28]
  return {
    accel: { x: view.getInt16(12, true) / 1000, y: view.getInt16(14, true) / 1000, z: view.getInt16(16, true) / 1000 },
    gyro: { x: view.getInt16(18, true) / 10, y: view.getInt16(20, true) / 10, z: view.getInt16(22, true) / 10 },
    pitch: view.getInt16(24, true) / 100,
    roll: view.getInt16(26, true) / 100,
    button: (b[4] & FLAG_BUTTON) !== 0,
    battery: battery === 255 ? null : Math.min(100, battery),
    receivedAt,
  }
}

/** Build a motion packet (used by tests and simulators). */
export function encodeMotionPacket(m: {
  gyro?: Partial<MotionSample['gyro']>
  accel?: Partial<MotionSample['accel']>
  pitch?: number
  roll?: number
  button?: boolean
  battery?: number
}): Uint8Array {
  const b = new Uint8Array(PACKET_SIZE)
  const v = new DataView(b.buffer)
  b[0] = MAGIC
  b[1] = 1
  b[2] = TYPE_MOTION
  b[4] = m.button ? FLAG_BUTTON : 0
  const i16 = (o: number, x: number) => v.setInt16(o, Math.max(-32768, Math.min(32767, Math.round(x))), true)
  i16(12, (m.accel?.x ?? 0) * 1000)
  i16(14, (m.accel?.y ?? 0) * 1000)
  i16(16, (m.accel?.z ?? 1) * 1000)
  i16(18, (m.gyro?.x ?? 0) * 10)
  i16(20, (m.gyro?.y ?? 0) * 10)
  i16(22, (m.gyro?.z ?? 0) * 10)
  i16(24, (m.pitch ?? 0) * 100)
  i16(26, (m.roll ?? 0) * 100)
  b[28] = m.battery ?? 255
  v.setUint16(PACKET_SIZE - 2, crc16(b, 0, PACKET_SIZE - 2), true)
  return b
}

function loadSettings(): MotionSettings {
  const def: MotionSettings = { acceptAllDevices: true, customServiceUuid: '', strumThreshold: 220, strumAxis: 'x', invertStrum: false, bendEnabled: true, chordTwist: true, buttonMute: true, fretMode: 'lead', leadMaxFret: 12, leadPitchSpan: 70, leadRollSpan: 60, leadPitchCentre: 0, leadRollCentre: 0, legatoOnMove: true }
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) return { ...def, ...(JSON.parse(raw) as Partial<MotionSettings>) }
  } catch {
    /* ignore */
  }
  return def
}

type BluetoothDeviceLike = {
  id: string
  name?: string
  gatt?: {
    connected: boolean
    connect(): Promise<GattServerLike>
    disconnect(): void
  }
  addEventListener(type: 'gattserverdisconnected', fn: () => void): void
  removeEventListener(type: 'gattserverdisconnected', fn: () => void): void
  forget?: () => Promise<void>
}
type ServiceLike = { uuid: string; getCharacteristic(uuid: string): Promise<CharLike>; getCharacteristics(): Promise<CharLike[]> }
type GattServerLike = { getPrimaryService(uuid: string): Promise<ServiceLike>; getPrimaryServices(): Promise<ServiceLike[]> }
type CharLike = {
  uuid?: string
  properties?: { notify?: boolean; indicate?: boolean }
  value?: DataView
  startNotifications(): Promise<unknown>
  addEventListener(type: 'characteristicvaluechanged', fn: (ev: Event) => void): void
  removeEventListener(type: 'characteristicvaluechanged', fn: (ev: Event) => void): void
}
type BluetoothLike = {
  requestDevice(opts: { filters?: Array<Record<string, unknown>>; acceptAllDevices?: boolean; optionalServices: string[] }): Promise<BluetoothDeviceLike>
}

const idle = (role: MotionRole): MotionDeviceStatus => ({ state: 'disconnected', name: null, error: null, role, battery: null, protocol: null, lastRaw: null, packets: 0, lead: null })

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.trim())
}

/** Smallest signed difference between two angles in degrees, so roll near +-180 does not wrap. */
export function angleDelta(a: number, centre: number): number {
  let d = (a - centre) % 360
  if (d > 180) d -= 360
  if (d < -180) d += 360
  return d
}

function toHex(b: Uint8Array): string {
  return Array.from(b.slice(0, 24), (x) => x.toString(16).padStart(2, '0')).join(' ') + (b.length > 24 ? ' …' : '')
}

/** One physical AiroMote: BLE link + its own gesture state. */
class AiroMoteDevice {
  readonly slot: number
  private manager: AiroMoteInputImpl
  private device: BluetoothDeviceLike | null = null
  private tx: CharLike | null = null
  private subscribed: CharLike[] = []
  private wantConnected = false
  private reconnectAttempt = 0
  private reconnectTimer: number | null = null
  status: MotionDeviceStatus
  last: MotionSample | null = null
  packets = 0
  listeners = new Set<(s: MotionSample) => void>()

  // gesture state
  private strumArmed = true
  private lastStrumAt = 0
  private twistArmed = true
  private lastTwistAt = 0
  private buttonDown = false
  private lastBend = 0
  private leadFret = -1
  private leadString = -1
  private leadFretPos = 0 // smoothed continuous fret position
  private leadStringPos = 0

  constructor(slot: number, manager: AiroMoteInputImpl, role: MotionRole) {
    this.slot = slot
    this.manager = manager
    this.status = idle(role)
  }

  get paired(): boolean {
    return this.device !== null
  }

  setRole(role: MotionRole) {
    this.releaseHeld()
    this.update({ role })
  }

  async connect(): Promise<void> {
    if (!this.manager.supported) {
      this.update({ state: 'unsupported', error: 'Web Bluetooth needs Chrome or Edge over HTTPS.' })
      return
    }
    this.wantConnected = true
    this.update({ state: 'connecting', error: null })
    try {
      if (!this.device) {
        const bt = (navigator as unknown as { bluetooth: BluetoothLike }).bluetooth
        const st = this.manager.currentSettings
        const optionalServices = [BLE_SERVICE_UUID, NUS_SERVICE_UUID, BATTERY_SERVICE_UUID, DEVICE_INFO_SERVICE_UUID]
        if (isUuid(st.customServiceUuid)) optionalServices.push(st.customServiceUuid.trim().toLowerCase())
        const device = await bt.requestDevice(
          st.acceptAllDevices
            ? { acceptAllDevices: true, optionalServices }
            : { filters: [{ services: [BLE_SERVICE_UUID] }, { namePrefix: BLE_NAME_PREFIX }, { services: [NUS_SERVICE_UUID] }], optionalServices },
        )
        const dup = this.manager.devices.find((d) => d !== this && d.device?.id === device.id)
        if (dup) throw new Error(`${device.name ?? 'That controller'} is already connected as Controller ${dup.slot + 1}. Pick the other AiroMote.`)
        this.device = device
        device.addEventListener('gattserverdisconnected', this.onDisconnected)
      }
      await this.openGatt()
      this.reconnectAttempt = 0
      this.update({ state: 'connected', name: this.device.name ?? 'AiroMote', error: null })
      this.manager.autoAssignRoles()
    } catch (e) {
      const msg = (e as Error).message || 'Could not connect'
      this.wantConnected = false
      if (/cancel|chooser/i.test(msg)) this.update({ state: 'disconnected', error: null })
      else this.update({ state: 'error', error: msg })
    }
  }

  async disconnect(): Promise<void> {
    this.wantConnected = false
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    try {
      this.subscribed.forEach((c) => c.removeEventListener('characteristicvaluechanged', this.onNotify))
      this.subscribed = []
      if (this.device?.gatt?.connected) this.device.gatt.disconnect()
    } finally {
      this.tx = null
      this.releaseHeld()
      this.update({ state: 'disconnected', protocol: null })
    }
  }

  async forget(): Promise<void> {
    await this.disconnect()
    if (this.device) {
      this.device.removeEventListener('gattserverdisconnected', this.onDisconnected)
      try {
        await this.device.forget?.()
      } catch {
        /* not supported everywhere */
      }
    }
    this.device = null
    this.last = null
    this.update({ name: null, battery: null, error: null })
  }

  /** Feed raw bytes (one or more 32-byte packets). Public so simulators and tests can drive the gesture engine. */
  feed(bytes: Uint8Array, receivedAt = performance.now()): void {
    for (let off = 0; off + PACKET_SIZE <= bytes.length; off += PACKET_SIZE) {
      const s = decodeMotionPacket(bytes.subarray(off, off + PACKET_SIZE), receivedAt)
      if (!s) continue
      this.last = s
      this.packets++
      if (s.battery !== this.status.battery || this.packets % 50 === 0) this.update({ battery: s.battery, packets: this.packets })
      this.listeners.forEach((l) => l(s))
      this.gestures(s)
    }
  }

  private update(patch: Partial<MotionDeviceStatus>) {
    this.status = { ...this.status, ...patch }
    this.manager.publish()
  }

  /**
   * Open GATT and subscribe. Preference order:
   *   1. AiroMote service (full motion protocol)
   *   2. Nordic UART TX (raw stream; parsed as AiroMote packets when the magic byte matches)
   *   3. any notify/indicate characteristic on the permitted services (raw bytes shown in the panel)
   */
  private async openGatt() {
    const server = await this.device!.gatt!.connect()
    this.subscribed = []
    const subscribe = async (c: CharLike) => {
      c.addEventListener('characteristicvaluechanged', this.onNotify)
      await c.startNotifications()
      this.subscribed.push(c)
    }
    try {
      const service = await server.getPrimaryService(BLE_SERVICE_UUID)
      this.tx = await service.getCharacteristic(BLE_TX_CHAR_UUID)
      await subscribe(this.tx)
      this.update({ protocol: 'airomote' })
      return
    } catch {
      /* not an AiroMote, keep looking */
    }
    try {
      const service = await server.getPrimaryService(NUS_SERVICE_UUID)
      this.tx = await service.getCharacteristic(NUS_TX_CHAR_UUID)
      await subscribe(this.tx)
      this.update({ protocol: 'uart' })
      return
    } catch {
      /* no UART service either */
    }
    let services: ServiceLike[] = []
    try {
      services = await server.getPrimaryServices()
    } catch {
      services = []
    }
    let count = 0
    for (const svc of services) {
      let chars: CharLike[] = []
      try {
        chars = await svc.getCharacteristics()
      } catch {
        continue
      }
      for (const c of chars) {
        if (c.properties?.notify || c.properties?.indicate) {
          try {
            await subscribe(c)
            count++
          } catch {
            /* characteristic refused notifications */
          }
        }
      }
    }
    if (!count) throw new Error('Connected, but this device has no readable data stream. It is not an AiroMote or UART device; use the HID option for gamepads.')
    this.tx = this.subscribed[0]
    this.update({ protocol: 'raw' })
  }

  private onNotify = (ev: Event) => {
    const c = ev.target as unknown as CharLike
    const v = c.value
    if (!v) return
    const bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength)
    if (bytes.length >= PACKET_SIZE && bytes[0] === MAGIC) {
      this.feed(bytes)
      return
    }
    // unknown format: keep it visible so the stream can be inspected
    this.packets++
    this.update({ lastRaw: toHex(bytes), packets: this.packets })
  }

  private onDisconnected = () => {
    this.subscribed.forEach((c) => c.removeEventListener('characteristicvaluechanged', this.onNotify))
    this.subscribed = []
    this.tx = null
    this.releaseHeld()
    if (!this.wantConnected) {
      this.update({ state: 'disconnected' })
      return
    }
    this.update({ state: 'reconnecting' })
    this.scheduleReconnect()
  }

  private scheduleReconnect() {
    if (this.reconnectTimer !== null) return
    const delay = Math.min(8000, 500 * 2 ** this.reconnectAttempt++)
    this.reconnectTimer = window.setTimeout(async () => {
      this.reconnectTimer = null
      if (!this.wantConnected || !this.device) return
      try {
        await this.openGatt()
        this.reconnectAttempt = 0
        this.update({ state: 'connected' })
      } catch (e) {
        if (this.reconnectAttempt > 8) {
          this.wantConnected = false
          this.update({ state: 'error', error: `Lost connection: ${(e as Error).message}` })
        } else this.scheduleReconnect()
      }
    }, delay)
  }

  private gestures(s: MotionSample) {
    const now = s.receivedAt
    const st = this.manager.currentSettings
    const role = this.status.role
    const strumHand = role === 'strum' || role === 'both'
    const fretHand = role === 'fret' || role === 'both'

    if (strumHand) {
      let rate = s.gyro[st.strumAxis]
      if (st.invertStrum) rate = -rate
      const thr = st.strumThreshold
      if (this.strumArmed && Math.abs(rate) > thr && now - this.lastStrumAt > 110) {
        this.strumArmed = false
        this.lastStrumAt = now
        const mag = Math.min(1, (Math.abs(rate) - thr) / (thr * 2))
        InputManager.dispatch({ type: rate > 0 ? 'STRUM_DOWN' : 'STRUM_UP', strength: 0.55 + mag * 0.45, speed: 0.4 + mag * 0.6 }, 'motion')
      } else if (!this.strumArmed && Math.abs(rate) < thr * 0.35) {
        this.strumArmed = true
      }
      if (st.buttonMute && s.button !== this.buttonDown) {
        this.buttonDown = s.button
        InputManager.dispatch({ type: 'PALM_MUTE', on: s.button }, 'motion')
      }
    }

    if (fretHand && role === 'fret' && st.fretMode === 'lead') {
      this.leadTracking(s, st, now)
    } else if (fretHand) {
      if (st.chordTwist) {
        const yawAxis = st.strumAxis === 'z' ? 'y' : 'z'
        const yaw = s.gyro[yawAxis]
        const strumRecent = strumHand && now - this.lastStrumAt < 250
        if (this.twistArmed && Math.abs(yaw) > 320 && now - this.lastTwistAt > 350 && !strumRecent) {
          this.twistArmed = false
          this.lastTwistAt = now
          InputManager.dispatch({ type: 'SELECT_CHORD', delta: yaw > 0 ? 1 : -1 }, 'motion')
        } else if (!this.twistArmed && Math.abs(yaw) < 100) {
          this.twistArmed = true
        }
      }
      if (st.bendEnabled) {
        const roll = Math.abs(angleDelta(s.roll, st.leadRollCentre))
        const bend = roll < 20 ? 0 : Math.min(2, ((roll - 20) / 45) * 2)
        const q = Math.round(bend * 10) / 10
        if (q !== this.lastBend) {
          this.lastBend = q
          InputManager.dispatch({ type: 'BEND', amount: q }, 'motion')
        }
      }
      // on a dedicated fret-hand device the button is vibrato instead of palm mute
      if (role === 'fret' && s.button !== this.buttonDown) {
        this.buttonDown = s.button
        InputManager.dispatch({ type: 'VIBRATO', on: s.button }, 'motion')
      }
    }
  }

  /**
   * Lead mode: the controller IS the fret hand. Tilt forward/back walks the
   * hand along the neck, wrist roll chooses the string. The chosen position is
   * fretted (other strings muted) so the strum hand plays exactly that note;
   * moving while the note still rings triggers a hammer-on or pull-off.
   */
  private leadTracking(s: MotionSample, st: MotionSettings, now: number) {
    // continuous positions with light smoothing against sensor jitter
    const pitchT = angleDelta(s.pitch, st.leadPitchCentre) / st.leadPitchSpan + 0.5 // 0..1 across the range
    const rollT = angleDelta(s.roll, st.leadRollCentre) / st.leadRollSpan + 0.5
    // centre of the travel = middle fret on the G string, so the calibrated rest pose is a natural playing position
    const fretTarget = Math.max(0, Math.min(st.leadMaxFret, pitchT * st.leadMaxFret))
    const stringTarget = Math.max(0, Math.min(5, 3 - (rollT - 0.5) * 6))
    this.leadFretPos += (fretTarget - this.leadFretPos) * 0.35
    this.leadStringPos += (stringTarget - this.leadStringPos) * 0.35
    // hysteresis: only step when clearly past the halfway point
    let fret = this.leadFret < 0 ? Math.round(this.leadFretPos) : this.leadFret
    if (this.leadFretPos > fret + 0.62) fret = Math.round(this.leadFretPos)
    else if (this.leadFretPos < fret - 0.62) fret = Math.round(this.leadFretPos)
    let str = this.leadString < 0 ? Math.round(this.leadStringPos) : this.leadString
    if (this.leadStringPos > str + 0.6) str = Math.round(this.leadStringPos)
    else if (this.leadStringPos < str - 0.6) str = Math.round(this.leadStringPos)
    fret = Math.max(0, Math.min(st.leadMaxFret, fret))
    str = Math.max(0, Math.min(5, str))
    if (fret === this.leadFret && str === this.leadString) return

    const prevString = this.leadString
    const state = store.get()
    const ringing = prevString >= 0 && state.ringing[prevString]
    const sameString = prevString === str
    this.leadFret = fret
    this.leadString = str
    // mute everything else so a strum only sounds the tracked note
    for (let i = 0; i < 6; i++) {
      if (i !== str && state.frets[i] !== -1) InputManager.dispatch({ type: 'FRET_NOTE', string: i as StringIndex, fret: -1, play: false }, 'motion')
    }
    const legato = st.legatoOnMove && ringing && sameString && now - this.lastStrumAt > 0
    InputManager.dispatch({ type: 'FRET_NOTE', string: str as StringIndex, fret, play: legato, velocity: 0.7 }, 'motion')
    this.update({ lead: { string: str, fret } })
  }

  /** Mark this slot as fed by an external source (dev bridge / simulator) instead of Web Bluetooth. */
  attachExternal(name: string) {
    this.update({ state: 'connected', name, error: null, protocol: 'airomote' })
    this.manager.autoAssignRoles()
  }

  detachExternal() {
    this.releaseHeld()
    this.update({ state: 'disconnected', protocol: null })
  }

  /** Capture the current tilt and roll as the neutral hand position. */
  calibrateLead() {
    if (!this.last) return
    this.manager.setSettings({ leadPitchCentre: this.last.pitch, leadRollCentre: this.last.roll })
    this.leadFret = -1
    this.leadString = -1
  }

  private releaseHeld() {
    if (this.buttonDown) {
      this.buttonDown = false
      InputManager.dispatch({ type: this.status.role === 'fret' ? 'VIBRATO' : 'PALM_MUTE', on: false }, 'motion')
    }
    if (this.lastBend > 0) {
      this.lastBend = 0
      InputManager.dispatch({ type: 'BEND', amount: 0 }, 'motion')
    }
  }
}

class AiroMoteInputImpl {
  readonly devices: AiroMoteDevice[]
  private settings: MotionSettings = loadSettings()

  constructor() {
    this.devices = [new AiroMoteDevice(0, this, 'both'), new AiroMoteDevice(1, this, 'fret')]
  }

  get supported(): boolean {
    return typeof navigator !== 'undefined' && 'bluetooth' in navigator && typeof window !== 'undefined' && window.isSecureContext
  }

  get currentSettings(): MotionSettings {
    return this.settings
  }

  get connectedCount(): number {
    return this.devices.filter((d) => d.status.state === 'connected').length
  }

  device(slot: number): AiroMoteDevice {
    return this.devices[slot]
  }

  /** Connect the next free slot (used by the top-bar button). */
  async connectNext(): Promise<void> {
    const free = this.devices.find((d) => d.status.state === 'disconnected' || d.status.state === 'error')
    if (free) await free.connect()
  }

  setSettings(patch: Partial<MotionSettings>) {
    this.settings = { ...this.settings, ...patch }
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings))
    } catch {
      /* ignore */
    }
    store.set({ motionSettingsVersion: store.get().motionSettingsVersion + 1 })
  }

  /** With two controllers, split the work: first = strum hand, second = fret hand. Alone, one device does both. */
  autoAssignRoles() {
    const connected = this.devices.filter((d) => d.status.state === 'connected')
    if (connected.length >= 2) {
      if (this.devices[0].status.role === 'both') this.devices[0].setRole('strum')
      if (this.devices[1].status.role === 'both') this.devices[1].setRole('fret')
    } else if (connected.length === 1 && connected[0].status.role !== 'both') {
      connected[0].setRole('both')
    }
    this.publish()
  }

  publish() {
    const statuses = this.devices.map((d) => ({ ...d.status }))
    const connected = statuses.filter((s) => s.state === 'connected')
    const busy = statuses.some((s) => s.state === 'connecting' || s.state === 'reconnecting')
    store.set({
      motionDevices: statuses,
      motionState: connected.length ? 'connected' : busy ? 'connecting' : statuses.some((s) => s.state === 'error') ? 'error' : 'disconnected',
      motionName: connected.map((s) => s.name ?? 'AiroMote').join(' + ') || null,
      motionError: statuses.find((s) => s.error)?.error ?? null,
    })
  }
}

export const AiroMoteInput = new AiroMoteInputImpl()
if (import.meta.env.DEV && typeof window !== 'undefined') (window as unknown as { __airomote: AiroMoteInputImpl }).__airomote = AiroMoteInput
