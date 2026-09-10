import { InputManager } from './InputManager'
import { store } from '../state/store'
import type { GamepadActionId, GamepadBinding, StringIndex } from '../types'

export const GAMEPAD_ACTIONS: { id: GamepadActionId; label: string; continuous?: boolean; hold?: boolean }[] = [
  { id: 'STRUM_DOWN', label: 'Strum Down' },
  { id: 'STRUM_UP', label: 'Strum Up' },
  { id: 'PICK_1', label: 'Pick String 1 (high e)' },
  { id: 'PICK_2', label: 'Pick String 2 (B)' },
  { id: 'PICK_3', label: 'Pick String 3 (G)' },
  { id: 'PICK_4', label: 'Pick String 4 (D)' },
  { id: 'PICK_5', label: 'Pick String 5 (A)' },
  { id: 'PICK_6', label: 'Pick String 6 (low E)' },
  { id: 'NEXT_CHORD', label: 'Next Chord' },
  { id: 'PREV_CHORD', label: 'Previous Chord' },
  { id: 'PALM_MUTE', label: 'Palm Mute', hold: true },
  { id: 'BEND', label: 'Bend', continuous: true, hold: true },
  { id: 'VIBRATO', label: 'Vibrato', hold: true },
]

export const DEFAULT_BINDINGS: GamepadBinding[] = [
  { action: 'STRUM_DOWN', kind: 'axis', index: 1, direction: 'positive', threshold: 0.5 },
  { action: 'STRUM_UP', kind: 'axis', index: 1, direction: 'negative', threshold: 0.5 },
  { action: 'STRUM_DOWN', kind: 'button', index: 0 },
  { action: 'STRUM_UP', kind: 'button', index: 1 },
  { action: 'NEXT_CHORD', kind: 'button', index: 15 },
  { action: 'PREV_CHORD', kind: 'button', index: 14 },
  { action: 'NEXT_CHORD', kind: 'button', index: 5 },
  { action: 'PREV_CHORD', kind: 'button', index: 4 },
  { action: 'PALM_MUTE', kind: 'button', index: 2 },
  { action: 'VIBRATO', kind: 'button', index: 3 },
  { action: 'BEND', kind: 'axis', index: 3, direction: 'negative', threshold: 0.15 },
  { action: 'PICK_6', kind: 'button', index: 12 },
  { action: 'PICK_1', kind: 'button', index: 13 },
]

const STORAGE_KEY = 'guitar-studio.gamepad.bindings.v1'

export interface GamepadSnapshot {
  connected: boolean
  id: string
  index: number
  buttons: number[]
  axes: number[]
  timestamp: number
}

const ACTION_IDS = new Set<string>(GAMEPAD_ACTIONS.map((a) => a.id))

/** Shape check for one persisted binding: anything that fails is dropped rather than crashing the poll loop. */
export function isGamepadBinding(b: unknown): b is GamepadBinding {
  if (!b || typeof b !== 'object') return false
  const x = b as Record<string, unknown>
  if (typeof x.action !== 'string' || !ACTION_IDS.has(x.action)) return false
  if (x.kind !== 'button' && x.kind !== 'axis') return false
  if (typeof x.index !== 'number' || !Number.isInteger(x.index) || x.index < 0 || x.index > 255) return false
  if (x.direction !== undefined && x.direction !== 'positive' && x.direction !== 'negative') return false
  if (x.threshold !== undefined && (typeof x.threshold !== 'number' || !Number.isFinite(x.threshold) || x.threshold < 0 || x.threshold >= 1)) return false
  return true
}

/** Keep only well-formed bindings; an empty result falls back to the defaults. */
export function sanitizeBindings(raw: unknown): GamepadBinding[] {
  const list = Array.isArray(raw) ? raw.filter(isGamepadBinding) : []
  const cleaned = list.map((b) => {
    const nb: GamepadBinding = { action: b.action, kind: b.kind, index: b.index }
    if (b.kind === 'axis') {
      nb.direction = b.direction ?? 'positive'
      if (b.threshold !== undefined) nb.threshold = b.threshold
    }
    return nb
  })
  return cleaned.length ? cleaned : DEFAULT_BINDINGS.map((b) => ({ ...b }))
}

function loadBindings(): GamepadBinding[] {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch {
    return DEFAULT_BINDINGS.map((b) => ({ ...b }))
  }
  if (!raw) return DEFAULT_BINDINGS.map((b) => ({ ...b }))
  let parsed: unknown = null
  try {
    parsed = JSON.parse(raw)
  } catch {
    parsed = null
  }
  const bindings = sanitizeBindings(parsed)
  try {
    // rewrite the repaired list so a corrupt key does not have to be cleaned by hand
    const json = JSON.stringify(bindings)
    if (json !== raw) localStorage.setItem(STORAGE_KEY, json)
  } catch {
    /* ignore */
  }
  return bindings
}

/**
 * Polls navigator.getGamepads() every animation frame, performs edge
 * detection on buttons and axis thresholds and dispatches Actions.
 */
class GamepadInputImpl {
  private raf: number | null = null
  private bindings: GamepadBinding[] = loadBindings()
  private prevButtons = new Map<string, boolean[]>()
  private prevAxisState = new Map<string, boolean>() // "pad:axis:dir" -> active
  private lastBend = 0
  private snapshot: GamepadSnapshot = { connected: false, id: '', index: -1, buttons: [], axes: [], timestamp: 0 }
  private snapListeners = new Set<(s: GamepadSnapshot) => void>()
  private bindListeners = new Set<(b: GamepadBinding[]) => void>()
  private deadzone = 0.12

  start() {
    if (this.raf !== null) return
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return
    window.addEventListener('gamepadconnected', this.onConnect)
    window.addEventListener('gamepaddisconnected', this.onDisconnect)
    const loop = () => {
      this.poll()
      this.raf = requestAnimationFrame(loop)
    }
    this.raf = requestAnimationFrame(loop)
  }

  stop() {
    if (this.raf !== null) cancelAnimationFrame(this.raf)
    this.raf = null
    window.removeEventListener('gamepadconnected', this.onConnect)
    window.removeEventListener('gamepaddisconnected', this.onDisconnect)
  }

  get current(): GamepadSnapshot {
    return this.snapshot
  }

  get currentBindings(): GamepadBinding[] {
    return this.bindings
  }

  onSnapshot(fn: (s: GamepadSnapshot) => void): () => void {
    this.snapListeners.add(fn)
    return () => this.snapListeners.delete(fn)
  }

  onBindings(fn: (b: GamepadBinding[]) => void): () => void {
    this.bindListeners.add(fn)
    fn(this.bindings)
    return () => this.bindListeners.delete(fn)
  }

  setBindings(b: GamepadBinding[]) {
    this.bindings = sanitizeBindings(b)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.bindings))
    } catch {
      /* ignore */
    }
    this.bindListeners.forEach((l) => l(this.bindings))
  }

  resetBindings() {
    this.setBindings(DEFAULT_BINDINGS)
  }

  private onConnect = (e: GamepadEvent) => {
    store.set({ gamepadName: e.gamepad.id })
  }
  private onDisconnect = (e: GamepadEvent) => {
    // poll() will not see this pad again, so release whatever it was holding here
    this.releasePad(`pad${e.gamepad.index}`)
    if (this.snapshot.index === e.gamepad.index || !this.snapshot.connected) {
      store.set({ gamepadName: null })
      this.snapshot = { connected: false, id: '', index: -1, buttons: [], axes: [], timestamp: 0 }
      this.snapListeners.forEach((l) => l(this.snapshot))
    }
  }

  /**
   * Release every hold action (palm mute / vibrato / bend) a pad had engaged.
   * evaluate() reads missing buttons as released and missing axes as centred,
   * so an empty snapshot fires the off edges. Idempotent, and scoped to one
   * transport key so a still-held HID device is not disturbed.
   */
  private releasePad(key: string) {
    try {
      this.evaluate(key, [], [], 'gamepad')
    } catch {
      /* a bad binding must not block the release */
    }
    this.prevButtons.delete(key)
    for (const k of Array.from(this.prevAxisState.keys())) if (k.startsWith(`${key}:`)) this.prevAxisState.delete(k)
  }

  private poll() {
    try {
      this.pollPads()
    } catch (e) {
      // never let a downstream handler kill the animation-frame loop
      if (!this.warned) {
        this.warned = true
        console.warn('[gamepad] poll failed', e)
      }
    }
  }

  private warned = false

  private pollPads() {
    let pads: (Gamepad | null)[] = []
    try {
      pads = navigator.getGamepads ? Array.from(navigator.getGamepads()) : []
    } catch {
      pads = []
    }
    const pad = pads.find((p) => p && p.connected) ?? null
    if (!pad) {
      if (this.snapshot.connected) {
        this.releasePad(`pad${this.snapshot.index}`)
        this.snapshot = { connected: false, id: '', index: -1, buttons: [], axes: [], timestamp: 0 }
        this.snapListeners.forEach((l) => l(this.snapshot))
        if (store.get().gamepadName) store.set({ gamepadName: null })
      }
      return
    }
    if (this.snapshot.connected && this.snapshot.index !== pad.index) this.releasePad(`pad${this.snapshot.index}`)
    if (store.get().gamepadName !== pad.id) store.set({ gamepadName: pad.id })

    const buttons = pad.buttons.map((b) => b.value)
    const axes = Array.from(pad.axes)
    this.snapshot = { connected: true, id: pad.id, index: pad.index, buttons, axes, timestamp: pad.timestamp }
    this.snapListeners.forEach((l) => l(this.snapshot))
    this.evaluate(`pad${pad.index}`, buttons, axes, 'gamepad')
  }

  /**
   * Run the bindings against a snapshot from another transport (WebHID). The
   * same edge detection / axis thresholds apply, so one mapping table serves
   * both Gamepad API and HID devices.
   */
  processExternal(key: string, buttons: number[], axes: number[]): void {
    this.evaluate(key, buttons, axes, 'gamepad')
  }

  private evaluate(key: string, buttons: number[], axes: number[], source: 'gamepad') {
    const prev = this.prevButtons.get(key) ?? []
    const pressedNow = buttons.map((v) => v > 0.5)

    let bendTarget = 0
    let bendBound = false

    for (const b of this.bindings) {
      if (!isGamepadBinding(b)) continue // defensive: a hand-edited entry must not stop the others
      if (b.kind === 'button') {
        const now = pressedNow[b.index] ?? false
        const was = prev[b.index] ?? false
        if (now && !was) this.fire(b.action, true, 1, source)
        else if (!now && was) this.fire(b.action, false, 0, source)
        if (b.action === 'BEND') {
          bendBound = true
          if (now) bendTarget = Math.max(bendTarget, 1)
        }
      } else {
        const raw = axes[b.index] ?? 0
        const v = Math.abs(raw) < this.deadzone ? 0 : raw
        const dir = b.direction ?? 'positive'
        const mag = dir === 'positive' ? Math.max(0, v) : Math.max(0, -v)
        const thr = b.threshold ?? 0.5
        const stateKey = `${key}:${b.index}:${dir}:${b.action}`
        if (b.action === 'BEND') {
          bendBound = true
          if (mag > thr) bendTarget = Math.max(bendTarget, ((mag - thr) / (1 - thr)) * 2)
          continue
        }
        const active = mag > thr
        const was = this.prevAxisState.get(stateKey) ?? false
        if (active && !was) this.fire(b.action, true, Math.min(1, mag), source)
        else if (!active && was) this.fire(b.action, false, 0, source)
        this.prevAxisState.set(stateKey, active)
      }
    }
    if (bendBound) {
      const q = Math.round(bendTarget * 20) / 20
      if (Math.abs(q - this.lastBend) > 0.02) {
        this.lastBend = q
        InputManager.dispatch({ type: 'BEND', amount: q }, source)
      }
    }
    this.prevButtons.set(key, pressedNow)
  }

  private fire(action: GamepadActionId, pressed: boolean, magnitude: number, source: 'gamepad') {
    const strength = 0.5 + magnitude * 0.5
    switch (action) {
      case 'STRUM_DOWN':
        if (pressed) InputManager.dispatch({ type: 'STRUM_DOWN', strength, speed: Math.min(1, 0.4 + magnitude * 0.6) }, source)
        break
      case 'STRUM_UP':
        if (pressed) InputManager.dispatch({ type: 'STRUM_UP', strength, speed: Math.min(1, 0.4 + magnitude * 0.6) }, source)
        break
      case 'PICK_1':
      case 'PICK_2':
      case 'PICK_3':
      case 'PICK_4':
      case 'PICK_5':
      case 'PICK_6': {
        if (!pressed) break
        const n = Number(action.slice(5)) // 1 = high e
        const s = (6 - n) as StringIndex
        InputManager.dispatch({ type: 'PICK_STRING', string: s, velocity: strength }, source)
        break
      }
      case 'NEXT_CHORD':
        if (pressed) InputManager.dispatch({ type: 'SELECT_CHORD', delta: 1 }, source)
        break
      case 'PREV_CHORD':
        if (pressed) InputManager.dispatch({ type: 'SELECT_CHORD', delta: -1 }, source)
        break
      case 'PALM_MUTE':
        InputManager.dispatch({ type: 'PALM_MUTE', on: pressed }, source)
        break
      case 'VIBRATO':
        InputManager.dispatch({ type: 'VIBRATO', on: pressed }, source)
        break
      case 'BEND':
        break // handled continuously
    }
  }
}

export const GamepadInput = new GamepadInputImpl()
