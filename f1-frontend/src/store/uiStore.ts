import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { InsightMode, TelemetryChannel, TelemetryPoint } from '../types/f1'

interface UIStore {
  // Yorum modu
  insightMode: InsightMode
  setInsightMode: (mode: InsightMode) => void

  // Aktif telemetri kanalı
  activeChannel: TelemetryChannel
  setActiveChannel: (ch: TelemetryChannel) => void

  // Grafik üzerinde seçili nokta
  selectedPoint: TelemetryPoint | null
  setSelectedPoint: (pt: TelemetryPoint | null) => void

  // Karşılaştırma modu aktif mi?
  compareMode: boolean
  setCompareMode: (v: boolean) => void

  // Sürücü seçimleri
  primaryDriver: string
  secondaryDriver: string
  setPrimaryDriver: (code: string) => void
  setSecondaryDriver: (code: string) => void
}

export const useUIStore = create<UIStore>()(
  persist(
    (set) => ({
      insightMode: 'beginner',
      setInsightMode: (mode) => set({ insightMode: mode, selectedPoint: null }),

      activeChannel: 'speed',
      setActiveChannel: (ch) => set({ activeChannel: ch }),

      selectedPoint: null,
      setSelectedPoint: (pt) => set({ selectedPoint: pt }),

      compareMode: false,
      setCompareMode: (v) => set({ compareMode: v }),

      primaryDriver: 'VER',
      secondaryDriver: 'NOR',
      setPrimaryDriver: (code) => set({ primaryDriver: code }),
      setSecondaryDriver: (code) => set({ secondaryDriver: code }),
    }),
    {
      name: 'f1-ui-store',
      partialize: (s) => ({
        insightMode: s.insightMode,
        primaryDriver: s.primaryDriver,
        secondaryDriver: s.secondaryDriver,
      }),
    }
  )
)
