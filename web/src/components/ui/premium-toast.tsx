'use client';

import React, { useEffect, useState } from 'react';
import { CheckCircle, AlertTriangle, X } from 'lucide-react';

export interface ToastItem {
  id: string;
  title: string;
  message: string;
  type: 'success' | 'error';
}

interface PremiumToastProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

/**
 * Premium slide-up dark navy toast component for Re-MIND-eЯ.
 * 
 * Success toasts use a dark navy background (#0F1C5A) with white text.
 * Error toasts use a dark red-tinted background with white text.
 * Both slide up from the bottom with a smooth CSS spring animation and
 * auto-dismiss after 3 seconds.
 */
export function PremiumToast({ toasts, onDismiss }: PremiumToastProps) {
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 sm:left-auto sm:translate-x-0 sm:right-6 z-50 flex flex-col gap-2.5 max-w-sm w-[calc(100%-2rem)] sm:w-full pointer-events-none">
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: string) => void }) {
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    const exitTimer = setTimeout(() => {
      setIsExiting(true);
    }, 2700); // Start exit animation before 3s dismiss

    const dismissTimer = setTimeout(() => {
      onDismiss(toast.id);
    }, 3000);

    return () => {
      clearTimeout(exitTimer);
      clearTimeout(dismissTimer);
    };
  }, [toast.id, onDismiss]);

  const handleDismiss = () => {
    setIsExiting(true);
    setTimeout(() => onDismiss(toast.id), 250);
  };

  const isError = toast.type === 'error';

  return (
    <div
      className={`pointer-events-auto flex items-start gap-3 px-4 py-3.5 rounded-2xl shadow-lg ${
        isExiting ? 'animate-toast-out' : 'animate-toast-in'
      } ${
        isError
          ? 'bg-danger text-white shadow-danger/20'
          : 'bg-[#0F1C5A] text-white shadow-[#0F1C5A]/20'
      }`}
    >
      {isError ? (
        <AlertTriangle className="w-5 h-5 text-white/90 shrink-0 mt-0.5" />
      ) : (
        <CheckCircle className="w-5 h-5 text-white/90 shrink-0 mt-0.5" />
      )}
      <div className="flex-1 space-y-0.5 min-w-0">
        <h5 className="font-bold text-sm text-white leading-tight font-[var(--font-mono)]">{toast.title}</h5>
        <p className="text-xs text-white/70 leading-relaxed">{toast.message}</p>
      </div>
      <button
        onClick={handleDismiss}
        className="text-white/50 hover:text-white/90 transition-colors p-0.5 rounded-md shrink-0"
        aria-label="Dismiss notification"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

/**
 * Hook helper to manage toast state in any component.
 * Returns [toasts, showToast, dismissToast] tuple.
 */
export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = (title: string, message: string, type: 'success' | 'error' = 'success') => {
    const id = `${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    setToasts((prev) => [...prev, { id, title, message, type }]);
  };

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return { toasts, showToast, dismissToast } as const;
}
