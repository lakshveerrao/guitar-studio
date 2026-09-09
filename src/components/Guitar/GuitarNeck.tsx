import { memo } from 'react'
import { NUM_FRETS } from '../../music/tuning'
import { HEAD_X0, MARKER_FRETS, NECK_END_X, NUT_X, fretCenterX, fretX, neckBottom, neckTop, stringY } from './geometry'

/** Static headstock, maple neck, rosewood-style fretboard, frets and inlays. */
export const GuitarNeck = memo(function GuitarNeck() {
  const topL = neckTop(NUT_X)
  const botL = neckBottom(NUT_X)
  const topR = neckTop(NECK_END_X)
  const botR = neckBottom(NECK_END_X)

  // Headstock: 6-in-line, tuners along the top edge
  const head =
    `M ${NUT_X} ${topL} ` +
    `C ${NUT_X - 20} ${topL - 12}, ${NUT_X - 60} ${topL - 30}, ${NUT_X - 110} ${topL - 42} ` +
    `C ${NUT_X - 150} ${topL - 52}, ${NUT_X - 186} ${topL - 30}, ${HEAD_X0 + 6} ${topL + 4} ` +
    `C ${HEAD_X0 - 2} ${topL + 30}, ${HEAD_X0 + 14} ${botL - 20}, ${NUT_X - 130} ${botL + 4} ` +
    `C ${NUT_X - 80} ${botL + 10}, ${NUT_X - 30} ${botL + 4}, ${NUT_X} ${botL} Z`

  const fretboard = `M ${NUT_X} ${topL} L ${NECK_END_X} ${topR} L ${NECK_END_X} ${botR} L ${NUT_X} ${botL} Z`

  return (
    <g>
      <defs>
        <linearGradient id="maple" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f0d9a6" />
          <stop offset="0.5" stopColor="#e6c98c" />
          <stop offset="1" stopColor="#c9a86a" />
        </linearGradient>
        <linearGradient id="fretboardWood" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4a2f22" />
          <stop offset="0.5" stopColor="#3a241a" />
          <stop offset="1" stopColor="#2a1912" />
        </linearGradient>
        <linearGradient id="fretWire" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#8c8f96" />
          <stop offset="0.5" stopColor="#f0f1f4" />
          <stop offset="1" stopColor="#7f828a" />
        </linearGradient>
        <linearGradient id="nut" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#e9e4d2" />
          <stop offset="1" stopColor="#c9c2ad" />
        </linearGradient>
        <filter id="neckShadow" x="-5%" y="-30%" width="110%" height="170%">
          <feDropShadow dx="0" dy="8" stdDeviation="8" floodColor="#000" floodOpacity="0.5" />
        </filter>
      </defs>

      {/* headstock */}
      <path d={head} fill="url(#maple)" stroke="#8a6a3a" strokeWidth={1.2} filter="url(#neckShadow)" />
      <path d={head} fill="none" stroke="#fff6dd" strokeOpacity={0.5} strokeWidth={0.6} />
      <text x={NUT_X - 178} y={botL - 26} fontSize={12} fill="#4b3416" fontStyle="italic" fontWeight={700} letterSpacing={1} opacity={0.8}>
        Studio
      </text>
      <text x={NUT_X - 178} y={botL - 14} fontSize={6} fill="#4b3416" letterSpacing={1.6} opacity={0.65}>
        STRATOS SERIES
      </text>
      {/* tuning pegs: post on the headstock face, button along the top edge */}
      {[0, 1, 2, 3, 4, 5].map((s) => {
        const px = NUT_X - 40 - s * 27
        const py = topL - 16 - s * 4
        return (
          <g key={s}>
            <circle cx={px} cy={py + 10} r={5.5} fill="#d4d6db" stroke="#6b6e75" strokeWidth={0.8} />
            <circle cx={px} cy={py + 10} r={2.4} fill="#4a4d55" />
            <rect x={px - 4} y={py - 14} width={8} height={16} rx={2.5} fill="#e4e5e9" stroke="#7a7d85" strokeWidth={0.8} />
            <rect x={px - 8} y={py - 26} width={16} height={11} rx={4} fill="#dfe0e4" stroke="#7a7d85" strokeWidth={0.8} />
          </g>
        )
      })}
      {/* string tree */}
      <rect x={NUT_X - 104} y={topL - 6} width={7} height={7} rx={2} fill="#d4d6db" stroke="#6b6e75" strokeWidth={0.6} />

      {/* maple neck behind the fretboard */}
      <path d={`M ${NUT_X} ${topL - 3} L ${NECK_END_X + 6} ${topR - 3} L ${NECK_END_X + 6} ${botR + 3} L ${NUT_X} ${botL + 3} Z`} fill="url(#maple)" filter="url(#neckShadow)" />

      {/* fretboard */}
      <path d={fretboard} fill="url(#fretboardWood)" />
      <path d={fretboard} fill="none" stroke="#1a100b" strokeWidth={1} />
      {/* subtle wood grain */}
      {[0.18, 0.36, 0.55, 0.72, 0.88].map((t, i) => (
        <line
          key={i}
          x1={NUT_X}
          y1={topL + (botL - topL) * t}
          x2={NECK_END_X}
          y2={topR + (botR - topR) * t}
          stroke="#000"
          strokeOpacity={0.12}
          strokeWidth={1.5 + (i % 2)}
        />
      ))}

      {/* inlays */}
      {MARKER_FRETS.map((n) => {
        const cx = fretCenterX(n)
        if (n === 12) {
          return (
            <g key={n}>
              <circle cx={cx} cy={stringY(1, cx) + (stringY(2, cx) - stringY(1, cx)) / 2} r={5.5} fill="#e8e2cf" opacity={0.85} />
              <circle cx={cx} cy={stringY(3, cx) + (stringY(4, cx) - stringY(3, cx)) / 2} r={5.5} fill="#e8e2cf" opacity={0.85} />
            </g>
          )
        }
        const cy = (neckTop(cx) + neckBottom(cx)) / 2
        return <circle key={n} cx={cx} cy={cy} r={5.5} fill="#e8e2cf" opacity={0.85} />
      })}
      {/* side dots + fret numbers */}
      {Array.from({ length: NUM_FRETS }, (_, i) => i + 1).map((n) => {
        const cx = fretCenterX(n)
        const isMarker = MARKER_FRETS.includes(n)
        return (
          <g key={n}>
            {isMarker && <circle cx={cx} cy={neckBottom(cx) + 1.5} r={1.6} fill="#f3ecd6" opacity={0.9} />}
            <text x={cx} y={neckBottom(cx) + 16} fontSize={9} textAnchor="middle" fill={isMarker ? '#9aa3af' : '#5f6875'} fontWeight={isMarker ? 700 : 500} className="mono">
              {n}
            </text>
          </g>
        )
      })}

      {/* frets */}
      {Array.from({ length: NUM_FRETS }, (_, i) => i + 1).map((n) => {
        const x = fretX(n)
        return (
          <g key={n}>
            <rect x={x - 1.6} y={neckTop(x)} width={3.2} height={neckBottom(x) - neckTop(x)} fill="#000" opacity={0.35} transform="translate(1.2 0)" />
            <rect x={x - 1.6} y={neckTop(x)} width={3.2} height={neckBottom(x) - neckTop(x)} fill="url(#fretWire)" rx={1} />
          </g>
        )
      })}
      {/* nut */}
      <rect x={NUT_X - 6} y={topL - 1} width={7} height={botL - topL + 2} fill="url(#nut)" stroke="#9a937f" strokeWidth={0.6} rx={1} />
    </g>
  )
})
