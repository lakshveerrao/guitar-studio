import { InputManager } from './InputManager'
import { store } from '../state/store'
import type { StringIndex } from '../types'

/**
 * Keyboard mapping
 *   1-6            pick string (6th .. 1st)
 *   A S D F G H J K L ;   fret 1..10 on the selected string (Shift = +10)
 *   0 / `          open string on the selected string
 *   ArrowDown / Space   strum down     ArrowUp   strum up
 *   M (hold)       palm mute           B (hold)  bend +1 semitone
 *   V (hold)       vibrato             R         record
 *   , .            previous / next chord        X   mute all
 *   ?  or  F1      keyboard help
 *
 * The fret row is matched on the physical key (KeyboardEvent.code) so Shift
 * still lands on the same fret key (Shift+; produces ':' as e.key, which would
 * otherwise never reach fret 20).
 */
export const FRET_KEYS = ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';']
const FRET_CODES = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon']

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  if (!t) return false
  const tag = t.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable
}

/** Lower-cased printable key; the shifted symbol on the ';' key maps back to it. */
function normKey(e: KeyboardEvent): string {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
  return k === ':' ? ';' : k
}

/** Index in the fret row, by physical key first and by printed key as a fallback (virtual keyboards). */
function fretIndex(e: KeyboardEvent, key: string): number {
  const byCode = e.code ? FRET_CODES.indexOf(e.code) : -1
  return byCode >= 0 ? byCode : FRET_KEYS.indexOf(key)
}

export function attachKeyboard(): () => void {
  // fret keys are held by their physical code, the hold keys (m / b / v) by name
  const held = new Set<string>()

  const onDown = (e: KeyboardEvent) => {
    if (isTyping(e)) return
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const key = normKey(e)
    if (e.repeat && key !== 'ArrowDown' && key !== 'ArrowUp' && key !== ' ') return
    const st = store.get()
    const sel = st.selectedString as StringIndex

    if (key >= '1' && key <= '6') {
      const s = (Number(key) - 1) as StringIndex
      InputManager.dispatch({ type: 'PICK_STRING', string: s, velocity: 0.85 }, 'keyboard')
      e.preventDefault()
      return
    }
    const fretIdx = fretIndex(e, key)
    if (fretIdx >= 0) {
      const holdKey = `fret:${fretIdx}`
      if (!held.has(holdKey)) {
        held.add(holdKey)
        const fret = fretIdx + 1 + (e.shiftKey ? 10 : 0)
        InputManager.dispatch({ type: 'FRET_NOTE', string: sel, fret, play: true, velocity: 0.85 }, 'keyboard')
      }
      e.preventDefault()
      return
    }
    switch (key) {
      case '0':
      case '`':
        InputManager.dispatch({ type: 'FRET_NOTE', string: sel, fret: 0, play: true }, 'keyboard')
        e.preventDefault()
        return
      case 'ArrowDown':
      case ' ':
        InputManager.dispatch({ type: 'STRUM_DOWN' }, 'keyboard')
        e.preventDefault()
        return
      case 'ArrowUp':
        InputManager.dispatch({ type: 'STRUM_UP' }, 'keyboard')
        e.preventDefault()
        return
      case 'm':
        if (!held.has('m')) {
          held.add('m')
          InputManager.dispatch({ type: 'PALM_MUTE', on: true }, 'keyboard')
        }
        return
      case 'b':
        if (!held.has('b')) {
          held.add('b')
          InputManager.dispatch({ type: 'BEND', amount: 1 }, 'keyboard')
        }
        return
      case 'v':
        if (!held.has('v')) {
          held.add('v')
          InputManager.dispatch({ type: 'VIBRATO', on: true }, 'keyboard')
        }
        return
      case 'r':
        InputManager.dispatch({ type: 'TOGGLE_RECORD' }, 'keyboard')
        return
      case ',':
        InputManager.dispatch({ type: 'SELECT_CHORD', delta: -1 }, 'keyboard')
        return
      case '.':
        InputManager.dispatch({ type: 'SELECT_CHORD', delta: 1 }, 'keyboard')
        return
      case 'x':
        InputManager.dispatch({ type: 'MUTE_ALL' }, 'keyboard')
        return
      case '?':
      case 'F1':
        // 'h' is fret 6, so the help lives on ? and F1 (the browser's own F1 help page is suppressed)
        store.set({ helpOpen: !store.get().helpOpen })
        e.preventDefault()
        return
      case 'Escape':
        store.set({ helpOpen: false, settingsOpen: false })
        return
      case 'ArrowLeft':
        store.set({ selectedString: Math.max(0, sel - 1) })
        e.preventDefault()
        return
      case 'ArrowRight':
        store.set({ selectedString: Math.min(5, sel + 1) })
        e.preventDefault()
        return
    }
  }

  // A key that is in `held` was pressed outside a text field, so its release is
  // always delivered, even when focus has moved into a slider or input since.
  const onUp = (e: KeyboardEvent) => {
    const key = normKey(e)
    const fretIdx = fretIndex(e, key)
    if (fretIdx >= 0) {
      held.delete(`fret:${fretIdx}`)
      return
    }
    if (!held.has(key)) return
    held.delete(key)
    switch (key) {
      case 'm':
        InputManager.dispatch({ type: 'PALM_MUTE', on: false }, 'keyboard')
        return
      case 'b':
        InputManager.dispatch({ type: 'BEND', amount: 0 }, 'keyboard')
        return
      case 'v':
        InputManager.dispatch({ type: 'VIBRATO', on: false }, 'keyboard')
        return
    }
  }

  const onBlur = () => {
    if (held.has('m')) InputManager.dispatch({ type: 'PALM_MUTE', on: false }, 'keyboard')
    if (held.has('b')) InputManager.dispatch({ type: 'BEND', amount: 0 }, 'keyboard')
    if (held.has('v')) InputManager.dispatch({ type: 'VIBRATO', on: false }, 'keyboard')
    held.clear()
  }

  window.addEventListener('keydown', onDown)
  window.addEventListener('keyup', onUp)
  window.addEventListener('blur', onBlur)
  return () => {
    window.removeEventListener('keydown', onDown)
    window.removeEventListener('keyup', onUp)
    window.removeEventListener('blur', onBlur)
  }
}
