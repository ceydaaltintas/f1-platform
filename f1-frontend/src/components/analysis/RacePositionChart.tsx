/**
 * Yarış Pozisyon Grafiği
 * Tüm sürücülerin kümülatif tur süresinden hesaplanan tahmini pozisyon eğrisi.
 * Karşılaştırma modunda ikinci sürücü de gösterilir.
 */
import { useQuery } from '@tanstack/react-query'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { client } from '../../api/client'
import { F1Loader } from '../ui/F1Loader'
import { useTranslation } from 'react-i18next'

interface LapEntry {
  driver_code: string
  lap_number: number
  lap_time: number | null
  is_pit_out_lap?: boolean
  is_pit_in_lap?: boolean
}

interface Props {
  sessionId: number
  primaryDriver: string
  compareDriver?: string
  sessionType?: string
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border px-4 py-3 text-[12px] mono"
      style={{ background: 'rgba(5,8,15,0.97)', border: '1px solid rgba(255,255,255,0.12)',
               boxShadow: '0 8px 32px rgba(0,0,0,0.6)', minWidth: 150 }}>
      <p className="font-bold text-white mb-2">Lap {label}</p>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex justify-between gap-4">
          <span style={{ color: p.color }}>{p.dataKey}</span>
          <span className="text-white font-bold">P{p.value}</span>
        </div>
      ))}
    </div>
  )
}

export function RacePositionChart({ sessionId, primaryDriver, compareDriver, sessionType }: Props) {
  const { t } = useTranslation()

  const { data, isLoading } = useQuery<LapEntry[]>({
    queryKey: ['session-all-laps', sessionId],
    queryFn: () => client.get(`/sessions/${sessionId}/laps`).then(r => r.data),
    staleTime: Infinity,
    retry: 0,
  })

  if (!['race', 'sprint'].includes(sessionType ?? '')) return null
  if (isLoading) return (
    <div className="card p-8 flex justify-center items-center h-48">
      <F1Loader text={t('race_position.loading')} />
    </div>
  )
  if (!data?.length) return null

  // Sürücü başına kümülatif tur süresi hesapla → sıralamadan pozisyon bul
  const cumTimes: Record<string, number> = {}
  const lapPositions: Record<string, number[]> = {}

  const allLapNums = [...new Set(data.map(l => l.lap_number))].sort((a, b) => a - b)
  const maxLap = allLapNums[allLapNums.length - 1] ?? 0

  for (const lapNum of allLapNums) {
    const thisLaps = data.filter(l => l.lap_number === lapNum)

    // Bu turda varolan sürücülerin kümülatif sürelerini güncelle
    for (const lap of thisLaps) {
      if (lap.lap_time && lap.driver_code) {
        cumTimes[lap.driver_code] = (cumTimes[lap.driver_code] ?? 0) + lap.lap_time
      }
    }

    // Şu ana kadar tur geçmiş tüm sürücüleri sırala
    const ranked = Object.entries(cumTimes)
      .sort(([, a], [, b]) => a - b)
      .map(([code], idx) => ({ code, pos: idx + 1 }))

    for (const { code, pos } of ranked) {
      if (!lapPositions[code]) lapPositions[code] = []
      lapPositions[code].push(pos)
    }
  }

  // Grafik verisi: her tur için primary + compare pozisyonu
  const chartData = allLapNums.map((lapNum, idx) => ({
    lap: lapNum,
    [primaryDriver]: lapPositions[primaryDriver]?.[idx] ?? null,
    ...(compareDriver ? { [compareDriver]: lapPositions[compareDriver]?.[idx] ?? null } : {}),
  })).filter(d => d[primaryDriver] != null)

  if (!chartData.length) return null

  const maxPos = Math.max(
    ...chartData.flatMap(d => [
      d[primaryDriver] as number,
      ...(compareDriver ? [d[compareDriver] as number] : []),
    ].filter(Boolean))
  )
  const yDomain = [1, Math.max(maxPos + 2, 10)]

  // Pit stop turlarını işaretle
  const pitLaps = data
    .filter(l => l.driver_code === primaryDriver && (l.is_pit_out_lap || l.is_pit_in_lap))
    .map(l => l.lap_number)

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--b1)' }}>
        <div className="flex items-center gap-3">
          <span className="text-xl">🏆</span>
          <div>
            <p className="text-[14px] font-bold text-white">{t('race_position.title')}</p>
            <p className="text-[11px] mono mt-0.5" style={{ color: 'var(--t3)' }}>{t('race_position.subtitle')}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-[11px] mono">
            <span className="w-4 h-0.5 rounded inline-block" style={{ background: '#E10600' }} />
            <span style={{ color: 'var(--t2)' }}>{primaryDriver}</span>
          </span>
          {compareDriver && (
            <span className="flex items-center gap-1.5 text-[11px] mono">
              <span className="w-4 h-0.5 rounded inline-block" style={{ background: '#FF8700' }} />
              <span style={{ color: 'var(--t2)' }}>{compareDriver}</span>
            </span>
          )}
        </div>
      </div>

      <div className="px-4 py-4">
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 8" stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis
            dataKey="lap"
            tick={{ fill: 'rgba(240,244,255,0.55)', fontSize: 11, fontFamily: 'IBM Plex Mono,monospace' }}
            tickLine={false}
            axisLine={{ stroke: 'rgba(255,255,255,0.10)' }}
            label={{ value: 'LAP', position: 'insideBottomRight', offset: -8,
                     fill: 'rgba(240,244,255,0.55)', fontSize: 11, fontFamily: 'IBM Plex Mono,monospace' }}
          />
          <YAxis
            reversed
            domain={yDomain}
            tickFormatter={v => `P${v}`}
            tick={{ fill: 'rgba(240,244,255,0.55)', fontSize: 11, fontFamily: 'IBM Plex Mono,monospace' }}
            tickLine={false}
            axisLine={false}
            width={32}
            ticks={[1, 5, 10, 15, 20].filter(t => t <= yDomain[1])}
          />
          <Tooltip content={<CustomTooltip />} />

          {/* Pit stop işaretçileri */}
          {pitLaps.map(lap => (
            <ReferenceLine key={lap} x={lap} stroke="rgba(255,255,255,0.12)"
              strokeDasharray="3 3" label={undefined} />
          ))}

          <Line
            type="monotone"
            dataKey={primaryDriver}
            stroke="#E10600"
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 4, fill: '#E10600', stroke: '#05080f', strokeWidth: 2 }}
            connectNulls
            animationDuration={1000}
          />
          {compareDriver && (
            <Line
              type="monotone"
              dataKey={compareDriver}
              stroke="#FF8700"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: '#FF8700', stroke: '#05080f', strokeWidth: 2 }}
              strokeDasharray="4 2"
              connectNulls
              animationDuration={1200}
            />
          )}
        </LineChart>
      </ResponsiveContainer>

      {pitLaps.length > 0 && (
        <p className="text-[11px] mono mt-2 text-center" style={{ color: 'var(--t3)' }}>
          {t('race_position.pit_note')}
        </p>
      )}
      </div>
    </div>
  )
}
