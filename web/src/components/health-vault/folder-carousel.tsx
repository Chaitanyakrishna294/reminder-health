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
      /* pb-3: the caption lives on the label inside the folder again, so the rail
         no longer needs room under each card for a board-level caption. */
      className={`-mx-4 flex gap-3 overflow-x-auto overscroll-x-contain pb-3 pt-4 snap-x snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
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
               repaints the card on every frame of the transition.

               NO `card-lift` and NO `press-sink` on the button any more. The folder
               is no longer a filled rectangle, so a card background here would paint
               a white block behind the folder's stepped top edge and destroy the
               silhouette. The BODY carries the surface and the lift instead, and the
               press is `group-active` on it — press-sink resolves TO lift-1, which on
               an element with no resting elevation would make it lift under the
               finger rather than sink (CLAUDE.md). */
            className={`group snap-center shrink-0 relative text-left transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none disabled:cursor-not-allowed enabled:cursor-pointer rounded-[var(--r-card)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
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

            {/* ONE SHEET, TWO SHADES, AND A REAL FRONT PANEL.
                v2 after the owner's "not nice". The previous attempt had TWO
                separate white shapes — a rounded block floating in the middle plus
                a strip across the bottom — and neither read as paper or as a label.
                It looked like a coloured card with white boxes in it.

                A folder is three planes at different depths, so it is built as
                three: a DARKER BACK, ONE SHEET of paper tucked into it, and a
                FRONT PANEL in the base colour overlapping the sheet's bottom edge.
                Both folder planes are the same --category-N hue at different
                brightness, so the depth comes from light rather than from a second
                colour. Nothing here invents a token.

                Text stays on the paper for the same measured reason as before:
                white on the four hues is 5.17 / 4.18 / 5.89 / 4.23 in light mode,
                so green and orange fail 4.5:1. The old skeuomorphic folder needed a
                black scrim to hide exactly that. On paper it clears by
                construction. */}

            {/* TAB — steps up from the back plane, so the top edge is stepped. */}
            <span
              aria-hidden
              className={`absolute left-0 top-0 rounded-t-[10px] ${isElderly ? 'w-[46%] h-5' : 'w-[44%] h-4'}`}
              style={{ background: 'var(--folder)', filter: 'brightness(0.82)' }}
            />

            {/* BACK PLANE — darker, so the sheet in front of it has something to sit
                against and the folder has a visible inside. */}
            <span
              aria-hidden
              className="absolute inset-x-0 bottom-0 rounded-[var(--r-card)]"
              style={{
                top: isElderly ? 15 : 12,
                background: 'var(--folder)',
                filter: 'brightness(0.82)',
                boxShadow: 'var(--lift-1)',
              }}
            />

            {/* THE SHEET — one, not three. Its top is tucked below the back plane's
                rim and its bottom disappears behind the front panel, which is what
                makes it read as being IN the folder. Square-cornered at the bottom
                because that edge is never seen. */}
            {item.count > 0 && (
              <span
                aria-hidden
                className="absolute bg-[var(--surface)] rounded-t-[8px]"
                style={{
                  left: isElderly ? 16 : 12,
                  right: isElderly ? 16 : 12,
                  top: isElderly ? 24 : 19,
                  bottom: isElderly ? 46 : 36,
                  boxShadow: '0 -1px 2px rgba(0,0,0,0.10)',
                }}
              />
            )}
            {/* A second and third edge, just a few px each, for a fuller folder.
                Thickness is never the only carrier — the caption states the number
                (project-a11y). */}
            {item.count > 2 && (
              <span
                aria-hidden
                className="absolute bg-[var(--surface)] rounded-t-[8px] opacity-70"
                style={{
                  left: isElderly ? 22 : 17,
                  right: isElderly ? 22 : 17,
                  top: isElderly ? 20 : 16,
                  bottom: isElderly ? 46 : 36,
                }}
              />
            )}

            {/* FRONT PANEL — the base colour, the dominant plane, overlapping the
                sheet. This is the surface a real folder shows you. */}
            <span
              aria-hidden
              className="absolute inset-x-0 bottom-0 rounded-b-[var(--r-card)] rounded-t-[12px] transition-transform duration-150 group-active:scale-[0.99] motion-reduce:transition-none"
              style={{
                height: isElderly ? 62 : 48,
                background: 'var(--folder)',
                boxShadow: '0 -2px 6px rgba(0,0,0,0.14)',
              }}
            />

            {/* THE LABEL — a paper patch stuck on the front panel, which is where a
                filing folder actually carries its name. Inset from the panel on
                three sides so it reads as applied to it, not as part of it. */}
            <span
              className={`absolute bg-[var(--surface)] rounded-[8px] flex flex-col justify-center min-w-0 ${isElderly ? 'px-3' : 'px-2.5'}`}
              style={{
                left: isElderly ? 14 : 10,
                right: isElderly ? 56 : 44,
                bottom: isElderly ? 12 : 9,
                height: isElderly ? 38 : 30,
                boxShadow: '0 1px 2px rgba(0,0,0,0.18)',
              }}
            >
              <span className={`block font-bold text-foreground tracking-tight truncate leading-tight ${isElderly ? 'text-base' : 'text-[13px]'}`}>
                {item.name}
              </span>
              <span className={`block font-medium text-muted-foreground truncate tabular-nums leading-tight ${isElderly ? 'text-xs' : 'text-[11px]'}`}>
                {item.caption}
              </span>
            </span>

            {/* The icon sits on the front panel to the right of the label — on the
                colour, where it is non-text and the 3:1 floor applies. All four
                hues clear it at 4.18 minimum. */}
            <span
              aria-hidden
              className={`absolute text-white ${isElderly ? 'right-4 bottom-[22px] [&_svg]:w-7 [&_svg]:h-7' : 'right-3 bottom-[17px] [&_svg]:w-5 [&_svg]:h-5'}`}
            >
              {item.icon}
            </span>
          </button>
        );
      })}
    </div>
  );
}
