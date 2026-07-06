'use client';

// Drag-to-confirm slider for the "Next dose" card. Extracted verbatim from
// dashboard-client-view.tsx — slide right past the threshold to mark TAKEN, left to
// SKIP. Self-contained: owns its own drag state and window listeners.

import React, { useState, useEffect } from 'react';
import { Check, X } from 'lucide-react';
import { getUnitIcon } from '@/components/dashboard/dashboard-helpers';

interface MedicationSliderProps {
  event: any;
  onResolve: (action: 'TAKEN' | 'SKIP') => void;
}

const MedicationSlider = ({ event, onResolve }: MedicationSliderProps) => {
  const [position, setPosition] = useState(0); // in pixels
  const [progress, setProgress] = useState(0); // -100 (skip) .. 100 (take)
  const [isDragging, setIsDragging] = useState(false);
  const trackRef = React.useRef<HTMLDivElement>(null);
  // Refs mirror the live drag state so window-listener handlers read current
  // values without the effect re-subscribing on every pixel (the prior cause of jank).
  const positionRef = React.useRef(0);
  const draggingRef = React.useRef(false);

  const handleStart = () => {
    draggingRef.current = true;
    setIsDragging(true);
  };

  const handleMove = (clientX: number) => {
    if (!draggingRef.current || !trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const width = rect.width;
    const center = rect.left + width / 2;
    const offset = clientX - center;
    const maxOffset = width / 2 - 28; // ~knob radius
    const percentage = Math.max(-100, Math.min(100, (offset / maxOffset) * 100));
    const px = (percentage / 100) * maxOffset;
    positionRef.current = px;
    setPosition(px);
    setProgress(percentage);
  };

  const handleEnd = () => {
    if (!draggingRef.current || !trackRef.current) return;
    draggingRef.current = false;
    setIsDragging(false);
    const rect = trackRef.current.getBoundingClientRect();
    const maxOffset = rect.width / 2 - 28;
    const threshold = maxOffset * 0.7;
    const pos = positionRef.current;

    if (pos >= threshold) {
      onResolve('TAKEN');
    } else if (pos <= -threshold) {
      onResolve('SKIP');
    }
    positionRef.current = 0;
    setPosition(0);
    setProgress(0);
  };

  useEffect(() => {
    if (!isDragging) return;
    const onMouseMove = (e: MouseEvent) => handleMove(e.clientX);
    const onMouseUp = () => handleEnd();
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) handleMove(e.touches[0].clientX);
    };
    const onTouchEnd = () => handleEnd();

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDragging]);

  const takeIntensity = Math.max(0, progress) / 100; // 0..1 dragging right (take)
  const skipIntensity = Math.max(0, -progress) / 100; // 0..1 dragging left (skip)
  const armedTake = progress > 45;
  const armedSkip = progress < -45;

  return (
    <div
      ref={trackRef}
      role="slider"
      aria-label="Slide left to skip, right to take this medication"
      aria-valuemin={-100}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress)}
      className="relative w-full h-14 rounded-full overflow-hidden border border-border flex items-center justify-between px-5 select-none bg-muted shadow-inner"
    >
      {/* Directional fills that intensify as the knob travels */}
      <div
        className="absolute inset-y-0 left-0 w-1/2 bg-danger/35 pointer-events-none transition-opacity duration-75"
        style={{ opacity: skipIntensity }}
      />
      <div
        className="absolute inset-y-0 right-0 w-1/2 bg-success/35 pointer-events-none transition-opacity duration-75"
        style={{ opacity: takeIntensity }}
      />

      <span className={`relative z-10 flex items-center gap-1 text-[11px] font-black transition-colors ${armedSkip ? 'text-danger' : 'text-danger/70'}`}>
        <X className="w-3.5 h-3.5 shrink-0" /> Skip
      </span>
      <span
        className="relative z-10 text-[10px] font-black uppercase tracking-wider text-muted-foreground transition-opacity"
        style={{ opacity: 1 - Math.min(1, Math.abs(progress) / 60) }}
      >
        Slide to confirm
      </span>
      <span className={`relative z-10 flex items-center gap-1 text-[11px] font-black transition-colors ${armedTake ? 'text-success' : 'text-success/70'}`}>
        Take <Check className="w-3.5 h-3.5 shrink-0" />
      </span>

      <div
        onMouseDown={handleStart}
        onTouchStart={handleStart}
        style={{
          transform: `translateX(calc(-50% + ${position}px))`,
          left: '50%',
          willChange: 'transform',
          transition: isDragging ? 'none' : 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
        }}
        className={`absolute top-1 z-20 w-12 h-12 rounded-full bg-white shadow-lg border-2 cursor-grab active:cursor-grabbing flex items-center justify-center touch-none transition-colors ${
          armedTake ? 'border-success/60 text-success' : armedSkip ? 'border-danger/60 text-danger' : 'border-border text-primary'
        }`}
      >
        {armedTake ? <Check className="w-5 h-5" /> : armedSkip ? <X className="w-5 h-5" /> : getUnitIcon(event.medications?.unit_type, 'w-5 h-5')}
      </div>
    </div>
  );
};

export default MedicationSlider;
