// Imported into the generated service worker (vite.config.ts → workbox.importScripts).
// Shows pushes from the send-push Edge Function and opens the right screen on tap.

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Group 4 Quiz', body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Group 4 Quiz', {
      body: data.body || '',
      icon: '/pwa-192x192.png',
      badge: '/pwa-64x64.png',
      tag: data.tag,
      renotify: !!data.tag,
      data: { url: data.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('navigate' in client && client.url.startsWith(self.location.origin)) {
          return client.navigate(url).then((c) => (c || client).focus());
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
