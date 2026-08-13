/**
 * `caregiver_connections.relationship_type` describes **who the caregiver is to the
 * patient** — the caregiver is the patient's son, spouse, doctor, and so on. The
 * `DOCTOR` option is what settles the direction: a patient is never their own
 * caregiver's doctor, so the field can only be describing the caregiver's role.
 *
 * That makes the field directional, and it was being rendered the same way in both
 * directions. Listing the people caring for you beside their relationship is right.
 * Listing a patient YOU care for beside the same value is inverted — it tags their
 * name with your role ("Ravi · Son" when you are Ravi's son).
 *
 * Use `caregiverRoleLabel` when the name on screen is the caregiver, and
 * `patientRoleLabel` when the name on screen is the patient.
 */

const CAREGIVER_ROLE: Record<string, string> = {
  SON: 'Son',
  DAUGHTER: 'Daughter',
  SPOUSE: 'Spouse',
  PARENT: 'Parent',
  SIBLING: 'Sibling',
  FRIEND: 'Friend',
  DOCTOR: 'Doctor',
  OTHER: 'Carer',
};

/** The inverse: what the PATIENT is to the caregiver. Son/Daughter both invert to
 *  Parent because the stored value carries no gender for the other side, and guessing
 *  one would be worse than the neutral term. */
const PATIENT_ROLE: Record<string, string> = {
  SON: 'Parent',
  DAUGHTER: 'Parent',
  PARENT: 'Child',
  SPOUSE: 'Spouse',
  SIBLING: 'Sibling',
  FRIEND: 'Friend',
  DOCTOR: 'Patient',
  OTHER: 'In your care',
};

const norm = (v?: string | null) => (v || 'OTHER').trim().toUpperCase();

/** Label for a caregiver's name — "who this person is to you". */
export function caregiverRoleLabel(relationshipType?: string | null): string {
  return CAREGIVER_ROLE[norm(relationshipType)] ?? CAREGIVER_ROLE.OTHER;
}

/** Label for a patient's name, seen by their caregiver — "who this person is to you". */
export function patientRoleLabel(relationshipType?: string | null): string {
  return PATIENT_ROLE[norm(relationshipType)] ?? PATIENT_ROLE.OTHER;
}

/** First name only, for compact cards. Falls back to the whole string, then a dash. */
export function firstName(fullName?: string | null): string {
  const trimmed = (fullName || '').trim();
  if (!trimmed) return '—';
  return trimmed.split(/\s+/)[0];
}


/**
 * A connection's state, in words the reader can act on.
 *
 * The care-circle cards used to render `connection_status` raw, so a patient
 * deciding whether their daughter could see their medication list read
 * "ACCEPTED" and "PENDING" — database values, shouted, on a screen about family.
 *
 * "Waiting for them to accept" rather than "Pending" because the difference that
 * matters to the reader is WHOSE TURN IT IS, and the enum never said.
 *
 * Lives here rather than in the card so it is pure, shared by both directions of
 * the relationship, and covered by a test.
 */
export function connectionStateCopy(
  status: string,
  isActive: boolean,
): { label: string; tone: 'success' | 'warning' | 'neutral' } {
  switch ((status || '').toUpperCase()) {
    case 'ACCEPTED':
      return isActive
        ? { label: 'Connected', tone: 'success' }
        : { label: 'Paused', tone: 'neutral' };
    case 'PENDING':
      return { label: 'Waiting for them to accept', tone: 'warning' };
    case 'REJECTED':
      return { label: 'Declined', tone: 'neutral' };
    default:
      // Never fall back to the raw enum: an unknown state is better described as
      // unknown than as a word from a database the reader has never seen.
      return { label: 'Not connected', tone: 'neutral' };
  }
}
