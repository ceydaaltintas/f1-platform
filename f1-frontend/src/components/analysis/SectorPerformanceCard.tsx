import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { client } from '../../api/client'
import { F1Loader } from '../ui/F1Loader'
import { useTranslation } from 'react-i18next'

interface LapEntry {
  lap_number: number
  lap_time: number | null
  sector1_time: number | null
  sector2_time: number | null
  sector3_time: number | null
  is_pit_out_lap?: boolean
  is_pit_in_lap?: boolean
}

interface SectorStats {
  best: number
  avg: number
  worst: number
  laps: number[]
}

interface Props {
  sessionId: number
  primaryDriver: string
  compareDriver?: string
  compareMode?: boolean
}

function computeSectorStats(laps: LapEntry[]) {
  const valid = laps.filter(l => !l.is_pit_out_lap && !l.is_pit_in_lap && l.lap_time)
  const s1s = valid.map(l => l.sector1_time).filter((v): v is number => v != null && v > 0)
  const s2s = valid.map(l => l.sector2_time).filter((v): v is number => v != null && v > 0)
  const s3s = valid.map(l => l.sector3_time).filter((v): v is number => v != null && v > 0)

  const stat = (arr: number[]): SectorStats | null => {
    if (!arr.length) return null
    const sorted = [...arr].sort((a, b) => a - b)
    return {
      best: sorted[0],
      avg: arr.reduce((s, v) => s + v, 0) / arr.length,
      worst: sorted[sorted.length - 1],
      laps: arr,
    }
  }

  return {
    s1: stat(s1s),
    s2: stat(s2s),
    s3: stat(s3s),
    theoreticalBest: s1s.length && s2s.length && s3s.length
      ? Math.min(...s1s) + Math.min(...s2s) + Math.min(...s3s)
      : null,
  }
}

function fmt(v: number) {
  const m = Math.floor(v / 60)
  const s = (v % 60).toFixed(3).padStart(6, '0')
  return m > 0 ? `${m}:${s}` : `${s}s`
}

interface SectorBarProps {
  label: string
  color: string
  primary: SectorStats | null
  compare: SectorStats | null
  compareLabel?: string
  primaryLabel: string
  globalBest: number
  globalWorst: number
  delay?: number
}

function SectorBar({ label, color, primary, compare, compareLabel, primaryLabel, globalBest, globalWorst, delay = 0 }: SectorBarProps) {
  const [go, setGo] = React.useState(false)
  const { t } = useTranslation()

  React.useEffect(() => {
    const timer = setTimeout(() => setGo(true), delay + 100)
    return () => clearTimeout(timer)
  }, [delay])

  if (!primary) return null

  const range = globalWorst - globalBest || 1
  const pct = (v: number) => Math.max(5, Math.min(100, ((globalWorst - v) / range) * 100))

  const primaryPct = pct(primary.best)
  const comparePct = compare ? pct(compare.best) : null

  // Filter avg to reasonable laps only (within 130% of best)
  const reasonableAvg = (laps: number[], best: number) => {
    const filtered = laps.filter(v => v <= best * 1.3)
    return filtered.length ? filtered.reduce((s, v) => s + v, 0) / filtered.length : primary.avg
  }

  const delta = compare ? primary.best - compare.best : null

  return (
    <div className="mb-5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[12px] mono font-black tracking-widest" style={{ color }}>{label}</span>
        <div className="flex items-center gap-3 text-[12px] mono">
          <span className="font-bold text-white">{fmt(primary.best)}</span>
          {compare && compareLabel && (
            <>
              <span className="text-[11px]" style={{ color: 'rgba(240,244,255,0.55)' }}>vs</span>
              <span className="font-bold" style={{ color: '#FF8700' }}>{fmt(compare.best)}</span>
              {delta !== null && (
                <span className="text-[10px] font-bold" style={{ color: delta < 0 ? '#E10600' : '#FF8700' }}>
                  {delta < 0 ? `${primaryLabel} -${Math.abs(delta).toFixed(3)}s` : `${compareLabel} -${Math.abs(delta).toFixed(3)}s`}
                </span>
              )}
            </>
          )}
        </div>
      </div>

      {/* Primary bar */}
      <div className="relative h-3 rounded-full mb-1.5 overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
        <div
          className="h-full rounded-full"
          style={{
            width: go ? `${primaryPct}%` : '0%',
            background: `linear-gradient(90deg, ${color}88, ${color})`,
            transition: `width 0.8s cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms`,
            boxShadow: `0 0 10px ${color}44`,
          }}
        />
      </div>

      {/* Compare bar */}
      {compare && comparePct !== null && (
        <div className="relative h-2 rounded-full mb-1.5 overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)' }}>
          <div
            className="h-full rounded-full"
            style={{
              width: go ? `${comparePct}%` : '0%',
              background: 'linear-gradient(90deg, #FF870066, #FF8700bb)',
              transition: `width 0.8s cubic-bezier(0.22, 1, 0.36, 1) ${delay + 80}ms`,
            }}
          />
        </div>
      )}

      {/* Avg */}
      <div className="flex items-center gap-3 text-[11px] mono" style={{ color: 'rgba(240,244,255,0.55)' }}>
        <span>{primaryLabel} {t('sector_perf.avg')} {fmt(reasonableAvg(primary.laps, primary.best))}</span>
        {compare && compareLabel && (
          <span>· {compareLabel} {t('sector_perf.avg')} {fmt(reasonableAvg(compare.laps, compare.best))}</span>
        )}
      </div>
    </div>
  )
}

export function SectorPerformanceCard({ sessionId, primaryDriver, compareDriver, compareMode }: Props) {
  const { t } = useTranslation()

  const primaryQ = useQuery<LapEntry[]>({
    queryKey: ['driver-laps', sessionId, primaryDriver],
    queryFn: () => client.get(`/sessions/${sessionId}/laps/${primaryDriver}`).then(r => r.data),
    staleTime: Infinity,
    retry: 0,
    enabled: !!primaryDriver,
  })

  const compareQ = useQuery<LapEntry[]>({
    queryKey: ['driver-laps', sessionId, compareDriver],
    queryFn: () => client.get(`/sessions/${sessionId}/laps/${compareDriver}`).then(r => r.data),
    staleTime: Infinity,
    retry: 0,
    enabled: !!compareDriver && !!compareMode,
  })

  if (primaryQ.isLoading) return (
    <div className="card p-8 flex justify-center items-center h-48">
      <F1Loader text={t('sector_perf.title')} />
    </div>
  )

  const primaryLaps = primaryQ.data ?? []
  if (!primaryLaps.length) return null

  const primary = computeSectorStats(primaryLaps)
  const compare = compareMode && compareQ.data ? computeSectorStats(compareQ.data) : null

  if (!primary.s1 && !primary.s2 && !primary.s3) return null

  // Global worst/best across both drivers for bar scale
  const allS1 = [primary.s1, compare?.s1].filter(Boolean).flatMap(s => s!.laps)
  const allS2 = [primary.s2, compare?.s2].filter(Boolean).flatMap(s => s!.laps)
  const allS3 = [primary.s3, compare?.s3].filter(Boolean).flatMap(s => s!.laps)

  const globalBest1 = Math.min(...allS1)
  const globalWorst1 = Math.max(...allS1)
  const globalBest2 = Math.min(...allS2)
  const globalWorst2 = Math.max(...allS2)
  const globalBest3 = Math.min(...allS3)
  const globalWorst3 = Math.max(...allS3)

  // Delta between theoretical bests
  const primaryTheo = primary.theoreticalBest
  const compareTheo = compare?.theoreticalBest ?? null
  const theoDelta = primaryTheo && compareTheo ? primaryTheo - compareTheo : null

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--b1)' }}>
        <div className="flex items-center gap-3">
          <span className="text-xl">⚡</span>
          <div>
            <p className="text-[14px] font-bold text-white">{t('sector_perf.title')}</p>
            <p className="text-[11px] mono mt-0.5" style={{ color: 'var(--t3)' }}>{t('sector_perf.subtitle')}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-[11px] mono">
            <span className="w-4 h-0.5 rounded inline-block" style={{ background: '#E10600' }} />
            <span style={{ color: 'var(--t2)' }}>{primaryDriver}</span>
          </span>
          {compareMode && compareDriver && (
            <span className="flex items-center gap-1.5 text-[11px] mono">
              <span className="w-4 h-0.5 rounded inline-block" style={{ background: '#FF8700' }} />
              <span style={{ color: 'var(--t2)' }}>{compareDriver}</span>
            </span>
          )}
        </div>
      </div>

      <div className="px-5 py-5">
      {/* Sector bars */}
      <SectorBar
        label="S1"
        color="#9B59B6"
        primary={primary.s1}
        compare={compare?.s1 ?? null}
        primaryLabel={primaryDriver}
        compareLabel={compareDriver}
        globalBest={globalBest1}
        globalWorst={globalWorst1}
        delay={0}
      />
      <SectorBar
        label="S2"
        color="#27AE60"
        primary={primary.s2}
        compare={compare?.s2 ?? null}
        primaryLabel={primaryDriver}
        compareLabel={compareDriver}
        globalBest={globalBest2}
        globalWorst={globalWorst2}
        delay={120}
      />
      <SectorBar
        label="S3"
        color="#E67E22"
        primary={primary.s3}
        compare={compare?.s3 ?? null}
        primaryLabel={primaryDriver}
        compareLabel={compareDriver}
        globalBest={globalBest3}
        globalWorst={globalWorst3}
        delay={240}
      />

      {/* Theoretical best */}
      {primaryTheo && (
        <div className="mt-4 pt-4 border-t flex items-center justify-between" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          <div>
            <p className="text-[11px] mono tracking-widest font-semibold" style={{ color: 'var(--t2)' }}>
              {t('sector_perf.theoretical')}
            </p>
            <p className="text-[20px] font-black mono mt-0.5" style={{ color: 'var(--t2)' }}>
              {fmt(primaryTheo)}
            </p>
          </div>
          {compareTheo && (
            <div className="text-right">
              <p className="text-[11px] mono tracking-widest font-semibold" style={{ color: 'var(--t2)' }}>
                {compareDriver}
              </p>
              <p className="text-[20px] font-black mono mt-0.5" style={{ color: '#FF8700' }}>
                {fmt(compareTheo)}
              </p>
              {theoDelta !== null && (
                <p className="text-[11px] mono mt-0.5" style={{ color: theoDelta < 0 ? '#E10600' : '#FF8700' }}>
                  {theoDelta < 0 ? `${primaryDriver} ` : `${compareDriver} `}
                  {Math.abs(theoDelta).toFixed(3)}s {t('pace_gap.faster')}
                </p>
              )}
            </div>
          )}
        </div>
      )}
      </div>
    </div>
  )
}
