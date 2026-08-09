/**
 * The app's one loading animation: the splash's clock⇄pill motif, looping.
 *
 * The launch screen tells a story — a clock face becomes the Medications pill —
 * and this is that same idea held in a loop, so every wait in the app looks like
 * the same thought rather than a generic spinner. One 2200ms cycle: the minute
 * hand sweeps a full turn · the circle stretches and tilts into the pill while
 * the hour hand retires and the minute hand parks as the score line · it holds ·
 * it returns to a clock. The hand ends on 360deg, which is visually identical to
 * the 0deg it restarts from, so the loop has no seam.
 *
 * OUTLINE, not the splash's filled mark, on purpose — the real Medications nav
 * icon is an outlined lucide `Pill`, so line art keeps the loader in the same
 * icon language as the app, and it inherits `currentColor` instead of needing a
 * fill colour matched to whatever surface it lands on.
 *
 * THE CSS IS INLINE, NOT IN globals.css — do not "tidy" it into the stylesheet.
 * It was there first and Tailwind/Lightning dropped the whole block from the
 * compiled output with no error (verified: the rules were absent from the served
 * CSS chunk while the neighbouring rules survived). An inline <style> renders
 * straight into the DOM and bypasses that pipeline, which is the same reason
 * components/launch-handoff.tsx carries its scene CSS this way. Duplicate tags
 * when several loaders mount at once are harmless.
 *
 * Sizing: meant for page- and section-level waits (32px+). In-button spinners
 * stay as a small `Loader2` — a two-handed clock at 14px is mush, and a morphing
 * mark is the wrong signal for "this one row is saving".
 */
export default function LoadingMark({
  size = 44,
  className = '',
}: {
  size?: number;
  className?: string;
}) {
  return (
    <>
      <style>{`
        .lm-tilt, .lm-body, .lm-score, .lm-hour {
          transform-box: view-box; transform-origin: 60px 60px;
        }
        .lm-tilt  { animation: markTilt  2200ms cubic-bezier(0.4, 0, 0.2, 1) infinite; }
        .lm-body  { animation: markBody  2200ms cubic-bezier(0.4, 0, 0.2, 1) infinite; }
        .lm-hour  { animation: markHour  2200ms cubic-bezier(0.4, 0, 0.2, 1) infinite; }
        .lm-score { animation: markScore 2200ms cubic-bezier(0.4, 0, 0.2, 1) infinite; }
        /* The return runs 68%->100% with NO coincident stop at the end. An earlier
           version held the clock from 86% to 100%; two keyframes carrying the same
           value at the tail made Chrome spike the interpolated rotation to -69deg
           for ~4ms right before the loop restarted (measured). Sub-frame, so barely
           visible — but there is no reason to ship it. */
        @keyframes markBody {
          0%, 32%  { x: 36px; width: 48px; }
          50%, 68% { x: 18px; width: 84px; }
          100%     { x: 36px; width: 48px; }
        }
        @keyframes markScore {
          0%       { transform: rotate(0deg);   y: 40px; height: 20px;
                     animation-timing-function: cubic-bezier(0.05, 0.7, 0.1, 1); }
          32%      { transform: rotate(360deg); y: 40px; height: 20px; }
          50%, 68% { transform: rotate(360deg); y: 36px; height: 48px; }
          /* ends on 360deg, visually identical to the 0deg it restarts from */
          100%     { transform: rotate(360deg); y: 40px; height: 20px; }
        }
        @keyframes markHour {
          0%, 32%  { transform: rotate(-28deg); opacity: 1; }
          44%, 74% { transform: rotate(-28deg); opacity: 0; }
          100%     { transform: rotate(-28deg); opacity: 1; }
        }
        @keyframes markTilt {
          0%, 32%  { transform: rotate(0deg); }
          50%, 68% { transform: rotate(-45deg); }
          100%     { transform: rotate(0deg); }
        }
        /* Reduced motion: hold the resolved pill — still a mark, just not moving. */
        @media (prefers-reduced-motion: reduce) {
          .lm-tilt, .lm-body, .lm-score, .lm-hour { animation: none; }
          .lm-tilt  { transform: rotate(-45deg); }
          .lm-body  { x: 18px; width: 84px; }
          .lm-score { y: 36px; height: 48px; }
          .lm-hour  { opacity: 0; }
        }
      `}</style>
      <svg
        viewBox="0 0 120 120"
        width={size}
        height={size}
        className={className}
        aria-hidden="true"
        focusable="false"
      >
        <g className="lm-tilt">
          <rect
            className="lm-body"
            x={36}
            y={36}
            width={48}
            height={48}
            rx={24}
            fill="none"
            stroke="currentColor"
            strokeWidth={7}
          />
          <rect className="lm-hour" x={57} y={46} width={6} height={14} rx={3} fill="currentColor" />
          <rect className="lm-score" x={56} y={40} width={8} height={20} rx={4} fill="currentColor" />
        </g>
      </svg>
    </>
  );
}
