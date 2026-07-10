package com.sweethome.investor;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipDescription;
import android.content.ClipboardManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PersistableBundle;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.text.NumberFormat;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

public final class MainActivity extends Activity {
    private static final long AUTO_SYNC_MIN_INTERVAL_MS = 15 * 60 * 1000L;
    private static final long CLIPBOARD_BACKUP_CLEAR_MS = 60_000L;
    private static final String BACKUP_CLIP_LABEL = "Investor Run ledger backup";
    private static final int REQUEST_EXPORT_BACKUP = 4101;
    private static final int REQUEST_IMPORT_BACKUP = 4102;

    private SignalRepository repository;
    private LedgerStore ledger;
    private LinearLayout content;
    private LinearLayout nav;
    private String selectedTab = "today";
    private String selectedOpsAccount = LedgerStore.ACCOUNT_US;
    private String selectedAccountTab = "all";
    private String selectedAssetRange = "day";
    private String selectedRecordFilter = "all";
    private boolean valuesHidden = false;
    private boolean recordTimelineExpanded = false;
    private boolean syncing = false;
    private long lastAutoSyncAttemptAt = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        repository = SignalRepository.load(this);
        ledger = new LedgerStore(this);
        NotificationHelper.ensureChannel(this);
        requestNotificationPermission();
        scheduleStrategyReminders();
        getWindow().setStatusBarColor(Ui.BG);
        getWindow().setNavigationBarColor(Ui.BG);
        buildShell();
        showToday();
        maybeAutoSyncRemoteSignals(true);
    }

    @Override
    protected void onResume() {
        super.onResume();
        maybeAutoSyncRemoteSignals(false);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (resultCode != RESULT_OK || data == null || data.getData() == null) {
            return;
        }
        Uri uri = data.getData();
        if (requestCode == REQUEST_EXPORT_BACKUP) {
            writeLedgerBackupToUri(uri);
        } else if (requestCode == REQUEST_IMPORT_BACKUP) {
            readLedgerBackupFromUri(uri);
        }
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 2001);
        }
    }

    private void buildShell() {
        LinearLayout shell = Ui.vertical(this);
        shell.setBackgroundColor(Ui.BG);

        ScrollView scrollView = new ScrollView(this);
        scrollView.setFillViewport(false);
        content = Ui.vertical(this);
        content.setPadding(0, Ui.dp(this, 8), 0, Ui.dp(this, 14));
        scrollView.addView(content, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        ));
        shell.addView(scrollView, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1
        ));

        nav = Ui.horizontal(this);
        nav.setGravity(Gravity.CENTER);
        nav.setPadding(Ui.dp(this, 8), Ui.dp(this, 8), Ui.dp(this, 8), Ui.dp(this, 8));
        nav.setBackgroundColor(Color.WHITE);
        shell.addView(nav, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                Ui.dp(this, 74)
        ));
        shell.setOnApplyWindowInsetsListener((view, insets) -> {
            int bottomInset = insets.getSystemWindowInsetBottom();
            nav.setPadding(Ui.dp(this, 8), Ui.dp(this, 8), Ui.dp(this, 8), Ui.dp(this, 8) + bottomInset);
            ViewGroup.LayoutParams params = nav.getLayoutParams();
            params.height = Ui.dp(this, 74) + bottomInset;
            nav.setLayoutParams(params);
            content.setPadding(0, Ui.dp(this, 8), 0, Ui.dp(this, 14));
            return insets;
        });
        setContentView(shell);
        shell.requestApplyInsets();
    }

    private void renderBase(String tab, String title, String subtitle) {
        selectedTab = tab;
        content.removeAllViews();
        LinearLayout header = Ui.horizontal(this);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(Ui.dp(this, 16), Ui.dp(this, 8), Ui.dp(this, 16), Ui.dp(this, 6));

        LinearLayout titleBox = Ui.vertical(this);
        TextView titleView = Ui.text(this, title, 25, Ui.TEXT, Typeface.BOLD);
        titleBox.addView(titleView);
        if (subtitle != null && !subtitle.isEmpty()) {
            titleBox.addView(Ui.text(this, subtitle, 13, Ui.MUTED, Typeface.NORMAL));
        }
        header.addView(titleBox, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));

        Button hideButton = Ui.button(this, valuesHidden ? "표시" : "숨김", Ui.PRIMARY, false);
        hideButton.setOnClickListener(view -> {
            valuesHidden = !valuesHidden;
            rerender();
        });
        header.addView(hideButton);
        content.addView(header);
        buildNav();
    }

    private void buildNav() {
        nav.removeAllViews();
        addNavItem("today", "오늘");
        addNavItem("accounts", "계좌");
        addNavItem("ops", "운용");
        addNavItem("assets", "자산");
        addNavItem("record", "기록");
    }

    private void addNavItem(String key, String label) {
        TextView item = Ui.text(this, label, 13, key.equals(selectedTab) ? Ui.PRIMARY : Ui.MUTED, Typeface.BOLD);
        item.setGravity(Gravity.CENTER);
        item.setPadding(0, Ui.dp(this, 8), 0, Ui.dp(this, 8));
        item.setBackground(roundedBackground(key.equals(selectedTab) ? Ui.withAlpha(Ui.PRIMARY, 16) : Color.TRANSPARENT, Ui.dp(this, 8)));
        item.setOnClickListener(view -> {
            if ("today".equals(key)) {
                showToday();
            } else if ("accounts".equals(key)) {
                showAccounts();
            } else if ("ops".equals(key)) {
                showOperations();
            } else if ("assets".equals(key)) {
                showAssets();
            } else {
                showRecord();
            }
        });
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1);
        params.setMargins(Ui.dp(this, 3), 0, Ui.dp(this, 3), 0);
        nav.addView(item, params);
    }

    private void rerender() {
        if ("accounts".equals(selectedTab)) {
            showAccounts();
        } else if ("ops".equals(selectedTab)) {
            showOperations();
        } else if ("assets".equals(selectedTab)) {
            showAssets();
        } else if ("record".equals(selectedTab)) {
            showRecord();
        } else {
            showToday();
        }
    }

    private void showToday() {
        renderBase("today", "오늘의 운용", "계좌별 전략 신호를 실제 주문과 기록으로 연결합니다");
        maybeAutoSyncRemoteSignals(false);
        addDataStatus();
        addTotalHero();
        addMarketQueue();
        addSectionTitle("오늘 할 일");

        List<ActionItem> actions = buildActions();
        if (actions.isEmpty()) {
            LinearLayout card = Ui.card(this);
            card.addView(Ui.text(this, "전략 유지 중입니다.", 17, Ui.TEXT, Typeface.BOLD));
            card.addView(Ui.text(this, "매수한 lot은 6개월 보유 구간에서는 조용히 관리합니다. 신규 매수, ETF 리밸런싱, 6개월/주봉/12개월 매도 조건이 생기면 이곳에 표시됩니다.", 14, Ui.MUTED, Typeface.NORMAL));
            content.addView(card);
        } else {
            for (ActionItem action : actions) {
                addActionCard(action);
            }
        }
    }

    private void addDataStatus() {
        boolean dataOk = todayDataHealthy();
        int color = dataOk ? Ui.SUCCESS : Ui.WARNING;
        LinearLayout card = Ui.card(this);
        LinearLayout row = Ui.horizontal(this);
        row.addView(Ui.pill(this, dataOk ? "데이터 양호" : "데이터 확인 필요", color));
        TextView summary = Ui.text(this, actionableQuoteHealthText(), 13, Ui.MUTED, Typeface.BOLD);
        summary.setGravity(Gravity.END);
        row.addView(summary, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        card.addView(row);
        if (dataOk) {
            card.addView(Ui.text(this, "주문 가이드에 필요한 신호, 시세, 환율이 준비되어 있습니다.", 14, Ui.MUTED, Typeface.NORMAL));
        } else {
            String issues = actionableQuoteIssueText();
            card.addView(Ui.text(this, issues.isEmpty()
                            ? "주문 전 데이터 동기화가 필요합니다. 세부 상태는 기록 탭에서 확인하세요."
                            : "주문 전 확인할 항목: " + issues,
                    14,
                    Ui.WARNING,
                    Typeface.BOLD));
            Button detail = Ui.button(this, "기록 탭에서 확인", Ui.WARNING, false);
            detail.setOnClickListener(view -> showRecord());
            card.addView(detail);
        }
        content.addView(card);
    }

    private void addTotalHero() {
        PnlSummary pnl = ledger.pnlSummary(repository);
        LinearLayout card = Ui.card(this);
        card.addView(Ui.text(this, "총자산", 14, Ui.MUTED, Typeface.BOLD));
        card.addView(Ui.mono(this, formatKrw(ledger.totalValueKrw(repository)), 31, Ui.TEXT, Typeface.BOLD));
        card.addView(Ui.text(this, "USD/KRW " + formatPlain(repository.usdKrw) + " · 현금 " + formatKrw(ledger.cashValueKrw(repository)), 13, Ui.MUTED, Typeface.NORMAL));
        card.addView(Ui.spacer(this, 10));
        addAllocationBar(card,
                ledger.holdingValueKrw(repository),
                ledger.cashValueKrw(repository),
                Ui.PRIMARY,
                Ui.WARNING);
        addMetric(card, "투자 중 자산", formatKrw(ledger.holdingValueKrw(repository)));
        addMetric(card, "투자 손익", formatSignedMoney(pnl.investmentPnlKrw, "KRW"));
        addMetric(card, "실현손익", formatSignedMoney(pnl.realizedKrw, "KRW"));
        addMetric(card, "미실현손익", formatSignedMoney(pnl.unrealizedKrw, "KRW"));
        addMetric(card, "보유 종목", ledger.openHoldingCount() + "개");
        content.addView(card);
    }

    private void addMarketQueue() {
        LinearLayout card = Ui.card(this);
        card.addView(Ui.text(this, "시장 시간 순서", 17, Ui.TEXT, Typeface.BOLD));
        addQueueRow(card, "1", "한국장", "한국 주식 계좌 신규 매수와 보유 점검", Ui.ACCENT_KR);
        addQueueRow(card, "2", "연금 ETF", "월간 목표 비중과 리밸런싱 검증", Ui.ACCENT_PENSION);
        addQueueRow(card, "3", "미국장", "미국 주식 계좌 매수와 lot 기록", Ui.ACCENT_US);
        content.addView(card);
    }

    private void addQueueRow(LinearLayout parent, String number, String title, String body, int color) {
        LinearLayout row = Ui.horizontal(this);
        row.setPadding(0, Ui.dp(this, 7), 0, Ui.dp(this, 7));
        TextView badge = Ui.pill(this, number, color);
        row.addView(badge);
        LinearLayout copy = Ui.vertical(this);
        copy.setPadding(Ui.dp(this, 10), 0, 0, 0);
        copy.addView(Ui.text(this, title, 14, Ui.TEXT, Typeface.BOLD));
        copy.addView(Ui.text(this, body, 13, Ui.MUTED, Typeface.NORMAL));
        row.addView(copy, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        parent.addView(row);
    }

    private void addActionCard(ActionItem action) {
        LinearLayout card = Ui.card(this);
        LinearLayout top = Ui.horizontal(this);
        top.addView(Ui.pill(this, action.accountName, action.color));
        TextView title = Ui.text(this, action.title, 17, Ui.TEXT, Typeface.BOLD);
        title.setPadding(Ui.dp(this, 8), 0, 0, 0);
        top.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        card.addView(top);
        card.addView(Ui.text(this, action.body, 14, Ui.MUTED, Typeface.NORMAL));
        if (!action.detail.isEmpty()) {
            card.addView(Ui.text(this, action.detail, 13, action.color, Typeface.BOLD));
        }
        LinearLayout buttons = Ui.horizontal(this);
        buttons.setPadding(0, Ui.dp(this, 12), 0, 0);
        Button primary = Ui.button(this, action.primaryLabel, action.color, true);
        primary.setOnClickListener(view -> action.runPrimary());
        buttons.addView(primary, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        Button later = Ui.button(this, "오늘 보류", Ui.MUTED, false);
        later.setOnClickListener(view -> {
            ledger.snoozeAction(action.actionKey);
            Toast.makeText(this, "오늘 Action Inbox에서 숨겼습니다.", Toast.LENGTH_SHORT).show();
            showToday();
        });
        LinearLayout.LayoutParams laterParams = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1);
        laterParams.setMargins(Ui.dp(this, 8), 0, 0, 0);
        buttons.addView(later, laterParams);
        card.addView(buttons);
        content.addView(card);
    }

    private List<ActionItem> buildActions() {
        List<ActionItem> actions = new ArrayList<>();
        if (ledger.isLedgerCorrupt()) {
            if (!ledger.isActionSnoozed("ledger-corrupt")) {
                actions.add(new ActionItem(
                        "ledger-corrupt",
                        LedgerStore.ACCOUNT_KR,
                        "장부 복구 필요",
                        "기록 저장 잠금",
                        "장부 JSON이 손상되어 새 기록을 막았습니다.",
                        ledger.ledgerSafetyMessage(),
                        "기록 열기",
                        Ui.DANGER,
                        this::showRecord
                ));
            }
            return actions;
        }
        if (ledger.entryCount() == 0 && ledger.totalValueKrw(repository) == 0) {
            if (!ledger.isActionSnoozed("setup-accounts")) {
                actions.add(new ActionItem(
                        "setup-accounts",
                        LedgerStore.ACCOUNT_US,
                        "계좌 설정 필요",
                        "3계좌 운용 시작",
                        "미국 주식, 한국 주식, 연금 ETF 계좌의 현금을 먼저 입력하세요.",
                        "계좌별 현금을 입력하면 이번 달 주문 가이드가 개인화됩니다.",
                        "계좌 설정",
                        Ui.PRIMARY,
                        this::showAccounts
                ));
            }
            return actions;
        }

        for (StrategySignal signal : repository.signals) {
            String accountId = ledger.defaultAccountIdForMarket(signal.market);
            Account account = ledger.account(accountId);
            if (!signalMatchesSelectedStrategy(signal, accountId)) {
                continue;
            }
            if ("buy".equals(signal.actionType)) {
                String actionKey = "signal-" + signal.signalId;
                if (ledger.isActionSnoozed(actionKey)) {
                    continue;
                }
                OrderPlan plan = orderPlan(signal, accountId);
                if (isBuyPlanComplete(signal, plan)) {
                    continue;
                }
                String status = validationText(signal, plan);
                boolean tradeReady = canUseTradingData(signal);
                boolean cashNeeded = needsCashInputForBuy(signal, accountId, plan);
                actions.add(new ActionItem(
                        actionKey,
                        accountId,
                        account.name,
                        signal.name + " 신규 매수",
                        strategyLabel(accountId) + " · 이번 목표 " + formatMoney(plan.targetOrderValue, signal.currency),
                        cashNeeded
                                ? status + " · " + cashNeededText(signal, accountId, plan)
                                : status + " · 추가 " + formatPlain(plan.additionalQuantity) + "주 · " + repository.quoteStatusText(signal.symbol) + " · 유효기간 " + signal.validUntil,
                        cashNeeded ? "매수 가이드" : tradeReady ? "주문 가이드" : "데이터 확인",
                        cashNeeded ? account.color : tradeReady ? account.color : Ui.WARNING,
                        cashNeeded ? () -> showOrderGuide(signal) : tradeReady ? () -> showOrderGuide(signal) : this::showRecord
                ));
            } else if ("rebalance".equals(signal.actionType)) {
                String actionKey = "rebalance-" + accountId;
                if (ledger.isActionSnoozed(actionKey)) {
                    continue;
                }
                boolean tradeReady = canUseEtfTradingData();
                if (tradeReady && !hasEtfRebalanceAction(accountId)) {
                    continue;
                }
                actions.add(new ActionItem(
                        actionKey,
                        accountId,
                        account.name,
                        "ETF 리밸런싱 점검",
                        "연금 ETF 계좌의 현재 비중을 목표 비중과 비교합니다.",
                        tradeReady ? "목표 비중 오차가 작으면 현실적 완료 처리할 수 있습니다." : "가격/환율 데이터 확인 후 체결 기록을 열 수 있습니다.",
                        tradeReady ? "리밸런싱" : "데이터 확인",
                        tradeReady ? account.color : Ui.WARNING,
                        tradeReady ? this::showEtfRebalanceGuide : this::showRecord
                ));
            }
        }

        addLotSellActions(actions);
        return actions;
    }

    private void addLotSellActions(List<ActionItem> actions) {
        for (Account account : ledger.accounts()) {
            if (LedgerStore.ACCOUNT_PENSION.equals(account.id)) {
                continue;
            }
            for (Holding holding : ledger.holdings(account.id).values()) {
                WeeklyTrend trend = repository.trends.get(holding.symbol);
                boolean trendBroken = trend != null && repository.isTrendBrokenNow(trend);
                for (HoldingLot lot : ledger.lots(account.id, holding.symbol)) {
                    LotAction lotAction = lotActionFor(lot, trendBroken);
                    if (lotAction == null) {
                        continue;
                    }
                    String actionKey = "lot-" + account.id + "-" + lot.lotId + "-" + lotAction.key;
                    if (ledger.isActionSnoozed(actionKey)) {
                        continue;
                    }
                    actions.add(new ActionItem(
                            actionKey,
                            account.id,
                            account.name,
                            holding.name + " " + lotAction.title,
                            lotAction.body,
                            "매수일 " + lot.openedDate + " · 잔여 " + formatPlain(lot.remainingQuantity) + "/" + formatPlain(lot.originalQuantity) + "주",
                            "매도 기록",
                            lotAction.color,
                            () -> showManualSellDialog(account.id, holding, lotAction.quantity, lotAction.reason, lot.lotId)
                    ));
                }
            }
        }
    }

    private LotAction lotActionFor(HoldingLot lot, boolean trendBroken) {
        double twelveDue = lot.twelveMonthDueQuantity();
        if (twelveDue > 0.000001) {
            return new LotAction(
                    "twelve",
                    "12개월 전량 매도",
                    "전략 보유 기간이 12개월에 도달했습니다.",
                    "12개월 전량 매도",
                    twelveDue,
                    Ui.DANGER
            );
        }
        double sixDue = lot.sixMonthDueQuantity();
        if (sixDue > 0.000001) {
            return new LotAction(
                    "six",
                    "6개월 50% 매도",
                    "6개월 보유 조건을 채웠습니다. 원래 lot의 50% 매도 조건을 확인하세요.",
                    "6개월 50% 매도",
                    sixDue,
                    Ui.WARNING
            );
        }
        double weeklyDue = lot.weeklyBreakDueQuantity(trendBroken);
        if (weeklyDue > 0.000001) {
            return new LotAction(
                    "weekly",
                    "잔여 50% 매도 검토",
                    "6개월 50% 매도 이후 남은 수량이 주봉 훼손 조건에 걸렸습니다.",
                    "주봉 훼손 잔여 매도",
                    weeklyDue,
                    Ui.DANGER
            );
        }
        return null;
    }

    private void showAccounts() {
        renderBase("accounts", "계좌", "계좌는 분리하고 총자산은 통합해서 봅니다");
        addAccountTabs();
        if ("all".equals(selectedAccountTab)) {
            addAccountAllocationDonut("계좌별 자산 비중");
            for (Account account : ledger.accounts()) {
                addAccountCard(account, true);
            }
        } else {
            Account account = ledger.account(selectedAccountTab);
            addAccountCard(account, true);
            addCashHoldingDonut(account.id, account.name + " 구성");
            addHoldingDonut(account.id, account.name + " 보유 종목");
        }
        LinearLayout note = Ui.card(this);
        note.addView(Ui.text(this, "계좌명은 계좌 카드에서 바꿀 수 있습니다.", 16, Ui.TEXT, Typeface.BOLD));
        note.addView(Ui.text(this, "상단 미니 버튼으로 전체와 계좌별 상태를 빠르게 전환합니다.", 14, Ui.MUTED, Typeface.NORMAL));
        content.addView(note);
    }

    private void addAccountTabs() {
        LinearLayout tabs = Ui.card(this);
        LinearLayout row = Ui.horizontal(this);
        addAccountTab(row, "all", "전체");
        addAccountTab(row, LedgerStore.ACCOUNT_US, "미국");
        addAccountTab(row, LedgerStore.ACCOUNT_KR, "한국");
        addAccountTab(row, LedgerStore.ACCOUNT_PENSION, "ETF");
        tabs.addView(row);
        content.addView(tabs);
    }

    private void addAccountTab(LinearLayout row, String key, String label) {
        int color = "all".equals(key) ? Ui.PRIMARY : ledger.account(key).color;
        boolean selected = key.equals(selectedAccountTab);
        Button button = Ui.button(this, label, selected ? color : Ui.MUTED, selected);
        button.setOnClickListener(view -> {
            selectedAccountTab = key;
            showAccounts();
        });
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1);
        if (row.getChildCount() > 0) {
            params.setMargins(Ui.dp(this, 8), 0, 0, 0);
        }
        row.addView(button, params);
    }

    private void addAccountCard(Account account, boolean withActions) {
        AccountSnapshot snapshot = ledger.snapshot(account.id, repository);
        LinearLayout card = Ui.card(this);
        LinearLayout top = Ui.horizontal(this);
        top.addView(Ui.colorDot(this, account.color));
        TextView name = Ui.text(this, account.name, 18, Ui.TEXT, Typeface.BOLD);
        name.setPadding(Ui.dp(this, 9), 0, 0, 0);
        top.addView(name, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        top.addView(Ui.pill(this, account.baseCurrency, account.color));
        card.addView(top);
        card.addView(Ui.text(this, account.role, 13, Ui.MUTED, Typeface.NORMAL));
        card.addView(Ui.spacer(this, 8));
        card.addView(Ui.mono(this, formatKrw(snapshot.totalKrw), 24, Ui.TEXT, Typeface.BOLD));
        addMetric(card, "현금", formatKrw(snapshot.cashKrw));
        addMetric(card, "보유 평가", formatKrw(snapshot.holdingKrw));
        addMetric(card, "실현손익", formatSignedMoney(snapshot.realizedPnlNative, account.baseCurrency));
        addMetric(card, "미실현손익", formatSignedMoney(snapshot.unrealizedPnlNative, account.baseCurrency));
        addMetric(card, "보유 종목", snapshot.holdingCount + "개");
        if (LedgerStore.ACCOUNT_US.equals(account.id)) {
            addMetric(card, "USD 현금", formatMoney(ledger.cash(account.id, "USD"), "USD"));
            addMetric(card, "보조 KRW", formatMoney(ledger.cash(account.id, "KRW"), "KRW"));
        }
        addAllocationBar(card, snapshot.holdingKrw, snapshot.cashKrw, account.color, Ui.WARNING);
        if (withActions) {
            LinearLayout buttons = Ui.horizontal(this);
            buttons.setPadding(0, Ui.dp(this, 12), 0, 0);
            Button deposit = Ui.button(this, "입금", account.color, false);
            deposit.setOnClickListener(view -> showCashDialog(account.id, "deposit"));
            buttons.addView(deposit, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
            Button withdraw = Ui.button(this, "출금", Ui.MUTED, false);
            withdraw.setOnClickListener(view -> showCashDialog(account.id, "withdraw"));
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1);
            params.setMargins(Ui.dp(this, 8), 0, 0, 0);
            buttons.addView(withdraw, params);
            card.addView(buttons);
            Button rename = Ui.button(this, "계좌명 변경", Ui.MUTED, false);
            rename.setOnClickListener(view -> showRenameAccountDialog(account));
            card.addView(rename);
        }
        content.addView(card);
    }

    private void showOperations() {
        renderBase("ops", "운용", "미국, 한국, ETF 전략을 완전히 분리해서 관리합니다");
        maybeAutoSyncRemoteSignals(false);
        addOpsTabs();
        if (LedgerStore.ACCOUNT_KR.equals(selectedOpsAccount)) {
            addOperationSection(LedgerStore.ACCOUNT_KR, "한국 주식 운용", "KR_STOCK");
        } else if (LedgerStore.ACCOUNT_PENSION.equals(selectedOpsAccount)) {
            addOperationSection(LedgerStore.ACCOUNT_PENSION, "연금 ETF 운용", "KR_ETF");
        } else {
            addOperationSection(LedgerStore.ACCOUNT_US, "미국 주식 운용", "US_STOCK");
        }
    }

    private void addOpsTabs() {
        LinearLayout tabs = Ui.card(this);
        LinearLayout row = Ui.horizontal(this);
        addOpsTab(row, LedgerStore.ACCOUNT_US, "미국");
        addOpsTab(row, LedgerStore.ACCOUNT_KR, "한국");
        addOpsTab(row, LedgerStore.ACCOUNT_PENSION, "ETF");
        tabs.addView(row);
        content.addView(tabs);
    }

    private void addOpsTab(LinearLayout row, String accountId, String label) {
        Account account = ledger.account(accountId);
        boolean selected = accountId.equals(selectedOpsAccount);
        Button button = Ui.button(this, label, selected ? account.color : Ui.MUTED, selected);
        button.setOnClickListener(view -> {
            selectedOpsAccount = accountId;
            showOperations();
        });
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1);
        if (row.getChildCount() > 0) {
            params.setMargins(Ui.dp(this, 8), 0, 0, 0);
        }
        row.addView(button, params);
    }

    private void addOperationSection(String accountId, String title, String market) {
        Account account = ledger.account(accountId);
        addSectionTitle(title);
        LinearLayout settings = Ui.card(this);
        LinearLayout top = Ui.horizontal(this);
        top.addView(Ui.pill(this, account.name, account.color));
        TextView label = Ui.text(this, "전략 선택", 14, Ui.MUTED, Typeface.BOLD);
        label.setGravity(Gravity.END);
        top.addView(label, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        settings.addView(top);
        addMetric(settings, "현재 전략", strategyLabel(accountId));
        addMetric(settings, "기준 통화", account.baseCurrency);
        settings.addView(Ui.text(this, strategyDescription(accountId), 13, Ui.MUTED, Typeface.NORMAL));
        Button choose = Ui.button(this, "전략 바꾸기", account.color, false);
        choose.setOnClickListener(view -> showStrategyPicker(accountId));
        settings.addView(choose);
        content.addView(settings);
        if (!"KR_ETF".equals(market)) {
            addLotScheduleSummary(accountId);
        }

        boolean hasSignal = false;
        List<StrategySignal> completedSignals = new ArrayList<>();
        for (StrategySignal signal : repository.signals) {
            if (market.equals(signal.market) && signalMatchesSelectedStrategy(signal, accountId)) {
                hasSignal = true;
                if ("buy".equals(signal.actionType)) {
                    OrderPlan plan = orderPlan(signal, accountId);
                    if (isBuyPlanComplete(signal, plan)) {
                        completedSignals.add(signal);
                        continue;
                    }
                }
                addSignalPlanCard(signal);
            }
        }
        if (!completedSignals.isEmpty()) {
            addCompletedSignalSummary(account, completedSignals);
        }
        if (!hasSignal) {
            LinearLayout emptySignal = Ui.card(this);
            emptySignal.addView(Ui.text(this, "선택한 전략의 이번 달 신호가 없습니다.", 16, Ui.TEXT, Typeface.BOLD));
            emptySignal.addView(Ui.text(this, "현재 자동 추천 패키지는 active 전략 중심입니다. 연구 전략은 데이터 패키지 확장 후 추천과 비중 가이드가 연결됩니다.", 14, Ui.MUTED, Typeface.NORMAL));
            content.addView(emptySignal);
        }

        Map<String, Holding> holdings = ledger.holdings(accountId);
        if (holdings.isEmpty()) {
            LinearLayout empty = Ui.card(this);
            if ("KR_ETF".equals(market)) {
                empty.addView(Ui.text(this, "아직 보유 ETF가 없습니다.", 16, Ui.TEXT, Typeface.BOLD));
                empty.addView(Ui.text(this, "체결 기록을 남기면 월간 리밸런싱과 목표 비중 검증에 반영됩니다.", 14, Ui.MUTED, Typeface.NORMAL));
            } else {
                empty.addView(Ui.text(this, "아직 보유 lot이 없습니다.", 16, Ui.TEXT, Typeface.BOLD));
                empty.addView(Ui.text(this, "체결 기록을 남기면 이 계좌의 lot과 다음 이벤트가 표시됩니다.", 14, Ui.MUTED, Typeface.NORMAL));
            }
            content.addView(empty);
        } else {
            for (Holding holding : holdings.values()) {
                addHoldingCard(account, holding);
            }
        }
    }

    private void addCompletedSignalSummary(Account account, List<StrategySignal> completedSignals) {
        LinearLayout card = Ui.card(this);
        LinearLayout top = Ui.horizontal(this);
        top.addView(Ui.pill(this, account.name, account.color));
        TextView title = Ui.text(this, "이번 달 목표 완료", 16, Ui.TEXT, Typeface.BOLD);
        title.setPadding(Ui.dp(this, 8), 0, 0, 0);
        top.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        top.addView(Ui.pill(this, completedSignals.size() + "개", Ui.SUCCESS));
        card.addView(top);
        for (StrategySignal signal : completedSignals) {
            addCompletedSignalRow(card, account, signal);
        }
        content.addView(card);
    }

    private void addCompletedSignalRow(LinearLayout parent, Account account, StrategySignal signal) {
        OrderPlan plan = orderPlan(signal, account.id);
        double reference = repository.referencePrice(signal.symbol);
        double targetQuantity = recommendedBuyQuantity(plan.targetOrderValue, reference);
        double executedQuantity = executedOrderQuantity(signal, account.id);
        LinearLayout band = Ui.band(this);
        LinearLayout top = Ui.horizontal(this);
        top.addView(Ui.text(this, signal.symbol, 14, Ui.TEXT, Typeface.BOLD), new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        top.addView(Ui.text(this, validationText(signal, plan), 13, Ui.SUCCESS, Typeface.BOLD));
        band.addView(top);
        addMetric(band, "목표/체결", formatMoney(plan.targetOrderValue, signal.currency) + " / " + formatMoney(plan.executedOrderValue, signal.currency));
        addMetric(band, "목표 수량", "약 " + formatPlain(targetQuantity) + "주 / 보유 " + formatPlain(executedQuantity) + "주");
        band.addView(Ui.progress(this, plan.targetOrderValue == 0 ? 0 : plan.executedOrderValue / plan.targetOrderValue, account.color));
        parent.addView(band);
    }

    private void addSignalPlanCard(StrategySignal signal) {
        String accountId = ledger.defaultAccountIdForMarket(signal.market);
        Account account = ledger.account(accountId);
        LinearLayout card = Ui.card(this);
        LinearLayout top = Ui.horizontal(this);
        top.addView(Ui.pill(this, account.name, account.color));
        TextView title = Ui.text(this, signal.name + " · " + signal.symbol, 16, Ui.TEXT, Typeface.BOLD);
        title.setPadding(Ui.dp(this, 8), 0, 0, 0);
        top.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        card.addView(top);
        if ("rebalance".equals(signal.actionType)) {
            card.addView(Ui.text(this, "ETF 목표 비중을 현재 보유와 비교해 리밸런싱합니다.", 14, Ui.MUTED, Typeface.NORMAL));
            addMetric(card, "허용 괴리", formatPercent(signal.driftThreshold));
            addMetric(card, "최소 주문금액", formatMoney(signal.minTradeAmount, signal.currency));
            if (signal.requiresPensionTradabilityCheck) {
                card.addView(Ui.text(this, "주문 전 연금계좌 매수 가능 여부를 증권사에서 확인하세요.", 13, Ui.WARNING, Typeface.BOLD));
            }
            String etfAccountId = LedgerStore.ACCOUNT_PENSION;
            double total = accountValueInCurrency(etfAccountId, "KRW");
            for (EtfTarget target : repository.etfTargets) {
                addTargetRow(card, target, account.color);
                addEtfTargetActionRow(card, target, etfAccountId, total);
            }
            boolean etfReady = canUseEtfTradingData();
            Button guide = Ui.button(this, etfReady ? "리밸런싱 가이드" : "데이터 확인 필요", etfReady ? account.color : Ui.WARNING, false);
            guide.setOnClickListener(view -> {
                if (canUseEtfTradingData()) {
                    showEtfRebalanceGuide();
                } else {
                    showDataLockedDialog("ETF 리밸런싱");
                }
            });
            card.addView(guide);
        } else {
            OrderPlan plan = orderPlan(signal, accountId);
            double averageBuyPrice = ledger.averageBuyPrice(accountId, signal.symbol);
            double reference = repository.referencePrice(signal.symbol);
            boolean cashNeeded = needsCashInputForBuy(signal, accountId, plan);
            String status = validationText(signal, plan);
            addMetric(card, "목표/체결", formatMoney(plan.targetOrderValue, signal.currency) + " / " + formatMoney(plan.executedOrderValue, signal.currency));
            if (reference > 0) {
                addMetric(card, "목표 수량", "약 " + formatPlain(recommendedBuyQuantity(plan.targetOrderValue, reference)) + "주");
            }
            if (plan.remainingOrderValue > 0.000001) {
                addMetric(card, "남은 매수", formatMoney(plan.remainingOrderValue, signal.currency));
            } else {
                addMetric(card, "남은 매수", "없음");
            }
            addMetric(card, "추가 수량", plan.additionalQuantity > 0
                    ? formatPlain(plan.additionalQuantity) + "주 · 약 " + formatMoney(plan.executableOrderValue, signal.currency)
                    : "0주");
            if (averageBuyPrice > 0) {
                addMetric(card, "평단/현재가", formatMoney(averageBuyPrice, signal.currency) + " / " + formatMoney(reference, signal.currency)
                        + " · " + priceVsAverageText(reference, averageBuyPrice));
            } else {
                addMetric(card, "현재가", formatMoney(reference, signal.currency));
            }
            if (plan.capLimitValue > 0 && plan.totalInvestedValue > plan.capLimitValue * 0.9) {
                addMetric(card, "종목 한도", formatMoney(plan.totalInvestedValue, signal.currency) + " / " + formatMoney(plan.capLimitValue, signal.currency));
            }
            String quoteStatus = repository.quoteStatusText(signal.symbol);
            if (!quoteStatus.startsWith("normal")) {
                addMetric(card, "시세 확인", quoteStatus);
            }
            if (cashNeeded) {
                addMetric(card, "현금 상태", cashNeededText(signal, accountId, plan));
                card.addView(Ui.text(this, "추천 신호는 유지됩니다. 예수금을 입력하면 목표금액과 매수 수량을 다시 계산합니다.", 13, Ui.WARNING, Typeface.BOLD));
            }
            card.addView(Ui.progress(this, plan.targetOrderValue == 0 ? 0 : plan.executedOrderValue / plan.targetOrderValue, account.color));
            card.addView(Ui.text(this, status, 13, statusColor(status, account.color), Typeface.BOLD));
            String meta = conciseSignalMeta(signal, accountId);
            if (!meta.isEmpty()) {
                card.addView(Ui.text(this, meta, 12, Ui.MUTED, Typeface.NORMAL));
            }
            for (String warning : signal.warnings) {
                card.addView(Ui.text(this, "주의: " + warning, 13, Ui.WARNING, Typeface.BOLD));
            }
            if (cashNeeded) {
                Button guide = Ui.button(this, "매수 가이드", account.color, false);
                guide.setOnClickListener(view -> showOrderGuide(signal));
                card.addView(guide);
            } else if (plan.additionalQuantity > 0 || !canUseTradingData(signal)) {
                Button guide = Ui.button(this, canUseTradingData(signal) ? "주문 가이드" : "데이터 확인 필요", canUseTradingData(signal) ? account.color : Ui.WARNING, false);
                guide.setOnClickListener(view -> showOrderGuide(signal));
                card.addView(guide);
            }
        }
        content.addView(card);
    }

    private void addTargetRow(LinearLayout parent, EtfTarget target, int color) {
        LinearLayout row = Ui.horizontal(this);
        row.setPadding(0, Ui.dp(this, 5), 0, Ui.dp(this, 5));
        row.addView(Ui.text(this, target.name, 13, Ui.TEXT, Typeface.BOLD), new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        row.addView(Ui.text(this, Math.round(target.targetWeight * 100) + "%", 13, color, Typeface.BOLD));
        parent.addView(row);
    }

    private void addEtfTargetActionRow(LinearLayout parent, EtfTarget target, String accountId, double total) {
        EtfRebalancePlan plan = etfRebalancePlan(target, accountId, total);
        LinearLayout band = Ui.band(this);
        band.addView(Ui.text(this, "실행: " + plan.actionText, 13, plan.color, Typeface.BOLD));
        addMetric(band, "목표 금액", formatMoney(plan.targetAmount, target.currency));
        addMetric(band, "현재 금액", formatMoney(plan.currentValue, target.currency));
        addMetric(band, "차이", formatMoney(plan.diff, target.currency));
        addMetric(band, "권장 수량", plan.quantity > 0 ? formatPlain(plan.quantity) + "주" : "0주");
        parent.addView(band);
    }

    private void addLotScheduleSummary(String accountId) {
        LotSummary summary = ledger.lotSummary(accountId);
        if (summary.openLots == 0) {
            return;
        }
        Account account = ledger.account(accountId);
        LinearLayout card = Ui.card(this);
        card.addView(Ui.text(this, "lot 일정 요약", 16, Ui.TEXT, Typeface.BOLD));
        addMetric(card, "열린 lot", summary.openLots + "개");
        addMetric(card, "6개월 50% 매도 검토", summary.sixMonthDue + "개");
        addMetric(card, "12개월 전량 매도 검토", summary.twelveMonthDue + "개");
        card.addView(Ui.text(this, "매도는 FIFO 기준 lot 잔여 수량으로 계산합니다.", 13, Ui.MUTED, Typeface.NORMAL));
        content.addView(card);
    }

    private void addHoldingCard(Account account, Holding holding) {
        boolean averageCostValuation = ledger.usesAverageCostValuation(account.id, holding, repository);
        double reference = ledger.valuationPrice(account.id, holding, repository);
        double value = holding.quantity * reference;
        WeeklyTrend trend = repository.trends.get(holding.symbol);
        LinearLayout card = Ui.card(this);
        LinearLayout top = Ui.horizontal(this);
        top.addView(Ui.pill(this, account.name, account.color));
        TextView title = Ui.text(this, holding.name, 17, Ui.TEXT, Typeface.BOLD);
        title.setPadding(Ui.dp(this, 8), 0, 0, 0);
        top.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        if (trend != null) {
            String trendState = repository.effectiveTrendState(trend);
            if ("broken".equals(trendState)) {
                top.addView(Ui.pill(this, "매도 검토", Ui.DANGER));
            }
        }
        card.addView(top);
        card.addView(Ui.text(this, holding.symbol + " · 수량 " + formatPlain(holding.quantity), 14, Ui.MUTED, Typeface.NORMAL));
        double pnl = value - holding.cost;
        addMetric(card, "평가/손익", formatMoney(value, holding.currency) + " · " + formatSignedMoney(pnl, holding.currency));
        addMetric(card, "평단/현재가", holding.quantity == 0
                ? "-"
                : formatMoney(holding.cost / holding.quantity, holding.currency) + " / " + formatMoney(reference, holding.currency));
        if (holding.cost > 0) {
            addMetric(card, "수익률", signedPercent(pnl / holding.cost * 100));
        }
        PriceQuote quote = repository.prices.get(holding.symbol);
        if (quote != null) {
            if (averageCostValuation && quote.price > 0) {
                addMetric(card, "수신 시세", formatMoney(quote.price, holding.currency));
            }
            if (!"normal".equals(quote.status)) {
                addMetric(card, "시세 확인", quote.priceDate + " · " + quote.status);
            }
        }
        if (averageCostValuation) {
            card.addView(Ui.text(this, "체결 이후 최신 시세가 아직 없어 평균 원가로 임시 평가합니다.", 13, Ui.WARNING, Typeface.BOLD));
        }
        if (trend != null && repository.isTrendBrokenNow(trend)) {
            addMetric(card, "주봉 기준선", formatMoney(trend.weeklyTrendLine, trend.currency));
        }
        if (!"KR_ETF".equals(holding.market)) {
            addLotRows(card, account, holding, trend);
        }
        addHoldingTradeButtons(card, account, holding);
        content.addView(card);
    }

    private void addHoldingTradeButtons(LinearLayout card, Account account, Holding holding) {
        LinearLayout row = Ui.horizontal(this);
        row.setPadding(0, Ui.dp(this, 8), 0, 0);
        Button buy = Ui.button(this, "추가 매수", account.color, false);
        buy.setOnClickListener(view -> showManualBuyDialog(account.id, holding));
        row.addView(buy, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        Button sell = Ui.button(this, "매도 입력", Ui.DANGER, false);
        sell.setOnClickListener(view -> showManualSellDialog(account.id, holding));
        LinearLayout.LayoutParams sellParams = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1);
        sellParams.setMargins(Ui.dp(this, 8), 0, 0, 0);
        row.addView(sell, sellParams);
        card.addView(row);
    }

    private void addLotRows(LinearLayout card, Account account, Holding holding, WeeklyTrend trend) {
        List<HoldingLot> lots = ledger.lots(account.id, holding.symbol);
        if (lots.isEmpty()) {
            return;
        }
        boolean trendBroken = trend != null && repository.isTrendBrokenNow(trend);
        card.addView(Ui.spacer(this, 4));
        addMetric(card, "다음 일정", nextLotSummary(lots, trendBroken));
        int shown = 0;
        for (HoldingLot lot : lots) {
            double twelveDue = lot.twelveMonthDueQuantity();
            double sixDue = lot.sixMonthDueQuantity();
            double weeklyDue = lot.weeklyBreakDueQuantity(trendBroken);
            if (twelveDue > 0.000001) {
                addLotSellButton(card, account, holding, lot, twelveDue, "12개월 전량 매도");
            } else if (sixDue > 0.000001) {
                addLotSellButton(card, account, holding, lot, sixDue, "6개월 50% 매도");
            } else if (weeklyDue > 0.000001) {
                addLotSellButton(card, account, holding, lot, weeklyDue, "주봉 훼손 잔여 매도");
            }
            shown++;
            if (shown >= 4) {
                break;
            }
        }
    }

    private void addLotSellButton(LinearLayout parent, Account account, Holding holding, HoldingLot lot, double quantity, String reason) {
        Button button = Ui.button(this, reason + " · " + formatPlain(quantity) + "주", Ui.DANGER, false);
        button.setOnClickListener(view -> showManualSellDialog(account.id, holding, quantity, reason, lot.lotId));
        parent.addView(button);
    }

    private void showAssets() {
        renderBase("assets", "자산", "총자산, 계좌별 변화, 현금 비중을 확인합니다");
        maybeAutoSyncRemoteSignals(false);
        captureAssetSnapshot("asset_view");
        addTotalHero();
        addAssetTrendCard();
        addAssetChangeExplanationCard();
        addPnlTrendCard();
        addAccountAllocationDonut("총자산 계좌 비중");
        addTotalHoldingDonut();
        addSectionTitle("계좌별 자산");
        for (Account account : ledger.accounts()) {
            addAccountCard(account, false);
        }
        addSectionTitle("손익 분해");
        PnlSummary pnl = ledger.pnlSummary(repository);
        LinearLayout breakdown = Ui.card(this);
        breakdown.addView(Ui.text(this, "투자 손익 분해", 17, Ui.TEXT, Typeface.BOLD));
        breakdown.addView(Ui.text(this, "총자산 변화가 아니라 보유/매도 투자 손익만 분해합니다. 입출금과 스냅샷 기준 변화는 위 자산 변화 요약에서 확인합니다.", 14, Ui.MUTED, Typeface.NORMAL));
        breakdown.addView(Ui.spacer(this, 8));
        addMetric(breakdown, "투자 손익", formatSignedMoney(pnl.investmentPnlKrw, "KRW"));
        addMetric(breakdown, "실현손익", formatSignedMoney(pnl.realizedKrw, "KRW"));
        addMetric(breakdown, "미실현손익", formatSignedMoney(pnl.unrealizedKrw, "KRW"));
        addMetric(breakdown, "세후 배당", formatMoney(pnl.netDividendKrw, "KRW"));
        addMetric(breakdown, "세전 배당", formatMoney(pnl.grossDividendKrw, "KRW"));
        addMetric(breakdown, "배당세", formatMoney(pnl.dividendTaxKrw, "KRW"));
        addMetric(breakdown, "누적 비용", formatMoney(pnl.totalFeeKrw, "KRW"));
        addMetric(breakdown, "매수 비용", formatMoney(pnl.buyFeeKrw, "KRW"));
        addMetric(breakdown, "매도 비용", formatMoney(pnl.sellFeeKrw, "KRW"));
        addMetric(breakdown, "실현 매도", pnl.realizedSellCount + "건");
        addMetric(breakdown, "배당 기록", pnl.dividendCount + "건");
        if (pnl.untrackedSellCount > 0) {
            addMetric(breakdown, "미집계 매도", pnl.untrackedSellCount + "건");
            breakdown.addView(Ui.text(this, "0.3.7 이전 매도처럼 원가 필드가 없는 기록은 실현손익 집계에서 제외됩니다.", 13, Ui.WARNING, Typeface.BOLD));
        }
        addMetric(breakdown, "환율 기준", "USD 투자 손익은 현재 USD/KRW 기준 환산");
        addMetric(breakdown, "자산 스냅샷", "일자별 자동 갱신");
        content.addView(breakdown);
    }

    private void showRecord() {
        renderBase("record", "기록", "체결, 현금, 데이터, 백업을 관리합니다");
        LinearLayout quick = Ui.card(this);
        quick.addView(Ui.text(this, "빠른 기록", 17, Ui.TEXT, Typeface.BOLD));
        addQuickRecordButtons(quick);
        content.addView(quick);

        addLedgerAuditPanel();
        addRecordTimelinePanel();
        addDataSettings();
        addBackupPanel();
    }

    private void addRecordTimelinePanel() {
        addSectionTitle("기록 타임라인");
        List<LedgerEntry> allEntries = ledger.entries();
        List<LedgerEntry> entries = filteredLedgerEntries(allEntries);
        LinearLayout summary = Ui.card(this);
        if (allEntries.isEmpty()) {
            summary.addView(Ui.text(this, "아직 기록이 없습니다.", 17, Ui.TEXT, Typeface.BOLD));
            summary.addView(Ui.text(this, "계좌별 현금 또는 주문 체결을 기록하면 자산과 운용 화면이 갱신됩니다.", 14, Ui.MUTED, Typeface.NORMAL));
            content.addView(summary);
            return;
        }

        String title = "all".equals(selectedRecordFilter)
                ? (recordTimelineExpanded ? "기록을 펼쳐서 보는 중" : "기록 " + allEntries.size() + "건 숨김")
                : "필터: " + recordFilterLabel(selectedRecordFilter) + " " + entries.size() + "건";
        summary.addView(Ui.text(this, title, 17, Ui.TEXT, Typeface.BOLD));
        if (entries.isEmpty()) {
            summary.addView(Ui.text(this, "현재 필터에 해당하는 기록이 없습니다.", 14, Ui.MUTED, Typeface.NORMAL));
        } else {
            summary.addView(Ui.text(this, ("all".equals(selectedRecordFilter) ? "최근: " : "대상: ") + entryCompactSummary(entries.get(0)), 14, Ui.MUTED, Typeface.NORMAL));
        }

        LinearLayout filterRow1 = Ui.horizontal(this);
        filterRow1.setPadding(0, Ui.dp(this, 8), 0, 0);
        addRecordFilterButton(filterRow1, "all", "전체", allEntries);
        addRecordFilterButton(filterRow1, "issues", "점검", allEntries);
        addRecordFilterButton(filterRow1, "cash", "입출금", allEntries);
        summary.addView(filterRow1);

        LinearLayout filterRow2 = Ui.horizontal(this);
        filterRow2.setPadding(0, Ui.dp(this, 6), 0, Ui.dp(this, 4));
        addRecordFilterButton(filterRow2, "trades", "체결", allEntries);
        addRecordFilterButton(filterRow2, "fx", "환전", allEntries);
        addRecordFilterButton(filterRow2, "voided", "취소", allEntries);
        summary.addView(filterRow2);

        LinearLayout filterRow3 = Ui.horizontal(this);
        filterRow3.setPadding(0, 0, 0, Ui.dp(this, 4));
        addRecordFilterButton(filterRow3, "dividend", "배당", allEntries);
        summary.addView(filterRow3);

        Button toggle = Ui.button(this, recordTimelineExpanded ? "기록 타임라인 접기" : "기록 타임라인 펼치기", Ui.PRIMARY, false);
        toggle.setOnClickListener(view -> {
            recordTimelineExpanded = !recordTimelineExpanded;
            if (!recordTimelineExpanded) {
                selectedRecordFilter = "all";
            }
            showRecord();
        });
        summary.addView(toggle);
        content.addView(summary);

        if (recordTimelineExpanded) {
            for (LedgerEntry entry : entries) {
                addEntryCard(entry);
            }
        }
    }

    private void addRecordFilterButton(LinearLayout parent, String filter, String label, List<LedgerEntry> entries) {
        boolean selected = filter.equals(selectedRecordFilter);
        int count = filteredLedgerEntries(entries, filter).size();
        Button button = Ui.button(this, label + " " + count, selected ? Ui.PRIMARY : Ui.MUTED, selected);
        button.setOnClickListener(view -> {
            selectedRecordFilter = filter;
            recordTimelineExpanded = true;
            showRecord();
        });
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1);
        params.setMargins(Ui.dp(this, 2), 0, Ui.dp(this, 2), 0);
        parent.addView(button, params);
    }

    private List<LedgerEntry> filteredLedgerEntries(List<LedgerEntry> entries) {
        return filteredLedgerEntries(entries, selectedRecordFilter);
    }

    private List<LedgerEntry> filteredLedgerEntries(List<LedgerEntry> entries, String filter) {
        List<LedgerEntry> result = new ArrayList<>();
        for (LedgerEntry entry : entries) {
            if (recordMatchesFilter(entry, filter)) {
                result.add(entry);
            }
        }
        return result;
    }

    private boolean recordMatchesFilter(LedgerEntry entry, String filter) {
        if ("issues".equals(filter)) {
            return isProblemRecord(entry);
        }
        if ("cash".equals(filter)) {
            return "deposit".equals(entry.type) || "withdraw".equals(entry.type);
        }
        if ("trades".equals(filter)) {
            return "buy".equals(entry.type) || "sell".equals(entry.type);
        }
        if ("fx".equals(filter)) {
            return "fx".equals(entry.type);
        }
        if ("dividend".equals(filter)) {
            return "dividend".equals(entry.type);
        }
        if ("voided".equals(filter)) {
            return isVoided(entry) || "cancel".equals(entry.type);
        }
        return true;
    }

    private boolean isProblemRecord(LedgerEntry entry) {
        if (entry == null || isVoided(entry) || "cancel".equals(entry.type)) {
            return false;
        }
        return isUsdCashFxMissing(entry) || isFxEventRateMissing(entry);
    }

    private boolean isUsdCashFxMissing(LedgerEntry entry) {
        return ("deposit".equals(entry.type) || "withdraw".equals(entry.type))
                && "USD".equals(entry.currency)
                && entry.fxRateKrw <= 0;
    }

    private boolean isFxEventRateMissing(LedgerEntry entry) {
        return "fx".equals(entry.type)
                && ("USD".equals(entry.fromCurrency) || "USD".equals(entry.toCurrency))
                && ("KRW".equals(entry.fromCurrency) || "KRW".equals(entry.toCurrency))
                && entry.fxRateKrw <= 0;
    }

    private String recordFilterLabel(String filter) {
        if ("issues".equals(filter)) {
            return "점검 필요";
        }
        if ("cash".equals(filter)) {
            return "입출금";
        }
        if ("trades".equals(filter)) {
            return "체결";
        }
        if ("fx".equals(filter)) {
            return "환전";
        }
        if ("dividend".equals(filter)) {
            return "배당";
        }
        if ("voided".equals(filter)) {
            return "취소/정정";
        }
        return "전체";
    }

    private void addLedgerAuditPanel() {
        LedgerAudit audit = ledgerAudit();
        addSectionTitle("장부 점검");
        LinearLayout card = Ui.card(this);
        int issueCount = audit.issueCount();
        int titleColor = issueCount == 0 ? Ui.SUCCESS : Ui.WARNING;
        card.addView(Ui.text(this, issueCount == 0 ? "장부 정상" : "확인 필요 " + issueCount + "건", 17, titleColor, Typeface.BOLD));
        card.addView(Ui.text(this, issueCount == 0
                        ? "현재 기록과 자산 계산에 큰 점검 항목이 없습니다."
                        : "아래 항목을 먼저 정리하면 자산/손익 숫자가 더 믿을 만해집니다.",
                14,
                Ui.MUTED,
                Typeface.NORMAL));
        card.addView(Ui.spacer(this, 8));
        addMetric(card, "기록", audit.activeEntryCount + "건");
        addMetric(card, "자산 스냅샷", audit.snapshotCount + "개");
        addMetric(card, "USD 입출금 환율 누락", audit.missingUsdCashFxCount + "건");
        addMetric(card, "환전 환율 누락", audit.missingFxEventRateCount + "건");
        addMetric(card, "평균원가 임시평가", audit.averageCostValuationCount + "종목");
        addMetric(card, "가격/환율 데이터", audit.marketDataStatus());
        if (audit.corruptLedger) {
            card.addView(Ui.text(this, "장부 JSON 손상이 감지되었습니다. 백업 복원 전 새 기록 저장은 차단됩니다.", 13, Ui.DANGER, Typeface.BOLD));
        }
        boolean needsMarketRefresh = audit.priceProblemCount > 0 || audit.fxProblem || audit.averageCostValuationCount > 0;
        if (audit.priceProblemCount > 0 || audit.fxProblem) {
            card.addView(Ui.text(this, "가격/환율 데이터가 불안정하면 신규 매수와 ETF 리밸런싱은 막고, 수동 기록만 허용합니다. 먼저 시세/환율을 갱신하세요.", 13, Ui.WARNING, Typeface.BOLD));
        }
        if (audit.missingUsdCashFxCount + audit.missingFxEventRateCount > 0) {
            card.addView(Ui.text(this, "환율 없는 USD 기록은 원금 기준 자산 변화가 추정값이 됩니다. USD 입출금은 정정 입력에서 당시 USD/KRW를 넣어주세요.", 13, Ui.WARNING, Typeface.BOLD));
            if (audit.missingFxEventRateCount > 0) {
                card.addView(Ui.text(this, "환전 기록의 환율이 빠진 경우 현재는 기록 취소 후 환전 기록을 다시 입력하는 방식으로 보정합니다.", 13, Ui.MUTED, Typeface.NORMAL));
            }
            Button expand = Ui.button(this, "점검 필요 기록만 보기", Ui.WARNING, false);
            expand.setOnClickListener(view -> {
                selectedRecordFilter = "issues";
                recordTimelineExpanded = true;
                Toast.makeText(this, "점검 필요 기록만 표시합니다. 저장 환율 없음 기록을 정정하세요.", Toast.LENGTH_LONG).show();
                showRecord();
            });
            card.addView(expand);
        }
        if (audit.averageCostValuationCount > 0) {
            card.addView(Ui.text(this, "일부 보유 종목은 최신 체결일보다 오래된 시세라 평균 매수가로 임시 평가 중입니다.", 13, Ui.MUTED, Typeface.NORMAL));
        }
        if (needsMarketRefresh) {
            Button liveSync = Ui.button(this, "시세/환율 갱신", Ui.SUCCESS, false);
            liveSync.setOnClickListener(view -> syncNoKeyMarketData());
            card.addView(liveSync);
        }
        content.addView(card);
    }

    private LedgerAudit ledgerAudit() {
        LedgerAudit audit = new LedgerAudit();
        audit.corruptLedger = ledger.isLedgerCorrupt();
        audit.snapshotCount = ledger.assetSnapshots().size();
        audit.priceProblemCount = repository.quoteFailedCount + repository.staleQuoteCount;
        audit.fxProblem = repository.usdKrw <= 0 || "failed".equals(repository.fxStatus);
        for (LedgerEntry entry : ledger.entries()) {
            if (isVoided(entry) || "cancel".equals(entry.type)) {
                continue;
            }
            audit.activeEntryCount++;
            if (isUsdCashFxMissing(entry)) {
                audit.missingUsdCashFxCount++;
            }
            if (isFxEventRateMissing(entry)) {
                audit.missingFxEventRateCount++;
            }
        }
        for (Account account : ledger.accounts()) {
            for (Holding holding : ledger.holdings(account.id).values()) {
                if (ledger.usesAverageCostValuation(account.id, holding, repository)) {
                    audit.averageCostValuationCount++;
                }
            }
        }
        return audit;
    }

    private String entryCompactSummary(LedgerEntry entry) {
        if (entry == null) {
            return "-";
        }
        if ("fx".equals(entry.type)) {
            return entryLabel(entry.type) + " · " + formatMoney(entry.fromAmount, entry.fromCurrency)
                    + " -> " + formatMoney(entry.toAmount, entry.toCurrency)
                    + " · " + entry.createdAt;
        }
        if ("dividend".equals(entry.type)) {
            return entryLabel(entry.type) + " · " + entry.symbol
                    + " · 세후 " + formatMoney(entry.amount, entry.currency)
                    + " · " + entry.createdAt;
        }
        if ("CASH".equals(entry.symbol) || entry.symbol == null || entry.symbol.isEmpty()) {
            return entryLabel(entry.type) + " · " + formatMoney(Math.abs(entry.amount), entry.currency)
                    + " · " + entry.createdAt;
        }
        return entryLabel(entry.type) + " · " + entry.symbol
                + " · " + formatPlain(entry.quantity) + "주"
                + " · " + entry.createdAt;
    }

    private void addQuickRecordButtons(LinearLayout parent) {
        for (Account account : ledger.accounts()) {
            Button deposit = Ui.button(this, account.name + " 입금", account.color, false);
            deposit.setOnClickListener(view -> showCashDialog(account.id, "deposit"));
            parent.addView(deposit);
        }
        Button buyPicker = Ui.button(this, "추천 매수 선택 기록", Ui.SUCCESS, false);
        buyPicker.setOnClickListener(view -> showBuySignalPicker());
        parent.addView(buyPicker);
        Button reconcile = Ui.button(this, "증권사 보유 대조", Ui.PRIMARY, false);
        reconcile.setOnClickListener(view -> showReconciliationPicker());
        parent.addView(reconcile);
        Button dividend = Ui.button(this, "배당 기록", Ui.WARNING, false);
        dividend.setOnClickListener(view -> showDividendPicker());
        parent.addView(dividend);
        Button fx = Ui.button(this, "미국 계좌 환전 기록", Ui.ACCENT_US, false);
        fx.setOnClickListener(view -> showFxDialog());
        parent.addView(fx);
    }

    private void addEntryCard(LedgerEntry entry) {
        Account account = ledger.account(entry.accountId);
        LinearLayout card = Ui.card(this);
        LinearLayout top = Ui.horizontal(this);
        top.addView(Ui.pill(this, account.name, account.color));
        if (!entry.voidedAt.isEmpty()) {
            top.addView(Ui.pill(this, "취소됨", Ui.DANGER));
        }
        TextView title = Ui.text(this, entryLabel(entry.type) + " · " + entry.createdAt, 14, Ui.TEXT, Typeface.BOLD);
        title.setPadding(Ui.dp(this, 8), 0, 0, 0);
        top.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        card.addView(top);
        if ("cancel".equals(entry.type)) {
            card.addView(Ui.text(this, "취소한 기록: " + safe(entry.cancelledLabel), 14, Ui.MUTED, Typeface.NORMAL));
        } else if ("fx".equals(entry.type)) {
            card.addView(Ui.text(this,
                    formatMoney(entry.fromAmount, entry.fromCurrency)
                            + " -> "
                            + formatMoney(entry.toAmount, entry.toCurrency)
                            + " · " + safe(entry.memo),
                    14,
                    Ui.MUTED,
                    Typeface.NORMAL));
        } else if ("dividend".equals(entry.type)) {
            card.addView(Ui.text(this, entry.name + " · " + entry.symbol, 14, Ui.MUTED, Typeface.NORMAL));
            card.addView(Ui.text(this,
                    "세전 " + formatMoney(entry.grossDividend, entry.currency)
                            + " · 세금 " + formatMoney(entry.dividendTax, entry.currency)
                            + " · 세후 " + formatMoney(entry.amount, entry.currency),
                    14,
                    Ui.SUCCESS,
                    Typeface.BOLD));
            if ("USD".equals(entry.currency)) {
                card.addView(Ui.text(this, entry.fxRateKrw > 0 ? "저장 환율: USD/KRW " + formatPlain(entry.fxRateKrw) : "저장 환율 없음", 13, Ui.MUTED, Typeface.NORMAL));
            }
        } else if ("CASH".equals(entry.symbol)) {
            String cashLine = formatMoney(entry.amount, entry.currency);
            if ("USD".equals(entry.currency)) {
                cashLine += entry.fxRateKrw > 0 ? " · USD/KRW " + formatPlain(entry.fxRateKrw) : " · 저장 환율 없음";
            }
            card.addView(Ui.text(this, cashLine + " · " + safe(entry.memo), 14, Ui.MUTED, Typeface.NORMAL));
        } else {
            card.addView(Ui.text(this, entry.name + " · " + entry.symbol, 14, Ui.MUTED, Typeface.NORMAL));
            card.addView(Ui.text(this, "수량 " + formatPlain(entry.quantity) + " · 체결가 " + formatMoney(entry.price, entry.currency) + " · 비용 " + formatMoney(entry.fee, entry.currency), 14, Ui.MUTED, Typeface.NORMAL));
            if ("sell".equals(entry.type) && entry.costBasis > 0) {
                int pnlColor = entry.realizedPnl >= 0 ? Ui.SUCCESS : Ui.DANGER;
                card.addView(Ui.text(this,
                        "실현손익 " + formatMoney(entry.realizedPnl, entry.currency)
                                + " (" + formatPlain(entry.realizedPnlPercent) + "%) · 원가 " + formatMoney(entry.costBasis, entry.currency),
                        14,
                        pnlColor,
                        Typeface.BOLD));
                card.addView(Ui.text(this, "lot 배분: " + lotModeLabel(entry), 13, Ui.MUTED, Typeface.NORMAL));
            }
        }
        if (!entry.voidedAt.isEmpty()) {
            card.addView(Ui.text(this, "이 기록은 " + entry.voidedAt + "에 취소되어 보유/현금 계산에서 제외됩니다.", 13, Ui.DANGER, Typeface.BOLD));
        } else {
            if (canCorrectEntry(entry)) {
                Button correct = Ui.button(this, "정정 입력", Ui.PRIMARY, false);
                correct.setOnClickListener(view -> showCorrectEntryDialog(entry));
                card.addView(correct);
            }
            if (ledger.isLatestEntry(entry.id)) {
            Button undo = Ui.button(this, "cancel".equals(entry.type) ? "최근 정정 되돌리기" : "최근 기록 되돌리기", Ui.DANGER, false);
            undo.setOnClickListener(view -> {
                ValidationResult result = ledger.deleteLatestEntry(entry.id);
                if (result.ok) {
                    captureAssetSnapshot("ledger_undo");
                }
                Toast.makeText(this, result.message, result.ok ? Toast.LENGTH_SHORT : Toast.LENGTH_LONG).show();
                showRecord();
            });
            card.addView(undo);
            } else if (!"cancel".equals(entry.type)) {
            Button cancel = Ui.button(this, "기록 취소", Ui.DANGER, false);
            cancel.setOnClickListener(view -> showCancelEntryDialog(entry));
            card.addView(cancel);
            }
        }
        content.addView(card);
    }

    private boolean canCorrectEntry(LedgerEntry entry) {
        return "deposit".equals(entry.type) || "withdraw".equals(entry.type) || "buy".equals(entry.type) || "sell".equals(entry.type);
    }

    private void showCorrectEntryDialog(LedgerEntry entry) {
        if ("deposit".equals(entry.type) || "withdraw".equals(entry.type)) {
            showCorrectCashDialog(entry);
        } else if ("buy".equals(entry.type)) {
            showCorrectBuyDialog(entry);
        } else if ("sell".equals(entry.type)) {
            showCorrectSellDialog(entry);
        }
    }

    private void showCancelEntryDialog(LedgerEntry entry) {
        String targetText;
        if ("fx".equals(entry.type)) {
            targetText = formatMoney(entry.fromAmount, entry.fromCurrency)
                    + " -> "
                    + formatMoney(entry.toAmount, entry.toCurrency);
        } else if (entry.symbol == null || entry.symbol.isEmpty() || "CASH".equals(entry.symbol)) {
            targetText = formatMoney(Math.abs(entry.amount), entry.currency);
        } else {
            targetText = entry.name + " · " + entry.symbol + " · " + formatPlain(entry.quantity) + "주";
        }
        String message = "이 기록은 삭제하지 않고 취소 표시와 정정 기록을 남깁니다.\n\n"
                + entryLabel(entry.type) + " · " + entry.createdAt + "\n"
                + targetText
                + "\n\n취소 후 현금이나 보유 수량이 음수가 되면 저장하지 않습니다.";
        new AlertDialog.Builder(this)
                .setTitle("기록 취소")
                .setMessage(message)
                .setPositiveButton("취소 기록 남기기", (dialog, which) -> {
                    ValidationResult result = ledger.cancelEntry(entry.id);
                    if (result.ok) {
                        captureAssetSnapshot("ledger_cancel");
                    }
                    Toast.makeText(this, result.message, result.ok ? Toast.LENGTH_SHORT : Toast.LENGTH_LONG).show();
                    showRecord();
                })
                .setNegativeButton("닫기", null)
                .show();
    }

    private void showCorrectCashDialog(LedgerEntry entry) {
        Account account = ledger.account(entry.accountId);
        LinearLayout form = dialogForm();
        form.addView(Ui.text(this, account.name, 14, account.color, Typeface.BOLD));
        LinearLayout info = Ui.band(this);
        info.addView(Ui.text(this, entryLabel(entry.type) + " 정정", 16, Ui.TEXT, Typeface.BOLD));
        info.addView(Ui.text(this, "현재 기록: " + formatMoney(Math.abs(entry.amount), entry.currency) + " · " + safe(entry.memo), 13, Ui.MUTED, Typeface.NORMAL));
        if ("USD".equals(entry.currency)) {
            info.addView(Ui.text(this, entry.fxRateKrw > 0 ? "저장 환율: USD/KRW " + formatPlain(entry.fxRateKrw) : "저장 환율 없음 · 첫 스냅샷 환율로 추정 중", 13, Ui.WARNING, Typeface.BOLD));
        }
        form.addView(info);
        EditText amount = moneyInput("금액", formatPlain(Math.abs(entry.amount)));
        EditText memo = input("메모 (선택)", entry.memo);
        addLabeledInput(form, "정정 금액", amount);
        EditText fxRate = null;
        if ("USD".equals(entry.currency)) {
            double defaultFx = entry.fxRateKrw > 0 ? entry.fxRateKrw : repository.usdKrw;
            fxRate = moneyInput("USD/KRW", defaultFx > 0 ? formatPlain(defaultFx) : "");
            addLabeledInput(form, "입금 당시 환율", fxRate);
        }
        addLabeledInput(form, "메모", memo);
        final EditText fxRateInput = fxRate;
        AlertDialog correctDialog = new AlertDialog.Builder(this)
                .setTitle(entryLabel(entry.type) + " 정정")
                .setView(form)
                .setPositiveButton("정정 저장", null)
                .setNegativeButton("취소", null)
                .create();
        correctDialog.setOnShowListener(dialog -> correctDialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
            double fxValue = fxRateInput == null ? 0 : number(fxRateInput);
            ValidationResult result = ledger.correctCashEntry(entry.id, number(amount), memoValue(memo, "입출금 정정"), fxValue);
            Toast.makeText(this, result.message, result.ok ? Toast.LENGTH_SHORT : Toast.LENGTH_LONG).show();
            if (result.ok) {
                captureAssetSnapshot("ledger_correction");
                correctDialog.dismiss();
                if ("USD".equals(entry.currency)) {
                    showUsdCashCorrectionResultDialog();
                } else {
                    showRecord();
                }
            }
        }));
        correctDialog.show();
    }

    private void showUsdCashCorrectionResultDialog() {
        new AlertDialog.Builder(this)
                .setTitle("환율 보정 저장")
                .setMessage("자산 스냅샷을 갱신했습니다. 원금 기준 요약에서 보정 결과를 바로 확인할 수 있습니다.")
                .setPositiveButton("자산 확인", (dialog, which) -> showAssets())
                .setNegativeButton("기록 보기", (dialog, which) -> {
                    selectedRecordFilter = "all";
                    recordTimelineExpanded = false;
                    showRecord();
                })
                .show();
    }

    private void showCorrectBuyDialog(LedgerEntry entry) {
        Account account = ledger.account(entry.accountId);
        double reference = repository.referencePrice(entry.symbol);
        LinearLayout form = dialogForm();
        form.addView(Ui.text(this, account.name, 14, account.color, Typeface.BOLD));
        LinearLayout info = Ui.band(this);
        info.addView(Ui.text(this, entry.name + " · " + entry.symbol, 16, Ui.TEXT, Typeface.BOLD));
        info.addView(Ui.text(this, "현재 기록: " + formatPlain(entry.quantity) + "주 · " + formatMoney(entry.price, entry.currency) + " · 비용 " + formatMoney(entry.fee, entry.currency), 13, Ui.MUTED, Typeface.NORMAL));
        if (reference > 0) {
            info.addView(Ui.text(this, "참고 기준가: " + formatMoney(reference, entry.currency), 13, Ui.MUTED, Typeface.NORMAL));
        }
        form.addView(info);
        EditText quantity = input("체결 수량", formatPlain(entry.quantity));
        EditText price = input("평균 체결가", String.valueOf(entry.price));
        EditText fee = input("수수료/세금", String.valueOf(entry.fee));
        EditText memo = input("메모 (선택)", entry.memo);
        addLabeledInput(form, "정정 수량", quantity);
        addLabeledInput(form, "정정 평균단가", price);
        addLabeledInput(form, "정정 비용", fee);
        addLabeledInput(form, "메모", memo);
        AlertDialog correctDialog = new AlertDialog.Builder(this)
                .setTitle("매수 체결 정정")
                .setView(form)
                .setPositiveButton("정정 저장", null)
                .setNegativeButton("취소", null)
                .create();
        correctDialog.setOnShowListener(dialog -> correctDialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
            double actualQuantity = number(quantity);
            double actualPrice = number(price);
            double actualFee = number(fee);
            if (rejectTradeCorrectionInput(actualQuantity, actualPrice, actualFee, reference)) {
                return;
            }
            ValidationResult result = ledger.correctBuyEntry(entry.id, actualQuantity, actualPrice, actualFee, memoValue(memo, "매수 기록 정정"));
            Toast.makeText(this, result.message, result.ok ? Toast.LENGTH_SHORT : Toast.LENGTH_LONG).show();
            if (result.ok) {
                captureAssetSnapshot("ledger_correction");
                correctDialog.dismiss();
                showRecord();
            }
        }));
        correctDialog.show();
    }

    private void showCorrectSellDialog(LedgerEntry entry) {
        Account account = ledger.account(entry.accountId);
        double reference = repository.referencePrice(entry.symbol);
        LinearLayout form = dialogForm();
        form.addView(Ui.text(this, account.name, 14, account.color, Typeface.BOLD));
        LinearLayout info = Ui.band(this);
        info.addView(Ui.text(this, entry.name + " · " + entry.symbol, 16, Ui.TEXT, Typeface.BOLD));
        info.addView(Ui.text(this, "현재 기록: " + formatPlain(entry.quantity) + "주 · " + formatMoney(entry.price, entry.currency) + " · 비용 " + formatMoney(entry.fee, entry.currency), 13, Ui.MUTED, Typeface.NORMAL));
        if (entry.costBasis > 0) {
            info.addView(Ui.text(this, "현재 실현손익: " + formatSignedMoney(entry.realizedPnl, entry.currency) + " · 원가 " + formatMoney(entry.costBasis, entry.currency), 13, signedColor(entry.realizedPnl), Typeface.BOLD));
        }
        if (reference > 0) {
            info.addView(Ui.text(this, "참고 기준가: " + formatMoney(reference, entry.currency), 13, Ui.MUTED, Typeface.NORMAL));
        }
        form.addView(info);

        List<HoldingLot> lots = ledger.lotsAvailableBeforeEntry(entry.id);
        final String[] selectedLotId = {entry.selectedLotId == null ? "" : entry.selectedLotId.trim()};
        HoldingLot initialLot = findLotById(lots, selectedLotId[0]);
        if (initialLot == null) {
            selectedLotId[0] = "";
        }
        final double[] selectedAvailable = {initialLot == null ? sumLotQuantity(lots) : initialLot.remainingQuantity};
        EditText quantity = input("매도 수량", formatPlain(entry.quantity));
        EditText price = input("평균 체결가", String.valueOf(entry.price));
        EditText fee = input("수수료/세금", String.valueOf(entry.fee));
        EditText memo = input("메모 (선택)", entry.memo);

        TextView preview = Ui.text(this, "", 13, Ui.TEXT, Typeface.BOLD);
        if (!lots.isEmpty() && !"KR_ETF".equals(entry.market)) {
            TextView lotChoice = Ui.text(this, lotChoiceText(lots, selectedLotId[0], selectedAvailable[0]), 13, Ui.TEXT, Typeface.BOLD);
            form.addView(lotChoice);
            Button fifo = Ui.button(this, "FIFO 자동", account.color, selectedLotId[0].isEmpty());
            fifo.setOnClickListener(view -> {
                selectedLotId[0] = "";
                selectedAvailable[0] = sumLotQuantity(lots);
                lotChoice.setText(lotChoiceText(lots, selectedLotId[0], selectedAvailable[0]));
                refreshCorrectSellPreview(preview, entry, quantity, price, fee, selectedLotId[0]);
            });
            form.addView(fifo);
            for (HoldingLot lot : lots) {
                Button lotButton = Ui.button(this,
                        lot.openedDate + " · 잔여 " + formatPlain(lot.remainingQuantity) + "주 · " + lotEventBadge(lot),
                        account.color,
                        lot.lotId.equals(selectedLotId[0]));
                lotButton.setOnClickListener(view -> {
                    selectedLotId[0] = lot.lotId;
                    selectedAvailable[0] = lot.remainingQuantity;
                    lotChoice.setText(lotChoiceText(lots, selectedLotId[0], selectedAvailable[0]));
                    quantity.setText(formatPlain(Math.min(lot.remainingQuantity, Math.max(0, entry.quantity))));
                    refreshCorrectSellPreview(preview, entry, quantity, price, fee, selectedLotId[0]);
                });
                form.addView(lotButton);
            }
        }
        addLabeledInput(form, "정정 수량", quantity);
        addLabeledInput(form, "정정 평균단가", price);
        LinearLayout quick = Ui.horizontal(this);
        Button half = Ui.button(this, "50% 수량", account.color, false);
        half.setOnClickListener(view -> quantity.setText(formatPlain(selectedAvailable[0] / 2)));
        quick.addView(half, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        Button all = Ui.button(this, "전량", account.color, false);
        all.setOnClickListener(view -> quantity.setText(formatPlain(selectedAvailable[0])));
        LinearLayout.LayoutParams allParams = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1);
        allParams.setMargins(Ui.dp(this, 8), 0, 0, 0);
        quick.addView(all, allParams);
        form.addView(quick);
        addLabeledInput(form, "정정 비용", fee);
        form.addView(preview);
        addLabeledInput(form, "메모", memo);
        Runnable refresh = () -> refreshCorrectSellPreview(preview, entry, quantity, price, fee, selectedLotId[0]);
        addAfterTextChanged(quantity, refresh);
        addAfterTextChanged(price, refresh);
        addAfterTextChanged(fee, refresh);
        refresh.run();

        AlertDialog correctDialog = new AlertDialog.Builder(this)
                .setTitle("매도 체결 정정")
                .setView(form)
                .setPositiveButton("정정 저장", null)
                .setNegativeButton("취소", null)
                .create();
        correctDialog.setOnShowListener(dialog -> correctDialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
            double actualQuantity = number(quantity);
            double actualPrice = number(price);
            double actualFee = number(fee);
            if (rejectTradeCorrectionInput(actualQuantity, actualPrice, actualFee, reference)) {
                return;
            }
            ValidationResult result = ledger.correctSellEntry(entry.id, actualQuantity, actualPrice, actualFee, memoValue(memo, "매도 기록 정정"), selectedLotId[0]);
            Toast.makeText(this, result.message, result.ok ? Toast.LENGTH_SHORT : Toast.LENGTH_LONG).show();
            if (result.ok) {
                captureAssetSnapshot("ledger_correction");
                correctDialog.dismiss();
                showRecord();
            }
        }));
        correctDialog.show();
    }

    private void addDataSettings() {
        addSectionTitle("데이터 동기화");
        LinearLayout data = Ui.card(this);
        addMetric(data, "신호 상태", repository.status);
        addMetric(data, "가격 상태", repository.priceStatus);
        addMetric(data, "환율 상태", repository.fxStatus + " · " + repository.fxSource);
        addMetric(data, "가격 종목", repository.prices.size() + "개");
        addMetric(data, "가격 문제", "실패 " + repository.quoteFailedCount + "개 · 지연 " + repository.staleQuoteCount + "개");
        addMetric(data, "월간 신호", repository.signalMonth);
        addMetric(data, "데이터 소스", repository.source);
        addMetric(data, "사용 중 시세", activeMarketDataText());
        addMetric(data, "거래 대상 시세", actionableQuoteHealthText());
        String actionableIssues = actionableQuoteIssueText();
        if (!actionableIssues.isEmpty()) {
            addMetric(data, "확인할 종목", actionableIssues);
        }
        addMetric(data, "마지막 성공", repository.lastSuccessfulSyncAt.isEmpty() ? "없음" : repository.lastSuccessfulSyncAt);
        addMetric(data, "직접 시세 성공", repository.lastLiveQuoteSyncAt.isEmpty() ? "없음" : repository.lastLiveQuoteSyncAt);
        if (!repository.lastSyncError.isEmpty()) {
            addMetric(data, "마지막 실패", friendlySyncError(repository.lastSyncError));
        }
        if (!repository.lastLiveQuoteError.isEmpty()) {
            addMetric(data, "직접 시세 실패", friendlySyncError(repository.lastLiveQuoteError));
        }
        String baseUrl = SignalRepository.remoteBaseUrl(this);
        addMetric(data, "원격 API", baseUrl.isEmpty() ? "미설정" : baseUrl);
        Button setUrl = Ui.button(this, "GitHub Pages API URL", Ui.PRIMARY, false);
        setUrl.setOnClickListener(view -> showRemoteUrlDialog(false));
        data.addView(setUrl);
        Button sync = Ui.button(this, syncing ? "동기화 중" : "원격 신호/시세 동기화", Ui.SUCCESS, false);
        sync.setEnabled(!syncing);
        sync.setOnClickListener(view -> syncRemoteSignals());
        data.addView(sync);
        Button liveSync = Ui.button(this, syncing ? "갱신 중" : "키 없는 시세/환율 갱신", Ui.SUCCESS, false);
        liveSync.setEnabled(!syncing);
        liveSync.setOnClickListener(view -> syncNoKeyMarketData());
        data.addView(liveSync);
        Button clear = Ui.button(this, "원격 캐시 삭제", Ui.MUTED, false);
        clear.setOnClickListener(view -> {
            SignalRepository.clearRemoteCache(this);
            repository = SignalRepository.load(this);
            captureAssetSnapshot("local_data_restore");
            Toast.makeText(this, "내장 데이터로 복구했습니다.", Toast.LENGTH_SHORT).show();
            showRecord();
        });
        data.addView(clear);
        content.addView(data);
    }

    private void addBackupPanel() {
        addSectionTitle("백업과 안전장치");
        LinearLayout backup = Ui.card(this);
        backup.addView(Ui.text(this, "장부 백업", 16, Ui.TEXT, Typeface.BOLD));
        backup.addView(Ui.text(this, "현재 계좌명, 현금, 전략 선택, 입출금/체결/환전 기록과 자산 스냅샷을 JSON으로 백업합니다. 기본 백업은 파일 저장을 권장합니다.", 14, Ui.MUTED, Typeface.NORMAL));
        Button exportFile = Ui.button(this, "백업 파일 저장", Ui.SUCCESS, false);
        exportFile.setOnClickListener(view -> createLedgerBackupFile());
        backup.addView(exportFile);
        Button restore = Ui.button(this, "백업 붙여넣기 복원", Ui.WARNING, false);
        restore.setOnClickListener(view -> showBackupImportDialog());
        backup.addView(restore);
        Button restoreFile = Ui.button(this, "백업 파일 불러오기", Ui.WARNING, false);
        restoreFile.setOnClickListener(view -> openLedgerBackupFile());
        backup.addView(restoreFile);
        Button export = Ui.button(this, "고급: 클립보드 백업 복사", Ui.WARNING, false);
        export.setOnClickListener(view -> confirmCopyLedgerBackup());
        backup.addView(export);
        backup.addView(Ui.text(this, "시장 알림: " + NotificationHelper.nextMarketReminderSummary() + " · 휴장일 반영", 13, Ui.MUTED, Typeface.NORMAL));
        Button schedule = Ui.button(this, "시장 알림 재예약", Ui.SUCCESS, false);
        schedule.setOnClickListener(view -> {
            requestNotificationPermission();
            String summary = NotificationHelper.scheduleMarketReminders(this);
            Toast.makeText(this, summary, Toast.LENGTH_LONG).show();
            showRecord();
        });
        backup.addView(schedule);
        Button test = Ui.button(this, "알림 테스트", Ui.PRIMARY, false);
        test.setOnClickListener(view -> {
            requestNotificationPermission();
            NotificationHelper.showNow(this, "전략 알림 테스트", "오늘의 Action Inbox를 확인하세요.");
        });
        backup.addView(test);
        content.addView(backup);
    }

    private void confirmCopyLedgerBackup() {
        new AlertDialog.Builder(this)
                .setTitle("클립보드 백업")
                .setMessage("장부 JSON에는 계좌명, 현금, 체결 기록이 들어갑니다. 다른 앱이나 키보드가 클립보드를 볼 수 있으니 파일 백업을 우선 사용하세요. 복사하면 1분 뒤 앱이 클립보드를 비웁니다.")
                .setPositiveButton("복사", (dialog, which) -> copyLedgerBackup())
                .setNegativeButton("취소", null)
                .show();
    }

    private void copyLedgerBackup() {
        String backup = ledger.exportBackup();
        ClipboardManager clipboard = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
        if (clipboard != null) {
            ClipData clip = ClipData.newPlainText(BACKUP_CLIP_LABEL, backup);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                PersistableBundle extras = new PersistableBundle();
                extras.putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true);
                clip.getDescription().setExtras(extras);
            }
            clipboard.setPrimaryClip(clip);
            scheduleClipboardClear();
            Toast.makeText(this, "장부 백업 JSON을 복사했습니다. 1분 뒤 자동으로 비웁니다.", Toast.LENGTH_LONG).show();
        } else {
            Toast.makeText(this, "클립보드를 사용할 수 없습니다.", Toast.LENGTH_LONG).show();
        }
    }

    private void scheduleClipboardClear() {
        content.postDelayed(() -> {
            ClipboardManager clipboard = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
            if (clipboard == null || !clipboard.hasPrimaryClip()) {
                return;
            }
            ClipDescription description = clipboard.getPrimaryClipDescription();
            CharSequence label = description == null ? "" : description.getLabel();
            if (BACKUP_CLIP_LABEL.contentEquals(label)) {
                clipboard.setPrimaryClip(ClipData.newPlainText("", ""));
            }
        }, CLIPBOARD_BACKUP_CLEAR_MS);
    }

    private void createLedgerBackupFile() {
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        intent.putExtra(Intent.EXTRA_TITLE, "investor-run-backup-" + backupTimestamp() + ".json");
        try {
            startActivityForResult(intent, REQUEST_EXPORT_BACKUP);
        } catch (Exception error) {
            Toast.makeText(this, "파일 저장 화면을 열 수 없습니다.", Toast.LENGTH_LONG).show();
        }
    }

    private void openLedgerBackupFile() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        try {
            startActivityForResult(intent, REQUEST_IMPORT_BACKUP);
        } catch (Exception error) {
            Toast.makeText(this, "파일 선택 화면을 열 수 없습니다.", Toast.LENGTH_LONG).show();
        }
    }

    private void writeLedgerBackupToUri(Uri uri) {
        try (OutputStream output = getContentResolver().openOutputStream(uri)) {
            if (output == null) {
                Toast.makeText(this, "백업 파일을 열 수 없습니다.", Toast.LENGTH_LONG).show();
                return;
            }
            output.write(ledger.exportBackup().getBytes(StandardCharsets.UTF_8));
            Toast.makeText(this, "백업 파일을 저장했습니다.", Toast.LENGTH_LONG).show();
        } catch (IOException error) {
            Toast.makeText(this, "백업 파일 저장 실패: " + friendlySyncError(error.getMessage()), Toast.LENGTH_LONG).show();
        }
    }

    private void readLedgerBackupFromUri(Uri uri) {
        try (InputStream input = getContentResolver().openInputStream(uri)) {
            if (input == null) {
                Toast.makeText(this, "백업 파일을 열 수 없습니다.", Toast.LENGTH_LONG).show();
                return;
            }
            String backupText = readUtf8(input);
            confirmBackupFileImport(backupText);
        } catch (IOException error) {
            Toast.makeText(this, "백업 파일 읽기 실패: " + friendlySyncError(error.getMessage()), Toast.LENGTH_LONG).show();
        }
    }

    private void confirmBackupFileImport(String backupText) {
        new AlertDialog.Builder(this)
                .setTitle("백업 파일 복원")
                .setMessage("선택한 백업 파일로 현재 장부와 현금 잔액을 교체합니다. 복원 전 현재 장부는 앱 내부에 직전 백업으로 보존됩니다.")
                .setPositiveButton("복원", (dialog, which) -> {
                    ValidationResult result = ledger.importBackup(backupText);
                    Toast.makeText(this, result.message, Toast.LENGTH_LONG).show();
                    if (result.ok) {
                        captureAssetSnapshot("backup_file_restore");
                        rerender();
                    }
                })
                .setNegativeButton("취소", null)
                .show();
    }

    private String readUtf8(InputStream input) throws IOException {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        int read;
        while ((read = input.read(chunk)) != -1) {
            buffer.write(chunk, 0, read);
        }
        return buffer.toString(StandardCharsets.UTF_8.name());
    }

    private String backupTimestamp() {
        return new SimpleDateFormat("yyyyMMdd-HHmmss", Locale.KOREA).format(new Date());
    }

    private void showBackupImportDialog() {
        LinearLayout form = dialogForm();
        EditText backupText = input("백업 JSON 붙여넣기", "");
        backupText.setSingleLine(false);
        backupText.setMinLines(6);
        backupText.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
        form.addView(Ui.text(this, "복원 전 현재 장부는 앱 내부에 직전 백업으로 보존됩니다.", 13, Ui.WARNING, Typeface.BOLD));
        form.addView(backupText);
        new AlertDialog.Builder(this)
                .setTitle("장부 백업 복원")
                .setMessage("붙여넣은 백업으로 현재 장부와 현금 잔액을 교체합니다.")
                .setView(form)
                .setPositiveButton("복원", (dialog, which) -> {
                    ValidationResult result = ledger.importBackup(backupText.getText().toString());
                    Toast.makeText(this, result.message, result.ok ? Toast.LENGTH_LONG : Toast.LENGTH_LONG).show();
                    if (result.ok) {
                        captureAssetSnapshot("backup_restore");
                        rerender();
                    }
                })
                .setNegativeButton("취소", null)
                .show();
    }

    private void showRemoteUrlDialog(boolean syncAfterSave) {
        LinearLayout form = dialogForm();
        EditText url = input("https://username.github.io/repo/api", SignalRepository.remoteBaseUrl(this));
        url.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        form.addView(url);
        new AlertDialog.Builder(this)
                .setTitle("GitHub Pages API URL")
                .setMessage("dist/api가 배포된 URL을 입력하세요. 예: https://username.github.io/repo/api")
                .setView(form)
                .setPositiveButton("저장", (dialog, which) -> {
                    SignalRepository.setRemoteBaseUrl(this, url.getText().toString());
                    Toast.makeText(this, "URL을 저장했습니다.", Toast.LENGTH_SHORT).show();
                    if (syncAfterSave) {
                        syncRemoteSignals();
                    } else {
                        showRecord();
                    }
                })
                .setNegativeButton("취소", null)
                .show();
    }

    private void syncRemoteSignals() {
        syncMarketData(true, true);
    }

    private void syncNoKeyMarketData() {
        syncMarketData(true, false);
    }

    private void maybeAutoSyncRemoteSignals(boolean force) {
        if (syncing) {
            return;
        }
        long now = System.currentTimeMillis();
        if (!force && lastAutoSyncAttemptAt > 0 && now - lastAutoSyncAttemptAt < AUTO_SYNC_MIN_INTERVAL_MS) {
            return;
        }
        lastAutoSyncAttemptAt = now;
        syncMarketData(false, !SignalRepository.remoteBaseUrl(this).isEmpty());
    }

    private void syncMarketData(boolean interactive, boolean includeRemote) {
        String baseUrl = SignalRepository.remoteBaseUrl(this);
        if (includeRemote && baseUrl.isEmpty()) {
            if (interactive) {
                showRemoteUrlDialog(true);
            }
            return;
        }
        if (syncing) {
            return;
        }
        syncing = true;
        lastAutoSyncAttemptAt = System.currentTimeMillis();
        if (interactive) {
            showRecord();
        }
        new Thread(() -> {
            SignalRepository working = repository;
            SyncResult remoteResult = null;
            if (includeRemote) {
                remoteResult = SignalRepository.syncFromRemote(this, baseUrl);
                if (remoteResult.success && remoteResult.repository != null) {
                    working = remoteResult.repository;
                } else {
                    working.lastSyncError = remoteResult.message;
                }
            }
            SyncResult liveResult = SignalRepository.syncNoKeyMarketData(this, working, quoteRequestsFor(working));
            SignalRepository finalRepository = liveResult.success && liveResult.repository != null ? liveResult.repository : working;
            boolean success = (remoteResult != null && remoteResult.success) || liveResult.success;
            String message = syncMessage(remoteResult, liveResult);
            runOnUiThread(() -> {
                syncing = false;
                if (success) {
                    repository = finalRepository;
                    captureAssetSnapshot(includeRemote ? "remote_live_sync" : "live_market_sync");
                    if (interactive) {
                        Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
                    }
                } else {
                    if (interactive) {
                        Toast.makeText(this, message, Toast.LENGTH_LONG).show();
                    }
                }
                if (interactive) {
                    showRecord();
                } else if (success) {
                    rerender();
                }
            });
        }).start();
    }

    private String syncMessage(SyncResult remoteResult, SyncResult liveResult) {
        List<String> parts = new ArrayList<>();
        if (remoteResult != null) {
            parts.add(syncResultText("원격", remoteResult));
        }
        if (liveResult != null) {
            parts.add(syncResultText("시세", liveResult));
        }
        return parts.isEmpty() ? "동기화 결과 없음" : join(parts, "\n");
    }

    private String syncResultText(String label, SyncResult result) {
        if (result == null) {
            return label + ": 결과 없음";
        }
        return label + (result.success ? " 성공: " : " 확인 필요: ")
                + (result.success ? friendlySyncSuccess(result.message) : friendlySyncError(result.message));
    }

    private String activeMarketDataText() {
        if (!repository.lastLiveQuoteSyncAt.isEmpty()) {
            return "직접 갱신 " + repository.lastLiveQuoteSyncAt;
        }
        if (!repository.lastSuccessfulSyncAt.isEmpty()) {
            return "원격 갱신 " + repository.lastSuccessfulSyncAt;
        }
        if (!repository.priceAsOf.isEmpty() || !repository.fxAsOf.isEmpty()) {
            return "내장 기준 " + safe(repository.priceAsOf) + " / " + safe(repository.fxAsOf);
        }
        return "기준 없음";
    }

    private boolean todayDataHealthy() {
        return "normal".equals(repository.status)
                && "normal".equals(repository.fxStatus)
                && repository.usdKrw > 0
                && actionableQuoteIssueText().isEmpty();
    }

    private String actionableQuoteHealthText() {
        List<QuoteRequest> requests = quoteRequestsFor(repository);
        if (requests.isEmpty()) {
            return "대상 없음";
        }
        int ok = 0;
        for (QuoteRequest request : requests) {
            if (repository.isQuoteReliable(request.symbol)) {
                ok++;
            }
        }
        String result = ok + "/" + requests.size() + "개 정상";
        if (!"normal".equals(repository.fxStatus) || repository.usdKrw <= 0) {
            result += " · 환율 확인";
        }
        return result;
    }

    private String actionableQuoteIssueText() {
        List<String> issues = new ArrayList<>();
        if (!"normal".equals(repository.fxStatus) || repository.usdKrw <= 0) {
            issues.add("USD/KRW");
        }
        List<QuoteRequest> requests = quoteRequestsFor(repository);
        int hidden = 0;
        for (QuoteRequest request : requests) {
            if (repository.isQuoteReliable(request.symbol)) {
                continue;
            }
            if (issues.size() < 4) {
                issues.add(request.symbol);
            } else {
                hidden++;
            }
        }
        if (hidden > 0) {
            issues.add("+" + hidden);
        }
        return join(issues, ", ");
    }

    private String friendlySyncSuccess(String message) {
        if (message == null || message.trim().isEmpty()) {
            return "갱신했습니다.";
        }
        if (message.contains("직접 시세 갱신")) {
            return message;
        }
        if (message.contains("원격 신호와 시세")) {
            return "신호 패키지를 갱신했습니다.";
        }
        return trimForDisplay(message);
    }

    private String friendlySyncError(String message) {
        if (message == null || message.trim().isEmpty()) {
            return "원인을 확인할 수 없습니다. 다시 시도하세요.";
        }
        String text = message.trim();
        String lower = text.toLowerCase(Locale.US);
        if (lower.contains("http 404") || lower.contains("404:")) {
            return "데이터 파일을 찾지 못했습니다. GitHub Pages API URL과 /api 배포 상태를 확인하세요.";
        }
        if (lower.contains("http 401") || lower.contains("http 403") || lower.contains("unauthorized") || lower.contains("forbidden")) {
            return "무료 시세 서버가 요청을 거절했습니다. 잠시 후 다시 갱신하거나 마지막 정상 시세를 사용하세요.";
        }
        if (lower.contains("timeout") || lower.contains("timed out") || lower.contains("failed to connect")) {
            return "네트워크 응답이 늦습니다. 연결 상태를 확인한 뒤 다시 시도하세요.";
        }
        if (lower.contains("frankfurter") && lower.contains("yahoo")) {
            return "환율 무료 경로가 모두 실패했습니다. 잠시 후 다시 갱신하세요.";
        }
        if (text.contains("원격 데이터가 현재 APK")) {
            return "원격 데이터가 앱 내장 데이터보다 오래되어 적용하지 않았습니다.";
        }
        if (text.contains("GitHub Pages API URL")) {
            return "GitHub Pages API URL을 먼저 설정하세요.";
        }
        if (text.contains("파싱 실패")) {
            return "저장된 캐시 형식이 깨졌습니다. 원격 캐시 삭제 후 다시 동기화하세요.";
        }
        return trimForDisplay(text);
    }

    private String trimForDisplay(String message) {
        String oneLine = message.replace('\n', ' ').replace('\r', ' ').trim();
        return oneLine.length() <= 90 ? oneLine : oneLine.substring(0, 87) + "...";
    }

    private List<QuoteRequest> quoteRequestsFor(SignalRepository source) {
        Map<String, QuoteRequest> requests = new LinkedHashMap<>();
        if (source != null) {
            for (StrategySignal signal : source.signals) {
                if ("buy".equals(signal.actionType)) {
                    addQuoteRequest(requests, signal.symbol, signal.name, signal.market, signal.currency);
                }
            }
            for (EtfTarget target : source.etfTargets) {
                addQuoteRequest(requests, target.symbol, target.name, "KR_ETF", target.currency);
            }
            for (Account account : ledger.accounts()) {
                for (Holding holding : ledger.holdings(account.id).values()) {
                    addQuoteRequest(requests, holding.symbol, holding.name, holding.market, holding.currency);
                }
            }
        }
        return new ArrayList<>(requests.values());
    }

    private void addQuoteRequest(Map<String, QuoteRequest> requests, String symbol, String name, String market, String currency) {
        if (symbol == null || symbol.trim().isEmpty()) {
            return;
        }
        if ("KR_ETF_BASKET".equals(symbol)) {
            return;
        }
        requests.put(symbol, new QuoteRequest(symbol, name, market, currency));
    }

    private String join(List<String> values, String separator) {
        StringBuilder builder = new StringBuilder();
        for (String value : values) {
            if (builder.length() > 0) {
                builder.append(separator);
            }
            builder.append(value);
        }
        return builder.toString();
    }

    private void showOrderGuide(StrategySignal signal) {
        if (!canUseTradingData(signal)) {
            showDataLockedDialog(signal.name + " 주문 가이드");
            return;
        }
        String accountId = ledger.defaultAccountIdForMarket(signal.market);
        Account account = ledger.account(accountId);
        OrderPlan plan = orderPlan(signal, accountId);
        double reference = repository.referencePrice(signal.symbol);
        double averageBuyPrice = ledger.averageBuyPrice(accountId, signal.symbol);
        boolean cashNeeded = needsCashInputForBuy(signal, accountId, plan);
        String averageLine = averageBuyPrice > 0
                ? "매수 평균가: " + formatMoney(averageBuyPrice, signal.currency) + " · 평단 대비 " + priceVsAverageText(reference, averageBuyPrice) + "\n"
                : "";
        String orderLine = cashNeeded
                ? "예수금 입력 전이라 매수 수량은 계산 대기입니다."
                : plan.additionalQuantity > 0
                ? "추가 권장 수량: " + formatPlain(plan.additionalQuantity)
                + "주 · 예상 주문금액 " + formatMoney(plan.executableOrderValue, signal.currency)
                : "자동 추천 없음: 목표를 채웠거나 1주 가격이 추가 권장 금액을 초과합니다.";
        String message = account.name + "\n"
                + signal.name + " (" + signal.symbol + ")\n\n"
                + "이번 목표: " + formatMoney(plan.targetOrderValue, signal.currency) + "\n"
                + "이번 체결: " + formatMoney(plan.executedOrderValue, signal.currency) + "\n"
                + "남은 매수: " + formatMoney(plan.remainingOrderValue, signal.currency) + "\n"
                + "추가 가능 예산: " + formatMoney(plan.additionalOrderValue, signal.currency) + "\n"
                + "총 보유 원금: " + formatMoney(plan.totalInvestedValue, signal.currency) + "\n"
                + "현재가/기준가: " + formatMoney(reference, signal.currency) + "\n"
                + averageLine
                + orderLine + "\n"
                + "사용 가능 현금: " + formatMoney(ledger.cash(accountId, signal.currency), signal.currency) + "\n"
                + "가격 상태: " + repository.quoteStatusText(signal.symbol) + "\n"
                + "유효기간: " + signal.validUntil + "\n\n"
                + (cashNeeded
                ? "계좌 탭에서 예수금을 입력하면 목표금액과 매수 수량을 다시 계산합니다."
                : "체결 후 실제 수량과 평균단가를 기록하세요. 이번 목표 대비 5% 이내면 완료로 봅니다.");
        AlertDialog.Builder builder = new AlertDialog.Builder(this)
                .setTitle("주문 가이드")
                .setMessage(message)
                .setNegativeButton("닫기", null);
        if (cashNeeded) {
            builder.setPositiveButton("계좌 보기", (dialog, which) -> showAccounts());
        } else {
            builder.setPositiveButton(plan.additionalQuantity > 0 ? "체결 기록" : "수동 기록", (dialog, which) -> showTradeDialog(signal, "buy"));
        }
        builder.show();
    }

    private void showEtfRebalanceGuide() {
        if (!canUseEtfTradingData()) {
            showDataLockedDialog("ETF 리밸런싱");
            return;
        }
        String accountId = LedgerStore.ACCOUNT_PENSION;
        Account account = ledger.account(accountId);
        double total = accountValueInCurrency(accountId, "KRW");
        LinearLayout form = dialogForm();
        form.addView(Ui.text(this, account.name, 14, account.color, Typeface.BOLD));
        form.addView(Ui.text(this, "계좌 평가금액 " + formatMoney(total, "KRW"), 16, Ui.TEXT, Typeface.BOLD));
        form.addView(Ui.text(this, "허용 기준: 목표 비중 대비 ±1.5%p 또는 5만원 이하는 현실적 완료로 봅니다.", 13, Ui.MUTED, Typeface.NORMAL));

        final AlertDialog[] rebalanceDialog = new AlertDialog[1];
        for (EtfTarget target : repository.etfTargets) {
            EtfRebalancePlan plan = etfRebalancePlan(target, accountId, total);
            LinearLayout band = Ui.band(this);
            band.addView(Ui.text(this, target.name + " · " + target.symbol, 15, Ui.TEXT, Typeface.BOLD));
            addMetric(band, "목표", Math.round(target.targetWeight * 100) + "% · " + formatMoney(plan.targetAmount, target.currency));
            addMetric(band, "현재", formatMoney(plan.currentValue, target.currency));
            double averageBuyPrice = ledger.averageBuyPrice(accountId, target.symbol);
            if (averageBuyPrice > 0) {
                addMetric(band, "매수 평균가", formatMoney(averageBuyPrice, target.currency));
                addMetric(band, "평단 대비", priceVsAverageText(plan.referencePrice, averageBuyPrice));
            }
            addMetric(band, "가이드", plan.actionText + " " + formatPlain(plan.quantity) + "주 · 약 " + formatMoney(plan.executableAmount, target.currency));
            addMetric(band, "가격 상태", repository.quoteStatusText(target.symbol));
            if (!"유지".equals(plan.actionText) && plan.quantity > 0 && repository.isQuoteReliable(target.symbol)) {
                String side = "매수".equals(plan.actionText) ? "buy" : "sell";
                Button record = Ui.button(this, plan.actionText + " 기록", "buy".equals(side) ? Ui.SUCCESS : Ui.DANGER, false);
                record.setOnClickListener(view -> {
                    if (rebalanceDialog[0] != null) {
                        rebalanceDialog[0].dismiss();
                    }
                    showEtfTradeDialog(target, side, plan.quantity, plan.referencePrice);
                });
                band.addView(record);
            }
            form.addView(band);
        }
        rebalanceDialog[0] = new AlertDialog.Builder(this)
                .setTitle("ETF 리밸런싱")
                .setView(form)
                .setPositiveButton("확인", null)
                .create();
        rebalanceDialog[0].show();
    }

    private void showEtfGuide() {
        String accountId = LedgerStore.ACCOUNT_PENSION;
        Account account = ledger.account(accountId);
        StringBuilder builder = new StringBuilder();
        builder.append(account.name).append("\n\n목표 비중\n");
        for (EtfTarget target : repository.etfTargets) {
            builder.append("- ")
                    .append(target.name)
                    .append(": ")
                    .append(Math.round(target.targetWeight * 100))
                    .append("% · 기준가 ")
                    .append(formatMoney(target.referencePrice, target.currency))
                    .append("\n");
        }
        builder.append("\n허용 기준: 목표 비중 대비 ±1.5%p 또는 최소 주문 단위보다 작은 차이는 현실적 완료로 처리합니다.");
        new AlertDialog.Builder(this)
                .setTitle("ETF 리밸런싱")
                .setMessage(builder.toString())
                .setPositiveButton("확인", null)
                .show();
    }

    private void showEtfTradeDialog(EtfTarget target, String side, double suggestedQuantity, double reference) {
        String accountId = LedgerStore.ACCOUNT_PENSION;
        Account account = ledger.account(accountId);
        StrategySignal signal = new StrategySignal();
        signal.signalId = "ETF-" + target.symbol;
        signal.market = "KR_ETF";
        signal.strategyKey = defaultStrategyKey(accountId);
        signal.actionType = side;
        signal.symbol = target.symbol;
        signal.name = target.name;
        signal.currency = target.currency;
        signal.referencePrice = reference;

        LinearLayout form = dialogForm();
        form.addView(Ui.text(this, account.name, 14, account.color, Typeface.BOLD));
        LinearLayout info = Ui.band(this);
        info.addView(Ui.text(this, target.name + " · " + target.symbol, 16, Ui.TEXT, Typeface.BOLD));
        info.addView(Ui.text(this, "리밸런싱 " + ("buy".equals(side) ? "매수" : "매도") + " · 기준가 " + formatMoney(reference, target.currency), 13, Ui.MUTED, Typeface.NORMAL));
        form.addView(info);

        EditText quantity = input("체결 수량", suggestedQuantity <= 0 ? "" : formatPlain(suggestedQuantity));
        EditText price = input("평균 체결가", reference == 0 ? "" : String.valueOf(reference));
        EditText fee = input("수수료/세금", "0");
        EditText memo = input("메모 (선택)", "");
        addLabeledInput(form, "실제 체결 수량", quantity);
        addLabeledInput(form, "실제 평균단가", price);
        addLabeledInput(form, "비용", fee);
        addLabeledInput(form, "메모", memo);

        AlertDialog etfDialog = new AlertDialog.Builder(this)
                .setTitle(("buy".equals(side) ? "ETF 매수" : "ETF 매도") + " 기록")
                .setView(form)
                .setPositiveButton("저장", null)
                .setNegativeButton("취소", null)
                .create();
        etfDialog.setOnShowListener(dialog -> etfDialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
                    double actualQuantity = number(quantity);
                    double actualPrice = number(price);
                    double actualFee = number(fee);
                    if (rejectTradeInput(signal, side, actualQuantity, actualPrice, actualFee, reference)) {
                        return;
                    }
                    ValidationResult result = ledger.recordTrade(side, accountId, signal, actualQuantity, actualPrice, actualFee, memoValue(memo, "ETF 리밸런싱"));
                    if (result.ok) {
                        ledger.clearSnoozedAction("rebalance-" + accountId);
                        captureAssetSnapshot("trade_record");
                    }
                    Toast.makeText(this, result.message, result.ok ? Toast.LENGTH_SHORT : Toast.LENGTH_LONG).show();
                    if (result.ok) {
                        etfDialog.dismiss();
                        rerender();
                    }
                }));
        etfDialog.show();
    }

    private void showDataLockedDialog(String title) {
        String message = "현재 가격/환율 데이터가 정상 상태가 아닙니다.\n\n"
                + "가격 상태: " + repository.priceStatus + " · 문제 " + (repository.quoteFailedCount + repository.staleQuoteCount) + "개\n"
                + "환율 상태: " + repository.fxStatus + " · " + repository.fxSource + "\n\n"
                + "실전 주문 가이드는 최신 시세와 환율 확인 후 다시 열어주세요.";
        new AlertDialog.Builder(this)
                .setTitle(title)
                .setMessage(message)
                .setPositiveButton("데이터 화면", (dialog, which) -> showRecord())
                .setNegativeButton("닫기", null)
                .show();
    }

    private void showTrendGuide(WeeklyTrend trend, boolean held) {
        String trendState = repository.effectiveTrendState(trend);
        double trendClose = repository.effectiveTrendClose(trend);
        String closeLabel = repository.trendUsesLatestQuote(trend) ? "최신가" : "종가";
        String message = trend.name + " (" + trend.symbol + ")\n"
                + "상태: " + trendState + "\n"
                + closeLabel + ": " + formatMoney(trendClose, trend.currency) + "\n"
                + "가격 기준일: " + repository.effectiveTrendDate(trend) + "\n"
                + "주봉 기준선: " + formatMoney(trend.weeklyTrendLine, trend.currency) + "\n"
                + "확인 필요: " + (trend.confirmationRequired ? "예" : "아니오");
        boolean sellReview = held && "broken".equals(trendState);
        AlertDialog.Builder builder = new AlertDialog.Builder(this)
                .setTitle(sellReview ? "주봉 훼손 매도 검토" : "주봉 상태 확인")
                .setMessage(message)
                .setNegativeButton("닫기", null);
        if (sellReview) {
            builder.setPositiveButton("매도 기록", (dialog, which) -> {
                String accountId = accountIdForTrend(trend);
                Holding holding = ledger.holdings(accountId).get(trend.symbol);
                if (holding != null) {
                    showManualSellDialog(accountId, holding);
                }
            });
        }
        builder.show();
    }

    private void showTradeDialog(StrategySignal signal, String side) {
        if ("buy".equals(side) && !canUseTradingData(signal)) {
            showDataLockedDialog(signal.name + " 체결 기록");
            return;
        }
        String accountId = ledger.defaultAccountIdForMarket(signal.market);
        Account account = ledger.account(accountId);
        LinearLayout form = dialogForm();
        form.addView(Ui.text(this, account.name, 14, account.color, Typeface.BOLD));
        LinearLayout info = Ui.band(this);
        info.addView(Ui.text(this, signal.name + " · " + signal.symbol, 16, Ui.TEXT, Typeface.BOLD));
        info.addView(Ui.text(this, "전략: " + strategyLabel(accountId), 13, Ui.MUTED, Typeface.NORMAL));
        info.addView(Ui.text(this, "기준가: " + formatMoney(repository.referencePrice(signal.symbol), signal.currency), 13, Ui.MUTED, Typeface.NORMAL));
        form.addView(info);

        OrderPlan plan = orderPlan(signal, accountId);
        double reference = repository.referencePrice(signal.symbol);
        double suggestedQuantity = "buy".equals(side) ? plan.additionalQuantity : 0;
        EditText quantity = input("체결 수량", suggestedQuantity <= 0 ? "" : formatPlain(suggestedQuantity));
        EditText price = input("평균 체결가", reference == 0 ? "" : String.valueOf(reference));
        EditText fee = input("수수료/세금", "0");
        EditText memo = input("메모 (선택)", "");
        addLabeledInput(form, "실제 체결 수량", quantity);
        addLabeledInput(form, "실제 평균단가", price);
        LinearLayout quick = Ui.horizontal(this);
        Button useCurrent = Ui.button(this, "현재가 적용", account.color, false);
        useCurrent.setOnClickListener(view -> price.setText(reference == 0 ? "" : String.valueOf(reference)));
        quick.addView(useCurrent, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        Button useTarget = Ui.button(this, "목표 수량", account.color, false);
        useTarget.setOnClickListener(view -> {
            if (suggestedQuantity <= 0) {
                Toast.makeText(this, "목표 금액으로 자동 산출 가능한 수량이 없습니다.", Toast.LENGTH_SHORT).show();
            } else {
                quantity.setText(formatPlain(suggestedQuantity));
            }
        });
        LinearLayout.LayoutParams targetParams = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1);
        targetParams.setMargins(Ui.dp(this, 8), 0, 0, 0);
        quick.addView(useTarget, targetParams);
        form.addView(quick);
        addLabeledInput(form, "비용", fee);
        addLabeledInput(form, "메모", memo);
        AlertDialog tradeDialog = new AlertDialog.Builder(this)
                .setTitle(("buy".equals(side) ? "매수" : "매도") + " 체결 기록")
                .setView(form)
                .setPositiveButton("저장", null)
                .setNegativeButton("취소", null)
                .create();
        tradeDialog.setOnShowListener(dialog -> tradeDialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
                    double actualQuantity = number(quantity);
                    double actualPrice = number(price);
                    double actualFee = number(fee);
                    if (rejectTradeInput(signal, side, actualQuantity, actualPrice, actualFee, reference)) {
                        return;
                    }
                    if ("buy".equals(side)) {
                        ledger.saveOrderTargetSnapshot(accountId, signal, plan.targetOrderValue);
                    }
                    ValidationResult result = ledger.recordTrade(side, accountId, signal, actualQuantity, actualPrice, actualFee, memoValue(memo, strategyLabel(accountId)));
                    if (!result.ok) {
                        Toast.makeText(this, result.message, Toast.LENGTH_LONG).show();
                        return;
                    }
                    ledger.clearSnoozedAction("signal-" + signal.signalId);
                    captureAssetSnapshot("trade_record");
                    double actual = actualQuantity * actualPrice + actualFee;
                    double expectedExecuted = "buy".equals(side) ? plan.executedOrderValue + actual : plan.executedOrderValue;
                    double expectedTotalInvested = "buy".equals(side) ? plan.totalInvestedValue + actual : plan.totalInvestedValue;
                    Toast.makeText(this, result.message + "\n" + validationText(signal, plan.targetOrderValue, expectedExecuted, expectedTotalInvested, plan.capLimitValue), Toast.LENGTH_LONG).show();
                    tradeDialog.dismiss();
                    rerender();
                }));
        tradeDialog.show();
    }

    private void showManualBuyDialog(String accountId, Holding holding) {
        Account account = ledger.account(accountId);
        StrategySignal signal = new StrategySignal();
        signal.signalId = "manual-buy-" + holding.symbol;
        signal.market = holding.market;
        signal.strategyKey = "manual_adjustment";
        signal.actionType = "buy";
        signal.symbol = holding.symbol;
        signal.name = holding.name;
        signal.currency = holding.currency;
        signal.referencePrice = repository.referencePrice(holding.symbol);

        LinearLayout form = dialogForm();
        form.addView(Ui.text(this, account.name, 14, account.color, Typeface.BOLD));
        LinearLayout info = Ui.band(this);
        info.addView(Ui.text(this, holding.name + " · " + holding.symbol, 16, Ui.TEXT, Typeface.BOLD));
        info.addView(Ui.text(this, "현재 보유 " + formatPlain(holding.quantity) + "주 · 평단 " + formatMoney(holding.cost / Math.max(holding.quantity, 0.000001), holding.currency), 13, Ui.MUTED, Typeface.NORMAL));
        info.addView(Ui.text(this, "현재가 " + formatMoney(signal.referencePrice, holding.currency) + " · 사용 가능 현금 " + formatMoney(ledger.cash(accountId, holding.currency), holding.currency), 13, Ui.MUTED, Typeface.NORMAL));
        form.addView(info);

        EditText quantity = input("매수 수량", "");
        EditText price = input("평균 체결가", signal.referencePrice == 0 ? "" : String.valueOf(signal.referencePrice));
        EditText fee = input("수수료/세금", "0");
        EditText memo = input("메모 (선택)", "");
        addLabeledInput(form, "실제 매수 수량", quantity);
        addLabeledInput(form, "실제 평균단가", price);
        Button useCurrent = Ui.button(this, "현재가 적용", account.color, false);
        useCurrent.setOnClickListener(view -> price.setText(signal.referencePrice == 0 ? "" : String.valueOf(signal.referencePrice)));
        form.addView(useCurrent);
        addLabeledInput(form, "비용", fee);
        addLabeledInput(form, "메모", memo);

        AlertDialog buyDialog = new AlertDialog.Builder(this)
                .setTitle("추가 매수 기록")
                .setView(form)
                .setPositiveButton("저장", null)
                .setNegativeButton("취소", null)
                .create();
        buyDialog.setOnShowListener(dialog -> buyDialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
            double actualQuantity = number(quantity);
            double actualPrice = number(price);
            double actualFee = number(fee);
            if (rejectTradeInput(signal, "buy", actualQuantity, actualPrice, actualFee, signal.referencePrice)) {
                return;
            }
            ValidationResult result = ledger.recordTrade("buy", accountId, signal, actualQuantity, actualPrice, actualFee, memoValue(memo, "수동 추가 매수"));
            if (result.ok) {
                captureAssetSnapshot("trade_record");
            }
            Toast.makeText(this, result.message, result.ok ? Toast.LENGTH_SHORT : Toast.LENGTH_LONG).show();
            if (result.ok) {
                buyDialog.dismiss();
                rerender();
            }
        }));
        buyDialog.show();
    }

    private void showManualSellDialog(String accountId, Holding holding) {
        showManualSellDialog(accountId, holding, holding.quantity / 2, "매도 기록");
    }

    private void showManualSellDialog(String accountId, Holding holding, double suggestedQuantity, String reason) {
        showManualSellDialog(accountId, holding, suggestedQuantity, reason, "");
    }

    private void showManualSellDialog(String accountId, Holding holding, double suggestedQuantity, String reason, String preselectedLotId) {
        StrategySignal signal = new StrategySignal();
        signal.signalId = "manual-sell-" + holding.symbol;
        signal.market = holding.market;
        signal.strategyKey = "manual_or_weekly_exit";
        signal.actionType = "sell";
        signal.symbol = holding.symbol;
        signal.name = holding.name;
        signal.currency = holding.currency;
        signal.referencePrice = repository.referencePrice(holding.symbol);
        LinearLayout form = dialogForm();
        form.addView(Ui.text(this, ledger.account(accountId).name, 14, ledger.account(accountId).color, Typeface.BOLD));
        LinearLayout info = Ui.band(this);
        info.addView(Ui.text(this, holding.name + " · " + holding.symbol, 16, Ui.TEXT, Typeface.BOLD));
        info.addView(Ui.text(this, "보유 수량: " + formatPlain(holding.quantity), 13, Ui.MUTED, Typeface.NORMAL));
        info.addView(Ui.text(this, "매도 사유: " + reason, 13, Ui.MUTED, Typeface.NORMAL));
        form.addView(info);
        List<HoldingLot> lots = ledger.lots(accountId, holding.symbol);
        final String[] selectedLotId = {preselectedLotId == null ? "" : preselectedLotId.trim()};
        HoldingLot initialLot = findLotById(lots, selectedLotId[0]);
        if (initialLot == null) {
            selectedLotId[0] = "";
        }
        final double[] selectedAvailable = {initialLot == null ? Math.max(holding.quantity, sumLotQuantity(lots)) : initialLot.remainingQuantity};
        double defaultQuantity = Math.min(selectedAvailable[0], Math.max(0, suggestedQuantity));
        EditText quantity = input("매도 수량", formatPlain(defaultQuantity));
        EditText price = input("평균 체결가", String.valueOf(signal.referencePrice));
        EditText fee = input("수수료/세금", "0");
        EditText memo = input("메모 (선택)", "");
        TextView preview = Ui.text(this, "", 13, Ui.TEXT, Typeface.BOLD);
        if (!lots.isEmpty() && !"KR_ETF".equals(holding.market)) {
            TextView lotChoice = Ui.text(this, lotChoiceText(lots, selectedLotId[0], selectedAvailable[0]), 13, Ui.TEXT, Typeface.BOLD);
            form.addView(lotChoice);
            Button fifo = Ui.button(this, "FIFO 자동", ledger.account(accountId).color, selectedLotId[0].isEmpty());
            fifo.setOnClickListener(view -> {
                selectedLotId[0] = "";
                selectedAvailable[0] = Math.max(holding.quantity, sumLotQuantity(lots));
                lotChoice.setText(lotChoiceText(lots, selectedLotId[0], selectedAvailable[0]));
                quantity.setText(formatPlain(Math.min(holding.quantity, Math.max(0, suggestedQuantity))));
                refreshSellPreview(preview, accountId, holding.symbol, holding.currency, quantity, price, fee, selectedLotId[0]);
            });
            form.addView(fifo);
            for (HoldingLot lot : lots) {
                Button lotButton = Ui.button(this,
                        lot.openedDate + " · 잔여 " + formatPlain(lot.remainingQuantity) + "주 · " + lotEventBadge(lot),
                        ledger.account(accountId).color,
                        lot.lotId.equals(selectedLotId[0]));
                lotButton.setOnClickListener(view -> {
                    selectedLotId[0] = lot.lotId;
                    selectedAvailable[0] = lot.remainingQuantity;
                    lotChoice.setText(lotChoiceText(lots, selectedLotId[0], selectedAvailable[0]));
                    quantity.setText(formatPlain(Math.min(lot.remainingQuantity, Math.max(0, suggestedQuantity))));
                    refreshSellPreview(preview, accountId, holding.symbol, holding.currency, quantity, price, fee, selectedLotId[0]);
                });
                form.addView(lotButton);
            }
        }
        addLabeledInput(form, "실제 매도 수량", quantity);
        addLabeledInput(form, "실제 평균단가", price);
        LinearLayout quick = Ui.horizontal(this);
        Button half = Ui.button(this, "50% 수량", ledger.account(accountId).color, false);
        half.setOnClickListener(view -> quantity.setText(formatPlain(selectedAvailable[0] / 2)));
        quick.addView(half, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        Button all = Ui.button(this, "전량", ledger.account(accountId).color, false);
        all.setOnClickListener(view -> quantity.setText(formatPlain(selectedAvailable[0])));
        LinearLayout.LayoutParams allParams = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1);
        allParams.setMargins(Ui.dp(this, 8), 0, 0, 0);
        quick.addView(all, allParams);
        form.addView(quick);
        addLabeledInput(form, "비용", fee);
        form.addView(preview);
        addLabeledInput(form, "메모", memo);
        Runnable refresh = () -> refreshSellPreview(preview, accountId, holding.symbol, holding.currency, quantity, price, fee, selectedLotId[0]);
        addAfterTextChanged(quantity, refresh);
        addAfterTextChanged(price, refresh);
        addAfterTextChanged(fee, refresh);
        refresh.run();
        AlertDialog sellDialog = new AlertDialog.Builder(this)
                .setTitle("매도 체결 기록")
                .setView(form)
                .setPositiveButton("저장", null)
                .setNegativeButton("취소", null)
                .create();
        sellDialog.setOnShowListener(dialog -> sellDialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
                    double actualQuantity = number(quantity);
                    double actualPrice = number(price);
                    double actualFee = number(fee);
                    if (rejectTradeInput(signal, "sell", actualQuantity, actualPrice, actualFee, signal.referencePrice)) {
                        return;
                    }
                    ValidationResult result = ledger.recordTrade("sell", accountId, signal, actualQuantity, actualPrice, actualFee, memoValue(memo, reason), selectedLotId[0]);
                    if (result.ok) {
                        captureAssetSnapshot("trade_record");
                    }
                    Toast.makeText(this, result.message, result.ok ? Toast.LENGTH_SHORT : Toast.LENGTH_LONG).show();
                    if (result.ok) {
                        sellDialog.dismiss();
                        rerender();
                    }
                }));
        sellDialog.show();
    }

    private void showCashDialog(String accountId, String type) {
        Account account = ledger.account(accountId);
        LinearLayout form = dialogForm();
        form.addView(Ui.text(this, account.name, 14, account.color, Typeface.BOLD));
        final String[] selectedCurrency = {account.baseCurrency};
        TextView selected = Ui.text(this, "선택 통화: " + selectedCurrency[0], 14, Ui.TEXT, Typeface.BOLD);
        form.addView(selected);
        if (LedgerStore.ACCOUNT_US.equals(accountId)) {
            LinearLayout currencyRow = Ui.horizontal(this);
            Button krw = Ui.button(this, "KRW", Ui.ACCENT_KR, false);
            krw.setOnClickListener(view -> {
                selectedCurrency[0] = "KRW";
                selected.setText("선택 통화: KRW");
            });
            currencyRow.addView(krw, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
            Button usd = Ui.button(this, "USD", Ui.ACCENT_US, false);
            usd.setOnClickListener(view -> {
                selectedCurrency[0] = "USD";
                selected.setText("선택 통화: USD");
            });
            LinearLayout.LayoutParams usdParams = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1);
            usdParams.setMargins(Ui.dp(this, 8), 0, 0, 0);
            currencyRow.addView(usd, usdParams);
            form.addView(currencyRow);
        }

        EditText amount = moneyInput("금액", "");
        addLabeledInput(form, "입출금 금액", amount);
        EditText memo = input("메모 (선택)", "");
        addLabeledInput(form, "메모", memo);
        new AlertDialog.Builder(this)
                .setTitle("withdraw".equals(type) ? "출금 기록" : "입금 기록")
                .setView(form)
                .setPositiveButton("저장", (dialog, which) -> {
                    String value = selectedCurrency[0];
                    ValidationResult result = ledger.addCashEvent(accountId, type, value, number(amount), memoValue(memo, "현금 기록"), repository.usdKrw);
                    if (result.ok) {
                        captureAssetSnapshot("cash_record");
                    }
                    Toast.makeText(this, result.message, result.ok ? Toast.LENGTH_SHORT : Toast.LENGTH_LONG).show();
                    rerender();
                })
                .setNegativeButton("취소", null)
                .show();
    }

    private void showFxDialog() {
        String accountId = LedgerStore.ACCOUNT_US;
        Account account = ledger.account(accountId);
        LinearLayout form = dialogForm();
        form.addView(Ui.text(this, account.name, 14, account.color, Typeface.BOLD));
        final String[] fromCurrency = {"KRW"};
        final String[] toCurrency = {"USD"};
        TextView direction = Ui.text(this, "환전 방향: KRW -> USD", 14, Ui.TEXT, Typeface.BOLD);
        form.addView(direction);
        LinearLayout directionRow = Ui.horizontal(this);
        Button krwToUsd = Ui.button(this, "KRW -> USD", Ui.ACCENT_US, false);
        krwToUsd.setOnClickListener(view -> {
            fromCurrency[0] = "KRW";
            toCurrency[0] = "USD";
            direction.setText("환전 방향: KRW -> USD");
        });
        directionRow.addView(krwToUsd, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        Button usdToKrw = Ui.button(this, "USD -> KRW", Ui.ACCENT_KR, false);
        usdToKrw.setOnClickListener(view -> {
            fromCurrency[0] = "USD";
            toCurrency[0] = "KRW";
            direction.setText("환전 방향: USD -> KRW");
        });
        LinearLayout.LayoutParams usdToKrwParams = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1);
        usdToKrwParams.setMargins(Ui.dp(this, 8), 0, 0, 0);
        directionRow.addView(usdToKrw, usdToKrwParams);
        form.addView(directionRow);

        EditText fromAmount = input("출금 통화 금액", "");
        EditText toAmount = input("입금 통화 금액", "");
        EditText memo = input("메모 (선택)", "");
        addLabeledInput(form, "환전 전 차감 금액", fromAmount);
        addLabeledInput(form, "환전 후 입금 금액", toAmount);
        addLabeledInput(form, "메모", memo);
        new AlertDialog.Builder(this)
                .setTitle("환전 기록")
                .setView(form)
                .setPositiveButton("저장", (dialog, which) -> {
                    ValidationResult result = ledger.addFxEvent(
                            accountId,
                            fromCurrency[0],
                            toCurrency[0],
                            number(fromAmount),
                            number(toAmount),
                            memoValue(memo, "환전 기록")
                    );
                    Toast.makeText(this, result.message, result.ok ? Toast.LENGTH_SHORT : Toast.LENGTH_LONG).show();
                    if (result.ok) {
                        captureAssetSnapshot("fx_record");
                        rerender();
                    }
                })
                .setNegativeButton("취소", null)
                .show();
    }

    private void showRenameAccountDialog(Account account) {
        LinearLayout form = dialogForm();
        EditText name = input("계좌명", account.name);
        name.setInputType(InputType.TYPE_CLASS_TEXT);
        form.addView(name);
        new AlertDialog.Builder(this)
                .setTitle("계좌명 변경")
                .setMessage("증권사명, 별칭, 운용 목적에 맞게 자유롭게 바꿀 수 있습니다.")
                .setView(form)
                .setPositiveButton("저장", (dialog, which) -> {
                    ledger.setAccountName(account.id, name.getText().toString());
                    Toast.makeText(this, "계좌명을 저장했습니다.", Toast.LENGTH_SHORT).show();
                    rerender();
                })
                .setNegativeButton("취소", null)
                .show();
    }

    private void showStrategyPicker(String accountId) {
        String[] labels = strategyLabels(accountId);
        String[] keys = strategyKeys(accountId);
        new AlertDialog.Builder(this)
                .setTitle("전략 선택")
                .setItems(labels, (dialog, which) -> {
                    if (isPackagedStrategy(accountId, keys[which])) {
                        saveStrategySelection(accountId, keys[which], labels[which]);
                    } else {
                        new AlertDialog.Builder(this)
                                .setTitle("연구 전략 선택")
                                .setMessage("이 전략은 현재 자동 추천 패키지와 완전히 연결되지 않았을 수 있습니다. 신호와 비중 가이드가 비어 있으면 기본 전략으로 되돌리세요.")
                                .setPositiveButton("선택", (confirmDialog, confirmWhich) -> saveStrategySelection(accountId, keys[which], labels[which]))
                                .setNegativeButton("취소", null)
                                .show();
                    }
                })
                .setNegativeButton("취소", null)
                .show();
    }

    private boolean isPackagedStrategy(String accountId, String strategyKey) {
        if (defaultStrategyKey(accountId).equals(strategyKey)) {
            return true;
        }
        if (LedgerStore.ACCOUNT_US.equals(accountId)) {
            return StrategyMath.STRATEGY_US_SCORE_C_CAP_27_5.equals(strategyKey);
        }
        return LedgerStore.ACCOUNT_PENSION.equals(accountId)
                && StrategyMath.isPackagedKrEtfStrategy(strategyKey);
    }

    private void saveStrategySelection(String accountId, String key, String label) {
        ledger.setSelectedStrategyKey(accountId, key);
        Toast.makeText(this, label + " 선택", Toast.LENGTH_SHORT).show();
        showOperations();
    }

    private LinearLayout dialogForm() {
        LinearLayout form = Ui.vertical(this);
        int pad = Ui.dp(this, 18);
        form.setPadding(pad, Ui.dp(this, 8), pad, 0);
        return form;
    }

    private EditText input(String hint, String value) {
        EditText editText = new EditText(this);
        editText.setHint(hint);
        editText.setText(value);
        editText.setSingleLine(true);
        if (hint.contains("금액") || hint.contains("수량") || hint.contains("체결가") || hint.contains("평균단가") || hint.contains("수수료")) {
            editText.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        }
        editText.setSelectAllOnFocus(true);
        return editText;
    }

    private EditText moneyInput(String hint, String value) {
        EditText editText = input(hint, value);
        editText.setInputType(InputType.TYPE_CLASS_NUMBER);
        editText.addTextChangedListener(new TextWatcher() {
            private boolean editing;

            @Override
            public void beforeTextChanged(CharSequence s, int start, int count, int after) {
            }

            @Override
            public void onTextChanged(CharSequence s, int start, int before, int count) {
            }

            @Override
            public void afterTextChanged(Editable editable) {
                if (editing) {
                    return;
                }
                String raw = editable.toString().replace(",", "").trim();
                if (raw.isEmpty()) {
                    return;
                }
                try {
                    editing = true;
                    long value = Long.parseLong(raw);
                    editText.setText(NumberFormat.getNumberInstance(Locale.KOREA).format(value));
                    editText.setSelection(editText.getText().length());
                } catch (NumberFormatException ignored) {
                } finally {
                    editing = false;
                }
            }
        });
        return editText;
    }

    private void addAfterTextChanged(EditText editText, Runnable callback) {
        editText.addTextChangedListener(new TextWatcher() {
            @Override
            public void beforeTextChanged(CharSequence s, int start, int count, int after) {
            }

            @Override
            public void onTextChanged(CharSequence s, int start, int before, int count) {
            }

            @Override
            public void afterTextChanged(Editable editable) {
                callback.run();
            }
        });
    }

    private void addLabeledInput(LinearLayout form, String label, EditText input) {
        TextView labelView = Ui.text(this, label, 12, Ui.MUTED, Typeface.BOLD);
        labelView.setPadding(0, Ui.dp(this, 10), 0, 0);
        form.addView(labelView);
        form.addView(input);
    }

    private String memoValue(EditText memo, String fallback) {
        String text = memo.getText().toString().trim();
        return text.isEmpty() ? fallback : text;
    }

    private void captureAssetSnapshot(String reason) {
        ledger.captureAssetSnapshot(repository, reason);
        scheduleStrategyReminders();
    }

    private void scheduleStrategyReminders() {
        NotificationHelper.scheduleMarketReminders(this);
    }

    private void addSectionTitle(String title) {
        TextView heading = Ui.text(this, title, 18, Ui.TEXT, Typeface.BOLD);
        heading.setPadding(Ui.dp(this, 16), Ui.dp(this, 18), Ui.dp(this, 16), Ui.dp(this, 4));
        content.addView(heading);
    }

    private void addMetric(LinearLayout parent, String label, String value) {
        LinearLayout row = Ui.horizontal(this);
        row.setPadding(0, Ui.dp(this, 3), 0, Ui.dp(this, 3));
        row.addView(Ui.text(this, label, 14, Ui.MUTED, Typeface.NORMAL), new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        TextView right = Ui.mono(this, value, 14, Ui.TEXT, Typeface.BOLD);
        right.setGravity(Gravity.END);
        row.addView(right, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        parent.addView(row);
    }

    private void addSummaryMetric(LinearLayout parent, String label, String value, int color) {
        LinearLayout box = Ui.vertical(this);
        box.setPadding(Ui.dp(this, 9), Ui.dp(this, 8), Ui.dp(this, 9), Ui.dp(this, 8));
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(Ui.withAlpha(color, 18));
        drawable.setCornerRadius(Ui.dp(this, 8));
        drawable.setStroke(Ui.dp(this, 1), Ui.withAlpha(color, 70));
        box.setBackground(drawable);
        TextView labelView = Ui.text(this, label, 11, Ui.MUTED, Typeface.BOLD);
        labelView.setGravity(Gravity.CENTER);
        TextView valueView = Ui.mono(this, value, 12, color, Typeface.BOLD);
        valueView.setGravity(Gravity.CENTER);
        box.addView(labelView);
        box.addView(valueView);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1);
        params.setMargins(Ui.dp(this, 2), 0, Ui.dp(this, 2), 0);
        parent.addView(box, params);
    }

    private int signedColor(double value) {
        if (value > 0.000001) {
            return Ui.SUCCESS;
        }
        if (value < -0.000001) {
            return Ui.DANGER;
        }
        return Ui.TEXT;
    }

    private void addAllocationBar(LinearLayout parent, double invested, double cash, int investedColor, int cashColor) {
        double total = Math.max(0, invested + cash);
        LinearLayout bar = Ui.horizontal(this);
        bar.setPadding(0, Ui.dp(this, 4), 0, Ui.dp(this, 4));
        View investedView = new View(this);
        investedView.setBackgroundColor(investedColor);
        View cashView = new View(this);
        cashView.setBackgroundColor(cashColor);
        int investedWeight = total <= 0 ? 1 : Math.max(1, (int) Math.round(invested / total * 100));
        int cashWeight = total <= 0 ? 1 : Math.max(1, 100 - investedWeight);
        bar.addView(investedView, new LinearLayout.LayoutParams(0, Ui.dp(this, 9), investedWeight));
        bar.addView(cashView, new LinearLayout.LayoutParams(0, Ui.dp(this, 9), cashWeight));
        parent.addView(bar);
        LinearLayout legend = Ui.horizontal(this);
        legend.addView(Ui.text(this, "투자 " + percentage(invested, total), 12, investedColor, Typeface.BOLD), new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        TextView cashText = Ui.text(this, "현금 " + percentage(cash, total), 12, cashColor, Typeface.BOLD);
        cashText.setGravity(Gravity.END);
        legend.addView(cashText, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        parent.addView(legend);
    }

    private void addAssetTrendCard() {
        List<AssetSnapshotPoint> points = ledger.assetSnapshotSeries(selectedAssetRange);
        LinearLayout card = Ui.card(this);
        LinearLayout header = Ui.horizontal(this);
        header.addView(Ui.text(this, "자산 변화", 17, Ui.TEXT, Typeface.BOLD), new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        header.addView(Ui.pill(this, assetRangeLabel(selectedAssetRange), Ui.PRIMARY));
        card.addView(header);

        LinearLayout range = Ui.horizontal(this);
        range.setPadding(0, Ui.dp(this, 8), 0, Ui.dp(this, 8));
        addAssetRangeButton(range, "day", "일");
        addAssetRangeButton(range, "week", "주");
        addAssetRangeButton(range, "month", "월");
        card.addView(range);

        if (points.isEmpty()) {
            card.addView(Ui.text(this, "아직 자산 스냅샷이 없습니다. 자산 탭을 열거나 기록을 저장하면 오늘 스냅샷이 생성됩니다.", 14, Ui.MUTED, Typeface.NORMAL));
            content.addView(card);
            return;
        }

        AssetSnapshotPoint first = points.get(0);
        AssetSnapshotPoint last = points.get(points.size() - 1);
        CashFlowBasis basis = cashFlowBasis(first.usdKrw);
        addMetric(card, "현재", formatKrw(last.totalKrw));
        if (basis.netContributionKrw > 0) {
            addMetric(card, "입금 원금", formatKrw(basis.netContributionKrw));
            addMetric(card, "원금 대비", trendChangeText(basis.netContributionKrw, last.totalKrw));
        } else {
            addMetric(card, "스냅샷 시작", formatKrw(first.totalKrw));
            addMetric(card, "스냅샷 변화", trendChangeText(first.totalKrw, last.totalKrw));
        }
        addMetric(card, "마지막 스냅샷", last.createdAt.isEmpty() ? last.dateKey : last.createdAt);

        AssetLineChartView chart = new AssetLineChartView(this);
        chart.setSeries(assetSeries(points, "total"), assetSeries(points, "cash"), assetSeries(points, "holding"));
        card.addView(chart, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, Ui.dp(this, 205)));

        LinearLayout axis = Ui.horizontal(this);
        axis.addView(Ui.text(this, safe(first.label), 12, Ui.MUTED, Typeface.BOLD), new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        TextView end = Ui.text(this, safe(last.label), 12, Ui.MUTED, Typeface.BOLD);
        end.setGravity(Gravity.END);
        axis.addView(end, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        card.addView(axis);

        addLineLegendRow(card, "총자산", Ui.PRIMARY);
        addLineLegendRow(card, "투자 중 자산", Ui.SUCCESS);
        addLineLegendRow(card, "현금", Ui.WARNING);
        card.addView(Ui.text(this, "상단 변화율은 입금 원금 기준이고, 그래프는 저장된 스냅샷 기록선입니다.", 13, Ui.MUTED, Typeface.NORMAL));
        if (points.size() < 2) {
            card.addView(Ui.text(this, "하루 이상 스냅샷이 쌓이면 추세선이 더 의미 있게 표시됩니다.", 13, Ui.MUTED, Typeface.NORMAL));
        }
        content.addView(card);
    }

    private void addPnlTrendCard() {
        List<AssetSnapshotPoint> points = ledger.pnlSnapshotSeries(selectedAssetRange);
        LinearLayout card = Ui.card(this);
        LinearLayout header = Ui.horizontal(this);
        header.addView(Ui.text(this, "손익 추세", 17, Ui.TEXT, Typeface.BOLD), new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        header.addView(Ui.pill(this, assetRangeLabel(selectedAssetRange), Ui.PRIMARY));
        card.addView(header);

        if (points.isEmpty()) {
            card.addView(Ui.text(this, "새 손익 기준으로 생성된 스냅샷이 아직 없습니다. 자산 탭을 다시 열면 오늘 기준 스냅샷부터 쌓입니다.", 14, Ui.MUTED, Typeface.NORMAL));
            content.addView(card);
            return;
        }

        AssetSnapshotPoint first = points.get(0);
        AssetSnapshotPoint last = points.get(points.size() - 1);
        addMetric(card, "투자 손익", formatSignedMoney(last.investmentPnlKrw, "KRW"));
        addMetric(card, "실현손익", formatSignedMoney(last.realizedPnlKrw, "KRW"));
        addMetric(card, "미실현손익", formatSignedMoney(last.unrealizedPnlKrw, "KRW"));
        addMetric(card, "기간 변화", points.size() < 2 ? "새 기준 시작" : pnlTrendChangeText(first.investmentPnlKrw, last.investmentPnlKrw));

        AssetLineChartView chart = new AssetLineChartView(this);
        chart.setSeries(
                assetSeries(points, "investmentPnl"),
                assetSeries(points, "unrealizedPnl"),
                assetSeries(points, "realizedPnl")
        );
        card.addView(chart, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, Ui.dp(this, 205)));

        LinearLayout axis = Ui.horizontal(this);
        axis.addView(Ui.text(this, safe(first.label), 12, Ui.MUTED, Typeface.BOLD), new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        TextView end = Ui.text(this, safe(last.label), 12, Ui.MUTED, Typeface.BOLD);
        end.setGravity(Gravity.END);
        axis.addView(end, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        card.addView(axis);

        addLineLegendRow(card, "투자 손익", Ui.PRIMARY);
        addLineLegendRow(card, "실현손익", Ui.SUCCESS);
        addLineLegendRow(card, "미실현손익", Ui.WARNING);
        if (points.size() < 2) {
            card.addView(Ui.text(this, "이전 손익 스냅샷은 stale quote 기준일 수 있어 추세 비교에서 제외했습니다.", 13, Ui.MUTED, Typeface.NORMAL));
        } else if (!hasPnlSnapshot(points)) {
            card.addView(Ui.text(this, "새 손익 기준으로 생성된 스냅샷부터 손익 값이 쌓입니다.", 13, Ui.MUTED, Typeface.NORMAL));
        }
        content.addView(card);
    }

    private void addAssetChangeExplanationCard() {
        List<AssetSnapshotPoint> points = ledger.assetSnapshotSeries(selectedAssetRange);
        if (points.size() < 2) {
            return;
        }

        AssetSnapshotPoint first = points.get(0);
        AssetSnapshotPoint last = points.get(points.size() - 1);
        CashFlowBasis basis = cashFlowBasis(first.usdKrw);
        double capitalChange = basis.netContributionKrw <= 0 ? last.totalKrw - first.totalKrw : last.totalKrw - basis.netContributionKrw;
        double explained = last.investmentPnlKrw + basis.fxEffectKrw;
        double other = capitalChange - explained;
        double fxChange = last.usdKrw - first.usdKrw;

        LinearLayout card = Ui.card(this);
        card.addView(Ui.text(this, "원금 기준 요약", 17, Ui.TEXT, Typeface.BOLD));
        card.addView(Ui.text(this, assetChangeSummary(capitalChange, last.investmentPnlKrw, basis.fxEffectKrw, basis.estimatedFxUsed), 14, Ui.MUTED, Typeface.NORMAL));
        card.addView(Ui.text(this,
                basis.netContributionKrw > 0
                        ? "계산 기준: 현재 총자산 - 누적 순입금 원금"
                        : "계산 기준: 현재 총자산 - 선택 기간 시작 총자산",
                13,
                Ui.MUTED,
                Typeface.BOLD));
        card.addView(Ui.spacer(this, 8));

        LinearLayout summaryRow = Ui.horizontal(this);
        addSummaryMetric(summaryRow, "원금 대비", formatSignedCompactKrw(capitalChange), signedColor(capitalChange));
        addSummaryMetric(summaryRow, "투자 손익", formatSignedCompactKrw(last.investmentPnlKrw), signedColor(last.investmentPnlKrw));
        addSummaryMetric(summaryRow, "환율 영향", formatSignedCompactKrw(basis.fxEffectKrw), signedColor(basis.fxEffectKrw));
        card.addView(summaryRow);
        card.addView(Ui.spacer(this, 8));

        addMetric(card, "현재 총자산", formatKrw(last.totalKrw));
        addMetric(card, basis.netContributionKrw > 0 ? "입금 원금" : "스냅샷 시작", formatKrw(basis.netContributionKrw > 0 ? basis.netContributionKrw : first.totalKrw));
        if (Math.abs(other) > 1000) {
            addMetric(card, "현금/시세 잔차", formatSignedMoney(other, "KRW"));
            card.addView(Ui.text(this, "잔차에는 현금 이동, 시세 기준일 차이, 반올림이 섞일 수 있어 투자 손익으로 보지 않습니다.", 13, Ui.MUTED, Typeface.NORMAL));
        }
        if (Math.abs(fxChange) > 0.000001) {
            addMetric(card, "USD/KRW 변화", (fxChange > 0 ? "+" : "-") + formatPlain(Math.abs(fxChange)));
        }
        if (basis.estimatedFxUsed) {
            card.addView(Ui.text(this, "기존 USD 입금에는 당시 환율이 없어 첫 스냅샷 환율로 원금을 추정했습니다. 새 입금부터는 당시 환율을 저장합니다.", 13, Ui.WARNING, Typeface.BOLD));
        }
        content.addView(card);
    }

    private void addAssetRangeButton(LinearLayout parent, String key, String label) {
        boolean selected = key.equals(selectedAssetRange);
        Button button = Ui.button(this, label, selected ? Ui.PRIMARY : Ui.MUTED, selected);
        button.setOnClickListener(view -> {
            selectedAssetRange = key;
            showAssets();
        });
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1);
        params.setMargins(Ui.dp(this, 3), 0, Ui.dp(this, 3), 0);
        parent.addView(button, params);
    }

    private void addLineLegendRow(LinearLayout parent, String label, int color) {
        LinearLayout row = Ui.horizontal(this);
        row.setPadding(0, Ui.dp(this, 3), 0, Ui.dp(this, 3));
        row.addView(Ui.colorDot(this, color));
        TextView text = Ui.text(this, label, 13, Ui.MUTED, Typeface.BOLD);
        text.setPadding(Ui.dp(this, 8), 0, 0, 0);
        row.addView(text);
        parent.addView(row);
    }

    private double[] assetSeries(List<AssetSnapshotPoint> points, String type) {
        double[] values = new double[points.size()];
        for (int index = 0; index < points.size(); index++) {
            AssetSnapshotPoint point = points.get(index);
            if ("cash".equals(type)) {
                values[index] = point.cashKrw;
            } else if ("holding".equals(type)) {
                values[index] = point.holdingKrw;
            } else if ("investmentPnl".equals(type)) {
                values[index] = point.investmentPnlKrw;
            } else if ("realizedPnl".equals(type)) {
                values[index] = point.realizedPnlKrw;
            } else if ("unrealizedPnl".equals(type)) {
                values[index] = point.unrealizedPnlKrw;
            } else {
                values[index] = point.totalKrw;
            }
        }
        return values;
    }

    private String assetRangeLabel(String range) {
        if ("week".equals(range)) {
            return "주간";
        }
        if ("month".equals(range)) {
            return "월간";
        }
        return "일간";
    }

    private String trendChangeText(double start, double end) {
        if (valuesHidden) {
            return "••••";
        }
        double delta = end - start;
        String sign = delta > 0 ? "+" : delta < 0 ? "-" : "";
        double percent = start <= 0 ? 0 : Math.abs(delta / start * 100);
        return sign + formatMoney(Math.abs(delta), "KRW") + " (" + sign + formatPlain(percent) + "%)";
    }

    private String assetChangeSummary(double totalChange, double currentInvestmentPnl, double fxEffect, boolean estimatedFxUsed) {
        if (valuesHidden) {
            return "금액 숨김 상태에서는 구성 금액을 표시하지 않습니다.";
        }
        String suffix = estimatedFxUsed ? " 기존 USD 입금 환율은 첫 스냅샷 환율로 추정했습니다." : "";
        if (Math.abs(totalChange) < 1) {
            return "입금 원금 기준으로 총자산 변화가 거의 없습니다." + suffix;
        }
        if (totalChange < 0 && currentInvestmentPnl < 0 && fxEffect < 0) {
            return "투자 손익과 환율 영향이 모두 마이너스라 원금 기준 총자산도 감소했습니다." + suffix;
        }
        if (totalChange < 0 && currentInvestmentPnl < 0) {
            return "보유 종목 손익이 원금 기준 총자산을 낮추고 있습니다." + suffix;
        }
        if (totalChange < 0 && fxEffect < 0) {
            return "환율 하락 영향이 원금 기준 총자산을 낮추고 있습니다." + suffix;
        }
        if (totalChange > 0 && currentInvestmentPnl > 0) {
            return "보유 종목 손익이 원금 기준 총자산을 높이고 있습니다." + suffix;
        }
        if (totalChange > 0 && fxEffect > 0) {
            return "환율 상승 영향이 원금 기준 총자산을 높이고 있습니다." + suffix;
        }
        return "입금 원금 기준으로 총자산 변화를 계산했습니다." + suffix;
    }

    private CashFlowBasis cashFlowBasis(double fallbackUsdKrw) {
        CashFlowBasis basis = new CashFlowBasis();
        double fallback = cashBasisFallbackUsdKrw(fallbackUsdKrw);
        for (LedgerEntry entry : ledger.entries()) {
            if (isVoided(entry)) {
                continue;
            }
            if (!"deposit".equals(entry.type) && !"withdraw".equals(entry.type)) {
                continue;
            }
            if ("USD".equals(entry.currency)) {
                double fx = entry.fxRateKrw > 0 ? entry.fxRateKrw : fallback;
                if (fx <= 0) {
                    continue;
                }
                if (entry.fxRateKrw <= 0) {
                    basis.estimatedFxUsed = true;
                }
                basis.netContributionKrw += entry.amount * fx;
                basis.usdContribution += entry.amount;
                if (repository.usdKrw > 0) {
                    basis.fxEffectKrw += entry.amount * (repository.usdKrw - fx);
                }
            } else {
                basis.netContributionKrw += entry.amount;
            }
        }
        return basis;
    }

    private double cashBasisFallbackUsdKrw(double rangeFallbackUsdKrw) {
        for (AssetSnapshotPoint point : ledger.assetSnapshots()) {
            if (point.usdKrw > 0) {
                return point.usdKrw;
            }
        }
        if (rangeFallbackUsdKrw > 0) {
            return rangeFallbackUsdKrw;
        }
        return repository.usdKrw;
    }

    private String pnlTrendChangeText(double start, double end) {
        if (valuesHidden) {
            return "••••";
        }
        double delta = end - start;
        String sign = delta > 0 ? "+" : delta < 0 ? "-" : "";
        double denominator = Math.abs(start);
        double percent = denominator <= 0 ? 0 : Math.abs(delta / denominator * 100);
        return sign + formatMoney(Math.abs(delta), "KRW") + " (" + sign + formatPlain(percent) + "%)";
    }

    private boolean hasPnlSnapshot(List<AssetSnapshotPoint> points) {
        for (AssetSnapshotPoint point : points) {
            if (Math.abs(point.investmentPnlKrw) > 0.000001
                    || Math.abs(point.realizedPnlKrw) > 0.000001
                    || Math.abs(point.unrealizedPnlKrw) > 0.000001) {
                return true;
            }
        }
        return false;
    }

    private void addAccountAllocationDonut(String title) {
        List<Account> accounts = ledger.accounts();
        double[] values = new double[accounts.size()];
        int[] colors = new int[accounts.size()];
        String[] labels = new String[accounts.size()];
        for (int index = 0; index < accounts.size(); index++) {
            Account account = accounts.get(index);
            values[index] = ledger.accountTotalKrw(account.id, repository);
            colors[index] = account.color;
            labels[index] = shortAccountName(account.id);
        }
        addDonutCard(title, labels, values, colors);
    }

    private void addCashHoldingDonut(String accountId, String title) {
        Account account = ledger.account(accountId);
        double cash = ledger.cashValueKrw(accountId, repository);
        double holding = ledger.holdingValueKrw(accountId, repository);
        addDonutCard(
                title,
                new String[]{"보유 평가", "현금"},
                new double[]{holding, cash},
                new int[]{account.color, Ui.WARNING}
        );
    }

    private void addTotalHoldingDonut() {
        List<String> labels = new ArrayList<>();
        List<Double> values = new ArrayList<>();
        List<Integer> colors = new ArrayList<>();
        int[] palette = piePalette();
        int colorIndex = 0;
        for (Account account : ledger.accounts()) {
            for (Holding holding : ledger.holdings(account.id).values()) {
                double price = ledger.valuationPrice(account.id, holding, repository);
                double value = holding.quantity * price;
                double krw = "USD".equals(holding.currency) ? value * repository.usdKrw : value;
                if (krw > 0) {
                    labels.add(holding.symbol);
                    values.add(krw);
                    colors.add(palette[colorIndex % palette.length]);
                    colorIndex++;
                }
            }
        }
        if (values.isEmpty()) {
            return;
        }
        addDonutCard("보유 종목 비중", labels.toArray(new String[0]), toDoubleArray(values), toIntArray(colors));
    }

    private void addHoldingDonut(String accountId, String title) {
        List<String> labels = new ArrayList<>();
        List<Double> values = new ArrayList<>();
        List<Integer> colors = new ArrayList<>();
        int[] palette = piePalette();
        int colorIndex = 0;
        for (Holding holding : ledger.holdings(accountId).values()) {
            double price = ledger.valuationPrice(accountId, holding, repository);
            double value = holding.quantity * price;
            double krw = "USD".equals(holding.currency) ? value * repository.usdKrw : value;
            if (krw > 0) {
                labels.add(holding.symbol);
                values.add(krw);
                colors.add(palette[colorIndex % palette.length]);
                colorIndex++;
            }
        }
        if (values.isEmpty()) {
            return;
        }
        addDonutCard(title, labels.toArray(new String[0]), toDoubleArray(values), toIntArray(colors));
    }

    private void addDonutCard(String title, String[] labels, double[] values, int[] colors) {
        LinearLayout card = Ui.card(this);
        card.addView(Ui.text(this, title, 17, Ui.TEXT, Typeface.BOLD));
        double total = 0;
        for (double value : values) {
            total += Math.max(0, value);
        }
        DonutChartView chart = new DonutChartView(this);
        chart.setCompact(total <= 0);
        chart.setSegments(values, colors);
        card.addView(chart, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                Ui.dp(this, total <= 0 ? 126 : 178)
        ));
        if (total <= 0) {
            card.addView(Ui.text(this, "아직 표시할 자산 비중이 없습니다.", 14, Ui.MUTED, Typeface.NORMAL));
        } else {
            for (int index = 0; index < labels.length && index < values.length && index < colors.length; index++) {
                addPieLegendRow(card, labels[index], values[index], total, colors[index]);
            }
        }
        content.addView(card);
    }

    private void addPieLegendRow(LinearLayout parent, String label, double value, double total, int color) {
        LinearLayout row = Ui.horizontal(this);
        row.setPadding(0, Ui.dp(this, 4), 0, Ui.dp(this, 4));
        row.addView(Ui.colorDot(this, color));
        TextView name = Ui.text(this, label, 14, Ui.TEXT, Typeface.BOLD);
        name.setPadding(Ui.dp(this, 10), 0, 0, 0);
        row.addView(name, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        TextView percent = Ui.mono(this, percentage(value, total), 14, Ui.MUTED, Typeface.BOLD);
        percent.setGravity(Gravity.END);
        row.addView(percent, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        parent.addView(row);
    }

    private int[] piePalette() {
        return new int[]{
                Color.rgb(66, 133, 244),
                Color.rgb(88, 214, 141),
                Color.rgb(255, 82, 82),
                Color.rgb(255, 171, 64),
                Color.rgb(213, 63, 242),
                Color.rgb(72, 219, 196),
                Color.rgb(255, 213, 79),
                Color.rgb(83, 109, 254)
        };
    }

    private String shortAccountName(String accountId) {
        if (LedgerStore.ACCOUNT_US.equals(accountId)) {
            return "미국";
        }
        if (LedgerStore.ACCOUNT_KR.equals(accountId)) {
            return "한국";
        }
        return "ETF";
    }

    private double[] toDoubleArray(List<Double> values) {
        double[] array = new double[values.size()];
        for (int index = 0; index < values.size(); index++) {
            array[index] = values.get(index);
        }
        return array;
    }

    private int[] toIntArray(List<Integer> values) {
        int[] array = new int[values.size()];
        for (int index = 0; index < values.size(); index++) {
            array[index] = values.get(index);
        }
        return array;
    }

    private GradientDrawable roundedBackground(int color, int radius) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(radius);
        return drawable;
    }

    private StrategySignal firstBuySignal() {
        for (StrategySignal signal : repository.signals) {
            if ("buy".equals(signal.actionType)) {
                return signal;
            }
        }
        return null;
    }

    private void showBuySignalPicker() {
        List<StrategySignal> signals = new ArrayList<>();
        List<String> labels = new ArrayList<>();
        for (StrategySignal signal : repository.signals) {
            String accountId = ledger.defaultAccountIdForMarket(signal.market);
            if ("buy".equals(signal.actionType) && signalMatchesSelectedStrategy(signal, accountId)) {
                signals.add(signal);
                labels.add(shortAccountName(accountId) + " · " + signal.name + " · " + signal.symbol);
            }
        }
        if (signals.isEmpty()) {
            Toast.makeText(this, "선택한 전략의 매수 신호가 없습니다.", Toast.LENGTH_SHORT).show();
            return;
        }
        new AlertDialog.Builder(this)
                .setTitle("매수 신호 선택")
                .setItems(labels.toArray(new String[0]), (dialog, which) -> showTradeDialog(signals.get(which), "buy"))
                .setNegativeButton("취소", null)
                .show();
    }

    private void showDividendPicker() {
        List<Account> accounts = new ArrayList<>();
        List<Holding> holdings = new ArrayList<>();
        List<String> labels = new ArrayList<>();
        for (Account account : ledger.accounts()) {
            for (Holding holding : ledger.holdings(account.id).values()) {
                accounts.add(account);
                holdings.add(holding);
                labels.add(account.name + " · " + holding.name + " · " + holding.symbol);
            }
        }
        if (holdings.isEmpty()) {
            Toast.makeText(this, "배당을 기록할 보유 종목이 없습니다.", Toast.LENGTH_SHORT).show();
            return;
        }
        new AlertDialog.Builder(this)
                .setTitle("배당 종목 선택")
                .setItems(labels.toArray(new String[0]), (dialog, which) -> showDividendDialog(accounts.get(which), holdings.get(which)))
                .setNegativeButton("취소", null)
                .show();
    }

    private void showDividendDialog(Account account, Holding holding) {
        LinearLayout form = dialogForm();
        form.addView(Ui.text(this, account.name, 14, account.color, Typeface.BOLD));
        LinearLayout info = Ui.band(this);
        info.addView(Ui.text(this, holding.name + " · " + holding.symbol, 16, Ui.TEXT, Typeface.BOLD));
        info.addView(Ui.text(this, "배당 통화: " + holding.currency + " · 세후 금액은 현금에 자동 반영됩니다.", 13, Ui.MUTED, Typeface.NORMAL));
        form.addView(info);

        EditText gross = input("세전 배당 금액", "");
        EditText tax = input("배당세 금액", "0");
        EditText memo = input("메모 (선택)", "");
        TextView preview = Ui.text(this, "세전 배당과 세금을 입력하세요.", 13, Ui.MUTED, Typeface.BOLD);
        addLabeledInput(form, "세전 배당", gross);
        addLabeledInput(form, "원천징수세/세금", tax);
        form.addView(preview);
        addLabeledInput(form, "메모", memo);

        Runnable refresh = () -> refreshDividendPreview(preview, holding.currency, gross, tax);
        addAfterTextChanged(gross, refresh);
        addAfterTextChanged(tax, refresh);
        refresh.run();

        AlertDialog dividendDialog = new AlertDialog.Builder(this)
                .setTitle("배당 기록")
                .setView(form)
                .setPositiveButton("저장", null)
                .setNegativeButton("취소", null)
                .create();
        dividendDialog.setOnShowListener(dialog -> dividendDialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
            double grossValue = number(gross);
            double taxValue = number(tax);
            if (grossValue <= 0 || taxValue < 0 || taxValue > grossValue + 0.000001) {
                Toast.makeText(this, "세전 배당과 세금을 다시 확인하세요.", Toast.LENGTH_LONG).show();
                return;
            }
            ValidationResult result = ledger.addDividendEvent(
                    account.id,
                    holding.symbol,
                    holding.name,
                    holding.market,
                    holding.currency,
                    grossValue,
                    taxValue,
                    memoValue(memo, "배당 기록"),
                    repository.usdKrw
            );
            Toast.makeText(this, result.message, result.ok ? Toast.LENGTH_SHORT : Toast.LENGTH_LONG).show();
            if (result.ok) {
                captureAssetSnapshot("dividend_record");
                dividendDialog.dismiss();
                showRecord();
            }
        }));
        dividendDialog.show();
    }

    private void showReconciliationPicker() {
        List<Account> accounts = new ArrayList<>();
        List<Holding> holdings = new ArrayList<>();
        List<String> labels = new ArrayList<>();
        for (Account account : ledger.accounts()) {
            for (Holding holding : ledger.holdings(account.id).values()) {
                accounts.add(account);
                holdings.add(holding);
                labels.add(account.name + " · " + holding.name + " · 앱 " + formatPlain(holding.quantity) + "주");
            }
        }
        if (holdings.isEmpty()) {
            Toast.makeText(this, "대조할 보유 종목이 없습니다.", Toast.LENGTH_SHORT).show();
            return;
        }
        new AlertDialog.Builder(this)
                .setTitle("증권사 보유 대조")
                .setItems(labels.toArray(new String[0]), (dialog, which) -> showReconciliationDialog(accounts.get(which), holdings.get(which)))
                .setNegativeButton("취소", null)
                .show();
    }

    private void showReconciliationDialog(Account account, Holding holding) {
        double appAverage = holding.quantity <= 0 ? 0 : holding.cost / holding.quantity;
        LinearLayout form = dialogForm();
        form.addView(Ui.text(this, account.name, 14, account.color, Typeface.BOLD));
        LinearLayout info = Ui.band(this);
        info.addView(Ui.text(this, holding.name + " · " + holding.symbol, 16, Ui.TEXT, Typeface.BOLD));
        info.addView(Ui.text(this, "앱 수량 " + formatPlain(holding.quantity) + "주 · 앱 평단 " + formatMoney(appAverage, holding.currency), 13, Ui.MUTED, Typeface.NORMAL));
        form.addView(info);
        EditText brokerQuantity = input("증권사 보유 수량", formatPlain(holding.quantity));
        EditText brokerAverage = input("증권사 평균단가", appAverage <= 0 ? "" : String.valueOf(appAverage));
        addLabeledInput(form, "증권사 수량", brokerQuantity);
        addLabeledInput(form, "증권사 평균단가", brokerAverage);
        new AlertDialog.Builder(this)
                .setTitle("보유 대조")
                .setView(form)
                .setPositiveButton("대조", (dialog, which) -> {
                    double quantity = number(brokerQuantity);
                    double average = number(brokerAverage);
                    double brokerCost = quantity * average;
                    double quantityDiff = quantity - holding.quantity;
                    double costDiff = brokerCost - holding.cost;
                    LedgerEntry latestBuy = latestBuyEntry(account.id, holding.symbol);
                    String message = "수량 차이: " + formatPlain(quantityDiff) + "주\n"
                            + "원금 차이: " + formatMoney(costDiff, holding.currency) + "\n\n"
                            + (latestBuy == null
                            ? "차이가 있으면 기존 기록을 취소하고 정확한 체결 기록을 다시 남기세요."
                            : "최근 매수 기록: " + latestBuy.createdAt + " · " + formatPlain(latestBuy.quantity) + "주");
                    AlertDialog.Builder resultBuilder = new AlertDialog.Builder(this)
                            .setTitle("대조 결과")
                            .setMessage(message)
                            .setPositiveButton("확인", null);
                    if (latestBuy != null && (Math.abs(quantityDiff) > 0.000001 || Math.abs(costDiff) > 1)) {
                        resultBuilder.setNegativeButton("최근 매수 정정", (resultDialog, resultWhich) -> showCorrectBuyDialog(latestBuy));
                    }
                    resultBuilder.show();
                })
                .setNegativeButton("취소", null)
                .show();
    }

    private LedgerEntry latestBuyEntry(String accountId, String symbol) {
        for (LedgerEntry entry : ledger.entries(accountId)) {
            if ("buy".equals(entry.type) && symbol.equals(entry.symbol) && !isVoided(entry)) {
                return entry;
            }
        }
        return null;
    }

    private boolean canUseTradingData(StrategySignal signal) {
        return repository.canTradeSymbol(signal.symbol);
    }

    private boolean canUseEtfTradingData() {
        if (!"normal".equals(repository.status) || !"normal".equals(repository.fxStatus)) {
            return false;
        }
        if (repository.etfTargets.isEmpty()) {
            return false;
        }
        for (EtfTarget target : repository.etfTargets) {
            if (!repository.isQuoteReliable(target.symbol)) {
                return false;
            }
        }
        return true;
    }

    private boolean hasEtfRebalanceAction(String accountId) {
        double total = accountValueInCurrency(accountId, "KRW");
        for (EtfTarget target : repository.etfTargets) {
            EtfRebalancePlan plan = etfRebalancePlan(target, accountId, total);
            if (!"유지".equals(plan.actionText) && plan.quantity > 0) {
                return true;
            }
        }
        return false;
    }

    private boolean rejectTradeInput(StrategySignal signal, String side, double quantity, double price, double fee, double reference) {
        if (requiresReliableTradingData(signal) && !canUseTradingData(signal)) {
            showDataLockedDialog(signal.name + " 체결 기록");
            return true;
        }
        if (quantity <= 0 || price <= 0 || fee < 0) {
            Toast.makeText(this, "수량, 평균단가, 비용을 다시 확인하세요.", Toast.LENGTH_LONG).show();
            return true;
        }
        if (reference > 0 && (price > reference * 3 || price < reference * 0.25)) {
            Toast.makeText(this, "체결가는 1주 평균단가로 입력하세요. 총 매입금액을 체결가 칸에 넣은 것 같으면 수량과 단가를 나눠 입력해야 합니다.", Toast.LENGTH_LONG).show();
            return true;
        }
        return false;
    }

    private boolean rejectTradeCorrectionInput(double quantity, double price, double fee, double reference) {
        if (quantity <= 0 || price <= 0 || fee < 0) {
            Toast.makeText(this, "수량, 평균단가, 비용을 다시 확인하세요.", Toast.LENGTH_LONG).show();
            return true;
        }
        if (reference > 0 && (price > reference * 3 || price < reference * 0.25)) {
            Toast.makeText(this, "정정 평균단가가 현재 기준가와 크게 다릅니다. 총 매입금액을 단가 칸에 넣은 것은 아닌지 확인하세요.", Toast.LENGTH_LONG).show();
            return true;
        }
        return false;
    }

    private boolean requiresReliableTradingData(StrategySignal signal) {
        if (signal == null) {
            return false;
        }
        String key = signal.strategyKey == null ? "" : signal.strategyKey;
        return !key.startsWith("manual_");
    }

    private double recommendedBuyQuantity(double target, double reference) {
        return StrategyMath.recommendedBuyQuantity(target, reference);
    }

    private OrderPlan orderPlan(StrategySignal signal, String accountId) {
        Account account = ledger.account(accountId);
        double available = ledger.cash(accountId, signal.currency);
        double target = plannedOrderValue(signal, accountId);
        double executed = executedOrderValue(signal, accountId);
        if ("buy".equals(signal.actionType) && executed > 0 && ledger.orderTargetSnapshot(accountId, signal) <= 0 && target > 0) {
            ledger.saveOrderTargetSnapshot(accountId, signal, target);
        }
        double totalInvested = investedForSignalAccount(signal, accountId);
        double capLimit = capLimitValue(signal, accountId);
        double reference = repository.referencePrice(signal.symbol);
        return StrategyMath.orderPlan(target, executed, available, feeBuffer(signal, account, available), capLimit, totalInvested, reference);
    }

    private double plannedOrderValue(StrategySignal signal, String accountId) {
        double snapshot = ledger.orderTargetSnapshot(accountId, signal);
        if (snapshot > 0) {
            return snapshot;
        }
        Account account = ledger.account(accountId);
        double availableAtStart = availableAtSignalStart(accountId, signal);
        if ("KR_ETF".equals(signal.market) || "rebalance".equals(signal.actionType)) {
            return Math.max(0, availableAtStart * 0.95);
        }
        if ("US_STOCK".equals(signal.market)
                && StrategyMath.isUsCap275Strategy(signal.strategyKey)) {
            return plannedUsCap275OrderValue(signal, accountId, availableAtStart);
        }
        if ("KR_STOCK".equals(signal.market) && StrategyMath.STRATEGY_KR_LEADER2.equals(signal.strategyKey)) {
            return plannedKrLeader2OrderValue(signal, accountId, availableAtStart);
        }
        double slots = "US_STOCK".equals(signal.market) ? 2 : 2;
        double buffer = "USD".equals(account.baseCurrency) ? 50 : 30000;
        return Math.max(0, (availableAtStart - buffer) / slots);
    }

    private double plannedUsCap275OrderValue(StrategySignal signal, String accountId, double availableAtStart) {
        return StrategyMath.plannedUsCap275OrderValue(
                accountValueInCurrency(accountId, signal.currency),
                availableAtStart,
                buyEntryCountBeforeSignal(accountId, signal),
                symbolBuyEntryCountBeforeSignal(accountId, signal.symbol, signal),
                signal.symbol,
                signal.sector,
                investedBeforeSignal(signal, accountId)
        );
    }

    private double usBaseBuyRatio(double equity, double available, int buyEntryCount) {
        return StrategyMath.usBaseBuyRatio(equity, available, buyEntryCount);
    }

    private double plannedKrLeader2OrderValue(StrategySignal signal, String accountId, double availableAtStart) {
        int signalCount = Math.max(1, buySignalCount(signal.market, signal.strategyKey));
        return StrategyMath.plannedKrLeader2OrderValue(
                accountValueInCurrency(accountId, signal.currency),
                availableAtStart,
                buyEntryCountBeforeSignal(accountId, signal),
                signalCount,
                investedBeforeSignal(signal, accountId)
        );
    }

    private int buySignalCount(String market, String strategyKey) {
        int count = 0;
        for (StrategySignal signal : repository.signals) {
            if ("buy".equals(signal.actionType)
                    && market.equals(signal.market)
                    && strategyKey.equals(signal.strategyKey)) {
                count++;
            }
        }
        return count;
    }

    private double usRepeatThemeMultiplier(StrategySignal signal, int previous) {
        return StrategyMath.usRepeatThemeMultiplier(signal.symbol, signal.sector, previous);
    }

    private boolean isAiHardware(StrategySignal signal) {
        return StrategyMath.isAiHardware(signal.symbol, signal.sector);
    }

    private boolean isDefensiveOrWeakSector(String sector) {
        return StrategyMath.isDefensiveOrWeakSector(sector);
    }

    private int buyEntryCountBeforeSignal(String accountId, StrategySignal signal) {
        int count = 0;
        String start = signalStartDate(signal);
        for (LedgerEntry entry : ledger.entries(accountId)) {
            if ("buy".equals(entry.type) && !isVoided(entry) && isBeforeSignalStart(entry, start)) {
                count++;
            }
        }
        return count;
    }

    private int symbolBuyEntryCountBeforeSignal(String accountId, String symbol, StrategySignal signal) {
        int count = 0;
        String start = signalStartDate(signal);
        for (LedgerEntry entry : ledger.entries(accountId)) {
            if ("buy".equals(entry.type) && !isVoided(entry) && symbol.equals(entry.symbol) && isBeforeSignalStart(entry, start)) {
                count++;
            }
        }
        return count;
    }

    private double availableAtSignalStart(String accountId, StrategySignal signal) {
        double available = ledger.cash(accountId, signal.currency);
        String start = signalStartDate(signal);
        if (start.isEmpty()) {
            return available;
        }
        for (LedgerEntry entry : ledger.entries(accountId)) {
            if (isVoided(entry) || !signal.currency.equals(entry.currency) || !isOnOrAfterSignalStart(entry, start)) {
                continue;
            }
            if ("buy".equals(entry.type)) {
                available += tradeCost(entry);
            } else if ("sell".equals(entry.type)) {
                available -= tradeProceeds(entry);
            }
        }
        return Math.max(0, available);
    }

    private double executedOrderValue(StrategySignal signal, String accountId) {
        double executed = 0;
        String start = signalStartDate(signal);
        for (HoldingLot lot : ledger.lots(accountId, signal.symbol)) {
            if (!isCurrentSignalLot(lot, signal, start)) {
                continue;
            }
            executed += Math.max(0, lot.remainingCost);
        }
        return executed;
    }

    private double executedOrderQuantity(StrategySignal signal, String accountId) {
        double quantity = 0;
        String start = signalStartDate(signal);
        for (HoldingLot lot : ledger.lots(accountId, signal.symbol)) {
            if (!isCurrentSignalLot(lot, signal, start)) {
                continue;
            }
            quantity += Math.max(0, lot.remainingQuantity);
        }
        return quantity;
    }

    private boolean isCurrentSignalLot(HoldingLot lot, StrategySignal signal, String start) {
        if (lot == null || lot.remainingQuantity <= 0.000001) {
            return false;
        }
        if (!signal.symbol.equals(lot.symbol) || !signal.currency.equals(lot.currency)) {
            return false;
        }
        if (lot.signalId != null && !lot.signalId.trim().isEmpty()) {
            return signal.signalId.equals(lot.signalId);
        }
        if (lot.strategyKey != null && !lot.strategyKey.trim().isEmpty() && !signal.strategyKey.equals(lot.strategyKey)) {
            return false;
        }
        return isOnOrAfterSignalStart(lot.openedDate, start) && isOnOrBeforeSignalEnd(lot.openedDate, signal.validUntil);
    }

    private double investedBeforeSignal(StrategySignal signal, String accountId) {
        return Math.max(0, investedForSignalAccount(signal, accountId) - executedOrderValue(signal, accountId));
    }

    private double capLimitValue(StrategySignal signal, String accountId) {
        double equity = accountValueInCurrency(accountId, signal.currency);
        if (equity <= 0) {
            return 0;
        }
        if ("US_STOCK".equals(signal.market) && StrategyMath.isUsCap275Strategy(signal.strategyKey)) {
            return equity * 0.275;
        }
        if ("KR_STOCK".equals(signal.market) && StrategyMath.STRATEGY_KR_LEADER2.equals(signal.strategyKey)) {
            return equity * 0.225;
        }
        return 0;
    }

    private double feeBuffer(StrategySignal signal, Account account, double available) {
        if ("US_STOCK".equals(signal.market)) {
            return Math.min(50, Math.max(0, available * 0.005));
        }
        if ("KR_STOCK".equals(signal.market)) {
            return Math.min(30000, Math.max(0, available * 0.003));
        }
        return "USD".equals(account.baseCurrency)
                ? Math.min(50, Math.max(0, available * 0.005))
                : Math.min(30000, Math.max(0, available * 0.003));
    }

    private boolean isBeforeSignalStart(LedgerEntry entry, String start) {
        if (start.isEmpty()) {
            return true;
        }
        String date = entryDate(entry);
        return !date.isEmpty() && date.compareTo(start) < 0;
    }

    private boolean isOnOrAfterSignalStart(LedgerEntry entry, String start) {
        return isOnOrAfterSignalStart(entryDate(entry), start);
    }

    private boolean isOnOrBeforeSignalEnd(LedgerEntry entry, String end) {
        return isOnOrBeforeSignalEnd(entryDate(entry), end);
    }

    private boolean isOnOrAfterSignalStart(String date, String start) {
        if (start.isEmpty()) {
            return false;
        }
        return date != null && !date.isEmpty() && date.compareTo(start) >= 0;
    }

    private boolean isOnOrBeforeSignalEnd(String date, String end) {
        if (end == null || end.trim().isEmpty()) {
            return true;
        }
        return date != null && !date.isEmpty() && date.compareTo(end.substring(0, Math.min(10, end.length()))) <= 0;
    }

    private String signalStartDate(StrategySignal signal) {
        if (signal.validFrom != null && signal.validFrom.length() >= 10) {
            return signal.validFrom.substring(0, 10);
        }
        if (repository.signalMonth != null && repository.signalMonth.length() >= 7) {
            return repository.signalMonth.substring(0, 7) + "-01";
        }
        return "";
    }

    private String entryDate(LedgerEntry entry) {
        return entry.createdAt != null && entry.createdAt.length() >= 10 ? entry.createdAt.substring(0, 10) : "";
    }

    private boolean isVoided(LedgerEntry entry) {
        return entry.voidedAt != null && !entry.voidedAt.trim().isEmpty();
    }

    private double tradeCost(LedgerEntry entry) {
        return Math.max(0, entry.amount) + Math.max(0, entry.fee);
    }

    private double tradeProceeds(LedgerEntry entry) {
        if (entry.netProceeds > 0) {
            return entry.netProceeds;
        }
        return Math.max(0, entry.amount - entry.fee);
    }

    private double accountValueInCurrency(String accountId, String currency) {
        double valueKrw = ledger.accountTotalKrw(accountId, repository);
        if ("USD".equals(currency)) {
            return repository.usdKrw <= 0 ? 0 : valueKrw / repository.usdKrw;
        }
        return valueKrw;
    }

    private EtfRebalancePlan etfRebalancePlan(EtfTarget target, String accountId, double total) {
        double price = repository.referencePrice(target.symbol);
        Holding holding = ledger.holdings(accountId).get(target.symbol);
        double currentValue = holding == null ? 0 : holding.quantity * price;
        StrategySignal signal = etfRebalanceSignal();
        double minTradeAmount = signal == null || signal.minTradeAmount <= 0 ? 50000 : signal.minTradeAmount;
        double driftThreshold = signal == null || signal.driftThreshold <= 0 ? 0.015 : signal.driftThreshold;
        EtfRebalancePlan plan = StrategyMath.etfRebalancePlan(total, target.targetWeight, currentValue, price, minTradeAmount, driftThreshold, "유지", "매수", "매도");
        String actionText = plan.actionText;
        int color = "유지".equals(actionText) ? Ui.SUCCESS : "매수".equals(actionText) ? Ui.PRIMARY : Ui.DANGER;
        return plan.withColor(color);
    }

    private StrategySignal etfRebalanceSignal() {
        String selected = selectedStrategyKey(LedgerStore.ACCOUNT_PENSION);
        for (StrategySignal signal : repository.signals) {
            if ("KR_ETF".equals(signal.market)
                    && "rebalance".equals(signal.actionType)
                    && selected.equals(signal.strategyKey)) {
                return signal;
            }
        }
        for (StrategySignal signal : repository.signals) {
            if ("KR_ETF".equals(signal.market) && "rebalance".equals(signal.actionType)) {
                return signal;
            }
        }
        return null;
    }

    private double investedForSignalAccount(StrategySignal signal, String accountId) {
        Holding holding = ledger.holdings(accountId).get(signal.symbol);
        return holding == null ? 0 : holding.cost;
    }

    private String validationText(StrategySignal signal, OrderPlan plan) {
        return validationText(signal, plan.targetOrderValue, plan.executedOrderValue, plan.totalInvestedValue, plan.capLimitValue);
    }

    private boolean isBuyPlanComplete(StrategySignal signal, OrderPlan plan) {
        if (signal == null || plan == null || !"buy".equals(signal.actionType)) {
            return false;
        }
        String status = validationText(signal, plan);
        return status.startsWith("완료") && StrategyMath.isBuyActionComplete(plan.executedOrderValue, plan.additionalQuantity);
    }

    private boolean needsCashInputForBuy(StrategySignal signal, String accountId, OrderPlan plan) {
        if (signal == null || plan == null || !"buy".equals(signal.actionType)) {
            return false;
        }
        double cash = ledger.cash(accountId, signal.currency);
        Account account = ledger.account(accountId);
        double feeRoom = feeBuffer(signal, account, Math.max(0, cash));
        if (plan.targetOrderValue <= 0 && plan.executedOrderValue <= 0) {
            return cash <= feeRoom + 0.000001;
        }
        if (plan.remainingOrderValue > 0.000001 && plan.additionalQuantity <= 0) {
            double reference = repository.referencePrice(signal.symbol);
            if (cash <= feeRoom + 0.000001) {
                return true;
            }
            return reference > 0
                    && plan.remainingOrderValue >= reference
                    && cash < reference + feeRoom;
        }
        return false;
    }

    private String cashNeededText(StrategySignal signal, String accountId, OrderPlan plan) {
        double cash = ledger.cash(accountId, signal.currency);
        if (plan.targetOrderValue <= 0 && plan.executedOrderValue <= 0) {
            return "예수금 없음 · 입금 후 계산";
        }
        return "현금 " + formatMoney(cash, signal.currency) + " · 입금 필요";
    }

    private int statusColor(String status, int fallback) {
        if (status == null) {
            return fallback;
        }
        if (status.startsWith("완료")) {
            return Ui.SUCCESS;
        }
        if (status.startsWith("확인") || status.startsWith("수동")) {
            return Ui.WARNING;
        }
        if (status.startsWith("조정") || status.startsWith("목표 없음")) {
            return Ui.DANGER;
        }
        return fallback;
    }

    private String validationText(StrategySignal signal, double target, double actual, double totalInvested, double capLimit) {
        String currency = signal.currency;
        double referencePrice = repository.referencePrice(signal.symbol);
        if (target <= 0 && actual <= 0) {
            return "현금 입력 후 검증 가능";
        }
        if (target <= 0) {
            return "목표 없음";
        }
        if (referencePrice > 0 && target < referencePrice && actual <= 0) {
            return "수동 확인 필요: 1주 가격이 목표 원금보다 큼";
        }
        double minUnit = "USD".equals(currency) ? 50 : 30000;
        if (referencePrice > 0) {
            minUnit = Math.max(minUnit, referencePrice);
        }
        double tolerance = Math.max(target * 0.05, minUnit);
        if (actual + tolerance < target) {
            return "조정 필요: " + formatMoney(target - actual, currency) + " 부족";
        }
        if (isStockBuySignal(signal)) {
            double capTolerance = capLimit <= 0 ? 0 : Math.max(capLimit * 0.01, minUnit);
            if (capLimit > 0 && totalInvested > capLimit + capTolerance) {
                return "조정 필요: 종목 한도 " + formatMoney(totalInvested - capLimit, currency) + " 초과";
            }
            if (actual <= target + tolerance) {
                return "완료: 목표 범위";
            }
            return "확인 필요: 목표보다 " + formatMoney(actual - target, currency) + " 초과"
                    + (capLimit > 0 ? " · 한도 이내" : "");
        }
        double diff = Math.abs(actual - target);
        if (diff <= tolerance) {
            return "완료: 목표 범위";
        }
        if (actual < target) {
            return "조정 필요: " + formatMoney(target - actual, currency) + " 부족";
        }
        return "조정 필요: " + formatMoney(actual - target, currency) + " 초과";
    }

    private boolean isStockBuySignal(StrategySignal signal) {
        return "buy".equals(signal.actionType)
                && ("US_STOCK".equals(signal.market) || "KR_STOCK".equals(signal.market));
    }

    private String validationText(StrategySignal signal, double target, double actual) {
        return validationText(target, actual, signal.currency, repository.referencePrice(signal.symbol));
    }

    private String validationText(double target, double actual, String currency) {
        return validationText(target, actual, currency, 0);
    }

    private String validationText(double target, double actual, String currency, double referencePrice) {
        if (target <= 0 && actual <= 0) {
            return "현금 입력 후 검증 가능";
        }
        if (target <= 0) {
            return "목표 없음";
        }
        if (referencePrice > 0 && target < referencePrice && actual <= 0) {
            return "수동 확인 필요: 1주 가격이 목표 원금보다 큼";
        }
        double diff = Math.abs(actual - target);
        double ratio = diff / target;
        if (ratio <= 0.05) {
            return "완료: 목표 대비 5% 이내";
        }
        double minUnit = "USD".equals(currency) ? 50 : 30000;
        if (referencePrice > 0) {
            minUnit = Math.max(minUnit, referencePrice);
        }
        if (diff <= minUnit) {
            return "현실적 완료: 최소 주문 단위 이내";
        }
        if (actual < target) {
            return "조정 필요: " + formatMoney(target - actual, currency) + " 부족";
        }
        return "조정 필요: " + formatMoney(actual - target, currency) + " 초과";
    }

    private String accountIdForTrend(WeeklyTrend trend) {
        if ("US_STOCK".equals(trend.market)) {
            return LedgerStore.ACCOUNT_US;
        }
        if ("KR_ETF".equals(trend.market)) {
            return LedgerStore.ACCOUNT_PENSION;
        }
        return LedgerStore.ACCOUNT_KR;
    }

    private String strategyLabel(String accountId) {
        String selected = selectedStrategyKey(accountId);
        String[] keys = strategyKeys(accountId);
        String[] labels = strategyLabels(accountId);
        for (int index = 0; index < keys.length; index++) {
            if (keys[index].equals(selected)) {
                return labels[index].replace(" · 신호 준비됨", "").replace(" · 후보", "").replace(" · 연구", "");
            }
        }
        return labels[0];
    }

    private String strategyDescription(String accountId) {
        String selected = selectedStrategyKey(accountId);
        if (defaultStrategyKey(accountId).equals(selected)) {
            if (LedgerStore.ACCOUNT_US.equals(accountId)) {
                return "현재 추천 패키지는 Leader2 + Repeat Theme Combo Cap27.5 기준으로 생성됩니다.";
            }
            if (LedgerStore.ACCOUNT_PENSION.equals(accountId)) {
                return "현재 추천 패키지는 KR ETF Benchmark Or Alpha Defensive 기준으로 생성됩니다. KODEX200이 강하면 국내 알파 ETF 1위, 약하면 방어 ETF 1위에 100% 리밸런싱합니다.";
            }
            return "현재 추천 패키지는 KR Stock Leader2 기준으로 생성됩니다.";
        }
        if (LedgerStore.ACCOUNT_US.equals(accountId) && StrategyMath.STRATEGY_US_SCORE_C_CAP_27_5.equals(selected)) {
            return "Score C 후보 전략입니다. 종목 점수에서 섹터/테마 비중을 절반으로 낮추고, Cap27.5 자금배분과 매도 규칙은 기존과 동일하게 적용합니다.";
        }
        return "선택한 연구 전략은 앱에서 선택은 가능하지만, 추천주와 비중 가이드를 내려면 GitHub Actions 신호 패키지 확장이 필요합니다.";
    }

    private String strategyVersionText(StrategySignal signal) {
        List<String> parts = new ArrayList<>();
        if (!signal.strategyStatus.isEmpty()) {
            parts.add(signal.strategyStatus);
        }
        if (!signal.scoreFormulaVersion.isEmpty()) {
            parts.add(signal.scoreFormulaVersion);
        }
        if (!signal.universeHash.isEmpty()) {
            parts.add("u:" + shortHash(signal.universeHash));
        }
        if (!signal.dataAsOf.isEmpty()) {
            parts.add(signal.dataAsOf);
        }
        return String.join(" · ", parts);
    }

    private String conciseSignalMeta(StrategySignal signal, String accountId) {
        List<String> parts = new ArrayList<>();
        if (ledger.orderTargetSnapshot(accountId, signal) > 0) {
            parts.add("월간 스냅샷");
        }
        if (!signal.strategyStatus.isEmpty() && !"active".equals(signal.strategyStatus)) {
            parts.add(signal.strategyStatus);
        }
        if (!signal.dataAsOf.isEmpty()) {
            parts.add("데이터 " + signal.dataAsOf);
        }
        return join(parts, " · ");
    }

    private String shortHash(String value) {
        return value.length() <= 8 ? value : value.substring(0, 8);
    }

    private boolean signalMatchesSelectedStrategy(StrategySignal signal, String accountId) {
        return signal.strategyKey.equals(selectedStrategyKey(accountId));
    }

    private String selectedStrategyKey(String accountId) {
        return ledger.selectedStrategyKey(accountId, defaultStrategyKey(accountId));
    }

    private String defaultStrategyKey(String accountId) {
        if (LedgerStore.ACCOUNT_US.equals(accountId)) {
            return StrategyMath.STRATEGY_US_CAP_27_5;
        }
        if (LedgerStore.ACCOUNT_PENSION.equals(accountId)) {
            return StrategyMath.STRATEGY_KR_ETF_BENCHMARK_OR_ALPHA_DEFENSIVE;
        }
        return "kr_stock_leader2";
    }

    private String[] strategyKeys(String accountId) {
        if (LedgerStore.ACCOUNT_US.equals(accountId)) {
            return new String[]{
                    StrategyMath.STRATEGY_US_CAP_27_5,
                    StrategyMath.STRATEGY_US_SCORE_C_CAP_27_5,
                    "us_repeat_theme_combo_cap30",
                    "us_conviction_diverse_top2"
            };
        }
        if (LedgerStore.ACCOUNT_PENSION.equals(accountId)) {
            return new String[]{
                    StrategyMath.STRATEGY_KR_ETF_BENCHMARK_OR_ALPHA_DEFENSIVE,
                    StrategyMath.STRATEGY_KR_ETF_BENCHMARK_OR_ALPHA,
                    StrategyMath.STRATEGY_KR_ETF_CORE_SATELLITE_50_40_10
            };
        }
        return new String[]{
                "kr_stock_leader2",
                "kr_stock_no_repeat"
        };
    }

    private String[] strategyLabels(String accountId) {
        if (LedgerStore.ACCOUNT_US.equals(accountId)) {
            return new String[]{
                    "Leader2 + Repeat Theme Combo Cap27.5 · 신호 준비됨",
                    "Leader2 Score C Cap27.5 · 후보",
                    "Repeat + Theme Combo Cap30 · 연구",
                    "Conviction Diverse Top2 · 연구"
            };
        }
        if (LedgerStore.ACCOUNT_PENSION.equals(accountId)) {
            return new String[]{
                    "KR ETF Benchmark Or Alpha Defensive · 신호 준비됨",
                    "KR ETF Benchmark Or Alpha · 비교",
                    "KR ETF Core/Satellite 50/40/10 · 이전"
            };
        }
        return new String[]{
                "KR Stock Leader2 · 신호 준비됨",
                "KR Stock No Repeat · 연구"
        };
    }

    private String entryLabel(String type) {
        if ("buy".equals(type)) {
            return "매수";
        }
        if ("sell".equals(type)) {
            return "매도";
        }
        if ("withdraw".equals(type)) {
            return "출금";
        }
        if ("fx".equals(type)) {
            return "환전";
        }
        if ("dividend".equals(type)) {
            return "배당";
        }
        if ("cancel".equals(type)) {
            return "정정";
        }
        return "입금";
    }

    private double number(EditText editText) {
        try {
            return Double.parseDouble(editText.getText().toString().trim().replace(",", ""));
        } catch (NumberFormatException error) {
            return 0;
        }
    }

    private String formatKrw(double value) {
        return valuesHidden ? "••••" : formatMoney(value, "KRW");
    }

    private String formatMoney(double value, String currency) {
        if (valuesHidden) {
            return "••••";
        }
        NumberFormat format = NumberFormat.getNumberInstance(Locale.KOREA);
        format.setMaximumFractionDigits("USD".equals(currency) ? 2 : 0);
        format.setMinimumFractionDigits("USD".equals(currency) ? 2 : 0);
        return ("USD".equals(currency) ? "$" : "₩") + format.format(value);
    }

    private String formatSignedMoney(double value, String currency) {
        if (valuesHidden) {
            return "••••";
        }
        if (Math.abs(value) <= 0.000001) {
            return formatMoney(0, currency);
        }
        return (value > 0 ? "+" : "-") + formatMoney(Math.abs(value), currency);
    }

    private String formatSignedCompactKrw(double value) {
        if (valuesHidden) {
            return "••••";
        }
        if (Math.abs(value) <= 0.000001) {
            return "₩0";
        }
        return (value > 0 ? "+" : "-") + compactKrw(Math.abs(value));
    }

    private String compactKrw(double value) {
        if (value >= 100_000_000) {
            return "₩" + formatPlain(value / 100_000_000) + "억";
        }
        if (value >= 10_000) {
            return "₩" + formatPlain(value / 10_000) + "만";
        }
        return formatMoney(value, "KRW");
    }

    private String formatPlain(double value) {
        NumberFormat format = NumberFormat.getNumberInstance(Locale.KOREA);
        format.setMaximumFractionDigits(2);
        return format.format(value);
    }

    private String formatPercent(double value) {
        return formatPlain(value * 100) + "%";
    }

    private String signedPercent(double value) {
        if (valuesHidden) {
            return "••••";
        }
        String sign = value > 0 ? "+" : "";
        return sign + formatPlain(value) + "%";
    }

    private String priceVsAverageText(double price, double averageBuyPrice) {
        if (averageBuyPrice <= 0 || price <= 0) {
            return "-";
        }
        double percent = (price / averageBuyPrice - 1) * 100;
        String sign = percent > 0 ? "+" : "";
        return sign + formatPlain(percent) + "%";
    }

    private String dayLabel(int days) {
        if (days > 0) {
            return "D-" + days;
        }
        if (days == 0) {
            return "오늘";
        }
        return "D+" + Math.abs(days);
    }

    private String lotNextEventText(HoldingLot lot) {
        if (lot.daysUntilSixMonth > 0) {
            return "다음 이벤트: 6개월 50% 매도까지 " + dayLabel(lot.daysUntilSixMonth);
        }
        if (lot.daysUntilTwelveMonth > 0) {
            return "6개월 기준 통과 · 주봉 훼손 또는 12개월 전량 매도를 감시합니다.";
        }
        return "12개월 기준 통과 · 전량 매도 검토 대상입니다.";
    }

    private String nextLotSummary(List<HoldingLot> lots, boolean trendBroken) {
        if (lots == null || lots.isEmpty()) {
            return "-";
        }
        int twelveDue = 0;
        int sixDue = 0;
        int weeklyDue = 0;
        int nearestSix = Integer.MAX_VALUE;
        int nearestTwelve = Integer.MAX_VALUE;
        for (HoldingLot lot : lots) {
            if (lot.twelveMonthDueQuantity() > 0.000001) {
                twelveDue++;
            } else if (lot.sixMonthDueQuantity() > 0.000001) {
                sixDue++;
            } else if (lot.weeklyBreakDueQuantity(trendBroken) > 0.000001) {
                weeklyDue++;
            }
            if (lot.daysUntilSixMonth > 0) {
                nearestSix = Math.min(nearestSix, lot.daysUntilSixMonth);
            }
            if (lot.daysUntilTwelveMonth > 0) {
                nearestTwelve = Math.min(nearestTwelve, lot.daysUntilTwelveMonth);
            }
        }
        String prefix = "lot " + lots.size() + "개 · ";
        if (twelveDue > 0) {
            return prefix + "12개월 전량 매도 " + twelveDue + "건";
        }
        if (sixDue > 0) {
            return prefix + "6개월 50% 매도 " + sixDue + "건";
        }
        if (weeklyDue > 0) {
            return prefix + "주봉 훼손 잔여 매도 " + weeklyDue + "건";
        }
        if (nearestSix != Integer.MAX_VALUE) {
            return prefix + "6개월 50% 매도까지 " + dayLabel(nearestSix);
        }
        if (nearestTwelve != Integer.MAX_VALUE) {
            return prefix + "12개월 전량 매도까지 " + dayLabel(nearestTwelve);
        }
        return prefix + "전량 매도 검토";
    }

    private HoldingLot findLotById(List<HoldingLot> lots, String lotId) {
        if (lotId == null || lotId.isEmpty()) {
            return null;
        }
        for (HoldingLot lot : lots) {
            if (lotId.equals(lot.lotId)) {
                return lot;
            }
        }
        return null;
    }

    private double sumLotQuantity(List<HoldingLot> lots) {
        double total = 0;
        for (HoldingLot lot : lots) {
            total += lot.remainingQuantity;
        }
        return total;
    }

    private String lotEventBadge(HoldingLot lot) {
        if (lot.twelveMonthDueQuantity() > 0.000001) {
            return "12개월";
        }
        if (lot.sixMonthDueQuantity() > 0.000001) {
            return "6개월";
        }
        if (lot.daysUntilSixMonth > 0) {
            return "D-" + lot.daysUntilSixMonth;
        }
        return "유지";
    }

    private void refreshSellPreview(TextView preview, String accountId, String symbol, String currency, EditText quantity, EditText price, EditText fee, String selectedLotId) {
        double actualQuantity = number(quantity);
        double actualPrice = number(price);
        double actualFee = number(fee);
        if (actualQuantity <= 0 || actualPrice <= 0 || actualFee < 0) {
            preview.setText("수량, 평균단가, 비용을 입력하면 예상 실현손익을 계산합니다.");
            preview.setTextColor(Ui.MUTED);
            return;
        }
        LotDisposition disposition = ledger.previewSellDisposition(accountId, symbol, actualQuantity, actualQuantity * actualPrice, actualFee, selectedLotId);
        applySellPreview(preview, disposition, currency);
    }

    private void refreshCorrectSellPreview(TextView preview, LedgerEntry entry, EditText quantity, EditText price, EditText fee, String selectedLotId) {
        double actualQuantity = number(quantity);
        double actualPrice = number(price);
        double actualFee = number(fee);
        if (actualQuantity <= 0 || actualPrice <= 0 || actualFee < 0) {
            preview.setText("수량, 평균단가, 비용을 입력하면 정정 후 실현손익을 계산합니다.");
            preview.setTextColor(Ui.MUTED);
            return;
        }
        LotDisposition disposition = ledger.previewCorrectSellDisposition(entry.id, actualQuantity, actualQuantity * actualPrice, actualFee, selectedLotId);
        applySellPreview(preview, disposition, entry.currency);
    }

    private void refreshDividendPreview(TextView preview, String currency, EditText gross, EditText tax) {
        double grossValue = number(gross);
        double taxValue = number(tax);
        if (grossValue <= 0) {
            preview.setText("세전 배당과 세금을 입력하세요.");
            preview.setTextColor(Ui.MUTED);
            return;
        }
        if (taxValue < 0 || taxValue > grossValue + 0.000001) {
            preview.setText("확인 필요: 세금은 세전 배당보다 클 수 없습니다.");
            preview.setTextColor(Ui.WARNING);
            return;
        }
        double net = grossValue - taxValue;
        preview.setText("세후 입금 " + formatMoney(net, currency)
                + " · 세율 " + formatPlain(grossValue <= 0 ? 0 : taxValue / grossValue * 100) + "%");
        preview.setTextColor(Ui.SUCCESS);
    }

    private void applySellPreview(TextView preview, LotDisposition disposition, String currency) {
        if (!disposition.ok) {
            preview.setText("확인 필요: " + disposition.message);
            preview.setTextColor(Ui.WARNING);
            return;
        }
        preview.setText("예상 실현손익 " + formatSignedMoney(disposition.realizedPnl, currency)
                + " · 원가 " + formatMoney(disposition.costBasis, currency)
                + " · 순입금 " + formatMoney(disposition.netProceeds, currency));
        preview.setTextColor(signedColor(disposition.realizedPnl));
    }

    private String lotChoiceText(List<HoldingLot> lots, String lotId, double availableQuantity) {
        HoldingLot lot = findLotById(lots, lotId);
        if (lot == null) {
            return "선택 lot: FIFO 자동 · 가능 " + formatPlain(availableQuantity) + "주";
        }
        double unitCost = lot.remainingQuantity <= 0 ? 0 : lot.remainingCost / lot.remainingQuantity;
        return "선택 lot: " + lot.openedDate
                + " 매수 · 잔여 " + formatPlain(lot.remainingQuantity) + "주"
                + " · 원가 " + formatMoney(unitCost, lot.currency);
    }

    private String lotModeLabel(LedgerEntry entry) {
        if ("specific".equals(entry.lotMode)) {
            return "직접 선택";
        }
        if ("fifo".equals(entry.lotMode)) {
            return "FIFO 자동";
        }
        return "-";
    }

    private String percentage(double value, double total) {
        if (valuesHidden || total <= 0) {
            return "-";
        }
        return formatPlain(value / total * 100) + "%";
    }

    private String safe(String value) {
        return value == null || value.isEmpty() ? "-" : value;
    }

    private static final class CashFlowBasis {
        double netContributionKrw;
        double usdContribution;
        double fxEffectKrw;
        boolean estimatedFxUsed;
    }

    private static final class LedgerAudit {
        boolean corruptLedger;
        boolean fxProblem;
        int activeEntryCount;
        int snapshotCount;
        int missingUsdCashFxCount;
        int missingFxEventRateCount;
        int averageCostValuationCount;
        int priceProblemCount;

        int issueCount() {
            int count = 0;
            if (corruptLedger) {
                count++;
            }
            if (fxProblem) {
                count++;
            }
            count += missingUsdCashFxCount;
            count += missingFxEventRateCount;
            count += averageCostValuationCount;
            count += priceProblemCount;
            return count;
        }

        String marketDataStatus() {
            if (fxProblem && priceProblemCount > 0) {
                return "가격 " + priceProblemCount + "건 · 환율 확인 필요";
            }
            if (priceProblemCount > 0) {
                return "가격 " + priceProblemCount + "건 확인";
            }
            if (fxProblem) {
                return "환율 확인 필요";
            }
            return "정상";
        }
    }

    private static final class LotAction {
        final String key;
        final String title;
        final String body;
        final String reason;
        final double quantity;
        final int color;

        LotAction(String key, String title, String body, String reason, double quantity, int color) {
            this.key = key;
            this.title = title;
            this.body = body;
            this.reason = reason;
            this.quantity = quantity;
            this.color = color;
        }
    }

    private final class ActionItem {
        final String actionKey;
        final String accountId;
        final String accountName;
        final String title;
        final String body;
        final String detail;
        final String primaryLabel;
        final int color;
        final Runnable primary;

        ActionItem(String actionKey, String accountId, String accountName, String title, String body, String detail, String primaryLabel, int color, Runnable primary) {
            this.actionKey = actionKey;
            this.accountId = accountId;
            this.accountName = accountName;
            this.title = title;
            this.body = body;
            this.detail = detail;
            this.primaryLabel = primaryLabel;
            this.color = color;
            this.primary = primary;
        }

        void runPrimary() {
            primary.run();
        }
    }
}
