/**
 * Devre Rehberi — pist bilgileri + hava tahmini
 * Session sayfası "Analiz" tabında gösterilir
 */

import { useTranslation } from 'react-i18next'
import { useWeather, weatherEmoji, weatherDesc, type DailyForecast } from '../../hooks/useWeather'
import { getCircuitByRaceName } from '../../data/circuits'

interface Props {
  raceName: string | null
  raceDate: string | null
}

function WeatherDay({ day, isRaceDay }: { day: DailyForecast; isRaceDay: boolean }) {
  const { i18n } = useTranslation()
  const locale = i18n.language?.startsWith('tr') ? 'tr-TR' : 'en-GB'
  const date   = new Date(day.date)
  const label  = date.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })
  const emoji  = weatherEmoji(day.weatherCode)
  const hasRain = day.rainProb >= 30

  return (
    <div className="flex flex-col items-center gap-1 p-2.5 rounded-xl min-w-[64px]"
      style={{
        background: isRaceDay ? 'rgba(225,6,0,0.1)' : 'var(--s2)',
        border: `1px solid ${isRaceDay ? 'rgba(225,6,0,0.3)' : 'var(--b1)'}`,
      }}>
      <p className="text-[9px] mono font-semibold text-center" style={{ color: isRaceDay ? '#E10600' : 'var(--t3)' }}>
        {label.toUpperCase()}
      </p>
      <span className="text-xl">{emoji}</span>
      <p className="text-[12px] font-bold text-white">{day.tempMax.toFixed(0)}°</p>
      <p className="text-[10px]" style={{ color: 'var(--t3)' }}>{day.tempMin.toFixed(0)}°</p>
      {hasRain && (
        <p className="text-[10px] font-semibold mono" style={{ color: '#00cfff' }}>
          💧{day.rainProb}%
        </p>
      )}
    </div>
  )
}

export function CircuitGuide({ raceName, raceDate }: Props) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language?.startsWith('tr') ? 'tr' : 'en'
  const circuit = raceName ? getCircuitByRaceName(raceName) : null
  const weather = useWeather(circuit?.lat ?? null, circuit?.lng ?? null)

  if (!circuit) return null

  const raceDay = raceDate ? new Date(raceDate).toISOString().split('T')[0] : null

  return (
    <div className="card overflow-hidden">
      {/* Başlık */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b"
        style={{ borderColor: 'var(--b1)' }}>
        <div className="flex items-center gap-3">
          <span className="text-xl">🏎</span>
          <div>
            <p className="text-[13px] font-bold text-white">{circuit.name}</p>
            <p className="text-[11px]" style={{ color: 'var(--t2)' }}>
              {circuit.locality}, {circuit.country} · {t('circuit.first_gp')}: {circuit.firstGP}
            </p>
          </div>
        </div>
      </div>

      <div className="p-5 space-y-5">
        {/* Devre istatistikleri */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: t('circuit.length'), value: `${circuit.lengthKm} km`, icon: '📏' },
            { label: t('circuit.corners'), value: `${circuit.corners}`, icon: '↩️' },
            { label: t('circuit.drs_zones'), value: `${circuit.drsZones}`, icon: '🚀' },
            {
              label: t('circuit.lap_record'),
              value: circuit.lapRecord ? `${circuit.lapRecord.time}` : '—',
              sub: circuit.lapRecord ? `${circuit.lapRecord.driver} (${circuit.lapRecord.year})` : undefined,
              icon: '⏱',
            },
          ].map(s => (
            <div key={s.label} className="rounded-xl p-3"
              style={{ background: 'var(--s2)', border: '1px solid var(--b1)' }}>
              <p className="text-[10px] mono mb-1" style={{ color: 'var(--t3)' }}>
                {s.icon} {s.label.toUpperCase()}
              </p>
              <p className="text-[15px] font-black mono text-white leading-none">{s.value}</p>
              {s.sub && (
                <p className="text-[9px] mono mt-0.5 truncate" style={{ color: 'var(--t3)' }}>
                  {s.sub}
                </p>
              )}
            </div>
          ))}
        </div>

        {/* Hava tahmini */}
        {weather.isLoading ? (
          <div className="flex items-center gap-2" style={{ color: 'var(--t3)' }}>
            <span className="text-sm animate-pulse">🌤</span>
            <p className="text-[12px] mono">{t('circuit.weather_loading')}</p>
          </div>
        ) : weather.isError ? (
          <p className="text-[12px] mono" style={{ color: 'var(--t3)' }}>
            {t('circuit.weather_error')}
          </p>
        ) : weather.data ? (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <p className="text-[11px] mono font-semibold tracking-widest" style={{ color: 'var(--t3)' }}>
                {t('circuit.forecast_title')}
              </p>
              {/* Güncel hava */}
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg ml-auto"
                style={{ background: 'var(--s2)', border: '1px solid var(--b1)' }}>
                <span className="text-base">{weatherEmoji(weather.data.current.weatherCode)}</span>
                <span className="text-[12px] font-bold text-white">
                  {weather.data.current.temp.toFixed(0)}°C
                </span>
                <span className="text-[11px]" style={{ color: 'var(--t3)' }}>
                  {weatherDesc(weather.data.current.weatherCode, lang)}
                </span>
                <span className="text-[11px] mono ml-1" style={{ color: 'var(--t3)' }}>
                  💨 {weather.data.current.windSpeed.toFixed(0)} km/h
                </span>
              </div>
            </div>

            <div className="flex gap-2 overflow-x-auto pb-1">
              {weather.data.daily.slice(0, 7).map(day => (
                <WeatherDay
                  key={day.date}
                  day={day}
                  isRaceDay={day.date === raceDay}
                />
              ))}
            </div>

            {/* Yağmur uyarısı */}
            {raceDay && weather.data.daily.find(d => d.date === raceDay && d.rainProb >= 50) && (
              <div className="mt-3 flex items-center gap-2 px-4 py-2.5 rounded-xl"
                style={{ background: 'rgba(0,207,255,0.08)', border: '1px solid rgba(0,207,255,0.2)' }}>
                <span className="text-lg">🌧</span>
                <p className="text-[12px]" style={{ color: '#00cfff' }}>
                  {t('circuit.rain_warning', { pct: weather.data.daily.find(d => d.date === raceDay)?.rainProb })}
                </p>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}
