import { InputManager } from './InputManager'
import { store } from '../state/store'
import { LEGATO_WINDOW_MS } from './constants'
import type { StringIndex } from '../types'

/**
 * AiroMote ESP32 motion controllers over Web Bluetooth. Up to two devices.
 *
 * Protocol (kept in sync with the AiroMote firmware / @aero/protocol):
 *   32-byte packets, magic 0xA5, version 1, CRC-16/CCITT-FALSE over bytes 0..29
 *   MOTION (0x01): timestamp u32 ms @8, accel i16 milli-g @12, gyro i16 tenths deg/s @18,
 *                  pitch/roll i16 hundredths deg @24/26, battery u8 @28
 *   status byte @4: bit2 = stationary (firmware's rest detector), bit5 = button pressed
 *
 * Both boards have their MPU6050 mounted upside down, so at rest roll reads about
 * +-178 deg and pitch about 0. Every angle is therefore measured wrap-safe from a
 * per-device neutral pose ("centre") that is captured automatically after
 * connecting and can be re-taken any time with "Set centre here".
 *
 * Packet rates differ per board (~110/s vs ~30-50/s), so every gesture is
 * time-based: smoothing uses dt from receivedAt and the strum detector looks for
 * a signed rate peak instead of sampling a specific instant.
 *
 * Gesture mapping per device role (device-agnostic Actions go through InputManager):
 *   strum hand : swing (gyro, chosen axis) -> STRUM_DOWN / STRUM_UP, button -> PALM_MUTE
 *   fret hand  : wrist roll -> BEND, quick twist -> NEXT/PREV chord, button -> VIBRATO
 *                (lead mode: tilt = fret, roll = string, button -> VIBRATO)
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
const FLAG_STATIONARY = 1 << 2
const FLAG_BUTTON = 1 << 5

// ---- tuning ----
/** Exponential smoothing time constant of the lead-mode hand position (same lag on both boards). */
export const LEAD_SMOOTH_TAU_MS = 60
/** Stationary packets averaged for the automatic neutral pose ... */
const CENTRE_CAPTURE_PACKETS = 20
/** ... and the hard cap when the firmware never flags the device as stationary. */
const CENTRE_CAPTURE_MAX_PACKETS = 50
/** Latest moment a stroke fires after the rate crossed the threshold, if no peak was seen. */
const STROKE_MAX_MS = 120
/** The rate must stay below half the threshold this long (wall time) before a same-direction stroke can fire again. */
const STRUM_REARM_MS = 40
/** Minimum spacing between two strums (noise guard, well above any playable rate). */
const STRUM_LOCKOUT_MS = 60
/** Bend is frozen this long after a strum when strum and bend share an axis. */
const BEND_HOLD_AFTER_STRUM_MS = 250
const CONNECT_TIMEOUT_MS = 15000
const MAX_RECONNECT_ATTEMPTS = 8
const STATUS_PUBLISH_MS = 100 // raw-stream hex / packet counter publish throttle (~10/s)
const PACKETS_PUBLISH_MS = 500

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
  stationary: boolean // firmware rest detector
  battery: number | null
  timestamp: number // device millis (informational; timing uses receivedAt)
  receivedAt: number
}

/** Neutral hand pose of one device; every angle is measured relative to it. */
export interface MotionCentre {
  pitch: number
  roll: number
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
  legatoOnMove: boolean // moving while a note rings plays hammer-on / pull-off
  centres: (MotionCentre | null)[] // per-slot neutral pose
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
  centre: MotionCentre | null // neutral pose, null until captured
}

export const MOTION_SETTINGS_KEY = 'guitar-studio.airomote.settings.v2'
export const MOTION_SETTINGS_KEY_V1 = 'guitar-studio.airomote.settings.v1'
const SETTINGS_KEY = MOTION_SETTINGS_KEY
const SETTINGS_KEY_V1 = MOTION_SETTINGS_KEY_V1

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' && localStorage ? localStorage : null
  } catch {
    return null
  }
}

export const DEFAULT_MOTION_SETTINGS: MotionSettings = {
  acceptAllDevices: true,
  customServiceUuid: '',
  strumThreshold: 220,
  strumAxis: 'x',
  invertStrum: false,
  bendEnabled: true,
  chordTwist: true,
  buttonMute: true,
  fretMode: 'lead',
  leadMaxFret: 12,
  leadPitchSpan: 70,
  leadRollSpan: 60,
  legatoOnMove: true,
  centres: [null, null],
}

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
    stationary: (b[4] & FLAG_STATIONARY) !== 0,
    battery: battery === 255 ? null : Math.min(100, battery),
    timestamp: view.getUint32(8, true),
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
  stationary?: boolean
  battery?: number
  timestamp?: number
  deviceId?: number
}): Uint8Array {
  const b = new Uint8Array(PACKET_SIZE)
  const v = new DataView(b.buffer)
  b[0] = MAGIC
  b[1] = 1
  b[2] = TYPE_MOTION
  b[3] = m.deviceId ?? 0
  b[4] = (m.button ? FLAG_BUTTON : 0) | (m.stationary ? FLAG_STATIONARY : 0)
  v.setUint32(8, Math.max(0, Math.round(m.timestamp ?? 0)) >>> 0, true)
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

// ---- settings validation ----

function num(v: unknown, min: number, max: number, def: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : def
}
function bool(v: unknown, def: boolean): boolean {
  return typeof v === 'boolean' ? v : def
}
function oneOf<T extends string>(v: unknown, options: readonly T[], def: T): T {
  return typeof v === 'string' && (options as readonly string[]).includes(v) ? (v as T) : def
}
function centreOf(v: unknown): MotionCentre | null {
  if (!v || typeof v !== 'object') return null
  const c = v as { pitch?: unknown; roll?: unknown }
  if (typeof c.pitch !== 'number' || !Number.isFinite(c.pitch) || typeof c.roll !== 'number' || !Number.isFinite(c.roll)) return null
  return { pitch: Math.max(-180, Math.min(180, c.pitch)), roll: angleDelta(c.roll, 0) }
}

/** Type/range check every field against the UI ranges; anything odd falls back to the default (never NaN). */
export function sanitizeMotionSettings(raw: unknown): MotionSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const d = DEFAULT_MOTION_SETTINGS
  let centres = Array.isArray(r.centres) ? r.centres.map(centreOf) : []
  if (!Array.isArray(r.centres)) {
    // pre-centre settings kept one global neutral pose; 0/0 was "never calibrated"
    const legacy = centreOf({ pitch: r.leadPitchCentre, roll: r.leadRollCentre })
    if (legacy && (legacy.pitch !== 0 || legacy.roll !== 0)) centres = [legacy, { ...legacy }]
  }
  return {
    acceptAllDevices: bool(r.acceptAllDevices, d.acceptAllDevices),
    customServiceUuid: typeof r.customServiceUuid === 'string' ? r.customServiceUuid.slice(0, 64) : d.customServiceUuid,
    strumThreshold: num(r.strumThreshold, 80, 450, d.strumThreshold),
    strumAxis: oneOf(r.strumAxis, ['x', 'y', 'z'] as const, d.strumAxis),
    invertStrum: bool(r.invertStrum, d.invertStrum),
    bendEnabled: bool(r.bendEnabled, d.bendEnabled),
    chordTwist: bool(r.chordTwist, d.chordTwist),
    buttonMute: bool(r.buttonMute, d.buttonMute),
    fretMode: oneOf(r.fretMode, ['chords', 'lead'] as const, d.fretMode),
    leadMaxFret: Math.round(num(r.leadMaxFret, 5, 22, d.leadMaxFret)),
    leadPitchSpan: num(r.leadPitchSpan, 30, 120, d.leadPitchSpan),
    leadRollSpan: num(r.leadRollSpan, 30, 120, d.leadRollSpan),
    legatoOnMove: bool(r.legatoOnMove, d.legatoOnMove),
    centres: Array.from({ length: MAX_DEVICES }, (_, i) => centres[i] ?? null),
  }
}

/** Load, validate and (when needed) migrate the persisted settings. Never throws. */
export function loadMotionSettings(storage: StorageLike | null = defaultStorage()): MotionSettings {
  if (!storage) return sanitizeMotionSettings(null)
  let raw: string | null = null
  let fromV1 = false
  try {
    raw = storage.getItem(SETTINGS_KEY)
    if (raw === null) {
      raw = storage.getItem(SETTINGS_KEY_V1)
      fromV1 = raw !== null
    }
  } catch {
    return sanitizeMotionSettings(null)
  }
  if (raw === null) return sanitizeMotionSettings(null)
  let parsed: unknown = null
  try {
    parsed = JSON.parse(raw)
  } catch {
    parsed = null
  }
  const settings = sanitizeMotionSettings(parsed)
  try {
    const json = JSON.stringify(settings)
    if (fromV1 || json !== raw) storage.setItem(SETTINGS_KEY, json)
    if (fromV1) storage.removeItem(SETTINGS_KEY_V1)
  } catch {
    /* ignore */
  }
  return settings
}

// ---- Web Bluetooth shapes (structural, so tests and simulators can stand in) ----

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

const idle = (role: MotionRole, centre: MotionCentre | null): MotionDeviceStatus => ({ state: 'disconnected', name: null, error: null, role, battery: null, protocol: null, lastRaw: null, packets: 0, lead: null, centre })

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

function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => void, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      onTimeout()
      reject(new Error(message))
    }, ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      },
    )
  })
}

interface CentreCapture {
  n: number
  pitch: number
  sin: number
  cos: number
  sN: number
  sPitch: number
  sSin: number
  sCos: number
}

interface Stroke {
  sign: 1 | -1
  peak: number
  start: number
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
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  /** Bumped whenever the link identity changes (disconnect / forget); async results from an older session are ignored. */
  private session = 0
  private opening = false
  private droppedWhileOpening = false
  status: MotionDeviceStatus
  last: MotionSample | null = null
  packets = 0
  listeners = new Set<(s: MotionSample) => void>()
  private lastPacketsPublishAt = -Infinity
  private lastRawPublishAt = -Infinity
  private rawPublishTimer: ReturnType<typeof setTimeout> | null = null
  private pendingRaw: string | null = null

  // neutral pose
  centre: MotionCentre | null
  private capture: CentreCapture | null = null

  // strum detector (signed peak)
  private strumArmed = true
  private stroke: Stroke | null = null
  private lastStrokeSign = 0
  private belowSince: number | null = null
  private lastStrumAt = -Infinity

  // twist / button / bend
  private twistArmed = true
  private lastTwistAt = -Infinity
  private buttonDown = false
  private lastBend = 0

  // lead mode
  private leadFret = -1
  private leadString = -1
  private leadFretPos = 0 // smoothed continuous fret position
  private leadStringPos = 0
  private leadSeeded = false
  private leadEngaged = false
  private leadMuted: boolean[] = [false, false, false, false, false, false]
  private prevSampleAt: number | null = null

  constructor(slot: number, manager: AiroMoteInputImpl, role: MotionRole) {
    this.slot = slot
    this.manager = manager
    this.centre = manager.currentSettings.centres[slot] ?? null
    this.status = idle(role, this.centre)
  }

  get paired(): boolean {
    return this.device !== null
  }

  get connected(): boolean {
    return this.status.state === 'connected'
  }

  /** True while a stroke is between threshold crossing and its peak (tests / UI). */
  get strokeInProgress(): boolean {
    return this.stroke !== null
  }

  setRole(role: MotionRole) {
    if (role === this.status.role) return
    this.releaseHeld()
    this.leaveLead()
    this.update({ role })
  }

  // ---- neutral pose ----

  /** Set (or clear) the neutral pose. Bend and lead tracking measure from it; a stale bend is released. */
  setCentre(c: MotionCentre | null) {
    this.centre = c ? { pitch: c.pitch, roll: angleDelta(c.roll, 0) } : null
    this.capture = null
    this.manager.saveCentre(this.slot, this.centre)
    if (this.lastBend > 0) {
      this.lastBend = 0
      InputManager.dispatch({ type: 'BEND', amount: 0 }, 'motion')
    }
    this.resetLeadPosition()
    if (!this.centre && this.connected) this.startCentreCapture()
    this.update({ centre: this.centre })
  }

  /** Capture the current tilt and roll as the neutral hand position ("Set centre here"). */
  calibrateLead() {
    if (!this.last) return
    this.setCentre({ pitch: this.last.pitch, roll: this.last.roll })
  }

  /** Average the first packets after connecting into the neutral pose, unless one is already known. */
  private startCentreCapture() {
    if (this.centre || this.capture) return
    this.capture = { n: 0, pitch: 0, sin: 0, cos: 0, sN: 0, sPitch: 0, sSin: 0, sCos: 0 }
  }

  private captureCentre(s: MotionSample) {
    const c = this.capture
    if (!c) return
    const r = (s.roll * Math.PI) / 180
    c.n++
    c.pitch += s.pitch
    c.sin += Math.sin(r)
    c.cos += Math.cos(r)
    if (s.stationary) {
      c.sN++
      c.sPitch += s.pitch
      c.sSin += Math.sin(r)
      c.sCos += Math.cos(r)
    }
    if (c.sN < CENTRE_CAPTURE_PACKETS && c.n < CENTRE_CAPTURE_MAX_PACKETS) return
    // prefer the packets the firmware flagged as stationary; roll is averaged on the circle
    const useStill = c.sN >= 5
    const n = useStill ? c.sN : c.n
    const pitch = (useStill ? c.sPitch : c.pitch) / n
    const roll = (Math.atan2(useStill ? c.sSin : c.sin, useStill ? c.sCos : c.cos) * 180) / Math.PI
    this.capture = null
    this.setCentre({ pitch, roll })
  }

  // ---- connection lifecycle ----

  async connect(): Promise<void> {
    if (!this.manager.supported) {
      this.update({ state: 'unsupported', error: 'Web Bluetooth needs Chrome or Edge over HTTPS.' })
      return
    }
    if (this.status.state === 'connected' || this.status.state === 'connecting' || this.status.state === 'reconnecting') return
    this.wantConnected = true
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    const session = ++this.session
    this.update({ state: 'connecting', error: null })
    let device = this.device
    try {
      if (!device) {
        const bt = (navigator as unknown as { bluetooth: BluetoothLike }).bluetooth
        const st = this.manager.currentSettings
        const optionalServices = [BLE_SERVICE_UUID, NUS_SERVICE_UUID, BATTERY_SERVICE_UUID, DEVICE_INFO_SERVICE_UUID]
        if (isUuid(st.customServiceUuid)) optionalServices.push(st.customServiceUuid.trim().toLowerCase())
        const picked = await bt.requestDevice(
          st.acceptAllDevices
            ? { acceptAllDevices: true, optionalServices }
            : { filters: [{ services: [BLE_SERVICE_UUID] }, { namePrefix: BLE_NAME_PREFIX }, { services: [NUS_SERVICE_UUID] }], optionalServices },
        )
        if (session !== this.session) return // cancelled while the picker was open
        const dup = this.manager.devices.find((d) => d !== this && d.device?.id === picked.id)
        if (dup) {
          if (dup.status.state !== 'disconnected' && dup.status.state !== 'error') {
            throw new Error(`${picked.name ?? 'That controller'} is already connected as Controller ${dup.slot + 1}. Pick the other AiroMote.`)
          }
          // only paired there: the pairing moves to this slot
          dup.releasePairing()
        }
        device = picked
        this.device = picked
        picked.addEventListener('gattserverdisconnected', this.onDisconnected)
      }
      await this.openGatt(device)
      if (session !== this.session || !this.wantConnected) {
        this.teardownLink(device)
        return
      }
      this.reconnectAttempt = 0
      this.update({ state: 'connected', name: device.name ?? 'AiroMote', error: null })
      this.startCentreCapture()
    } catch (e) {
      if (session !== this.session) return // disconnect()/forget() already set the final state
      this.teardownLink(device)
      const msg = (e as Error).message || 'Could not connect'
      this.wantConnected = false
      if (/cancel|chooser/i.test(msg)) this.update({ state: 'disconnected', error: null })
      else this.update({ state: 'error', error: msg })
    }
  }

  /** Also the Cancel path while connecting / reconnecting. */
  async disconnect(): Promise<void> {
    this.session++
    this.wantConnected = false
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.capture = null
    try {
      this.teardownLink(this.device)
    } finally {
      this.releaseAll()
      this.update({ state: 'disconnected', protocol: null })
    }
  }

  async forget(): Promise<void> {
    await this.disconnect()
    const device = this.device
    this.device = null
    if (device) {
      device.removeEventListener('gattserverdisconnected', this.onDisconnected)
      try {
        await device.forget?.()
      } catch {
        /* not supported everywhere */
      }
    }
    this.last = null
    this.update({ name: null, battery: null, error: null })
  }

  /** Another slot takes over the pairing of a device that is only paired (not connected) here. */
  releasePairing() {
    const device = this.device
    this.device = null
    device?.removeEventListener('gattserverdisconnected', this.onDisconnected)
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
      if (s.battery !== this.status.battery || receivedAt - this.lastPacketsPublishAt >= PACKETS_PUBLISH_MS) {
        this.lastPacketsPublishAt = receivedAt
        this.update({ battery: s.battery, packets: this.packets })
      }
      this.listeners.forEach((l) => l(s))
      this.gestures(s)
    }
  }

  private update(patch: Partial<MotionDeviceStatus>) {
    const wasConnected = this.status.state === 'connected'
    this.status = { ...this.status, ...patch }
    const isConnected = this.status.state === 'connected'
    // membership of the connected set changed: re-split the roles (a lone device does both)
    if (wasConnected !== isConnected) this.manager.autoAssignRoles()
    else this.manager.publish()
  }

  private teardownLink(device: BluetoothDeviceLike | null) {
    this.subscribed.forEach((c) => c.removeEventListener('characteristicvaluechanged', this.onNotify))
    this.subscribed = []
    this.tx = null
    try {
      device?.gatt?.disconnect()
    } catch {
      /* already gone */
    }
  }

  /**
   * Open GATT and subscribe. Preference order:
   *   1. AiroMote service (full motion protocol)
   *   2. Nordic UART TX (raw stream; parsed as AiroMote packets when the magic byte matches)
   *   3. any notify/indicate characteristic on the permitted services (raw bytes shown in the panel)
   */
  private async openGatt(device: BluetoothDeviceLike) {
    const gatt = device.gatt
    if (!gatt) throw new Error('This device has no GATT server.')
    this.opening = true
    this.droppedWhileOpening = false
    try {
      const server = await withTimeout(
        gatt.connect(),
        CONNECT_TIMEOUT_MS,
        () => {
          try {
            gatt.disconnect()
          } catch {
            /* ignore */
          }
        },
        'Connection timed out. Is the controller switched on and in range?',
      )
      this.subscribed = []
      const subscribe = async (c: CharLike) => {
        // listen only once notifications are confirmed, so a refusing characteristic leaves nothing attached
        await c.startNotifications()
        c.addEventListener('characteristicvaluechanged', this.onNotify)
        this.subscribed.push(c)
      }
      let protocol: BleProtocol = null
      try {
        const service = await server.getPrimaryService(BLE_SERVICE_UUID)
        this.tx = await service.getCharacteristic(BLE_TX_CHAR_UUID)
        await subscribe(this.tx)
        protocol = 'airomote'
      } catch {
        /* not an AiroMote, keep looking */
      }
      if (!protocol) {
        try {
          const service = await server.getPrimaryService(NUS_SERVICE_UUID)
          this.tx = await service.getCharacteristic(NUS_TX_CHAR_UUID)
          await subscribe(this.tx)
          protocol = 'uart'
        } catch {
          /* no UART service either */
        }
      }
      if (!protocol) {
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
        protocol = 'raw'
      }
      if (this.droppedWhileOpening) throw new Error('The connection dropped while setting up.')
      this.update({ protocol })
    } finally {
      this.opening = false
    }
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
    // unknown format: keep it visible so the stream can be inspected, but at most ~10 publishes/s
    this.packets++
    this.pendingRaw = toHex(bytes)
    const now = performance.now()
    const wait = STATUS_PUBLISH_MS - (now - this.lastRawPublishAt)
    if (wait <= 0) this.publishRaw()
    else if (this.rawPublishTimer === null) this.rawPublishTimer = setTimeout(() => this.publishRaw(), wait)
  }

  private publishRaw() {
    this.rawPublishTimer = null
    this.lastRawPublishAt = performance.now()
    this.update({ lastRaw: this.pendingRaw, packets: this.packets })
  }

  private onDisconnected = () => {
    this.subscribed.forEach((c) => c.removeEventListener('characteristicvaluechanged', this.onNotify))
    this.subscribed = []
    this.tx = null
    if (this.opening) {
      // the connect attempt in flight reports the outcome
      this.droppedWhileOpening = true
      return
    }
    if (this.status.state !== 'connected') return // already torn down by disconnect()/forget()/a failed connect
    this.releaseAll()
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
    const session = this.session
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null
      if (session !== this.session || !this.wantConnected || !this.device) return
      const device = this.device
      try {
        await this.openGatt(device)
        if (session !== this.session || !this.wantConnected) {
          this.teardownLink(device)
          return
        }
        this.reconnectAttempt = 0
        this.update({ state: 'connected', error: null })
        this.startCentreCapture() // no-op when the centre survived the drop
      } catch (e) {
        if (session !== this.session || !this.wantConnected) return // do not re-arm after forget/disconnect
        this.teardownLink(device)
        if (this.reconnectAttempt > MAX_RECONNECT_ATTEMPTS) {
          this.wantConnected = false
          this.update({ state: 'error', error: `Lost connection: ${(e as Error).message}` })
        } else this.scheduleReconnect()
      }
    }, delay)
  }

  // ---- gestures ----

  private gestures(s: MotionSample) {
    const now = s.receivedAt
    const st = this.manager.currentSettings
    const role = this.status.role
    const strumHand = role === 'strum' || role === 'both'
    const fretHand = role === 'fret' || role === 'both'
    const dt = this.prevSampleAt === null ? 0 : Math.max(0, Math.min(100, now - this.prevSampleAt))
    this.prevSampleAt = now

    if (this.capture) this.captureCentre(s)

    if (strumHand) {
      this.detectStrum(s, st, now)
      if (st.buttonMute && s.button !== this.buttonDown) {
        this.buttonDown = s.button
        InputManager.dispatch({ type: 'PALM_MUTE', on: s.button }, 'motion')
      }
    }

    if (fretHand && role === 'fret' && st.fretMode === 'lead') {
      this.leadTracking(s, st, now, dt)
    } else if (fretHand) {
      const strumRecent = strumHand && (this.stroke !== null || now - this.lastStrumAt < BEND_HOLD_AFTER_STRUM_MS)
      if (st.chordTwist) {
        const yawAxis = st.strumAxis === 'z' ? 'y' : 'z'
        const yaw = s.gyro[yawAxis]
        if (this.twistArmed && Math.abs(yaw) > 320 && now - this.lastTwistAt > 350 && !strumRecent) {
          this.twistArmed = false
          this.lastTwistAt = now
          InputManager.dispatch({ type: 'SELECT_CHORD', delta: yaw > 0 ? 1 : -1 }, 'motion')
        } else if (!this.twistArmed && Math.abs(yaw) < 100) {
          this.twistArmed = true
        }
      }
      if (st.bendEnabled) {
        // roll is the integral of gyro X on this hardware, so a strum swing on X is also a roll change:
        // never bend while a stroke is in progress, and hold the bend for a moment after a strum on the shared axis
        const sharedAxis = strumHand && st.strumAxis === 'x'
        const frozen = this.stroke !== null || (sharedAxis && strumRecent)
        if (!frozen) {
          let q = 0
          if (this.centre) {
            const roll = Math.abs(angleDelta(s.roll, this.centre.roll))
            const bend = roll < 20 ? 0 : Math.min(2, ((roll - 20) / 45) * 2)
            q = Math.round(bend * 10) / 10
          }
          if (q !== this.lastBend) {
            this.lastBend = q
            InputManager.dispatch({ type: 'BEND', amount: q }, 'motion')
          }
        }
      }
    }
    // on a dedicated fret-hand device the button is vibrato instead of palm mute, in both fret modes
    if (role === 'fret' && s.button !== this.buttonDown) {
      this.buttonDown = s.button
      InputManager.dispatch({ type: 'VIBRATO', on: s.button }, 'motion')
    }
  }

  /**
   * Strum = one signed peak of the rate on the strum axis. Arm when the rate
   * crosses the threshold, fire on the first sample where it stops increasing
   * (or after STROKE_MAX_MS), and re-arm when the sign flips or the rate has
   * been below half the threshold for STRUM_REARM_MS of wall time, so no
   * specific instant has to be sampled at any packet rate.
   */
  private detectStrum(s: MotionSample, st: MotionSettings, now: number) {
    let rate = s.gyro[st.strumAxis]
    if (st.invertStrum) rate = -rate
    const thr = st.strumThreshold
    const mag = Math.abs(rate)
    const sign: 1 | -1 | 0 = rate > 0 ? 1 : rate < 0 ? -1 : 0

    const k = this.stroke
    if (k) {
      const rising = sign === k.sign && mag > k.peak
      if (rising) k.peak = mag
      if (!rising || now - k.start >= STROKE_MAX_MS) this.fireStrum(k, thr, now)
    }

    if (!this.strumArmed && !this.stroke) {
      if (sign !== 0 && sign !== this.lastStrokeSign && mag >= thr * 0.5) {
        this.strumArmed = true // counter-swing
      } else if (mag < thr * 0.5) {
        if (this.belowSince === null) this.belowSince = now
        else if (now - this.belowSince >= STRUM_REARM_MS) this.strumArmed = true
      } else {
        this.belowSince = null
      }
      if (this.strumArmed) this.belowSince = null
    }

    if (this.strumArmed && !this.stroke && sign !== 0 && mag > thr && now - this.lastStrumAt >= STRUM_LOCKOUT_MS) {
      this.stroke = { sign, peak: mag, start: now }
      this.strumArmed = false
    }
  }

  private fireStrum(k: Stroke, thr: number, now: number) {
    this.stroke = null
    this.lastStrokeSign = k.sign
    this.lastStrumAt = now
    this.belowSince = null
    const mag = Math.min(1, Math.max(0, (k.peak - thr) / (thr * 2)))
    InputManager.dispatch({ type: k.sign > 0 ? 'STRUM_DOWN' : 'STRUM_UP', strength: 0.55 + mag * 0.45, speed: 0.4 + mag * 0.6 }, 'motion')
  }

  /**
   * Lead mode: the controller IS the fret hand. Tilt forward/back walks the
   * hand along the neck, wrist roll chooses the string. The chosen position is
   * fretted (other strings muted) so the strum hand plays exactly that note;
   * moving while the note still rings triggers a hammer-on or pull-off.
   * Holds its last position until the neutral pose is known.
   */
  private leadTracking(s: MotionSample, st: MotionSettings, now: number, dt: number) {
    const c = this.centre
    if (!c) return
    const pitchT = angleDelta(s.pitch, c.pitch) / st.leadPitchSpan + 0.5 // 0..1 across the range
    const rollT = angleDelta(s.roll, c.roll) / st.leadRollSpan + 0.5
    // centre of the travel = middle fret on the G string, so the calibrated rest pose is a natural playing position
    const fretTarget = Math.max(0, Math.min(st.leadMaxFret, pitchT * st.leadMaxFret))
    const stringTarget = Math.max(0, Math.min(5, 3 - (rollT - 0.5) * 6))
    if (!this.leadSeeded) {
      // start where the hand is instead of walking there from (low E, open)
      this.leadFretPos = fretTarget
      this.leadStringPos = stringTarget
      this.leadSeeded = true
    } else {
      // exponential smoothing with a fixed time constant: the same lag at 30 and 110 packets/s
      const a = 1 - Math.exp(-dt / LEAD_SMOOTH_TAU_MS)
      this.leadFretPos += (fretTarget - this.leadFretPos) * a
      this.leadStringPos += (stringTarget - this.leadStringPos) * a
    }
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
    // legato only while the previous note on this string is young enough for the engine to hammer/pull it
    const sameString = prevString >= 0 && prevString === str
    const ringAge = sameString ? now - state.pluckStamp[prevString] : Infinity
    const legato = st.legatoOnMove && this.leadEngaged && sameString && state.ringing[prevString] && ringAge < LEGATO_WINDOW_MS
    this.leadFret = fret
    this.leadString = str
    this.leadEngaged = true
    // mute everything else so a strum only sounds the tracked note
    for (let i = 0; i < 6; i++) {
      if (i !== str && state.frets[i] !== -1) {
        this.leadMuted[i] = true
        InputManager.dispatch({ type: 'FRET_NOTE', string: i as StringIndex, fret: -1, play: false }, 'motion')
      }
    }
    this.leadMuted[str] = false
    InputManager.dispatch({ type: 'FRET_NOTE', string: str as StringIndex, fret, play: legato, legatoOnly: true, velocity: 0.7 }, 'motion')
    this.update({ lead: { string: str, fret } })
  }

  private resetLeadPosition() {
    this.leadFret = -1
    this.leadString = -1
    this.leadSeeded = false
  }

  /**
   * Leave lead mode: forget the tracked position and give back the strings it
   * muted (and the one it fretted) as open strings, unless the user changed
   * them in the meantime. No-op unless this device was actually tracking.
   */
  leaveLead() {
    const trackedString = this.leadString
    const trackedFret = this.leadFret
    this.resetLeadPosition()
    this.prevSampleAt = null
    if (!this.leadEngaged) {
      if (this.status.lead) this.update({ lead: null })
      return
    }
    this.leadEngaged = false
    const frets = store.get().frets
    for (let i = 0; i < 6; i++) {
      if (this.leadMuted[i] && frets[i] === -1) InputManager.dispatch({ type: 'FRET_NOTE', string: i as StringIndex, fret: 0, play: false }, 'motion')
      this.leadMuted[i] = false
    }
    if (trackedString >= 0 && trackedFret > 0 && frets[trackedString] === trackedFret) {
      InputManager.dispatch({ type: 'FRET_NOTE', string: trackedString as StringIndex, fret: 0, play: false }, 'motion')
    }
    this.update({ lead: null })
  }

  /** Mark this slot as fed by an external source (dev bridge / simulator) instead of Web Bluetooth. */
  attachExternal(name: string) {
    this.update({ state: 'connected', name, error: null, protocol: 'airomote' })
    this.startCentreCapture()
  }

  detachExternal() {
    this.capture = null
    this.releaseAll()
    this.update({ state: 'disconnected', protocol: null })
  }

  /** Release button / bend holds and the lead-mode fretting, and reset the gesture detectors (timing included: a new link starts a new clock). */
  private releaseAll() {
    this.releaseHeld()
    this.leaveLead()
    this.stroke = null
    this.strumArmed = true
    this.belowSince = null
    this.lastStrokeSign = 0
    this.lastStrumAt = -Infinity
    this.twistArmed = true
    this.lastTwistAt = -Infinity
    this.prevSampleAt = null
    this.lastPacketsPublishAt = -Infinity
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

export type { AiroMoteDevice }

class AiroMoteInputImpl {
  readonly devices: AiroMoteDevice[]
  private settings: MotionSettings = loadMotionSettings()

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
    const prev = this.settings
    this.settings = sanitizeMotionSettings({ ...prev, ...patch })
    try {
      defaultStorage()?.setItem(SETTINGS_KEY, JSON.stringify(this.settings))
    } catch {
      /* ignore */
    }
    // leaving lead mode gives the fret hand's strings back
    if (prev.fretMode === 'lead' && this.settings.fretMode !== 'lead') this.devices.forEach((d) => d.leaveLead())
    store.set({ motionSettingsVersion: store.get().motionSettingsVersion + 1 })
  }

  /** Persist one slot's neutral pose. */
  saveCentre(slot: number, centre: MotionCentre | null) {
    const centres = this.settings.centres.slice()
    centres[slot] = centre
    this.setSettings({ centres })
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
