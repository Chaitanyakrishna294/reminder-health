'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useUiMode } from '@/context/ui-mode-context';
import { clearNativeSchedule } from '@/lib/native/schedule-bridge';
import { ChevronDown, LogOut, Glasses, HeartPulse, Siren, Calendar } from 'lucide-react';
import NotificationCenter from '@/components/shared/notification-center';

interface NavbarProps {
  user: {
    id: string;
    email: string;
    fullName: string;
    role: string;
    telegramChatId: string;
    patientChatId?: string | null;
    patientName?: string | null;
    avatarUrl?: string | null;
  };
}

export default function Navbar({ user }: NavbarProps) {
  const router = useRouter();
  const supabase = createClient();
  const { isElderly, toggleMode, viewMode, uiModeLocked } = useUiMode();
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);

  const handleLogout = async () => {
    // BEFORE signOut, while the session is still valid: wipe the Android app's
    // local schedule and cancel its alarms. Otherwise this account's doses keep
    // ringing on the device for whoever signs in next — observed on-device
    // 2026-08-11, where a guest session still rang for the previous account's
    // 12 medications. A no-op in a normal browser.
    await clearNativeSchedule().catch((err) => {
      console.error('[Navbar] clearNativeSchedule failed:', err);
    });
    await supabase.auth.signOut();
    router.refresh();
    router.push('/login');
  };

  return (
    <nav className="bg-white/80 dark:bg-card/70 backdrop-blur-xl border-b border-border/70 shadow-sm sticky top-0 z-40 transition-all duration-300 supports-[backdrop-filter]:bg-white/65">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* 56px in normal density, down from 64. The bar is chrome: it should
            frame the screen, not take a bite out of it. Elderly keeps its 80px
            — that density is excluded from this round and its targets are sized
            for a different pair of hands. */}
        <div className={`flex justify-between items-center transition-all duration-300 ${isElderly ? 'h-20' : 'h-14'
          }`}>
          {/* Logo and Brand */}
          <div className="flex items-center">
            <Link href="/dashboard" className="flex items-center gap-1 min-h-11 shrink-0">
              
              {/* A TYPE WORDMARK, not a raster mark.
                  The bar used to carry a 40px PNG between "Re" and "eЯ", which
                  set the header's height on its own and shipped an image request
                  on every page. Set in the brand's mono face — a wordmark is a
                  VALUE, not a sentence, so this is the one place mono is exactly
                  right — with MIND in the accent so the name still reads as a
                  mark rather than as three syllables.

                  Elderly keeps the image: that density is excluded, and its
                  users are the ones most helped by a familiar shape. */}
              {isElderly ? (
                <span className="font-black text-foreground tracking-tight transition-all duration-300 font-mono flex items-center gap-0.5 text-2xl">
                  <span>Re</span>
                  <img
                    src="/logo2.png"
                    alt="MIND"
                    className="inline-block rounded-md object-contain shrink-0 bg-white"
                    style={{ width: '48px', height: '48px' }}
                  />
                  <span>eЯ</span>
                </span>
              ) : (
                <span className="font-mono font-black text-foreground text-[19px] leading-none tracking-[-0.03em] flex items-baseline">
                  <span>Re</span>
                  <span className="text-primary-strong">MIND</span>
                  <span>eЯ</span>
                </span>
              )}
            </Link>
          </div>

          {/* Action Center (Role Switcher, Realtime Bell, Mode Toggle, Profile Dropdown) */}
          <div className={`flex items-center min-w-0 ${isElderly ? 'gap-2 sm:gap-4' : 'gap-1.5'}`}>

            {/* CONSOLIDATED. The bar carried three separate round buttons of equal
                weight — bell, glasses, avatar — which read as a row of widgets
                rather than as chrome. In normal density they now sit in one
                recessed group, so the header has ONE object on the right instead
                of three competing ones. Each target keeps its own 44px. */}
            <div className={isElderly ? 'contents' : 'flex items-center gap-0.5 rounded-[14px] surface-sunk px-1'}>

            {/* Realtime Bell */}
            <NotificationCenter userId={user.id} />

            {/* The theme toggle used to sit here — a one-tap moon between the bell and
                the glasses, three round icons of equal weight, one of which repainted
                the whole app. Removed 2026-08-12: light is this product's default and
                dark is a deliberate act (CLAUDE.md theme policy), and a bar button one
                mis-tap from flipping the entire interface is the accidental flip that
                policy exists to prevent. It now lives in Settings → Layout Preference,
                which is also the only place that can explain that elderly mode stays
                light regardless. The bar is one icon slimmer, which elderly mode wanted
                anyway. */}

            {/* Mode Switcher Toggle (icon-only: glasses = large/accessible "Elderly" view).
                HIDDEN ENTIRELY WHEN THE VIEW IS LOCKED — in every mode, not just
                elderly. The lock exists because one stray tap on a round icon up here
                makes the text small and the layout unfamiliar for someone who cannot
                undo it, so leaving a disabled-looking version would keep the target
                that caused the problem. The control lives in Settings while locked. */}
            {!uiModeLocked && (
            <button
              onClick={toggleMode}
              aria-label={isElderly ? 'Switch to Normal view' : 'Switch to Elderly (large, accessible) view'}
              title={isElderly ? 'Switch to Normal view' : 'Switch to Elderly view'}
              className={`flex items-center justify-center rounded-full transition-all duration-200 border cursor-pointer hover:scale-[1.05] active:scale-[0.95] ${isElderly
                ? 'bg-warning/20 hover:bg-warning/35 border-warning/50 text-warning-strong w-12 h-12 shadow-sm'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/60 w-11 h-11'
                }`}
            >
              <Glasses className={isElderly ? 'w-6 h-6' : 'w-[18px] h-[18px]'} />
            </button>
            )}

            {/* Profile Dropdown */}
            <div className="relative">
              <button
                onClick={() => setUserDropdownOpen(!userDropdownOpen)}
                aria-label={`Account menu for ${user.fullName}`}
                aria-expanded={userDropdownOpen}
                className="flex items-center space-x-2 focus:outline-none cursor-pointer font-mono"
              >
                <div className={`rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold border border-primary/20 transition-all overflow-hidden ${isElderly ? 'w-12 h-12 text-base' : 'w-11 h-11 text-sm'
                  }`}>
                  {user.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={user.avatarUrl} alt="Profile photo" className="w-full h-full object-cover" />
                  ) : (
                    user.fullName.substring(0, 2).toUpperCase()
                  )}
                </div>
                {/* The name and chevron survive in ELDERLY only. In normal
                    density the avatar is the affordance and the name is the
                    first line of the menu it opens, so both were restating
                    something one tap away — and the aria-label above carries the
                    name for anyone not looking at the picture. */}
                {isElderly && (
                  <>
                    <span className="hidden sm:inline font-semibold text-foreground text-base">
                      {user.fullName}
                    </span>
                    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  </>
                )}
              </button>

              {userDropdownOpen && (
                <div className="absolute right-0 mt-2 w-56 bg-card rounded-2xl shadow-lg border border-border py-1.5 z-50 overflow-hidden animate-fade-in">
                  <div className="px-4 py-2 border-b border-border">
                    <p className="text-xs text-muted-foreground">Signed in as</p>
                    <p className="text-sm font-semibold text-foreground truncate">{user.email}</p>
                    <div className="mt-1 flex items-center gap-1.5">
                      {viewMode === 'PATIENT_MONITOR' && user.patientName && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-success/15 text-success">
                          Monitoring: {user.patientName}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="px-4 py-1.5 border-b border-border text-[11px] text-muted-foreground">
                    Telegram: {user.telegramChatId}
                  </div>
                  {/* Scheduler moved out of the bottom nav to make room for Care Circle.
                      It is listed here so it keeps a permanent, findable home rather than
                      existing only as a link on another page. */}
                  <Link
                    href="/schedule-planner"
                    onClick={() => setUserDropdownOpen(false)}
                    className="w-full text-left px-4 py-2 text-sm text-foreground hover:bg-muted font-medium transition-colors cursor-pointer flex items-center gap-2 font-mono"
                  >
                    <Calendar className="w-3.5 h-3.5 text-primary" />
                    <span>Scheduler</span>
                  </Link>
                  {viewMode !== 'PATIENT_MONITOR' && (
                    <>
                      <Link
                        href="/medical-profile"
                        onClick={() => setUserDropdownOpen(false)}
                        className="w-full text-left px-4 py-2 text-sm text-foreground hover:bg-muted font-medium transition-colors cursor-pointer flex items-center gap-2 font-mono"
                      >
                        <HeartPulse className="w-3.5 h-3.5 text-primary" />
                        <span>Medical Profile</span>
                      </Link>
                      <Link
                        href="/emergency"
                        onClick={() => setUserDropdownOpen(false)}
                        className="w-full text-left px-4 py-2 text-sm text-foreground hover:bg-muted font-medium transition-colors cursor-pointer flex items-center gap-2 font-mono border-b border-border"
                      >
                        <Siren className="w-3.5 h-3.5 text-danger" />
                        <span>Emergency Card</span>
                      </Link>
                    </>
                  )}
                  <button
                    onClick={handleLogout}
                    className="w-full text-left px-4 py-2 text-sm text-foreground hover:bg-muted font-medium transition-colors cursor-pointer flex items-center gap-2 font-mono"
                  >
                    <LogOut className="w-3.5 h-3.5 text-muted-foreground" />
                    <span>Sign Out</span>
                  </button>
                </div>
              )}
            </div>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}
