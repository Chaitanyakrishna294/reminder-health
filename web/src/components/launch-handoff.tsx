'use client';

import { useEffect } from 'react';

/** Length of the brand assembly. MUST match `--dur` in public/launch.html AND the
 *  clamp in the root layout's pre-paint seek script. */
const DURATION = 1400;

/**
 * The second half of the PWA launch animation.
 *
 * /launch.html (the installed app's start_url, served from the service-worker
 * cache) plays a Gmail/Docs-class brand assembly — a clock face draws itself, its
 * hand sweeps one turn and stays as the pill's score line while the circle
 * stretches into a capsule and tilts into the app's Medications icon — then
 * forwards to /dashboard?launch=1&s=<start>. A pre-paint script in the root layout
 * sets `data-launching` and `--lh-seek` from `s`, so THIS overlay — THE SAME SCENE,
 * SEEKED to wherever the splash had got to — is visible from the dashboard's very
 * first frame with no restart and no gap.
 *
 * It lifts once BOTH the page is interactive and the assembly has finished (a
 * splash that flashes for 200ms is worse than one that completes its beat; on cold
 * opens the load dominates anyway, and warm opens skip the overlay entirely).
 *
 * The lift ends with the finished mark FLYING HOME into the dock's centre
 * Medications slot — the storyboard's last beat — and the icon answering with its
 * existing press squash. Design decisions there, each from an adversarial review
 * that caught the naive version being wrong:
 *
 * - The visible nav link is found by iterating candidates and testing
 *   getClientRects().length — querySelector alone returns the HIDDEN desktop rail
 *   first on mobile (document order), whose 0x0 rect at (0,0) would send the mark
 *   to the top-left corner. offsetParent is useless here: both navs are fixed.
 * - The flier is BUILT FRESH as standalone SVG markup rather than cloned: a clone
 *   parented to document.body would lose the component-scoped styles that give the
 *   mark its resolved geometry, and would inherit the overlay's 350ms fade.
 * - The flight is driven by WAAPI, which supersedes CSS animations in the cascade.
 * - The landing squash is fire-and-forget: pointerdown is dispatched on the icon's
 *   <svg> and bubbles to NavIcon's wrapper handler. If hydration hasn't attached
 *   the handler yet, the event is dropped and the teardown proceeds unchanged.
 * - Plain-fade fallbacks: reduced motion, ELDERLY MODE (this app's own accessibility
 *   mode — its users are the least likely to have OS-level reduced-motion set and
 *   the most likely to be vestibularly sensitive, so the app's setting outranks the
 *   OS default), monitoring mode (no Medications link), document hidden, and the
 *   stall cap (readyState 'loading' means the server is still streaming — the dock
 *   may not have arrived and layout can't be trusted for a measured flight).
 *
 * THE SCENE IS A DELIBERATE DUPLICATE of public/launch.html — that file must stay
 * self-contained to render from cache alone. Change one, change both, including
 * DURATION above.
 */
export default function LaunchHandoff() {
  useEffect(() => {
    const root = document.documentElement;
    if (root.getAttribute('data-launching') !== '1') return;

    let done = false;
    let capTimer: ReturnType<typeof setTimeout> | null = null;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (fn: () => void, ms: number) => { timers.push(setTimeout(fn, ms)); };

    /** How far into the assembly the splash page had already played. */
    const elapsed = () => {
      const m = /[?&]s=(\d+)/.exec(window.location.search);
      if (!m) return DURATION; // no stamp (direct hit) — treat as already finished
      const e = Date.now() - Number(m[1]);
      return e > 0 ? Math.min(e, DURATION) : 0;
    };

    const teardown = () => {
      // The warm-open stamp, written ONLY when a launch reached a rendered page —
      // launch.html reads it to skip the overlay for the next hour. Stamping on
      // the splash side would mark stalled attempts warm and strip the overlay
      // from exactly the launches that need it.
      try { localStorage.setItem('remind-last-launch', String(Date.now())); } catch { /* fine */ }
      root.removeAttribute('data-launching');
      root.style.removeProperty('--lh-seek');
      // Strip the launch params so a reload or share of the URL doesn't replay it.
      const url = new URL(window.location.href);
      url.searchParams.delete('launch');
      url.searchParams.delete('s');
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    };

    const plainFade = () => {
      root.setAttribute('data-launching', 'lifting');
      later(teardown, 350);
    };

    const flight = () => {
      const source = document.querySelector<HTMLElement>('#launch-handoff .lh-mark');
      // The FIRST match can be the hidden desktop rail (document order); take the
      // one that actually has a rendered box.
      const link = [...document.querySelectorAll<HTMLElement>(
        '[data-tour="dash-nav"] a[href="/medications"], aside a[href="/medications"]'
      )].find(el => el.getClientRects().length > 0);
      const iconRect = link?.querySelector('svg')?.getBoundingClientRect();
      if (!source || !link || !iconRect || iconRect.width === 0) { plainFade(); return; }

      const from = source.getBoundingClientRect();
      const dark = root.classList.contains('dark');
      const markFill = dark ? '#F583A0' : '#CC3D64';
      const scoreFill = dark ? '#0F1C5A' : '#FFFFFF';

      // Standalone markup in the mark's RESOLVED state — no scoped CSS needed.
      const flier = document.createElement('div');
      flier.setAttribute('aria-hidden', 'true');
      flier.innerHTML =
        `<svg viewBox="0 0 120 120" width="${from.width}" height="${from.height}">` +
        `<g transform="rotate(-45 60 60)">` +
        `<rect x="18" y="36" width="84" height="48" rx="24" fill="${markFill}"/>` +
        `<rect x="56" y="36" width="8" height="48" rx="4" fill="${scoreFill}"/>` +
        `</g></svg>`;
      Object.assign(flier.style, {
        position: 'fixed',
        left: `${from.left}px`, top: `${from.top}px`,
        width: `${from.width}px`, height: `${from.height}px`,
        margin: '0', zIndex: '201', pointerEvents: 'none',
      });
      document.body.appendChild(flier);
      source.style.visibility = 'hidden';

      // Overlay (mark, wordmark) fades out UNDER the flying mark; the page beneath
      // is already interactive — 'lifting' sets pointer-events: none.
      root.setAttribute('data-launching', 'lifting');
      later(teardown, 350);

      const dx = (iconRect.left + iconRect.width / 2) - (from.left + from.width / 2);
      const dy = (iconRect.top + iconRect.height / 2) - (from.top + from.height / 2);
      // The mark's visible capsule is ~70% of its 120px box; match the 24px icon.
      const scale = Math.min((iconRect.width / from.width) / 0.7, 1);
      const anim = flier.animate(
        [
          { transform: 'translate(0, 0) scale(1)', opacity: 1 },
          { transform: `translate(${dx * 0.75}px, ${dy * 0.75}px) scale(${(1 + scale) / 2})`, opacity: 1, offset: 0.75 },
          { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: 0 },
        ],
        { duration: 520, easing: 'cubic-bezier(0.32, 0.72, 0, 1)', fill: 'forwards' }
      );

      const land = () => {
        if (!flier.isConnected) return;
        flier.remove();
        // Restore the hidden source: a real launch never re-shows the overlay, but
        // anything that re-flags data-launching must find the scene whole.
        source.style.visibility = '';
        // "The dock catches the pill": bubbles to NavIcon's onPointerDown. A
        // pointerdown alone can't navigate, so this is side-effect-free.
        link.querySelector('svg')?.dispatchEvent(
          new PointerEvent('pointerdown', { bubbles: true })
        );
        // Debug/verification hook: what flew, from where, to where.
        (window as unknown as Record<string, unknown>).__launchHandoffLast = {
          flew: true, dx: Math.round(dx), dy: Math.round(dy),
          target: { x: Math.round(iconRect.left), y: Math.round(iconRect.top) },
        };
      };
      anim.finished.then(land).catch(() => flier.remove());
      later(() => { anim.cancel(); land(); }, 820); // safety: never leave a stray flier
    };

    const lift = () => {
      if (done) return;           // the cap and DOMContentLoaded both route here — run once
      done = true;
      if (capTimer) clearTimeout(capTimer);
      // Let the assembly finish before anything moves: flying a half-drawn mark
      // reads as a glitch, and on cold opens the load overlaps this anyway.
      later(() => {
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        let elderly = false;
        try { elderly = localStorage.getItem('ui-mode') === 'elderly'; } catch { /* fade */ }
        // If the 8s CSS failsafe already retired the overlay (hydration arrived
        // very late), the user is looking at — possibly using — the page. No fade,
        // no flight: a mark materialising over an in-use dashboard is a ghost.
        const overlay = document.getElementById('launch-handoff');
        if (overlay && getComputedStyle(overlay).visibility === 'hidden') {
          teardown();
        } else if (reduced || elderly || document.hidden || document.readyState === 'loading') {
          plainFade();
        } else {
          flight();
        }
      }, Math.max(0, DURATION - elapsed()) + 120);
    };

    // Hydration is the readiness signal: this effect running means React has made
    // the page interactive, and the flight only needs the dock's geometry — not
    // images or fonts. 'loading' means the server is still streaming HTML (the
    // dock may not have arrived yet), so wait for the parser to finish.
    if (document.readyState !== 'loading') {
      lift();
    } else {
      document.addEventListener('DOMContentLoaded', lift, { once: true });
    }
    // Hard cap: if the stream stalls, fade out over whatever has arrived (the
    // route's loading skeleton at worst) — never trap someone on a splash.
    capTimer = setTimeout(lift, 2500);

    return () => {
      document.removeEventListener('DOMContentLoaded', lift);
      if (capTimer) clearTimeout(capTimer);
      timers.forEach(clearTimeout);
    };
  }, []);

  return (
    <>
      <style>{`
        #launch-handoff { display: none; }
        html[data-launching] #launch-handoff {
          --ink: #0F1C5A; --lh-bg: #F6F2F5; --mark: #CC3D64; --score: #FFFFFF;
          display: flex; position: fixed; inset: 0; z-index: 200;
          flex-direction: column; align-items: center; justify-content: center;
          gap: 20px; padding: 24px; text-align: center; overflow: hidden;
          background: var(--lh-bg); color: var(--ink);
          font-family: ui-monospace, 'JetBrains Mono', Consolas, monospace;
          opacity: 1; transition: opacity 350ms ease;
        }
        html.dark[data-launching] #launch-handoff {
          --ink: #EAF0FF; --lh-bg: #0F1C5A; --mark: #F583A0; --score: #0F1C5A;
        }
        html[data-launching='lifting'] #launch-handoff { opacity: 0; pointer-events: none; }
        /* No-JS escape hatch. If hydration never completes (stalled bundle download,
           script error), nothing in the effect above can run and data-launching would
           stay set forever — so CSS itself retires the overlay after 8s. Keyed to '1'
           only: the moment the real lift starts ('lifting') the selector stops
           matching, the animation resets, and the normal 350ms transition takes over.
           visibility:hidden also drops the overlay's hit-testing, so the page under
           it becomes usable even though the attribute is still set. */
        html[data-launching='1'] #launch-handoff { animation: lhFailsafe 350ms ease 8s forwards; }
        @keyframes lhFailsafe { to { opacity: 0; visibility: hidden; } }

        /* --- The scene. Duplicate of public/launch.html; change one, change both. ---
           --lh-seek is a NEGATIVE delay set pre-paint by the root layout, which
           fast-forwards every animation to wherever the splash page had got to. */
        #launch-handoff .lh-mark { width: 120px; height: 120px; }
        #launch-handoff .lh-tilt,
        #launch-handoff .lh-body,
        #launch-handoff .lh-hour,
        #launch-handoff .lh-score { transform-box: view-box; transform-origin: 60px 60px; }
        #launch-handoff .lh-tilt  { animation: lhTilt 1400ms both var(--lh-seek, 0ms); }
        #launch-handoff .lh-body  { fill: var(--mark); fill-opacity: 0; stroke: var(--ink);
                                    stroke-width: 6; stroke-dasharray: 1; stroke-dashoffset: 1;
                                    animation: lhBody 1400ms both var(--lh-seek, 0ms); }
        /* The hour hand exists purely for legibility: a circle with ONE sweeping
           line reads as a loading spinner, two hands read as a clock. It retires
           during the morph, leaving the minute hand to become the score line. */
        #launch-handoff .lh-hour  { fill: var(--ink); animation: lhHour 1400ms both var(--lh-seek, 0ms); }
        #launch-handoff .lh-score { fill: var(--ink); animation: lhScore 1400ms both var(--lh-seek, 0ms); }
        #launch-handoff .lh-name  { font-size: 22px; font-weight: 800; letter-spacing: -0.02em;
                                    opacity: 0; animation: lhName 1400ms both var(--lh-seek, 0ms); }
        @keyframes lhBody {
          0%   { stroke-dashoffset: 1; x: 36px; width: 48px; fill-opacity: 0; stroke-opacity: 1;
                 animation-timing-function: cubic-bezier(0.05, 0.7, 0.1, 1); }
          36%  { stroke-dashoffset: 0; x: 36px; width: 48px; fill-opacity: 0; stroke-opacity: 1;
                 animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1); }
          /* dashoffset repeated to the end on purpose: CSS synthesises the missing
             100% frame from the base value (1), which would visibly ERASE the
             outline again while it fades out. */
          62%  { stroke-dashoffset: 0; x: 21.9px; width: 76.1px; fill-opacity: 1; stroke-opacity: 0; }
          73%  { stroke-dashoffset: 0; x: 16px;   width: 88px;   fill-opacity: 1; stroke-opacity: 0;
                 animation-timing-function: cubic-bezier(0.34, 1.2, 0.64, 1); }
          86%  { stroke-dashoffset: 0; x: 18px;   width: 84px;   fill-opacity: 1; stroke-opacity: 0; }
          100% { stroke-dashoffset: 0; x: 18px;   width: 84px;   fill-opacity: 1; stroke-opacity: 0; }
        }
        @keyframes lhScore {
          0%   { transform: rotate(0deg);   y: 40px;   height: 20px;   fill: var(--ink);
                 animation-timing-function: cubic-bezier(0.05, 0.7, 0.1, 1); }
          36%  { transform: rotate(360deg); y: 40px;   height: 20px;   fill: var(--ink);
                 animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1); }
          62%  { transform: rotate(360deg); y: 37.2px; height: 39.7px; fill: var(--score); }
          73%  { transform: rotate(360deg); y: 36px;   height: 48px;   fill: var(--score); }
          100% { transform: rotate(360deg); y: 36px;   height: 48px;   fill: var(--score); }
        }
        @keyframes lhHour {
          0%   { transform: rotate(-60deg); opacity: 1;
                 animation-timing-function: cubic-bezier(0.05, 0.7, 0.1, 1); }
          36%  { transform: rotate(-28deg); opacity: 1; }
          52%  { transform: rotate(-28deg); opacity: 0; }
          100% { transform: rotate(-28deg); opacity: 0; }
        }
        @keyframes lhTilt {
          0%   { transform: rotate(0deg); }
          48%  { transform: rotate(0deg); animation-timing-function: cubic-bezier(0.34, 1.4, 0.64, 1); }
          100% { transform: rotate(-45deg); }
        }
        @keyframes lhName {
          0%   { opacity: 0; transform: translateY(6px); letter-spacing: 0.35em; }
          73%  { opacity: 0; transform: translateY(6px); letter-spacing: 0.35em;
                 animation-timing-function: cubic-bezier(0.05, 0.7, 0.1, 1); }
          100% { opacity: 1; transform: translateY(0);   letter-spacing: -0.02em; }
        }
        @media (prefers-reduced-motion: reduce) {
          #launch-handoff .lh-tilt, #launch-handoff .lh-body, #launch-handoff .lh-hour,
          #launch-handoff .lh-score, #launch-handoff .lh-name { animation: none; }
          #launch-handoff .lh-tilt  { transform: rotate(-45deg); }
          #launch-handoff .lh-body  { x: 18px; width: 84px; fill-opacity: 1; stroke-opacity: 0; stroke-dashoffset: 0; }
          #launch-handoff .lh-score { y: 36px; height: 48px; fill: var(--score); }
          #launch-handoff .lh-hour  { opacity: 0; }
          #launch-handoff .lh-name  { opacity: 1; letter-spacing: -0.02em; }
        }
      `}</style>
      <div id="launch-handoff" aria-hidden="true">
        <svg className="lh-mark" viewBox="0 0 120 120" aria-hidden="true">
          <g className="lh-tilt">
            <rect className="lh-body" x={36} y={36} width={48} height={48} rx={24} pathLength={1} />
            <rect className="lh-hour" x={57} y={46} width={6} height={14} rx={3} />
            <rect className="lh-score" x={56} y={40} width={8} height={20} rx={4} />
          </g>
        </svg>
        <div className="lh-name">Re&#8209;MIND&#8209;e&#1071;</div>
      </div>
    </>
  );
}
