/**
 * Sürücü Yarış Özeti
 * Pit stop zamanlaması, lastik stratejisi ve stint başına performans.
 */

import { useQuery } from '@tanstack/react-query'
import { client } from '../../api/client'
import { ErrorCard } from '../ui/ErrorCard'
import { formatLapTime } from '../../utils/format'
import { COMPOUND_COLORS } from '../../types/f1'

interface Stint {
  stint_number: number
  compound: string
  lap_start: number
  lap_end: number
  laps: number
  tyre_age_start: number
  avg_lap_time: number | null
  fastest_lap_time: number | null
}

interface Summary {
  driver_code: string
  session_type: string
  pit_count: number
  pit_laps: number[]
  stints: Stint[]
  total_laps: number
  fastest_lap: number | null
}

const COMPOUND_TR: Record<string, string> = {
  SOFT: 'Yumuşak', MEDIUM: 'Orta', HARD: 'Sert',
  INTERMEDIATE: 'Ara', WET: 'Islak', UNKNOWN: '?',
}

const RACE_TYPES = ['race', 'sprint']

interface Props {
  sessionId: number
  driverCode: string
  sessionType?: string
}

export function DriverRaceSummary({ sessionId, driverCode, sessionType }: Props) {
  // Sadece yarış/sprint oturumlarında göster
  if (sessionType && !RACE_TYPES.includes(sessionType)) return null

  const { data, isLoading, isError } = useQuery<Summary>({
    queryKey: ['driver-summary', sessionId, driverCode],
    queryFn:  () => client.get(`/sessions/${sessionId}/driver_summary/${driverCode}`).then(r => r.data),
    staleTime: 600_000,
    enabled:  !!sessionId && !!driverCode,
  })

  if (isLoading) return (
    <div className="card p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-6 h-6 rounded-full bg-[#E10600] flex items-center justify-center text-[10px] font-black text-white">
          {driverCode.slice(0,1)}
        </div>
        <p className="text-[11px] mono font-semibold tracking-widest" style={{ color:'var(--t3)' }}>
          YARIŞ ÖZETİ YÜKLENİYOR...
        </p>
      </div>
      <div className="space-y-2">
        {[1,2,3].map(i => <div key={i} className="h-16 rounded-xl animate-pulse" style={{ background:'var(--s2)' }} />)}
      </div>
    </div>
  )

  if (isError) return (
    <ErrorCard compact
      title="Yarış özeti yüklenemedi"
      message="OpenF1'den stint verisi alınamadı."
      onRetry={() => window.location.reload()}
    />
  )
  if (!data || data.stints.length === 0) return null

  const totalLaps = data.total_laps || data.stints.at(-1)?.lap_end || 0

  return (
    <div className="card overflow-hidden">
      {/* ── Header ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b"
        style={{ borderColor:'var(--b1)' }}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full flex items-center justify-center font-black text-[12px]"
            style={{ background:'rgba(225,6,0,0.15)', color:'#E10600', border:'1px solid rgba(225,6,0,0.25)' }}>
            {driverCode}
          </div>
          <div>
            <p className="text-[13px] font-bold text-white leading-none">Yarış Özeti</p>
            <p className="text-[10px] mono mt-0.5" style={{ color:'var(--t3)' }}>
              Pit stop stratejisi & stint analizi
            </p>
          </div>
        </div>

        {/* Pit stop sayacı */}
        <div className="flex items-center gap-2">
          <div className="text-center px-3 py-1.5 rounded-lg"
            style={{ background:'rgba(255,135,0,0.1)', border:'1px solid rgba(255,135,0,0.2)' }}>
            <p className="text-[20px] font-black mono" style={{ color:'#FF8700' }}>
              {data.pit_count}
            </p>
            <p className="text-[9px] mono" style={{ color:'rgba(255,135,0,0.7)' }}>PIT STOP</p>
          </div>
          {data.fastest_lap && (
            <div className="text-center px-3 py-1.5 rounded-lg"
              style={{ background:'rgba(192,84,252,0.1)', border:'1px solid rgba(192,84,252,0.2)' }}>
              <p className="text-[14px] font-black mono" style={{ color:'#c084fc' }}>
                {formatLapTime(data.fastest_lap)}
              </p>
              <p className="text-[9px] mono" style={{ color:'rgba(192,84,252,0.7)' }}>EN HIZLI TUR</p>
            </div>
          )}
        </div>
      </div>

      <div className="p-5 space-y-5">

        {/* ── Yarış Zaman Çizelgesi ─────────────────────────────── */}
        {totalLaps > 0 && (
          <div>
            <p className="text-[10px] mono font-semibold tracking-widest mb-2" style={{ color:'var(--t3)' }}>
              YARIŞIN TAMAMI ({totalLaps} TUR)
            </p>
            <div className="flex h-8 rounded-xl overflow-hidden gap-px w-full">
              {data.stints.map((st, i) => {
                const pct   = (st.laps / totalLaps) * 100
                const color = COMPOUND_COLORS[st.compound] ?? '#888'
                return (
                  <div key={i}
                    className="relative flex flex-col items-center justify-center"
                    style={{
                      width: `${pct}%`, minWidth: 14,
                      background: color + '22',
                      borderTop: `3px solid ${color}`,
                    }}
                    title={`${COMPOUND_TR[st.compound] ?? st.compound} · Tur ${st.lap_start}–${st.lap_end}`}>
                    {pct > 8 && (
                      <span className="text-[9px] font-black mono" style={{ color }}>
                        {st.compound[0]}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
            {/* Pit turları işaretleri */}
            {data.pit_laps.length > 0 && (
              <div className="flex gap-2 mt-2 flex-wrap">
                {data.pit_laps.map((pl, i) => (
                  <span key={i} className="text-[10px] mono px-2 py-0.5 rounded"
                    style={{ background:'rgba(255,135,0,0.1)', color:'#FF8700',
                             border:'1px solid rgba(255,135,0,0.2)' }}>
                    🔧 Tur {pl}'de pit
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Stint Detayları ───────────────────────────────────── */}
        <div>
          <p className="text-[10px] mono font-semibold tracking-widest mb-3" style={{ color:'var(--t3)' }}>
            STINT DETAYLARI
          </p>
          <div className="space-y-2.5">
            {data.stints.map((st, i) => {
              const color    = COMPOUND_COLORS[st.compound] ?? '#888'
              const isFastest = data.fastest_lap != null && st.fastest_lap_time === data.fastest_lap

              return (
                <div key={i} className="rounded-xl border p-4"
                  style={{ background:'var(--s2)', borderColor:'var(--b1)' }}>
                  <div className="flex items-start justify-between gap-3">

                    {/* Sol: compound + tur aralığı */}
                    <div className="flex items-center gap-3 min-w-0">
                      {/* Büyük compound harfi */}
                      <div className="w-11 h-11 rounded-xl flex flex-col items-center justify-center shrink-0"
                        style={{ background: color + '18', border: `2px solid ${color}40` }}>
                        <span className="text-[18px] font-black mono leading-none" style={{ color }}>
                          {st.compound[0]}
                        </span>
                        <span className="text-[7px] mono font-semibold" style={{ color: color + 'aa' }}>
                          {COMPOUND_TR[st.compound]?.split('').slice(0,3).join('') ?? st.compound.slice(0,3)}
                        </span>
                      </div>

                      <div>
                        <div className="flex items-center gap-2 mb-0.5">
                          <p className="text-[13px] font-bold text-white">
                            {COMPOUND_TR[st.compound] ?? st.compound}
                          </p>
                          {st.tyre_age_start > 0 && (
                            <span className="text-[10px] mono px-1.5 py-0.5 rounded"
                              style={{ background: color + '15', color: color + 'cc' }}>
                              {st.tyre_age_start} tur eski
                            </span>
                          )}
                          {isFastest && (
                            <span className="text-[10px] mono px-1.5 py-0.5 rounded"
                              style={{ background:'rgba(192,84,252,0.12)', color:'#c084fc',
                                       border:'1px solid rgba(192,84,252,0.25)' }}>
                              ⚡ En hızlı tur
                            </span>
                          )}
                        </div>
                        <p className="text-[12px] mono" style={{ color:'var(--t2)' }}>
                          Tur {st.lap_start} → {st.lap_end}
                          <span className="ml-2" style={{ color:'var(--t3)' }}>
                            ({st.laps} tur)
                          </span>
                          {i < data.stints.length - 1 && data.pit_laps[i] && (
                            <span className="ml-2 text-[#FF8700]">
                              → Tur {data.pit_laps[i]}'de pit
                            </span>
                          )}
                        </p>
                      </div>
                    </div>

                    {/* Sağ: tur süreleri */}
                    <div className="text-right shrink-0">
                      {st.avg_lap_time && (
                        <div className="mb-1">
                          <p className="text-[9px] mono" style={{ color:'var(--t3)' }}>ORT. TUR</p>
                          <p className="text-[14px] font-black mono text-white">
                            {formatLapTime(st.avg_lap_time)}
                          </p>
                        </div>
                      )}
                      {st.fastest_lap_time && (
                        <div>
                          <p className="text-[9px] mono" style={{ color:'var(--t3)' }}>EN HIZLI</p>
                          <p className="text-[12px] font-bold mono"
                            style={{ color: isFastest ? '#c084fc' : 'var(--t2)' }}>
                            {formatLapTime(st.fastest_lap_time)}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Degradasyon göstergesi */}
                  {st.avg_lap_time && st.fastest_lap_time && (
                    <div className="mt-2.5 pt-2.5 border-t" style={{ borderColor:'rgba(255,255,255,0.06)' }}>
                      <div className="flex items-center justify-between text-[10px] mono">
                        <span style={{ color:'var(--t3)' }}>Lastik degradasyonu</span>
                        <span style={{ color: st.avg_lap_time - st.fastest_lap_time > 1.5 ? '#f87171' : 'var(--t2)' }}>
                          +{(st.avg_lap_time - st.fastest_lap_time).toFixed(2)}s ort. kayıp
                        </span>
                      </div>
                      <div className="h-1 rounded-full mt-1 overflow-hidden"
                        style={{ background:'rgba(255,255,255,0.06)' }}>
                        <div className="h-1 rounded-full"
                          style={{
                            width: `${Math.min(100, (st.avg_lap_time - st.fastest_lap_time) / 3 * 100)}%`,
                            background: st.avg_lap_time - st.fastest_lap_time > 1.5
                              ? '#f87171' : 'rgba(0,210,190,0.7)',
                          }} />
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
