import { store, useStore } from '../../state/store'
import { InputManager } from '../../input/InputManager'
import { GuitarController } from '../../input/GuitarController'
import { actions } from '../../hooks/useStudioActions'
import { Section, Slider, Toggle } from '../ui/controls'
import { Tuner } from '../Tuner/Tuner'
import { MetronomePanel } from '../Metronome/MetronomePanel'

export function PlayPanel() {
  const mode = useStore((s) => s.mode)
  const palmMute = useStore((s) => s.palmMute)
  const vibrato = useStore((s) => s.vibrato)
  const vibratoDepth = useStore((s) => s.vibratoDepth)
  const vibratoRate = useStore((s) => s.vibratoRate)
  const strumSpeed = useStore((s) => s.strumSpeed)
  const strumStrength = useStore((s) => s.strumStrength)
  const bend = useStore((s) => s.bend)
  const showNotes = useStore((s) => s.showNotes)
  const chordId = useStore((s) => s.chordId)
  const crowdOn = useStore((s) => s.crowdOn)
  const showPlayer = useStore((s) => s.showPlayer)
  const showStage = useStore((s) => s.showStage)

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
      <Section
        title="Strum"
        right={
          <span className="text-[10px] text-ink-3 hidden sm:inline">
            drag across strings in the strum zone
          </span>
        }
      >
        <div className="grid grid-cols-2 gap-2">
          <button
            className="btn h-12 text-sm"
            onPointerDown={(e) => {
              e.preventDefault()
              InputManager.dispatch({ type: 'STRUM_DOWN' }, e.pointerType === 'touch' ? 'touch' : 'mouse')
            }}
          >
            ↓ Down
          </button>
          <button
            className="btn h-12 text-sm"
            onPointerDown={(e) => {
              e.preventDefault()
              InputManager.dispatch({ type: 'STRUM_UP' }, e.pointerType === 'touch' ? 'touch' : 'mouse')
            }}
          >
            ↑ Up
          </button>
        </div>
        <Slider label="Strum Speed" value={Math.round(strumSpeed * 100)} min={0} max={100} onChange={(v) => store.set({ strumSpeed: v / 100 })} format={(v) => `${Math.round(45 - (v / 100) * 30)}ms`} />
        <Slider label="Strum Strength" value={Math.round(strumStrength * 100)} min={10} max={100} onChange={(v) => store.set({ strumStrength: v / 100 })} format={(v) => `${v}%`} />
      </Section>

      <Section title="Technique">
        <div className="grid grid-cols-2 gap-2">
          <button
            className={`btn h-12 text-sm ${palmMute ? 'active' : ''}`}
            onClick={() => InputManager.dispatch({ type: 'PALM_MUTE', on: !palmMute }, 'mouse')}
            aria-pressed={palmMute}
          >
            Palm Mute <span className="kbd ml-1">M</span>
          </button>
          <button
            className={`btn h-12 text-sm ${vibrato ? 'active' : ''}`}
            onClick={() => InputManager.dispatch({ type: 'VIBRATO', on: !vibrato }, 'mouse')}
            aria-pressed={vibrato}
          >
            Vibrato <span className="kbd ml-1">V</span>
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Slider label="Vib Depth" value={vibratoDepth} min={5} max={80} onChange={(v) => actions.setVibratoParams(v, vibratoRate)} format={(v) => `${v}¢`} />
          <Slider label="Vib Rate" value={vibratoRate} min={3} max={9} step={0.5} onChange={(v) => actions.setVibratoParams(vibratoDepth, v)} format={(v) => `${v}Hz`} />
        </div>
        <div className="flex items-center gap-2">
          <span className="label">Bend</span>
          <div className="flex-1 h-1.5 bg-line rounded-full overflow-hidden">
            <div className="h-full bg-warn transition-all" style={{ width: `${(bend / 2) * 100}%` }} />
          </div>
          <span className="mono text-xs text-warn w-10 text-right">+{(Math.round(bend * 2) / 2).toFixed(1)}</span>
        </div>
        <div className="flex gap-1">
          {[0.5, 1, 1.5, 2].map((v) => (
            <button
              key={v}
              className="btn sm flex-1"
              onPointerDown={() => InputManager.dispatch({ type: 'BEND', amount: v }, 'mouse')}
              onPointerUp={() => InputManager.dispatch({ type: 'BEND', amount: 0 }, 'mouse')}
              onPointerLeave={() => bend > 0 && InputManager.dispatch({ type: 'BEND', amount: 0 }, 'mouse')}
            >
              +{v}
            </button>
          ))}
          <span className="text-[10px] text-ink-3 self-center ml-1 hidden sm:inline">hold · or drag a fretted note upward</span>
        </div>
      </Section>

      <Section
        title="Fretboard"
        right={
          <div className="seg">
            <button className={mode === 'chord' ? 'active' : ''} onClick={() => GuitarController.setMode('chord')}>
              Chord
            </button>
            <button className={mode === 'fretboard' ? 'active' : ''} onClick={() => GuitarController.setMode('fretboard')}>
              Fretboard
            </button>
          </div>
        }
      >
        <div className="grid grid-cols-2 gap-2">
          <button className="btn" onClick={() => GuitarController.clearFretting()}>
            Clear
          </button>
          <button
            className="btn"
            onClick={() => {
              if (chordId) InputManager.dispatch({ type: 'SELECT_CHORD', id: chordId }, 'mouse')
              else GuitarController.clearFretting()
              InputManager.dispatch({ type: 'BEND', amount: 0 }, 'mouse')
            }}
          >
            Reset
          </button>
          <button className="btn" onClick={() => GuitarController.setFrets([0, 0, 0, 0, 0, 0])}>
            Open Strings
          </button>
          <button className="btn" onClick={() => GuitarController.muteAllStrings()}>
            Mute All
          </button>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          <Toggle on={showStage} onChange={(v) => store.set({ showStage: v })} label="Stage scene" size="sm" />
          <Toggle on={showPlayer} onChange={(v) => store.set({ showPlayer: v })} label="Show guitarist" size="sm" />
          <Toggle on={crowdOn} onChange={(v) => actions.setCrowd(v)} label="Crowd applause" size="sm" />
        </div>
        <div className="flex items-center justify-between">
          <Toggle on={showNotes} onChange={(v) => store.set({ showNotes: v })} label="Show all notes" size="sm" />
          <button className="btn sm" onClick={() => InputManager.dispatch({ type: 'MUTE_ALL' }, 'mouse')}>
            Silence <span className="kbd ml-1">X</span>
          </button>
        </div>
        <p className="text-[11px] text-ink-3 leading-snug">
          {mode === 'chord'
            ? 'Chord mode: pick a chord in the Chords tab, then strum. Clicking the neck plays single notes on top.'
            : 'Fretboard mode: click any string/fret to fret and play it. Use the O/× column to set open or muted strings, then strum your custom voicing.'}
        </p>
      </Section>

      <div className="flex flex-col gap-3">
        <Tuner />
        <MetronomePanel compact />
      </div>
    </div>
  )
}
