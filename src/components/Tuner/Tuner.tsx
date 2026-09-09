import { useStore } from '../../state/store'
import { STRING_LABELS, STRING_NAMES_FULL, fretFrequency, fretMidi } from '../../music/tuning'
import { midiToNameWithOctave } from '../../music/notes'
import { Section } from '../ui/controls'
import { store } from '../../state/store'

/**
 * Reference tuner. Derives note, frequency and cents from the selected
 * string's current fret + bend (this is a virtual instrument: the pitch is
 * known exactly, so the needle shows the bend offset from the nearest note).
 */
export function Tuner() {
  const selected = useStore((s) => s.selectedString)
  const frets = useStore((s) => s.frets)
  const bend = useStore((s) => s.bend)
  const bendString = useStore((s) => s.bendString)
  const flats = useStore((s) => s.flats)

  const fret = Math.max(0, frets[selected])
  const appliesBend = bend > 0 && (bendString === null || bendString === selected)
  const b = appliesBend ? bend : 0
  const freq = fretFrequency(selected, fret, b)
  const nearest = Math.round(fretMidi(selected, fret) + b)
  const cents = Math.round((fretMidi(selected, fret) + b - nearest) * 100)
  const name = midiToNameWithOctave(nearest, flats)
  const angle = Math.max(-45, Math.min(45, (cents / 50) * 45))

  return (
    <Section title="Tuner">
      <div className="flex items-center gap-3">
        <div className="seg flex-col !p-1">
          {STRING_LABELS.map((_, i) => (
            <button key={i} className={`!h-6 !px-2 ${selected === i ? 'active' : ''}`} onClick={() => store.set({ selectedString: i })}>
              <span className="mono">{STRING_NAMES_FULL[i]}</span>
            </button>
          ))}
        </div>
        <div className="flex-1 flex flex-col items-center gap-1">
          <svg viewBox="0 0 160 90" className="w-full max-w-[200px]">
            <path d="M 12 82 A 68 68 0 0 1 148 82" fill="none" stroke="#262b33" strokeWidth={6} strokeLinecap="round" />
            <path d="M 68 26 A 68 68 0 0 1 92 26" fill="none" stroke="#3ad29f" strokeWidth={6} strokeLinecap="round" opacity={0.6} />
            {[-45, -30, -15, 0, 15, 30, 45].map((a) => (
              <line
                key={a}
                x1={80 + 58 * Math.sin((a * Math.PI) / 180)}
                y1={82 - 58 * Math.cos((a * Math.PI) / 180)}
                x2={80 + 64 * Math.sin((a * Math.PI) / 180)}
                y2={82 - 64 * Math.cos((a * Math.PI) / 180)}
                stroke="#5f6875"
                strokeWidth={a === 0 ? 2 : 1}
              />
            ))}
            <line x1={80} y1={82} x2={80 + 60 * Math.sin((angle * Math.PI) / 180)} y2={82 - 60 * Math.cos((angle * Math.PI) / 180)} stroke={Math.abs(cents) < 5 ? '#3ad29f' : '#f2b84b'} strokeWidth={2.5} strokeLinecap="round" style={{ transition: 'all .12s' }} />
            <circle cx={80} cy={82} r={4} fill="#e6e9ee" />
            <text x={14} y={78} fontSize={8} fill="#5f6875" className="mono">♭</text>
            <text x={140} y={78} fontSize={8} fill="#5f6875" className="mono">♯</text>
          </svg>
          <div className="flex items-baseline gap-3">
            <span className="text-2xl font-bold tracking-tight">{name}</span>
            <span className="mono text-xs text-ink-2">{freq.toFixed(2)} Hz</span>
            <span className={`mono text-xs ${Math.abs(cents) < 5 ? 'text-ok' : 'text-warn'}`}>
              {cents >= 0 ? '+' : ''}
              {cents}¢
            </span>
          </div>
          <div className="text-[10px] text-ink-3">
            string {6 - selected} · {fret === 0 ? 'open' : `fret ${fret}`}
            {appliesBend ? ` · bend +${(Math.round(bend * 2) / 2).toFixed(1)}` : ''}
          </div>
        </div>
      </div>
    </Section>
  )
}
