import { forwardRef, type ReactNode } from 'react'

/**
 * Paylaşım kartları (ShareCard, HistoricalShareCard, EnergyShareCard) için
 * ortak görsel dil. Kartlar html2canvas ile rasterize ediliyor; bu yüzden
 * yalnızca güvenilir rasterize olan öğeler kullanılıyor: solid <div>,
 * lineer gradient, border-radius, ve dikey ortalama line-height ile yapılıyor
 * (flexbox align-items html2canvas'ta metni doğru ortalamıyor).
 *
 * İllüstrasyon yok — hizalama tek bir CSS grid üzerinden garanti ediliyor.
 */

export const COLOR_A = '#E10600'
export const COLOR_B = '#FF8700'
export const TEAL = '#00D2BE'

/**
 * İki değeri ortadan iki yöne uzanan barla karşılaştırır (yarış yayını
 * "sektör farkı" grafiği gibi). Bar, kazananın tarafına |fark| oranında uzar.
 */
export function CompareBar({ frac, aWins }: { frac: number; aWins: boolean }) {
  const w = Math.min(1, Math.max(0, frac)) * 50 // barın yarısının yüzdesi
  return (
    <div style={{ position: 'relative', height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.05)' }}>
      {/* orta çizgi */}
      <div style={{ position: 'absolute', left: '50%', top: -2, bottom: -2, width: 1, background: 'rgba(255,255,255,0.22)' }} />
      {/* dolgu */}
      <div style={{
        position: 'absolute', top: 0, bottom: 0,
        ...(aWins
          ? { right: '50%', width: `${w}%`, background: COLOR_A, borderRadius: '4px 0 0 4px' }
          : { left: '50%', width: `${w}%`, background: COLOR_B, borderRadius: '0 4px 4px 0' }),
      }} />
    </div>
  )
}

/** Şarj seviyeli batarya göstergesi — basit <rect>/<text> SVG (html2canvas uyumlu) */
export function Battery({ pct, color, label }: { pct: number; color: string; label?: string }) {
  const w = 96, h = 40
  const innerMaxW = w - 14
  const clamped = Math.min(100, Math.max(0, pct))
  const fillW = Math.max(3, (clamped / 100) * innerMaxW)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <svg width={w + 7} height={h} viewBox={`0 0 ${w + 7} ${h}`} xmlns="http://www.w3.org/2000/svg">
        <rect x="1.5" y="3" width={w} height={h - 6} rx="5" fill="#101010" stroke="#444" strokeWidth="2" />
        <rect x={w + 2} y={h / 2 - 6} width="5" height="12" rx="1.5" fill="#444" />
        <rect x="6" y="8" width={fillW} height={h - 16} rx="3" fill={color} />
        <text x={(w + 7) / 2} y={h / 2 + 4.5} textAnchor="middle" fontSize="13" fontWeight="700" fill="#fff"
          fontFamily="'IBM Plex Mono', monospace">
          {Math.round(clamped)}%
        </text>
      </svg>
      {label && <p style={{ margin: 0, fontSize: 12, color, letterSpacing: '0.05em', fontWeight: 800 }}>{label}</p>}
    </div>
  )
}

/** Lastik bileşimi rozeti */
export function CompoundChip({ compound, color }: { compound: string; color: string }) {
  return (
    <span style={{
      display: 'inline-block', padding: '5px 10px', lineHeight: 1,
      borderRadius: 10, fontSize: 10, fontWeight: 700, color: '#000',
      background: color, letterSpacing: '0.03em',
    }}>
      {compound}
    </span>
  )
}

interface CardShellProps {
  height: number
  accent?: string
  sourceLabel: string
  children: ReactNode
}

/** Tüm paylaşım kartlarının dış çerçevesi — üst gradient şerit + standart altlık */
export const CardShell = forwardRef<HTMLDivElement, CardShellProps>(
  ({ height, accent, sourceLabel, children }, ref) => (
    <div
      ref={ref}
      style={{
        width: 600,
        height,
        background: '#0a0a0a',
        fontFamily: "'IBM Plex Mono', monospace",
        position: 'absolute',
        left: -9999,
        top: -9999,
        overflow: 'hidden',
      }}
    >
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 4,
        background: accent ?? `linear-gradient(90deg, ${COLOR_A}, ${TEAL}, ${COLOR_B})`,
      }} />

      <div style={{
        padding: '28px 34px', display: 'flex', flexDirection: 'column',
        height: '100%', justifyContent: 'space-between', boxSizing: 'border-box', gap: 18,
      }}>
        {children}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <p style={{ color: '#555', fontSize: 10, margin: 0, fontWeight: 700, letterSpacing: '0.08em' }}>hotlap.live</p>
          <p style={{ color: '#3a3a3a', fontSize: 10, margin: 0 }}>{sourceLabel}</p>
        </div>
      </div>
    </div>
  )
)
CardShell.displayName = 'CardShell'
