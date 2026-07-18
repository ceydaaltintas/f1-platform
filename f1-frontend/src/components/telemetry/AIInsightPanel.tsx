import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { aiApi } from '../../api/client'
import type { InsightMode, TelemetryPoint } from '../../types/f1'

interface Props {
  selectedPoint: TelemetryPoint | null
  mode: InsightMode
  driverCode: string
  // Karşılaştırma modu
  comparePoint?: TelemetryPoint | null
  compareDriver?: string
}

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; text: string; source?: string; isCompare?: boolean }
  | { kind: 'error'; msg: string }

function pointToSnap(pt: TelemetryPoint) {
  return {
    speed: pt.speed,
    throttle: pt.throttle,
    brake: pt.brake,
    gear: pt.gear,
    drs: pt.drs,
    rpm: pt.rpm,
    dist_m: pt.dist_m,
  }
}

export function AIInsightPanel({
  selectedPoint, mode, driverCode,
  comparePoint, compareDriver,
}: Props) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language?.startsWith('tr') ? 'tr' : 'en'
  const [state, setState] = useState<State>({ kind: 'idle' })
  const isCompareMode = !!(comparePoint && compareDriver)

  // Nesne referansı yerine değer bazlı key — sonsuz döngüyü önler
  const pointKey = selectedPoint
    ? `${selectedPoint.dist_m}_${selectedPoint.speed}_${selectedPoint.brake}`
    : null
  const compareKey = comparePoint
    ? `${comparePoint.dist_m}_${comparePoint.speed}_${comparePoint.brake}`
    : null

  useEffect(() => {
    if (!selectedPoint) { setState({ kind: 'idle' }); return }
    let cancelled = false
    setState({ kind: 'loading' })

    const snapA = pointToSnap(selectedPoint)
    const inCompare = !!(comparePoint && compareDriver)

    const payload = inCompare && comparePoint
      ? {
          ...snapA,
          mode,
          driver_a: driverCode,
          driver_b: compareDriver,
          snapshot_b: pointToSnap(comparePoint),
        }
      : { ...snapA, mode, driver_a: driverCode }

    aiApi.interpret(payload, mode, lang)
      .then(r => {
        if (!cancelled) setState({
          kind: 'ok',
          text: r.explanation,
          source: r.source,
          isCompare: inCompare,
        })
      })
      .catch(() => {
        if (!cancelled) setState({ kind: 'error', msg: 'Sunucu yanıt vermedi.' })
      })

    return () => { cancelled = true }
  // Nesne referansı yerine primitive key'ler kullanıyoruz
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointKey, compareKey, mode, driverCode, compareDriver])

  const sourceLabel = (source?: string) => {
    if (source === 'groq')      return '⚡ Groq · Llama 3.3'
    if (source === 'anthropic') return '🤖 Claude'
    return '📐 Kural tabanlı'
  }

  return (
    <div className="card flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b"
        style={{ borderColor: 'var(--b1)' }}>
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg,#E10600,#cc0000)' }}>
            <span className="text-white text-xs font-black">AI</span>
          </div>
          <div>
            <p className="text-[13px] font-bold text-white leading-none">
              {isCompareMode
                ? `${driverCode} vs ${compareDriver}`
                : t('ai.title')}
            </p>
            <p className="text-[10px] mono mt-0.5" style={{ color: 'var(--t3)' }}>
              {state.kind === 'ok'
                ? sourceLabel(state.source)
                : isCompareMode
                  ? (lang === 'en' ? 'Same point comparison' : 'Aynı noktada karşılaştırma')
                  : mode === 'beginner' ? t('ai.mode_beginner') : t('ai.mode_expert')}
            </p>
          </div>
          {state.kind === 'loading' && (
            <div className="flex gap-1 ml-1">
              {[0, 1, 2].map(i => (
                <div key={i} className="w-1.5 h-1.5 rounded-full bg-[#E10600]"
                  style={{ animation: `bounce-dot 0.8s ${i * 0.15}s ease-in-out infinite` }} />
              ))}
            </div>
          )}
        </div>

        {/* Mod rozeti */}
        {!isCompareMode && (
          <span className="text-[10px] mono font-semibold px-2 py-0.5 rounded-full"
            style={mode === 'beginner'
              ? { background: 'rgba(0,210,190,0.1)', color: '#00D2BE', border: '1px solid rgba(0,210,190,0.2)' }
              : { background: 'rgba(255,135,0,0.1)', color: '#FF8700', border: '1px solid rgba(255,135,0,0.2)' }}>
            {mode === 'beginner' ? `🟢 ${t('ai.beginner')}` : `⚡ ${t('ai.expert')}`}
          </span>
        )}

        {/* Karşılaştırma rozeti */}
        {isCompareMode && (
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-black mono px-2 py-0.5 rounded"
              style={{ background: 'rgba(225,6,0,0.15)', color: '#E10600' }}>
              {driverCode}
            </span>
            <span style={{ color: 'var(--t3)' }}>vs</span>
            <span className="text-[11px] font-black mono px-2 py-0.5 rounded"
              style={{ background: 'rgba(255,135,0,0.15)', color: '#FF8700' }}>
              {compareDriver}
            </span>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 p-5 overflow-y-auto" style={{ maxHeight: 420 }}>

        {/* Karşılaştırma modu — veri kartları */}
        {isCompareMode && selectedPoint && comparePoint && state.kind !== 'loading' && (
          <div className="grid grid-cols-2 gap-2 mb-4">
            {[
              { label: driverCode, pt: selectedPoint, color: '#E10600' },
              { label: compareDriver!, pt: comparePoint, color: '#FF8700' },
            ].map(({ label, pt, color }) => (
              <div key={label} className="rounded-xl p-3 space-y-1.5"
                style={{ background: color + '0a', border: `1px solid ${color}25` }}>
                <p className="text-[11px] font-black mono" style={{ color }}>{label}</p>
                <div className="grid grid-cols-2 gap-1">
                  {[
                    { k: 'Hız', v: pt.speed != null ? `${pt.speed} km/sa` : '—' },
                    { k: 'Gaz', v: pt.throttle != null ? `%${pt.throttle}` : '—' },
                    { k: 'Fren', v: pt.brake != null ? `%${pt.brake}` : '—' },
                    { k: 'Vites', v: pt.gear != null ? `${pt.gear}` : '—' },
                  ].map(({ k, v }) => (
                    <div key={k}>
                      <p className="text-[9px] mono" style={{ color: 'var(--t3)' }}>{k}</p>
                      <p className="text-[12px] font-bold mono text-white">{v}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Boş durum */}
        {state.kind === 'idle' && (
          <div className="flex flex-col items-center justify-center h-24 gap-2 text-center">
            <span className="text-2xl opacity-40">
              {isCompareMode ? '⚖️' : '☝️'}
            </span>
            <p className="text-[12px] leading-relaxed" style={{ color: 'var(--t2)' }}>
              {isCompareMode
                ? `Grafiğe tıkla — ${driverCode} ve ${compareDriver}'ın aynı noktada farkını göster`
                : 'Grafiğe tıkla — Claude o anı analiz eder'}
            </p>
          </div>
        )}

        {/* Yükleniyor */}
        {state.kind === 'loading' && (
          <div className="space-y-2 animate-fade-in">
            <p className="text-[12px] mono" style={{ color: 'var(--t2)' }}>
              {isCompareMode
                ? `${driverCode} vs ${compareDriver} karşılaştırılıyor...`
                : `${driverCode} analiz ediliyor...`}
            </p>
            {[100, 75, 88].map((w, i) => (
              <div key={i} className="h-2.5 rounded-full animate-pulse"
                style={{ width: `${w}%`, background: 'rgba(225,6,0,0.12)' }} />
            ))}
          </div>
        )}

        {/* Yorum */}
        {state.kind === 'ok' && (
          <p className="text-[13px] leading-relaxed pl-3 border-l-2 animate-fade-up"
            style={{
              color: 'rgba(240,244,255,0.85)',
              borderColor: state.isCompare ? '#FF8700' : '#E10600',
            }}>
            {state.text}
          </p>
        )}

        {/* Hata */}
        {state.kind === 'error' && (
          <div className="p-4 rounded-xl"
            style={{ background: 'rgba(225,6,0,0.08)', border: '1px solid rgba(225,6,0,0.2)' }}>
            <p className="text-[13px]" style={{ color: '#f87171' }}>⚠ {state.msg}</p>
          </div>
        )}
      </div>

      <style>{`
        @keyframes bounce-dot {
          0%,80%,100% { transform:translateY(0) }
          40%         { transform:translateY(-5px) }
        }
      `}</style>
    </div>
  )
}
