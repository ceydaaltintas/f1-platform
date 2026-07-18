/** Uygulama genelinde tutarlı hata gösterimi */
import { useTranslation } from 'react-i18next'

interface Props {
  title?: string
  message?: string
  hint?: string
  onRetry?: () => void
  compact?: boolean
}

export function ErrorCard({
  title,
  message,
  hint,
  onRetry,
  compact = false,
}: Props) {
  const { t } = useTranslation()
  const resolvedTitle   = title   ?? t('common.error')
  const resolvedMessage = message ?? t('common.load_failed')

  if (compact) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl"
        style={{ background:'rgba(225,6,0,0.06)', border:'1px solid rgba(225,6,0,0.18)' }}>
        <span className="text-xl shrink-0">⚠️</span>
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-semibold text-white leading-snug">{resolvedTitle}</p>
          <p className="text-[11px] mt-0.5" style={{ color:'var(--t2)' }}>{resolvedMessage}</p>
        </div>
        {onRetry && (
          <button onClick={onRetry}
            className="shrink-0 text-[11px] mono px-3 py-1.5 rounded-lg transition-all"
            style={{ background:'rgba(225,6,0,0.1)', color:'#E10600',
                     border:'1px solid rgba(225,6,0,0.25)' }}>
            {t('common.retry')}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="card p-8 text-center space-y-3">
      <p className="text-4xl">🏎💨</p>
      <p className="text-[16px] font-bold text-white">{resolvedTitle}</p>
      <p className="text-[13px]" style={{ color:'var(--t2)' }}>{resolvedMessage}</p>
      {hint && (
        <p className="text-[11px] mono" style={{ color:'var(--t3)' }}>{hint}</p>
      )}
      {onRetry && (
        <button onClick={onRetry}
          className="mt-2 px-5 py-2.5 rounded-xl text-[13px] font-semibold transition-all"
          style={{ background:'#E10600', color:'white' }}>
          {t('common.retry')}
        </button>
      )}
    </div>
  )
}
