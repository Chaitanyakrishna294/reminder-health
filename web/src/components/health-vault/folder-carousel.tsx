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
            {/* A CARD ON THE BOARD, not a paper folder (looks-maxx stage 2).
                The skeuomorphic version — tab, stacked sheets, a front panel under
                a black scrim — was a good drawing of a folder and the one object
                in the app that belonged to a different world. Everything else is
                now a card floating on the tray, so this is too.

                WHAT SURVIVES, because it was carrying information rather than
                decoration:
                  - the token-derived cover colour, which is the folder's identity
                    (--category-N, never status — see globals.css);
                  - the count, which the stacked paper used to imply by thickness.
                    It is now a WORD AND A NUMBER rather than a shape, which is
                    also the a11y rule: never encode meaning in form alone.

                WHAT GOES, and why it is a gain: the black gradient scrim existed
                to force white text to clear contrast over four arbitrary hues. The
                label now sits in ink on the card, which clears it by construction
                and puts the folder name in the same type system as every other
                name in the app. */}

            {/* The cover. A SURFACE, in the slot-tint tradition — colour that
                identifies, never colour that invites a tap. The whole card is the
                target; this band is not a button of its own. */}
            <span
              aria-hidden
              className="absolute inset-x-0 top-0 h-[44%]"
              style={{ background: 'var(--folder)' }}
            >
              <span className="absolute right-2.5 top-2.5 flex items-center justify-center rounded-[10px] bg-black/25 text-white w-7 h-7 [&_svg]:w-4 [&_svg]:h-4">
                {item.icon}
              </span>
            </span>

            <span className="absolute inset-x-0 bottom-0 top-[44%] px-3 py-2.5 flex flex-col justify-center min-w-0">
              {/* Mono, uppercase, small: a structural label, which is exactly what
                  mono is for and the one thing it is still allowed to be. */}
              <span className={`block font-mono uppercase tracking-[0.06em] text-muted-foreground ${isElderly ? 'text-[11px]' : 'text-[10px]'}`}>
                {item.caption}
              </span>
              {/* The folder's NAME is user content — truncated, never restyled into
                  something clever. */}
              <span className={`block font-bold text-foreground tracking-tight truncate mt-0.5 ${isElderly ? 'text-lg' : 'text-sm'}`}>
                {item.name}
              </span>
              {/* What the stacked paper used to say, said. */}
              <span className={`block font-mono tabular-nums text-muted-foreground mt-0.5 ${isElderly ? 'text-xs' : 'text-[10px]'}`}>
                {item.count === 0 ? 'Empty' : item.count}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
