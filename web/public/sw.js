// ---------------------------------------------------------------------------
// Launch-screen precache. The manifest's start_url is /launch.html, and the ONLY
// reason opening the installed app can show an animation during the slow server
// render is that this file (and the mascot it shows) is already on disk — a launch
// with no network involved. Bump LAUNCH_CACHE when launch.html changes.
//
// The fetch handler is deliberately narrow: it answers ONLY for the precached
// launch assets and touches nothing else. Every other request — the dashboard SSR,
// API calls, everything — falls through to the network untouched, so this can
// never serve a stale page or interfere with auth.
// ---------------------------------------------------------------------------
const LAUNCH_CACHE = 'remind-launch-v2';
const LAUNCH_ASSETS = ['/launch.html', '/mascot/reminder.png'];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(LAUNCH_CACHE)
      .then(cache => cache.addAll(LAUNCH_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k.startsWith('remind-launch-') && k !== LAUNCH_CACHE)
            .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', function(event) {
  const path = new URL(event.request.url).pathname;
  if (event.request.method !== 'GET' || !LAUNCH_ASSETS.includes(path)) return;
  event.respondWith(
    caches.match(event.request).then(cached =>
      cached || fetch(event.request).then(res => {
        const copy = res.clone();
        caches.open(LAUNCH_CACHE).then(cache => cache.put(event.request, copy));
        return res;
      })
    )
  );
});

self.addEventListener('push', function(event) {
  let data = { title: 'Medication Reminder', body: 'Take your scheduled medication.' };
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { title: 'Medication Reminder', body: event.data.text() };
    }
  }

  const options = {
    body: data.body,
    icon: '/icon-192x192.png',
    badge: '/icon-192x192.png',
    data: {
      eventId: data.eventId,
      trackingToken: data.trackingToken,
      url: data.url || '/dashboard'
    },
    actions: data.actions || []
  };

  const promiseChain = self.registration.showNotification(data.title, options)
    .then(() => {
      if (data.eventId && data.trackingToken) {
        return fetch('/api/push/displayed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventId: data.eventId, trackingToken: data.trackingToken })
        }).catch(err => console.error('Failed to report DISPLAYED status:', err));
      }
    });

  event.waitUntil(promiseChain);
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  let targetUrl = '/dashboard';
  if (event.notification.data && event.notification.data.url) {
    targetUrl = event.notification.data.url;
  }

  let fetchPromise = Promise.resolve();
  const hasToken = event.notification.data && event.notification.data.eventId && event.notification.data.trackingToken;

  if (hasToken) {
    const endpoint = event.action === 'acknowledge' ? '/api/push/acknowledge' : '/api/push/opened';
    fetchPromise = fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId: event.notification.data.eventId,
        trackingToken: event.notification.data.trackingToken
      })
    }).catch(err => console.error(`Failed to report callback (${event.action || 'opened'}):`, err));
  }

  // Only open/focus window if they clicked the main notification body (not an action button)
  const openWindowPromise = (!event.action)
    ? clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
        for (var i = 0; i < clientList.length; i++) {
          var client = clientList[i];
          if (client.url.indexOf(targetUrl) !== -1 && 'focus' in client) {
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      })
    : Promise.resolve();

  event.waitUntil(Promise.all([fetchPromise, openWindowPromise]));
});
