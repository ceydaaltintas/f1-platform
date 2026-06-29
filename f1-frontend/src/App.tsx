import { useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom'
import { Navbar } from './components/ui/Navbar'
import { BottomNav } from './components/ui/BottomNav'
import { F1Transition } from './components/ui/F1Transition'
import { OnboardingOverlay } from './components/ui/OnboardingOverlay'
import { HomePage } from './pages/HomePage'
import { SeasonPage } from './pages/SeasonPage'
import { SessionPage } from './pages/SessionPage'
import { LivePage } from './pages/LivePage'
import { LoginPage } from './pages/LoginPage'
import { StandingsPage } from './pages/StandingsPage'
import { RulesPage } from './pages/RulesPage'
import { RecapPage } from './pages/RecapPage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 2, refetchOnWindowFocus: false, staleTime: 5 * 60 * 1000 },
  },
})

const NO_NAV = ['/login']

/** Her rota değişiminde sayfayı en üste taşır */
function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }, [pathname])
  return null
}

function Shell({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation()
  const noNav = NO_NAV.some(p => pathname.startsWith(p))
  return (
    <div style={{ fontFamily: "'IBM Plex Mono',monospace" }}>
      {!noNav && <Navbar />}
      <main className={noNav ? '' : 'pb-16 md:pb-0'} style={{ overflowX: 'clip' }}>
        {children}
      </main>
      {!noNav && <BottomNav />}
      <F1Transition />
      <OnboardingOverlay />
    </div>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ScrollToTop />
        <Shell>
          <Routes>
            <Route path="/"                    element={<HomePage />} />
            <Route path="/season/:year"         element={<SeasonPage />} />
            <Route path="/standings/:year"      element={<StandingsPage />} />
            <Route path="/standings"            element={<StandingsPage />} />
            <Route path="/session/:sessionId"   element={<SessionPage />} />
            <Route path="/live/:sessionId"      element={<LivePage />} />
            <Route path="/rules"                element={<RulesPage />} />
            <Route path="/recap/:year/:round"   element={<RecapPage />} />
            <Route path="/login"                element={<LoginPage />} />
            <Route path="*" element={
              <div className="min-h-screen flex flex-col items-center justify-center gap-5 px-6"
                style={{ background:'var(--bg)' }}>
                <p className="text-[80px] leading-none">🏁</p>
                <div className="text-center">
                  <p className="text-[64px] font-black mono" style={{ color:'#E10600' }}>404</p>
                  <p className="text-[18px] font-bold text-white mt-1">Sayfa bulunamadı</p>
                  <p className="text-[14px] mt-2" style={{ color:'var(--t2)' }}>
                    Aradığın sayfa yok veya taşındı.
                  </p>
                </div>
                <a href="/"
                  className="px-6 py-3 rounded-xl text-[14px] font-bold transition-all"
                  style={{ background:'#E10600', color:'white' }}>
                  Ana Sayfaya Dön
                </a>
              </div>
            }/>
          </Routes>
        </Shell>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
