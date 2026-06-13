import { forwardRef } from 'react'
import type { TelemetryResponse } from '../../types/f1'

interface Props {
  sessionName: string       // "Monaco GP · Qualifying"
  driverA: string           // "VER"
  driverB: string           // "NOR"
  lapA: TelemetryResponse['lap']
  lapB: TelemetryResponse['lap']
  gapSeconds: number        // pozitif = A daha hızlı
}

export const ShareCard = forwardRef<HTMLDivElement, Props>(
  ({ sessionName, driverA, driverB, lapA, lapB, gapSeconds }, ref) => {
    const faster = gapSeconds <= 0 ? driverA : driverB
    const gap = Math.abs(gapSeconds).toFixed(3)

    return (
      <div
        ref={ref}
        style={{
          width: 600,
          height: 314,
          background: '#080808',
          fontFamily: "'IBM Plex Mono', monospace",
          padding: '28px 32px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          position: 'absolute',
          left: -9999,
          top: -9999,
        }}
      >
        {/* Üst: başlık */}
        <div>
          <p style={{ color: '#E10600', fontSize: 11, letterSpacing: '0.15em', margin: '0 0 6px' }}>
            HOTLAP.LIVE · F1 TELEMETRİ ANALİZİ
          </p>
          <p style={{ color: '#fff', fontSize: 20, fontWeight: 600, margin: 0 }}>{sessionName}</p>
        </div>

        {/* Orta: karşılaştırma */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          {/* Pilot A */}
          <div style={{ flex: 1, textAlign: 'center' }}>
            <p style={{ color: '#E10600', fontSize: 32, fontWeight: 600, margin: '0 0 4px' }}>{driverA}</p>
            <p style={{ color: gapSeconds <= 0 ? '#00D2BE' : '#888', fontSize: 18, margin: 0 }}>
              {lapA?.duration?.toFixed(3)}s
            </p>
            <p style={{ color: '#333', fontSize: 11, margin: '4px 0 0' }}>{lapA?.compound}</p>
          </div>

          {/* Fark */}
          <div style={{ textAlign: 'center', minWidth: 100 }}>
            <p style={{ color: '#222', fontSize: 11, letterSpacing: '0.1em', margin: '0 0 4px' }}>FARK</p>
            <p style={{ color: '#fff', fontSize: 22, fontWeight: 600, margin: 0 }}>+{gap}s</p>
            <p style={{ color: '#00D2BE', fontSize: 11, margin: '4px 0 0' }}>→ {faster} daha hızlı</p>
          </div>

          {/* Pilot B */}
          <div style={{ flex: 1, textAlign: 'center' }}>
            <p style={{ color: '#FF8700', fontSize: 32, fontWeight: 600, margin: '0 0 4px' }}>{driverB}</p>
            <p style={{ color: gapSeconds > 0 ? '#00D2BE' : '#888', fontSize: 18, margin: 0 }}>
              {lapB?.duration?.toFixed(3)}s
            </p>
            <p style={{ color: '#333', fontSize: 11, margin: '4px 0 0' }}>{lapB?.compound}</p>
          </div>
        </div>

        {/* Sektör deltas (varsa) */}
        <div style={{ display: 'flex', gap: 8 }}>
          {[1, 2, 3].map((s) => (
            <div key={s} style={{
              flex: 1, background: '#111', borderRadius: 6, padding: '8px 12px', textAlign: 'center'
            }}>
              <p style={{ color: '#333', fontSize: 10, margin: '0 0 4px' }}>SEKTÖR {s}</p>
              <p style={{ color: '#555', fontSize: 12, margin: 0 }}>—</p>
            </div>
          ))}
        </div>

        {/* Alt: filigran */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <p style={{ color: '#222', fontSize: 10, margin: 0 }}>hotlap.live</p>
          <p style={{ color: '#1a1a1a', fontSize: 10, margin: 0 }}>Gerçek F1 telemetri verisi · OpenF1</p>
        </div>
      </div>
    )
  }
)
ShareCard.displayName = 'ShareCard'
