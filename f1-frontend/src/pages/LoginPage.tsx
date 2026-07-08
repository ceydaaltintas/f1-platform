import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { authApi } from '../api/client'

export function LoginPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<'login' | 'register'>('login')
  const [form, setForm] = useState({ username:'', email:'', password:'' })
  const [error, setError] = useState<string|null>(null)
  const [loading, setLoading] = useState(false)

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const handleSubmit = async () => {
    setError(null); setLoading(true)
    try {
      if (tab === 'login') {
        await authApi.login({ email: form.email, password: form.password })
      } else {
        await authApi.register({ username: form.username, email: form.email, password: form.password })
        await authApi.login({ email: form.email, password: form.password })
      }
      navigate('/')
    } catch (e: any) {
      const d = e.response?.data?.detail
      if (typeof d === 'string') {
        // Backend'den gelen anlamlı hata (örn. "Bu e-posta adresiyle kayıtlı bir hesap zaten var")
        setError(d)
      } else if (Array.isArray(d) && d.length > 0) {
        // Pydantic doğrulama hataları (örn. "Şifre en az 8 karakter olmalı")
        const msg = String(d[0]?.msg ?? '').replace(/^Value error,\s*/, '')
        setError(msg || 'Girdiğiniz bilgileri kontrol edin')
      } else {
        setError(tab === 'login' ? 'E-posta veya şifre hatalı' : 'Kayıt sırasında bir hata oluştu')
      }
    } finally { setLoading(false) }
  }

  const inputStyle = {
    background: 'var(--s2)',
    border: '1px solid var(--b1)',
    borderRadius: 12,
    color: 'var(--text)',
    fontSize: 13,
    padding: '12px 16px',
    width: '100%',
    fontFamily: 'Inter,sans-serif',
    transition: 'border-color 0.2s',
    outline: 'none',
  } as const

  return (
    <div className="min-h-screen flex items-center justify-center p-4"
      style={{ background:'var(--bg)' }}>

      <div className="w-full max-w-sm space-y-6">
        {/* Logo */}
        <div className="text-center">
          <Link to="/" className="inline-flex items-center gap-2.5 mb-2">
            <img src="/favicon.svg" alt="Hotlap" style={{ width: 32, height: 32 }} />
            <span style={{
              fontFamily: 'system-ui, -apple-system, sans-serif',
              fontSize: 22, fontWeight: 600, letterSpacing: '-0.3px', lineHeight: 1,
            }}>
              <span style={{ color: '#ffffff' }}>Hot</span>
              <span style={{ color: '#E10600' }}>lap</span>
            </span>
          </Link>
          <p className="text-[13px]" style={{ color:'var(--t2)' }}>
            {tab==='login' ? 'Hesabına giriş yap' : 'Yeni hesap oluştur'}
          </p>
        </div>

        {/* Card */}
        <div className="card p-6 space-y-4">
          {/* Tab */}
          <div className="flex p-1 rounded-xl" style={{ background:'var(--s2)' }}>
            {(['login','register'] as const).map(t => (
              <button key={t} onClick={() => { setTab(t); setError(null) }}
                className="flex-1 py-2.5 rounded-lg text-[13px] font-semibold transition-all"
                style={tab===t
                  ? { background:'#E10600', color:'white', boxShadow:'0 0 12px rgba(225,6,0,0.3)' }
                  : { background:'transparent', color:'var(--t2)' }}>
                {t==='login' ? 'Giriş Yap' : 'Kayıt Ol'}
              </button>
            ))}
          </div>

          {tab==='register' && (
            <div className="space-y-1.5">
              <label className="text-[11px] mono font-semibold" style={{ color:'var(--t3)' }}>
                KULLANICI ADI
              </label>
              <input value={form.username} onChange={set('username')}
                name="username" id="username"
                placeholder="kullanici_adi" autoComplete="username"
                style={inputStyle} onFocus={e => e.target.style.borderColor='rgba(225,6,0,0.5)'}
                onBlur={e => e.target.style.borderColor='var(--b1)'} />
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-[11px] mono font-semibold" style={{ color:'var(--t3)' }}>E-POSTA</label>
            <input value={form.email} onChange={set('email')}
              name="email" id="email"
              placeholder="ornek@mail.com" type="email" autoComplete="email"
              style={inputStyle} onFocus={e => e.target.style.borderColor='rgba(225,6,0,0.5)'}
              onBlur={e => e.target.style.borderColor='var(--b1)'} />
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] mono font-semibold" style={{ color:'var(--t3)' }}>ŞİFRE</label>
            <input value={form.password} onChange={set('password')}
              name="password" id="password"
              placeholder="••••••••" type="password"
              autoComplete={tab==='login' ? 'current-password' : 'new-password'}
              style={inputStyle} onFocus={e => e.target.style.borderColor='rgba(225,6,0,0.5)'}
              onBlur={e => e.target.style.borderColor='var(--b1)'}
              onKeyDown={e => e.key==='Enter' && handleSubmit()} />
          </div>

          {error && (
            <div className="p-3 rounded-xl text-[12px]"
              style={{ background:'rgba(225,6,0,0.08)', border:'1px solid rgba(225,6,0,0.2)', color:'#f87171' }}>
              ⚠ {error}
            </div>
          )}

          <button onClick={handleSubmit} disabled={loading}
            className="w-full py-3 rounded-xl text-[14px] font-bold transition-all
                       disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: loading ? 'rgba(225,6,0,0.5)' : '#E10600', color:'white',
                     boxShadow: loading ? 'none' : '0 0 20px rgba(225,6,0,0.35)' }}>
            {loading ? '⏳ Lütfen bekleyin...' : tab==='login' ? 'Giriş Yap →' : 'Hesap Oluştur →'}
          </button>

          <p className="text-center text-[11px]" style={{ color:'var(--t3)' }}>
            AI yorumları için giriş zorunlu değil
          </p>
        </div>

        <p className="text-center text-[12px]">
          <Link to="/" className="hover:text-white transition-colors" style={{ color:'var(--t3)' }}>
            ← Ana sayfaya dön
          </Link>
        </p>
      </div>
    </div>
  )
}
