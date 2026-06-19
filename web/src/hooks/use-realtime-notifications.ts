'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';

export interface Notification {
  id: string;
  user_id: string;
  title: string;
  message: string;
  type: 'TAKEN' | 'SKIPPED' | 'MISSED' | 'ESCALATED' | 'CARE_CIRCLE_ACCESS_REQUEST' | 'CARE_CIRCLE_ACCESS_GRANTED' | 'CARE_CIRCLE_ACCESS_UPDATED' | 'CARE_CIRCLE_ACCESS_REVOKED' | 'CARE_CIRCLE_PRIMARY_CHANGED' | 'UNCONFIRMED';
  is_read: boolean;
  created_at: string;
  connection_id?: string | null;
}

export function useRealtimeNotifications(userId: string) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const supabase = createClient();

  const fetchNotifications = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;

      if (data) {
        setNotifications(data as Notification[]);
        setUnreadCount(data.filter((n) => !n.is_read).length);
      }
    } catch (err) {
      console.error('[Notifications Hook] Error fetching notifications:', err);
    }
  }, [userId, supabase]);

  useEffect(() => {
    fetchNotifications();

    // Subscribe to INSERT notifications for this specific user
    const channel = supabase
      .channel(`public:notifications:user_id=eq.${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const newNotif = payload.new as Notification;
          setNotifications((prev) => [newNotif, ...prev]);
          setUnreadCount((prev) => prev + 1);

          // Play micro audio cue (optional, using browser SpeechSynthesis or standard pop if focused)
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(newNotif.title, { body: newNotif.message });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, supabase, fetchNotifications]);

  const markAsRead = async (notificationId: string) => {
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('id', notificationId);

      if (error) throw error;

      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, is_read: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (err) {
      console.error('[Notifications Hook] Error marking as read:', err);
    }
  };

  const markAllAsRead = async () => {
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('user_id', userId)
        .eq('is_read', false);

      if (error) throw error;

      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } catch (err) {
      console.error('[Notifications Hook] Error marking all as read:', err);
    }
  };

  const deleteNotification = async (notificationId: string) => {
    // Optimistic remove; RLS (FOR ALL USING user_id = auth.uid()) permits delete.
    const removed = notifications.find((n) => n.id === notificationId);
    setNotifications((prev) => prev.filter((n) => n.id !== notificationId));
    if (removed && !removed.is_read) setUnreadCount((prev) => Math.max(0, prev - 1));
    try {
      const { error } = await supabase.from('notifications').delete().eq('id', notificationId);
      if (error) throw error;
    } catch (err) {
      console.error('[Notifications Hook] Error deleting notification:', err);
      fetchNotifications(); // resync on failure
    }
  };

  return { notifications, unreadCount, markAsRead, markAllAsRead, deleteNotification };
}
