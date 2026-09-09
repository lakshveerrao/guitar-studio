import type { ReactNode } from 'react'

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
  className = '',
}: {
  label?: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  format?: (v: number) => string
  className?: string
}) {
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      {label && (
        <div className="flex items-center justify-between">
          <span className="label">{label}</span>
          <span className="mono text-[10px] text-ink-2">{format ? format(value) : value}</span>
        </div>
      )}
      <input type="range" className="slider" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} />
    </label>
  )
}

export function Toggle({ on, onChange, label, size = 'md' }: { on: boolean; onChange: (v: boolean) => void; label?: string; size?: 'sm' | 'md' }) {
  const w = size === 'sm' ? 30 : 38
  const h = size === 'sm' ? 16 : 20
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className="inline-flex items-center gap-2 cursor-pointer"
    >
      <span
        className="relative inline-block rounded-full transition-colors"
        style={{ width: w, height: h, background: on ? '#2f7fe0' : '#262b33', border: '1px solid ' + (on ? '#4da3ff' : '#30363f') }}
      >
        <span
          className="absolute top-1/2 -translate-y-1/2 rounded-full bg-white transition-all"
          style={{ width: h - 6, height: h - 6, left: on ? w - h + 2 : 2 }}
        />
      </span>
      {label && <span className="text-xs text-ink-2">{label}</span>}
    </button>
  )
}

export function Section({ title, right, children, className = '' }: { title: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel p-3 flex flex-col gap-3 min-w-0 ${className}`}>
      <header className="flex items-center justify-between gap-2">
        <h3 className="label">{title}</h3>
        {right}
      </header>
      {children}
    </section>
  )
}

export function Stat({ label, value, mono = true, accent = false }: { label: string; value: ReactNode; mono?: boolean; accent?: boolean }) {
  return (
    <div className="flex flex-col min-w-0">
      <span className="label">{label}</span>
      <span className={`${mono ? 'mono' : ''} text-sm font-semibold truncate ${accent ? 'text-accent' : 'text-ink'}`}>{value}</span>
    </div>
  )
}
