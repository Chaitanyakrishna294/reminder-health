'use client';

/**
 * The top bar's bell. A LINK now, not a dropdown.
 *
 * It used to open a 256px overlay panel holding twenty messages, each with a
 * fingernail-sized delete icon and no way to act on two at once — and being an
 * overlay, reading it meant covering the thing it was telling you about. The list
 * lives at /notifications, which has room for the history, day grouping, and
 * selection. What stays here is the one thing a top bar is good at: a count.
 *
 * The realtime subscription stays too, so the badge still updates live without the
 * page being open.
 */

import React from 'react';
import Link from 'next/link';
import { Bell } from 'lucide-react';
import { useRealtimeNotifications } from '@/hooks/use-realtime-notifications';

interface NotificationCenterProps {
  userId: string;
}

export default function NotificationCenter({ userId }: NotificationCenterProps) {
  const { unreadCount } = useRealtimeNotifications(userId);

  return (
    <Link
      href="/notifications"
      aria-label={
        unreadCount > 0
          ? `Notifications, ${unreadCount} unread`
          : 'Notifications'
      }
      className="relative w-11 h-11 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <Bell className="w-5 h-5" aria-hidden />
      {unreadCount > 0 && (
        /* aria-hidden: the count is already in the link's accessible name, and
           reading it twice is how a badge becomes noise on a screen reader. */
        <span
          aria-hidden
          className="absolute top-0 right-0 inline-flex items-center justify-center px-1.5 py-0.5 rounded-full text-xs font-bold leading-none text-danger-solid-foreground bg-danger-solid transform translate-x-1/3 -translate-y-1/3 tabular-nums"
        >
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </Link>
  );
}
