'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useUiMode } from '@/context/ui-mode-context';
import { Eye, EyeOff } from 'lucide-react';
import Turnstile, { captchaEnabled } from '@/components/turnstile';

export default function RegisterPage() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);

  const router = useRouter();
  const supabase = createClient();
  const { isElderly } = useUiMode();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (captchaEnabled && !captchaToken) {
      setError('Please complete the verification challenge.');
      return;
    }
    setLoading(true);
    setError(null);

    const { data, error: signupErr } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
        },
        emailRedirectTo: `${window.location.origin}/api/auth/callback?next=/link-account`,
        captchaToken: captchaToken ?? undefined,
      },
    });

    if (signupErr) {
      setError(signupErr.message);
      setLoading(false);
      return;
    }

    setLoading(false);
    // If confirmation is required, show verification prompt. If not, auto-logged in.
    if (data.session) {
      router.refresh();
      router.push('/link-account');
    } else {
      setSuccess(true);
    }
  };

  if (success) {
    return (
      <div className={`space-y-6 text-center transition-all duration-300 ${isElderly ? 'max-w-2xl space-y-8' : ''}`}>
        <div className="inline-flex items-center justify-center w-12 h-12 bg-success/10 text-success rounded-full text-2xl">
          ✉️
        </div>
        <h2 className={`font-bold text-foreground ${isElderly ? 'text-2xl' : 'text-xl'}`}>Verify Your Email</h2>
        <p className={`text-muted-foreground ${isElderly ? 'text-lg mt-2' : 'text-sm'}`}>
          We have sent a verification email to <b>{email}</b>.<br />
          Please click the link in the email to activate your account and set up your Telegram link.
        </p>
        <div className="pt-4">
          <Link href="/login" className={`font-semibold text-primary hover:underline ${isElderly ? 'text-lg' : 'text-sm'}`}>
            Back to Sign In
          </Link>
        </div>
      </div>
    );
  }

  const labelClass = `block font-medium text-foreground ${isElderly ? 'text-lg mb-2 font-bold' : 'text-sm'}`;
  const inputClass = `mt-1 block w-full px-4 border border-input rounded-2xl bg-background text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all ${isElderly ? 'py-4 text-lg border-2' : 'py-3 text-sm'}`;

  return (
    <div className={`space-y-6 transition-all duration-300 ${isElderly ? 'max-w-2xl space-y-8' : ''}`}>
      <div className="text-center">
        <h2 className={`font-bold text-foreground ${isElderly ? 'text-2xl' : 'text-xl'}`}>Create Your Account</h2>
      </div>

      {error && (
        <div className="bg-danger/10 text-danger text-sm p-3 rounded-2xl border border-danger/20">
          ⚠️ {error}
        </div>
      )}

      <form onSubmit={handleRegister} className="space-y-4">
        <div>
          <label className={labelClass}>Full Name</label>
          <input
            type="text"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className={inputClass}
            placeholder="John Doe"
          />
        </div>

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
          <label className={labelClass}>Password</label>
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

        <Turnstile onVerify={setCaptchaToken} />

        <button
          type="submit"
          disabled={loading}
          className={`w-full flex justify-center py-3 px-4 border border-transparent rounded-2xl shadow-sm font-semibold text-primary-foreground bg-primary hover:bg-primary-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 transition-all active:scale-[0.98] cursor-pointer ${isElderly ? 'py-4 text-xl' : 'text-sm'}`}
        >
          {loading ? 'Registering...' : 'Register'}
        </button>
      </form>

      <div className="text-center text-sm">
        <span className="text-muted-foreground">Already have an account? </span>
        <Link href="/login" className="font-medium text-primary hover:underline">
          Sign In
        </Link>
      </div>
    </div>
  );
}
