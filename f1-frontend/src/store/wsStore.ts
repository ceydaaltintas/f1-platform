import { create } from 'zustand'

// ─── Tipler ──────────────────────────────────────────────────────────────────

export interface LivePosition {
  driver_number: number
  x: number | null
  y: number | null
  speed?: number
}

export interface LiveInterval {
  driver_number: number
  gap_to_leader: string | number | null
  interval: string | number | null
}

export interface RaceControlMessage {
  message: string
  flag: string | null
  category: string | null
  driver_number: number | null
  date: string
}

export interface RadioRecording {
  driver_number: number
  recording_url: string
  date: string
}

export interface WSState {
  // Bağlantı durumu
  connected: boolean
  sessionId: number | null
  sessionKey: number | null
  reconnectCount: number

  // Canlı veri
  positions: LivePosition[]
  intervals: LiveInterval[]
  raceControlMessages: RaceControlMessage[]
  radioQueue: RadioRecording[]
  lastUpdate: string | null

  // Eylemler
  connect: (sessionId: number) => void
  disconnect: () => void
  clearRadioQueue: () => void
}

// ─── Store ───────────────────────────────────────────────────────────────────

let socket: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectDelay = 1000
const MAX_RECONNECT_DELAY = 30_000
const WS_BASE = import.meta.env.VITE_WS_URL ?? 'ws://localhost:8000'

export const useWSStore = create<WSState>((set, get) => ({
  connected: false,
  sessionId: null,
  sessionKey: null,
  reconnectCount: 0,
  positions: [],
  intervals: [],
  raceControlMessages: [],
  radioQueue: [],
  lastUpdate: null,

  connect: (sessionId: number) => {
    // Mevcut bağlantıyı kapat
    if (socket) {
      socket.onclose = null
      socket.close()
      socket = null
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }

    set({ sessionId, connected: false })
    reconnectDelay = 1000

    const open = () => {
      const url = `${WS_BASE}/ws/race/${sessionId}`
      socket = new WebSocket(url)

      socket.onopen = () => {
        reconnectDelay = 1000 // Reset
        set({ connected: true, reconnectCount: 0 })

        // İlgilendiğimiz kanalları bildir
        socket?.send(JSON.stringify({
          type: 'subscribe',
          channels: ['timing', 'positions', 'race_control', 'radio'],
        }))
      }

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          handleMessage(msg, set)
        } catch {
          // JSON dışı mesaj — yoksay
        }
      }

      socket.onerror = (err) => {
        console.error('[WS] Hata:', err)
      }

      socket.onclose = (event) => {
        set({ connected: false })
        if (event.code === 4004) {
          // Oturum aktif değil — yeniden bağlanma
          console.warn('[WS] Oturum aktif değil, yeniden bağlanılmıyor')
          return
        }
        // Otomatik yeniden bağlan
        reconnectTimer = setTimeout(() => {
          reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY)
          set((s) => ({ reconnectCount: s.reconnectCount + 1 }))
          open()
        }, reconnectDelay)
      }
    }

    open()
  },

  disconnect: () => {
    if (reconnectTimer) clearTimeout(reconnectTimer)
    if (socket) {
      socket.onclose = null
      socket.close()
      socket = null
    }
    set({
      connected: false,
      sessionId: null,
      positions: [],
      intervals: [],
      raceControlMessages: [],
      radioQueue: [],
    })
  },

  clearRadioQueue: () => set({ radioQueue: [] }),
}))

// ─── Mesaj İşleyici ──────────────────────────────────────────────────────────

function handleMessage(
  msg: { type: string; data?: any; is_snapshot?: boolean },
  set: (partial: Partial<WSState> | ((s: WSState) => Partial<WSState>)) => void
) {
  const now = new Date().toISOString()

  switch (msg.type) {
    case 'positions':
      set({ positions: msg.data?.positions ?? [], lastUpdate: now })
      break

    case 'timing':
      set({ intervals: msg.data?.intervals ?? [], lastUpdate: now })
      break

    case 'race_control': {
      const newMsgs: RaceControlMessage[] = msg.data?.messages ?? []
      set((s) => ({
        raceControlMessages: [...newMsgs, ...s.raceControlMessages].slice(0, 50),
        lastUpdate: now,
      }))
      break
    }

    case 'radio': {
      const recordings: RadioRecording[] = msg.data?.recordings ?? []
      if (!msg.is_snapshot) {
        set((s) => ({
          radioQueue: [...recordings, ...s.radioQueue].slice(0, 20),
          lastUpdate: now,
        }))
      }
      break
    }

    case 'connected':
      set({ sessionKey: msg.data?.session_key ?? null })
      break

    case 'error':
      console.error('[WS] Sunucu hatası:', msg)
      break

    default:
      break
  }
}
