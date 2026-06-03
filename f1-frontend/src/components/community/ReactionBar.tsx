import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { client } from '../../api/client'
import { useCommunityStore } from '../../store/communityStore'

const EMOJIS = ['🔥', '💀', '👏', '😮', '🏎️', '🏁', '⚠️', '💨']

interface Props {
  sessionId: number
  lapNumber?: number
  distPct?: number
  isAuthenticated: boolean
}

interface FloatingEmoji {
  id: number
  emoji: string
  x: number
}

let emojiCounter = 0

export function ReactionBar({ sessionId, lapNumber, distPct, isAuthenticated }: Props) {
  const [floating, setFloating] = useState<FloatingEmoji[]>([])
  const { liveReactions } = useCommunityStore()

  const mutation = useMutation({
    mutationFn: (emoji: string) =>
      client.post(`/sessions/${sessionId}/reactions`, {
        emoji,
        lap_number: lapNumber ?? null,
        dist_pct: distPct ?? null,
      }),
  })

  const handleReaction = (emoji: string) => {
    if (!isAuthenticated) return

    // Optimistik animasyon
    const id = ++emojiCounter
    const x = 20 + Math.random() * 60  // %20–%80 yatay pozisyon
    setFloating((prev) => [...prev, { id, emoji, x }])
    setTimeout(() => setFloating((prev) => prev.filter((f) => f.id !== id)), 2000)

    mutation.mutate(emoji)
  }

  return (
    <div className="relative">
      {/* Yüzen emojiler (diğer kullanıcıların gerçek zamanlı tepkileri) */}
      <div className="absolute bottom-full left-0 right-0 h-20 pointer-events-none overflow-hidden">
        {[...floating, ...liveReactions.slice(0, 5)].map((f, i) => (
          <div
            key={'id' in f ? f.id : i}
            className="absolute text-lg animate-bounce"
            style={{
              left: `${'x' in f ? f.x : 30 + i * 10}%`,
              bottom: 0,
              animation: 'floatUp 2s ease-out forwards',
            }}
          >
            {'emoji' in f ? f.emoji : ''}
          </div>
        ))}
      </div>

      {/* Emoji butonları */}
      <div className="bg-[#0d0d0d] border border-[#1a1a1a] rounded-lg px-3 py-2 flex items-center gap-1 flex-wrap">
        <span className="text-[9px] text-[#222] tracking-widest mr-2">TEPKİ</span>
        {EMOJIS.map((emoji) => (
          <button
            key={emoji}
            onClick={() => handleReaction(emoji)}
            disabled={!isAuthenticated || mutation.isPending}
            className="text-base hover:scale-125 transition-transform disabled:opacity-30 disabled:cursor-not-allowed px-1"
            title={isAuthenticated ? `${emoji} tepkisi gönder` : 'Tepki için giriş yap'}
          >
            {emoji}
          </button>
        ))}
        {!isAuthenticated && (
          <span className="text-[9px] text-[#1e1e1e] ml-2">Giriş yap</span>
        )}
      </div>

      <style>{`
        @keyframes floatUp {
          0%   { transform: translateY(0) scale(1); opacity: 1; }
          100% { transform: translateY(-80px) scale(1.4); opacity: 0; }
        }
      `}</style>
    </div>
  )
}
