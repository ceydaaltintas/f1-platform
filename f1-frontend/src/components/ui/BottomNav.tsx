import { Link, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { client } from '../../api/client'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'

export function BottomNav() {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const { data: currentYear = new Date().getFullYear() } = useQuery({
    queryKey: ['current-year'],
    queryFn: () => client.get('/seasons').then(r => {
      const cur = (r.data as any[]).find((s: any) => s.is_current)
      return cur?.year ?? new Date().getFullYear()
    }),
    staleTime: 3_600_000,
  })
  const ITEMS = [
    { to: '/',                              icon: '🏠', label: t('bottom_nav.home') },
    { to: `/season/${currentYear}`,         icon: '📅', label: String(currentYear) },
    { to: `/standings/${currentYear}`,      icon: '🏆', label: t('bottom_nav.standings') },
    { to: '/login',                         icon: '👤', label: t('bottom_nav.profile') },
  ]
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden"
      style={{ background:'rgba(5,8,15,0.97)', backdropFilter:'blur(16px)',
               borderTop:'1px solid rgba(255,255,255,0.07)' }}>
      <div className="flex">
        {ITEMS.map(item => {
          const active = item.to==='/' ? pathname==='/'
            : pathname.startsWith(item.to.split('/2026')[0])
          return (
            <Link key={item.to} to={item.to}
              className="flex-1 flex flex-col items-center gap-1 py-3 transition-colors">
              <span className="text-xl leading-none">{item.icon}</span>
              <span className={clsx('text-[10px] mono font-semibold',
                active ? 'text-[#E10600]' : 'text-white/25')}>
                {item.label}
              </span>
            </Link>
          )
        })}
      </div>
      <div style={{ height:'env(safe-area-inset-bottom,0px)' }} />
    </nav>
  )
}
