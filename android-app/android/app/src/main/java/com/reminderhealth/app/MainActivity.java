package com.reminderhealth.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.reminderhealth.app.schedule.ScheduleBridgePlugin;

public class MainActivity extends BridgeActivity {
  private static final int REQUEST_POST_NOTIFICATIONS = 1001;

  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(ScheduleBridgePlugin.class);
    super.onCreate(savedInstanceState);

    // Android 13+ needs runtime consent to post notifications at all — without
    // it a dose alarm fires but shows nothing, which would look exactly like a
    // broken alarm. Asked here (on app open) rather than from the alarm path,
    // which must stay pure native and must never depend on the UI being up.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
        requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, REQUEST_POST_NOTIFICATIONS);
      }
    }
  }
}
