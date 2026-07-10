package com.sweethome.investor;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public final class BootScheduleReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())
                || "android.intent.action.MY_PACKAGE_REPLACED".equals(intent.getAction())) {
            NotificationHelper.scheduleMarketReminders(context);
        }
    }
}
