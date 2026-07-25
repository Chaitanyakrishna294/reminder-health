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
      // 1. Fetch active subscriptions count
      const { count: subCount, error: subErr } = await supabase
        .from('push_subscriptions')
        .select('*', { count: 'exact', head: true });
        
      if (subErr) throw subErr;

      // 2. Fetch push logs from push_logs table
      const { data: logsData, error: logsErr } = await supabase
        .from('push_logs')
        .select(`
          id,
          user_id,
          status,
          gateway,
          error_message,
          created_at,
          profiles:user_id (
            full_name
          )
        `)
        .order('created_at', { ascending: false })
        .limit(50);

      if (logsErr) throw logsErr;

      // 3. Compute stats
      const typedLogs = (logsData || []) as any[] as PushLog[];
      setLogs(typedLogs);

      // Fetch all logs from last 7 days for aggregate metrics
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      const { data: allStatsLogs, error: statsErr } = await supabase
        .from('push_logs')
        .select('status, created_at')
        .gte('created_at', sevenDaysAgo.toISOString());

      if (statsErr) throw statsErr;

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

      // 4. Fetch 30-day medication events for adherence outcomes
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const { data: adhEvents, error: adhErr } = await supabase
        .from('reminder_events')
        .select('reminder_status, reviewed_at, reviewed_from_status, resolution_channel')
        .gte('scheduled_for', thirtyDaysAgo.toISOString());

      if (adhErr) throw adhErr;

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

      adhEvents?.forEach(event => {
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
  }, [supabase]);

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
      const { error } = await supabase.from('push_logs').delete().neq('id', 0);
      if (error) throw error;
      fetchDiagnostics();
    } catch (err) {
      alert('Failed to clear logs: ' + (err as Error).message);
      setLoading(false);
    }
  };

  if (!authorized || loading && logs.length === 0) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-100 p-6">
        <RefreshCw className="h-8 w-8 text-teal-400 animate-spin mb-4" />
        <p className="text-sm text-slate-400">Loading push diagnostics telemetry...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans pb-12">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-slate-950/80 backdrop-blur-md border-b border-slate-800/80 px-6 py-4">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="p-2 hover:bg-slate-800/50 rounded-xl transition-all border border-transparent hover:border-slate-800 text-slate-400 hover:text-slate-100">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-teal-400 animate-pulse" />
                <h1 className="text-xl font-bold tracking-tight text-white">Push Notification Diagnostics</h1>
              </div>
              <p className="text-xs text-slate-400">Real-time gateway telemetry and active subscription tracking</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 items-center w-full sm:w-auto">
            {/* Auto Refresh Toggle */}
            <button 
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                autoRefresh 
                  ? 'bg-teal-500/10 border-teal-500/30 text-teal-400' 
                  : 'bg-slate-900 border-slate-850 text-slate-400 hover:text-slate-200'
              }`}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${autoRefresh ? 'animate-spin' : ''}`} />
              Auto-Refresh (5s)
            </button>

            {/* Manual Refresh */}
            <button 
              onClick={fetchDiagnostics}
              className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-200 transition-all"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Force Sync
            </button>

            {/* Purge Logs */}
            <button 
              onClick={handleClearLogs}
              className="flex items-center gap-2 bg-red-950/20 hover:bg-red-950/40 border border-red-900/30 px-3 py-1.5 rounded-lg text-xs font-semibold text-red-400 transition-all"
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
          <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-5 flex flex-col justify-between">
            <div>
              <span className="text-xs text-slate-400 font-semibold tracking-wide uppercase">Active Devices</span>
              <h2 className="text-3xl font-extrabold text-white mt-2">{stats.activeSubscriptions}</h2>
            </div>
            <div className="flex items-center gap-2 mt-4 text-xs text-teal-400 bg-teal-500/5 px-2.5 py-1 rounded-lg w-max font-medium">
              <Smartphone className="h-3.5 w-3.5" />
              Registered PWAs
            </div>
          </div>

          {/* Delivery Rate */}
          <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-5 flex flex-col justify-between">
            <div>
              <span className="text-xs text-slate-400 font-semibold tracking-wide uppercase">7d Delivery Rate</span>
              <h2 className="text-3xl font-extrabold text-white mt-2">{stats.deliveryRate}%</h2>
            </div>
            <div className={`flex items-center gap-2 mt-4 text-xs px-2.5 py-1 rounded-lg w-max font-medium ${
              stats.deliveryRate >= 90 
                ? 'text-emerald-400 bg-emerald-500/5' 
                : stats.deliveryRate >= 70 
                ? 'text-amber-400 bg-amber-500/5' 
                : 'text-red-400 bg-red-500/5'
            }`}>
              <CheckCircle className="h-3.5 w-3.5" />
              {stats.displayedCount} / {stats.sentCount} Pushes Displayed
            </div>
          </div>

          {/* Open Rate */}
          <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-5 flex flex-col justify-between">
            <div>
              <span className="text-xs text-slate-400 font-semibold tracking-wide uppercase">7d Open Rate</span>
              <h2 className="text-3xl font-extrabold text-white mt-2">{stats.openRate}%</h2>
            </div>
            <div className="flex items-center gap-2 mt-4 text-xs text-indigo-400 bg-indigo-500/5 px-2.5 py-1 rounded-lg w-max font-medium">
              <Activity className="h-3.5 w-3.5" />
              {stats.openedCount} / {stats.sentCount} Pushes Opened
            </div>
          </div>

          {/* Failures & Expirations */}
          <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-5 flex flex-col justify-between">
            <div>
              <span className="text-xs text-slate-400 font-semibold tracking-wide uppercase">7d Rejections & Expirations</span>
              <h2 className="text-3xl font-extrabold text-white mt-2">
                {stats.failedCount + stats.expiredCount}
              </h2>
            </div>
            <div className="flex items-center gap-2 mt-4 text-xs text-amber-400 bg-amber-500/5 px-2.5 py-1 rounded-lg w-max font-medium">
              <AlertTriangle className="h-3.5 w-3.5" />
              Failed: {stats.failedCount} | Expired: {stats.expiredCount}
            </div>
          </div>

        </div>

        {/* Adherence Outcomes Section */}
        <div className="mt-8 space-y-6">
          <div>
            <h3 className="text-base font-bold text-white">Medication Adherence & Confirmation Outcomes</h3>
            <p className="text-xs text-slate-400">Analysis of critical grace-period outcomes and late-resolution channels (30-day window)</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            {/* Outcome Segments */}
            <div className="md:col-span-2 bg-slate-900/60 border border-slate-800/80 rounded-2xl p-6 space-y-6">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Adherence Segmentations</h4>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800/60 flex flex-col justify-between">
                  <span className="text-[10px] text-slate-400 font-bold tracking-wider uppercase">Taken Immediately</span>
                  <p className="text-2xl font-black text-emerald-400 mt-1">{adherenceStats.takenImmediately}</p>
                  <p className="text-[9px] text-slate-500 mt-2 font-medium">Logged within grace periods</p>
                </div>

                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800/60 flex flex-col justify-between">
                  <span className="text-[10px] text-slate-400 font-bold tracking-wider uppercase">Taken After Review</span>
                  <p className="text-2xl font-black text-teal-400 mt-1">{adherenceStats.takenAfterReview}</p>
                  <p className="text-[9px] text-slate-500 mt-2 font-medium">Resolved late via review queue</p>
                </div>

                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800/60 flex flex-col justify-between">
                  <span className="text-[10px] text-slate-400 font-bold tracking-wider uppercase">Skipped After Review</span>
                  <p className="text-2xl font-black text-amber-400 mt-1">{adherenceStats.skippedAfterReview}</p>
                  <p className="text-[9px] text-slate-500 mt-2 font-medium">Logged late as skipped dose</p>
                </div>

                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800/60 flex flex-col justify-between">
                  <span className="text-[10px] text-slate-450 font-bold tracking-wider uppercase text-red-400">Never Confirmed</span>
                  <p className="text-2xl font-black text-red-500 mt-1">{adherenceStats.neverConfirmed}</p>
                  <p className="text-[9px] text-slate-500 mt-2 font-medium">Remaining in unconfirmed history</p>
                </div>
              </div>
            </div>

            {/* Resolution Channel breakdown */}
            <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-6 space-y-6">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Confirmation Channels</h4>
              
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
                      <div className="flex justify-between items-center text-[11px] font-semibold text-slate-350">
                        <span>{channelLabels[channel] || channel}</span>
                        <span className="text-white font-mono">{count} ({pct}%)</span>
                      </div>
                      <div className="w-full bg-slate-950 rounded-full h-1.5 overflow-hidden">
                        <div 
                          className="bg-teal-400 h-1.5 rounded-full transition-all duration-500" 
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
          <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-800 flex justify-between items-center">
              <div>
                <h3 className="text-base font-bold text-white">Recent Dispatch Audit Trail</h3>
                <p className="text-xs text-slate-400">Chronological list of the last 50 browser push dispatches</p>
              </div>
              <div className="text-xs text-slate-400 font-semibold">
                Last push event:{' '}
                <span className="text-slate-200">
                  {stats.lastPushTime ? new Date(stats.lastPushTime).toLocaleTimeString() : 'Never'}
                </span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-900 border-b border-slate-800 text-xs font-semibold text-slate-400 tracking-wider">
                    <th className="px-6 py-3.5">Timestamp</th>
                    <th className="px-6 py-3.5">Recipient</th>
                    <th className="px-6 py-3.5">Status</th>
                    <th className="px-6 py-3.5">Gateway Vendor</th>
                    <th className="px-6 py-3.5">Error Detail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-xs">
                  {logs.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-12 text-center text-slate-500">
                        No push log dispatches found. Trigger a medication event to start logging.
                      </td>
                    </tr>
                  ) : (
                    logs.map((log) => {
                      const statusColors: Record<PushLog['status'], { bg: string, text: string, dot: string }> = {
                        SENT: { bg: 'bg-cyan-500/10', text: 'text-cyan-400', dot: 'bg-cyan-400' },
                        DISPLAYED: { bg: 'bg-indigo-500/10', text: 'text-indigo-400', dot: 'bg-indigo-400' },
                        OPENED: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', dot: 'bg-emerald-400' },
                        EXPIRED: { bg: 'bg-amber-500/10', text: 'text-amber-400', dot: 'bg-amber-400' },
                        FAILED: { bg: 'bg-red-500/10', text: 'text-red-400', dot: 'bg-red-400' },
                      };
                      const color = statusColors[log.status] || { bg: 'bg-slate-500/10', text: 'text-slate-400', dot: 'bg-slate-400' };
                      
                      return (
                        <tr key={log.id} className="hover:bg-slate-800/20 transition-all">
                          <td className="px-6 py-4 text-slate-300 font-mono whitespace-nowrap">
                            {new Date(log.created_at).toLocaleString()}
                          </td>
                          <td className="px-6 py-4 font-medium text-slate-200">
                            {log.profiles?.full_name || 'System User'}
                            <div className="text-[10px] text-slate-500 font-mono">{log.user_id.slice(0, 8)}...</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${color.bg} ${color.text}`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${color.dot}`} />
                              {log.status}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-slate-400 font-mono">
                            {log.gateway || 'N/A'}
                          </td>
                          <td className="px-6 py-4 text-slate-400 max-w-[240px] truncate hover:whitespace-normal hover:break-all transition-all">
                            {log.error_message || <span className="text-slate-600">-</span>}
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
