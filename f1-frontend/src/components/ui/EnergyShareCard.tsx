import { forwardRef } from 'react'
import { CardShell, CompareBar, Battery, COLOR_A, COLOR_B, TEAL } from './shareCardKit'

interface Profile {
  aggression: number
  harvest_eff: number
  avg_deploy_kj: number
  avg_regen_kj: number
}

interface Props {
  sessionName: string
  driverA: string
  driverB: string
  profileA: Profile
  profileB: Profile
}

const COLS = '120px 88px 1fr 88px'

export const EnergyShareCard = forwardRef<HTMLDivElement, Props>(
  ({ sessionName, driverA, driverB, profileA, profileB }, ref) => {
    const moreAggressive = profileA.aggression >= profileB.aggression ? driverA : driverB
    const betterHarvest  = profileA.harvest_eff >= profileB.harvest_eff ? driverA : driverB

    const metrics = [
      { label: 'AGRESİFLİK', a: profileA.aggression, b: profileB.aggression, unit: '/100' },
      { label: 'DEPLOY / TUR', a: profileA.avg_deploy_kj, b: profileB.avg_deploy_kj, unit: ' kJ' },
      { label: 'REGEN / TUR', a: profileA.avg_regen_kj, b: profileB.avg_regen_kj, unit: ' kJ' },
    ]

    return (
      <CardShell ref={ref} height={620} sourceLabel="Tahmini · Throttle/Brake/Speed fizik modeli">
        {/* Başlık */}
        <div>
          <p style={{ color: COLOR_A, fontSize: 11, letterSpacing: '0.2em', margin: '0 0 6px', fontWeight: 700 }}>
            HOTLAP.LIVE · 2026 ENERJİ YÖNETİMİ
          </p>
          <p style={{ color: '#fff', fontSize: 22, fontWeight: 700, margin: 0 }}>{sessionName}</p>
        </div>

        {/* Pilot başlıkları */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <p style={{ color: COLOR_A, fontSize: 38, fontWeight: 800, margin: 0, letterSpacing: '0.05em' }}>{driverA}</p>
          <p style={{ color: '#444', fontSize: 16, fontWeight: 600, margin: 0 }}>vs</p>
          <p style={{ color: COLOR_B, fontSize: 38, fontWeight: 800, margin: 0, letterSpacing: '0.05em' }}>{driverB}</p>
        </div>

        {/* Harvest bataryası */}
        <div style={{ background: '#141414', borderRadius: 12, padding: '18px 20px', border: '1px solid rgba(255,255,255,0.05)' }}>
          <p style={{ color: '#999', fontSize: 12, letterSpacing: '0.15em', margin: '0 0 16px', fontWeight: 700, textAlign: 'center' }}>
            HARVEST VERİMLİLİĞİ
          </p>
          <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'flex-start' }}>
            <Battery pct={profileA.harvest_eff} color={COLOR_A} label={driverA} />
            <Battery pct={profileB.harvest_eff} color={COLOR_B} label={driverB} />
          </div>
        </div>

        {/* Karşılaştırma barları */}
        <div style={{ background: '#141414', borderRadius: 12, padding: '16px 20px', border: '1px solid rgba(255,255,255,0.05)' }}>
          {/* Başlık satırı */}
          <div style={{ display: 'grid', gridTemplateColumns: COLS, columnGap: 14, marginBottom: 12, alignItems: 'baseline' }}>
            <span />
            <span style={{ textAlign: 'right', color: COLOR_A, fontSize: 14, fontWeight: 800, lineHeight: 1 }}>{driverA}</span>
            <span style={{ textAlign: 'center', color: '#555', fontSize: 10, letterSpacing: '0.12em', fontWeight: 700, lineHeight: 1 }}>FARK</span>
            <span style={{ textAlign: 'left', color: COLOR_B, fontSize: 14, fontWeight: 800, lineHeight: 1 }}>{driverB}</span>
          </div>

          {metrics.map((m) => {
            const aWins = m.a >= m.b
            const frac = Math.max(m.a, m.b) > 0 ? Math.abs(m.a - m.b) / Math.max(m.a, m.b) : 0
            return (
              <div key={m.label} style={{ display: 'grid', gridTemplateColumns: COLS, columnGap: 14, alignItems: 'center', padding: '9px 0' }}>
                <span style={{ color: '#aaa', fontSize: 12, fontWeight: 600, lineHeight: 1 }}>{m.label}</span>
                <span style={{ textAlign: 'right', fontSize: 15, fontWeight: aWins ? 700 : 500, color: aWins ? TEAL : '#999', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                  {m.a}{m.unit}
                </span>
                <CompareBar frac={frac} aWins={aWins} />
                <span style={{ textAlign: 'left', fontSize: 15, fontWeight: !aWins ? 700 : 500, color: !aWins ? TEAL : '#999', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                  {m.b}{m.unit}
                </span>
              </div>
            )
          })}
        </div>

        {/* Sonuç özeti */}
        <div style={{ display: 'flex', gap: 14 }}>
          <div style={{ flex: 1, background: '#141414', borderRadius: 10, padding: '12px 16px', textAlign: 'center', border: '1px solid rgba(255,255,255,0.05)' }}>
            <p style={{ color: '#777', fontSize: 10, margin: '0 0 6px', letterSpacing: '0.1em', fontWeight: 700 }}>EN AGRESİF</p>
            <p style={{ color: TEAL, fontSize: 18, fontWeight: 800, margin: 0 }}>{moreAggressive}</p>
          </div>
          <div style={{ flex: 1, background: '#141414', borderRadius: 10, padding: '12px 16px', textAlign: 'center', border: '1px solid rgba(255,255,255,0.05)' }}>
            <p style={{ color: '#777', fontSize: 10, margin: '0 0 6px', letterSpacing: '0.1em', fontWeight: 700 }}>EN İYİ HARVEST</p>
            <p style={{ color: TEAL, fontSize: 18, fontWeight: 800, margin: 0 }}>{betterHarvest}</p>
          </div>
        </div>
      </CardShell>
    )
  }
)
EnergyShareCard.displayName = 'EnergyShareCard'
