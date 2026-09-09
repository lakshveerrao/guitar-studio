import { useState } from 'react'
import { CHORDS, CHORD_GROUPS, chordById, chordNoteNames } from '../../music/chords'
import { InputManager } from '../../input/InputManager'
import { store, useStore } from '../../state/store'
import { Section } from '../ui/controls'
import type { ChordDef } from '../../types'
import { STRING_LABELS } from '../../music/tuning'

function ChordDiagram({ chord }: { chord: ChordDef }) {
  const maxFret = Math.max(...chord.frets, 1)
  const base = maxFret > 4 ? Math.max(1, Math.min(...chord.frets.filter((f) => f > 0))) : 1
  const rows = 4
  const w = 96
  const h = 104
  const x0 = 16
  const y0 = 22
  const cw = (w - x0 - 8) / 5
  const rh = (h - y0 - 8) / rows
  return (
    <svg width={w} height={h} className="shrink-0">
      {/* nut / base fret */}
      {base === 1 ? <rect x={x0} y={y0 - 3} width={cw * 5} height={3} fill="#e6e9ee" /> : (
        <text x={x0 - 12} y={y0 + rh / 2 + 3} fontSize={8} fill="#9aa3af" className="mono">
          {base}
        </text>
      )}
      {Array.from({ length: rows + 1 }, (_, i) => (
        <line key={i} x1={x0} y1={y0 + i * rh} x2={x0 + cw * 5} y2={y0 + i * rh} stroke="#3a424d" strokeWidth={1} />
      ))}
      {Array.from({ length: 6 }, (_, i) => (
        <line key={i} x1={x0 + i * cw} y1={y0} x2={x0 + i * cw} y2={y0 + rows * rh} stroke="#5f6875" strokeWidth={i === 0 ? 1.5 : 1} />
      ))}
      {chord.frets.map((f, s) => {
        const x = x0 + s * cw
        if (f < 0)
          return (
            <text key={s} x={x} y={y0 - 7} fontSize={9} textAnchor="middle" fill="#ff7a86" fontWeight={700}>
              ×
            </text>
          )
        if (f === 0)
          return <circle key={s} cx={x} cy={y0 - 9} r={3} fill="none" stroke="#bfe0ff" strokeWidth={1.2} />
        const row = f - base
        if (row < 0 || row >= rows) return null
        const y = y0 + row * rh + rh / 2
        const finger = chord.fingers?.[s] ?? 0
        return (
          <g key={s}>
            <circle cx={x} cy={y} r={6} fill="#4da3ff" />
            {finger > 0 && (
              <text x={x} y={y + 2.8} fontSize={7.5} textAnchor="middle" fill="#06111f" fontWeight={800}>
                {finger}
              </text>
            )}
          </g>
        )
      })}
      {STRING_LABELS.map((l, i) => (
        <text key={i} x={x0 + i * cw} y={h - 1} fontSize={7} textAnchor="middle" fill="#5f6875" className="mono">
          {l}
        </text>
      ))}
    </svg>
  )
}

export function ChordPanel() {
  const chordId = useStore((s) => s.chordId)
  const flats = useStore((s) => s.flats)
  const frets = useStore((s) => s.frets)
  const [group, setGroup] = useState<ChordDef['group']>('open')
  const chord = chordId ? chordById(chordId) : undefined
  const list = CHORDS.filter((c) => c.group === group)
  const notes = chordNoteNames(chord ? chord.frets : frets, flats)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-3">
      <Section
        title="Chord Library"
        right={
          <div className="seg">
            {CHORD_GROUPS.map((g) => (
              <button key={g.id} className={group === g.id ? 'active' : ''} onClick={() => setGroup(g.id)}>
                {g.label}
              </button>
            ))}
          </div>
        }
      >
        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
          {list.map((c) => (
            <button
              key={c.id}
              className={`btn h-11 text-sm ${chordId === c.id ? 'active' : ''}`}
              onClick={() => InputManager.dispatch({ type: 'SELECT_CHORD', id: c.id }, 'mouse')}
            >
              {c.name}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button className="btn" onClick={() => InputManager.dispatch({ type: 'SELECT_CHORD', delta: -1 }, 'mouse')}>
            ‹ Prev
          </button>
          <button className="btn" onClick={() => InputManager.dispatch({ type: 'SELECT_CHORD', delta: 1 }, 'mouse')}>
            Next ›
          </button>
          <span className="w-px h-6 bg-line mx-1" />
          <button className="btn" onClick={() => InputManager.dispatch({ type: 'STRUM_DOWN' }, 'mouse')}>
            ↓ Strum Down
          </button>
          <button className="btn" onClick={() => InputManager.dispatch({ type: 'STRUM_UP' }, 'mouse')}>
            ↑ Strum Up
          </button>
          <span className="text-[11px] text-ink-3 ml-auto hidden md:inline">
            Keys <span className="kbd">,</span> <span className="kbd">.</span> change chord · <span className="kbd">↓</span> <span className="kbd">↑</span> strum
          </span>
        </div>
      </Section>

      <Section title="Current Chord" right={<button className="btn sm" onClick={() => store.set({ flats: !flats })}>{flats ? '♭ names' : '♯ names'}</button>}>
        <div className="flex items-center gap-4">
          {chord ? <ChordDiagram chord={chord} /> : (
            <div className="w-24 h-26 flex items-center justify-center text-[11px] text-ink-3 text-center border border-dashed border-line rounded-md">
              custom<br />fingering
            </div>
          )}
          <div className="flex flex-col gap-2 min-w-0">
            <div className="text-3xl font-bold tracking-tight">{chord?.name ?? 'Custom'}</div>
            <div className="flex flex-wrap gap-1">
              {notes.length ? (
                notes.map((n) => (
                  <span key={n} className="mono text-xs px-2 py-0.5 rounded bg-panel-2 border border-line-2 text-ink">
                    {n}
                  </span>
                ))
              ) : (
                <span className="text-xs text-ink-3">all strings muted</span>
              )}
            </div>
            <div className="mono text-[11px] text-ink-3">
              {(chord ? chord.frets : frets).map((f) => (f < 0 ? 'x' : f)).join(' ')}
              <span className="text-ink-3/60"> · E A D G B e</span>
            </div>
          </div>
        </div>
      </Section>
    </div>
  )
}
