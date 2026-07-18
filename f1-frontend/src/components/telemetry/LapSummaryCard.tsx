import { useEffect, useState } from 'react'
import { aiApi } from '../../api/client'
import { formatLapTime, formatSectorTime } from '../../utils/format'
import { COMPOUND_COLORS } from '../../types/f1'
import type { LapInfo, KeyMoment, InsightMode } from '../../types/f1'
import { useTranslation } from 'react-i18next'

interface Props {
  lap: LapInfo | null
  keyMoments: KeyMoment[]
  mode: InsightMode
  driverCode: string
  compareLap?: LapInfo | null
  compareDriver?: string
  /** Stintlerden gelen lastik bileşiği (lap.compound null olabilir) */
  tyreCompound?: string | null
  tyreAge?: number | null
}

type State = { kind: 'idle' } | { kind: 'loading' } | { kind: 'ok'; text: string } | { kind: 'error' }

export function LapSummaryCard({
  lap, keyMoments, mode, driverCode,
  compareLap, compareDriver,
  tyreCompound, tyreAge,
}: Props) {
  const { t } = useTranslation()
  const [state, setState] = useState<State>({ kind: 'idle' })

  // Tur, mod veya pilot değişince analizi yeniden üret
  useEffect(() => {
    if (!lap?.duration) { setState({ kind: 'idle' }); return }

    let cancelled = false
    setState({ kind: 'loading' })

    // Lastik bilgisini lap_info'ya ekle (backend'de None görünmesin)
    const lapWithCompound = {
      ...lap,
      compound: tyreCompound ?? lap.compound ?? t('compounds.UNKNOWN'),
    }

    aiApi.lapSummary(lapWithCompound as any, keyMoments, mode)
      .then(r => { if (!cancelled) setState({ kind: 'ok', text: r.summary }) })
      .catch(() => { if (!cancelled) setState({ kind: 'error' }) })

    return () => { cancelled = true }
  // driverCode ve tyreCompound da tetikleyici
  }, [lap?.number, lap?.duration, mode, driverCode, tyreCompound])

  if (!lap) return null

  // Lastik: önce prop'tan, sonra lap'tan, sonra "Bilinmiyor"
  const compound  = tyreCompound ?? lap.compound ?? null
  const compColor = compound ? (COMPOUND_COLORS[compound] ?? '#888') : null

  return (
    <div className="card overflow-hidden">
      {/* ── Header ───────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 py-3 border-b"
        style={{ borderColor: 'var(--b1)' }}>
        <div className="flex items-center gap-3">
          <p className="text-[11px] mono font-semibold tracking-widest" style={{ color: 'var(--t3)' }}>
            {t('lap_summary.title')}
          </p>
          {state.kind === 'loading' && (
            <div className="flex gap-1">
              {[0,1,2].map(i => (
                <span key={i} className="w-1.5 h-1.5 rounded-full bg-[#E10600]"
                  style={{ animation: `bounce-dot 0.8s ${i*0.15}s infinite` }} />
              ))}
            </div>
          )}
        </div>

        {/* Lastik rozeti */}
        {compound && compColor ? (
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full" style={{ background: compColor }} />
            <span className="text-[12px] mono font-bold" style={{ color: compColor }}>
              {t(`compounds.${compound}`, compound)}
            </span>
            {tyreAge != null && tyreAge > 0 && (
              <span className="text-[11px] mono px-2 py-0.5 rounded"
                style={{ background: compColor + '15', color: compColor,
                         border: `1px solid ${compColor}30` }}>
                {t('strategy_sim.tyre_age_laps', { n: tyreAge })}
              </span>
            )}
          </div>
        ) : (
          <span className="text-[11px] mono" style={{ color: 'var(--t3)' }}>
            {t('compounds.UNKNOWN')}
          </span>
        )}
      </div>

      {/* ── Tur süreleri ─────────────────────────────────────── */}
      <div className="flex flex-wrap gap-6 px-5 py-4 border-b" style={{ borderColor: 'var(--b1)' }}>
        {/* Primary */}
        <div>
          <p className="text-[11px] mono font-bold mb-1.5" style={{ color: '#E10600' }}>
            {driverCode}
          </p>
          <p className="text-[26px] font-black mono text-white leading-none tracking-tight">
            {formatLapTime(lap.duration)}
          </p>
          <div className="flex gap-4 mt-2">
            {([lap.sector1, lap.sector2, lap.sector3] as (number|null)[]).map((s, i) => (
              <div key={i}>
                <p className="text-[9px] mono mb-0.5" style={{ color: 'var(--t3)' }}>S{i+1}</p>
                <p className="text-[13px] font-bold mono" style={{ color: 'var(--t2)' }}>
                  {formatSectorTime(s)}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Compare */}
        {compareLap && compareDriver && (
          <>
            <div className="w-px" style={{ background: 'var(--b1)', alignSelf: 'stretch' }} />
            <div>
              <p className="text-[11px] mono font-bold mb-1.5" style={{ color: '#FF8700' }}>
                {compareDriver}
              </p>
              <p className="text-[26px] font-black mono leading-none tracking-tight"
                style={{ color: '#FF8700' }}>
                {formatLapTime(compareLap.duration)}
              </p>
              <div className="flex gap-4 mt-2">
                {([compareLap.sector1, compareLap.sector2, compareLap.sector3] as (number|null)[]).map((s, i) => {
                  const base = ([lap.sector1, lap.sector2, lap.sector3] as (number|null)[])[i]
                  const diff = (s ?? 0) - (base ?? 0)
                  const dcol = diff < -0.01 ? '#00D2BE' : diff > 0.01 ? '#E10600' : 'var(--t2)'
                  return (
                    <div key={i}>
                      <p className="text-[9px] mono mb-0.5" style={{ color: 'var(--t3)' }}>S{i+1}</p>
                      <p className="text-[13px] font-bold mono" style={{ color: 'var(--t2)' }}>
                        {formatSectorTime(s)}
                      </p>
                      {Math.abs(diff) > 0.01 && (
                        <p className="text-[10px] mono font-bold" style={{ color: dcol }}>
                          {diff > 0 ? '+' : '−'}{formatSectorTime(Math.abs(diff))}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
              {lap.duration != null && compareLap.duration != null && (
                <p className="text-[12px] mono font-bold mt-2"
                  style={{ color: compareLap.duration < lap.duration ? '#00D2BE' : '#E10600' }}>
                  {compareLap.duration < lap.duration ? '▲ ' : '▼ '}
                  {formatLapTime(Math.abs(compareLap.duration - lap.duration))}
                </p>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── AI Genel Analiz ──────────────────────────────────── */}
      <div className="px-5 py-4">
        {state.kind === 'loading' && (
          <div className="space-y-2">
            {[90, 65, 80].map((w, i) => (
              <div key={i} className="h-2.5 rounded-full animate-pulse"
                style={{ width: `${w}%`, background: 'rgba(225,6,0,0.08)' }} />
            ))}
            <p className="text-[11px] mono" style={{ color: 'var(--t3)' }}>
              {t('ai.loading')}
            </p>
          </div>
        )}
        {state.kind === 'ok' && (
          <p className="text-[13px] leading-relaxed" style={{ color: 'rgba(240,244,255,0.82)' }}>
            {state.text}
          </p>
        )}
        {state.kind === 'error' && (
          <p className="text-[12px]" style={{ color: 'var(--t3)' }}>
            {t('lap_summary.error')}
          </p>
        )}
        {state.kind === 'idle' && (
          <p className="text-[12px] italic" style={{ color: 'var(--t3)' }}>
            {t('lap_summary.loading')}
          </p>
        )}
      </div>

      <style>{`
        @keyframes bounce-dot {
          0%,80%,100% { transform:translateY(0) }
          40%         { transform:translateY(-5px) }
        }
      `}</style>
    </div>
  )
}
