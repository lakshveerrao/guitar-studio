import { store, useStore } from '../../state/store'
import { actions } from '../../hooks/useStudioActions'
import { PRESETS } from '../../audio/presets'
import { GuitarController } from '../../input/GuitarController'
import { BeatPulse } from '../Metronome/MetronomePanel'
import { AiroMoteInput } from '../../input/AiroMoteInput'
import { HidInput } from '../../input/HidInput'
import { useEffect, useRef, useState } from 'react'

function Logo() {
  return (
    <div className="flex items-center gap-2 select-none">
      <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden>
        <rect x="1" y="1" width="24" height="24" rx="6" fill="#1d5cb8" />
        <rect x="1" y="1" width="24" height="24" rx="6" fill="url(#lg)" />
        <defs>
          <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.25" />
            <stop offset="1" stopColor="#000" stopOpacity="0.25" />
          </linearGradient>
        </defs>
        {[7, 10, 13, 16, 19].map((y, i) => (
          <line key={y} x1="5" y1={y} x2="21" y2={y} stroke="#f4f1e6" strokeWidth={1.6 - i * 0.2} strokeOpacity={0.9} />
        ))}
      </svg>
      <div className="leading-none">
        <div className="text-[13px] font-bold tracking-tight">Guitar Studio</div>
        <div className="text-[9px] text-ink-3 tracking-[0.18em] uppercase">Virtual Electric</div>
      </div>
    </div>
  )
}

export function TopBar() {
  const presetId = useStore((s) => s.presetId)
  const bpm = useStore((s) => s.bpm)
  const metronomeOn = useStore((s) => s.metronomeOn)
  const recorder = useStore((s) => s.recorder)
  const gamepadName = useStore((s) => s.gamepadName)
  const audioReady = useStore((s) => s.audioReady)
  const masterVolume = useStore((s) => s.masterVolume)
  const motionState = useStore((s) => s.motionState)
  const motionDevices = useStore((s) => s.motionDevices)
  const connectedCount = motionDevices.filter((d) => d.state === 'connected').length
  const motionBusy = motionState === 'connecting'
  const hidState = useStore((s) => s.hidState)
  const hidConnected = hidState === 'connected'
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menuOpen) return
    const close = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [menuOpen])
  const anyConnected = connectedCount > 0 || hidConnected

  return (
    <header className="h-14 shrink-0 border-b border-line bg-panel/90 backdrop-blur px-3 md:px-4 flex items-center gap-2 md:gap-3">
      <Logo />
      <div className="hidden md:block w-px h-7 bg-line mx-1" />

      <label className="hidden sm:flex items-center gap-2">
        <span className="label">Preset</span>
        <select className="sel w-40" value={presetId ?? ''} onChange={(e) => e.target.value && actions.applyPreset(e.target.value)} aria-label="Preset">
          <option value="">Custom</option>
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <div className="hidden sm:flex items-center gap-2">
        <span className="label">Tempo</span>
        <button className={`btn h-8 gap-2 ${metronomeOn ? 'active' : ''}`} onClick={() => actions.toggleMetronome()} title="Metronome">
          <BeatPulse size={9} />
          <span className="mono">{bpm}</span>
        </button>
        <button className="btn h-8 sm" onClick={() => actions.tapTempo()}>
          Tap
        </button>
      </div>

      <button
        className={`btn h-8 rec ${recorder === 'recording' ? 'active' : ''}`}
        onClick={() => GuitarController.recorder.toggleRecord()}
        title="Record performance (R)"
        disabled={!audioReady}
      >
        <span className="w-2 h-2 rounded-full bg-current" />
        <span className="hidden sm:inline">{recorder === 'recording' ? 'Recording' : 'Record'}</span>
      </button>

      <div className="ml-auto flex items-center gap-2">
        <div className="hidden lg:flex items-center gap-2 mr-2">
          <span className="label">Master</span>
          <input type="range" className="slider w-24" min={0} max={100} value={Math.round(masterVolume * 100)} onChange={(e) => actions.setMasterVolume(Number(e.target.value) / 100)} aria-label="Master volume" />
        </div>
        <div className="relative" ref={menuRef}>
          <button
            className={`btn h-8 ${anyConnected ? 'active' : ''}`}
            onClick={() => setMenuOpen((o) => !o)}
            disabled={motionBusy || hidState === 'connecting'}
            title="Connect or disconnect a controller"
          >
            <span className={`led green ${anyConnected ? 'on' : ''}`} />
            <span>
              {motionBusy || hidState === 'connecting'
                ? 'Connecting…'
                : anyConnected
                  ? `${connectedCount + (hidConnected ? 1 : 0)} Connected`
                  : 'Connect Controller'}
            </span>
            <span className="text-ink-3 text-[10px]">▾</span>
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-9 z-40 panel p-1 w-64 shadow-2xl flex flex-col gap-0.5">
              {motionDevices.map((d, i) => (
                <button
                  key={i}
                  className="btn justify-start h-9 !bg-transparent !border-transparent hover:!bg-panel-2"
                  onClick={() => {
                    setMenuOpen(false)
                    const dev = AiroMoteInput.device(i)
                    if (d.state === 'connected') void dev.disconnect()
                    else void dev.connect()
                  }}
                >
                  <span className={`led green ${d.state === 'connected' ? 'on' : ''}`} />
                  <span className="flex-1 text-left">
                    AiroMote {i + 1}
                    <span className="text-ink-3 font-normal"> · Bluetooth</span>
                  </span>
                  <span className="text-[10px] text-ink-2">{d.state === 'connected' ? 'Disconnect' : 'Connect'}</span>
                </button>
              ))}
              <button
                className="btn justify-start h-9 !bg-transparent !border-transparent hover:!bg-panel-2"
                onClick={() => {
                  setMenuOpen(false)
                  if (hidConnected) void HidInput.disconnect()
                  else void HidInput.connect()
                }}
              >
                <span className={`led green ${hidConnected ? 'on' : ''}`} />
                <span className="flex-1 text-left">
                  HID controller
                  <span className="text-ink-3 font-normal"> · Bluetooth / USB</span>
                </span>
                <span className="text-[10px] text-ink-2">{hidConnected ? 'Disconnect' : 'Connect'}</span>
              </button>
              <div className="border-t border-line my-0.5" />
              <button
                className="btn justify-start h-8 !bg-transparent !border-transparent hover:!bg-panel-2 text-ink-2"
                onClick={() => {
                  setMenuOpen(false)
                  store.set({ tab: 'controller' })
                }}
              >
                Controller settings…
              </button>
            </div>
          )}
        </div>
        <button className={`btn h-8 ${gamepadName ? 'active' : ''}`} onClick={() => store.set({ tab: 'controller' })} title={gamepadName ?? 'Gamepad / controller settings'}>
          <span className={`led green ${gamepadName ? 'on' : ''}`} />
          <span className="hidden lg:inline">Gamepad</span>
        </button>
        <button className="btn h-8" onClick={() => store.set({ settingsOpen: true })}>
          <span className="hidden sm:inline">Settings</span>
          <span className="sm:hidden">⚙</span>
        </button>
        <button className="btn h-8 sm" onClick={() => store.set({ helpOpen: true })} title="Keyboard help (?)">
          ?
        </button>
      </div>
    </header>
  )
}
