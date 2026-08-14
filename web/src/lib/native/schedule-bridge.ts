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
  /**
   * `medications.priority_level` — 'normal' | 'important' | 'critical'.
   *
   * Sent as of the retry ladder (2026-08-14). It was deliberately NOT in this
   * payload before, because nothing native needed it: the alarm rang once and
   * the server owned every escalation decision. The ladder is the first native
   * behaviour that differs by priority, so now it travels.
   */
  priorityLevel: string | null;
  /**
   * Retry override, or NULL to use the priority default. BOTH or NEITHER — a
   * half-set pair is rejected by the DB constraint, and the native side treats
   * either being null as "use the default".
   *
   * `interval * count` may never exceed 30 minutes. That is not a preference:
   * the server clamps its escalation anchor at created_at + 30, so a longer
   * ladder would have the device re-asking the patient while the caregiver was
   * already being told the dose was missed. See lib/schedule/retry-ladder.ts.
   */
  retryIntervalMinutes: number | null;
  retryCount: number | null;
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

/**
 * Whether alarms will actually fire on this specific device.
 *
 * Every field except `manufacturer`/`isAggressiveOem` is something only the USER
 * can grant — the app can detect and explain, never fix. See DeviceReliability.kt.
 */
export interface ReliabilityStatus {
  manufacturer: string;
  /** Distinct from manufacturer: a vivo-made phone reports BRAND=iQOO. */
  brand: string;
  /** OEM skins known to kill alarms even with battery optimisation already off. */
  isAggressiveOem: boolean;
  ignoringBatteryOptimizations: boolean;
  canScheduleExactAlarms: boolean;
  notificationsEnabled: boolean;
  /** Android 14+ gate on the full-screen alarm takeover. */
  canUseFullScreenIntent: boolean;
  /** Whether an OEM autostart screen exists on this device to link to. */
  hasAutostartSettings: boolean;
}

export type ReliabilityTarget = 'battery' | 'autostart' | 'notifications' | 'exactAlarms';

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

/** Android hardware back button payload — see lib/native/app-bridge.ts. */
export interface BackButtonEvent {
  /** Capacitor's own read of whether the webview has history to pop. */
  canGoBack: boolean;
}

export interface PluginListenerHandle {
  remove: () => Promise<void> | void;
}

declare global {
  interface Window {
    Capacitor?: {
      isNativePlatform?: () => boolean;
      Plugins?: {
        /**
         * Capacitor's own App plugin (@capacitor/app). Optional because it was NOT
         * installed in android-app when the navigation rework was written — any APK
         * built before that lands has no `App` here at all.
         */
        App?: {
          addListener: (
            event: 'backButton',
            cb: (event: BackButtonEvent) => void,
          ) => Promise<PluginListenerHandle> | PluginListenerHandle;
          /** Sends the app to the background — what Android's own back gesture does. */
          minimizeApp?: () => Promise<void>;
          exitApp?: () => Promise<void>;
        };
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
          getReliabilityStatus?: () => Promise<ReliabilityStatus>;
          openReliabilitySetting?: (options: { target: ReliabilityTarget }) => Promise<{ opened: boolean }>;
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
 * Whether alarms will actually fire on this device. Null outside the native app,
 * and null on an APK older than this bridge method — callers must treat both as
 * "nothing to show" rather than "everything is fine".
 */
export async function getReliabilityStatus(): Promise<ReliabilityStatus | null> {
  if (!isNativeApp()) return null;
  const bridge = window.Capacitor?.Plugins?.ScheduleBridge;
  if (!bridge?.getReliabilityStatus) return null;
  return bridge.getReliabilityStatus();
}

/**
 * Opens the system screen for [target]. Only the user can grant these.
 *
 * False means every intent in native's chain failed to resolve — the caller must
 * then show the written steps, because the user is otherwise left on whatever
 * screen they were on with no idea what happened.
 */
export async function openReliabilitySetting(target: ReliabilityTarget): Promise<boolean> {
  if (!isNativeApp()) return false;
  const bridge = window.Capacitor?.Plugins?.ScheduleBridge;
  if (!bridge?.openReliabilitySetting) return false;
  const { opened } = await bridge.openReliabilitySetting({ target });
  return opened;
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
