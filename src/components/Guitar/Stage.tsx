import { memo } from 'react'
import { VB_W } from './geometry'

/** Stage backdrop: dark hall, lighting truss, moving spotlights, reflective floor. Drawn behind the player. */
export const StageBackdrop = memo(function StageBackdrop({ top, bottom }: { top: number; bottom: number }) {
  const h = bottom - top
  const lamps = [120, 360, 600, 840, 1080, 1320, 1560]
  return (
    <g pointerEvents="none">
      <defs>
        <linearGradient id="stageWall" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#05060a" />
          <stop offset="0.55" stopColor="#0d1018" />
          <stop offset="1" stopColor="#151a24" />
        </linearGradient>
        <linearGradient id="stageFloor" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a2622" />
          <stop offset="0.35" stopColor="#1c1916" />
          <stop offset="1" stopColor="#0a0908" />
        </linearGradient>
        <radialGradient id="spotWarm" cx="0.5" cy="0" r="0.75">
          <stop offset="0" stopColor="#ffd9a0" stopOpacity="0.55" />
          <stop offset="0.6" stopColor="#ffb457" stopOpacity="0.12" />
          <stop offset="1" stopColor="#ffb457" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="spotCool" cx="0.5" cy="0" r="0.75">
          <stop offset="0" stopColor="#bfe0ff" stopOpacity="0.5" />
          <stop offset="0.6" stopColor="#4da3ff" stopOpacity="0.12" />
          <stop offset="1" stopColor="#4da3ff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="haze" cx="0.5" cy="0.45" r="0.6">
          <stop offset="0" stopColor="#3b4a66" stopOpacity="0.35" />
          <stop offset="1" stopColor="#3b4a66" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="floorGlow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffb457" stopOpacity="0.22" />
          <stop offset="1" stopColor="#ffb457" stopOpacity="0" />
        </linearGradient>
      </defs>

      <rect x={0} y={top} width={VB_W} height={h} fill="url(#stageWall)" />
      <rect x={0} y={top} width={VB_W} height={h} fill="url(#haze)" />

      {/* back curtain folds */}
      {Array.from({ length: 22 }, (_, i) => (
        <rect key={i} x={i * 76} y={top} width={38} height={h * 0.7} fill="#000" opacity={0.18} />
      ))}

      {/* spotlight cones */}
      <g className="spot spot-a" style={{ transformOrigin: '420px ' + (top + 8) + 'px' }}>
        <polygon points={`380,${top + 8} 460,${top + 8} 900,${bottom} 60,${bottom}`} fill="url(#spotWarm)" />
      </g>
      <g className="spot spot-b" style={{ transformOrigin: '1220px ' + (top + 8) + 'px' }}>
        <polygon points={`1180,${top + 8} 1260,${top + 8} 1640,${bottom} 760,${bottom}`} fill="url(#spotCool)" />
      </g>
      <g className="spot spot-c" style={{ transformOrigin: '820px ' + (top + 8) + 'px' }}>
        <polygon points={`790,${top + 8} 850,${top + 8} 1180,${bottom} 420,${bottom}`} fill="url(#spotWarm)" opacity={0.7} />
      </g>

      {/* lighting truss */}
      <rect x={0} y={top + 2} width={VB_W} height={9} fill="#20242c" />
      <rect x={0} y={top + 11} width={VB_W} height={2} fill="#3a4049" />
      {lamps.map((x, i) => (
        <g key={x}>
          <rect x={x - 14} y={top + 11} width={28} height={16} rx={3} fill="#262b33" stroke="#3a4049" />
          <circle cx={x} cy={top + 30} r={8} fill={i % 2 ? '#8fd3ff' : '#ffd08a'} opacity={0.95} />
          <circle cx={x} cy={top + 30} r={16} fill={i % 2 ? '#4da3ff' : '#ffb457'} opacity={0.18} className="lamp-glow" />
        </g>
      ))}

      {/* floor */}
      <rect x={0} y={bottom - 190} width={VB_W} height={190} fill="url(#stageFloor)" />
      <rect x={0} y={bottom - 190} width={VB_W} height={90} fill="url(#floorGlow)" />
      <line x1={0} y1={bottom - 190} x2={VB_W} y2={bottom - 190} stroke="#3a342c" strokeWidth={2} />
      {/* floor boards */}
      {Array.from({ length: 12 }, (_, i) => (
        <line key={i} x1={0} y1={bottom - 176 + i * 15} x2={VB_W} y2={bottom - 176 + i * 15} stroke="#000" strokeOpacity={0.18} />
      ))}
      {/* monitor wedge + cable */}
      <path d={`M 40 ${bottom - 60} L 150 ${bottom - 60} L 170 ${bottom - 10} L 20 ${bottom - 10} Z`} fill="#15171b" stroke="#2a2f37" />
      <rect x={52} y={bottom - 52} width={86} height={34} fill="#0a0b0e" />
      <path d={`M 170 ${bottom - 14} C 320 ${bottom - 30}, 520 ${bottom + 4}, 700 ${bottom - 18}`} fill="none" stroke="#000" strokeWidth={3} opacity={0.6} />
    </g>
  )
})

/** Audience silhouettes in the foreground, clapping and bobbing. */
export const Crowd = memo(function Crowd({ y }: { y: number }) {
  // two rows: a smaller back row, a larger front row; deterministic jitter
  const people = Array.from({ length: 38 }, (_, i) => {
    const back = i < 18
    const x = back ? 60 + i * 92 + ((i * 37) % 30) : 10 + (i - 18) * 84 + ((i * 53) % 26)
    const scale = (back ? 1.15 : 1.6) + ((i * 53) % 10) / 40
    const delay = ((i * 97) % 10) / 10
    const dur = 0.5 + ((i * 31) % 6) / 20
    return { x, y: back ? y - 26 : y, scale, delay, dur, i, fill: back ? '#0d111a' : '#080a10', rim: back ? '#1a2130' : '#232c3e' }
  })
  return (
    <g pointerEvents="none">
      <defs>
        <linearGradient id="crowdFade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#05060a" stopOpacity="0" />
          <stop offset="1" stopColor="#05060a" stopOpacity="0.9" />
        </linearGradient>
      </defs>
      <rect x={0} y={y - 90} width={VB_W} height={200} fill="url(#crowdFade)" />
      {people.map((p) => (
        <g
          key={p.i}
          className="crowd-person"
          style={{ transformOrigin: `${p.x}px ${p.y + 60}px`, animationDelay: `${p.delay}s`, animationDuration: `${p.dur * 2}s` }}
        >
          <g transform={`translate(${p.x} ${p.y}) scale(${p.scale})`}>
            {/* shoulders + head */}
            <path d="M -34 60 C -34 22, -14 14, 0 14 C 14 14, 34 22, 34 60 Z" fill={p.fill} stroke={p.rim} strokeWidth={1.2} />
            <circle cx={0} cy={0} r={15} fill={p.fill} stroke={p.rim} strokeWidth={1.2} />
            {/* left arm raised, clapping */}
            <g className="crowd-arm crowd-arm-l" style={{ transformOrigin: '-26px 30px', animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s` }}>
              <path d="M -26 30 L -40 -6 L -30 -14" stroke={p.fill} strokeWidth={9} strokeLinecap="round" fill="none" />
              <circle cx={-30} cy={-16} r={6} fill={p.fill} stroke={p.rim} strokeWidth={1} />
            </g>
            <g className="crowd-arm crowd-arm-r" style={{ transformOrigin: '26px 30px', animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s` }}>
              <path d="M 26 30 L 40 -6 L 30 -14" stroke={p.fill} strokeWidth={9} strokeLinecap="round" fill="none" />
              <circle cx={30} cy={-16} r={6} fill={p.fill} stroke={p.rim} strokeWidth={1} />
            </g>
          </g>
        </g>
      ))}
      {/* a few phone lights */}
      {[3, 9, 15].map((i) => (
        <rect key={i} x={10 + i * 84 + 30} y={y - 44} width={7} height={11} rx={1.5} fill="#cfe8ff" opacity={0.85} className="lamp-glow" />
      ))}
    </g>
  )
})
