'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useUiMode } from '@/context/ui-mode-context';
import { Pill, User, Users, ChevronDown, LogOut } from 'lucide-react';
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
  };
}

export default function Navbar({ user }: NavbarProps) {
  const router = useRouter();
  const supabase = createClient();
  const { isElderly, toggleMode, viewMode } = useUiMode();
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.refresh();
    router.push('/login');
  };

  return (
    <nav className="bg-white border-b border-border/80 shadow-sm sticky top-0 z-40 transition-all duration-300">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className={`flex justify-between items-center transition-all duration-300 ${isElderly ? 'h-20' : 'h-16'
          }`}>
          {/* Logo and Brand */}
          <div className="flex items-center">
            <Link href="/dashboard" className="flex items-center space-x-2">
              <Pill className="text-primary w-6 h-6 shrink-0" />
              <span className={`font-black text-foreground tracking-tight transition-all duration-300 font-mono flex items-center gap-0.5 ${isElderly ? 'text-2xl' : 'text-lg'
                }`}>
                <span>Re</span>
                <img
                  src="/logo2.png"
                  alt="MIND"
                  className="inline-block rounded-md object-contain shrink-0 bg-white"
                  style={{
                    width: isElderly ? '75px' : '55px',
                    height: isElderly ? '75x' : '55px'
                  }}
                />
                <span>eЯ</span>
              </span>
            </Link>
          </div>

          {/* Action Center (Role Switcher, Realtime Bell, Mode Toggle, Profile Dropdown) */}
          <div className="flex items-center space-x-3 sm:space-x-4">

            {/* Realtime Bell */}
            <NotificationCenter userId={user.id} />

            {/* Mode Switcher Toggle */}
            <button
              onClick={toggleMode}
              className={`flex items-center justify-center font-bold rounded-2xl transition-all duration-200 border cursor-pointer hover:scale-[1.02] active:scale-[0.98] font-mono ${isElderly
                ? 'bg-warning/20 hover:bg-warning/35 border-warning/50 text-warning-foreground px-4 py-2.5 text-base shadow-sm font-extrabold'
                : 'bg-muted hover:bg-muted/80 border-border text-foreground/80 hover:text-foreground px-2.5 py-1.5 text-xs font-semibold'
                }`}
            >
              <User className="w-3.5 h-3.5 mr-1" />
              <span>{isElderly ? 'Normal Mode' : 'Elderly Mode'}</span>
            </button>

            {/* Profile Dropdown */}
            <div className="relative">
              <button
                onClick={() => setUserDropdownOpen(!userDropdownOpen)}
                className="flex items-center space-x-2 focus:outline-none cursor-pointer font-mono"
              >
                <div className={`rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold border border-primary/20 transition-all ${isElderly ? 'w-10 h-10 text-base' : 'w-8 h-8 text-sm'
                  }`}>
                  {user.fullName.substring(0, 2).toUpperCase()}
                </div>
                <span className={`hidden sm:inline font-semibold text-foreground ${isElderly ? 'text-base' : 'text-sm'
                  }`}>
                  {user.fullName}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              </button>

              {userDropdownOpen && (
                <div className="absolute right-0 mt-2 w-56 bg-card rounded-md shadow-lg border border-border py-1 z-50">
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
    </nav>
  );
}
