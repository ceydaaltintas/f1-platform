/**
 * OpenMeteo hava tahmini hook'u
 * Tamamen ücretsiz, API key gerektirmez
 * https://open-meteo.com
 */

import { useQuery } from '@tanstack/react-query'

export interface HourlyForecast {
  time: string        // ISO datetime
  temp: number        // °C
  rain: number        // mm
  rainProb: number    // %
  windSpeed: number   // km/h
  weatherCode: number
}

export interface DailyForecast {
  date: string
  tempMax: number
  tempMin: number
  rainProb: number    // max of day
  totalRain: number   // mm
  weatherCode: number
}

export interface WeatherData {
  current: {
    temp: number
    rainProb: number
    windSpeed: number
    weatherCode: number
    isRaining: boolean
  }
  hourly: HourlyForecast[]
  daily: DailyForecast[]
}

// WMO Weather Interpretation Codes → emoji + Türkçe
export function weatherEmoji(code: number): string {
  if (code === 0)            return '☀️'
  if (code <= 2)             return '🌤'
  if (code <= 3)             return '☁️'
  if (code <= 49)            return '🌫'
  if (code <= 55)            return '🌦'
  if (code <= 65)            return '🌧'
  if (code <= 67)            return '🌨'
  if (code <= 77)            return '❄️'
  if (code <= 82)            return '🌧'
  if (code <= 99)            return '⛈'
  return '🌡'
}

export function weatherDesc(code: number): string {
  if (code === 0)            return 'Açık'
  if (code <= 2)             return 'Az bulutlu'
  if (code <= 3)             return 'Bulutlu'
  if (code <= 49)            return 'Sisli'
  if (code <= 55)            return 'Çisenti'
  if (code <= 65)            return 'Yağmurlu'
  if (code <= 67)            return 'Dondurucu yağmur'
  if (code <= 77)            return 'Karlı'
  if (code <= 82)            return 'Sağanak'
  if (code <= 99)            return 'Fırtınalı'
  return 'Bilinmeyen'
}

async function fetchWeather(lat: number, lng: number): Promise<WeatherData> {
  const params = new URLSearchParams({
    latitude:  lat.toString(),
    longitude: lng.toString(),
    hourly:    'temperature_2m,precipitation_probability,precipitation,wind_speed_10m,weather_code',
    daily:     'temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,weather_code',
    current:   'temperature_2m,precipitation,wind_speed_10m,weather_code',
    timezone:  'auto',
    forecast_days: '7',
  })

  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`)
  if (!res.ok) throw new Error('Weather API error')
  const d = await res.json()

  const cur = d.current
  const h   = d.hourly
  const day = d.daily

  const hourly: HourlyForecast[] = (h.time ?? []).map((t: string, i: number) => ({
    time:        t,
    temp:        h.temperature_2m[i] ?? 0,
    rain:        h.precipitation[i] ?? 0,
    rainProb:    h.precipitation_probability[i] ?? 0,
    windSpeed:   h.wind_speed_10m[i] ?? 0,
    weatherCode: h.weather_code[i] ?? 0,
  }))

  const daily: DailyForecast[] = (day.time ?? []).map((t: string, i: number) => ({
    date:        t,
    tempMax:     day.temperature_2m_max[i] ?? 0,
    tempMin:     day.temperature_2m_min[i] ?? 0,
    rainProb:    day.precipitation_probability_max[i] ?? 0,
    totalRain:   day.precipitation_sum[i] ?? 0,
    weatherCode: day.weather_code[i] ?? 0,
  }))

  return {
    current: {
      temp:        cur.temperature_2m ?? 0,
      rainProb:    0,
      windSpeed:   cur.wind_speed_10m ?? 0,
      weatherCode: cur.weather_code ?? 0,
      isRaining:   (cur.precipitation ?? 0) > 0,
    },
    hourly,
    daily,
  }
}

export function useWeather(lat: number | null, lng: number | null) {
  return useQuery<WeatherData>({
    queryKey: ['weather', lat, lng],
    queryFn:  () => fetchWeather(lat!, lng!),
    enabled:  lat != null && lng != null,
    staleTime: 30 * 60 * 1000,  // 30 dk cache
    retry: 1,
  })
}
