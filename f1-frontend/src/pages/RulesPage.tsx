import { useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { useTranslation } from 'react-i18next'

type Tab = 'general' | 'regulations'

function posColor(i: number) {
  if (i === 0) return '#FFD700'
  if (i === 1) return '#C0C0C0'
  if (i === 2) return '#CD7F32'
  return 'var(--t3)'
}

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

export function RulesPage() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('general')

  const TYRE_COMPOUNDS = [
    { name: 'SOFT',         color: '#E10600', letter: 'S', desc: t('rules.tyre_soft_desc') },
    { name: 'MEDIUM',       color: '#FFD700', letter: 'M', desc: t('rules.tyre_medium_desc') },
    { name: 'HARD',         color: '#C0C0C0', letter: 'H', desc: t('rules.tyre_hard_desc') },
    { name: 'INTERMEDIATE', color: '#43B02A', letter: 'I', desc: t('rules.tyre_inter_desc') },
    { name: 'WET',          color: '#0072C6', letter: 'W', desc: t('rules.tyre_wet_desc') },
  ]

  const FLAGS = [
    { name: t('rules.flag_green'),    color: '#00D2BE', icon: '🟢', desc: t('rules.flag_green_desc') },
    { name: t('rules.flag_yellow'),   color: '#FFD700', icon: '🟡', desc: t('rules.flag_yellow_desc') },
    { name: t('rules.flag_red'),      color: '#E10600', icon: '🔴', desc: t('rules.flag_red_desc') },
    { name: t('rules.flag_blue'),     color: '#0072C6', icon: '🔵', desc: t('rules.flag_blue_desc') },
    { name: t('rules.flag_black'),    color: '#333',    icon: '🏴', desc: t('rules.flag_black_desc') },
    { name: t('rules.flag_bw'),       color: '#888',    icon: '🏁', desc: t('rules.flag_bw_desc') },
    { name: t('rules.flag_chequered'),color: '#fff',    icon: '🏁', desc: t('rules.flag_chequered_desc') },
  ]

  const WEEKEND_FORMAT = [
    { day: t('rules.day_friday'), sessions: [
      { name: t('session.practice1'), duration: '60 min', desc: t('rules.fp1_desc') },
      { name: t('session.practice2'), duration: '60 min', desc: t('rules.fp2_desc') },
    ]},
    { day: t('rules.day_saturday'), sessions: [
      { name: t('session.practice3'), duration: '60 min', desc: t('rules.fp3_desc') },
      { name: t('session.qualifying'), duration: 'Q1(18)+Q2(15)+Q3(12)', desc: t('rules.quali_desc') },
    ]},
    { day: t('rules.day_sunday'), sessions: [
      { name: t('session.race'), duration: t('rules.race_duration'), desc: t('rules.race_desc') },
    ]},
  ]

  const REGS_2026 = [
    {
      title: t('rules.reg_pu_title'), icon: '⚡', color: '#E10600',
      points: [
        t('rules.reg_pu_1'), t('rules.reg_pu_2'), t('rules.reg_pu_3'), t('rules.reg_pu_4'),
      ],
    },
    {
      title: t('rules.reg_aero_title'), icon: '🔄', color: '#00D2BE',
      points: [
        t('rules.reg_aero_1'), t('rules.reg_aero_2'), t('rules.reg_aero_3'), t('rules.reg_aero_4'),
      ],
    },
    {
      title: t('rules.reg_ground_title'), icon: '⬇️', color: '#FFD700',
      points: [
        t('rules.reg_ground_1'), t('rules.reg_ground_2'), t('rules.reg_ground_3'), t('rules.reg_ground_4'),
      ],
    },
    {
      title: t('rules.reg_cost_title'), icon: '💰', color: '#a855f7',
      points: [
        t('rules.reg_cost_1'), t('rules.reg_cost_2'), t('rules.reg_cost_3'), t('rules.reg_cost_4'),
      ],
    },
  ]

  const COMPARISON = [
    { label: t('rules.cmp_length'),   old: '5640 mm', val: '5440 mm', diff: '-200 mm', diffColor: '#00D2BE' },
    { label: t('rules.cmp_width'),    old: '2000 mm', val: '2000 mm', diff: t('rules.cmp_same'), diffColor: 'var(--t3)' },
    { label: t('rules.cmp_weight'),   old: '798 kg',  val: '722 kg',  diff: '-76 kg',  diffColor: '#00D2BE' },
    { label: t('rules.cmp_wb'),       old: '3600 mm', val: '3400 mm', diff: '-200 mm', diffColor: '#00D2BE' },
    { label: t('rules.cmp_mguk'),     old: '120 kW',  val: '350 kW',  diff: '+192%',   diffColor: '#E10600' },
    { label: 'MGU-H', old: t('rules.cmp_yes'), val: t('rules.cmp_removed'), diff: '—', diffColor: '#E10600' },
    { label: t('rules.cmp_fuel'),     old: t('rules.cmp_fossil'), val: '100% ' + t('rules.cmp_sustainable'), diff: t('rules.cmp_new'), diffColor: '#00D2BE' },
    { label: t('rules.cmp_aero'),     old: t('rules.cmp_fixed_wing'), val: t('rules.cmp_active_wing'), diff: t('rules.cmp_new'), diffColor: '#a855f7' },
    { label: 'DRS', old: t('rules.cmp_yes'), val: t('rules.cmp_removed') + ' (Overtake)', diff: t('rules.cmp_new'), diffColor: '#a855f7' },
  ]

  const PENALTIES = [
    { penalty: t('rules.pen_5s'),   desc: t('rules.pen_5s_desc'),  severity: 1 },
    { penalty: t('rules.pen_10s'),  desc: t('rules.pen_10s_desc'), severity: 2 },
    { penalty: 'Drive-through',     desc: t('rules.pen_dt_desc'),  severity: 3 },
    { penalty: 'Stop & Go (10s)',   desc: t('rules.pen_sg_desc'),  severity: 4 },
    { penalty: t('rules.pen_grid'), desc: t('rules.pen_grid_desc'),severity: 2 },
    { penalty: t('rules.pen_dsq'),  desc: t('rules.pen_dsq_desc'), severity: 5 },
  ]

  return (
    <>
      <Helmet>
        <title>{t('rules.page_title', { year: 2026 })}</title>
        <meta name="description" content={t('rules.page_desc', { year: 2026 })} />
        <link rel="canonical" href="https://hotlap.live/rules" />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="Hotlap" />
        <meta property="og:title" content={t('rules.page_title', { year: 2026 })} />
        <meta property="og:description" content={t('rules.page_desc', { year: 2026 })} />
        <meta property="og:url" content="https://hotlap.live/rules" />
        <meta property="og:image" content="https://hotlap.live/og-image.png" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:site" content="@hotlapapp" />
        <meta name="twitter:title" content={t('rules.page_title', { year: 2026 })} />
        <meta name="twitter:description" content={t('rules.page_desc', { year: 2026 })} />
      </Helmet>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        <div>
          <p className="text-[10px] mono font-semibold tracking-[0.3em] mb-2" style={{ color: '#E10600' }}>
            FORMULA 1
          </p>
          <h1 className="text-[32px] font-black text-white leading-tight">{t('rules.title')}</h1>
          <p className="text-[14px] mt-1" style={{ color: 'var(--t2)' }}>
            {t('rules.subtitle', { year: 2026 })}
          </p>
        </div>

        <div className="flex p-1 rounded-xl" style={{ background: 'var(--s1)' }}>
          {([
            ['general', t('rules.tab_general')],
            ['regulations', t('rules.tab_regs', { year: 2026 })],
          ] as const).map(([tabKey, label]) => (
            <button key={tabKey} onClick={() => setTab(tabKey)}
              className="flex-1 py-2.5 rounded-lg text-[13px] font-semibold transition-all"
              style={tab === tabKey ? { background: '#E10600', color: 'white' } : { color: 'var(--t3)' }}>
              {label}
            </button>
          ))}
        </div>

        {/* ── General Rules ── */}
        {tab === 'general' && (
          <div className="space-y-8">

            {/* Points */}
            <section className="card overflow-hidden">
              <div className="px-5 py-3 border-b" style={{ borderColor: 'var(--b1)' }}>
                <h2 className="text-[15px] font-bold text-white">🏆 {t('rules.sec_points')}</h2>
              </div>
              <div className="p-5 grid md:grid-cols-2 gap-6">
                <div>
                  <p className="text-[11px] mono font-semibold mb-3" style={{ color: 'var(--t3)' }}>
                    {t('rules.race_points_label')}
                  </p>
                  <div className="space-y-1.5">
                    {POINTS_RACE.map((p, i) => (
                      <div key={p.pos} className="flex items-center gap-3">
                        <span className="text-[11px] mono w-5 text-right font-bold" style={{ color: posColor(i) }}>P{p.pos}</span>
                        <div className="flex-1">
                          <AnimatedBar value={p.pts} max={25} color={i < 3 ? '#E10600' : '#888'} delay={i * 0.05} />
                        </div>
                      </div>
                    ))}
                    <p className="text-[10px] mt-2" style={{ color: 'var(--t3)' }}>{t('rules.fastest_lap_note')}</p>
                  </div>
                </div>
                <div>
                  <p className="text-[11px] mono font-semibold mb-3" style={{ color: 'var(--t3)' }}>
                    {t('rules.sprint_points_label')}
                  </p>
                  <div className="space-y-1.5">
                    {POINTS_SPRINT.map((p, i) => (
                      <div key={p.pos} className="flex items-center gap-3">
                        <span className="text-[11px] mono w-5 text-right font-bold" style={{ color: posColor(i) }}>P{p.pos}</span>
                        <div className="flex-1">
                          <AnimatedBar value={p.pts} max={8} color={i < 3 ? '#FF8700' : '#888'} delay={i * 0.05} />
                        </div>
                      </div>
                    ))}
                    <p className="text-[10px] mt-2" style={{ color: 'var(--t3)' }}>{t('rules.sprint_note')}</p>
                  </div>
                </div>
              </div>
            </section>

            {/* Tyres */}
            <section className="card overflow-hidden">
              <div className="px-5 py-3 border-b" style={{ borderColor: 'var(--b1)' }}>
                <h2 className="text-[15px] font-bold text-white">🔴 {t('rules.sec_tyres')}</h2>
              </div>
              <div className="p-5">
                <div className="flex flex-wrap gap-4 justify-center py-4">
                  {TYRE_COMPOUNDS.map((tc, i) => (
                    <div key={tc.name} className="flex flex-col items-center gap-2 w-[140px]"
                      style={{ animation: `fadeUp 0.5s ease-out ${i * 0.1}s both` }}>
                      <div className="relative">
                        <svg width="72" height="72" viewBox="0 0 72 72">
                          <circle cx="36" cy="36" r="32" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="8" />
                          <circle cx="36" cy="36" r="32" fill="none" stroke={tc.color} strokeWidth="8"
                            strokeDasharray={`${201 * ((5 - i) / 5)} 201`}
                            style={{ animation: `tyreRotate 2s linear ${i * 0.2}s both` }}
                            transform="rotate(-90 36 36)" />
                          <circle cx="36" cy="36" r="20" fill={tc.color + '15'} stroke={tc.color + '40'} strokeWidth="1" />
                          <text x="36" y="40" textAnchor="middle" fontSize="16" fontWeight="900"
                            fontFamily="IBM Plex Mono" fill={tc.color}>{tc.letter}</text>
                        </svg>
                      </div>
                      <p className="text-[12px] font-bold" style={{ color: tc.color }}>{tc.name}</p>
                      <p className="text-[10px] text-center leading-tight" style={{ color: 'var(--t3)' }}>{tc.desc}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-4 rounded-lg px-4 py-3" style={{ background: 'rgba(255,255,255,0.03)' }}>
                  <p className="text-[11px] leading-relaxed" style={{ color: 'var(--t2)' }}>
                    {t('rules.tyre_rule_note')}
                  </p>
                </div>
              </div>
            </section>

            {/* Flags */}
            <section className="card overflow-hidden">
              <div className="px-5 py-3 border-b" style={{ borderColor: 'var(--b1)' }}>
                <h2 className="text-[15px] font-bold text-white">🚩 {t('rules.sec_flags')}</h2>
              </div>
              <div className="p-5 grid sm:grid-cols-2 gap-3">
                {FLAGS.map(f => (
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

            {/* Weekend Format */}
            <section className="card overflow-hidden">
              <div className="px-5 py-3 border-b" style={{ borderColor: 'var(--b1)' }}>
                <h2 className="text-[15px] font-bold text-white">📅 {t('rules.sec_weekend')}</h2>
              </div>
              <div className="p-5">
                <div className="grid md:grid-cols-3 gap-4">
                  {WEEKEND_FORMAT.map((day, di) => (
                    <div key={day.day} className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--b1)' }}>
                      <div className="px-4 py-2 text-center" style={{ background: di === 2 ? 'rgba(225,6,0,0.1)' : 'rgba(255,255,255,0.03)' }}>
                        <p className="text-[11px] mono font-black tracking-widest"
                          style={{ color: di === 2 ? '#E10600' : 'var(--t3)' }}>{day.day}</p>
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

            {/* Qualifying Format */}
            <section className="card overflow-hidden">
              <div className="px-5 py-3 border-b" style={{ borderColor: 'var(--b1)' }}>
                <h2 className="text-[15px] font-bold text-white">⏱ {t('rules.sec_quali')}</h2>
              </div>
              <div className="p-5">
                <div className="flex flex-col sm:flex-row gap-3">
                  {[
                    { seg: 'Q1', time: t('rules.q1_time'), drivers: '22 → 16', elim: t('rules.q1_elim'), color: '#E10600' },
                    { seg: 'Q2', time: t('rules.q2_time'), drivers: '16 → 10', elim: t('rules.q2_elim'), color: '#FF8700' },
                    { seg: 'Q3', time: t('rules.q3_time'), drivers: t('rules.q3_drivers'), elim: t('rules.q3_elim'), color: '#a855f7' },
                  ].map(q => (
                    <div key={q.seg} className="flex-1 rounded-xl border overflow-hidden" style={{ borderColor: q.color + '40' }}>
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
                <div className="flex items-center justify-center gap-2 mt-4 flex-wrap">
                  {[`22 ${t('rules.drivers')}`, '→', 'Q1', '→', '16', '→', 'Q2', '→', '10', '→', 'Q3', '→', 'Pole'].map((item, i) => (
                    <span key={i} className="text-[10px] mono font-bold"
                      style={{ color: item.startsWith('Q') ? '#E10600' : item === 'Pole' ? '#FFD700' : 'var(--t3)',
                               animation: `fadeUp 0.3s ease-out ${i * 0.05}s both` }}>
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            </section>

            {/* Active Aero */}
            <section className="card overflow-hidden">
              <div className="px-5 py-3 border-b" style={{ borderColor: 'var(--b1)' }}>
                <h2 className="text-[15px] font-bold text-white">💨 {t('rules.sec_aero')}</h2>
              </div>
              <div className="p-5">
                <div className="rounded-lg px-4 py-3 mb-4" style={{ background: 'rgba(225,6,0,0.06)', border: '1px solid rgba(225,6,0,0.15)' }}>
                  <p className="text-[11px]" style={{ color: '#E10600' }}>{t('rules.drs_removed_note')}</p>
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-3">
                    <div className="rounded-lg px-4 py-3" style={{ background: 'rgba(255,255,255,0.03)' }}>
                      <p className="text-[12px] font-bold text-white">{t('rules.z_mode_title')}</p>
                      <p className="text-[11px] mt-1" style={{ color: 'var(--t2)' }}>{t('rules.z_mode_desc')}</p>
                    </div>
                    <div className="rounded-lg px-4 py-3" style={{ background: 'rgba(255,255,255,0.03)' }}>
                      <p className="text-[12px] font-bold text-white">Manual Override (Overtake)</p>
                      <p className="text-[11px] mt-1" style={{ color: 'var(--t2)' }}>{t('rules.overtake_desc')}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-center">
                    <svg viewBox="0 0 220 130" width="220" height="130">
                      <g transform="translate(10,15)">
                        <rect x="5" y="25" width="70" height="4" rx="2" fill="#888" />
                        <rect x="15" y="8" width="50" height="6" rx="2" fill="#888" transform="rotate(-15 40 11)" />
                        <rect x="15" y="40" width="50" height="6" rx="2" fill="#888" transform="rotate(15 40 43)" />
                        <text x="40" y="70" textAnchor="middle" fontSize="8" fill="var(--t3)" fontFamily="IBM Plex Mono">{t('rules.corner_label')}</text>
                        <text x="40" y="80" textAnchor="middle" fontSize="7" fill="var(--t3)" fontFamily="IBM Plex Mono">{t('rules.high_df')}</text>
                      </g>
                      <text x="110" y="40" textAnchor="middle" fontSize="16" fill="#00D2BE">→</text>
                      <g transform="translate(130,15)">
                        <rect x="5" y="25" width="70" height="4" rx="2" fill="#00D2BE" />
                        <rect x="15" y="20" width="50" height="4" rx="2" fill="#00D2BE">
                          <animate attributeName="y" values="12;20;20" dur="0.8s" fill="freeze" />
                        </rect>
                        <rect x="15" y="32" width="50" height="4" rx="2" fill="#00D2BE">
                          <animate attributeName="y" values="40;32;32" dur="0.8s" fill="freeze" />
                        </rect>
                        <text x="40" y="70" textAnchor="middle" fontSize="8" fill="#00D2BE" fontWeight="bold" fontFamily="IBM Plex Mono">{t('rules.straight_label')}</text>
                        <text x="40" y="80" textAnchor="middle" fontSize="7" fill="#00D2BE" fontFamily="IBM Plex Mono">{t('rules.low_drag')}</text>
                      </g>
                    </svg>
                  </div>
                </div>
              </div>
            </section>

            {/* Penalties */}
            <section className="card overflow-hidden">
              <div className="px-5 py-3 border-b" style={{ borderColor: 'var(--b1)' }}>
                <h2 className="text-[15px] font-bold text-white">⚖️ {t('rules.sec_penalties')}</h2>
              </div>
              <div className="p-5 grid sm:grid-cols-2 gap-3">
                {PENALTIES.map(p => (
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

        {/* ── 2026 Regulations ── */}
        {tab === 'regulations' && (
          <div className="space-y-6">
            <div className="card p-5">
              <p className="text-[14px] leading-relaxed" style={{ color: 'var(--t2)' }}>
                {t('rules.regs_intro', { year: 2026 })}
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

            {/* Comparison Table */}
            <section className="card overflow-hidden">
              <div className="px-5 py-3 border-b" style={{ borderColor: 'var(--b1)' }}>
                <h2 className="text-[15px] font-bold text-white">📊 {t('rules.sec_comparison')}</h2>
              </div>
              <div className="overflow-x-auto">
                <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'IBM Plex Mono, monospace' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)' }}>
                      {[t('rules.cmp_feature'), '2025', '2026', t('rules.cmp_diff')].map((h, i) => (
                        <th key={h} style={{
                          padding: '10px 14px', fontSize: 10, fontWeight: 600, letterSpacing: '0.1em',
                          color: h === '2026' ? '#00D2BE' : h === t('rules.cmp_diff') ? '#E10600' : 'rgba(240,244,255,0.3)',
                          textAlign: i === 0 ? 'left' : 'right',
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {COMPARISON.map(r => (
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
