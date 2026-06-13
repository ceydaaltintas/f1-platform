import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Helmet } from 'react-helmet-async'
import { seasonApi } from '../api/client'
import { SESSION_LABELS, type Round, type SessionType } from '../types/f1'
import { ErrorCard } from '../components/ui/ErrorCard'

const FLAG: Record<string, string> = {
  Australia:'🇦🇺', China:'🇨🇳', Japan:'🇯🇵', Bahrain:'🇧🇭',
  'Saudi Arabia':'🇸🇦', USA:'🇺🇸', Canada:'🇨🇦', Monaco:'🇲🇨',
  Spain:'🇪🇸', Austria:'🇦🇹', 'Great Britain':'🇬🇧', Hungary:'🇭🇺',
  Belgium:'🇧🇪', Netherlands:'🇳🇱', Italy:'🇮🇹', Azerbaijan:'🇦🇿',
  Singapore:'🇸🇬', Mexico:'🇲🇽', Brazil:'🇧🇷', Qatar:'🇶🇦', 'Abu Dhabi':'🇦🇪',
  UK:'🇬🇧',
}

function formatDate(d: string|null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('tr-TR', { day:'numeric', month:'long' })
}

function RoundCard({ round, index, highlight }: { round: Round; index: number; highlight?: boolean }) {
  const flag   = FLAG[round.country ?? ''] ?? '🏁'
  const done   = round.round_status === 'completed'
  const hasActiveSess = round.sessions.some(s => s.status === 'active')

  return (
    <div
      className="card group p-5 transition-all duration-300 hover:border-white/15"
      style={{
        animationDelay: `${index * 40}ms`,
        borderColor: highlight ? 'rgba(225,6,0,0.3)' : undefined,
        background:  highlight ? 'rgba(225,6,0,0.03)' : undefined,
      }}
    >
      <div className="flex justify-between items-start gap-3 mb-4">
        {/* Left: flag + info */}
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-3xl shrink-0">{flag}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-[10px] mono font-semibold px-1.5 py-0.5 rounded"
                style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--t3)' }}>
                TUR {round.round_number}
              </span>
              {hasActiveSess && (
                <span className="flex items-center gap-1 text-[10px] mono font-bold px-2 py-0.5
                                 rounded-full bg-[#E10600]/15 text-[#E10600] border border-[#E10600]/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#E10600] animate-pulse" />
                  CANLI
                </span>
              )}
              {!hasActiveSess && done && (
                <span className="text-[10px] mono font-medium" style={{ color: 'rgba(0,210,190,0.7)' }}>
                  ✓ TAMAMLANDI
                </span>
              )}
              {!hasActiveSess && !done && highlight && (
                <span className="text-[10px] mono font-bold px-2 py-0.5 rounded-full
                                 bg-[#E10600]/10 text-[#E10600] border border-[#E10600]/20">
                  SIRA­DAKİ
                </span>
              )}
              {!hasActiveSess && !done && !highlight && (
                <span className="text-[10px] mono font-medium px-2 py-0.5 rounded-full
                                 bg-[#E10600]/10 text-[#E10600] border border-[#E10600]/20">
                  YAKLAŞIYOR
                </span>
              )}
            </div>
            <p className="font-bold text-white text-[15px] leading-tight truncate">
              {round.name}
            </p>
            <p className="text-[12px] mt-0.5 truncate" style={{ color: 'var(--t2)' }}>
              {round.circuit_name} · {formatDate(round.race_date)}
            </p>
          </div>
        </div>
      </div>

      {/* Sessions row */}
      {round.sessions.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {round.sessions.map(s => {
            const isFinished = s.status === 'finished'
            const isActive   = s.status === 'active'
            return (
              <Link
                key={s.id}
                to={isActive ? `/live/${s.id}` : `/session/${s.id}`}
                className="text-[11px] font-medium px-3 py-1.5 rounded-lg border transition-all flex items-center gap-1.5"
                style={{
                  background: isActive ? 'rgba(225,6,0,0.12)' : isFinished
                    ? 'rgba(255,255,255,0.04)' : 'transparent',
                  borderColor: isActive ? 'rgba(225,6,0,0.5)' : isFinished
                    ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.05)',
                  color: isActive ? '#E10600' : isFinished
                    ? 'rgba(240,244,255,0.6)' : 'rgba(240,244,255,0.25)',
                }}>
                {isActive && (
                  <span className="w-1.5 h-1.5 rounded-full bg-[#E10600] animate-pulse" />
                )}
                {SESSION_LABELS[s.type as SessionType] ?? s.type}
                {isActive && <span className="text-[9px] font-bold ml-0.5">CANLI</span>}
              </Link>
            )
          })}
        </div>
      ) : (
        <p className="text-[12px] italic" style={{ color: 'var(--t3)' }}>
          Oturum verisi henüz yok
        </p>
      )}
    </div>
  )
}

export function SeasonPage() {
  const { year } = useParams<{ year: string }>()
  const y = Number(year)

  const [activeTab, setActiveTab] = useState<'upcoming' | 'completed'>('upcoming')

  const season = useQuery({
    queryKey: ['seasons'],
    queryFn: () => seasonApi.list(),
    select: ss => ss.find(s => s.year === y),
  })

  const rounds = useQuery({
    queryKey: ['rounds', y],
    queryFn: () => seasonApi.rounds(y),
    enabled: !!y,
    staleTime: 300_000,
  })

  const completed = rounds.data?.filter(r => r.round_status === 'completed') ?? []
  const upcoming  = rounds.data?.filter(r => r.round_status === 'upcoming')  ?? []

  // Sayfa açılışında tamamlanan yoksa upcoming'e, upcoming yoksa completed'a git
  const effectiveTab = activeTab

  if (rounds.isLoading) return (
    <div className="min-h-screen p-6" style={{ background: 'var(--bg)' }}>
      <div className="max-w-5xl mx-auto space-y-4 pt-8">
        {Array(6).fill(0).map((_,i) => (
          <div key={i} className="h-28 rounded-2xl animate-pulse" style={{ background:'var(--s1)' }} />
        ))}
      </div>
    </div>
  )

  if (rounds.isError) return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background:'var(--bg)' }}>
      <div className="max-w-md w-full">
        <ErrorCard
          title={`${y} sezonu yüklenemedi`}
          message="Sezon verisi bulunamadı veya henüz senkronize edilmedi."
          hint={`İlk kez yüklemek için: POST /api/v1/seasons/${y}/sync`}
          onRetry={() => window.location.reload()}
        />
      </div>
    </div>
  )

  const pct = season.data && season.data.round_count > 0
    ? Math.round(season.data.rounds_completed / season.data.round_count * 100) : 0

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
      <Helmet>
        <title>{`${y} F1 Sezonu — Yarış Takvimi ve Telemetri · Hotlap`}</title>
        <meta name="description" content={`Formula 1 ${y} sezonu yarış takvimi, telemetri analizleri ve canlı yarış takibi. Hotlap.live`} />
      </Helmet>

      {/* ── Season Header ──────────────────────────── */}
      <div className="border-b" style={{ borderColor: 'var(--b1)', background: 'var(--s1)' }}>
        <div className="max-w-5xl mx-auto px-6 py-8">
          <Link to="/" className="text-[12px] mono mb-4 inline-block hover:text-white transition-colors"
            style={{ color: 'var(--t3)' }}>← Ana Sayfa</Link>

          <div className="flex flex-col sm:flex-row sm:items-end gap-4 justify-between">
            <div>
              <p className="text-[11px] mono font-semibold tracking-[0.25em] mb-2"
                style={{ color: 'rgba(225,6,0,0.7)' }}>FORMULA 1</p>
              <div className="flex items-baseline gap-3">
                <h1 className="text-5xl font-black text-white">{y}</h1>
                <span className="text-2xl font-light" style={{ color: 'var(--t2)' }}>Sezonu</span>
              </div>
              {season.data && (
                <p className="text-[13px] mt-2" style={{ color: 'var(--t2)' }}>
                  <span className="text-white font-semibold">{season.data.rounds_completed}</span> yarış tamamlandı
                  {season.data.rounds_upcoming > 0 && (
                    <span> · <span className="font-semibold">{season.data.rounds_upcoming}</span> yarış kaldı</span>
                  )}
                </p>
              )}
            </div>

            <div className="flex items-center gap-4">
              {season.data?.is_current && (
                <span className="text-[11px] mono font-semibold px-3 py-1.5 rounded-full
                                 bg-[#E10600]/15 text-[#E10600] border border-[#E10600]/25">
                  AKTİF SEZON
                </span>
              )}
              <div className="text-right">
                <span className="text-3xl font-black text-white mono">{pct}%</span>
                <p className="text-[10px] mono" style={{ color: 'var(--t3)' }}>tamamlandı</p>
              </div>
            </div>
          </div>

          {/* Progress bar */}
          <div className="h-1 rounded-full mt-5" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <div className="h-1 rounded-full transition-all duration-700"
              style={{ width:`${pct}%`, background:'linear-gradient(90deg,#E10600,#ff4520)' }} />
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6">

        {/* ── Tab seçici ─────────────────────────────────── */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setActiveTab('upcoming')}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-semibold transition-all"
            style={effectiveTab === 'upcoming'
              ? { background:'rgba(225,6,0,0.12)', color:'#E10600', border:'1px solid rgba(225,6,0,0.3)' }
              : { background:'var(--s1)', color:'var(--t3)', border:'1px solid var(--b1)' }}>
            🏎 Yaklaşanlar
            <span className="text-[10px] px-1.5 py-0.5 rounded-md font-black mono"
              style={effectiveTab === 'upcoming'
                ? { background:'rgba(225,6,0,0.2)', color:'#E10600' }
                : { background:'var(--s2)', color:'var(--t3)' }}>
              {upcoming.length}
            </span>
          </button>
          <button
            onClick={() => setActiveTab('completed')}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-semibold transition-all"
            style={effectiveTab === 'completed'
              ? { background:'rgba(255,215,0,0.1)', color:'#FFD700', border:'1px solid rgba(255,215,0,0.3)' }
              : { background:'var(--s1)', color:'var(--t3)', border:'1px solid var(--b1)' }}>
            🏆 Tamamlananlar
            <span className="text-[10px] px-1.5 py-0.5 rounded-md font-black mono"
              style={effectiveTab === 'completed'
                ? { background:'rgba(255,215,0,0.15)', color:'#FFD700' }
                : { background:'var(--s2)', color:'var(--t3)' }}>
              {completed.length}
            </span>
          </button>
        </div>

        {/* ── YAKLAŞANLAR ──────────────────────────────────── */}
        {effectiveTab === 'upcoming' && (
          <div className="space-y-3">
            {upcoming.length === 0 ? (
              <div className="text-center py-20">
                <p className="text-[40px] mb-4">🏁</p>
                <p className="text-[16px] font-bold text-white mb-2">Sezon tamamlandı!</p>
                <p className="text-[13px] mono" style={{ color:'var(--t3)' }}>
                  {y} sezonu tüm yarışları tamamlandı.
                </p>
                <button onClick={() => setActiveTab('completed')}
                  className="mt-5 px-4 py-2 rounded-xl text-[12px] mono font-semibold transition-all"
                  style={{ background:'rgba(255,215,0,0.1)', color:'#FFD700',
                           border:'1px solid rgba(255,215,0,0.3)' }}>
                  🏆 Sonuçlara git →
                </button>
              </div>
            ) : (
              upcoming.map((r, i) => (
                <RoundCard key={r.id} round={r} index={i} highlight={i === 0} />
              ))
            )}
          </div>
        )}

        {/* ── TAMAMLANANLAR ────────────────────────────────── */}
        {effectiveTab === 'completed' && (
          <div className="space-y-3">
            {completed.length === 0 ? (
              <div className="text-center py-20">
                <p className="text-[13px] mono" style={{ color:'var(--t3)' }}>
                  Henüz tamamlanan yarış yok.
                </p>
              </div>
            ) : (
              /* En son tamamlanan en üstte */
              [...completed].reverse().map((r, i) => (
                <RoundCard key={r.id} round={r} index={i} />
              ))
            )}
          </div>
        )}

      </div>
    </div>
  )
}
