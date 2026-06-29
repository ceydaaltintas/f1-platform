/**
 * Canlı Yarış Sayfası
 * - Gerçek yarış: /live/{sessionId} → OpenF1 polling
 * - Demo modu: /live/demo → Kanada GP race (session 25) gerçek verisi
 */

import { useEffect, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { client } from '../api/client'
import { TrackMap } from '../components/trackmap/TrackMap'
import { LiveSimulator } from '../components/live/LiveSimulator'
import { CommentFeed } from '../components/community/CommentFeed'
import { PollWidget } from '../components/community/PollWidget'
import { COMPOUND_COLORS, SESSION_LABELS, type SessionType } from '../types/f1'
import { formatLapTime, formatGap } from '../utils/format'

// Canlı yarışta yorum/anket akışı için yenileme süresi
const LIVE_COMMUNITY_REFRESH = 12_000

// ── Topluluk paneli (yorum + anket sekmeli) ───────────────────────────────────
function LiveCommunityPanel({ sessionId, isLoggedIn }: { sessionId: number; isLoggedIn: boolean }) {
  const [tab, setTab] = useState<'comments' | 'polls'>('comments')
  return (
    <div className="card overflow-hidden flex flex-col">
      <div className="flex border-b" style={{ borderColor: 'var(--b1)' }}>
        {(['comments', 'polls'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className="flex-1 py-3 text-[12px] font-semibold transition-all"
            style={tab === t
              ? { background: 'rgba(225,6,0,0.08)', color: '#E10600',
                  borderBottom: '2px solid #E10600' }
              : { color: 'var(--t3)', borderBottom: '2px solid transparent' }}>
            {t === 'comments' ? '💬 Yorumlar' : '📊 Anketler'}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0" style={{ maxHeight: 360, overflowY: 'auto' }}>
        {tab === 'comments'
          ? <CommentFeed sessionId={sessionId} isAuthenticated={isLoggedIn} refetchInterval={LIVE_COMMUNITY_REFRESH} />
          : <PollWidget sessionId={sessionId} userId={null} isAuthenticated={isLoggedIn} refetchInterval={LIVE_COMMUNITY_REFRESH} />
        }
      </div>
    </div>
  )
}

const QUALI_COLOR: Record<string, string> = { Q1: '#FF8700', Q2: '#00D2BE', Q3: '#E10600' }
const QUALI_SEGMENT_NAMES_ORDER = ['Q1', 'Q2', 'Q3'] as const

const TEAM_COLOR: Record<string, string> = {
  VER: '#3671C6', NOR: '#FF8000', LEC: '#E8002D', HAM: '#27F4D2',
  RUS: '#27F4D2', PIA: '#FF8000', SAI: '#E8002D', ANT: '#27F4D2',
  ALO: '#358C75', STR: '#358C75', GAS: '#0093CC', OCO: '#0093CC',
  HUL: '#B6BABD', BOT: '#C92D4B', ALB: '#64C4FF', COL: '#64C4FF',
  LAW: '#6692FF', HAD: '#6692FF', LIN: '#6692FF', BEA: '#B6BABD',
  BOR: '#C92D4B',
}

const FLAG_STYLE: Record<string, { color: string; label: string; emoji: string }> = {
  GREEN:     { color: '#00C851', label: 'YEŞİL BAYRAK',                       emoji: '🟢' },
  YELLOW:    { color: '#FFD700', label: 'SARI BAYRAK',                         emoji: '🟡' },
  RED:       { color: '#E10600', label: 'KIRMIZI BAYRAK — YARIŞI DURDURULDU', emoji: '🔴' },
  SC:        { color: '#FF8700', label: 'SAFETY CAR',                          emoji: '🚗' },
  VSC:       { color: '#FF8700', label: 'VIRTUAL SAFETY CAR',                  emoji: '🔶' },
  CHEQUERED: { color: '#ffffff', label: 'DAMALIBAYRAK — YARIŞI BİTTİ',        emoji: '🏁' },
}

function windDir(deg?: number): string {
  if (deg == null) return '—'
  return ['K','KD','D','GD','G','GB','B','KB'][Math.round(deg / 45) % 8]
}

// Demo modu için Kanada GP session ID
const DEMO_SESSION_ID = 25

export function LivePage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const isDemo = sessionId === 'demo'
  // Demo için gerçek Kanada GP verisi kullan
  const effectiveSid = isDemo ? DEMO_SESSION_ID : Number(sessionId)
  const isLoggedIn = !!localStorage.getItem('access_token')
  const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

  const sessionInfo = useQuery({
    queryKey: ['session-info', effectiveSid],
    queryFn:  () => client.get(`/sessions/${effectiveSid}`).then(r => r.data),
    staleTime: 300_000,
    enabled: !isDemo && !!effectiveSid && !isNaN(effectiveSid),
  })
  const sessionTitle = isDemo
    ? 'Kanada Grand Prix 2026'
    : sessionInfo.data
      ? `${sessionInfo.data.round?.name ?? ''} — ${SESSION_LABELS[sessionInfo.data.type as SessionType] ?? sessionInfo.data.type}`
      : `Oturum #${effectiveSid}`

  const timing = useQuery({
    queryKey: ['live-timing', effectiveSid],
    queryFn:  () => client.get(`/live/${effectiveSid}/timing`).then(r => r.data),
    refetchInterval: isDemo ? 30_000 : 8_000,  // demo'da daha seyrek (veri zaten sabit)
    staleTime: 0,
    enabled: !!effectiveSid && !isNaN(effectiveSid),
  })
  const rcMessages = useQuery({
    queryKey: ['live-rc', effectiveSid],
    queryFn:  () => client.get(`/live/${effectiveSid}/race_control`).then(r => r.data),
    refetchInterval: isDemo ? 60_000 : 10_000,
    staleTime: 0,
    enabled: !!effectiveSid && !isNaN(effectiveSid),
  })
  const radio = useQuery({
    queryKey: ['live-radio', effectiveSid],
    queryFn:  () => client.get(`/live/${effectiveSid}/radio`).then(r => r.data),
    refetchInterval: isDemo ? 60_000 : 15_000,
    staleTime: 0,
    enabled: !!effectiveSid && !isNaN(effectiveSid),
  })
  const weather = useQuery({
    queryKey: ['live-weather', effectiveSid],
    queryFn:  () => client.get(`/live/${effectiveSid}/weather`).then(r => r.data),
    refetchInterval: 30_000,
    staleTime: 0,
    enabled: !!effectiveSid && !isNaN(effectiveSid),
  })
  const trackMap = useQuery({
    queryKey: ['track_map', effectiveSid, 'VER'],
    queryFn:  () => client.get(`/sessions/${effectiveSid}/track_map?driver_code=VER`).then(r => r.data),
    staleTime: 86_400_000,
    retry: 3,
    refetchInterval: (query) => (query.state.data?.points?.length ? false : 30_000),
    enabled: !!effectiveSid && !isNaN(effectiveSid),
  })
  const positionsMap = useQuery({
    queryKey: ['positions_map', effectiveSid],
    queryFn:  () => client.get(`/live/${effectiveSid}/positions_map`).then(r => r.data),
    refetchInterval: 4_000,
    staleTime: 0,
    enabled: !isDemo && !!effectiveSid && !isNaN(effectiveSid),
  })

  // SSE yorumu — sadece gerçek yarış modunda
  const [commentary, setCommentary] = useState('')
  const esRef = useRef<EventSource | null>(null)
  useEffect(() => {
    if (isDemo || !effectiveSid || isNaN(effectiveSid)) return
    const es = new EventSource(`${BASE}/api/v1/live/${effectiveSid}/commentary?mode=beginner`)
    esRef.current = es
    es.onmessage = e => {
      try { setCommentary(JSON.parse(e.data).text ?? '') } catch {}
    }
    return () => es.close()
  }, [effectiveSid, isDemo])

  // Tick
  const [tick, setTick] = useState('')
  useEffect(() => {
    const id = setInterval(() => setTick(new Date().toLocaleTimeString('tr-TR')), 1000)
    return () => clearInterval(id)
  }, [])

  const radioClips: any[] = radio.data?.clips ?? []
  const messages: any[] = rcMessages.data?.messages ?? []
  const latestFlag = [...messages].reverse().find(m => m.flag && m.flag !== 'NONE')
  const flagStyle  = latestFlag ? FLAG_STYLE[latestFlag.flag] : null
  const entries: any[] = timing.data?.entries ?? []
  const raceFinished: boolean = !!timing.data?.race_finished
  const sessionType: string | undefined = timing.data?.session_type
  // Canlı strateji simülatörü (pit/yakalama analizi) sadece yarış formatlı
  // session'larda anlamlı — antrenman/sıralama'da gösterilmez
  const isRaceLike = isDemo || sessionType === 'race' || sessionType === 'sprint'
  const isPractice = sessionType?.startsWith('practice')
  // Sıralama oturumunda Q1/Q2/Q3 segmentlerine göre standings gösterilir
  const isQuali = sessionType === 'qualifying' || sessionType === 'sprint_qualifying'
  const activeSegment: string | undefined = timing.data?.active_segment
  const qualiSegments: Record<string, any[]> = timing.data?.segments ?? {}

  const isLoading = timing.isLoading && rcMessages.isLoading

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg)' }}>
        <div className="text-center space-y-4">
          <div className="flex gap-1.5 justify-center">
            {[0,1,2].map(i => (
              <div key={i} className="w-2.5 h-2.5 rounded-full bg-[#E10600]"
                style={{ animation: `bounce-dot 0.8s ${i*0.15}s infinite` }} />
            ))}
          </div>
          <p className="text-[13px] mono" style={{ color: 'var(--t3)' }}>
            {isDemo ? 'Kanada GP verisi yükleniyor...' : 'Canlı veri bekleniyor...'}
          </p>
        </div>
        <style>{`@keyframes bounce-dot{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-6px)}}`}</style>
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>

      {/* ── Üst Durum Çubuğu ─────────────────────────────────────── */}
      <div className="border-b px-6 py-3 flex items-center justify-between flex-wrap gap-3"
        style={{ background: 'var(--s1)', borderColor: 'var(--b1)' }}>
        <div className="flex items-center gap-4">
          {raceFinished && !isDemo ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full"
              style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.25)' }}>
              <span>🏁</span>
              <span className="text-[12px] font-bold mono" style={{ color: '#ffffff' }}>
                YARIŞ BİTTİ
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full"
              style={{ background: 'rgba(225,6,0,0.15)', border: '1px solid rgba(225,6,0,0.4)' }}>
              <span className="w-2 h-2 rounded-full bg-[#E10600]"
                style={{ animation: 'pulse-dot 1s infinite' }} />
              <span className="text-[12px] font-bold mono text-[#E10600]">
                {isDemo ? 'DEMO' : 'CANLI'}
              </span>
            </div>
          )}
          <div>
            <p className="text-[11px] mono" style={{ color: 'var(--t3)' }}>
              {isDemo ? 'KANADA GP — DEMO GÖRÜNTÜLEMESİ' : 'CANLI YARIŞ TAKİBİ'}
            </p>
            <p className="text-[14px] font-bold text-white">
              {sessionTitle}
            </p>
          </div>
          {isDemo && (
            <span className="text-[10px] mono px-2 py-1 rounded"
              style={{ background:'rgba(255,215,0,0.08)', color:'#FFD700',
                       border:'1px solid rgba(255,215,0,0.2)' }}>
              Gerçek yarış verisi — final durumu
            </span>
          )}
        </div>

        <div className="flex items-center gap-4">
          {flagStyle && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl"
              style={{ background: flagStyle.color + '18', border: `1px solid ${flagStyle.color}40` }}>
              <span>{flagStyle.emoji}</span>
              <span className="text-[12px] font-bold mono" style={{ color: flagStyle.color }}>
                {flagStyle.label}
              </span>
            </div>
          )}
          {weather.data && (
            <div className="flex items-center gap-3 text-[11px] mono" style={{ color: 'var(--t2)' }}>
              <span>🌡 {weather.data.track_temp?.toFixed(0)}°C pist</span>
              <span>/ {weather.data.air_temp?.toFixed(0)}°C hava</span>
              {weather.data.humidity && <span>💧 {weather.data.humidity?.toFixed(0)}%</span>}
              {weather.data.wind_speed && (
                <span>💨 {windDir(weather.data.wind_dir)} {weather.data.wind_speed?.toFixed(0)} km/h</span>
              )}
              {weather.data.rainfall && <span style={{ color: '#00cfff' }}>🌧 Yağmur</span>}
            </div>
          )}
          <span className="text-[10px] mono" style={{ color: 'var(--t3)' }}>⏱ {tick}</span>
        </div>
      </div>

      {/* ── Race Control Feed ──────────────────────────────────────── */}
      {messages.length > 0 && (
        <div className="border-b overflow-hidden"
          style={{ background: 'var(--s1)', borderColor: 'var(--b1)' }}>
          <div className="ticker-wrap">
            <div className="ticker-inner ticker-slow gap-8 px-6 py-2">
              {[...messages.slice(0,15), ...messages.slice(0,15)].map((m: any, i: number) => {
                const color = m.flag === 'RED' ? '#E10600'
                  : m.flag === 'SC' || m.flag === 'VSC' ? '#FF8700'
                  : m.flag === 'GREEN' ? '#00C851'
                  : m.flag === 'YELLOW' ? '#FFD700'
                  : 'var(--t2)'
                return (
                  <span key={i} className="text-[11px] mono shrink-0" style={{ color }}>
                    {m.flag && m.flag !== 'NONE' ? `${FLAG_STYLE[m.flag]?.emoji ?? '●'} ` : '● '}
                    {m.message}
                    <span className="mx-4" style={{ color: 'var(--t3)' }}>·</span>
                  </span>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Ana İçerik ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4 p-4 max-w-7xl mx-auto">

        {/* ── Sol: Sıralama Kulesi ───────────────────────────────── */}
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b"
            style={{ borderColor: 'var(--b1)' }}>
            <div className="flex items-center gap-3">
              <p className="text-[13px] font-bold text-white">Sıralama</p>
              {(() => {
                const clock = timing.data?.session_clock
                if (!clock?.remaining_s && clock?.remaining_s !== 0) return null
                const serverRemaining = clock.remaining_s
                const serverTs = timing.data?.ts ? new Date(timing.data.ts).getTime() : Date.now()
                const elapsed = (Date.now() - serverTs) / 1000
                const remaining = Math.max(0, Math.round(serverRemaining - elapsed))
                const mins = Math.floor(remaining / 60)
                const secs = remaining % 60
                const isLow = remaining < 120
                return (
                  <span className="text-[12px] mono font-bold px-2 py-0.5 rounded"
                    style={{
                      color: isLow ? '#E10600' : '#00D2BE',
                      background: isLow ? 'rgba(225,6,0,0.1)' : 'rgba(0,210,190,0.08)',
                      border: `1px solid ${isLow ? 'rgba(225,6,0,0.3)' : 'rgba(0,210,190,0.2)'}`,
                    }}>
                    {mins}:{String(secs).padStart(2, '0')}
                  </span>
                )
              })()}
            </div>
            {/* Aktif segment (sıralama) veya tur sayacı (yarış) */}
            {isQuali && activeSegment ? (
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg"
                style={{ background: (QUALI_COLOR[activeSegment] ?? '#888') + '18',
                         border: `1px solid ${(QUALI_COLOR[activeSegment] ?? '#888')}40` }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: QUALI_COLOR[activeSegment] ?? '#888', animation: 'pulse-dot 1s infinite' }} />
                <span className="text-[10px] mono" style={{ color: 'var(--t3)' }}>AKTİF</span>
                <span className="text-[16px] font-black mono leading-none" style={{ color: QUALI_COLOR[activeSegment] ?? '#888' }}>
                  {activeSegment}
                </span>
              </div>
            ) : isRaceLike && timing.data?.current_lap ? (
              <div className="flex items-baseline gap-1 px-3 py-1 rounded-lg"
                style={{ background: 'rgba(225,6,0,0.1)', border: '1px solid rgba(225,6,0,0.2)' }}>
                <span className="text-[10px] mono mr-1" style={{ color: 'var(--t3)' }}>TUR</span>
                <span className="text-[20px] font-black mono leading-none" style={{ color: '#E10600' }}>
                  {timing.data.current_lap}
                </span>
                {timing.data?.total_laps && (
                  <span className="text-[13px] font-bold mono" style={{ color: 'var(--t3)' }}>
                    /{timing.data.total_laps}
                  </span>
                )}
              </div>
            ) : null}
          </div>

          {/* Tablo — scroll yok, tüm pilotlar görünür */}
          {!isQuali && (
          <table style={{
            width: '100%', borderCollapse: 'collapse',
            fontFamily: 'IBM Plex Mono, monospace',
            tableLayout: 'fixed',   /* sütunlar taşmaz */
          }}>
            <colgroup>
              <col style={{ width: 28 }}  />{/* P */}
              <col style={{ width: 30 }}  />{/* Pozisyon değişimi */}
              <col style={{ width: 6 }}   />{/* renk */}
              <col />{/* Pilot — kalan alanı kaplar */}
              <col style={{ width: isPractice ? 88 : 88 }}  />{/* Fark / En İyi */}
              <col style={{ width: 80 }}  />{/* Aralık / Son Tur */}
              <col style={{ width: 26 }}  />{/* Lastik */}
              <col style={{ width: 26 }}  />{/* Pit / Tur */}
            </colgroup>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.07)',
                           background: 'rgba(255,255,255,0.02)' }}>
                {[
                  { label: 'P',      align: 'left'  },
                  { label: '',       align: 'center' },
                  { label: '',       align: 'left'  },
                  { label: 'PİLOT', align: 'left'  },
                  { label: isPractice ? 'EN İYİ' : 'FARK', align: 'right' },
                  { label: isPractice ? 'FARK' : 'ARALIK', align: 'right' },
                  { label: 'L',      align: 'right' },
                  { label: isPractice ? 'TUR' : 'PIT', align: 'right' },
                ].map(({ label, align }, i) => (
                  <th key={i} style={{
                    padding: '7px 6px', textAlign: align as any,
                    fontSize: 9, fontWeight: 600, letterSpacing: '0.1em',
                    color: 'rgba(240,244,255,0.4)',
                    overflow: 'hidden', whiteSpace: 'nowrap',
                  }}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center',
                  color: 'rgba(240,244,255,0.4)', fontSize: 12 }}>
                  Veri yükleniyor...
                </td></tr>
              ) : entries.map((e: any) => {
                const color = e.team_colour ?? TEAM_COLOR[e.code] ?? '#888'
                const tyre  = e.compound
                const tyreC = tyre ? (COMPOUND_COLORS[tyre] ?? '#888') : null
                return (
                  <tr key={e.code}
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                    onMouseEnter={ev => (ev.currentTarget.style.background='rgba(255,255,255,0.03)')}
                    onMouseLeave={ev => (ev.currentTarget.style.background='transparent')}>

                    {/* P */}
                    <td style={{ padding: '7px 6px', fontSize: 12, fontWeight: 900,
                      color: e.position === 1 ? '#00D2BE' : 'rgba(240,244,255,0.45)' }}>
                      {e.position}
                    </td>

                    {/* Pozisyon değişimi (başlangıca göre) — pasif pilotlarda gösterilmez */}
                    <td style={{ padding: '7px 2px', textAlign: 'center', fontSize: 10, fontWeight: 800 }}>
                      {e.status ? null : e.position_change > 0 ? (
                        <span style={{ color: '#00D2BE' }}>▲{e.position_change}</span>
                      ) : e.position_change < 0 ? (
                        <span style={{ color: '#f87171' }}>▼{Math.abs(e.position_change)}</span>
                      ) : (
                        <span style={{ color: 'rgba(240,244,255,0.35)' }}>—</span>
                      )}
                    </td>

                    {/* Takım renk çubuğu */}
                    <td style={{ padding: '0 2px' }}>
                      <div style={{ width: 3, height: 18, borderRadius: 2, background: color, margin: 'auto' }} />
                    </td>

                    {/* Pilot adı + takım */}
                    <td style={{ padding: '6px 8px 6px 4px', overflow: 'hidden' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, lineHeight: 1 }}>
                        <span style={{ fontSize: 12, fontWeight: 900, color: 'white',
                          whiteSpace: 'nowrap' }}>{e.code}</span>
                        {e.in_pit && (
                          <span style={{
                            fontSize: 8, fontWeight: 900, padding: '1.5px 4px', borderRadius: 4,
                            background: 'rgba(255,135,0,0.15)', color: '#FF8700',
                            border: '1px solid rgba(255,135,0,0.35)', letterSpacing: '0.05em',
                          }}>PİT</span>
                        )}
                      </div>
                      <div style={{ fontSize: 8, color: 'rgba(240,244,255,0.4)', marginTop: 1,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {e.team_name}
                      </div>
                    </td>

                    {/* Sütun 5: Antrenman→En İyi Tur, Yarış→Fark */}
                    <td style={{ padding: '7px 6px', textAlign: 'right', fontSize: 10, fontWeight: 600,
                      whiteSpace: 'nowrap', overflow: 'hidden',
                      color: isPractice
                        ? (e.position === 1 ? '#a855f7' : 'rgba(240,244,255,0.75)')
                        : e.status === 'DNS/DNF' ? 'rgba(240,244,255,0.45)'
                        : e.lapped ? '#f87171'
                        : e.position === 1 ? 'rgba(240,244,255,0.5)'
                        : 'rgba(240,244,255,0.75)' }}>
                      {isPractice
                        ? (e.best_lap_time ?? '—')
                        : e.status === 'DNS/DNF' ? 'DNS/DNF' : formatGap(e.gap_to_leader, e.position === 1)}
                    </td>

                    {/* Sütun 6: Antrenman→Fark, Yarış→Aralık */}
                    <td style={{ padding: '7px 6px', textAlign: 'right', fontSize: 10,
                      color: isPractice
                        ? (e.position === 1 ? '#00D2BE' : 'rgba(240,244,255,0.5)')
                        : 'rgba(240,244,255,0.32)',
                      whiteSpace: 'nowrap', overflow: 'hidden' }}>
                      {isPractice
                        ? (e.gap_to_leader ?? '—')
                        : e.interval ? formatGap(e.interval, false) : '—'}
                    </td>

                    {/* Lastik */}
                    <td style={{ padding: '7px 4px', textAlign: 'right' }}>
                      {tyreC ? (
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          width: 18, height: 18, borderRadius: '50%',
                          fontSize: 8, fontWeight: 900,
                          background: tyreC + '20', color: tyreC, border: `1.5px solid ${tyreC}50`,
                        }}>{tyre[0]}</span>
                      ) : <span style={{ color: 'rgba(240,244,255,0.4)', fontSize: 10 }}>—</span>}
                    </td>

                    {/* Sütun 8: Antrenman→Tur sayısı, Yarış→Pit */}
                    <td style={{ padding: '7px 6px', textAlign: 'right', fontSize: 11, fontWeight: 700,
                      color: isPractice
                        ? (e.lap_count > 0 ? 'rgba(240,244,255,0.5)' : 'rgba(240,244,255,0.4)')
                        : e.pit_count > 0 ? '#FF8700' : 'rgba(240,244,255,0.4)' }}>
                      {isPractice ? (e.lap_count ?? 0) : (e.pit_count ?? 0)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          )}

          {/* Sıralama: aktif segment standings + tamamlanan segmentler */}
          {isQuali && (
          <table style={{
            width: '100%', borderCollapse: 'collapse',
            fontFamily: 'IBM Plex Mono, monospace',
            tableLayout: 'fixed',
          }}>
            <colgroup>
              <col style={{ width: 28 }}  />{/* P */}
              <col style={{ width: 6 }}   />{/* renk */}
              <col />{/* Pilot */}
              <col style={{ width: 88 }}  />{/* En iyi tur */}
              <col style={{ width: 80 }}  />{/* Fark */}
            </colgroup>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.07)',
                           background: 'rgba(255,255,255,0.02)' }}>
                {[
                  { label: 'P',        align: 'left'  },
                  { label: '',         align: 'left'  },
                  { label: 'PİLOT',    align: 'left'  },
                  { label: 'EN İYİ TUR', align: 'right' },
                  { label: 'FARK',     align: 'right' },
                ].map(({ label, align }, i) => (
                  <th key={i} style={{
                    padding: '7px 6px', textAlign: align as any,
                    fontSize: 9, fontWeight: 600, letterSpacing: '0.1em',
                    color: 'rgba(240,244,255,0.4)',
                    overflow: 'hidden', whiteSpace: 'nowrap',
                  }}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 ? (
                <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center',
                  color: 'rgba(240,244,255,0.4)', fontSize: 12 }}>
                  Veri yükleniyor...
                </td></tr>
              ) : entries.map((e: any) => {
                const color = e.team_colour ?? TEAM_COLOR[e.code] ?? '#888'
                const hasTime = e.lap_time != null
                return (
                  <tr key={e.code}
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                    onMouseEnter={ev => (ev.currentTarget.style.background='rgba(255,255,255,0.03)')}
                    onMouseLeave={ev => (ev.currentTarget.style.background='transparent')}>

                    <td style={{ padding: '7px 6px', fontSize: 12, fontWeight: 900,
                      color: e.position === 1 ? '#00D2BE' : 'rgba(240,244,255,0.45)' }}>
                      {e.position}
                    </td>

                    <td style={{ padding: '0 2px' }}>
                      <div style={{ width: 3, height: 18, borderRadius: 2, background: color, margin: 'auto' }} />
                    </td>

                    <td style={{ padding: '6px 8px 6px 4px', overflow: 'hidden' }}>
                      <div style={{ fontSize: 12, fontWeight: 900, color: 'white',
                        lineHeight: 1, whiteSpace: 'nowrap' }}>{e.code}</div>
                      <div style={{ fontSize: 8, color: 'rgba(240,244,255,0.4)', marginTop: 1,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {e.team_name}
                      </div>
                    </td>

                    <td style={{ padding: '7px 6px', textAlign: 'right', fontSize: 11, fontWeight: 700,
                      color: e.position === 1 ? '#00D2BE' : 'rgba(240,244,255,0.85)' }}>
                      {hasTime ? formatLapTime(e.lap_time) : '—'}
                    </td>

                    <td style={{ padding: '7px 6px', textAlign: 'right', fontSize: 10, fontWeight: 600,
                      color: e.position === 1 ? 'rgba(240,244,255,0.5)' : 'rgba(240,244,255,0.75)' }}>
                      {!hasTime ? '—' : e.position === 1 ? 'LDR' : (e.gap < 60 ? `+${e.gap.toFixed(3)}` : `+${formatLapTime(e.gap)}`)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          )}

          {/* Tamamlanan segment sonuçları (örn. Q2 aktifken Q1 sonuçları) */}
          {isQuali && Object.keys(qualiSegments).length > 0 && (
            <div className="border-t" style={{ borderColor: 'var(--b1)' }}>
              {QUALI_SEGMENT_NAMES_ORDER.filter(seg => qualiSegments[seg]?.length).map(seg => (
                <div key={seg} className="px-4 py-2.5 border-b" style={{ borderColor: 'var(--b1)' }}>
                  <p className="text-[10px] mono font-bold mb-1.5" style={{ color: QUALI_COLOR[seg] }}>
                    {seg} SONUÇLARI ({qualiSegments[seg].length})
                  </p>
                  <div className="space-y-1">
                    {qualiSegments[seg].map((e: any) => (
                      <div key={e.code} className="flex items-center gap-2 text-[11px] mono">
                        <span style={{ width: 18, color: e.position === 1 ? '#00D2BE' : 'rgba(240,244,255,0.3)', fontWeight: 900 }}>{e.position}</span>
                        <span style={{ width: 3, height: 14, borderRadius: 2, background: e.team_colour ?? TEAM_COLOR[e.code] ?? '#888' }} />
                        <span style={{ color: 'white', fontWeight: 700 }}>{e.code}</span>
                        <span style={{ marginLeft: 'auto', color: 'rgba(240,244,255,0.6)' }}>{formatLapTime(e.lap_time)}</span>
                        <span style={{ width: 64, textAlign: 'right', color: 'rgba(240,244,255,0.35)' }}>
                          {e.position === 1 ? 'LDR' : `+${e.gap.toFixed(3)}`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Sağ: Pist + Simülatör + RC + AI ──────────────────────── */}
        <div className="space-y-4">

          {/* Pist Haritası */}
          <div className="card overflow-hidden">
            <div className="px-5 py-3 border-b" style={{ borderColor: 'var(--b1)' }}>
              <p className="text-[13px] font-bold text-white">Pist Haritası</p>
            </div>
            {trackMap.isLoading || !trackMap.data?.points?.length ? (
              <div className="flex items-center justify-center h-48">
                <p className="text-[12px] mono" style={{ color:'var(--t3)' }}>
                  {trackMap.isLoading ? 'Pist yükleniyor...' : 'Pist verisi bekleniyor...'}
                </p>
              </div>
            ) : (
              <TrackMap
                points={trackMap.data?.points ?? []}
                livePositions={positionsMap.data?.positions ?? []}
                showCorners height={240}
              />
            )}
          </div>

          {/* Canlı Simülatör */}
          {entries.length > 0 && isRaceLike && (
            <LiveSimulator
              sessionId={effectiveSid}
              drivers={entries.map((e: any) => e.code).filter(Boolean)}
              defaultDriver={entries[4]?.code ?? ''}
              disabled={raceFinished}
            />
          )}

          {/* Race Control + AI Yorum */}
          <div className="grid md:grid-cols-2 gap-4">
            <div className="card overflow-hidden">
              <div className="px-5 py-3 border-b" style={{ borderColor: 'var(--b1)' }}>
                <p className="text-[13px] font-bold text-white">Yarış Kontrolü</p>
              </div>
              <div className="p-4 space-y-2 overflow-y-auto" style={{ maxHeight: 200 }}>
                {messages.length === 0 ? (
                  <p className="text-[12px] mono text-center py-4" style={{ color:'var(--t3)' }}>
                    Mesaj yok
                  </p>
                ) : messages.slice(0, 15).map((m: any, i: number) => {
                  const c = m.flag==='RED'?'#E10600':m.flag==='SC'||m.flag==='VSC'?'#FF8700':
                    m.flag==='GREEN'?'#00C851':m.flag==='YELLOW'?'#FFD700':'var(--t2)'
                  const emoji = m.flag && FLAG_STYLE[m.flag] ? FLAG_STYLE[m.flag].emoji : '●'
                  return (
                    <div key={i} className="flex items-start gap-2">
                      <span className="shrink-0 mt-0.5 text-sm">{emoji}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] leading-snug" style={{ color: c }}>{m.message}</p>
                        {m.date && (
                          <p className="text-[9px] mono mt-0.5" style={{ color: 'rgba(240,244,255,0.4)' }}>
                            {new Date(m.date).toLocaleTimeString('tr-TR', { hour:'2-digit', minute:'2-digit', second:'2-digit' })}
                          </p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="card overflow-hidden">
              <div className="px-5 py-3 border-b flex items-center gap-2"
                style={{ borderColor: 'var(--b1)' }}>
                <div className="w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-black"
                  style={{ background:'linear-gradient(135deg,#E10600,#cc0000)', color:'white' }}>
                  AI
                </div>
                <p className="text-[13px] font-bold text-white">Canlı Yorum</p>
                {isDemo && (
                  <span className="text-[10px] mono ml-auto" style={{ color:'var(--t3)' }}>
                    Sadece canlı yarışta
                  </span>
                )}
              </div>
              <div className="p-5 flex items-center" style={{ minHeight: 120 }}>
                {commentary ? (
                  <p className="text-[13px] leading-relaxed pl-3 border-l-2"
                    style={{ color:'rgba(240,244,255,0.85)', borderColor:'#E10600' }}>
                    {commentary}
                  </p>
                ) : (
                  <p className="text-[12px] italic w-full text-center" style={{ color:'var(--t3)' }}>
                    {isDemo
                      ? 'AI yorumu canlı oturum sırasında aktif olur'
                      : 'Yorum bekleniyor...'}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Takım Radyoları */}
          <div className="card overflow-hidden">
            <div className="px-5 py-3 border-b flex items-center gap-2" style={{ borderColor: 'var(--b1)' }}>
              <span className="text-base">📻</span>
              <p className="text-[13px] font-bold text-white">Takım Radyoları</p>
              {radioClips.length > 0 && (
                <span className="text-[10px] mono ml-auto" style={{ color: 'var(--t3)' }}>
                  {radioClips.length} kayıt
                </span>
              )}
            </div>
            <div className="p-3 space-y-2 overflow-y-auto" style={{ maxHeight: 280 }}>
              {radioClips.length === 0 ? (
                <p className="text-[12px] mono text-center py-4" style={{ color: 'var(--t3)' }}>
                  Henüz radyo kaydı yok
                </p>
              ) : radioClips.map((c: any, i: number) => (
                <div key={`${c.recording_url}-${i}`}
                  className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg"
                  style={{ background: 'var(--s2)', border: '1px solid var(--b1)' }}>
                  <div style={{ width: 3, height: 28, borderRadius: 2, background: c.team_colour ?? '#888', flexShrink: 0 }} />
                  <div style={{ minWidth: 46, flexShrink: 0 }}>
                    <p className="text-[12px] font-black mono text-white leading-none">{c.code}</p>
                    {c.date && (
                      <p className="text-[9px] mono mt-0.5" style={{ color: 'rgba(240,244,255,0.45)' }}>
                        {new Date(c.date).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </p>
                    )}
                  </div>
                  <audio controls preload="none" src={c.recording_url} style={{ flex: 1, height: 30 }} />
                </div>
              ))}
            </div>
          </div>

          {/* Topluluk: Yorumlar + Anketler */}
          {!!effectiveSid && !isNaN(effectiveSid) && (
            <LiveCommunityPanel sessionId={effectiveSid} isLoggedIn={isLoggedIn} />
          )}
        </div>
      </div>

      <style>{`
        @keyframes pulse-dot { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.4;transform:scale(0.8)} }
        @keyframes bounce-dot { 0%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-6px)} }
      `}</style>
    </div>
  )
}
