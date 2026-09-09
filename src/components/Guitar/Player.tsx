import { memo, useEffect, useRef, useState } from 'react'
import { useStore } from '../../state/store'
import { chordById } from '../../music/chords'
import { NECK_END_X, NUT_X, fretCenterX, neckBottom, neckTop, stringY } from './geometry'

const SKIN = '#e2b48f'
const SKIN_HI = '#f2cdae'
const SKIN_DARK = '#c8956d'
const SLEEVE = '#3a4150'
const SLEEVE_HI = '#4c5568'

/**
 * The guitarist. Drawn in three layers so the guitar sits in between:
 *   <PlayerBody/>   behind everything: head, torso, shoulders, strap
 *   <PlayerArms/>   behind the guitar: upper arms + forearms (pose-driven)
 *   <PlayerHands/>  in front: fret hand on the strings, strum hand with pick
 * Hand targets come from the fretting state; a small rAF smoother eases every
 * joint toward its target so position changes read as real movement.
 */

// ---------------------------------------------------------------- pose ----

export interface PlayerPose {
  handX: number // fret-hand palm centre x
  palmY: number
  fingers: { x: number; y: number; pressing: boolean }[] // index, middle, ring, pinky tips
  pickY: number // strum-hand y
}

interface FingerTarget {
  x: number
  y: number
}

function fingerAssignments(frets: number[], chordFingers?: number[]): (FingerTarget | null)[] {
  const targets: (FingerTarget | null)[] = [null, null, null, null]
  const pressed: { s: number; f: number; finger: number }[] = []
  frets.forEach((f, s) => {
    if (f > 0) pressed.push({ s, f, finger: chordFingers?.[s] ?? 0 })
  })
  if (!pressed.length) return targets
  const used = new Set<number>()
  pressed.forEach((p) => {
    if (p.finger >= 1 && p.finger <= 4 && !targets[p.finger - 1]) {
      const cx = fretCenterX(p.f)
      targets[p.finger - 1] = { x: cx, y: stringY(p.s, cx) }
      used.add(p.s)
    }
  })
  // remaining notes: lowest fret gets the index finger, and so on
  const rest = pressed.filter((p) => !used.has(p.s)).sort((a, b) => a.f - b.f || b.s - a.s)
  let next = 0
  for (const p of rest) {
    while (next < 4 && targets[next]) next++
    if (next >= 4) break
    const cx = fretCenterX(p.f)
    targets[next] = { x: cx, y: stringY(p.s, cx) }
    next++
  }
  return targets
}

/** Ease an array of numbers toward its target on animation frames. */
function useSmoothed(target: number[], speed = 0.22): number[] {
  const [cur, setCur] = useState(target)
  const curRef = useRef(target)
  const targetRef = useRef(target)
  targetRef.current = target
  const key = target.join(',')
  useEffect(() => {
    let raf = 0
    const step = () => {
      const t = targetRef.current
      const c = curRef.current
      let maxD = 0
      const n = t.map((tv, i) => {
        const cv = c[i] ?? tv
        const d = tv - cv
        maxD = Math.max(maxD, Math.abs(d))
        return cv + d * speed
      })
      curRef.current = n
      setCur(n)
      if (maxD > 0.35) raf = requestAnimationFrame(step)
      else {
        curRef.current = t
        setCur(t)
      }
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, speed])
  return cur
}

export function usePlayerPose(): PlayerPose {
  const frets = useStore((s) => s.frets)
  const chordId = useStore((s) => s.chordId)
  const lastNote = useStore((s) => s.lastNote)
  const lastTechnique = useStore((s) => s.lastTechnique)
  const chord = chordId ? chordById(chordId) : undefined
  const assigned = fingerAssignments(frets, chord?.fingers)
  const active = assigned.filter((f): f is FingerTarget => !!f)
  const rawX = active.length ? active.reduce((a, f) => a + f.x, 0) / active.length + 8 : fretCenterX(2)
  const handX = Math.max(NUT_X + 40, Math.min(NECK_END_X - 40, rawX))
  const palmY = neckBottom(handX) + 16
  // rest positions for fingers not pressing: curled just under the neck edge
  const targets = assigned.map((t, i) => t ?? { x: handX - 28 + i * 17, y: neckBottom(handX) - 4 - i * 2 })
  const pickY = lastNote && lastTechnique !== 'strum' && lastTechnique !== '' ? stringY(lastNote.string, 1300) + 6 : 240

  const smoothed = useSmoothed([handX, palmY, ...targets.flatMap((t) => [t.x, t.y]), pickY])
  return {
    handX: smoothed[0],
    palmY: smoothed[1],
    fingers: assigned.map((t, i) => ({ x: smoothed[2 + i * 2], y: smoothed[3 + i * 2], pressing: !!t })),
    pickY: smoothed[10],
  }
}

// ---------------------------------------------------------------- body ----

export const PlayerBody = memo(function PlayerBody() {
  return (
    <g pointerEvents="none">
      <defs>
        <radialGradient id="skinShade" cx="0.4" cy="0.35" r="0.75">
          <stop offset="0" stopColor="#f0c8a4" />
          <stop offset="1" stopColor={SKIN_DARK} />
        </radialGradient>
        <linearGradient id="shirtShade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a303b" />
          <stop offset="1" stopColor="#12151b" />
        </linearGradient>
      </defs>
      {/* strap over the left shoulder */}
      <path d="M 1030 88 C 1090 40, 1170 6, 1236 -6" stroke="#3b2a1e" strokeWidth={22} strokeLinecap="round" fill="none" />
      <path d="M 1030 88 C 1090 40, 1170 6, 1236 -6" stroke="#5a4030" strokeWidth={14} strokeLinecap="round" fill="none" />
      {/* torso */}
      <path d="M 1170 30 C 1160 90, 1150 250, 1160 470 L 1520 470 C 1530 250, 1520 90, 1508 30 C 1470 6, 1420 -2, 1340 -2 C 1260 -2, 1210 6, 1170 30 Z" fill="url(#shirtShade)" />
      <path d="M 1290 -2 C 1300 40, 1380 40, 1390 -2" fill="none" stroke="#0b0d11" strokeWidth={3} opacity={0.6} />
      {/* neck */}
      <rect x={1318} y={-46} width={44} height={56} rx={14} fill={SKIN_DARK} />
      {/* head, tilted toward the fretboard */}
      <g transform="rotate(-8 1340 -80)">
        <ellipse cx={1340} cy={-78} rx={44} ry={50} fill="url(#skinShade)" />
        <path d="M 1294 -92 C 1290 -140, 1330 -150, 1350 -146 C 1380 -150, 1392 -120, 1386 -96 C 1372 -108, 1350 -118, 1330 -110 C 1316 -104, 1302 -100, 1294 -92 Z" fill="#2a1c14" />
        <path d="M 1296 -92 C 1296 -70, 1300 -56, 1306 -46 L 1300 -46 C 1292 -60, 1290 -78, 1296 -92 Z" fill="#2a1c14" />
        <ellipse cx={1296} cy={-76} rx={7} ry={10} fill={SKIN_DARK} />
        <ellipse cx={1384} cy={-76} rx={7} ry={10} fill={SKIN_DARK} />
        <path d="M 1318 -78 q 8 5 16 0" stroke="#2a1c14" strokeWidth={2.2} fill="none" strokeLinecap="round" />
        <path d="M 1348 -78 q 8 5 16 0" stroke="#2a1c14" strokeWidth={2.2} fill="none" strokeLinecap="round" />
        <path d="M 1316 -90 q 10 -6 20 -1" stroke="#2a1c14" strokeWidth={2} fill="none" strokeLinecap="round" opacity={0.7} />
        <path d="M 1346 -91 q 10 -5 20 1" stroke="#2a1c14" strokeWidth={2} fill="none" strokeLinecap="round" opacity={0.7} />
        <path d="M 1342 -70 q -4 8 2 10" stroke={SKIN_DARK} strokeWidth={2} fill="none" strokeLinecap="round" />
        <path d="M 1326 -50 q 16 12 32 0" stroke="#8a4a3a" strokeWidth={2.4} fill="none" strokeLinecap="round" />
      </g>
      {/* shoulders */}
      <circle cx={1196} cy={42} r={30} fill={SLEEVE} />
      <circle cx={1488} cy={42} r={30} fill={SLEEVE} />
    </g>
  )
})

// ---------------------------------------------------------------- arms ----

function Limb({ d, width }: { d: string; width: number }) {
  return (
    <>
      <path d={d} stroke="#000" strokeOpacity={0.35} strokeWidth={width + 4} strokeLinecap="round" fill="none" transform="translate(3 5)" />
      <path d={d} stroke={SLEEVE} strokeWidth={width} strokeLinecap="round" fill="none" />
      <path d={d} stroke={SLEEVE_HI} strokeWidth={width * 0.35} strokeLinecap="round" fill="none" opacity={0.45} transform="translate(-4 -6)" />
    </>
  )
}

/** Upper arms and forearms. Behind the guitar, so the left arm passes under the neck and the right arm rests over the body. */
export function PlayerArms({ pose }: { pose: PlayerPose }) {
  const { handX, palmY } = pose
  // left arm: upper arm drops behind the body to an elbow just below the lower horn,
  // forearm runs out along the neck to the wrist (how it looks from the audience)
  const elbowX = 1010
  const elbowY = 412
  const wristX = handX + 6
  const wristY = palmY + 10
  const upper = `M 1196 42 C 1150 160, 1060 300, ${elbowX} ${elbowY}`
  const fore = `M ${elbowX} ${elbowY} C ${elbowX - 160} ${elbowY + 4}, ${wristX + 160} ${wristY + 26}, ${wristX} ${wristY}`
  return (
    <g pointerEvents="none">
      <Limb d={upper} width={54} />
      <Limb d={fore} width={48} />
      <circle cx={elbowX} cy={elbowY} r={25} fill={SLEEVE} />
      {/* right upper arm over the top of the body */}
      <Limb d="M 1488 42 C 1560 90, 1600 150, 1582 202" width={54} />
    </g>
  )
}

// --------------------------------------------------------------- hands ----

function Finger({ kx, ky, tx, ty, pressing }: { kx: number; ky: number; tx: number; ty: number; pressing: boolean }) {
  // two-segment finger: knuckle -> middle joint -> tip, bent so it reads as a curl
  const dx = tx - kx
  const dy = ty - ky
  const len = Math.hypot(dx, dy) || 1
  // middle joint bows outward (toward the bridge) proportionally to the reach
  const bow = pressing ? Math.min(34, 10 + len * 0.16) : 12
  const mx = kx + dx * 0.55 + (dy < 0 ? bow : bow * 0.4)
  const my = ky + dy * 0.55 - (pressing ? 4 : 10)
  const d = `M ${kx} ${ky} Q ${kx + dx * 0.25 + bow * 0.8} ${ky + dy * 0.25} ${mx} ${my} Q ${mx + (tx - mx) * 0.45 - bow * 0.35} ${my + (ty - my) * 0.6} ${tx} ${ty}`
  return (
    <g>
      <path d={d} stroke="#000" strokeOpacity={0.3} strokeWidth={15} strokeLinecap="round" fill="none" transform="translate(2 3)" />
      <path d={d} stroke={SKIN} strokeWidth={12.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d={d} stroke={SKIN_HI} strokeWidth={3.5} strokeLinecap="round" fill="none" opacity={0.55} transform="translate(-2 -2)" />
      {/* joint crease */}
      <circle cx={mx} cy={my} r={5.2} fill="none" stroke={SKIN_DARK} strokeWidth={1} opacity={0.45} />
      {/* fingertip, pressed flat when fretting */}
      <ellipse cx={tx} cy={ty} rx={pressing ? 7.5 : 6.5} ry={pressing ? 6 : 6.5} fill={pressing ? '#f0c4a0' : SKIN} stroke={SKIN_DARK} strokeWidth={0.8} />
      {pressing && <circle cx={tx} cy={ty + 1} r={9} fill="none" stroke="#000" strokeOpacity={0.22} strokeWidth={1.5} />}
    </g>
  )
}

export function PlayerHands({ pose }: { pose: PlayerPose }) {
  const strumStamp = useStore((s) => s.strumStamp)
  const strumDir = useStore((s) => s.strumDir)
  const { handX, palmY, fingers, pickY } = pose

  const pickX = 1300
  const restY = 240
  const thumb = `M ${handX - 30} ${palmY - 4} C ${handX - 50} ${neckBottom(handX) - 34}, ${handX - 52} ${neckTop(handX) + 18}, ${handX - 38} ${neckTop(handX) - 6}`

  return (
    <g pointerEvents="none">
      {/* ---- fret hand (left) ---- */}
      <g>
        {/* wrist */}
        <path d={`M ${handX + 28} ${palmY + 22} C ${handX + 12} ${palmY + 8}, ${handX - 8} ${palmY + 8}, ${handX - 22} ${palmY + 20}`} stroke={SKIN} strokeWidth={30} strokeLinecap="round" fill="none" />
        {/* thumb wraps behind the neck, tip over the top edge */}
        <path d={thumb} stroke="#000" strokeOpacity={0.3} strokeWidth={16} strokeLinecap="round" fill="none" transform="translate(2 3)" />
        <path d={thumb} stroke={SKIN} strokeWidth={13} strokeLinecap="round" fill="none" opacity={0.92} />
        <ellipse cx={handX - 38} cy={neckTop(handX) - 5} rx={6.5} ry={5.5} fill={SKIN_HI} stroke={SKIN_DARK} strokeWidth={0.8} />
        {/* palm */}
        <ellipse cx={handX} cy={palmY + 5} rx={37} ry={21} fill={SKIN} stroke={SKIN_DARK} strokeWidth={1} />
        <ellipse cx={handX - 6} cy={palmY} rx={22} ry={10} fill={SKIN_HI} opacity={0.45} />
        {fingers.map((f, i) => (
          <Finger key={i} kx={handX - 26 + i * 17} ky={palmY - 6} tx={f.x} ty={f.y} pressing={f.pressing} />
        ))}
      </g>

      {/* ---- strum hand (right) ---- */}
      <g key={strumStamp} className={strumStamp ? (strumDir === 'up' ? 'strum-hand strum-up' : 'strum-hand strum-down') : 'strum-hand'} style={{ transformOrigin: `${pickX}px ${pickY}px` }}>
        <g style={{ transform: `translate(0px, ${pickY - restY}px)` }}>
          {/* forearm from the elbow at the body edge to the wrist */}
          <Limb d={`M 1582 202 C 1500 250, 1400 262, 1340 ${restY + 14}`} width={48} />
          <path d={`M 1352 ${restY + 12} L 1322 ${restY + 2}`} stroke={SKIN} strokeWidth={28} strokeLinecap="round" />
          {/* loosely closed hand, index + thumb holding the pick */}
          <ellipse cx={pickX + 8} cy={restY} rx={24} ry={19} fill={SKIN} stroke={SKIN_DARK} strokeWidth={1} transform={`rotate(-20 ${pickX + 8} ${restY})`} />
          {[0, 1, 2].map((i) => (
            <path key={i} d={`M ${pickX + 16 + i * 6} ${restY + 10 + i * 2} q 6 10 14 6`} stroke={SKIN_DARK} strokeWidth={2} fill="none" strokeLinecap="round" opacity={0.5} />
          ))}
          <path d={`M ${pickX + 8} ${restY - 12} C ${pickX - 6} ${restY - 8}, ${pickX - 12} ${restY + 2}, ${pickX - 4} ${restY + 8}`} stroke={SKIN} strokeWidth={12} strokeLinecap="round" fill="none" />
          <path d={`M ${pickX + 4} ${restY + 12} C ${pickX - 8} ${restY + 10}, ${pickX - 12} ${restY + 2}, ${pickX - 6} ${restY - 6}`} stroke={SKIN} strokeWidth={11} strokeLinecap="round" fill="none" />
          <path d={`M ${pickX - 14} ${restY - 4} L ${pickX - 2} ${restY - 10} L ${pickX - 4} ${restY + 8} Z`} fill="#f2f0e6" stroke="#b8b4a4" strokeWidth={1} />
        </g>
      </g>
    </g>
  )
}
