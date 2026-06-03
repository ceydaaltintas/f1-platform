/**
 * Pace Karşılaştırması
 * - Takım arkadaşları: tüm takımlar için otomatik çiftler
 * - Serbest seçim: kullanıcı herhangi iki pilotu karşılaştırır
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { client } from '../../api/client'
import { formatLapTime } from '../../utils/format'

interface DriverPace {
  code:   string
  number: number
  median: number
  best:   number
  laps:   number
}

interface TeamData {
  team:   string
  faster: DriverPace
  slower: DriverPace
  gap_ms: number
}

interface Props { sessionId: number }

const TEAM_COLORS: Record<string, string> = {
  'red bull':    '#3671C6', 'mclaren':      '#FF8000',
  'ferrari':     '#E8002D', 'mercedes':     '#27F4D2',
  'aston':       '#229971', 'alpine':       '#FF87BC',
  'williams':    '#64C4FF', 'racing bulls': '#6692FF',
  'sauber':      '#52E252', 'haas':         '#B6BABD',
  'audi':        '#D4AF37',
}
function teamColor(name: string): string {
  const n = name.toLowerCase()
  for (const [k, v] of Object.entries(TEAM_COLORS)) {
    if (n.includes(k)) return v
  }
  return '#888'
}

function GapBar({ gap, maxGap, color }: { gap: number; maxGap: number; color: string }) {
  return (
    <div className="h-1.5 rounded-full" style={{ background:'rgba(255,255,255,0.06)' }}>
      <div className="h-full rounded-full transition-all duration-700"
        style={{ width:`${(gap / maxGap) * 100}%`, background: color, opacity:0.85 }} />
    </div>
  )
}

function TeamRow({ t, maxGap }: { t: TeamData; maxGap: number }) {
  const color = teamColor(t.team)
  return (
    <div className="px-5 py-4 border-b" style={{ borderColor:'var(--b1)' }}>
      <div className="flex items-center gap-2 mb-3">
        <div className="w-2 h-2 rounded-full" style={{ background: color }} />
        <p className="text-[10px] font-semibold mono tracking-widest" style={{ color:'var(--t2)' }}>
          {t.team.toUpperCase()}
        </p>
      </div>
      <div className="flex items-center gap-3">
        {/* Hızlı */}
        <div className="shrink-0 text-right" style={{ width:44 }}>
          <p className="text-[15px] font-black mono" style={{ color }}>{t.faster.code}</p>
          <p className="text-[9px] mono" style={{ color:'var(--t3)' }}>{formatLapTime(t.faster.median)}</p>
        </div>
        {/* Bar */}
        <div className="flex-1 space-y-1.5">
          <div className="flex justify-between items-center">
            <p className="text-[10px] mono" style={{ color:'rgba(240,244,255,0.25)' }}>
              {t.faster.code} daha hızlı
            </p>
            <p className="text-[14px] font-black mono" style={{ color }}>
              {t.gap_ms >= 1
                ? `${t.gap_ms.toFixed(3)}s`
                : `${(t.gap_ms * 1000).toFixed(0)}ms`}
            </p>
          </div>
          <GapBar gap={t.gap_ms} maxGap={maxGap} color={color} />
          <div className="flex justify-between">
            <p className="text-[9px] mono" style={{ color:'var(--t3)' }}>{t.faster.laps} tur</p>
            <p className="text-[9px] mono" style={{ color:'var(--t3)' }}>{t.slower.laps} tur</p>
          </div>
        </div>
        {/* Yavaş */}
        <div className="shrink-0" style={{ width:44 }}>
          <p className="text-[15px] font-black mono" style={{ color:'rgba(240,244,255,0.3)' }}>
            {t.slower.code}
          </p>
          <p className="text-[9px] mono" style={{ color:'var(--t3)' }}>{formatLapTime(t.slower.median)}</p>
        </div>
      </div>
      {/* En hızlı tur */}
      <div className="flex justify-between mt-2.5 pt-2 border-t text-[9px] mono"
        style={{ borderColor:'rgba(255,255,255,0.04)', color:'var(--t3)' }}>
        <span>
          En hızlı:{' '}
          <span style={{ color:'#00D2BE' }}>{formatLapTime(t.faster.best)}</span>
          <span className="mx-1" style={{ color:'rgba(255,255,255,0.12)' }}>vs</span>
          <span style={{ color:'rgba(240,244,255,0.35)' }}>{formatLapTime(t.slower.best)}</span>
        </span>
        <span>
          best Δ{' '}
          <span style={{ color:'#00D2BE' }}>
            {(t.slower.best - t.faster.best).toFixed(3)}s
          </span>
        </span>
      </div>
    </div>
  )
}

export function TeammatePace({ sessionId }: Props) {
  const [subTab, setSubTab]   = useState<'teams' | 'custom'>('teams')
  const [dA, setDA]           = useState('')
  const [dB, setDB]           = useState('')

  const { data, isLoading, isError } = useQuery({
    queryKey: ['teammate-pace', sessionId],
    queryFn:  () => client.get(`/sessions/${sessionId}/teammate_pace`).then(r => r.data),
    staleTime: 3_600_000,
    retry: 1,
  })

  const teams: TeamData[]        = data?.teams        ?? []
  const allDrivers: DriverPace[] = data?.all_drivers  ?? []
  const sessionType: string      = data?.session_type ?? ''
  const isQuali = sessionType.includes('qualifying')
  const paceLabel = isQuali ? 'En İyi Tur' : 'Medyan Pace'
  const maxGap = Math.max(...teams.map(t => t.gap_ms), 0.001)

  // Serbest karşılaştırma için seçili pilotlar
  const paceMap = Object.fromEntries(allDrivers.map(d => [d.code, d]))
  const pA = dA ? paceMap[dA] : null
  const pB = dB ? paceMap[dB] : null
  const customFaster = pA && pB ? (pA.median <= pB.median ? pA : pB) : null
  const customSlower = pA && pB ? (pA.median <= pB.median ? pB : pA) : null
  const customGap    = customFaster && customSlower
    ? round3(customSlower.median - customFaster.median) : null

  // İlk yüklendiğinde varsayılan pilot seç
  if (!dA && allDrivers.length >= 2) {
    setTimeout(() => {
      setDA(allDrivers[0].code)
      setDB(allDrivers[1].code)
    }, 0)
  }

  function round3(n: number) { return Math.round(n * 1000) / 1000 }

  if (isLoading) return (
    <div className="card p-5 text-center">
      <p className="text-[12px] mono animate-pulse" style={{ color:'var(--t3)' }}>
        Pace verisi hesaplanıyor...
      </p>
    </div>
  )
  if (isError || (!teams.length && !allDrivers.length)) return (
    <div className="card p-5 text-center">
      <p className="text-[12px] mono" style={{ color:'var(--t3)' }}>
        Bu oturum için pace verisi bulunamadı.
      </p>
    </div>
  )

  return (
    <div className="card overflow-hidden">
      {/* Başlık */}
      <div className="px-5 py-4 border-b" style={{ borderColor:'var(--b1)' }}>
        <div className="flex items-center gap-3">
          <span className="text-xl">⚡</span>
          <div>
            <p className="text-[14px] font-bold text-white">Pace Karşılaştırması</p>
            <p className="text-[11px] mono mt-0.5" style={{ color:'var(--t3)' }}>
              {isQuali ? 'En iyi tur karşılaştırması' : 'Medyan tur süresi · güvenlik aracı / pit-out hariç'}
            </p>
          </div>
        </div>
      </div>

      {/* Alt sekmeler */}
      <div className="flex border-b" style={{ borderColor:'var(--b1)' }}>
        {([
          ['teams',  '👥 Takım Arkadaşları'],
          ['custom', '⚔️ Serbest Karşılaştırma'],
        ] as const).map(([t, label]) => (
          <button key={t} onClick={() => setSubTab(t)}
            className="flex-1 py-2.5 text-[12px] font-semibold transition-all"
            style={subTab === t
              ? { background:'rgba(225,6,0,0.08)', color:'#E10600', borderBottom:'2px solid #E10600' }
              : { color:'var(--t3)', borderBottom:'2px solid transparent' }}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Takım arkadaşları ─────────────────────────── */}
      {subTab === 'teams' && (
        <>
          {teams.map(t => <TeamRow key={t.team} t={t} maxGap={maxGap} />)}
          <div className="px-5 py-3">
            <p className="text-[10px] mono" style={{ color:'var(--t3)' }}>
              {isQuali
                ? 'Sıralama turunda en iyi tur süresi karşılaştırılıyor'
                : 'Uç değerler çıkarılmış (%5 alt, %15 üst) · En hızlı tur gerçek best lap'}
            </p>
          </div>
        </>
      )}

      {/* ── Serbest karşılaştırma ─────────────────────── */}
      {subTab === 'custom' && (
        <div className="px-5 py-5 space-y-5">
          {/* Pilot seçici */}
          <div className="flex items-center gap-3 flex-wrap">
            <select value={dA} onChange={e => setDA(e.target.value)}
              className="px-3 py-2.5 rounded-xl text-[15px] font-black mono cursor-pointer"
              style={{ background:'rgba(225,6,0,0.1)', border:'1px solid rgba(225,6,0,0.3)',
                       color:'#E10600', outline:'none', minWidth:90 }}>
              {allDrivers.filter(d => d.code !== dB).map(d => (
                <option key={d.code} value={d.code}>{d.code}</option>
              ))}
            </select>

            <span className="text-[16px] font-black" style={{ color:'var(--t3)' }}>vs</span>

            <select value={dB} onChange={e => setDB(e.target.value)}
              className="px-3 py-2.5 rounded-xl text-[15px] font-black mono cursor-pointer"
              style={{ background:'rgba(255,135,0,0.1)', border:'1px solid rgba(255,135,0,0.3)',
                       color:'#FF8700', outline:'none', minWidth:90 }}>
              {allDrivers.filter(d => d.code !== dA).map(d => (
                <option key={d.code} value={d.code}>{d.code}</option>
              ))}
            </select>
          </div>

          {/* Sonuç */}
          {customFaster && customSlower && customGap !== null && (
            <>
              {/* Ana skor */}
              <div className="rounded-2xl p-5 text-center"
                style={{ background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)' }}>
                <p className="text-[11px] mono mb-2" style={{ color:'var(--t3)' }}>
                  {isQuali ? 'EN İYİ TUR FARKI' : 'MEDYAN PACE FARKI'}
                </p>
                <p className="text-[42px] font-black mono leading-none"
                  style={{ color: customGap < 0.1 ? '#00D2BE' : customGap < 0.5 ? '#FFD700' : '#E10600' }}>
                  {customGap >= 1
                    ? `${customGap.toFixed(3)}s`
                    : `${(customGap * 1000).toFixed(0)}ms`}
                </p>
                <p className="text-[14px] font-bold mt-2">
                  <span style={{ color:'#E10600' }}>{customFaster.code}</span>
                  <span className="mx-2" style={{ color:'var(--t3)' }}>daha hızlı</span>
                  <span style={{ color:'#FF8700' }}>{customSlower.code}</span>
                  <span style={{ color:'var(--t3)' }}>'dan</span>
                </p>
              </div>

              {/* Detay tablo */}
              <div className="rounded-xl overflow-hidden border" style={{ borderColor:'var(--b1)' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontFamily:'IBM Plex Mono,monospace' }}>
                  <thead>
                    <tr style={{ background:'rgba(255,255,255,0.03)' }}>
                      <th style={{ padding:'8px 14px', textAlign:'left', fontSize:9,
                        fontWeight:600, letterSpacing:'0.12em', color:'rgba(240,244,255,0.25)' }}>
                        METRİK
                      </th>
                      <th style={{ padding:'8px 14px', textAlign:'center', fontSize:11,
                        fontWeight:900, color:'#E10600' }}>{customFaster.code}</th>
                      <th style={{ padding:'8px 14px', textAlign:'center', fontSize:11,
                        fontWeight:900, color:'#FF8700' }}>{customSlower.code}</th>
                      <th style={{ padding:'8px 14px', textAlign:'right', fontSize:9,
                        fontWeight:600, letterSpacing:'0.1em', color:'rgba(240,244,255,0.25)' }}>
                        FARK
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      {
                        label: paceLabel,
                        a: formatLapTime(customFaster.median),
                        b: formatLapTime(customSlower.median),
                        diff: `+${customGap.toFixed(3)}s`,
                        diffColor: '#E10600',
                      },
                      {
                        label: 'En İyi Tur',
                        a: formatLapTime(customFaster.best),
                        b: formatLapTime(customSlower.best),
                        diff: `+${(customSlower.best - customFaster.best).toFixed(3)}s`,
                        diffColor: '#00D2BE',
                      },
                      {
                        label: 'Analiz Edilen Tur',
                        a: `${customFaster.laps}`,
                        b: `${customSlower.laps}`,
                        diff: '',
                        diffColor: 'var(--t3)',
                      },
                    ].map(row => (
                      <tr key={row.label} style={{ borderTop:'1px solid rgba(255,255,255,0.05)' }}>
                        <td style={{ padding:'10px 14px', fontSize:11, color:'rgba(240,244,255,0.4)' }}>
                          {row.label}
                        </td>
                        <td style={{ padding:'10px 14px', textAlign:'center',
                          fontSize:13, fontWeight:700, color:'white' }}>{row.a}</td>
                        <td style={{ padding:'10px 14px', textAlign:'center',
                          fontSize:13, fontWeight:700, color:'rgba(240,244,255,0.45)' }}>{row.b}</td>
                        <td style={{ padding:'10px 14px', textAlign:'right',
                          fontSize:12, fontWeight:700, color: row.diffColor }}>{row.diff}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Tüm pilotlara göre sıralama */}
              <div>
                <p className="text-[10px] mono font-semibold tracking-widest mb-2"
                  style={{ color:'var(--t3)' }}>
                  TÜM PILOTLARA GÖRE PACE SIRALAMASI
                </p>
                <div className="space-y-1">
                  {allDrivers.map((d, i) => {
                    const isA = d.code === dA
                    const isB = d.code === dB
                    const ref = allDrivers[0].median
                    const gap = round3(d.median - ref)
                    const barPct = Math.min((gap / (allDrivers[allDrivers.length-1].median - ref + 0.001)) * 100, 100)
                    return (
                      <div key={d.code}
                        className="flex items-center gap-3 px-3 py-1.5 rounded-lg transition-all"
                        style={{
                          background: isA ? 'rgba(225,6,0,0.08)' : isB ? 'rgba(255,135,0,0.08)' : 'transparent',
                          border: isA ? '1px solid rgba(225,6,0,0.2)' : isB ? '1px solid rgba(255,135,0,0.2)' : '1px solid transparent',
                        }}>
                        <span className="text-[11px] mono w-5 shrink-0"
                          style={{ color: i===0?'#FFD700':i===1?'#C0C0C0':i===2?'#CD7F32':'rgba(240,244,255,0.25)' }}>
                          {i+1}
                        </span>
                        <span className="text-[13px] font-black mono w-10 shrink-0"
                          style={{ color: isA?'#E10600': isB?'#FF8700':'rgba(240,244,255,0.6)' }}>
                          {d.code}
                        </span>
                        <div className="flex-1 h-1 rounded-full" style={{ background:'rgba(255,255,255,0.06)' }}>
                          <div className="h-full rounded-full"
                            style={{ width:`${barPct}%`,
                              background: isA?'#E10600': isB?'#FF8700':'rgba(255,255,255,0.2)' }} />
                        </div>
                        <span className="text-[11px] mono shrink-0 w-20 text-right"
                          style={{ color:'rgba(240,244,255,0.4)' }}>
                          {i === 0 ? '— lider' : `+${gap.toFixed(3)}s`}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
