/* Service worker – generated at build time (see vite.config.ts). */
const VERSION = '__VERSION__'
const CACHE = `haushaltsbuch-${VERSION}`
const PRECACHE = __PRECACHE__ // relative to this file's directory (= app base path)
const INDEX = new URL('index.html', self.registration.scope).href

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('haushaltsbuch-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  // App shell: network first (to pick up updates), offline fallback to cached index.html
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(INDEX, copy))
          return res
        })
        .catch(() => caches.match(INDEX)),
    )
    return
  }

  // Static assets: cache first (hashed filenames), then network
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(req, copy))
          }
          return res
        }),
    ),
  )
})

// ---------- Web Push (iOS 16.4+ Home-Bildschirm-App, Android, Desktop) ----------
self.addEventListener('push', (event) => {
  let msg = {}
  try {
    msg = event.data ? event.data.json() : {}
  } catch {
    msg = { body: event.data ? event.data.text() : '' }
  }
  const title = msg.title || 'Haushaltsbuch'
  const url = new URL(msg.url || './', self.registration.scope).href
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, {
        body: msg.body || '',
        tag: msg.tag || undefined,
        icon: new URL('icon-192.png', self.registration.scope).href,
        badge: new URL('icon-192.png', self.registration.scope).href,
        data: { url },
      }),
      // let open app windows know (used by the automated tests and to refresh data)
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => cs.forEach((c) => c.postMessage({ type: 'push', msg }))),
    ]),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || self.registration.scope
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
      const c = cs.find((x) => x.url.startsWith(self.registration.scope))
      if (c) {
        c.postMessage({ type: 'navigate', url })
        return c.focus()
      }
      return self.clients.openWindow(url)
    }),
  )
})
