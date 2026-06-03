// F1 Platform Service Worker
// Push bildirimleri için

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  if (!event.data) return

  let data
  try {
    data = event.data.json()
  } catch {
    data = { title: 'F1 Platform', body: event.data.text() }
  }

  const title = data.title || 'F1 Platform'
  const options = {
    body: data.body || '',
    icon: '/f1-icon.png',
    badge: '/f1-badge.png',
    tag: data.tag || 'f1-notification',
    requireInteraction: data.urgent || false,
    data: { url: data.url || '/' },
    actions: data.url
      ? [{ action: 'open', title: 'Görüntüle' }]
      : [],
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      const existing = clients.find((c) => c.url.includes(self.location.origin))
      if (existing) {
        existing.focus()
        existing.navigate(url)
      } else {
        self.clients.openWindow(url)
      }
    })
  )
})
