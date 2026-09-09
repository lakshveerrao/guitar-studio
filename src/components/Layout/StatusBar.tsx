import { useStore } from '../../state/store'
import { chordById } from '../../music/chords'
import { fretNoteNameOctave, STRING_LABELS } from '../../music/tuning'
import { Stat } from '../ui/controls'

const SOURCE_LABEL: Record<string, string> = {
  mouse: 'Mouse',
  touch: 'Touch',
  keyboard: 'Keyboard',
  gamepad: 'Gamepad',
  motion: 'AiroMote',
  playback: 'Playback',
  trainer: 'Trainer',
  none: '—',
}

export function StatusBar() {
  const chordId = useStore((s) => s.chordId)
  const lastNote = useStore((s) => s.lastNote)
  const lastTechnique = useStore((s) => s.lastTechnique)
  const bpm = useStore((s) => s.bpm)
  const source = useStore((s) => s.inputSource)
  const gamepadName = useStore((s) => s.gamepadName)
  const motionState = useStore((s) => s.motionState)
  const motionName = useStore((s) => s.motionName)
  const hidName = useStore((s) => s.hidName)
  const hidState = useStore((s) => s.hidState)
  const flats = useStore((s) => s.flats)
  const palmMute = useStore((s) => s.palmMute)
  const bend = useStore((s) => s.bend)
  const vibrato = useStore((s) => s.vibrato)
  const chord = chordId ? chordById(chordId) : undefined

  return (
    <div className="panel px-3 py-2 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 items-center">
      <Stat label="Chord" value={chord?.name ?? 'Custom'} mono={false} accent={!!chord} />
      <Stat
        label="Note"
        value={
          lastNote ? (
            <>
              {fretNoteNameOctave(lastNote.string, lastNote.fret, flats)}
              <span className="text-ink-3 text-[10px] ml-1">
                {STRING_LABELS[lastNote.string]}·{lastNote.fret}
                {lastTechnique === 'hammer' ? ' H' : lastTechnique === 'pull' ? ' P' : ''}
              </span>
            </>
          ) : (
            '—'
          )
        }
      />
      <Stat label="BPM" value={bpm} />
      <Stat label="Input" value={SOURCE_LABEL[source] ?? source} mono={false} />
      <Stat
        label="Controller"
        value={
          <span className="inline-flex items-center gap-1.5">
            <span className={`led green ${gamepadName || motionState === 'connected' || hidState === 'connected' ? 'on' : ''}`} />
            <span className="truncate">
              {motionState === 'connected'
                ? motionName ?? 'AiroMote'
                : hidState === 'connected'
                  ? hidName ?? 'HID controller'
                  : gamepadName
                    ? gamepadName.split('(')[0].trim()
                    : 'not connected'}
            </span>
          </span>
        }
        mono={false}
      />
      <div className="flex items-center gap-1.5 justify-start lg:justify-end">
        <span className={`btn sm pointer-events-none ${palmMute ? 'active' : 'opacity-40'}`}>PM</span>
        <span className={`btn sm pointer-events-none ${vibrato ? 'active' : 'opacity-40'}`}>VIB</span>
        <span className={`btn sm pointer-events-none mono ${bend > 0 ? 'active' : 'opacity-40'}`}>+{(Math.round(bend * 2) / 2).toFixed(1)}</span>
      </div>
    </div>
  )
}
