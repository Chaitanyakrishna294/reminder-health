import React from 'react';

type Mood = 'asking' | 'happy';

interface BrainMascotProps {
  size?: number;
  mood?: Mood;
  className?: string;
}

/**
 * Friendly "Re-MIND-eЯ" brain mascot (inline SVG, app palette only).
 * - mood 'asking'  → open, curious eyes + gentle smile (used by the dose gate)
 * - mood 'happy'   → cheerful closed-eye arcs + big smile (all-caught-up states)
 * Pure presentational; safe in server components.
 */
export default function BrainMascot({ size = 160, mood = 'asking', className = '' }: BrainMascotProps) {
  return (
    <span
      className={`inline-block ${className}`}
      style={{ width: size, height: size, animation: 'brainBob 4.5s ease-in-out infinite' }}
      aria-hidden="true"
    >
      <style>{'@keyframes brainBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}'}</style>
      <svg viewBox="0 0 200 200" width={size} height={size} xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="brainFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#F8839E" />
            <stop offset="100%" stopColor="#F26B8A" />
          </linearGradient>
        </defs>

        {/* soft shadow */}
        <ellipse cx="100" cy="178" rx="52" ry="9" fill="#0F1C5A" opacity="0.06" />

        {/* brain body — bumpy rounded silhouette */}
        <path
          fill="url(#brainFill)"
          d="M100 28
             c-16-14-44-12-54 6
             c-16 2-26 16-22 31
             c-12 8-13 26-2 35
             c-2 16 12 29 30 27
             c10 12 32 12 48 0
             c18 2 32-11 30-27
             c11-9 10-27-2-35
             c4-15-6-29-22-31
             c-10-18-38-20-54-6 Z"
        />

        {/* central fissure + gyri (darker pink) */}
        <g stroke="#ED5276" strokeWidth="3.2" strokeLinecap="round" fill="none" opacity="0.55">
          <path d="M100 36 V150" />
          <path d="M74 70 q-14 8 -6 22" />
          <path d="M70 104 q-16 6 -8 22" />
          <path d="M126 70 q14 8 6 22" />
          <path d="M130 104 q16 6 8 22" />
        </g>

        {/* blush */}
        <ellipse cx="68" cy="116" rx="11" ry="7" fill="#FBC3D1" opacity="0.85" />
        <ellipse cx="132" cy="116" rx="11" ry="7" fill="#FBC3D1" opacity="0.85" />

        {/* face */}
        {mood === 'happy' ? (
          <g stroke="#0F1C5A" strokeWidth="5" strokeLinecap="round" fill="none">
            <path d="M76 96 q9 -10 18 0" />
            <path d="M106 96 q9 -10 18 0" />
            <path d="M80 116 q20 22 40 0" />
          </g>
        ) : (
          <g fill="#0F1C5A">
            <circle cx="85" cy="98" r="6.5" />
            <circle cx="115" cy="98" r="6.5" />
            <circle cx="87" cy="96" r="2" fill="#ffffff" />
            <circle cx="117" cy="96" r="2" fill="#ffffff" />
            <path d="M84 116 q16 14 32 0" stroke="#0F1C5A" strokeWidth="5" strokeLinecap="round" fill="none" />
          </g>
        )}
      </svg>
    </span>
  );
}
