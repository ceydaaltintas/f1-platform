import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { LiveInterval } from '../../store/wsStore'

interface Driver {
  driver_number: number
  code: string
  color: string
}

interface Props {
  intervals: LiveInterval[]
  drivers: Record<number, Driver>  // driver_number → {code, color}
  currentLap?: number
  totalLaps?: number
}

// Formatlar: "+1.234" ya da "+1 LAP"
function formatGap(gap: string | number | null, isLeader = false): string {
  if (isLeader) return 'LDR'
  if (gap === null || gap === undefined) return '—'
  if (typeof gap === 'string' && gap.includes('LAP')) return gap
  const n = Number(gap)
  if (isNaN(n)) return String(gap)
  return n === 0 ? '—' : `+${n.toFixed(3)}`
}

function formatInterval(iv: string | number | null): string {
  if (iv === null || iv === undefined) return '—'
  if (typeof iv === 'string' && iv.includes('LAP')) return iv
  const n = Number(iv)
  if (isNaN(n)) return '—'
  return `+${n.toFixed(3)}`
}

export function TimingTower({ intervals, drivers, currentLap, totalLaps }: Props) {
  const { t } = useTranslation()
  const [sorted, setSorted] = useState<LiveInterval[]>([])
  const [posChanges, setPosChanges] = useState<Record<number, 'up' | 'down' | null>>({})
  const prevOrder = useRef<number[]>([])

  useEffect(() => {
    if (!intervals.length) return

    // Araç sırasını gap_to_leader'a göre sırala
    const s = [...intervals].sort((a, b) => {
      const ga = typeof a.gap_to_leader === 'number' ? a.gap_to_leader : Infinity
      const gb = typeof b.gap_to_leader === 'number' ? b.gap_to_leader : Infinity
      return ga - gb
    })

    // Pozisyon değişimlerini tespit et
    const newOrder = s.map((iv) => iv.driver_number)
    const changes: Record<number, 'up' | 'down' | null> = {}

    newOrder.forEach((dn, newPos) => {
      const oldPos = prevOrder.current.indexOf(dn)
      if (oldPos === -1) return
      if (oldPos > newPos) changes[dn] = 'up'
      else if (oldPos < newPos) changes[dn] = 'down'
    })

    setSorted(s)
    setPosChanges(changes)
    prevOrder.current = newOrder

    // 3 saniye sonra animasyonu sıfırla
    const t = setTimeout(() => setPosChanges({}), 3000)
    return () => clearTimeout(t)
  }, [intervals])

  if (!sorted.length) {
    return (
      <div className="bg-[#0d0d0d] border border-[#1a1a1a] rounded-lg p-4">
        <p className="text-[10px] text-[#222] tracking-widest mb-3">{t('live.timing')}</p>
        <div className="space-y-1">
          {Array(5).fill(null).map((_, i) => (
            <div key={i} className="h-8 bg-[#111] rounded animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="bg-[#0d0d0d] border border-[#1a1a1a] rounded-lg p-4">
      {/* Başlık */}
      <div className="flex justify-between items-center mb-3">
        <p className="text-[10px] text-[#222] tracking-widest">{t('live.timing')}</p>
        {currentLap !== undefined && (
          <p className="text-[10px] text-[#444] font-mono">
            {t('live.lap', { current: currentLap, total: totalLaps ?? '?' })}
          </p>
        )}
      </div>

      {/* Sütun başlıkları */}
      <div className="grid grid-cols-[24px_36px_1fr_72px_72px] gap-1 mb-1 px-1">
        <span className="text-[9px] text-[#1e1e1e]">P</span>
        <span className="text-[9px] text-[#1e1e1e]"></span>
        <span className="text-[9px] text-[#1e1e1e]">{t('live.col_driver')}</span>
        <span className="text-[9px] text-[#1e1e1e] text-right">{t('live.col_gap')}</span>
        <span className="text-[9px] text-[#1e1e1e] text-right">{t('live.col_best')}</span>
      </div>

      {/* Sıralama satırları */}
      <div className="space-y-0.5">
        {sorted.map((iv, idx) => {
          const drv = drivers[iv.driver_number]
          const change = posChanges[iv.driver_number]
          const isLeader = idx === 0

          return (
            <div
              key={iv.driver_number}
              className="grid grid-cols-[24px_36px_1fr_72px_72px] gap-1 items-center rounded px-1 py-1.5 transition-colors duration-500"
              style={{
                background: change === 'up'
                  ? '#00D2BE0a'
                  : change === 'down'
                  ? '#E106000a'
                  : isLeader
                  ? '#1a1a1a'
                  : 'transparent',
              }}
            >
              {/* Pozisyon */}
              <span className="text-[11px] font-mono text-[#555]">
                {idx + 1}
              </span>

              {/* Değişim oku */}
              <span className="text-[10px]" style={{
                color: change === 'up' ? '#00D2BE' : change === 'down' ? '#E10600' : 'transparent'
              }}>
                {change === 'up' ? '▲' : change === 'down' ? '▼' : '·'}
              </span>

              {/* Pilot kodu + renk şeridi */}
              <div className="flex items-center gap-1.5">
                <div
                  className="w-0.5 h-4 rounded-full flex-shrink-0"
                  style={{ background: drv?.color ?? '#555' }}
                />
                <span className="text-[12px] font-semibold font-mono" style={{ color: drv?.color ?? '#888' }}>
                  {drv?.code ?? iv.driver_number}
                </span>
              </div>

              {/* Gap to leader */}
              <span className="text-[10px] font-mono text-right" style={{
                color: isLeader ? '#E10600' : '#888'
              }}>
                {formatGap(iv.gap_to_leader, isLeader)}
              </span>

              {/* Interval */}
              <span className="text-[10px] font-mono text-right text-[#444]">
                {formatInterval(iv.interval)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
