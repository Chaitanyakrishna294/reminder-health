import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    // Stable identifier so the app keeps the same identity even if start_url changes later.
    id: '/',
    name: 'Re-MIND-eЯ | Healthcare Companion',
    short_name: 'Re-MIND-eЯ',
    description: 'Your calm, intelligent healthcare companion. Medication tracking, adherence progress, and caregiver coordination.',
    start_url: '/dashboard',
    scope: '/',
    lang: 'en',
    dir: 'ltr',
    categories: ['health', 'medical', 'lifestyle'],
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#090d16',
    theme_color: '#0d9488',
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
