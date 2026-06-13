'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function LinkAccountPage() {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const router = useRouter();
  const supabase = createClient();

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const formattedCode = code.trim().toUpperCase();

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError('You must be signed in to link your account.');
        setLoading(false);
        return;
      }

      const { data: linkData, error: fetchErr } = await supabase
        .from('link_codes')
        .select('*')
        .eq('code', formattedCode)
        .single();

      if (fetchErr || !linkData) {
        setError('Invalid verification code. Please check and try again.');
        setLoading(false);
        return;
      }

      const expiresAt = new Date(linkData.expires_at).getTime();
      if (expiresAt < Date.now()) {
        setError('This verification code has expired. Please request a new one by typing /linkweb in the bot.');
        setLoading(false);
        return;
      }

      const { error: updateErr } = await supabase
        .from('profiles')
        .update({ telegram_chat_id: linkData.telegram_chat_id })
        .eq('id', user.id);

      if (updateErr) {
        console.error('[LinkAccount] Profile update error:', updateErr);
        setError('Failed to update profile. Please try again.');
        setLoading(false);
        return;
      }

      await supabase
        .from('link_codes')
        .delete()
        .eq('id', linkData.id);

      setSuccess(true);
      setLoading(false);

      setTimeout(() => {
        router.refresh();
        router.push('/dashboard');
      }, 1500);

    } catch (err) {
      console.error('[LinkAccount] Unexpected error:', err);
      setError('An unexpected error occurred. Please try again.');
      setLoading(false);
    }
  };

  const handleSkip = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError('You must be signed in.');
        setLoading(false);
        return;
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('telegram_chat_id')
        .eq('id', user.id)
        .single();

      if (profile && !profile.telegram_chat_id) {
        const { error: updateErr } = await supabase
          .from('profiles')
          .update({ telegram_chat_id: `WEB-${user.id}` })
          .eq('id', user.id);

        if (updateErr) throw updateErr;
      }

      router.refresh();
      router.push('/dashboard');
    } catch (err) {
      console.error('[LinkAccount] Skip error:', err);
      setError('Failed to skip. Please try again.');
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12 sm:px-6 lg:px-8 bg-[#f8fafc]">
      
      {/* Crisp Soft White Card Container */}
      <div className="w-full max-w-lg bg-white border border-border/80 shadow-sm rounded-3xl p-8 space-y-8">
        
        {/* Header Branding */}
        <div className="text-center space-y-2">
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-black bg-primary/10 text-primary border border-primary/20">
            🤖 Telegram Syncing
          </span>
          <h2 className="text-3xl font-black text-foreground tracking-tight">
            Connect Your Account
          </h2>
          <p className="text-xs text-muted-foreground font-semibold">
            To view reminders and track your progress, let's pair your Telegram bot.
          </p>
        </div>

        {success ? (
          <div className="space-y-4 text-center py-6">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-success/15 text-success rounded-full text-3xl shadow-lg border border-success/30 animate-pulse">
              ✓
            </div>
            <h3 className="text-xl font-black text-foreground">Verification Confirmed!</h3>
            <p className="text-sm text-muted-foreground font-semibold">
              Redirecting you to your workspace dashboard...
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            
            {error && (
              <div className="bg-danger/10 text-danger text-xs p-4 rounded-2xl border border-danger/20 font-bold">
                ⚠️ {error}
              </div>
            )}

            {/* Premium 3-Step Flow and QR Container */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center border border-border bg-muted/30 p-5 rounded-2xl">
              
              {/* Steps Checklist */}
              <div className="md:col-span-7 space-y-4">
                <h3 className="text-xs font-black text-muted-foreground uppercase tracking-widest">Setup Guide</h3>
                
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary border border-primary/20 text-xs font-black flex items-center justify-center">1</span>
                    <div>
                      <p className="text-xs font-black text-foreground">Open Telegram Bot</p>
                      <p className="text-[10px] text-muted-foreground font-medium">Search for bot or click QR connect.</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary border border-primary/20 text-xs font-black flex items-center justify-center">2</span>
                    <div>
                      <p className="text-xs font-black text-foreground">Request Pairing Code</p>
                      <p className="text-[10px] text-muted-foreground font-medium">Send <code className="bg-muted px-1 py-0.5 rounded font-mono font-bold text-[10px]">/linkweb</code> to the bot.</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary border border-primary/20 text-xs font-black flex items-center justify-center">3</span>
                    <div>
                      <p className="text-xs font-black text-foreground">Enter Pairing Code</p>
                      <p className="text-[10px] text-muted-foreground font-medium">Copy & paste code in the field below.</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* QR Code Glass Connect Box */}
              <div className="md:col-span-5 flex flex-col items-center justify-center">
                <a 
                  href="https://t.me/reminder_health_bot" 
                  target="_blank" 
                  rel="noreferrer"
                  className="relative group overflow-hidden border border-white/50 dark:border-slate-800/50 bg-white/40 dark:bg-slate-900/40 backdrop-blur-md rounded-2xl p-3 flex flex-col items-center justify-center space-y-2 transition-all hover:scale-105 active:scale-95 shadow-md max-w-[140px] w-full"
                >
                  {/* Scanner moving light line */}
                  <div className="absolute left-0 right-0 h-0.5 bg-primary/75 animate-bounce shadow-[0_0_6px_#5B8DEF] z-10" style={{ top: '25%' }} />
                  
                  <div className="w-24 h-24 bg-white rounded-xl p-1 flex items-center justify-center border border-primary/20">
                    <svg viewBox="0 0 100 100" className="w-full h-full text-slate-950">
                      {/* Left Top square */}
                      <rect x="0" y="0" width="28" height="28" fill="currentColor" />
                      <rect x="4" y="4" width="20" height="20" fill="white" />
                      <rect x="8" y="8" width="12" height="12" fill="currentColor" />

                      {/* Right Top square */}
                      <rect x="72" y="0" width="28" height="28" fill="currentColor" />
                      <rect x="76" y="4" width="20" height="20" fill="white" />
                      <rect x="80" y="8" width="12" height="12" fill="currentColor" />

                      {/* Left Bottom square */}
                      <rect x="0" y="72" width="28" height="28" fill="currentColor" />
                      <rect x="4" y="76" width="20" height="20" fill="white" />
                      <rect x="8" y="80" width="12" height="12" fill="currentColor" />

                      {/* Random mock QR paths */}
                      <rect x="36" y="8" width="8" height="20" fill="currentColor" />
                      <rect x="48" y="16" width="12" height="12" fill="currentColor" />
                      <rect x="36" y="36" width="28" height="28" fill="currentColor" />
                      <rect x="42" y="42" width="16" height="16" fill="white" />
                      <rect x="12" y="36" width="12" height="12" fill="currentColor" />
                      <rect x="80" y="36" width="12" height="8" fill="currentColor" />
                      <rect x="72" y="56" width="16" height="12" fill="currentColor" />
                      <rect x="36" y="72" width="24" height="8" fill="currentColor" />
                      <rect x="8" y="56" width="12" height="8" fill="currentColor" />
                      <rect x="52" y="80" width="16" height="16" fill="currentColor" />
                      <rect x="80" y="80" width="12" height="12" fill="currentColor" />
                    </svg>
                  </div>
                  <span className="text-[9px] font-black text-muted-foreground tracking-wider text-center uppercase">Quick Link</span>
                </a>
              </div>

            </div>

            {/* Pairing Code Verification Form */}
            <form onSubmit={handleVerify} className="space-y-4">
              <div>
                <label className="block text-xs font-black text-foreground uppercase tracking-widest mb-1.5 text-center">Verification Code</label>
                <input
                  type="text"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="block w-full px-4 py-3 border border-input rounded-2xl bg-background text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-center font-mono font-black text-xl placeholder-muted-foreground/45 uppercase tracking-widest"
                  placeholder="RMDR-XXXXXX"
                  maxLength={11}
                />
              </div>

              <button
                type="submit"
                disabled={loading || code.trim().length < 11}
                className="w-full flex justify-center py-3.5 px-4 border border-transparent rounded-2xl shadow-lg text-sm font-black text-primary-foreground bg-primary hover:bg-primary-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 transition-all cursor-pointer active:scale-[0.98]"
              >
                {loading ? 'Confirming Code...' : 'Synchronize Bot'}
              </button>
            </form>

            <div className="relative flex py-1 items-center">
              <div className="flex-grow border-t border-border/60"></div>
              <span className="flex-shrink mx-4 text-muted-foreground text-[10px] font-black uppercase tracking-wider">Or</span>
              <div className="flex-grow border-t border-border/60"></div>
            </div>

            <button
              type="button"
              onClick={handleSkip}
              disabled={loading}
              className="w-full flex justify-center py-3.5 px-4 border border-border rounded-2xl shadow-sm text-sm font-black text-foreground bg-muted hover:bg-muted/80 transition-all cursor-pointer active:scale-[0.98]"
            >
              Skip for Now (Use Web-Only)
            </button>

            <div className="pt-2 text-center">
              <button
                type="button"
                onClick={handleLogout}
                className="text-xs font-bold text-muted-foreground hover:text-danger transition-colors cursor-pointer"
              >
                Sign out of current account
              </button>
            </div>

          </div>
        )}
      </div>

    </div>
  );
}
