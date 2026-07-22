import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { client } from '../../api/client'
import { formatSectorTime } from '../../utils/format'

interface Props {
  sessionId: number
  driverA: string
  driverB: string
  colorA?: string
  colorB?: string
  mode?: string
}

function SectorBar({ label, timeA, timeB, driverA, driverB, colorA, colorB, delta, t }: any) {
  const total = (timeA ?? 0) + (timeB ?? 0) || 1
  const fasterA = delta !== null && delta <= 0

  return (
    <div className="mb-4">
      <div className="flex justify-between mb-1.5">
        <span className="text-[12px] mono" style={{ color: 'var(--t2)' }}>{t('sector.sector_n', { n: label })}</span>
        {delta !== null && (
          <span className="text-[12px] mono font-bold" style={{ color: fasterA ? colorA : colorB }}>
            {t('sector.faster_driver', { driver: fasterA ? driverA : driverB, delta: Math.abs(delta).toFixed(3) })}
          </span>
        )}
      </div>
      <div className="flex h-3 rounded-full overflow-hidden gap-0.5">
        <div style={{ width: `${((timeA ?? 0) / total) * 100}%`, background: colorA, borderRadius: '4px 0 0 4px' }} />
        <div style={{ flex: 1, background: colorB, borderRadius: '0 4px 4px 0' }} />
      </div>
      <div className="flex justify-between mt-0.5">
        <span className="text-[11px] mono font-bold" style={{ color: colorA }}>{driverA}: {timeA?.toFixed(3)}</span>
        <span className="text-[11px] mono font-bold" style={{ color: colorB }}>{driverB}: {timeB?.toFixed(3)}</span>
      </div>
    </div>
  )
}

export function SectorAnalysis({
  sessionId, driverA, driverB,
  colorA = '#E10600', colorB = '#FF8700',
  mode = 'beginner',
}: Props) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language?.startsWith('tr') ? 'tr' : 'en'

  const { data, isLoading, isError } = useQuery({
    queryKey: ['sectors', sessionId, driverA, driverB, mode, lang],
    queryFn: () =>
      client.get(`/sessions/${sessionId}/sector-analysis`, {
        params: { drivers: `${driverA},${driverB}`, lap: 'fastest', mode, language: lang }
      }).then(r => r.data),
    enabled: !!(sessionId && driverA && driverB),
    staleTime: 5 * 60 * 1000,
  })

  if (isLoading) return (
    <div className="card p-4">
      <p className="text-[11px] mono font-semibold tracking-widest mb-3" style={{ color: 'var(--t3)' }}>{t('sector.title')}</p>
      {[1,2,3].map(i => <div key={i} className="h-10 rounded mb-3 animate-pulse" style={{ background: 'var(--s2)' }}/>)}
    </div>
  )

  if (isError || !data) return null

  return (
    <div className="card p-4">
      <div className="flex justify-between items-center mb-4">
        <p className="text-[11px] mono font-semibold tracking-widest" style={{ color: 'var(--t3)' }}>{t('sector.title')}</p>
        <span className="text-[12px] mono font-semibold" style={{ color: data.faster_overall === driverA ? colorA : colorB }}>
          {t('sector.overall_faster', { driver: data.faster_overall })}
          {' '}({data.total_gap > 0 ? '+' : ''}{formatSectorTime(Math.abs(data.total_gap))}s)
        </span>
      </div>

      {data.sectors.map((s: any) => (
        <SectorBar
          key={s.sector}
          label={s.sector}
          timeA={s[`time_${driverA}`]}
          timeB={s[`time_${driverB}`]}
          driverA={driverA}
          driverB={driverB}
          colorA={colorA}
          colorB={colorB}
          delta={s.delta}
          t={t}
        />
      ))}

      {data.ai_summary && (
        <p className="text-[12px] leading-relaxed pl-3 border-l-2 mt-2"
          style={{ color: 'var(--t2)', borderColor: 'var(--b1)' }}>
          {data.ai_summary.replace(/\*\*/g, '')}
        </p>
      )}
    </div>
  )
}
