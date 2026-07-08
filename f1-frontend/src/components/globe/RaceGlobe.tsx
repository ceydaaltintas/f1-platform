/**
 * F1 Yarış Takvimi Küresi
 * - D3 geoOrthographic ile interaktif 3D görünüm
 * - Sürükle = döndür, bırak = otomatik dönüş devam eder
 * - Tamamlanan → kırmızı, sıradaki → altın pulse, yaklaşan → beyaz
 * - Hover → yarış kartı (tarih, lokasyon, podyum)
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import * as d3 from 'd3'
// @ts-ignore
import { feature } from 'topojson-client'
import type { Round } from '../../types/f1'

// ── Devre koordinatları (lat, lng) ──────────────────────────────────────────
const CIRCUIT_COORDS: Record<string, [number, number]> = {
  'Australian Grand Prix':         [-37.85, 144.97],
  'Chinese Grand Prix':            [ 31.34, 121.22],
  'Japanese Grand Prix':           [ 34.84, 136.54],
  'Bahrain Grand Prix':            [ 26.03,  50.51],
  'Saudi Arabian Grand Prix':      [ 21.63,  39.10],
  'Miami Grand Prix':              [ 25.96, -80.24],
  'Canadian Grand Prix':           [ 45.50, -73.52],
  'Monaco Grand Prix':             [ 43.73,   7.42],
  'Spanish Grand Prix':            [ 40.45,  -3.73],
  'Barcelona Grand Prix':          [ 41.57,   2.26],
  'Austrian Grand Prix':           [ 47.22,  14.76],
  'British Grand Prix':            [ 52.08,  -1.02],
  'Belgian Grand Prix':            [ 50.44,   5.97],
  'Hungarian Grand Prix':          [ 47.58,  19.25],
  'Dutch Grand Prix':              [ 52.39,   4.54],
  'Italian Grand Prix':            [ 45.62,   9.28],
  'Azerbaijan Grand Prix':         [ 40.37,  49.85],
  'Singapore Grand Prix':          [  1.29, 103.86],
  'United States Grand Prix':      [ 30.13, -97.64],
  'Mexico City Grand Prix':        [ 19.40, -99.09],
  'São Paulo Grand Prix':          [-23.70, -46.70],
  'Las Vegas Grand Prix':          [ 36.17,-115.14],
  'Qatar Grand Prix':              [ 25.49,  51.45],
  'Abu Dhabi Grand Prix':          [ 24.47,  54.60],
}

function circuitCoords(name: string): [number, number] | null {
  // Tam eşleşme
  if (CIRCUIT_COORDS[name]) return CIRCUIT_COORDS[name]
  // Kısmi eşleşme
  const key = Object.keys(CIRCUIT_COORDS).find(k =>
    name.toLowerCase().includes(k.toLowerCase().split(' ')[0]) ||
    k.toLowerCase().includes(name.toLowerCase().split(' ')[0])
  )
  return key ? CIRCUIT_COORDS[key] : null
}

// ── Tip tanımları ────────────────────────────────────────────────────────────

interface CircuitMarker {
  name: string
  round_number: number
  race_date: string | null
  locality: string | null
  country: string | null
  round_status: 'completed' | 'upcoming'
  coords: [number, number]
  isNext: boolean
  podium?: string[]   // pilot kodları: ['RUS','ANT','LEC']
}

interface TooltipState {
  marker: CircuitMarker
  x: number
  y: number
}

interface Props {
  rounds: Round[]
  nextRoundNumber?: number
  raceResults?: Record<number, { p1: string; p2: string; p3: string }>
}

// ── Renk sabitleri ───────────────────────────────────────────────────────────
const COLOR = {
  completed: '#E10600',
  next:      '#FFD700',
  upcoming:  'rgba(200,220,255,0.75)',
  glow_completed: 'rgba(225,6,0,0.4)',
  glow_next:      'rgba(255,215,0,0.5)',
}

function formatDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })
}

function daysUntil(d: string | null): number | null {
  if (!d) return null
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86_400_000)
}

// ── Ana bileşen ──────────────────────────────────────────────────────────────

export function RaceGlobe({ rounds, nextRoundNumber, raceResults = {} }: Props) {
  const svgRef        = useRef<SVGSVGElement>(null)
  const rotationRef   = useRef<[number, number, number]>([-30, -25, 0])
  const isDragging    = useRef(false)
  const isPaused      = useRef(false)
  const dragMoved     = useRef(false)   // sürükleme mi, yoksa tıklama mı?
  const lastMouse     = useRef<[number, number]>([0, 0])
  const animRef       = useRef<number>(0)
  const projRef       = useRef<d3.GeoProjection | null>(null)
  const markersRef    = useRef<CircuitMarker[]>([])
  // SVG koordinatlarında marker pozisyonları → click tespiti için
  const markerPtsRef  = useRef<Array<{ marker: CircuitMarker; sx: number; sy: number }>>([])

  const [tooltip, setTooltip]     = useState<TooltipState | null>(null)
  const [paused, setPaused]       = useState(false)
  const [worldData, setWorldData] = useState<any>(null)
  const [size, setSize]           = useState({ w: 700, h: 480 })

  // Boyutu container'a göre ayarla
  const containerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver(([e]) => {
      const w = e.contentRect.width
      setSize({ w, h: Math.min(w * 0.78, 640) })
    })
    ro.observe(containerRef.current)
    setSize({ w: containerRef.current.offsetWidth, h: Math.min(containerRef.current.offsetWidth * 0.78, 640) })
    return () => ro.disconnect()
  }, [])

  // Dünya haritası verisini çek
  useEffect(() => {
    fetch('https://unpkg.com/world-atlas@2/countries-110m.json')
      .then(r => r.json())
      .then(data => setWorldData(data))
      .catch(() => {})
  }, [])

  // Marker listesi oluştur
  useEffect(() => {
    markersRef.current = rounds
      .map(r => {
        const coords = circuitCoords(r.name)
        if (!coords) return null
        const res = raceResults[r.round_number]
        return {
          name:         r.name,
          round_number: r.round_number,
          race_date:    r.race_date,
          locality:     r.locality,
          country:      r.country,
          round_status: r.round_status,
          coords,
          isNext:       r.round_number === nextRoundNumber,
          podium:       res ? [res.p1, res.p2, res.p3] : undefined,
        } as CircuitMarker
      })
      .filter(Boolean) as CircuitMarker[]
  }, [rounds, nextRoundNumber, raceResults])

  // Globe çizimi
  const draw = useCallback(() => {
    const svg = svgRef.current
    if (!svg || !worldData) return

    const { w, h } = size
    const r = Math.min(w, h) * 0.42

    // Projeksiyon
    const proj = d3.geoOrthographic()
      .scale(r)
      .translate([w / 2, h / 2])
      .clipAngle(90)
      .rotate(rotationRef.current)
    projRef.current = proj

    const path = d3.geoPath(proj)
    markerPtsRef.current = []  // Her frame'de sıfırla

    const s = d3.select(svg)
    s.selectAll('*').remove()
    s.attr('width', w).attr('height', h)

    // Defs — glow filtresi
    const defs = s.append('defs')
    const blur = defs.append('filter').attr('id','globe-glow')
      .attr('x','-30%').attr('y','-30%').attr('width','160%').attr('height','160%')
    blur.append('feGaussianBlur').attr('in','SourceGraphic').attr('stdDeviation','8').attr('result','blur')
    const bm = blur.append('feMerge')
    bm.append('feMergeNode').attr('in','blur')
    bm.append('feMergeNode').attr('in','SourceGraphic')

    // Okyanus arka planı
    s.append('circle')
      .attr('cx', w / 2).attr('cy', h / 2).attr('r', r + 2)
      .attr('fill', '#0a1628')

    // Atmosfer halesi
    const grad = defs.append('radialGradient').attr('id','atmos')
      .attr('cx','50%').attr('cy','50%').attr('r','50%')
    grad.append('stop').attr('offset','85%').attr('stop-color','transparent')
    grad.append('stop').attr('offset','100%').attr('stop-color','rgba(100,180,255,0.12)')
    s.append('circle')
      .attr('cx', w / 2).attr('cy', h / 2).attr('r', r + 14)
      .attr('fill','url(#atmos)')

    // Küre + ülkeler
    const countries = feature(worldData, worldData.objects.countries)
    s.append('g')
      .selectAll('path')
      .data((countries as any).features)
      .enter().append('path')
      .attr('d', (d: any) => path(d) ?? '')
      .attr('fill','#0f2040')
      .attr('stroke','#1a3560')
      .attr('stroke-width', 0.5)

    // Kıta sınırları (daha ince)
    const graticule = d3.geoGraticule().step([30, 30])
    s.append('path')
      .datum(graticule())
      .attr('d', path)
      .attr('fill','none')
      .attr('stroke','rgba(255,255,255,0.04)')
      .attr('stroke-width', 0.5)

    // Küre dış çizgisi
    s.append('circle')
      .attr('cx', w / 2).attr('cy', h / 2).attr('r', r)
      .attr('fill','none')
      .attr('stroke','rgba(100,160,255,0.2)')
      .attr('stroke-width', 1)

    // Markerlar
    markersRef.current.forEach(m => {
      const [lng, lat] = [m.coords[1], m.coords[0]]
      const pt = proj([lng, lat])
      if (!pt) return

      // Görünür tarafta mı?
      const visible = d3.geoDistance([lng, lat], [
        -(rotationRef.current[0]), -(rotationRef.current[1])
      ]) < Math.PI / 2

      if (!visible) return

      const color = m.isNext ? COLOR.next
        : m.round_status === 'completed' ? COLOR.completed
        : COLOR.upcoming

      const baseR = m.isNext ? 9 : m.round_status === 'completed' ? 7 : 5

      // Glow halkası
      if (m.isNext || m.round_status === 'completed') {
        s.append('circle')
          .attr('cx', pt[0]).attr('cy', pt[1])
          .attr('r', baseR + 7)
          .attr('fill', m.isNext ? COLOR.glow_next : COLOR.glow_completed)
          .attr('pointer-events', 'none')
      }

      // Marker screen konumunu kaydet (React onClick için)
      markerPtsRef.current.push({ marker: m, sx: pt[0], sy: pt[1] })

      // Ana nokta — sadece hover event'leri D3'te
      s.append('circle')
        .attr('cx', pt[0]).attr('cy', pt[1])
        .attr('r', baseR)
        .attr('fill', color)
        .attr('stroke', '#05080f').attr('stroke-width', 1.5)
        .attr('style', 'cursor:pointer')
        .on('mouseenter', (event: MouseEvent) => {
          setTooltip({ marker: m, x: event.clientX, y: event.clientY })
        })
        .on('mousemove', (event: MouseEvent) => {
          setTooltip(t => t ? { ...t, x: event.clientX, y: event.clientY } : null)
        })
        .on('mouseleave', () => {
          if (!isPaused.current) setTooltip(null)
        })

      // Tur numarası
      if (m.round_number <= 9 || m.round_status !== 'upcoming' || m.isNext) {
        s.append('text')
          .attr('x', pt[0]).attr('y', pt[1] + 4)
          .attr('text-anchor','middle')
          .attr('fill', m.round_status === 'completed' ? 'white' : '#05080f')
          .attr('font-size', '8px').attr('font-weight','bold')
          .attr('font-family','IBM Plex Mono,monospace')
          .attr('pointer-events','none')
          .text(m.round_number)
      }
    })
  }, [worldData, size])

  // Otomatik döndürme + mouse etkileşimi
  useEffect(() => {
    if (!worldData) return

    let lastTime = 0
    const AUTO_SPEED = 6 // derece/saniye

    const tick = (now: number) => {
      const dt = (now - lastTime) / 1000
      lastTime = now

      const paused = svgRef.current?.dataset.paused === '1'
      if (!isDragging.current && !paused) {
        rotationRef.current = [
          rotationRef.current[0] - AUTO_SPEED * dt,
          rotationRef.current[1],
          0,
        ]
      }
      draw()
      animRef.current = requestAnimationFrame(tick)
    }
    animRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animRef.current)
  }, [worldData, draw])

  // ── Ortak: koordinattan marker hit testi ─────────────────────────────────
  const hitTest = useCallback((clientX: number, clientY: number) => {
    const svg  = svgRef.current
    const rect = svg?.getBoundingClientRect()
    if (!rect) return null
    const scaleX = size.w / rect.width
    const scaleY = size.h / rect.height
    const cx = (clientX - rect.left) * scaleX
    const cy = (clientY - rect.top)  * scaleY
    const HIT = 26
    let hit: (typeof markerPtsRef.current)[0] | null = null
    let best = HIT
    for (const mp of markerPtsRef.current) {
      const d = Math.hypot(mp.sx - cx, mp.sy - cy)
      if (d < best) { best = d; hit = mp }
    }
    return hit
  }, [size.w, size.h])

  const tooltipRef = useRef<TooltipState | null>(null)
  tooltipRef.current = tooltip

  const handleTap = useCallback((clientX: number, clientY: number) => {
    const hit = hitTest(clientX, clientY)
    if (hit) {
      const alreadyPaused = svgRef.current?.dataset.paused === '1' &&
        tooltipRef.current?.marker.name === hit.marker.name
      if (alreadyPaused) {
        if (svgRef.current) svgRef.current.dataset.paused = '0'
        setPaused(false)
        setTooltip(null)
      } else {
        if (svgRef.current) svgRef.current.dataset.paused = '1'
        setPaused(true)
        setTooltip({ marker: hit.marker, x: clientX, y: clientY })
      }
    } else {
      if (svgRef.current) svgRef.current.dataset.paused = '0'
      setPaused(false)
      setTooltip(null)
    }
  }, [hitTest])

  // ── Mouse etkileşimi ──────────────────────────────────────────────────────
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    isDragging.current = true
    dragMoved.current  = false
    lastMouse.current  = [e.clientX, e.clientY]
  }, [])

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) return
    const dx = e.clientX - lastMouse.current[0]
    const dy = e.clientY - lastMouse.current[1]
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragMoved.current = true
    rotationRef.current = [
      rotationRef.current[0] + dx * 0.4,
      rotationRef.current[1] - dy * 0.4,
      0,
    ]
    lastMouse.current = [e.clientX, e.clientY]
  }, [])

  const onMouseUp = useCallback(() => {
    isDragging.current = false
  }, [])

  const handleTapRef = useRef(handleTap)
  handleTapRef.current = handleTap

  const onSvgClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (dragMoved.current) return
    handleTapRef.current(e.clientX, e.clientY)
  }, [])

  // ── Touch etkileşimi — containerRef üzerinde (her zaman var), passive:false
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        isDragging.current = false
        return
      }
      e.preventDefault()
      isDragging.current = true
      dragMoved.current  = false
      lastMouse.current  = [e.touches[0].clientX, e.touches[0].clientY]
    }

    const onTouchMove = (e: TouchEvent) => {
      if (!isDragging.current || e.touches.length !== 1) return
      e.preventDefault()
      const dx = e.touches[0].clientX - lastMouse.current[0]
      const dy = e.touches[0].clientY - lastMouse.current[1]
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragMoved.current = true
      rotationRef.current[0] += dx * 0.4
      rotationRef.current[1] -= dy * 0.4
      lastMouse.current = [e.touches[0].clientX, e.touches[0].clientY]
    }

    const onTouchEnd = (e: TouchEvent) => {
      isDragging.current = false
      if (!dragMoved.current && e.changedTouches.length === 1) {
        const t = e.changedTouches[0]
        handleTapRef.current(t.clientX, t.clientY)
      }
    }

    el.addEventListener('touchstart', onTouchStart, { passive: false })
    el.addEventListener('touchmove',  onTouchMove,  { passive: false })
    el.addEventListener('touchend',   onTouchEnd,   { passive: false })

    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove',  onTouchMove)
      el.removeEventListener('touchend',   onTouchEnd)
    }
  }, [])

  return (
    <div ref={containerRef} className="card overflow-hidden" style={{ position:'relative' }}>

      {/* Yükleniyor */}
      {!worldData && (
        <div className="flex items-center justify-center" style={{ height: 600 }}>
          <div className="text-center space-y-3">
            <div className="flex gap-1.5 justify-center">
              {[0,1,2].map(i => (
                <div key={i} className="w-2 h-2 rounded-full bg-[#E10600]"
                  style={{ animation:`bounce-dot 0.8s ${i*0.15}s infinite` }} />
              ))}
            </div>
            <p className="text-[12px] mono" style={{ color:'var(--t3)' }}>Küre yükleniyor...</p>
          </div>
        </div>
      )}
      {worldData && <>
        {/* Başlık + legend */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b"
          style={{ borderColor:'var(--b1)' }}>
          <p className="text-[11px] mono font-semibold tracking-widest" style={{ color:'var(--t3)' }}>
            2026 YARIŞ TAKVİMİ
          </p>
          <div className="flex items-center gap-3 text-[10px] mono">
            {[
              { color: COLOR.next,      label: 'Sıradaki', size: 10 },
              { color: COLOR.completed, label: 'Bitti',    size: 8  },
              { color: COLOR.upcoming,  label: 'Yaklaşıyor', size: 6 },
            ].map(({ color, label, size }) => (
              <span key={label} className="flex items-center gap-1">
                <span className="rounded-full inline-block shrink-0"
                  style={{ width: size, height: size, background: color }} />
                <span style={{ color: 'var(--t2)' }}>{label}</span>
              </span>
            ))}
          </div>
        </div>

        {/* Globe */}
        <div style={{ cursor: isDragging.current ? 'grabbing' : 'grab', touchAction: 'none' }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}>
          <svg ref={svgRef}
            style={{ display:'block', width:'100%', userSelect:'none', cursor: paused ? 'default' : 'grab' }}
            onClick={onSvgClick}
            onContextMenu={e => e.preventDefault()}
          />
        </div>

        <div className="flex items-center justify-between px-4 py-2 border-t"
          style={{ borderColor:'var(--b1)' }}>
          <p className="text-[10px] mono" style={{ color:'var(--t3)' }}>
            {paused
              ? '⏸ Durduruldu — tekrar tıkla veya sürükle'
              : '✦ Tıkla = durdur · Sürükle = döndür · İşarete gel = detay'}
          </p>
          {paused && (
            <span className="text-[10px] mono px-2 py-0.5 rounded"
              style={{ background:'rgba(255,215,0,0.1)', color:'#FFD700', border:'1px solid rgba(255,215,0,0.2)' }}>
              ⏸ Duraklatıldı
            </span>
          )}
        </div>

        {tooltip && createPortal(<GlobeTooltip {...tooltip} />, document.body)}
      </>}

      <style>{`
        @keyframes bounce-dot {
          0%,80%,100%{transform:translateY(0)}
          40%{transform:translateY(-6px)}
        }
      `}</style>
    </div>
  )
}

// ── Tooltip ──────────────────────────────────────────────────────────────────

function GlobeTooltip({ marker, x, y }: TooltipState) {
  const days  = daysUntil(marker.race_date)
  const color = marker.isNext ? COLOR.next
    : marker.round_status === 'completed' ? COLOR.completed
    : 'rgba(200,220,255,0.7)'

  // Ekran sağ/alt kenarından taşmasın
  const CARD_W   = 220
  const left     = x + 20 + CARD_W > window.innerWidth  ? x - CARD_W - 8 : x + 16
  const top      = Math.max(8, Math.min(y - 12, window.innerHeight - 260))

  return (
    <div
      style={{
        position: 'fixed',
        left,
        top,
        zIndex: 99999,
        pointerEvents: 'none',
        background: 'rgba(5,8,15,0.98)',
        border: `1px solid ${color}50`,
        borderRadius: 12,
        padding: '12px 16px',
        minWidth: CARD_W,
        maxWidth: 260,
        backdropFilter: 'blur(16px)',
        boxShadow: `0 16px 48px rgba(0,0,0,0.7), 0 0 0 1px ${color}15`,
        fontFamily: "'Inter', sans-serif",
      }}
    >
      {/* Tur no + yarış adı */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] mono font-bold px-1.5 py-0.5 rounded"
          style={{ background: color + '20', color }}>
          TUR {marker.round_number}
        </span>
        {marker.isNext && (
          <span className="text-[10px] mono font-bold" style={{ color: COLOR.next }}>
            ● SIRADAKI
          </span>
        )}
      </div>

      <p className="text-[14px] font-bold text-white leading-tight mb-1">
        {marker.name}
      </p>
      {marker.locality && (
        <p className="text-[11px] mb-2" style={{ color:'var(--t2)' }}>
          {marker.locality}, {marker.country}
        </p>
      )}

      {/* Tarih */}
      <p className="text-[11px] mono" style={{ color:'var(--t3)' }}>
        {formatDate(marker.race_date)}
      </p>

      {/* Geri sayım */}
      {days !== null && days > 0 && (
        <p className="text-[12px] mono font-bold mt-1" style={{ color: COLOR.next }}>
          {days} gün kaldı
        </p>
      )}

      {/* Podyum (tamamlanan yarışlar) */}
      {marker.round_status === 'completed' && marker.podium && marker.podium.some(Boolean) && (
        <div className="mt-3 pt-3 space-y-1.5" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          {(['🥇','🥈','🥉'] as const).map((medal, i) => {
            const p = marker.podium![i]
            if (!p || p === '—') return null
            // "RUS  George Russell" formatında gelebilir
            const parts  = p.split('  ')
            const code   = parts[0]?.trim()
            const name   = parts.slice(1).join(' ').trim()
            return (
              <div key={i} className="flex items-center gap-2">
                <span className="text-base leading-none shrink-0">{medal}</span>
                <div>
                  <span className="text-[13px] font-bold text-white">{code}</span>
                  {name && (
                    <span className="text-[11px] ml-1.5" style={{ color: 'rgba(240,244,255,0.5)' }}>
                      {name}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
