export function F1Loader({ text = 'Yükleniyor...' }: { text?: string }) {
  const c = '#E10600'

  return (
    <div className="flex flex-col items-center justify-center gap-5 py-2 select-none">

      {/* Pist + araç kabı */}
      <div style={{ position: 'relative', width: 240, height: 52 }}>

        {/* Pist zemini */}
        <div style={{
          position: 'absolute', bottom: 6, left: 0, right: 0,
          height: 6, borderRadius: 3,
          background: 'rgba(255,255,255,0.07)',
        }} />

        {/* Orta kesikli çizgi */}
        <div style={{
          position: 'absolute', bottom: 10, left: 8, right: 8, height: 1,
          background: 'repeating-linear-gradient(90deg, rgba(255,255,255,0.1) 0 8px, transparent 8px 16px)',
        }} />

        {/* Start/Finish çizgisi */}
        <div style={{
          position: 'absolute', bottom: 6, left: '50%',
          width: 3, height: 6, background: 'rgba(225,6,0,0.6)', borderRadius: 1,
        }} />

        {/* ── F1 Araç SVG — animasyon doğrudan bu elemana ── */}
        <svg
          viewBox="0 0 80 30"
          width="48"
          height="30"
          style={{
            position: 'absolute',
            bottom: 10,
            left: 0,
            filter: 'drop-shadow(0 0 5px rgba(225,6,0,0.8)) drop-shadow(0 1px 3px rgba(0,0,0,0.9))',
            animation: 'f1car-drive 1.8s ease-in-out infinite',
          }}
        >
          <defs>
            <linearGradient id="exh" x1="100%" y1="0%" x2="0%" y2="0%">
              <stop offset="0%"   stopColor={c} stopOpacity="0.5" />
              <stop offset="100%" stopColor={c} stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Egzoz izi */}
          <rect x="-22" y="13" width="24" height="2.5" rx="1" fill="url(#exh)" />
          <rect x="-18" y="11" width="18" height="1"   rx="0.5" fill="url(#exh)" opacity="0.4" />

          {/* Arka kanat */}
          <rect x="3"  y="5"  width="2.5" height="9"  rx="0.5" fill={c} />
          <rect x="1"  y="4"  width="7"   height="2.5" rx="0.5" fill={c} />

          {/* Gövde */}
          <path d="M7,15 L11,8 L30,6 L47,7 L55,11 L57,15 L57,18 L7,18 Z" fill={c} />
          <path d="M12,8 L30,6 L44,7 L52,10 L30,6" fill="white" opacity="0.1" />

          {/* Kokpit / halo */}
          <path d="M24,8 L27,3 L40,3 L42,8" fill="#06060f" opacity="0.95" />
          <path d="M26,6 Q33,1 40,6" stroke={c} strokeWidth="1" fill="none" opacity="0.8" />
          {/* Vizör */}
          <path d="M27,5 Q33,2 39,5 L38,6.5 Q33,3.5 28,6.5 Z" fill="#00cfff" opacity="0.55" />

          {/* Ön kanat */}
          <path d="M52,14 L59,16 L60,12 L57,11 Z" fill={c} opacity="0.9" />
          <rect x="51" y="15" width="10" height="1.5" rx="0.5" fill={c} />

          {/* Arka lastik */}
          <circle cx="15" cy="19" r="6"   fill="#0d0d0d" />
          <circle cx="15" cy="19" r="4.2" fill="#1a1a1a" />
          <circle cx="15" cy="19" r="1.8" fill="#2a2a2a" />

          {/* Ön lastik */}
          <circle cx="48" cy="19" r="5.5" fill="#0d0d0d" />
          <circle cx="48" cy="19" r="3.8" fill="#1a1a1a" />
          <circle cx="48" cy="19" r="1.6" fill="#2a2a2a" />

          {/* Süspansiyon */}
          <line x1="15" y1="15" x2="26" y2="12" stroke="#2a2a2a" strokeWidth="1" />
          <line x1="48" y1="15" x2="40" y2="12" stroke="#2a2a2a" strokeWidth="1" />
        </svg>
      </div>

      {/* Yazı */}
      <p className="text-[12px] mono font-medium" style={{ color: 'var(--t3)' }}>
        {text}
      </p>

      <style>{`
        @keyframes f1car-drive {
          0%   { transform: translateX(-55px)  scaleX(1);  opacity: 0;   }
          6%   { opacity: 1; }
          47%  { transform: translateX(245px)  scaleX(1);  opacity: 1;   }
          50%  { transform: translateX(245px)  scaleX(-1); opacity: 0.8; }
          53%  { opacity: 1; }
          95%  { transform: translateX(-55px)  scaleX(-1); opacity: 1;   }
          97%  { opacity: 0; }
          100% { transform: translateX(-55px)  scaleX(1);  opacity: 0;   }
        }
      `}</style>
    </div>
  )
}
