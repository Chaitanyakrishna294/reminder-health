'use client';

import React, { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useUiMode } from '@/context/ui-mode-context';
import { Eye, EyeOff, Sparkles, AlertTriangle, Info, Mail, Lock } from 'lucide-react';
import Turnstile, { captchaEnabled } from '@/components/turnstile';

function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const { isElderly } = useUiMode();

  useEffect(() => {
    const errorParam = searchParams.get('error');
    if (errorParam) {
      setError(errorParam);
    }
  }, [searchParams]);

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (captchaEnabled && !captchaToken) {
      setError('Please complete the verification challenge.');
      return;
    }
    setLoading(true);
    setError(null);
    setInfo(null);

    const { error: loginErr } = await supabase.auth.signInWithPassword({
      email,
      password,
      options: { captchaToken: captchaToken ?? undefined },
    });

    if (loginErr) {
      setError(loginErr.message);
      setLoading(false);
    } else {
      router.refresh();
      router.push('/dashboard');
    }
  };

  const handleMagicLink = async () => {
    if (!email) {
      setError('Please enter your email to request a magic link.');
      return;
    }
    setLoading(true);
    setError(null);
    setInfo(null);

    if (captchaEnabled && !captchaToken) {
      setError('Please complete the verification challenge.');
      return;
    }
    const { error: magicErr } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/api/auth/callback?next=/dashboard`,
        captchaToken: captchaToken ?? undefined,
      },
    });

    setLoading(false);
    if (magicErr) {
      setError(magicErr.message);
    } else {
      setMagicLinkSent(true);
      setInfo('Check your email inbox for a direct sign-in link.');
    }
  };

  const inputClass = `w-full pl-11 pr-4 rounded-2xl bg-white border border-border text-foreground shadow-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all ${isElderly ? 'py-4 text-lg' : 'py-3.5 text-sm'}`;
  const iconClass = 'absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none';

  return (
    <div className="space-y-5">
      {error && (
        <div className="bg-danger/10 text-danger text-sm p-3 rounded-2xl border border-danger/20 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> <span>{error}</span>
        </div>
      )}

      {info && (
        <div className="bg-primary/10 text-primary text-sm p-3 rounded-2xl border border-primary/20 flex items-start gap-2">
          <Info className="w-4 h-4 shrink-0 mt-0.5" /> <span>{info}</span>
        </div>
      )}

      <form onSubmit={handlePasswordLogin} className="space-y-3">
        <div>
          <label htmlFor="login-email" className={`block font-bold text-foreground mb-1.5 ${isElderly ? 'text-base' : 'text-xs'}`}>Email</label>
          <div className="relative">
            <Mail className={`${iconClass} w-4 h-4`} />
            <input
              id="login-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
              placeholder="you@example.com"
            />
          </div>
        </div>

        <div>
          <label htmlFor="login-password" className={`block font-bold text-foreground mb-1.5 ${isElderly ? 'text-base' : 'text-xs'}`}>Password</label>
          <div className="relative flex items-center">
            <Lock className={`${iconClass} w-4 h-4`} />
            <input
              id="login-password"
              type={showPassword ? 'text' : 'password'}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`${inputClass} pr-12`}
              placeholder="Your password"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="absolute right-4 text-muted-foreground hover:text-primary transition-colors focus:outline-none flex items-center justify-center"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <div className="flex justify-end mt-1.5">
            <Link href="/forgot-password" className={`text-muted-foreground hover:text-primary transition-colors ${isElderly ? 'text-base' : 'text-xs'}`}>
              Forgot password?
            </Link>
          </div>
        </div>

        <Turnstile onVerify={setCaptchaToken} />

        <button
          type="submit"
          disabled={loading}
          style={{ background: 'linear-gradient(180deg, #F8839E 0%, #F26B8A 100%)' }}
          className={`w-full flex justify-center rounded-2xl shadow-md font-black text-white hover:brightness-[0.97] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 transition-all active:scale-[0.98] cursor-pointer ${isElderly ? 'py-4 text-xl' : 'py-3.5 text-base'}`}
        >
          {loading ? 'Signing In…' : 'Sign In'}
        </button>
      </form>

      <div className="relative flex items-center">
        <div className="flex-grow border-t border-border"></div>
        <span className="flex-shrink mx-4 text-muted-foreground text-xs">or</span>
        <div className="flex-grow border-t border-border"></div>
      </div>

      <Link
        href="/register"
        className="w-full flex items-center justify-center gap-1.5 py-3.5 rounded-2xl bg-white border border-border shadow-sm text-sm text-muted-foreground hover:border-primary/40 transition-all cursor-pointer"
      >
        New to Re-MIND-eЯ? <span className="font-black text-primary">Create account</span>
      </Link>

      <div className="text-center">
        <button
          type="button"
          disabled={loading || magicLinkSent}
          onClick={handleMagicLink}
          className="inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-primary disabled:opacity-50 transition-colors cursor-pointer"
        >
          <Sparkles className="w-3.5 h-3.5 shrink-0" /> Prefer a magic link? Email me one
        </button>
      </div>

      <div className="text-center text-xs text-muted-foreground pt-1">
        <Link href="/privacy" className="hover:underline">Privacy Policy</Link>
        <span className="mx-2">·</span>
        <Link href="/terms" className="hover:underline">Terms of Service</Link>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="text-center text-sm text-muted-foreground py-8">Loading sign-in...</div>}>
      <LoginForm />
    </Suspense>
  );
}
