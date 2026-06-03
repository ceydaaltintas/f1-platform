import { useCallback } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { CHANNELS, type TelemetryChannel, type TelemetryPoint } from '../../types/f1'

interface Props {
  data: TelemetryPoint[]
  activeChannel: TelemetryChannel
  selectedPoint: TelemetryPoint | null
  onPointClick: (pt: TelemetryPoint) => void
  height?: number
  // İsteğe bağlı: ikinci pilotun verisi (karşılaştırma modu)
  compareData?: TelemetryPoint[]
  compareColor?: string
}

const BRAKE_ZONES_SAMPLE = [
  // Gerçek veriden dinamik olarak üretilmeli; bu örnek Monaco benzeri
]

export function TelemetryChart({
  data,
  activeChannel,
  selectedPoint,
  onPointClick,
  height = 200,
  compareData,
  compareColor = '#FF8700',
}: Props) {
  const ch = CHANNELS.find((c) => c.key === activeChannel)!

  // İki veri setini mesafe ekseninde birleştir
  const merged = data.map((pt, i) => ({
    ...pt,
    compare_val: compareData?.[i]?.[activeChannel] ?? null,
  }))

  const handleClick = useCallback(
    (payload: any) => {
      const pt = payload?.activePayload?.[0]?.payload as TelemetryPoint | undefined
      if (pt) onPointClick(pt)
    },
    [onPointClick]
  )

  return (
    <div className="card pt-4 pb-2 px-2">
      <p className="text-[12px] mono font-semibold tracking-[0.15em] pl-3 mb-3"
        style={{ color: 'var(--t2)' }}>
        {ch.label.toUpperCase()} {ch.unit ? `(${ch.unit})` : ''} · Tıkla → AI yorum al
      </p>

      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={merged} onClick={handleClick} style={{ cursor: 'crosshair' }}>
          <CartesianGrid strokeDasharray="3 8" stroke="rgba(255,255,255,0.04)" vertical={false} />

          {/* Fren bölgelerini vurgula */}
          {merged
            .reduce<{ start: number; end: number }[]>((acc, pt, i) => {
              const brake = (pt.brake ?? 0) > 40
              if (brake && (i === 0 || !((merged[i - 1].brake ?? 0) > 40))) {
                acc.push({ start: pt.dist_m, end: pt.dist_m })
              } else if (brake && acc.length > 0) {
                acc[acc.length - 1].end = pt.dist_m
              }
              return acc
            }, [])
            .map((zone, i) => (
              <ReferenceArea
                key={i}
                x1={zone.start}
                x2={zone.end}
                fill="#FF870010"
                stroke="#FF870022"
                strokeWidth={0.5}
              />
            ))}

          {/* Seçili nokta dikey çizgisi */}
          {selectedPoint && (
            <ReferenceLine
              x={selectedPoint.dist_m}
              stroke="#ffffff18"
              strokeDasharray="3 3"
              strokeWidth={1}
            />
          )}

          <XAxis
            dataKey="dist_m"
            tick={{ fill: 'rgba(240,244,255,0.55)', fontSize: 11, fontFamily: 'IBM Plex Mono,monospace' }}
            tickLine={false}
            axisLine={{ stroke: 'rgba(255,255,255,0.10)' }}
            tickFormatter={(v) => `${Math.round(v)}m`}
          />
          <YAxis
            domain={ch.domain}
            tick={{ fill: 'rgba(240,244,255,0.55)', fontSize: 11, fontFamily: 'IBM Plex Mono,monospace' }}
            tickLine={false}
            axisLine={false}
            width={42}
          />

          <Tooltip
            contentStyle={{
              background: 'rgba(9,14,28,0.97)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 12,
              fontSize: 12,
              fontFamily: 'IBM Plex Mono,monospace',
              backdropFilter: 'blur(12px)',
            }}
            labelStyle={{ color: 'rgba(240,244,255,0.65)', marginBottom: 6, fontSize: 12 }}
            labelFormatter={(v) => `📍 ${Math.round(Number(v))} m`}
            formatter={(v: any, name: string) => [
              `${v} ${ch.unit}`,
              name === activeChannel ? ch.label : 'Karşılaştırma',
            ]}
          />

          {/* Ana pilot */}
          <Line
            type="monotone"
            dataKey={activeChannel}
            stroke={ch.color}
            strokeWidth={1.5}
            dot={false}
            activeDot={{ r: 3, fill: ch.color, stroke: '#080808', strokeWidth: 2 }}
          />

          {/* Karşılaştırma pilotu */}
          {compareData && (
            <Line
              type="monotone"
              dataKey="compare_val"
              stroke={compareColor}
              strokeWidth={1.5}
              dot={false}
              strokeDasharray="4 2"
              activeDot={{ r: 3, fill: compareColor }}
            />
          )}
        </LineChart>
      </ResponsiveContainer>

      <div className="flex gap-5 pl-3 pb-1 mt-2">
        <span className="text-[11px] mono" style={{ color:'rgba(255,135,0,0.6)' }}>
          ▓ Fren bölgesi
        </span>
        {compareData && (
          <span className="text-[11px] mono" style={{ color: compareColor + '99' }}>
            ── Karşılaştırma
          </span>
        )}
      </div>
    </div>
  )
}
