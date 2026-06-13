import { forwardRef } from 'react'
import type { TelemetryResponse } from '../../types/f1'
import { COMPOUND_COLORS } from '../../types/f1'
import { formatLapTime, formatSectorTime } from '../../utils/format'
import { CardShell, CompareBar, CompoundChip, COLOR_A, COLOR_B, TEAL } from './shareCardKit'

interface Props {
  sessionName: string       // "Monaco GP · Qualifying"
  driverA: string           // "VER"
  driverB: string           // "NOR"
  lapA: TelemetryResponse['lap']
  lapB: TelemetryResponse['lap']
  gapSeconds: number        // pozitif = A daha hızlı
}

// Tek grid şablonu — başlık, sektör ve toplam satırları aynı sütunlara oturur
const COLS = '70px 96px 1fr 96px'

export const ShareCard = forwardRef<HTMLDivElement, Props>(
  ({ sessionName, driverA, driverB, lapA, lapB, gapSeconds }, ref) => {
    const faster = gapSeconds <= 0 ? driverA : driverB
    const gap = Math.abs(gapSeconds).toFixed(3)

    const durA = lapA?.duration ?? null
    const durB = lapB?.duration ?? null

    const sectors = ([1, 2, 3] as const).map((s) => {
      const key = `sector${s}` as 'sector1' | 'sector2' | 'sector3'
      const a = lapA?.[key]
      const b = lapB?.[key]
      const aWins = a != null && b != null ? a <= b : false
      const frac = a != null && b != null ? Math.abs(a - b) / Math.max(a, b) * 6 : 0
      return { num: s, a, b, aWins, frac }
    })

    const totalAWins = durA != null && durB != null ? durA <= durB : gapSeconds <= 0
    const totalFrac = durA != null && durB != null ? Math.abs(durA - durB) / Math.max(durA, durB) * 6 : 0

    // Tek bir karşılaştırma satırı (sektör veya toplam) — dikey ortalama
    // eşit padding + lineHeight:1 + align-items center ile (html2canvas uyumlu)
    const Row = ({ label, a, b, aWins, frac, big }: {
      label: string; a: number | null | undefined; b: number | null | undefined
      aWins: boolean; frac: number; big?: boolean
    }) => (
      <div style={{ display: 'grid', gridTemplateColumns: COLS, columnGap: 12, alignItems: 'center', padding: big ? '9px 0' : '7px 0' }}>
        <span style={{ color: '#888', fontSize: big ? 12 : 11, fontWeight: 700, letterSpacing: '0.06em', lineHeight: 1 }}>{label}</span>
        <span style={{
          textAlign: 'right', fontVariantNumeric: 'tabular-nums', lineHeight: 1,
          fontSize: big ? 18 : 15, fontWeight: aWins ? 700 : 500, color: aWins ? TEAL : '#999',
        }}>
          {big ? formatLapTime(a) : formatSectorTime(a)}
        </span>
        <CompareBar frac={frac} aWins={aWins} />
        <span style={{
          textAlign: 'left', fontVariantNumeric: 'tabular-nums', lineHeight: 1,
          fontSize: big ? 18 : 15, fontWeight: !aWins ? 700 : 500, color: !aWins ? TEAL : '#999',
        }}>
          {big ? formatLapTime(b) : formatSectorTime(b)}
        </span>
      </div>
    )

    return (
      <CardShell ref={ref} height={440} sourceLabel="Gerçek F1 telemetri verisi · OpenF1">
        {/* Başlık */}
        <div>
          <p style={{ color: COLOR_A, fontSize: 11, letterSpacing: '0.2em', margin: '0 0 6px', fontWeight: 700 }}>
            HOTLAP.LIVE · F1 TELEMETRİ ANALİZİ
          </p>
          <p style={{ color: '#fff', fontSize: 22, fontWeight: 700, margin: 0 }}>{sessionName}</p>
        </div>

        {/* Hero: iki pilot + fark */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {/* A */}
          <div style={{ textAlign: 'center', flex: 1 }}>
            <p style={{ color: COLOR_A, fontSize: 34, fontWeight: 800, margin: '0 0 4px', letterSpacing: '0.04em' }}>
              {driverA}{lapA?.is_personal_best ? ' ★' : ''}
            </p>
            <p style={{ color: gapSeconds <= 0 ? TEAL : '#999', fontSize: 22, fontWeight: 700, margin: 0, fontVariantNumeric: 'tabular-nums' }}>
              {formatLapTime(durA)}
            </p>
            {lapA?.compound && <div style={{ marginTop: 8 }}><CompoundChip compound={lapA.compound} color={COMPOUND_COLORS[lapA.compound] ?? '#888'} /></div>}
          </div>

          {/* Fark */}
          <div style={{ textAlign: 'center', minWidth: 150 }}>
            <p style={{ color: '#777', fontSize: 10, letterSpacing: '0.2em', margin: '0 0 4px', fontWeight: 700 }}>FARK</p>
            <p style={{ color: '#fff', fontSize: 26, fontWeight: 800, margin: 0, fontVariantNumeric: 'tabular-nums' }}>
              {gapSeconds === 0 ? '=' : '+'}{gap}s
            </p>
            <p style={{ color: TEAL, fontSize: 11, margin: '5px 0 0', fontWeight: 600 }}>→ {faster} daha hızlı</p>
          </div>

          {/* B */}
          <div style={{ textAlign: 'center', flex: 1 }}>
            <p style={{ color: COLOR_B, fontSize: 34, fontWeight: 800, margin: '0 0 4px', letterSpacing: '0.04em' }}>
              {driverB}{lapB?.is_personal_best ? ' ★' : ''}
            </p>
            <p style={{ color: gapSeconds > 0 ? TEAL : '#999', fontSize: 22, fontWeight: 700, margin: 0, fontVariantNumeric: 'tabular-nums' }}>
              {formatLapTime(durB)}
            </p>
            {lapB?.compound && <div style={{ marginTop: 8 }}><CompoundChip compound={lapB.compound} color={COMPOUND_COLORS[lapB.compound] ?? '#888'} /></div>}
          </div>
        </div>

        {/* Sektör fark barları */}
        <div style={{ background: '#121212', borderRadius: 12, padding: '16px 18px', border: '1px solid rgba(255,255,255,0.05)' }}>
          {/* Başlık satırı: pilot kodları sütun üstünde */}
          <div style={{ display: 'grid', gridTemplateColumns: COLS, columnGap: 12, marginBottom: 10 }}>
            <span />
            <span style={{ textAlign: 'right', color: COLOR_A, fontSize: 12, fontWeight: 800 }}>{driverA}</span>
            <span style={{ textAlign: 'center', color: '#555', fontSize: 10, letterSpacing: '0.15em', fontWeight: 700, lineHeight: '14px' }}>SEKTÖR FARKI</span>
            <span style={{ textAlign: 'left', color: COLOR_B, fontSize: 12, fontWeight: 800 }}>{driverB}</span>
          </div>

          {sectors.map((sec) => (
            <Row key={sec.num} label={`SEKTÖR ${sec.num}`} a={sec.a} b={sec.b} aWins={sec.aWins} frac={sec.frac} />
          ))}

          {/* Toplam tur */}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', marginTop: 8, paddingTop: 8 }}>
            <Row label="TOPLAM" a={durA} b={durB} aWins={totalAWins} frac={totalFrac} big />
          </div>
        </div>
      </CardShell>
    )
  }
)
ShareCard.displayName = 'ShareCard'
