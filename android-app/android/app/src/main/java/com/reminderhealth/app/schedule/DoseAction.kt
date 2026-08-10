package com.reminderhealth.app.schedule

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * One queued Taken / Skip / Snooze, written the instant the user taps — BEFORE
 * any network is attempted.
 *
 * That ordering is the whole point: until this existed, a tap on the alarm
 * screen was simply discarded, so a patient could tell the app they had taken a
 * dose and have it forgotten. In a medication record that is data loss, not a
 * missing feature. Recording locally first means the action survives being
 * offline, the process being killed, and a reboot.
 *
 * Matches `QueuedAction` in android-app/BRIDGE_CONTRACT.md.
 */
@Entity(tableName = "dose_actions")
data class DoseAction(
    /** Client-generated UUID. Local identity only — the server dedupes on its own keys. */
    @PrimaryKey val id: String,
    val medicationId: Long,
    val drugName: String,
    /** ISO 8601 UTC — the dose's own scheduled instant, never "now" at tap time. */
    val scheduledFor: String,
    /** [ACTION_TAKEN], [ACTION_SKIP] or [ACTION_SNOOZE]. */
    val action: String,
    /** ISO 8601 UTC, when the user actually tapped (device-local truth). */
    val recordedAt: String,
    val snoozeMinutes: Int? = null,
    val synced: Boolean = false,
    val syncError: String? = null,
    /** Bounded retry, so a permanently-rejected action can't loop forever. */
    val attempts: Int = 0,
) {
    companion object {
        /** Sent verbatim as resolve_reminder_event's p_action — do not localise or abbreviate. */
        const val ACTION_TAKEN = "TAKEN"
        const val ACTION_SKIP = "SKIP"

        /** Routed to snooze_reminder_event instead; not a resolve_reminder_event action. */
        const val ACTION_SNOOZE = "SNOOZE"
    }
}
