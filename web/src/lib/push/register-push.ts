function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function registerPush(userChatId?: string): Promise<boolean> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('Push notifications are not supported by this browser.');
    return false;
  }

  try {
    // 1. Register service worker
    const registration = await navigator.serviceWorker.register('/sw.js');
    console.log('Service Worker registered successfully:', registration);

    // 2. Request permission
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.warn('Notification permission denied.');
      return false;
    }

    // 3. Retrieve VAPID Public Key from environment variables
    const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapidPublicKey) {
      console.error('VAPID public key is missing in client configurations.');
      return false;
    }

    const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);

    // 4. Subscribe to Push Manager
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey
    });

    console.log('Browser Push Subscription created:', subscription);

    // Detect device type based on User-Agent
    let deviceName = 'Web Browser';
    if (/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {
      deviceName = 'Mobile Device';
    } else if (/Macintosh/i.test(navigator.userAgent)) {
      deviceName = 'macOS Client';
    } else if (/Windows/i.test(navigator.userAgent)) {
      deviceName = 'Windows Client';
    } else if (/Linux/i.test(navigator.userAgent)) {
      deviceName = 'Linux Client';
    }

    // 5. Submit subscription to Supabase API endpoint
    const res = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        subscription,
        deviceName
      })
    });

    if (!res.ok) {
      throw new Error(`Failed to store push subscription on server: ${res.statusText}`);
    }

    const responseData = await res.json();
    console.log('Push subscription stored successfully:', responseData);
    if (typeof window !== 'undefined') {
      localStorage.setItem('lastPushEndpoint', subscription.endpoint);
      localStorage.setItem('lastPushRefreshTimestamp', Date.now().toString());
      if (userChatId) {
        localStorage.setItem('lastPushUserChatId', userChatId);
      }
    }
    return true;
  } catch (error) {
    console.error('Error during push notification registration:', error);
    return false;
  }
}
