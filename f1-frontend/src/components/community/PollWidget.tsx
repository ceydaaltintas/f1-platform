import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { client, getCurrentUserId } from '../../api/client'
import { useCommunityStore, type Poll } from '../../store/communityStore'

function useCountdown(closesAt: string | null): string {
  const [label, setLabel] = useState('')
  useEffect(() => {
    if (!closesAt) return
    const tick = () => {
      const diff = new Date(closesAt).getTime() - Date.now()
      if (diff <= 0) { setLabel('Kapandı'); return }
      const m = Math.floor(diff / 60_000)
      const s = Math.floor((diff % 60_000) / 1000)
      setLabel(`${m}:${s.toString().padStart(2, '0')}`)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [closesAt])
  return label
}

function PollCard({ poll, sessionId, userId, onDeleted }: {
  poll: Poll; sessionId: number; userId: string | null; onDeleted: (id: string) => void
}) {
  const countdown   = useCountdown(poll.closes_at)
  const queryClient = useQueryClient()

  const voteMutation = useMutation({
    mutationFn: (optionIndex: number) =>
      client.post<Poll>(`/polls/${poll.id}/vote`, null, { params: { option_index: optionIndex } })
        .then(r => r.data),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['polls', sessionId] }),
  })

  const deleteMutation = useMutation({
    mutationFn: () => client.delete(`/polls/${poll.id}`),
    onSuccess: () => onDeleted(poll.id),
  })

  const hasVoted = poll.user_vote !== null && poll.user_vote !== undefined
  const isClosed = poll.is_closed
  const isOwn = poll.created_by === getCurrentUserId()

  return (
    <div className="rounded-xl border p-4 space-y-3"
      style={{ background: 'var(--s2)', borderColor: 'var(--b1)' }}>
      {/* Soru */}
      <div className="flex items-start justify-between gap-3">
        <p className="text-[14px] font-semibold text-white leading-snug flex-1">
          {poll.question}
        </p>
        {isClosed ? (
          <span className="text-[10px] mono font-semibold px-2 py-0.5 rounded shrink-0"
            style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--t3)', border: '1px solid var(--b1)' }}>
            KAPANDI
          </span>
        ) : countdown ? (
          <span className="text-[11px] mono font-bold shrink-0" style={{ color: '#FF8700' }}>
            ⏱ {countdown}
          </span>
        ) : null}
      </div>

      {/* Seçenekler */}
      <div className="space-y-2">
        {poll.options.map(opt => {
          const isVoted     = poll.user_vote === opt.index
          const showResults = hasVoted || isClosed
          const canVote     = !hasVoted && !isClosed && !voteMutation.isPending

          return (
            <button key={opt.index}
              onClick={() => canVote && voteMutation.mutate(opt.index)}
              disabled={!canVote}
              className="w-full text-left rounded-xl overflow-hidden transition-all"
              style={{ cursor: canVote ? 'pointer' : 'default' }}>
              <div className="relative border rounded-xl overflow-hidden"
                style={{
                  borderColor: isVoted ? 'rgba(225,6,0,0.4)' : 'rgba(255,255,255,0.08)',
                  minHeight: 44,
                }}>
                {/* Progress fill */}
                {showResults && (
                  <div className="absolute inset-y-0 left-0 rounded-xl transition-all duration-700"
                    style={{
                      width: `${opt.pct}%`,
                      background: isVoted ? 'rgba(225,6,0,0.18)' : 'rgba(255,255,255,0.05)',
                    }} />
                )}

                {/* Content */}
                <div className="relative flex items-center justify-between px-4 py-2.5">
                  <div className="flex items-center gap-2.5">
                    {isVoted ? (
                      <span className="w-4 h-4 rounded-full flex items-center justify-center text-[10px]"
                        style={{ background: '#E10600', color: 'white' }}>✓</span>
                    ) : (
                      <span className="w-4 h-4 rounded-full border"
                        style={{ borderColor: 'rgba(255,255,255,0.15)' }} />
                    )}
                    <span className="text-[13px] font-medium"
                      style={{ color: isVoted ? 'white' : 'rgba(240,244,255,0.75)' }}>
                      {opt.text}
                    </span>
                  </div>
                  {showResults && (
                    <span className="text-[13px] font-black mono"
                      style={{ color: isVoted ? '#E10600' : 'var(--t2)' }}>
                      {opt.pct.toFixed(0)}%
                    </span>
                  )}
                </div>
              </div>
            </button>
          )
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-1">
        <span className="text-[11px] mono" style={{ color: 'var(--t3)' }}>
          {poll.total_votes} oy · @{poll.created_by_username}
        </span>
        <div className="flex items-center gap-3">
          {!hasVoted && !isClosed && (
            <span className="text-[10px]" style={{ color: 'var(--t3)' }}>
              Seç ve oy ver
            </span>
          )}
          {isOwn && (
            <button onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="text-[11px] transition-colors hover:text-[#f87171] disabled:opacity-50"
              style={{ color: 'var(--t3)' }}>
              {deleteMutation.isPending ? '⏳' : 'Sil'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function PollCreateForm({ sessionId, onCreated }: {
  sessionId: number; onCreated: (p: Poll) => void
}) {
  const [open, setOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState(['', ''])
  const [minutes, setMinutes] = useState(5)
  const [error, setError] = useState<string | null>(null)
  const submittingRef = useRef(false)

  const mutation = useMutation({
    mutationFn: () =>
      client.post<Poll>(`/sessions/${sessionId}/polls`, {
        question: question.trim(),
        options: options.filter(o => o.trim()),
        closes_in_minutes: minutes,
      }).then(r => r.data),
    onSuccess: (p) => { onCreated(p); setOpen(false); setQuestion(''); setOptions(['', '']); setError(null) },
    onError: (e: any) => {
      const msg = e.response?.data?.detail
      if (typeof msg === 'string') setError(msg)
      else if (Array.isArray(msg) && msg[0]?.msg) setError(String(msg[0].msg))
      else setError('Anket oluşturulamadı')
    },
    onSettled: () => { submittingRef.current = false },
  })

  const handleSubmit = () => {
    if (submittingRef.current || mutation.isPending) return
    submittingRef.current = true
    mutation.mutate()
  }

  const inputStyle = {
    width: '100%',
    background: 'var(--s1)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 10,
    color: 'rgba(240,244,255,0.85)',
    fontSize: 13,
    padding: '9px 12px',
    outline: 'none',
    fontFamily: 'Inter,sans-serif',
  } as const

  if (!open) return (
    <button onClick={() => setOpen(true)}
      className="w-full py-3 rounded-xl text-[12px] font-medium border border-dashed transition-all"
      style={{ borderColor: 'rgba(255,255,255,0.1)', color: 'var(--t2)',
               background: 'transparent' }}
      onMouseEnter={e => {
        (e.target as HTMLElement).style.borderColor = 'rgba(225,6,0,0.35)'
        ;(e.target as HTMLElement).style.color = '#E10600'
      }}
      onMouseLeave={e => {
        (e.target as HTMLElement).style.borderColor = 'rgba(255,255,255,0.1)'
        ;(e.target as HTMLElement).style.color = 'var(--t2)'
      }}>
      + Anket Oluştur
    </button>
  )

  return (
    <div className="rounded-xl border p-4 space-y-3"
      style={{ background: 'var(--s2)', borderColor: 'rgba(225,6,0,0.2)' }}>
      <p className="text-[12px] font-semibold text-white">Yeni Anket</p>

      <input value={question} onChange={e => setQuestion(e.target.value)}
        placeholder="Soru yaz..." maxLength={300} style={inputStyle}
        onFocus={e => e.target.style.borderColor = 'rgba(225,6,0,0.4)'}
        onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.08)'} />

      {options.map((opt, i) => (
        <input key={i} value={opt}
          onChange={e => { const n = [...options]; n[i] = e.target.value; setOptions(n) }}
          placeholder={`Seçenek ${i + 1}`} maxLength={80} style={inputStyle}
          onFocus={e => e.target.style.borderColor = 'rgba(225,6,0,0.4)'}
          onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.08)'} />
      ))}

      {options.length < 4 && (
        <button onClick={() => setOptions([...options, ''])}
          className="text-[11px] transition-colors"
          style={{ color: 'var(--t3)' }}
          onMouseEnter={e => (e.target as HTMLElement).style.color = 'white'}
          onMouseLeave={e => (e.target as HTMLElement).style.color = 'var(--t3)'}>
          + Seçenek Ekle
        </button>
      )}

      <div className="flex items-center gap-3 pt-1">
        <label className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--t2)' }}>
          Süre:
          <select value={minutes} onChange={e => setMinutes(Number(e.target.value))}
            style={{ ...inputStyle, width: 'auto', padding: '6px 10px', fontSize: 12 }}>
            {[1, 2, 5, 10, 30].map(m => <option key={m} value={m}>{m} dk</option>)}
          </select>
        </label>

        <div className="flex gap-2 ml-auto">
          <button onClick={() => setOpen(false)}
            className="px-3 py-1.5 rounded-lg text-[12px] transition-colors"
            style={{ color: 'var(--t3)' }}>İptal</button>
          <button
            onClick={handleSubmit}
            disabled={question.trim().length < 5 || options.filter(o => o.trim()).length < 2 || mutation.isPending}
            className="px-4 py-1.5 rounded-lg text-[12px] font-semibold transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ background: 'rgba(225,6,0,0.15)', border: '1px solid rgba(225,6,0,0.3)', color: '#E10600' }}>
            {mutation.isPending ? '⏳' : 'Oluştur'}
          </button>
        </div>
      </div>

      {error && <p className="text-[12px]" style={{ color: '#f87171' }}>⚠ {error}</p>}
    </div>
  )
}

interface Props { sessionId: number; userId: string | null; isAuthenticated: boolean }

export function PollWidget({ sessionId, userId, isAuthenticated }: Props) {
  const { polls, setInitialPolls, addPoll, removePoll } = useCommunityStore()
  const queryClient = useQueryClient()

  const { data: pollsData } = useQuery({
    queryKey: ['polls', sessionId],
    queryFn: () => client.get<Poll[]>(`/sessions/${sessionId}/polls`).then(r => r.data),
    staleTime: 30_000,
  })

  useEffect(() => { if (pollsData) setInitialPolls(pollsData) }, [pollsData])

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b"
        style={{ borderColor: 'var(--b1)' }}>
        <div className="flex items-center gap-2.5">
          <span className="text-base">📊</span>
          <div>
            <p className="text-[13px] font-bold text-white leading-none">Canlı Anketler</p>
            <p className="text-[10px] mono mt-0.5" style={{ color: 'var(--t3)' }}>
              {polls.length > 0 ? `${polls.length} aktif anket` : 'Anket yok'}
            </p>
          </div>
        </div>
        {polls.length > 0 && (
          <span className="w-2 h-2 rounded-full" style={{ background: '#FF8700', animation: 'pulse-dot 2s infinite' }} />
        )}
      </div>

      <div className="p-4 space-y-3 flex-1 overflow-y-auto" style={{ maxHeight: 380 }}>
        {polls.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 gap-2">
            <span className="text-3xl opacity-30">📊</span>
            <p className="text-[12px]" style={{ color: 'var(--t3)' }}>
              {isAuthenticated ? 'İlk anketi oluştur!' : 'Henüz anket yok'}
            </p>
          </div>
        ) : (
          polls.map(p => (
            <PollCard key={p.id} poll={p} sessionId={sessionId} userId={userId} onDeleted={removePoll} />
          ))
        )}

        {isAuthenticated ? (
          <PollCreateForm sessionId={sessionId}
            onCreated={addPoll} />
        ) : (
          <div className="text-center py-3">
            <p className="text-[12px]" style={{ color: 'var(--t3)' }}>
              Anket oluşturmak için{' '}
              <Link to="/login" className="font-semibold hover:text-white transition-colors"
                style={{ color: 'var(--red)' }}>giriş yap</Link>
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
