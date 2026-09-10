import { memo, useSyncExternalStore } from 'react'
import { store } from '../../state/store'
import { VB_W } from './geometry'

// ---------------------------------------------------- scene activity ----
// The scene's CSS animations are paused (via the `stage-paused` class) while
// the tab is hidden, and while applause is off and nothing has been played
// for a while, so an idle page does not keep repainting the whole svg.

const IDLE_MS = 6000
let paused = false
let tracking = false
let lastActivity = 0
let idleTimer = 0
const listeners = new Set<() => void>()

function setPaused(next: boolean) {
  if (next === paused) return
  paused = next
  listeners.forEach((l) => l())
}

function evaluate() {
  const idle = performance.now() - lastActivity >= IDLE_MS
  setPaused(document.hidden || (!store.get().crowdOn && idle))
}

function touch() {
  lastActivity = performance.now()
  window.clearTimeout(idleTimer)
  idleTimer = window.setTimeout(evaluate, IDLE_MS + 50)
  evaluate()
}

function startTracking() {
  if (tracking) return
  tracking = true
  let prev = store.get()
  store.subscribe(() => {
    const st = store.get()
    const played = st.pluckStamp !== prev.pluckStamp || st.strumStamp !== prev.strumStamp
    const crowdChanged = st.crowdOn !== prev.crowdOn
    prev = st
    if (played) touch()
    else if (crowdChanged) evaluate()
  })
  document.addEventListener('visibilitychange', evaluate)
  touch()
}

function subscribePaused(l: () => void) {
  startTracking()
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

/** True while the stage animations should stand still. */
export function useStagePaused(): boolean {
  return useSyncExternalStore(subscribePaused, () => paused, () => false)
}

// --------------------------------------------------------- backdrop ----

/** Stage backdrop: dark hall, lighting truss, moving spotlights, reflective floor. Drawn behind the player. */
export const StageBackdrop = memo(function StageBackdrop({ top, bottom }: { top: number; bottom: number }) {
  const paused = useStagePaused()
  const h = bottom - top
  const lamps = [120, 360, 600, 840, 1080, 1320, 1560]
  return (
    <g pointerEvents="none" className={paused ? 'stage-paused' : undefined}>
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
        </g>
      ))}
      {/* one pulsing layer for every lamp halo */}
      <g className="lamp-glow">
        {lamps.map((x, i) => (
          <circle key={x} cx={x} cy={top + 30} r={16} fill={i % 2 ? '#4da3ff' : '#ffb457'} />
        ))}
      </g>

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

// ------------------------------------------------------------ crowd ----

interface Person {
  i: number
  x: number
  y: number
  scale: number
  /** static lean of the raised arms, degrees */
  tilt: number
  fill: string
  rim: string
}

interface CrowdGroup {
  back: boolean
  /** shoulder line of the group in viewBox units: the arms' skew pivots here */
  shoulderY: number
  people: Person[]
}

/**
 * Audience silhouettes in the foreground, clapping and bobbing.
 * Two rows of 38 people, each row split into three phase groups so neighbours
 * move out of step. Every group is one bobbing layer with one layer of left
 * arms and one of right arms (skewed about the shoulder line so every hand
 * sways in place), instead of three animations per person.
 */
export const Crowd = memo(function Crowd({ y }: { y: number }) {
  const paused = useStagePaused()
  const rows = [
    { y: y - 26, fill: '#0d111a', rim: '#1a2130', baseScale: 1.15 },
    { y, fill: '#080a10', rim: '#232c3e', baseScale: 1.6 },
  ]
  const groups: CrowdGroup[] = rows.flatMap((row, r) =>
    Array.from({ length: 3 }, () => ({ back: r === 0, shoulderY: row.y + 30 * (row.baseScale + 0.12), people: [] as Person[] })),
  )
  for (let i = 0; i < 38; i++) {
    const back = i < 18
    const row = rows[back ? 0 : 1]
    const x = back ? 60 + i * 92 + ((i * 37) % 30) : 10 + (i - 18) * 84 + ((i * 53) % 26)
    const scale = row.baseScale + ((i * 53) % 10) / 40
    const tilt = ((i * 41) % 17) - 8
    groups[(back ? 0 : 3) + (i % 3)].people.push({ i, x, y: row.y, scale, tilt, fill: row.fill, rim: row.rim })
  }
  return (
    <g pointerEvents="none" className={paused ? 'stage-paused' : undefined}>
      <defs>
        <linearGradient id="crowdFade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#05060a" stopOpacity="0" />
          <stop offset="1" stopColor="#05060a" stopOpacity="0.9" />
        </linearGradient>
        {/* shoulders + head; fill/stroke inherited from the <use> */}
        <g id="crowd-body">
          <path d="M -34 60 C -34 22, -14 14, 0 14 C 14 14, 34 22, 34 60 Z" />
          <circle cx={0} cy={0} r={15} />
        </g>
        {/* raised arms; the arm takes the <use> stroke, the hand its fill and `color` */}
        <g id="crowd-arm-l">
          <path d="M -26 30 L -40 -6 L -30 -14" strokeWidth={9} strokeLinecap="round" fill="none" />
          <circle cx={-30} cy={-16} r={6} stroke="currentColor" strokeWidth={1} />
        </g>
        <g id="crowd-arm-r">
          <path d="M 26 30 L 40 -6 L 30 -14" strokeWidth={9} strokeLinecap="round" fill="none" />
          <circle cx={30} cy={-16} r={6} stroke="currentColor" strokeWidth={1} />
        </g>
      </defs>
      <rect x={0} y={y - 90} width={VB_W} height={200} fill="url(#crowdFade)" />
      {groups.map((g, gi) => {
        const delay = `${((gi * 0.37) % 1).toFixed(2)}s`
        const bob = `${(1.1 + (gi % 3) * 0.15).toFixed(2)}s`
        const clap = `${(0.5 + ((gi * 2) % 5) * 0.05).toFixed(2)}s`
        return (
          <g key={gi} className="crowd-bob" style={{ animationDelay: delay, animationDuration: bob }}>
            {g.people.map((p) => (
              <use key={p.i} href="#crowd-body" transform={`translate(${p.x} ${p.y}) scale(${p.scale})`} fill={p.fill} stroke={p.rim} strokeWidth={1.2} />
            ))}
            <g className="crowd-arm crowd-arm-l" style={{ transformOrigin: `0px ${g.shoulderY}px`, animationDelay: delay, animationDuration: clap }}>
              {g.people.map((p) => (
                <use key={p.i} href="#crowd-arm-l" transform={`translate(${p.x} ${p.y}) scale(${p.scale}) rotate(${p.tilt} -26 30)`} stroke={p.fill} fill={p.fill} color={p.rim} />
              ))}
            </g>
            <g className="crowd-arm crowd-arm-r" style={{ transformOrigin: `0px ${g.shoulderY}px`, animationDelay: delay, animationDuration: clap }}>
              {g.people.map((p) => (
                <use key={p.i} href="#crowd-arm-r" transform={`translate(${p.x} ${p.y}) scale(${p.scale}) rotate(${-p.tilt} 26 30)`} stroke={p.fill} fill={p.fill} color={p.rim} />
              ))}
            </g>
          </g>
        )
      })}
      {/* a few phone lights */}
      <g className="lamp-glow">
        {[3, 9, 15].map((i) => (
          <rect key={i} x={10 + i * 84 + 30} y={y - 44} width={7} height={11} rx={1.5} fill="#cfe8ff" />
        ))}
      </g>
    </g>
  )
})
