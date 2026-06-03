import { useEffect, useCallback } from 'react'
import { client } from '../api/client'

// VAPID public key — gerçek deploy'da .env'den gelmeli
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? ''

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)))
}

export function usePushNotifications() {
  const isSupported = 'serviceWorker' in navigator && 'PushManager' in window

  useEffect(() => {
    if (!isSupported) return
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[SW] Kayıt başarısız:', err)
    })
  }, [isSupported])

  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!isSupported || !VAPID_PUBLIC_KEY) return false

    try {
      const reg = await navigator.serviceWorker.ready
      const existing = await reg.pushManager.getSubscription()
      if (existing) return true

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      })

      await client.post('/notifications/subscribe', sub.toJSON())
      return true
    } catch (e) {
      console.warn('[Push] Abonelik başarısız:', e)
      return false
    }
  }, [isSupported])

  const requestPermission = useCallback(async (): Promise<NotificationPermission> => {
    if (!isSupported) return 'denied'
    return Notification.requestPermission()
  }, [isSupported])

  return { isSupported, subscribe, requestPermission }
}
