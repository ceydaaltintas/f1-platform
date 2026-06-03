/**
 * Saniyeyi F1 formatına çevirir: M:SS.XXXX
 * Örnek: 82.0913 → "1:22.0913"
 */
export function formatLapTime(seconds: number | null | undefined): string {
  if (seconds == null || isNaN(seconds)) return '—'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  const ms4  = Math.round((seconds % 1) * 10_000)
  return `${mins}:${String(secs).padStart(2, '0')}.${String(ms4).padStart(4, '0')}`
}

/**
 * Saniyeyi kısa formata çevirir: SS.XXX (dakika yoksa)
 * Örnek: 28.823 → "28.823"  |  62.1 → "1:02.100"
 */
export function formatSectorTime(seconds: number | null | undefined): string {
  if (seconds == null || isNaN(seconds)) return '—'
  if (seconds < 60) {
    const secs = Math.floor(seconds)
    const ms3  = Math.round((seconds % 1) * 1000)
    return `${secs}.${String(ms3).padStart(3, '0')}`
  }
  return formatLapTime(seconds)
}

/**
 * Canlı yarış gap formatı (4 hane salise):
 * 1.2345  → "+1.2345"
 * 75.1234 → "+1:15.1234"
 * 0       → "LDR"
 * "+2 LAPS" / "+1 LAP" → olduğu gibi
 */
export function formatGap(gap: number | string | null | undefined, isLeader = false): string {
  if (isLeader) return 'LDR'
  if (gap == null) return '—'

  const s = String(gap)
  // Laplı araç — olduğu gibi göster
  if (s.toUpperCase().includes('LAP')) return s

  const num = typeof gap === 'number' ? gap : parseFloat(s.replace('+', ''))
  if (isNaN(num)) return s
  if (num === 0) return 'LDR'

  const abs  = Math.abs(num)
  const sign = num < 0 ? '-' : '+'

  if (abs < 60) {
    const secs = Math.floor(abs)
    const ms4  = Math.round((abs % 1) * 10_000)
    return `${sign}${secs}.${String(ms4).padStart(4, '0')}`
  }
  // 1 dakika üzeri
  const mins = Math.floor(abs / 60)
  const secs = Math.floor(abs % 60)
  const ms4  = Math.round((abs % 1) * 10_000)
  return `${sign}${mins}:${String(secs).padStart(2,'0')}.${String(ms4).padStart(4,'0')}`
}
