import { create } from 'zustand'

// ─── Tipler ──────────────────────────────────────────────────────────────────

export interface Comment {
  id: string
  content: string
  username: string
  user_id: string
  lap_number: number | null
  dist_pct: number | null
  upvotes: number
  created_at: string
}

export interface PollOption {
  index: number
  text: string
  votes: number
  pct: number
}

export interface Poll {
  id: string
  question: string
  options: PollOption[]
  total_votes: number
  user_vote: number | null
  created_at: string
  closes_at: string | null
  is_closed: boolean
  created_by: string
  created_by_username: string
}

export interface Reaction {
  emoji: string
  dist_pct: number | null
  lap_number: number | null
  user_id?: string
  ts: string
}

interface CommunityStore {
  // Bağlantı
  connected: boolean
  sessionId: number | null

  // Veri
  comments: Comment[]
  polls: Poll[]
  liveReactions: Reaction[]  // Son 5 saniyedeki anlık tepkiler (animasyon için)

  // Eylemler
  connect: (sessionId: number) => void
  disconnect: () => void
  addComment: (comment: Comment) => void   // Optimistik güncelleme için
  updateComment: (comment: Comment) => void
  removeComment: (id: string) => void
  addPoll: (poll: Poll) => void
  updatePoll: (poll: Poll) => void
  removePoll: (id: string) => void
  clearLiveReactions: () => void
  setInitialComments: (comments: Comment[]) => void
  setInitialPolls: (polls: Poll[]) => void
}

let socket: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectDelay = 1000
const WS_BASE = import.meta.env.VITE_WS_URL ?? 'ws://localhost:8000'

export const useCommunityStore = create<CommunityStore>((set, get) => ({
  connected: false,
  sessionId: null,
  comments: [],
  polls: [],
  liveReactions: [],

  connect: (sessionId: number) => {
    if (socket) { socket.onclose = null; socket.close(); socket = null }
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }

    set({ sessionId, connected: false })

    const open = () => {
      socket = new WebSocket(`${WS_BASE}/ws/community/${sessionId}`)

      socket.onopen = () => {
        reconnectDelay = 1000
        set({ connected: true })
      }

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          handleCommunityMessage(msg, set, get)
        } catch {}
      }

      socket.onclose = (e) => {
        set({ connected: false })
        // 4xxx = kasıtlı kapatma, yeniden bağlanma
        if (e.code >= 4000) return
        reconnectTimer = setTimeout(() => {
          reconnectDelay = Math.min(reconnectDelay * 2, 30_000)
          open()
        }, reconnectDelay)
      }
    }

    open()
  },

  disconnect: () => {
    if (reconnectTimer) clearTimeout(reconnectTimer)
    if (socket) { socket.onclose = null; socket.close(); socket = null }
    set({ connected: false, sessionId: null, comments: [], polls: [], liveReactions: [] })
  },

  addComment: (comment) =>
    set((s) => {
      if (s.comments.some((c) => c.id === comment.id)) return s
      return { comments: [comment, ...s.comments].slice(0, 200) }
    }),

  updateComment: (comment) =>
    set((s) => ({
      comments: s.comments.map((c) => c.id === comment.id ? comment : c),
    })),

  removeComment: (id) =>
    set((s) => ({ comments: s.comments.filter((c) => c.id !== id) })),

  addPoll: (poll) =>
    set((s) => {
      if (s.polls.some((p) => p.id === poll.id)) return s
      return { polls: [poll, ...s.polls] }
    }),

  updatePoll: (poll) =>
    set((s) => ({
      polls: s.polls.map((p) => p.id === poll.id ? poll : p),
    })),

  removePoll: (id) =>
    set((s) => ({ polls: s.polls.filter((p) => p.id !== id) })),

  clearLiveReactions: () => set({ liveReactions: [] }),

  setInitialComments: (comments) => set({ comments }),
  setInitialPolls: (polls) => set({ polls }),
}))

// ─── Mesaj İşleyici ──────────────────────────────────────────────────────────

function handleCommunityMessage(
  msg: { type: string; data?: any },
  set: (p: any) => void,
  get: () => CommunityStore
) {
  switch (msg.type) {
    case 'comment': {
      const c: Comment = msg.data
      set((s: CommunityStore) => {
        if (s.comments.some((existing) => existing.id === c.id)) return s
        return { comments: [c, ...s.comments].slice(0, 200) }
      })
      break
    }
    case 'comment_update': {
      const c: Comment = msg.data
      set((s: CommunityStore) => ({
        comments: s.comments.map((existing) => existing.id === c.id ? c : existing),
      }))
      break
    }
    case 'comment_delete': {
      const { id } = msg.data
      set((s: CommunityStore) => ({
        comments: s.comments.filter((existing) => existing.id !== id),
      }))
      break
    }
    case 'poll_new': {
      const p: Poll = msg.data
      set((s: CommunityStore) => {
        if (s.polls.some((existing) => existing.id === p.id)) return s
        return { polls: [p, ...s.polls] }
      })
      break
    }
    case 'poll_update': {
      const p: Poll = msg.data
      set((s: CommunityStore) => ({
        polls: s.polls.map((existing) => existing.id === p.id ? p : existing),
      }))
      break
    }
    case 'poll_delete': {
      const { id } = msg.data
      set((s: CommunityStore) => ({
        polls: s.polls.filter((existing) => existing.id !== id),
      }))
      break
    }
    case 'reaction': {
      const r: Reaction = msg.data
      set((s: CommunityStore) => ({
        liveReactions: [r, ...s.liveReactions].slice(0, 30),
      }))
      // 4 saniye sonra animasyonu temizle
      setTimeout(() => {
        set((s: CommunityStore) => ({
          liveReactions: s.liveReactions.filter((lr) => lr.ts !== r.ts),
        }))
      }, 4000)
      break
    }
    default:
      break
  }
}
