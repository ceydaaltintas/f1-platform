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
import { COMPOUND_COLORS } from '../types/f1'
import { formatLapTime, formatGap } from '../utils/format'

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
  const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

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

  const messages: any[] = rcMessages.data?.messages ?? []
  const latestFlag = [...messages].reverse().find(m => m.flag && m.flag !== 'NONE')
  const flagStyle  = latestFlag ? FLAG_STYLE[latestFlag.flag] : null
  const entries: any[] = timing.data?.entries ?? []
  const raceFinished: boolean = !!timing.data?.race_finished

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
              {isDemo ? 'Kanada Grand Prix 2026' : `Oturum #${effectiveSid}`}
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
            <div className="ticker-inner gap-8 px-6 py-2">
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
            <p className="text-[13px] font-bold text-white">Sıralama</p>
            {/* Tur sayacı */}
            {timing.data?.current_lap && (
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
            )}
          </div>

          {/* Tablo — scroll yok, tüm pilotlar görünür */}
          <table style={{
            width: '100%', borderCollapse: 'collapse',
            fontFamily: 'IBM Plex Mono, monospace',
            tableLayout: 'fixed',   /* sütunlar taşmaz */
          }}>
            <colgroup>
              <col style={{ width: 28 }}  />{/* P */}
              <col style={{ width: 6 }}   />{/* renk */}
              <col />{/* Pilot — kalan alanı kaplar */}
              <col style={{ width: 88 }}  />{/* Fark */}
              <col style={{ width: 80 }}  />{/* Aralık */}
              <col style={{ width: 26 }}  />{/* Lastik */}
              <col style={{ width: 26 }}  />{/* Pit */}
            </colgroup>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.07)',
                           background: 'rgba(255,255,255,0.02)' }}>
                {[
                  { label: 'P',      align: 'left'  },
                  { label: '',       align: 'left'  },
                  { label: 'PİLOT', align: 'left'  },
                  { label: 'FARK',   align: 'right' },
                  { label: 'ARALIK', align: 'right' },
                  { label: 'L',      align: 'right' },
                  { label: 'PIT',    align: 'right' },
                ].map(({ label, align }, i) => (
                  <th key={i} style={{
                    padding: '7px 6px', textAlign: align as any,
                    fontSize: 9, fontWeight: 600, letterSpacing: '0.1em',
                    color: 'rgba(240,244,255,0.22)',
                    overflow: 'hidden', whiteSpace: 'nowrap',
                  }}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 ? (
                <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center',
                  color: 'rgba(240,244,255,0.2)', fontSize: 12 }}>
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
                      color: e.position === 1 ? '#00D2BE' : 'rgba(240,244,255,0.25)' }}>
                      {e.position}
                    </td>

                    {/* Takım renk çubuğu */}
                    <td style={{ padding: '0 2px' }}>
                      <div style={{ width: 3, height: 18, borderRadius: 2, background: color, margin: 'auto' }} />
                    </td>

                    {/* Pilot adı + takım */}
                    <td style={{ padding: '6px 8px 6px 4px', overflow: 'hidden' }}>
                      <div style={{ fontSize: 12, fontWeight: 900, color: 'white',
                        lineHeight: 1, whiteSpace: 'nowrap' }}>{e.code}</div>
                      <div style={{ fontSize: 8, color: 'rgba(240,244,255,0.22)', marginTop: 1,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {e.team_name}
                      </div>
                    </td>

                    {/* Fark */}
                    <td style={{ padding: '7px 6px', textAlign: 'right', fontSize: 10, fontWeight: 600,
                      whiteSpace: 'nowrap', overflow: 'hidden',
                      color: e.status === 'DNS/DNF' ? 'rgba(240,244,255,0.25)'
                        : e.lapped ? '#f87171'
                        : e.position === 1 ? 'rgba(240,244,255,0.28)'
                        : 'rgba(240,244,255,0.75)' }}>
                      {e.status === 'DNS/DNF' ? 'DNS/DNF' : formatGap(e.gap_to_leader, e.position === 1)}
                    </td>

                    {/* Aralık */}
                    <td style={{ padding: '7px 6px', textAlign: 'right', fontSize: 10,
                      color: 'rgba(240,244,255,0.32)', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                      {e.interval ? formatGap(e.interval, false) : '—'}
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
                      ) : <span style={{ color: 'rgba(240,244,255,0.2)', fontSize: 10 }}>—</span>}
                    </td>

                    {/* Pit */}
                    <td style={{ padding: '7px 6px', textAlign: 'right', fontSize: 11, fontWeight: 700,
                      color: e.pit_count > 0 ? '#FF8700' : 'rgba(240,244,255,0.2)' }}>
                      {e.pit_count ?? 0}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* ── Sağ: Pist + Simülatör + RC + AI ──────────────────────── */}
        <div className="space-y-4">

          {/* Pist Haritası */}
          <div className="card overflow-hidden">
            <div className="px-5 py-3 border-b" style={{ borderColor: 'var(--b1)' }}>
              <p className="text-[13px] font-bold text-white">Pist Haritası</p>
            </div>
            {trackMap.isLoading ? (
              <div className="flex items-center justify-center h-48">
                <p className="text-[12px] mono" style={{ color:'var(--t3)' }}>Pist yükleniyor...</p>
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
          {entries.length > 0 && (
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
                          <p className="text-[9px] mono mt-0.5" style={{ color: 'rgba(240,244,255,0.2)' }}>
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
                      ? 'AI yorumu canlı yarış sırasında aktif olur'
                      : 'Yarış başladığında yorum başlayacak...'}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes pulse-dot { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.4;transform:scale(0.8)} }
        @keyframes bounce-dot { 0%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-6px)} }
      `}</style>
    </div>
  )
}
