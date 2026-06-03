/**
 * Head-to-Head Karşılaştırma
 * Yıl bazında puan rekabeti + pist bazında kim daha başarılı
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { client } from '../../api/client'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts'

const CURRENT_YEAR = new Date().getFullYear()
const YEARS_RANGE  = Array.from({ length: 7 }, (_, i) => CURRENT_YEAR - i).reverse()

interface YearResult {
  year: number
  p1: { points: number; wins: number; position: number }
  p2: { points: number; wins: number; position: number }
  winner: 'p1' | 'p2' | 'equal'
}

interface CircuitResult {
  circuit: string
  c1_wins: number; c2_wins: number
  c1_podiums: number; c2_podiums: number
  races: number
}

async function fetchSeasonComparison(year: number, code1: string, code2: string) {
  const data = await client.get(`/seasons/${year}/standings/drivers`).then(r => r.data)
  if (!Array.isArray(data)) return null
  const d1 = data.find((d: any) => d.code?.toUpperCase() === code1.toUpperCase())
  const d2 = data.find((d: any) => d.code?.toUpperCase() === code2.toUpperCase())
  if (!d1 || !d2) return null
  return {
    year,
    p1: { points: d1.points, wins: d1.wins, position: d1.position },
    p2: { points: d2.points, wins: d2.wins, position: d2.position },
    winner: d1.points > d2.points ? 'p1' : d2.points > d1.points ? 'p2' : 'equal',
  } as YearResult
}

export function HeadToHead() {
  const [d1, setD1]         = useState('VER')
  const [d2, setD2]         = useState('NOR')
  const [subTab, setSubTab] = useState<'seasons' | 'circuits'>('seasons')

  // Mevcut sezondaki pilotları çek — dropdown için
  const driversQ = useQuery({
    queryKey: ['drivers-list'],
    queryFn:  () => client.get(`/seasons/${CURRENT_YEAR}/standings/drivers`).then(r => r.data),
    staleTime: 3_600_000,
  })
  const driverCodes: string[] = (driversQ.data ?? []).map((d: any) => d.code).filter(Boolean)

  // Yıl bazında karşılaştırma
  const comparison = useQuery({
    queryKey: ['h2h-seasons', d1, d2],
    queryFn:  async () => {
      const results = await Promise.allSettled(
        YEARS_RANGE.map(y => fetchSeasonComparison(y, d1, d2))
      )
      return results
        .filter(r => r.status === 'fulfilled' && r.value !== null)
        .map(r => (r as PromiseFulfilledResult<YearResult>).value)
    },
    enabled:  d1.length >= 2 && d2.length >= 2,
    staleTime: 3_600_000,
  })

  // Pist bazında karşılaştırma
  const circuits = useQuery({
    queryKey: ['h2h-circuits', d1, d2],
    queryFn:  () =>
      client.get(`/h2h/circuits?driver1=${d1}&driver2=${d2}&year_from=2022`).then(r => r.data),
    enabled:  subTab === 'circuits' && d1.length >= 2 && d2.length >= 2,
    staleTime: 86_400_000,
  })

  const seasons: YearResult[] = comparison.data ?? []
  const circuitData: CircuitResult[] = circuits.data ?? []

  const stats = seasons.reduce(
    (acc, s) => ({
      d1wins:     acc.d1wins     + (s.winner === 'p1' ? 1 : 0),
      d2wins:     acc.d2wins     + (s.winner === 'p2' ? 1 : 0),
      d1points:   acc.d1points   + s.p1.points,
      d2points:   acc.d2points   + s.p2.points,
      d1raceWins: acc.d1raceWins + s.p1.wins,
      d2raceWins: acc.d2raceWins + s.p2.wins,
    }),
    { d1wins:0, d2wins:0, d1points:0, d2points:0, d1raceWins:0, d2raceWins:0 }
  )

  const chartData = seasons.map(s => ({ year: s.year, [d1]: s.p1.points, [d2]: s.p2.points }))

  return (
    <div className="card overflow-hidden">
      {/* Başlık + pilot seçimi */}
      <div className="px-5 py-4 border-b" style={{ borderColor:'var(--b1)' }}>
        <div className="flex items-center gap-3 mb-4">
          <span className="text-xl">⚔️</span>
          <div>
            <p className="text-[14px] font-bold text-white">Head-to-Head Karşılaştırma</p>
            <p className="text-[11px] mono mt-0.5" style={{ color:'var(--t3)' }}>
              Son {YEARS_RANGE.length} sezonda puan rekabeti ve pist başarısı
            </p>
          </div>
        </div>

        {/* Dropdown pilot seçici */}
        <div className="flex items-center gap-3 flex-wrap">
          <select value={d1} onChange={e => setD1(e.target.value)}
            className="px-3 py-2.5 rounded-xl text-[16px] font-black mono cursor-pointer"
            style={{ background:'rgba(225,6,0,0.1)', border:'1px solid rgba(225,6,0,0.3)',
                     color:'#E10600', outline:'none', minWidth:90 }}>
            {driverCodes.filter(c => c !== d2).map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
            {!driverCodes.includes(d1) && <option value={d1}>{d1}</option>}
          </select>

          <span className="text-[18px] font-black" style={{ color:'var(--t3)' }}>vs</span>

          <select value={d2} onChange={e => setD2(e.target.value)}
            className="px-3 py-2.5 rounded-xl text-[16px] font-black mono cursor-pointer"
            style={{ background:'rgba(255,135,0,0.1)', border:'1px solid rgba(255,135,0,0.3)',
                     color:'#FF8700', outline:'none', minWidth:90 }}>
            {driverCodes.filter(c => c !== d1).map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
            {!driverCodes.includes(d2) && <option value={d2}>{d2}</option>}
          </select>

          {driversQ.isLoading && (
            <p className="text-[11px] mono animate-pulse" style={{ color:'var(--t3)' }}>
              Pilot listesi yükleniyor...
            </p>
          )}
        </div>
      </div>

      {/* Alt sekmeler */}
      <div className="flex border-b" style={{ borderColor:'var(--b1)' }}>
        {([
          ['seasons',  '📅 Sezon Bazında'],
          ['circuits', '🏎 Pist Bazında'],
        ] as const).map(([t, label]) => (
          <button key={t} onClick={() => setSubTab(t)}
            className="flex-1 py-2.5 text-[12px] font-semibold transition-all"
            style={subTab===t
              ? { background:'rgba(225,6,0,0.08)', color:'#E10600', borderBottom:'2px solid #E10600' }
              : { color:'var(--t3)', borderBottom:'2px solid transparent' }}>
            {label}
          </button>
        ))}
      </div>

      {/* ── SEZON BAZINDA ───────────────────────────────────── */}
      {subTab === 'seasons' && (
        comparison.isLoading ? (
          <div className="p-8 text-center">
            <p className="text-[12px] mono animate-pulse" style={{ color:'var(--t3)' }}>Yükleniyor...</p>
          </div>
        ) : !seasons.length ? (
          <div className="p-8 text-center">
            <p className="text-[12px] mono" style={{ color:'var(--t3)' }}>
              Bu yıl aralığında ortak sezon bulunamadı.
            </p>
          </div>
        ) : (
          <>
            {/* Skor */}
            <div className="grid grid-cols-3 border-b" style={{ borderColor:'var(--b1)' }}>
              <div className="px-5 py-4 text-center border-r" style={{ borderColor:'var(--b1)' }}>
                <p className="text-[32px] font-black mono" style={{ color:'#E10600' }}>{d1}</p>
                <div className="flex justify-center gap-4 mt-2">
                  <div><p className="text-[20px] font-black mono text-white">{stats.d1wins}</p>
                       <p className="text-[9px] mono" style={{ color:'var(--t3)' }}>SEZON</p></div>
                  <div><p className="text-[20px] font-black mono text-white">{stats.d1raceWins}</p>
                       <p className="text-[9px] mono" style={{ color:'var(--t3)' }}>GALİBİYET</p></div>
                </div>
              </div>
              <div className="px-5 py-4 text-center flex flex-col items-center justify-center">
                <p className="text-[11px] mono mb-1" style={{ color:'var(--t3)' }}>{seasons.length} SEZON</p>
                {stats.d1wins !== stats.d2wins ? (
                  <>
                    <p className="text-[13px] font-black"
                      style={{ color: stats.d1wins > stats.d2wins ? '#E10600':'#FF8700' }}>
                      {stats.d1wins > stats.d2wins ? d1 : d2} üstün
                    </p>
                    <p className="text-[26px] font-black mono text-white mt-1">
                      {Math.max(stats.d1wins,stats.d2wins)}–{Math.min(stats.d1wins,stats.d2wins)}
                    </p>
                  </>
                ) : (
                  <p className="text-[26px] font-black mono text-white">{stats.d1wins}–{stats.d2wins}</p>
                )}
              </div>
              <div className="px-5 py-4 text-center border-l" style={{ borderColor:'var(--b1)' }}>
                <p className="text-[32px] font-black mono" style={{ color:'#FF8700' }}>{d2}</p>
                <div className="flex justify-center gap-4 mt-2">
                  <div><p className="text-[20px] font-black mono text-white">{stats.d2wins}</p>
                       <p className="text-[9px] mono" style={{ color:'var(--t3)' }}>SEZON</p></div>
                  <div><p className="text-[20px] font-black mono text-white">{stats.d2raceWins}</p>
                       <p className="text-[9px] mono" style={{ color:'var(--t3)' }}>GALİBİYET</p></div>
                </div>
              </div>
            </div>

            {/* Grafik */}
            <div className="px-5 py-5">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData} barGap={4}>
                  <CartesianGrid strokeDasharray="3 8" stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis dataKey="year"
                    tick={{ fill:'rgba(240,244,255,0.3)', fontSize:10, fontFamily:'IBM Plex Mono,monospace' }}
                    tickLine={false} axisLine={{ stroke:'rgba(255,255,255,0.08)' }} />
                  <YAxis tick={{ fill:'rgba(240,244,255,0.3)', fontSize:10, fontFamily:'IBM Plex Mono,monospace' }}
                    tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ background:'rgba(5,8,15,0.97)', border:'1px solid rgba(255,255,255,0.1)',
                    borderRadius:12, fontFamily:'IBM Plex Mono,monospace', fontSize:12 }}
                    labelStyle={{ color:'rgba(240,244,255,0.4)' }} />
                  <Legend formatter={v => <span style={{ color:'rgba(240,244,255,0.6)', fontSize:11 }}>{v}</span>} />
                  <Bar dataKey={d1} fill="#E10600" radius={[3,3,0,0]} opacity={0.9} />
                  <Bar dataKey={d2} fill="#FF8700" radius={[3,3,0,0]} opacity={0.9} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Sezon listesi */}
            <div className="px-5 pb-5 space-y-2">
              {[...seasons].reverse().map(s => {
                const wColor = s.winner==='p1'?'#E10600':s.winner==='p2'?'#FF8700':undefined
                return (
                  <div key={s.year} className="flex items-center px-4 py-2.5 rounded-xl border"
                    style={{ borderColor: wColor?wColor+'25':'var(--b1)',
                             background: wColor?wColor+'06':'var(--s2)' }}>
                    <span className="text-[13px] font-black mono w-14 shrink-0"
                      style={{ color: wColor??'var(--t3)' }}>{s.year}</span>
                    <div className="flex-1 flex items-center gap-4">
                      <span className="text-[13px] font-bold mono" style={{ color:'#E10600', minWidth:56 }}>
                        {s.p1.points} pts
                      </span>
                      <span className="text-[11px]" style={{ color:'var(--t3)' }}>vs</span>
                      <span className="text-[13px] font-bold mono" style={{ color:'#FF8700', minWidth:56 }}>
                        {s.p2.points} pts
                      </span>
                    </div>
                    {s.winner!=='equal' ? (
                      <span className="text-[11px] mono font-bold shrink-0" style={{ color:wColor }}>
                        {s.winner==='p1'?d1:d2} +{Math.abs(s.p1.points-s.p2.points)} pts
                      </span>
                    ) : (
                      <span className="text-[10px] mono" style={{ color:'var(--t3)' }}>Eşit</span>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )
      )}

      {/* ── PİST BAZINDA ────────────────────────────────────── */}
      {subTab === 'circuits' && (
        circuits.isLoading ? (
          <div className="p-8 text-center">
            <p className="text-[12px] mono animate-pulse" style={{ color:'var(--t3)' }}>
              Pist verileri yükleniyor (birkaç saniye sürebilir)...
            </p>
          </div>
        ) : !circuitData.length ? (
          <div className="p-8 text-center">
            <p className="text-[12px] mono" style={{ color:'var(--t3)' }}>
              Bu iki pilot için ortak yarış bulunamadı.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table style={{ width:'100%', borderCollapse:'collapse', fontFamily:'IBM Plex Mono,monospace' }}>
              <thead>
                <tr style={{ background:'rgba(255,255,255,0.02)', borderBottom:'1px solid rgba(255,255,255,0.07)' }}>
                  {['Pist','Yarış','',d1+' Galip','',d2+' Galip','',d1+' Podyum','',d2+' Podyum'].map((h,i) => (
                    <th key={i} style={{ padding:'8px 10px', textAlign: i===0?'left':'center',
                      fontSize:9, fontWeight:600, letterSpacing:'0.1em',
                      color: h===d1+' Galip'||h===d1+' Podyum' ? '#E10600'
                           : h===d2+' Galip'||h===d2+' Podyum' ? '#FF8700'
                           : 'rgba(240,244,255,0.25)',
                      whiteSpace:'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {circuitData.map(c => {
                  const total = c.c1_wins + c.c2_wins
                  const w1pct = total > 0 ? (c.c1_wins / total) * 100 : 50
                  const d1Better = c.c1_wins > c.c2_wins
                  const d2Better = c.c2_wins > c.c1_wins
                  return (
                    <tr key={c.circuit} style={{ borderBottom:'1px solid rgba(255,255,255,0.04)' }}>
                      <td style={{ padding:'9px 10px', fontSize:12, fontWeight:600, color:'white',
                        maxWidth:180, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {c.circuit}
                      </td>
                      <td style={{ padding:'9px 10px', textAlign:'center', fontSize:11, color:'rgba(240,244,255,0.3)' }}>
                        {c.races}
                      </td>
                      {/* Bar */}
                      <td style={{ padding:'4px 8px', minWidth:120 }}>
                        <div style={{ height:6, borderRadius:3, overflow:'hidden', background:'rgba(255,255,255,0.08)', display:'flex' }}>
                          <div style={{ width:`${w1pct}%`, background:'#E10600', transition:'width 0.5s' }} />
                          <div style={{ flex:1, background:'#FF8700' }} />
                        </div>
                      </td>
                      <td style={{ padding:'9px 10px', textAlign:'center', fontSize:14, fontWeight:900,
                        color: d1Better?'#E10600':'rgba(240,244,255,0.25)' }}>
                        {c.c1_wins}
                      </td>
                      <td style={{ padding:'9px 4px', textAlign:'center', fontSize:11, color:'rgba(240,244,255,0.15)' }}>
                        –
                      </td>
                      <td style={{ padding:'9px 10px', textAlign:'center', fontSize:14, fontWeight:900,
                        color: d2Better?'#FF8700':'rgba(240,244,255,0.25)' }}>
                        {c.c2_wins}
                      </td>
                      <td style={{ padding:'9px 4px' }} />
                      <td style={{ padding:'9px 10px', textAlign:'center', fontSize:12, fontWeight:700,
                        color: c.c1_podiums>c.c2_podiums?'#E10600':'rgba(240,244,255,0.4)' }}>
                        {c.c1_podiums}
                      </td>
                      <td style={{ padding:'9px 4px', textAlign:'center', fontSize:11, color:'rgba(240,244,255,0.15)' }}>
                        –
                      </td>
                      <td style={{ padding:'9px 10px', textAlign:'center', fontSize:12, fontWeight:700,
                        color: c.c2_podiums>c.c1_podiums?'#FF8700':'rgba(240,244,255,0.4)' }}>
                        {c.c2_podiums}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div className="px-5 py-3 border-t" style={{ borderColor:'var(--b1)' }}>
              <p className="text-[10px] mono" style={{ color:'var(--t3)' }}>
                2022–{CURRENT_YEAR} arası yarışlar · Galip = daha yüksek bitiş pozisyonu · Bar = galip oranı
              </p>
            </div>
          </div>
        )
      )}
    </div>
  )
}
