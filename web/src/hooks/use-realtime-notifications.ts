'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';

export interface Notification {
  id: string;
  user_id: string;
  title: string;
  message: string;
  type: 'TAKEN' | 'SKIPPED' | 'MISSED' | 'ESCALATED' | 'CARE_CIRCLE_ACCESS_REQUEST' | 'CARE_CIRCLE_ACCESS_GRANTED' | 'CARE_CIRCLE_ACCESS_UPDATED' | 'CARE_CIRCLE_ACCESS_REVOKED' | 'CARE_CIRCLE_PRIMARY_CHANGED' | 'UNCONFIRMED' | 'LOW_STOCK';
  is_read: boolean;
  created_at: string;
  connection_id?: string | null;
}

/**
 * @param limit how many rows to hold. The bell only needs enough for a badge; the
 *   notifications PAGE is the full history, so it asks for more. Kept as a parameter
 *   rather than always fetching the maximum because the bell mounts on every
 *   dashboard route and a 200-row payload per navigation is real cost on a phone.
 */
export function useRealtimeNotifications(userId: string, limit = 20) {
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
        .limit(limit);

      if (error) throw error;

      if (data) {
        setNotifications(data as Notification[]);
        setUnreadCount(data.filter((n) => !n.is_read).length);
      }
    } catch (err) {
      console.error('[Notifications Hook] Error fetching notifications:', err);
    }
  }, [userId, supabase, limit]);

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

  /**
   * Delete several at once — the notifications page's selection mode.
   *
   * THIS REMOVES THE MESSAGE ONLY. `notifications` rows are a delivery record; the
   * dose history lives in `reminder_events` and `reminder_logs` and is not touched
   * here or by any cascade from here. The confirm copy says so out loud, because
   * "delete" on a screen full of medication messages is otherwise a frightening
   * word for exactly the audience least able to test what it does.
   */
  const deleteMany = async (ids: string[]) => {
    if (ids.length === 0) return;
    const removing = new Set(ids);
    const removedUnread = notifications.filter((n) => removing.has(n.id) && !n.is_read).length;
    setNotifications((prev) => prev.filter((n) => !removing.has(n.id)));
    setUnreadCount((prev) => Math.max(0, prev - removedUnread));
    try {
      const { error } = await supabase.from('notifications').delete().in('id', ids);
      if (error) throw error;
    } catch (err) {
      console.error('[Notifications Hook] Error deleting notifications:', err);
      fetchNotifications(); // resync on failure — an optimistic list that lied is worse than a slow one
    }
  };

  /** Clear the whole list. Scoped to this user by BOTH the filter and RLS. */
  const clearAll = async () => {
    const previous = notifications;
    setNotifications([]);
    setUnreadCount(0);
    try {
      const { error } = await supabase.from('notifications').delete().eq('user_id', userId);
      if (error) throw error;
    } catch (err) {
      console.error('[Notifications Hook] Error clearing notifications:', err);
      setNotifications(previous);
      fetchNotifications();
    }
  };

  return {
    notifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    deleteMany,
    clearAll,
    refresh: fetchNotifications,
  };
}
