package com.reminderhealth.app.schedule

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * [ActionSync.isAuthFailure] decides whether a failed sync spends one of an
 * action's five retries. Getting it wrong in either direction costs something
 * real, which is why it is a pure function with tests rather than an inline
 * condition:
 *
 *  - **Too narrow** and an expired token burns the ceiling, which is the
 *    2026-08-18 bug: a patient's recorded "I took it" stranded on
 *    `resolve_reminder_event HTTP 401 ... PGRST303 JWT expired`.
 *  - **Too wide** and a dose the server permanently rejects retries forever,
 *    which is what the ceiling exists to stop.
 *
 * The strings below are the real shapes [ActionSync.post] produces —
 * `"<fn> HTTP <code>: <body>"` — not invented ones.
 */
class ActionSyncAuthFailureTest {

    @Test
    fun `the 401 that stranded a dose on 2026-08-18 is an auth failure`() {
        assertTrue(
            ActionSync.isAuthFailure(
                "resolve_reminder_event HTTP 401: {\"code\":\"PGRST303\"," +
                    "\"message\":\"JWT expired\"}",
            ),
        )
    }

    @Test
    fun `PGRST303 counts even if the status text is missing`() {
        // Defensive: the body is truncated to 300 chars, so a long error could in
        // principle arrive without the code — but when the code IS there it must win.
        assertTrue(ActionSync.isAuthFailure("something odd: PGRST303"))
    }

    @Test
    fun `403 is an auth failure — a token that parses but is not accepted`() {
        assertTrue(ActionSync.isAuthFailure("snooze_reminder_event HTTP 403: forbidden"))
    }

    @Test
    fun `a permanently rejected dose is NOT an auth failure and must spend a retry`() {
        // These are the errors the ceiling was built for. If they ever read as auth
        // failures they would retry forever.
        assertFalse(
            ActionSync.isAuthFailure(
                "resolve_reminder_event HTTP 400: {\"message\":\"INVALID_SCHEDULED_TIME\"}",
            ),
        )
        assertFalse(
            ActionSync.isAuthFailure(
                "resolve_reminder_event HTTP 400: {\"message\":\"MEDICATION_NOT_FOUND\"}",
            ),
        )
        assertFalse(
            ActionSync.isAuthFailure(
                "resolve_reminder_event HTTP 400: {\"message\":\"VIRTUAL_EVENT_MUST_BE_FOR_TODAY\"}",
            ),
        )
    }

    @Test
    fun `a server error is not an auth failure`() {
        // A 500 is worth the ceiling: if it never recovers, stranding with the real
        // error attached is more honest than retrying silently forever.
        assertFalse(ActionSync.isAuthFailure("resolve_reminder_event HTTP 500: upstream"))
    }

    @Test
    fun `a network failure is not an auth failure`() {
        // Deliberately excluded: WorkManager's network constraint already handles
        // these, and treating them as unlimited would remove the ceiling from
        // genuine failures too.
        assertFalse(ActionSync.isAuthFailure("Unable to resolve host \"xyz.supabase.co\""))
        assertFalse(ActionSync.isAuthFailure("timeout"))
    }

    @Test
    fun `no error message is not an auth failure`() {
        assertFalse(ActionSync.isAuthFailure(null))
        assertFalse(ActionSync.isAuthFailure(""))
    }

    @Test
    fun `a 401 inside a medication name cannot fake an auth failure`() {
        // Medication names travel in the log line but NOT in syncError, which is
        // built only from the function name, status and response body. This pins
        // that: a drug called "HTTP 401" would still not flip the decision, because
        // the match is on the message ActionSync.post formats, and a name never
        // reaches it. If a future change starts putting names in syncError, this
        // test is the one that should start failing.
        assertFalse(ActionSync.isAuthFailure("patient took Amoxicillin 401 mg"))
    }
}
