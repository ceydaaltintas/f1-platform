/**
 * Lastik Degradasyon Analizi
 * Lastik yaşı → tur süresi eğrisi, cliff noktası, hamur karşılaştırması
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { client } from '../../api/client'
import { formatLapTime } from '../../utils/format'
import { COMPOUND_COLORS } from '../../types/f1'

const COMPOUND_NAME: Record<string, string> = {
  SOFT: 'Yumuşak', MEDIUM: 'Orta', HARD: 'Sert',
  INTERMEDIATE: 'Ara', WET: 'Islak', UNKNOWN: '?',
}

interface Lap    { lap_number: number; tyre_age: number; lap_time: number; delta: number }
interface Stint  { stint_number: number; compound: string; tyre_age_start: number; laps: Lap[]; avg_time: number; best_time: number; degradation: number }
interface Driver { code: string; stints: Stint[] }

interface Props { sessionId: number }

// Degradasyon hızına göre renk
function degColor(deg: number): string {
  if (deg < 0.5)  return '#00D2BE'  // İyi
  if (deg < 1.5)  return '#FFD700'  // Orta
  return '#E10600'                   // Kötü
}

// Özel tooltip
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border px-4 py-3 text-[12px] mono"
      style={{ background:'rgba(5,8,15,0.97)', border:'1px solid rgba(255,255,255,0.1)',
               boxShadow:'0 8px 32px rgba(0,0,0,0.6)', minWidth: 180 }}>
      <p className="font-bold text-white mb-2">Lastik Yaşı: {label} tur</p>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex justify-between gap-4">
          <span style={{ color: p.color }}>{p.name}</span>
          <span className="text-white">{formatLapTime(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

export function TyreDegradation({ sessionId }: Props) {
  const [selectedDrivers, setSelectedDrivers] = useState<string[]>([])
  const [viewMode, setViewMode] = useState<'laptime' | 'delta'>('laptime')

  const { data, isLoading, isError } = useQuery({
    queryKey: ['tyre-deg', sessionId],
    queryFn:  () => client.get(`/sessions/${sessionId}/tyre_degradation`).then(r => r.data),
    staleTime: 3_600_000,
    retry: 1,
  })

  const drivers: Driver[] = data?.drivers ?? []

  // İlk 3 pilotu varsayılan seç
  const selected = selectedDrivers.length > 0
    ? selectedDrivers
    : drivers.slice(0, 3).map(d => d.code)

  // Seçili pilotların stintlerini birleştir → grafik verisi
  const chartData = (() => {
    const maxAge = Math.max(
      0,
      ...drivers
        .filter(d => selected.includes(d.code))
        .flatMap(d => d.stints.flatMap(s => s.laps.map(l => l.tyre_age)))
    )
    const points: any[] = []
    for (let age = 0; age <= maxAge; age++) {
      const pt: any = { age }
      let hasData = false
      for (const driver of drivers.filter(d => selected.includes(d.code))) {
        for (const stint of driver.stints) {
          const lap = stint.laps.find(l => l.tyre_age === age)
          if (lap) {
            const key = `${driver.code}_${stint.compound}`
            pt[key] = viewMode === 'laptime' ? lap.lap_time : lap.delta
            hasData = true
          }
        }
      }
      if (hasData) points.push(pt)
    }
    return points
  })()

  // Renk paleti
  const lines: { key: string; color: string; name: string }[] = drivers
    .filter(d => selected.includes(d.code))
    .flatMap(d => d.stints.map(s => ({
      key:   `${d.code}_${s.compound}`,
      color: COMPOUND_COLORS[s.compound] ?? '#888',
      name:  `${d.code} (${COMPOUND_NAME[s.compound] ?? s.compound})`,
    })))

  if (isLoading) return (
    <div className="card p-5 text-center">
      <p className="text-[12px] mono animate-pulse" style={{ color:'var(--t3)' }}>
        Lastik verisi yükleniyor...
      </p>
    </div>
  )

  if (isError || !drivers.length) return (
    <div className="card p-5 text-center">
      <p className="text-[12px] mono" style={{ color:'var(--t3)' }}>
        Bu oturum için lastik degradasyon verisi bulunamadı.
      </p>
    </div>
  )

  return (
    <div className="card overflow-hidden">
      {/* Başlık */}
      <div className="flex items-center justify-between px-5 py-4 border-b"
        style={{ borderColor:'var(--b1)' }}>
        <div className="flex items-center gap-3">
          <span className="text-xl">🏁</span>
          <div>
            <p className="text-[14px] font-bold text-white">Lastik Degradasyonu</p>
            <p className="text-[11px] mono mt-0.5" style={{ color:'var(--t3)' }}>
              Lastik yaşı arttıkça tur süresi nasıl değişiyor?
            </p>
          </div>
        </div>
        {/* Görünüm modu */}
        <div className="flex gap-1.5">
          {(['laptime','delta'] as const).map(m => (
            <button key={m} onClick={() => setViewMode(m)}
              className="px-3 py-1.5 rounded-lg text-[11px] mono font-semibold transition-all"
              style={viewMode===m
                ? { background:'#E10600', color:'white' }
                : { background:'var(--s2)', color:'var(--t3)', border:'1px solid var(--b1)' }}>
              {m==='laptime' ? 'Tur Süresi' : 'Delta (+s)'}
            </button>
          ))}
        </div>
      </div>

      {/* Pilot seçici */}
      <div className="px-5 py-3 border-b" style={{ borderColor:'var(--b1)' }}>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] mono font-semibold tracking-widest" style={{ color:'var(--t3)' }}>
            {drivers.length} PİLOT · seç/kaldır
          </p>
          <div className="flex gap-2">
            <button onClick={() => setSelectedDrivers(drivers.map(d => d.code))}
              className="text-[10px] mono px-2 py-1 rounded-lg transition-all"
              style={{ background:'var(--s2)', color:'var(--t3)', border:'1px solid var(--b1)' }}>
              Tümü
            </button>
            <button onClick={() => setSelectedDrivers([])}
              className="text-[10px] mono px-2 py-1 rounded-lg transition-all"
              style={{ background:'var(--s2)', color:'var(--t3)', border:'1px solid var(--b1)' }}>
              Temizle
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2" style={{ maxHeight: 88, overflowY: 'auto' }}>
          {drivers.map(d => (
            <button key={d.code}
              onClick={() => setSelectedDrivers(prev =>
                prev.includes(d.code)
                  ? prev.filter(c => c !== d.code)
                  : [...prev, d.code]
              )}
              className="px-2.5 py-1 rounded-lg text-[11px] mono font-bold transition-all shrink-0"
              style={selected.includes(d.code)
                ? { background:'rgba(225,6,0,0.15)', color:'#E10600', border:'1px solid rgba(225,6,0,0.3)' }
                : { background:'var(--s2)', color:'var(--t3)', border:'1px solid var(--b1)' }}>
              {d.code}
            </button>
          ))}
        </div>
      </div>

      {/* Grafik */}
      <div className="px-4 py-5">
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 8" stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis dataKey="age"
              label={{ value: 'Lastik Yaşı (tur)', position: 'insideBottom', offset: -4,
                       fill: 'rgba(240,244,255,0.55)', fontSize: 11 }}
              tick={{ fill:'rgba(240,244,255,0.55)', fontSize:11, fontFamily:'IBM Plex Mono,monospace' }}
              tickLine={false} axisLine={{ stroke:'rgba(255,255,255,0.10)' }} />
            <YAxis
              tickFormatter={v => viewMode==='laptime' ? formatLapTime(v) : `+${v.toFixed(1)}s`}
              tick={{ fill:'rgba(240,244,255,0.55)', fontSize:11, fontFamily:'IBM Plex Mono,monospace' }}
              tickLine={false} axisLine={false} width={75} />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              formatter={(v) => <span style={{ color:'rgba(240,244,255,0.75)', fontSize:12 }}>{v}</span>}
            />
            {viewMode === 'delta' && (
              <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" strokeDasharray="4 4" />
            )}
            {lines.map(l => (
              <Line key={l.key} type="monotone" dataKey={l.key} name={l.name}
                stroke={l.color} strokeWidth={2} dot={false}
                activeDot={{ r:4, fill:l.color, stroke:'#05080f', strokeWidth:2 }} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Özet tablo */}
      <div className="px-5 pb-5">
        <p className="text-[12px] mono font-semibold tracking-widest mb-3" style={{ color:'var(--t2)' }}>
          STINT ÖZETİ
        </p>
        <div className="overflow-x-auto">
          <table style={{ width:'100%', borderCollapse:'collapse', fontFamily:'IBM Plex Mono,monospace' }}>
            <thead>
              <tr style={{ borderBottom:'1px solid rgba(255,255,255,0.10)' }}>
                {['Pilot','Hamur','Süre','Avg Tur','En Hızlı','Degradasyon'].map(h => (
                  <th key={h} style={{ padding:'8px 10px', textAlign:'left', fontSize:11,
                    fontWeight:600, letterSpacing:'0.08em', color:'var(--t2)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {drivers.filter(d => selected.includes(d.code)).flatMap(d =>
                d.stints.map(s => (
                  <tr key={`${d.code}-${s.stint_number}`}
                    style={{ borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
                    <td style={{ padding:'10px 10px', fontWeight:900, color:'white', fontSize:13 }}>
                      {d.code}
                    </td>
                    <td style={{ padding:'10px 10px' }}>
                      <span style={{
                        padding:'3px 8px', borderRadius:4, fontSize:11, fontWeight:700,
                        background:(COMPOUND_COLORS[s.compound]??'#888')+'25',
                        color: COMPOUND_COLORS[s.compound]??'#888',
                        border:`1px solid ${(COMPOUND_COLORS[s.compound]??'#888')}50`,
                      }}>
                        {COMPOUND_NAME[s.compound] ?? s.compound}
                      </span>
                    </td>
                    <td style={{ padding:'10px 10px', color:'var(--t2)', fontSize:12 }}>
                      {s.laps.length} tur
                    </td>
                    <td style={{ padding:'10px 10px', color:'white', fontSize:13, fontWeight:700 }}>
                      {formatLapTime(s.avg_time)}
                    </td>
                    <td style={{ padding:'10px 10px', color:'#00D2BE', fontSize:13, fontWeight:700 }}>
                      {formatLapTime(s.best_time)}
                    </td>
                    <td style={{ padding:'10px 10px', fontWeight:700, fontSize:13,
                      color: degColor(s.degradation) }}>
                      +{s.degradation.toFixed(2)}s
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className="text-[12px] mono mt-3" style={{ color:'var(--t2)' }}>
          🟢 &lt;0.5s/stint = iyi &nbsp;·&nbsp;
          🟡 0.5–1.5s = orta &nbsp;·&nbsp;
          🔴 &gt;1.5s = yüksek yıpranma
        </p>
      </div>
    </div>
  )
}
