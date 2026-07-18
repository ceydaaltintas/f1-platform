import { useQuery } from '@tanstack/react-query'
import { client } from '../../api/client'
import { useUIStore } from '../../store/uiStore'
import { useTranslation } from 'react-i18next'

interface Props {
  year: number
  roundNumber: number
}

const MEDALS = ['🥇', '🥈', '🥉']

export function FantasyPicks({ year, roundNumber }: Props) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language?.startsWith('tr') ? 'tr' : 'en'
  const { insightMode } = useUIStore()

  const { data, isLoading } = useQuery({
    queryKey: ['fantasy', year, roundNumber, insightMode, lang],
    queryFn: () =>
      client.get(`/seasons/${year}/fantasy/picks`, {
        params: { round: roundNumber, mode: insightMode, language: lang }
      }).then(r => r.data),
    staleTime: 60 * 60 * 1000,
  })

  if (isLoading) return (
    <div className="card p-4">
      <p className="text-[10px] mono font-semibold tracking-widest mb-3" style={{ color: 'var(--t3)' }}>{t('fantasy.label')}</p>
      {[1,2,3].map(i => <div key={i} className="h-10 rounded mb-2 animate-pulse" style={{ background: 'var(--s2)' }}/>)}
    </div>
  )
  if (!data) return null

  return (
    <div className="card p-4">
      <p className="text-[10px] mono font-semibold tracking-widest mb-4" style={{ color: 'var(--t3)' }}>
        {t('fantasy.this_weekend')}
      </p>

      {/* Top picks */}
      <div className="space-y-2 mb-4">
        {data.picks.slice(0, 5).map((p: any, i: number) => (
          <div key={p.code}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
            style={{
              border: `1px solid ${i === 0 ? 'rgba(225,6,0,0.30)' : 'var(--b1)'}`,
              background: i === 0 ? 'rgba(225,6,0,0.05)' : 'transparent',
            }}
          >
            <span className="text-base w-6">{MEDALS[i] || `${i + 1}`}</span>
            <span className="text-[13px] font-semibold mono w-10" style={{ color: 'var(--text)' }}>{p.code}</span>
            <div className="flex-1">
              <div className="h-1.5 rounded-full" style={{ background: 'var(--s2)' }}>
                <div
                  className="h-1.5 rounded-full"
                  style={{ width: `${(p.form_score / (data.picks[0]?.form_score || 1)) * 100}%`, background: '#E10600' }}
                />
              </div>
            </div>
            <div className="text-right">
              <p className="text-[11px] mono" style={{ color: 'var(--t2)' }}>{p.avg_points} {t('fantasy.pts_per_race')}</p>
              <p className="text-[9px] mono" style={{ color: 'var(--t3)' }}>P{p.avg_position.toFixed(1)} {t('fantasy.avg_abbr')}</p>
            </div>
          </div>
        ))}
      </div>

      {/* AI özeti */}
      {data.ai_summary && (
        <p className="text-[11px] leading-relaxed pl-3 border-l-2" style={{ color: 'var(--t2)', borderColor: 'var(--b1)' }}>
          {data.ai_summary.replace(/\*\*/g, '')}
        </p>
      )}
    </div>
  )
}
