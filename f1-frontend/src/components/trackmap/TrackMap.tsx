import { useRef, useState, useMemo, useEffect } from 'react'
import type { TrackPoint, TelemetryPoint } from '../../types/f1'

interface DriverPos { ratio: number; code: string; color: string }
interface LivePos { x: number; y: number; code: string; color: string }

interface Props {
  points: TrackPoint[]
  driverPositions?: DriverPos[]
  livePositions?: LivePos[]
  speedTelemetry?: TelemetryPoint[]
  compareTelemetry?: TelemetryPoint[]
  primaryColor?: string
  compareColor?: string
  primaryLabel?: string
  compareLabel?: string
  showCorners?: boolean
  height?: number
}

type Pt = { x: number; y: number }
type VB = { x: number; y: number; w: number; h: number }

function clean(pts: TrackPoint[]): Pt[] {
  return pts.filter(p => p.x != null && p.y != null) as Pt[]
}

function toD(pts: Pt[]): string {
  if (!pts.length) return ''
  return pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ') + ' Z'
}

function ptAt(pts: Pt[], ratio: number): Pt {
  return pts[Math.min(Math.round(ratio * (pts.length - 1)), pts.length - 1)] ?? pts[0]
}

function bbox(pts: Pt[], pad = 40): VB {
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y)
  return {
    x: Math.min(...xs) - pad, y: Math.min(...ys) - pad,
    w: Math.max(...xs) - Math.min(...xs) + pad * 2,
    h: Math.max(...ys) - Math.min(...ys) + pad * 2,
  }
}

function detectCorners(pts: Pt[], max = 18): number[] {
  const out: number[] = []
  const gap = Math.max(5, Math.floor(pts.length / 22))
  let last = -gap
  for (let i = 4; i < pts.length - 4; i++) {
    const a1 = Math.atan2(pts[i].y - pts[i-4].y, pts[i].x - pts[i-4].x)
    const a2 = Math.atan2(pts[i+4].y - pts[i].y, pts[i+4].x - pts[i].x)
    let d = Math.abs(a2 - a1); if (d > Math.PI) d = 2 * Math.PI - d
    if (d > 0.42 && i - last > gap) { out.push(i); last = i }
    if (out.length >= max) break
  }
  return out
}

function speedAt(telem: TelemetryPoint[], ratio: number): number {
  if (!telem.length) return 0
  const maxD = telem[telem.length - 1].dist_m
  const target = ratio * maxD
  let best = telem[0]
  for (const pt of telem) {
    if (Math.abs(pt.dist_m - target) < Math.abs(best.dist_m - target)) best = pt
  }
  return best.speed ?? 0
}

function speedColor(spd: number): string {
  const t = Math.max(0, Math.min(1, (spd - 60) / 280))
  if (t < 0.33) {
    const s = t / 0.33
    return `rgb(${Math.round(s*50)},${Math.round(100+s*100)},${Math.round(255-s*200)})`
  } else if (t < 0.66) {
    const s = (t - 0.33) / 0.33
    return `rgb(${Math.round(50+s*200)},${Math.round(200+s*55)},${Math.round(55-s*55)})`
  } else {
    const s = (t - 0.66) / 0.34
    return `rgb(250,${Math.round(255-s*230)},0)`
  }
}

function useInterpolatedPositions(targets: LivePos[]): LivePos[] {
  const prevRef = useRef<Map<string, { x: number; y: number }>>(new Map())
  const currentRef = useRef<Map<string, { x: number; y: number }>>(new Map())
  const startTimeRef = useRef(0)
  const [rendered, setRendered] = useState<LivePos[]>([])
  const DURATION = 3500

  useEffect(() => {
    // Yeni hedef geldi — prev'i current'a, target'ı current'a kaydet
    prevRef.current = new Map(currentRef.current)
    const newCurrent = new Map<string, { x: number; y: number }>()
    for (const t of targets) {
      newCurrent.set(t.code, { x: t.x, y: t.y })
      if (!prevRef.current.has(t.code)) {
        prevRef.current.set(t.code, { x: t.x, y: t.y })
      }
    }
    currentRef.current = newCurrent
    startTimeRef.current = performance.now()
  }, [targets])

  useEffect(() => {
    let raf: number
    function tick() {
      const elapsed = performance.now() - startTimeRef.current
      const t = Math.min(1, elapsed / DURATION)
      const result: LivePos[] = targets.map(lp => {
        const prev = prevRef.current.get(lp.code) ?? lp
        const curr = currentRef.current.get(lp.code) ?? lp
        return {
          ...lp,
          x: prev.x + (curr.x - prev.x) * t,
          y: prev.y + (curr.y - prev.y) * t,
        }
      })
      setRendered(result)
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [targets])

  return rendered.length ? rendered : targets
}

export function TrackMap({
  points, driverPositions = [], livePositions = [],
  speedTelemetry, compareTelemetry,
  primaryColor = '#E10600', compareColor = '#FF8700',
  primaryLabel, compareLabel,
  showCorners = true,
  height = 460,
}: Props) {
  const interpolated = useInterpolatedPositions(livePositions)
  const svgRef = useRef<SVGSVGElement>(null)
  const initRef = useRef<VB>({ x: 0, y: 0, w: 1000, h: 1000 })
  // drag: vb'yi sürükle başındaki değerden hesapla — drift olmaz
  const dragRef = useRef<{ cx: number; cy: number; startVB: VB } | null>(null)

  const ptsA = useMemo(() => clean(points), [points])
  const [vb, setVb] = useState<VB>({ x: 0, y: 0, w: 1000, h: 1000 })

  // Veri gelince viewBox'ı ayarla
  useEffect(() => {
    if (!ptsA.length) return
    const init = bbox(ptsA)
    initRef.current = init
    setVb(init)
  }, [ptsA])

  const reset = () => setVb(initRef.current)

  const zoomIn = () => setVb(v => {
    const cx = v.x + v.w / 2, cy = v.y + v.h / 2
    const nw = v.w * 0.5, nh = v.h * 0.5
    return { x: cx - nw / 2, y: cy - nh / 2, w: nw, h: nh }
  })

  const zoomOut = () => setVb(v => {
    const init = initRef.current
    const cx = v.x + v.w / 2, cy = v.y + v.h / 2
    const nw = Math.min(v.w * 2, init.w * 3)
    const nh = Math.min(v.h * 2, init.h * 3)
    return { x: cx - nw / 2, y: cy - nh / 2, w: nw, h: nh }
  })

  /** Köşeye zoom: o noktanın etrafını göster */
  const zoomToCorner = (p: Pt) => {
    const margin = initRef.current.w / 5  // pist genişliğinin 1/5'i kadar alan
    setVb({ x: p.x - margin, y: p.y - margin, w: margin * 2, h: margin * 2 })
  }

  // Sürükle: fare hareketiyle viewBox kaydır
  const onMouseDown = (e: React.MouseEvent) => {
    dragRef.current = { cx: e.clientX, cy: e.clientY, startVB: vb }
  }
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragRef.current || !svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const dx = (e.clientX - dragRef.current.cx) / rect.width  * dragRef.current.startVB.w
    const dy = (e.clientY - dragRef.current.cy) / rect.height * dragRef.current.startVB.h
    setVb({ ...dragRef.current.startVB, x: dragRef.current.startVB.x - dx, y: dragRef.current.startVB.y - dy })
  }
  const onMouseUp = () => { dragRef.current = null }

  // Renkli segmentler
  const segments = useMemo(() => {
    if (!ptsA.length) return []
    const hasCompare = !!(compareTelemetry?.length && speedTelemetry?.length)
    const hasSingle  = !!speedTelemetry?.length
    if (!hasSingle) return []

    return ptsA.slice(0, -1).map((pt, i) => {
      const next  = ptsA[i + 1]
      const ratio = i / (ptsA.length - 1)
      let color: string
      if (hasCompare) {
        const sA = speedAt(speedTelemetry!, ratio)
        const sB = speedAt(compareTelemetry!, ratio)
        const diff = sA - sB
        color = Math.abs(diff) < 5 ? 'rgba(130,145,165,0.55)' : diff > 0 ? primaryColor : compareColor
      } else {
        color = speedColor(speedAt(speedTelemetry!, ratio))
      }
      return { x1: pt.x, y1: pt.y, x2: next.x, y2: next.y, color }
    })
  }, [ptsA, speedTelemetry, compareTelemetry, primaryColor, compareColor])

  const dA      = useMemo(() => toD(ptsA), [ptsA])
  const corners = useMemo(
    () => showCorners && ptsA.length > 20 ? detectCorners(ptsA) : [],
    [ptsA, showCorners]
  )

  const hasSegments = segments.length > 0
  const hasCompare  = !!(compareTelemetry?.length && speedTelemetry?.length)
  const zoomLevel   = initRef.current.w / (vb.w || 1)

  if (!ptsA.length) {
    return (
      <div className="flex items-center justify-center" style={{ height }}>
        <p className="text-[12px] mono" style={{ color: 'var(--t3)' }}>Pist verisi yükleniyor...</p>
      </div>
    )
  }

  const sf = ptsA[0]

  return (
    <div style={{ userSelect: 'none' }}>

      {/* ── Üst çubuk ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b flex-wrap gap-2"
        style={{ borderColor: 'var(--b1)' }}>

        {/* Legend */}
        <div className="flex items-center gap-4 flex-wrap text-[11px] mono">
          {hasCompare ? (
            <>
              <span className="flex items-center gap-1.5">
                <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: primaryColor }} />
                <b style={{ color: primaryColor }}>{primaryLabel}</b> daha hızlı
              </span>
              <span className="flex items-center gap-1.5">
                <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: compareColor }} />
                <b style={{ color: compareColor }}>{compareLabel}</b> daha hızlı
              </span>
              <span className="flex items-center gap-1.5" style={{ color: 'var(--t3)' }}>
                <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: 'rgba(130,145,165,0.55)' }} />
                Eşit
              </span>
            </>
          ) : hasSegments ? (
            <span className="flex items-center gap-2" style={{ color: 'var(--t2)' }}>
              <span>Yavaş</span>
              <span style={{ display: 'inline-block', width: 72, height: 8, borderRadius: 4,
                background: 'linear-gradient(to right,#0064ff,#00c832,#ffee00,#ff2000)' }} />
              <span>Hızlı</span>
              {primaryLabel && <b style={{ color: primaryColor, marginLeft: 4 }}>· {primaryLabel}</b>}
            </span>
          ) : (
            <span style={{ color: 'var(--t3)' }}>Grafiğe tıklayınca konum gösterilir</span>
          )}
        </div>

        {/* Zoom butonları */}
        <div className="flex items-center gap-2">
          {zoomLevel > 1.2 && (
            <span className="text-[11px] mono font-bold px-2 py-0.5 rounded"
              style={{ background: 'rgba(225,6,0,0.12)', color: '#E10600' }}>
              {zoomLevel.toFixed(1)}×
            </span>
          )}
          {([['−', zoomOut], ['+', zoomIn]] as const).map(([lbl, fn]) => (
            <button key={lbl} onClick={fn}
              style={{ width: 32, height: 32, borderRadius: 8, fontSize: 18, fontWeight: 'bold',
                       cursor: 'pointer', background: 'var(--s2)', color: 'white',
                       border: '1px solid var(--b2)' }}>
              {lbl}
            </button>
          ))}
          <button onClick={reset}
            style={{ padding: '4px 10px', borderRadius: 8, fontSize: 11, cursor: 'pointer',
                     background: 'var(--s2)', color: 'var(--t2)', border: '1px solid var(--b1)' }}>
            ↺
          </button>
        </div>
      </div>

      {/* Viraj butonları */}
      {corners.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-4 py-2 border-b"
          style={{ borderColor: 'var(--b1)' }}>
          <span className="text-[10px] mono self-center mr-1" style={{ color: 'var(--t3)' }}>Köşe:</span>
          {corners.map((idx, n) => (
            <button key={n}
              onClick={() => zoomToCorner(ptsA[idx])}
              style={{ width: 26, height: 26, borderRadius: '50%', fontSize: 10, fontWeight: 'bold',
                       cursor: 'pointer', background: 'rgba(255,200,0,0.1)',
                       color: 'rgba(255,215,0,0.85)', border: '1.5px solid rgba(255,200,0,0.35)' }}>
              {n + 1}
            </button>
          ))}
          {zoomLevel > 1.2 && (
            <button onClick={reset}
              style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, marginLeft: 4,
                       cursor: 'pointer', background: 'rgba(255,255,255,0.05)',
                       color: 'var(--t3)', border: '1px solid var(--b1)' }}>
              Tüm pist
            </button>
          )}
        </div>
      )}

      {/* ── SVG ─────────────────────────────────────────────────────── */}
      <svg
        ref={svgRef}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        style={{ width: '100%', height, display: 'block', cursor: dragRef.current ? 'grabbing' : 'grab' }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      >
        {/* Zemin */}
        <path d={dA} fill="none" stroke="#080f1d" strokeWidth={30}
          strokeLinecap="round" strokeLinejoin="round" />
        {/* Asfalt */}
        <path d={dA} fill="none" stroke="#1a2d48" strokeWidth={20}
          strokeLinecap="round" strokeLinejoin="round" />
        {/* Kenarlık */}
        <path d={dA} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={21}
          strokeLinejoin="round" strokeDasharray="2 19" />

        {/* Hız / delta segmentleri */}
        {hasSegments
          ? segments.map((s, i) => (
              <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2}
                stroke={s.color} strokeWidth={6} strokeLinecap="round" />
            ))
          : (
              <path d={dA} fill="none" stroke={primaryColor} strokeWidth={4}
                strokeLinecap="round" strokeLinejoin="round" />
            )
        }

        {/* S/F */}
        <circle cx={sf.x} cy={sf.y} r={12} fill={primaryColor} stroke="#05080f" strokeWidth={3} />
        <text x={sf.x} y={sf.y - 18} textAnchor="middle" fontSize={18} fontWeight="bold"
          fontFamily="IBM Plex Mono,monospace" fill="rgba(225,6,0,0.9)">S/F</text>

        {/* Viraj numaraları — stopPropagation ile drag'ı engelle */}
        {corners.map((idx, n) => {
          const p = ptsA[idx]
          return (
            <g key={idx} style={{ cursor: 'pointer' }}
              onMouseDown={e => e.stopPropagation()}
              onClick={() => zoomToCorner(p)}>
              <circle cx={p.x} cy={p.y} r={16}
                fill="rgba(16,24,40,0.85)" stroke="rgba(255,200,0,0.5)" strokeWidth={2} />
              <text x={p.x} y={p.y + 5.5} textAnchor="middle" fontSize={14} fontWeight="bold"
                fontFamily="IBM Plex Mono,monospace" fill="rgba(255,215,0,0.95)">{n + 1}</text>
            </g>
          )
        })}

        {/* Canlı GPS konumları */}
        {interpolated.map(lp => (
          <g key={`live-${lp.code}`} transform={`translate(${lp.x},${lp.y})`}>
            <circle cx={0} cy={0} r={20} fill={lp.color + '12'} stroke={lp.color + '30'} strokeWidth={2}>
              <animate attributeName="r" values="16;24;16" dur="1.5s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.7;0;0.7" dur="1.5s" repeatCount="indefinite" />
            </circle>
            <circle cx={0} cy={0} r={10} fill={lp.color} stroke="#05080f" strokeWidth={3} />
            <text x={0} y={-17} textAnchor="middle" fontSize={13} fontWeight="bold"
              fontFamily="IBM Plex Mono,monospace" fill={lp.color}
              stroke="#05080f" strokeWidth={4} paintOrder="stroke">{lp.code}</text>
          </g>
        ))}

        {/* Pilot konumu */}
        {driverPositions.map(dp => {
          const p = ptAt(ptsA, dp.ratio)
          return (
            <g key={dp.code}>
              <circle cx={p.x} cy={p.y} r={28} fill={dp.color + '12'} stroke={dp.color + '30'} strokeWidth={2}>
                <animate attributeName="r" values="22;32;22" dur="1.5s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.7;0;0.7" dur="1.5s" repeatCount="indefinite" />
              </circle>
              <circle cx={p.x} cy={p.y} r={14} fill={dp.color} stroke="#05080f" strokeWidth={4} />
              <text x={p.x} y={p.y - 24} textAnchor="middle" fontSize={18} fontWeight="bold"
                fontFamily="IBM Plex Mono,monospace" fill={dp.color}
                stroke="#05080f" strokeWidth={5} paintOrder="stroke">{dp.code}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
