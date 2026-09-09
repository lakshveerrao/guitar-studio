import { useStore } from '../../state/store'
import { actions } from '../../hooks/useStudioActions'
import { Knob } from '../ui/Knob'
import { PRESETS } from '../../audio/presets'
import type { AmpModel } from '../../types'

const MODELS: AmpModel[] = ['Clean', 'Warm', 'Blues', 'Crunch', 'Rock', 'Lead', 'Metal', 'Ambient']

export function AmpPanel({ compact = false }: { compact?: boolean }) {
  const amp = useStore((s) => s.amp)
  const presetId = useStore((s) => s.presetId)
  const guitarVolume = useStore((s) => s.guitarVolume)
  const guitarTone = useStore((s) => s.guitarTone)
  const pickup = useStore((s) => s.pickup)
  const size = compact ? 46 : 54

  return (
    <div className="flex flex-col gap-3">
      <div className="panel p-3 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="label">Amp Head</h3>
          <select className="sel h-7 text-[11px]" value={presetId ?? ''} onChange={(e) => e.target.value && actions.applyPreset(e.target.value)} aria-label="Preset">
            <option value="">Preset…</option>
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-4 gap-1">
          {MODELS.map((m) => (
            <button key={m} className={`btn sm ${amp.model === m ? 'active' : ''}`} onClick={() => actions.setAmp({ model: m })}>
              {m}
            </button>
          ))}
        </div>
        <div className={`grid ${compact ? 'grid-cols-4' : 'grid-cols-4 xl:grid-cols-7'} gap-y-3 justify-items-center pt-1`}>
          <Knob label="Gain" value={amp.gain} onChange={(v) => actions.setAmp({ gain: v })} size={size} accent="#f2b84b" />
          <Knob label="Bass" value={amp.bass} onChange={(v) => actions.setAmp({ bass: v })} size={size} />
          <Knob label="Mid" value={amp.mid} onChange={(v) => actions.setAmp({ mid: v })} size={size} />
          <Knob label="Treble" value={amp.treble} onChange={(v) => actions.setAmp({ treble: v })} size={size} />
          <Knob label="Presence" value={amp.presence} onChange={(v) => actions.setAmp({ presence: v })} size={size} />
          <Knob label="Master" value={amp.master} onChange={(v) => actions.setAmp({ master: v })} size={size} accent="#3ad29f" />
          <Knob label="Sustain" value={amp.sustain} onChange={(v) => actions.setAmp({ sustain: v })} size={size} />
        </div>
      </div>

      <div className="panel p-3 flex flex-col gap-2">
        <h3 className="label">Guitar</h3>
        <div className="flex items-start justify-between gap-2">
          <Knob label="Volume" value={guitarVolume} onChange={actions.setGuitarVolume} size={44} />
          <Knob label="Tone" value={guitarTone} onChange={actions.setGuitarTone} size={44} />
          <div className="flex flex-col gap-1 flex-1">
            <span className="label">Pickup</span>
            <div className="seg flex-col !p-1">
              {(['neck', 'middle', 'bridge'] as const).map((p) => (
                <button key={p} className={`capitalize ${pickup === p ? 'active' : ''}`} onClick={() => actions.setPickup(p)}>
                  {p}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
