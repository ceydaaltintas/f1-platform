// ─── Sezon & Yarış ──────────────────────────────────────────────────────────

export interface Season {
  id: number
  year: number
  is_current: boolean
  round_count: number
  rounds_completed: number
  rounds_upcoming: number
}

export interface SessionBrief {
  id: number
  type: SessionType
  status: 'upcoming' | 'active' | 'finished'
  session_date: string | null
  session_key: number | null
}

export type SessionType =
  | 'practice1' | 'practice2' | 'practice3'
  | 'qualifying' | 'sprint_qualifying' | 'sprint' | 'race'

export const SESSION_LABELS: Record<SessionType, string> = {
  practice1: 'Antrenman 1',
  practice2: 'Antrenman 2',
  practice3: 'Antrenman 3',
  qualifying: 'Sıralama',
  sprint_qualifying: 'Sprint Sıralama',
  sprint: 'Sprint',
  race: 'Yarış',
}

export interface Round {
  id: number
  round_number: number
  name: string
  circuit_name: string
  country: string | null
  locality: string | null
  race_date: string | null
  race_datetime: string | null
  round_status: 'completed' | 'upcoming'
  sessions: SessionBrief[]
}

// ─── Pilot & Takım ──────────────────────────────────────────────────────────

export interface Team {
  id: number
  jolpica_id: string
  name: string
  nationality: string | null
  color_hex: string
}

export interface Driver {
  id: number
  jolpica_id: string
  code: string
  first_name: string
  last_name: string
  full_name: string
  number: number | null
  nationality: string | null
  current_team: Team | null
}

// ─── Telemetri ──────────────────────────────────────────────────────────────

export interface TelemetryPoint {
  date: string
  speed: number | null
  throttle: number | null
  brake: number | null
  drs: number | null
  rpm: number | null
  gear: number | null
  dist_m: number
}

export interface LapInfo {
  number: number
  duration: number | null
  date_start: string | null
  compound: string | null
  sector1: number | null
  sector2: number | null
  sector3: number | null
  is_personal_best: boolean
}

export interface KeyMoment {
  point: 'braking' | 'drs_open' | string
  speed_entry?: number
  speed_min?: number
  speed?: number
  dist_m: number
}

export interface TelemetryResponse {
  lap: LapInfo
  telemetry: TelemetryPoint[]
  key_moments: KeyMoment[]
  driver_code: string
  session_id: number
}

export interface TrackPoint {
  x: number | null
  y: number | null
}

export interface TrackMapResponse {
  session_id: number
  points: TrackPoint[]
  count: number
}

export interface Stint {
  driver_number: number
  driver_code: string
  compound: string
  lap_start: number
  lap_end: number
  tyre_age_at_start: number
}

export interface CompareResponse {
  session_id: number
  drivers: Record<string, LapInfo>
  delta: Array<{
    dist_m: number
    [key: string]: number | null
  }>
  summary: {
    gap_seconds: number
    faster: string
  }
}

// ─── AI ─────────────────────────────────────────────────────────────────────

export type InsightMode = 'beginner' | 'expert'

export interface InterpretResponse {
  explanation: string
  mode: InsightMode
}

// ─── UI ─────────────────────────────────────────────────────────────────────

export type TelemetryChannel = 'speed' | 'throttle' | 'brake' | 'rpm'

export interface ChannelConfig {
  key: TelemetryChannel
  label: string
  unit: string
  color: string
  domain: [number, number]
}

export const CHANNELS: ChannelConfig[] = [
  { key: 'speed',    label: 'Hız',    unit: 'km/sa', color: '#E10600', domain: [0, 380] },
  { key: 'throttle', label: 'Gaz',    unit: '%',     color: '#00D2BE', domain: [0, 110] },
  { key: 'brake',    label: 'Fren',   unit: '%',     color: '#FF8700', domain: [0, 110] },
  { key: 'rpm',      label: 'RPM',    unit: '',      color: '#7B61FF', domain: [0, 15000] },
]

export const COMPOUND_COLORS: Record<string, string> = {
  SOFT:         '#FF3333',
  MEDIUM:       '#FFD700',
  HARD:         '#CCCCCC',
  INTERMEDIATE: '#39B54A',
  WET:          '#0067FF',
  UNKNOWN:      '#888888',
}
