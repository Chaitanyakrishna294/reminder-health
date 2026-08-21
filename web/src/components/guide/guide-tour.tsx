'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, X, Check } from 'lucide-react';
import BrainMascot from '@/components/dashboard/brain-mascot';
import { mascotSlot } from '@/components/dashboard/mascot-slots';
import { useGuide } from './guide-context';
import { TOURS } from './guide-content';
import { useDensity } from '@/context/density-context';

const CARD_W = 320;

export default function GuideTour() {
  const { activeTour, stopTour, stepIndex: index, setStepIndex } = useGuide();
  const { density } = useDensity();
  /**
   * Steps whose target this density does not render are dropped, so "step 2 of 3"
   * counts what the user will actually be shown.
   *
   * NOTE for anyone adding `densities` to the newMedication tour:
   * medications/new/page.tsx reads `TOURS.newMedication[stepIndex]` to drive the
   * wizard, so filtering that tour would put the two out of step. Give that page
   * the same filter at the same time, or leave newMedication unfiltered.
   */
  const steps = activeTour
    ? TOURS[activeTour].filter((s) => !s.densities || s.densities.includes(density))
    : null;
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [vw, setVw] = useState(0);
  const [vh, setVh] = useState(0);
  /**
   * THE BUBBLE'S REAL HEIGHT, MEASURED — never guessed.
   *
   * This used to be `const estCardH = 240`, a hardcoded number the placement math
   * trusted completely. Real cards measure 203-271px at the default font, so the
   * dashboard tour's "Today's schedule" step already hung 11px off the bottom of a
   * 375x812 screen; at the system font's largest setting cards reach 472px and
   * EVERY step hung off, by up to 212px. The Back/Next buttons live at the bottom
   * of the card, so a card hanging off the bottom is a tour you cannot advance —
   * only Esc or the small close cross gets you out.
   *
   * Same lesson the dose gate's fit search is built on: measure the rendered thing
   * against the space it has. There is no threshold worth guessing here, because
   * the height depends on the step's text, the font scale and the card's width.
   */
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardH, setCardH] = useState(0);

  const step = steps ? steps[index] : null;

  // Measure the target: scroll into view, then read its rect; keep it fresh on scroll/resize.
  useEffect(() => {
    if (!step) {
      setRect(null);
      return;
    }
    setVw(window.innerWidth);
    setVh(window.innerHeight);
    const measure = () => {
      const el = document.querySelector(`[data-tour="${step.target}"]`) as HTMLElement | null;
      setRect(el ? el.getBoundingClientRect() : null);
      setVw(window.innerWidth);
      setVh(window.innerHeight);
    };
    const el = document.querySelector(`[data-tour="${step.target}"]`) as HTMLElement | null;
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    // Re-measure a few times: when a tour drives another component (e.g. the Add
    // Medication wizard switching step), the target may render a moment after the
    // step changes, so a single measure can miss it.
    measure();
    const timers = [90, 240, 430, 680, 1000].map((d) => setTimeout(measure, d));
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [step]);

  /**
   * `measure()` runs IMMEDIATELY inside the effect as well as through the
   * ResizeObserver, and that is deliberate rather than belt-and-braces: an effect
   * body runs whenever React commits, but a ResizeObserver only delivers during
   * the rendering steps, which a backgrounded or non-compositing webview pauses.
   * The immediate call is what makes the card correct on a step change even then;
   * the observer is what catches a system font-size change, which alters the
   * height with no React state to depend on.
   */
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const measure = () => {
      const h = el.getBoundingClientRect().height;
      // Only commit real changes — sub-pixel churn would re-render forever.
      setCardH((prev) => (Math.abs(prev - h) > 1 ? h : prev));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [step, activeTour, vw, vh]);

  useEffect(() => {
    if (!activeTour) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') stopTour(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeTour, stopTour]);

  if (!steps || !step || vw === 0) return null;

  const total = steps.length;
  const isLast = index === total - 1;
  const goNext = () => (isLast ? stopTour() : setStepIndex((i) => i + 1));
  const goBack = () => setStepIndex((i) => Math.max(0, i - 1));

  // Is the target present and on-screen enough to spotlight?
  const hasTarget = !!rect && rect.width > 4 && rect.height > 4 && rect.bottom > 0 && rect.top < vh;

  const cardW = Math.min(CARD_W, vw - 24);
  const M = 12; // the margin the card keeps from every screen edge

  // 240 only ever describes the FIRST frame, before the measurement lands. Every
  // frame after that uses the real height.
  const measuredH = cardH || 240;
  // A card taller than the screen cannot be placed, only capped — see the style
  // below, which lets it scroll internally so Back/Next stay reachable.
  const maxCardH = Math.max(120, vh - M * 2);
  const placedH = Math.min(measuredH, maxCardH);

  let cardTop: number;
  let cardLeft: number;

  if (hasTarget && rect) {
    const fitsBelow = rect.bottom + 16 + placedH + M <= vh;
    cardTop = fitsBelow ? rect.bottom + 16 : rect.top - placedH - 16;
    cardLeft = Math.min(Math.max(M, rect.left + rect.width / 2 - cardW / 2), vw - M - cardW);
  } else {
    cardTop = vh - placedH - 24;
    cardLeft = (vw - cardW) / 2;
  }
  // The last word, whatever the target did: neither edge may leave the viewport.
  // Above-placement can still go negative for a target near the top, and a target
  // near the bottom can push a tall card past it.
  cardTop = Math.min(Math.max(M, cardTop), Math.max(M, vh - placedH - M));

  // Interactive tutorials (the Add Medication wizard, whose steps carry a wizardStep)
  // leave a live "hole" over the highlighted field so the user can actually use it;
  // read-only tours close on any click as before.
  const interactive = step?.wizardStep != null;
  const holeTop = rect ? rect.top - 8 : 0;
  const holeLeft = rect ? rect.left - 8 : 0;
  const holeW = rect ? rect.width + 16 : 0;
  const holeH = rect ? rect.height + 16 : 0;
  const catcher = 'absolute pointer-events-auto cursor-default';

  return (
    // Container lets pointer events fall through; only the catchers and bubble catch them,
    // so the spotlit field stays interactive in tutorial mode.
    <div className="fixed inset-0 z-[130] pointer-events-none" role="dialog" aria-modal={interactive ? undefined : true} aria-label="Guide">
      {/* Spotlight: highlight the target and lightly dim everything else. */}
      {hasTarget && rect && (
        <div
          className="absolute rounded-[var(--r-card)] pointer-events-none transition-all duration-300"
          style={{
            top: holeTop,
            left: holeLeft,
            width: holeW,
            height: holeH,
            boxShadow: '0 0 0 9999px rgba(15,28,90,0.45)',
            outline: '2px solid rgba(242,107,138,0.9)',
          }}
        />
      )}

      {/* Close catchers. Tutorial mode: four panels around the live hole, so clicking the
          dimmed area (or ✕ / Esc) closes but the field itself stays usable. Otherwise a
          single full-screen catcher closes on any click. */}
      {hasTarget && rect && interactive ? (
        <>
          <button aria-label="Close guide" tabIndex={-1} onClick={stopTour} className={catcher} style={{ top: 0, left: 0, width: '100%', height: Math.max(0, holeTop) }} />
          <button aria-label="Close guide" tabIndex={-1} onClick={stopTour} className={catcher} style={{ top: holeTop + holeH, left: 0, width: '100%', bottom: 0 }} />
          <button aria-label="Close guide" tabIndex={-1} onClick={stopTour} className={catcher} style={{ top: holeTop, left: 0, width: Math.max(0, holeLeft), height: holeH }} />
          <button aria-label="Close guide" tabIndex={-1} onClick={stopTour} className={catcher} style={{ top: holeTop, left: holeLeft + holeW, right: 0, height: holeH }} />
        </>
      ) : (
        <button aria-label="Close guide" onClick={stopTour} className={`${catcher} inset-0 w-full h-full`} style={{ background: 'transparent' }} />
      )}

      {/* Step bubble — the guider mascot lives inside it. */}
      <div
        className="absolute card-lift card-lift-2 p-5 transition-all duration-300 animate-fade-in pointer-events-auto"
        ref={cardRef}
        style={{
          top: cardTop,
          left: cardLeft,
          width: cardW,
          maxHeight: maxCardH,
          // Only when the card genuinely cannot fit — an overflow container clips
          // the card's own shadow, so it is not worth paying in the normal case.
          overflowY: measuredH > maxCardH ? 'auto' : undefined,
        }}
      >
        <div className="flex items-start gap-3">
          {/* Was `guider.png` at a hardcoded 52, with the registry lookup sitting
              underneath as an error fallback — so the tour showed the pre-freeze art
              and the approved `curious` face rendered only when the PNG failed. The
              registry is the single source of truth for placement AND size; a
              hardcoded number here is that decision quietly re-made somewhere
              nobody would look again. */}
          <BrainMascot {...mascotSlot('guideTour')} />
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-black text-foreground text-base tracking-tight">{step.title}</h3>
              <button onClick={stopTour} aria-label="Skip guide" className="text-muted-foreground hover:text-foreground p-0.5 rounded-full cursor-pointer shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed mt-1">{step.message}</p>
          </div>
        </div>

        <div className="flex items-center justify-between mt-4">
          <div className="flex items-center gap-1.5">
            {steps.map((_, i) => (
              <span key={i} className={`w-1.5 h-1.5 rounded-full ${i === index ? 'bg-primary' : 'bg-border'}`} />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {index > 0 && (
              <button onClick={goBack} className="inline-flex items-center gap-1 text-xs font-bold text-muted-foreground hover:text-foreground px-2.5 py-1.5 rounded-[var(--r-control)] cursor-pointer">
                <ArrowLeft className="w-3.5 h-3.5" /> Back
              </button>
            )}
            <button onClick={goNext} className="inline-flex items-center gap-1 text-xs font-black text-primary-strong-foreground bg-primary-strong hover:bg-primary-strong-hover px-3.5 py-1.5 rounded-[var(--r-control)] cursor-pointer">
              {isLast ? (<><Check className="w-3.5 h-3.5" /> Done</>) : (<>Next <ArrowRight className="w-3.5 h-3.5" /></>)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
