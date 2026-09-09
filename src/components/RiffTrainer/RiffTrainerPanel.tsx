import { useStore } from '../../state/store'
import { GuitarController } from '../../input/GuitarController'
import { RIFFS } from '../../music/riffs'
import { Section, Slider, Stat } from '../ui/controls'
import { STRING_LABELS, fretNoteName } from '../../music/tuning'

export function RiffTrainerPanel() {
  const t = useStore((s) => s.trainer)
  const flats = useStore((s) => s.flats)
  const riff = RIFFS.find((r) => r.id === t.riffId) ?? RIFFS[0]
  const trainer = GuitarController.trainer
  const total = t.correct + t.missed
  const accuracy = total ? Math.round((t.correct / total) * 100) : 0

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-3">
      <Section title="Riff Trainer">
        <div className="flex flex-col gap-1">
          {RIFFS.map((r) => (
            <button key={r.id} className={`btn justify-start h-9 ${t.riffId === r.id ? 'active' : ''}`} onClick={() => trainer.selectRiff(r.id)}>
              {r.name}
              <span className="ml-auto mono text-[10px] text-ink-3">{r.bpm} bpm</span>
            </button>
          ))}
        </div>
        <p className="text-[11px] text-ink-3 leading-snug">{riff.description}</p>
      </Section>

      <Section
        title={riff.name}
        right={
          <div className="flex items-center gap-2">
            <button className="btn" onClick={() => trainer.start(true)}>
              ▶ Listen
            </button>
            <button className={`btn ${t.running ? 'active' : ''}`} onClick={() => (t.running ? trainer.stop() : trainer.start(false))}>
              {t.running ? '■ Stop' : '● Practice'}
            </button>
          </div>
        }
      >
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <Stat label="Next" value={t.target ? `${STRING_LABELS[t.target.string]} · ${t.target.fret === 0 ? 'open' : `fret ${t.target.fret}`} (${fretNoteName(t.target.string, t.target.fret, flats)})` : '—'} accent />
          <Stat label="Correct" value={t.correct} />
          <Stat label="Missed" value={t.missed} />
          <Stat label="Accuracy" value={`${accuracy}%`} />
          <Stat label="Tempo" value={`${t.bpm} bpm`} />
        </div>
        <Slider label="Practice tempo" value={t.bpm} min={40} max={200} onChange={(v) => trainer.setBpm(v)} format={(v) => `${v} bpm`} />

        {/* tab-style step strip */}
        <div className="scroll-x">
          <div className="flex gap-1 min-w-max py-1">
            {riff.steps.map((s, i) => {
              const state = i === t.stepIndex && t.running ? 'current' : i < t.stepIndex && t.running ? 'past' : 'future'
              return (
                <div
                  key={i}
                  className={`flex flex-col items-center justify-center w-11 h-14 rounded-md border text-xs mono ${
                    state === 'current' ? 'border-warn bg-[#2b2410] text-warn' : state === 'past' ? 'border-line text-ink-3' : 'border-line-2 text-ink-2'
                  }`}
                >
                  <span className="text-[9px] text-ink-3">{STRING_LABELS[s.string]}</span>
                  <span className="text-base font-bold">{s.fret}</span>
                  <span className="text-[9px]">{fretNoteName(s.string, s.fret, flats)}</span>
                </div>
              )
            })}
          </div>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-ink-3">
          <span className={`led green ${t.lastResult === 'hit' ? 'on' : ''}`} />
          <span className={`led ${t.lastResult === 'miss' ? 'on' : ''}`} />
          <span>Play the highlighted position on the neck (mouse, keys or controller) in time with the count. The target is shown in amber on the fretboard.</span>
        </div>
      </Section>
    </div>
  )
}
