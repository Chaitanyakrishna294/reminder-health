/**
 * Thin wrapper around the native ScheduleBridge Capacitor plugin
 * (android-app/BRIDGE_CONTRACT.md). No @capacitor/core dependency added to
 * web/ on purpose — the web app must keep working standalone in a normal
 * browser, where `window.Capacitor` simply doesn't exist. `isNativeApp()`
 * is the one check every caller needs before touching the bridge.
 */

export interface MedicationPayload {
  id: number;
  drugName: string;
  dosage: string | null;
  dosageAmount: number;
  unitType: string | null;
  reminderTimes: string[];
  doseDays: number[] | null;
  timezone: string;
  nextReminderAt: string;
  active: boolean;
  medicationReason: string | null;
}

/**
 * Handed to native so it can call Supabase RPCs as this user (offline action
 * queue). `supabaseUrl` + the **anon** key travel with it rather than being
 * hardcoded in the APK: one source of truth (the web's `NEXT_PUBLIC_*` env) and
 * nothing extra committed to the repo. The service-role key must never be sent.
 */
export interface BridgeSession {
  accessToken: string;
  refreshToken: string;
  /** Epoch SECONDS (Supabase's own unit), not milliseconds. */
  expiresAt: number;
  supabaseUrl: string;
  supabaseAnonKey: string;
  /** Which account owns the native stores — see SessionStore.ownerUserId. */
  userId: string;
}

/** A Taken/Skip/Snooze recorded on the device but not yet accepted by the server. */
export interface PendingAction {
  id: string;
  medicationId: number;
  drugName: string;
  scheduledFor: string;
  action: 'TAKEN' | 'SKIP' | 'SNOOZE';
  recordedAt: string;
  attempts: number;
  syncError: string | null;
}

declare global {
  interface Window {
    Capacitor?: {
      isNativePlatform?: () => boolean;
      Plugins?: {
        ScheduleBridge?: {
          syncSchedule: (options: {
            medications: MedicationPayload[];
          }) => Promise<{ synced: number; canScheduleExactAlarms: boolean }>;
          getSchedule: () => Promise<{ medications: MedicationPayload[] }>;
          setSession: (options: BridgeSession) => Promise<{ stored: boolean; syncedPendingActions: number }>;
          getPendingActions: () => Promise<{ actions: PendingAction[] }>;
          /** Step-3 debug helper — see BRIDGE_CONTRACT.md. Not a product feature. */
          scheduleTestAlarm: (options: {
            seconds: number;
          }) => Promise<{ scheduledFor: string; canScheduleExactAlarms: boolean }>;
        };
      };
    };
  }
}

/** True only inside the Capacitor app; always false in a normal browser tab. */
export function isNativeApp(): boolean {
  return typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.();
}

/**
 * Replaces the ENTIRE native schedule store — not a diff. Call after any
 * medication create/edit/delete, and once per app foreground to resync. A
 * no-op (resolves immediately) outside the native app.
 */
/**
 * Hands the current Supabase session to native. Must run BEFORE
 * [syncScheduleToNative] on a given app open: it is also what makes a queued
 * Taken/Skip syncable, so native drains the action queue as soon as it lands.
 *
 * A no-op outside the native app.
 */
export async function setNativeSession(session: BridgeSession): Promise<{ syncedPendingActions: number } | null> {
  if (!isNativeApp()) return null;
  const bridge = window.Capacitor?.Plugins?.ScheduleBridge;
  if (!bridge?.setSession) return null;
  return bridge.setSession(session);
}

/** Actions recorded on the device that the server hasn't accepted yet. */
export async function getPendingNativeActions(): Promise<PendingAction[]> {
  if (!isNativeApp()) return [];
  const bridge = window.Capacitor?.Plugins?.ScheduleBridge;
  if (!bridge?.getPendingActions) return [];
  const { actions } = await bridge.getPendingActions();
  return actions ?? [];
}

export async function syncScheduleToNative(
  medications: MedicationPayload[],
): Promise<{ synced: number; canScheduleExactAlarms: boolean } | null> {
  if (!isNativeApp()) return null;
  const bridge = window.Capacitor?.Plugins?.ScheduleBridge;
  if (!bridge) return null;
  return bridge.syncSchedule({ medications });
}
