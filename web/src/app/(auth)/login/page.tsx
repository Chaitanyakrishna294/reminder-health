'use client';

import React, { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useUiMode } from '@/context/ui-mode-context';
import { Eye, EyeOff, Sparkles, AlertTriangle, Info } from 'lucide-react';

function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  
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
    setLoading(true);
    setError(null);
    setInfo(null);

    const { error: loginErr } = await supabase.auth.signInWithPassword({
      email,
      password,
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

    const { error: magicErr } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/api/auth/callback?next=/dashboard`,
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

  const labelClass = `block font-medium text-foreground ${isElderly ? 'text-lg mb-2 font-bold' : 'text-sm'}`;
  const inputClass = `mt-1 block w-full px-4 border border-input rounded-2xl bg-background text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all ${isElderly ? 'py-4 text-lg border-2' : 'py-3 text-sm'}`;

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className={`font-bold text-foreground ${isElderly ? 'text-2xl' : 'text-xl'}`}>Sign In to Dashboard</h2>
      </div>

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

      <form onSubmit={handlePasswordLogin} className="space-y-4">
        <div>
          <label className={labelClass}>Email address</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
            placeholder="you@example.com"
          />
        </div>

        <div>
          <div className="flex items-center justify-between">
            <label className={labelClass}>Password</label>
            <Link
              href="/forgot-password"
              className={`text-primary hover:underline ${isElderly ? 'text-base font-bold' : 'text-xs'}`}
            >
              Forgot password?
            </Link>
          </div>
          <div className="relative flex items-center">
            <input
              type={showPassword ? 'text' : 'password'}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`${inputClass} pr-12`}
              placeholder="••••••••"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className={`absolute right-4 text-muted-foreground hover:text-primary transition-colors focus:outline-none flex items-center justify-center ${isElderly ? 'w-10 h-10' : 'w-6 h-6'}`}
            >
              {showPassword ? (
                <EyeOff className={isElderly ? 'w-6 h-6' : 'w-4 h-4'} />
              ) : (
                <Eye className={isElderly ? 'w-6 h-6' : 'w-4 h-4'} />
              )}
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className={`w-full flex justify-center py-3 px-4 border border-transparent rounded-2xl shadow-sm font-semibold text-primary-foreground bg-primary hover:bg-primary-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 transition-all active:scale-[0.98] cursor-pointer ${isElderly ? 'py-4 text-xl' : 'text-sm'}`}
        >
          {loading ? 'Signing In...' : 'Sign In with Password'}
        </button>
      </form>

      <div className="relative flex items-center py-2">
        <div className="flex-grow border-t border-border"></div>
        <span className="flex-shrink mx-4 text-muted-foreground text-xs uppercase">Or</span>
        <div className="flex-grow border-t border-border"></div>
      </div>

      <button
        type="button"
        disabled={loading || magicLinkSent}
        onClick={handleMagicLink}
        className="w-full flex items-center justify-center gap-2 py-3 px-4 border border-primary/30 rounded-2xl shadow-sm text-sm font-semibold text-primary bg-primary-soft hover:bg-primary/15 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 transition-all active:scale-[0.98] cursor-pointer"
      >
        <Sparkles className="w-4 h-4 shrink-0" /> Send Login Magic Link
      </button>

      <div className="text-center text-sm">
        <span className="text-muted-foreground">Don't have an account? </span>
        <Link href="/register" className="font-medium text-primary hover:underline">
          Register
        </Link>
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
