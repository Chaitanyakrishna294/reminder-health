/**
 * REMI — the frozen art, as geometry.
 *
 * **[docs/design/REMI.md](../../../../docs/design/REMI.md) is the authority.** Every
 * number here is lifted from it; if the two disagree, the doc wins and this file
 * is the bug. Changing any of it needs an explicit unfreeze.
 *
 * ── WHY INLINE SVG AND NOT `<img src="remi.svg">` ──
 *
 * Two of the frozen laws need to reach INSIDE the art:
 *
 *  - dark mode = the same art with the blush layer at 45%;
 *  - the shine and arm floors, which resize details so they survive at 42px.
 *
 * An `<img>` is opaque to the page — no CSS crosses into it and no prop can — so
 * the blush would sit at full strength on the OLED ground, which is precisely the
 * hotspot failure law 5 exists to prevent. Inline rendering is forced by the
 * laws, not chosen for convenience.
 *
 * The floors are arithmetic here rather than CSS. An earlier attempt expressed
 * them as `.sz-42 .shine { r: … }` and it matched NOTHING, silently, at exactly
 * the size it existed for: the art lived in a <symbol> instantiated through
 * <use>, and selectors do not cross that shadow boundary. Computing from `size`
 * has no boundary to cross.
 */

import React from 'react';
import type { RemiExpression } from '@/components/dashboard/mascot-slots';

/* ── anchor geometry (REMI.md § Anchor face values) ───────────────────────── */
const BODY = { W: 376, H: 326, CX: 256 };
const EYE = { H: 104.3, W: 57.4, CY: 262.5, L: 198.6, R: 313.4 };
const SHINE = { R: 9.76, DX: -12.6, DY: -29.2 };
const FOLD_SW = 8.3;
const MOUTH_SW = 9.5;
const MOUTH_Y = 318.7;
const BLUSH = { L: 131.95, R: 380.05, CY: 290, RX: 33, RY: 18.15 };

/** REMI.md § The shine floor. */
export function shineRadius(size: number): number {
  if (size <= 42) return 12.2;
  if (size <= 120) return 11.2;
  return SHINE.R;
}

/** REMI.md § The arm floor — `waving` only. Thickens, never hides. */
export function armMetrics(size: number): { stroke: number; hand: number } {
  if (size <= 42) return { stroke: 42, hand: 28 };
  if (size <= 56) return { stroke: 34, hand: 25 };
  return { stroke: 26, hand: 22 };
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/* ── primitives ───────────────────────────────────────────────────────────── */
const pill = (cx: number, cy: number, w: number, h: number) => (
  <rect key={`p${cx}`} x={r1(cx - w / 2)} y={r1(cy - h / 2)} width={r1(w)} height={r1(h)} rx={r1(w / 2)} />
);
/** ∩ — closed-happy. */
const arcUp = (cx: number, cy: number, w: number, d: number) =>
  `M${r1(cx - w / 2)} ${r1(cy + d / 2)} Q${r1(cx)} ${r1(cy - d * 1.5)} ${r1(cx + w / 2)} ${r1(cy + d / 2)}`;
/** ⌣ — resting lid. */
const arcDown = (cx: number, cy: number, w: number, d: number) =>
  `M${r1(cx - w / 2)} ${r1(cy - d / 2)} Q${r1(cx)} ${r1(cy + d * 1.5)} ${r1(cx + w / 2)} ${r1(cy - d / 2)}`;
const mouthArc = (w: number, depth: number, lift = 0, y = MOUTH_Y) =>
  `M${r1(BODY.CX - w / 2)} ${r1(y - lift)} Q${r1(BODY.CX)} ${r1(y + depth)} ${r1(BODY.CX + w / 2)} ${r1(y - lift)}`;

const BODY_SHAPE = (
  <>
    <ellipse cx={256} cy={256} rx={150} ry={120} />
    <circle cx={256} cy={161} r={68} /><circle cx={182} cy={179} r={68} />
    <circle cx={136} cy={227} r={68} /><circle cx={136} cy={285} r={68} />
    <circle cx={182} cy={333} r={68} /><circle cx={256} cy={351} r={68} />
    <circle cx={330} cy={333} r={68} /><circle cx={376} cy={285} r={68} />
    <circle cx={376} cy={227} r={68} /><circle cx={330} cy={179} r={68} />
  </>
);

/** Upper lobes only — the face zone stays bare skin (REMI.md law 2). */
const folds = (raised: boolean) => (
  <g fill="none" stroke="#CC3D64" strokeWidth={FOLD_SW} strokeLinecap="round">
    <path d={raised ? 'M174.7 122.6 Q146.9 128.9 140.6 156.7' : 'M174.7 137.6 Q146.9 143.9 140.6 171.7'} />
    <path d="M337.3 137.6 Q365.1 143.9 371.4 171.7" />
  </g>
);

/* ── per-expression face parameters, straight from REMI.md ────────────────── */
type Face = {
  eyes: 'open' | 'up' | 'down';
  dx?: number; dy?: number; wScale?: number; yOff?: number; depth?: number;
  mouth: { w: number; depth?: number; lift?: number; y?: number; o?: boolean };
  blush: number;
  raisedFold?: boolean;
  tilt?: number;
  arm?: boolean;
  zeds?: boolean;
};

const FACES: Record<RemiExpression, Face> = {
  happy:   { eyes: 'open', mouth: { w: 75.2, depth: 19.6 }, blush: 1 },
  waving:  { eyes: 'open', mouth: { w: 75.2, depth: 19.6 }, blush: 1, arm: true },
  proud:   { eyes: 'up', depth: 16.1, mouth: { w: 100.3, depth: 26, lift: 7 }, blush: 1.2 },
  peaceful:{ eyes: 'down', wScale: 1.25, yOff: 10, depth: 8.7,
             mouth: { w: 37.6, depth: 9.8 }, blush: 0.8, tilt: 4 },
  curious: { eyes: 'open', dx: -8.6, dy: -8.6,
             mouth: { w: 26.32, o: true, y: 306.7 }, blush: 1, raisedFold: true },
  'peaceful-sleep': { eyes: 'down', wScale: 1.25, yOff: 10, depth: 8.7,
             mouth: { w: 37.6, depth: 9.8 }, blush: 0.8, tilt: 4, zeds: true },
};

/**
 * One expression, drawn at `size`. Renders the SVG children only — the caller
 * owns the `<svg>` element, its dimensions and its accessible name.
 */
export function RemiArt({ expression, size }: { expression: RemiExpression; size: number }) {
  const f = FACES[expression];
  const dx = f.dx ?? 0, dy = f.dy ?? 0;
  const ew = EYE.W * (f.wScale ?? 1);
  const cy = EYE.CY + dy + (f.yOff ?? 0);
  const lx = EYE.L + dx, rx = EYE.R + dx;
  const sr = shineRadius(size);
  const arm = armMetrics(size);

  const eyes = f.eyes === 'open' ? (
    <g fill="#0F1C5A">{pill(lx, cy, ew, EYE.H)}{pill(rx, cy, ew, EYE.H)}</g>
  ) : (
    <g fill="none" stroke="#0F1C5A" strokeWidth={FOLD_SW} strokeLinecap="round">
      <path d={(f.eyes === 'up' ? arcUp : arcDown)(lx, cy, ew, f.depth!)} />
      <path d={(f.eyes === 'up' ? arcUp : arcDown)(rx, cy, ew, f.depth!)} />
    </g>
  );

  // Closed eyes carry no shine — there is no ink for it to sit on.
  const shine = f.eyes === 'open' ? (
    <g fill="#FFFFFF">
      <circle cx={r1(lx + SHINE.DX)} cy={r1(cy + SHINE.DY)} r={sr} />
      <circle cx={r1(rx + SHINE.DX)} cy={r1(cy + SHINE.DY)} r={sr} />
    </g>
  ) : null;

  const face = (
    <>
      {/* `remi-blush` is the hook the dark rule uses — see globals.css */}
      <g className="remi-blush" fill="#FDEEF2">
        <ellipse cx={BLUSH.L} cy={BLUSH.CY} rx={r1(BLUSH.RX * f.blush)} ry={r1(BLUSH.RY * f.blush)} />
        <ellipse cx={BLUSH.R} cy={BLUSH.CY} rx={r1(BLUSH.RX * f.blush)} ry={r1(BLUSH.RY * f.blush)} />
      </g>
      {eyes}
      {shine}
      <g fill="none" stroke="#CC3D64" strokeWidth={MOUTH_SW} strokeLinecap="round">
        {f.mouth.o
          ? <circle cx={BODY.CX} cy={f.mouth.y} r={r1(f.mouth.w / 2)} fill="none" />
          : <path d={mouthArc(f.mouth.w, f.mouth.depth!, f.mouth.lift, f.mouth.y)} />}
      </g>
    </>
  );

  return (
    <>
      {/* The arm is drawn FIRST so the body fill covers its root and it reads
          attached rather than stuck on (REMI.md § waving). */}
      {f.arm && (
        <g>
          <path d="M398 205 C430 201 447 184 451 155"
                fill="none" stroke="#F26B8A" strokeWidth={arm.stroke} strokeLinecap="round" />
          <circle cx={451} cy={150} r={arm.hand} fill="#F26B8A" />
        </g>
      )}
      <g fill="#F26B8A">{BODY_SHAPE}</g>
      {folds(!!f.raisedFold)}
      {/* Only the FACE tilts. The body never does. */}
      {f.tilt ? <g transform={`rotate(${f.tilt} 256 280)`}>{face}</g> : face}
      {f.zeds && (
        <g fill="none" stroke="#CC3D64" strokeWidth={FOLD_SW} strokeLinecap="round" strokeLinejoin="round">
          <path d="M450 168 L474 168 L450 192 L474 192" />
          <path d="M481 130 L499 130 L481 148 L499 148" />
        </g>
      )}
    </>
  );
}

/** Everything the registry can ask for, for tests and the review harness. */
export const REMI_EXPRESSIONS = Object.keys(FACES) as RemiExpression[];
