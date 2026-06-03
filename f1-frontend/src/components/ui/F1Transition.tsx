/**
 * Sayfa geçiş animasyonu — F1 aracı soldan sağa geçer.
 * useLocation değişince otomatik tetiklenir.
 */

import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'

// ── F1 Araç SVG ─────────────────────────────────────────────────────────────
function F1Car({ color = '#E10600' }: { color?: string }) {
  return (
    <svg
      viewBox="0 0 320 80"
      width="320"
      height="80"
      style={{ display: 'block', overflow: 'visible' }}
    >
      {/* ── Egzoz izi (arkada, solda) ── */}
      <defs>
        <linearGradient id="exhaust" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={color} stopOpacity="0" />
          <stop offset="60%" stopColor={color} stopOpacity="0.12" />
          <stop offset="100%" stopColor={color} stopOpacity="0.35" />
        </linearGradient>
        <linearGradient id="speed1" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="white" stopOpacity="0" />
          <stop offset="100%" stopColor="white" stopOpacity="0.08" />
        </linearGradient>
        <filter id="glow-car">
          <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Egzoz / hız çizgileri */}
      <rect x="-180" y="34" width="200" height="3" rx="1.5" fill="url(#exhaust)" />
      <rect x="-160" y="30" width="160" height="1.5" rx="1" fill="url(#speed1)" />
      <rect x="-160" y="38" width="160" height="1.5" rx="1" fill="url(#speed1)" />
      <rect x="-140" y="26" width="120" height="1" rx="0.5" fill="url(#speed1)" opacity="0.5" />
      <rect x="-140" y="42" width="120" height="1" rx="0.5" fill="url(#speed1)" opacity="0.5" />

      {/* ── Arka kanat ── */}
      <rect x="14" y="14" width="4" height="18" rx="1" fill={color} opacity="0.9" />
      <rect x="8"  y="12" width="16" height="4"  rx="1" fill={color} filter="url(#glow-car)" />
      <rect x="8"  y="15" width="16" height="2"  rx="0.5" fill="white" opacity="0.15" />

      {/* ── Arka difüzör ── */}
      <path d="M18,52 L8,56 L32,56 L28,52 Z" fill={color} opacity="0.8" />

      {/* ── Gövde ana kısım ── */}
      <path
        d="M22,42 L30,26 L90,22 L140,20 L185,22 L210,30 L218,38 L216,46 L22,46 Z"
        fill={color}
        filter="url(#glow-car)"
      />
      {/* Gövde üst highlight */}
      <path
        d="M32,26 L90,22 L140,20 L180,22 L200,28 L205,32 L90,22"
        fill="white"
        opacity="0.08"
      />

      {/* ── Kokpit / kask bölgesi ── */}
      <path
        d="M88,22 L98,12 L148,11 L158,22"
        fill="#08080f"
        opacity="0.95"
      />
      {/* Kask + kafa koruma (halo) */}
      <ellipse cx="123" cy="15" rx="18" ry="7" fill="#1a1a2e" />
      <path d="M105,15 Q123,8 141,15" stroke={color} strokeWidth="2" fill="none" opacity="0.7" />
      {/* Vizör */}
      <path d="M113,13 Q123,9 133,13 L131,16 Q123,12 115,16 Z" fill="#00cfff" opacity="0.5" />

      {/* ── Ön kanat ── */}
      <path d="M200,42 L215,44 L222,38 L218,36 Z" fill={color} opacity="0.9" />
      <path d="M195,46 L225,48 L228,44 L218,46 Z" fill={color} opacity="0.8" />
      <rect x="193" y="40" width="32" height="2.5" rx="1" fill={color} opacity="0.7" />

      {/* ── Arka lastik ── */}
      <ellipse cx="52"  cy="50" rx="14" ry="13" fill="#111" />
      <ellipse cx="52"  cy="50" rx="10" ry="9"  fill="#222" />
      <ellipse cx="52"  cy="50" rx="5"  ry="4"  fill="#333" />
      {/* Lastik desen */}
      {[0,60,120,180,240,300].map((deg, i) => (
        <line key={i}
          x1={52 + 6 * Math.cos(deg * Math.PI / 180)}
          y1={50 + 5 * Math.sin(deg * Math.PI / 180)}
          x2={52 + 10 * Math.cos(deg * Math.PI / 180)}
          y2={50 + 9  * Math.sin(deg * Math.PI / 180)}
          stroke="#444" strokeWidth="1.5" />
      ))}

      {/* ── Ön lastik ── */}
      <ellipse cx="196" cy="50" rx="13" ry="12" fill="#111" />
      <ellipse cx="196" cy="50" rx="9"  ry="8"  fill="#222" />
      <ellipse cx="196" cy="50" rx="4.5" ry="4" fill="#333" />
      {[0,60,120,180,240,300].map((deg, i) => (
        <line key={i}
          x1={196 + 5.5 * Math.cos(deg * Math.PI / 180)}
          y1={50  + 5   * Math.sin(deg * Math.PI / 180)}
          x2={196 + 9   * Math.cos(deg * Math.PI / 180)}
          y2={50  + 8   * Math.sin(deg * Math.PI / 180)}
          stroke="#444" strokeWidth="1.5" />
      ))}

      {/* ── Süspansiyon kolları ── */}
      <line x1="52"  y1="44" x2="80"  y2="40" stroke="#555" strokeWidth="1.5" />
      <line x1="52"  y1="44" x2="80"  y2="46" stroke="#555" strokeWidth="1.5" />
      <line x1="196" y1="44" x2="170" y2="40" stroke="#555" strokeWidth="1.5" />
      <line x1="196" y1="44" x2="170" y2="46" stroke="#555" strokeWidth="1.5" />

      {/* ── Üst akış tüneli (airbox) ── */}
      <ellipse cx="120" cy="21" rx="12" ry="4" fill="#08080f" opacity="0.8" />

      {/* ── Sponsor şeridi ── */}
      <rect x="85" y="32" width="100" height="6" rx="1" fill="white" opacity="0.06" />
    </svg>
  )
}

// ── Geçiş bileşeni ────────────────────────────────────────────────────────────

export function F1Transition() {
  const location     = useLocation()
  const prevPath     = useRef(location.pathname)
  const [show, setShow] = useState(false)
  const timerRef     = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (location.pathname === prevPath.current) return
    prevPath.current = location.pathname

    // Önceki zamanlayıcıyı temizle
    if (timerRef.current) clearTimeout(timerRef.current)

    setShow(true)
    timerRef.current = setTimeout(() => setShow(false), 900)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [location.pathname])

  if (!show) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9998,
        pointerEvents: 'none',
        overflow: 'hidden',
      }}
    >
      {/* Hafif koyu overlay */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(5,8,15,0.45)',
        animation: 'f1-overlay 0.9s ease forwards',
      }} />

      {/* Şerit çizgisi */}
      <div style={{
        position: 'absolute',
        top: '50%',
        left: 0,
        right: 0,
        height: '2px',
        marginTop: '-1px',
        background: 'linear-gradient(90deg, transparent, rgba(225,6,0,0.4), transparent)',
        animation: 'f1-line 0.9s ease forwards',
      }} />

      {/* F1 Araç */}
      <div style={{
        position: 'absolute',
        top: '50%',
        transform: 'translateY(-50%)',
        animation: 'f1-car 0.9s cubic-bezier(0.4,0,0.2,1) forwards',
        filter: 'drop-shadow(0 0 12px rgba(225,6,0,0.6)) drop-shadow(0 2px 8px rgba(0,0,0,0.8))',
      }}>
        <F1Car />
      </div>

      <style>{`
        @keyframes f1-car {
          0%   { left: -340px;  opacity: 0; }
          8%   { opacity: 1; }
          85%  { opacity: 1; }
          100% { left: calc(100vw + 20px); opacity: 0; }
        }

        @keyframes f1-overlay {
          0%   { opacity: 0; }
          15%  { opacity: 1; }
          70%  { opacity: 1; }
          100% { opacity: 0; }
        }

        @keyframes f1-line {
          0%   { opacity: 0; transform: scaleX(0); transform-origin: left; }
          20%  { opacity: 1; transform: scaleX(1); transform-origin: left; }
          80%  { opacity: 1; }
          100% { opacity: 0; }
        }
      `}</style>
    </div>
  )
}
