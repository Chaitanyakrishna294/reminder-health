'use client';

import { useEffect } from 'react';

/**
 * The second half of the PWA launch animation.
 *
 * /launch.html (the installed app's start_url, served from the service-worker cache)
 * plays the splash and forwards to /dashboard?launch=1. A pre-paint inline script in
 * the root layout sees the param and sets `data-launching` on <html>, so this overlay
 * — THE SAME SCENE — is visible from the dashboard's very first frame with no gap,
 * and it lifts only once the window has fully loaded.
 *
 * The lift ends with the capsule FLYING HOME into the dock's centre Medications slot
 * and the icon answering with its existing press squash. Design decisions there, each
 * from an adversarial review that caught the naive version being wrong:
 *
 * - The visible nav link is found by iterating candidates and testing
 *   getClientRects().length — querySelector alone returns the HIDDEN desktop rail
 *   first on mobile (document order), whose 0x0 rect at (0,0) would send the capsule
 *   to the top-left corner. offsetParent is useless here: both navs are fixed.
 * - The flying capsule is a bare CLONE parented to document.body. Inside the overlay
 *   it would inherit the 350ms fade (child opacity multiplies) and be display:none'd
 *   mid-flight by the attribute teardown.
 * - The flight is driven by WAAPI, which supersedes CSS animations — the source
 *   pill's infinite hop would win the cascade over any inline transform. The source
 *   is measured only after its animations are cancelled and a frame has passed, so
 *   the start rect is the rest pose, not a mid-hop snapshot.
 * - The landing squash is fire-and-forget: pointerdown is dispatched on the icon's
 *   <svg> and bubbles to NavIcon's wrapper handler. If hydration hasn't attached the
 *   handler yet, the event is dropped and the teardown proceeds unchanged.
 * - Plain-fade fallbacks: reduced motion, ELDERLY MODE (this app's own accessibility
 *   mode — its users are the least likely to have OS-level reduced-motion set and the
 *   most likely to be vestibularly sensitive, so the app's setting outranks the OS
 *   default), monitoring mode (no Medications link), document hidden, and the 6s cap
 *   (readyState !== 'complete' means layout can't be trusted for a measured flight).
 *
 * THE SCENE IS A DELIBERATE DUPLICATE of public/launch.html — that file must stay
 * self-contained to render from cache alone. Change one, change both. (One known
 * divergence: launch.html fakes the colour fields with pre-blurred radial-gradients
 * for instant first paint; here the real blur() matches the med-due gate.)
 */
export default function LaunchHandoff() {
  useEffect(() => {
    const root = document.documentElement;
    if (root.getAttribute('data-launching') !== '1') return;

    let done = false;
    let capTimer: ReturnType<typeof setTimeout> | null = null;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (fn: () => void, ms: number) => { timers.push(setTimeout(fn, ms)); };

    const teardown = () => {
      root.removeAttribute('data-launching');
      // Strip ?launch=1 so a reload or share of the URL doesn't replay the splash.
      const url = new URL(window.location.href);
      url.searchParams.delete('launch');
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    };

    const plainFade = () => {
      root.setAttribute('data-launching', 'lifting');
      later(teardown, 350);
    };

    const flight = () => {
      const source = document.querySelector<HTMLElement>('#launch-handoff .lh-capsule');
      // The FIRST match can be the hidden desktop rail (document order); take the
      // one that actually has a rendered box.
      const link = [...document.querySelectorAll<HTMLElement>(
        '[data-tour="dash-nav"] a[href="/medications"], aside a[href="/medications"]'
      )].find(el => el.getClientRects().length > 0);
      const iconRect = link?.querySelector('svg')?.getBoundingClientRect();
      if (!source || !link || !iconRect || iconRect.width === 0) { plainFade(); return; }

      // Rest-pose measurement: cancel the hop first, give the engine one frame.
      source.getAnimations({ subtree: true }).forEach(a => a.cancel());
      requestAnimationFrame(() => {
        const from = source.getBoundingClientRect();
        source.style.visibility = 'hidden';

        const clone = source.cloneNode(true) as HTMLElement;
        clone.className = '';
        clone.setAttribute('aria-hidden', 'true');
        Object.assign(clone.style, {
          position: 'fixed',
          left: `${from.left}px`, top: `${from.top}px`,
          width: `${from.width}px`, height: `${from.height}px`,
          margin: '0', zIndex: '201', pointerEvents: 'none',
          borderRadius: '8px',
          background: 'linear-gradient(90deg, #CC3D64 50%, #FDEEF2 50%)',
          border: '2px solid #CC3D64',
          boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.4)',
        });
        document.body.appendChild(clone);

        // Overlay (mascot, fields, caption) fades out UNDER the flying clone; the
        // page beneath is already interactive — 'lifting' sets pointer-events: none.
        root.setAttribute('data-launching', 'lifting');
        later(teardown, 350);

        const dx = (iconRect.left + iconRect.width / 2) - (from.left + from.width / 2);
        const dy = (iconRect.top + iconRect.height / 2) - (from.top + from.height / 2);
        const scale = Math.min(iconRect.width / from.width, 1);
        const anim = clone.animate(
          [
            { transform: 'translate(0, 0) scale(1) rotate(0deg)', opacity: 1 },
            { transform: `translate(${dx * 0.75}px, ${dy * 0.75}px) scale(${(1 + scale) / 2}) rotate(15deg)`, opacity: 1, offset: 0.75 },
            { transform: `translate(${dx}px, ${dy}px) scale(${scale}) rotate(20deg)`, opacity: 0 },
          ],
          { duration: 600, easing: 'cubic-bezier(0.32, 0.72, 0, 1)', fill: 'forwards' }
        );

        const land = () => {
          if (!clone.isConnected) return;
          clone.remove();
          // Restore the hidden source: a real launch never re-shows the overlay, but
          // anything that re-flags data-launching must find the scene whole.
          source.style.visibility = '';
          // "The dock catches the pill": bubbles to NavIcon's onPointerDown. A
          // pointerdown alone can't navigate, so this is side-effect-free.
          link.querySelector('svg')?.dispatchEvent(
            new PointerEvent('pointerdown', { bubbles: true })
          );
          // Debug/verification hook: what flew, from where, to where.
          (window as any).__launchHandoffLast = {
            flew: true, dx: Math.round(dx), dy: Math.round(dy),
            target: { x: Math.round(iconRect.left), y: Math.round(iconRect.top) },
          };
        };
        anim.finished.then(land).catch(() => clone.remove());
        later(() => { anim.cancel(); land(); }, 900); // safety: never leave a stray clone
      });
    };

    const lift = () => {
      if (done) return;           // the 6s cap and `load` both route here — run once
      done = true;
      if (capTimer) clearTimeout(capTimer);
      // Let the loaded frame paint under the overlay before anything moves.
      later(() => {
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        let elderly = false;
        try { elderly = localStorage.getItem('ui-mode') === 'elderly'; } catch { /* fade */ }
        if (reduced || elderly || document.hidden || document.readyState !== 'complete') {
          plainFade();
        } else {
          flight();
        }
      }, 250);
    };

    if (document.readyState === 'complete') {
      lift();
    } else {
      window.addEventListener('load', lift, { once: true });
    }
    // Hard cap: if `load` never fires, the overlay must never trap someone on a
    // splash over a usable page. readyState won't be 'complete', so this fades.
    capTimer = setTimeout(lift, 6000);

    return () => {
      window.removeEventListener('load', lift);
      if (capTimer) clearTimeout(capTimer);
      timers.forEach(clearTimeout);
    };
  }, []);

  return (
    <>
      <style>{`
        #launch-handoff { display: none; }
        html[data-launching] #launch-handoff {
          display: flex; position: fixed; inset: 0; z-index: 200;
          flex-direction: column; align-items: center; justify-content: center;
          gap: 14px; padding: 24px; text-align: center; overflow: hidden;
          background: #F8F9FB; color: #0F1C5A;
          font-family: ui-monospace, 'JetBrains Mono', Consolas, monospace;
          opacity: 1; transition: opacity 350ms ease;
        }
        html[data-launching='lifting'] #launch-handoff { opacity: 0; pointer-events: none; }
        html.dark #launch-handoff { background: #0F1C5A; color: #EAF0FF; }
        /* Blur sits on each FIELD, never the container: a filtered container becomes
           a containing block that breaks position:fixed and repaints enormously. */
        #launch-handoff .lh-field { position: absolute; border-radius: 50%; filter: blur(72px); opacity: 0.7; pointer-events: none; }
        #launch-handoff .lh-f1 { width: 24rem; height: 24rem; top: -7rem; left: -8rem; background: #F7CCDB; }
        #launch-handoff .lh-f2 { width: 21rem; height: 21rem; bottom: -6rem; right: -7rem; background: #CBDCF2; }
        #launch-handoff .lh-f3 { width: 18rem; height: 18rem; top: 38%; right: -6rem; background: #F6E3CA; }
        html.dark #launch-handoff .lh-field { opacity: 0.5; }
        html.dark #launch-handoff .lh-f1 { background: #24378F; }
        html.dark #launch-handoff .lh-f2 { background: #1B3A78; }
        html.dark #launch-handoff .lh-f3 { background: #3A2A6B; }
        #launch-handoff .lh-scene { position: relative; display: flex; flex-direction: column; align-items: center; gap: 14px; }
        #launch-handoff .lh-brain {
          width: 96px; height: 96px; object-fit: contain;
          animation: lhBreathe 1.6s ease-in-out infinite;
        }
        #launch-handoff .lh-name { font-size: 20px; font-weight: 800; letter-spacing: -0.02em; }
        #launch-handoff .lh-choreo { display: flex; align-items: flex-end; gap: 14px; height: 40px; margin-top: 2px; }
        #launch-handoff .lh-slot { display: flex; flex-direction: column; align-items: center; gap: 3px; }
        #launch-handoff .lh-pill { animation: lhHop 1.35s cubic-bezier(0.34, 1.56, 0.64, 1) infinite; }
        #launch-handoff .lh-pill-shadow {
          width: 14px; height: 3px; border-radius: 50%;
          background: rgba(15, 28, 90, 0.18);
          animation: lhSquash 1.35s cubic-bezier(0.34, 1.56, 0.64, 1) infinite;
        }
        /* NOT the --warning token: warning means low stock / skipped, and the next
           screen can be the med-due gate where that orange is the overdue ring. */
        #launch-handoff .lh-tablet {
          width: 18px; height: 18px; border-radius: 50%;
          background: #FDF1DF; border: 2px solid #B36B00; position: relative;
        }
        #launch-handoff .lh-tablet::after {
          content: ''; position: absolute; left: 2px; right: 2px; top: 50%;
          height: 2px; margin-top: -1px; border-radius: 1px; background: #B36B00; opacity: .6;
        }
        html.dark #launch-handoff .lh-tablet { background: #3A2F1E; border-color: #E8A13D; }
        html.dark #launch-handoff .lh-tablet::after { background: #E8A13D; }
        #launch-handoff .lh-capsule {
          width: 30px; height: 15px; border-radius: 8px;
          background: linear-gradient(90deg, #CC3D64 50%, #FDEEF2 50%);
          border: 2px solid #CC3D64;
          box-shadow: inset 0 1px 1px rgba(255,255,255,0.4);
        }
        html.dark #launch-handoff .lh-capsule { background: linear-gradient(90deg, #F26B8A 50%, #2A3B7E 50%); }
        #launch-handoff .lh-softgel {
          width: 15px; height: 15px; border-radius: 50%;
          background: #34C759; border: 2px solid #1B7A3A;
          box-shadow: inset 0 1px 1px rgba(255,255,255,0.35);
        }
        #launch-handoff .lh-slot:nth-child(2) .lh-pill,
        #launch-handoff .lh-slot:nth-child(2) .lh-pill-shadow { animation-delay: 0.15s; }
        #launch-handoff .lh-slot:nth-child(3) .lh-pill,
        #launch-handoff .lh-slot:nth-child(3) .lh-pill-shadow { animation-delay: 0.3s; }
        /* 0.75, not 0.65: where two mesh fields overlap, 0.65 measured 4.48:1 —
           under the floor. Keep in lockstep with launch.html's .hint. */
        #launch-handoff .lh-hint { font-size: 12px; font-weight: 600; opacity: 0.75; }
        @keyframes lhBreathe {
          0%, 100% { transform: scale(1) translateY(0); }
          50%      { transform: scale(1.07) translateY(-4px); }
        }
        @keyframes lhHop {
          0%, 55%, 100% { transform: translateY(0) rotate(0deg); }
          25%           { transform: translateY(-12px) rotate(-10deg); }
          40%           { transform: translateY(-2px) rotate(6deg); }
        }
        @keyframes lhSquash {
          0%, 55%, 100% { transform: scaleX(1); opacity: 1; }
          25%           { transform: scaleX(0.55); opacity: 0.55; }
          40%           { transform: scaleX(0.85); opacity: 0.8; }
        }
        @media (prefers-reduced-motion: reduce) {
          #launch-handoff .lh-brain, #launch-handoff .lh-pill, #launch-handoff .lh-pill-shadow { animation: none; }
        }
      `}</style>
      <div id="launch-handoff" aria-hidden="true">
        <span className="lh-field lh-f1" />
        <span className="lh-field lh-f2" />
        <span className="lh-field lh-f3" />
        <div className="lh-scene">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="lh-brain" src="/mascot/reminder.png" alt="" width={96} height={96} />
          <div className="lh-name">Re&#8209;MIND&#8209;e&#1071;</div>
          <div className="lh-choreo">
            <span className="lh-slot"><span className="lh-pill lh-tablet" /><span className="lh-pill-shadow" /></span>
            <span className="lh-slot"><span className="lh-pill lh-capsule" /><span className="lh-pill-shadow" /></span>
            <span className="lh-slot"><span className="lh-pill lh-softgel" /><span className="lh-pill-shadow" /></span>
          </div>
          <p className="lh-hint">Opening your medications…</p>
        </div>
      </div>
    </>
  );
}
