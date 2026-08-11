# R8 / ProGuard rules for the release build.
#
# CLAUDE.md requires minification for release. Everything below exists because
# R8 removes or renames code that is only ever reached by REFLECTION, which it
# cannot see. The failure mode is not a build error — it is a release APK that
# installs fine and then silently loses a feature, which for this app means
# reminders that stop working only in the version real users get.
#
# Each rule says what breaks without it, so nobody deletes one to "clean up".

# ---------------------------------------------------------------------------
# Capacitor bridge
# ---------------------------------------------------------------------------
# Plugin classes and their @PluginMethod functions are resolved BY NAME at
# runtime from JavaScript. Renamed or stripped, every native call from the
# webview fails: no syncSchedule, so no alarms are ever registered on a fresh
# install, and no clearSchedule, so a signed-out account keeps ringing.
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keepclassmembers class * extends com.getcapacitor.Plugin {
    @com.getcapacitor.PluginMethod <methods>;
}
-keep class com.reminderhealth.app.schedule.ScheduleBridgePlugin { *; }

# Cordova plugins bridged through Capacitor, same name-based resolution.
-keep class org.apache.cordova.** { *; }

# ---------------------------------------------------------------------------
# Room + the local schedule store
# ---------------------------------------------------------------------------
# Entities are mapped column-to-field by generated code that references field
# names. Losing these means the encrypted store cannot be read back — and the
# store is what the boot receiver rebuilds alarms from.
-keep class com.reminderhealth.app.schedule.Medication { *; }
-keep class com.reminderhealth.app.schedule.DoseAction { *; }
-keep class com.reminderhealth.app.schedule.PendingSnooze { *; }
-keep class * extends androidx.room.RoomDatabase { *; }
-dontwarn androidx.room.paging.**

# ---------------------------------------------------------------------------
# SQLCipher (encryption at rest)
# ---------------------------------------------------------------------------
# JNI: the native library looks these classes and methods up by name. Break them
# and schedule.db cannot be opened, which sends the app down the
# "unreadable store" recovery path and wipes the local schedule.
-keep class net.zetetic.database.** { *; }
-keep class net.sqlcipher.** { *; }
-dontwarn net.zetetic.**

# ---------------------------------------------------------------------------
# Alarm core entry points
# ---------------------------------------------------------------------------
# Receivers and activities are instantiated by the SYSTEM from the manifest name.
# The manifest is not renamed, so a renamed class means Android cannot find it —
# the alarm silently never fires, and BOOT_COMPLETED never re-registers anything.
# (AGP keeps manifest-referenced classes automatically; stated explicitly because
# this is the one thing in the app that must not break quietly.)
-keep class com.reminderhealth.app.MainActivity { *; }
-keep class com.reminderhealth.app.schedule.AlarmReceiver { *; }
-keep class com.reminderhealth.app.schedule.BootReceiver { *; }
-keep class com.reminderhealth.app.schedule.DoseActionReceiver { *; }
-keep class com.reminderhealth.app.schedule.AlarmActivity { *; }
-keep class * extends androidx.work.Worker
-keep class * extends androidx.work.CoroutineWorker

# ---------------------------------------------------------------------------
# Sentry
# ---------------------------------------------------------------------------
# Ships its own consumer rules; these only silence warnings for the optional
# integrations we do not include (notably the NDK layer, removed after it killed
# the app with SIGBUS — see variables.gradle).
-dontwarn io.sentry.android.ndk.**
-keep class io.sentry.** { *; }

# ---------------------------------------------------------------------------
# Tink (via androidx.security-crypto -> EncryptedSharedPreferences)
# ---------------------------------------------------------------------------
# Tink is what protects the session tokens and the SQLCipher passphrase. It
# references build-time-only annotations (errorprone, JSR-305) that are not on
# the runtime classpath, and R8 treats those dangling references as errors rather
# than warnings — the first assembleRelease failed on exactly this.
#
# -dontwarn, NOT -keep: these annotations genuinely do not exist at runtime and
# nothing needs them there. Suppressing the warning is correct; keeping them
# would be keeping nothing.
-dontwarn com.google.errorprone.annotations.**
-dontwarn javax.annotation.**
-keep class com.google.crypto.tink.** { *; }

# Tink also ships optional cloud-KMS backends (Google Cloud KMS, AWS KMS) whose
# HTTP-client and Joda-Time dependencies are not bundled. This app uses Tink ONLY
# through EncryptedSharedPreferences with an Android Keystore master key, so those
# code paths are unreachable — the classes are genuinely absent and are meant to
# be. -dontwarn, not -keep: there is nothing to keep.
-dontwarn com.google.api.client.http.**
-dontwarn org.joda.time.**

# ---------------------------------------------------------------------------
# Kotlin / coroutines
# ---------------------------------------------------------------------------
-dontwarn kotlinx.coroutines.**
-keepclassmembers class kotlin.Metadata { *; }

# Keep line numbers so a minified stack trace in Sentry can still be read
# without a mapping file, and hide the original source file name.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
