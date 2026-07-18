import { useTranslation } from 'react-i18next'

export function LanguageToggle() {
  const { i18n } = useTranslation()
  const current = i18n.language?.startsWith('tr') ? 'tr' : 'en'

  const toggle = () => {
    i18n.changeLanguage(current === 'tr' ? 'en' : 'tr')
  }

  return (
    <button
      onClick={toggle}
      className="mono text-[11px] font-semibold transition-all"
      style={{
        padding: '4px 10px',
        borderRadius: 6,
        border: '0.5px solid rgba(255,255,255,0.12)',
        background: 'transparent',
        color: 'rgba(255,255,255,0.4)',
        cursor: 'pointer',
        letterSpacing: '0.05em',
      }}
      onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.8)')}
      onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.4)')}
    >
      {current === 'tr' ? 'EN' : 'TR'}
    </button>
  )
}
