import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { client } from '../../api/client'
import clsx from 'clsx'

export function Navbar() {
  const { pathname } = useLocation()
  const [isLive, setIsLive] = useState(false)
  const [liveSessionId, setLiveSessionId] = useState<number | null>(null)
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const { data: currentYear = new Date().getFullYear() } = useQuery({
    queryKey: ['current-year'],
    queryFn: () => client.get('/seasons').then(r => {
      const cur = (r.data as any[]).find((s: any) => s.is_current)
      return cur?.year ?? new Date().getFullYear()
    }),
    staleTime: 3_600_000,
  })

  useEffect(() => {
    setIsLoggedIn(!!localStorage.getItem('access_token'))
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', onScroll)
    const checkLive = async () => {
      try {
        const r = await client.get('/live/status')
        setIsLive(r.data.live)
        setLiveSessionId(r.data.session_id ?? null)
      } catch {}
    }
    checkLive()
    const id = setInterval(checkLive, 30_000)
    return () => { window.removeEventListener('scroll', onScroll); clearInterval(id) }
  }, [])

  // Menü dışına tıklayınca kapat
  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  // Rota değişince menüyü kapat
  useEffect(() => { setMenuOpen(false) }, [pathname])

  const isActive = (to: string) =>
    to === '/' ? pathname === '/' : pathname.startsWith(to)

  const navLinks = [
    { to: `/season/${currentYear}`, label: `${currentYear} Sezonu` },
    { to: `/standings/${currentYear}`, label: 'Şampiyona' },
    { to: '/rules', label: 'Kurallar' },
    { to: '/live/demo', label: '🎭 Demo' },
  ]

  return (
    <nav
      className={clsx(
        'sticky top-0 z-50 flex items-center justify-between px-4 md:px-6 h-14 transition-all duration-300',
        scrolled
          ? 'bg-[#05080f]/95 backdrop-blur-xl border-b border-white/5 shadow-xl shadow-black/40'
          : 'bg-[#05080f]/80 backdrop-blur-md border-b border-white/[0.04]'
      )}
    >
      {/* ── Logo ── */}
      <Link to="/" className="flex items-center gap-2.5 shrink-0">
        <img src="/favicon.svg" alt="Hotlap logo" style={{ width: 28, height: 28 }} />
        <span style={{
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: 18, fontWeight: 600, letterSpacing: '-0.3px', lineHeight: 1,
        }}>
          <span style={{ color: '#ffffff' }}>Hot</span>
          <span style={{ color: '#E10600' }}>lap</span>
        </span>
      </Link>

      {/* ── Desktop Nav ── */}
      <div className="hidden md:flex items-center gap-1">
        {navLinks.map(({ to, label }) => (
          <Link
            key={to}
            to={to}
            className={clsx(
              'px-3 py-1.5 rounded-lg text-[13px] font-medium transition-all',
              isActive(to) ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/80 hover:bg-white/5'
            )}
          >
            {label}
          </Link>
        ))}
      </div>

      {/* ── Desktop Right ── */}
      <div className="hidden md:flex items-center gap-2">
        {isLive && liveSessionId && (
          <Link
            to={`/live/${liveSessionId}`}
            className="flex items-center gap-2 px-3 py-1.5 rounded-full text-[12px] font-semibold
                       bg-[#E10600]/15 border border-[#E10600]/40 text-[#E10600]
                       hover:bg-[#E10600]/25 transition-all mono"
            style={{ animation: 'glow-pulse 2s ease-in-out infinite' }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#E10600]"
              style={{ animation: 'pulse-dot 1s infinite' }} />
            CANLI
          </Link>
        )}
        {isLoggedIn ? (
          <button
            onClick={() => {
              localStorage.removeItem('access_token')
              localStorage.removeItem('refresh_token')
              setIsLoggedIn(false)
            }}
            className="px-3 py-1.5 rounded-lg text-[12px] text-white/40 hover:text-white/70 hover:bg-white/5 transition-all"
          >
            Çıkış
          </button>
        ) : (
          <Link
            to="/login"
            className="px-3 py-1.5 rounded-lg text-[12px] font-medium
                       bg-white/[0.06] border border-white/10 text-white/70
                       hover:bg-white/10 hover:text-white transition-all"
          >
            Giriş Yap
          </Link>
        )}
      </div>

      {/* ── Mobile Right: CANLI + Hamburger ── */}
      <div className="flex md:hidden items-center gap-2" ref={menuRef}>
        {isLive && liveSessionId && (
          <Link
            to={`/live/${liveSessionId}`}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold
                       bg-[#E10600]/15 border border-[#E10600]/40 text-[#E10600] mono"
            style={{ animation: 'glow-pulse 2s ease-in-out infinite' }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#E10600]"
              style={{ animation: 'pulse-dot 1s infinite' }} />
            CANLI
          </Link>
        )}

        <button
          onClick={() => setMenuOpen(v => !v)}
          className="flex flex-col justify-center items-center w-9 h-9 rounded-lg hover:bg-white/5 transition-all gap-[5px]"
          aria-label="Menü"
        >
          <span className={clsx('block w-5 h-[1.5px] bg-white/60 transition-all duration-200',
            menuOpen && 'rotate-45 translate-y-[6.5px]')} />
          <span className={clsx('block w-5 h-[1.5px] bg-white/60 transition-all duration-200',
            menuOpen && 'opacity-0')} />
          <span className={clsx('block w-5 h-[1.5px] bg-white/60 transition-all duration-200',
            menuOpen && '-rotate-45 -translate-y-[6.5px]')} />
        </button>

        {/* Dropdown */}
        {menuOpen && (
          <div className="absolute top-14 right-0 left-0 z-50 border-b border-white/5"
            style={{ background: 'rgba(5,8,15,0.98)', backdropFilter: 'blur(20px)' }}>
            <div className="flex flex-col py-2">
              {navLinks.map(({ to, label }) => (
                <Link
                  key={to}
                  to={to}
                  className={clsx(
                    'px-5 py-3.5 text-[15px] font-medium transition-colors',
                    isActive(to) ? 'text-white bg-white/5' : 'text-white/50 hover:text-white hover:bg-white/5'
                  )}
                >
                  {label}
                </Link>
              ))}
              <div className="mx-5 my-2 h-px bg-white/5" />
              {isLoggedIn ? (
                <button
                  onClick={() => {
                    localStorage.removeItem('access_token')
                    localStorage.removeItem('refresh_token')
                    setIsLoggedIn(false)
                    setMenuOpen(false)
                  }}
                  className="px-5 py-3.5 text-left text-[15px] text-white/40 hover:text-white/70 transition-colors"
                >
                  Çıkış
                </button>
              ) : (
                <Link
                  to="/login"
                  className="px-5 py-3.5 text-[15px] font-medium text-white/50 hover:text-white transition-colors"
                >
                  Giriş Yap
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </nav>
  )
}
