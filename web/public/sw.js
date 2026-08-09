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
// The splash is now pure inline SVG/CSS — no image to precache, so the installed
// app's first paint costs exactly one ~6KB HTML read from disk.
const LAUNCH_CACHE = 'remind-launch-v7';
const LAUNCH_ASSETS = ['/launch.html'];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(LAUNCH_CACHE)
      // cache: 'reload' bypasses the browser's HTTP cache, so a version bump can
      // never re-precache a stale copy (or one stored with obsolete headers — a
      // launch.html cached WITH the strict CSP header once froze installed apps
      // on the splash even after the server stopped sending it).
      .then(cache => cache.addAll(LAUNCH_ASSETS.map(u => new Request(u, { cache: 'reload' }))))
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
      // Heal any window still sitting on the splash. A broken cached copy (e.g.
      // one stored WITH the strict CSP header, whose forwarding script the browser
      // then blocks) cannot recover by itself, and without this it stays frozen
      // until the user somehow knows to fully close and relaunch the app.
      // Re-navigating to the same URL serves the fresh copy this worker just
      // precached, so recovery happens on the FIRST open after a deploy.
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then(wins => Promise.all(
        wins.filter(w => new URL(w.url).pathname === '/launch.html')
            .map(w => w.navigate(w.url).catch(() => {}))
      ))
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

  // Same-origin guard: only ever navigate within our own origin. Push payloads are
  // VAPID-signed (server-authored), so data.url is not attacker-controlled today, but
  // resolving an absolute/cross-origin URL here would be an open-redirect if that ever
  // changed. Accept only a same-origin path; otherwise fall back to the dashboard.
  let targetUrl = '/dashboard';
  if (event.notification.data && event.notification.data.url) {
    try {
      const resolved = new URL(event.notification.data.url, self.location.origin);
      if (resolved.origin === self.location.origin) {
        targetUrl = resolved.pathname + resolved.search;
      }
    } catch (e) {
      // malformed url -> keep the default
    }
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
