import { store } from '../state/store'
import type { Studio } from '../audio/Studio'
import { RIFFS, type RiffDef } from '../music/riffs'
import type { NoteEvent } from '../types'

const HIT_WINDOW = 0.35 // seconds either side of the target time

/**
 * Practice sequencer. Steps through a riff on the audio clock, highlights the
 * next position on the fretboard, and judges the notes the player produces.
 */
export class RiffTrainer {
  private studio: Studio | null = null
  private riff: RiffDef = RIFFS[0]
  private timer: number | null = null
  private startTime = 0
  private stepIdx = 0
  private hitCurrent = false
  private running = false
  private listenMode = false

  attach(s: Studio) {
    this.studio = s
  }

  selectRiff(id: string) {
    const r = RIFFS.find((x) => x.id === id)
    if (!r) return
    this.stop()
    this.riff = r
    store.set((st) => ({ trainer: { ...st.trainer, riffId: r.id, bpm: r.bpm, stepIndex: 0, correct: 0, missed: 0, target: r.steps[0] ?? null, lastResult: null } }))
  }

  setBpm(bpm: number) {
    store.set((st) => ({ trainer: { ...st.trainer, bpm: Math.max(40, Math.min(240, Math.round(bpm))) } }))
  }

  /** Start in practice mode (listen=false) or demo playback (listen=true). */
  start(listen = false) {
    if (!this.studio) return
    this.stop()
    this.listenMode = listen
    this.running = true
    this.stepIdx = 0
    this.hitCurrent = false
    this.startTime = this.studio.ctx.currentTime + 1.0 // one-beat count-in
    store.set((st) => ({
      trainer: { ...st.trainer, running: true, stepIndex: 0, correct: 0, missed: 0, target: this.riff.steps[0], lastResult: null },
    }))
    this.timer = window.setInterval(() => this.tick(), 30)
  }

  stop() {
    if (this.timer !== null) window.clearInterval(this.timer)
    this.timer = null
    if (this.running) {
      this.running = false
      store.set((st) => ({ trainer: { ...st.trainer, running: false } }))
    }
  }

  onNote(e: NoteEvent) {
    if (!this.running || this.listenMode || !this.studio) return
    if (store.get().inputSource === 'trainer') return
    const step = this.riff.steps[this.stepIdx]
    if (!step) return
    const targetTime = this.stepTime(this.stepIdx)
    const dt = e.time - targetTime
    if (Math.abs(dt) <= HIT_WINDOW && e.string === step.string && e.fret === step.fret && !this.hitCurrent) {
      this.hitCurrent = true
      store.set((st) => ({ trainer: { ...st.trainer, correct: st.trainer.correct + 1, lastResult: 'hit' } }))
    }
  }

  private stepTime(i: number) {
    const bpm = store.get().trainer.bpm
    return this.startTime + (this.riff.steps[i].beat * 60) / bpm
  }

  private tick() {
    const s = this.studio
    if (!s || !this.running) return
    const now = s.ctx.currentTime
    const step = this.riff.steps[this.stepIdx]
    if (!step) {
      // riff finished: loop it
      const bpm = store.get().trainer.bpm
      const end = this.startTime + (this.riff.lengthBeats * 60) / bpm
      if (now >= end) {
        this.startTime = end
        this.stepIdx = 0
        this.hitCurrent = false
        store.set((st) => ({ trainer: { ...st.trainer, stepIndex: 0, target: this.riff.steps[0] } }))
      }
      return
    }
    const t = this.stepTime(this.stepIdx)
    if (this.listenMode && now >= t - 0.1 && !this.hitCurrent) {
      this.hitCurrent = true
      store.set({ inputSource: 'trainer' })
      s.guitar.playNote(step.string, step.fret, { velocity: 0.8, technique: 'pick', time: Math.max(t, now) })
    }
    if (now > t + HIT_WINDOW) {
      // advance
      if (!this.listenMode && !this.hitCurrent) {
        store.set((st) => ({ trainer: { ...st.trainer, missed: st.trainer.missed + 1, lastResult: 'miss' } }))
      }
      this.stepIdx++
      this.hitCurrent = false
      const next = this.riff.steps[this.stepIdx] ?? null
      store.set((st) => ({ trainer: { ...st.trainer, stepIndex: this.stepIdx, target: next } }))
    }
  }
}
