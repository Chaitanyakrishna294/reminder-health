'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

export interface FolderItem {
  id: string;
  name: string;
  /** Line above the title: file count, or the "add your first…" prompt at zero. */
  caption: string;
  icon: React.ReactNode;
  /** How many files are inside. Drives the paper edges peeking out of the folder. */
  count: number;
  /** Placeholder categories that aren't real rows yet — shown, not openable. */
  disabled?: boolean;
}

interface FolderCarouselProps {
  items: FolderItem[];
  isElderly: boolean;
  onSelect: (id: string) => void;
}

/**
 * Folder rail with the centred card enlarged and continuous (wrapping) scroll.
 *
 * Looping is done by rendering the set three times and silently jumping the scroll
 * position back to the middle copy whenever it drifts into an outer one. The jump
 * happens at a snap boundary with instant scrolling, so it is invisible.
 *
 * The clones are real DOM nodes, which is an accessibility trap: without care a screen
 * reader announces every folder three times and Tab walks through 12 cards instead of 4.
 * Only the middle copy is exposed — the outer copies are aria-hidden and taken out of
 * the tab order. They stay clickable, since tapping a visible card must do something.
 *
 * Below three items there is nothing to loop, so it degrades to a plain centred row.
 */
export default function FolderCarousel({ items, isElderly, onSelect }: FolderCarouselProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const didInit = useRef(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loop = items.length >= 3;
  const copies = loop ? 3 : 1;
  const rendered = loop ? [...items, ...items, ...items] : items;

  const cardW = isElderly ? 230 : 172;
  const cardH = isElderly ? 172 : 136;

  // Start on the middle copy so there is material to scroll to in both directions.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !loop || didInit.current) return;
    const setWidth = el.scrollWidth / copies;
    if (setWidth > 0) {
      el.scrollLeft = setWidth;
      didInit.current = true;
    }
  }, [loop, copies, items.length]);

  // Rewind to the middle copy ONLY once scrolling has stopped. Repositioning mid-fling
  // fights the browser's momentum animation and the snap engine at the same time, which
  // is what made dragging the rail feel jittery. `scrollend` is the precise signal;
  // where it is missing, an idle timer stands in for it.
  const rewind = useCallback(() => {
    const el = scrollerRef.current;
    if (!el || !loop) return;
    const setWidth = el.scrollWidth / copies;
    if (setWidth <= 0) return;
    if (el.scrollLeft < setWidth * 0.5) el.scrollLeft += setWidth;
    else if (el.scrollLeft > setWidth * 1.5) el.scrollLeft -= setWidth;
  }, [loop, copies]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !loop) return;
    const supportsScrollEnd = 'onscrollend' in window;
    if (supportsScrollEnd) {
      el.addEventListener('scrollend', rewind);
      return () => el.removeEventListener('scrollend', rewind);
    }
    const onScroll = () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(rewind, 140);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, [loop, rewind]);

  // Whichever card overlaps the centre band is the active one. A thin rootMargin band
  // means no scroll maths and no per-frame work — the observer fires only on change.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      entries => {
        const hit = entries.find(e => e.isIntersecting);
        if (hit) setActiveKey((hit.target as HTMLElement).dataset.key || null);
      },
      { root: el, rootMargin: '0px -48% 0px -48%', threshold: 0 }
    );
    el.querySelectorAll('[data-key]').forEach(node => observer.observe(node));
    return () => observer.disconnect();
  }, [rendered.length]);

  return (
    <div
      ref={scrollerRef}
      className={`-mx-4 flex gap-3 overflow-x-auto overscroll-x-contain pb-2 pt-4 snap-x snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
        loop ? '' : 'justify-center'
      }`}
      style={{
        paddingInline: `calc(50% - ${cardW / 2}px)`,
        // The neighbouring cards peek by ~80px each side and were cut dead straight by the
        // viewport edge, mid-label — which reads as a clipping bug rather than as "there is
        // more this way". A mask dissolves them instead. Composited, so it costs nothing
        // while the rail moves, and it degrades to no mask where unsupported.
        ...(loop
          ? {
              WebkitMaskImage:
                'linear-gradient(to right, transparent 0, #000 14%, #000 86%, transparent 100%)',
              maskImage:
                'linear-gradient(to right, transparent 0, #000 14%, #000 86%, transparent 100%)',
            }
          : null),
      }}
    >
      {rendered.map((item, i) => {
        const copyIndex = Math.floor(i / items.length);
        const isRealCopy = !loop || copyIndex === 1;
        const key = `${item.id}-${i}`;
        const isActive = activeKey === key;
        return (
          <button
            key={key}
            data-key={key}
            type="button"
            aria-hidden={!isRealCopy}
            tabIndex={isRealCopy ? 0 : -1}
            disabled={item.disabled}
            onClick={() => !item.disabled && onSelect(item.id)}
            style={{
              ['--folder' as string]: `var(--category-${(items.indexOf(item) % 4) + 1})`,
              width: cardW,
              height: cardH,
            }}
            /* Only transform and opacity are transitioned — both are GPU-composited, so
               the scale change costs no layout or paint. box-shadow was in here too and
               repaints the card on every frame of the transition. */
            className={`folder-card snap-center shrink-0 relative text-left transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none disabled:cursor-not-allowed enabled:cursor-pointer ${
              // 0.7 opacity dropped the side cards' text to 4.14:1. Scale alone carries
              // the "this one is centred" hierarchy, so the fade only needs to be slight.
              isActive ? 'scale-100 opacity-100' : 'scale-[0.88] opacity-[0.88]'
            }`}
          >
            {/* An actual folder, not a rounded rectangle: a TAB, sheets of paper, then the
                front panel over them. The old card was a flat colour block whose only
                folder gesture was one un-rounded corner, so it read as a swatch.
                Three layers, back to front. */}

            {/* 1. Tab — the shape that says "folder" before anything is read. Slightly
                   darker than the body so the fold catches light. */}
            <span
              aria-hidden
              className="absolute left-0 top-0 h-[22px] w-[46%] rounded-t-[10px]"
              style={{ background: 'color-mix(in srgb, var(--folder) 78%, black)' }}
            />

            {/* 2. The paper inside. Peeks above the front panel, and there is simply less
                   of it when the folder holds less — an empty folder shows no paper at
                   all, so "nothing in here yet" is legible from the shape alone.

                   SOLID white with an edge, not `bg-white/55`: the part that shows sits
                   above the panel, so its backdrop is the PAGE, and translucent white on
                   the near-white light theme was invisible. Paper is paper in both
                   themes, so the fill is committed rather than tokenised — the hairline
                   and the lift above it are what separate it from a light background. */}
            {item.count > 0 && (
              <span aria-hidden>
                <span
                  className="absolute left-4 right-6 top-[13px] h-4 rounded-t-[5px] border border-b-0"
                  style={{ background: '#fff', borderColor: 'rgba(15, 28, 90, 0.18)' }}
                />
                {item.count > 1 && (
                  <span
                    className="absolute left-6 right-4 top-[9px] h-4 rounded-t-[5px] border border-b-0"
                    style={{
                      background: '#fff',
                      borderColor: 'rgba(15, 28, 90, 0.18)',
                      boxShadow: '0 -1px 2px rgba(15, 28, 90, 0.10)',
                    }}
                  />
                )}
              </span>
            )}

            {/* 3. Front panel, carrying the label. */}
            <span
              className="absolute inset-x-0 bottom-0 top-[18px] overflow-hidden rounded-[18px] rounded-tl-[4px] shadow-md"
              style={{ background: 'var(--folder)' }}
            >
              {/* The glyph was 80px at white/20, pushed off the top-right corner so it
                  rendered as a large cropped smudge across the panel — and now that the
                  card has a tab and paper edges, it was competing with the shape that
                  actually says "folder". Small, fully inside the panel, and bright enough
                  to be read as an icon: it labels the folder instead of texturing it. */}
              <span
                aria-hidden
                className="absolute right-2.5 top-2.5 flex items-center justify-center rounded-lg bg-black/20 text-white/90 w-7 h-7 [&_svg]:w-4 [&_svg]:h-4"
              >
                {item.icon}
              </span>

              {/* A gradient scrim instead of the old hard black band. It still guarantees
                  contrast on any of the four cover hues — the worst of them, category-4,
                  measures ~11:1 for white text at this opacity — but it fades into the
                  colour instead of cutting it with a straight edge.
                  Deliberately NOT backdrop-blur: twelve of these live in a horizontal
                  scroller and backdrop-filter re-resolves every frame while it moves,
                  for a blur you could not see over a flat fill. */}
              <span className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black/70 via-black/40 to-transparent" />

              <span className="absolute inset-x-0 bottom-0 px-3 py-2.5">
                <span className={`block font-bold text-white/85 ${isElderly ? 'text-xs' : 'text-[11px]'}`}>
                  {item.caption}
                </span>
                <span className={`block font-black text-white tracking-tight truncate mt-0.5 ${isElderly ? 'text-lg' : 'text-sm'}`}>
                  {item.name}
                </span>
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
