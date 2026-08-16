'use client';

/**
 * The water tumbler — tap to add a cup, swipe to undo.
 *
 * ## Motion, and why there is so little of it
 *
 * CLAUDE.md's governing constraint is CALM: nothing on Today may move for
 * attention, and motion is earned in exactly two places (the all-taken
 * celebration and Remi's idle). So this animates ONLY as feedback to a touch,
 * never on its own. There is no loop, no breathing, no sloshing while you read
 * the screen — the tumbler is completely still until someone touches it.
 *
 * What does animate: the liquid rises. One composited `translateY` on the fill
 * plus one small `translateX` slosh on the wave, ~380ms, on a fluid-material
 * ease with a slight settle rather than a bounce (a cartoon bounce on a
 * medication screen reads as a game). Both are transforms, so this is GPU-only
 * — no layout, no paint, no canvas physics engine for a cup of water.
 *
 * `prefers-reduced-motion` snaps the fill instantly and kills the slosh. This is
 * an elderly app and motion sensitivity is real, so it is a real branch rather
 * than a shortened duration.
 *
 * ## Colour
 *
 * Uses the SCOPED `--hydration-*` accent (globals.css), which exists so a glass
 * of water can never be mistaken for a dose. It must not appear on any
 * medication surface.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';

/** Fluid material: a touch slower than a card, with a settle rather than a bounce. */
const FILL_MS = 380;
const FILL_EASE = 'cubic-bezier(0.34, 1.06, 0.64, 1)';
/** Past this, a horizontal drag is an undo rather than a tap. */
const SWIPE_PX = 44;

export interface WaterTumblerProps {
  cups: number;
  goalCups: number;
  cupMl: number;
  onAdd: () => void;
  onUndo: () => void;
  isElderly?: boolean;
}

export default function WaterTumbler({
  cups,
  goalCups,
  cupMl,
  onAdd,
  onUndo,
  isElderly = false,
}: WaterTumblerProps) {
  const [reduced, setReduced] = useState(false);
  /** Flips on every change so the wave sloshes once, then stays still. */
  const [slosh, setSlosh] = useState(false);
  const previous = useRef(cups);
  const drag = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReduced(query.matches);
    apply();
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    if (cups !== previous.current) {
      previous.current = cups;
      setSlosh((s) => !s);
    }
  }, [cups]);

  const filled = goalCups > 0 ? Math.min(1, cups / goalCups) : 0;
  const met = cups >= goalCups;

  // Pointer, not touch: covers mouse, pen and finger with one path, and the
  // browser hands us a clean tap when the drag never exceeds the threshold.
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY };
  }, []);

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const start = drag.current;
      drag.current = null;
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      // Horizontal intent only — a vertical drag is the page scrolling.
      if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) {
        onUndo();
        return;
      }
      onAdd();
    },
    [onAdd, onUndo],
  );

  const width = isElderly ? 132 : 104;
  const height = isElderly ? 176 : 140;

  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (drag.current = null)}
        // Keyboard gets both actions without the gesture: the swipe is an
        // accelerator, never the only way to undo.
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'Backspace') {
            e.preventDefault();
            onUndo();
          }
        }}
        aria-label={`Add a cup of water. ${cups} of ${goalCups} cups today. Press the left arrow key to remove one.`}
        className="relative shrink-0 rounded-[28px] overflow-hidden border-2 transition-transform active:scale-[0.97] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background touch-pan-y"
        style={{
          width,
          height,
          borderColor: 'var(--hydration)',
          background: 'var(--hydration-soft)',
        }}
      >
        {/* THE LIQUID. One transform, translated from below — the whole column
            lives outside the frame at 0 cups and rises into it. */}
        <span
          aria-hidden
          className="absolute inset-x-0 bottom-0"
          style={{
            height: '100%',
            transform: `translateY(${(1 - filled) * 100}%)`,
            transition: reduced ? 'none' : `transform ${FILL_MS}ms ${FILL_EASE}`,
            willChange: 'transform',
          }}
        >
          {/* The surface. Sloshes once per change, then is still. */}
          <span
            className="absolute inset-x-0 top-0 block"
            style={{
              height: 14,
              transform: `translateX(${reduced ? 0 : slosh ? 6 : -6}px)`,
              transition: reduced ? 'none' : `transform ${FILL_MS}ms ${FILL_EASE}`,
            }}
          >
            <svg viewBox="0 0 140 14" preserveAspectRatio="none" className="w-[calc(100%+16px)] h-full -ml-2">
              <path
                d="M0 7 Q 17.5 0 35 7 T 70 7 T 105 7 T 140 7 V14 H0 Z"
                fill="var(--hydration)"
              />
            </svg>
          </span>
          <span
            className="absolute inset-x-0 bottom-0 block"
            style={{ top: 13, background: 'var(--hydration)' }}
          />
        </span>

        {/* GLASS, and every part of it is STATIC. The stillness rule is not
            relaxed for polish: nothing here moves unless a finger asks. A
            specular streak and a rim highlight are how a glass reads as glass in
            a still frame, which is the only frame this widget ever has.

            pointer-events-none on both, so the glass never eats the tap. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-[14%] w-[10%] rounded-full"
          style={{
            background: 'linear-gradient(to bottom, var(--glass-sheen), rgba(255,255,255,0.10) 45%, rgba(255,255,255,0) 75%)',
          }}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[26px]"
          style={{
            // An inner rim rather than an outer shadow: the tumbler is a hollow
            // object, so the light belongs on the inside of its wall.
            boxShadow: 'inset 0 1px 2px var(--glass-rim), inset 0 -8px 14px var(--glass-floor)',
          }}
        />

        {/* The count, over the liquid. Kept inside the tumbler so the number and
            the level are one object rather than a figure with a caption. */}
        <span
          className="absolute inset-0 flex items-center justify-center font-black tabular-nums"
          style={{
            // Over the fill it needs white; above the fill it needs ink. The
            // switch happens at half full, where the number sits.
            color: filled > 0.5 ? 'var(--hydration-foreground)' : 'var(--hydration-ink)',
            fontSize: isElderly ? 34 : 26,
            transition: reduced ? 'none' : `color ${FILL_MS}ms ${FILL_EASE}`,
          }}
        >
          {cups}
        </span>
      </button>

      <div className="min-w-0">
        {/* Reports, never scores. No streaks, no "only", no exclamation — a
            missed water day says nothing about anybody. */}
        <p className={`font-black text-foreground tabular-nums ${isElderly ? 'text-2xl' : 'text-lg'}`}>
          {cups} of {goalCups} cups
        </p>
        <p className={`font-semibold text-muted-foreground ${isElderly ? 'text-base' : 'text-sm'}`}>
          {met ? `That's your goal for today.` : `${cupMl} ml each · tap the glass to add one`}
        </p>
        <p className={`font-semibold text-muted-foreground/80 mt-0.5 ${isElderly ? 'text-sm' : 'text-xs'}`}>
          Swipe the glass to undo.
        </p>
      </div>

      {/* The count is what a screen reader needs to hear after a tap — the
          tumbler itself is decorative once the number is announced. */}
      <span className="sr-only" role="status" aria-live="polite">
        {cups} of {goalCups} cups today
      </span>
    </div>
  );
}
