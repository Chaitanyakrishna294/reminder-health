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
            className={`card-lift press-sink overflow-hidden snap-center shrink-0 relative text-left transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none disabled:cursor-not-allowed enabled:cursor-pointer ${
              // 0.7 opacity dropped the side cards' text to 4.14:1. Scale alone carries
              // the "this one is centred" hierarchy, so the fade only needs to be slight.
              isActive ? 'scale-100 opacity-100' : 'scale-[0.88] opacity-[0.88]'
            }`}
          >
            {/* A FOLDER, WITH THE FILES INSIDE IT.
                Owner override, 2026-08-17: this one surface is unfrozen. The
                minimal band-card was correct about materials and wrong about
                identity — it lost the folder.

                THE SHAPE, and why it is built this way rather than drawn:
                  - the card IS the folder back, in --category-N;
                  - a TAB sits on its top-left edge;
                  - white SHEETS emerge from inside it, offset, so the stack reads
                    as paper;
                  - a FRONT LIP in the same colour overlaps the sheets' bottom.
                That last part is what makes the files read as INSIDE the folder
                rather than stacked behind it. It is the whole trick.

                WHY THE TEXT LIVES ON THE PAPER, and this is not a style choice.
                White on the four category hues MEASURES 5.17 / 4.18 / 5.89 / 4.23
                in light mode — green and orange FAIL 4.5:1. That is exactly why the
                old skeuomorphic version carried a black scrim: the scrim was not
                decoration, it was contrast machinery holding up an unsound
                arrangement. Category-as-text on white fails on the same two hues.
                So the name and count sit in ink on a white sheet, which clears the
                floor by construction — and is also what a real folder looks like:
                the colour is the folder, the writing is on the paper.

                The only white-on-colour element left is the icon, which is
                non-text (3:1 floor) and clears it on all four at 4.18 minimum. */}

            {/* The folder back — the whole card. */}
            <span aria-hidden className="absolute inset-0" style={{ background: 'var(--folder)' }} />

            {/* The TAB. A lightened wash of the folder's own colour rather than a
                second hue, so the folder stays one object in one colour. */}
            <span
              aria-hidden
              className={`absolute left-0 top-0 rounded-br-[10px] bg-white/25 ${isElderly ? 'h-4 w-[46%]' : 'h-3 w-[44%]'}`}
            />

            {/* THE SHEETS. Two decorative edges behind the front sheet imply a
                stack; the count is still stated in WORDS below, because form must
                never be the only carrier (project-a11y). */}
            {item.count > 1 && (
              <span
                aria-hidden
                className="absolute rounded-[14px] bg-[var(--surface)] opacity-60"
                style={{ left: 22, right: 10, top: isElderly ? 26 : 20, bottom: isElderly ? 44 : 36 }}
              />
            )}
            {item.count > 2 && (
              <span
                aria-hidden
                className="absolute rounded-[14px] bg-[var(--surface)] opacity-80"
                style={{ left: 16, right: 14, top: isElderly ? 30 : 23, bottom: isElderly ? 44 : 36 }}
              />
            )}

            {/* The front sheet, carrying the words. */}
            <span
              className={`absolute rounded-[14px] bg-[var(--surface)] flex flex-col justify-center min-w-0 ${isElderly ? 'px-4' : 'px-3'}`}
              style={{ left: 10, right: 10, top: isElderly ? 34 : 26, bottom: isElderly ? 40 : 32 }}
            >
              {/* User content — truncated, never restyled into something clever. */}
              <span className={`block font-bold text-foreground tracking-tight truncate ${isElderly ? 'text-lg' : 'text-[15px]'}`}>
                {item.name}
              </span>
              {/* The caption already reads "3 files" / "Add your first prescription",
                  so the separate numeral the band-card printed under it was the
                  count twice — the exact defect a comment at the call site says was
                  fixed once before. Once, here.

                  12px normal / 14px elderly: the caption floor. It was 10px, which
                  was below it. */}
              <span className={`block font-medium text-muted-foreground truncate mt-0.5 tabular-nums ${isElderly ? 'text-sm' : 'text-xs'}`}>
                {item.caption}
              </span>
            </span>

            {/* The FRONT LIP, overlapping the sheets. This is what puts the files
                inside the folder. Its own top edge is rounded so it reads as the
                folder's front panel rather than a bar across the card. */}
            <span
              aria-hidden
              className={`absolute inset-x-0 bottom-0 rounded-t-[10px] ${isElderly ? 'h-10' : 'h-8'}`}
              style={{ background: 'var(--folder)' }}
            >
              {/* 28px elderly / 20px normal — the project-a11y icon floor. It was
                  16px. Decorative (the name is stated in words), but sized to the
                  same rule so nothing here is the exception. */}
              <span className={`absolute right-2.5 top-1/2 -translate-y-1/2 text-white ${isElderly ? '[&_svg]:w-7 [&_svg]:h-7' : '[&_svg]:w-5 [&_svg]:h-5'}`}>
                {item.icon}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
