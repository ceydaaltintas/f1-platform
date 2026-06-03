import { useEffect, useRef, useState } from 'react'
import type { RadioRecording } from '../../store/wsStore'

interface Driver {
  code: string
  color: string
}

interface Props {
  recordings: RadioRecording[]
  drivers: Record<number, Driver>
  onClear: () => void
}

function timeAgo(isoStr: string): string {
  const diff = (Date.now() - new Date(isoStr).getTime()) / 1000
  if (diff < 60) return `${Math.round(diff)}sn önce`
  return `${Math.round(diff / 60)}dk önce`
}

export function RadioPanel({ recordings, drivers, onClear }: Props) {
  const [playing, setPlaying] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const play = (url: string) => {
    if (audioRef.current) {
      audioRef.current.pause()
    }
    const audio = new Audio(url)
    audioRef.current = audio
    audio.play().catch(() => {})
    setPlaying(url)
    audio.onended = () => setPlaying(null)
  }

  useEffect(() => {
    return () => {
      audioRef.current?.pause()
    }
  }, [])

  return (
    <div className="bg-[#0d0d0d] border border-[#1a1a1a] rounded-lg p-4">
      <div className="flex justify-between items-center mb-3">
        <p className="text-[10px] text-[#222] tracking-widest">TAKIM RADYOSU</p>
        {recordings.length > 0 && (
          <button
            onClick={onClear}
            className="text-[9px] text-[#333] hover:text-[#555] transition-colors"
          >
            Temizle
          </button>
        )}
      </div>

      {recordings.length === 0 ? (
        <p className="text-[#1a1a1a] text-xs italic">Radyo mesajı bekleniyor...</p>
      ) : (
        <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
          {recordings.map((rec, i) => {
            const drv = drivers[rec.driver_number]
            const isPlaying = playing === rec.recording_url

            return (
              <div
                key={i}
                className="flex items-center gap-2 group cursor-pointer rounded px-2 py-1.5 transition-colors"
                style={{
                  background: isPlaying ? '#1a1a1a' : 'transparent',
                }}
                onClick={() => play(rec.recording_url)}
              >
                {/* Oynat butonu */}
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 transition-colors"
                  style={{
                    background: isPlaying
                      ? (drv?.color ?? '#E10600') + '33'
                      : '#151515',
                    border: `1px solid ${(drv?.color ?? '#E10600')}44`,
                  }}
                >
                  <span
                    className="text-[8px]"
                    style={{ color: drv?.color ?? '#E10600' }}
                  >
                    {isPlaying ? '■' : '▶'}
                  </span>
                </div>

                {/* Pilot ve zaman */}
                <div className="flex-1 min-w-0">
                  <span
                    className="text-[11px] font-semibold font-mono"
                    style={{ color: drv?.color ?? '#888' }}
                  >
                    {drv?.code ?? `#${rec.driver_number}`}
                  </span>
                  <span className="text-[9px] text-[#333] ml-2">
                    {timeAgo(rec.date)}
                  </span>
                </div>

                {/* Ses dalgası animasyonu (oynatılırken) */}
                {isPlaying && (
                  <div className="flex items-center gap-0.5">
                    {[1, 2, 3, 4].map((b) => (
                      <div
                        key={b}
                        className="w-0.5 rounded-full"
                        style={{
                          background: drv?.color ?? '#E10600',
                          height: `${Math.random() * 12 + 4}px`,
                          animation: `bounce ${0.4 + b * 0.1}s ease-in-out infinite alternate`,
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <style>{`
        @keyframes bounce { from { transform: scaleY(0.3); } to { transform: scaleY(1); } }
      `}</style>
    </div>
  )
}
