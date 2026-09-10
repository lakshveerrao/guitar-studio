import { useEffect, useState } from 'react'
import { useStore } from '../../state/store'
import { actions } from '../../hooks/useStudioActions'
import { Section, Slider } from '../ui/controls'
import type { DrumStyle } from '../../audio/DrumMachine'

const STYLES: DrumStyle[] = ['Rock', 'Blues', 'Pop', 'Funk']

export function BeatPulse({ size = 12 }: { size?: number }) {
  const beat = useStore((s) => s.beat)
  const stamp = useStore((s) => s.beatStamp)
  const on = useStore((s) => s.metronomeOn)
  const [flash, setFlash] = useState(false)
  useEffect(() => {
    if (!stamp) return
    setFlash(true)
    const t = window.setTimeout(() => setFlash(false), 110)
    return () => window.clearTimeout(t)
  }, [stamp])
  const accent = beat % 4 === 0
  return (
    <span className="relative inline-flex items-center justify-center" style={{ width: size + 8, height: size + 8 }}>
      {flash && on ? <span className="absolute inset-0 rounded-full beat-ring" style={{ border: `2px solid ${accent ? '#4da3ff' : '#9aa3af'}` }} /> : null}
      <span
        className="rounded-full transition-colors"
        style={{ width: size, height: size, background: !on ? '#262b33' : flash ? (accent ? '#4da3ff' : '#e6e9ee') : '#3a424d' }}
      />
    </span>
  )
}

export function MetronomePanel({ compact = false }: { compact?: boolean }) {
  const bpm = useStore((s) => s.bpm)
  const on = useStore((s) => s.metronomeOn)
  const beat = useStore((s) => s.beat)
  const drumsRunning = useStore((s) => s.drumsRunning)
  const drumStyle = useStore((s) => s.drumStyle)
  const drumVolume = useStore((s) => s.drumVolume)
  // what the user is typing in the BPM field; null while unfocused, when the store value shows
  const [draft, setDraft] = useState<string | null>(null)
  const commitDraft = () => {
    const n = Number(draft)
    if (draft !== null && draft.trim() !== '' && Number.isFinite(n)) actions.setBpm(n) // setBpm clamps to 40..240
    setDraft(null)
  }

  return (
    <Section
      title="Metronome & Beat"
      right={
        <div className="flex items-center gap-2">
          <BeatPulse />
          <span className="mono text-[11px] text-ink-2 w-6">{on ? (beat % 4) + 1 : '–'}</span>
        </div>
      }
    >
      <div className="flex items-center gap-2">
        <button className={`btn ${on ? 'active' : ''}`} onClick={() => actions.toggleMetronome()} aria-pressed={!!on}>
          {on ? 'Metronome On' : 'Metronome Off'}
        </button>
        <button className="btn" onClick={() => actions.tapTempo()}>
          Tap
        </button>
        <div className="ml-auto flex items-center gap-1">
          <button className="btn sm" onClick={() => actions.setBpm(bpm - 1)} aria-label="slower">
            −
          </button>
          <input
            className="inp w-16 text-center mono h-7"
            type="number"
            min={40}
            max={240}
            value={draft ?? String(bpm)}
            onFocus={() => setDraft(String(bpm))}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitDraft}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              else if (e.key === 'Escape') {
                setDraft(null)
                e.currentTarget.blur()
              }
            }}
            aria-label="BPM"
          />
          <button className="btn sm" onClick={() => actions.setBpm(bpm + 1)} aria-label="faster">
            +
          </button>
        </div>
      </div>
      <Slider value={bpm} min={40} max={240} onChange={actions.setBpm} />
      <div className={`flex ${compact ? 'flex-col' : 'flex-row items-center'} gap-2 pt-1 border-t border-line`}>
        <div className="flex items-center gap-2">
          <button className={`btn ${drumsRunning ? 'active' : ''}`} onClick={() => actions.setDrums(!drumsRunning)}>
            {drumsRunning ? '■ Stop Beat' : '▶ Start Beat'}
          </button>
          <div className="seg">
            {STYLES.map((s) => (
              <button key={s} className={drumStyle === s ? 'active' : ''} onClick={() => actions.setDrumStyle(s)}>
                {s}
              </button>
            ))}
          </div>
        </div>
        <Slider label="Beat Volume" value={Math.round(drumVolume * 100)} min={0} max={100} onChange={(v) => actions.setDrumVolume(v / 100)} format={(v) => `${v}%`} className="flex-1" />
      </div>
    </Section>
  )
}
