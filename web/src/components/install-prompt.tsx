'use client';

import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';

// The browser's install event (Chrome/Edge/Android/desktop). Not in lib.dom yet.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// Once the user closes the banner we remember it and only show the compact icon
// from then on (across pages/sessions), so they're never nagged by the full banner again.
const COLLAPSED_KEY = 'installPromptCollapsed';

/**
 * App-wide "Install app" suggestion.
 * - First time: a full banner with an Install button.
 * - After the user taps ✕: collapses to a small floating download icon that
 *   persists across navigation; tapping it runs the install.
 * Only rendered when the app is actually installable (beforeinstallprompt fired)
 * and not already installed. iOS Safari uses the separate Add-to-Home-Screen hint.
 */
export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (isStandalone) return;

    try {
      if (localStorage.getItem(COLLAPSED_KEY) === '1') setCollapsed(true);
    } catch {
      /* ignore */
    }

    const onBeforeInstall = (e: Event) => {
      e.preventDefault(); // suppress the default mini-infobar; we render our own UI
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferred(null);
      try {
        localStorage.removeItem(COLLAPSED_KEY);
      } catch {
        /* ignore */
      }
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferred) return;
    await deferred.prompt();
    try {
      const { outcome } = await deferred.userChoice;
      if (outcome === 'accepted') setDeferred(null); // a used prompt can't be reused
    } catch {
      /* user dismissed the native dialog */
    }
  };

  const handleCollapse = () => {
    try {
      localStorage.setItem(COLLAPSED_KEY, '1');
    } catch {
      /* ignore */
    }
    setCollapsed(true);
  };

  // Nothing to offer unless the browser says the app is installable.
  if (!deferred) return null;

  // Collapsed: unobtrusive floating icon that survives page navigation.
  if (collapsed) {
    return (
      <button
        onClick={handleInstall}
        aria-label="Install Re-MIND-eЯ app"
        title="Install app"
        className="fixed bottom-4 right-4 z-[90] w-12 h-12 rounded-full bg-primary text-primary-foreground shadow-2xl flex items-center justify-center hover:bg-primary-hover transition-all cursor-pointer"
      >
        <Download className="w-5 h-5" />
      </button>
    );
  }

  // First-run: full banner.
  return (
    <div
      role="dialog"
      aria-label="Install app"
      className="fixed bottom-4 left-4 right-4 sm:right-auto sm:max-w-sm z-[90]"
    >
      <div className="rounded-2xl border border-border bg-card shadow-2xl p-4 flex items-center gap-3">
        <div className="shrink-0 w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          <Download className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-foreground">Install Re-MIND-eЯ</p>
          <p className="text-xs text-muted-foreground">Add it to your device for faster access and reminders.</p>
        </div>
        <button
          onClick={handleInstall}
          className="shrink-0 rounded-xl bg-primary text-primary-foreground font-bold px-4 py-2 text-sm hover:bg-primary-hover transition-all cursor-pointer"
        >
          Install
        </button>
        <button
          onClick={handleCollapse}
          aria-label="Minimize install suggestion"
          className="shrink-0 text-muted-foreground hover:text-foreground p-1 rounded-full transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
