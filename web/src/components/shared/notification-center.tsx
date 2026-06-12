'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useRealtimeNotifications, Notification } from '@/hooks/use-realtime-notifications';
import { Bell, Check, SkipForward, AlertTriangle, XCircle, Heart } from 'lucide-react';

interface NotificationCenterProps {
  userId: string;
}

export default function NotificationCenter({ userId }: NotificationCenterProps) {
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useRealtimeNotifications(userId);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const getTypeIcon = (type: Notification['type']) => {
    switch (type) {
      case 'TAKEN':
        return { icon: <Check className="w-4 h-4 text-success" />, bg: 'bg-success/10' };
      case 'SKIPPED':
        return { icon: <SkipForward className="w-4 h-4 text-warning" />, bg: 'bg-warning/10' };
      case 'ESCALATED':
        return { icon: <AlertTriangle className="w-4 h-4 text-danger animate-pulse" />, bg: 'bg-danger/10' };
      case 'MISSED':
        return { icon: <XCircle className="w-4 h-4 text-danger" />, bg: 'bg-danger/10' };
      case 'CARE_CIRCLE_ACCESS_REQUEST':
        return { icon: <Heart className="w-4 h-4 text-primary animate-pulse" />, bg: 'bg-primary/10' };
      case 'CARE_CIRCLE_ACCESS_GRANTED':
        return { icon: <Heart className="w-4 h-4 text-success" />, bg: 'bg-success/10' };
      case 'CARE_CIRCLE_ACCESS_UPDATED':
        return { icon: <Heart className="w-4 h-4 text-warning" />, bg: 'bg-warning/10' };
      case 'CARE_CIRCLE_ACCESS_REVOKED':
        return { icon: <Heart className="w-4 h-4 text-danger" />, bg: 'bg-danger/10' };
      case 'CARE_CIRCLE_PRIMARY_CHANGED':
        return { icon: <Heart className="w-4 h-4 text-primary font-bold" />, bg: 'bg-primary/10' };
      default:
        return { icon: <Bell className="w-4 h-4 text-muted-foreground" />, bg: 'bg-muted' };
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground focus:outline-none transition-colors cursor-pointer flex items-center justify-center"
        aria-label="View notifications"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute top-0 right-0 inline-flex items-center justify-center px-1.5 py-0.5 rounded-full text-xs font-bold leading-none text-danger-foreground bg-danger transform translate-x-1/3 -translate-y-1/3">
            {unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 bg-card rounded-lg shadow-lg border border-border py-2 z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b border-border">
            <span className="font-bold text-foreground text-sm">Notifications</span>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="text-xs text-primary hover:underline font-medium cursor-pointer"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-64 overflow-y-auto divide-y divide-border">
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                No notifications yet.
              </div>
            ) : (
              notifications.map((n) => {
                const style = getTypeIcon(n.type);
                return (
                  <div
                    key={n.id}
                    className={`flex items-start p-3 gap-3 hover:bg-muted/50 transition-colors ${
                      !n.is_read ? 'bg-primary/5' : ''
                    }`}
                  >
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${style.bg}`}>
                      {style.icon}
                    </div>
                    <div className="flex-1 space-y-0.5 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-xs text-foreground truncate">{n.title}</span>
                        <span className="text-[10px] text-muted-foreground whitespace-nowrap" suppressHydrationWarning>
                          {new Date(n.created_at).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground break-words leading-relaxed">{n.message}</p>
                      {!n.is_read && n.type === 'CARE_CIRCLE_ACCESS_REQUEST' ? (
                        <button
                          onClick={() => {
                            markAsRead(n.id);
                            setIsOpen(false);
                            router.push('/care-circle/requests');
                          }}
                          className="text-[10px] text-primary hover:underline font-bold pt-1 block cursor-pointer"
                        >
                          View Request →
                        </button>
                      ) : !n.is_read && [
                        'CARE_CIRCLE_ACCESS_GRANTED',
                        'CARE_CIRCLE_ACCESS_UPDATED',
                        'CARE_CIRCLE_ACCESS_REVOKED',
                        'CARE_CIRCLE_PRIMARY_CHANGED'
                      ].includes(n.type) ? (
                        <button
                          onClick={() => {
                            markAsRead(n.id);
                            setIsOpen(false);
                            router.push('/care-circle/manage');
                          }}
                          className="text-[10px] text-primary hover:underline font-bold pt-1 block cursor-pointer"
                        >
                          Manage Shared Trust →
                        </button>
                      ) : !n.is_read ? (
                        <button
                          onClick={() => markAsRead(n.id)}
                          className="text-[10px] text-primary hover:underline font-medium pt-1 block cursor-pointer"
                        >
                          Mark as read
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
