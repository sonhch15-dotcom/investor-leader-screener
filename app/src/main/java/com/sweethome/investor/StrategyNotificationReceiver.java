package com.sweethome.investor;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public final class StrategyNotificationReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String kind = intent.getStringExtra(NotificationHelper.EXTRA_KIND);
        String title = intent.getStringExtra("title");
        String body = NotificationHelper.ACTION_MARKET_ALARM.equals(intent.getAction()) && kind != null && !kind.isEmpty()
                ? NotificationHelper.marketBody(context, kind)
                : intent.getStringExtra("body");
        if (title == null || title.isEmpty()) {
            title = "투자 전략 알림";
        }
        if (body == null || body.isEmpty()) {
            body = "전략 이벤트를 확인하세요.";
        }

        NotificationHelper.ensureChannel(context);
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.notify(7302, NotificationHelper.build(context, title, body));
        }
        if (NotificationHelper.ACTION_MARKET_ALARM.equals(intent.getAction()) && kind != null && !kind.isEmpty()) {
            NotificationHelper.scheduleMarketReminder(context, kind);
        }
    }
}
