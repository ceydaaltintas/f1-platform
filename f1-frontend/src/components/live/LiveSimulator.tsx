/**
 * Canlı Yarış Simülatörü
 * - Yakalama tahmini: X pilot Y'yi kaç turda yakalar?
 * - Pit senaryosu: Şu an pit girerse hangi sırada çıkar?
 * - Optimal pit penceresi: Arkadaki araçtan kaçmak güvenli mi?
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { client } from '../../api/client'
import { useTranslation } from 'react-i18next'

interface Props {
  sessionId: number
  drivers: string[]          // mevcut pilotlar (dropdown için)
  defaultDriver?: string
  disabled?: boolean         // yarış bittiyse true
}

export function LiveSimulator({ sessionId, drivers, defaultDriver = '', disabled = false }: Props) {
  const { t } = useTranslation()
  const [selectedDriver, setSelectedDriver] = useState(defaultDriver)
  const [enabled, setEnabled] = useState(false)

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['live-sim', sessionId, selectedDriver],
    queryFn:  () =>
      client.get(`/live/${sessionId}/simulate?driver_code=${selectedDriver}`)
        .then(r => r.data),
    enabled:  enabled && !!selectedDriver && !disabled,
    staleTime: 0,
    refetchInterval: enabled && !disabled ? 15_000 : false,
  })

  const runSim = () => {
    if (!selectedDriver || disabled) return
    if (enabled) {
      // Zaten etkinse (aynı pilot için tekrar basıldıysa) doğrudan yeniden çek
      refetch()
    } else {
      // İlk etkinleştirme — sorgu enabled olunca otomatik ilk isteği yapar
      setEnabled(true)
    }
  }

  return (
    <div className="card overflow-hidden">
      {/* Başlık */}
      <div className="flex items-center gap-3 px-5 py-3.5 border-b"
        style={{ borderColor: 'var(--b1)' }}>
        <span className="text-xl">🔮</span>
        <div>
          <p className="text-[13px] font-bold text-white leading-none">{t('live_sim.title')}</p>
          <p className="text-[10px] mono mt-0.5" style={{ color: 'var(--t3)' }}>
            {t('live_sim.subtitle')}
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
              🏁 {t('live_sim.race_finished')}
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
            <option value="">{t('live_sim.select_driver')}</option>
            {drivers.map(d => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <button
            onClick={runSim}
            disabled={!selectedDriver || isLoading || disabled}
            className="px-4 py-2.5 rounded-xl text-[12px] font-bold transition-all disabled:opacity-40"
            style={{ background: '#E10600', color: 'white' }}>
            {isLoading ? '⏳' : `▶ ${t('live_sim.simulate_btn')}`}
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
              {t('live_sim.lapped_note')}
            </p>
          </div>
        )}

        {data && !data.lapped && !data.retired && (
          <div className="space-y-3">
            {/* Mevcut durum */}
            <div className="flex items-center gap-4 px-4 py-3 rounded-xl"
              style={{ background: 'var(--s2)', border: '1px solid var(--b1)' }}>
              <div>
                <p className="text-[10px] mono" style={{ color: 'var(--t3)' }}>{t('live_sim.position')}</p>
                <p className="text-[22px] font-black mono" style={{ color: '#E10600' }}>
                  P{data.current_position}
                </p>
              </div>
              <div className="w-px h-10 self-stretch" style={{ background: 'var(--b1)' }} />
              <div>
                <p className="text-[10px] mono" style={{ color: 'var(--t3)' }}>{t('live_sim.avg_pace')}</p>
                <p className="text-[16px] font-black mono text-white">
                  {data.avg_pace ? `${data.avg_pace.toFixed(3)}s` : '—'}
                </p>
              </div>
              <div className="w-px h-10 self-stretch" style={{ background: 'var(--b1)' }} />
              <div>
                <p className="text-[10px] mono" style={{ color: 'var(--t3)' }}>{t('live_sim.gap_to_leader')}</p>
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
                  {t('live_sim.pit_now')}
                </p>
              </div>
              <div className="px-4 py-3 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[12px]" style={{ color: 'var(--t2)' }}>{t('live_sim.est_exit_pos')}</span>
                  <span className="text-[20px] font-black mono" style={{ color: '#FF8700' }}>
                    P{data.pit_scenario.position_after_pit}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span style={{ color: 'var(--t3)' }}>{t('live_sim.pit_loss_est')}</span>
                  <span className="mono font-bold" style={{ color: 'var(--t2)' }}>~{data.pit_loss_estimate}s</span>
                </div>
                {data.pit_scenario.cars_overtaken.length > 0 && (
                  <div>
                    <p className="text-[10px] mono mb-1.5" style={{ color: 'var(--t3)' }}>
                      {t('live_sim.will_overtake')}
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
                      {t('live_sim.still_ahead')}
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
                    {t('live_sim.pit_window')}
                  </p>
                </div>
                <div className="px-4 py-3">
                  <p className="text-[13px] leading-relaxed" style={{ color: 'var(--t2)' }}>
                    {data.optimal_pit.message}
                  </p>
                  <div className="flex gap-4 mt-2.5 text-[11px] mono">
                    <span style={{ color: 'var(--t3)' }}>
                      {t('live_sim.behind')}: <strong className="text-white">{data.optimal_pit.closest_behind}</strong>
                    </span>
                    <span style={{ color: 'var(--t3)' }}>
                      {t('live_sim.gap')}: <strong className="text-white">{data.optimal_pit.gap_to_behind.toFixed(1)}s</strong>
                    </span>
                    <span style={{ color: 'var(--t3)' }}>
                      {t('live_sim.min_needed')}: <strong className="text-white">{data.optimal_pit.needed_gap}s</strong>
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
                  <p className="text-[12px] font-bold text-white">{t('live_sim.catch_analysis')}</p>
                  {data.remaining_laps != null && (
                    <span className="text-[10px] mono ml-auto" style={{ color: 'var(--t3)' }}>
                      {t('live_sim.remaining_laps', { n: data.remaining_laps })}
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
                          {t('live_sim.gap_ahead', { n: c.gap_seconds.toFixed(1) })}
                        </span>
                      </div>
                      {c.catchable ? (
                        <div className="text-right">
                          <span className="text-[13px] font-black mono" style={{ color: '#00D2BE' }}>
                            {c.laps_to_catch != null ? t('live_sim.laps_to_catch', { n: c.laps_to_catch.toFixed(0) }) : t('live_sim.in_battle')}
                          </span>
                          <p className="text-[9px] mono" style={{ color: 'var(--t3)' }}>
                            {c.pace_gain_per_lap ? t('live_sim.pace_gaining', { n: c.pace_gain_per_lap.toFixed(3) }) : (c.reason ?? t('live_sim.drs_range'))}
                          </p>
                        </div>
                      ) : (
                        <div className="text-right">
                          <span className="text-[11px] mono" style={{ color: '#f87171' }}>
                            {t('live_sim.cannot_catch')}
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
                  ? `🏆 ${t('live_sim.catch_none_leader')}`
                  : t('live_sim.catch_none_close')}
              </p>
            )}

            <p className="text-[10px] mono text-center" style={{ color: 'var(--t3)' }}>
              {t('live_sim.auto_update', { pit_loss: data.pit_loss_estimate })}
            </p>
          </div>
        )}  {/* !data.lapped && data kapanış */}

        {!data && !isLoading && (
          <p className="text-[12px] text-center py-4" style={{ color: 'var(--t3)' }}>
            {t('live_sim.prompt')}
          </p>
        )}
      </div>
    </div>
  )
}
