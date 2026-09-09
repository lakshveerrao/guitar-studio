import { InputManager } from './InputManager'
import { store } from '../state/store'
import { getStudio, onStudioReady, type Studio } from '../audio/Studio'
import { CHORDS, chordById } from '../music/chords'
import { NUM_FRETS, NUM_STRINGS } from '../music/tuning'
import type { Action, InputSource, NoteEvent, StringIndex, Technique } from '../types'
import { Recorder } from './Recorder'
import { RiffTrainer } from './RiffTrainer'

const LEGATO_WINDOW = 1.8 // seconds a string may ring and still accept hammer-on / pull-off

/**
 * The playing-state engine. Holds what is fretted on each string and turns
 * device-agnostic Actions into engine calls. Also keeps the UI store in sync.
 */
class GuitarControllerImpl {
  private studio: Studio | null = null
  readonly recorder = new Recorder()
  readonly trainer = new RiffTrainer()
  private ringPoll: number | null = null

  constructor() {
    InputManager.onAction((a, s) => this.handle(a, s))
    onStudioReady((s) => this.attach(s))
  }

  private attach(s: Studio) {
    this.studio = s
    const st = store.get()
    s.amp.apply(st.amp)
    s.effects.apply(st.effects)
    s.guitar.setSustain(st.amp.sustain)
    s.guitar.setVolume(st.guitarVolume / 10)
    s.guitar.setTone(st.guitarTone)
    s.guitar.setPickup(st.pickup)
    s.metronome.bpm = st.bpm
    s.drums.bpm = st.bpm
    s.guitar.onNote((e) => this.onNote(e))
    s.metronome.onBeat((beat) => store.set({ beat, beatStamp: performance.now() }))
    this.recorder.attach(s)
    this.trainer.attach(s)
    store.set({ audioReady: true })
    this.ringPoll = window.setInterval(() => this.pollRinging(), 120)
  }

  private pollRinging() {
    const s = this.studio
    if (!s) return
    const prev = store.get().ringing
    const next = prev.map((_, i) => s.guitar.isRinging(i as StringIndex))
    if (next.some((v, i) => v !== prev[i])) store.set({ ringing: next })
  }

  private onNote(e: NoteEvent) {
    const stamps = store.get().pluckStamp.slice()
    // schedule the visual pluck to line up with the audio time
    const delayMs = Math.max(0, (e.time - (this.studio?.ctx.currentTime ?? 0)) * 1000)
    const apply = () => {
      stamps[e.string] = performance.now()
      store.set((st) => {
        const ringing = st.ringing.slice()
        ringing[e.string] = true
        const ps = st.pluckStamp.slice()
        ps[e.string] = performance.now()
        return { ringing, pluckStamp: ps, lastNote: { string: e.string, fret: e.fret }, lastTechnique: e.technique }
      })
    }
    if (delayMs < 4) apply()
    else window.setTimeout(apply, delayMs)
    this.recorder.onNote(e)
    this.trainer.onNote(e)
  }

  /** Current fretting per string (-1 = muted) */
  get frets(): number[] {
    return store.get().frets
  }

  handle(a: Action, source: InputSource): void {
    if (source !== 'playback') store.set({ inputSource: source })
    const g = this.studio?.guitar
    const st = store.get()
    switch (a.type) {
      case 'FRET_NOTE': {
        const fret = Math.max(-1, Math.min(NUM_FRETS, a.fret))
        const frets = st.frets.slice()
        const prevFret = frets[a.string]
        frets[a.string] = fret
        // keep the chord label only while the fingering still matches its definition
        const chord = st.chordId ? chordById(st.chordId) : undefined
        const stillChord = !!chord && chord.frets.every((f, i) => f === frets[i])
        store.set({ frets, selectedString: a.string, chordId: stillChord ? st.chordId : null })
        if (a.play !== false && fret >= 0 && g) {
          let technique: Technique = 'pick'
          const ringingFret = g.ringingFret(a.string)
          if (g.isRinging(a.string) && ringingFret >= 0 && ringingFret !== fret && this.ringAge(a.string) < LEGATO_WINDOW) {
            technique = fret > ringingFret ? 'hammer' : 'pull'
          } else if (prevFret === fret && g.isRinging(a.string)) {
            technique = 'pick'
          }
          g.playNote(a.string, fret, { velocity: a.velocity ?? 0.85, technique, palmMute: st.palmMute, chord: st.chordId ?? undefined })
        } else if (fret < 0 && g) {
          g.muteString(a.string)
        }
        break
      }
      case 'RELEASE_FRET': {
        if (g) g.muteString(a.string, 0.08)
        break
      }
      case 'PICK_STRING': {
        store.set({ selectedString: a.string })
        const fret = st.frets[a.string]
        if (fret < 0) {
          // muted string: a short dead thud, like hitting a damped string
          g?.playNote(a.string, 0, { velocity: 0.35, technique: 'pick', palmMute: true })
          break
        }
        g?.playNote(a.string, fret, { velocity: a.velocity ?? 0.85, technique: 'pick', palmMute: st.palmMute, chord: st.chordId ?? undefined })
        break
      }
      case 'STRUM_DOWN':
      case 'STRUM_UP': {
        g?.strum({
          frets: st.frets,
          direction: a.type === 'STRUM_DOWN' ? 'down' : 'up',
          strength: a.strength ?? st.strumStrength,
          speed: a.speed ?? st.strumSpeed,
          palmMute: st.palmMute,
          chord: st.chordId ?? undefined,
        })
        store.set({ strumStamp: performance.now(), strumDir: a.type === 'STRUM_DOWN' ? 'down' : 'up' })
        this.studio?.applause.cheer(0.5)
        break
      }
      case 'PALM_MUTE': {
        if (st.palmMute !== a.on) store.set({ palmMute: a.on })
        if (a.on) g?.muteAll(0.06)
        break
      }
      case 'BEND': {
        const amount = Math.max(0, Math.min(2, a.amount))
        g?.setBend(a.string ?? 'all', amount)
        store.set({ bend: amount, bendString: amount > 0 ? (a.string ?? null) : null })
        break
      }
      case 'VIBRATO': {
        const depth = a.depth ?? st.vibratoDepth
        g?.setVibrato(a.on, depth, st.vibratoRate)
        store.set({ vibrato: a.on })
        break
      }
      case 'SELECT_CHORD': {
        let chord = a.id ? chordById(a.id) : undefined
        if (!chord && typeof a.index === 'number') chord = CHORDS[((a.index % CHORDS.length) + CHORDS.length) % CHORDS.length]
        if (!chord && typeof a.delta === 'number') {
          const cur = CHORDS.findIndex((c) => c.id === st.chordId)
          const idx = cur < 0 ? (a.delta > 0 ? 0 : CHORDS.length - 1) : (cur + a.delta + CHORDS.length) % CHORDS.length
          chord = CHORDS[idx]
        }
        if (!chord) break
        store.set({ chordId: chord.id, frets: chord.frets.slice(), mode: 'chord' })
        break
      }
      case 'MUTE_ALL': {
        g?.muteAll()
        store.set({ ringing: Array(NUM_STRINGS).fill(false) })
        break
      }
      case 'TOGGLE_RECORD': {
        this.recorder.toggleRecord()
        break
      }
    }
  }

  private ringAge(string: StringIndex): number {
    const stamp = store.get().pluckStamp[string]
    return (performance.now() - stamp) / 1000
  }

  // ---- non-action state helpers used by the UI ----

  setMode(mode: 'chord' | 'fretboard') {
    store.set({ mode })
  }

  setFrets(frets: number[]) {
    store.set({ frets: frets.slice(), chordId: null })
  }

  clearFretting() {
    store.set({ frets: Array(NUM_STRINGS).fill(0), chordId: null })
  }

  muteAllStrings() {
    getStudio()?.guitar.muteAll()
    store.set({ frets: Array(NUM_STRINGS).fill(-1), chordId: null, ringing: Array(NUM_STRINGS).fill(false) })
  }

  dispose() {
    if (this.ringPoll !== null) window.clearInterval(this.ringPoll)
  }
}

export const GuitarController = new GuitarControllerImpl()
if (import.meta.env.DEV && typeof window !== 'undefined') (window as unknown as { __controller: GuitarControllerImpl }).__controller = GuitarController
