import { useCallback, useRef } from 'react'

interface KnobProps {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (v: number) => void
  size?: number
  format?: (v: number) => string
  accent?: string
}

/**
 * Rotary knob: drag vertically (or use the keyboard arrows) to change.
 * 270 degrees of travel like a real amp pot.
 */
export function Knob({ label, value, min = 0, max = 10, step = 0.1, onChange, size = 52, format, accent = '#4da3ff' }: KnobProps) {
  const start = useRef<{ y: number; v: number } | null>(null)
  const t = (value - min) / (max - min)
  const angle = -135 + t * 270
  const r = size / 2
  const arc = (from: number, to: number) => {
    const a0 = ((from - 90) * Math.PI) / 180
    const a1 = ((to - 90) * Math.PI) / 180
    const rr = r - 4
    const x0 = r + rr * Math.cos(a0)
    const y0 = r + rr * Math.sin(a0)
    const x1 = r + rr * Math.cos(a1)
    const y1 = r + rr * Math.sin(a1)
    const large = to - from > 180 ? 1 : 0
    return `M ${x0} ${y0} A ${rr} ${rr} 0 ${large} 1 ${x1} ${y1}`
  }

  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step))

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      start.current = { y: e.clientY, v: value }
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      e.preventDefault()
    },
    [value],
  )
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!start.current) return
      const dy = start.current.y - e.clientY
      const range = max - min
      const next = clamp(start.current.v + (dy / 150) * range * (e.shiftKey ? 0.2 : 1))
      if (next !== value) onChange(next)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [max, min, onChange, value],
  )
  const onPointerUp = () => {
    start.current = null
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    const big = (max - min) / 10
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') onChange(clamp(value + (e.shiftKey ? big : step)))
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') onChange(clamp(value - (e.shiftKey ? big : step)))
    else return
    e.preventDefault()
  }
  const onWheel = (e: React.WheelEvent) => {
    const dir = e.deltaY < 0 ? 1 : -1
    onChange(clamp(value + dir * (max - min) * 0.02))
  }

  return (
    <div className="flex flex-col items-center gap-1 select-none" style={{ width: size + 12 }}>
      <div
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        onWheel={onWheel}
        onDoubleClick={() => onChange(clamp((min + max) / 2))}
        className="relative cursor-ns-resize rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        style={{ width: size, height: size, touchAction: 'none' }}
      >
        <svg width={size} height={size} className="absolute inset-0">
          <path d={arc(-135, 135)} stroke="#262b33" strokeWidth={3} fill="none" strokeLinecap="round" />
          {t > 0.002 && <path d={arc(-135, angle)} stroke={accent} strokeWidth={3} fill="none" strokeLinecap="round" />}
          <circle cx={r} cy={r} r={r - 9} fill="url(#knobFace)" stroke="#0a0c0f" strokeWidth={1} />
          <defs>
            <radialGradient id="knobFace" cx="0.35" cy="0.3" r="0.8">
              <stop offset="0" stopColor="#3a414b" />
              <stop offset="1" stopColor="#151920" />
            </radialGradient>
          </defs>
          <line
            x1={r}
            y1={r}
            x2={r + (r - 13) * Math.sin((angle * Math.PI) / 180)}
            y2={r - (r - 13) * Math.cos((angle * Math.PI) / 180)}
            stroke="#e6e9ee"
            strokeWidth={2.2}
            strokeLinecap="round"
          />
        </svg>
      </div>
      <div className="label text-center leading-tight">{label}</div>
      <div className="mono text-[10px] text-ink-2 -mt-0.5">{format ? format(value) : value.toFixed(step < 1 ? 1 : 0)}</div>
    </div>
  )
}
