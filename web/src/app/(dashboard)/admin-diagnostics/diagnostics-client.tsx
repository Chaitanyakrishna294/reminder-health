'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { 
  Activity, 
  ShieldAlert, 
  CheckCircle, 
  AlertTriangle, 
  RefreshCw, 
  ArrowLeft,
  Smartphone,
  Globe,
  Trash2,
  Send
} from 'lucide-react';
import Link from 'next/link';
import LoadingMark from '@/components/ui/loading-mark';

/**
 * The console's palette.
 *
 * This page is a deliberately dark, terminal-style diagnostics console — it is NOT
 * theme-aware and must stay dark in light mode too, which is why it never used the app's
 * semantic tokens: none of them describe a surface that ignores the theme. It expressed
 * that with ~119 scattered raw Tailwind palette classes (`bg-slate-950`,
 * `text-emerald-400`, …), which DESIGN_SYSTEM.md forbids — a colour with no name is a
 * colour with no meaning.
 *
 * These are the SAME hex values those Tailwind stops resolve to, so the console renders
 * exactly as before; they just have names now, and live in one place instead of 119.
 *
 * Shipped as INLINE custom properties rather than a `.admin-console` rule in globals.css:
 * a rule containing only custom properties is stripped from that file during the Tailwind
 * build (verified — the declarations never reached the served stylesheet, which would
 * have left every colour here unresolved). The loading-mark keyframes hit the same wall;
 * see the note in components/ui/loading-mark.tsx.
 */
const CONSOLE_PALETTE = {
  '--con-bg': '#020617',                        // slate-950
  '--con-bg-80': 'rgba(2, 6, 23, 0.8)',
  '--con-surface': '#0f172a',                   // slate-900
  '--con-surface-60': 'rgba(15, 23, 42, 0.6)',
  '--con-raised': '#1e293b',                    // slate-800
  '--con-raised-50': 'rgba(30, 41, 59, 0.5)',
  '--con-raised-20': 'rgba(30, 41, 59, 0.2)',
  '--con-line': '#1e293b',
  '--con-line-80': 'rgba(30, 41, 59, 0.8)',
  '--con-line-60': 'rgba(30, 41, 59, 0.6)',

  '--con-ink': '#f1f5f9',                       // slate-100
  '--con-ink-2': '#e2e8f0',                     // slate-200
  '--con-ink-3': '#cbd5e1',                     // slate-300
  '--con-muted': '#94a3b8',                     // slate-400
  '--con-muted-2': '#64748b',                   // slate-500
  '--con-muted-3': '#475569',                   // slate-600
  '--con-muted-10': 'rgba(100, 116, 139, 0.1)',

  // Status. Same meanings as the app's tone system, tuned for a near-black surface
  // rather than for the app's navy / off-white ones.
  '--con-ok': '#34d399',                        // emerald-400
  '--con-ok-10': 'rgba(16, 185, 129, 0.1)',
  '--con-ok-5': 'rgba(16, 185, 129, 0.05)',
  '--con-warn': '#fbbf24',                      // amber-400
  '--con-warn-10': 'rgba(245, 158, 11, 0.1)',
  '--con-warn-5': 'rgba(245, 158, 11, 0.05)',
  '--con-err': '#f87171',                       // red-400
  '--con-err-strong': '#ef4444',                // red-500
  '--con-err-10': 'rgba(239, 68, 68, 0.1)',
  '--con-err-5': 'rgba(239, 68, 68, 0.05)',
  '--con-err-deep-40': 'rgba(69, 10, 10, 0.4)', // red-950/40
  '--con-err-deep-20': 'rgba(69, 10, 10, 0.2)',
  '--con-err-line-30': 'rgba(127, 29, 29, 0.3)',
  '--con-info': '#818cf8',                      // indigo-400
  '--con-info-10': 'rgba(99, 102, 241, 0.1)',
  '--con-info-5': 'rgba(99, 102, 241, 0.05)',
  '--con-accent': '#2dd4bf',                    // teal-400
  '--con-accent-10': 'rgba(20, 184, 166, 0.1)',
  '--con-accent-5': 'rgba(20, 184, 166, 0.05)',
  '--con-accent-line-30': 'rgba(20, 184, 166, 0.3)',
  '--con-cyan': '#22d3ee',                      // cyan-400
  '--con-cyan-10': 'rgba(6, 182, 212, 0.1)',
} as React.CSSProperties;

interface PushLog {
  id: number;
  user_id: string;
  status: 'SENT' | 'DISPLAYED' | 'OPENED' | 'EXPIRED' | 'FAILED';
  gateway: string | null;
  error_message: string | null;
  created_at: string;
  profiles?: {
    full_name: string | null;
  } | null;
}

export default function AdminDiagnosticsPage() {
  const router = useRouter();
  const supabase = createClient();
  
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [stats, setStats] = useState({
    activeSubscriptions: 0,
    totalSent: 0,
    sentCount: 0,
    displayedCount: 0,
    openedCount: 0,
    failedCount: 0,
    expiredCount: 0,
    deliveryRate: 100,
    openRate: 0,
    lastPushTime: null as string | null,
  });
  const [adherenceStats, setAdherenceStats] = useState({
    takenImmediately: 0,
    takenAfterReview: 0,
    skippedImmediately: 0,
    skippedAfterReview: 0,
    neverConfirmed: 0,
    channelCounts: {
      WEB_DASHBOARD: 0,
      PUSH_NOTIFICATION: 0,
      TELEGRAM: 0,
      REVIEW_QUEUE: 0,
      CAREGIVER_CONSOLE: 0,
    } as Record<string, number>,
  });
  const [logs, setLogs] = useState<PushLog[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState<NodeJS.Timeout | null>(null);

  const fetchDiagnostics = useCallback(async () => {
    try {
      // Cross-user telemetry comes from the ADMIN_EMAILS-gated service-role route;
      // push_logs RLS no longer allows reading other users' rows from the browser.
      const res = await fetch('/api/admin/diagnostics');
      if (res.status === 403) {
        router.push('/dashboard');
        return;
      }
      if (!res.ok) throw new Error(`Diagnostics fetch failed (${res.status})`);
      const { subCount, logs: logsData, statusRows: allStatsLogs, adhEvents } = (await res.json()) as {
        subCount: number;
        logs: PushLog[];
        statusRows: { status: string; created_at: string }[];
        adhEvents: { reminder_status: string; reviewed_from_status: string | null; resolution_channel: string | null }[];
      };

      const typedLogs = (logsData || []) as any[] as PushLog[];
      setLogs(typedLogs);

      const total = allStatsLogs?.length || 0;
      const sent = allStatsLogs?.filter(l => l.status === 'SENT').length || 0;
      const displayed = allStatsLogs?.filter(l => l.status === 'DISPLAYED').length || 0;
      const opened = allStatsLogs?.filter(l => l.status === 'OPENED').length || 0;
      const failed = allStatsLogs?.filter(l => l.status === 'FAILED').length || 0;
      const expired = allStatsLogs?.filter(l => l.status === 'EXPIRED').length || 0;
      
      const lastPush = allStatsLogs && allStatsLogs.length > 0 
        ? allStatsLogs[0].created_at 
        : null;

      setStats({
        activeSubscriptions: subCount || 0,
        totalSent: total,
        sentCount: sent,
        displayedCount: displayed,
        openedCount: opened,
        failedCount: failed,
        expiredCount: expired,
        deliveryRate: sent > 0 ? parseFloat(((displayed / sent) * 100).toFixed(1)) : 100,
        openRate: sent > 0 ? parseFloat(((opened / sent) * 100).toFixed(1)) : 0,
        lastPushTime: lastPush,
      });

      // 30-day medication events for adherence outcomes (from the same admin route)
      let takenImmediately = 0;
      let takenAfterReview = 0;
      let skippedImmediately = 0;
      let skippedAfterReview = 0;
      let neverConfirmed = 0;
      
      const channelCounts = {
        WEB_DASHBOARD: 0,
        PUSH_NOTIFICATION: 0,
        TELEGRAM: 0,
        REVIEW_QUEUE: 0,
        CAREGIVER_CONSOLE: 0,
      };

      (adhEvents || []).forEach((event: { reminder_status: string; reviewed_from_status: string | null; resolution_channel: string | null }) => {
        const status = event.reminder_status;
        const fromStatus = event.reviewed_from_status;
        
        if (status === 'TAKEN') {
          if (fromStatus === 'UNCONFIRMED') {
            takenAfterReview++;
          } else {
            takenImmediately++;
          }
        } else if (status === 'SKIPPED') {
          if (fromStatus === 'UNCONFIRMED') {
            skippedAfterReview++;
          } else {
            skippedImmediately++;
          }
        } else if (status === 'UNCONFIRMED') {
          neverConfirmed++;
        }

        const channel = event.resolution_channel;
        if (channel && channel in channelCounts) {
          channelCounts[channel as keyof typeof channelCounts]++;
        }
      });

      setAdherenceStats({
        takenImmediately,
        takenAfterReview,
        skippedImmediately,
        skippedAfterReview,
        neverConfirmed,
        channelCounts,
      });

    } catch (err) {
      console.error('Failed to fetch diagnostics:', err);
    } finally {
      setLoading(false);
    }
  }, [router]);

  // Check authentication
  useEffect(() => {
    const checkAuth = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
      } else {
        setAuthorized(true);
        fetchDiagnostics();
      }
    };
    checkAuth();
  }, [supabase, router, fetchDiagnostics]);

  // Handle auto refresh toggle
  useEffect(() => {
    if (autoRefresh) {
      const interval = setInterval(() => {
        fetchDiagnostics();
      }, 5000);
      setRefreshInterval(interval);
    } else {
      if (refreshInterval) {
        clearInterval(refreshInterval);
        setRefreshInterval(null);
      }
    }
    return () => {
      if (refreshInterval) clearInterval(refreshInterval);
    };
  }, [autoRefresh, fetchDiagnostics]);

  const handleClearLogs = async () => {
    if (!confirm('Are you sure you want to purge all notification diagnostic logs?')) return;
    try {
      setLoading(true);
      const res = await fetch('/api/admin/diagnostics', { method: 'DELETE' });
      if (!res.ok) throw new Error(`Purge failed (${res.status})`);
      fetchDiagnostics();
    } catch (err) {
      alert('Failed to clear logs: ' + (err as Error).message);
      setLoading(false);
    }
  };

  if (!authorized || loading && logs.length === 0) {
    return (
      <div style={CONSOLE_PALETTE} className="min-h-screen bg-[var(--con-bg)] flex flex-col items-center justify-center text-[var(--con-ink)] p-6">
        <LoadingMark size={48} className="text-[var(--con-accent)] mb-4" />
        <p className="text-sm text-[var(--con-muted)]">Loading push diagnostics telemetry…</p>
      </div>
    );
  }

  return (
    <div style={CONSOLE_PALETTE} className="min-h-screen bg-[var(--con-bg)] text-[var(--con-ink)] font-sans pb-12">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-[var(--con-bg-80)] backdrop-blur-md border-b border-[var(--con-line-80)] px-6 py-4">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="p-2 hover:bg-[var(--con-raised-50)] rounded-xl transition-all border border-transparent hover:border-[var(--con-line)] text-[var(--con-muted)] hover:text-[var(--con-ink)]">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[var(--con-accent)] animate-pulse" />
                <h1 className="text-xl font-bold tracking-tight text-white">Push Notification Diagnostics</h1>
              </div>
              <p className="text-xs text-[var(--con-muted)]">Real-time gateway telemetry and active subscription tracking</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 items-center w-full sm:w-auto">
            {/* Auto Refresh Toggle */}
            <button 
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                autoRefresh 
                  ? 'bg-[var(--con-accent-10)] border-[var(--con-accent-line-30)] text-[var(--con-accent)]' 
                  : 'bg-[var(--con-surface)] border-[var(--con-line)] text-[var(--con-muted)] hover:text-[var(--con-ink-2)]'
              }`}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${autoRefresh ? 'animate-spin' : ''}`} />
              Auto-Refresh (5s)
            </button>

            {/* Manual Refresh */}
            <button 
              onClick={fetchDiagnostics}
              className="flex items-center gap-2 bg-[var(--con-surface)] hover:bg-[var(--con-raised)] border border-[var(--con-line)] px-3 py-1.5 rounded-lg text-xs font-semibold text-[var(--con-ink-2)] transition-all"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Force Sync
            </button>

            {/* Purge Logs */}
            <button 
              onClick={handleClearLogs}
              className="flex items-center gap-2 bg-[var(--con-err-deep-20)] hover:bg-[var(--con-err-deep-40)] border border-[var(--con-err-line-30)] px-3 py-1.5 rounded-lg text-xs font-semibold text-[var(--con-err)] transition-all"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Purge Logs
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-6 mt-8">
        
        {/* Metrics Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          
          {/* Active Subscriptions */}
          <div className="bg-[var(--con-surface-60)] border border-[var(--con-line-80)] rounded-2xl p-5 flex flex-col justify-between">
            <div>
              <span className="text-xs text-[var(--con-muted)] font-semibold tracking-wide uppercase">Active Devices</span>
              <h2 className="text-3xl font-extrabold text-white mt-2">{stats.activeSubscriptions}</h2>
            </div>
            <div className="flex items-center gap-2 mt-4 text-xs text-[var(--con-accent)] bg-[var(--con-accent-5)] px-2.5 py-1 rounded-lg w-max font-medium">
              <Smartphone className="h-3.5 w-3.5" />
              Registered PWAs
            </div>
          </div>

          {/* Delivery Rate */}
          <div className="bg-[var(--con-surface-60)] border border-[var(--con-line-80)] rounded-2xl p-5 flex flex-col justify-between">
            <div>
              <span className="text-xs text-[var(--con-muted)] font-semibold tracking-wide uppercase">7d Delivery Rate</span>
              <h2 className="text-3xl font-extrabold text-white mt-2">{stats.deliveryRate}%</h2>
            </div>
            <div className={`flex items-center gap-2 mt-4 text-xs px-2.5 py-1 rounded-lg w-max font-medium ${
              stats.deliveryRate >= 90 
                ? 'text-[var(--con-ok)] bg-[var(--con-ok-5)]' 
                : stats.deliveryRate >= 70 
                ? 'text-[var(--con-warn)] bg-[var(--con-warn-5)]' 
                : 'text-[var(--con-err)] bg-[var(--con-err-5)]'
            }`}>
              <CheckCircle className="h-3.5 w-3.5" />
              {stats.displayedCount} / {stats.sentCount} Pushes Displayed
            </div>
          </div>

          {/* Open Rate */}
          <div className="bg-[var(--con-surface-60)] border border-[var(--con-line-80)] rounded-2xl p-5 flex flex-col justify-between">
            <div>
              <span className="text-xs text-[var(--con-muted)] font-semibold tracking-wide uppercase">7d Open Rate</span>
              <h2 className="text-3xl font-extrabold text-white mt-2">{stats.openRate}%</h2>
            </div>
            <div className="flex items-center gap-2 mt-4 text-xs text-[var(--con-info)] bg-[var(--con-info-5)] px-2.5 py-1 rounded-lg w-max font-medium">
              <Activity className="h-3.5 w-3.5" />
              {stats.openedCount} / {stats.sentCount} Pushes Opened
            </div>
          </div>

          {/* Failures & Expirations */}
          <div className="bg-[var(--con-surface-60)] border border-[var(--con-line-80)] rounded-2xl p-5 flex flex-col justify-between">
            <div>
              <span className="text-xs text-[var(--con-muted)] font-semibold tracking-wide uppercase">7d Rejections & Expirations</span>
              <h2 className="text-3xl font-extrabold text-white mt-2">
                {stats.failedCount + stats.expiredCount}
              </h2>
            </div>
            <div className="flex items-center gap-2 mt-4 text-xs text-[var(--con-warn)] bg-[var(--con-warn-5)] px-2.5 py-1 rounded-lg w-max font-medium">
              <AlertTriangle className="h-3.5 w-3.5" />
              Failed: {stats.failedCount} | Expired: {stats.expiredCount}
            </div>
          </div>

        </div>

        {/* Adherence Outcomes Section */}
        <div className="mt-8 space-y-6">
          <div>
            <h3 className="text-base font-bold text-white">Medication Adherence & Confirmation Outcomes</h3>
            <p className="text-xs text-[var(--con-muted)]">Analysis of critical grace-period outcomes and late-resolution channels (30-day window)</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            {/* Outcome Segments */}
            <div className="md:col-span-2 bg-[var(--con-surface-60)] border border-[var(--con-line-80)] rounded-2xl p-6 space-y-6">
              <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--con-muted)]">Adherence Segmentations</h4>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-[var(--con-bg)] p-4 rounded-xl border border-[var(--con-line-60)] flex flex-col justify-between">
                  <span className="text-[10px] text-[var(--con-muted)] font-bold tracking-wider uppercase">Taken Immediately</span>
                  <p className="text-2xl font-black text-[var(--con-ok)] mt-1">{adherenceStats.takenImmediately}</p>
                  <p className="text-[9px] text-[var(--con-muted-2)] mt-2 font-medium">Logged within grace periods</p>
                </div>

                <div className="bg-[var(--con-bg)] p-4 rounded-xl border border-[var(--con-line-60)] flex flex-col justify-between">
                  <span className="text-[10px] text-[var(--con-muted)] font-bold tracking-wider uppercase">Taken After Review</span>
                  <p className="text-2xl font-black text-[var(--con-accent)] mt-1">{adherenceStats.takenAfterReview}</p>
                  <p className="text-[9px] text-[var(--con-muted-2)] mt-2 font-medium">Resolved late via review queue</p>
                </div>

                <div className="bg-[var(--con-bg)] p-4 rounded-xl border border-[var(--con-line-60)] flex flex-col justify-between">
                  <span className="text-[10px] text-[var(--con-muted)] font-bold tracking-wider uppercase">Skipped After Review</span>
                  <p className="text-2xl font-black text-[var(--con-warn)] mt-1">{adherenceStats.skippedAfterReview}</p>
                  <p className="text-[9px] text-[var(--con-muted-2)] mt-2 font-medium">Logged late as skipped dose</p>
                </div>

                <div className="bg-[var(--con-bg)] p-4 rounded-xl border border-[var(--con-line-60)] flex flex-col justify-between">
                  <span className="text-[10px] font-bold tracking-wider uppercase text-[var(--con-err)]">Never Confirmed</span>
                  <p className="text-2xl font-black text-[var(--con-err-strong)] mt-1">{adherenceStats.neverConfirmed}</p>
                  <p className="text-[9px] text-[var(--con-muted-2)] mt-2 font-medium">Remaining in unconfirmed history</p>
                </div>
              </div>
            </div>

            {/* Resolution Channel breakdown */}
            <div className="bg-[var(--con-surface-60)] border border-[var(--con-line-80)] rounded-2xl p-6 space-y-6">
              <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--con-muted)]">Confirmation Channels</h4>
              
              <div className="space-y-4">
                {Object.entries(adherenceStats.channelCounts).map(([channel, count]) => {
                  const totalResolutions = Object.values(adherenceStats.channelCounts).reduce((a, b) => a + b, 0);
                  const pct = totalResolutions > 0 ? Math.round((count / totalResolutions) * 100) : 0;
                  
                  const channelLabels: Record<string, string> = {
                    WEB_DASHBOARD: 'Web Patient Dashboard',
                    PUSH_NOTIFICATION: 'Patient Browser Push',
                    TELEGRAM: 'Telegram Chat Bot',
                    REVIEW_QUEUE: 'Medication Review Queue',
                    CAREGIVER_CONSOLE: 'Caregiver Console',
                  };

                  return (
                    <div key={channel} className="space-y-1">
                      <div className="flex justify-between items-center text-[11px] font-semibold text-[var(--con-ink-3)]">
                        <span>{channelLabels[channel] || channel}</span>
                        <span className="text-white font-mono">{count} ({pct}%)</span>
                      </div>
                      <div className="w-full bg-[var(--con-bg)] rounded-full h-1.5 overflow-hidden">
                        <div 
                          className="bg-[var(--con-accent)] h-1.5 rounded-full transition-all duration-500" 
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

          </div>
        </div>

        {/* Audit Trail Section */}
        <div className="mt-8">
          <div className="bg-[var(--con-surface-60)] border border-[var(--con-line-80)] rounded-2xl overflow-hidden">
            <div className="px-6 py-5 border-b border-[var(--con-line)] flex justify-between items-center">
              <div>
                <h3 className="text-base font-bold text-white">Recent Dispatch Audit Trail</h3>
                <p className="text-xs text-[var(--con-muted)]">Chronological list of the last 50 browser push dispatches</p>
              </div>
              <div className="text-xs text-[var(--con-muted)] font-semibold">
                Last push event:{' '}
                <span className="text-[var(--con-ink-2)]">
                  {stats.lastPushTime ? new Date(stats.lastPushTime).toLocaleTimeString() : 'Never'}
                </span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[var(--con-surface)] border-b border-[var(--con-line)] text-xs font-semibold text-[var(--con-muted)] tracking-wider">
                    <th className="px-6 py-3.5">Timestamp</th>
                    <th className="px-6 py-3.5">Recipient</th>
                    <th className="px-6 py-3.5">Status</th>
                    <th className="px-6 py-3.5">Gateway Vendor</th>
                    <th className="px-6 py-3.5">Error Detail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--con-line-60)] text-xs">
                  {logs.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-12 text-center text-[var(--con-muted-2)]">
                        No push log dispatches found. Trigger a medication event to start logging.
                      </td>
                    </tr>
                  ) : (
                    logs.map((log) => {
                      const statusColors: Record<PushLog['status'], { bg: string, text: string, dot: string }> = {
                        SENT: { bg: 'bg-[var(--con-cyan-10)]', text: 'text-[var(--con-cyan)]', dot: 'bg-[var(--con-cyan)]' },
                        DISPLAYED: { bg: 'bg-[var(--con-info-10)]', text: 'text-[var(--con-info)]', dot: 'bg-[var(--con-info)]' },
                        OPENED: { bg: 'bg-[var(--con-ok-10)]', text: 'text-[var(--con-ok)]', dot: 'bg-[var(--con-ok)]' },
                        EXPIRED: { bg: 'bg-[var(--con-warn-10)]', text: 'text-[var(--con-warn)]', dot: 'bg-[var(--con-warn)]' },
                        FAILED: { bg: 'bg-[var(--con-err-10)]', text: 'text-[var(--con-err)]', dot: 'bg-[var(--con-err)]' },
                      };
                      const color = statusColors[log.status] || { bg: 'bg-[var(--con-muted-10)]', text: 'text-[var(--con-muted)]', dot: 'bg-[var(--con-muted)]' };
                      
                      return (
                        <tr key={log.id} className="hover:bg-[var(--con-raised-20)] transition-all">
                          <td className="px-6 py-4 text-[var(--con-ink-3)] font-mono whitespace-nowrap">
                            {new Date(log.created_at).toLocaleString()}
                          </td>
                          <td className="px-6 py-4 font-medium text-[var(--con-ink-2)]">
                            {log.profiles?.full_name || 'System User'}
                            <div className="text-[10px] text-[var(--con-muted-2)] font-mono">{log.user_id.slice(0, 8)}...</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${color.bg} ${color.text}`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${color.dot}`} />
                              {log.status}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-[var(--con-muted)] font-mono">
                            {log.gateway || 'N/A'}
                          </td>
                          <td className="px-6 py-4 text-[var(--con-muted)] max-w-[240px] truncate hover:whitespace-normal hover:break-all transition-all">
                            {log.error_message || <span className="text-[var(--con-muted-3)]">-</span>}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

      </main>
    </div>
  );
}
