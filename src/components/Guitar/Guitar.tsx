import { useCallback, useEffect, useMemo, useRef } from 'react'
import { store, useStore } from '../../state/store'
import { InputManager } from '../../input/InputManager'
import { chordById } from '../../music/chords'
import { NUM_FRETS, NUM_STRINGS, STRING_LABELS, STRING_WOUND, fretNoteName } from '../../music/tuning'
import { GuitarBody } from './GuitarBody'
import { GuitarNeck } from './GuitarNeck'
import { Crowd, StageBackdrop } from './Stage'
import { PlayerArms, PlayerBody, PlayerHands, usePlayerPose } from './Player'
import {
  BRIDGE_X,
  NECK_END_X,
  NUT_X,
  OPEN_ZONE_X0,
  STATUS_X,
  STRING_WIDTHS,
  VB_H,
  VB_W,
  fretAt,
  fretCenterX,
  fretX,
  nearestString,
  neckBottom,
  neckTop,
  stringGap,
  stringY,
} from './geometry'
import type { InputSource, StringIndex } from '../../types'
import { getStudio } from '../../audio/Studio'

type Drag =
  | { kind: 'fret'; string: StringIndex; fret: number; x0: number; y0: number; bend: number }
  | { kind: 'strum'; lastY: number; lastT: number }

const STRING_COLORS = ['#c9b283', '#c9b283', '#c9b283', '#d9dce3', '#d9dce3', '#d9dce3']
const STRING_HI = ['#efe0bb', '#efe0bb', '#efe0bb', '#ffffff', '#ffffff', '#ffffff']

export function Guitar() {
  const svgRef = useRef<SVGSVGElement>(null)
  const stringRefs = useRef<(SVGPathElement | null)[]>([])
  const dragRef = useRef<Drag | null>(null)

  const frets = useStore((s) => s.frets)
  const chordId = useStore((s) => s.chordId)
  const showNotes = useStore((s) => s.showNotes)
  const flats = useStore((s) => s.flats)
  const selectedString = useStore((s) => s.selectedString)
  const bend = useStore((s) => s.bend)
  const bendString = useStore((s) => s.bendString)
  const target = useStore((s) => (s.trainer.running ? s.trainer.target : null))
  const pickup = useStore((s) => s.pickup)
  const guitarVolume = useStore((s) => s.guitarVolume)
  const guitarTone = useStore((s) => s.guitarTone)
  const ringing = useStore((s) => s.ringing)
  const showPlayer = useStore((s) => s.showPlayer)
  const showStage = useStore((s) => s.showStage)
  const STAGE_TOP = -205
  const pose = usePlayerPose()
  const STAGE_BOTTOM = 560

  const chord = chordId ? chordById(chordId) : undefined

  // ---- string vibration animation (imperative, no React re-render) ----
  useEffect(() => {
    let raf = 0
    const base = (s: number) => {
      const y0 = stringY(s, NUT_X)
      const y1 = stringY(s, BRIDGE_X)
      return `M ${NUT_X - 6} ${y0} L ${BRIDGE_X + 12} ${y1}`
    }
    stringRefs.current.forEach((el, s) => el && el.setAttribute('d', base(s)))
    const tick = () => {
      const st = store.get()
      const now = performance.now()
      for (let s = 0; s < NUM_STRINGS; s++) {
        const el = stringRefs.current[s]
        if (!el) continue
        const age = now - st.pluckStamp[s]
        if (age < 700) {
          const amp = 3.2 * Math.exp(-age / 220)
          const wob = Math.sin(age * 0.09) * amp
          const y0 = stringY(s, NUT_X)
          const y1 = stringY(s, BRIDGE_X)
          const mx = (NUT_X + BRIDGE_X) / 2
          el.setAttribute('d', `M ${NUT_X - 6} ${y0} Q ${mx} ${(y0 + y1) / 2 + wob} ${BRIDGE_X + 12} ${y1}`)
        } else if (age < 760) {
          el.setAttribute('d', base(s))
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  // ---- pointer handling ----
  const toSvg = useCallback((e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current
    if (!svg) return { x: -1, y: -1 }
    const ctm = svg.getScreenCTM()
    if (!ctm) return { x: -1, y: -1 }
    const inv = ctm.inverse()
    return { x: inv.a * e.clientX + inv.c * e.clientY + inv.e, y: inv.b * e.clientX + inv.d * e.clientY + inv.f }
  }, [])

  const sourceOf = (e: React.PointerEvent): InputSource => (e.pointerType === 'touch' ? 'touch' : 'mouse')

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    const { x, y } = toSvg(e)
    const src = sourceOf(e)
    // neck (fretting)
    if (x >= OPEN_ZONE_X0 && x <= NECK_END_X && y >= neckTop(NUT_X) - 20 && y <= neckBottom(NECK_END_X) + 20) {
      const s = nearestString(Math.max(x, NUT_X), y, 1)
      const fret = fretAt(x)
      if (s < 0 || fret < 0) return
      e.currentTarget.setPointerCapture(e.pointerId)
      dragRef.current = { kind: 'fret', string: s as StringIndex, fret, x0: x, y0: y, bend: 0 }
      InputManager.dispatch({ type: 'FRET_NOTE', string: s as StringIndex, fret, play: true, velocity: 0.85 }, src)
      e.preventDefault()
      return
    }
    // body (picking / strumming)
    if (x > NECK_END_X && x < BRIDGE_X + 20 && y >= 100 && y <= 340) {
      e.currentTarget.setPointerCapture(e.pointerId)
      dragRef.current = { kind: 'strum', lastY: y, lastT: performance.now() }
      const s = nearestString(x, y, 0.6)
      if (s >= 0) InputManager.dispatch({ type: 'PICK_STRING', string: s as StringIndex, velocity: 0.85 }, src)
      e.preventDefault()
    }
  }

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = dragRef.current
    if (!d) return
    const { x, y } = toSvg(e)
    const src = sourceOf(e)
    if (d.kind === 'fret') {
      // vertical drag = bend, up to 2 semitones over ~60 viewBox units
      const dy = d.y0 - y
      const amount = Math.max(0, Math.min(2, dy / 30))
      if (Math.abs(amount - d.bend) > 0.02) {
        d.bend = amount
        InputManager.dispatch({ type: 'BEND', amount, string: d.string }, src)
      }
      return
    }
    // strum: pluck every string the pointer crosses, velocity from speed
    const now = performance.now()
    const dt = Math.max(1, now - d.lastT)
    const speed = Math.abs(y - d.lastY) / dt // vb units per ms
    const velocity = Math.max(0.35, Math.min(1, 0.45 + speed * 0.9))
    const lo = Math.min(d.lastY, y)
    const hi = Math.max(d.lastY, y)
    const xs = Math.max(NECK_END_X + 1, Math.min(BRIDGE_X, x))
    const order: number[] = []
    for (let s = 0; s < NUM_STRINGS; s++) {
      const sy = stringY(s, xs)
      if (sy > lo && sy <= hi) order.push(s)
    }
    if (y < d.lastY) order.reverse()
    order.forEach((s) => InputManager.dispatch({ type: 'PICK_STRING', string: s as StringIndex, velocity }, src))
    d.lastY = y
    d.lastT = now
  }

  const endDrag = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = dragRef.current
    if (!d) return
    dragRef.current = null
    if (d.kind === 'fret' && d.bend > 0) InputManager.dispatch({ type: 'BEND', amount: 0, string: d.string }, sourceOf(e))
  }

  const toggleStringStatus = (s: number) => {
    const cur = frets[s]
    InputManager.dispatch({ type: 'FRET_NOTE', string: s as StringIndex, fret: cur < 0 ? 0 : -1, play: false }, 'mouse')
  }

  const setPickup = (p: typeof pickup) => {
    store.set({ pickup: p })
    getStudio()?.guitar.setPickup(p)
  }

  // ---- derived visuals ----
  const noteLabels = useMemo(() => {
    if (!showNotes) return null
    const out: React.ReactNode[] = []
    for (let s = 0; s < NUM_STRINGS; s++) {
      for (let n = 1; n <= NUM_FRETS; n++) {
        if (frets[s] === n) continue
        const cx = fretCenterX(n)
        out.push(
          <text key={`${s}-${n}`} x={cx} y={stringY(s, cx) + 3} fontSize={8} textAnchor="middle" fill="#f3ecd6" opacity={0.5} className="mono" pointerEvents="none">
            {fretNoteName(s, n, flats)}
          </text>,
        )
      }
    }
    return out
  }, [showNotes, flats, frets])

  return (
    <div className="scroll-x w-full">
      <svg
        ref={svgRef}
        viewBox={showStage ? `0 ${STAGE_TOP} ${VB_W} ${STAGE_BOTTOM - STAGE_TOP}` : `0 0 ${VB_W} ${VB_H}`}
        className="block w-full min-w-[1180px] lg:min-w-0 select-none"
        style={{ touchAction: 'pan-x', aspectRatio: showStage ? `${VB_W} / ${STAGE_BOTTOM - STAGE_TOP}` : `${VB_W} / ${VB_H}` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onContextMenu={(e) => e.preventDefault()}
      >
        {showStage && <StageBackdrop top={STAGE_TOP} bottom={STAGE_BOTTOM} />}
        {showPlayer && <PlayerBody />}
        {showPlayer && <PlayerArms pose={pose} />}
        <GuitarBody pickup={pickup} onPickup={setPickup} volume={guitarVolume} tone={guitarTone} />
        <GuitarNeck />

        {/* selected string guide (keyboard users) */}
        <line
          x1={NUT_X}
          y1={stringY(selectedString, NUT_X)}
          x2={NECK_END_X}
          y2={stringY(selectedString, NECK_END_X)}
          stroke="#4da3ff"
          strokeOpacity={0.18}
          strokeWidth={stringGap(NUT_X) * 0.9}
          pointerEvents="none"
        />

        {noteLabels}

        {/* strings: headstock segment (static) + playing segment (animated) */}
        {Array.from({ length: NUM_STRINGS }, (_, s) => {
          const w = STRING_WIDTHS[s]
          const y0 = stringY(s, NUT_X)
          const pegX = NUT_X - 40 - s * 27
          const pegY = neckTop(NUT_X) - 6 - s * 4
          const wound = STRING_WOUND[s]
          const isRinging = ringing[s]
          return (
            <g key={s} pointerEvents="none">
              <path d={`M ${NUT_X - 6} ${y0} L ${pegX} ${pegY}`} stroke={STRING_COLORS[s]} strokeWidth={w * 0.85} fill="none" opacity={0.9} />
              {/* shadow */}
              <path
                d={`M ${NUT_X - 6} ${y0 + 2.5} L ${BRIDGE_X + 12} ${stringY(s, BRIDGE_X) + 2.5}`}
                stroke="#000"
                strokeOpacity={0.35}
                strokeWidth={w}
                fill="none"
              />
              <path
                ref={(el) => {
                  stringRefs.current[s] = el
                }}
                stroke={STRING_COLORS[s]}
                strokeWidth={w}
                fill="none"
                strokeDasharray={wound ? '2 0.8' : undefined}
                style={{ filter: isRinging ? 'drop-shadow(0 0 2px rgba(255,255,255,0.35))' : undefined }}
              />
              <line x1={NUT_X - 6} y1={y0 - w * 0.25} x2={BRIDGE_X + 12} y2={stringY(s, BRIDGE_X) - w * 0.25} stroke={STRING_HI[s]} strokeOpacity={0.35} strokeWidth={0.5} />
            </g>
          )
        })}

        {/* per-string status column: open / muted toggles + string names */}
        {Array.from({ length: NUM_STRINGS }, (_, s) => {
          const y = stringY(s, NUT_X)
          const f = frets[s]
          const muted = f < 0
          const open = f === 0
          return (
            <g key={s} onClick={() => toggleStringStatus(s)} style={{ cursor: 'pointer' }}>
              <circle cx={STATUS_X} cy={y} r={9} fill={muted ? '#2a1418' : open ? '#12283f' : '#12151a'} stroke={muted ? '#ff4d5e' : open ? '#4da3ff' : '#30363f'} strokeWidth={1.4} />
              {muted ? (
                <text x={STATUS_X} y={y + 3.5} fontSize={10} textAnchor="middle" fill="#ff7a86" fontWeight={700} pointerEvents="none">
                  ×
                </text>
              ) : open ? (
                <text x={STATUS_X} y={y + 3.2} fontSize={8.5} textAnchor="middle" fill="#bfe0ff" fontWeight={700} pointerEvents="none" className="mono">
                  {fretNoteName(s, 0, flats)}
                </text>
              ) : (
                <text x={STATUS_X} y={y + 3} fontSize={8} textAnchor="middle" fill="#5f6875" fontWeight={700} pointerEvents="none">
                  {STRING_LABELS[s]}
                </text>
              )}
            </g>
          )
        })}

        {/* open zone hint */}
        <rect x={OPEN_ZONE_X0} y={neckTop(NUT_X) - 2} width={NUT_X - OPEN_ZONE_X0 - 8} height={neckBottom(NUT_X) - neckTop(NUT_X) + 4} rx={4} fill="#4da3ff" opacity={0.06} pointerEvents="none" />
        <text x={(OPEN_ZONE_X0 + NUT_X - 8) / 2} y={neckBottom(NUT_X) + 16} fontSize={8} textAnchor="middle" fill="#5f6875" letterSpacing={1.5} fontWeight={700} pointerEvents="none">
          OPEN
        </text>

        {/* trainer target */}
        {target && (
          <g pointerEvents="none">
            <circle cx={fretCenterX(target.fret)} cy={stringY(target.string, fretCenterX(target.fret))} r={13} fill="none" stroke="#f2b84b" strokeWidth={2} className="beat-ring" />
            <circle cx={fretCenterX(target.fret)} cy={stringY(target.string, fretCenterX(target.fret))} r={9} fill="#f2b84b" opacity={0.35} />
          </g>
        )}

        {/* finger markers */}
        {frets.map((f, s) => {
          if (f <= 0) return null
          const cx = fretCenterX(f)
          const cy = stringY(s, cx)
          const finger = chord?.fingers?.[s] ?? 0
          const isBent = bendString === s && bend > 0
          const bentAll = bendString === null && bend > 0
          const label = fretNoteName(s, f, flats)
          return (
            <g key={s} pointerEvents="none">
              <circle cx={cx} cy={cy + 1.5} r={10.5} fill="#000" opacity={0.4} />
              <circle cx={cx} cy={cy} r={10.5} fill={isBent || bentAll ? '#f2b84b' : '#4da3ff'} stroke="#0b0d10" strokeWidth={1.2} />
              {showPlayer ? (
                <g>
                  <rect x={cx - 11} y={cy - 32} width={22} height={14} rx={4} fill="#0b0d10" opacity={0.85} />
                  <text x={cx} y={cy - 21.5} fontSize={9} textAnchor="middle" fill="#bfe0ff" fontWeight={800} className="mono">
                    {label}
                  </text>
                </g>
              ) : (
                <text x={cx} y={cy + 3.5} fontSize={label.length > 1 ? 8.5 : 10} textAnchor="middle" fill="#06111f" fontWeight={800} className="mono">
                  {label}
                </text>
              )}
              {finger > 0 && (
                <g>
                  <circle cx={cx + (showPlayer ? 14 : 9)} cy={cy - (showPlayer ? 25 : 9)} r={5} fill="#0b0d10" stroke="#4da3ff" strokeWidth={0.8} />
                  <text x={cx + (showPlayer ? 14 : 9)} y={cy - (showPlayer ? 22.8 : 6.8)} fontSize={6.5} textAnchor="middle" fill="#bfe0ff" fontWeight={700}>
                    {finger}
                  </text>
                </g>
              )}
              {(isBent || bentAll) && (
                <text x={cx} y={cy - 15} fontSize={9} textAnchor="middle" fill="#f2b84b" fontWeight={800} className="mono">
                  +{(Math.round(bend * 2) / 2).toFixed(1)}
                </text>
              )}
            </g>
          )
        })}

        {showPlayer && <PlayerHands pose={pose} />}
        {showStage && <Crowd y={STAGE_BOTTOM - 62} />}

        {/* fret cell hover cursor: subtle highlight of the whole neck hit-area */}
        <rect x={fretX(0)} y={neckTop(NUT_X)} width={NECK_END_X - NUT_X} height={neckBottom(NECK_END_X) - neckTop(NUT_X)} fill="transparent" pointerEvents="none" />
      </svg>
    </div>
  )
}
