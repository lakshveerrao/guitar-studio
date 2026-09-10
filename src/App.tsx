import { useEffect, useState } from 'react'
import { store, useStore, type Tab } from './state/store'
import { TopBar } from './components/Layout/TopBar'
import { StatusBar } from './components/Layout/StatusBar'
import { EnableAudioGate, HelpOverlay, SettingsDialog } from './components/Layout/Overlays'
import { Guitar } from './components/Guitar/Guitar'
import { PlayPanel } from './components/Guitar/PlayPanel'
import { ChordPanel } from './components/ChordPanel/ChordPanel'
import { AmpPanel } from './components/AmpPanel/AmpPanel'
import { EffectsPanel } from './components/EffectsPanel/EffectsPanel'
import { RiffTrainerPanel } from './components/RiffTrainer/RiffTrainerPanel'
import { LooperPanel } from './components/Looper/LooperPanel'
import { ControllerPanel } from './components/ControllerPanel/ControllerPanel'
import { attachKeyboard } from './input/KeyboardInput'
import { GamepadInput } from './input/GamepadInput'
import { HidInput } from './input/HidInput'
import { startBridge } from './input/BridgeInput'
import { GuitarController } from './input/GuitarController'
import { ensureStudio } from './audio/Studio'
import { AudioSystem } from './audio/AudioSystem'

const TABS: { id: Tab; label: string }[] = [
  { id: 'play', label: 'PLAY' },
  { id: 'chords', label: 'CHORDS' },
  { id: 'amp', label: 'AMP' },
  { id: 'effects', label: 'EFFECTS' },
  { id: 'riffs', label: 'RIFFS' },
  { id: 'looper', label: 'LOOPER' },
  { id: 'controller', label: 'CONTROLLER' },
]

export default function App() {
  const tab = useStore((s) => s.tab)
  const audioReady = useStore((s) => s.audioReady)
  // the context exists but is not producing sound (iOS interruption, backgrounding, a suspended tab)
  const [audioStalled, setAudioStalled] = useState(false)

  useEffect(() => {
    // make sure the controller singleton is constructed and wired
    void GuitarController
    const detachKeys = attachKeyboard()
    GamepadInput.start()
    void HidInput.reconnectPermitted()
    const bridgeParam = new URLSearchParams(location.search).get('bridge')
    const stopBridge = import.meta.env.DEV && bridgeParam ? startBridge(bridgeParam.startsWith('ws') ? bridgeParam : undefined) : null
    // Any gesture unlocks audio (autoplay policy) and, for the life of the page, brings it back
    // whenever the context has left 'running' (iOS interruptions, backgrounding, screen lock).
    const onGesture = () => {
      const ctx = AudioSystem.context
      if (!ctx || ctx.state !== 'running') void ensureStudio()
    }
    // Returning to the tab: only resume an existing context; creating one here would be outside a gesture
    // and would drop the Enable Audio gate while the context is still suspended.
    const onVisible = () => {
      const ctx = AudioSystem.context
      if (!document.hidden && ctx && ctx.state !== 'running') void AudioSystem.unlock()
    }
    window.addEventListener('pointerdown', onGesture)
    window.addEventListener('keydown', onGesture)
    document.addEventListener('visibilitychange', onVisible)
    const unsubAudio = AudioSystem.subscribe((running) => setAudioStalled(!!AudioSystem.context && !running))
    return () => {
      detachKeys()
      GamepadInput.stop()
      stopBridge?.()
      window.removeEventListener('pointerdown', onGesture)
      window.removeEventListener('keydown', onGesture)
      document.removeEventListener('visibilitychange', onVisible)
      unsubAudio()
    }
  }, [])

  return (
    <div className="h-full flex flex-col bg-bg text-ink">
      <TopBar />
      <main className="flex-1 min-h-0 overflow-auto">
        <div className="max-w-[1800px] mx-auto p-3 md:p-4 flex flex-col gap-3">
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-3 items-start">
            <div className="flex flex-col gap-3 min-w-0">
              <div className="panel p-2 md:p-3 overflow-hidden bg-[radial-gradient(ellipse_at_center,#161a21_0%,#0e1115_70%)]">
                <Guitar />
              </div>
              <StatusBar />
            </div>
            <aside className="hidden xl:block">
              <AmpPanel compact />
            </aside>
          </div>

          <div className="panel overflow-hidden">
            <div className="tabbar flex border-b border-line overflow-x-auto">
              {TABS.map((t) => (
                <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => store.set({ tab: t.id })}>
                  {t.label}
                </button>
              ))}
            </div>
            <div className="p-3">
              {tab === 'play' && <PlayPanel />}
              {tab === 'chords' && <ChordPanel />}
              {tab === 'amp' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <AmpPanel />
                  <div className="panel p-3 text-xs text-ink-2 leading-relaxed">
                    <div className="label mb-2">Signal path</div>
                    Strings → pickup resonance → tone/volume → compressor → overdrive → distortion → <b className="text-ink">pre-gain → waveshaper → bass / mid / treble → presence → cabinet</b> → chorus → delay
                    → reverb → master → limiter.
                    <div className="mt-3 text-ink-3">
                      Gain drives the amp into its clipping curve. Sustain changes the physical string damping, so notes ring longer at the source instead of
                      just getting louder.
                    </div>
                  </div>
                </div>
              )}
              {tab === 'effects' && <EffectsPanel />}
              {tab === 'riffs' && <RiffTrainerPanel />}
              {tab === 'looper' && <LooperPanel />}
              {tab === 'controller' && <ControllerPanel />}
            </div>
          </div>
        </div>
      </main>
      {audioReady && audioStalled && (
        <button
          type="button"
          className="fixed bottom-3 left-1/2 -translate-x-1/2 z-30 btn h-9 px-4 !bg-warn/15 !border-warn/60 text-warn shadow-lg"
          onClick={() => void AudioSystem.unlock()}
        >
          Audio paused — tap to resume
        </button>
      )}
      {!audioReady && <EnableAudioGate />}
      <HelpOverlay />
      <SettingsDialog />
    </div>
  )
}
