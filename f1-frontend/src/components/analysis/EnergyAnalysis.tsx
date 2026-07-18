/**
 * 2026 F1 Enerji Yönetimi Analizi
 * Fizik modeli ile tahmini deploy / regen / SoC / X-mode verileri
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, ReferenceLine, Legend,
} from 'recharts'
import { client } from '../../api/client'
import { EnergyShareCard } from '../ui/EnergyShareCard'
import { useShareCard } from '../../hooks/useShareCard'
import { useTranslation } from 'react-i18next'

interface PerLap {
  lap: number; deploy_kj: number; regen_kj: number
  net_kj: number; efficiency_pct: number; x_mode_count: number
}
interface SocPoint {
  dist_m: number; soc_pct: number; deploy_kw: number
  regen_kw: number; x_mode: number; lap: number; speed: number
}
interface Profile {
  aggression: number; harvest_eff: number
  avg_deploy_kj: number; avg_regen_kj: number
  x_mode_zones: number[]; total_laps_analyzed: number
}
interface EnergyData {
  driver_code: string; soc_curve: SocPoint[]
  per_lap: PerLap[]; profile: Profile
}
interface Props {
  sessionId: number; sessionDrivers: string[]; primaryDriver?: string; sessionName?: string
}

function GlossaryCard() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const GLOSSARY = [
    { term: '⚡ Deploy', short: t('energy.glossary_deploy_short'), detail: t('energy.glossary_deploy_detail'), color: '#E10600' },
    { term: '🔋 Regen',  short: t('energy.glossary_regen_short'),  detail: t('energy.glossary_regen_detail'),  color: '#00D2BE' },
    { term: '🔀 X-mode', short: t('energy.glossary_xmode_short'),  detail: t('energy.glossary_xmode_detail'),  color: '#FFD700' },
    { term: '🎯 Agresiflik', short: t('energy.glossary_aggr_short'), detail: t('energy.glossary_aggr_detail'), color: '#FF8700' },
  ]
  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--b1)' }}>
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left transition-all"
        style={{ background: 'var(--s2)' }}>
        <p className="text-[12px] font-semibold mono" style={{ color: 'var(--t2)' }}>
          📖 {t('energy.glossary_title')}
        </p>
        <span className="text-[11px] mono" style={{ color: 'var(--t3)' }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4"
          style={{ background: 'var(--s1)' }}>
          {GLOSSARY.map(g => (
            <div key={g.term} className="rounded-lg p-3 border"
              style={{ borderColor: g.color + '25', background: g.color + '08' }}>
              <p className="text-[13px] font-bold mb-1" style={{ color: g.color }}>{g.term}</p>
              <p className="text-[12px] font-semibold mb-1 text-white">{g.short}</p>
              <p className="text-[11px] leading-relaxed" style={{ color: 'var(--t2)' }}>{g.detail}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ScoreBar({ label, value, color, description }: {
  label: string; value: number; color: string; description: string
}) {
  return (
    <div>
      <div className="flex justify-between items-center mb-1.5">
        <p className="text-[12px] font-semibold mono" style={{ color: 'var(--t2)' }}>{label}</p>
        <p className="text-[16px] font-black mono" style={{ color }}>{value}<span className="text-[11px] ml-0.5">/100</span></p>
      </div>
      <div className="h-2.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.07)' }}>
        <div className="h-full rounded-full transition-all duration-700"
          style={{ width: `${value}%`, background: color }} />
      </div>
      <p className="text-[11px] mono mt-1" style={{ color: 'var(--t3)' }}>{description}</p>
    </div>
  )
}

export function EnergyAnalysis({ sessionId, sessionDrivers, primaryDriver, sessionName }: Props) {
  const { t } = useTranslation()
  const defaultA = primaryDriver && sessionDrivers.includes(primaryDriver)
    ? primaryDriver : (sessionDrivers[0] ?? 'VER')
  const defaultB = sessionDrivers.find(d => d !== defaultA) ?? sessionDrivers[1] ?? 'NOR'

  const [dA, setDA] = useState(defaultA)
  const [dB, setDB] = useState(defaultB)
  const [subTab, setSubTab] = useState<'profile' | 'laps' | 'soc'>('profile')
  const [selectedLap, setSelectedLap] = useState<number | 'all'>('all')    // Tur analizi
  const [selectedSocLap, setSelectedSocLap] = useState<number | 'all'>('all') // SoC eğrisi

  const queryA = useQuery({
    queryKey: ['energy', sessionId, dA],
    queryFn: () => client.get(`/sessions/${sessionId}/energy_analysis/${dA}`).then(r => r.data as EnergyData),
    staleTime: Infinity, retry: 1,
  })
  const queryB = useQuery({
    queryKey: ['energy', sessionId, dB],
    queryFn: () => client.get(`/sessions/${sessionId}/energy_analysis/${dB}`).then(r => r.data as EnergyData),
    staleTime: Infinity, retry: 1, enabled: dB !== dA,
  })

  const { cardRef: shareCardRef, share: shareEnergy } = useShareCard()

  const eA = queryA.data
  const eB = queryB.data
  const isLoading = queryA.isLoading || (dB !== dA && queryB.isLoading)

  // Tur listesi
  const lapNumbers = eA?.per_lap.map(l => l.lap) ?? []

  // Seçili tur filtresi
  const filteredPerLapA = selectedLap === 'all' ? (eA?.per_lap ?? []) : (eA?.per_lap.filter(l => l.lap === selectedLap) ?? [])
  const filteredPerLapB = selectedLap === 'all' ? (eB?.per_lap ?? []) : (eB?.per_lap.filter(l => l.lap === selectedLap) ?? [])

  // Bar chart verisi
  const lapChartData = filteredPerLapA.map(la => {
    const lb = filteredPerLapB.find(l => l.lap === la.lap)
    return {
      lap: la.lap,
      [`${dA} Deploy`]: la.deploy_kj,
      [`${dA} Regen`]:  la.regen_kj,
      ...(eB ? {
        [`${dB} Deploy`]: lb?.deploy_kj ?? 0,
        [`${dB} Regen`]:  lb?.regen_kj  ?? 0,
      } : {}),
    }
  })

  // SoC eğrisi — kendi filtresine göre, A ve B aynı eksende
  const socDataA = (eA?.soc_curve ?? []).filter(p => selectedSocLap === 'all' || p.lap === selectedSocLap)
  const socDataB = (eB?.soc_curve ?? []).filter(p => selectedSocLap === 'all' || p.lap === selectedSocLap)
  const socStep = Math.max(1, Math.floor(Math.max(socDataA.length, socDataB.length, 1) / 150))
  const sampledA = socDataA.filter((_, i) => i % socStep === 0)
  const sampledB = socDataB.filter((_, i) => i % socStep === 0)
  const socChartA = Array.from({ length: Math.max(sampledA.length, sampledB.length) }, (_, i) => {
    const a = sampledA[i]
    const b = sampledB[i]
    return {
      idx: i,
      [`${dA} SoC`]: a?.soc_pct,
      [`${dA}_lap`]: a?.lap,
      ...(eB ? {
        [`${dB} SoC`]: b?.soc_pct,
        [`${dB}_lap`]: b?.lap,
      } : {}),
      speed: a?.speed,
      xmode: a && a.x_mode > 0.6 ? 105 : null,
    }
  })

  // Profile açıklama metinleri
  const aggrDesc = (v: number) => v >= 80 ? t('energy.aggr_high') : v >= 50 ? t('energy.aggr_mid') : t('energy.aggr_low')
  const harvDesc = (v: number) => v >= 60 ? t('energy.harv_high') : v >= 30 ? t('energy.harv_mid') : t('energy.harv_low')

  return (
    <div className="card overflow-hidden">
      {/* Başlık */}
      <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--b1)' }}>
        <div className="flex items-center gap-3 mb-4">
          <span className="text-xl">⚡</span>
          <div>
            <p className="text-[14px] font-bold text-white">{t('energy.title')}</p>
            <p className="text-[11px] mono mt-0.5" style={{ color: 'var(--t3)' }}>
              {t('energy.subtitle')}
            </p>
          </div>
        </div>

        {/* Pilot seçici */}
        <div className="flex flex-wrap items-center gap-3">
          <select value={dA} onChange={e => setDA(e.target.value)}
            className="px-3 py-2 rounded-xl text-[14px] font-black mono cursor-pointer"
            style={{ background:'rgba(225,6,0,0.1)', border:'1px solid rgba(225,6,0,0.3)', color:'#E10600', outline:'none', minWidth:90 }}>
            {sessionDrivers.filter(c => c !== dB).map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <span className="text-[13px] font-black" style={{ color:'var(--t3)' }}>vs</span>
          <select value={dB} onChange={e => setDB(e.target.value)}
            className="px-3 py-2 rounded-xl text-[14px] font-black mono cursor-pointer"
            style={{ background:'rgba(255,135,0,0.1)', border:'1px solid rgba(255,135,0,0.3)', color:'#FF8700', outline:'none', minWidth:90 }}>
            {sessionDrivers.filter(c => c !== dA).map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          {(queryA.isFetching || queryB.isFetching) && (
            <p className="text-[11px] mono animate-pulse" style={{ color:'var(--t3)' }}>
              {t('energy.loading')}
            </p>
          )}
        </div>
      </div>

      {/* Alt sekmeler */}
      <div className="flex border-b" style={{ borderColor:'var(--b1)' }}>
        {([['profile', t('energy.tab_profile')],['laps', t('energy.tab_laps')],['soc', t('energy.tab_soc')]] as const).map(([tabKey, label]) => (
          <button key={tabKey} onClick={() => setSubTab(tabKey)}
            className="flex-1 py-2.5 text-[12px] font-semibold transition-all"
            style={subTab===tabKey
              ? { background:'rgba(225,6,0,0.08)', color:'#E10600', borderBottom:'2px solid #E10600' }
              : { color:'var(--t3)', borderBottom:'2px solid transparent' }}>
            {label}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="p-10 text-center">
          <p className="text-[13px] mono animate-pulse" style={{ color:'var(--t3)' }}>
            {t('energy.loading')}
          </p>
          <p className="text-[11px] mono mt-2" style={{ color:'var(--t3)' }}>
            ~20–30s (first time), &lt;1s (cached)
          </p>
        </div>
      )}

      {!isLoading && eA && (
        <>
          {/* ── PİLOT PROFİLİ ─────────────────────────────── */}
          {subTab === 'profile' && (
            <div className="p-5 space-y-5">
              {/* İki pilot yan yana */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {([{code:dA, data:eA, color:'#E10600'}, {code:dB, data:eB, color:'#FF8700'}] as const).map(
                  ({code, data, color}) => data && (
                    <div key={code} className="rounded-2xl p-4 border space-y-4"
                      style={{ borderColor:color+'30', background:color+'06' }}>
                      <p className="text-[22px] font-black mono" style={{ color }}>{code}</p>

                      <ScoreBar
                        label={`⚡ ${t('energy.intensity_short')}`}
                        value={data.profile.aggression}
                        color={color}
                        description={aggrDesc(data.profile.aggression)}
                      />
                      <ScoreBar
                        label={`🔋 ${t('energy.regen_short')}`}
                        value={data.profile.harvest_eff}
                        color="#00D2BE"
                        description={harvDesc(data.profile.harvest_eff)}
                      />

                      <div className="pt-2 border-t space-y-2" style={{ borderColor:'rgba(255,255,255,0.07)' }}>
                        {/* Deploy */}
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="text-[12px] mono" style={{ color:'var(--t2)' }}>{t('energy.avg_deploy_lap')}</p>
                            <p className="text-[10px] mono" style={{ color:'var(--t3)' }}>
                              {data.profile.avg_deploy_kj < 400 ? t('energy.deploy_conservative') : data.profile.avg_deploy_kj < 700 ? t('energy.deploy_balanced') : t('energy.deploy_aggressive')}
                              {' · '}{t('energy.deploy_ideal')}
                            </p>
                          </div>
                          <span className="text-[14px] font-black mono" style={{ color }}>{data.profile.avg_deploy_kj} kJ</span>
                        </div>
                        {/* Regen */}
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="text-[12px] mono" style={{ color:'var(--t2)' }}>{t('energy.avg_regen_lap')}</p>
                            <p className="text-[10px] mono" style={{ color:'var(--t3)' }}>
                              {data.profile.avg_regen_kj < 100 ? t('energy.regen_weak') : data.profile.avg_regen_kj < 200 ? t('energy.regen_average') : t('energy.regen_good')}
                              {' · '}{t('energy.regen_ideal')}
                            </p>
                          </div>
                          <span className="text-[14px] font-black mono" style={{ color:'#00D2BE' }}>{data.profile.avg_regen_kj} kJ</span>
                        </div>
                        {[
                          [t('energy.analysis_laps'), `${data.profile.total_laps_analyzed}`],
                          [t('energy.xmode_zones'),   `${data.profile.x_mode_zones.length}`],
                        ].map(([k, v]) => (
                          <div key={k} className="flex justify-between">
                            <span className="text-[12px] mono" style={{ color:'var(--t2)' }}>{k}</span>
                            <span className="text-[13px] font-bold mono text-white">{v}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                )}
              </div>

              {/* Karşılaştırma barları */}
              {eB && (
                <div className="rounded-xl p-4 border space-y-4"
                  style={{ borderColor:'var(--b1)', background:'var(--s2)' }}>
                  <p className="text-[12px] mono font-semibold" style={{ color:'var(--t2)' }}>
                    COMPARISON
                  </p>
                  {[
                    { label: t('energy.deploy_short'), a:eA.profile.aggression, b:eB.profile.aggression, winKey:'can_catch' },
                    { label: t('energy.regen_short'), a:eA.profile.harvest_eff, b:eB.profile.harvest_eff, winKey:'can_catch' },
                  ].map(row => {
                    const total = row.a + row.b || 1
                    const diff  = Math.abs(row.a - row.b)
                    const winner = row.a >= row.b ? dA : dB
                    const wc = row.a >= row.b ? '#E10600' : '#FF8700'
                    const isTie = diff < 3
                    return (
                      <div key={row.label}>
                        <div className="flex justify-between mb-1.5">
                          <span className="text-[12px] mono" style={{ color:'var(--t2)' }}>{row.label}</span>
                          <span className="text-[12px] mono font-bold" style={{ color: isTie ? 'var(--t2)' : wc }}>
                            {isTie ? t('h2h.equal') : `${winner}`}
                          </span>
                        </div>
                        <div className="flex h-3 rounded-full overflow-hidden gap-0.5">
                          <div style={{ width:`${(row.a/total)*100}%`, background:'#E10600', borderRadius:'4px 0 0 4px' }} />
                          <div style={{ flex:1, background:'#FF8700', borderRadius:'0 4px 4px 0' }} />
                        </div>
                        <div className="flex justify-between mt-0.5">
                          <span className="text-[11px] mono font-bold" style={{ color:'#E10600' }}>{dA}: {row.a}</span>
                          <span className="text-[11px] mono font-bold" style={{ color:'#FF8700' }}>{dB}: {row.b}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Paylaşım */}
              {eB && (
                <>
                  <div className="flex justify-end">
                    <button onClick={() => shareEnergy(`hotlap-${dA}-vs-${dB}-enerji`)}
                      className="flex items-center gap-2 px-4 py-2 text-[11px] border border-[#E10600]/40 text-[#E10600] rounded-lg hover:bg-[#E10600]/10 transition-all"
                    >
                      <span>↗</span> {t('energy.share_profile')}
                    </button>
                  </div>

                  {/* Görünmez kart — sadece yakalama için */}
                  <EnergyShareCard
                    ref={shareCardRef}
                    sessionName={sessionName ?? ''}
                    driverA={dA}
                    driverB={dB}
                    profileA={eA.profile}
                    profileB={eB.profile}
                  />
                </>
              )}

              {/* Sözlük */}
              <GlossaryCard />

              {/* Uyarı */}
              <div className="rounded-xl px-4 py-3 flex gap-3"
                style={{ background:'rgba(255,215,0,0.05)', border:'1px solid rgba(255,215,0,0.15)' }}>
                <span className="shrink-0 text-[13px]">⚠️</span>
                <p className="text-[11px] mono leading-relaxed" style={{ color:'rgba(255,215,0,0.7)' }}>
                  {t('energy.disclaimer')} <strong>{t('energy.disclaimer_note')}</strong>
                </p>
              </div>
            </div>
          )}

          {/* ── TUR ANALİZİ ──────────────────────────────── */}
          {subTab === 'laps' && (
            <div className="px-5 py-5 space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  <p className="text-[12px] mono font-semibold" style={{ color:'var(--t2)' }}>
                    {selectedLap === 'all' ? t('energy.all_laps_label', { n: lapChartData.length }) : t('energy.lap_label', { n: selectedLap })}
                  </p>
                  {/* Tur seçici — sadece bu sekmede */}
                  {lapNumbers.length > 0 && (
                    <select value={selectedLap}
                      onChange={e => setSelectedLap(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                      className="px-2.5 py-1.5 rounded-lg text-[12px] mono cursor-pointer"
                      style={{ background:'var(--s2)', border:'1px solid var(--b1)', color:'var(--t2)', outline:'none' }}>
                      <option value="all">{t('energy.all_race')}</option>
                      {lapNumbers.map(l => <option key={l} value={l}>{t('energy.lap_option', { n: l })}</option>)}
                    </select>
                  )}
                </div>
                <div className="flex gap-3 text-[11px] mono">
                  <span style={{ color:'#E10600' }}>■ Deploy</span>
                  <span style={{ color:'#00D2BE' }}>■ Regen</span>
                </div>
              </div>

              {lapChartData.length === 0 ? (
                <p className="text-[12px] mono text-center py-8" style={{ color:'var(--t3)' }}>{t('energy.no_data')}</p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={lapChartData} barGap={2} barCategoryGap="25%">
                    <CartesianGrid strokeDasharray="3 8" stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis dataKey="lap"
                      tick={{ fill:'rgba(240,244,255,0.55)', fontSize:11, fontFamily:'IBM Plex Mono,monospace' }}
                      tickLine={false} axisLine={{ stroke:'rgba(255,255,255,0.10)' }}
                      label={{ value: t('telemetry.lap', { n: '' }).trim(), position:'insideBottom', offset:-2, fill:'rgba(240,244,255,0.4)', fontSize:11 }} />
                    <YAxis
                      tick={{ fill:'rgba(240,244,255,0.55)', fontSize:11, fontFamily:'IBM Plex Mono,monospace' }}
                      tickLine={false} axisLine={false}
                      label={{ value:'kJ', angle:-90, position:'insideLeft', fill:'rgba(240,244,255,0.4)', fontSize:11 }} />
                    <Tooltip
                      contentStyle={{ background:'rgba(5,8,15,0.97)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:10, fontFamily:'IBM Plex Mono,monospace', fontSize:11 }}
                      labelFormatter={v => t('energy.lap_option', { n: v })} />
                    <Bar dataKey={`${dA} Deploy`} fill="#E10600" opacity={0.9} radius={[2,2,0,0]} />
                    <Bar dataKey={`${dA} Regen`}  fill="#00D2BE" opacity={0.7} radius={[2,2,0,0]} />
                    {eB && <>
                      <Bar dataKey={`${dB} Deploy`} fill="#FF8700" opacity={0.9} radius={[2,2,0,0]} />
                      <Bar dataKey={`${dB} Regen`}  fill="#00D2BE" opacity={0.4} radius={[2,2,0,0]} />
                    </>}
                  </BarChart>
                </ResponsiveContainer>
              )}

              {/* Özet istatistik */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { label: t('energy.max_deploy'), val:`${Math.max(...lapChartData.map((l:any) => l[`${dA} Deploy`]||0)).toFixed(0)} kJ`, color:'#E10600' },
                  { label: t('energy.max_regen'),  val:`${Math.max(...lapChartData.map((l:any) => l[`${dA} Regen`]||0)).toFixed(0)} kJ`,  color:'#00D2BE' },
                  { label: t('energy.avg_deploy'), val:`${eA.profile.avg_deploy_kj} kJ`, color:'var(--t2)' },
                  { label: t('energy.avg_regen'),  val:`${eA.profile.avg_regen_kj} kJ`,  color:'var(--t2)' },
                ].map(s => (
                  <div key={s.label} className="rounded-xl p-3 border" style={{ borderColor:'var(--b1)', background:'var(--s2)' }}>
                    <p className="text-[10px] mono mb-1" style={{ color:'var(--t3)' }}>{s.label}</p>
                    <p className="text-[15px] font-black mono" style={{ color:s.color }}>{s.val}</p>
                  </div>
                ))}
              </div>

              <GlossaryCard />
            </div>
          )}

          {/* ── SOC EĞRİSİ ────────────────────────────────── */}
          {subTab === 'soc' && (
            <div className="px-5 py-5 space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-[12px] mono font-semibold" style={{ color:'var(--t2)' }}>
                  {t('energy.battery_title')}
                </p>
                <div className="flex gap-3 text-[11px] mono">
                  <span style={{ color:'#E10600' }}>■ {dA}</span>
                  {eB && <span style={{ color:'#FF8700' }}>■ {dB}</span>}
                  <span style={{ color:'rgba(255,215,0,0.7)' }}>▏ X-mode</span>
                </div>
              </div>

              {socChartA.length === 0 ? (
                <p className="text-[12px] mono text-center py-8" style={{ color:'var(--t3)' }}>
                  {t('energy.no_data')}
                </p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={socChartA}>
                    <CartesianGrid strokeDasharray="3 8" stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis dataKey="idx" hide />
                    <YAxis domain={[0, 105]}
                      tick={{ fill:'rgba(240,244,255,0.55)', fontSize:11, fontFamily:'IBM Plex Mono,monospace' }}
                      tickLine={false} axisLine={false}
                      tickFormatter={v => `${v}%`} width={40} />
                    <Tooltip
                      contentStyle={{ background:'rgba(5,8,15,0.97)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:10, fontFamily:'IBM Plex Mono,monospace', fontSize:11 }}
                      formatter={(v:any, name:string, item:any) => {
                        if (name === 'xmode') return null
                        const lapKey = name === `${dA} SoC` ? `${dA}_lap` : `${dB}_lap`
                        const lap = item?.payload?.[lapKey]
                        return [`${v}%${lap ? ` · ${t('energy.lap_option', { n: lap })}` : ''}`, name]
                      }}
                      labelFormatter={() => ''} />
                    <ReferenceLine y={20} stroke="rgba(225,6,0,0.3)" strokeDasharray="3 3"
                      label={{ value: t('energy.critical_label'), position:'insideLeft', fill:'rgba(225,6,0,0.5)', fontSize:10 }} />
                    <Line type="monotone" dataKey={`${dA} SoC`} stroke="#E10600" strokeWidth={2} dot={false} connectNulls />
                    {eB && <Line type="monotone" dataKey={`${dB} SoC`} stroke="#FF8700" strokeWidth={2} dot={false} connectNulls />}
                    <Line type="monotone" dataKey="xmode" stroke="rgba(255,215,0,0.5)"
                      strokeWidth={0}
                      dot={(props:any) => {
                        if (!props.payload?.xmode) return <g key={props.key}/>
                        return <rect key={props.key} x={props.cx-1} y={4} width={2} height={props.height||200} fill="rgba(255,215,0,0.15)" />
                      }} />
                  </LineChart>
                </ResponsiveContainer>
              )}

              {/* Nasıl okunur */}
              <div className="rounded-xl p-4 border space-y-2"
                style={{ borderColor:'var(--b1)', background:'var(--s2)' }}>
                <p className="text-[12px] mono font-semibold mb-2" style={{ color:'var(--t2)' }}>
                  📖 {t('energy.how_to_read')}
                </p>
                <div className="space-y-2 text-[11px] leading-relaxed" style={{ color:'var(--t2)' }}>
                  <p>{t('energy.read_deploy')}</p>
                  <p>{t('energy.read_regen')}</p>
                  <p>{t('energy.read_critical')}</p>
                  <p>{t('energy.read_xmode')}</p>
                  <p>{t('energy.read_refill')}</p>
                </div>
              </div>

              <GlossaryCard />
            </div>
          )}
        </>
      )}
    </div>
  )
}
