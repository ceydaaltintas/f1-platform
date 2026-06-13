import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { client } from '../../api/client'
import { formatLapTime, formatSectorTime } from '../../utils/format'
import { HistoricalShareCard } from '../ui/HistoricalShareCard'
import { useShareCard } from '../../hooks/useShareCard'

interface Props {
  circuitName?: string
  sessionDrivers?: string[]
  selectedDriver?: string
}

const DEFAULT_DRIVERS = ['VER', 'HAM', 'LEC', 'NOR', 'PIA', 'RUS', 'SAI', 'ALO']
const AVAILABLE_YEARS = [2024, 2025, 2026]

export function HistoricalCompare({ circuitName, sessionDrivers, selectedDriver }: Props) {
  const driverOptions = sessionDrivers && sessionDrivers.length > 0 ? sessionDrivers : DEFAULT_DRIVERS

  const [driver, setDriver] = useState(selectedDriver ?? driverOptions[0])
  const [years, setYears] = useState<number[]>([2025, 2026])
  const [triggered, setTriggered] = useState(false)

  // Ana sayfadaki pilot seçimi değişince burayı da güncelle
  useEffect(() => {
    if (selectedDriver) setDriver(selectedDriver)
  }, [selectedDriver])

  const circuit = (circuitName ?? '').toLowerCase()

  const toggleYear = (y: number) => {
    setYears(prev => prev.includes(y) ? prev.filter(x => x !== y) : [...prev, y].sort())
  }

  const { cardRef: shareCardRef, share: shareHistorical } = useShareCard()

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['historical', driver, circuit, years],
    queryFn: () =>
      client.get('/historical-compare', {
        params: { driver, circuit, years: years.join(',') }
      }).then(r => r.data),
    enabled: triggered && years.length > 0 && !!circuit,
    staleTime: 24 * 60 * 60 * 1000,
  })

  return (
    <div className="card p-4">
      <p className="text-[10px] mono font-semibold tracking-widest mb-4" style={{ color: 'var(--t3)' }}>
        TARİHSEL KARŞILAŞTIRMA
      </p>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        {/* Pilot seçimi */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] mono font-semibold" style={{ color: 'var(--t3)' }}>PİLOT</span>
          <select
            value={driver}
            onChange={e => setDriver(e.target.value)}
            className="px-3 py-2 rounded-xl text-[13px] font-black mono cursor-pointer"
            style={{ background: 'rgba(225,6,0,0.08)', border: '1px solid rgba(225,6,0,0.30)', color: '#E10600', outline: 'none', minWidth: 90 }}
          >
            {driverOptions.map(code => (
              <option key={code} value={code}>{code}</option>
            ))}
          </select>
        </div>

        {/* Yıl seçimi */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] mono font-semibold" style={{ color: 'var(--t3)' }}>YIL</span>
          {AVAILABLE_YEARS.map(y => (
            <button key={y} onClick={() => toggleYear(y)}
              className="px-3 py-2 rounded-xl text-[12px] mono font-semibold cursor-pointer transition-all"
              style={{
                background: years.includes(y) ? 'rgba(0,210,190,0.10)' : 'var(--s2)',
                border: `1px solid ${years.includes(y) ? 'rgba(0,210,190,0.35)' : 'var(--b1)'}`,
                color: years.includes(y) ? '#00D2BE' : 'var(--t2)',
              }}>
              {y}
            </button>
          ))}
        </div>

        <button onClick={() => setTriggered(true)}
          disabled={years.length === 0 || !circuit}
          className="px-4 py-2 rounded-xl text-[12px] mono font-semibold cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: 'rgba(225,6,0,0.08)', border: '1px solid rgba(225,6,0,0.30)', color: '#E10600' }}>
          Karşılaştır
        </button>
      </div>

      {!circuit && (
        <div className="text-[12px]" style={{ color: 'var(--t3)' }}>Devre bilgisi yükleniyor...</div>
      )}

      {(isLoading || isFetching) && (
        <div className="text-[12px]" style={{ color: 'var(--t3)' }}>Yükleniyor...</div>
      )}

      {data?.results && (
        <div className="space-y-2">
          <div className="flex justify-end">
            <button onClick={() => shareHistorical(`hotlap-${driver}-${circuit.replace(/\s+/g, '-')}-tarihsel`)}
              className="flex items-center gap-2 px-4 py-2 text-[11px] border border-[#E10600]/40 text-[#E10600] rounded-lg hover:bg-[#E10600]/10 transition-all"
            >
              <span>↗</span> Karşılaştırmayı Paylaş
            </button>
          </div>

          {/* Görünmez kart — sadece yakalama için */}
          <HistoricalShareCard
            ref={shareCardRef}
            driver={driver}
            circuitName={circuitName ?? circuit}
            results={data.results}
            fastestYear={data.fastest_year}
          />

          {data.results.map((r: any) => (
            <div key={r.year}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
              style={{
                border: `1px solid ${r.year === data.fastest_year ? 'rgba(225,6,0,0.30)' : 'var(--b1)'}`,
                background: r.year === data.fastest_year ? 'rgba(225,6,0,0.05)' : 'transparent',
              }}>
              <span className="text-[12px] mono w-12" style={{ color: 'var(--t2)' }}>{r.year}</span>
              {r.error ? (
                <span className="text-[11px]" style={{ color: 'var(--t3)' }}>{r.error}</span>
              ) : (
                <>
                  <span className="text-[14px] font-semibold mono flex-1" style={{ color: 'var(--text)' }}>
                    {formatLapTime(r.lap_time)}
                  </span>
                  <div className="text-right">
                    <div className="flex items-center justify-end gap-2.5 mb-0.5">
                      {[['S1', r.s1], ['S2', r.s2], ['S3', r.s3]].map(([label, val]) => (
                        <div key={label} className="flex items-center gap-1">
                          <span className="text-[9px] mono font-semibold" style={{ color: 'var(--t3)' }}>{label}</span>
                          <span className="text-[13px] mono font-bold" style={{ color: 'var(--text)' }}>
                            {formatSectorTime(val as number)}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="text-[10px] mono" style={{ color: 'var(--t3)' }}>{r.compound}</div>
                  </div>
                  {r.year === data.fastest_year && (
                    <span className="text-[9px] mono font-semibold rounded-lg px-1.5 py-0.5"
                      style={{ color: '#E10600', border: '1px solid rgba(225,6,0,0.30)' }}>
                      EN HIZLI
                    </span>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
