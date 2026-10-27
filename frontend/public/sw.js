// Service Worker für Benachrichtigungen ("Gleich bist du dran", "Du bist dran").
// Bewusst ohne Offline-Cache: Die App soll immer den aktuellen Stand der Schlange zeigen.
// Nachrichten kommen vom Backend (backend/app/libs/notify_worker.py) als JSON {title, body, url, tag}.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Dranzeit';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      tag: data.tag || undefined,
      renotify: Boolean(data.tag),
      // "Du bist dran" bleibt stehen, bis man sie wegtippt – erkannt am tag ("called-<Termin>"), der Titel ist übersetzt
      requireInteraction: String(data.tag || '').startsWith('called-'),
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      vibrate: [200, 100, 200],
      data: { url: data.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => w.url === url);
      if (open) return open.focus();
      return self.clients.openWindow(url);
    }),
  );
});
