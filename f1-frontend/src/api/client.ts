import axios from 'axios'
import type {
  CompareResponse,
  Driver,
  InterpretResponse,
  Round,
  Season,
  TelemetryResponse,
  TrackMapResponse,
} from '../types/f1'

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

export const client = axios.create({
  baseURL: `${BASE_URL}/api/v1`,
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
})

// JWT token interceptor
client.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// ─── Auth ────────────────────────────────────────────────────────────────────

export const authApi = {
  register: (body: { username: string; email: string; password: string }) =>
    client.post('/auth/register', body).then((r) => r.data),

  login: (body: { email: string; password: string }) =>
    client.post<{ access_token: string; refresh_token: string }>('/auth/login', body).then((r) => {
      localStorage.setItem('access_token', r.data.access_token)
      localStorage.setItem('refresh_token', r.data.refresh_token)
      return r.data
    }),

  logout: () => {
    localStorage.removeItem('access_token')
    localStorage.removeItem('refresh_token')
  },
}

// ─── Seasons ─────────────────────────────────────────────────────────────────

export const seasonApi = {
  list: () => client.get<Season[]>('/seasons').then((r) => r.data),

  current: () => client.get<Season>('/seasons/current').then((r) => r.data),

  rounds: (year: number, status?: 'completed' | 'upcoming') =>
    client.get<Round[]>(`/seasons/${year}/rounds`, { params: { status } }).then((r) => r.data),

  nextRound: (year: number) =>
    client.get<Round>(`/seasons/${year}/next`).then((r) => r.data),

  sync: (year: number) =>
    client.post(`/seasons/${year}/sync`).then((r) => r.data),
}

// ─── Drivers ─────────────────────────────────────────────────────────────────

export const driverApi = {
  list: (season?: number) =>
    client.get<Driver[]>('/drivers', { params: { season } }).then((r) => r.data),
}

// ─── Telemetri ───────────────────────────────────────────────────────────────

export const telemetryApi = {
  get: (sessionId: number, driverCode: string, lap: string | number = 'fastest') =>
    client
      .get<TelemetryResponse>(`/sessions/${sessionId}/telemetry/${driverCode}`, {
        params: { lap },
      })
      .then((r) => r.data),

  trackMap: (sessionId: number, driverCode = 'VER') =>
    client
      .get<TrackMapResponse>(`/sessions/${sessionId}/track_map`, {
        params: { driver_code: driverCode },
      })
      .then((r) => r.data),

  stints: (sessionId: number, driverCode?: string) =>
    client
      .get(`/sessions/${sessionId}/stints`, { params: { driver_code: driverCode } })
      .then((r) => r.data),

  compare: (sessionId: number, driverA: string, driverB: string, lap = 'fastest') =>
    client
      .get<CompareResponse>(`/sessions/${sessionId}/compare`, {
        params: { drivers: `${driverA},${driverB}`, lap },
      })
      .then((r) => r.data),
}

// ─── AI ──────────────────────────────────────────────────────────────────────

export const aiApi = {
  interpret: (snapshot: Record<string, unknown>, mode: string) =>
    client
      .post<InterpretResponse & { source?: string }>('/ai/interpret', { ...snapshot, mode })
      .then((r) => r.data),

  lapSummary: (lapInfo: object, keyMoments: object[], mode: string) =>
    client
      .post<{ summary: string; mode: string }>('/ai/lap_summary', { lap_info: lapInfo, key_moments: keyMoments, mode })
      .then((r) => r.data),

  compare: (body: object) =>
    client.post('/ai/compare', body).then((r) => r.data),
}
