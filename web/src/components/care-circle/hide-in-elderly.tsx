'use client';

/**
 * Renders its children at every density EXCEPT elderly.
 *
 * Exists because the care-circle page is a server component and cannot read the
 * ui mode, while the decision about what elderly sees is a real one that should
 * live in the page's own markup rather than be threaded through props.
 *
 * ELDERLY'S CARE CIRCLE ANSWERS ONE QUESTION: "who is looking after me?" So the
 * people who look after the reader stay, and everything that is a decision ABOUT
 * a relationship goes — the people they care FOR (which is caregiving work done
 * from a caregiver's own phone), the invite and request flows, and the
 * permission controls. Same line the elderly mode already draws around dose
 * correction and regimen editing: reading is fine, judging is somebody else's
 * job from a screen built for it.
 *
 * Named literally on purpose. A wrapper called `CaregiverOnly` or `AdvancedOnly`
 * would invite guessing about what it hides; this one says exactly what it does
 * and the reason lives at the call site.
 */

import React from 'react';
import { useUiMode } from '@/context/ui-mode-context';

export default function HideInElderly({ children }: { children: React.ReactNode }) {
  const { isElderly } = useUiMode();
  if (isElderly) return null;
  return <>{children}</>;
}
