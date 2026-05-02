// AiCall service worker - minimal pentru PWA install + offline shell.
// Versiunea 1: doar caching shell (HTML), fara strategii agresive.
// Push notifications + apel ringtone se vor adauga in v2.

const CACHE_NAME = 'aicall-v1';
const SHELL = ['/', '/index.html'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL).catch(() => {}))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // Network-first pentru tot. Fallback la cache pe HTML cand offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html').then((r) => r || fetch(request)))
    );
    return;
  }
  // Pentru asset-uri (JS/CSS/img): cache-first cu fallback la network
  if (request.url.includes('/assets/')) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(request, copy));
        return res;
      }).catch(() => cached))
    );
    return;
  }
  // Default: just network
});

// Placeholder pentru push notifications - se va popula in v2
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'AiCall', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'AiCall - Apel intrant';
  const options = {
    body: data.body || 'Cineva te suna...',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    vibrate: [200, 100, 200, 100, 200],
    requireInteraction: true,
    data: data,
    actions: [
      { action: 'answer', title: '📞 Răspunde' },
      { action: 'reject', title: '🚫 Refuză' },
    ],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const action = event.action || 'answer';
  const target = action === 'reject' ? '/?call_action=reject' : '/?call_action=answer';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes('/') && 'focus' in client) {
          client.postMessage({ type: 'call_action', action });
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
