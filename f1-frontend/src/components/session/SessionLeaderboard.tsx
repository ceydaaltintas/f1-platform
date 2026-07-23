import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { client } from '../../api/client'
import { ErrorCard } from '../ui/ErrorCard'
import { formatLapTime, formatSectorTime } from '../../utils/format'
import { COMPOUND_COLORS } from '../../types/f1'
import { useTranslation } from 'react-i18next'

// ── Tipler ──────────────────────────────────────────────────────────────────

interface RaceEntry {
  position: number; code: string; full_name: string
  team_name: string; team_colour: string
  grid: number; gap_str: string; status: string
  fastest_lap: string | null; fastest_lap_rank: number | null
  points: number
  // Dinamik (lap=N) için
  total_time?: number
}

interface QualiEntry {
  position: number; code: string; full_name: string
  team_name: string; team_colour: string
  lap_time: number; gap: number; q_segment: string | null
  sector1: number | null; sector2: number | null; sector3: number | null
  sector1_is_best: boolean; sector2_is_best: boolean; sector3_is_best: boolean
  compound: string | null
}

interface Props {
  sessionId: number
  selectedDriver?: string
  onDriverSelect?: (code: string) => void
  currentLap?: string
}

// ── Yardımcı bileşenler ─────────────────────────────────────────────────────

function TeamBar({ colour }: { colour: string }) {
  return <div className="w-1 h-6 rounded-full self-center" style={{ background: colour }} />
}

function Tyre({ compound }: { compound: string | null }) {
  if (!compound) return <span style={{ color: 'var(--t3)' }}>—</span>
  const c = COMPOUND_COLORS[compound] ?? '#888'
  return (
    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-black"
      style={{ background: c + '22', color: c, border: `1.5px solid ${c}55` }}
      title={compound}>
      {compound[0]}
    </span>
  )
}

function S({ time, best }: { time: number | null; best: boolean }) {
  if (!time) return <span className="text-[12px] mono" style={{ color: 'var(--t3)' }}>—</span>
  return (
    <span className="text-[12px] font-bold mono" style={{ color: best ? '#00D2BE' : 'var(--t2)' }}>
      {formatSectorTime(time)}
    </span>
  )
}

// ── Ana bileşen ─────────────────────────────────────────────────────────────

export function SessionLeaderboard({ sessionId, selectedDriver, onDriverSelect, currentLap }: Props) {
  const { t } = useTranslation()
  const [qualiFilter, setQualiFilter] = useState<'ALL' | 'Q3' | 'Q2' | 'Q1'>('ALL')

  const lapNum = currentLap && currentLap !== 'fastest' ? parseInt(currentLap) : undefined

  const { data, isLoading, isError } = useQuery({
    queryKey: ['leaderboard', sessionId, lapNum ?? 'final'],
    queryFn:  () =>
      client.get(`/sessions/${sessionId}/leaderboard${lapNum ? `?lap=${lapNum}` : ''}`)
        .then(r => r.data),
    staleTime: lapNum ? 30_000 : 60_000,
    refetchInterval: 120_000,
  })

  if (isLoading) return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-4">
        <p className="text-[11px] mono font-semibold tracking-widest" style={{ color: 'var(--t3)' }}>{t('live.standings_title').toUpperCase()}</p>
        <div className="flex gap-1">{[0,1,2].map(i => <span key={i} className="w-1.5 h-1.5 rounded-full bg-[#E10600]" style={{ animation:`bounce-dot 0.8s ${i*0.15}s infinite` }} />)}</div>
      </div>
      <div className="space-y-2">{Array(8).fill(0).map((_,i) => <div key={i} className="h-9 rounded-lg animate-pulse" style={{ background:'var(--s2)' }} />)}</div>
      <style>{`@keyframes bounce-dot{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-4px)}}`}</style>
    </div>
  )

  if (isError || !data) return (
    <ErrorCard compact
      title={t('leaderboard.error_title')}
      message={t('leaderboard.error_msg')}
      onRetry={() => window.location.reload()}
    />
  )

  if (data.syncing) return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-4">
        <p className="text-[11px] mono font-semibold tracking-widest" style={{ color: 'var(--t3)' }}>{t('live.standings_title').toUpperCase()}</p>
        <div className="flex gap-1">{[0,1,2].map(i => <span key={i} className="w-1.5 h-1.5 rounded-full bg-[#E10600]" style={{ animation:`bounce-dot 0.8s ${i*0.15}s infinite` }} />)}</div>
      </div>
      <p className="text-[12px] text-center py-6" style={{ color: 'var(--t3)' }}>
        {t('leaderboard.loading_hint')}
      </p>
      <style>{`@keyframes bounce-dot{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-4px)}}`}</style>
    </div>
  )

  const isRace: boolean  = data.is_race ?? false
  const isQuali: boolean = data.is_quali ?? false
  const isDynamic        = isRace && !!lapNum
  const sessionType      = data.session_type ?? ''
  const segments         = data.segments ?? {}
  const SESSION_LABELS: Record<string, string> = {
    practice1: t('session.practice1'), practice2: t('session.practice2'), practice3: t('session.practice3'),
    qualifying: t('session.qualifying'), sprint_qualifying: t('session.sprint_qualifying'),
    sprint: t('session.sprint'), race: t('session.race'),
  }

  // ── YARIŞ ────────────────────────────────────────────────────────────────
  if (isRace) {
    const entries: RaceEntry[] = data.entries ?? []
    const COLS = '28px 6px 1fr 72px 100px 80px 36px'

    return (
      <div className="card overflow-hidden">
        {/* Başlık */}
        <div className="flex items-center gap-3 px-5 py-3.5 border-b" style={{ borderColor:'var(--b1)' }}>
          <p className="text-[13px] font-bold text-white">{t('leaderboard.title', { session: SESSION_LABELS[sessionType] ?? sessionType })}</p>
          {isDynamic
            ? <span className="text-[11px] mono px-2 py-0.5 rounded font-semibold" style={{ background:'rgba(255,135,0,0.12)', color:'#FF8700', border:'1px solid rgba(255,135,0,0.3)' }}>{t('leaderboard.at_lap', { n: lapNum })}</span>
            : <span className="text-[11px] mono" style={{ color:'var(--t3)' }}>{t('leaderboard.final', { n: entries.length })}</span>
          }
        </div>

        {/* Tablo başlığı */}
        <div className="grid px-4 py-2 border-b text-[10px] mono font-semibold tracking-wider"
          style={{ gridTemplateColumns:COLS, borderColor:'var(--b1)', color:'var(--t3)', background:'rgba(255,255,255,0.02)' }}>
          <span>{t('leaderboard.col_pos')}</span><span /><span>{t('leaderboard.col_driver')}</span>
          <span>{isDynamic ? t('leaderboard.col_prev_lap') : t('leaderboard.col_grid')}</span>
          <span>GAP</span>
          <span>{t('leaderboard.col_best_lap')}</span>
          <span>PTS</span>
        </div>

        {/* Satırlar */}
        {entries.map((e, i) => {
          const isSelected = e.code === selectedDriver
          return (
            <div key={e.code}
              className="grid items-center px-4 py-2.5 border-b cursor-pointer transition-all"
              style={{ gridTemplateColumns:COLS, borderColor:'var(--b1)',
                background: isSelected ? 'rgba(225,6,0,0.08)' : 'transparent',
                borderLeft: isSelected ? '3px solid #E10600' : '3px solid transparent' }}
              onClick={() => onDriverSelect?.(e.code)}
              onMouseEnter={ev => { if (!isSelected) (ev.currentTarget as HTMLElement).style.background='rgba(255,255,255,0.03)' }}
              onMouseLeave={ev => { if (!isSelected) (ev.currentTarget as HTMLElement).style.background='transparent' }}>

              <span className="text-[13px] font-black mono" style={{ color: i===0 ? '#00D2BE' : 'var(--t3)' }}>{e.position}</span>
              <TeamBar colour={e.team_colour} />

              <div>
                <p className="text-[13px] font-black mono text-white leading-none">{e.code}</p>
                <p className="text-[10px] truncate mt-0.5" style={{ color:'var(--t3)' }}>{e.team_name}</p>
              </div>

              {/* Grid / Geçen tur */}
              <span className="text-[12px] mono" style={{ color:'var(--t3)' }}>
                {isDynamic
                  ? (e.total_time != null ? `${e.total_time.toFixed(0)}s` : '—')
                  : (e.grid ? `P${e.grid}` : '—')}
              </span>

              {/* Gap / Durum */}
              <div>
                <span className="text-[12px] mono"
                  style={{ color: i===0 ? 'var(--t3)' : e.status === 'Retired' || e.status === 'Did not start' ? '#f87171' : 'var(--t2)' }}>
                  {i===0 ? 'LDR' : (e.gap_str && e.gap_str !== 'LDR' ? e.gap_str : '—')}
                </span>
                {!isDynamic && e.status && e.status !== 'Finished' && (
                  <p className="text-[9px] mono truncate" style={{ color:'#f87171' }}>{e.status}</p>
                )}
              </div>

              {/* En hızlı tur */}
              <span className="text-[11px] mono font-bold"
                style={{ color: e.fastest_lap_rank === 1 ? '#c084fc' : 'var(--t2)' }}>
                {e.fastest_lap ?? '—'}
              </span>

              {/* Puan */}
              <span className="text-[12px] font-black mono" style={{ color: e.points > 0 ? 'white' : 'var(--t3)' }}>
                {e.points ?? 0}
              </span>
            </div>
          )
        })}

        <div className="px-5 py-2" style={{ background:'rgba(255,255,255,0.01)' }}>
          <p className="text-[10px] mono" style={{ color:'var(--t3)' }}>
            {t('leaderboard.click_hint')}
            {isDynamic ? '' : ' · Jolpica'}
          </p>
        </div>
      </div>
    )
  }

  // ── SIRALAMA / ANTRENMAN ─────────────────────────────────────────────────
  const allEntries: QualiEntry[] = data.entries ?? []
  const segCounts = { ALL: allEntries.length, Q3: segments.Q3?.length??0, Q2: segments.Q2?.length??0, Q1: segments.Q1?.length??0 }
  const filtered: QualiEntry[] = qualiFilter === 'ALL' ? allEntries : (segments[qualiFilter] ?? [])
  const COLS = '28px 6px 1fr 108px 72px 68px 68px 68px 28px'
  const Q_COLOR: Record<string,string> = { Q3:'#E10600', Q2:'#00D2BE', Q1:'#FF8700', ALL:'white' }

  return (
    <div className="card overflow-hidden">
      {/* Başlık */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b" style={{ borderColor:'var(--b1)' }}>
        <div className="flex items-center gap-3">
          <p className="text-[13px] font-bold text-white">{t('leaderboard.title', { session: SESSION_LABELS[sessionType] ?? sessionType })}</p>
          <span className="text-[11px] mono" style={{ color:'var(--t3)' }}>{allEntries.length}</span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] mono">
          <span className="w-2 h-2 rounded-full bg-[#00D2BE]" />
          <span style={{ color:'var(--t2)' }}>Session best</span>
        </div>
      </div>

      {/* Q Filtre sekmeleri */}
      {isQuali && (
        <div className="flex border-b" style={{ borderColor:'var(--b1)' }}>
          {(['ALL','Q3','Q2','Q1'] as const).map(tab => (
            <button key={tab} onClick={() => setQualiFilter(tab)}
              className="flex-1 py-2.5 text-[12px] font-semibold mono transition-all"
              style={{
                background: qualiFilter===tab ? Q_COLOR[tab]+'15' : 'transparent',
                color: qualiFilter===tab ? Q_COLOR[tab] : 'var(--t3)',
                borderBottom: qualiFilter===tab ? `2px solid ${Q_COLOR[tab]}` : '2px solid transparent',
              }}>
              {tab==='ALL' ? t('tyre_deg.all') : tab}
              <span className="ml-1 text-[10px] opacity-60">({segCounts[tab]})</span>
            </button>
          ))}
        </div>
      )}

      {/* Tablo başlığı */}
      <div className="grid px-4 py-2 border-b text-[10px] mono font-semibold tracking-wider"
        style={{ gridTemplateColumns:COLS, borderColor:'var(--b1)', color:'var(--t3)', background:'rgba(255,255,255,0.02)' }}>
        <span>{t('leaderboard.col_pos')}</span><span /><span>{t('leaderboard.col_driver')}</span>
        <span>{t('leaderboard.col_best_lap')}</span><span>GAP</span>
        <span>S1</span><span>S2</span><span>S3</span><span>L</span>
      </div>

      {/* Satırlar */}
      {filtered.length === 0
        ? <p className="px-5 py-8 text-center text-[12px]" style={{ color:'var(--t3)' }}>{t('leaderboard.no_data')}</p>
        : filtered.map((e, i) => {
            const isSelected = e.code === selectedDriver
            const isLeader   = i === 0
            const gap        = e.gap ?? 0
            return (
              <div key={e.code}
                className="grid items-center px-4 py-2.5 border-b cursor-pointer transition-all"
                style={{ gridTemplateColumns:COLS, borderColor:'var(--b1)',
                  background: isSelected ? 'rgba(225,6,0,0.08)' : 'transparent',
                  borderLeft: isSelected ? '3px solid #E10600' : '3px solid transparent' }}
                onClick={() => onDriverSelect?.(e.code)}
                onMouseEnter={ev => { if (!isSelected) (ev.currentTarget as HTMLElement).style.background='rgba(255,255,255,0.03)' }}
                onMouseLeave={ev => { if (!isSelected) (ev.currentTarget as HTMLElement).style.background='transparent' }}>

                <span className="text-[13px] font-black mono" style={{ color:isLeader?'#00D2BE':'var(--t3)' }}>{e.position}</span>
                <TeamBar colour={e.team_colour} />

                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-black mono text-white">{e.code}</span>
                    {isQuali && e.q_segment && qualiFilter==='ALL' && (
                      <span className="text-[9px] mono font-bold px-1.5 py-0.5 rounded"
                        style={{ background:Q_COLOR[e.q_segment]+'18', color:Q_COLOR[e.q_segment], border:`1px solid ${Q_COLOR[e.q_segment]}35` }}>
                        {e.q_segment}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] truncate mt-0.5" style={{ color:'var(--t3)' }}>{e.team_name}</p>
                </div>

                <span className="text-[13px] font-black mono" style={{ color:isLeader?'#00D2BE':'white' }}>
                  {formatLapTime(e.lap_time)}
                </span>

                <span className="text-[12px] mono" style={{ color:'var(--t2)' }}>
                  {isLeader ? <span style={{ color:'var(--t3)' }}>LDR</span>
                    : gap < 60 ? `+${gap.toFixed(3)}` : `+${formatLapTime(gap)}`}
                </span>

                <S time={e.sector1} best={e.sector1_is_best} />
                <S time={e.sector2} best={e.sector2_is_best} />
                <S time={e.sector3} best={e.sector3_is_best} />
                <Tyre compound={e.compound} />
              </div>
            )
          })
      }

      <div className="px-5 py-2.5" style={{ background:'rgba(255,255,255,0.01)' }}>
        <p className="text-[10px] mono" style={{ color:'var(--t3)' }}>
          {t('leaderboard.click_hint')} · Session best sector = teal
        </p>
      </div>
    </div>
  )
}
