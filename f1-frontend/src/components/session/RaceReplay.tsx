import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { client } from '../../api/client'
import type { TrackPoint } from '../../types/f1'
import { useTranslation } from 'react-i18next'

const TEAM_COLOR: Record<string, string> = {
  VER:'#3671C6', NOR:'#FF8000', LEC:'#E8002D', HAM:'#27F4D2',
  RUS:'#27F4D2', PIA:'#FF8000', SAI:'#E8002D', ANT:'#27F4D2',
  ALO:'#358C75', STR:'#358C75', GAS:'#0093CC', OCO:'#0093CC',
  HUL:'#B6BABD', BOT:'#C92D4B', ALB:'#64C4FF', COL:'#64C4FF',
  LAW:'#6692FF', HAD:'#6692FF', LIN:'#6692FF', BEA:'#B6BABD',
  BOR:'#C92D4B',
}

type Pt = { x: number; y: number }

interface LapEntry {
  lap_number: number
  lap_duration: number
  date_start: string
}

interface DriverData { code: string; number: number; laps: LapEntry[] }

interface Props {
  sessionId: number
  trackPoints: TrackPoint[]
  sessionDrivers?: string[]
}

export function RaceReplay({ sessionId, trackPoints }: Props) {
  const { t } = useTranslation()
  const canvasRef   = useRef<HTMLCanvasElement>(null)
  const animRef     = useRef<number>(0)
  const progressRef = useRef(0)
  const speedRef    = useRef(1)

  const [playing, setPlaying]   = useState(false)
  const [progress, setProgress] = useState(0)
  const [speed, setSpeed]       = useState(1)

  useEffect(() => { speedRef.current = speed }, [speed])

  const lapsQuery = useQuery({
    queryKey: ['replay-laps', sessionId],
    queryFn:  () => client.get(`/sessions/${sessionId}/replay_laps`).then(r => r.data),
    staleTime: Infinity, retry: 1,
  })

  const pts: Pt[] = useMemo(
    () => (trackPoints.filter(p => p.x != null && p.y != null) as Pt[]),
    [trackPoints]
  )

  const drivers: DriverData[] = useMemo(
    () => lapsQuery.data?.drivers ?? [],
    [lapsQuery.data]
  )

  // Zaman aralığı
  const { tMin, tMax } = useMemo(() => {
    let mn = Infinity, mx = -Infinity
    for (const d of drivers)
      for (const l of d.laps) {
        const t = new Date(l.date_start).getTime()
        if (t < mn) mn = t
        const e = t + l.lap_duration * 1000
        if (e > mx) mx = e
      }
    return { tMin: mn === Infinity ? 0 : mn, tMax: mx === -Infinity ? 1 : mx }
  }, [drivers])

  // Pist kümülatif mesafe
  const cumDist = useMemo(() => {
    let d = 0; const arr = [0]
    for (let i = 1; i < pts.length; i++) {
      d += Math.hypot(pts[i].x - pts[i-1].x, pts[i].y - pts[i-1].y)
      arr.push(d)
    }
    return arr
  }, [pts])
  const totalDist = cumDist.at(-1) ?? 1

  // Canvas boyutu
  const [size, setSize] = useState({ w: 600, h: 340 })
  const boxRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => {
      const w = e.contentRect.width
      setSize({ w, h: Math.min(Math.round(w * 0.56), 360) })
    })
    if (boxRef.current) ro.observe(boxRef.current)
    return () => ro.disconnect()
  }, [])

  // Ölçek hesabı
  const scale = useMemo(() => {
    if (!pts.length) return null
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y)
    const minX = Math.min(...xs), maxX = Math.max(...xs)
    const minY = Math.min(...ys), maxY = Math.max(...ys)
    const PAD = 32
    const sf  = Math.min((size.w-PAD*2)/(maxX-minX||1), (size.h-PAD*2)/(maxY-minY||1))
    const ox  = (size.w - (maxX-minX)*sf) / 2
    const oy  = (size.h - (maxY-minY)*sf) / 2
    return {
      x: (v: number) => ox + (v - minX) * sf,
      y: (v: number) => size.h - (oy + (v - minY) * sf),
    }
  }, [pts, size])

  // Sürücünün o andaki pist üzerindeki konumu → {cx, cy}
  const carPos = useCallback((d: DriverData, nowMs: number) => {
    if (!scale || !pts.length) return null
    let lapProg = -1

    for (const lap of d.laps) {
      const s = new Date(lap.date_start).getTime()
      const e = s + lap.lap_duration * 1000
      if (nowMs >= s && nowMs <= e) {
        lapProg = (nowMs - s) / (e - s)
        break
      }
    }
    if (lapProg < 0) return null

    const target = lapProg * totalDist
    for (let i = 0; i < cumDist.length - 1; i++) {
      if (cumDist[i] <= target && cumDist[i+1] > target) {
        const t  = (target - cumDist[i]) / (cumDist[i+1] - cumDist[i])
        const px = pts[i].x + t * (pts[i+1].x - pts[i].x)
        const py = pts[i].y + t * (pts[i+1].y - pts[i].y)
        return { cx: scale.x(px), cy: scale.y(py) }
      }
    }
    const last = pts.at(-1)!
    return { cx: scale.x(last.x), cy: scale.y(last.y) }
  }, [pts, cumDist, totalDist, scale])

  // Tek draw fonksiyonu — pist + araçlar
  const draw = useCallback((prog: number) => {
    const canvas = canvasRef.current
    if (!canvas || !scale || !pts.length) return
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Pist zemin
    ctx.beginPath()
    for (let i = 0; i < pts.length; i++) {
      const x = scale.x(pts[i].x), y = scale.y(pts[i].y)
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.strokeStyle = '#0a1220'; ctx.lineWidth = 22; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    ctx.stroke()

    // Pist yüzeyi
    ctx.beginPath()
    for (let i = 0; i < pts.length; i++) {
      const x = scale.x(pts[i].x), y = scale.y(pts[i].y)
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.strokeStyle = '#1a2d48'; ctx.lineWidth = 14
    ctx.stroke()

    if (!drivers.length || tMin === 0) return

    const nowMs = tMin + prog * (tMax - tMin)

    for (const d of drivers) {
      const pos = carPos(d, nowMs)
      if (!pos) continue
      const color = TEAM_COLOR[d.code] ?? '#888888'

      // Halo
      ctx.beginPath()
      ctx.arc(pos.cx, pos.cy, 8, 0, Math.PI * 2)
      ctx.fillStyle = color + '30'
      ctx.fill()

      // Nokta
      ctx.beginPath()
      ctx.arc(pos.cx, pos.cy, 5, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.strokeStyle = '#05080f'; ctx.lineWidth = 1.5
      ctx.fill(); ctx.stroke()

      // Pilot kodu
      ctx.font = 'bold 7px IBM Plex Mono, monospace'
      ctx.textAlign = 'center'
      ctx.strokeStyle = '#05080f'; ctx.lineWidth = 3; ctx.lineJoin = 'round'
      ctx.strokeText(d.code, pos.cx, pos.cy - 10)
      ctx.fillStyle = color
      ctx.fillText(d.code, pos.cx, pos.cy - 10)
    }
  }, [pts, scale, drivers, tMin, tMax, carPos])

  // Canvas boyutu ayarla
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width  = size.w
    canvas.height = size.h
    draw(progressRef.current)
  }, [size, draw])

  // Progress değişince yeniden çiz
  useEffect(() => {
    if (!playing) draw(progressRef.current)
  }, [draw, playing])

  // Animasyon
  useEffect(() => {
    if (!playing) { cancelAnimationFrame(animRef.current); return }
    let last = performance.now()
    const duration = (tMax - tMin) / 1000 / speedRef.current

    const tick = (now: number) => {
      const dt = (now - last) / 1000; last = now
      progressRef.current = Math.min(1, progressRef.current + dt / duration)
      setProgress(progressRef.current)
      draw(progressRef.current)
      if (progressRef.current >= 1) { setPlaying(false); return }
      animRef.current = requestAnimationFrame(tick)
    }
    animRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animRef.current)
  }, [playing, draw, tMin, tMax])

  if (lapsQuery.isLoading) return (
    <div className="card p-5 text-center">
      <p className="text-[12px] mono animate-pulse" style={{ color:'var(--t3)' }}>{t('replay.loading')}</p>
    </div>
  )
  if (lapsQuery.isError || !drivers.length) return (
    <div className="card p-5 text-center">
      <p className="text-[13px] mono" style={{ color:'var(--t3)' }}>{t('replay.no_data')}</p>
    </div>
  )

  const elapsed    = (tMax - tMin) / 1000
  const currentSec = elapsed * progress
  const fmt = (s: number) => new Date(s * 1000).toISOString().substr(11, 8)

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b"
        style={{ borderColor:'var(--b1)' }}>
        <div className="flex items-center gap-3">
          <span className="text-xl">🎬</span>
          <div>
            <p className="text-[13px] font-bold text-white">{t('replay.title')}</p>
            <p className="text-[10px] mono mt-0.5" style={{ color:'var(--t3)' }}>
              {t('replay.subtitle', { n: drivers.length })}
            </p>
          </div>
        </div>
        <div className="flex gap-1.5">
          {[1, 2, 5, 20].map(s => (
            <button key={s} onClick={() => setSpeed(s)}
              className="px-2.5 py-1.5 rounded-lg text-[11px] mono font-bold transition-all"
              style={speed === s
                ? { background:'#E10600', color:'white' }
                : { background:'var(--s2)', color:'var(--t3)', border:'1px solid var(--b1)' }}>
              {s}x
            </button>
          ))}
        </div>
      </div>

      <div ref={boxRef} style={{ background:'var(--s1)' }}>
        <canvas ref={canvasRef} style={{ display:'block', width:'100%' }} />
      </div>

      <div className="px-5 py-3 border-t space-y-2.5" style={{ borderColor:'var(--b1)' }}>
        <input type="range" min={0} max={1000} value={Math.round(progress * 1000)}
          onChange={e => {
            const p = Number(e.target.value) / 1000
            progressRef.current = p
            setProgress(p)
            draw(p)
          }}
          className="w-full cursor-pointer" style={{ accentColor:'#E10600' }} />
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              if (progress >= 1) { progressRef.current = 0; setProgress(0) }
              setPlaying(p => !p)
            }}
            className="px-4 py-2 rounded-xl text-[13px] font-bold"
            style={{ background:'#E10600', color:'white', minWidth: 90 }}>
            {playing ? `⏸ ${t('replay.pause')}` : progress >= 1 ? `↺ ${t('replay.replay')}` : `▶ ${t('replay.play')}`}
          </button>
          <button
            onClick={() => { progressRef.current=0; setProgress(0); setPlaying(false); draw(0) }}
            className="px-3 py-2 rounded-xl text-[12px]"
            style={{ background:'var(--s2)', color:'var(--t3)', border:'1px solid var(--b1)' }}>
            ↺
          </button>
          <span className="text-[11px] mono ml-auto" style={{ color:'var(--t3)' }}>
            {fmt(currentSec)} / {fmt(elapsed)}
          </span>
        </div>
      </div>
    </div>
  )
}
