import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { client } from '../../api/client'
import { useCommunityStore, type Comment } from '../../store/communityStore'

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60)   return `${Math.round(diff)}s`
  if (diff < 3600) return `${Math.round(diff / 60)}dk`
  return `${Math.round(diff / 3600)}sa`
}

/** Her kullanıcı adı için sabit renk — avatar rengine dönüşür */
function nameColor(name: string): string {
  const palette = ['#E10600','#00D2BE','#FF8700','#8B5CF6','#06b6d4','#10b981']
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) & 0xffffffff
  return palette[Math.abs(hash) % palette.length]
}

function CommentItem({ comment, onUpvote }: { comment: Comment; onUpvote: (id: string) => void }) {
  const color = nameColor(comment.username)
  return (
    <div className="flex gap-3 py-3 border-b last:border-0"
      style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
      {/* Avatar */}
      <div className="w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-bold shrink-0"
        style={{ background: color + '20', color, border: `1px solid ${color}30` }}>
        {comment.username.charAt(0).toUpperCase()}
      </div>

      <div className="flex-1 min-w-0">
        {/* Meta */}
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="text-[12px] font-semibold text-white">{comment.username}</span>
          {comment.lap_number && (
            <span className="text-[10px] mono px-1.5 py-0.5 rounded"
              style={{ background: 'rgba(225,6,0,0.12)', color: '#E10600', border: '1px solid rgba(225,6,0,0.2)' }}>
              Tur {comment.lap_number}
            </span>
          )}
          <span className="text-[10px] mono ml-auto" style={{ color: 'var(--t3)' }}>
            {timeAgo(comment.created_at)}
          </span>
        </div>

        {/* Metin */}
        <p className="text-[13px] leading-relaxed mb-2" style={{ color: 'rgba(240,244,255,0.75)' }}>
          {comment.content}
        </p>

        {/* Upvote */}
        <button onClick={() => onUpvote(comment.id)}
          className="flex items-center gap-1.5 text-[11px] mono transition-all group"
          style={{ color: 'var(--t3)' }}>
          <span className="group-hover:text-[#E10600] transition-colors">▲</span>
          <span className="group-hover:text-white transition-colors">{comment.upvotes}</span>
        </button>
      </div>
    </div>
  )
}

function CommentInput({ sessionId, lapNumber, onPosted }: {
  sessionId: number; lapNumber?: number; onPosted: (c: Comment) => void
}) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: (content: string) =>
      client.post<Comment>(`/sessions/${sessionId}/comments`, {
        content, lap_number: lapNumber ?? null,
      }).then(r => r.data),
    onSuccess: (c) => { setText(''); setError(null); onPosted(c) },
    onError: (e: any) => {
      const msg = e.response?.data?.detail ?? 'Yorum gönderilemedi'
      setError(typeof msg === 'string' ? msg : 'Hata oluştu')
    },
  })

  return (
    <div className="border-t pt-4" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) mutation.mutate(text.trim()) }}
        placeholder={lapNumber ? `Tur ${lapNumber} için yorum yaz...` : 'Yorumunu yaz... (Ctrl+Enter)'}
        rows={2}
        maxLength={500}
        className="w-full rounded-xl text-[13px] resize-none mono"
        style={{
          background: 'var(--s2)',
          border: '1px solid rgba(255,255,255,0.08)',
          color: 'rgba(240,244,255,0.85)',
          padding: '10px 14px',
          outline: 'none',
        }}
        onFocus={e => { e.target.style.borderColor = 'rgba(225,6,0,0.4)' }}
        onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.08)' }}
      />
      <div className="flex items-center justify-between mt-2">
        <div>
          {error && <p className="text-[11px] text-[#f87171]">{error}</p>}
          <p className="text-[10px] mono" style={{ color: 'var(--t3)' }}>{text.length}/500</p>
        </div>
        <button
          onClick={() => mutation.mutate(text.trim())}
          disabled={!text.trim() || mutation.isPending}
          className="px-4 py-2 rounded-lg text-[12px] font-semibold transition-all
                     disabled:opacity-30 disabled:cursor-not-allowed"
          style={{
            background: text.trim() ? 'rgba(225,6,0,0.15)' : 'transparent',
            border: '1px solid rgba(225,6,0,0.3)',
            color: text.trim() ? '#E10600' : 'var(--t3)',
          }}>
          {mutation.isPending ? '⏳' : 'Gönder ↵'}
        </button>
      </div>
    </div>
  )
}

interface FeedProps {
  sessionId: number
  lapNumber?: number
  isAuthenticated: boolean
  className?: string
}

export function CommentFeed({ sessionId, lapNumber, isAuthenticated, className }: FeedProps) {
  const { comments, addComment, setInitialComments } = useCommunityStore()
  const queryClient = useQueryClient()
  const listRef = useRef<HTMLDivElement>(null)

  const { isLoading, data } = useQuery({
    queryKey: ['comments', sessionId, lapNumber],
    queryFn: () =>
      client.get(`/sessions/${sessionId}/comments`, {
        params: { lap: lapNumber, page: 1, page_size: 50 },
      }).then(r => r.data.items as Comment[]),
    staleTime: 30_000,
  })

  useEffect(() => { if (data) setInitialComments(data) }, [data])

  const handleUpvote = async (id: string) => {
    try {
      await client.post(`/comments/${id}/upvote`)
      queryClient.invalidateQueries({ queryKey: ['comments', sessionId] })
    } catch {}
  }

  const filtered = lapNumber
    ? comments.filter(c => c.lap_number === lapNumber || c.lap_number === null)
    : comments

  return (
    <div className={`flex flex-col ${className ?? ''}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b"
        style={{ borderColor: 'var(--b1)' }}>
        <div className="flex items-center gap-2.5">
          <span className="text-base">💬</span>
          <div>
            <p className="text-[13px] font-bold text-white leading-none">Canlı Yorumlar</p>
            <p className="text-[10px] mono mt-0.5" style={{ color: 'var(--t3)' }}>
              {filtered.length} yorum
            </p>
          </div>
        </div>
        <span className="w-2 h-2 rounded-full bg-[#00D2BE]"
          style={{ animation: 'pulse-dot 2s infinite' }} />
      </div>

      {/* Liste */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-5" style={{ maxHeight: 300 }}>
        {isLoading ? (
          <div className="py-6 space-y-3">
            {[80, 60, 70].map((w, i) => (
              <div key={i} className="flex gap-3">
                <div className="w-8 h-8 rounded-full animate-pulse shrink-0" style={{ background: 'var(--s3)' }} />
                <div className="flex-1 space-y-2">
                  <div className="h-3 rounded-full animate-pulse" style={{ width: `${w}%`, background: 'var(--s3)' }} />
                  <div className="h-3 rounded-full animate-pulse" style={{ width: '50%', background: 'var(--s3)' }} />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 gap-2">
            <span className="text-3xl opacity-30">💬</span>
            <p className="text-[12px]" style={{ color: 'var(--t3)' }}>İlk yorumu sen yap!</p>
          </div>
        ) : (
          filtered.map(c => <CommentItem key={c.id} comment={c} onUpvote={handleUpvote} />)
        )}
      </div>

      {/* Input */}
      <div className="px-5 pb-5">
        {isAuthenticated ? (
          <CommentInput sessionId={sessionId} lapNumber={lapNumber} onPosted={addComment} />
        ) : (
          <div className="border-t pt-4 text-center" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
            <p className="text-[12px]" style={{ color: 'var(--t3)' }}>
              Yorum yapmak için{' '}
              <Link to="/login" className="font-semibold hover:text-white transition-colors"
                style={{ color: 'var(--red)' }}>
                giriş yap
              </Link>
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
