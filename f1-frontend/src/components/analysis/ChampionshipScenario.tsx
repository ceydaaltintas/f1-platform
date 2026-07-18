/**
 * Şampiyona Senaryo Hesaplayıcı
 * "Lider şampiyonayı garantilemek için ne zaman kaç puan gerekiyor?"
 * Kalan yarışlarda alınabilecek maksimum puan × kombinasyonlar
 */

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { client, seasonApi } from '../../api/client'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

// F1 2025+ puan sistemi
const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]
const FASTEST_LAP = 1
const MAX_PER_RACE = POINTS[0] + FASTEST_LAP  // 26

interface Driver {
  code: string; first_name: string; last_name: string
  points: number; wins: number; position: number
}

interface Props { year: number }

export function ChampionshipScenario({ year }: Props) {
  const { t } = useTranslation()
  const [showAll, setShowAll] = useState(false)

  const drivers = useQuery({
    queryKey: ['standings', 'drivers', year],
    queryFn:  () => client.get(`/seasons/${year}/standings/drivers`).then(r => r.data),
    staleTime: 300_000,
    retry: 1,
  })

  const rounds = useQuery({
    queryKey: ['rounds', year, 'all'],
    queryFn:  () => seasonApi.rounds(year),
    staleTime: 300_000,
  })

  const remainingRaces = (rounds.data ?? []).filter((r: any) => r.round_status === 'upcoming').length
  const maxRemaining   = remainingRaces * MAX_PER_RACE

  const driversData: Driver[] = drivers.data ?? []
  const leader   = driversData[0]
  const display  = showAll ? driversData : driversData.slice(0, 8)

  // Scenarios for each driver
  const scenarios = useMemo(() => {
    if (!leader || !driversData.length) return []
    return driversData.map(d => {
      const gap         = leader.points - d.points
      const maxPossible = d.points + maxRemaining
      const canCatch    = maxPossible >= leader.points
      const guaranteeLap = !canCatch ? null : Math.ceil(
        remainingRaces - (maxPossible - leader.points) / MAX_PER_RACE
      )
      const clinchRace  = remainingRaces - Math.floor(
        (d.points - (driversData[1]?.points ?? 0) - maxRemaining / 2) / MAX_PER_RACE
      )
      return { ...d, gap, maxPossible, canCatch, guaranteeLap }
    })
  }, [driversData, leader, maxRemaining, remainingRaces])

  if (drivers.isLoading || rounds.isLoading) return (
    <div className="card p-5 text-center">
      <p className="text-[12px] mono animate-pulse" style={{ color:'var(--t3)' }}>{t('scenario.loading')}</p>
    </div>
  )

  if (!driversData.length) return (
    <div className="card p-5 text-center">
      <p className="text-[12px] mono" style={{ color:'var(--t3)' }}>{t('scenario.no_data')}</p>
    </div>
  )

  return (
    <div className="card overflow-hidden">
      {/* Title */}
      <div className="flex items-center justify-between px-5 py-4 border-b"
        style={{ borderColor:'var(--b1)' }}>
        <div className="flex items-center gap-3">
          <span className="text-xl">🏆</span>
          <div>
            <p className="text-[14px] font-bold text-white">{t('scenario.title', { year })}</p>
            <p className="text-[11px] mono mt-0.5" style={{ color:'var(--t3)' }}>
              {t('scenario.subtitle', { remaining: remainingRaces, max: maxRemaining })}
            </p>
          </div>
        </div>
      </div>

      {/* Leader card */}
      {leader && (
        <div className="px-5 py-4 border-b"
          style={{ borderColor:'var(--b1)', background:'rgba(255,215,0,0.04)' }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="text-center">
                <p className="text-[36px] font-black mono" style={{ color:'#FFD700' }}>
                  {leader.code}
                </p>
                <p className="text-[10px] mono" style={{ color:'var(--t3)' }}>{t('scenario.leader_label')}</p>
              </div>
              <div>
                <p className="text-[28px] font-black mono text-white leading-none">
                  {leader.points} <span className="text-[14px] font-normal" style={{ color:'var(--t3)' }}>{t('scenario.points_unit')}</span>
                </p>
                <p className="text-[12px] mt-1" style={{ color:'var(--t2)' }}>
                  {t('scenario.max_remaining', { pts: leader.points + maxRemaining })}
                </p>
              </div>
            </div>
            {remainingRaces === 0 ? (
              <div className="px-4 py-2 rounded-xl text-center"
                style={{ background:'rgba(255,215,0,0.15)', border:'1px solid rgba(255,215,0,0.3)' }}>
                <p className="text-[16px] font-black" style={{ color:'#FFD700' }}>{t('scenario.champion')}</p>
              </div>
            ) : (
              <div className="text-right">
                <p className="text-[12px] mono" style={{ color:'var(--t3)' }}>{t('scenario.gap_to_second')}</p>
                <p className="text-[24px] font-black mono" style={{ color:'#E10600' }}>
                  +{(leader.points - (driversData[1]?.points ?? 0))}
                  <span className="text-[12px]"> pts</span>
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <table style={{ width:'100%', borderCollapse:'collapse', fontFamily:'IBM Plex Mono,monospace' }}>
          <thead>
            <tr style={{ background:'rgba(255,255,255,0.02)', borderBottom:'1px solid rgba(255,255,255,0.07)' }}>
              {[
                t('scenario.col_pos'),
                t('scenario.col_driver'),
                t('scenario.col_points'),
                t('scenario.col_gap'),
                t('scenario.col_max'),
                t('scenario.col_chance'),
              ].map(h => (
                <th key={h} style={{ padding:'8px 12px', textAlign:'left', fontSize:9,
                  fontWeight:600, letterSpacing:'0.1em', color:'rgba(240,244,255,0.25)',
                  whiteSpace:'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {display.map((d, i) => {
              const sc       = scenarios[i]
              const isLeader = i === 0
              const gapColor = i===0?'var(--t3)': sc?.canCatch?'#FF8700':'#f87171'
              return (
                <tr key={d.code} style={{ borderBottom:'1px solid rgba(255,255,255,0.04)' }}>
                  <td style={{ padding:'10px 12px', fontSize:13, fontWeight:900,
                    color: i===0?'#FFD700':i===1?'#C0C0C0':i===2?'#CD7F32':'rgba(240,244,255,0.3)' }}>
                    {d.position}
                  </td>
                  <td style={{ padding:'10px 12px' }}>
                    <p style={{ fontSize:13, fontWeight:900, color:'white' }}>{d.code}</p>
                    <p style={{ fontSize:9, color:'rgba(240,244,255,0.3)', marginTop:1 }}>
                      {d.first_name} {d.last_name}
                    </p>
                  </td>
                  <td style={{ padding:'10px 12px', fontSize:14, fontWeight:900, color:'white' }}>
                    {d.points}
                  </td>
                  <td style={{ padding:'10px 12px', fontSize:13, fontWeight:700, color: gapColor }}>
                    {isLeader ? '—' : `-${sc?.gap}`}
                  </td>
                  <td style={{ padding:'10px 12px', fontSize:12, color:'rgba(240,244,255,0.5)' }}>
                    {sc?.maxPossible}
                    <span style={{ fontSize:9, color:'rgba(240,244,255,0.25)', marginLeft:4 }}>
                      (+{maxRemaining})
                    </span>
                  </td>
                  <td style={{ padding:'10px 12px' }}>
                    {isLeader ? (
                      <span style={{ fontSize:11, color:'#FFD700', fontWeight:700 }}>
                        {t('scenario.leading')}
                      </span>
                    ) : sc?.canCatch ? (
                      <span style={{ fontSize:11, color:'#FF8700', fontWeight:600 }}>
                        {sc.maxPossible - leader!.points >= 0
                          ? t('scenario.can_catch', { gap: sc.maxPossible - leader!.points })
                          : t('scenario.can_catch_lead')}
                      </span>
                    ) : (
                      <span style={{ fontSize:11, color:'rgba(240,244,255,0.25)' }}>
                        {t('scenario.impossible')}
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {driversData.length > 8 && (
        <div className="px-5 py-3 border-t" style={{ borderColor:'var(--b1)' }}>
          <button onClick={() => setShowAll(p => !p)}
            className="text-[12px] mono hover:text-white transition-colors"
            style={{ color:'var(--t3)' }}>
            {showAll ? t('scenario.show_less') : t('scenario.show_all', { n: driversData.length })}
          </button>
        </div>
      )}

      <div className="px-5 py-3 border-t" style={{ borderColor:'var(--b1)' }}>
        <p className="text-[10px] mono" style={{ color:'var(--t3)' }}>
          {t('scenario.footnote', { max: MAX_PER_RACE, p1: POINTS[0], fl: FASTEST_LAP, rest: POINTS.slice(1).join('/') })}
        </p>
      </div>
    </div>
  )
}
