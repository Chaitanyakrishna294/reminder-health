// "Luxe" premium design tokens for the Care+ surfaces — on-brand: deep navy panels
// with the app's pink accent (#F26B8A) and its dark-mode ink tokens.
//
// Each Care+ surface (pill, pricing card/modal, member hub) composes these into its
// own distinct skin. The surfaces are intentionally always-dark (a self-contained
// premium theme) so they read the same in the app's light and dark modes.
import type { CSSProperties } from 'react';

// Pure deep-navy panel (the brand's dark surface). All warmth comes from the
// pink accent layers, never from purple/plum tints in the panel itself.
export const luxePanel: CSSProperties = {
  background: 'linear-gradient(160deg, #20336E 0%, #0C1330 58%, #101B42 100%)',
};
export const luxePanelShadow =
  '0 30px 70px -24px rgba(6,10,30,0.75), inset 0 1px 0 rgba(255,255,255,0.05)';

// Brand pink accent — matches the app's F8839E → F26B8A gradient.
export const ACCENT = '#F26B8A';
export const accentSurface = 'linear-gradient(180deg, #F8839E 0%, #F26B8A 55%, #ED5276 100%)';
export const accentText: CSSProperties = {
  // Rose-champagne → brand rose: reads premium while staying in the pink family.
  // (backgroundImage longhand, not the `background` shorthand: mixing shorthand
  // with backgroundClip makes React drop the clip on rerender.)
  backgroundImage: 'linear-gradient(180deg, #F9C6D3 0%, #F26B8A 100%)',
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  backgroundClip: 'text',
};
export const accentHairline = '1px solid rgba(242,107,138,0.32)';
export const accentGlow = '0 0 0 1px rgba(242,107,138,0.20), 0 18px 50px -20px rgba(242,107,138,0.30)';

// Ink on the dark panels — the app's dark-mode foreground / muted tokens.
export const luxeInk = '#EAF0FF';
export const luxeMuted = '#A6B6DD';

// Reusable light-sweep overlay. Drop into a `position: relative; overflow:
// hidden` parent.
//
// The SWEEP IS STATIC now. It carried `luxeSheen 5s ease-in-out infinite`, and
// §6 forbids idle motion outright — the recorded exception list is closed and
// Care+ is not on it. The gradient still reads as a highlight across the panel;
// it simply no longer travels across it forever.
//
// The rest of this file's palette is untouched on purpose. Care+ is a documented,
// deliberate always-dark skin (see the header), and swapping its colours for
// system tokens would be a redesign rather than conformance — that one is the
// maintainer's call, and it is written up as D5 in the conformance audit.
export const sheenStyle: CSSProperties = {
  position: 'absolute',
  top: 0,
  bottom: 0,
  width: '40%',
  background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.12) 50%, transparent 100%)',
  pointerEvents: 'none',
};
