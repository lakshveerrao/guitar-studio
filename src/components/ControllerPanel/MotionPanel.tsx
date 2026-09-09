import { useEffect, useState } from 'react'
import { AiroMoteInput, MAX_DEVICES, type MotionRole, type MotionSample, type MotionSettings } from '../../input/AiroMoteInput'
import { HidInput, type HidSnapshot } from '../../input/HidInput'
import { useStore } from '../../state/store'
import { Section, Slider, Toggle } from '../ui/controls'

function useMotionSample(slot: number): MotionSample | null {
  const dev = AiroMoteInput.device(slot)
  const [s, setS] = useState<MotionSample | null>(dev.last)
  useEffect(() => {
    let last = 0
    const fn = (sample: MotionSample) => {
      const now = performance.now()
      if (now - last > 40) {
        last = now
        setS(sample)
      }
    }
    dev.listeners.add(fn)
    return () => {
      dev.listeners.delete(fn)
    }
  }, [dev])
  return s
}

function useHidSnapshot(): HidSnapshot {
  const [s, setS] = useState<HidSnapshot>(HidInput.current)
  useEffect(() => {
    let last = 0
    return HidInput.onSnapshot((snap) => {
      const now = performance.now()
      if (now - last > 33 || !snap.connected) {
        last = now
        setS(snap)
      }
    })
  }, [])
  return s
}

function Bar({ label, value, max, unit }: { label: string; value: number; max: number; unit: string }) {
  const t = Math.max(-1, Math.min(1, value / max))
  return (
    <div className="flex items-center gap-2 text-[10px] mono">
      <span className="w-12 text-ink-3">{label}</span>
      <div className="relative flex-1 h-3 bg-[#0e1115] border border-line rounded overflow-hidden">
        <div className="absolute top-0 bottom-0 w-px bg-line-2 left-1/2" />
        <div className="absolute top-0.5 bottom-0.5 rounded bg-accent" style={{ left: t >= 0 ? '50%' : `${50 + t * 50}%`, width: `${Math.abs(t) * 50}%` }} />
      </div>
      <span className="w-16 text-right text-ink-2">
        {value.toFixed(0)}
        {unit}
      </span>
    </div>
  )
}

const ROLE_LABEL: Record<MotionRole, string> = { both: 'Strum + fret', strum: 'Strum hand', fret: 'Fret hand' }

function DeviceRow({ slot }: { slot: number }) {
  const status = useStore((s) => s.motionDevices[slot])
  const sample = useMotionSample(slot)
  const dev = AiroMoteInput.device(slot)
  const connected = status.state === 'connected'
  const busy = status.state === 'connecting' || status.state === 'reconnecting'
  const supported = AiroMoteInput.supported

  return (
    <div className="rounded-lg border border-line bg-[#0e1115] p-3 flex flex-col gap-2 min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold tracking-wide w-24">Controller {slot + 1}</span>
        <span className={`inline-flex items-center gap-1.5 text-[11px] ${connected ? 'text-ok' : busy ? 'text-warn' : 'text-ink-3'}`}>
          <span className={`led green ${connected ? 'on' : ''}`} />
          {status.state}
        </span>
        <span className="text-xs text-ink-2 truncate">{status.name ?? 'not paired'}</span>
        {status.protocol && <span className="mono text-[10px] px-1.5 py-0.5 rounded bg-panel-2 border border-line-2 text-ink-2">{status.protocol === 'airomote' ? 'AiroMote protocol' : status.protocol === 'uart' ? 'UART stream' : 'raw BLE'}</span>}
        {status.battery != null && <span className="mono text-[10px] text-ink-3">battery {status.battery}%</span>}
        <div className="ml-auto flex items-center gap-2">
          {!connected ? (
            <button className="btn !bg-accent-2 !border-accent text-white" onClick={() => void dev.connect()} disabled={busy || !supported}>
              {busy ? 'Connecting…' : status.name ? 'Reconnect' : 'Connect'}
            </button>
          ) : (
            <button className="btn" onClick={() => void dev.disconnect()}>
              Disconnect
            </button>
          )}
          <button className="btn" onClick={() => void dev.forget()} disabled={!status.name}>
            Forget
          </button>
        </div>
      </div>
      {status.error && <div className="text-[11px] text-rec">{status.error}</div>}
      {connected && status.protocol !== 'airomote' && (
        <div className="text-[11px] text-ink-2 leading-snug">
          Connected, but this device does not send AiroMote motion packets, so it cannot strum yet.{' '}
          {status.lastRaw ? (
            <span>
              Latest data ({status.packets} notifications): <span className="mono text-ink">{status.lastRaw}</span>
            </span>
          ) : (
            <span>No data received yet. Move it or press its button.</span>
          )}
        </div>
      )}
      <div className="flex items-center gap-2">
        <span className="label">Role</span>
        <div className="seg">
          {(['both', 'strum', 'fret'] as MotionRole[]).map((r) => (
            <button key={r} className={status.role === r ? 'active' : ''} onClick={() => dev.setRole(r)}>
              {ROLE_LABEL[r]}
            </button>
          ))}
        </div>
      </div>
      {connected && sample && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
          <Bar label="swing X" value={sample.gyro.x} max={600} unit="°/s" />
          <Bar label="pitch" value={sample.pitch} max={90} unit="°" />
          <Bar label="swing Y" value={sample.gyro.y} max={600} unit="°/s" />
          <Bar label="roll" value={sample.roll} max={90} unit="°" />
          <Bar label="twist Z" value={sample.gyro.z} max={600} unit="°/s" />
          <div className="flex items-center gap-2 text-[10px] mono">
            <span className="w-12 text-ink-3">button</span>
            <span className={`led ${sample.button ? 'on' : ''}`} />
            <span className="text-ink-2">{sample.button ? 'pressed' : 'released'}</span>
            <span className="ml-auto text-ink-3">{dev.packets} packets</span>
          </div>
        </div>
      )}
    </div>
  )
}

export function MotionPanel() {
  useStore((s) => s.motionSettingsVersion)
  const devices = useStore((s) => s.motionDevices)
  const settings = AiroMoteInput.currentSettings
  const set = (p: Partial<MotionSettings>) => AiroMoteInput.setSettings(p)
  const connectedCount = devices.filter((d) => d.state === 'connected').length
  const supported = AiroMoteInput.supported

  return (
    <Section
      title="AiroMote Motion Controllers"
      right={
        <span className={`text-[11px] ${connectedCount ? 'text-ok' : 'text-ink-3'}`}>
          {connectedCount} of {MAX_DEVICES} connected
        </span>
      }
    >
      {!supported && (
        <div className="text-[11px] text-warn">Web Bluetooth is only available in Chrome or Edge over HTTPS. Use the Bluetooth HID section below or a gamepad on other browsers.</div>
      )}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        {Array.from({ length: MAX_DEVICES }, (_, i) => (
          <DeviceRow key={i} slot={i} />
        ))}
      </div>
      <p className="text-[12px] text-ink-2 leading-relaxed">
        One controller does everything: swing to strum, roll the wrist to bend, twist to change chords, hold the button to palm mute. With two connected,
        Controller 1 becomes the strum hand and Controller 2 the fret hand (bend, chord twist, button = vibrato). Roles can be changed above.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 pt-2 border-t border-line">
        <Toggle on={settings.acceptAllDevices} onChange={(v) => set({ acceptAllDevices: v })} label="Show every Bluetooth device in the picker" size="sm" />
        <label className="flex items-center gap-2">
          <span className="label whitespace-nowrap">Extra service UUID</span>
          <input
            className="inp mono flex-1 min-w-0 text-[11px]"
            placeholder="optional, e.g. 6e400001-b5a3-f393-e0a9-e50e24dcca9e"
            value={settings.customServiceUuid}
            onChange={(e) => set({ customServiceUuid: e.target.value })}
          />
        </label>
        <Slider label="Strum sensitivity" value={Math.round(600 - settings.strumThreshold)} min={150} max={520} onChange={(v) => set({ strumThreshold: 600 - v })} format={() => `${settings.strumThreshold}°/s`} />
        <div className="flex flex-col gap-1">
          <span className="label">Strum axis</span>
          <div className="seg self-start">
            {(['x', 'y', 'z'] as const).map((a) => (
              <button key={a} className={settings.strumAxis === a ? 'active' : ''} onClick={() => set({ strumAxis: a })}>
                gyro {a.toUpperCase()}
              </button>
            ))}
            <button className={settings.invertStrum ? 'active' : ''} onClick={() => set({ invertStrum: !settings.invertStrum })}>
              invert
            </button>
          </div>
        </div>
        <Toggle on={settings.bendEnabled} onChange={(v) => set({ bendEnabled: v })} label="Wrist roll bends the note" size="sm" />
        <Toggle on={settings.chordTwist} onChange={(v) => set({ chordTwist: v })} label="Quick twist changes chord" size="sm" />
        <Toggle on={settings.buttonMute} onChange={(v) => set({ buttonMute: v })} label="Strum-hand button holds palm mute" size="sm" />
      </div>
    </Section>
  )
}

export function HidPanel() {
  const state = useStore((s) => s.hidState)
  const error = useStore((s) => s.hidError)
  const snap = useHidSnapshot()
  const connected = state === 'connected'
  const busy = state === 'connecting'
  const supported = HidInput.supported

  return (
    <Section
      title="Bluetooth HID Controller"
      right={
        <span className={`inline-flex items-center gap-1.5 text-[11px] ${connected ? 'text-ok' : busy ? 'text-warn' : 'text-ink-3'}`}>
          <span className={`led green ${connected ? 'on' : ''}`} />
          {state}
        </span>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        {!connected ? (
          <button className="btn h-10 px-5 !bg-accent-2 !border-accent text-white" onClick={() => void HidInput.connect()} disabled={busy || !supported}>
            {busy ? 'Connecting…' : 'Connect HID Device'}
          </button>
        ) : (
          <button className="btn h-10" onClick={() => void HidInput.disconnect()}>
            Disconnect
          </button>
        )}
        <button className="btn h-10" onClick={() => void HidInput.forget()} disabled={!snap.name}>
          Forget device
        </button>
        <span className="text-xs text-ink-2 truncate">{snap.name || 'No HID device paired'}</span>
        {snap.name && (
          <span className="mono text-[10px] text-ink-3">
            {snap.vendorId.toString(16).padStart(4, '0')}:{snap.productId.toString(16).padStart(4, '0')}
          </span>
        )}
      </div>
      {error && <div className="text-[11px] text-rec">{error}</div>}
      {!supported && <div className="text-[11px] text-warn">WebHID is only available in Chrome or Edge over HTTPS.</div>}
      {connected ? (
        <div className="flex flex-col gap-2">
          <div className="text-[10px] text-ink-3 mono">
            {snap.buttons.length} buttons · {snap.axes.length} axes · {snap.reports} reports · uses the Gamepad mappings below
          </div>
          {snap.buttons.length > 0 && (
            <div className="grid grid-cols-8 sm:grid-cols-12 gap-1">
              {snap.buttons.map((v, i) => (
                <div key={i} className="h-7 rounded border border-line-2 flex items-center justify-center mono text-[9px]" style={{ background: `rgba(77,163,255,${v * 0.7})` }}>
                  {i}
                </div>
              ))}
            </div>
          )}
          {snap.axes.map((v, i) => (
            <Bar key={i} label={`axis ${i}`} value={v * 100} max={100} unit="%" />
          ))}
        </div>
      ) : (
        <p className="text-[12px] text-ink-2 leading-relaxed">
          Pair a Bluetooth gamepad or joystick in your system Bluetooth settings first, then press <b>Connect HID Device</b> and pick it. Buttons and sticks
          are read straight from its HID reports and use the same mappings as the Gamepad API section, so Learn works here too.
        </p>
      )}
    </Section>
  )
}
