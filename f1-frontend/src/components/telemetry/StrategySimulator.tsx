import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { client } from '../../api/client'
import { COMPOUND_COLORS } from '../../types/f1'
import { useUIStore } from '../../store/uiStore'

interface Props {
  sessionId: number
  totalLaps?: number
  currentLap?: number
  driverCode?: string
  refLapTime?: number
}

const C_FULL: Record<string, string> = {
  SOFT: '#FF3333', MEDIUM: '#FFD700', HARD: '#CCCCCC',
  INTERMEDIATE: '#39B54A', WET: '#0067FF',
}
const C_TR: Record<string, string> = {
  SOFT: 'Yumuşak', MEDIUM: 'Orta', HARD: 'Sert',
  INTERMEDIATE: 'Ara', WET: 'Islak',
}
const COMPOUNDS = ['SOFT', 'MEDIUM', 'HARD'] as const

// ── Tam yarış stint görselleştirmesi ─────────────────────────────────────────
// Tamamlanan kısım (gri) + senaryonun stintleri = toplam tur

function FullRaceBar({
  stints, totalLaps, currentLap, currentCompound,
}: {
  stints: any[]
  totalLaps: number
  currentLap: number
  currentCompound: string
}) {
  // Tamamlanan kısım: tur 1'den (currentLap - 1)'e kadar
  const doneLaps = currentLap - 1
  const donePct  = (doneLaps / totalLaps) * 100

  // Senaryonun stintleri
  const stintBars = stints.map((s: any) => ({
    ...s,
    pct: (s.laps / totalLaps) * 100,
  }))

  // Toplam kontrol
  const stintTotal  = stints.reduce((sum: number, s: any) => sum + s.laps, 0)
  const grandTotal  = doneLaps + stintTotal

  return (
    <div>
      {/* Bar */}
      <div className="flex h-7 rounded-lg overflow-hidden w-full gap-px">
        {/* Tamamlanan turlar */}
        {doneLaps > 0 && (
          <div
            className="flex items-center justify-center text-[9px] font-bold mono"
            style={{
              width: `${donePct}%`,
              background: 'rgba(255,255,255,0.08)',
              color: 'rgba(255,255,255,0.3)',
              borderTop: '2px solid rgba(255,255,255,0.15)',
              minWidth: 8,
            }}
            title={`Tamamlanan: ${doneLaps} tur (1–${currentLap - 1})`}
          >
            {donePct > 6 ? `${doneLaps}` : ''}
          </div>
        )}

        {/* Senaryo stintleri */}
        {stintBars.map((s, i) => {
          const col = C_FULL[s.compound] ?? '#888'
          return (
            <div key={i}
              className="flex items-center justify-center text-[9px] font-black mono"
              style={{
                width: `${s.pct}%`,
                minWidth: 12,
                background: col + '28',
                borderTop: `2px solid ${col}`,
                color: col,
              }}
              title={`${s.compound} · ${s.laps} tur (${s.start_lap}–${s.end_lap})`}>
              {s.pct > 6 ? s.compound[0] : ''}
            </div>
          )
        })}
      </div>

      {/* Etiket satırı */}
      <div className="flex items-center gap-3 mt-1.5 flex-wrap">
        {doneLaps > 0 && (
          <span className="flex items-center gap-1 text-[10px] mono"
            style={{ color: 'rgba(255,255,255,0.3)' }}>
            <span className="w-2 h-2 rounded-sm inline-block"
              style={{ background: 'rgba(255,255,255,0.15)' }} />
            Tamamlanan {doneLaps} tur
          </span>
        )}
        {stints.map((s: any, i: number) => {
          const col = C_FULL[s.compound] ?? '#888'
          return (
            <span key={i} className="flex items-center gap-1 text-[10px] mono font-semibold"
              style={{ color: col }}>
              <span className="w-2 h-2 rounded-sm inline-block"
                style={{ background: col + '40', border: `1px solid ${col}60` }} />
              {C_TR[s.compound] ?? s.compound} · {s.laps} tur
            </span>
          )
        })}
        {/* Toplam tur doğrulama */}
        <span className="ml-auto text-[10px] mono"
          style={{ color: grandTotal === totalLaps ? 'rgba(0,210,190,0.7)' : '#f87171' }}>
          {grandTotal === totalLaps
            ? `✓ ${grandTotal}/${totalLaps} tur`
            : `⚠ ${grandTotal}/${totalLaps} tur`}
        </span>
      </div>
    </div>
  )
}

// ── Ana bileşen ───────────────────────────────────────────────────────────────

export function StrategySimulator({
  sessionId, totalLaps = 58, currentLap = 20, driverCode = 'VER', refLapTime,
}: Props) {
  const { insightMode } = useUIStore()

  const [lap,          setLap]          = useState(currentLap)
  const [compound,     setCompound]     = useState<string>('MEDIUM')
  const [tyreAge,      setTyreAge]      = useState(10)
  const [baseLapTime,  setBaseLapTime]  = useState(refLapTime ?? 90.0)
  const [alternatePit, setAlternatePit] = useState<number | ''>('')
  const [triggered,    setTriggered]    = useState(false)
  const [expanded,     setExpanded]     = useState(false)

  // Props değişince güncelle
  useEffect(() => { setLap(currentLap) }, [currentLap])
  useEffect(() => {
    if (refLapTime && refLapTime > 0) setBaseLapTime(refLapTime)
  }, [refLapTime])

  const sim = useQuery({
    queryKey: ['strategy', sessionId, lap, totalLaps, compound, tyreAge, baseLapTime, alternatePit, insightMode],
    queryFn: () =>
      client.get(`/sessions/${sessionId}/strategy/simulate`, {
        params: {
          current_lap: lap, total_laps: totalLaps,
          compound, tyre_age: tyreAge,
          base_lap_time: baseLapTime,
          alternate_pit: alternatePit || undefined,
          mode: insightMode, driver_code: driverCode,
        },
      }).then(r => r.data),
    enabled: triggered,
    staleTime: 60_000,
  })

  const scenarios: any[] = sim.data?.scenarios ?? []
  const best = scenarios.reduce(
    (a: any, b: any) => (b.time_vs_base < a.time_vs_base ? b : a),
    scenarios[0]
  )
  const maxDelta = Math.max(...scenarios.map((s: any) => Math.abs(s.time_vs_base)), 1)
  const compColor = C_FULL[compound] ?? '#888'
  const remaining = totalLaps - lap + 1

  return (
    <div>
      {/* Başlık */}
      <div className="flex items-start justify-between px-5 py-4 border-b"
        style={{ borderColor: 'var(--b1)' }}>
        <div className="flex items-center gap-3">
          <span className="text-2xl">🏁</span>
          <div>
            <p className="text-[14px] font-bold text-white">Pit Stop Stratejisi</p>
            <p className="text-[11px] mt-0.5" style={{ color: 'var(--t2)' }}>
              Şu andan yarış sonuna kadar farklı pit zamanlamalarının toplam süreye etkisi
            </p>
          </div>
        </div>
        <button onClick={() => setExpanded(e => !e)}
          className="text-[11px] px-2.5 py-1.5 rounded-lg"
          style={{ background: 'var(--s2)', color: 'var(--t3)', border: '1px solid var(--b1)' }}>
          {expanded ? '▲ Kapat' : '▼ Ayarlar'}
        </button>
      </div>

      <div className="p-5 space-y-4">

        {/* ── Mevcut Durum ─────────────────────────────────── */}
        <div className="rounded-xl p-4 space-y-3"
          style={{ background: 'var(--s2)', border: '1px solid var(--b1)' }}>

          {/* Tur bilgisi */}
          <div className="flex items-center gap-4 flex-wrap">
            <div>
              <p className="text-[10px] mono mb-0.5" style={{ color: 'var(--t3)' }}>MEVCUT TUR</p>
              <div className="flex items-baseline gap-1.5">
                <span className="text-[26px] font-black mono text-white">{lap}</span>
                <span className="text-[14px] mono" style={{ color: 'var(--t3)' }}>/ {totalLaps}</span>
                <span className="text-[11px] mono ml-1" style={{ color: 'var(--t3)' }}>
                  ({remaining} tur kaldı)
                </span>
              </div>
            </div>
            <div className="w-px h-10 self-stretch" style={{ background: 'var(--b1)' }} />
            <div>
              <p className="text-[10px] mono mb-0.5" style={{ color: 'var(--t3)' }}>MEVCUT LASTİK</p>
              <span className="text-[18px] font-black mono" style={{ color: compColor }}>
                {compound[0]} <span className="text-[13px]">{C_TR[compound]}</span>
              </span>
            </div>
            <div className="w-px h-10 self-stretch" style={{ background: 'var(--b1)' }} />
            <div>
              <p className="text-[10px] mono mb-0.5" style={{ color: 'var(--t3)' }}>LASTİK YAŞI</p>
              <span className="text-[18px] font-black mono text-white">{tyreAge}
                <span className="text-[12px] font-normal ml-1" style={{ color: 'var(--t3)' }}>tur</span>
              </span>
            </div>
            <div className="w-px h-10 self-stretch" style={{ background: 'var(--b1)' }} />
            <div>
              <p className="text-[10px] mono mb-0.5" style={{ color: 'var(--t3)' }}>
                REF. PACE
                {refLapTime && <span className="ml-1 opacity-60">({driverCode})</span>}
              </p>
              <span className="text-[18px] font-black mono text-white">{baseLapTime.toFixed(1)}
                <span className="text-[12px] font-normal ml-1" style={{ color: 'var(--t3)' }}>s</span>
              </span>
            </div>
          </div>

          {/* Tur kaydırıcısı */}
          <div>
            <div className="flex justify-between mb-1">
              <p className="text-[10px] mono" style={{ color: 'var(--t3)' }}>
                Hangi turda simüle edilsin?
              </p>
              <span className="text-[11px] mono font-bold text-white">Tur {lap}</span>
            </div>
            <input type="range"
              min={1} max={totalLaps - 3} value={lap}
              onChange={e => setLap(Number(e.target.value))}
              className="w-full cursor-pointer"
              style={{ accentColor: '#E10600' }} />
            <div className="flex justify-between text-[9px] mono mt-0.5" style={{ color: 'var(--t3)' }}>
              <span>Tur 1</span>
              <span>Tur {totalLaps}</span>
            </div>
          </div>
        </div>

        {/* ── Ayarlar (opsiyonel) ───────────────────────────── */}
        {expanded && (
          <div className="rounded-xl p-4 space-y-4"
            style={{ background: 'var(--s2)', border: '1px solid var(--b1)' }}>

            {/* Lastik */}
            <div>
              <p className="text-[11px] mono mb-2 font-semibold" style={{ color: 'var(--t3)' }}>
                Mevcut lastik hamuru
              </p>
              <div className="flex gap-2">
                {COMPOUNDS.map(c => {
                  const col = C_FULL[c]
                  return (
                    <button key={c} onClick={() => setCompound(c)}
                      className="flex-1 py-2.5 rounded-xl text-[12px] font-bold mono"
                      style={{
                        background: compound === c ? col + '20' : 'transparent',
                        border: `1px solid ${compound === c ? col + '60' : 'rgba(255,255,255,0.08)'}`,
                        color: compound === c ? col : 'var(--t3)',
                      }}>
                      {c[0]}<br />
                      <span className="text-[9px] opacity-70">{C_TR[c]}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Lastik yaşı */}
              <div>
                <div className="flex justify-between mb-1">
                  <p className="text-[11px] mono font-semibold" style={{ color: 'var(--t3)' }}>
                    Lastik Yaşı
                  </p>
                  <span className="text-[12px] mono font-bold text-white">{tyreAge} tur</span>
                </div>
                <p className="text-[9px] mb-1" style={{ color: 'var(--t3)' }}>
                  Bu lastiği kaç turdur kullanıyorsun?
                </p>
                <input type="range" min={0} max={40} value={tyreAge}
                  onChange={e => setTyreAge(Number(e.target.value))}
                  className="w-full cursor-pointer" style={{ accentColor: compColor }} />
              </div>

              {/* Ref. pace */}
              <div>
                <p className="text-[11px] mono mb-1 font-semibold" style={{ color: 'var(--t3)' }}>
                  Referans Tur Süresi (s)
                </p>
                <p className="text-[9px] mb-1.5" style={{ color: 'var(--t3)' }}>
                  Temiz havada ortalama tur süresi
                </p>
                <input type="number" min={60} max={150} step={0.1}
                  value={baseLapTime}
                  onChange={e => setBaseLapTime(Number(e.target.value))}
                  style={{
                    width: '100%', background: 'var(--s1)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 8, color: 'white', fontSize: 13,
                    padding: '7px 10px', outline: 'none',
                    fontFamily: 'IBM Plex Mono,monospace',
                  }} />
              </div>
            </div>

            {/* Özel pit turu */}
            <div>
              <p className="text-[11px] mono mb-1 font-semibold" style={{ color: 'var(--t3)' }}>
                Özel Pit Turu <span className="font-normal opacity-60">(opsiyonel)</span>
              </p>
              <input type="number" min={lap + 1} max={totalLaps - 2}
                value={alternatePit}
                onChange={e => setAlternatePit(e.target.value ? Number(e.target.value) : '')}
                placeholder={`${lap + 1} – ${totalLaps - 2} arası`}
                style={{
                  width: '100%', background: 'var(--s1)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 8, color: 'white', fontSize: 13,
                  padding: '7px 10px', outline: 'none',
                  fontFamily: 'IBM Plex Mono,monospace',
                }} />
            </div>
          </div>
        )}

        {/* Simüle Et */}
        <button
          onClick={() => { setTriggered(true); sim.refetch() }}
          disabled={sim.isFetching}
          className="w-full py-3 rounded-xl text-[14px] font-bold transition-all disabled:opacity-40"
          style={{ background: '#FF8700', color: '#05080f' }}>
          {sim.isFetching ? '⚙️  Hesaplanıyor...' : '🏎  Pit Stop Senaryolarını Hesapla'}
        </button>

        {/* ── Sonuçlar ────────────────────────────────────────── */}
        {scenarios.length > 0 && (
          <div className="space-y-3">
            <p className="text-[11px] mono" style={{ color: 'var(--t3)' }}>
              Baz senaryoya göre toplam süre farkı · Bar = negatif (🟢 daha hızlı) veya pozitif (🔴 daha yavaş)
            </p>

            {scenarios.map((s: any, i: number) => {
              const isBest   = s.label === best?.label
              const delta    = s.time_vs_base as number
              const isBase   = delta === 0
              const faster   = delta < 0
              const barColor = isBase ? 'rgba(255,255,255,0.15)' : faster ? '#00D2BE' : '#E10600'
              const barW     = isBase ? 0 : Math.abs(delta) / maxDelta * 100

              return (
                <div key={i} className="rounded-xl border overflow-hidden"
                  style={{
                    borderColor: isBest ? '#00D2BE40' : 'var(--b1)',
                    background:  isBest ? 'rgba(0,210,190,0.04)' : 'var(--s2)',
                  }}>

                  {/* Başlık */}
                  <div className="flex items-center justify-between px-4 py-3 border-b"
                    style={{ borderColor: isBest ? '#00D2BE15' : 'var(--b1)' }}>
                    <div className="flex items-center gap-2">
                      {isBest && (
                        <span className="text-[10px] mono font-bold px-2 py-0.5 rounded-full"
                          style={{ background: '#00D2BE18', color: '#00D2BE', border: '1px solid #00D2BE30' }}>
                          ★ EN İYİ
                        </span>
                      )}
                      {isBase && (
                        <span className="text-[10px] mono px-2 py-0.5 rounded-full"
                          style={{ background: 'rgba(255,255,255,0.07)', color: 'var(--t2)' }}>
                          BAZ
                        </span>
                      )}
                      <span className="text-[13px] font-bold text-white">{s.label}</span>
                    </div>
                    <span className="text-[18px] font-black mono"
                      style={{ color: isBase ? 'var(--t3)' : barColor }}>
                      {isBase ? '—' : faster ? `${delta.toFixed(1)}s` : `+${delta.toFixed(1)}s`}
                    </span>
                  </div>

                  <div className="px-4 py-3 space-y-3">
                    {/* Fark barı */}
                    {!isBase && (
                      <div>
                        <div className="h-1.5 rounded-full overflow-hidden mb-1"
                          style={{ background: 'rgba(255,255,255,0.06)' }}>
                          <div className="h-1.5 rounded-full"
                            style={{ width: `${barW}%`, background: barColor }} />
                        </div>
                        <p className="text-[10px] mono" style={{ color: barColor }}>
                          {faster
                            ? `Baz senaryodan ${Math.abs(delta).toFixed(1)}s daha hızlı`
                            : `Baz senaryodan ${delta.toFixed(1)}s daha yavaş`}
                        </p>
                      </div>
                    )}

                    {/* Tam yarış stint görselleştirmesi */}
                    <FullRaceBar
                      stints={s.stints}
                      totalLaps={totalLaps}
                      currentLap={lap}
                      currentCompound={compound}
                    />

                    {/* AI yorum */}
                    {s.ai_summary && (
                      <p className="text-[12px] leading-relaxed pl-3 border-l-2"
                        style={{ color: 'var(--t2)', borderColor: isBest ? '#00D2BE' : 'var(--b2)' }}>
                        {s.ai_summary}
                      </p>
                    )}
                  </div>
                </div>
              )
            })}

            {/* Açıklama */}
            <div className="rounded-xl px-4 py-3"
              style={{ background: 'rgba(255,135,0,0.05)', border: '1px solid rgba(255,135,0,0.12)' }}>
              <p className="text-[11px] leading-relaxed" style={{ color: 'rgba(255,135,0,0.75)' }}>
                💡 <strong>Gri kısım</strong> = tamamlanan turlar.
                Renkli kısımlar = kalan stintler (lastik hamuru × tur sayısı).
                Tüm stintlerin toplamı yarış tur sayısına eşit olmalı (✓ işareti ile doğrulanır).
              </p>
            </div>
          </div>
        )}

        {sim.isError && (
          <div className="p-4 rounded-xl text-center"
            style={{ background: 'rgba(225,6,0,0.08)', border: '1px solid rgba(225,6,0,0.2)' }}>
            <p className="text-[12px]" style={{ color: '#f87171' }}>⚠ Simülasyon başarısız.</p>
          </div>
        )}
      </div>
    </div>
  )
}
