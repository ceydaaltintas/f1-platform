/**
 * Tur Süresi Sparkline
 * Sürücünün yarış/seans boyunca tur sürelerinin eğrisi.
 * Pit stop turları işaretlenir, karşılaştırma sürücüsü overlay olarak gösterilir.
 */
import { useQuery } from '@tanstack/react-query'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { client } from '../../api/client'
import { F1Loader } from '../ui/F1Loader'
import { formatLapTime } from '../../utils/format'
import { useTranslation } from 'react-i18next'

interface LapEntry {
  lap_number: number
  lap_time: number | null
  is_pit_out_lap?: boolean
  is_pit_in_lap?: boolean
  compound?: string
  is_personal_best?: boolean
}

interface Props {
  sessionId: number
  primaryDriver: string
  compareDriver?: string
  compareMode?: boolean
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border px-4 py-3 text-[12px] mono"
      style={{ background: 'rgba(5,8,15,0.97)', border: '1px solid rgba(255,255,255,0.1)',
               boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
      <p className="font-bold text-white mb-2">Lap {label}</p>
      {payload.map((p: any, i: number) => p.value && (
        <div key={i} className="flex justify-between gap-4">
          <span style={{ color: p.color }}>{p.name}</span>
          <span className="text-white font-bold">{formatLapTime(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

export function LapTimeSparkline({ sessionId, primaryDriver, compareDriver, compareMode }: Props) {
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
    <div className="card p-8 flex justify-center items-center h-40">
      <F1Loader text="Tur verileri yükleniyor..." />
    </div>
  )

  const laps = primaryQ.data ?? []
  if (!laps.length) return null

  // SC / VSC turlarını veya aşırı uzun turları filtrele (outlier)
  const validLaps = laps.filter(l => l.lap_time && l.lap_time > 0)
  if (!validLaps.length) return null

  // Use fastest lap as base to avoid median being skewed by out/slow laps
  const minTime = Math.min(...validLaps.map(l => l.lap_time!))
  const yMin = minTime * 0.97
  const yMax = minTime * 1.20

  // Karşılaştırma sürücüsü verisi
  const compareLaps = compareQ.data ?? []
  const compareMap: Record<number, number> = {}
  for (const l of compareLaps) {
    if (l.lap_number && l.lap_time) compareMap[l.lap_number] = l.lap_time
  }

  const chartData = laps
    .filter(l => l.lap_number != null && l.lap_time != null)
    .map(l => {
      const inRange = l.lap_time != null && l.lap_time >= yMin && l.lap_time <= yMax
      const cmpTime = compareMode && compareDriver ? (compareMap[l.lap_number] ?? null) : null
      const cmpInRange = cmpTime != null && cmpTime >= yMin && cmpTime <= yMax
      return {
        lap: l.lap_number,
        [primaryDriver]: inRange ? l.lap_time : null,
        ...(compareMode && compareDriver ? { [compareDriver]: cmpInRange ? cmpTime : null } : {}),
        isPit: l.is_pit_out_lap || l.is_pit_in_lap,
        isBest: l.is_personal_best,
      }
    })

  const pitLaps = chartData.filter(d => d.isPit).map(d => d.lap)

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--b1)' }}>
        <div className="flex items-center gap-3">
          <span className="text-xl">📈</span>
          <div>
            <p className="text-[14px] font-bold text-white">{t('lap_sparkline.title')}</p>
            <p className="text-[11px] mono mt-0.5" style={{ color: 'var(--t3)' }}>{t('lap_sparkline.subtitle')}</p>
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

      <div className="px-4 py-4">
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
          <defs>
            <linearGradient id="primaryGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#E10600" stopOpacity={0.18} />
              <stop offset="95%" stopColor="#E10600" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="compareGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#FF8700" stopOpacity={0.12} />
              <stop offset="95%" stopColor="#FF8700" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 8" stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis
            dataKey="lap"
            tick={{ fill: 'rgba(240,244,255,0.55)', fontSize: 11, fontFamily: 'IBM Plex Mono,monospace' }}
            tickLine={false} axisLine={{ stroke: 'rgba(255,255,255,0.10)' }}
          />
          <YAxis
            domain={[yMin, yMax]}
            tickFormatter={v => formatLapTime(v).slice(0, -1)}
            tick={{ fill: 'rgba(240,244,255,0.55)', fontSize: 11, fontFamily: 'IBM Plex Mono,monospace' }}
            tickLine={false} axisLine={false}
            width={52}
          />
          <Tooltip content={<CustomTooltip />} />

          {pitLaps.map(lap => (
            <ReferenceLine key={lap} x={lap} stroke="rgba(255,255,255,0.1)"
              strokeDasharray="3 3" />
          ))}

          {compareMode && compareDriver && (
            <Area
              type="monotone"
              dataKey={compareDriver}
              stroke="#FF8700"
              strokeWidth={1.5}
              fill="url(#compareGrad)"
              strokeDasharray="4 2"
              dot={false}
              activeDot={{ r: 3, fill: '#FF8700', stroke: '#05080f', strokeWidth: 2 }}
              connectNulls
              animationDuration={1200}
            />
          )}
          <Area
            type="monotone"
            dataKey={primaryDriver}
            stroke="#E10600"
            strokeWidth={2}
            fill="url(#primaryGrad)"
            dot={false}
            activeDot={{ r: 4, fill: '#E10600', stroke: '#05080f', strokeWidth: 2 }}
            connectNulls
            animationDuration={1000}
          />
        </AreaChart>
      </ResponsiveContainer>

      {pitLaps.length > 0 && (
        <p className="text-[11px] mono mt-2 text-center" style={{ color: 'var(--t3)' }}>
          {t('lap_sparkline.pit_note')}
        </p>
      )}
      </div>
    </div>
  )
}
