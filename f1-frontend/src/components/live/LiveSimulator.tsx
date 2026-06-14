/**
 * Canlı Yarış Simülatörü
 * - Yakalama tahmini: X pilot Y'yi kaç turda yakalar?
 * - Pit senaryosu: Şu an pit girerse hangi sırada çıkar?
 * - Optimal pit penceresi: Arkadaki araçtan kaçmak güvenli mi?
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { client } from '../../api/client'

interface Props {
  sessionId: number
  drivers: string[]          // mevcut pilotlar (dropdown için)
  defaultDriver?: string
  disabled?: boolean         // yarış bittiyse true
}

export function LiveSimulator({ sessionId, drivers, defaultDriver = '', disabled = false }: Props) {
  const [selectedDriver, setSelectedDriver] = useState(defaultDriver)
  const [enabled, setEnabled] = useState(false)

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['live-sim', sessionId, selectedDriver],
    queryFn:  () =>
      client.get(`/live/${sessionId}/simulate?driver_code=${selectedDriver}`)
        .then(r => r.data),
    enabled:  enabled && !!selectedDriver && !disabled,
    staleTime: 10_000,
    refetchInterval: enabled && !disabled ? 15_000 : false,
  })

  const runSim = () => {
    if (!selectedDriver || disabled) return
    setEnabled(true)
    setTimeout(() => refetch(), 50)
  }

  return (
    <div className="card overflow-hidden">
      {/* Başlık */}
      <div className="flex items-center gap-3 px-5 py-3.5 border-b"
        style={{ borderColor: 'var(--b1)' }}>
        <span className="text-xl">🔮</span>
        <div>
          <p className="text-[13px] font-bold text-white leading-none">Canlı Simülasyon</p>
          <p className="text-[10px] mono mt-0.5" style={{ color: 'var(--t3)' }}>
            Yakalama · Pit senaryosu · Optimal pit penceresi
          </p>
        </div>
        {enabled && isFetching && (
          <span className="w-2 h-2 rounded-full bg-[#E10600] animate-pulse ml-auto" />
        )}
      </div>

      <div className="p-4 space-y-4">
        {disabled && (
          <div className="rounded-xl p-3 text-center"
            style={{ background:'rgba(255,255,255,0.04)', border:'1px solid var(--b1)' }}>
            <p className="text-[12px]" style={{ color:'var(--t3)' }}>
              🏁 Yarış bitti — canlı simülasyon artık çalıştırılamaz.
            </p>
          </div>
        )}
        {/* Pilot seçici + Simüle Et */}
        <div className="flex gap-3">
          <select
            value={selectedDriver}
            onChange={e => { setSelectedDriver(e.target.value); setEnabled(false) }}
            disabled={disabled}
            className="flex-1 px-3 py-2.5 rounded-xl text-[13px] font-bold mono cursor-pointer disabled:opacity-40"
            style={{
              background: 'var(--s2)', border: '1px solid var(--b1)',
              color: selectedDriver ? '#E10600' : 'var(--t3)', outline: 'none',
            }}
          >
            <option value="">Pilot seç...</option>
            {drivers.map(d => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <button
            onClick={runSim}
            disabled={!selectedDriver || isLoading || disabled}
            className="px-4 py-2.5 rounded-xl text-[12px] font-bold transition-all disabled:opacity-40"
            style={{ background: '#E10600', color: 'white' }}>
            {isLoading ? '⏳' : '▶ Simüle Et'}
          </button>
        </div>

        {/* Sonuçlar */}
        {data?.retired && (
          <div className="rounded-xl p-4 text-center"
            style={{ background:'rgba(255,255,255,0.04)', border:'1px solid var(--b1)' }}>
            <p className="text-xl mb-1">🏁</p>
            <p className="text-[13px] font-semibold" style={{ color:'var(--t2)' }}>
              {data.message}
            </p>
          </div>
        )}

        {data?.lapped && (
          <div className="rounded-xl p-4 text-center"
            style={{ background:'rgba(255,135,0,0.08)', border:'1px solid rgba(255,135,0,0.25)' }}>
            <p className="text-xl mb-1">🔄</p>
            <p className="text-[13px] font-semibold" style={{ color:'#FF8700' }}>
              {data.message}
            </p>
            <p className="text-[11px] mt-1" style={{ color:'var(--t3)' }}>
              Tur gerisindeki pilotlar için simülasyon yapılamaz.
            </p>
          </div>
        )}

        {data && !data.lapped && !data.retired && (
          <div className="space-y-3">
            {/* Mevcut durum */}
            <div className="flex items-center gap-4 px-4 py-3 rounded-xl"
              style={{ background: 'var(--s2)', border: '1px solid var(--b1)' }}>
              <div>
                <p className="text-[10px] mono" style={{ color: 'var(--t3)' }}>POZİSYON</p>
                <p className="text-[22px] font-black mono" style={{ color: '#E10600' }}>
                  P{data.current_position}
                </p>
              </div>
              <div className="w-px h-10 self-stretch" style={{ background: 'var(--b1)' }} />
              <div>
                <p className="text-[10px] mono" style={{ color: 'var(--t3)' }}>ORT. PACE</p>
                <p className="text-[16px] font-black mono text-white">
                  {data.avg_pace ? `${data.avg_pace.toFixed(3)}s` : '—'}
                </p>
              </div>
              <div className="w-px h-10 self-stretch" style={{ background: 'var(--b1)' }} />
              <div>
                <p className="text-[10px] mono" style={{ color: 'var(--t3)' }}>LİDERE FARK</p>
                <p className="text-[16px] font-black mono text-white">
                  {data.current_gap > 0 ? `+${data.current_gap.toFixed(1)}s` : 'LDR'}
                </p>
              </div>
            </div>

            {/* Pit Senaryosu */}
            <div className="rounded-xl overflow-hidden border"
              style={{ borderColor: 'rgba(255,135,0,0.3)', background: 'rgba(255,135,0,0.05)' }}>
              <div className="px-4 py-2.5 border-b flex items-center gap-2"
                style={{ borderColor: 'rgba(255,135,0,0.2)' }}>
                <span>🔧</span>
                <p className="text-[12px] font-bold" style={{ color: '#FF8700' }}>
                  Şu An Pit Girerse
                </p>
              </div>
              <div className="px-4 py-3 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[12px]" style={{ color: 'var(--t2)' }}>Tahmini çıkış pozisyonu</span>
                  <span className="text-[20px] font-black mono" style={{ color: '#FF8700' }}>
                    P{data.pit_scenario.position_after_pit}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span style={{ color: 'var(--t3)' }}>Pit kaybı tahmini</span>
                  <span className="mono font-bold" style={{ color: 'var(--t2)' }}>~{data.pit_loss_estimate}s</span>
                </div>
                {data.pit_scenario.cars_overtaken.length > 0 && (
                  <div>
                    <p className="text-[10px] mono mb-1.5" style={{ color: 'var(--t3)' }}>
                      GEÇECEKLER (undercut)
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {data.pit_scenario.cars_overtaken.map((c: any) => (
                        <span key={c.code} className="text-[11px] mono font-bold px-2 py-0.5 rounded"
                          style={{ background: 'rgba(0,210,190,0.12)', color: '#00D2BE',
                                   border: '1px solid rgba(0,210,190,0.25)' }}>
                          P{c.pos} {c.code} +{c.gap_after_pit.toFixed(1)}s
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {data.pit_scenario.cars_still_ahead.length > 0 && (
                  <div>
                    <p className="text-[10px] mono mb-1.5" style={{ color: 'var(--t3)' }}>
                      ÖNDE KALACAKLAR
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {data.pit_scenario.cars_still_ahead.slice(0, 5).map((c: any) => (
                        <span key={c.code} className="text-[11px] mono px-2 py-0.5 rounded"
                          style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--t3)',
                                   border: '1px solid var(--b1)' }}>
                          P{c.pos} {c.code}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Optimal pit penceresi */}
            {data.optimal_pit && (
              <div className="rounded-xl overflow-hidden border"
                style={{
                  borderColor: data.optimal_pit.safe_to_pit_now
                    ? 'rgba(0,210,190,0.3)' : 'rgba(225,6,0,0.3)',
                  background: data.optimal_pit.safe_to_pit_now
                    ? 'rgba(0,210,190,0.05)' : 'rgba(225,6,0,0.05)',
                }}>
                <div className="px-4 py-2.5 border-b flex items-center gap-2"
                  style={{
                    borderColor: data.optimal_pit.safe_to_pit_now
                      ? 'rgba(0,210,190,0.2)' : 'rgba(225,6,0,0.2)',
                  }}>
                  <span>{data.optimal_pit.safe_to_pit_now ? '✅' : '⚠️'}</span>
                  <p className="text-[12px] font-bold"
                    style={{ color: data.optimal_pit.safe_to_pit_now ? '#00D2BE' : '#E10600' }}>
                    Pit Penceresi Analizi
                  </p>
                </div>
                <div className="px-4 py-3">
                  <p className="text-[13px] leading-relaxed" style={{ color: 'var(--t2)' }}>
                    {data.optimal_pit.message}
                  </p>
                  <div className="flex gap-4 mt-2.5 text-[11px] mono">
                    <span style={{ color: 'var(--t3)' }}>
                      Arkadaki: <strong className="text-white">{data.optimal_pit.closest_behind}</strong>
                    </span>
                    <span style={{ color: 'var(--t3)' }}>
                      Fark: <strong className="text-white">{data.optimal_pit.gap_to_behind.toFixed(1)}s</strong>
                    </span>
                    <span style={{ color: 'var(--t3)' }}>
                      Gereken min: <strong className="text-white">{data.optimal_pit.needed_gap}s</strong>
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Yakalama analizi */}
            {data.catch_analysis.length > 0 && (
              <div className="rounded-xl overflow-hidden border"
                style={{ borderColor: 'var(--b1)', background: 'var(--s2)' }}>
                <div className="px-4 py-2.5 border-b flex items-center gap-2"
                  style={{ borderColor: 'var(--b1)' }}>
                  <span>📡</span>
                  <p className="text-[12px] font-bold text-white">Yakalama Analizi</p>
                  {data.remaining_laps != null && (
                    <span className="text-[10px] mono ml-auto" style={{ color: 'var(--t3)' }}>
                      Kalan {data.remaining_laps} tur
                    </span>
                  )}
                </div>
                <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
                  {data.catch_analysis.map((c: any) => (
                    <div key={c.ahead_code} className="px-4 py-2.5 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] font-black mono" style={{ color: 'var(--t3)' }}>
                          P{c.ahead_pos}
                        </span>
                        <span className="text-[13px] font-black mono text-white">{c.ahead_code}</span>
                        <span className="text-[11px] mono" style={{ color: 'var(--t3)' }}>
                          {c.gap_seconds.toFixed(1)}s önde
                        </span>
                      </div>
                      {c.catchable ? (
                        <div className="text-right">
                          <span className="text-[13px] font-black mono" style={{ color: '#00D2BE' }}>
                            ~{c.laps_to_catch.toFixed(0)} tur
                          </span>
                          <p className="text-[9px] mono" style={{ color: 'var(--t3)' }}>
                            +{c.pace_gain_per_lap.toFixed(3)}s/tur kazanıyor
                          </p>
                        </div>
                      ) : (
                        <div className="text-right">
                          <span className="text-[11px] mono" style={{ color: '#f87171' }}>
                            Yakalanamaz
                          </span>
                          {c.reason && (
                            <p className="text-[9px] mono mt-0.5" style={{ color: 'var(--t3)' }}>
                              {c.reason}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {data.catch_analysis.length === 0 && (
              <p className="text-[12px] text-center py-2" style={{ color: 'var(--t3)' }}>
                {data.current_position === 1
                  ? '🏆 Lider konumunda — yakalama analizi yok'
                  : 'Pace farkı çok küçük — yakalama analizi yapılamıyor'}
              </p>
            )}

            <p className="text-[10px] mono text-center" style={{ color: 'var(--t3)' }}>
              15 saniyede bir otomatik güncellenir · Pit kaybı tahmini: ~{data.pit_loss_estimate}s
            </p>
          </div>
        )}  {/* !data.lapped && data kapanış */}

        {!data && !isLoading && (
          <p className="text-[12px] text-center py-4" style={{ color: 'var(--t3)' }}>
            Pilot seç ve simüle et butonuna bas
          </p>
        )}
      </div>
    </div>
  )
}
