import { useEffect, useState } from 'react'
import { store, useStore } from '../../state/store'
import { GuitarController } from '../../input/GuitarController'
import { getStudio } from '../../audio/Studio'
import { Section, Stat, Toggle } from '../ui/controls'
import { STRING_LABELS } from '../../music/tuning'

function fmt(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = seconds - m * 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}

// When a take starts (from any tab: R key, TopBar, this panel) remember the moment on both clocks,
// so the live length counter is right even if this panel mounts mid-take.
let recStartWall = 0
let recStartAudio = -1
let prevRecorderState = store.get().recorder
store.subscribe(() => {
  const r = store.get().recorder
  if (r === prevRecorderState) return
  prevRecorderState = r
  if (r === 'recording') {
    recStartWall = performance.now()
    recStartAudio = getStudio()?.ctx.currentTime ?? -1
  }
})

/** seconds since the current take started, on the audio clock when available (matches the recorded offsets) */
function recordingElapsed(): number {
  const ctx = getStudio()?.ctx
  if (ctx && recStartAudio >= 0) return Math.max(0, ctx.currentTime - recStartAudio)
  return Math.max(0, (performance.now() - recStartWall) / 1000)
}

export function LooperPanel() {
  const state = useStore((s) => s.recorder)
  const loop = useStore((s) => s.recorderLoop)
  const count = useStore((s) => s.recordedEvents)
  const duration = useStore((s) => s.recordDuration)
  const rec = GuitarController.recorder
  const [pos, setPos] = useState(0)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (state === 'idle') return // nothing moves: no frame loop
    if (state === 'recording' && !recStartWall) recStartWall = performance.now() // take started before this module loaded
    let raf = 0
    const tick = () => {
      setPos(rec.position)
      if (state === 'recording') setElapsed(recordingElapsed())
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [rec, state])

  const events = rec.eventList

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-3">
      <Section title="Performance Recorder">
        <div className="grid grid-cols-2 gap-2">
          <button className={`btn h-11 rec ${state === 'recording' ? 'active' : ''}`} onClick={() => rec.toggleRecord()}>
            {state === 'recording' ? '■ Stop Rec' : '● Record'}
          </button>
          <button className="btn h-11" onClick={() => rec.stop()} disabled={state === 'idle'}>
            ■ Stop
          </button>
          <button className={`btn h-11 ${state === 'playing' ? 'active' : ''}`} onClick={() => rec.play()} disabled={!count || state === 'recording'}>
            ▶ Play
          </button>
          <button className="btn h-11" onClick={() => rec.clear()} disabled={!count && state === 'idle'}>
            Clear
          </button>
        </div>
        <div className="flex items-center justify-between">
          <Toggle on={loop} onChange={(v) => rec.setLoop(v)} label="Loop playback" />
          <span className="text-[10px] text-ink-3">
            <span className="kbd">R</span> toggles record
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Stat label="State" value={state} mono={false} accent={state !== 'idle'} />
          <Stat label="Events" value={count} />
          <Stat label="Length" value={state === 'recording' ? fmt(elapsed) : fmt(duration)} />
        </div>
      </Section>

      <Section title="Timeline">
        <div className="relative h-16 rounded-md bg-[#0e1115] border border-line overflow-hidden">
          {duration > 0 &&
            events.map((e, i) => (
              <div
                key={i}
                className="absolute w-[3px] rounded-sm"
                style={{
                  left: `${(e.offset / duration) * 100}%`,
                  top: `${8 + e.string * 8}px`,
                  height: 6,
                  background: e.technique === 'strum' ? '#4da3ff' : e.technique === 'pick' ? '#e6e9ee' : '#f2b84b',
                  opacity: 0.4 + e.velocity * 0.6,
                }}
                title={`${STRING_LABELS[e.string]} fret ${e.fret} · ${e.technique}${e.chord ? ' · ' + e.chord : ''}`}
              />
            ))}
          {state === 'playing' && <div className="absolute top-0 bottom-0 w-px bg-rec" style={{ left: `${pos * 100}%` }} />}
          {state === 'recording' && <div className="absolute inset-0 border-2 border-rec/60 rounded-md animate-pulse pointer-events-none" />}
          {!count && state === 'idle' && <div className="absolute inset-0 flex items-center justify-center text-[11px] text-ink-3">Press Record, then play. Notes, strums, bends and chords are captured as events.</div>}
        </div>
        <div className="flex justify-between mono text-[10px] text-ink-3">
          <span>0:00.0</span>
          <span>{fmt(duration)}</span>
        </div>
        <div className="flex gap-3 text-[10px] text-ink-3">
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 bg-[#e6e9ee] rounded-sm" /> pick</span>
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 bg-accent rounded-sm" /> strum</span>
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 bg-warn rounded-sm" /> hammer / pull</span>
        </div>
      </Section>
    </div>
  )
}
