'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useUiMode } from '@/context/ui-mode-context';
import { Lock, AlertCircle, CheckCircle, Eye, EyeOff } from 'lucide-react';

export default function UpdatePasswordPage() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const supabase = createClient();
  const { isElderly } = useUiMode();

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (password.length < 6) {
      setError('Password must be at least 6 characters long.');
      setLoading(false);
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      setLoading(false);
      return;
    }

    const { error: updateErr } = await supabase.auth.updateUser({
      password: password,
    });

    setLoading(false);
    if (updateErr) {
      setError(updateErr.message);
    } else {
      setSuccess(true);
    }
  };

  if (success) {
    return (
      <div className={`space-y-6 text-center transition-all duration-300 ${isElderly ? 'max-w-2xl space-y-8' : ''}`}>
        <div className={`inline-flex items-center justify-center bg-success/10 text-success rounded-full ${isElderly ? 'w-16 h-16' : 'w-12 h-12'}`}>
          <CheckCircle className={isElderly ? 'w-8 h-8' : 'w-6 h-6'} />
        </div>
        <h2 className={`font-bold text-foreground ${isElderly ? 'text-2xl' : 'text-xl'}`}>Password Updated</h2>
        <p className={`text-muted-foreground ${isElderly ? 'text-lg mt-2' : 'text-sm'}`}>
          Your password has been successfully updated. You can now access your dashboard.
        </p>
        <div className="pt-4">
          <Link
            href="/dashboard"
            className={`w-full flex justify-center py-3 px-4 border border-transparent rounded-2xl shadow-sm font-semibold text-primary-foreground bg-primary hover:bg-primary-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition-all active:scale-[0.98] cursor-pointer text-center ${isElderly ? 'py-4 text-xl' : 'text-sm'}`}
          >
            Go to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  const labelClass = `block font-bold text-foreground ${isElderly ? 'text-lg mb-2' : 'text-xs font-semibold mb-1'}`;
  const inputClass = `mt-1 block w-full px-4 border border-input rounded-2xl bg-background text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all ${isElderly ? 'py-4 text-lg border-2' : 'py-3 text-sm'}`;

  return (
    <div className={`space-y-6 transition-all duration-300 ${isElderly ? 'max-w-2xl space-y-8' : ''}`}>
      <div className="text-center">
        <h2 className={`font-bold text-foreground ${isElderly ? 'text-2xl' : 'text-xl'}`}>Update Password</h2>
        <p className={`text-muted-foreground mt-1 ${isElderly ? 'text-lg' : 'text-xs'}`}>
          Enter a secure new password for your Re-MIND-eЯ account.
        </p>
      </div>

      {error && (
        <div className="bg-danger/10 text-danger text-sm p-3 rounded-2xl border border-danger/20 flex items-center gap-2">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleUpdatePassword} className="space-y-4">
        <div>
          <label className={labelClass}>New Password</label>
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

        <div>
          <label className={labelClass}>Confirm New Password</label>
          <div className="relative flex items-center">
            <input
              type={showConfirmPassword ? 'text' : 'password'}
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={`${inputClass} pr-12`}
              placeholder="••••••••"
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              className={`absolute right-4 text-muted-foreground hover:text-primary transition-colors focus:outline-none flex items-center justify-center ${isElderly ? 'w-10 h-10' : 'w-6 h-6'}`}
            >
              {showConfirmPassword ? (
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
          className={`w-full flex justify-center items-center gap-2 border border-transparent rounded-2xl shadow-sm font-semibold text-primary-foreground bg-primary hover:bg-primary-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 transition-all active:scale-[0.98] cursor-pointer ${isElderly ? 'py-4 text-xl' : 'py-3 text-sm'}`}
        >
          <Lock className={isElderly ? 'w-6 h-6' : 'w-4 h-4'} />
          {loading ? 'Updating...' : 'Update Password'}
        </button>
      </form>

      <div className="text-center">
        <Link 
          href="/login" 
          className={`font-semibold text-primary hover:underline ${isElderly ? 'text-lg' : 'text-sm'}`}
        >
          Back to Sign In
        </Link>
      </div>
    </div>
  );
}
