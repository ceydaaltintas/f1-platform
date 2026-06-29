import React, { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Helmet } from 'react-helmet-async'
import { seasonApi, client } from '../api/client'
import { buildPageSEO } from '../utils/seo'
import { SESSION_LABELS, type SessionType } from '../types/f1'
import { RaceGlobe } from '../components/globe/RaceGlobe'

function LiveTicker() {
  // Aktif sezonu dinamik çek — 2027 gelince otomatik güncellenir
  const currentYear = useQuery({
    queryKey: ['current-year'],
    queryFn: () => client.get('/seasons').then(r => {
      const cur = (r.data as any[]).find(s => s.is_current)
      return cur?.year ?? new Date().getFullYear()
    }),
    staleTime: 3_600_000,
  })
  const y = currentYear.data ?? new Date().getFullYear()

  const standings = useQuery({
    queryKey: ['standings-ticker', y],
    queryFn: () => client.get(`/seasons/${y}/standings/drivers`).then(r => r.data),
    enabled: !!currentYear.data,
    staleTime: 300_000,
  })

  const items: string[] = standings.data
    ? [
        `🏆 ${y} Pilot Şampiyonası`,
        ...standings.data.slice(0, 10).map((d: any) =>
          `${d.position}. ${d.code} · ${d.points} puan`
        ),
      ]
    : ['Şampiyona verisi yükleniyor...']

  // İki kopya yan yana → sonsuz kaydırma
  const doubled = [...items, ...items]

  return (
    <div className="border-y overflow-hidden" style={{ borderColor: 'var(--b1)', background: 'var(--s1)' }}>
      <div className="flex items-center">
        {/* Sabit etiket */}
        <div className="shrink-0 px-4 py-2.5 border-r flex items-center gap-2"
          style={{ borderColor: 'var(--b1)', background: 'rgba(225,6,0,0.1)' }}>
          <span className="w-1.5 h-1.5 rounded-full bg-[#E10600]"
            style={{ animation: 'pulse-dot 1s infinite' }} />
          <span className="text-[10px] mono font-bold text-[#E10600] tracking-widest whitespace-nowrap">
            CANLI
          </span>
        </div>
        {/* Kayan şerit */}
        <div className="ticker-wrap flex-1">
          <div className="ticker-inner gap-10 px-6 py-2.5">
            {doubled.map((item, i) => (
              <span key={i} className="text-[11px] mono font-medium shrink-0"
                style={{ color: 'var(--t2)' }}>
                {item}
                <span className="mx-5" style={{ color: 'var(--t3)' }}>·</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function daysUntil(d: string | null) {
  if (!d) return null
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86_400_000)
}
function formatShortDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })
}

// ── Canlı Geri Sayım ─────────────────────────────────────────────────────────
function useCountdown(targetDate: string | null) {
  const [t, setT] = React.useState({ d: 0, h: 0, m: 0, s: 0, past: false })
  useEffect(() => {
    const calc = () => {
      if (!targetDate) return
      const diff = new Date(targetDate).getTime() - Date.now()
      if (diff <= 0) { setT({ d:0, h:0, m:0, s:0, past: true }); return }
      const d = Math.floor(diff / 86_400_000)
      const h = Math.floor((diff % 86_400_000) / 3_600_000)
      const m = Math.floor((diff % 3_600_000) / 60_000)
      const s = Math.floor((diff % 60_000) / 1_000)
      setT({ d, h, m, s, past: false })
    }
    calc()
    const id = setInterval(calc, 1_000)
    return () => clearInterval(id)
  }, [targetDate])
  return t
}

// ── Geri sayım yardımcı bileşenleri ──────────────────────────────────────────
function TimeUnit({ value, label, color }: { value: string|number; label: string; color: string }) {
  return (
    <div className="text-center px-1">
      <p className="text-[38px] font-black mono leading-none" style={{ color }}>{value}</p>
      <p className="text-[8px] mono mt-1 tracking-widest" style={{ color:'rgba(240,244,255,0.65)' }}>
        {label}
      </p>
    </div>
  )
}

function Colon({ active = false, blink = false }: { active?: boolean; blink?: boolean }) {
  return (
    <p className="text-[28px] font-black mono pb-4 px-0.5 leading-none select-none"
      style={{
        color: active ? 'rgba(225,6,0,0.7)' : 'rgba(255,255,255,0.2)',
        animation: blink ? 'colon-blink 1s step-end infinite' : 'none',
      }}>
      :
      <style>{`@keyframes colon-blink { 0%,100%{opacity:1} 50%{opacity:0.15} }`}</style>
    </p>
  )
}

// ── Şampiyona Şeridi ──────────────────────────────────────────────────────────
function StandingsStrip() {
  const { data } = useQuery({
    queryKey: ['standings-strip'],
    queryFn:  () => client.get('/seasons/2026/standings/drivers').then(r => r.data),
    staleTime: 300_000,
  })
  if (!data?.length) return null
  return (
    <div className="border-b" style={{ borderColor:'var(--b1)', background:'var(--s1)' }}>
      <div className="max-w-5xl mx-auto px-6 py-2.5 flex items-center gap-6 overflow-x-auto">
        <p className="text-[9px] mono font-bold tracking-[0.2em] shrink-0"
          style={{ color:'var(--t3)' }}>
          🏆 ŞAMPİYONA
        </p>
        {data.slice(0,5).map((d: any, i: number) => (
          <div key={d.driver_id} className="flex items-center gap-2 shrink-0">
            <span className="text-[11px] mono font-bold" style={{ color:'var(--t3)' }}>
              {i+1}.
            </span>
            <span className="text-[12px] font-black mono text-white">{d.code}</span>
            <span className="text-[12px] font-bold mono" style={{ color:'var(--t2)' }}>
              {d.points}
            </span>
            {i < 4 && <span style={{ color:'var(--t3)' }}>·</span>}
          </div>
        ))}
        <Link to="/standings/2026" className="text-[10px] mono ml-auto shrink-0 hover:text-white transition-colors"
          style={{ color:'var(--t3)' }}>
          Tümü →
        </Link>
      </div>
    </div>
  )
}

const FLAG: Record<string, string> = {
  Australia:'🇦🇺', China:'🇨🇳', Japan:'🇯🇵', Bahrain:'🇧🇭',
  'Saudi Arabia':'🇸🇦', USA:'🇺🇸', Canada:'🇨🇦', Monaco:'🇲🇨',
  Spain:'🇪🇸', Austria:'🇦🇹', 'Great Britain':'🇬🇧', Hungary:'🇭🇺',
  Belgium:'🇧🇪', Netherlands:'🇳🇱', Italy:'🇮🇹', Azerbaijan:'🇦🇿',
  Singapore:'🇸🇬', Mexico:'🇲🇽', Brazil:'🇧🇷', Qatar:'🇶🇦', 'Abu Dhabi':'🇦🇪',
}

export function HomePage() {
  const seasons = useQuery({ queryKey:['seasons'], queryFn:()=>seasonApi.list(), staleTime:300_000 })
  const current = seasons.data?.find(s => s.is_current)

  // Tüm roundlar (küre için) — aktif sezonu kullan
  const allRounds = useQuery({
    queryKey: ['rounds', current?.year, 'all'],
    queryFn:  () => seasonApi.rounds(current!.year),
    enabled:  !!current?.year,
    staleTime: 300_000,
  })

  // Tamamlanan yarışların sonuçları
  const seasonResults = useQuery({
    queryKey: ['season-results', current?.year],
    queryFn:  () => client.get(`/seasons/${current!.year}/results`).then(r => r.data),
    enabled:  !!current?.year,
    staleTime: 600_000,
  })

  // round → podyum listesi [P1_kod, P2_kod, P3_kod]
  const raceResults: Record<number, { p1: string; p2: string; p3: string }> = {}
  if (seasonResults.data) {
    for (const race of seasonResults.data) {
      const rn: number = race.round
      if (!rn) continue
      if (race.podium?.length >= 1) {
        const fmt = (p: any) => p ? `${p.code}  ${p.name}` : '—'
        raceResults[rn] = {
          p1: fmt(race.podium[0]),
          p2: fmt(race.podium[1]),
          p3: fmt(race.podium[2]),
        }
      } else if (race.winner_code) {
        raceResults[rn] = {
          p1: race.winner_code + '  ' + (race.winner_name ?? ''),
          p2: '—', p3: '—',
        }
      }
    }
  }

  const nextRound = useQuery({
    queryKey: ['next-round', current?.year],
    queryFn:  () => seasonApi.nextRound(current!.year),
    enabled:  !!current,
    staleTime: 60_000,
  })

  const liveStatus = useQuery({
    queryKey: ['live-status'],
    queryFn:  () => client.get('/live/status').then(r => r.data),
    refetchInterval: 30_000,
  })

  const days      = daysUntil(nextRound.data?.race_date ?? null)
  const round     = nextRound.data
  const flag      = FLAG[round?.country ?? ''] ?? '🏁'
  const countdown = useCountdown(round?.race_datetime ?? round?.race_date ?? null)

  // Son tamamlanan yarış podyumu
  const completedRaces = seasonResults.data?.filter((r: any) => r.podium?.length > 0) ?? []
  const lastRace = completedRaces.at(-1) as any
  const lastRacePodium: any[] = lastRace?.podium?.slice(0, 3) ?? []

  const { title, description } = buildPageSEO({ path: '/' })

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
      <Helmet>
        <title>{title}</title>
        <meta name="description" content={description} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content="https://hotlap.live" />
        <meta name="twitter:card" content="summary_large_image" />
      </Helmet>

      {/* ── Hero: Sol = Küre, Sağ = Metin ──────────────────── */}
      <section className="relative overflow-hidden">
        {/* Arka plan grid */}
        <div className="absolute inset-0 opacity-[0.025]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,.8) 1px,transparent 1px),' +
              'linear-gradient(90deg,rgba(255,255,255,.8) 1px,transparent 1px)',
            backgroundSize: '48px 48px',
          }} />

        {/* Kırmızı glow — sağ tarafta */}
        <div className="absolute top-0 right-0 w-[500px] h-[500px] opacity-15 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse at 80% 20%, #E10600 0%, transparent 65%)',
            filter: 'blur(80px)',
          }} />

        <div className="relative max-w-7xl mx-auto px-6">
          <div className="flex flex-col lg:flex-row items-center gap-0 min-h-[640px]">

            {/* ── SOL: Küre ──────────────────────────────────── */}
            <div className="w-full lg:w-1/2 flex-shrink-0 py-6 lg:py-0">
              {allRounds.data && allRounds.data.length > 0 ? (
                <RaceGlobe
                  rounds={allRounds.data}
                  nextRoundNumber={nextRound.data?.round_number}
                  raceResults={raceResults}
                />
              ) : (
                /* Veri gelene kadar placeholder */
                <div className="card flex items-center justify-center" style={{ height: 560 }}>
                  <div className="flex gap-1.5">
                    {[0,1,2].map(i => (
                      <div key={i} className="w-2 h-2 rounded-full bg-[#E10600]"
                        style={{ animation:`bounce-dot 0.8s ${i*0.15}s infinite` }} />
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* ── SAĞ: Hero içerik ───────────────────────────── */}
            <div className="w-full lg:w-1/2 lg:pl-12 pb-12 lg:pb-0 flex flex-col justify-center">
              {/* Canlı yarış var mı? */}
              {liveStatus.data?.live && (
                <Link
                  to={`/live/${liveStatus.data.session_id}`}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full mb-8 w-fit
                             border border-[#E10600]/40 bg-[#E10600]/10 text-[#E10600]
                             text-[12px] font-semibold mono hover:bg-[#E10600]/20 transition-all"
                  style={{ animation: 'glow-pulse 2s infinite' }}
                >
                  <span className="w-2 h-2 rounded-full bg-[#E10600]"
                    style={{ animation: 'pulse-dot 1s infinite' }} />
                  CANLI YARIŞ — Takip Et
                </Link>
              )}

              <p className="text-[11px] mono font-semibold tracking-[0.3em] mb-4"
                style={{ color: 'rgba(225,6,0,0.8)' }}>
                FORMULA 1 TELEMETRİ PLATFORMU
              </p>

              <h1 className="text-4xl sm:text-5xl font-black leading-tight mb-5">
                <span className="text-white">Yarışı </span>
                <span className="grad-red">veriyle</span>
                <br />
                <span className="text-white">takip et.</span>
              </h1>

              <p className="text-[16px] leading-relaxed mb-8" style={{ color: 'var(--t2)', maxWidth: 420 }}>
                Gerçek zamanlı telemetri, AI destekli analiz,
                canlı pist haritası — F1 mühendislerinin gözünden.
              </p>

              <div className="flex flex-wrap gap-3">
                <Link to={`/season/${current?.year ?? new Date().getFullYear()}`}
                  className="px-6 py-3 rounded-xl font-semibold text-[14px] transition-all
                             bg-[#E10600] text-white hover:bg-[#cc0000]
                             hover:shadow-[0_0_32px_rgba(225,6,0,0.5)]">
                  {current?.year ?? new Date().getFullYear()} Sezonu →
                </Link>
                <Link to="/session/5"
                  className="px-6 py-3 rounded-xl font-semibold text-[14px] transition-all
                             border border-white/10 text-white/60 hover:border-white/20 hover:text-white
                             bg-white/[0.04]">
                  Telemetri Dene
                </Link>
              </div>

              {/* Hızlı istatistik */}
              <div className="flex gap-6 mt-10 pt-8 border-t" style={{ borderColor:'rgba(255,255,255,0.07)' }}>
                {[
                  { val: '24', label: 'Yarış' },
                  { val: '22', label: 'Pilot' },
                  { val: '10', label: 'Takım' },
                ].map(s => (
                  <div key={s.label}>
                    <p className="text-2xl font-black text-white">{s.val}</p>
                    <p className="text-[11px] mono" style={{ color:'var(--t3)' }}>{s.label}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Ticker + Şampiyona ───────────────────────────────── */}
      <LiveTicker />
      <StandingsStrip />

      {/* ── Sonraki Yarış + Son Yarış ─────────────────────────── */}
      {round && (
        <section className="max-w-5xl mx-auto px-6 py-10">
          <div className="grid lg:grid-cols-[1fr_300px] gap-5 items-start">

            {/* ── Sonraki Yarış — Büyük kart ─────────────────── */}
            <div className="card card-red glow-red overflow-hidden">
              {/* Üst başlık */}
              <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b"
                style={{ borderColor:'rgba(225,6,0,0.15)' }}>
                <div className="flex items-center gap-3">
                  <span className="text-[11px] mono font-semibold tracking-[0.2em]"
                    style={{ color:'rgba(225,6,0,0.7)' }}>
                    SONRAKİ YARIŞ
                  </span>
                  <span className="text-[11px] mono px-2 py-0.5 rounded-full"
                    style={{ background:'rgba(225,6,0,0.12)', color:'#E10600',
                             border:'1px solid rgba(225,6,0,0.25)' }}>
                    TUR {round.round_number}
                  </span>
                </div>
                <span className="text-3xl">{flag}</span>
              </div>

              <div className="px-6 py-5 flex flex-col sm:flex-row gap-6 justify-between">
                {/* Yarış bilgisi */}
                <div className="flex-1">
                  <h2 className="text-[28px] font-black text-white leading-tight mb-1">
                    {round.name}
                  </h2>
                  <p className="text-[13px] mb-5" style={{ color:'var(--t2)' }}>
                    {round.circuit_name}
                  </p>

                  {/* Geri sayım */}
                  {!countdown.past ? (
                    <div className="flex items-end gap-0">
                      {/* Gün */}
                      {countdown.d > 0 && <>
                        <TimeUnit value={countdown.d} label="GÜN" color="white" />
                        <Colon />
                      </>}
                      {/* Saat */}
                      {(countdown.d > 0 || countdown.h > 0) && <>
                        <TimeUnit value={String(countdown.h).padStart(2,'0')}
                          label="SAAT" color={countdown.d === 0 ? '#E10600' : 'white'} />
                        <Colon active={countdown.d === 0} />
                      </>}
                      {/* Dakika */}
                      <TimeUnit value={String(countdown.m).padStart(2,'0')}
                        label="DAK"
                        color={countdown.d===0 && countdown.h===0 ? '#E10600' : 'white'} />
                      <Colon active={countdown.d===0 && countdown.h===0} blink />
                      {/* Saniye */}
                      <TimeUnit value={String(countdown.s).padStart(2,'0')}
                        label="SAN"
                        color={countdown.d===0 && countdown.h===0 ? '#E10600' : 'rgba(240,244,255,0.7)'} />
                    </div>
                  ) : (
                    <p className="text-[18px] font-black" style={{ color:'#E10600' }}>
                      BUGÜN / GEÇTİ
                    </p>
                  )}
                </div>

                {/* Oturumlar */}
                <div className="flex flex-col gap-2 justify-center shrink-0">
                  <p className="text-[9px] mono font-semibold tracking-widest mb-1"
                    style={{ color:'var(--t3)' }}>OTURUMLAR</p>
                  {round.sessions.length > 0 ? round.sessions.map(s => {
                    const isClickable = s.status === 'active' || s.status === 'finished'
                    const sessionTime = s.session_date
                      ? new Date(s.session_date).toLocaleDateString('tr-TR', { weekday:'short', day:'numeric', month:'short' })
                        + ' ' + new Date(s.session_date).toLocaleTimeString('tr-TR', { hour:'2-digit', minute:'2-digit' })
                      : ''

                    if (!isClickable) {
                      return (
                        <div key={s.id}
                          className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border opacity-50"
                          style={{ borderColor: 'var(--b1)', background: 'var(--s2)', minWidth: 160 }}>
                          <span className="text-[11px] font-medium" style={{ color: 'var(--t3)' }}>
                            {SESSION_LABELS[s.type as SessionType] ?? s.type}
                          </span>
                          <span className="text-[9px] mono" style={{ color: 'var(--t3)' }}>
                            {sessionTime}
                          </span>
                        </div>
                      )
                    }

                    return (
                    <Link key={s.id}
                      to={s.status === 'active' ? `/live/${s.id}` : `/session/${s.id}`}
                      className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border transition-all group"
                      style={{
                        borderColor: s.status==='active' ? 'rgba(225,6,0,0.5)' : 'var(--b1)',
                        background:  s.status==='active' ? 'rgba(225,6,0,0.1)' : 'var(--s2)',
                        minWidth: 160,
                      }}>
                      <div className="flex items-center gap-2">
                        {s.status === 'active' && (
                          <span className="w-1.5 h-1.5 rounded-full bg-[#E10600] animate-pulse" />
                        )}
                        <span className="text-[11px] font-medium"
                          style={{ color: s.status==='active' ? '#E10600' : 'var(--t2)' }}>
                          {SESSION_LABELS[s.type as SessionType] ?? s.type}
                          {s.status==='active' && <span className="ml-1 text-[9px] font-bold">CANLI</span>}
                        </span>
                      </div>
                      <span className="text-[10px] text-white/25 group-hover:text-white/60">→</span>
                    </Link>
                    )
                  }) : (
                    <p className="text-[12px]" style={{ color:'var(--t3)' }}>Yakında</p>
                  )}
                </div>
              </div>
            </div>

            {/* ── Son Yarış Podyumu ──────────────────────────── */}
            {lastRace && (
              <Link to={`/recap/${current?.year ?? new Date().getFullYear()}/${lastRace.round}`}
                className="card p-5 h-full block transition-all hover:border-white/10"
                style={{ textDecoration: 'none' }}>
                <p className="text-[9px] mono font-semibold tracking-[0.2em] mb-3"
                  style={{ color:'var(--t3)' }}>
                  SON YARIŞ
                </p>
                <p className="text-[15px] font-bold text-white mb-4 leading-tight">
                  {lastRace.race_name}
                </p>

                {/* Podyum */}
                <div className="space-y-2.5">
                  {(['🥇','🥈','🥉'] as const).map((medal, i) => {
                    const p = lastRacePodium[i]
                    if (!p) return null
                    return (
                      <div key={i} className="flex items-center gap-3">
                        <span className="text-xl shrink-0">{medal}</span>
                        <div>
                          <p className="text-[14px] font-black mono text-white leading-none">
                            {p.code}
                          </p>
                          <p className="text-[10px] mt-0.5" style={{ color:'var(--t3)' }}>
                            {p.name}
                          </p>
                        </div>
                      </div>
                    )
                  })}
                </div>

                <p className="text-[10px] mono mt-3" style={{ color: '#E10600' }}>
                  Yarış özeti →
                </p>
              </Link>
            )}
          </div>
        </section>
      )}

      {/* ── Seasons ──────────────────────────────────────────── */}
      <section className="max-w-5xl mx-auto px-6 pb-16">
        <p className="text-[11px] mono font-semibold tracking-[0.25em] mb-6"
          style={{ color: 'var(--t3)' }}>SEZONLAR</p>

        {seasons.isLoading ? (
          <div className="grid sm:grid-cols-3 gap-4">
            {[1,2,3].map(i => (
              <div key={i} className="h-36 rounded-2xl animate-pulse"
                style={{ background: 'var(--s1)' }} />
            ))}
          </div>
        ) : (
          <div className="grid sm:grid-cols-3 gap-4">
            {(seasons.data ?? []).slice(0,6).map(s => {
              const pct = s.round_count > 0
                ? Math.round(s.rounds_completed / s.round_count * 100) : 0
              return (
                <Link key={s.id} to={`/season/${s.year}`}
                  className="card p-5 group cursor-pointer block"
                  style={{ textDecoration: 'none' }}>
                  <div className="flex justify-between items-start mb-5">
                    <span className="text-3xl font-black text-white group-hover:text-gradient-white
                                     transition-colors">{s.year}</span>
                    {s.is_current && (
                      <span className="text-[10px] mono font-semibold px-2 py-0.5 rounded-full
                                       bg-[#E10600]/15 text-[#E10600] border border-[#E10600]/25">
                        AKTİF
                      </span>
                    )}
                  </div>

                  <div className="space-y-1.5 mb-4">
                    <div className="flex justify-between text-[12px]">
                      <span style={{ color: 'var(--t2)' }}>Tamamlanan</span>
                      <span className="font-semibold text-white">{s.rounds_completed}</span>
                    </div>
                    <div className="flex justify-between text-[12px]">
                      <span style={{ color: 'var(--t3)' }}>Kalan</span>
                      <span style={{ color: 'var(--t2)' }}>{s.rounds_upcoming}</span>
                    </div>
                  </div>

                  {/* Progress */}
                  <div className="relative h-1 rounded-full overflow-hidden"
                    style={{ background: 'rgba(255,255,255,0.06)' }}>
                    <div className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
                      style={{
                        width: `${pct}%`,
                        background: 'linear-gradient(90deg, #E10600, #ff4520)',
                      }} />
                  </div>
                  <p className="text-[10px] mono mt-2" style={{ color: 'var(--t3)' }}>
                    {pct}% tamamlandı
                  </p>
                </Link>
              )
            })}
          </div>
        )}

        {seasons.data?.length === 0 && !seasons.isLoading && (
          <div className="card text-center py-16 px-8">
            <p className="text-5xl mb-4">🏎</p>
            <p className="text-white font-semibold mb-2">Henüz sezon verisi yok</p>
            <p className="text-[13px] mb-5" style={{ color: 'var(--t2)' }}>
              İlk senkronizasyonu başlat:
            </p>
            <code className="text-[12px] mono px-4 py-2.5 rounded-xl block w-fit mx-auto"
              style={{ background: 'var(--s2)', color: '#00D2BE', border: '1px solid var(--b1)' }}>
              POST /api/v1/seasons/2026/sync
            </code>
          </div>
        )}
      </section>

      {/* ── Features ──────────────────────────────────────────── */}
      <section className="border-t py-16" style={{ borderColor: 'var(--b1)' }}>
        <div className="max-w-5xl mx-auto px-6">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Canlı yarış — özel kart */}
            <Link to={liveStatus.data?.live ? `/live/${liveStatus.data.session_id}` : '/live/demo'}
              className="card p-6 col-span-1 group block transition-all hover:border-[#E10600]/40"
              style={{ textDecoration: 'none', borderColor: liveStatus.data?.live ? 'rgba(225,6,0,0.4)' : undefined,
                       background: liveStatus.data?.live ? 'rgba(225,6,0,0.05)' : undefined }}>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-2xl">📺</span>
                {liveStatus.data?.live && (
                  <span className="flex items-center gap-1 text-[10px] mono font-bold text-[#E10600]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#E10600] animate-pulse" />
                    CANLI
                  </span>
                )}
              </div>
              <p className="font-bold text-white mb-1">
                {liveStatus.data?.live ? 'Canlı Yarış' : 'Canlı Yarış (Demo)'}
              </p>
              <p className="text-[12px] leading-relaxed" style={{ color: 'var(--t2)' }}>
                {liveStatus.data?.live
                  ? 'Anlık sıralama, pist haritası, race control, AI yorum →'
                  : 'Kanada GP verisiyle simülasyon ve pit analizi dene →'}
              </p>
            </Link>

            {[
              { icon:'📡', title:'Gerçek Zamanlı Telemetri',
                desc:'Hız, gaz, fren, DRS, RPM verileri. Grafiğe tıkla, AI yorumla.' },
              { icon:'🤖', title:'AI Destekli Analiz',
                desc:'Groq/Claude ile anlık telemetri ve strateji simülasyonu.' },
              { icon:'🗺', title:'Pist & Strateji',
                desc:'GPS pist haritası, viraj analizi, pit stop simülatörü.' },
            ].map(f => (
              <div key={f.title} className="card p-6">
                <p className="text-2xl mb-3">{f.icon}</p>
                <p className="font-bold text-white mb-1">{f.title}</p>
                <p className="text-[12px] leading-relaxed" style={{ color: 'var(--t2)' }}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
