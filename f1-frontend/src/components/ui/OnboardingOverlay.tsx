import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

const STEPS = [
  {
    title: 'Telemetriyi görsel olarak keşfet',
    desc: 'Bir yarışı seç, pilotun o turdaki her pedal hareketini saniye saniye izle.',
    action: 'Yarışlara bak →',
    target: '/season/2026',
  },
  {
    title: 'AI sana anlatır',
    desc: 'Grafiğe tıkla — Claude AI o anı sade Türkçe veya teknik dille yorumlar.',
    action: 'Deneme analizi aç →',
    target: null,    // aynı sayfada göster
  },
  {
    title: 'Yarışı canlı takip et',
    desc: 'Araçların pist üzerindeki konumunu, aralıkları ve strateji tahminlerini gerçek zamanlı gör.',
    action: 'Başla →',
    target: '/',
  },
]

export function OnboardingOverlay() {
  const [step, setStep] = useState(0)
  const [visible, setVisible] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    const seen = localStorage.getItem('hotlap_onboarded')
    if (!seen) {
      setTimeout(() => setVisible(true), 800)
    }
  }, [])

  const dismiss = () => {
    localStorage.setItem('hotlap_onboarded', '1')
    setVisible(false)
  }

  const next = () => {
    const s = STEPS[step]
    if (step === STEPS.length - 1) {
      dismiss()
      if (s.target) navigate(s.target)
    } else {
      if (s.target) { dismiss(); navigate(s.target) }
      else setStep(step + 1)
    }
  }

  if (!visible) return null

  const current = STEPS[step]

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
      onClick={dismiss}
    >
      <div
        className="w-full max-w-md mx-4 mb-8 md:mb-0 bg-[#0d0d0d] border border-[#1a1a1a] rounded-2xl p-6"
        style={{ fontFamily: "'IBM Plex Mono', monospace" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Adım göstergesi */}
        <div className="flex gap-1.5 mb-6">
          {STEPS.map((_, i) => (
            <div key={i}
              className="h-0.5 flex-1 rounded-full transition-colors duration-300"
              style={{ background: i <= step ? '#E10600' : '#1a1a1a' }}
            />
          ))}
        </div>

        <p className="text-[10px] text-[#E10600]/60 tracking-widest mb-2">
          ADIM {step + 1}/{STEPS.length}
        </p>
        <h2 className="text-lg font-semibold text-white mb-3 leading-tight">
          {current.title}
        </h2>
        <p className="text-[13px] text-[#555] leading-relaxed mb-6">
          {current.desc}
        </p>

        <div className="flex justify-between items-center">
          <button onClick={dismiss} className="text-[11px] text-[#2a2a2a] hover:text-[#444] transition-colors">
            Atla
          </button>
          <button
            onClick={next}
            className="px-5 py-2 text-[11px] bg-[#E10600] text-white rounded-lg font-semibold tracking-wide hover:bg-[#c00500] transition-colors"
          >
            {current.action}
          </button>
        </div>
      </div>
    </div>
  )
}
