import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface FavoritesStore {
  favoriteDrivers: string[]   // pilot kodları: ['VER', 'NOR', ...]
  toggleDriver: (code: string) => void
  isFavorite: (code: string) => boolean
}

export const useFavoritesStore = create<FavoritesStore>()(
  persist(
    (set, get) => ({
      favoriteDrivers: [],
      toggleDriver: (code) =>
        set(s => ({
          favoriteDrivers: s.favoriteDrivers.includes(code)
            ? s.favoriteDrivers.filter(c => c !== code)
            : [...s.favoriteDrivers, code],
        })),
      isFavorite: (code) => get().favoriteDrivers.includes(code),
    }),
    { name: 'f1-favorites' }
  )
)
