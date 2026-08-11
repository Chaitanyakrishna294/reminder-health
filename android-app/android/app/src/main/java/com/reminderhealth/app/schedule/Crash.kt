package com.reminderhealth.app.schedule

import android.content.Context
import android.util.Log
import io.sentry.Sentry
import io.sentry.SentryLevel
import io.sentry.android.core.SentryAndroid

/**
 * Crash and error reporting for the **native alarm core** — the part that has to
 * keep working when the webview does not, and whose failures are otherwise
 * invisible.
 *
 * This is the half of observability that matters most here. A webview error
 * produces a user staring at a broken page, who can tell you about it. An alarm
 * that silently fails to re-register produces nothing at all: no screen, no
 * complaint, just a dose quietly missed at 3am and a patient who assumes the app
 * is fine. The server-side escalation ladder covers the patient; this covers the
 * developer.
 *
 * **PHI discipline, same as the web side.** Drug names, dose times and telegram
 * ids never go into an event. Breadcrumbs are off, `isSendDefaultPii` is false,
 * and the reporting helpers below take a medication ID rather than a name — an
 * opaque number is enough to find the row, and enough to correlate two reports,
 * without shipping "Telmikind, 08:30" to a third party.
 *
 * Inert without a DSN, so the app behaves and costs exactly as before until
 * someone opts in.
 */
object Crash {
    /**
     * Read from the manifest at build time (`sentry.dsn` resource). Absent by
     * default: no DSN, no init, every call below a no-op.
     */
    private const val DSN_RESOURCE = "sentry_dsn"

    @Volatile
    private var initialised = false

    fun init(context: Context) {
        if (initialised) return
        initialised = true

        val dsn = runCatching {
            val id = context.resources.getIdentifier(DSN_RESOURCE, "string", context.packageName)
            if (id == 0) null else context.getString(id).takeIf { it.isNotBlank() }
        }.getOrNull()

        if (dsn == null) {
            Log.i(AlarmScheduler.TAG, "Sentry not configured (no $DSN_RESOURCE); crash reporting is off")
            return
        }

        runCatching {
            SentryAndroid.init(context) { options ->
                options.dsn = dsn
                // Explicit rather than trusting a default to stay put: this flag
                // controls whether device/user identifiers ride along.
                options.isEnableUserInteractionTracing = false
                options.isSendDefaultPii = false
                // Belt and braces. The NDK artifact is already excluded at the
                // Gradle level (app/build.gradle uses sentry-android-core), which
                // is the fix that actually holds — but if someone ever swaps the
                // dependency back to the `sentry-android` bundle, these keep the
                // native layer off rather than silently re-arming a crash that
                // killed this app twice in three minutes on a real device.
                options.isEnableNdk = false
                options.isEnableScopeSync = false
                // Breadcrumbs would capture activity lifecycle and, worse, our own
                // logcat lines — which DO contain drug names (AlarmScheduler logs
                // them deliberately, for on-device debugging).
                options.isEnableAutoSessionTracking = false
                options.maxBreadcrumbs = 0
                // Errors only. Tracing multiplies event volume and this project
                // runs on free tiers.
                options.tracesSampleRate = 0.0
                options.beforeSend = io.sentry.SentryOptions.BeforeSendCallback { event, _ ->
                    // Last gate. The message itself can still carry whatever the
                    // thrower put in it — the real defence is not putting patient
                    // data in exception messages, which the helpers below enforce
                    // by taking ids rather than names.
                    event.user = null
                    event.setTag("component", "alarm-core")
                    event
                }
            }
            Log.i(AlarmScheduler.TAG, "Sentry initialised for the native alarm core")
        }.onFailure {
            // Crash reporting failing to start must never take the alarm core
            // with it. That would be the reporting tool causing the outage it
            // exists to reveal.
            Log.e(AlarmScheduler.TAG, "Sentry init failed; continuing without crash reporting", it)
        }
    }

    /**
     * A caught failure worth knowing about, identified by medication ID only.
     *
     * @param what a fixed description — NOT interpolated with patient data, so
     *   events group properly and carry nothing sensitive.
     */
    fun report(what: String, medicationId: Long? = null, error: Throwable? = null) {
        Log.e(AlarmScheduler.TAG, "REPORTED: $what (med=${medicationId ?: "n/a"})", error)
        runCatching {
            Sentry.withScope { scope ->
                scope.level = SentryLevel.ERROR
                medicationId?.let { scope.setTag("medicationId", it.toString()) }
                scope.setTag("failure", what)
                if (error != null) Sentry.captureException(error) else Sentry.captureMessage(what)
            }
        }
    }
}
