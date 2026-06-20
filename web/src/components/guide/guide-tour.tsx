'use client';

import React, { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, X, Check } from 'lucide-react';
import BrainMascot from '@/components/dashboard/brain-mascot';
import { useGuide } from './guide-context';
import { TOURS } from './guide-content';

const CARD_W = 320;

function PointingMascot({ dir, size }: { dir: 'left' | 'right'; size: number }) {
  const [ok, setOk] = useState(true);
  if (!ok) return <BrainMascot size={size} mood="curious" />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/mascot/point-${dir}.png`}
      alt=""
      width={size}
      height={size}
      onError={() => setOk(false)}
      style={{ width: size, height: size, objectFit: 'contain' }}
    />
  );
}

export default function GuideTour() {
  const { activeTour, stopTour } = useGuide();
  const steps = activeTour ? TOURS[activeTour] : null;
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [vw, setVw] = useState(0);
  const [vh, setVh] = useState(0);

  useEffect(() => {
    setIndex(0);
  }, [activeTour]);

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
    const t = setTimeout(measure, 320);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [step]);

  useEffect(() => {
    if (!activeTour) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') stopTour(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeTour, stopTour]);

  if (!steps || !step || vw === 0) return null;

  const total = steps.length;
  const isLast = index === total - 1;
  const goNext = () => (isLast ? stopTour() : setIndex((i) => i + 1));
  const goBack = () => setIndex((i) => Math.max(0, i - 1));

  // Is the target present and on-screen enough to spotlight?
  const hasTarget = !!rect && rect.width > 4 && rect.height > 4 && rect.bottom > 0 && rect.top < vh;

  const cardW = Math.min(CARD_W, vw - 24);
  const estCardH = 240;

  let cardTop: number;
  let cardLeft: number;
  let dir: 'left' | 'right' = 'right';

  if (hasTarget && rect) {
    const below = rect.bottom + estCardH + 24 < vh;
    cardTop = below ? rect.bottom + 16 : Math.max(12, rect.top - estCardH - 16);
    cardLeft = Math.min(Math.max(12, rect.left + rect.width / 2 - cardW / 2), vw - 12 - cardW);
    const targetCx = rect.left + rect.width / 2;
    dir = targetCx < cardLeft + cardW / 2 ? 'left' : 'right';
  } else {
    cardTop = vh - estCardH - 24;
    cardLeft = (vw - cardW) / 2;
  }

  return (
    <div className="fixed inset-0 z-[130]" role="dialog" aria-modal="true" aria-label="Guide">
      {/* Click-anywhere-to-close catcher (transparent). */}
      <button
        aria-label="Close guide"
        onClick={stopTour}
        className="absolute inset-0 w-full h-full cursor-default"
        style={{ background: 'transparent' }}
      />

      {/* Spotlight: highlight the target and lightly dim everything else. */}
      {hasTarget && rect && (
        <div
          className="absolute rounded-2xl pointer-events-none transition-all duration-300"
          style={{
            top: rect.top - 8,
            left: rect.left - 8,
            width: rect.width + 16,
            height: rect.height + 16,
            boxShadow: '0 0 0 9999px rgba(15,28,90,0.45)',
            outline: '2px solid rgba(242,107,138,0.9)',
          }}
        />
      )}

      {/* Pointing mascot, just outside the card toward the target. */}
      <div
        className="absolute transition-all duration-300 pointer-events-none"
        style={{ top: cardTop - 58, left: dir === 'left' ? cardLeft + 6 : cardLeft + cardW - 70 }}
      >
        <PointingMascot dir={dir} size={64} />
      </div>

      {/* Step bubble. */}
      <div
        className="absolute bg-card border border-border rounded-3xl shadow-2xl p-5 transition-all duration-300 animate-fade-in"
        style={{ top: cardTop, left: cardLeft, width: cardW }}
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-black text-foreground text-base tracking-tight">{step.title}</h3>
          <button onClick={stopTour} aria-label="Skip guide" className="text-muted-foreground hover:text-foreground p-0.5 rounded-full cursor-pointer shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed mt-2">{step.message}</p>

        <div className="flex items-center justify-between mt-4">
          <div className="flex items-center gap-1.5">
            {steps.map((_, i) => (
              <span key={i} className={`w-1.5 h-1.5 rounded-full ${i === index ? 'bg-primary' : 'bg-border'}`} />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {index > 0 && (
              <button onClick={goBack} className="inline-flex items-center gap-1 text-xs font-bold text-muted-foreground hover:text-foreground px-2.5 py-1.5 rounded-xl cursor-pointer">
                <ArrowLeft className="w-3.5 h-3.5" /> Back
              </button>
            )}
            <button onClick={goNext} className="inline-flex items-center gap-1 text-xs font-black text-primary-foreground bg-primary hover:bg-primary-hover px-3.5 py-1.5 rounded-xl cursor-pointer">
              {isLast ? (<><Check className="w-3.5 h-3.5" /> Done</>) : (<>Next <ArrowRight className="w-3.5 h-3.5" /></>)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
