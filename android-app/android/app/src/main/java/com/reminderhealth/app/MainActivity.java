package com.reminderhealth.app;

import android.Manifest;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import com.reminderhealth.app.schedule.Crash;
import com.reminderhealth.app.schedule.DoseNotifications;
import com.reminderhealth.app.schedule.ScheduleBridgePlugin;

public class MainActivity extends BridgeActivity {
  private static final String TAG = "MainActivity";
  private static final int REQUEST_POST_NOTIFICATIONS = 1001;

  /** Local page shown when the remote site can't load. See assets/offline.html. */
  private static final String OFFLINE_URL = "file:///android_asset/offline.html";
  /** Tapped on the offline page; intercepted below rather than actually navigated. */
  private static final String RETRY_URL = "reminderhealth://retry";

  /** The URL whose load failed, so Retry can re-attempt exactly that one. */
  private String lastFailedUrl = null;

  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(ScheduleBridgePlugin.class);
    super.onCreate(savedInstanceState);

    // Created at app start (not lazily at first alarm) so the channel exists in
    // system Settings for the user to inspect before any dose is ever due.
    // DoseNotifications also calls this defensively before notifying, because
    // AlarmReceiver can run with this Activity never having started at all
    // (proven on-device: the process was cold-started purely to fire an alarm).
    DoseNotifications.ensureChannel(this);

    // Crash reporting. Inert unless a DSN resource is configured, and its own
    // init failure is swallowed — a reporting tool must never be the thing that
    // takes down the alarm core it exists to watch.
    Crash.INSTANCE.init(getApplicationContext());

    // Debug-only smoke test for crash reporting, fired from adb:
    //   adb shell am start -n com.reminderhealth.app/.MainActivity --ez sentry_test true
    // Kept out of release builds by BuildConfig.DEBUG. It exists because the
    // only way to trust a crash reporter is to watch one event travel the whole
    // path — SDK, scrubbing, network, dashboard — rather than assume it does.
    // FLAG_DEBUGGABLE rather than BuildConfig.DEBUG: AGP 8 no longer generates
    // BuildConfig unless the build feature is enabled, and turning that on for a
    // single boolean is not worth the build-surface change.
    boolean debuggable =
        (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    if (debuggable && getIntent() != null
        && getIntent().getBooleanExtra("sentry_test", false)) {
      Crash.INSTANCE.report(
          "sentry smoke test from MainActivity",
          0L,
          new RuntimeException("Sentry smoke test - native alarm core"));
    }

    // Android 13+ needs runtime consent to post notifications at all — without
    // it a dose alarm fires but shows nothing, which would look exactly like a
    // broken alarm. Asked here (on app open) rather than from the alarm path,
    // which must stay pure native and must never depend on the UI being up.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
        requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, REQUEST_POST_NOTIFICATIONS);
      }
    }

    installOfflineFallback();
  }

  /**
   * server.url mode means the webview loads the deployed site, so with no
   * network it paints a blank white screen. Swap in a local page instead.
   *
   * Only main-frame failures are handled: a single failed image or analytics
   * request must not replace a page that otherwise loaded fine.
   */
  private void installOfflineFallback() {
    final WebView webView = this.bridge.getWebView();
    webView.setWebViewClient(new BridgeWebViewClient(this.bridge) {
      @Override
      public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        if (RETRY_URL.equals(request.getUrl().toString())) {
          String target = lastFailedUrl != null ? lastFailedUrl : bridge.getServerUrl();
          Log.i(TAG, "offline fallback: retrying " + target);
          view.loadUrl(target);
          return true;
        }
        return super.shouldOverrideUrlLoading(view, request);
      }

      @Override
      public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        if (request.isForMainFrame()) {
          lastFailedUrl = request.getUrl().toString();
          Log.w(TAG, "main-frame load failed (" + error.getDescription() + ") for " + lastFailedUrl
              + " -> showing offline fallback");
          view.loadUrl(OFFLINE_URL);
          return;
        }
        super.onReceivedError(view, request, error);
      }
    });
  }
}
