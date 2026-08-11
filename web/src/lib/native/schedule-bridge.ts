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
            userId?: string;
          }) => Promise<{ synced: number; canScheduleExactAlarms: boolean }>;
          clearSchedule: () => Promise<{
            cleared: boolean;
            syncedBeforeClear: number;
            strandedActions: number;
          }>;
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
  userId?: string,
): Promise<{ synced: number; canScheduleExactAlarms: boolean } | null> {
  if (!isNativeApp()) return null;
  const bridge = window.Capacitor?.Plugins?.ScheduleBridge;
  if (!bridge) return null;
  // userId keys the native store to one identity. Without it, signing in as a
  // guest left the previous account's medications in place and ringing for
  // doses the current user doesn't have (found on-device 2026-08-11).
  return bridge.syncSchedule({ medications, userId });
}

/**
 * Wipes the native medication store and cancels every registered alarm.
 *
 * MUST be called on sign-out (and before signing a different account in), or the
 * previous user's doses keep ringing on this device. Native flushes any queued
 * dose actions first, while the outgoing session is still valid.
 *
 * A no-op outside the native app.
 */
export async function clearNativeSchedule(): Promise<void> {
  if (!isNativeApp()) return;
  const bridge = window.Capacitor?.Plugins?.ScheduleBridge;
  if (!bridge?.clearSchedule) return;
  const result = await bridge.clearSchedule();
  console.log(
    `[ScheduleSync] native store cleared and alarms cancelled ` +
      `(synced ${result.syncedBeforeClear} before clearing, ${result.strandedActions} stranded)`,
  );
}
