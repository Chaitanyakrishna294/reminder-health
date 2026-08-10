package com.reminderhealth.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.reminderhealth.app.schedule.ScheduleBridgePlugin;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(ScheduleBridgePlugin.class);
    super.onCreate(savedInstanceState);
  }
}
