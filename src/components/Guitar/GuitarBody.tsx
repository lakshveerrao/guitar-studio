import { memo } from 'react'
import { BRIDGE_X, NECK_END_X, stringY } from './geometry'
import type { PickupPosition } from '../../audio/GuitarEngine'

/**
 * Static artwork for the body, pickguard, pickups, bridge and controls.
 * Pure SVG, memoised so string animation never re-renders it. The pickups are
 * tagged with `data-pickup`; the Guitar's pointer handlers turn a tap on one
 * into a pickup change (the svg holds pointer capture, so a click here would
 * never be delivered to a descendant).
 */
export const GuitarBody = memo(function GuitarBody({ pickup, volume, tone }: { pickup: PickupPosition; volume: number; tone: number }) {
  const bodyPath =
    'M 1020 80 ' +
    'C 1030 52, 1120 26, 1230 38 ' +
    'C 1290 46, 1320 84, 1360 88 ' +
    'C 1400 92, 1436 34, 1495 34 ' +
    'C 1560 36, 1600 140, 1600 230 ' +
    'C 1600 322, 1560 418, 1495 416 ' +
    'C 1430 414, 1405 350, 1365 356 ' +
    'C 1330 362, 1300 406, 1230 408 ' +
    'C 1170 410, 1120 400, 1090 380 ' +
    'C 1118 364, 1152 322, 1164 286 ' +
    'L 1164 140 ' +
    'C 1130 146, 1060 130, 1020 80 Z'

  const guardPath =
    'M 1046 104 ' +
    'C 1060 84, 1140 58, 1240 66 ' +
    'C 1290 70, 1318 104, 1360 110 ' +
    'C 1400 114, 1432 90, 1470 90 ' +
    'C 1462 100, 1466 150, 1470 200 ' +
    'C 1476 250, 1580 280, 1560 345 ' +
    'C 1548 385, 1490 398, 1440 384 ' +
    'C 1400 372, 1390 338, 1365 336 ' +
    'C 1330 340, 1300 386, 1230 388 ' +
    'C 1180 390, 1130 380, 1108 366 ' +
    'C 1130 348, 1158 312, 1172 286 ' +
    'L 1172 142 ' +
    'C 1140 146, 1080 132, 1046 104 Z'

  const pickupRect = (x: number, active: boolean, key: string, angle = 0) => (
    <g key={key} transform={`rotate(${angle} ${x + 12} 216)`}>
      <rect x={x} y={140} width={26} height={152} rx={12} fill="#f4f1e6" stroke="#cfc8b5" strokeWidth={1.5} />
      <rect x={x + 2} y={142} width={22} height={148} rx={11} fill="url(#pickupShade)" />
      {[0, 1, 2, 3, 4, 5].map((s) => (
        <circle key={s} cx={x + 13} cy={stringY(s, 1300)} r={3.2} fill="#8f8f95" stroke="#5c5c62" strokeWidth={0.8} />
      ))}
      <circle cx={x + 13} cy={132} r={2.4} fill="#7d7d84" />
      <circle cx={x + 13} cy={300} r={2.4} fill="#7d7d84" />
      {active && <rect x={x - 3} y={137} width={32} height={158} rx={14} fill="none" stroke="#4da3ff" strokeWidth={1.5} opacity={0.9} />}
    </g>
  )

  const knob = (cx: number, cy: number, value: number, label: string, key: string) => {
    const angle = -135 + (value / 10) * 270
    return (
      <g key={key}>
        <circle cx={cx} cy={cy + 2} r={17} fill="#000" opacity={0.3} />
        <circle cx={cx} cy={cy} r={16} fill="url(#knobShade)" stroke="#c8c1ab" strokeWidth={1} />
        <circle cx={cx} cy={cy} r={11} fill="#efe9d6" stroke="#cfc8b5" strokeWidth={0.8} />
        <line
          x1={cx}
          y1={cy}
          x2={cx + Math.sin((angle * Math.PI) / 180) * 12}
          y2={cy - Math.cos((angle * Math.PI) / 180) * 12}
          stroke="#2a2a2e"
          strokeWidth={2}
          strokeLinecap="round"
        />
        <text x={cx} y={cy + 28} fontSize={8} textAnchor="middle" fill="#6b6455" fontWeight={600} letterSpacing={1}>
          {label}
        </text>
      </g>
    )
  }

  return (
    <g>
      <defs>
        <linearGradient id="bodyBlue" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2f78d6" />
          <stop offset="0.45" stopColor="#1d5cb8" />
          <stop offset="1" stopColor="#123f86" />
        </linearGradient>
        <radialGradient id="bodyGloss" cx="0.35" cy="0.25" r="0.7">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.28" />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.04" />
          <stop offset="1" stopColor="#000000" stopOpacity="0.22" />
        </radialGradient>
        <linearGradient id="guardCream" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f7f3e6" />
          <stop offset="1" stopColor="#e6dfc9" />
        </linearGradient>
        <linearGradient id="pickupShade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.5" />
          <stop offset="1" stopColor="#000000" stopOpacity="0.08" />
        </linearGradient>
        <radialGradient id="knobShade" cx="0.4" cy="0.35" r="0.7">
          <stop offset="0" stopColor="#fbf8ee" />
          <stop offset="1" stopColor="#d4cbb1" />
        </radialGradient>
        <linearGradient id="chrome" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f2f2f4" />
          <stop offset="0.5" stopColor="#a9abb2" />
          <stop offset="1" stopColor="#dedfe3" />
        </linearGradient>
        <filter id="bodyShadow" x="-10%" y="-10%" width="120%" height="130%">
          <feDropShadow dx="0" dy="10" stdDeviation="10" floodColor="#000" floodOpacity="0.55" />
        </filter>
      </defs>

      {/* body */}
      <path d={bodyPath} fill="url(#bodyBlue)" filter="url(#bodyShadow)" />
      <path d={bodyPath} fill="url(#bodyGloss)" />
      {/* forearm contour */}
      <path d="M 1400 54 C 1460 40, 1550 58, 1592 150" fill="none" stroke="#ffffff" strokeOpacity={0.12} strokeWidth={14} strokeLinecap="round" />
      <path d={bodyPath} fill="none" stroke="#0a2450" strokeWidth={2.2} />
      <path d={bodyPath} fill="none" stroke="#7fb4ff" strokeOpacity={0.35} strokeWidth={0.8} />

      {/* pickguard */}
      <path d={guardPath} fill="#0b1d3a" opacity={0.35} transform="translate(0 3)" />
      <path d={guardPath} fill="url(#guardCream)" stroke="#bfb69c" strokeWidth={1.2} />
      <path d={guardPath} fill="none" stroke="#ffffff" strokeOpacity={0.55} strokeWidth={0.6} transform="translate(0 -1)" />
      {[
        [1064, 112], [1240, 74], [1360, 126], [1462, 100], [1476, 200], [1562, 320], [1470, 384], [1365, 346], [1230, 380], [1116, 366],
      ].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={2.2} fill="#9b9484" />
      ))}

      {/* neck pocket shadow under the fretboard end */}
      <rect x={NECK_END_X - 6} y={126} width={12} height={168} fill="#000" opacity={0.25} />

      {/* pickups: neck, middle, bridge (slanted) */}
      <g style={{ cursor: 'pointer' }}>
        <g data-pickup="neck">{pickupRect(1214, pickup === 'neck', 'neck')}</g>
        <g data-pickup="middle">{pickupRect(1300, pickup === 'middle', 'middle')}</g>
        <g data-pickup="bridge">{pickupRect(1380, pickup === 'bridge', 'bridge', -8)}</g>
      </g>

      {/* pickup selector switch */}
      <g>
        <rect x={1419} y={338} width={54} height={8} rx={4} fill="#1a1a1e" transform="rotate(-62 1446 342)" />
        <line
          x1={1446}
          y1={342}
          x2={1446 + (pickup === 'neck' ? -22 : pickup === 'bridge' ? 22 : 0)}
          y2={342 - (pickup === 'middle' ? 34 : 26)}
          stroke="#f4f1e6"
          strokeWidth={5}
          strokeLinecap="round"
        />
        <circle cx={1446} cy={342} r={4} fill="#111" />
      </g>

      {/* bridge / saddles */}
      <rect x={BRIDGE_X - 8} y={138} width={30} height={156} rx={4} fill="url(#chrome)" stroke="#6b6e75" strokeWidth={1} />
      <rect x={BRIDGE_X - 8} y={138} width={30} height={156} rx={4} fill="url(#chrome)" opacity={0.5} />
      {[0, 1, 2, 3, 4, 5].map((s) => (
        <g key={s}>
          <rect x={BRIDGE_X - 4} y={stringY(s, BRIDGE_X) - 4} width={20} height={8} rx={2} fill="#d9dbe0" stroke="#7a7d85" strokeWidth={0.8} />
          <circle cx={BRIDGE_X + 12} cy={stringY(s, BRIDGE_X)} r={1.8} fill="#4a4d55" />
        </g>
      ))}
      <rect x={BRIDGE_X + 24} y={144} width={6} height={144} rx={2} fill="#2b2d33" opacity={0.6} />

      {/* controls */}
      {knob(1506, 250, volume, 'VOLUME', 'vol')}
      {knob(1530, 304, tone, 'TONE', 'tone1')}
      {knob(1512, 358, 7, 'TONE', 'tone2')}

      {/* output jack plate */}
      <ellipse cx={1570} cy={372} rx={12} ry={7.5} fill="url(#chrome)" stroke="#6b6e75" strokeWidth={0.8} transform="rotate(-50 1570 372)" />
      <circle cx={1570} cy={372} r={3} fill="#111" />

      {/* strap button */}
      <circle cx={1026} cy={84} r={4} fill="#c9cbd1" stroke="#63666d" />
      <circle cx={1596} cy={230} r={4} fill="#c9cbd1" stroke="#63666d" />

      {/* strum zone hint */}
      <text x={(NECK_END_X + BRIDGE_X) / 2 + 6} y={330} fontSize={9} fill="#0a2450" opacity={0.65} textAnchor="middle" letterSpacing={2} fontWeight={700}>
        STRUM ZONE
      </text>
    </g>
  )
})
