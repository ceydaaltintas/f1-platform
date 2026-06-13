import { forwardRef } from 'react'
import { COMPOUND_COLORS } from '../../types/f1'
import { formatLapTime, formatSectorTime } from '../../utils/format'
import { CardShell, CompoundChip, COLOR_A, TEAL } from './shareCardKit'

interface YearResult {
  year: number
  lap_time?: number | null
  s1?: number | null
  s2?: number | null
  s3?: number | null
  compound?: string | null
  error?: string
}

interface Props {
  driver: string
  circuitName: string
  results: YearResult[]
  fastestYear?: number
}

export const HistoricalShareCard = forwardRef<HTMLDivElement, Props>(
  ({ driver, circuitName, results, fastestYear }, ref) => {
    const rows = results.filter(r => !r.error)
    const hasCompound = rows.some(r => !!r.compound)

    // İlk sütun: sabit genişlikli işaretçi (★ sadece en hızlı satırda) — her
    // satırda bulunduğu için yıldız hiçbir verinin hizasını kaydırmaz.
    // Lastik verisi yoksa o sütunu hiç gösterme.
    const COLS = hasCompound
      ? '16px 56px 1fr 72px 72px 72px 78px'
      : '16px 56px 1fr 84px 84px 84px'

    const hdr = { fontSize: 10, color: '#888', fontWeight: 700 as const, letterSpacing: '0.1em', lineHeight: 1 }

    // Dikey ortalama: eşit padding + lineHeight:1 + baseline (html2canvas'ta
    // line-height=height yöntemi metni kaydırır; arka plan bandı YOK)
    const rowBase = {
      display: 'grid', gridTemplateColumns: COLS, columnGap: 10,
      alignItems: 'baseline' as const,
    }

    return (
      <CardShell ref={ref} height={170 + rows.length * 48 + 56} sourceLabel="Gerçek F1 telemetri verisi · OpenF1 / Jolpica">
        {/* Başlık */}
        <div>
          <p style={{ color: COLOR_A, fontSize: 11, letterSpacing: '0.2em', margin: '0 0 6px', fontWeight: 700 }}>
            HOTLAP.LIVE · TARİHSEL KARŞILAŞTIRMA
          </p>
          <p style={{ color: '#fff', fontSize: 22, fontWeight: 700, margin: 0 }}>
            {driver} <span style={{ color: '#555', fontWeight: 500 }}>·</span> {circuitName}
          </p>
        </div>

        {/* Yıl tablosu */}
        <div style={{ background: '#121212', borderRadius: 12, padding: '8px 18px 12px', border: '1px solid rgba(255,255,255,0.05)' }}>
          {/* Başlık satırı */}
          <div style={{ ...rowBase, padding: '11px 0' }}>
            <span />
            <span style={hdr}>YIL</span>
            <span style={hdr}>TUR SÜRESİ</span>
            <span style={{ ...hdr, textAlign: 'center' }}>S1</span>
            <span style={{ ...hdr, textAlign: 'center' }}>S2</span>
            <span style={{ ...hdr, textAlign: 'center' }}>S3</span>
            {hasCompound && <span style={{ ...hdr, textAlign: 'center' }}>LASTİK</span>}
          </div>

          {/* Yıl satırları */}
          {rows.map((r) => {
            const isFastest = r.year === fastestYear
            const numColor = isFastest ? TEAL : '#cfcfcf'
            const cell = { fontSize: 14, color: numColor, textAlign: 'center' as const, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }
            return (
              <div key={r.year} style={{
                ...rowBase, padding: '15px 0',
                borderTop: '1px solid rgba(255,255,255,0.06)',
              }}>
                {/* işaretçi sütunu — en hızlı satırda yıldız */}
                <span style={{ color: TEAL, fontSize: 13, lineHeight: 1, textAlign: 'left' }}>{isFastest ? '★' : ''}</span>
                <span style={{ fontSize: 15, fontWeight: 700, color: isFastest ? TEAL : '#aaa', lineHeight: 1 }}>{r.year}</span>
                <span style={{ fontSize: 18, fontWeight: 700, color: isFastest ? TEAL : '#fff', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                  {formatLapTime(r.lap_time)}
                </span>
                <span style={cell}>{formatSectorTime(r.s1)}</span>
                <span style={cell}>{formatSectorTime(r.s2)}</span>
                <span style={cell}>{formatSectorTime(r.s3)}</span>
                {hasCompound && (
                  <div style={{ textAlign: 'center' }}>
                    {r.compound
                      ? <CompoundChip compound={r.compound} color={COMPOUND_COLORS[r.compound] ?? '#888'} />
                      : <span style={{ color: '#444', fontSize: 13, lineHeight: 1 }}>—</span>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </CardShell>
    )
  }
)
HistoricalShareCard.displayName = 'HistoricalShareCard'
