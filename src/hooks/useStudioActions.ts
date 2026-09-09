import { store } from '../state/store'
import { getStudio } from '../audio/Studio'
import { PRESETS } from '../audio/presets'
import type { AmpParams, EffectsParams } from '../types'
import type { DrumStyle } from '../audio/DrumMachine'
import type { PickupPosition } from '../audio/GuitarEngine'

/** Imperative helpers that update both the UI store and the live audio graph. */
export const actions = {
  setAmp(patch: Partial<AmpParams>) {
    const amp = { ...store.get().amp, ...patch }
    store.set({ amp, presetId: null })
    const s = getStudio()
    if (s) {
      s.amp.apply(amp)
      if (patch.sustain !== undefined) s.guitar.setSustain(amp.sustain)
    }
  },

  setEffect<K extends keyof EffectsParams>(key: K, patch: Partial<EffectsParams[K]>) {
    const effects = structuredClone(store.get().effects)
    Object.assign(effects[key], patch)
    store.set({ effects, presetId: null })
    getStudio()?.effects.apply(effects)
  },

  applyPreset(id: string) {
    const p = PRESETS.find((x) => x.id === id)
    if (!p) return
    store.set({ amp: { ...p.amp }, effects: structuredClone(p.effects), presetId: p.id })
    const s = getStudio()
    if (s) {
      s.amp.apply(p.amp)
      s.effects.apply(p.effects)
      s.guitar.setSustain(p.amp.sustain)
    }
  },

  setGuitarVolume(v: number) {
    store.set({ guitarVolume: v })
    getStudio()?.guitar.setVolume(v / 10)
  },

  setGuitarTone(v: number) {
    store.set({ guitarTone: v })
    getStudio()?.guitar.setTone(v)
  },

  setPickup(p: PickupPosition) {
    store.set({ pickup: p })
    getStudio()?.guitar.setPickup(p)
  },

  setMasterVolume(v: number) {
    store.set({ masterVolume: v })
    getStudio()?.setMasterVolume(v)
  },

  setBpm(bpm: number) {
    const v = Math.max(40, Math.min(240, Math.round(bpm)))
    store.set({ bpm: v })
    const s = getStudio()
    if (s) {
      s.metronome.bpm = v
      s.drums.bpm = v
    }
  },

  toggleMetronome(on?: boolean) {
    const s = getStudio()
    const next = on ?? !store.get().metronomeOn
    store.set({ metronomeOn: next ? 1 : 0 })
    if (!s) return
    if (next) s.metronome.start()
    else s.metronome.stop()
  },

  tapTempo() {
    const s = getStudio()
    if (!s) return
    const bpm = s.metronome.tap()
    if (bpm) actions.setBpm(bpm)
  },

  setDrums(running: boolean) {
    const s = getStudio()
    store.set({ drumsRunning: running })
    if (!s) return
    if (running) s.drums.start()
    else s.drums.stop()
  },

  setDrumStyle(style: DrumStyle) {
    store.set({ drumStyle: style })
    const s = getStudio()
    if (s) s.drums.style = style
  },

  setDrumVolume(v: number) {
    store.set({ drumVolume: v })
    getStudio()?.drums.setVolume(v)
  },

  setCrowd(on: boolean) {
    store.set({ crowdOn: on })
    const s = getStudio()
    if (!s) return
    if (on) s.applause.start()
    else s.applause.stop()
  },

  setVibratoParams(depth: number, rate: number) {
    store.set({ vibratoDepth: depth, vibratoRate: rate })
    const s = getStudio()
    if (s && store.get().vibrato) s.guitar.setVibrato(true, depth, rate)
  },
}
