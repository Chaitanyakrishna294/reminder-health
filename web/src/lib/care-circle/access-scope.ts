/**
 * WHAT A CAREGIVER CAN SEE, in the patient's words.
 *
 * One source for two jobs that must never disagree: the summary shown BEFORE you
 * send an invitation, and the permission list shown afterwards. If they drift,
 * the app tells someone one thing while granting another — and the thing being
 * granted is access to their medication history.
 *
 * THE DEFAULTS ARE THE DATABASE'S, not a guess. `caregiver_connections` sets
 * them as column defaults (migration_caregiver_decoupling_phase_a.sql and
 * migration_medical_profiles.sql), and `invite_caregiver` inserts without
 * overriding them, so a fresh connection lands exactly here. Change one there
 * and this file must change in the same commit — the test asserts the pair.
 */

export interface AccessFlags {
  can_view_medications: boolean;
  can_view_vault: boolean;
  can_view_reports: boolean;
  can_edit_medications: boolean;
  can_receive_escalations: boolean;
  can_view_medical_profile: boolean;
}

/** Exactly the column defaults a new invitation gets. */
export const DEFAULT_ACCESS: AccessFlags = {
  can_view_medications: true,
  can_view_vault: false,
  can_view_reports: false,
  can_edit_medications: false,
  can_receive_escalations: true,
  can_view_medical_profile: false,
};

export interface AccessItem {
  key: keyof AccessFlags;
  /** What it lets them DO, from the patient's side. Never the column name. */
  can: string;
  /** The same capability phrased as its absence, for the "cannot" list. */
  cannot: string;
}

/**
 * Ordered by how much of the patient it exposes, most sensitive last — so a
 * reader scanning the "can" list meets the mildest thing first and the list
 * reads as escalating rather than arbitrary.
 */
export const ACCESS_ITEMS: AccessItem[] = [
  {
    key: 'can_view_medications',
    can: 'See your medicines and when each dose is due',
    cannot: 'See your medicines',
  },
  {
    key: 'can_receive_escalations',
    can: 'Be told if you miss an important dose',
    cannot: 'Be told if you miss a dose',
  },
  {
    key: 'can_view_reports',
    can: 'See how often you take your doses over time',
    cannot: 'See how often you take your doses over time',
  },
  {
    key: 'can_view_medical_profile',
    can: 'See your medical profile — blood group, allergies, emergency contact',
    cannot: 'See your medical profile',
  },
  {
    key: 'can_view_vault',
    can: 'Open the documents in your Health Vault',
    cannot: 'Open your Health Vault documents',
  },
  {
    key: 'can_edit_medications',
    // The only one that WRITES. Phrased so that is unmistakable.
    can: 'Add, change and pause your medicines',
    cannot: 'Change anything about your medicines',
  },
];

/** Split into what this connection allows and what it does not. */
export function describeAccess(flags: AccessFlags): { can: string[]; cannot: string[] } {
  const can: string[] = [];
  const cannot: string[] = [];
  for (const item of ACCESS_ITEMS) {
    if (flags[item.key]) can.push(item.can);
    else cannot.push(item.cannot);
  }
  return { can, cannot };
}
