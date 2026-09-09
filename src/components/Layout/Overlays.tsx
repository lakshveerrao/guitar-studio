import type { ReactNode } from 'react'
import { store, useStore } from '../../state/store'
import { actions } from '../../hooks/useStudioActions'
import { Slider, Toggle } from '../ui/controls'
import { ensureStudio } from '../../audio/Studio'

function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose} role="dialog" aria-modal>
      <div className={`panel w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[90vh] overflow-auto p-4 shadow-2xl`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold tracking-wide">{title}</h2>
          <button className="btn sm" onClick={onClose}>
            Close <span className="kbd ml-1">Esc</span>
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

const K = ({ k }: { k: string }) => <span className="kbd">{k}</span>

export function HelpOverlay() {
  const open = useStore((s) => s.helpOpen)
  if (!open) return null
  const row = (keys: ReactNode, what: string) => (
    <div className="flex items-center justify-between gap-3 py-1.5 border-b border-line/60">
      <span className="flex gap-1 flex-wrap">{keys}</span>
      <span className="text-xs text-ink-2 text-right">{what}</span>
    </div>
  )
  return (
    <Modal title="Keyboard Controls" onClose={() => store.set({ helpOpen: false })} wide>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
        <div>
          <div className="label mb-1">Picking & strumming</div>
          {row(<><K k="1" /> … <K k="6" /></>, 'pick string 6 (low E) … 1 (high e)')}
          {row(<><K k="↓" /> <K k="Space" /></>, 'strum down')}
          {row(<K k="↑" />, 'strum up')}
          {row(<><K k="," /> <K k="." /></>, 'previous / next chord')}
          {row(<K k="X" />, 'silence all strings')}
          <div className="label mb-1 mt-4">Fretting (selected string)</div>
          {row(<><K k="A" /> <K k="S" /> <K k="D" /> <K k="F" /> <K k="G" /> <K k="H" /> <K k="J" /> <K k="K" /> <K k="L" /> <K k=";" /></>, 'fret 1 … 10, plays the note')}
          {row(<><K k="Shift" /> + fret key</>, 'fret 11 … 20')}
          {row(<><K k="0" /> <K k="`" /></>, 'open string')}
          {row(<><K k="←" /> <K k="→" /></>, 'select string')}
        </div>
        <div>
          <div className="label mb-1">Techniques</div>
          {row(<K k="M" />, 'palm mute (hold)')}
          {row(<K k="B" />, 'bend +1 semitone (hold)')}
          {row(<K k="V" />, 'vibrato (hold)')}
          {row(<span className="text-xs text-ink-3">fret key while ringing</span>, 'hammer-on / pull-off')}
          <div className="label mb-1 mt-4">Transport</div>
          {row(<K k="R" />, 'start / stop recording')}
          {row(<><K k="?" /> <K k="H" /></>, 'this help')}
          {row(<K k="Esc" />, 'close dialogs')}
          <div className="label mb-1 mt-4">Mouse & touch</div>
          <p className="text-xs text-ink-2 leading-relaxed">
            Click a string/fret on the neck to fret and play it. Drag a held note upward to bend (up to +2). Click a string over the body to pick it, or drag
            vertically across the strings in the strum zone to strum. Click the O/× column to set open or muted strings.
          </p>
        </div>
      </div>
      <p className="text-[11px] text-ink-3 mt-3">Shortcuts are ignored while typing in a text field.</p>
    </Modal>
  )
}

export function SettingsDialog() {
  const open = useStore((s) => s.settingsOpen)
  const masterVolume = useStore((s) => s.masterVolume)
  const flats = useStore((s) => s.flats)
  const showNotes = useStore((s) => s.showNotes)
  const gamepadName = useStore((s) => s.gamepadName)
  if (!open) return null
  return (
    <Modal title="Settings" onClose={() => store.set({ settingsOpen: false })}>
      <div className="flex flex-col gap-4">
        <Slider label="Master volume" value={Math.round(masterVolume * 100)} min={0} max={100} onChange={(v) => actions.setMasterVolume(v / 100)} format={(v) => `${v}%`} />
        <div className="flex items-center justify-between">
          <span className="text-xs">Note names</span>
          <div className="seg">
            <button className={!flats ? 'active' : ''} onClick={() => store.set({ flats: false })}>
              Sharps (F#)
            </button>
            <button className={flats ? 'active' : ''} onClick={() => store.set({ flats: true })}>
              Flats (Gb)
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs">Show every note on the fretboard</span>
          <Toggle on={showNotes} onChange={(v) => store.set({ showNotes: v })} />
        </div>
        <div className="border-t border-line pt-3">
          <div className="label mb-1">Controllers</div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-ink-2 truncate">{gamepadName ?? 'No Gamepad API device connected'}</span>
            <button className="btn sm" onClick={() => store.set({ settingsOpen: false, tab: 'controller' })}>
              Open mappings
            </button>
          </div>
        </div>
        <div className="border-t border-line pt-3 text-[11px] text-ink-3 leading-relaxed">
          Audio runs entirely in your browser with the Web Audio API. Strings are a Karplus-Strong physical model; the amp and pedals are real signal-chain
          nodes. Nothing is sent to a server.
        </div>
      </div>
    </Modal>
  )
}

export function EnableAudioGate() {
  const ready = useStore((s) => s.audioReady)
  if (ready) return null
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-bg/85 backdrop-blur-sm p-4">
      <div className="panel max-w-md w-full p-6 flex flex-col items-center text-center gap-4 shadow-2xl">
        <div className="text-[10px] tracking-[0.25em] text-ink-3 uppercase">Guitar Studio</div>
        <h1 className="text-2xl font-bold tracking-tight">Virtual Electric Guitar</h1>
        <p className="text-sm text-ink-2 leading-relaxed">
          Six strings, 22 frets, chords, strumming, amp and pedals — all rendered live in your browser. Your browser needs one click before it will
          play sound.
        </p>
        <button
          className="btn h-12 px-8 text-sm !bg-accent-2 !border-accent hover:!bg-accent text-white"
          onClick={() => {
            void ensureStudio()
          }}
        >
          Enable Audio
        </button>
        <p className="text-[11px] text-ink-3">
          Then press <span className="kbd">?</span> for keyboard controls
        </p>
      </div>
    </div>
  )
}
