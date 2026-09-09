import type { ReactNode } from 'react'
import { useStore } from '../../state/store'
import { actions } from '../../hooks/useStudioActions'
import { Knob } from '../ui/Knob'
import type { EffectsParams } from '../../types'

function Pedal({ name, color, on, onToggle, children }: { name: string; color: string; on: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className="pedal p-3 flex flex-col gap-3 min-w-[150px]" style={{ borderTopColor: color, borderTopWidth: 3 }}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold tracking-wide">{name}</span>
        <span className={`led ${on ? 'on' : ''}`} />
      </div>
      <div className="flex justify-around gap-1">{children}</div>
      <button
        className={`h-9 rounded-md border text-[11px] font-bold tracking-widest ${on ? 'bg-[#1a2a3f] border-accent-2 text-[#bfe0ff]' : 'bg-[#0e1115] border-line-2 text-ink-3'}`}
        onClick={onToggle}
        aria-pressed={on}
      >
        {on ? 'ON' : 'OFF'}
      </button>
    </div>
  )
}

export function EffectsPanel() {
  const fx = useStore((s) => s.effects)
  const set = <K extends keyof EffectsParams>(k: K, patch: Partial<EffectsParams[K]>) => actions.setEffect(k, patch)
  const toggle = (k: keyof EffectsParams) => actions.setEffect(k, { on: !fx[k].on } as Partial<EffectsParams[typeof k]>)
  const ks = 42

  return (
    <div className="panel p-3">
      <div className="flex items-center justify-between mb-3">
        <h3 className="label">Pedalboard</h3>
        <span className="text-[11px] text-ink-3 hidden sm:inline">Signal: guitar → comp → drive → dist → amp → chorus → delay → reverb</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <Pedal name="COMPRESSOR" color="#3ad29f" on={fx.compressor.on} onToggle={() => toggle('compressor')}>
          <Knob label="Thresh" value={fx.compressor.threshold} min={-50} max={0} step={1} onChange={(v) => set('compressor', { threshold: v })} size={ks} format={(v) => `${v}dB`} />
          <Knob label="Ratio" value={fx.compressor.ratio} min={1} max={12} step={0.5} onChange={(v) => set('compressor', { ratio: v })} size={ks} format={(v) => `${v}:1`} />
          <Knob label="Makeup" value={fx.compressor.makeup} min={0} max={12} step={0.5} onChange={(v) => set('compressor', { makeup: v })} size={ks} format={(v) => `+${v}`} />
        </Pedal>
        <Pedal name="OVERDRIVE" color="#f2b84b" on={fx.overdrive.on} onToggle={() => toggle('overdrive')}>
          <Knob label="Drive" value={fx.overdrive.drive} onChange={(v) => set('overdrive', { drive: v })} size={ks} />
          <Knob label="Tone" value={fx.overdrive.tone} onChange={(v) => set('overdrive', { tone: v })} size={ks} />
          <Knob label="Level" value={fx.overdrive.level} onChange={(v) => set('overdrive', { level: v })} size={ks} />
        </Pedal>
        <Pedal name="DISTORTION" color="#ff4d5e" on={fx.distortion.on} onToggle={() => toggle('distortion')}>
          <Knob label="Drive" value={fx.distortion.drive} onChange={(v) => set('distortion', { drive: v })} size={ks} />
          <Knob label="Tone" value={fx.distortion.tone} onChange={(v) => set('distortion', { tone: v })} size={ks} />
          <Knob label="Level" value={fx.distortion.level} onChange={(v) => set('distortion', { level: v })} size={ks} />
        </Pedal>
        <Pedal name="CHORUS" color="#4da3ff" on={fx.chorus.on} onToggle={() => toggle('chorus')}>
          <Knob label="Rate" value={fx.chorus.rate} onChange={(v) => set('chorus', { rate: v })} size={ks} />
          <Knob label="Depth" value={fx.chorus.depth} onChange={(v) => set('chorus', { depth: v })} size={ks} />
          <Knob label="Mix" value={fx.chorus.mix} onChange={(v) => set('chorus', { mix: v })} size={ks} />
        </Pedal>
        <Pedal name="DELAY" color="#b48cff" on={fx.delay.on} onToggle={() => toggle('delay')}>
          <Knob label="Time" value={fx.delay.time} min={40} max={1200} step={10} onChange={(v) => set('delay', { time: v })} size={ks} format={(v) => `${v}ms`} />
          <Knob label="Feedback" value={fx.delay.feedback} onChange={(v) => set('delay', { feedback: v })} size={ks} />
          <Knob label="Mix" value={fx.delay.mix} onChange={(v) => set('delay', { mix: v })} size={ks} />
        </Pedal>
        <Pedal name="REVERB" color="#8fd3ff" on={fx.reverb.on} onToggle={() => toggle('reverb')}>
          <Knob label="Room" value={fx.reverb.room} step={1} onChange={(v) => set('reverb', { room: v })} size={ks} />
          <Knob label="Mix" value={fx.reverb.mix} onChange={(v) => set('reverb', { mix: v })} size={ks} />
        </Pedal>
      </div>
    </div>
  )
}
