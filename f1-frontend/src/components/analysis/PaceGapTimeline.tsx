/**
 * Pace Farkı Zaman Çizelgesi
 * Seçilen iki pilot arasındaki tur başına süre farkının eğrisi.
 * Bar < 0 → A daha hızlı, bar > 0 → B daha hızlı.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts'
import { client } from '../../api/client'
import { F1Loader } from '../ui/F1Loader'
import { formatLapTime } from '../../utils/format'
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
  sessionDrivers: string[]
  primaryDriver?: string
}

function CustomTooltip({ active, payload, label, dA, dB, tFn }: any) {
  if (!active || !payload?.length) return null
  const val = payload[0]?.value ?? 0
  const faster = val < 0 ? dA : dB
  const slower = val < 0 ? dB : dA
  return (
    <div className="rounded-xl border px-4 py-3 text-[12px] mono"
      style={{ background: 'rgba(5,8,15,0.97)', border: '1px solid rgba(255,255,255,0.1)',
               boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
      <p className="font-bold text-white mb-2">{tFn('pace_gap.lap', { n: label })}</p>
      <p style={{ color: val < 0 ? '#E10600' : '#FF8700' }}>
        <span className="font-bold">{faster}</span>
        <span style={{ color: 'rgba(240,244,255,0.55)' }}> {tFn('pace_gap.faster_by')} </span>
        <span className="font-bold">{formatLapTime(Math.abs(val))}</span>
      </p>
      <p className="text-[11px] mt-1" style={{ color: 'rgba(240,244,255,0.55)' }}>{slower} {tFn('pace_gap.slower')}</p>
    </div>
  )
}

export function PaceGapTimeline({ sessionId, sessionDrivers, primaryDriver }: Props) {
  const { t } = useTranslation()

  const defaultA = primaryDriver ?? sessionDrivers[0] ?? ''
  const defaultB = sessionDrivers.find(d => d !== defaultA) ?? sessionDrivers[1] ?? ''

  const [dA, setDA] = useState(defaultA)
  const [dB, setDB] = useState(defaultB)

  const { data: allLaps, isLoading } = useQuery<LapEntry[]>({
    queryKey: ['session-all-laps', sessionId],
    queryFn: () => client.get(`/sessions/${sessionId}/laps`).then(r => r.data),
    staleTime: Infinity,
    retry: 0,
  })

  if (isLoading) return (
    <div className="card p-8 flex justify-center items-center h-48">
      <F1Loader text="Pace verileri yükleniyor..." />
    </div>
  )
  if (!allLaps?.length || sessionDrivers.length < 2) return null

  // Her tur için A ve B'nin süresini bul
  const lapMap = new Map<number, { a?: number; b?: number }>()
  for (const lap of allLaps) {
    if (!lap.lap_time || !lap.driver_code) continue
    if (lap.is_pit_out_lap || lap.is_pit_in_lap) continue
    if (lap.driver_code !== dA && lap.driver_code !== dB) continue
    if (!lapMap.has(lap.lap_number)) lapMap.set(lap.lap_number, {})
    const entry = lapMap.get(lap.lap_number)!
    if (lap.driver_code === dA) entry.a = lap.lap_time
    if (lap.driver_code === dB) entry.b = lap.lap_time
  }

  // Fark verisi: negatif = A daha hızlı, pozitif = B daha hızlı
  const chartData = [...lapMap.entries()]
    .filter(([, v]) => v.a != null && v.b != null)
    .sort(([a], [b]) => a - b)
    .map(([lap, v]) => ({
      lap,
      gap: Math.round(((v.b! - v.a!) + Number.EPSILON) * 1000) / 1000,
    }))

  if (!chartData.length) return null

  const maxAbs = Math.max(...chartData.map(d => Math.abs(d.gap)), 0.1)
  const yDomain = [-maxAbs * 1.2, maxAbs * 1.2]

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--b1)' }}>
        <div className="flex items-center gap-3">
          <span className="text-xl">⏱</span>
          <div>
            <p className="text-[14px] font-bold text-white">{t('pace_gap.title')}</p>
            <p className="text-[11px] mono mt-0.5" style={{ color: 'var(--t3)' }}>{t('pace_gap.subtitle')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select value={dA} onChange={e => setDA(e.target.value)}
            className="px-3 py-1.5 rounded-lg text-[13px] font-black mono cursor-pointer"
            style={{ background: 'rgba(225,6,0,0.1)', border: '1px solid rgba(225,6,0,0.3)',
                     color: '#E10600', outline: 'none' }}>
            {sessionDrivers.filter(d => d !== dB).map(d => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <span className="text-[12px] font-black" style={{ color: 'var(--t3)' }}>vs</span>
          <select value={dB} onChange={e => setDB(e.target.value)}
            className="px-3 py-1.5 rounded-lg text-[13px] font-black mono cursor-pointer"
            style={{ background: 'rgba(255,135,0,0.1)', border: '1px solid rgba(255,135,0,0.3)',
                     color: '#FF8700', outline: 'none' }}>
            {sessionDrivers.filter(d => d !== dA).map(d => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="px-4 py-4">
      {/* Açıklama */}
      <div className="flex items-center gap-4 mb-3 text-[10px] mono" style={{ color: 'rgba(240,244,255,0.5)' }}>
        <span><span style={{ color: '#E10600' }}>▼</span> {dA} {t('pace_gap.faster')}</span>
        <span><span style={{ color: '#FF8700' }}>▲</span> {dB} {t('pace_gap.faster')}</span>
      </div>

      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
          barCategoryGap="20%">
          <CartesianGrid strokeDasharray="3 8" stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis
            dataKey="lap"
            tick={{ fill: 'rgba(240,244,255,0.55)', fontSize: 11, fontFamily: 'IBM Plex Mono,monospace' }}
            tickLine={false} axisLine={{ stroke: 'rgba(255,255,255,0.10)' }}
          />
          <YAxis
            domain={yDomain}
            tickFormatter={v => v === 0 ? '0' : `${v > 0 ? '+' : ''}${v.toFixed(2)}s`}
            tick={{ fill: 'rgba(240,244,255,0.55)', fontSize: 11, fontFamily: 'IBM Plex Mono,monospace' }}
            tickLine={false} axisLine={false}
            width={48}
          />
          <Tooltip content={<CustomTooltip dA={dA} dB={dB} tFn={t} />} />
          <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" strokeWidth={1} />
          <Bar dataKey="gap" radius={[2, 2, 0, 0]} maxBarSize={8} animationDuration={800}>
            {chartData.map((entry, idx) => (
              <Cell key={idx} fill={entry.gap < 0 ? '#E10600' : '#FF8700'} fillOpacity={0.85} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      </div>
    </div>
  )
}
