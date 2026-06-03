import React, { useState, useCallback, useEffect, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { telemetryApi, client } from '../api/client'
import { useUIStore } from '../store/uiStore'
import { useCommunityStore } from '../store/communityStore'
import { TelemetryChart } from '../components/telemetry/TelemetryChart'
import { AIInsightPanel } from '../components/telemetry/AIInsightPanel'
import { LapSummaryCard } from '../components/telemetry/LapSummaryCard'
import { TrackMap } from '../components/trackmap/TrackMap'
import { CommentFeed } from '../components/community/CommentFeed'
import { PollWidget } from '../components/community/PollWidget'
import { StrategySimulator } from '../components/telemetry/StrategySimulator'
import { SessionLeaderboard } from '../components/session/SessionLeaderboard'
import { DriverRaceSummary } from '../components/session/DriverRaceSummary'
import { CircuitGuide } from '../components/session/CircuitGuide'
import { RaceReplay } from '../components/session/RaceReplay'
import { TyreDegradation } from '../components/analysis/TyreDegradation'
import { TeammatePace } from '../components/analysis/TeammatePace'
import { EnergyAnalysis } from '../components/analysis/EnergyAnalysis'
import { CHANNELS, COMPOUND_COLORS, SESSION_LABELS, type TelemetryPoint, type SessionType } from '../types/f1'

// ── Topluluk paneli (yorum + anket sekmeli) ───────────────────────────────────
function CommunityPanel({ sessionId, isLoggedIn }: { sessionId: number; isLoggedIn: boolean }) {
  const [tab, setTab] = React.useState<'comments' | 'polls'>('comments')
  return (
    <div className="card overflow-hidden flex flex-col">
      {/* Sekmeler */}
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
      <div className="flex-1 min-h-0">
        {tab === 'comments'
          ? <CommentFeed sessionId={sessionId} isAuthenticated={isLoggedIn} />
          : <PollWidget sessionId={sessionId} userId={null} isAuthenticated={isLoggedIn} />
        }
      </div>
    </div>
  )
}
import { formatLapTime } from '../utils/format'
import { F1Loader } from '../components/ui/F1Loader'
import { ErrorCard } from '../components/ui/ErrorCard'

const LAP_OPTIONS = ['fastest','1','2','3','4','5','10','15','20','30','40','50']

/** Telemetri grafiği altında tahmini batarya doluluk şeridi */
function SocMiniStrip({ sessionId, driverCode }: { sessionId: number; driverCode: string }) {
  const { data } = useQuery({
    queryKey: ['energy', sessionId, driverCode],
    queryFn:  () => client.get(`/sessions/${sessionId}/energy_analysis/${driverCode}`).then(r => r.data),
    staleTime: Infinity,
    retry: 0,
  })

  if (!data?.soc_curve?.length) return null

  const curve: any[] = data.soc_curve
  if (!curve.length) return null
  const step = curve.length

  return (
    <div className="card px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] mono font-semibold" style={{ color: 'var(--t2)' }}>
          ⚡ TAHMİNİ BATARYA DOLULUK
        </p>
        <p className="text-[10px] mono" style={{ color: 'var(--t3)' }}>
          Fizik modeli · yaklaşık değer
        </p>
      </div>
      {/* Bar grafik — index bazlı x ekseni */}
      <div className="flex items-end gap-px rounded-lg overflow-hidden h-10"
        style={{ background: 'rgba(255,255,255,0.04)' }}>
        {curve.filter((_: any, i: number) => i % Math.max(1, Math.floor(step / 120)) === 0).map((pt: any, i: number, arr: any[]) => (
          <div key={i} className="flex-1 rounded-t-sm transition-all"
            style={{
              height:     `${Math.max(4, pt.soc_pct)}%`,
              background: pt.x_mode > 0.6 ? 'rgba(255,255,255,0.8)'
                : pt.soc_pct < 20 ? '#E10600'
                : pt.soc_pct < 50 ? '#FF8700'
                : '#00D2BE',
              opacity: 0.85,
            }} />
        ))}
      </div>
      <div className="flex justify-between mt-1.5 text-[10px] mono" style={{ color: 'var(--t3)' }}>
        <div className="flex gap-3">
          <span style={{ color: '#00D2BE' }}>■ Dolu</span>
          <span style={{ color: '#FF8700' }}>■ Düşük</span>
          <span style={{ color: '#E10600' }}>■ Kritik</span>
          <span style={{ color: 'rgba(255,255,255,0.6)' }}>■ X-mode</span>
        </div>
        <span>Yarış boyunca →</span>
      </div>
    </div>
  )
}

const SESSION_TABS = [
  { id: 'telemetry', label: 'Telemetri', emoji: '📈' },
  { id: 'analysis',  label: 'Analiz',    emoji: '📋' },
  { id: 'standings', label: 'Sıralama',  emoji: '🏆' },
  { id: 'strategy',  label: 'Strateji',  emoji: '🔧' },
] as const

type SessionTab = typeof SESSION_TABS[number]['id']

function StatTile({
  label, value, unit, color, sublabel,
}: {
  label: string; value: string; unit?: string; color?: string; sublabel?: string
}) {
  return (
    <div className="card p-4 flex flex-col gap-1"
      style={color ? { borderColor: color + '30', background: color + '08' } : {}}>
      <p className="text-[10px] mono font-semibold tracking-widest" style={{ color: 'var(--t3)' }}>
        {label}
      </p>
      <p className="text-2xl font-black mono leading-none" style={{ color: color ?? 'white' }}>
        {value}
      </p>
      {unit && <p className="text-[10px]" style={{ color: 'var(--t3)' }}>{unit}</p>}
      {sublabel && <p className="text-[10px]" style={{ color: 'var(--t2)' }}>{sublabel}</p>}
    </div>
  )
}

export function SessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const sid = Number(sessionId)
  const isLoggedIn = !!localStorage.getItem('access_token')

  const {
    insightMode, setInsightMode,
    activeChannel, setActiveChannel,
    selectedPoint, setSelectedPoint,
    primaryDriver, secondaryDriver,
    setPrimaryDriver, setSecondaryDriver,
    compareMode, setCompareMode,
  } = useUIStore()

  const { connect: connectCommunity, disconnect: disconnectCommunity } = useCommunityStore()
  const [lapA, setLapA] = useState('fastest')
  const [lapB, setLapB] = useState('fastest')
  const [activeTab, setActiveTab] = useState<SessionTab>('telemetry')

  useEffect(() => {
    if (sid) connectCommunity(sid)
    return () => disconnectCommunity()
  }, [sid])

  /* ── Session info (race name + type) ── */
  const sessionInfo = useQuery({
    queryKey: ['session-info', sid],
    queryFn:  () => client.get(`/sessions/${sid}`).then(r => r.data),
    enabled:  !!sid,
    staleTime: Infinity,
  })


  const telA = useQuery({
    queryKey: ['telemetry', sid, primaryDriver, lapA],
    queryFn:  () => telemetryApi.get(sid, primaryDriver, lapA),
    enabled:  !!sid,
    staleTime: 300_000,
  })
  const telB = useQuery({
    queryKey: ['telemetry', sid, secondaryDriver, lapB],
    queryFn:  () => telemetryApi.get(sid, secondaryDriver, lapB),
    enabled:  !!sid && compareMode,
    staleTime: 300_000,
  })
  const trackMap = useQuery({
    queryKey: ['track_map', sid, primaryDriver],
    queryFn:  () => telemetryApi.trackMap(sid, primaryDriver),
    enabled:  !!sid,
    staleTime: 86_400_000,
  })
  // Karşılaştırma modunda ikinci pilotun farklı çizgisini göstermek için
  const trackMapB = useQuery({
    queryKey: ['track_map', sid, secondaryDriver],
    queryFn:  () => telemetryApi.trackMap(sid, secondaryDriver),
    enabled:  !!sid && compareMode,
    staleTime: 86_400_000,
  })
  const stints = useQuery({
    queryKey: ['stints', sid],
    queryFn:  () => telemetryApi.stints(sid),
    enabled:  !!sid,
    staleTime: 300_000,
  })

  const handlePointClick = useCallback(
    (pt: TelemetryPoint) => setSelectedPoint(pt),
    [setSelectedPoint]
  )

  /**
   * Karşılaştırma modunda B pilotunun seçili noktaya (dist_m) en yakın
   * noktasını döner. useMemo ile sadece bağımlılıklar değiştiğinde yeniden hesaplanır —
   * her render'da yeni referans oluşturmaz, sonsuz döngüyü önler.
   */
  const comparePoint = useMemo<TelemetryPoint | null>(() => {
    if (!compareMode || !selectedPoint || !telB.data?.telemetry?.length) return null
    const telem = telB.data.telemetry
    const target = selectedPoint.dist_m
    return telem.reduce((best, curr) =>
      Math.abs(curr.dist_m - target) < Math.abs(best.dist_m - target) ? curr : best
    )
  }, [compareMode, selectedPoint?.dist_m, telB.data?.telemetry])

  /**
   * Pist haritası üzerindeki pilot pozisyonları.
   * dist_m / maxDist oranı → track map noktası dizisindeki index.
   */
  const driverPositions = useMemo(() => {
    if (!selectedPoint) return []

    const maxDistA = telA.data?.telemetry?.at(-1)?.dist_m ?? 0
    const ratioA   = maxDistA > 0 ? selectedPoint.dist_m / maxDistA : 0

    const positions = [{ ratio: ratioA, code: primaryDriver, color: '#E10600' }]

    if (compareMode && comparePoint && telB.data?.telemetry?.length) {
      const maxDistB = telB.data.telemetry.at(-1)?.dist_m ?? maxDistA
      const ratioB   = maxDistB > 0 ? comparePoint.dist_m / maxDistB : 0
      // color '#FF8700' ile TrackMap'teki compareColor eşleşmeli
      positions.push({ ratio: ratioB, code: secondaryDriver, color: '#FF8700' })
    }

    return positions
  }, [selectedPoint, comparePoint, compareMode, primaryDriver, secondaryDriver,
      telA.data?.telemetry, telB.data?.telemetry])

  /** Seçili tur için stint bilgisi (lastik bileşiği + yaş) */
  const stintInfo = useMemo<{ compound: string | null; age: number | null }>(() => {
    if (!stints.data?.stints || !telA.data?.lap?.number) return { compound: null, age: null }
    const lapNum = telA.data.lap.number
    const driverStints = (stints.data.stints as any[])
      .filter((s: any) => s.driver_code === primaryDriver)
    const cur = driverStints.find(
      (s: any) => s.lap_start <= lapNum && (s.lap_end >= lapNum || !s.lap_end)
    )
    if (!cur) return { compound: null, age: null }
    const age = lapNum - (cur.lap_start ?? lapNum) + (cur.tyre_age_at_start ?? 0)
    return { compound: cur.compound ?? null, age }
  }, [stints.data?.stints, telA.data?.lap?.number, primaryDriver])

  const tyreAge = stintInfo.age

  /** Toplam tur sayısı — stints'teki en yüksek lap_end değerinden */
  const totalLapsFromStints = useMemo(() => {
    if (!stints.data?.stints?.length) return 0
    const maxLap = Math.max(
      ...(stints.data.stints as any[]).map((s: any) => s.lap_end ?? 0)
    )
    return maxLap > 10 ? maxLap : 0
  }, [stints.data?.stints])

  /**
   * Referans tur süresi — seçili pilotun geçerli turlarının ortalaması.
   * Stintlerdeki en hızlı turdan hesaplıyoruz (leaderboard'dan gelir).
   * Yedek: telA.data?.lap?.duration (en hızlı tur).
   */
  const refLapTime = useMemo(() => {
    // Önce en hızlı tur + %1.5 (ortalama pace tahmini)
    const fastest = telA.data?.lap?.duration
    if (fastest && fastest > 0) return Math.round(fastest * 1.015 * 10) / 10
    return 90.0
  }, [telA.data?.lap?.duration])

  // Stints'ten o yarışa katılan pilotlar (unique, kod sırası)
  const sessionDrivers: string[] = stints.data?.stints
    ? [...new Set<string>(
        (stints.data.stints as any[])
          .map((s: any) => s.driver_code as string)
          .filter(Boolean)
      )].sort()
    : []

  const sp  = selectedPoint
  const ch  = CHANNELS.find(c => c.key === activeChannel)!
  const lap = telA.data?.lap

  const roundName    = sessionInfo.data?.round?.name ?? '...'
  const sessionLabel = sessionInfo.data?.type
    ? (SESSION_LABELS[sessionInfo.data.type as SessionType] ?? sessionInfo.data.type)
    : '...'

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)', overflowX: 'clip' }}>

      {/* ── Sticky Header ─────────────────────────────────── */}
      <div className="sticky top-14 z-40 border-b"
        style={{ background: 'rgba(5,8,15,0.95)', backdropFilter: 'blur(16px)',
                 borderColor: 'var(--b1)' }}>
        <div className="max-w-7xl mx-auto px-6 py-3">
          {/* Breadcrumb — sadece desktop'ta göster */}
          <div className="hidden sm:flex items-center gap-2 text-[11px] mono mb-1" style={{ color:'var(--t3)' }}>
            <Link to="/" className="hover:text-white/60 transition-colors">Ana Sayfa</Link>
            <span>/</span>
            <Link to={`/season/${sessionInfo.data?.round?.season_year ?? new Date().getFullYear()}`}
              className="hover:text-white/60 transition-colors">
              {sessionInfo.data?.round?.season_year ?? new Date().getFullYear()}
            </Link>
            <span>/</span>
            <span style={{ color:'var(--t2)' }}>{roundName}</span>
            <span>/</span>
            <span className="text-white">{sessionLabel}</span>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <h1 className="text-xl font-black text-white leading-none">{roundName}</h1>
              <span className="text-[11px] mono font-semibold px-2.5 py-1 rounded-full
                               bg-[#E10600]/15 text-[#E10600] border border-[#E10600]/25">
                {sessionLabel.toUpperCase()}
              </span>
              {lap && (
                <div className="hidden md:flex items-center gap-3">
                  <span className="text-[14px] font-black mono" style={{ color: '#E10600' }}>
                    {formatLapTime(lap.duration)}
                  </span>
                  {compareMode && telB.data?.lap && (
                    <>
                      <span style={{ color: 'var(--t3)' }}>vs</span>
                      <span className="text-[14px] font-black mono" style={{ color: '#FF8700' }}>
                        {formatLapTime(telB.data.lap.duration)}
                      </span>
                    </>
                  )}
                  {lap.compound && (
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded"
                      style={{ background: (COMPOUND_COLORS[lap.compound] ?? '#888') + '20',
                               color: COMPOUND_COLORS[lap.compound] ?? '#888' }}>
                      ● {lap.compound}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Mode toggle */}
            <div className="flex items-center gap-1 p-1 rounded-xl"
              style={{ background: 'var(--s2)', border: '1px solid var(--b1)' }}>
              {(['beginner', 'expert'] as const).map(m => (
                <button key={m} onClick={() => setInsightMode(m)}
                  className="px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all"
                  style={insightMode === m
                    ? { background: '#E10600', color: 'white' }
                    : { color: 'var(--t2)' }}>
                  {m === 'beginner' ? '🟢 Sade' : '⚡ Uzman'}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Unified sticky tab bar — hem mobil hem desktop */}
      <div className="border-b sticky top-14 z-30"
        style={{ background:'rgba(5,8,15,0.97)', backdropFilter:'blur(12px)', borderColor:'var(--b1)' }}>
        <div className="max-w-7xl mx-auto px-2 sm:px-6 flex overflow-x-auto" style={{ scrollbarWidth:'none' }}>
          {SESSION_TABS.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              className="flex items-center gap-2 px-4 py-3 text-[13px] font-semibold transition-all border-b-2 shrink-0"
              style={{
                color: activeTab===t.id ? 'white' : 'rgba(240,244,255,0.3)',
                borderBottomColor: activeTab===t.id ? '#E10600' : 'transparent',
                background: activeTab===t.id ? 'rgba(225,6,0,0.05)' : 'transparent',
              }}>
              <span>{t.emoji}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-5 pb-6">

        {/* ── Driver & Lap Controls ──────────────────────────── */}
        <div className="card p-4">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-[10px] mono font-semibold tracking-widest shrink-0"
              style={{ color:'var(--t3)' }}>PILOT & TUR</p>

            {/* Driver A */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] mono font-semibold" style={{ color:'var(--t3)' }}>A</span>
              <select
                value={primaryDriver}
                onChange={e => setPrimaryDriver(e.target.value)}
                className="px-3 py-2 rounded-xl text-[13px] font-black mono cursor-pointer"
                style={{
                  background:'rgba(225,6,0,0.08)',
                  border:'1px solid rgba(225,6,0,0.30)',
                  color:'#E10600',
                  outline:'none',
                  minWidth: 90,
                }}
              >
                {sessionDrivers.length > 0
                  ? sessionDrivers.map(code => (
                      <option key={code} value={code}>{code}</option>
                    ))
                  : <option value={primaryDriver}>{primaryDriver}</option>
                }
              </select>
            </div>

            <select value={lapA} onChange={e => setLapA(e.target.value)}
              className="px-3 py-2 rounded-xl text-[12px] mono cursor-pointer"
              style={{ background:'var(--s2)', border:'1px solid var(--b1)', color:'var(--t2)',
                       outline:'none' }}>
              <option value="fastest">⚡ En Hızlı</option>
              {['1','2','3','4','5','10','15','20','30','40','50'].map(l => (
                <option key={l} value={l}>Tur {l}</option>
              ))}
            </select>

            {/* Compare toggle */}
            <button onClick={() => setCompareMode(!compareMode)}
              className="px-4 py-2 rounded-xl text-[12px] font-medium transition-all"
              style={compareMode
                ? { background:'rgba(255,135,0,0.12)', border:'1px solid rgba(255,135,0,0.35)',
                    color:'#FF8700' }
                : { background:'var(--s2)', border:'1px solid var(--b1)', color:'var(--t2)' }}>
              {compareMode ? '✕ Karşılaştırmayı Kapat' : '+ Karşılaştır'}
            </button>

            {compareMode && (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] mono font-semibold" style={{ color:'var(--t3)' }}>B</span>
                  <select
                    value={secondaryDriver}
                    onChange={e => setSecondaryDriver(e.target.value)}
                    className="px-3 py-2 rounded-xl text-[13px] font-black mono cursor-pointer"
                    style={{
                      background:'rgba(255,135,0,0.08)',
                      border:'1px solid rgba(255,135,0,0.30)',
                      color:'#FF8700',
                      outline:'none',
                      minWidth: 90,
                    }}
                  >
                    {sessionDrivers.length > 0
                      ? sessionDrivers.map(code => (
                          <option key={code} value={code}>{code}</option>
                        ))
                      : <option value={secondaryDriver}>{secondaryDriver}</option>
                    }
                  </select>
                </div>
                <select value={lapB} onChange={e => setLapB(e.target.value)}
                  className="px-3 py-2 rounded-xl text-[12px] mono cursor-pointer"
                  style={{ background:'var(--s2)', border:'1px solid rgba(255,135,0,0.2)',
                           color:'var(--t2)', outline:'none' }}>
                  <option value="fastest">⚡ En Hızlı</option>
                  {['1','2','3','4','5','10','15','20','30','40','50'].map(l => (
                    <option key={l} value={l}>Tur {l}</option>
                  ))}
                </select>
              </>
            )}
          </div>
        </div>

        {/* ── Channel Tabs ──────────────────────────────────── */}
        <div className="flex gap-2 flex-wrap items-center">
          {CHANNELS.map(c => (
            <button key={c.key} onClick={() => setActiveChannel(c.key)}
              className="px-4 py-2 rounded-xl text-[12px] font-semibold transition-all"
              style={activeChannel === c.key
                ? { background: c.color + '18', border:`1px solid ${c.color}50`, color: c.color }
                : { background:'var(--s1)', border:'1px solid var(--b1)', color:'var(--t2)' }}>
              {c.label}
              <span className="ml-1.5 text-[10px]" style={{ color: activeChannel===c.key ? c.color+'aa' : 'var(--t3)' }}>
                {c.unit}
              </span>
            </button>
          ))}
          <span className="hidden sm:inline text-[11px] ml-2" style={{ color:'var(--t3)' }}>
            ← Grafiğe tıkla → AI yorum
          </span>
        </div>

        {/* ══ TAB İÇERİKLERİ ══════════════════════════════════ */}

        {/* ── 📈 TELEMETRİ ─────────────────────────────────── */}
        {activeTab === 'telemetry' && <>
          {telA.isLoading ? (
            <div className="card h-52 flex items-center justify-center">
              <F1Loader text={`${primaryDriver} yükleniyor...`} />
            </div>
          ) : telA.isError ? (
            <ErrorCard compact
              title="Telemetri yüklenemedi"
              message="OpenF1'den veri alınamadı. Pilot kodu doğru mu?"
              onRetry={() => telA.refetch()}
            />
          ) : telA.data ? (<>
            <TelemetryChart
              data={telA.data.telemetry}
              activeChannel={activeChannel}
              selectedPoint={selectedPoint}
              onPointClick={handlePointClick}
              compareData={compareMode && telB.data ? telB.data.telemetry : undefined}
            />
            {/* Kompakt SoC şeridi */}
            <SocMiniStrip sessionId={sid} driverCode={primaryDriver} />
          </>) : null}

          {/* Anlık değerler */}
          {sp ? (
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 sm:gap-3 animate-fade-up">
              <StatTile label="HIZ"   value={sp.speed != null ? String(sp.speed) : '—'} unit="km/sa" color={(sp.speed??0)>280?'#E10600':undefined} />
              <StatTile label="GAZ"   value={sp.throttle != null ? `${sp.throttle}%` : '—'} color={(sp.throttle??0)>90?'#00D2BE':undefined} />
              <StatTile label="FREN"  value={sp.brake != null ? `${sp.brake}%` : '—'} color={(sp.brake??0)>50?'#FF8700':undefined} />
              <StatTile label="VİTES" value={sp.gear != null ? String(sp.gear) : '—'} />
              <StatTile label="DRS"   value={(sp.drs??0)>0?'AÇIK':'KAPALI'} color={(sp.drs??0)>0?'#00D2BE':undefined} />
              <StatTile label="RPM"   value={sp.rpm != null ? sp.rpm.toLocaleString() : '—'} />
            </div>
          ) : lap && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
              <StatTile label="TUR SÜRESİ" value={formatLapTime(lap.duration)} color="#E10600" />
              <StatTile label="S1" value={formatLapTime(lap.sector1)} />
              <StatTile label="S2" value={formatLapTime(lap.sector2)} />
              <StatTile label="S3" value={formatLapTime(lap.sector3)} />
            </div>
          )}

          {/* AI + Topluluk */}
          <div className="grid md:grid-cols-2 gap-4">
            <AIInsightPanel
              selectedPoint={sp}
              mode={insightMode}
              driverCode={primaryDriver}
              comparePoint={comparePoint}
              compareDriver={compareMode ? secondaryDriver : undefined}
            />
            <CommunityPanel sessionId={sid} isLoggedIn={isLoggedIn} />
          </div>
        </>}

        {/* ── 📋 ANALİZ ────────────────────────────────────── */}
        {activeTab === 'analysis' && <>
          <CircuitGuide
            raceName={sessionInfo.data?.round?.name ?? null}
            raceDate={sessionInfo.data?.round?.race_date ?? null}
          />
          <LapSummaryCard
            lap={telA.data?.lap ?? null}
            keyMoments={telA.data?.key_moments ?? []}
            mode={insightMode}
            driverCode={primaryDriver}
            compareLap={compareMode ? (telB.data?.lap ?? null) : null}
            compareDriver={compareMode ? secondaryDriver : undefined}
            tyreCompound={stintInfo.compound ?? telA.data?.lap?.compound ?? null}
            tyreAge={tyreAge}
          />
          <DriverRaceSummary
            sessionId={sid}
            driverCode={primaryDriver}
            sessionType={sessionInfo.data?.type}
          />
          {/* Pist haritası */}
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b" style={{ borderColor:'var(--b1)' }}>
              <p className="text-[11px] mono font-semibold tracking-widest" style={{ color:'var(--t3)' }}>PİST HARİTASI</p>
            </div>
            {trackMap.isLoading ? (
              <div className="flex items-center justify-center h-48">
                <F1Loader text="Pist yükleniyor..." />
              </div>
            ) : (
              <TrackMap
                points={trackMap.data?.points ?? []}
                driverPositions={driverPositions}
                speedTelemetry={telA.data?.telemetry}
                compareTelemetry={compareMode && telB.data?.telemetry?.length ? telB.data.telemetry : undefined}
                primaryColor="#E10600" compareColor="#FF8700"
                primaryLabel={primaryDriver}
                compareLabel={compareMode ? secondaryDriver : undefined}
                height={320} showCorners
              />
            )}
          </div>
          {/* 2026 Enerji Analizi — sadece yarış / sprint */}
          {sessionDrivers.length >= 2 && ['race','sprint'].includes(sessionInfo.data?.type ?? '') && (
            <EnergyAnalysis sessionId={sid} sessionDrivers={sessionDrivers} primaryDriver={primaryDriver} />
          )}

          {/* Takım Arkadaşı Pace */}
          <TeammatePace sessionId={sid} />

          {/* Lastik Degradasyon */}
          <TyreDegradation sessionId={sid} />

          {/* Replay — sadece yarış/sprint oturumlarında */}
          {['race','sprint'].includes(sessionInfo.data?.type ?? '') && (
            <RaceReplay
              sessionId={sid}
              trackPoints={trackMap.data?.points ?? []}
              sessionDrivers={sessionDrivers}
            />
          )}

          {/* Stintler */}
          {(stints.data?.stints?.length ?? 0) > 0 && (
            <div className="card p-4">
              <p className="text-[11px] mono font-semibold tracking-widest mb-4" style={{ color:'var(--t3)' }}>LASTİK STİNTLERİ</p>
              <div className="space-y-2.5 overflow-x-auto">
                {Object.entries(
                  (stints.data!.stints as any[]).reduce<Record<string,any[]>>((acc,s) => {
                    const c = s.driver_code||'?'; if(!acc[c])acc[c]=[]; acc[c].push(s); return acc
                  }, {})
                ).map(([code, ds]) => (
                  <div key={code} className="flex items-center gap-3 min-w-0">
                    <span className="w-10 shrink-0 text-[13px] font-black mono text-white">{code}</span>
                    <div className="flex gap-1.5 flex-wrap">
                      {ds.map((s:any,i:number) => {
                        const laps=(s.lap_end||0)-(s.lap_start||0)+1
                        const cmp=(s.compound||'UNKNOWN').toUpperCase()
                        const col=COMPOUND_COLORS[cmp]??'#888'
                        return <div key={i} className="rounded-lg text-[10px] mono font-bold text-center py-1.5"
                          style={{minWidth:`${Math.max(laps*2.5,28)}px`,background:col+'20',border:`1px solid ${col}40`,color:col}}
                          title={`${cmp}·T${s.lap_start}–${s.lap_end}`}>{cmp[0]}</div>
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[10px] mono mt-3" style={{ color:'var(--t3)' }}>S·M·H·I·W</p>
            </div>
          )}
        </>}

        {/* ── 🏆 SIRALAMA ──────────────────────────────────── */}
        {activeTab === 'standings' && (
          <SessionLeaderboard
            sessionId={sid}
            selectedDriver={primaryDriver}
            currentLap={lapA}
            onDriverSelect={code => { setPrimaryDriver(code); setSelectedPoint(null) }}
          />
        )}

        {/* ── 🔧 STRATEJİ ──────────────────────────────────── */}
        {activeTab === 'strategy' && (
          <div className="card overflow-hidden">
            <StrategySimulator
              sessionId={sid}
              totalLaps={totalLapsFromStints || 58}
              currentLap={telA.data?.lap?.number ?? 25}
              refLapTime={refLapTime}
              driverCode={primaryDriver}
            />
          </div>
        )}

      </div>

      <style>{`
        @keyframes bounce-dot {
          0%,80%,100% { transform:translateY(0) }
          40%         { transform:translateY(-6px) }
        }
      `}</style>
    </div>
  )
}
