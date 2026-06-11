'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useUiMode } from '@/context/ui-mode-context';
import { createClient } from '@/lib/supabase/client';
import { 
  LayoutDashboard, 
  Pill, 
  Calendar, 
  AlertTriangle, 
  Settings,
  Phone,
  Copy,
  ExternalLink,
  Shield,
  LogOut,
  Check
} from 'lucide-react';

export default function DashboardMainLayout({ 
  children,
  userRole = 'PATIENT',
  patientName = '',
  patientPhone = ''
}: { 
  children: React.ReactNode;
  userRole?: 'PATIENT' | 'CAREGIVER';
  patientName?: string;
  patientPhone?: string;
}) {
  const { isElderly, viewMode, setViewMode } = useUiMode();
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const [showCallPopover, setShowCallPopover] = useState(false);
  const [copied, setCopied] = useState(false);
  const [hasEscalation, setHasEscalation] = useState(false);

  // Smooth hash scroll listener for Next.js routing transitions
  React.useEffect(() => {
    const handleHashScroll = () => {
      if (typeof window !== 'undefined' && window.location.hash) {
        const id = window.location.hash.substring(1);
        setTimeout(() => {
          const element = document.getElementById(id);
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }, 150);
      }
    };

    handleHashScroll();
    window.addEventListener('hashchange', handleHashScroll);
    return () => {
      window.removeEventListener('hashchange', handleHashScroll);
    };
  }, [pathname]);

  // Query database for active escalations if viewing a monitored patient
  React.useEffect(() => {
    async function checkEscalations() {
      if (viewMode === 'PATIENT_MONITOR' && userRole === 'CAREGIVER') {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data: profile } = await supabase
          .from('profiles')
          .select('telegram_chat_id')
          .eq('id', user.id)
          .single();

        if (!profile?.telegram_chat_id) return;

        const { data: link } = await supabase
          .from('caregiver_info')
          .select('patient_telegram_id, connection_status')
          .eq('caregiver_chat_id', profile.telegram_chat_id)
          .eq('is_active', true)
          .single();

        if (!link?.patient_telegram_id || link.connection_status !== 'ACCEPTED') return;

        const { data: events } = await supabase
          .from('reminder_events')
          .select('id')
          .eq('telegram_id', link.patient_telegram_id)
          .eq('reminder_status', 'ESCALATED_TO_CG')
          .limit(1);

        setHasEscalation(!!events && events.length > 0);
      }
    }
    checkEscalations();
  }, [viewMode, pathname, userRole, supabase]);

  const isLinkActive = (path: string) => {
    if (path.includes('#')) return false;
    return pathname === path || (path !== '/dashboard' && pathname.startsWith(path + '/'));
  };

  const getNavItems = () => {
    const baseItems = [
      { href: '/dashboard', label: 'Dashboard', icon: <LayoutDashboard className="w-5 h-5" /> },
      { href: '/medications', label: 'Medications', icon: <Pill className="w-5 h-5" /> },
      { href: '/schedule-planner', label: 'Schedule', icon: <Calendar className="w-5 h-5" /> },
      { href: '/settings', label: 'Settings', icon: <Settings className="w-5 h-5" /> },
    ];

    if (viewMode === 'PATIENT_MONITOR') {
      // Hide medications in monitoring view
      return baseItems.filter(item => item.href !== '/medications');
    }
    return baseItems;
  };

  const navItems = getNavItems();

  const shouldPrefetch = (path: string) => {
    const allowed = ['/dashboard', '/medications', '/schedule-planner'];
    return allowed.includes(path);
  };

  const handleCall = () => {
    if (!patientPhone) {
      alert('No phone number is registered for this patient.');
      return;
    }
    const isMobile = /Android|iPhone|iPad|iPod|Windows Phone/i.test(navigator.userAgent);
    if (isMobile) {
      window.location.href = `tel:${patientPhone}`;
    } else {
      setShowCallPopover(!showCallPopover);
    }
  };

  const handleExitMonitoring = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        // Compliance audit log
        await supabase
          .from('audit_logs')
          .insert([{
            user_id: user.id,
            action: 'Exited Monitoring Mode',
            details: {
              patient_name: patientName || 'Your Patient'
            }
          }]);
      }
    } catch (err) {
      console.error('Error logging monitoring exit:', err);
    } finally {
      setViewMode('PATIENT_SELF');
      router.push('/dashboard');
      router.refresh();
    }
  };

  return (
    <div className="flex flex-1 min-h-[calc(100vh-4rem)] relative w-full">
      {/* LEFT VERTICAL RAIL (Desktop/Tablet) */}
      <aside 
        className={`hidden md:flex flex-col items-center justify-center fixed left-6 top-1/2 -translate-y-1/2 z-40 rounded-full bg-white border border-border shadow-[0_8px_24px_rgba(15,23,42,0.08)] transition-all duration-300 ${
          isElderly 
            ? 'w-24 py-10 space-y-8 border-2 border-primary/50' 
            : 'w-[72px] py-8 space-y-6'
        }`}
      >
        {navItems.map((item) => {
          const active = isLinkActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={shouldPrefetch(item.href)}
              className={`flex flex-col items-center justify-center rounded-full transition-all relative group ${
                isElderly
                  ? `w-20 h-20 text-3xl ${active ? 'bg-primary text-primary-foreground shadow-lg' : 'text-foreground hover:bg-muted/80'}`
                  : `w-14 h-14 text-xl ${
                      active 
                        ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20' 
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                    }`
              }`}
              title={item.label}
            >
              <span>{item.icon}</span>
              {!isElderly && (
                <span className="absolute left-20 scale-0 group-hover:scale-100 transition-all duration-200 bg-foreground text-background text-xs font-bold px-2 py-1 rounded shadow-sm pointer-events-none whitespace-nowrap z-50">
                  {item.label}
                </span>
              )}
            </Link>
          );
        })}
      </aside>

      {/* BOTTOM FLOATING PILL DOCK (Mobile) */}
      <nav 
        className={`md:hidden fixed bottom-6 left-1/2 -translate-x-1/2 z-40 rounded-full bg-white border border-border shadow-[0_8px_24px_rgba(15,23,42,0.08)] flex items-center justify-around px-4 transition-all duration-300 ${
          isElderly 
            ? 'w-[92%] h-24 border-2 border-primary/50' 
            : 'w-[90%] max-w-[480px] h-[72px]'
        }`}
      >
        {navItems.map((item) => {
          const active = isLinkActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={shouldPrefetch(item.href)}
              className={`flex items-center justify-center rounded-full transition-all ${
                isElderly
                  ? `h-16 flex-1 max-w-[64px] aspect-square ${
                      active ? 'bg-primary text-primary-foreground shadow-lg' : 'text-foreground bg-muted/40'
                    }`
                  : `h-11 flex-1 max-w-[44px] aspect-square ${
                      active 
                        ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20' 
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                    }`
              }`}
              title={item.label}
            >
              <span className={isElderly ? "text-2xl" : "text-lg"}>{item.icon}</span>
            </Link>
          );
        })}
      </nav>

      {/* Main Content Area */}
      <main 
        className={`flex-1 w-full max-w-[1600px] mx-auto transition-all duration-300 ${
          isElderly 
            ? 'p-8 md:p-12 md:pl-40 pb-32 md:pb-12' 
            : 'p-6 md:p-8 md:pl-32 pb-24 md:pb-8'
        }`}
      >
        {viewMode === 'PATIENT_MONITOR' && userRole === 'CAREGIVER' && (
          <div className="sticky top-0 z-50 mb-6 bg-white border border-border rounded-3xl p-4 shadow-md flex flex-col md:flex-row items-center justify-between gap-4 animate-fade-in">
            {/* Left section: Badges & Patient Selector */}
            <div className="flex flex-wrap items-center gap-3">
              {hasEscalation ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-black bg-danger/10 text-danger border border-danger/25 animate-pulse uppercase tracking-wider shrink-0">
                  <AlertTriangle className="w-4 h-4" /> ⚠️ CRITICAL ALARM
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-black bg-[#EAF3FF] text-primary border border-primary/20 uppercase tracking-wider shrink-0">
                  <Shield className="w-4 h-4" /> READ ONLY
                </span>
              )}

              {/* Patient Selector Dropdown */}
              <div className="relative group shrink-0">
                <button className="flex items-center gap-1.5 text-xs font-black text-foreground bg-muted hover:bg-muted/80 border border-border px-3.5 py-1.5 rounded-xl cursor-pointer">
                  <span>Monitoring: {patientName}</span>
                  <span className="text-[10px] text-muted-foreground">▼</span>
                </button>
                <div className="hidden group-hover:block absolute left-0 top-9 w-48 bg-white border border-border rounded-xl shadow-lg z-50 p-1.5 animate-fade-in">
                  <div className="flex items-center justify-between px-3 py-2 text-xs font-black text-foreground hover:bg-muted rounded-lg cursor-default">
                    <span>{patientName}</span>
                    <Check className="w-3.5 h-3.5 text-success shrink-0" />
                  </div>
                </div>
              </div>
            </div>

            {/* Right section: Quick Actions */}
            <div className="flex flex-wrap items-center gap-3 relative shrink-0">
              <button
                onClick={handleCall}
                className="inline-flex items-center justify-center gap-1.5 text-xs font-black text-foreground bg-muted hover:bg-muted/80 border border-border px-4 py-2 rounded-xl transition-all cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
              >
                <Phone className="w-3.5 h-3.5" /> Call Patient
              </button>

              {/* Desktop Call Popover */}
              {showCallPopover && (
                <div className="absolute right-0 top-12 w-64 bg-white border border-border rounded-2xl p-4 shadow-xl z-50 animate-fade-in space-y-3">
                  <h4 className="text-xs font-black text-foreground border-b border-border/40 pb-2">Patient Phone Number</h4>
                  <p className="text-sm font-bold text-foreground font-mono bg-muted p-2 rounded-lg text-center">{patientPhone || 'Not Registered'}</p>
                  {patientPhone && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(patientPhone);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        }}
                        className="flex-1 inline-flex items-center justify-center gap-1 text-[10px] font-black bg-muted hover:bg-muted/80 text-foreground border border-border px-2 py-1.5 rounded-lg transition-all cursor-pointer"
                      >
                        {copied ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
                        <span>{copied ? 'Copied!' : 'Copy'}</span>
                      </button>
                      <a
                        href={`tel:${patientPhone}`}
                        className="flex-1 inline-flex items-center justify-center gap-1 text-[10px] font-black bg-primary text-primary-foreground hover:bg-primary/95 px-2 py-1.5 rounded-lg transition-all text-center"
                      >
                        <ExternalLink className="w-3 h-3" />
                        <span>Open App</span>
                      </a>
                    </div>
                  )}
                </div>
              )}

              <button
                onClick={handleExitMonitoring}
                className="inline-flex items-center justify-center gap-1.5 text-xs font-black text-primary bg-primary/10 hover:bg-primary/15 border border-primary/25 px-4 py-2 rounded-xl transition-all cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
              >
                <LogOut className="w-3.5 h-3.5" /> Return to My Dashboard
              </button>
            </div>
          </div>
        )}
        <div className="w-full">
          {children}
        </div>
      </main>
    </div>
  );
}
