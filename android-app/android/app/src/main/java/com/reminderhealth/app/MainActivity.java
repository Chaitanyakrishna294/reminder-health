package com.reminderhealth.app;

import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(PingPlugin.class);
    super.onCreate(savedInstanceState);

    // M1 bridge proof only (see android-app/README.md): once the deployed
    // page finishes loading, call the trivial Ping plugin from native code
    // and log the round trip — no change to web/ needed for this. Delete
    // this override once M1 is verified, or once real M2 plugins make it
    // redundant.
    this.bridge.getWebView().setWebViewClient(new BridgeWebViewClient(this.bridge) {
      @Override
      public void onPageFinished(WebView view, String url) {
        super.onPageFinished(view, url);
        view.evaluateJavascript(
          "window.Capacitor.Plugins.Ping.ping({ value: 'hello from webview' })"
            + ".then(function(r) { console.log('[Ping] native replied:', r.value); })"
            + ".catch(function(e) { console.error('[Ping] failed:', e); });",
          null
        );
      }
    });
  }
}
