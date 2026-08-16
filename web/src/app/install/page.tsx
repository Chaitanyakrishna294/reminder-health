'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import PageBack from '@/components/layout/page-back';
import { Download, Share, SquarePlus, MoreVertical } from 'lucide-react';

// Mirrors the type used by components/install-prompt.tsx — not in lib.dom yet.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type Platform = 'checking' | 'promptable' | 'ios' | 'manual';

/**
 * Standalone, shareable "install this app" page (e.g. for a WhatsApp/SMS link).
 * beforeinstallprompt can only fire once a user is on the page in a supporting
 * browser, so this detects the situation and does the right thing:
 * - already installed (opened standalone, or just installed) → redirect to /dashboard
 * - Chrome/Edge/Android → one-tap install button
 * - iOS Safari (never fires beforeinstallprompt) → Add-to-Home-Screen steps
 * - anything else → manual browser-menu install steps
 */
export default function InstallPage() {
  const router = useRouter();
  const [platform, setPlatform] = useState<Platform>('checking');
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;

    // Already installed → send them straight into the app.
    if (isStandalone) {
      router.replace('/dashboard');
      return;
    }

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setPlatform('promptable');
    };
    // Fires right after a successful install → the app now exists, go to it.
    const onInstalled = () => router.replace('/dashboard');

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);

    // beforeinstallprompt fires almost immediately if it's going to fire at all;
    // give it a beat, then fall back to manual steps (iOS-specific or generic).
    const timer = setTimeout(() => {
      setPlatform((current) => (current === 'checking' ? (isIOS ? 'ios' : 'manual') : current));
    }, 800);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
      clearTimeout(timer);
    };
  }, [router]);

  const handleInstall = async () => {
    if (!deferred) return;
    await deferred.prompt();
    try {
      const { outcome } = await deferred.userChoice;
      // appinstalled also redirects, but this is more immediate on accept.
      if (outcome === 'accepted') router.replace('/dashboard');
    } catch {
      /* user dismissed the native dialog */
    }
  };

  return (
    /* `board` + `card-lift` rather than a hex and a border. This route sits
       outside the (dashboard) group, so it never inherited the board ground the
       layout applies — it painted its own #f8fafc, a cool slate against the
       system's warm tray. Spec §1 (the board is the ground, and the shadow IS a
       card's edge), §2 (radius 20, not rounded-3xl's 24 — named there as the
       defect the scale fixes) and §10.2 (a hardcoded colour bypasses the tokens
       and cannot follow dark mode). */
    <div className="flex min-h-screen items-center justify-center px-4 py-12 board">
      <div className="w-full max-w-md card-lift p-8 space-y-6 text-center">
        {/* This page had NO way out at all — no link, no back, nothing but the
            install prompt. Left-aligned inside a centred card on purpose: a back
            control belongs where the thumb looks for it, not in the middle. */}
        <div className="flex justify-start -mt-2 -ml-2">
          <PageBack fallback="/" />
        </div>
        <Image
          src="/icon-192x192.png"
          alt="Re-MIND-eЯ"
          width={72}
          height={72}
          className="mx-auto rounded-2xl shadow-md"
        />

        <div>
          <h1 className="title-page text-foreground">Install Re-MIND-eЯ</h1>
          <p className="text-sm text-muted-foreground font-semibold mt-1">
            Add it to your home screen for faster access and reminders.
          </p>
        </div>

        {platform === 'checking' && (
          <p className="py-6 text-sm text-muted-foreground font-semibold">Checking your browser…</p>
        )}

        {platform === 'promptable' && (
          <button
            onClick={handleInstall}
            className="w-full flex items-center justify-center gap-2 rounded-[var(--r-control)] bg-primary-strong text-primary-strong-foreground font-black px-6 py-4 text-base hover:bg-primary-strong-hover transition-all active:scale-[0.98] cursor-pointer"
          >
            {/* Sentence case (ux-copy): "Install App" was title case. */}
            <Download className="w-5 h-5" /> Install app
          </button>
        )}

        {platform === 'ios' && (
          <div className="space-y-3 text-left surface-sunk p-4">
            <p className="font-mono text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.06em] text-center mb-1">
              Add to Home Screen
            </p>
            <div className="flex items-start gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary border border-primary/20 text-xs font-black flex items-center justify-center">1</span>
              <p className="text-xs font-bold text-foreground flex items-center gap-1.5 flex-wrap">
                Tap the Share icon <Share className="w-3.5 h-3.5 shrink-0" /> in Safari&apos;s toolbar
              </p>
            </div>
            <div className="flex items-start gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary border border-primary/20 text-xs font-black flex items-center justify-center">2</span>
              <p className="text-xs font-bold text-foreground flex items-center gap-1.5 flex-wrap">
                Scroll down and tap <SquarePlus className="w-3.5 h-3.5 shrink-0" /> &quot;Add to Home Screen&quot;
              </p>
            </div>
            <div className="flex items-start gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary border border-primary/20 text-xs font-black flex items-center justify-center">3</span>
              <p className="text-xs font-bold text-foreground">Tap &quot;Add&quot; — the icon appears on your home screen</p>
            </div>
          </div>
        )}

        {platform === 'manual' && (
          <div className="space-y-3">
            <div className="space-y-3 text-left surface-sunk p-4">
              <p className="font-mono text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.06em] text-center mb-1">
                Install from your browser menu
              </p>
              <div className="flex items-start gap-3">
                <span className="shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary border border-primary/20 text-xs font-black flex items-center justify-center">1</span>
                <p className="text-xs font-bold text-foreground flex items-center gap-1.5 flex-wrap">
                  Open your browser menu <MoreVertical className="w-3.5 h-3.5 shrink-0" /> (top-right)
                </p>
              </div>
              <div className="flex items-start gap-3">
                <span className="shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary border border-primary/20 text-xs font-black flex items-center justify-center">2</span>
                <p className="text-xs font-bold text-foreground flex items-center gap-1.5 flex-wrap">
                  Tap <SquarePlus className="w-3.5 h-3.5 shrink-0" /> &quot;Install app&quot; or &quot;Add to Home screen&quot;
                </p>
              </div>
              <div className="flex items-start gap-3">
                <span className="shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary border border-primary/20 text-xs font-black flex items-center justify-center">3</span>
                <p className="text-xs font-bold text-foreground">Confirm — the app icon appears on your device</p>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground font-semibold">
              Don&apos;t see the option? Open this page in Chrome or Edge.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
