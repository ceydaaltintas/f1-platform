import { useState } from 'react'
import { Helmet } from 'react-helmet-async'

type Tab = 'general' | 'regulations'

function posColor(i: number) {
  if (i === 0) return '#FFD700'
  if (i === 1) return '#C0C0C0'
  if (i === 2) return '#CD7F32'
  return 'var(--t3)'
}

const TYRE_COMPOUNDS = [
  { name: 'SOFT', color: '#E10600', letter: 'S', desc: 'Maksimum kavrama, düşük dayanıklılık. Sıralama ve kısa stintler için ideal.' },
  { name: 'MEDIUM', color: '#FFD700', letter: 'M', desc: 'Denge. Yarışın ana lastik stratejisinin temelini oluşturur.' },
  { name: 'HARD', color: '#C0C0C0', letter: 'H', desc: 'Düşük kavrama, yüksek dayanıklılık. Uzun stintler ve yakıt tasarrufu.' },
  { name: 'INTERMEDIATE', color: '#43B02A', letter: 'I', desc: 'Hafif ıslak pist. Yüzeyinde su oluk kanalları bulunur.' },
  { name: 'WET', color: '#0072C6', letter: 'W', desc: 'Ağır yağmur. Maksimum su tahliyesi için derin oluklar.' },
]

const FLAGS = [
  { name: 'Yeşil Bayrak', color: '#00D2BE', icon: '🟢', desc: 'Pist temiz, yarış/oturum devam ediyor.' },
  { name: 'Sarı Bayrak', color: '#FFD700', icon: '🟡', desc: 'Tehlike! Yavaşla, sollama yasak. Çift sarı: Dur durabilecek hızda ol.' },
  { name: 'Kırmızı Bayrak', color: '#E10600', icon: '🔴', desc: 'Oturum durduruldu. Tüm araçlar pit\'e döner.' },
  { name: 'Mavi Bayrak', color: '#0072C6', icon: '🔵', desc: 'Tur gerisindeki araç, önündeki aracı geçirmeli.' },
  { name: 'Siyah Bayrak', color: '#333', icon: '🏴', desc: 'Diskalifiye. Pilot pit\'e dönmek zorunda.' },
  { name: 'Siyah-Beyaz Bayrak', color: '#888', icon: '🏁', desc: 'Sportmenlik dışı davranış uyarısı.' },
  { name: 'Damalı Bayrak', color: '#fff', icon: '🏁', desc: 'Yarış/oturum sona erdi.' },
]

const POINTS_RACE = [
  { pos: 1, pts: 25 }, { pos: 2, pts: 18 }, { pos: 3, pts: 15 },
  { pos: 4, pts: 12 }, { pos: 5, pts: 10 }, { pos: 6, pts: 8 },
  { pos: 7, pts: 6 }, { pos: 8, pts: 4 }, { pos: 9, pts: 2 }, { pos: 10, pts: 1 },
]

const POINTS_SPRINT = [
  { pos: 1, pts: 8 }, { pos: 2, pts: 7 }, { pos: 3, pts: 6 },
  { pos: 4, pts: 5 }, { pos: 5, pts: 4 }, { pos: 6, pts: 3 },
  { pos: 7, pts: 2 }, { pos: 8, pts: 1 },
]

const WEEKEND_FORMAT = [
  { day: 'CUMA', sessions: [
    { name: 'Antrenman 1', duration: '60 dk', desc: 'Araç ayarları, lastik testi, veri toplama' },
    { name: 'Antrenman 2', duration: '60 dk', desc: 'Yarış simülasyonu, uzun stint denemeleri' },
  ]},
  { day: 'CUMARTESİ', sessions: [
    { name: 'Antrenman 3', duration: '60 dk', desc: 'Son ayarlar, sıralama hazırlığı' },
    { name: 'Sıralama', duration: 'Q1(18)+Q2(15)+Q3(12)', desc: 'Grid sırası belirlenir' },
  ]},
  { day: 'PAZAR', sessions: [
    { name: 'Yarış', duration: '~2 saat / 305 km', desc: 'Şampiyona puanları dağıtılır' },
  ]},
]

const REGS_2026 = [
  {
    title: 'Yeni Güç Ünitesi',
    icon: '⚡',
    color: '#E10600',
    points: [
      'Elektrik gücü 3 katına çıkıyor: MGU-K 350 kW (önceki: 120 kW)',
      'MGU-H kaldırıldı — motor yapısı basitleşiyor',
      'Yakıt %100 sürdürülebilir kaynaklardan üretilecek',
      'Motor sesi daha yüksek olacak',
    ],
  },
  {
    title: 'Aktif Aerodinamik',
    icon: '🔄',
    color: '#00D2BE',
    points: [
      'Ön ve arka kanat pozisyonları otomatik ayarlanabilir',
      'Düz yolda düşük sürükleme (Z-modu) — virajda yüksek yere basma',
      'DRS kaldırıldı — yerini manual override (overtake modu) aldı',
      'Araçlar arası takip mesafesi azalacak',
    ],
  },
  {
    title: 'Zemin Etkisi Değişiklikleri',
    icon: '⬇️',
    color: '#FFD700',
    points: [
      'Zemin etkisi azaltılıyor — araçlar daha hafif',
      'Minimum ağırlık 768 kg\'dan 722 kg\'a düşürülüyor',
      'Aracın toplam boyutu küçülüyor (200 mm daha kısa)',
      'Ön kanat basitleştiriliyor',
    ],
  },
  {
    title: 'Maliyet Sınırı & Sportif',
    icon: '💰',
    color: '#a855f7',
    points: [
      'Bütçe tavanı 135 milyon $ olarak devam ediyor',
      '3 zorunlu güç ünitesi (sezon başına)',
      'Yeni takımlar için daha adil rekabet ortamı',
      'Sprint yarış formatı genişletiliyor',
    ],
  },
]

function AnimatedBar({ value, max, color, delay = 0 }: { value: number; max: number; color: string; delay?: number }) {
  return (
    <div className="h-6 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
      <div className="h-6 rounded-full flex items-center justify-end pr-2"
        style={{
          width: `${(value / max) * 100}%`,
          background: `linear-gradient(90deg, ${color}40, ${color})`,
          animation: `slideIn 0.8s ease-out ${delay}s both`,
        }}>
        <span className="text-[11px] font-black mono text-white">{value}</span>
      </div>
    </div>
  )
}

function TyreAnimation() {
  return (
    <div className="flex flex-wrap gap-4 justify-center py-4">
      {TYRE_COMPOUNDS.map((t, i) => (
        <div key={t.name} className="flex flex-col items-center gap-2 w-[140px]"
          style={{ animation: `fadeUp 0.5s ease-out ${i * 0.1}s both` }}>
          <div className="relative">
            <svg width="72" height="72" viewBox="0 0 72 72">
              <circle cx="36" cy="36" r="32" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="8" />
              <circle cx="36" cy="36" r="32" fill="none" stroke={t.color} strokeWidth="8"
                strokeDasharray={`${201 * ((5 - i) / 5)} 201`}
                style={{ animation: `tyreRotate 2s linear ${i * 0.2}s both` }}
                transform="rotate(-90 36 36)" />
              <circle cx="36" cy="36" r="20" fill={t.color + '15'} stroke={t.color + '40'} strokeWidth="1" />
              <text x="36" y="40" textAnchor="middle" fontSize="16" fontWeight="900"
                fontFamily="IBM Plex Mono" fill={t.color}>{t.letter}</text>
            </svg>
          </div>
          <p className="text-[12px] font-bold" style={{ color: t.color }}>{t.name}</p>
          <p className="text-[10px] text-center leading-tight" style={{ color: 'var(--t3)' }}>{t.desc}</p>
        </div>
      ))}
    </div>
  )
}

export function RulesPage() {
  const [tab, setTab] = useState<Tab>('general')

  return (
    <>
      <Helmet>
        <title>F1 Kuralları & 2026 Regülasyonları — Hotlap</title>
        <meta name="description" content="Formula 1 kuralları: puan sistemi, bayraklar, lastik bileşikleri, yarış haftası formatı ve 2026 yeni regülasyonları. Aktif aerodinamik, yeni motor ve daha fazlası." />
      </Helmet>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div>
          <p className="text-[10px] mono font-semibold tracking-[0.3em] mb-2" style={{ color: '#E10600' }}>
            FORMULA 1
          </p>
          <h1 className="text-[32px] font-black text-white leading-tight">
            Kurallar & Regülasyonlar
          </h1>
          <p className="text-[14px] mt-1" style={{ color: 'var(--t2)' }}>
            F1'in temel kuralları ve 2026 sezonu değişiklikleri
          </p>
        </div>

        {/* Tab seçici */}
        <div className="flex p-1 rounded-xl" style={{ background: 'var(--s1)' }}>
          {([
            ['general', '📋 Genel Kurallar'],
            ['regulations', '🔧 2026 Regülasyonları'],
          ] as const).map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)}
              className="flex-1 py-2.5 rounded-lg text-[13px] font-semibold transition-all"
              style={tab === t
                ? { background: '#E10600', color: 'white' }
                : { color: 'var(--t3)' }}>
              {label}
            </button>
          ))}
        </div>

        {/* ── Genel Kurallar ──────────────────────────────────── */}
        {tab === 'general' && (
          <div className="space-y-8">

            {/* Puan Sistemi */}
            <section className="card overflow-hidden">
              <div className="px-5 py-3 border-b" style={{ borderColor: 'var(--b1)' }}>
                <h2 className="text-[15px] font-bold text-white">🏆 Puan Sistemi</h2>
              </div>
              <div className="p-5 grid md:grid-cols-2 gap-6">
                <div>
                  <p className="text-[11px] mono font-semibold mb-3" style={{ color: 'var(--t3)' }}>YARIŞ PUANLARI</p>
                  <div className="space-y-1.5">
                    {POINTS_RACE.map((p, i) => (
                      <div key={p.pos} className="flex items-center gap-3">
                        <span className="text-[11px] mono w-5 text-right font-bold" style={{ color: posColor(i) }}>
                          P{p.pos}
                        </span>
                        <div className="flex-1">
                          <AnimatedBar value={p.pts} max={25} color={i < 3 ? '#E10600' : '#888'} delay={i * 0.05} />
                        </div>
                      </div>
                    ))}
                    <p className="text-[10px] mt-2" style={{ color: 'var(--t3)' }}>
                      2026'dan itibaren en hızlı tur bonusu kaldırılmıştır
                    </p>
                  </div>
                </div>
                <div>
                  <p className="text-[11px] mono font-semibold mb-3" style={{ color: 'var(--t3)' }}>SPRİNT PUANLARI</p>
                  <div className="space-y-1.5">
                    {POINTS_SPRINT.map((p, i) => (
                      <div key={p.pos} className="flex items-center gap-3">
                        <span className="text-[11px] mono w-5 text-right font-bold" style={{ color: posColor(i) }}>
                          P{p.pos}
                        </span>
                        <div className="flex-1">
                          <AnimatedBar value={p.pts} max={8} color={i < 3 ? '#FF8700' : '#888'} delay={i * 0.05} />
                        </div>
                      </div>
                    ))}
                    <p className="text-[10px] mt-2" style={{ color: 'var(--t3)' }}>
                      Sprint yarışları seçili hafta sonlarında yapılır (~100 km)
                    </p>
                  </div>
                </div>
              </div>
            </section>

            {/* Lastik Bileşikleri */}
            <section className="card overflow-hidden">
              <div className="px-5 py-3 border-b" style={{ borderColor: 'var(--b1)' }}>
                <h2 className="text-[15px] font-bold text-white">🔴 Lastik Bileşikleri</h2>
              </div>
              <div className="p-5">
                <TyreAnimation />
                <div className="mt-4 rounded-lg px-4 py-3" style={{ background: 'rgba(255,255,255,0.03)' }}>
                  <p className="text-[11px] leading-relaxed" style={{ color: 'var(--t2)' }}>
                    Pirelli her yarış için 3 kuru lastik seti belirler (C1-C5 aralığından). Yumuşak lastik daha hızlı ama
                    daha çabuk aşınır. Yarışta en az <span className="text-white font-bold">2 farklı bileşik</span> kullanmak zorunludur.
                    Yağmurda intermediate veya wet lastik kullanılır — bu durumda bileşik kuralı geçersizdir.
                  </p>
                </div>
              </div>
            </section>

            {/* Bayraklar */}
            <section className="card overflow-hidden">
              <div className="px-5 py-3 border-b" style={{ borderColor: 'var(--b1)' }}>
                <h2 className="text-[15px] font-bold text-white">🚩 Bayrak Kuralları</h2>
              </div>
              <div className="p-5 grid sm:grid-cols-2 gap-3">
                {FLAGS.map((f, i) => (
                  <div key={f.name} className="flex items-start gap-3 rounded-lg px-3 py-2.5"
                    style={{ background: 'rgba(255,255,255,0.03)' }}>
                    <span className="text-xl shrink-0">{f.icon}</span>
                    <div>
                      <p className="text-[12px] font-bold" style={{ color: f.color }}>{f.name}</p>
                      <p className="text-[11px] mt-0.5" style={{ color: 'var(--t3)' }}>{f.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Yarış Haftası */}
            <section className="card overflow-hidden">
              <div className="px-5 py-3 border-b" style={{ borderColor: 'var(--b1)' }}>
                <h2 className="text-[15px] font-bold text-white">📅 Yarış Haftası Formatı</h2>
              </div>
              <div className="p-5">
                <div className="grid md:grid-cols-3 gap-4">
                  {WEEKEND_FORMAT.map((day, di) => (
                    <div key={day.day} className="rounded-xl border overflow-hidden"
                      style={{ borderColor: 'var(--b1)' }}>
                      <div className="px-4 py-2 text-center" style={{ background: di === 2 ? 'rgba(225,6,0,0.1)' : 'rgba(255,255,255,0.03)' }}>
                        <p className="text-[11px] mono font-black tracking-widest"
                          style={{ color: di === 2 ? '#E10600' : 'var(--t3)' }}>
                          {day.day}
                        </p>
                      </div>
                      <div className="p-3 space-y-2">
                        {day.sessions.map(s => (
                          <div key={s.name} className="rounded-lg px-3 py-2" style={{ background: 'rgba(255,255,255,0.03)' }}>
                            <div className="flex justify-between items-center">
                              <p className="text-[12px] font-bold text-white">{s.name}</p>
                              <p className="text-[9px] mono" style={{ color: 'var(--t3)' }}>{s.duration}</p>
                            </div>
                            <p className="text-[10px] mt-1" style={{ color: 'var(--t3)' }}>{s.desc}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* Sıralama Formatı */}
            <section className="card overflow-hidden">
              <div className="px-5 py-3 border-b" style={{ borderColor: 'var(--b1)' }}>
                <h2 className="text-[15px] font-bold text-white">⏱ Sıralama Turları</h2>
              </div>
              <div className="p-5">
                <div className="flex flex-col sm:flex-row gap-3">
                  {[
                    { seg: 'Q1', time: '18 dakika', drivers: '22 → 16', elim: '6 pilot elenir', color: '#E10600' },
                    { seg: 'Q2', time: '15 dakika', drivers: '16 → 10', elim: '6 pilot elenir', color: '#FF8700' },
                    { seg: 'Q3', time: '12 dakika', drivers: '10 pilot', elim: 'Pole pozisyonu belirlenir', color: '#a855f7' },
                  ].map((q, i) => (
                    <div key={q.seg} className="flex-1 rounded-xl border overflow-hidden"
                      style={{ borderColor: q.color + '40' }}>
                      <div className="px-4 py-2 text-center" style={{ background: q.color + '15' }}>
                        <p className="text-[20px] font-black mono" style={{ color: q.color }}>{q.seg}</p>
                      </div>
                      <div className="p-3 space-y-1 text-center">
                        <p className="text-[13px] font-bold text-white">{q.time}</p>
                        <p className="text-[11px]" style={{ color: 'var(--t2)' }}>{q.drivers}</p>
                        <p className="text-[10px]" style={{ color: 'var(--t3)' }}>{q.elim}</p>
                      </div>
                    </div>
                  ))}
                </div>
                {/* Q akış gösterimi */}
                <div className="flex items-center justify-center gap-2 mt-4">
                  {['22 Pilot', '→', 'Q1', '→', '16', '→', 'Q2', '→', '10', '→', 'Q3', '→', 'Pole'].map((t, i) => (
                    <span key={i} className="text-[10px] mono font-bold"
                      style={{ color: t.startsWith('Q') ? '#E10600' : t === 'Pole' ? '#FFD700' : 'var(--t3)',
                               animation: `fadeUp 0.3s ease-out ${i * 0.05}s both` }}>
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            </section>

            {/* Aktif Aerodinamik — Overtake Modu */}
            <section className="card overflow-hidden">
              <div className="px-5 py-3 border-b" style={{ borderColor: 'var(--b1)' }}>
                <h2 className="text-[15px] font-bold text-white">💨 Aktif Aerodinamik & Overtake Modu</h2>
              </div>
              <div className="p-5">
                <div className="rounded-lg px-4 py-3 mb-4" style={{ background: 'rgba(225,6,0,0.06)', border: '1px solid rgba(225,6,0,0.15)' }}>
                  <p className="text-[11px]" style={{ color: '#E10600' }}>
                    2026'da DRS kaldırıldı. Yerine aktif aerodinamik sistemi geldi.
                  </p>
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-3">
                    <div className="rounded-lg px-4 py-3" style={{ background: 'rgba(255,255,255,0.03)' }}>
                      <p className="text-[12px] font-bold text-white">Z-Modu (Düzlük Modu)</p>
                      <p className="text-[11px] mt-1" style={{ color: 'var(--t2)' }}>
                        Düz yollarda ön ve arka kanatlar otomatik olarak düzleşir, hava direnci azalır.
                        Tüm araçlarda otomatik aktif olur — özel koşul gerekmez.
                      </p>
                    </div>
                    <div className="rounded-lg px-4 py-3" style={{ background: 'rgba(255,255,255,0.03)' }}>
                      <p className="text-[12px] font-bold text-white">Manual Override (Overtake)</p>
                      <p className="text-[11px] mt-1" style={{ color: 'var(--t2)' }}>
                        Pilot direksiyondaki butona basarak kanatları düzlük moduna zorlar.
                        Tur başına sınırlı kullanım hakkı — savunma ve atak için stratejik kullanılır.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-center">
                    <svg viewBox="0 0 220 130" width="220" height="130">
                      {/* Viraj modu */}
                      <g transform="translate(10,15)">
                        <rect x="5" y="25" width="70" height="4" rx="2" fill="#888" />
                        <rect x="15" y="8" width="50" height="6" rx="2" fill="#888" transform="rotate(-15 40 11)" />
                        <rect x="15" y="40" width="50" height="6" rx="2" fill="#888" transform="rotate(15 40 43)" />
                        <text x="40" y="70" textAnchor="middle" fontSize="8" fill="var(--t3)" fontFamily="IBM Plex Mono">VİRAJ</text>
                        <text x="40" y="80" textAnchor="middle" fontSize="7" fill="var(--t3)" fontFamily="IBM Plex Mono">Yüksek basma</text>
                      </g>
                      <text x="110" y="40" textAnchor="middle" fontSize="16" fill="#00D2BE">→</text>
                      {/* Düzlük modu */}
                      <g transform="translate(130,15)">
                        <rect x="5" y="25" width="70" height="4" rx="2" fill="#00D2BE" />
                        <rect x="15" y="20" width="50" height="4" rx="2" fill="#00D2BE">
                          <animate attributeName="y" values="12;20;20" dur="0.8s" fill="freeze" />
                        </rect>
                        <rect x="15" y="32" width="50" height="4" rx="2" fill="#00D2BE">
                          <animate attributeName="y" values="40;32;32" dur="0.8s" fill="freeze" />
                        </rect>
                        <text x="40" y="70" textAnchor="middle" fontSize="8" fill="#00D2BE" fontWeight="bold" fontFamily="IBM Plex Mono">DÜZLÜK</text>
                        <text x="40" y="80" textAnchor="middle" fontSize="7" fill="#00D2BE" fontFamily="IBM Plex Mono">Düşük direnç</text>
                      </g>
                    </svg>
                  </div>
                </div>
              </div>
            </section>

            {/* Cezalar */}
            <section className="card overflow-hidden">
              <div className="px-5 py-3 border-b" style={{ borderColor: 'var(--b1)' }}>
                <h2 className="text-[15px] font-bold text-white">⚖️ Yaygın Cezalar</h2>
              </div>
              <div className="p-5 grid sm:grid-cols-2 gap-3">
                {[
                  { penalty: '5 saniye ceza', desc: 'Küçük ihlaller: pist sınırı, güvenli olmayan çıkış', severity: 1 },
                  { penalty: '10 saniye ceza', desc: 'Orta ihlaller: çarpışmaya sebep olma', severity: 2 },
                  { penalty: 'Drive-through', desc: 'Ağır ihlaller: pit lane hız limiti aşımı', severity: 3 },
                  { penalty: 'Stop & Go (10s)', desc: 'Çok ağır ihlaller: tehlikeli sürüş', severity: 4 },
                  { penalty: 'Grid cezası', desc: 'Motor/şanzıman değişimi, parc fermé ihlali', severity: 2 },
                  { penalty: 'Diskalifiye', desc: 'Teknik kural ihlali, yakıt limitini aşma', severity: 5 },
                ].map((p, i) => (
                  <div key={p.penalty} className="flex items-start gap-3 rounded-lg px-3 py-2.5"
                    style={{ background: 'rgba(255,255,255,0.03)' }}>
                    <div className="flex gap-0.5 mt-1 shrink-0">
                      {Array(p.severity).fill(0).map((_, j) => (
                        <div key={j} className="w-1.5 h-1.5 rounded-full" style={{ background: '#E10600' }} />
                      ))}
                    </div>
                    <div>
                      <p className="text-[12px] font-bold text-white">{p.penalty}</p>
                      <p className="text-[10px] mt-0.5" style={{ color: 'var(--t3)' }}>{p.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {/* ── 2026 Regülasyonları ─────────────────────────────── */}
        {tab === 'regulations' && (
          <div className="space-y-6">

            <div className="card p-5">
              <p className="text-[14px] leading-relaxed" style={{ color: 'var(--t2)' }}>
                2026 sezonu Formula 1 tarihindeki en büyük regülasyon değişikliklerinden birini getiriyor.
                Yeni güç üniteleri, aktif aerodinamik ve sürdürülebilir yakıtlar ile F1 yeni bir çağa giriyor.
              </p>
            </div>

            {REGS_2026.map((reg, i) => (
              <section key={reg.title} className="card overflow-hidden"
                style={{ animation: `fadeUp 0.5s ease-out ${i * 0.1}s both` }}>
                <div className="px-5 py-3 border-b flex items-center gap-3"
                  style={{ borderColor: 'var(--b1)', background: reg.color + '08' }}>
                  <span className="text-2xl">{reg.icon}</span>
                  <h2 className="text-[15px] font-bold" style={{ color: reg.color }}>{reg.title}</h2>
                </div>
                <div className="p-5 space-y-2">
                  {reg.points.map((point, j) => (
                    <div key={j} className="flex items-start gap-3"
                      style={{ animation: `fadeUp 0.3s ease-out ${j * 0.08}s both` }}>
                      <div className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: reg.color }} />
                      <p className="text-[13px]" style={{ color: 'var(--t2)' }}>{point}</p>
                    </div>
                  ))}
                </div>
              </section>
            ))}

            {/* Karşılaştırma Tablosu */}
            <section className="card overflow-hidden">
              <div className="px-5 py-3 border-b" style={{ borderColor: 'var(--b1)' }}>
                <h2 className="text-[15px] font-bold text-white">📊 2025 vs 2026 Karşılaştırma</h2>
              </div>
              <div className="overflow-x-auto">
                <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'IBM Plex Mono, monospace' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)' }}>
                      {['ÖZELLİK', '2025', '2026', 'FARK'].map((h, i) => (
                        <th key={h} style={{
                          padding: '10px 14px', fontSize: 10, fontWeight: 600, letterSpacing: '0.1em',
                          color: h === '2026' ? '#00D2BE' : h === 'FARK' ? '#E10600' : 'rgba(240,244,255,0.3)',
                          textAlign: i === 0 ? 'left' : 'right',
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { label: 'Uzunluk', old: '5640 mm', val: '5440 mm', diff: '-200 mm', diffColor: '#00D2BE' },
                      { label: 'Genişlik', old: '2000 mm', val: '2000 mm', diff: 'Aynı', diffColor: 'var(--t3)' },
                      { label: 'Min. ağırlık', old: '798 kg', val: '722 kg', diff: '-76 kg', diffColor: '#00D2BE' },
                      { label: 'Dingil mesafesi', old: '3600 mm', val: '3400 mm', diff: '-200 mm', diffColor: '#00D2BE' },
                      { label: 'Elektrik (MGU-K)', old: '120 kW', val: '350 kW', diff: '+192%', diffColor: '#E10600' },
                      { label: 'MGU-H', old: 'Var', val: 'Kaldırıldı', diff: '—', diffColor: '#E10600' },
                      { label: 'Yakıt', old: 'Fosil bazlı', val: '%100 sürdürülebilir', diff: 'Yeni', diffColor: '#00D2BE' },
                      { label: 'Aerodinamik', old: 'Sabit kanat', val: 'Aktif kanat', diff: 'Yeni', diffColor: '#a855f7' },
                      { label: 'DRS', old: 'Var', val: 'Kaldırıldı (Overtake)', diff: 'Yeni', diffColor: '#a855f7' },
                    ].map(r => (
                      <tr key={r.label} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--t2)' }}>{r.label}</td>
                        <td style={{ padding: '10px 14px', fontSize: 12, fontWeight: 700, textAlign: 'right', color: 'rgba(240,244,255,0.5)' }}>{r.old}</td>
                        <td style={{ padding: '10px 14px', fontSize: 12, fontWeight: 700, textAlign: 'right', color: '#00D2BE' }}>{r.val}</td>
                        <td style={{ padding: '10px 14px', fontSize: 11, fontWeight: 700, textAlign: 'right', color: r.diffColor }}>{r.diff}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}
      </div>
    </>
  )
}
