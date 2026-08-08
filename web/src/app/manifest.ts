import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    // Stable identifier so the app keeps the same identity even if start_url changes later.
    id: '/',
    name: 'Re-MIND-eЯ | Healthcare Companion',
    short_name: 'Re-MIND-eЯ',
    description: 'Your calm, intelligent healthcare companion. Medication tracking, adherence progress, and caregiver coordination.',
    // A tiny static page sw.js pre-caches, so the installed app OPENS instantly from
    // disk with an animated splash while /dashboard server-renders behind it. The `id`
    // above keeps the app's identity stable across this change. Existing installs pick
    // up a manifest change lazily — it can take a couple of launches to apply.
    start_url: '/launch.html',
    scope: '/',
    lang: 'en',
    dir: 'ltr',
    categories: ['health', 'medical', 'lifestyle'],
    display: 'standalone',
    orientation: 'portrait',
    // Match the app's light chrome (page background) so the installed PWA's
    // splash and title bar look like the app, not off-brand teal/black.
    background_color: '#F8F9FB',
    theme_color: '#F8F9FB',
    shortcuts: [
      {
        name: 'Medications',
        short_name: 'Meds',
        url: '/medications',
        icons: [{ src: '/icon-192x192.png', sizes: '192x192', type: 'image/png' }],
      },
      {
        name: 'Schedule',
        short_name: 'Schedule',
        url: '/schedule-planner',
        icons: [{ src: '/icon-192x192.png', sizes: '192x192', type: 'image/png' }],
      },
    ],
    icons: [
      {
        src: '/icon-192x192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-maskable.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
