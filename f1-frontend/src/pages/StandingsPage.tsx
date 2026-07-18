import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Helmet } from 'react-helmet-async'
import { client } from '../api/client'
import { ErrorCard } from '../components/ui/ErrorCard'
import { useFavoritesStore } from '../store/favoritesStore'
import { ChampionshipScenario } from '../components/analysis/ChampionshipScenario'
import { HeadToHead } from '../components/analysis/HeadToHead'
import { FantasyPicks } from '../components/fantasy/FantasyPicks'
import { useTranslation } from 'react-i18next'

// Mevcut yılı baz alarak yıl seçenekleri üret — 2027 gelince otomatik güncellenir
function buildYearOptions(currentYear: number): number[] {
  return [currentYear, currentYear - 1, currentYear - 2]
}

// Pozisyon rengi
function posColor(i: number) {
  if (i === 0) return '#FFD700'
  if (i === 1) return '#C0C0C0'
  if (i === 2) return '#CD7F32'
  return 'var(--t3)'
}

const TEAM_COLORS: Record<string, string> = {
  red_bull: '#3671C6', mclaren: '#FF8000', ferrari: '#E8002D', mercedes: '#27F4D2',
  aston_martin: '#229971', alpine: '#FF87BC', williams: '#64C4FF', rb: '#6692FF',
  audi: '#F50537', haas: '#B6BABD', cadillac: '#909090',
}

const NATIONALITY_FLAG: Record<string, string> = {
  Italian: '🇮🇹', British: '🇬🇧', Dutch: '🇳🇱', Monegasque: '🇲🇨', Australian: '🇦🇺',
  Spanish: '🇪🇸', German: '🇩🇪', French: '🇫🇷', Canadian: '🇨🇦', Mexican: '🇲🇽',
  Finnish: '🇫🇮', Japanese: '🇯🇵', Chinese: '🇨🇳', Thai: '🇹🇭', American: '🇺🇸',
  'New Zealander': '🇳🇿', Brazilian: '🇧🇷', Argentine: '🇦🇷', Danish: '🇩🇰',
  Austrian: '🇦🇹', Swiss: '🇨🇭',
}

function DriverProfileCard({ driverId, teamColor }: { driverId: string; teamColor: string }) {
  const { t } = useTranslation()
  const { data, isLoading } = useQuery({
    queryKey: ['driver-profile', driverId],
    queryFn: () => client.get(`/drivers/${driverId}/profile`).then(r => r.data),
    staleTime: 86_400_000,
  })

  if (isLoading) return (
    <div className="px-4 pb-4 pt-2 border-t" style={{ borderColor:'rgba(255,255,255,0.06)' }}>
      <div className="h-16 rounded-lg animate-pulse" style={{ background:'rgba(255,255,255,0.03)' }} />
    </div>
  )

  if (!data) return null
  const stats = [
    { label: t('standings.results').toUpperCase(), value: data.total_races, color: 'white' },
    { label: t('standings_page.wins'), value: data.wins, color: data.wins > 0 ? '#FFD700' : 'white' },
    { label: 'PODIUM', value: data.podiums, color: data.podiums > 0 ? '#00D2BE' : 'white' },
    { label: 'POLE', value: data.poles, color: data.poles > 0 ? '#a855f7' : 'white' },
    { label: 'DEBUT', value: data.debut_year ?? '—', color: 'var(--t2)' },
  ]

  return (
    <div className="px-4 pb-4 pt-2 border-t" style={{ borderColor:'rgba(255,255,255,0.06)' }}
      onClick={e => e.stopPropagation()}>
      <div className="flex gap-2 flex-wrap">
        {stats.map(s => (
          <div key={s.label} className="rounded-lg px-3 py-2 flex-1 min-w-[70px]"
            style={{ background:'rgba(255,255,255,0.03)' }}>
            <p className="text-[9px] mono" style={{ color:'var(--t3)' }}>{s.label}</p>
            <p className="text-[16px] font-black mono mt-0.5" style={{ color: s.color }}>{s.value}</p>
          </div>
        ))}
      </div>
      {data.bio && (
        <div className="mt-2 rounded-lg px-3 py-2.5" style={{ background: teamColor + '08', borderLeft: `3px solid ${teamColor}` }}>
          <p className="text-[12px] leading-relaxed" style={{ color:'var(--t2)' }}>{data.bio}</p>
        </div>
      )}
    </div>
  )
}

export function StandingsPage() {
  const { t, i18n } = useTranslation()
  const { year } = useParams<{ year: string }>()

  // Aktif sezonu API'den çek — hardcoded yıl yok
  const currentSeasonQ = useQuery({
    queryKey: ['current-season-year'],
    queryFn:  () => client.get('/seasons').then(r => {
      const seasons: any[] = r.data
      const cur = seasons.find((s: any) => s.is_current)
      return cur?.year ?? new Date().getFullYear()
    }),
    staleTime: 3_600_000,
  })
  const currentYear = currentSeasonQ.data ?? new Date().getFullYear()
  const y = Number(year) || currentYear
  const YEAR_OPTIONS = buildYearOptions(currentYear)

  const [tab, setTab] = useState<'drivers' | 'constructors' | 'results' | 'scenarios' | 'h2h' | 'fantasy'>('drivers')
  const [expandedDriver, setExpandedDriver] = useState<string | null>(null)

  // Senaryolar, H2H ve Fantasy yalnızca güncel sezonda
  const isCurrentYear = currentSeasonQ.isSuccess && y === currentYear
  const effectiveTab = (!isCurrentYear && (tab === 'scenarios' || tab === 'h2h' || tab === 'fantasy')) ? 'drivers' : tab

  // Jolpica down olunca DB'den fallback
  // Önce 3s içinde cevap gelmezse direkt DB'ye geç
  const withFallback = async (jolpicaUrl: string, fallbackFn: () => Promise<any>) => {
    try {
      const result = await Promise.race([
        client.get(jolpicaUrl).then(r => r.data),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 3_000)
        ),
      ])
      return result
    } catch {
      return fallbackFn()
    }
  }

  const drivers = useQuery({
    queryKey: ['standings', 'drivers', y],
    queryFn:  () => withFallback(
      `/seasons/${y}/standings/drivers`,
      async () => {
        const db = await client.get(`/drivers?season=${y}`).then(r => r.data)
        return (db ?? []).map((d: any, i: number) => ({
          position: i + 1, points: '—', wins: 0,
          code: d.code, first_name: d.first_name, last_name: d.last_name,
          driver_id: d.jolpica_id,
          team_name: d.current_team?.name ?? '—',
          team_id:   d.current_team?.jolpica_id ?? '',
          fallback:  true,
        }))
      }
    ),
    enabled:  effectiveTab === 'drivers',
    staleTime: 300_000,
    retry: 0,
  })

  const constructors = useQuery({
    queryKey: ['standings', 'constructors', y],
    queryFn:  () => withFallback(
      `/seasons/${y}/standings/constructors`,
      async () => {
        const db = await client.get(`/teams?season=${y}`).then(r => r.data)
        return (db ?? []).map((t: any, i: number) => ({
          position: i + 1, points: '—', wins: 0,
          team_id: t.jolpica_id, team_name: t.name,
          nationality: t.nationality ?? '—', fallback: true,
        }))
      }
    ),
    enabled:  effectiveTab === 'constructors',
    staleTime: 300_000,
    retry: 0,
  })

  const results = useQuery({
    queryKey: ['season', 'results', y],
    queryFn:  () => withFallback(
      `/seasons/${y}/results`,
      async () => []
    ),
    enabled:  effectiveTab === 'results',
    staleTime: 300_000,
    retry: 0,
  })

  // Fantasy için bir sonraki round'u doğrudan DB'den al — Jolpica yavaş
  // kaldığında results.data.length'e dayanmak yanlış round numarası verip
  // 404'e (ve boş Fantasy sekmesine) yol açıyordu.
  const nextRound = useQuery({
    queryKey: ['next-round', y],
    queryFn:  () => client.get(`/seasons/${y}/next`).then(r => r.data),
    enabled:  effectiveTab === 'fantasy',
    staleTime: 300_000,
    retry: 0,
  })

  const isFallback    = !!(drivers.data?.[0]?.fallback || constructors.data?.[0]?.fallback)
  const { toggleDriver, isFavorite } = useFavoritesStore()
  const maxDriverPts  = Math.max(1, ...(drivers.data?.map((d: any) => Number(d.points) || 0) ?? [0]))
  const maxConstrPts  = Math.max(1, ...(constructors.data?.map((c: any) => Number(c.points) || 0) ?? [0]))
  const leaderPts     = Number(drivers.data?.[0]?.points) || 0

  const isLoading = (effectiveTab === 'drivers' && drivers.isLoading) ||
    (effectiveTab === 'constructors' && constructors.isLoading) ||
    (effectiveTab === 'results' && results.isLoading)

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
      <Helmet>
        <title>{`${y} F1 Şampiyona Tablosu · Hotlap`}</title>
        <meta name="description" content={`${y} Formula 1 pilot ve takım şampiyona sıralaması. Güncel puan tablosu ve yarış sonuçları.`} />
        <link rel="canonical" href={`https://hotlap.live/standings/${y}`} />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="Hotlap" />
        <meta property="og:title" content={`${y} F1 Şampiyona Tablosu · Hotlap`} />
        <meta property="og:description" content={`${y} Formula 1 pilot ve takım şampiyona sıralaması. Güncel puan tablosu ve yarış sonuçları.`} />
        <meta property="og:url" content={`https://hotlap.live/standings/${y}`} />
        <meta property="og:image" content="https://hotlap.live/og-image.png" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:site" content="@hotlapapp" />
        <meta name="twitter:title" content={`${y} F1 Şampiyona Tablosu · Hotlap`} />
        <meta name="twitter:description" content={`${y} Formula 1 pilot ve takım şampiyona sıralaması. Güncel puan tablosu ve yarış sonuçları.`} />
      </Helmet>
      <div className="max-w-4xl mx-auto px-6 py-8">

        {/* ── Başlık ──────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <Link to="/" className="text-[11px] mono mb-2 block hover:text-white transition-colors"
              style={{ color:'var(--t3)' }}>{t('standings_page.back_home')}</Link>
            <h1 className="text-3xl font-black text-white">{t('standings.title', { year: y })}</h1>
            <p className="text-[13px] mt-1" style={{ color:'var(--t2)' }}>{t('standings_page.year_season', { year: y })}</p>
          </div>
          {/* Yıl seçici */}
          <div className="flex gap-2">
            {YEAR_OPTIONS.map(yr => (
              <Link key={yr} to={`/standings/${yr}`}
                className="px-3 py-1.5 rounded-lg text-[12px] font-semibold mono transition-all"
                style={yr === y
                  ? { background:'rgba(225,6,0,0.12)', color:'#E10600', border:'1px solid rgba(225,6,0,0.3)' }
                  : { background:'var(--s1)', color:'var(--t3)', border:'1px solid var(--b1)' }}>
                {yr}
              </Link>
            ))}
          </div>
        </div>

        {/* ── Tab seçici ──────────────────────────────────────── */}
        <div className="flex p-1 rounded-xl mb-6" style={{ background:'var(--s1)' }}>
          {([
            ['drivers',      `🏎 ${t('standings.drivers')}`],
            ['constructors', `🔧 ${t('standings.constructors')}`],
            ['results',      `🏁 ${t('standings.results')}`],
            ...(y === currentYear
              ? [['scenarios', `📊 ${t('standings_page.scenarios')}`], ['h2h', `⚔️ ${t('standings_page.h2h')}`], ['fantasy', `🎮 ${t('standings.fantasy')}`]] as const
              : []),
          ] as const).map(([t, label]) => (
            <button key={t} onClick={() => setTab(t as any)}
              className="flex-1 py-2.5 rounded-lg text-[13px] font-semibold transition-all"
              style={effectiveTab === t
                ? { background:'#E10600', color:'white' }
                : { color:'var(--t3)' }}>
              {label}
            </button>
          ))}
        </div>

        {/* ── Fallback banner ─────────────────────────────────── */}
        {isFallback && !isLoading && (
          <div className="rounded-xl px-4 py-3 mb-4 flex items-center gap-3"
            style={{ background:'rgba(255,135,0,0.08)', border:'1px solid rgba(255,135,0,0.2)' }}>
            <span>⚠️</span>
            <p className="text-[12px]" style={{ color:'rgba(255,135,0,0.9)' }}>
              {t('standings_page.fallback_warning')}
            </p>
          </div>
        )}

        {/* ── Loading ─────────────────────────────────────────── */}
        {isLoading && (
          <div className="space-y-2">
            {Array(12).fill(0).map((_, i) => (
              <div key={i} className="h-14 rounded-xl animate-pulse" style={{ background:'var(--s1)' }} />
            ))}
          </div>
        )}

        {/* ── Hata durumu ─────────────────────────────────────── */}
        {(
          (effectiveTab === 'drivers'      && !drivers.isLoading      && drivers.isError) ||
          (effectiveTab === 'constructors' && !constructors.isLoading && constructors.isError) ||
          (effectiveTab === 'results'      && !results.isLoading      && results.isError)
        ) && (
          <ErrorCard
            title={t('standings_page.error_title')}
            message={t('standings_page.error_msg')}
            hint={t('standings_page.error_hint')}
            onRetry={() => {
              if (effectiveTab === 'drivers')      drivers.refetch()
              if (effectiveTab === 'constructors') constructors.refetch()
              if (effectiveTab === 'results')      results.refetch()
            }}
          />
        )}

        {/* ── Pilotlar ─────────────────────────────────────────── */}
        {effectiveTab === 'drivers' && !drivers.isLoading && (
          <div className="space-y-1.5">
            {(drivers.data ?? []).map((d: any, i: number) => {
              const pct     = (d.points / maxDriverPts) * 100
              const gapPts  = leaderPts - d.points
              const isLeader = i === 0
              return (
                <div key={d.driver_id}
                  className="rounded-xl border transition-all cursor-pointer"
                  onClick={() => setExpandedDriver(expandedDriver === d.driver_id ? null : d.driver_id)}
                  style={{
                    background: isLeader ? 'rgba(255,215,0,0.04)' : 'var(--s1)',
                    borderColor: expandedDriver === d.driver_id
                      ? (TEAM_COLORS[d.team_id] ?? '#888') + '60'
                      : isLeader ? 'rgba(255,215,0,0.2)' : 'var(--b1)',
                  }}>
                  <div className="flex items-center gap-3 px-4 py-3">
                    {/* Pozisyon */}
                    <span className="text-[15px] font-black mono w-7 text-right shrink-0"
                      style={{ color: posColor(i) }}>
                      {d.position}
                    </span>

                    {/* Takım renk çubuğu */}
                    <div className="w-1 h-10 rounded-full shrink-0"
                      style={{ background: TEAM_COLORS[d.team_id] ?? '#888' }} />

                    {/* Pilot */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[15px] font-black mono text-white">{d.code}</span>
                        <span className="text-[13px] font-semibold" style={{ color:'var(--t2)' }}>
                          {d.first_name} {d.last_name}
                        </span>
                        <span className="text-[12px]">{NATIONALITY_FLAG[d.nationality] ?? ''}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] mono px-1.5 py-0.5 rounded"
                          style={{ background: (TEAM_COLORS[d.team_id] ?? '#888') + '20',
                                   color: TEAM_COLORS[d.team_id] ?? '#888',
                                   border: `1px solid ${(TEAM_COLORS[d.team_id] ?? '#888')}30` }}>
                          {d.team_name}
                        </span>
                        {d.number && d.number !== '—' && (
                          <span className="text-[10px] mono" style={{ color:'var(--t3)' }}>#{d.number}</span>
                        )}
                      </div>
                      {/* Puan barı */}
                      <div className="h-1 rounded-full mt-2 overflow-hidden"
                        style={{ background:'rgba(255,255,255,0.06)' }}>
                        <div className="h-1 rounded-full transition-all duration-700"
                          style={{
                            width: `${pct}%`,
                            background: isLeader
                              ? 'linear-gradient(90deg,#E10600,#ff4520)'
                              : 'rgba(255,255,255,0.3)',
                          }} />
                      </div>
                    </div>

                    {/* Puan + fark */}
                    <div className="text-right shrink-0">
                      <p className="text-[18px] font-black mono text-white leading-none">
                        {d.points === '—' ? '—' : d.points}
                      </p>
                      {!isLeader && gapPts > 0 && d.points !== '—' && (
                        <p className="text-[10px] mono mt-0.5" style={{ color:'var(--t3)' }}>
                          -{gapPts} pts
                        </p>
                      )}
                    </div>

                    {/* Galibiyet */}
                    {d.wins > 0 && (
                      <div className="text-center shrink-0 ml-1">
                        <p className="text-[14px] font-black" style={{ color:'#FFD700' }}>{d.wins}</p>
                        <p className="text-[8px] mono" style={{ color:'var(--t3)' }}>{t('standings_page.wins')}</p>
                      </div>
                    )}

                    {/* Favori yıldızı */}
                    <button
                      onClick={e => { e.stopPropagation(); toggleDriver(d.code) }}
                      className="shrink-0 ml-1 text-lg transition-all hover:scale-110"
                      title={isFavorite(d.code) ? t('standings_page.favorite_remove') : t('standings_page.favorite_add')}
                    >
                      {isFavorite(d.code) ? '⭐' : '☆'}
                    </button>
                  </div>

                  {/* Bilgi kartı */}
                  {expandedDriver === d.driver_id && (
                    <DriverProfileCard driverId={d.driver_id} teamColor={TEAM_COLORS[d.team_id] ?? '#888'} />
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* ── Takımlar ─────────────────────────────────────────── */}
        {effectiveTab === 'constructors' && !constructors.isLoading && (
          <div className="space-y-1.5">
            {(constructors.data ?? []).map((c: any, i: number) => {
              const pct = (c.points / maxConstrPts) * 100
              return (
                <div key={c.team_id}
                  className="rounded-xl border transition-all"
                  style={{
                    background: i===0 ? 'rgba(255,215,0,0.04)' : 'var(--s1)',
                    borderColor: i===0 ? 'rgba(255,215,0,0.2)' : 'var(--b1)',
                  }}>
                  <div className="flex items-center gap-3 px-4 py-3">
                    <span className="text-[15px] font-black mono w-7 text-right shrink-0"
                      style={{ color: posColor(i) }}>
                      {c.position}
                    </span>

                    {/* Takım renk çubuğu */}
                    <div className="w-1 h-10 rounded-full shrink-0"
                      style={{ background: TEAM_COLORS[c.team_id] ?? '#888' }} />

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[15px] font-bold text-white">{c.team_name}</span>
                        <span className="text-[12px]">{NATIONALITY_FLAG[c.nationality] ?? ''}</span>
                      </div>
                      <div className="h-1.5 rounded-full mt-2 overflow-hidden"
                        style={{ background:'rgba(255,255,255,0.06)' }}>
                        <div className="h-1.5 rounded-full transition-all duration-700"
                          style={{
                            width: `${pct}%`,
                            background: TEAM_COLORS[c.team_id] ?? (i===0
                              ? 'linear-gradient(90deg,#E10600,#ff4520)'
                              : 'rgba(255,255,255,0.3)'),
                          }} />
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <p className="text-[18px] font-black mono text-white leading-none">
                        {c.points === '—' ? '—' : c.points}
                      </p>
                      {i > 0 && c.points !== '—' && (constructors.data?.[0]?.points ?? 0) !== '—' && (
                        <p className="text-[10px] mono mt-0.5" style={{ color:'var(--t3)' }}>
                          -{Number(constructors.data?.[0]?.points ?? 0) - Number(c.points)} pts
                        </p>
                      )}
                    </div>

                    {c.wins > 0 && (
                      <div className="text-center shrink-0 ml-1">
                        <p className="text-[14px] font-black" style={{ color:'#FFD700' }}>{c.wins}</p>
                        <p className="text-[8px] mono" style={{ color:'var(--t3)' }}>{t('standings_page.wins')}</p>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* ── Yarış Sonuçları ──────────────────────────────────── */}
        {effectiveTab === 'results' && !results.isLoading && (
          <div className="space-y-2">
            {(results.data ?? []).map((r: any) => (
              <Link key={r.round} to={`/recap/${y}/${r.round}`}
                className="block rounded-xl border transition-all hover:border-white/10 overflow-hidden"
                style={{ background:'var(--s1)', borderColor:'var(--b1)' }}>
                <div className="flex items-start gap-4 px-4 py-3.5">
                  <span className="text-[13px] font-black mono shrink-0 w-8 text-center
                                   pt-0.5 rounded-lg"
                    style={{ color:'var(--t3)', background:'var(--s2)' }}>
                    {r.round}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-bold text-white leading-tight">{r.race_name}</p>
                    <p className="text-[11px] mt-0.5 truncate" style={{ color:'var(--t3)' }}>
                      {r.circuit}
                    </p>
                    <p className="text-[10px] mono mt-1" style={{ color:'var(--t3)' }}>
                      {r.date
                        ? new Date(r.date).toLocaleDateString(i18n?.language?.startsWith('tr') ? 'tr-TR' : 'en-GB', { day:'numeric', month:'long', year:'numeric' })
                        : '—'}
                    </p>
                  </div>
                  <div className="shrink-0 text-right space-y-1">
                    {r.podium?.length > 0 ? (
                      r.podium.slice(0,3).map((p: any, pi: number) => (
                        <div key={pi} className="flex items-center justify-end gap-1.5">
                          <span className="text-[10px]">{pi===0?'🥇':pi===1?'🥈':'🥉'}</span>
                          <span className="text-[12px] font-black mono text-white">{p.code}</span>
                          <span className="text-[10px] mono" style={{ color:'var(--t3)' }}>
                            {p.team?.split(' ')[0]}
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="flex items-center justify-end gap-1.5">
                        <span className="text-[12px]">🥇</span>
                        <span className="text-[12px] font-black mono" style={{ color:'#E10600' }}>
                          {r.winner_code}
                        </span>
                        <span className="text-[10px] mono" style={{ color:'var(--t3)' }}>{r.team}</span>
                      </div>
                    )}
                  </div>
                </div>
              </Link>
            ))}
            {(!results.data || results.data.length === 0) && (
              <div className="text-center py-16">
                <p className="text-[14px] mb-2" style={{ color:'var(--t3)' }}>{t('standings.no_results')}</p>
              </div>
            )}
          </div>
        )}

        {/* ── Şampiyona Senaryoları ────────────────────────────── */}
        {effectiveTab === 'scenarios' && (
          <ChampionshipScenario year={y} />
        )}

        {/* ── Head-to-Head ─────────────────────────────────────── */}
        {effectiveTab === 'h2h' && (
          <HeadToHead />
        )}

        {/* ── Fantasy F1 ──────────────────────────────────────── */}
        {effectiveTab === 'fantasy' && (
          nextRound.data?.round_number
            ? <FantasyPicks year={y} roundNumber={nextRound.data.round_number} />
            : nextRound.isError
              ? (
                <div className="card p-4 text-center">
                  <p className="text-[12px]" style={{ color: 'var(--t3)' }}>
                    {t('standings_page.season_not_found')}
                  </p>
                </div>
              )
              : (
                <div className="card p-4">
                  {[1,2,3].map(i => <div key={i} className="h-10 rounded mb-2 animate-pulse" style={{ background: 'var(--s2)' }}/>)}
                </div>
              )
        )}

      </div>
    </div>
  )
}
