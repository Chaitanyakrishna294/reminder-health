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
