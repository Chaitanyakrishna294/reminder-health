'use client';

import React from 'react';
import { HelpCircle } from 'lucide-react';
import { useGuide } from './guide-context';

interface GuideButtonProps {
  tour: string;
  className?: string;
  label?: string;
}

/** The "?" help trigger. Starts the named tour from anywhere. */
export default function GuideButton({ tour, className = '', label = 'How this works' }: GuideButtonProps) {
  const { startTour } = useGuide();
  return (
    <button
      onClick={() => startTour(tour)}
      aria-label={label}
      title={label}
      className={`inline-flex items-center justify-center rounded-full text-primary bg-primary/10 hover:bg-primary/20 border border-primary/20 transition-all cursor-pointer w-8 h-8 ${className}`}
    >
      <HelpCircle className="w-4 h-4" />
    </button>
  );
}
