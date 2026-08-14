'use client';

/**
 * A document preview you can actually read.
 *
 * WHY THE BROWSER'S OWN PINCH IS NOT ENOUGH. The preview is a fixed-position
 * modal. Native page zoom scales the whole viewport, so pinching inside a
 * fixed overlay magnifies the chrome along with the document and then scrolls
 * the page behind it — you end up zoomed into a corner of the dialog rather
 * than into the prescription. This zooms the IMAGE, inside its own frame.
 *
 * That matters more here than in a photo gallery: the thing being examined is
 * usually a dose written by hand on a paper slip, and "can I read this at all"
 * is the entire reason the file was stored.
 *
 * Three ways in, because one is never enough for this audience:
 *   - pinch, for whoever already knows the gesture;
 *   - double-tap, for whoever expects photos to work like photos;
 *   - visible +/− buttons, which are the only ones that work with a tremor, on
 *     a desktop, or from a keyboard.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Minus, Plus, Maximize2 } from 'lucide-react';
import { useUiMode } from '@/context/ui-mode-context';

const MIN = 1;
const MAX = 5;
const DOUBLE_TAP_SCALE = 2.5;
const DOUBLE_TAP_MS = 300;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export default function ZoomableImage({ src, alt }: { src: string; alt: string }) {
  const { isElderly } = useUiMode();
  const frameRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [animating, setAnimating] = useState(false);

  // Live pointers, by id. Two means pinch, one means pan.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ dist: number; scale: number } | null>(null);
  const panStart = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const lastTap = useRef(0);

  // A new document starts fresh — inheriting the previous file's zoom would open
  // the next prescription mid-magnification with no clue why.
  useEffect(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, [src]);

  /**
   * Keep the image overlapping its frame. Without this, a pan can fling the
   * document entirely off-screen and leave an empty grey box that looks broken.
   */
  const clampOffset = useCallback((x: number, y: number, s: number) => {
    const el = frameRef.current;
    if (!el) return { x, y };
    const maxX = (el.clientWidth * (s - 1)) / 2;
    const maxY = (el.clientHeight * (s - 1)) / 2;
    return { x: clamp(x, -maxX, maxX), y: clamp(y, -maxY, maxY) };
  }, []);

  const zoomTo = useCallback((next: number) => {
    const s = clamp(next, MIN, MAX);
    setAnimating(true);
    setScale(s);
    setOffset((o) => (s === MIN ? { x: 0, y: 0 } : clampOffset(o.x, o.y, s)));
    window.setTimeout(() => setAnimating(false), 200);
  }, [clampOffset]);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchStart.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale };
      panStart.current = null;
      return;
    }

    // Double tap. Toggles rather than steps: the way back out has to be as easy
    // as the way in, or someone is stranded at 2.5x with no obvious escape.
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      zoomTo(scale > MIN ? MIN : DOUBLE_TAP_SCALE);
      lastTap.current = 0;
      return;
    }
    lastTap.current = now;

    if (scale > MIN) {
      panStart.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2 && pinchStart.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const next = clamp((dist / pinchStart.current.dist) * pinchStart.current.scale, MIN, MAX);
      setScale(next);
      setOffset((o) => clampOffset(o.x, o.y, next));
      return;
    }

    if (panStart.current) {
      const p = panStart.current;
      setOffset(clampOffset(p.ox + (e.clientX - p.x), p.oy + (e.clientY - p.y), scale));
    }
  };

  const endPointer = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
    if (pointers.current.size === 0) panStart.current = null;
  };

  const zoomed = scale > MIN;
  const btn = `flex items-center justify-center rounded-full bg-card/90 backdrop-blur border border-border text-foreground shadow-sm transition-colors hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
    isElderly ? 'w-14 h-14' : 'w-11 h-11'
  }`;
  const icon = isElderly ? 'w-7 h-7' : 'w-5 h-5';

  return (
    <div className="relative w-full h-full">
      <div
        ref={frameRef}
        // touch-none stops the webview treating a pinch as page zoom and a drag
        // as a scroll, which would fight every gesture below.
        className="w-full h-full overflow-hidden flex items-center justify-center touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onPointerLeave={endPointer}
        style={{ cursor: zoomed ? 'grab' : 'zoom-in' }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          draggable={false}
          className="max-w-full max-h-full object-contain select-none"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            transition: animating ? 'transform 200ms ease-out' : 'none',
            willChange: 'transform',
          }}
        />
      </div>

      {/* Buttons, not just gestures. A gesture nobody discovers is a feature
          nobody has — and these are the only controls that work from a keyboard. */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2">
        <button type="button" onClick={() => zoomTo(scale - 0.5)} disabled={scale <= MIN} className={btn} aria-label="Zoom out">
          <Minus className={icon} aria-hidden />
        </button>
        <button type="button" onClick={() => zoomTo(MIN)} disabled={!zoomed} className={btn} aria-label="Fit to screen">
          <Maximize2 className={icon} aria-hidden />
        </button>
        <button type="button" onClick={() => zoomTo(scale + 0.5)} disabled={scale >= MAX} className={btn} aria-label="Zoom in">
          <Plus className={icon} aria-hidden />
        </button>
      </div>

      {zoomed && (
        <span
          className="absolute top-3 right-3 rounded-full bg-foreground/75 px-2.5 py-1 font-mono text-[11px] font-bold text-background tabular-nums"
          aria-live="polite"
        >
          {scale.toFixed(1)}×
        </span>
      )}
    </div>
  );
}
