import { NUM_FRETS, NUM_STRINGS } from '../../music/tuning'

export const VB_W = 1640
export const VB_H = 440

export const NUT_X = 196
export const NECK_END_X = 1170
export const HEAD_X0 = 4
export const BODY_X0 = 1010
export const BRIDGE_X = 1420
export const OPEN_ZONE_X0 = 140 // open-string hit zone (left of the nut)
export const STATUS_X = 116 // per-string status column (O / X)

// neck edge y at the nut and at the body join
const NECK_TOP_NUT = 150
const NECK_BOT_NUT = 270
const NECK_TOP_END = 134
const NECK_BOT_END = 286

const STRING_MARGIN_NUT = 12
const STRING_MARGIN_END = 14

export const STRING_WIDTHS = [3.4, 2.9, 2.4, 1.7, 1.4, 1.15]

const REAL_BLEND = 0.72 // 1 = true equal-temperament spacing, 0 = linear

const fretXCache: number[] = []
/** x of fret wire n (0 = nut). */
export function fretX(n: number): number {
  if (fretXCache[n] !== undefined) return fretXCache[n]
  const span = NECK_END_X - NUT_X
  const L = span / (1 - Math.pow(2, -NUM_FRETS / 12))
  const real = L * (1 - Math.pow(2, -n / 12))
  const linear = (n / NUM_FRETS) * span
  const x = NUT_X + REAL_BLEND * real + (1 - REAL_BLEND) * linear
  fretXCache[n] = x
  return x
}

/** Center x of fret position n (where a finger goes). n = 0 -> open zone. */
export function fretCenterX(n: number): number {
  if (n <= 0) return (OPEN_ZONE_X0 + NUT_X) / 2
  return (fretX(n - 1) + fretX(n)) / 2
}

export function neckTop(x: number): number {
  const t = (x - NUT_X) / (NECK_END_X - NUT_X)
  return NECK_TOP_NUT + (NECK_TOP_END - NECK_TOP_NUT) * t
}
export function neckBottom(x: number): number {
  const t = (x - NUT_X) / (NECK_END_X - NUT_X)
  return NECK_BOT_NUT + (NECK_BOT_END - NECK_BOT_NUT) * t
}

/** y of string s (0 = low E, drawn at the top) at horizontal position x. */
export function stringY(s: number, x: number): number {
  const t = Math.max(0, Math.min(1.6, (x - NUT_X) / (NECK_END_X - NUT_X)))
  const top = NECK_TOP_NUT + (NECK_TOP_END - NECK_TOP_NUT) * t
  const bot = NECK_BOT_NUT + (NECK_BOT_END - NECK_BOT_NUT) * t
  const margin = STRING_MARGIN_NUT + (STRING_MARGIN_END - STRING_MARGIN_NUT) * t
  const y0 = top + margin
  const y1 = bot - margin
  return y0 + ((y1 - y0) * s) / (NUM_STRINGS - 1)
}

/** vertical spacing between strings at x */
export function stringGap(x: number): number {
  return stringY(1, x) - stringY(0, x)
}

export const MARKER_FRETS = [3, 5, 7, 9, 12, 15, 17, 19, 21]

/** Which string index is nearest to a y at x; returns -1 if too far away. */
export function nearestString(x: number, y: number, tolerance = 1.2): number {
  const gap = stringGap(x)
  let best = -1
  let bestD = Infinity
  for (let s = 0; s < NUM_STRINGS; s++) {
    const d = Math.abs(stringY(s, x) - y)
    if (d < bestD) {
      bestD = d
      best = s
    }
  }
  return bestD <= gap * tolerance ? best : -1
}

/** Fret number at x on the neck, or -1 when off the neck. 0 = open zone. */
export function fretAt(x: number): number {
  if (x >= OPEN_ZONE_X0 && x < NUT_X) return 0
  if (x < NUT_X || x > NECK_END_X) return -1
  for (let n = 1; n <= NUM_FRETS; n++) {
    if (x <= fretX(n)) return n
  }
  return -1
}
