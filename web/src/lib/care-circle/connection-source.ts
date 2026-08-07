// Which table a care-circle row actually lives in.
//
// `active_caregiver_links` is a compatibility view: a union of the modern
// `caregiver_connections` table and the legacy `caregiver_info` one. `is_migrated` tells
// them apart, and it decides which table a write has to target.
//
// This lives in its own module — not in `connection-actions.tsx` — because that file is
// `'use client'`, and a server component calling a function exported from a client module
// throws at runtime ("Attempted to call sourceOf() from the server"). Types cross that
// boundary fine; functions do not.

export type ConnectionSource = 'connections' | 'legacy';

export const sourceOf = (isMigrated?: boolean): ConnectionSource =>
  isMigrated ? 'connections' : 'legacy';
