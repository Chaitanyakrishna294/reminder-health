'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useLinkStatus } from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useUiMode } from '@/context/ui-mode-context';
import { createClient } from '@/lib/supabase/client';
import { ESCALATION_STATUSES } from '@/lib/schedule/dose-attention';
import { isRootPath } from '@/lib/navigation/stack';
import PageBack from '@/components/layout/page-back';
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
  Check,
  FolderHeart,
  ChevronDown,
  Users
} from 'lucide-react';

// The nav icon used to SPIN from tap until the destination was ready
// (useLinkStatus). On a fast route that was a flicker of rotation; on a slow one a
// spinner on the thing you just pressed reads as "something is wrong". It is replaced
// by a press animation: a quick squash-and-overshoot that confirms the tap landed and
// then settles, with no relationship to how long the route takes.
//
// The class is removed on animationend rather than left on the node, so a second tap
// re-triggers it â€” CSS animations do not restart while the class is still applied.
function NavIcon({
  icon: Icon,
  size = 'w-5 h-5',
}: {
  icon: React.ComponentType<{ className?: string }>;
  size?: string;
}) {
  const [tapped, setTapped] = useState(false);

  // Cleared on a timer rather than on `animationend`. That event is not guaranteed to
  // arrive: it never fires if the tab is backgrounded while the animation is pending
  // (frames stop compositing), if the icon unmounts on navigation, or if the animation
  // is cancelled. Any of those would leave the class stuck on the node, and a CSS
  // animation will not restart while its class is still applied â€” so the next tap
  // would do nothing.
  React.useEffect(() => {
    if (!tapped) return;
    const t = setTimeout(() => setTapped(false), 340);
    return () => clearTimeout(t);
  }, [tapped]);

  // The handler sits on a wrapper because the lucide icon components accept only
  // `className`. The wrapper is what animates; the icon stays a plain icon.
  return (
    <span
      className={`inline-flex ${tapped ? 'nav-icon-tap' : ''}`}
      onPointerDown={() => setTapped(true)}
    >
      <Icon className={size} />
    </span>
  );
}

/**
 * Instant acknowledgement that a tab tap registered.
 *
 * The route-level `loading.tsx` deliberately waits 300ms before showing anything, so
 * a fast page does not flash a spinner. That leaves a real silent window on a slow
 * webview: you tap, nothing moves, and the reflex is to tap again. This fills
 * exactly that window — it appears the moment the navigation starts, on the control
 * you actually touched, which is where the eye already is.
 *
 * `useLinkStatus` must be rendered INSIDE the <Link> it reports on; that is the
 * whole API (see node_modules/next/dist/docs/.../use-link-status.md).
 *
 * A wash of the existing accent, not a spinner: two loading indicators for one
 * navigation is worse than one, and this one only has to say "heard you".
 */
function NavPending() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      aria-hidden
      className="absolute inset-0 rounded-[inherit] bg-primary/20 animate-pulse pointer-events-none"
    />
  );
}

export default function DashboardMainLayout({
  children,
  patientName = '',
  patientPhone = '',
  patientChatId = ''
}: { 
  children: React.ReactNode;
  patientName?: string;
  patientPhone?: string;
  patientChatId?: string | null;
}) {
  const { isElderly, viewMode, setViewMode, showNavLabels } = useUiMode();
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const [showCallPopover, setShowCallPopover] = useState(false);
  const [copied, setCopied] = useState(false);
  const [hasEscalation, setHasEscalation] = useState(false);
  const [monitoredPatients, setMonitoredPatients] = useState<any[]>([]);

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
      if (viewMode === 'PATIENT_MONITOR' && patientChatId) {
        // Live escalation = one of today's doses the scheduler escalated to the
        // caregiver (ESCALATED / CAREGIVER_ACKNOWLEDGED) and still unresolved.
        // Day-bounded so a stale acknowledged dose from a previous day can
        // never wedge the alarm on.
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        const { data: events } = await supabase
          .from('reminder_events')
          .select('id')
          .eq('telegram_id', patientChatId)
          .in('reminder_status', [...ESCALATION_STATUSES])
          .gte('scheduled_for', startOfToday.toISOString())
          .limit(1);

        setHasEscalation(!!events && events.length > 0);
      }
    }
    checkEscalations();
  }, [viewMode, pathname, supabase, patientChatId]);

  // Load all accepted patient links for the caregiver selector dropdown
  React.useEffect(() => {
    async function loadPatients() {
      if (viewMode === 'PATIENT_MONITOR') {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data: profile } = await supabase
          .from('profiles')
          .select('telegram_chat_id')
          .eq('id', user.id)
          .single();

        if (!profile?.telegram_chat_id) return;

        const { data: links } = await supabase
          .from('active_caregiver_links')
          .select('*')
          .eq('caregiver_chat_id', profile.telegram_chat_id)
          .eq('is_active', true)
          .eq('connection_status', 'ACCEPTED');

        if (links) {
          const patientChatIds = links.map(l => l.patient_telegram_id).filter(Boolean);
          const { data: patientProfiles } = await supabase
            .from('profiles')
            .select('full_name, telegram_chat_id')
            .in('telegram_chat_id', patientChatIds);

          const nameMap = new Map(patientProfiles?.map(p => [p.telegram_chat_id, p.full_name]) || []);

          setMonitoredPatients(links.map(l => ({
            telegram_chat_id: l.patient_telegram_id,
            full_name: nameMap.get(l.patient_telegram_id) || l.patient_telegram_id || 'Patient'
          })));
        }
      }
    }
    loadPatients();
  }, [viewMode, supabase]);

  const isLinkActive = (path: string) => {
    if (path.includes('#')) return false;
    return pathname === path || (path !== '/dashboard' && pathname.startsWith(path + '/'));
  };

  const getNavItems = () => {
    // Mobile-first: keep the nav to exactly 5 icons. Secondary destinations
    // (Medical Profile, Emergency, Scheduler) live in the profile menu, not here.
    //
    // Care Circle took the Scheduler's slot. This is a caregiver product and Care
    // Circle was reachable only through a dashboard card or Settings, while the
    // planner â€” a task you do occasionally, not daily â€” held a permanent slot.
    // Scheduler is still one tap from the Medications page and the profile menu.
    // Medications holds the CENTER slot: it is the app's core object and the thumb's
    // natural resting position on a phone dock.
    // `label` is the accessible name and stays the full destination. `short` is
    // what fits UNDER the icon at five-up on a 375px phone; `shortElderly`
    // overrides it where the elderly nav's four tabs leave room for the plainer
    // word — "Meds" is idiomatic rather than plain, and elderly mode is the one
    // density that can afford "Medicines".
    const baseItems = [
      { href: '/dashboard', label: 'Dashboard', short: 'Today', icon: LayoutDashboard },
      { href: '/care-circle', label: 'Care Circle', short: 'Care', icon: Users },
      { href: '/medications', label: 'Medications', short: 'Meds', shortElderly: 'Medicines', icon: Pill },
      { href: '/health-vault', label: 'Health Vault', short: 'Vault', icon: FolderHeart },
      { href: '/settings', label: 'Settings', short: 'Settings', icon: Settings },
    ];

    // ELDERLY = the third density, and its nav collapses with everything else.
    // Five destinations is five decisions before the one that matters. Today is the
    // screen; Care Circle is the only other place an elderly user has a reason to be.
    //
    // SETTINGS IS THE THIRD, AND IT IS NOT OPTIONAL — see the anti-jail rule in
    // CLAUDE.md. The view lock is set and cleared from Settings and nowhere else, so
    // a nav that hides Settings can strand a locked patient with no way out and no
    // way for a caregiver to help without a rebuild. Minimal is the goal; locked out
    // is not, and the difference between them is exactly one icon.
    if (isElderly) {
      // Today · Medications · Care Circle · Settings. Four, not five: the Health
      // Vault is a filing cabinet and nobody opens one from the home screen.
      // Medications earns its slot — "what am I taking?" is a question people ask
      // out loud, and the alternative was making them find it through Settings.
      return baseItems.filter(item =>
        ['/dashboard', '/medications', '/care-circle', '/settings'].includes(item.href)
      );
    }

    if (viewMode === 'PATIENT_MONITOR') {
      // Monitoring is a focused, read-only view of ONE patient. It used to hide only
      // Medications, leaving Care Circle / Vault / Settings in the dock â€” all of which
      // are the caregiver's OWN pages, so tapping them mid-monitoring silently changed
      // whose data you were looking at. Only the monitor dashboard remains; leaving
      // the mode goes through the banner's "Return to My Dashboard", which also writes
      // the audit log entry that a plain nav tap would skip.
      return baseItems.filter(item => item.href === '/dashboard');
    }
    return baseItems;
  };

  const navItems = getNavItems();
  // Which tab the indicator sits over. -1 on a sub-page, where no tab is
  // current and the indicator should not be showing at all.
  const activeNavIndex = navItems.findIndex((item) => isLinkActive(item.href));

  const shouldPrefetch = (path: string) => {
    const allowed = ['/dashboard', '/medications', '/care-circle', '/health-vault'];
    return allowed.includes(path);
  };

  const handleCall = () => {
    if (!patientPhone) {
      alert('No phone number is registered for this patient.');
      return;
    }
    // Strip to dial-safe characters so a malformed/poisoned phone value can't
    // inject a different URI scheme (e.g. "javascript:") into the navigation.
    const dialSafePhone = patientPhone.replace(/[^\d+]/g, '');
    if (!dialSafePhone) {
      alert('The registered phone number is invalid.');
      return;
    }
    const isMobile = /Android|iPhone|iPad|iPod|Windows Phone/i.test(navigator.userAgent);
    if (isMobile) {
      window.location.href = `tel:${dialSafePhone}`;
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
        aria-label="Main navigation"
        className={`hidden md:flex flex-col items-center justify-center fixed left-6 top-1/2 -translate-y-1/2 z-40 rounded-[28px] bg-white/80 dark:bg-card/70 backdrop-blur-xl border border-border/70 shadow-lg transition-all duration-300 ${
          isElderly
            ? 'w-24 py-10 space-y-8 border-2 border-primary/50'
            : 'w-[72px] py-8 space-y-6'
        }`}
      >
        {/* THE SLIDING INDICATOR. One pink pill that MOVES between tabs rather
            than a colour block that appears and disappears — the movement is
            what tells you where you came from, which a block cannot.

            Absolutely positioned behind the tabs and driven by the active index,
            so it is one composited translateX and never touches layout. Elderly
            keeps its solid block: that density is excluded from this round, and
            a moving target is the wrong idea there anyway. */}
        {!isElderly && activeNavIndex >= 0 && (
          <span
            aria-hidden
            className="absolute top-2 bottom-2 left-4 right-4 pointer-events-none"
          >
            <span
              className="absolute top-0 bottom-0 rounded-2xl shadow-md shadow-primary/20 motion-reduce:transition-none"
              style={{
                width: `${100 / navItems.length}%`,
                transform: `translateX(${activeNavIndex * 100}%)`,
                transition: 'transform 260ms cubic-bezier(0.22, 1, 0.36, 1)',
                /*
                 * THE FILL IS AN INLINE TOKEN READ, not `bg-primary-strong`.
                 *
                 * The utility rendered GREY in light mode and pink in dark on a
                 * real device (2026-08-15), and the cause was not reproducible by
                 * reading: the token exists, the @theme mapping exists, and the
                 * class is spelled correctly. Rather than guess which layer ate
                 * it — utility-vs-plain-class ordering, the parent's
                 * backdrop-filter stacking context, a purge miss on a class only
                 * this element uses — the fill now reads the variable directly.
                 *
                 * An inline style cannot be purged, cannot lose to layer order,
                 * and still flips with the theme because the TOKEN flips. For a
                 * single moving element whose whole job is being the accent, that
                 * is the right trade; it is not a licence to inline colours
                 * generally.
                 */
                background: 'var(--primary-strong)',
              }}
            />
          </span>
        )}

        {navItems.map((item) => {
          const active = isLinkActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              /* REPLACE, never push. A tab bar that stacks history means back after
                 four tab taps walks backwards through all four — nobody expects that
                 from tabs, and it buries the exit. See lib/navigation/stack.ts. */
              replace
              prefetch={shouldPrefetch(item.href)}
              className={`flex flex-col items-center justify-center gap-1 rounded-[20px] transition-all relative group ${
                isElderly
                  ? `w-20 py-2.5 ${active ? 'bg-primary-strong text-primary-strong-foreground shadow-lg' : 'text-foreground hover:bg-muted/80'}`
                  : `w-16 py-2 ${
                      active 
                        ? 'bg-primary-strong text-primary-strong-foreground shadow-md shadow-primary/20' 
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                    }`
              }`}
              title={item.label}
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
            >
              <NavPending />
              <NavIcon icon={item.icon} size={isElderly ? 'w-7 h-7' : 'w-5 h-5'} />
              {/* OFF by default, forced on in elderly — see showNavLabels in
                  ui-mode-context. The hover tooltip it replaced was worse than
                  nothing on touch, where hover does not exist. */}
              {showNavLabels && (
                <span className={`font-bold leading-none ${isElderly ? 'text-sm' : 'text-xs'}`}>
                  {(isElderly && item.shortElderly) || item.short}
                </span>
              )}
            </Link>
          );
        })}
      </aside>

      {/* BOTTOM FLOATING PILL DOCK (Mobile) */}
      <nav
        data-tour="dash-nav"
        aria-label="Main navigation"
        className={`md:hidden fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 z-40 rounded-[32px] bg-white/85 dark:bg-card/80 backdrop-blur-xl border border-border/70 card-overlay flex items-center justify-around px-4 transition-all duration-300 ${
          isElderly
            ? 'w-[94%] h-[104px] border-2 border-primary/50'
            : `w-[92%] max-w-[480px] ${showNavLabels ? 'h-[84px]' : 'h-[72px]'}`
        }`}
      >
        {navItems.map((item) => {
          const active = isLinkActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              /* REPLACE, never push. A tab bar that stacks history means back after
                 four tab taps walks backwards through all four — nobody expects that
                 from tabs, and it buries the exit. See lib/navigation/stack.ts. */
              replace
              prefetch={shouldPrefetch(item.href)}
              /* Was an aspect-square pill. Squares cannot hold a word, so the tabs
                 now share the dock's width evenly and run icon-over-label. Both
                 densities stay well past the 44px target in each dimension. */
              className={`flex items-center justify-center rounded-2xl transition-all min-w-0 ${
                isElderly
                  ? `h-[84px] flex-1 ${
                      active ? 'bg-primary-strong text-primary-strong-foreground shadow-lg' : 'text-foreground bg-muted/40'
                    }`
                  : `${showNavLabels ? 'h-[68px]' : 'h-12 max-w-[56px]'} flex-1 relative z-10 ${
                      active
                        // No fill here: the sliding indicator behind is the fill.
                        // White on --primary-strong is 4.75:1, the same pairing
                        // the block used.
                        ? 'text-primary-strong-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`
              }`}
              title={item.label}
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
            >
              {/* `relative` so the pending wash positions against this tab and not
                  the dock — without it every tap would flash the whole bar. */}
              <span className="relative flex flex-col items-center justify-center gap-1 w-full h-full rounded-2xl px-0.5">
                <NavPending />
                <NavIcon icon={item.icon} size={isElderly ? 'w-7 h-7' : 'w-5 h-5'} />
                {/* aria-label always carries the FULL destination name, labels or
                    not — the visible short label is only what fits under a 61px
                    tab, and turning it off must never cost a screen reader user
                    the name of the tab. */}
                {showNavLabels && (
                  <span className={`font-bold leading-none ${isElderly ? 'text-sm' : 'text-xs'}`}>
                    {(isElderly && item.shortElderly) || item.short}
                  </span>
                )}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Main Content Area.
          Bottom padding must clear the floating dock, which is NOT part of the flow:
          it occupies bottom-6 (24px) + its own height (72px normal / 96px elderly),
          plus the home-indicator inset. The old pb-24 (96px) exactly equalled the
          normal-mode dock band, i.e. zero clearance â€” the last card on every scrolling
          page sat under it. These values leave ~24-32px of real breathing room. */}
      <main
        className={`flex-1 w-full max-w-[1600px] mx-auto transition-all duration-300 ${
          isElderly
            ? 'p-8 md:p-12 md:pl-40 pb-[calc(11rem+env(safe-area-inset-bottom))] md:pb-12'
            : `p-6 md:p-8 md:pl-32 md:pb-8 ${showNavLabels ? 'pb-[calc(9rem+env(safe-area-inset-bottom))]' : 'pb-[calc(7.5rem+env(safe-area-inset-bottom))]'}`
        }`}
      >
        {viewMode === 'PATIENT_MONITOR' && (
          <div className="sticky top-0 z-50 mb-6 bg-white border border-border rounded-3xl p-4 shadow-md flex flex-col md:flex-row items-center justify-between gap-4 animate-fade-in">
            {/* Left section: Badges & Patient Selector */}
            <div className="flex flex-wrap items-center gap-3">
              {hasEscalation ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-black bg-danger/10 text-danger border border-danger/25 animate-pulse uppercase tracking-wider shrink-0">
                  <AlertTriangle className="w-4 h-4" /> CRITICAL ALARM
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-black bg-[#EAF3FF] text-primary border border-primary/20 uppercase tracking-wider shrink-0">
                  <Shield className="w-4 h-4" /> READ ONLY â€” EXCEPT MISSED DOSES
                </span>
              )}

              {/* Patient Selector Dropdown */}
              <div className="relative group shrink-0">
                <button className="flex items-center gap-1.5 text-xs font-black text-foreground bg-muted hover:bg-muted/80 border border-border px-3.5 py-1.5 rounded-xl cursor-pointer">
                  <span>Monitoring: {patientName}</span>
                  <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                </button>
                {monitoredPatients.length > 0 && (
                  <div className="hidden group-hover:block absolute left-0 top-9 w-48 bg-white border border-border rounded-xl shadow-lg z-50 p-1.5 animate-fade-in space-y-1">
                    {monitoredPatients.map((p) => {
                      const isActive = p.telegram_chat_id === patientChatId;
                      return (
                        <button
                          key={p.telegram_chat_id}
                          onClick={() => {
                            if (isActive) return;
                            document.cookie = `monitored-patient-id=${p.telegram_chat_id}; path=/; max-age=31536000; SameSite=Lax`;
                            router.refresh();
                          }}
                          className="w-full flex items-center justify-between px-3 py-2 text-xs font-black text-foreground hover:bg-muted rounded-lg cursor-pointer text-left"
                        >
                          <span>{p.full_name}</span>
                          {isActive && <Check className="w-3.5 h-3.5 text-success shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                )}
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
                        className="flex-1 inline-flex items-center justify-center gap-1 text-[10px] font-black bg-primary-strong text-primary-strong-foreground hover:bg-primary-strong-hover px-2 py-1.5 rounded-lg transition-all text-center"
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
        {/* THE BACK ARROW FOR EVERY SUB-PAGE, decided here rather than page by page.
            "Sub-pages get a back arrow" is a rule, and a rule enforced by sixteen
            copies of the same JSX is a rule that lasts until someone adds the
            seventeenth page. Driven off isRootPath, so a new route inherits the
            right behaviour by existing — the five tab destinations get nothing
            (back there means leave the app), everything else gets an arrow. */}
        {!isRootPath(pathname) && (
          <div className="w-full mb-1">
            <PageBack />
          </div>
        )}
        <div className="w-full">
          {children}
        </div>
      </main>
    </div>
  );
}
