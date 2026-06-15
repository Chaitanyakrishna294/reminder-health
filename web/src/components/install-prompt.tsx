'use client';

import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';

// The browser's install event (Chrome/Edge/Android/desktop). Not in lib.dom yet.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'dismissedInstallPrompt';

/**
 * App-wide "Install app" suggestion. Captures the browser's beforeinstallprompt
 * event and offers a one-tap install. Hidden when already installed (standalone)
 * or previously dismissed. iOS Safari doesn't fire this event, so iOS continues
 * to use the manual "Add to Home Screen" hint shown elsewhere.
 */
export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (isStandalone) return;

    try {
      if (localStorage.getItem(DISMISS_KEY) === 'true') return;
    } catch {
      /* ignore */
    }

    const onBeforeInstall = (e: Event) => {
      e.preventDefault(); // stop the default mini-infobar so we can show our own
      setDeferred(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    const onInstalled = () => {
      setVisible(false);
      setDeferred(null);
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
      await deferred.userChoice;
    } catch {
      /* user dismissed */
    }
    setVisible(false);
    setDeferred(null);
  };

  const handleDismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, 'true');
    } catch {
      /* ignore */
    }
    setVisible(false);
  };

  if (!visible) return null;

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
          onClick={handleDismiss}
          aria-label="Dismiss install suggestion"
          className="shrink-0 text-muted-foreground hover:text-foreground p-1 rounded-full transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
