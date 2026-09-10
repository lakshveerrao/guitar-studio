import { store } from '../state/store'
import type { Studio } from '../audio/Studio'
import { RIFFS, type RiffDef } from '../music/riffs'
import type { NoteEvent } from '../types'

const HIT_WINDOW = 0.35 // seconds either side of the target time

/**
 * Practice sequencer. Steps through a riff on the audio clock, highlights the
 * next position on the fretboard, and judges the notes the player produces.
 *
 * A played note is judged against the nearest unhit step inside the hit
 * window (not only the current one), so riffs with steps closer together than
 * the window still score correctly, and a hit advances immediately.
 */
export class RiffTrainer {
  private studio: Studio | null = null
  private riff: RiffDef = RIFFS[0]
  private timer: number | null = null
  private startTime = 0
  private stepIdx = 0 // next step still open for judging (practice) / the highlighted step (listen)
  private listenIdx = 0 // next step to sound in listen mode
  private hit: boolean[] = []
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
    this.listenIdx = 0
    this.hit = this.riff.steps.map(() => false)
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
    if (e.dead || e.fret < 0) return // a thud on a muted string is not a note
    if (store.get().inputSource === 'trainer') return
    const steps = this.riff.steps
    // nearest matching, unhit step whose window contains the note
    let best = -1
    let bestDt = Infinity
    for (let i = this.stepIdx; i < steps.length; i++) {
      const dt = e.time - this.stepTime(i)
      if (dt < -HIT_WINDOW) break // steps are in time order: everything after is even further ahead
      if (this.hit[i] || Math.abs(dt) > HIT_WINDOW) continue
      if (steps[i].string !== e.string || steps[i].fret !== e.fret) continue
      if (Math.abs(dt) < bestDt) {
        best = i
        bestDt = Math.abs(dt)
      }
    }
    if (best < 0) return
    this.hit[best] = true
    // steps skipped on the way to this hit were missed
    let missed = 0
    for (let i = this.stepIdx; i < best; i++) {
      if (!this.hit[i]) {
        this.hit[i] = true
        missed++
      }
    }
    this.stepIdx = best + 1
    const next = steps[this.stepIdx] ?? null
    store.set((st) => ({
      trainer: { ...st.trainer, correct: st.trainer.correct + 1, missed: st.trainer.missed + missed, lastResult: 'hit', stepIndex: this.stepIdx, target: next },
    }))
  }

  private stepTime(i: number) {
    const bpm = store.get().trainer.bpm
    return this.startTime + (this.riff.steps[i].beat * 60) / bpm
  }

  private tick() {
    const s = this.studio
    if (!s || !this.running) return
    const now = s.ctx.currentTime
    const steps = this.riff.steps
    const bpm = store.get().trainer.bpm
    const end = this.startTime + (this.riff.lengthBeats * 60) / bpm

    if (this.listenMode) {
      // sound every step that falls inside the look-ahead, independent of the hit window
      while (this.listenIdx < steps.length && now >= this.stepTime(this.listenIdx) - 0.1) {
        const st = steps[this.listenIdx]
        store.set({ inputSource: 'trainer' })
        s.guitar.playNote(st.string, st.fret, { velocity: 0.8, technique: 'pick', time: Math.max(this.stepTime(this.listenIdx), now) })
        this.listenIdx++
      }
      // the highlight follows the audible note, moving on halfway to the next one
      let moved = false
      while (this.stepIdx < steps.length) {
        const t = this.stepTime(this.stepIdx)
        const tNext = this.stepIdx + 1 < steps.length ? this.stepTime(this.stepIdx + 1) : end
        if (now < t + Math.min(HIT_WINDOW, (tNext - t) / 2)) break
        this.stepIdx++
        moved = true
      }
      if (moved) store.set((st) => ({ trainer: { ...st.trainer, stepIndex: this.stepIdx, target: steps[this.stepIdx] ?? null } }))
    } else {
      // expire unplayed steps
      let missed = 0
      while (this.stepIdx < steps.length && !this.hit[this.stepIdx] && now > this.stepTime(this.stepIdx) + HIT_WINDOW) {
        this.hit[this.stepIdx] = true
        this.stepIdx++
        missed++
      }
      if (missed) {
        store.set((st) => ({
          trainer: { ...st.trainer, missed: st.trainer.missed + missed, lastResult: 'miss', stepIndex: this.stepIdx, target: steps[this.stepIdx] ?? null },
        }))
      }
    }

    if (this.stepIdx >= steps.length && this.listenIdx >= (this.listenMode ? steps.length : 0) && now >= end) {
      // riff finished: loop it
      this.startTime = end
      this.stepIdx = 0
      this.listenIdx = 0
      this.hit = steps.map(() => false)
      store.set((st) => ({ trainer: { ...st.trainer, stepIndex: 0, target: steps[0] ?? null } }))
    }
  }
}
