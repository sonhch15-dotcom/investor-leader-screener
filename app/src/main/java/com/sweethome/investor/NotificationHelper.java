package com.sweethome.investor;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;

final class NotificationHelper {
    static final String CHANNEL_ID = "strategy_events";
    static final String ACTION_MARKET_ALARM = "com.sweethome.investor.MARKET_ALARM";
    static final String EXTRA_KIND = "kind";
    static final String KIND_KOREA = "korea_open";
    static final String KIND_ETF = "etf_open";
    static final String KIND_US = "us_open";
    private static final int REQUEST_NOTIFY = 7301;
    private static final int REQUEST_KOREA = 7311;
    private static final int REQUEST_ETF = 7312;
    private static final int REQUEST_US = 7313;
    private static final ZoneId KOREA_ZONE = ZoneId.of("Asia/Seoul");
    private static final ZoneId NEW_YORK_ZONE = ZoneId.of("America/New_York");

    private NotificationHelper() {
    }

    static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "전략 알림",
                NotificationManager.IMPORTANCE_DEFAULT
        );
        channel.setDescription("월간 추천, 매도 시점, 리밸런싱, 기록 누락 알림");
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.createNotificationChannel(channel);
        }
    }

    static String scheduleMarketReminders(Context context) {
        ensureChannel(context);
        long koreaAt = scheduleMarketReminder(context, KIND_KOREA);
        long etfAt = scheduleMarketReminder(context, KIND_ETF);
        long usAt = scheduleMarketReminder(context, KIND_US);
        return "다음 알림 · 한국 " + formatAlarm(koreaAt)
                + " · ETF " + formatAlarm(etfAt)
                + " · 미국 " + formatAlarm(usAt);
    }

    static long scheduleMarketReminder(Context context, String kind) {
        long triggerAt = nextTriggerAt(kind);
        Intent intent = new Intent(context, StrategyNotificationReceiver.class);
        intent.setAction(ACTION_MARKET_ALARM);
        intent.putExtra(EXTRA_KIND, kind);
        intent.putExtra("title", titleFor(kind));
        PendingIntent pendingIntent = PendingIntent.getBroadcast(
                context,
                requestCodeFor(kind),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager != null) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent);
            } else {
                alarmManager.set(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent);
            }
        }
        return triggerAt;
    }

    static String nextMarketReminderSummary() {
        return "한국 " + formatAlarm(nextTriggerAt(KIND_KOREA))
                + " · ETF " + formatAlarm(nextTriggerAt(KIND_ETF))
                + " · 미국 " + formatAlarm(nextTriggerAt(KIND_US));
    }

    static void showNow(Context context, String title, String body) {
        ensureChannel(context);
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) {
            return;
        }
        manager.notify(REQUEST_NOTIFY, build(context, title, body));
    }

    static void scheduleInOneMinute(Context context) {
        Intent intent = new Intent(context, StrategyNotificationReceiver.class);
        intent.putExtra("title", "전략 점검 시간");
        intent.putExtra("body", "오늘의 매수, 매도, 리밸런싱 항목을 확인하세요.");
        PendingIntent pendingIntent = PendingIntent.getBroadcast(
                context,
                REQUEST_NOTIFY,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager != null) {
            alarmManager.set(AlarmManager.RTC_WAKEUP, System.currentTimeMillis() + 60_000L, pendingIntent);
        }
    }

    static String marketBody(Context context, String kind) {
        SignalRepository repository = SignalRepository.load(context);
        LedgerStore ledger = new LedgerStore(context);
        if (ledger.entryCount() == 0 && ledger.totalValueKrw(repository) == 0) {
            return "계좌 현금 입력이 필요합니다. 앱을 열어 3계좌 운용 자금을 먼저 기록하세요.";
        }
        String accountId = accountIdForKind(kind);
        int buyCount = matchingBuySignals(repository, ledger, accountId);
        int sellCount = matchingBrokenTrendCount(repository, ledger, accountId);
        int lotSellCount = matchingDueLotCount(ledger, accountId);
        String data = repository.hasReliableTradingData() ? "데이터 정상" : "데이터 확인 필요: " + repository.dataReliabilityMessage();
        if (KIND_ETF.equals(kind)) {
            int rebalanceCount = matchingRebalanceSignals(repository, ledger, accountId);
            return "리밸런싱 " + rebalanceCount + "건 · 매도 검토 " + sellCount + "건 · " + data;
        }
        return "신규 매수 " + buyCount + "건 · lot 매도 " + lotSellCount + "건 · 주봉 매도 " + sellCount + "건 · " + data;
    }

    static Notification build(Context context, String title, String body) {
        Intent openIntent = new Intent(context, MainActivity.class);
        PendingIntent contentIntent = PendingIntent.getActivity(
                context,
                0,
                openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(context, CHANNEL_ID)
                : new Notification.Builder(context);
        return builder
                .setSmallIcon(R.drawable.ic_stat_signal)
                .setContentTitle(title)
                .setContentText(body)
                .setContentIntent(contentIntent)
                .setAutoCancel(true)
                .build();
    }

    private static long nextTriggerAt(String kind) {
        if (KIND_US.equals(kind)) {
            return nextUsReminderAt();
        }
        LocalTime time = KIND_ETF.equals(kind) ? LocalTime.of(9, 5) : LocalTime.of(8, 55);
        return nextKoreaTradingDayAt(time);
    }

    private static long nextKoreaTradingDayAt(LocalTime time) {
        ZonedDateTime now = ZonedDateTime.now(KOREA_ZONE);
        for (int offset = 0; offset < 370; offset++) {
            LocalDate date = now.toLocalDate().plusDays(offset);
            ZonedDateTime candidate = ZonedDateTime.of(date, time, KOREA_ZONE);
            if (MarketCalendar.isKoreaTradingDay(date) && candidate.toInstant().isAfter(now.toInstant())) {
                return candidate.toInstant().toEpochMilli();
            }
        }
        return now.plusDays(1).toInstant().toEpochMilli();
    }

    private static long nextUsReminderAt() {
        ZonedDateTime nowEastern = ZonedDateTime.now(NEW_YORK_ZONE);
        Instant now = Instant.now();
        for (int offset = 0; offset < 370; offset++) {
            LocalDate easternDate = nowEastern.toLocalDate().plusDays(offset);
            ZonedDateTime candidateEastern = ZonedDateTime.of(easternDate, LocalTime.of(9, 20), NEW_YORK_ZONE);
            if (MarketCalendar.isUsTradingDay(easternDate) && candidateEastern.toInstant().isAfter(now)) {
                return candidateEastern.toInstant().toEpochMilli();
            }
        }
        return now.plusSeconds(24 * 60 * 60).toEpochMilli();
    }

    private static int requestCodeFor(String kind) {
        if (KIND_ETF.equals(kind)) {
            return REQUEST_ETF;
        }
        if (KIND_US.equals(kind)) {
            return REQUEST_US;
        }
        return REQUEST_KOREA;
    }

    private static String titleFor(String kind) {
        if (KIND_ETF.equals(kind)) {
            return "연금 ETF 리밸런싱 점검";
        }
        if (KIND_US.equals(kind)) {
            return "미국 주식 운용 점검";
        }
        return "한국 주식 운용 점검";
    }

    private static String formatAlarm(long triggerAt) {
        ZonedDateTime time = Instant.ofEpochMilli(triggerAt).atZone(KOREA_ZONE);
        return String.format("%02d/%02d %02d:%02d", time.getMonthValue(), time.getDayOfMonth(), time.getHour(), time.getMinute());
    }

    private static String accountIdForKind(String kind) {
        if (KIND_US.equals(kind)) {
            return LedgerStore.ACCOUNT_US;
        }
        if (KIND_ETF.equals(kind)) {
            return LedgerStore.ACCOUNT_PENSION;
        }
        return LedgerStore.ACCOUNT_KR;
    }

    private static int matchingBuySignals(SignalRepository repository, LedgerStore ledger, String accountId) {
        int count = 0;
        for (StrategySignal signal : repository.signals) {
            if ("buy".equals(signal.actionType)
                    && accountId.equals(ledger.defaultAccountIdForMarket(signal.market))
                    && selectedStrategyKey(ledger, accountId).equals(signal.strategyKey)
                    && !hasCurrentSignalLot(ledger, accountId, signal)) {
                count++;
            }
        }
        return count;
    }

    private static int matchingRebalanceSignals(SignalRepository repository, LedgerStore ledger, String accountId) {
        int count = 0;
        for (StrategySignal signal : repository.signals) {
            if ("rebalance".equals(signal.actionType)
                    && accountId.equals(ledger.defaultAccountIdForMarket(signal.market))
                    && selectedStrategyKey(ledger, accountId).equals(signal.strategyKey)) {
                count++;
            }
        }
        return count;
    }

    private static int matchingBrokenTrendCount(SignalRepository repository, LedgerStore ledger, String accountId) {
        int count = 0;
        for (WeeklyTrend trend : repository.trends.values()) {
            if (repository.isTrendBrokenNow(trend)
                    && accountId.equals(accountIdForTrend(trend))) {
                for (HoldingLot lot : ledger.lots(accountId, trend.symbol)) {
                    if (lot.weeklyBreakDueQuantity(true) > 0.000001) {
                        count++;
                    }
                }
            }
        }
        return count;
    }

    private static boolean hasCurrentSignalLot(LedgerStore ledger, String accountId, StrategySignal signal) {
        for (HoldingLot lot : ledger.lots(accountId, signal.symbol)) {
            if (lot.remainingQuantity <= 0.000001) {
                continue;
            }
            if (lot.signalId != null && !lot.signalId.trim().isEmpty()) {
                if (signal.signalId.equals(lot.signalId)) {
                    return true;
                }
                continue;
            }
            if (lot.strategyKey != null && !lot.strategyKey.trim().isEmpty() && !signal.strategyKey.equals(lot.strategyKey)) {
                continue;
            }
            if (isInSignalWindow(lot.openedDate, signal.validFrom, signal.validUntil)) {
                return true;
            }
        }
        return false;
    }

    private static boolean isInSignalWindow(String date, String validFrom, String validUntil) {
        String safeDate = date == null ? "" : date;
        if (safeDate.isEmpty()) {
            return false;
        }
        if (validFrom != null && !validFrom.isEmpty() && safeDate.compareTo(validFrom) < 0) {
            return false;
        }
        return validUntil == null || validUntil.isEmpty() || safeDate.compareTo(validUntil) <= 0;
    }

    private static int matchingDueLotCount(LedgerStore ledger, String accountId) {
        if (LedgerStore.ACCOUNT_PENSION.equals(accountId)) {
            return 0;
        }
        LotSummary summary = ledger.lotSummary(accountId);
        return summary.sixMonthDue + summary.twelveMonthDue;
    }

    private static String accountIdForTrend(WeeklyTrend trend) {
        if ("US_STOCK".equals(trend.market)) {
            return LedgerStore.ACCOUNT_US;
        }
        if ("KR_ETF".equals(trend.market)) {
            return LedgerStore.ACCOUNT_PENSION;
        }
        return LedgerStore.ACCOUNT_KR;
    }

    private static String selectedStrategyKey(LedgerStore ledger, String accountId) {
        return ledger.selectedStrategyKey(accountId, defaultStrategyKey(accountId));
    }

    private static String defaultStrategyKey(String accountId) {
        if (LedgerStore.ACCOUNT_US.equals(accountId)) {
            return StrategyMath.STRATEGY_US_CAP_27_5;
        }
        if (LedgerStore.ACCOUNT_PENSION.equals(accountId)) {
            return StrategyMath.STRATEGY_KR_ETF_BENCHMARK_OR_ALPHA_DEFENSIVE;
        }
        return "kr_stock_leader2";
    }
}
