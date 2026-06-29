import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Helmet } from 'react-helmet-async'
import { client } from '../api/client'
import { CommentFeed } from '../components/community/CommentFeed'

const MEDAL = ['🥇', '🥈', '🥉']

const TEAM_COLORS: Record<string, string> = {
  'Red Bull': '#3671C6', 'McLaren': '#FF8000', 'Ferrari': '#E8002D', 'Mercedes': '#27F4D2',
  'Aston Martin': '#229971', 'Alpine': '#FF87BC', 'Williams': '#64C4FF',
  'Racing Bulls': '#6692FF', 'Audi': '#F50537', 'Haas F1 Team': '#B6BABD', 'Cadillac': '#909090',
}

function teamColor(name: string): string {
  for (const [k, v] of Object.entries(TEAM_COLORS)) {
    if (name.includes(k)) return v
  }
  return '#888'
}

export function RecapPage() {
  const { year, round } = useParams<{ year: string; round: string }>()
  const y = Number(year) || 2026
  const r = Number(round) || 1

  const { data, isLoading, isError } = useQuery({
    queryKey: ['race-recap', y, r],
    queryFn: () => client.get(`/seasons/${y}/rounds/${r}/recap`).then(res => res.data),
    staleTime: 300_000,
  })

  if (isLoading) return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="space-y-4">
        {Array(5).fill(0).map((_, i) => (
          <div key={i} className="h-16 rounded-xl animate-pulse" style={{ background: 'var(--s1)' }} />
        ))}
      </div>
    </div>
  )

  if (isError || !data) return (
    <div className="max-w-4xl mx-auto px-4 py-8 text-center">
      <p className="text-[14px]" style={{ color: 'var(--t3)' }}>Yarış özeti bulunamadı</p>
      <Link to={`/standings/${y}`} className="text-[13px] mt-2 inline-block" style={{ color: '#E10600' }}>
        Şampiyona sayfasına dön
      </Link>
    </div>
  )

  const results: any[] = data.results ?? []
  const podium: any[] = data.podium ?? []
  const gainers: any[] = data.gainers ?? []
  const losers: any[] = data.losers ?? []
  const dnfs: any[] = data.dnfs ?? []

  // Yarış session ID'sini bulmak için (yorum sistemi için)
  // Round number'dan hesaplayamayız ama yorum sistemi session_id ister
  // Şimdilik round_number*5 gibi bir tahmin yapmak yerine, yorumları round bazlı yapalım

  return (
    <>
      <Helmet>
        <title>{data.race_name} Yarış Özeti — Hotlap</title>
        <meta name="description" content={`${data.race_name} ${y} yarış özeti, sonuçlar ve analiz. ${podium[0]?.driver ?? ''} kazandı.`} />
      </Helmet>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">

        {/* Header */}
        <div>
          <Link to={`/standings/${y}`} className="text-[11px] mono" style={{ color: 'var(--t3)' }}>
            ← {y} Sezonu
          </Link>
          <div className="flex items-baseline gap-3 mt-2 flex-wrap">
            <span className="text-[10px] mono px-2 py-1 rounded"
              style={{ background: 'rgba(225,6,0,0.1)', color: '#E10600', border: '1px solid rgba(225,6,0,0.3)' }}>
              TUR {data.round}
            </span>
            <h1 className="text-[28px] font-black text-white leading-tight">{data.race_name}</h1>
          </div>
          <p className="text-[13px] mt-1" style={{ color: 'var(--t2)' }}>
            {data.circuit} · {data.date}
          </p>
        </div>

        {/* Podyum */}
        <div className="card overflow-hidden">
          <div className="px-5 py-3 border-b" style={{ borderColor: 'var(--b1)' }}>
            <p className="text-[13px] font-bold text-white">Podyum</p>
          </div>
          <div className="grid grid-cols-3 gap-0">
            {podium.map((p: any, i: number) => (
              <div key={p.code} className="px-4 py-5 text-center"
                style={{
                  borderRight: i < 2 ? '1px solid rgba(255,255,255,0.06)' : 'none',
                  background: i === 0 ? 'rgba(255,215,0,0.04)' : 'transparent',
                }}>
                <span className="text-3xl">{MEDAL[i]}</span>
                <p className="text-[18px] font-black mono text-white mt-2">{p.code}</p>
                <p className="text-[12px] font-semibold" style={{ color: 'var(--t2)' }}>{p.driver}</p>
                <p className="text-[11px] mono mt-1" style={{ color: teamColor(p.team) }}>{p.team}</p>
                <p className="text-[10px] mono mt-2" style={{ color: 'var(--t3)' }}>
                  {p.time} {p.grid > 0 && `· Grid P${p.grid}`}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* AI Özet */}
        {data.recap && (
          <div className="card overflow-hidden">
            <div className="px-5 py-3 border-b flex items-center gap-2" style={{ borderColor: 'var(--b1)' }}>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded"
                style={{ background: 'rgba(225,6,0,0.15)', color: '#E10600' }}>AI</span>
              <p className="text-[13px] font-bold text-white">Yarış Özeti</p>
            </div>
            <div className="px-5 py-4">
              <p className="text-[14px] leading-relaxed" style={{ color: 'var(--t2)' }}>
                {data.recap}
              </p>
            </div>
          </div>
        )}

        {/* Sonuçlar tablosu */}
        <div className="card overflow-hidden">
          <div className="px-5 py-3 border-b" style={{ borderColor: 'var(--b1)' }}>
            <p className="text-[13px] font-bold text-white">Yarış Sonuçları</p>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'IBM Plex Mono, monospace' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)' }}>
                {['P', 'PİLOT', 'TAKIM', 'GRİD', 'DEĞ.', 'PUAN'].map((h, i) => (
                  <th key={h} style={{
                    padding: '8px 10px', fontSize: 9, fontWeight: 600, letterSpacing: '0.1em',
                    color: 'rgba(240,244,255,0.25)',
                    textAlign: i === 0 || i >= 3 ? 'center' : 'left',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {results.map((d: any) => {
                const isDnf = d.status !== 'Finished' && !d.status.includes('Lap')
                return (
                  <tr key={d.code} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <td style={{ padding: '8px 10px', fontSize: 13, fontWeight: 900, textAlign: 'center',
                      color: d.position <= 3 ? ['#FFD700', '#C0C0C0', '#CD7F32'][d.position - 1] : 'rgba(240,244,255,0.3)' }}>
                      {isDnf ? 'DNF' : d.position}
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      <div className="flex items-center gap-2">
                        <div className="w-1 h-5 rounded-full" style={{ background: teamColor(d.team) }} />
                        <span className="text-[13px] font-bold text-white">{d.code}</span>
                        <span className="text-[11px] hidden sm:inline" style={{ color: 'var(--t3)' }}>{d.driver.split(' ')[0]}</span>
                      </div>
                    </td>
                    <td style={{ padding: '8px 10px', fontSize: 11, color: teamColor(d.team) }}>{d.team}</td>
                    <td style={{ padding: '8px 10px', fontSize: 12, textAlign: 'center', color: 'var(--t3)' }}>P{d.grid}</td>
                    <td style={{ padding: '8px 10px', fontSize: 11, fontWeight: 700, textAlign: 'center',
                      color: d.change > 0 ? '#00D2BE' : d.change < 0 ? '#f87171' : 'var(--t3)' }}>
                      {isDnf ? '—' : d.change > 0 ? `▲${d.change}` : d.change < 0 ? `▼${Math.abs(d.change)}` : '—'}
                    </td>
                    <td style={{ padding: '8px 10px', fontSize: 12, fontWeight: 700, textAlign: 'center',
                      color: d.points > 0 ? 'white' : 'var(--t3)' }}>
                      {d.points || '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Öne çıkanlar */}
        <div className="grid sm:grid-cols-2 gap-4">
          {/* Yükselenler */}
          {gainers.length > 0 && (
            <div className="card p-4">
              <p className="text-[11px] mono font-semibold mb-3" style={{ color: '#00D2BE' }}>▲ EN ÇOK YÜKSELENLer</p>
              <div className="space-y-2">
                {gainers.map((g: any) => (
                  <div key={g.code} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-bold text-white">{g.code}</span>
                      <span className="text-[10px]" style={{ color: 'var(--t3)' }}>P{g.grid} → P{g.position}</span>
                    </div>
                    <span className="text-[12px] font-bold" style={{ color: '#00D2BE' }}>+{g.change}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Düşenler */}
          {losers.length > 0 && (
            <div className="card p-4">
              <p className="text-[11px] mono font-semibold mb-3" style={{ color: '#f87171' }}>▼ EN ÇOK DÜŞENLer</p>
              <div className="space-y-2">
                {losers.map((l: any) => (
                  <div key={l.code} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-bold text-white">{l.code}</span>
                      <span className="text-[10px]" style={{ color: 'var(--t3)' }}>P{l.grid} → P{l.position}</span>
                    </div>
                    <span className="text-[12px] font-bold" style={{ color: '#f87171' }}>{l.change}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* DNF'ler */}
        {dnfs.length > 0 && (
          <div className="card p-4">
            <p className="text-[11px] mono font-semibold mb-3" style={{ color: 'var(--t3)' }}>TAMAMLAYAMAYANLAR</p>
            <div className="flex flex-wrap gap-2">
              {dnfs.map((d: any) => (
                <span key={d.code} className="text-[11px] mono px-2 py-1 rounded"
                  style={{ background: 'rgba(248,113,113,0.1)', color: '#f87171', border: '1px solid rgba(248,113,113,0.2)' }}>
                  {d.code} — {d.status}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Yorumlar */}
        <div className="card overflow-hidden">
          <div className="px-5 py-3 border-b" style={{ borderColor: 'var(--b1)' }}>
            <p className="text-[13px] font-bold text-white">Yorumlar</p>
          </div>
          <div className="p-4">
            <p className="text-[12px] text-center py-4" style={{ color: 'var(--t3)' }}>
              Yorum sistemi yakında aktif olacak
            </p>
          </div>
        </div>
      </div>
    </>
  )
}
