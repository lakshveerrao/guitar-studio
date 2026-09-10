import { memo, useEffect, useLayoutEffect, useState } from 'react'
import { store, useStore, type AppState } from '../../state/store'
import { chordById } from '../../music/chords'
import { NECK_END_X, NUT_X, fretCenterX, neckBottom, neckTop, stringY } from './geometry'

const SKIN = '#e2b48f'
const SKIN_HI = '#f2cdae'
const SKIN_DARK = '#c8956d'
const SLEEVE = '#3a4150'
const SLEEVE_HI = '#4c5568'

/** Vertical extent of the guitarist (top of the hair .. bottom of the torso), used to frame the viewBox when the stage is off. */
export const PLAYER_TOP = -160
export const PLAYER_BOTTOM = 480

const PICK_X = 1300
const REST_Y = 240
const ELBOW_X = 1010
const ELBOW_Y = 412
const EASE = 0.22 // per-frame easing factor toward the target pose
const SETTLE = 0.35 // viewBox units: below this the pose snaps to its target and the loop stops

/**
 * The guitarist. Drawn in three layers so the guitar sits in between:
 *   <PlayerBody/>   behind everything: head, torso, shoulders, strap
 *   <PlayerArms/>   behind the guitar: upper arms + forearms (pose-driven)
 *   <PlayerHands/>  in front: fret hand on the strings, strum hand with pick
 * Pose targets come from the fretting state. A rig (usePlayerRig) eases every
 * joint toward its target on animation frames and writes the SVG attributes
 * directly, so the movement never re-renders React. Only the strum gesture
 * (rare) goes through React state, via the key on the strum-hand group.
 */

// ---------------------------------------------------------------- pose ----

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

interface PoseTargets {
  /** [handX, palmY, finger0x, finger0y, ... finger3x, finger3y, pickY] */
  values: number[]
  pressing: boolean[]
}

function poseTargets(st: AppState): PoseTargets {
  const chord = st.chordId ? chordById(st.chordId) : undefined
  const assigned = fingerAssignments(st.frets, chord?.fingers)
  const active = assigned.filter((f): f is FingerTarget => !!f)
  const rawX = active.length ? active.reduce((a, f) => a + f.x, 0) / active.length + 8 : fretCenterX(2)
  const handX = Math.max(NUT_X + 40, Math.min(NECK_END_X - 40, rawX))
  const palmY = neckBottom(handX) + 16
  // rest positions for fingers not pressing: curled just under the neck edge
  const targets = assigned.map((t, i) => t ?? { x: handX - 28 + i * 17, y: neckBottom(handX) - 4 - i * 2 })
  const { lastNote, lastTechnique } = st
  const pickY = lastNote && lastTechnique !== 'strum' && lastTechnique !== '' ? stringY(lastNote.string, PICK_X) + 6 : REST_Y
  return { values: [handX, palmY, ...targets.flatMap((t) => [t.x, t.y]), pickY], pressing: assigned.map((t) => !!t) }
}

// ----------------------------------------------------------------- rig ----

const f = (n: number) => Math.round(n * 100) / 100

interface FingerLayout {
  d: string
  jx: number
  jy: number
  tx: number
  ty: number
}

/** Two-segment finger: knuckle -> middle joint -> tip, bent so it reads as a curl. */
function fingerLayout(kx: number, ky: number, tx: number, ty: number, pressing: boolean): FingerLayout {
  const dx = tx - kx
  const dy = ty - ky
  const len = Math.hypot(dx, dy) || 1
  // middle joint bows outward (toward the bridge) proportionally to the reach
  const bow = pressing ? Math.min(34, 10 + len * 0.16) : 12
  const mx = kx + dx * 0.55 + (dy < 0 ? bow : bow * 0.4)
  const my = ky + dy * 0.55 - (pressing ? 4 : 10)
  const d = `M ${f(kx)} ${f(ky)} Q ${f(kx + dx * 0.25 + bow * 0.8)} ${f(ky + dy * 0.25)} ${f(mx)} ${f(my)} Q ${f(mx + (tx - mx) * 0.45 - bow * 0.35)} ${f(my + (ty - my) * 0.6)} ${f(tx)} ${f(ty)}`
  return { d, jx: mx, jy: my, tx, ty }
}

export interface PlayerRig {
  /** Stable ref callback for the SVG element the rig positions under `key`. */
  bind(key: string): (el: SVGElement | null) => void
  /** Write the current pose into every bound element (call after a commit that (re)mounted bound elements). */
  paint(): void
}

interface RigImpl extends PlayerRig {
  setEnabled(on: boolean): void
  setTargets(t: PoseTargets): void
}

function createRig(): RigImpl {
  const init = poseTargets(store.get())
  let cur = init.values.slice()
  let target = init.values.slice()
  let pressing = init.pressing.slice()
  let enabled = false
  let raf = 0
  const slots = new Map<string, SVGElement>()
  const binders = new Map<string, (el: SVGElement | null) => void>()
  // last value written per element, so an unchanged attribute is not re-set every frame
  const written = new Map<string, Map<string, string>>()

  const bind = (key: string) => {
    let fn = binders.get(key)
    if (!fn) {
      fn = (el) => {
        written.delete(key)
        if (el) slots.set(key, el)
        else slots.delete(key)
      }
      binders.set(key, fn)
    }
    return fn
  }

  const set = (key: string, attr: string, value: string) => {
    const el = slots.get(key)
    if (!el) return
    let w = written.get(key)
    if (!w) written.set(key, (w = new Map()))
    if (w.get(attr) === value) return
    w.set(attr, value)
    if (attr === 'transform' || attr === 'transformOrigin') el.style[attr] = value
    else el.setAttribute(attr, value)
  }
  const setXY = (key: string, x: number, y: number) => {
    set(key, 'cx', String(f(x)))
    set(key, 'cy', String(f(y)))
  }

  const paint = () => {
    const handX = cur[0]
    const palmY = cur[1]
    const pickY = cur[10]
    // left forearm: elbow just below the lower horn out along the neck to the wrist
    const wristX = handX + 6
    const wristY = palmY + 10
    const fore = `M ${ELBOW_X} ${ELBOW_Y} C ${ELBOW_X - 160} ${ELBOW_Y + 4}, ${f(wristX + 160)} ${f(wristY + 26)}, ${f(wristX)} ${f(wristY)}`
    set('fore.0', 'd', fore)
    set('fore.1', 'd', fore)
    set('fore.2', 'd', fore)
    // fret hand
    set('wrist', 'd', `M ${f(handX + 28)} ${f(palmY + 22)} C ${f(handX + 12)} ${f(palmY + 8)}, ${f(handX - 8)} ${f(palmY + 8)}, ${f(handX - 22)} ${f(palmY + 20)}`)
    const nt = neckTop(handX)
    const nb = neckBottom(handX)
    const thumb = `M ${f(handX - 30)} ${f(palmY - 4)} C ${f(handX - 50)} ${f(nb - 34)}, ${f(handX - 52)} ${f(nt + 18)}, ${f(handX - 38)} ${f(nt - 6)}`
    set('thumb.0', 'd', thumb)
    set('thumb.1', 'd', thumb)
    setXY('thumbTip', handX - 38, nt - 5)
    setXY('palm', handX, palmY + 5)
    setXY('palmHi', handX - 6, palmY)
    for (let i = 0; i < 4; i++) {
      const p = pressing[i]
      const L = fingerLayout(handX - 26 + i * 17, palmY - 6, cur[2 + i * 2], cur[3 + i * 2], p)
      set(`f${i}.shadow`, 'd', L.d)
      set(`f${i}.main`, 'd', L.d)
      set(`f${i}.hi`, 'd', L.d)
      setXY(`f${i}.joint`, L.jx, L.jy)
      setXY(`f${i}.tip`, L.tx, L.ty)
      set(`f${i}.tip`, 'rx', p ? '7.5' : '6.5')
      set(`f${i}.tip`, 'ry', p ? '6' : '6.5')
      set(`f${i}.tip`, 'fill', p ? '#f0c4a0' : SKIN)
      setXY(`f${i}.ring`, L.tx, L.ty + 1)
      set(`f${i}.ring`, 'visibility', p ? 'visible' : 'hidden')
    }
    // strum hand: the strum keyframes rotate/translate about the pick, the inner group carries the string offset
    set('strum', 'transformOrigin', `${PICK_X}px ${f(pickY)}px`)
    set('strumInner', 'transform', `translate(0px, ${f(pickY - REST_Y)}px)`)
  }

  const step = () => {
    raf = 0
    let maxD = 0
    for (let i = 0; i < cur.length; i++) {
      const d = target[i] - cur[i]
      const a = Math.abs(d)
      if (a > maxD) maxD = a
      cur[i] += d * EASE
    }
    const settled = maxD <= SETTLE
    if (settled) cur = target.slice()
    paint()
    if (!settled) raf = requestAnimationFrame(step)
  }
  const kick = () => {
    if (enabled && !raf) raf = requestAnimationFrame(step)
  }

  return {
    bind,
    paint,
    setTargets(t) {
      let changed = t.values.length !== target.length || t.pressing.length !== pressing.length
      for (let i = 0; !changed && i < target.length; i++) if (t.values[i] !== target[i]) changed = true
      for (let i = 0; !changed && i < pressing.length; i++) if (t.pressing[i] !== pressing[i]) changed = true
      if (!changed) return
      target = t.values.slice()
      pressing = t.pressing.slice()
      kick()
    },
    setEnabled(on) {
      enabled = on
      if (!on) {
        if (raf) cancelAnimationFrame(raf)
        raf = 0
        return
      }
      // (re)appearing: no drift animation from a stale pose
      cur = target.slice()
      paint()
    },
  }
}

/**
 * Owns the guitarist's pose. Subscribes to the store outside React and drives
 * the bound SVG elements from a rAF loop that only runs while the pose is
 * still converging; nothing runs at all while the player is hidden.
 */
export function usePlayerRig(enabled: boolean): PlayerRig {
  const [rig] = useState(createRig)
  useEffect(() => {
    const sync = () => rig.setTargets(poseTargets(store.get()))
    sync()
    const unsub = store.subscribe(sync)
    return () => {
      unsub()
    }
  }, [rig])
  useEffect(() => {
    rig.setEnabled(enabled)
    return () => rig.setEnabled(false)
  }, [rig, enabled])
  return rig
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

type Binder = (i: number) => (el: SVGElement | null) => void

/** Sleeve segment: shadow + sleeve + highlight. Static when `d` is given, rig-driven when `bind` is given. */
function Limb({ d, width, bind }: { d?: string; width: number; bind?: Binder }) {
  return (
    <>
      <path ref={bind?.(0)} d={d} stroke="#000" strokeOpacity={0.35} strokeWidth={width + 4} strokeLinecap="round" fill="none" transform="translate(3 5)" />
      <path ref={bind?.(1)} d={d} stroke={SLEEVE} strokeWidth={width} strokeLinecap="round" fill="none" />
      <path ref={bind?.(2)} d={d} stroke={SLEEVE_HI} strokeWidth={width * 0.35} strokeLinecap="round" fill="none" opacity={0.45} transform="translate(-4 -6)" />
    </>
  )
}

/** Upper arms and forearms. Behind the guitar, so the left arm passes under the neck and the right arm rests over the body. */
export const PlayerArms = memo(function PlayerArms({ rig }: { rig: PlayerRig }) {
  useLayoutEffect(() => {
    rig.paint()
  })
  // left arm: upper arm drops behind the body to an elbow just below the lower horn,
  // forearm (rig-driven) runs out along the neck to the wrist (how it looks from the audience)
  const upper = `M 1196 42 C 1150 160, 1060 300, ${ELBOW_X} ${ELBOW_Y}`
  return (
    <g pointerEvents="none">
      <Limb d={upper} width={54} />
      <Limb width={48} bind={(i) => rig.bind(`fore.${i}`)} />
      <circle cx={ELBOW_X} cy={ELBOW_Y} r={25} fill={SLEEVE} />
      {/* right upper arm over the top of the body */}
      <Limb d="M 1488 42 C 1560 90, 1600 150, 1582 202" width={54} />
    </g>
  )
})

// --------------------------------------------------------------- hands ----

/** One finger; every pose-dependent attribute is written by the rig. */
function Finger({ rig, i }: { rig: PlayerRig; i: number }) {
  const k = (part: string) => rig.bind(`f${i}.${part}`)
  return (
    <g>
      <path ref={k('shadow')} stroke="#000" strokeOpacity={0.3} strokeWidth={15} strokeLinecap="round" fill="none" transform="translate(2 3)" />
      <path ref={k('main')} stroke={SKIN} strokeWidth={12.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path ref={k('hi')} stroke={SKIN_HI} strokeWidth={3.5} strokeLinecap="round" fill="none" opacity={0.55} transform="translate(-2 -2)" />
      {/* joint crease */}
      <circle ref={k('joint')} r={5.2} fill="none" stroke={SKIN_DARK} strokeWidth={1} opacity={0.45} />
      {/* fingertip, pressed flat when fretting */}
      <ellipse ref={k('tip')} stroke={SKIN_DARK} strokeWidth={0.8} />
      <circle ref={k('ring')} r={9} fill="none" stroke="#000" strokeOpacity={0.22} strokeWidth={1.5} visibility="hidden" />
    </g>
  )
}

export const PlayerHands = memo(function PlayerHands({ rig }: { rig: PlayerRig }) {
  const strumStamp = useStore((s) => s.strumStamp)
  const strumDir = useStore((s) => s.strumDir)
  // the strum-hand group remounts on every strum (key), so its rig-owned attributes must be rewritten after each commit
  useLayoutEffect(() => {
    rig.paint()
  })

  return (
    <g pointerEvents="none">
      {/* ---- fret hand (left) ---- */}
      <g>
        {/* wrist */}
        <path ref={rig.bind('wrist')} stroke={SKIN} strokeWidth={30} strokeLinecap="round" fill="none" />
        {/* thumb wraps behind the neck, tip over the top edge */}
        <path ref={rig.bind('thumb.0')} stroke="#000" strokeOpacity={0.3} strokeWidth={16} strokeLinecap="round" fill="none" transform="translate(2 3)" />
        <path ref={rig.bind('thumb.1')} stroke={SKIN} strokeWidth={13} strokeLinecap="round" fill="none" opacity={0.92} />
        <ellipse ref={rig.bind('thumbTip')} rx={6.5} ry={5.5} fill={SKIN_HI} stroke={SKIN_DARK} strokeWidth={0.8} />
        {/* palm */}
        <ellipse ref={rig.bind('palm')} rx={37} ry={21} fill={SKIN} stroke={SKIN_DARK} strokeWidth={1} />
        <ellipse ref={rig.bind('palmHi')} rx={22} ry={10} fill={SKIN_HI} opacity={0.45} />
        {[0, 1, 2, 3].map((i) => (
          <Finger key={i} rig={rig} i={i} />
        ))}
      </g>

      {/* ---- strum hand (right) ---- */}
      <g key={strumStamp} ref={rig.bind('strum')} className={strumStamp ? (strumDir === 'up' ? 'strum-hand strum-up' : 'strum-hand strum-down') : 'strum-hand'}>
        <g ref={rig.bind('strumInner')}>
          {/* forearm from the elbow at the body edge to the wrist */}
          <Limb d={`M 1582 202 C 1500 250, 1400 262, 1340 ${REST_Y + 14}`} width={48} />
          <path d={`M 1352 ${REST_Y + 12} L 1322 ${REST_Y + 2}`} stroke={SKIN} strokeWidth={28} strokeLinecap="round" />
          {/* loosely closed hand, index + thumb holding the pick */}
          <ellipse cx={PICK_X + 8} cy={REST_Y} rx={24} ry={19} fill={SKIN} stroke={SKIN_DARK} strokeWidth={1} transform={`rotate(-20 ${PICK_X + 8} ${REST_Y})`} />
          {[0, 1, 2].map((i) => (
            <path key={i} d={`M ${PICK_X + 16 + i * 6} ${REST_Y + 10 + i * 2} q 6 10 14 6`} stroke={SKIN_DARK} strokeWidth={2} fill="none" strokeLinecap="round" opacity={0.5} />
          ))}
          <path d={`M ${PICK_X + 8} ${REST_Y - 12} C ${PICK_X - 6} ${REST_Y - 8}, ${PICK_X - 12} ${REST_Y + 2}, ${PICK_X - 4} ${REST_Y + 8}`} stroke={SKIN} strokeWidth={12} strokeLinecap="round" fill="none" />
          <path d={`M ${PICK_X + 4} ${REST_Y + 12} C ${PICK_X - 8} ${REST_Y + 10}, ${PICK_X - 12} ${REST_Y + 2}, ${PICK_X - 6} ${REST_Y - 6}`} stroke={SKIN} strokeWidth={11} strokeLinecap="round" fill="none" />
          <path d={`M ${PICK_X - 14} ${REST_Y - 4} L ${PICK_X - 2} ${REST_Y - 10} L ${PICK_X - 4} ${REST_Y + 8} Z`} fill="#f2f0e6" stroke="#b8b4a4" strokeWidth={1} />
        </g>
      </g>
    </g>
  )
})
