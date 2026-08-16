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

/**
 * A dose the SERVER has already resolved, being reported back to the device.
 *
 * The device runs its own retry ladder — chained exact alarms that re-ask about
 * an unanswered dose — and it cancels that ladder when it sees the answer. It
 * sees answers made on the alarm screen and on the notification. It does NOT see
 * an answer made in this webview, because that goes straight to Supabase.
 *
 * On 2026-08-14 that gap was live on a real device: two critical medications
 * marked skipped in the app kept ringing every five minutes afterwards. This
 * type is the report that closes it, and [notifyNativeDoseResolved] is called
 * from the one place every web resolve passes through — see
 * lib/reminder-events.ts.
 */
export interface ResolvedDose {
  medicationId: number;
  /** ISO-8601 UTC, the dose's own scheduled instant — the server's dose identity. */
  scheduledFor: string;
  action: 'TAKEN' | 'SKIP';
}

/** A retry chain still running on the device, from `getActiveLadders`. */
export interface ActiveLadder {
  medicationId: number;
  scheduledFor: string;
}

/**
 * The alarm's backdrop and sound.
 *
 * **Native owns the files, and this direction is the reverse of every other
 * bridge value.** `elderly` and `ringSeconds` are web data the device mirrors;
 * these are device data the web displays. The webview cannot write to Android
 * app-private storage, and the alarm has to show its picture and play its sound
 * in airplane mode with the app process dead — so the picker runs in Kotlin, the
 * bytes are copied there, and the web only ever learns which choice is active.
 *
 * That copy is also what makes "delete the original from your gallery" safe: the
 * alarm never refers to the picked file again.
 *
 * GLOBAL, not per medication (2026-08-14) — one picture and one sound for every
 * alarm. A per-medication override is the natural next step and is already half
 * built: `Medication.alarmAudioPath`/`alarmPhotoPath` exist in Room, the alarm
 * already prefers them, and what is missing is somewhere to set them (per-med UI,
 * a server column, a migration). Global costs nothing later — the resolution
 * order IS the override's mechanism, with one of its two inputs populated.
 */
export interface AlarmMediaState {
  /** A bundled key (see `bundled`), `custom`, or `none`. */
  imageChoice: string;
  /** `default` (the system alarm tone) or `custom`. */
  soundChoice: string;
  /** Keys of the images shipped inside the APK, in display order. */
  bundled: string[];
  hasCustomImage: boolean;
  hasCustomSound: boolean;
}

/** `picked: false` means the user cancelled the file picker — not an error. */
export interface AlarmPickResult {
  picked: boolean;
  imageChoice?: string;
  soundChoice?: string;
  error?: string;
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
            elderly?: boolean;
            ringSeconds?: number;
            /** BCP-47 base tag: en · hi · te · ta · kn · ml · mr. See below. */
            language?: string;
          }) => Promise<{ synced: number; canScheduleExactAlarms: boolean }>;
          /**
           * Optional: an APK older than 2026-08-14 has neither. Every caller must
           * treat their absence as "this device cannot be told", not as an error
           * — `server.url` means the web and the APK ship separately and a device
           * can be running either combination.
           */
          doseResolved?: (options: { doses: ResolvedDose[] }) => Promise<{ applied: number }>;
          getActiveLadders?: () => Promise<{ ladders: ActiveLadder[] }>;
          /** Alarm backdrop + sound. Native owns the files — see AlarmMediaState. */
          /** Water nudges. Optional: an APK older than 2026-08-14 has neither. */
          syncWater?: (options: {
            enabled: boolean;
            goalCups: number;
            cupsToday: number;
            nudgeMinutes: number[];
          }) => Promise<{ scheduled: number; cupsToday: number }>;
          getWaterCount?: () => Promise<{ cupsToday: number }>;
          getAlarmMedia?: () => Promise<AlarmMediaState>;
          setAlarmImage?: (options: { choice: string }) => Promise<AlarmMediaState>;
          pickAlarmImage?: () => Promise<AlarmPickResult>;
          pickAlarmSound?: () => Promise<AlarmPickResult>;
          clearAlarmSound?: () => Promise<AlarmMediaState>;
          /** A rendered picture of the real alarm screen — see renderAlarmPreview. */
          renderAlarmPreview?: (options: { width?: number }) => Promise<{ dataUri: string | null }>;
          previewAlarmSound?: () => Promise<{ playing: boolean }>;
          stopAlarmSoundPreview?: () => Promise<{ playing: boolean }>;
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
  /**
   * Elderly mode, mirrored so the NATIVE alarm screen can honour it. The alarm
   * is Kotlin and cannot read this webview's UI mode, and it is the one screen
   * that has to work offline at 3am for the least technical user — so the
   * choice travels, exactly as BRIDGE_CONTRACT.md requires for `language`.
   * Elderly changes one thing there: a coalesced handful is asked about one dose
   * at a time instead of as a list.
   */
  elderly?: boolean,
  /**
   * How long EACH dose rings before the alarm screen moves on to the next one in
   * the same handful. `profiles.alarm_ring_seconds`; undefined leaves whatever
   * the device already has, so an APK newer than the migration keeps its 60s
   * default rather than being reset by an absent field.
   */
  ringSeconds?: number,
  /**
   * THE IN-APP LANGUAGE, mirrored so the native alarm speaks it.
   *
   * This is the field CLAUDE.md marks CRITICAL, and the reason is that Android
   * resource qualifiers (`values-hi/`) follow the DEVICE locale, not the choice
   * made in this app. A patient whose phone is in English but who set the app to
   * Telugu would otherwise meet an English alarm at 3am — the one screen that has
   * to work offline, at speed, for the least technical user. The bridged value is
   * what makes the two agree, and native applies it with an explicit
   * `Configuration` rather than trusting the system locale.
   *
   * BCP-47 base tag only ('te', not 'te-IN'). Undefined leaves whatever the
   * device already has, so an older APK is unaffected and a newer one keeps its
   * last known choice rather than being reset to English by an absent field —
   * same contract as `ringSeconds`.
   */
  language?: string,
): Promise<{ synced: number; canScheduleExactAlarms: boolean } | null> {
  if (!isNativeApp()) return null;
  const bridge = window.Capacitor?.Plugins?.ScheduleBridge;
  if (!bridge) return null;
  // userId keys the native store to one identity. Without it, signing in as a
  // guest left the previous account's medications in place and ringing for
  // doses the current user doesn't have (found on-device 2026-08-11).
  return bridge.syncSchedule({ medications, userId, elderly, ringSeconds, language });
}

/**
 * Tell the device about a dose THIS webview just resolved.
 *
 * Without it the device's retry ladder outlives the answer: the dose reads as
 * taken everywhere on screen while the phone keeps re-asking about it every few
 * minutes, which is the 2026-08-14 field bug. Native routes this through the
 * same queue an alarm-screen tap uses, so the ladder is cancelled, the dose
 * leaves the coalesced alarm group, and a visible alarm screen refreshes.
 *
 * Deliberately silent on every failure. A resolve has ALREADY succeeded on the
 * server by the time this runs, so nothing here may turn a recorded dose into
 * an error the patient sees — the worst case is a ladder that outlives the
 * answer by one app-open, which the reconciliation in `schedule-sync` then
 * clears.
 */
export async function notifyNativeDoseResolved(doses: ResolvedDose[]): Promise<void> {
  if (!isNativeApp() || doses.length === 0) return;
  const bridge = window.Capacitor?.Plugins?.ScheduleBridge;
  if (!bridge?.doseResolved) return;
  try {
    await bridge.doseResolved({ doses });
  } catch (err) {
    console.error('[ScheduleBridge] doseResolved failed:', err);
  }
}

/**
 * The alarm's current backdrop and sound, or null when this device cannot say —
 * a browser, or an APK older than the media picker. Null means "do not render
 * the section", never "no image chosen": showing "None selected" to someone
 * whose alarm has a picture would invite them to fix something that is not
 * broken.
 */
export async function getAlarmMedia(): Promise<AlarmMediaState | null> {
  if (!isNativeApp()) return null;
  const bridge = window.Capacitor?.Plugins?.ScheduleBridge;
  if (!bridge?.getAlarmMedia) return null;
  try {
    return await bridge.getAlarmMedia();
  } catch (err) {
    console.error('[ScheduleBridge] getAlarmMedia failed:', err);
    return null;
  }
}

/**
 * A rendered picture of the REAL alarm screen, as a `data:` URI for an `<img>`.
 *
 * Native inflates the same layouts the alarm uses and draws them to a bitmap, so
 * the Settings miniature cannot drift from the screen it previews. A CSS
 * recreation would have been a second implementation of the most safety-critical
 * screen in the product, and a preview that quietly stops matching is worse than
 * no preview — it is a promise about a screen the user next sees at 3am.
 *
 * Null means "no preview available": a browser, an older APK, or a render that
 * failed. Never an error the settings screen surfaces.
 */
export async function renderAlarmPreview(width = 420): Promise<string | null> {
  const bridge = window.Capacitor?.Plugins?.ScheduleBridge;
  if (!isNativeApp() || !bridge?.renderAlarmPreview) return null;
  try {
    const { dataUri } = await bridge.renderAlarmPreview({ width });
    return dataUri ?? null;
  } catch (err) {
    console.error('[ScheduleBridge] renderAlarmPreview failed:', err);
    return null;
  }
}

/** Hear the chosen alarm sound. Non-looping and self-stopping after ~10s. */
export async function previewAlarmSound(): Promise<boolean> {
  const bridge = window.Capacitor?.Plugins?.ScheduleBridge;
  if (!isNativeApp() || !bridge?.previewAlarmSound) return false;
  try {
    const { playing } = await bridge.previewAlarmSound();
    return playing;
  } catch {
    return false;
  }
}

export async function stopAlarmSoundPreview(): Promise<void> {
  const bridge = window.Capacitor?.Plugins?.ScheduleBridge;
  if (!isNativeApp() || !bridge?.stopAlarmSoundPreview) return;
  try {
    await bridge.stopAlarmSoundPreview();
  } catch {
    /* stopping is best-effort; it self-stops anyway */
  }
}

/**
 * Push the hydration schedule to the device.
 *
 * The WEB computes the nudge times — including dropping the ones that clash with
 * a dose — so the settings preview and the phone cannot disagree about when
 * reminders arrive. Native only picks the next one, which it must be able to do
 * with no network.
 *
 * Silent on every failure: water is the quiet tier, and a sync problem here must
 * never surface as an error on a medication screen.
 */
export async function syncWaterToNative(opts: {
  enabled: boolean;
  goalCups: number;
  cupsToday: number;
  nudgeMinutes: number[];
}): Promise<void> {
  const bridge = window.Capacitor?.Plugins?.ScheduleBridge;
  if (!isNativeApp() || !bridge?.syncWater) return;
  try {
    await bridge.syncWater(opts);
  } catch (err) {
    console.error('[ScheduleBridge] syncWater failed:', err);
  }
}

/** Cups the DEVICE counted (from the notification's Taken), or null if it cannot say. */
export async function getNativeWaterCount(): Promise<number | null> {
  const bridge = window.Capacitor?.Plugins?.ScheduleBridge;
  if (!isNativeApp() || !bridge?.getWaterCount) return null;
  try {
    const { cupsToday } = await bridge.getWaterCount();
    return typeof cupsToday === 'number' ? cupsToday : null;
  } catch {
    return null;
  }
}

export async function setAlarmImage(choice: string): Promise<AlarmMediaState | null> {
  const bridge = window.Capacitor?.Plugins?.ScheduleBridge;
  if (!isNativeApp() || !bridge?.setAlarmImage) return null;
  return bridge.setAlarmImage({ choice });
}

/** Opens Android's document picker. Resolves with `picked: false` if cancelled. */
export async function pickAlarmImage(): Promise<AlarmPickResult> {
  const bridge = window.Capacitor?.Plugins?.ScheduleBridge;
  if (!isNativeApp() || !bridge?.pickAlarmImage) return { picked: false };
  return bridge.pickAlarmImage();
}

export async function pickAlarmSound(): Promise<AlarmPickResult> {
  const bridge = window.Capacitor?.Plugins?.ScheduleBridge;
  if (!isNativeApp() || !bridge?.pickAlarmSound) return { picked: false };
  return bridge.pickAlarmSound();
}

export async function clearAlarmSound(): Promise<AlarmMediaState | null> {
  const bridge = window.Capacitor?.Plugins?.ScheduleBridge;
  if (!isNativeApp() || !bridge?.clearAlarmSound) return null;
  return bridge.clearAlarmSound();
}

/**
 * Retry chains still running on this device. Empty outside the app, and on any
 * APK that predates the call — both mean "nothing to reconcile".
 */
export async function getNativeActiveLadders(): Promise<ActiveLadder[]> {
  if (!isNativeApp()) return [];
  const bridge = window.Capacitor?.Plugins?.ScheduleBridge;
  if (!bridge?.getActiveLadders) return [];
  try {
    const { ladders } = await bridge.getActiveLadders();
    return ladders ?? [];
  } catch (err) {
    console.error('[ScheduleBridge] getActiveLadders failed:', err);
    return [];
  }
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
