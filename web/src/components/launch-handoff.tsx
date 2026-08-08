'use client';

import { useEffect } from 'react';

/**
 * The second half of the PWA launch animation.
 *
 * /launch.html (the installed app's start_url, served from the service-worker cache)
 * plays the splash and forwards to /dashboard?launch=1. Without this component the
 * animation dies at the dashboard's FIRST PAINT — which on a slow device is fonts
 * still loading and hydration still running, i.e. visibly not ready. A pre-paint
 * inline script in the root layout sees ?launch=1 and sets `data-launching` on
 * <html>, so this overlay — THE SAME SCENE — is visible from the dashboard's very
 * first frame with no gap, and it only lifts once the window has fully loaded.
 *
 * THE SCENE IS A DELIBERATE DUPLICATE of the one in public/launch.html: that file
 * must stay self-contained to render from cache alone, so it cannot import shared
 * markup. Change one, change both.
 *
 * The overlay is rendered on every page but displayed only under
 * html[data-launching] — normal navigation never shows it.
 */
export default function LaunchHandoff() {
  useEffect(() => {
    const root = document.documentElement;
    if (root.getAttribute('data-launching') !== '1') return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const lift = () => {
      // Let the loaded frame actually paint under the overlay before fading.
      timer = setTimeout(() => {
        root.setAttribute('data-launching', 'lifting');
        timer = setTimeout(() => {
          root.removeAttribute('data-launching');
          // Strip ?launch=1 so a reload or share of the URL doesn't replay the splash.
          const url = new URL(window.location.href);
          url.searchParams.delete('launch');
          window.history.replaceState(null, '', url.pathname + url.search + url.hash);
        }, 350);
      }, 250);
    };

    if (document.readyState === 'complete') {
      lift();
    } else {
      window.addEventListener('load', lift, { once: true });
    }
    // Hard cap: if `load` never fires (a hung image, a flaky connection), the overlay
    // must never trap someone on a splash over a usable page.
    const cap = setTimeout(lift, 6000);
    return () => {
      window.removeEventListener('load', lift);
      clearTimeout(cap);
      if (timer) clearTimeout(timer);
    };
  }, []);

  return (
    <>
      {/* eslint-disable-next-line react/no-unknown-property */}
      <style>{`
        #launch-handoff { display: none; }
        html[data-launching] #launch-handoff {
          display: flex; position: fixed; inset: 0; z-index: 200;
          flex-direction: column; align-items: center; justify-content: center;
          gap: 14px; padding: 24px; text-align: center;
          background: #F8F9FB; color: #0F1C5A;
          font-family: ui-monospace, 'JetBrains Mono', Consolas, monospace;
          opacity: 1; transition: opacity 350ms ease;
        }
        html[data-launching='lifting'] #launch-handoff { opacity: 0; pointer-events: none; }
        html.dark #launch-handoff { background: #0F1C5A; color: #EAF0FF; }
        html.dark #launch-handoff .lh-tablet { background: #2A3B7E; }
        html.dark #launch-handoff .lh-capsule { background: linear-gradient(90deg, #F26B8A 50%, #2A3B7E 50%); }
        #launch-handoff .lh-brain {
          width: 96px; height: 96px; object-fit: contain;
          animation: lhBreathe 1.6s ease-in-out infinite;
        }
        @keyframes lhBreathe {
          0%, 100% { transform: scale(1) translateY(0); }
          50%      { transform: scale(1.07) translateY(-4px); }
        }
        #launch-handoff .lh-name { font-size: 20px; font-weight: 800; letter-spacing: -0.02em; }
        #launch-handoff .lh-choreo { display: flex; align-items: flex-end; gap: 12px; height: 34px; margin-top: 2px; }
        #launch-handoff .lh-pill { animation: lhHop 1.35s cubic-bezier(0.34, 1.56, 0.64, 1) infinite; }
        #launch-handoff .lh-tablet {
          width: 18px; height: 18px; border-radius: 50%;
          background: #FDEEF2; border: 2px solid #CC3D64; position: relative;
        }
        #launch-handoff .lh-tablet::after {
          content: ''; position: absolute; left: 2px; right: 2px; top: 50%;
          height: 2px; margin-top: -1px; border-radius: 1px; background: #CC3D64; opacity: .55;
        }
        #launch-handoff .lh-capsule {
          width: 30px; height: 15px; border-radius: 8px;
          background: linear-gradient(90deg, #CC3D64 50%, #FDEEF2 50%);
          border: 2px solid #CC3D64; animation-delay: 0.15s;
        }
        #launch-handoff .lh-softgel {
          width: 15px; height: 15px; border-radius: 50%;
          background: #34C759; border: 2px solid #1B7A3A; animation-delay: 0.3s;
        }
        #launch-handoff .lh-hint { font-size: 12px; font-weight: 600; opacity: 0.65; }
        @keyframes lhHop {
          0%, 55%, 100% { transform: translateY(0) rotate(0deg); }
          25%           { transform: translateY(-12px) rotate(-10deg); }
          40%           { transform: translateY(-2px) rotate(6deg); }
        }
        @media (prefers-reduced-motion: reduce) {
          #launch-handoff .lh-brain, #launch-handoff .lh-pill { animation: none; }
        }
      `}</style>
      <div id="launch-handoff" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="lh-brain" src="/mascot/reminder.png" alt="" width={96} height={96} />
        <div className="lh-name">Re&#8209;MIND&#8209;e&#1071;</div>
        <div className="lh-choreo">
          <span className="lh-pill lh-tablet" />
          <span className="lh-pill lh-capsule" />
          <span className="lh-pill lh-softgel" />
        </div>
        <p className="lh-hint">Opening your medications…</p>
      </div>
    </>
  );
}
