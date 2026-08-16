'use client';

/**
 * THE NOTIFICATIONS PAGE — replaces the top-bar dropdown.
 *
 * The dropdown was a 256px-tall scroller holding twenty messages, with a delete icon
 * the size of a fingernail on every row and no way to act on more than one at a time.
 * It was also an overlay, so reading it meant covering the thing it was telling you
 * about. This is the same data with room to breathe.
 *
 * DELETION HAS TWO DOORS ON PURPOSE. Long-press is the gesture people expect from
 * their phone's own apps; a visible "Select" button is the one that actually works
 * for someone with a tremor, long nails, or a screen protector — and long-press is
 * unreachable by keyboard entirely. Neither is a fallback for the other; they are
 * both primary.
 *
 * DELETING REMOVES THE MESSAGE, NOT THE RECORD. `notifications` rows are a delivery
 * log. Dose history lives in `reminder_events` / `reminder_logs` and nothing here
 * touches it. The confirm says so, because "delete" on a screen of medication
 * messages is a frightening word for the audience least able to test what it means.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Bell, Check, SkipForward, XCircle, AlertTriangle, Heart, PackagePlus,
  Trash2, CheckSquare, Square, X, MailOpen, SlidersHorizontal,
} from 'lucide-react';
import { useRealtimeNotifications, type Notification } from '@/hooks/use-realtime-notifications';
import { useUiMode } from '@/context/ui-mode-context';
import { dayKeyForDose, timeOfDayForDose } from '@/lib/design/slots';
import { notificationMeta, notificationTarget, type NotificationMeta } from '@/lib/design/notification-kinds';
import BrainMascot from '@/components/dashboard/brain-mascot';
import { mascotSlot } from '@/components/dashboard/mascot-slots';

/** The page holds real history, not a badge's worth. */
const PAGE_LIMIT = 200;
/** Long enough not to fire while scrolling, short enough to feel deliberate. */
const LONG_PRESS_MS = 500;

const ICONS: Record<NotificationMeta['icon'], typeof Bell> = {
  check: Check,
  skip: SkipForward,
  missed: XCircle,
  alert: AlertTriangle,
  heart: Heart,
  stock: PackagePlus,
  bell: Bell,
};

/** Tone → surface tint + on-tint text. `-strong` throughout: these are ICONS on a
 *  15% wash, and the plain token fails 4.5:1 there (the contrast bug this project
 *  has already shipped twice). */
const TONE_CLASS: Record<string, string> = {
  success: 'bg-success/15 text-success-strong',
  warning: 'bg-warning/15 text-warning-strong',
  danger: 'bg-danger/15 text-danger-strong',
  primary: 'bg-primary/15 text-primary-strong',
  info: 'bg-info/15 text-info-strong',
  neutral: 'bg-muted text-muted-foreground',
};

export default function NotificationsClientView({
  userId,
  referenceTimeZone,
}: {
  userId: string;
  referenceTimeZone: string | null;
}) {
  const { notifications, markAllAsRead, deleteMany, clearAll } =
    useRealtimeNotifications(userId, PAGE_LIMIT);
  const { isElderly } = useUiMode();
  const router = useRouter();

  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [mounted, setMounted] = useState(false);

  /**
   * Which rows were unread when the page opened.
   *
   * Opening the page marks them read in the database immediately — that is what
   * clears the bell's badge — but they keep their unread styling for this visit.
   * Marking them read AND hiding that they were new in the same frame means the one
   * thing the user came to see, which of these is new, never appears.
   *
   * State, not a ref: this is read during render to style each row, and a ref read
   * during render is exactly what the React compiler refuses (it cannot know to
   * re-render when the ref changes, so the styling would depend on whatever else
   * happened to re-render).
   */
  const [unreadOnOpen, setUnreadOnOpen] = useState<ReadonlySet<string> | null>(null);

  useEffect(() => {
    // State set from a callback, not synchronously in the effect body: the latter is
    // a cascading render and React's lint flags it.
    const t = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!mounted || unreadOnOpen !== null || notifications.length === 0) return;
    const unread = notifications.filter((n) => !n.is_read).map((n) => n.id);
    const t = setTimeout(() => {
      // Snapshot first, then mark read. markAllAsRead updates the hook's list, which
      // re-runs this effect — the non-null snapshot is what stops it looping.
      setUnreadOnOpen(new Set(unread));
      if (unread.length > 0) markAllAsRead();
    }, 0);
    return () => clearTimeout(t);
    // markAllAsRead is recreated each render by the hook; depending on it would
    // re-mark on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, notifications, unreadOnOpen]);

  const wasUnread = (id: string) => unreadOnOpen?.has(id) ?? false;
  /** Live unread — i.e. arrived since this page opened. See the button's note. */
  const hasUnread = notifications.some((n) => !n.is_read);

  // ── Grouping ──────────────────────────────────────────────────────────────
  // Same day-key rule as the rail (lib/design/slots.ts), so a notification about a
  // 01:40 dose lands on the day the rail files that dose under, not the UTC day.
  const groups = useMemo(() => {
    const byDay = new Map<string, Notification[]>();
    for (const n of notifications) {
      // Group by when the dose was DUE where we know it; the row's own
      // created_at is only a stand-in for older rows.
      const key = dayKeyForDose(n.scheduled_for || n.created_at, referenceTimeZone) ?? '';
      if (!key) continue;
      const bucket = byDay.get(key);
      if (bucket) bucket.push(n);
      else byDay.set(key, [n]);
    }
    // Newest day first; the hook already returns rows newest-first within a day.
    return [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [notifications, referenceTimeZone]);

  const todayKey = mounted ? dayKeyForDose(new Date().toISOString(), referenceTimeZone) : null;

  const dayLabel = (key: string) => {
    if (key === todayKey) return 'Today';
    const at = new Date(Date.UTC(
      Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)), 12,
    ));
    if (todayKey) {
      const yesterday = new Date(Date.UTC(
        Number(todayKey.slice(0, 4)), Number(todayKey.slice(5, 7)) - 1, Number(todayKey.slice(8, 10)), 12,
      ) - 86_400_000);
      if (at.getTime() === yesterday.getTime()) return 'Yesterday';
    }
    return at.toLocaleDateString('en-GB', {
      weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
    });
  };

  // ── Selection ─────────────────────────────────────────────────────────────
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const exitSelection = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressedId = useRef<string | null>(null);
  const cancelPress = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
    pressedId.current = null;
  };
  const startPress = (id: string) => {
    cancelPress();
    pressedId.current = id;
    pressTimer.current = setTimeout(() => {
      // Entering selection mode selects the row you pressed — a long-press that
      // selected nothing would make you press it again to do the obvious thing.
      setSelecting(true);
      setSelected(new Set([id]));
      pressTimer.current = null;
    }, LONG_PRESS_MS);
  };
  useEffect(() => cancelPress, []);

  /**
   * Every notification now has somewhere to go — see notificationTarget. A dose
   * row written since migration_notification_targets_2026_08_14 carries its own
   * medication and instant, so the link names the day AND the dose and the
   * dashboard rings that card; older rows keep the created_at approximation and
   * simply open the day.
   */
  const openNotification = (n: Notification) => {
    router.push(notificationTarget(n, (iso) => dayKeyForDose(iso, referenceTimeZone)));
  };

  const confirmDeleteSelected = () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    const what = ids.length === 1 ? 'this notification' : `these ${ids.length} notifications`;
    if (!window.confirm(`Delete ${what}?\n\nThis won't change your dose history.`)) return;
    deleteMany(ids);
    exitSelection();
  };

  const confirmClearAll = () => {
    if (notifications.length === 0) return;
    if (!window.confirm("Delete all notifications?\n\nThis won't change your dose history.")) return;
    clearAll();
    exitSelection();
  };

  const btn = `inline-flex items-center justify-center gap-1.5 rounded-full font-bold cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
    isElderly ? 'min-h-14 px-5 text-base' : 'min-h-11 px-4 text-xs'
  }`;

  return (
    <div className={`max-w-3xl mx-auto space-y-5 ${isElderly ? 'p-2 space-y-8' : ''}`}>
      <header className="flex items-start justify-between gap-3 flex-wrap px-1">
        {/* No PageBack here: DashboardMainLayout renders one above every sub-page,
            so a local copy would show two arrows stacked. */}
        <div className="min-w-0">
          <h1 className={`font-black text-foreground tracking-tight ${isElderly ? 'text-4xl' : 'title-page'}`}>
            Notifications
          </h1>
          <p className={`text-muted-foreground font-semibold ${isElderly ? 'text-xl mt-2' : 'text-xs mt-1'}`}>
            {selecting
              ? `${selected.size} selected`
              : 'Messages about your doses and your care circle.'}
          </p>
          {/* The question this page provokes is "can I get fewer of these?", and
              until now it had no answer on screen — you had to know the setting
              existed and go looking for it in another section. */}
          {!selecting && (
            <Link
              href="/settings/notifications"
              className={`mt-2 inline-flex items-center gap-1.5 font-bold text-primary-strong hover:underline min-h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-lg ${isElderly ? 'text-lg' : 'text-xs'}`}
            >
              <SlidersHorizontal className={isElderly ? 'w-5 h-5' : 'w-3.5 h-3.5'} aria-hidden />
              Choose what you get notified about
            </Link>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {selecting ? (
            <>
              <button type="button" onClick={exitSelection} className={`${btn} border border-border text-foreground hover:bg-muted`}>
                <X className={isElderly ? 'w-5 h-5' : 'w-4 h-4'} aria-hidden /> Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeleteSelected}
                disabled={selected.size === 0}
                className={`${btn} bg-danger-solid text-danger-solid-foreground hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                <Trash2 className={isElderly ? 'w-5 h-5' : 'w-4 h-4'} aria-hidden /> Delete ({selected.size})
              </button>
            </>
          ) : (
            notifications.length > 0 && (
              <>
                {/* The visible door to selection. Long-press is the gesture people
                    expect, but it is unreliable with a tremor and impossible from a
                    keyboard, so this is not a fallback — it is the reliable one. */}
                <button type="button" onClick={() => setSelecting(true)} className={`${btn} border border-border text-foreground hover:bg-muted`}>
                  <CheckSquare className={isElderly ? 'w-5 h-5' : 'w-4 h-4'} aria-hidden /> Select
                </button>
                {/* ONLY when something is genuinely unread — which, on this page,
                    means a message that ARRIVED while it was open. Opening the page
                    already marks everything read (that is what clears the bell), so
                    a permanent button here would be a control with nothing to do
                    999 times out of 1000, and a disabled one would be worse: it
                    would look like a feature that is broken. */}
                {hasUnread && (
                  <button type="button" onClick={markAllAsRead} className={`${btn} border border-border text-foreground hover:bg-muted`}>
                    <MailOpen className={isElderly ? 'w-5 h-5' : 'w-4 h-4'} aria-hidden /> Mark all as read
                  </button>
                )}
                <button type="button" onClick={confirmClearAll} className={`${btn} text-danger-strong hover:bg-danger/10`}>
                  Clear all
                </button>
              </>
            )
          )}
        </div>
      </header>

      {notifications.length === 0 ? (
        /* Remi's empty-state slot. `peaceful` — an empty inbox is a good outcome,
           not an error, and the calm rule says the mascot never escalates a
           non-event. No call to action: there is nothing here to do. */
        <div className="px-6 py-10 flex flex-col items-center text-center gap-5 bg-card/60 rounded-[var(--r-card)] border border-dashed border-border/80">
          <BrainMascot {...mascotSlot('emptyState', isElderly)} />
          <p className={`text-muted-foreground font-semibold text-balance ${isElderly ? 'text-lg' : 'text-base'}`}>
            No notifications — all caught up.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map(([key, items]) => (
            <section key={key} className="space-y-2">
              <h2
                className={`font-mono uppercase tracking-[0.14em] text-muted-foreground px-1 ${isElderly ? 'text-sm' : 'text-[11px]'}`}
                suppressHydrationWarning
              >
                {dayLabel(key)}
              </h2>

              <ul className="space-y-2">
                {items.map((n) => {
                  const meta = notificationMeta(n.type);
                  const Icon = ICONS[meta.icon];
                  const isSelected = selected.has(n.id);
                  const unread = wasUnread(n.id);

                  return (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => (selecting ? toggle(n.id) : openNotification(n))}
                        onPointerDown={() => startPress(n.id)}
                        onPointerUp={cancelPress}
                        onPointerLeave={cancelPress}
                        onPointerCancel={cancelPress}
                        // A long-press on touch otherwise raises the OS text-selection
                        // menu over our own selection mode.
                        onContextMenu={(e) => { if (selecting || pressedId.current) e.preventDefault(); }}
                        aria-pressed={selecting ? isSelected : undefined}
                        className={`w-full text-left rounded-[var(--r-card)] border p-3.5 flex items-start gap-3 select-none transition-colors cursor-pointer stagger-in
                                    /* NO press-sink here, deliberately: these rows
                                       carry state TINTS rather than elevation, and
                                       press-sink resolves to lift-1 on :active — on
                                       an element with no resting shadow that reads
                                       as the row LIFTING under the finger, which is
                                       backwards. The existing colour transition is
                                       the press feedback. */
                                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background
                                    ${isSelected
                                      ? 'bg-primary-soft border-primary/40'
                                      : unread
                                        /* Unread is a tint AND a dot below — never
                                           colour alone. */
                                        ? 'bg-primary/[0.04] border-primary/20 hover:bg-muted/60'
                                        : 'bg-card border-transparent hover:bg-muted/60'}`}
                      >
                        {selecting ? (
                          <span className={`shrink-0 flex items-center justify-center ${isElderly ? 'w-12 h-12' : 'w-10 h-10'}`} aria-hidden>
                            {isSelected
                              ? <CheckSquare className={`text-primary-strong ${isElderly ? 'w-7 h-7' : 'w-5 h-5'}`} />
                              : <Square className={`text-muted-foreground ${isElderly ? 'w-7 h-7' : 'w-5 h-5'}`} />}
                          </span>
                        ) : (
                          <span
                            className={`shrink-0 rounded-[var(--r-control)] flex items-center justify-center ${TONE_CLASS[meta.tone] ?? TONE_CLASS.neutral} ${isElderly ? 'w-12 h-12' : 'w-10 h-10'}`}
                            aria-hidden
                          >
                            <Icon className={isElderly ? 'w-7 h-7' : 'w-5 h-5'} />
                          </span>
                        )}

                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className={`font-bold text-foreground truncate ${isElderly ? 'text-lg' : 'text-sm'}`}>
                              {n.title}
                            </span>
                            <span
                              className={`shrink-0 font-mono tabular-nums text-muted-foreground ${isElderly ? 'text-sm' : 'text-[11px]'}`}
                              suppressHydrationWarning
                            >
                              {timeOfDayForDose(n.scheduled_for || n.created_at, referenceTimeZone)}
                            </span>
                          </span>
                          <span className={`block text-muted-foreground leading-relaxed break-words ${isElderly ? 'text-base mt-1' : 'text-xs mt-0.5'}`}>
                            {n.message}
                          </span>
                          {unread && !selecting && (
                            <span className={`inline-flex items-center gap-1 mt-1.5 font-mono uppercase tracking-wider text-primary-strong ${isElderly ? 'text-xs' : 'text-[10px]'}`}>
                              <span className="w-1.5 h-1.5 rounded-full bg-primary-strong" aria-hidden /> New
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

          {notifications.length >= PAGE_LIMIT && (
            /* Says the list is capped instead of letting it look complete. A silent
               truncation in an adherence-adjacent log reads as "nothing else
               happened". */
            <p className="text-center text-xs text-muted-foreground font-semibold px-1">
              Showing the most recent {PAGE_LIMIT} notifications.
            </p>
          )}
        </div>
      )}

      <p className="px-1">
        <Link
          href="/dashboard"
          className={`text-primary-strong font-bold hover:underline inline-flex items-center min-h-11 ${isElderly ? 'text-base' : 'text-xs'}`}
        >
          Back to today
        </Link>
      </p>
    </div>
  );
}
