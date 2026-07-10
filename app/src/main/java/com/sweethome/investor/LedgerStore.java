package com.sweethome.investor;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.TimeUnit;

final class LedgerStore {
    static final String ACCOUNT_US = "us_stock";
    static final String ACCOUNT_KR = "kr_stock";
    static final String ACCOUNT_PENSION = "pension_etf";

    private static final String PREFS = "investor_ledger";
    private static final String KEY_VERSION = "ledger_version";
    private static final String KEY_ENTRIES = "entries_v2";
    private static final String KEY_CORRUPT_ENTRIES = "corrupt_entries_backup";
    private static final String KEY_CORRUPT_MESSAGE = "corrupt_entries_message";
    private static final String KEY_SNOOZED_PREFIX = "snoozed_action_";
    private static final String KEY_PRE_IMPORT_ENTRIES = "pre_import_entries_backup";
    private static final String KEY_PRE_IMPORT_AT = "pre_import_at";
    private static final String KEY_ASSET_SNAPSHOTS = "asset_snapshots_v1";
    private static final String KEY_CORRUPT_ASSET_SNAPSHOTS = "corrupt_asset_snapshots_backup";
    private static final String KEY_ORDER_TARGETS = "order_targets_v1";
    private static final int MAX_ASSET_SNAPSHOTS = 420;
    private static final int CURRENT_PNL_BASIS_VERSION = 3;
    private static final String OLD_KEY_KRW_CASH = "krw_cash";
    private static final String OLD_KEY_USD_CASH = "usd_cash";

    private final SharedPreferences prefs;

    LedgerStore(Context context) {
        prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        migrateIfNeeded();
    }

    List<Account> accounts() {
        List<Account> accounts = new ArrayList<>();
        accounts.add(new Account(ACCOUNT_US, accountName(ACCOUNT_US, "미국 주식 계좌"), "USD", "미국 주식", Ui.ACCENT_US));
        accounts.add(new Account(ACCOUNT_KR, accountName(ACCOUNT_KR, "한국 주식 계좌"), "KRW", "한국 주식", Ui.ACCENT_KR));
        accounts.add(new Account(ACCOUNT_PENSION, accountName(ACCOUNT_PENSION, "연금 ETF 계좌"), "KRW", "한국 ETF", Ui.ACCENT_PENSION));
        return accounts;
    }

    Account account(String accountId) {
        for (Account account : accounts()) {
            if (account.id.equals(accountId)) {
                return account;
            }
        }
        return accounts().get(0);
    }

    String defaultAccountIdForMarket(String market) {
        if ("US_STOCK".equals(market)) {
            return ACCOUNT_US;
        }
        if ("KR_ETF".equals(market)) {
            return ACCOUNT_PENSION;
        }
        return ACCOUNT_KR;
    }

    double cash(String accountId, String currency) {
        return Double.longBitsToDouble(prefs.getLong(cashKey(accountId, currency), Double.doubleToLongBits(0)));
    }

    void setCash(String accountId, String currency, double amount) {
        prefs.edit().putLong(cashKey(accountId, currency), Double.doubleToLongBits(amount)).apply();
    }

    void setAccountName(String accountId, String name) {
        String trimmed = name == null ? "" : name.trim();
        if (!trimmed.isEmpty()) {
            prefs.edit().putString("account_name_" + accountId, trimmed).apply();
        }
    }

    boolean strategyEnabled(String accountId) {
        return prefs.getBoolean("strategy_enabled_" + accountId, true);
    }

    void setStrategyEnabled(String accountId, boolean enabled) {
        prefs.edit().putBoolean("strategy_enabled_" + accountId, enabled).apply();
    }

    String selectedStrategyKey(String accountId, String fallback) {
        return prefs.getString("selected_strategy_" + accountId, fallback);
    }

    void setSelectedStrategyKey(String accountId, String strategyKey) {
        prefs.edit().putString("selected_strategy_" + accountId, strategyKey).apply();
    }

    double orderTargetSnapshot(String accountId, StrategySignal signal) {
        if (signal == null) {
            return 0;
        }
        JSONObject item = readOrderTargets().optJSONObject(orderTargetKey(accountId, signal));
        return item == null ? 0 : Math.max(0, item.optDouble("target", 0));
    }

    void saveOrderTargetSnapshot(String accountId, StrategySignal signal, double target) {
        if (signal == null || target <= 0) {
            return;
        }
        String key = orderTargetKey(accountId, signal);
        JSONObject targets = readOrderTargets();
        if (targets.has(key)) {
            return;
        }
        JSONObject item = new JSONObject();
        try {
            item.put("accountId", accountId);
            item.put("signalId", signal.signalId);
            item.put("market", signal.market);
            item.put("strategyKey", signal.strategyKey);
            item.put("symbol", signal.symbol);
            item.put("currency", signal.currency);
            item.put("target", target);
            item.put("createdAt", now());
            targets.put(key, item);
            prefs.edit().putString(KEY_ORDER_TARGETS, targets.toString()).apply();
        } catch (JSONException ignored) {
        }
    }

    boolean isActionSnoozed(String actionKey) {
        return prefs.getBoolean(snoozeKey(actionKey), false);
    }

    void snoozeAction(String actionKey) {
        prefs.edit().putBoolean(snoozeKey(actionKey), true).apply();
    }

    void clearSnoozedAction(String actionKey) {
        prefs.edit().remove(snoozeKey(actionKey)).apply();
    }

    boolean isCurrencyAllowed(String accountId, String currency) {
        if (ACCOUNT_US.equals(accountId)) {
            return "USD".equals(currency) || "KRW".equals(currency);
        }
        return "KRW".equals(currency);
    }

    ValidationResult addCashEvent(String accountId, String type, String currency, double amount, String memo, double usdKrw) {
        if (isLedgerCorrupt()) {
            return ValidationResult.fail("장부 JSON이 손상되어 새 기록을 저장하지 않았습니다.");
        }
        if (!"deposit".equals(type) && !"withdraw".equals(type)) {
            return ValidationResult.fail("입출금 유형이 올바르지 않습니다.");
        }
        if (!isCurrencyAllowed(accountId, currency)) {
            return ValidationResult.fail(account(accountId).name + "에는 " + currency + " 현금을 기록할 수 없습니다.");
        }
        if (amount <= 0) {
            return ValidationResult.fail("금액은 0보다 커야 합니다.");
        }
        if ("withdraw".equals(type) && cash(accountId, currency) + 0.000001 < amount) {
            return ValidationResult.fail("출금 가능 현금보다 큰 금액입니다.");
        }
        double signed = "withdraw".equals(type) ? -amount : amount;
        setCash(accountId, currency, cash(accountId, currency) + signed);
        JSONObject json = baseEntry(accountId, type, currency);
        try {
            json.put("symbol", "CASH");
            json.put("name", "현금");
            json.put("amount", signed);
            json.put("memo", memo);
            putFxRate(json, currency, usdKrw);
        } catch (JSONException ignored) {
        }
        if (!append(json)) {
            setCash(accountId, currency, cash(accountId, currency) - signed);
            return ValidationResult.fail("장부를 저장하지 못했습니다.");
        }
        return ValidationResult.ok("기록했습니다.");
    }

    ValidationResult recordTrade(String side, String accountId, StrategySignal signal, double quantity, double price, double fee, String memo) {
        return recordTrade(side, accountId, signal, quantity, price, fee, memo, "");
    }

    ValidationResult correctCashEntry(String entryId, double amount, String memo, double fxRateKrw) {
        if (isLedgerCorrupt()) {
            return ValidationResult.fail("장부 JSON이 손상되어 기록을 정정할 수 없습니다.");
        }
        if (amount <= 0) {
            return ValidationResult.fail("금액은 0보다 커야 합니다.");
        }
        JSONArray array = readEntriesForWrite();
        if (array == null) {
            return ValidationResult.fail("장부를 읽지 못했습니다.");
        }
        JSONObject target = findEntry(array, entryId);
        if (target == null) {
            return ValidationResult.fail("정정할 기록을 찾지 못했습니다.");
        }
        if (isVoided(target)) {
            return ValidationResult.fail("이미 취소된 기록은 정정할 수 없습니다.");
        }
        LedgerEntry original = LedgerEntry.fromJson(target);
        if (!"deposit".equals(original.type) && !"withdraw".equals(original.type)) {
            return ValidationResult.fail("입금/출금 기록만 이 정정 화면에서 수정할 수 있습니다.");
        }
        if ("USD".equals(original.currency) && fxRateKrw <= 0 && original.fxRateKrw <= 0) {
            return ValidationResult.fail("USD 입출금 정정에는 당시 USD/KRW 환율이 필요합니다.");
        }
        ValidationResult validation = validateCancelable(array, original);
        if (!validation.ok) {
            return validation;
        }
        double cashAfterCancel = cash(original.accountId, original.currency) - original.amount;
        if ("withdraw".equals(original.type) && cashAfterCancel + 0.000001 < amount) {
            return ValidationResult.fail("정정 후 출금 가능 현금보다 큰 금액입니다.");
        }
        double signed = "withdraw".equals(original.type) ? -amount : amount;
        try {
            String cancelId = System.currentTimeMillis() + "-correct-cancel";
            target.put("voidedAt", now());
            target.put("voidedBy", cancelId);
            JSONObject cancel = correctionCancelEntry(original, cancelId, "입출금 정정");

            JSONObject replacement = baseEntry(original.accountId, original.type, original.currency);
            replacement.put("id", System.currentTimeMillis() + "-correct-" + original.type);
            replacement.put("symbol", "CASH");
            replacement.put("name", "현금");
            replacement.put("amount", signed);
            replacement.put("memo", memo);
            if ("USD".equals(original.currency)) {
                replacement.put("fxRateKrw", fxRateKrw > 0 ? fxRateKrw : original.fxRateKrw);
            } else if ("KRW".equals(original.currency)) {
                replacement.put("fxRateKrw", 1);
            }
            replacement.put("correctedEntryId", original.id);
            JSONArray updated = withCorrectionInserted(array, original.id, replacement, cancel);
            setCash(original.accountId, original.currency, cashAfterCancel + signed);
            prefs.edit().putString(KEY_ENTRIES, updated.toString()).apply();
            return ValidationResult.ok("입출금 기록을 정정했습니다.");
        } catch (JSONException error) {
            return ValidationResult.fail("정정 기록을 만들지 못했습니다.");
        }
    }

    ValidationResult correctBuyEntry(String entryId, double quantity, double price, double fee, String memo) {
        if (isLedgerCorrupt()) {
            return ValidationResult.fail("장부 JSON이 손상되어 기록을 정정할 수 없습니다.");
        }
        if (quantity <= 0) {
            return ValidationResult.fail("체결 수량은 0보다 커야 합니다.");
        }
        if (price <= 0) {
            return ValidationResult.fail("체결가는 0보다 커야 합니다.");
        }
        if (fee < 0) {
            return ValidationResult.fail("수수료/세금은 음수일 수 없습니다.");
        }
        JSONArray array = readEntriesForWrite();
        if (array == null) {
            return ValidationResult.fail("장부를 읽지 못했습니다.");
        }
        JSONObject target = findEntry(array, entryId);
        if (target == null) {
            return ValidationResult.fail("정정할 기록을 찾지 못했습니다.");
        }
        if (isVoided(target)) {
            return ValidationResult.fail("이미 취소된 기록은 정정할 수 없습니다.");
        }
        LedgerEntry original = LedgerEntry.fromJson(target);
        if (!"buy".equals(original.type)) {
            return ValidationResult.fail("매수 체결 기록만 이 정정 화면에서 수정할 수 있습니다.");
        }
        ValidationResult validation = validateCancelable(array, original);
        if (!validation.ok) {
            return validation;
        }
        double gross = quantity * price;
        double cashAfterCancel = cash(original.accountId, original.currency) + original.amount + original.fee;
        if (cashAfterCancel + 0.000001 < gross + fee) {
            return ValidationResult.fail("정정 후 매수 가능 현금보다 큰 주문입니다.");
        }
        try {
            String cancelId = System.currentTimeMillis() + "-correct-cancel";
            target.put("voidedAt", now());
            target.put("voidedBy", cancelId);
            JSONObject cancel = correctionCancelEntry(original, cancelId, "매수 정정");

            JSONObject replacement = baseEntry(original.accountId, "buy", original.currency);
            replacement.put("id", System.currentTimeMillis() + "-correct-buy");
            replacement.put("signalId", original.signalId);
            replacement.put("market", original.market);
            replacement.put("strategyKey", original.strategyKey);
            replacement.put("symbol", original.symbol);
            replacement.put("name", original.name);
            replacement.put("quantity", quantity);
            replacement.put("price", price);
            replacement.put("fee", fee);
            replacement.put("amount", gross);
            replacement.put("memo", memo);
            replacement.put("correctedEntryId", original.id);
            JSONArray updated = withCorrectionInserted(array, original.id, replacement, cancel);
            setCash(original.accountId, original.currency, cashAfterCancel - gross - fee);
            prefs.edit().putString(KEY_ENTRIES, updated.toString()).apply();
            return ValidationResult.ok("매수 체결 기록을 정정했습니다.");
        } catch (JSONException error) {
            return ValidationResult.fail("정정 기록을 만들지 못했습니다.");
        }
    }

    ValidationResult correctSellEntry(String entryId, double quantity, double price, double fee, String memo, String selectedLotId) {
        if (isLedgerCorrupt()) {
            return ValidationResult.fail("장부 JSON이 손상되어 기록을 정정할 수 없습니다.");
        }
        if (quantity <= 0) {
            return ValidationResult.fail("체결 수량은 0보다 커야 합니다.");
        }
        if (price <= 0) {
            return ValidationResult.fail("체결가는 0보다 커야 합니다.");
        }
        if (fee < 0) {
            return ValidationResult.fail("수수료/세금은 음수일 수 없습니다.");
        }
        JSONArray array = readEntriesForWrite();
        if (array == null) {
            return ValidationResult.fail("장부를 읽지 못했습니다.");
        }
        int targetIndex = findEntryIndex(array, entryId);
        JSONObject target = targetIndex < 0 ? null : array.optJSONObject(targetIndex);
        if (target == null) {
            return ValidationResult.fail("정정할 기록을 찾지 못했습니다.");
        }
        if (isVoided(target)) {
            return ValidationResult.fail("이미 취소된 기록은 정정할 수 없습니다.");
        }
        LedgerEntry original = LedgerEntry.fromJson(target);
        if (!"sell".equals(original.type)) {
            return ValidationResult.fail("매도 체결 기록만 이 정정 화면에서 수정할 수 있습니다.");
        }
        ValidationResult validation = validateCancelable(array, original);
        if (!validation.ok) {
            return validation;
        }

        double gross = quantity * price;
        double cashAfterCancel = cash(original.accountId, original.currency) - original.amount + original.fee;
        if (cashAfterCancel + gross - fee < -0.000001) {
            return ValidationResult.fail("정정 후 매도 비용 때문에 현금이 음수가 됩니다.");
        }

        JSONArray prefix = entriesBefore(array, targetIndex);
        LotDisposition disposition = sellDisposition(prefix, original.accountId, original.symbol, quantity, gross, fee, selectedLotId);
        if (!disposition.ok) {
            return ValidationResult.fail(disposition.message);
        }

        try {
            String cancelId = System.currentTimeMillis() + "-correct-cancel";
            target.put("voidedAt", now());
            target.put("voidedBy", cancelId);
            JSONObject cancel = correctionCancelEntry(original, cancelId, "매도 정정");

            JSONObject replacement = baseEntry(original.accountId, "sell", original.currency);
            replacement.put("id", System.currentTimeMillis() + "-correct-sell");
            replacement.put("signalId", original.signalId);
            replacement.put("market", original.market);
            replacement.put("strategyKey", original.strategyKey);
            replacement.put("symbol", original.symbol);
            replacement.put("name", original.name);
            replacement.put("quantity", quantity);
            replacement.put("price", price);
            replacement.put("fee", fee);
            replacement.put("amount", gross);
            replacement.put("memo", memo);
            replacement.put("correctedEntryId", original.id);
            disposition.putInto(replacement);

            JSONArray updated = withCorrectionInserted(array, original.id, replacement, cancel);
            if (!tradeFlowStaysValid(updated, original.accountId, original.symbol)) {
                target.remove("voidedAt");
                target.remove("voidedBy");
                return ValidationResult.fail("정정 후 이후 매도 기록의 lot 수량 흐름이 깨집니다.");
            }
            setCash(original.accountId, original.currency, cashAfterCancel + gross - fee);
            prefs.edit().putString(KEY_ENTRIES, updated.toString()).apply();
            return ValidationResult.ok("매도 체결 기록을 정정했습니다.");
        } catch (JSONException error) {
            return ValidationResult.fail("정정 기록을 만들지 못했습니다.");
        }
    }

    ValidationResult recordTrade(String side, String accountId, StrategySignal signal, double quantity, double price, double fee, String memo, String selectedLotId) {
        if (isLedgerCorrupt()) {
            return ValidationResult.fail("장부 JSON이 손상되어 새 기록을 저장하지 않았습니다.");
        }
        if (!"buy".equals(side) && !"sell".equals(side)) {
            return ValidationResult.fail("체결 유형이 올바르지 않습니다.");
        }
        if (signal == null) {
            return ValidationResult.fail("종목 정보가 없습니다.");
        }
        if (!isCurrencyAllowed(accountId, signal.currency)) {
            return ValidationResult.fail(account(accountId).name + "에는 " + signal.currency + " 체결을 기록할 수 없습니다.");
        }
        if (quantity <= 0) {
            return ValidationResult.fail("체결 수량은 0보다 커야 합니다.");
        }
        if (price <= 0) {
            return ValidationResult.fail("체결가는 0보다 커야 합니다.");
        }
        if (fee < 0) {
            return ValidationResult.fail("수수료/세금은 음수일 수 없습니다.");
        }
        double gross = quantity * price;
        if ("buy".equals(side)) {
            if (cash(accountId, signal.currency) + 0.000001 < gross + fee) {
                return ValidationResult.fail("매수 가능 현금보다 큰 주문입니다.");
            }
            setCash(accountId, signal.currency, cash(accountId, signal.currency) - gross - fee);
        } else {
            Holding holding = holdings(accountId).get(signal.symbol);
            double heldQuantity = holding == null ? 0 : holding.quantity;
            if (quantity > heldQuantity + 0.000001) {
                return ValidationResult.fail("보유 수량보다 큰 매도입니다.");
            }
            LotDisposition disposition = sellDisposition(accountId, signal.symbol, quantity, gross, fee, selectedLotId);
            if (!disposition.ok) {
                return ValidationResult.fail(disposition.message);
            }
            setCash(accountId, signal.currency, cash(accountId, signal.currency) + gross - fee);
        }

        JSONObject json = baseEntry(accountId, side, signal.currency);
        try {
            json.put("signalId", signal.signalId);
            json.put("market", signal.market);
            json.put("strategyKey", signal.strategyKey);
            json.put("symbol", signal.symbol);
            json.put("name", signal.name);
            json.put("quantity", quantity);
            json.put("price", price);
            json.put("fee", fee);
            json.put("amount", gross);
            json.put("memo", memo);
            if ("sell".equals(side)) {
                LotDisposition disposition = sellDisposition(accountId, signal.symbol, quantity, gross, fee, selectedLotId);
                disposition.putInto(json);
            }
        } catch (JSONException ignored) {
        }
        if (!append(json)) {
            if ("buy".equals(side)) {
                setCash(accountId, signal.currency, cash(accountId, signal.currency) + gross + fee);
            } else {
                setCash(accountId, signal.currency, cash(accountId, signal.currency) - gross + fee);
            }
            return ValidationResult.fail("장부를 저장하지 못했습니다.");
        }
        return ValidationResult.ok("체결 기록을 저장했습니다.");
    }

    ValidationResult addFxEvent(String accountId, String fromCurrency, String toCurrency, double fromAmount, double toAmount, String memo) {
        if (isLedgerCorrupt()) {
            return ValidationResult.fail("장부 JSON이 손상되어 환전 기록을 저장하지 않았습니다.");
        }
        if (!ACCOUNT_US.equals(accountId)) {
            return ValidationResult.fail("환전 기록은 미국 주식 계좌에서만 사용할 수 있습니다.");
        }
        if (fromCurrency.equals(toCurrency)) {
            return ValidationResult.fail("서로 다른 통화로 환전해야 합니다.");
        }
        if (!isCurrencyAllowed(accountId, fromCurrency) || !isCurrencyAllowed(accountId, toCurrency)) {
            return ValidationResult.fail("허용되지 않는 통화입니다.");
        }
        if (fromAmount <= 0 || toAmount <= 0) {
            return ValidationResult.fail("환전 금액은 0보다 커야 합니다.");
        }
        if (cash(accountId, fromCurrency) + 0.000001 < fromAmount) {
            return ValidationResult.fail("환전 출금 통화의 현금이 부족합니다.");
        }
        setCash(accountId, fromCurrency, cash(accountId, fromCurrency) - fromAmount);
        setCash(accountId, toCurrency, cash(accountId, toCurrency) + toAmount);
        JSONObject json = baseEntry(accountId, "fx", fromCurrency);
        try {
            json.put("symbol", "FX");
            json.put("name", "환전");
            json.put("fromCurrency", fromCurrency);
            json.put("toCurrency", toCurrency);
            json.put("fromAmount", fromAmount);
            json.put("toAmount", toAmount);
            json.put("amount", fromAmount);
            double fxRate = fxRateFromConversion(fromCurrency, toCurrency, fromAmount, toAmount);
            if (fxRate > 0) {
                json.put("fxRateKrw", fxRate);
            }
            json.put("memo", memo);
        } catch (JSONException ignored) {
        }
        if (!append(json)) {
            setCash(accountId, fromCurrency, cash(accountId, fromCurrency) + fromAmount);
            setCash(accountId, toCurrency, cash(accountId, toCurrency) - toAmount);
            return ValidationResult.fail("장부를 저장하지 못했습니다.");
        }
        return ValidationResult.ok("환전 기록을 저장했습니다.");
    }

    ValidationResult addDividendEvent(String accountId, String symbol, String name, String market, String currency, double gross, double tax, String memo, double usdKrw) {
        if (isLedgerCorrupt()) {
            return ValidationResult.fail("장부 JSON이 손상되어 배당 기록을 저장하지 않았습니다.");
        }
        if (!isCurrencyAllowed(accountId, currency)) {
            return ValidationResult.fail(account(accountId).name + "에는 " + currency + " 배당을 기록할 수 없습니다.");
        }
        if (gross <= 0) {
            return ValidationResult.fail("세전 배당금은 0보다 커야 합니다.");
        }
        if (tax < 0 || tax > gross + 0.000001) {
            return ValidationResult.fail("배당세는 0 이상, 세전 배당 이하로 입력하세요.");
        }
        double net = gross - tax;
        setCash(accountId, currency, cash(accountId, currency) + net);
        JSONObject json = baseEntry(accountId, "dividend", currency);
        try {
            json.put("symbol", symbol == null || symbol.trim().isEmpty() ? "DIVIDEND" : symbol.trim());
            json.put("name", name == null || name.trim().isEmpty() ? "배당" : name.trim());
            json.put("market", market == null ? "" : market);
            json.put("amount", net);
            json.put("grossDividend", gross);
            json.put("dividendTax", tax);
            json.put("memo", memo);
            putFxRate(json, currency, usdKrw);
        } catch (JSONException ignored) {
        }
        if (!append(json)) {
            setCash(accountId, currency, cash(accountId, currency) - net);
            return ValidationResult.fail("장부를 저장하지 못했습니다.");
        }
        return ValidationResult.ok("배당 기록을 저장했습니다.");
    }

    List<LedgerEntry> entries() {
        List<LedgerEntry> entries = new ArrayList<>();
        JSONArray array = readEntries();
        for (int index = array.length() - 1; index >= 0; index--) {
            JSONObject json = array.optJSONObject(index);
            if (json != null) {
                entries.add(LedgerEntry.fromJson(json));
            }
        }
        return entries;
    }

    List<LedgerEntry> entries(String accountId) {
        List<LedgerEntry> result = new ArrayList<>();
        for (LedgerEntry entry : entries()) {
            if (accountId.equals(entry.accountId)) {
                result.add(entry);
            }
        }
        return result;
    }

    Map<String, Holding> holdings() {
        Map<String, Holding> all = new LinkedHashMap<>();
        for (Account account : accounts()) {
            for (Holding holding : holdings(account.id).values()) {
                all.put(account.id + ":" + holding.symbol, holding);
            }
        }
        return all;
    }

    Map<String, Holding> holdings(String accountId) {
        Map<String, Holding> holdings = new LinkedHashMap<>();
        for (HoldingLot lot : lots(accountId)) {
            Holding holding = holdings.get(lot.symbol);
            if (holding == null) {
                holding = new Holding();
                holding.accountId = accountId;
                holding.symbol = lot.symbol;
                holding.name = lot.name;
                holding.market = lot.market;
                holding.currency = lot.currency;
                holdings.put(lot.symbol, holding);
            }
            holding.quantity += lot.remainingQuantity;
            holding.cost += lot.remainingCost;
            holding.invested += lot.originalCost;
        }
        return holdings;
    }

    List<HoldingLot> lots(String accountId) {
        return lotsFromEntries(readEntries(), accountId);
    }

    List<HoldingLot> lotsAvailableBeforeEntry(String entryId) {
        JSONArray array = readEntries();
        int targetIndex = findEntryIndex(array, entryId);
        if (targetIndex < 0) {
            return new ArrayList<>();
        }
        JSONObject target = array.optJSONObject(targetIndex);
        if (target == null) {
            return new ArrayList<>();
        }
        LedgerEntry entry = LedgerEntry.fromJson(target);
        return lotsFromEntries(entriesBefore(array, targetIndex), entry.accountId, entry.symbol);
    }

    private List<HoldingLot> lotsFromEntries(JSONArray array, String accountId) {
        List<HoldingLot> lots = new ArrayList<>();
        for (int index = 0; index < array.length(); index++) {
            JSONObject json = array.optJSONObject(index);
            if (json == null || !accountId.equals(json.optString("accountId")) || isVoided(json)) {
                continue;
            }
            String type = json.optString("type");
            if ("buy".equals(type)) {
                HoldingLot lot = HoldingLot.fromBuy(json);
                lots.add(lot);
            } else if ("sell".equals(type)) {
                String selectedLotId = json.optString("selectedLotId");
                if (selectedLotId.trim().isEmpty()) {
                    consumeLotsFifo(lots, json.optString("symbol"), json.optDouble("quantity", 0));
                } else {
                    consumeSelectedLot(lots, json.optString("symbol"), selectedLotId, json.optDouble("quantity", 0));
                }
            }
        }
        List<HoldingLot> open = new ArrayList<>();
        for (HoldingLot lot : lots) {
            if (lot.remainingQuantity > 0.000001) {
                lot.refreshSchedule();
                open.add(lot);
            }
        }
        return open;
    }

    List<HoldingLot> lots(String accountId, String symbol) {
        return lotsFromEntries(readEntries(), accountId, symbol);
    }

    private List<HoldingLot> lotsFromEntries(JSONArray array, String accountId, String symbol) {
        List<HoldingLot> result = new ArrayList<>();
        for (HoldingLot lot : lotsFromEntries(array, accountId)) {
            if (symbol.equals(lot.symbol)) {
                result.add(lot);
            }
        }
        return result;
    }

    double averageBuyPrice(String accountId, String symbol) {
        double weightedPrice = 0;
        double quantity = 0;
        for (HoldingLot lot : lots(accountId, symbol)) {
            weightedPrice += lot.price * lot.remainingQuantity;
            quantity += lot.remainingQuantity;
        }
        return quantity <= 0.000001 ? 0 : weightedPrice / quantity;
    }

    LotSummary lotSummary(String accountId) {
        LotSummary summary = new LotSummary();
        for (HoldingLot lot : lots(accountId)) {
            summary.openLots++;
            if (lot.sixMonthDueQuantity() > 0.000001) {
                summary.sixMonthDue++;
            }
            if (lot.twelveMonthDueQuantity() > 0.000001) {
                summary.twelveMonthDue++;
            }
        }
        return summary;
    }

    LotDisposition previewSellDisposition(String accountId, String symbol, double quantity, double gross, double fee, String selectedLotId) {
        return sellDisposition(accountId, symbol, quantity, gross, fee, selectedLotId);
    }

    LotDisposition previewCorrectSellDisposition(String entryId, double quantity, double gross, double fee, String selectedLotId) {
        JSONArray array = readEntries();
        int targetIndex = findEntryIndex(array, entryId);
        JSONObject target = targetIndex < 0 ? null : array.optJSONObject(targetIndex);
        if (target == null) {
            return LotDisposition.fail("정정할 매도 기록을 찾지 못했습니다.");
        }
        LedgerEntry entry = LedgerEntry.fromJson(target);
        return sellDisposition(entriesBefore(array, targetIndex), entry.accountId, entry.symbol, quantity, gross, fee, selectedLotId);
    }

    boolean hasHolding(String symbol) {
        for (Holding holding : holdings().values()) {
            if (holding.symbol.equals(symbol)) {
                return true;
            }
        }
        return false;
    }

    boolean hasHolding(String accountId, String symbol) {
        return holdings(accountId).containsKey(symbol);
    }

    int openHoldingCount() {
        return holdings().size();
    }

    int entryCount() {
        return readEntries().length();
    }

    boolean isLedgerCorrupt() {
        String raw = prefs.getString(KEY_ENTRIES, "[]");
        try {
            new JSONArray(raw);
            return false;
        } catch (JSONException error) {
            preserveCorruptEntries(raw, error);
            return true;
        }
    }

    String ledgerSafetyMessage() {
        if (!isLedgerCorrupt()) {
            return "";
        }
        return prefs.getString(KEY_CORRUPT_MESSAGE, "장부 JSON 손상");
    }

    boolean isLatestEntry(String entryId) {
        JSONArray array = readEntries();
        if (array.length() == 0) {
            return false;
        }
        JSONObject last = array.optJSONObject(array.length() - 1);
        return last != null && entryId.equals(last.optString("id"));
    }

    ValidationResult deleteLatestEntry(String entryId) {
        if (isLedgerCorrupt()) {
            return ValidationResult.fail("장부 JSON이 손상되어 기록을 되돌릴 수 없습니다.");
        }
        JSONArray array = readEntries();
        if (array.length() == 0) {
            return ValidationResult.fail("되돌릴 기록이 없습니다.");
        }
        JSONObject last = array.optJSONObject(array.length() - 1);
        if (last == null || !entryId.equals(last.optString("id"))) {
            return ValidationResult.fail("안전을 위해 가장 최근 기록만 되돌릴 수 있습니다.");
        }
        LedgerEntry entry = LedgerEntry.fromJson(last);
        String accountId = entry.accountId;
        String currency = entry.currency;
        double beforeCash = cash(accountId, currency);
        if ("deposit".equals(entry.type) || "withdraw".equals(entry.type)) {
            setCash(accountId, currency, beforeCash - entry.amount);
        } else if ("buy".equals(entry.type)) {
            setCash(accountId, currency, beforeCash + entry.amount + entry.fee);
        } else if ("sell".equals(entry.type)) {
            setCash(accountId, currency, beforeCash - entry.amount + entry.fee);
        } else if ("dividend".equals(entry.type)) {
            setCash(accountId, currency, beforeCash - entry.amount);
        } else if ("fx".equals(entry.type)) {
            setCash(accountId, entry.fromCurrency, cash(accountId, entry.fromCurrency) + entry.fromAmount);
            setCash(accountId, entry.toCurrency, cash(accountId, entry.toCurrency) - entry.toAmount);
        } else if ("cancel".equals(entry.type)) {
            JSONObject original = findEntry(array, entry.cancelledEntryId);
            if (original == null) {
                return ValidationResult.fail("취소 원본 기록을 찾지 못했습니다.");
            }
            LedgerEntry originalEntry = LedgerEntry.fromJson(original);
            ValidationResult validation = validateCancelUndo(originalEntry);
            if (!validation.ok) {
                return validation;
            }
            restoreCancelledCash(originalEntry);
            original.remove("voidedAt");
            original.remove("voidedBy");
        } else {
            return ValidationResult.fail("되돌릴 수 없는 기록입니다.");
        }
        JSONArray updated = new JSONArray();
        for (int index = 0; index < array.length() - 1; index++) {
            updated.put(array.opt(index));
        }
        prefs.edit().putString(KEY_ENTRIES, updated.toString()).apply();
        return ValidationResult.ok("가장 최근 기록을 되돌렸습니다.");
    }

    ValidationResult cancelEntry(String entryId) {
        if (isLedgerCorrupt()) {
            return ValidationResult.fail("장부 JSON이 손상되어 기록을 취소할 수 없습니다.");
        }
        JSONArray array = readEntriesForWrite();
        if (array == null) {
            return ValidationResult.fail("장부를 읽지 못했습니다.");
        }
        JSONObject target = null;
        for (int index = 0; index < array.length(); index++) {
            JSONObject candidate = array.optJSONObject(index);
            if (candidate != null && entryId.equals(candidate.optString("id"))) {
                target = candidate;
                break;
            }
        }
        if (target == null) {
            return ValidationResult.fail("취소할 기록을 찾지 못했습니다.");
        }
        if (isVoided(target)) {
            return ValidationResult.fail("이미 취소된 기록입니다.");
        }
        LedgerEntry entry = LedgerEntry.fromJson(target);
        if ("cancel".equals(entry.type)) {
            return ValidationResult.fail("취소 기록은 다시 취소할 수 없습니다.");
        }
        ValidationResult validation = validateCancelable(array, entry);
        if (!validation.ok) {
            return validation;
        }
        String cancelId = System.currentTimeMillis() + "-cancel";
        String voidedAt = now();
        try {
            target.put("voidedAt", voidedAt);
            target.put("voidedBy", cancelId);
            JSONObject cancel = baseEntry(entry.accountId, "cancel", entry.currency);
            cancel.put("id", cancelId);
            cancel.put("symbol", entry.symbol == null || entry.symbol.isEmpty() ? "CANCEL" : entry.symbol);
            cancel.put("name", "기록 취소");
            cancel.put("cancelledEntryId", entry.id);
            cancel.put("cancelledType", entry.type);
            cancel.put("cancelledLabel", cancelSummary(entry));
            cancel.put("amount", Math.abs(entry.amount));
            cancel.put("memo", "입력 오류 정정");
            array.put(cancel);
        } catch (JSONException error) {
            return ValidationResult.fail("취소 기록을 만들지 못했습니다.");
        }
        applyCancelCash(entry);
        prefs.edit().putString(KEY_ENTRIES, array.toString()).apply();
        return ValidationResult.ok("기록을 취소하고 장부를 정정했습니다.");
    }

    String exportBackup() {
        JSONObject backup = new JSONObject();
        JSONArray accountArray = new JSONArray();
        try {
            backup.put("schemaVersion", "investor-ledger-backup-1");
            backup.put("exportedAt", now());
            backup.put("entries", readEntries());
            backup.put("assetSnapshots", readAssetSnapshots());
            backup.put("orderTargets", readOrderTargets());
            for (Account account : accounts()) {
                JSONObject accountJson = new JSONObject();
                JSONObject cashJson = new JSONObject();
                cashJson.put("KRW", cash(account.id, "KRW"));
                cashJson.put("USD", cash(account.id, "USD"));
                accountJson.put("accountId", account.id);
                accountJson.put("name", account.name);
                accountJson.put("baseCurrency", account.baseCurrency);
                accountJson.put("cash", cashJson);
                accountJson.put("selectedStrategy", selectedStrategyKey(account.id, ""));
                accountArray.put(accountJson);
            }
            backup.put("accounts", accountArray);
        } catch (JSONException ignored) {
        }
        return backup.toString();
    }

    ValidationResult importBackup(String raw) {
        String text = raw == null ? "" : raw.trim();
        if (text.isEmpty()) {
            return ValidationResult.fail("복원할 백업 JSON이 비어 있습니다.");
        }
        try {
            JSONObject backup = new JSONObject(text);
            if (!"investor-ledger-backup-1".equals(backup.optString("schemaVersion"))) {
                return ValidationResult.fail("지원하지 않는 백업 형식입니다.");
            }
            JSONArray entries = backup.optJSONArray("entries");
            JSONArray accountArray = backup.optJSONArray("accounts");
            JSONArray assetSnapshots = backup.optJSONArray("assetSnapshots");
            JSONObject orderTargets = backup.optJSONObject("orderTargets");
            if (entries == null || accountArray == null) {
                return ValidationResult.fail("백업에 entries/accounts가 없습니다.");
            }
            ValidationResult entryCheck = validateEntriesForImport(entries);
            if (!entryCheck.ok) {
                return entryCheck;
            }
            if (assetSnapshots != null) {
                ValidationResult snapshotCheck = validateAssetSnapshotsForImport(assetSnapshots);
                if (!snapshotCheck.ok) {
                    return snapshotCheck;
                }
            }
            String beforeEntries = prefs.getString(KEY_ENTRIES, "[]");
            SharedPreferences.Editor editor = prefs.edit()
                    .putString(KEY_PRE_IMPORT_ENTRIES, beforeEntries)
                    .putString(KEY_PRE_IMPORT_AT, now())
                    .putString(KEY_ENTRIES, entries.toString())
                    .remove(KEY_CORRUPT_ENTRIES)
                    .remove(KEY_CORRUPT_MESSAGE);

            for (Account account : accounts()) {
                editor.putLong(cashKey(account.id, "KRW"), Double.doubleToLongBits(0));
                editor.putLong(cashKey(account.id, "USD"), Double.doubleToLongBits(0));
            }
            for (int index = 0; index < accountArray.length(); index++) {
                JSONObject accountJson = accountArray.optJSONObject(index);
                if (accountJson == null) {
                    continue;
                }
                String accountId = accountJson.optString("accountId");
                if (!isKnownAccount(accountId)) {
                    return ValidationResult.fail("알 수 없는 계좌가 백업에 포함되어 있습니다: " + accountId);
                }
                String name = accountJson.optString("name");
                if (!name.trim().isEmpty()) {
                    editor.putString("account_name_" + accountId, name.trim());
                }
                JSONObject cashJson = accountJson.optJSONObject("cash");
                if (cashJson != null) {
                    double krw = cashJson.optDouble("KRW", 0);
                    double usd = cashJson.optDouble("USD", 0);
                    if (krw < -0.000001 || usd < -0.000001) {
                        return ValidationResult.fail("백업 현금 값은 음수일 수 없습니다.");
                    }
                    if (!ACCOUNT_US.equals(accountId) && usd > 0.000001) {
                        return ValidationResult.fail("한국/ETF 계좌 백업에 USD 현금이 포함되어 있습니다.");
                    }
                    editor.putLong(cashKey(accountId, "KRW"), Double.doubleToLongBits(krw));
                    editor.putLong(cashKey(accountId, "USD"), Double.doubleToLongBits(usd));
                }
                String strategy = accountJson.optString("selectedStrategy");
                if (!strategy.isEmpty()) {
                    editor.putString("selected_strategy_" + accountId, strategy);
                }
            }
            if (assetSnapshots == null) {
                editor.remove(KEY_ASSET_SNAPSHOTS);
            } else {
                editor.putString(KEY_ASSET_SNAPSHOTS, assetSnapshots.toString());
            }
            if (orderTargets == null) {
                editor.remove(KEY_ORDER_TARGETS);
            } else {
                editor.putString(KEY_ORDER_TARGETS, orderTargets.toString());
            }
            editor.apply();
            return ValidationResult.ok("백업을 복원했습니다. 이전 장부는 복원 직전 백업으로 보존했습니다.");
        } catch (JSONException error) {
            return ValidationResult.fail("백업 JSON을 읽지 못했습니다: " + (error.getMessage() == null ? "형식 오류" : error.getMessage()));
        }
    }

    double holdingValueKrw(SignalRepository repository) {
        double total = 0;
        for (Account account : accounts()) {
            total += holdingValueKrw(account.id, repository);
        }
        return total;
    }

    double holdingValueKrw(String accountId, SignalRepository repository) {
        double total = 0;
        for (Holding holding : holdings(accountId).values()) {
            double price = valuationPrice(accountId, holding, repository);
            double value = holding.quantity * price;
            total += "USD".equals(holding.currency) ? value * repository.usdKrw : value;
        }
        return total;
    }

    double holdingValueNative(String accountId, SignalRepository repository) {
        double total = 0;
        for (Holding holding : holdings(accountId).values()) {
            total += holding.quantity * valuationPrice(accountId, holding, repository);
        }
        return total;
    }

    double valuationPrice(String accountId, Holding holding, SignalRepository repository) {
        double averageCost = averageCost(holding);
        if (usesAverageCostValuation(accountId, holding, repository)) {
            return averageCost;
        }
        double reference = repository.referencePrice(holding.symbol);
        return reference > 0 ? reference : averageCost;
    }

    boolean usesAverageCostValuation(String accountId, Holding holding, SignalRepository repository) {
        double averageCost = averageCost(holding);
        if (averageCost <= 0) {
            return false;
        }
        PriceQuote quote = repository.prices.get(holding.symbol);
        if (quote == null || quote.price <= 0) {
            return true;
        }
        String quoteDay = safeDate(quote.priceDate);
        if (quoteDay.isEmpty()) {
            return true;
        }
        String latestTradeDay = latestActiveTradeDate(accountId, holding.symbol);
        return !latestTradeDay.isEmpty() && latestTradeDay.compareTo(quoteDay) > 0;
    }

    private double averageCost(Holding holding) {
        return holding == null || holding.quantity <= 0 ? 0 : holding.cost / holding.quantity;
    }

    private String latestActiveTradeDate(String accountId, String symbol) {
        for (LedgerEntry entry : entries(accountId)) {
            if (("buy".equals(entry.type) || "sell".equals(entry.type))
                    && symbol.equals(entry.symbol)
                    && (entry.voidedAt == null || entry.voidedAt.trim().isEmpty())) {
                String day = safeDate(entry.createdAt);
                if (!day.isEmpty()) {
                    return day;
                }
            }
        }
        return "";
    }

    private String safeDate(String value) {
        if (value == null) {
            return "";
        }
        String trimmed = value.trim();
        return trimmed.length() >= 10 ? trimmed.substring(0, 10) : "";
    }

    double cashValueKrw(SignalRepository repository) {
        double total = 0;
        for (Account account : accounts()) {
            total += cashValueKrw(account.id, repository);
        }
        return total;
    }

    double cashValueKrw(String accountId, SignalRepository repository) {
        return cash(accountId, "KRW") + cash(accountId, "USD") * repository.usdKrw;
    }

    double cashNative(String accountId) {
        Account account = account(accountId);
        return cash(accountId, account.baseCurrency);
    }

    double totalValueKrw(SignalRepository repository) {
        return cashValueKrw(repository) + holdingValueKrw(repository);
    }

    double accountTotalKrw(String accountId, SignalRepository repository) {
        return cashValueKrw(accountId, repository) + holdingValueKrw(accountId, repository);
    }

    PnlSummary pnlSummary(SignalRepository repository) {
        PnlSummary total = new PnlSummary();
        total.baseCurrency = "KRW";
        for (Account account : accounts()) {
            PnlSummary accountSummary = pnlSummary(account.id, repository);
            total.realizedKrw += accountSummary.realizedKrw;
            total.unrealizedKrw += accountSummary.unrealizedKrw;
            total.costBasisKrw += accountSummary.costBasisKrw;
            total.netProceedsKrw += accountSummary.netProceedsKrw;
            total.openCostKrw += accountSummary.openCostKrw;
            total.openMarketKrw += accountSummary.openMarketKrw;
            total.totalFeeKrw += accountSummary.totalFeeKrw;
            total.buyFeeKrw += accountSummary.buyFeeKrw;
            total.sellFeeKrw += accountSummary.sellFeeKrw;
            total.grossDividendKrw += accountSummary.grossDividendKrw;
            total.dividendTaxKrw += accountSummary.dividendTaxKrw;
            total.netDividendKrw += accountSummary.netDividendKrw;
            total.realizedSellCount += accountSummary.realizedSellCount;
            total.untrackedSellCount += accountSummary.untrackedSellCount;
            total.openHoldingCount += accountSummary.openHoldingCount;
            total.dividendCount += accountSummary.dividendCount;
        }
        total.realizedNative = total.realizedKrw;
        total.unrealizedNative = total.unrealizedKrw;
        total.costBasisNative = total.costBasisKrw;
        total.netProceedsNative = total.netProceedsKrw;
        total.openCostNative = total.openCostKrw;
        total.openMarketNative = total.openMarketKrw;
        total.totalFeeNative = total.totalFeeKrw;
        total.buyFeeNative = total.buyFeeKrw;
        total.sellFeeNative = total.sellFeeKrw;
        total.grossDividendNative = total.grossDividendKrw;
        total.dividendTaxNative = total.dividendTaxKrw;
        total.netDividendNative = total.netDividendKrw;
        total.refreshTotals();
        return total;
    }

    PnlSummary pnlSummary(String accountId, SignalRepository repository) {
        Account account = account(accountId);
        PnlSummary summary = new PnlSummary();
        summary.accountId = accountId;
        summary.baseCurrency = account.baseCurrency;
        JSONArray array = readEntries();
        for (int index = 0; index < array.length(); index++) {
            JSONObject json = array.optJSONObject(index);
            if (json == null
                    || !accountId.equals(json.optString("accountId"))
                    || isVoided(json)) {
                continue;
            }
            String type = json.optString("type");
            if ("dividend".equals(type)) {
                String currency = json.optString("currency", account.baseCurrency);
                double gross = json.optDouble("grossDividend", json.optDouble("amount", 0));
                double tax = json.optDouble("dividendTax", 0);
                double net = json.optDouble("amount", Math.max(0, gross - tax));
                summary.grossDividendNative += convert(gross, currency, account.baseCurrency, repository);
                summary.grossDividendKrw += toKrw(gross, currency, repository);
                summary.dividendTaxNative += convert(tax, currency, account.baseCurrency, repository);
                summary.dividendTaxKrw += toKrw(tax, currency, repository);
                summary.netDividendNative += convert(net, currency, account.baseCurrency, repository);
                summary.netDividendKrw += toKrw(net, currency, repository);
                summary.dividendCount++;
                continue;
            }
            if (!"buy".equals(type) && !"sell".equals(type)) {
                continue;
            }
            String currency = json.optString("currency", account.baseCurrency);
            double fee = json.optDouble("fee", 0);
            summary.totalFeeNative += convert(fee, currency, account.baseCurrency, repository);
            summary.totalFeeKrw += toKrw(fee, currency, repository);
            if ("buy".equals(type)) {
                summary.buyFeeNative += convert(fee, currency, account.baseCurrency, repository);
                summary.buyFeeKrw += toKrw(fee, currency, repository);
                continue;
            }
            summary.sellFeeNative += convert(fee, currency, account.baseCurrency, repository);
            summary.sellFeeKrw += toKrw(fee, currency, repository);
            double costBasis = json.optDouble("costBasis", 0);
            if (costBasis <= 0.000001) {
                summary.untrackedSellCount++;
                continue;
            }
            double realized = json.optDouble("realizedPnl", 0);
            double netProceeds = json.optDouble("netProceeds", json.optDouble("amount", 0) - json.optDouble("fee", 0));
            summary.realizedNative += convert(realized, currency, account.baseCurrency, repository);
            summary.realizedKrw += toKrw(realized, currency, repository);
            summary.costBasisNative += convert(costBasis, currency, account.baseCurrency, repository);
            summary.costBasisKrw += toKrw(costBasis, currency, repository);
            summary.netProceedsNative += convert(netProceeds, currency, account.baseCurrency, repository);
            summary.netProceedsKrw += toKrw(netProceeds, currency, repository);
            summary.realizedSellCount++;
        }
        for (Holding holding : holdings(accountId).values()) {
            double market = holding.quantity * valuationPrice(accountId, holding, repository);
            double cost = holding.cost;
            double unrealized = market - cost;
            summary.openMarketNative += convert(market, holding.currency, account.baseCurrency, repository);
            summary.openMarketKrw += toKrw(market, holding.currency, repository);
            summary.openCostNative += convert(cost, holding.currency, account.baseCurrency, repository);
            summary.openCostKrw += toKrw(cost, holding.currency, repository);
            summary.unrealizedNative += convert(unrealized, holding.currency, account.baseCurrency, repository);
            summary.unrealizedKrw += toKrw(unrealized, holding.currency, repository);
            summary.openHoldingCount++;
        }
        summary.refreshTotals();
        return summary;
    }

    AssetSnapshotPoint captureAssetSnapshot(SignalRepository repository, String reason) {
        JSONArray array = readAssetSnapshotsForWrite();
        JSONObject json = assetSnapshotJson(repository, reason);
        String dateKey = json.optString("dateKey");
        int lastIndex = array.length() - 1;
        JSONObject last = lastIndex >= 0 ? array.optJSONObject(lastIndex) : null;
        if (last != null && dateKey.equals(last.optString("dateKey"))) {
            JSONArray updated = new JSONArray();
            for (int index = 0; index < array.length(); index++) {
                updated.put(index == lastIndex ? json : array.opt(index));
            }
            array = updated;
        } else {
            array.put(json);
        }
        while (array.length() > MAX_ASSET_SNAPSHOTS) {
            JSONArray trimmed = new JSONArray();
            for (int index = 1; index < array.length(); index++) {
                trimmed.put(array.opt(index));
            }
            array = trimmed;
        }
        prefs.edit().putString(KEY_ASSET_SNAPSHOTS, array.toString()).apply();
        return AssetSnapshotPoint.fromJson(json);
    }

    List<AssetSnapshotPoint> assetSnapshotSeries(String range) {
        List<AssetSnapshotPoint> all = assetSnapshots();
        if ("week".equals(range)) {
            return tail(groupSnapshots(all, "week"), 12);
        }
        if ("month".equals(range)) {
            return tail(groupSnapshots(all, "month"), 12);
        }
        return tail(labelDailySnapshots(all), 14);
    }

    List<AssetSnapshotPoint> pnlSnapshotSeries(String range) {
        List<AssetSnapshotPoint> all = filterCurrentPnlBasis(assetSnapshots());
        if ("week".equals(range)) {
            return tail(groupSnapshots(all, "week"), 12);
        }
        if ("month".equals(range)) {
            return tail(groupSnapshots(all, "month"), 12);
        }
        return tail(labelDailySnapshots(all), 14);
    }

    List<AssetSnapshotPoint> assetSnapshots() {
        List<AssetSnapshotPoint> result = new ArrayList<>();
        JSONArray array = readAssetSnapshots();
        for (int index = 0; index < array.length(); index++) {
            JSONObject json = array.optJSONObject(index);
            if (json != null) {
                result.add(AssetSnapshotPoint.fromJson(json));
            }
        }
        return result;
    }

    AccountSnapshot snapshot(String accountId, SignalRepository repository) {
        Account account = account(accountId);
        PnlSummary pnl = pnlSummary(accountId, repository);
        AccountSnapshot snapshot = new AccountSnapshot();
        snapshot.account = account;
        snapshot.cashKrw = cashValueKrw(accountId, repository);
        snapshot.holdingKrw = holdingValueKrw(accountId, repository);
        snapshot.totalKrw = snapshot.cashKrw + snapshot.holdingKrw;
        snapshot.nativeCash = cash(accountId, account.baseCurrency);
        snapshot.nativeHolding = holdingValueNative(accountId, repository);
        snapshot.realizedPnlNative = pnl.realizedNative;
        snapshot.realizedPnlKrw = pnl.realizedKrw;
        snapshot.unrealizedPnlNative = pnl.unrealizedNative;
        snapshot.unrealizedPnlKrw = pnl.unrealizedKrw;
        snapshot.investmentPnlNative = pnl.investmentPnlNative;
        snapshot.investmentPnlKrw = pnl.investmentPnlKrw;
        snapshot.holdingCount = holdings(accountId).size();
        snapshot.actionCount = 0;
        return snapshot;
    }

    private void migrateIfNeeded() {
        if (prefs.getInt(KEY_VERSION, 0) >= 2) {
            return;
        }
        double oldUsd = Double.longBitsToDouble(prefs.getLong(OLD_KEY_USD_CASH, Double.doubleToLongBits(0)));
        double oldKrw = Double.longBitsToDouble(prefs.getLong(OLD_KEY_KRW_CASH, Double.doubleToLongBits(0)));
        SharedPreferences.Editor editor = prefs.edit();
        if (oldUsd != 0) {
            editor.putLong(cashKey(ACCOUNT_US, "USD"), Double.doubleToLongBits(oldUsd));
        }
        if (oldKrw != 0) {
            editor.putLong(cashKey(ACCOUNT_KR, "KRW"), Double.doubleToLongBits(oldKrw));
        }
        editor.putInt(KEY_VERSION, 2).apply();
    }

    private String cashKey(String accountId, String currency) {
        return "cash_" + accountId + "_" + currency;
    }

    private String snoozeKey(String actionKey) {
        return KEY_SNOOZED_PREFIX + new SimpleDateFormat("yyyy-MM-dd", Locale.KOREA).format(new Date()) + "_" + actionKey;
    }

    private String orderTargetKey(String accountId, StrategySignal signal) {
        String signalId = signal.signalId == null ? "" : signal.signalId.trim();
        if (signalId.isEmpty()) {
            signalId = safePart(signal.market) + "_" + safePart(signal.strategyKey) + "_" + safePart(signal.symbol) + "_" + safePart(signal.validFrom);
        }
        return accountId + "|" + signalId;
    }

    private String safePart(String value) {
        return value == null ? "" : value.trim();
    }

    private String accountName(String accountId, String fallback) {
        return prefs.getString("account_name_" + accountId, fallback);
    }

    private boolean isKnownAccount(String accountId) {
        return ACCOUNT_US.equals(accountId) || ACCOUNT_KR.equals(accountId) || ACCOUNT_PENSION.equals(accountId);
    }

    private ValidationResult validateEntriesForImport(JSONArray entries) {
        for (int index = 0; index < entries.length(); index++) {
            JSONObject entry = entries.optJSONObject(index);
            if (entry == null) {
                return ValidationResult.fail("백업 장부 " + (index + 1) + "번째 기록 형식이 올바르지 않습니다.");
            }
            String accountId = entry.optString("accountId");
            String type = entry.optString("type");
            String currency = entry.optString("currency", "KRW");
            if (!isKnownAccount(accountId)) {
                return ValidationResult.fail("백업 장부에 알 수 없는 계좌가 있습니다: " + accountId);
            }
            if (!isCurrencyAllowed(accountId, currency)) {
                return ValidationResult.fail("백업 장부에 허용되지 않는 통화가 있습니다: " + currency);
            }
            if ("deposit".equals(type) || "withdraw".equals(type)) {
                double amount = entry.optDouble("amount", 0);
                if ("deposit".equals(type) && amount <= 0) {
                    return ValidationResult.fail("백업 입금 기록 금액이 올바르지 않습니다.");
                }
                if ("withdraw".equals(type) && amount >= 0) {
                    return ValidationResult.fail("백업 출금 기록 금액이 올바르지 않습니다.");
                }
            } else if ("buy".equals(type) || "sell".equals(type)) {
                if (entry.optDouble("quantity", 0) <= 0 || entry.optDouble("price", 0) <= 0) {
                    return ValidationResult.fail("백업 체결 기록의 수량/가격이 올바르지 않습니다.");
                }
                if (entry.optDouble("fee", 0) < 0 || entry.optDouble("amount", 0) <= 0) {
                    return ValidationResult.fail("백업 체결 기록의 금액/비용이 올바르지 않습니다.");
                }
                if ("sell".equals(type)
                        && (entry.optDouble("costBasis", 0) < -0.000001
                        || entry.optDouble("netProceeds", 0) < -0.000001)) {
                    return ValidationResult.fail("백업 매도 기록의 lot 손익 필드가 올바르지 않습니다.");
                }
            } else if ("fx".equals(type)) {
                String fromCurrency = entry.optString("fromCurrency");
                String toCurrency = entry.optString("toCurrency");
                if (!ACCOUNT_US.equals(accountId)
                        || fromCurrency.equals(toCurrency)
                        || !isCurrencyAllowed(accountId, fromCurrency)
                        || !isCurrencyAllowed(accountId, toCurrency)
                        || entry.optDouble("fromAmount", 0) <= 0
                        || entry.optDouble("toAmount", 0) <= 0) {
                    return ValidationResult.fail("백업 환전 기록이 올바르지 않습니다.");
                }
            } else if ("cancel".equals(type)) {
                if (entry.optString("cancelledEntryId").trim().isEmpty()) {
                    return ValidationResult.fail("백업 취소 기록에 원본 기록 ID가 없습니다.");
                }
            } else if ("dividend".equals(type)) {
                double gross = entry.optDouble("grossDividend", entry.optDouble("amount", 0));
                double tax = entry.optDouble("dividendTax", 0);
                double amount = entry.optDouble("amount", 0);
                if (gross <= 0 || tax < 0 || tax > gross + 0.000001 || amount < -0.000001) {
                    return ValidationResult.fail("백업 배당 기록의 세전/세금/세후 금액이 올바르지 않습니다.");
                }
            } else {
                return ValidationResult.fail("백업 장부에 지원하지 않는 기록 유형이 있습니다: " + type);
            }
        }
        return ValidationResult.ok("백업 장부 검증 완료");
    }

    private ValidationResult validateAssetSnapshotsForImport(JSONArray snapshots) {
        for (int index = 0; index < snapshots.length(); index++) {
            JSONObject snapshot = snapshots.optJSONObject(index);
            if (snapshot == null) {
                return ValidationResult.fail("백업 자산 스냅샷 " + (index + 1) + "번째 형식이 올바르지 않습니다.");
            }
            if (snapshot.optString("dateKey").trim().isEmpty()) {
                return ValidationResult.fail("백업 자산 스냅샷에 날짜가 없습니다.");
            }
            if (snapshot.optDouble("totalKrw", 0) < -0.000001
                    || snapshot.optDouble("cashKrw", 0) < -0.000001
                    || snapshot.optDouble("holdingKrw", 0) < -0.000001) {
                return ValidationResult.fail("백업 자산 스냅샷 금액은 음수일 수 없습니다.");
            }
        }
        return ValidationResult.ok("백업 자산 스냅샷 검증 완료");
    }

    private JSONObject assetSnapshotJson(SignalRepository repository, String reason) {
        JSONObject json = new JSONObject();
        try {
            String dateKey = todayKey();
            PnlSummary pnl = pnlSummary(repository);
            json.put("id", dateKey + "-asset");
            json.put("dateKey", dateKey);
            json.put("createdAt", now());
            json.put("reason", reason == null ? "auto" : reason);
            json.put("totalKrw", totalValueKrw(repository));
            json.put("cashKrw", cashValueKrw(repository));
            json.put("holdingKrw", holdingValueKrw(repository));
            json.put("usKrw", accountTotalKrw(ACCOUNT_US, repository));
            json.put("krKrw", accountTotalKrw(ACCOUNT_KR, repository));
            json.put("pensionKrw", accountTotalKrw(ACCOUNT_PENSION, repository));
            json.put("usdKrw", repository.usdKrw);
            json.put("entryCount", entryCount());
            json.put("realizedPnlKrw", pnl.realizedKrw);
            json.put("unrealizedPnlKrw", pnl.unrealizedKrw);
            json.put("investmentPnlKrw", pnl.investmentPnlKrw);
            json.put("pnlBasisVersion", CURRENT_PNL_BASIS_VERSION);
        } catch (JSONException ignored) {
        }
        return json;
    }

    private List<AssetSnapshotPoint> filterCurrentPnlBasis(List<AssetSnapshotPoint> snapshots) {
        List<AssetSnapshotPoint> result = new ArrayList<>();
        for (AssetSnapshotPoint point : snapshots) {
            if (point.pnlBasisVersion >= CURRENT_PNL_BASIS_VERSION) {
                result.add(point);
            }
        }
        return result;
    }

    private List<AssetSnapshotPoint> labelDailySnapshots(List<AssetSnapshotPoint> snapshots) {
        List<AssetSnapshotPoint> result = new ArrayList<>();
        for (AssetSnapshotPoint point : snapshots) {
            AssetSnapshotPoint copy = point.copy();
            copy.label = shortDateLabel(point.dateKey);
            result.add(copy);
        }
        return result;
    }

    private List<AssetSnapshotPoint> groupSnapshots(List<AssetSnapshotPoint> snapshots, String range) {
        Map<String, AssetSnapshotPoint> grouped = new LinkedHashMap<>();
        for (AssetSnapshotPoint point : snapshots) {
            String key = "month".equals(range) ? monthKey(point.dateKey) : weekKey(point.dateKey);
            AssetSnapshotPoint copy = point.copy();
            copy.label = "month".equals(range) ? monthLabel(point.dateKey) : weekLabel(point.dateKey);
            grouped.put(key, copy);
        }
        return new ArrayList<>(grouped.values());
    }

    private List<AssetSnapshotPoint> tail(List<AssetSnapshotPoint> points, int limit) {
        if (points.size() <= limit) {
            return points;
        }
        return new ArrayList<>(points.subList(points.size() - limit, points.size()));
    }

    private double toKrw(double value, String currency, SignalRepository repository) {
        return "USD".equals(currency) ? value * repository.usdKrw : value;
    }

    private double convert(double value, String fromCurrency, String toCurrency, SignalRepository repository) {
        if (fromCurrency.equals(toCurrency)) {
            return value;
        }
        if ("USD".equals(fromCurrency) && "KRW".equals(toCurrency)) {
            return value * repository.usdKrw;
        }
        if ("KRW".equals(fromCurrency) && "USD".equals(toCurrency)) {
            return repository.usdKrw <= 0 ? 0 : value / repository.usdKrw;
        }
        return value;
    }

    private LotDisposition sellDisposition(String accountId, String symbol, double quantity, double gross, double fee, String selectedLotId) {
        return sellDisposition(readEntries(), accountId, symbol, quantity, gross, fee, selectedLotId);
    }

    private LotDisposition sellDisposition(JSONArray array, String accountId, String symbol, double quantity, double gross, double fee, String selectedLotId) {
        String lotId = selectedLotId == null ? "" : selectedLotId.trim();
        List<HoldingLot> openLots = lotsFromEntries(array, accountId, symbol);
        JSONArray details = new JSONArray();
        double costBasis = 0;
        if (!lotId.isEmpty()) {
            HoldingLot selected = null;
            for (HoldingLot lot : openLots) {
                if (lotId.equals(lot.lotId)) {
                    selected = lot;
                    break;
                }
            }
            if (selected == null) {
                return LotDisposition.fail("선택한 lot을 찾지 못했습니다.");
            }
            if (quantity > selected.remainingQuantity + 0.000001) {
                return LotDisposition.fail("선택한 lot의 잔여 수량보다 큰 매도입니다.");
            }
            costBasis = proportionalCost(selected, quantity);
            addLotDispositionDetail(details, selected, quantity, costBasis);
            return LotDisposition.ok("specific", lotId, costBasis, gross, fee, details);
        }

        double remaining = quantity;
        for (HoldingLot lot : openLots) {
            if (remaining <= 0.000001) {
                break;
            }
            double sold = Math.min(lot.remainingQuantity, remaining);
            double lotCost = proportionalCost(lot, sold);
            costBasis += lotCost;
            addLotDispositionDetail(details, lot, sold, lotCost);
            remaining -= sold;
        }
        if (remaining > 0.000001) {
            return LotDisposition.fail("FIFO lot 잔여 수량이 매도 수량보다 부족합니다.");
        }
        return LotDisposition.ok("fifo", "", costBasis, gross, fee, details);
    }

    private double proportionalCost(HoldingLot lot, double quantity) {
        double unitCost = lot.remainingQuantity <= 0 ? 0 : lot.remainingCost / lot.remainingQuantity;
        return unitCost * quantity;
    }

    private void addLotDispositionDetail(JSONArray details, HoldingLot lot, double quantity, double costBasis) {
        JSONObject json = new JSONObject();
        try {
            json.put("lotId", lot.lotId);
            json.put("openedDate", lot.openedDate);
            json.put("quantity", quantity);
            json.put("costBasis", costBasis);
        } catch (JSONException ignored) {
        }
        details.put(json);
    }

    private void consumeLotsFifo(List<HoldingLot> lots, String symbol, double sellQuantity) {
        double remainingSell = Math.max(0, sellQuantity);
        for (HoldingLot lot : lots) {
            if (remainingSell <= 0.000001) {
                return;
            }
            if (!symbol.equals(lot.symbol) || lot.remainingQuantity <= 0.000001) {
                continue;
            }
            double consumed = Math.min(lot.remainingQuantity, remainingSell);
            double costPerShare = lot.remainingQuantity <= 0 ? 0 : lot.remainingCost / lot.remainingQuantity;
            lot.remainingQuantity -= consumed;
            lot.remainingCost = Math.max(0, lot.remainingCost - costPerShare * consumed);
            remainingSell -= consumed;
        }
    }

    private void consumeSelectedLot(List<HoldingLot> lots, String symbol, String selectedLotId, double sellQuantity) {
        double remainingSell = Math.max(0, sellQuantity);
        for (HoldingLot lot : lots) {
            if (remainingSell <= 0.000001) {
                return;
            }
            if (!symbol.equals(lot.symbol) || !selectedLotId.equals(lot.lotId) || lot.remainingQuantity <= 0.000001) {
                continue;
            }
            double consumed = Math.min(lot.remainingQuantity, remainingSell);
            double costPerShare = lot.remainingQuantity <= 0 ? 0 : lot.remainingCost / lot.remainingQuantity;
            lot.remainingQuantity -= consumed;
            lot.remainingCost = Math.max(0, lot.remainingCost - costPerShare * consumed);
            remainingSell -= consumed;
        }
        if (remainingSell > 0.000001) {
            consumeLotsFifo(lots, symbol, remainingSell);
        }
    }

    private ValidationResult validateCancelable(JSONArray array, LedgerEntry entry) {
        String type = entry.type;
        String accountId = entry.accountId;
        String currency = entry.currency;
        if ("deposit".equals(type)) {
            if (cash(accountId, currency) + 0.000001 < entry.amount) {
                return ValidationResult.fail("이 입금 기록을 취소하면 현금이 음수가 됩니다.");
            }
            return ValidationResult.ok("취소 가능");
        }
        if ("withdraw".equals(type)) {
            return ValidationResult.ok("취소 가능");
        }
        if ("buy".equals(type)) {
            Holding holding = holdings(accountId).get(entry.symbol);
            double heldQuantity = holding == null ? 0 : holding.quantity;
            if (heldQuantity + 0.000001 < entry.quantity) {
                return ValidationResult.fail("이미 매도된 수량이 있어 이 매수 기록을 취소할 수 없습니다.");
            }
            if (!tradeFlowStaysValidAfterVoid(array, entry)) {
                return ValidationResult.fail("이 매수 기록을 취소하면 이후 매도 기록의 수량 흐름이 깨집니다.");
            }
            return ValidationResult.ok("취소 가능");
        }
        if ("sell".equals(type)) {
            double cashDecrease = entry.amount - entry.fee;
            if (cash(accountId, currency) + 0.000001 < cashDecrease) {
                return ValidationResult.fail("이 매도 기록을 취소하면 현금이 음수가 됩니다.");
            }
            return ValidationResult.ok("취소 가능");
        }
        if ("dividend".equals(type)) {
            if (cash(accountId, currency) + 0.000001 < entry.amount) {
                return ValidationResult.fail("이 배당 기록을 취소하면 현금이 음수가 됩니다.");
            }
            return ValidationResult.ok("취소 가능");
        }
        if ("fx".equals(type)) {
            if (cash(accountId, entry.toCurrency) + 0.000001 < entry.toAmount) {
                return ValidationResult.fail("이 환전 기록을 취소하면 입금 통화 현금이 음수가 됩니다.");
            }
            return ValidationResult.ok("취소 가능");
        }
        return ValidationResult.fail("취소할 수 없는 기록 유형입니다.");
    }

    private void applyCancelCash(LedgerEntry entry) {
        String accountId = entry.accountId;
        String currency = entry.currency;
        if ("deposit".equals(entry.type) || "withdraw".equals(entry.type)) {
            setCash(accountId, currency, cash(accountId, currency) - entry.amount);
        } else if ("buy".equals(entry.type)) {
            setCash(accountId, currency, cash(accountId, currency) + entry.amount + entry.fee);
        } else if ("sell".equals(entry.type)) {
            setCash(accountId, currency, cash(accountId, currency) - entry.amount + entry.fee);
        } else if ("dividend".equals(entry.type)) {
            setCash(accountId, currency, cash(accountId, currency) - entry.amount);
        } else if ("fx".equals(entry.type)) {
            setCash(accountId, entry.fromCurrency, cash(accountId, entry.fromCurrency) + entry.fromAmount);
            setCash(accountId, entry.toCurrency, cash(accountId, entry.toCurrency) - entry.toAmount);
        }
    }

    private ValidationResult validateCancelUndo(LedgerEntry original) {
        String accountId = original.accountId;
        String currency = original.currency;
        if ("withdraw".equals(original.type) && cash(accountId, currency) + original.amount < -0.000001) {
            return ValidationResult.fail("정정을 되돌리면 현금이 음수가 됩니다.");
        }
        if ("buy".equals(original.type) && cash(accountId, currency) + 0.000001 < original.amount + original.fee) {
            return ValidationResult.fail("정정을 되돌리면 매수 현금이 부족합니다.");
        }
        if ("sell".equals(original.type)) {
            Holding holding = holdings(accountId).get(original.symbol);
            double heldQuantity = holding == null ? 0 : holding.quantity;
            if (heldQuantity + 0.000001 < original.quantity) {
                return ValidationResult.fail("정정을 되돌리면 보유 수량이 음수가 됩니다.");
            }
        }
        if ("fx".equals(original.type) && cash(accountId, original.fromCurrency) + 0.000001 < original.fromAmount) {
            return ValidationResult.fail("정정을 되돌리면 환전 출금 통화 현금이 부족합니다.");
        }
        return ValidationResult.ok("정정 되돌리기 가능");
    }

    private void restoreCancelledCash(LedgerEntry original) {
        String accountId = original.accountId;
        String currency = original.currency;
        if ("deposit".equals(original.type) || "withdraw".equals(original.type)) {
            setCash(accountId, currency, cash(accountId, currency) + original.amount);
        } else if ("buy".equals(original.type)) {
            setCash(accountId, currency, cash(accountId, currency) - original.amount - original.fee);
        } else if ("sell".equals(original.type)) {
            setCash(accountId, currency, cash(accountId, currency) + original.amount - original.fee);
        } else if ("dividend".equals(original.type)) {
            setCash(accountId, currency, cash(accountId, currency) + original.amount);
        } else if ("fx".equals(original.type)) {
            setCash(accountId, original.fromCurrency, cash(accountId, original.fromCurrency) - original.fromAmount);
            setCash(accountId, original.toCurrency, cash(accountId, original.toCurrency) + original.toAmount);
        }
    }

    private boolean tradeFlowStaysValidAfterVoid(JSONArray array, LedgerEntry target) {
        double quantity = 0;
        for (int index = 0; index < array.length(); index++) {
            JSONObject json = array.optJSONObject(index);
            if (json == null
                    || target.id.equals(json.optString("id"))
                    || isVoided(json)
                    || !target.accountId.equals(json.optString("accountId"))
                    || !target.symbol.equals(json.optString("symbol"))) {
                continue;
            }
            String type = json.optString("type");
            if ("buy".equals(type)) {
                quantity += json.optDouble("quantity", 0);
            } else if ("sell".equals(type)) {
                double sellQuantity = json.optDouble("quantity", 0);
                if (sellQuantity > quantity + 0.000001) {
                    return false;
                }
                quantity -= sellQuantity;
            }
        }
        return true;
    }

    private boolean tradeFlowStaysValid(JSONArray array, String accountId, String symbol) {
        double quantity = 0;
        for (int index = 0; index < array.length(); index++) {
            JSONObject json = array.optJSONObject(index);
            if (json == null
                    || isVoided(json)
                    || !accountId.equals(json.optString("accountId"))
                    || !symbol.equals(json.optString("symbol"))) {
                continue;
            }
            String type = json.optString("type");
            if ("buy".equals(type)) {
                quantity += json.optDouble("quantity", 0);
            } else if ("sell".equals(type)) {
                double sellQuantity = json.optDouble("quantity", 0);
                if (sellQuantity > quantity + 0.000001) {
                    return false;
                }
                quantity -= sellQuantity;
            }
        }
        return true;
    }

    private boolean isVoided(JSONObject json) {
        return "cancel".equals(json.optString("type")) || !json.optString("voidedAt").isEmpty();
    }

    private String cancelSummary(LedgerEntry entry) {
        if ("deposit".equals(entry.type)) {
            return "입금 · " + entry.currency + " · " + entry.createdAt;
        }
        if ("withdraw".equals(entry.type)) {
            return "출금 · " + entry.currency + " · " + entry.createdAt;
        }
        if ("fx".equals(entry.type)) {
            return "환전 · " + entry.fromCurrency + "->" + entry.toCurrency + " · " + entry.createdAt;
        }
        if ("dividend".equals(entry.type)) {
            return "배당 · " + entry.symbol + " · " + entry.createdAt;
        }
        return ("buy".equals(entry.type) ? "매수" : "매도") + " · " + entry.symbol + " · " + entry.createdAt;
    }

    private JSONObject correctionCancelEntry(LedgerEntry entry, String cancelId, String memo) throws JSONException {
        JSONObject cancel = baseEntry(entry.accountId, "cancel", entry.currency);
        cancel.put("id", cancelId);
        cancel.put("symbol", entry.symbol == null || entry.symbol.isEmpty() ? "CANCEL" : entry.symbol);
        cancel.put("name", "기록 정정");
        cancel.put("cancelledEntryId", entry.id);
        cancel.put("cancelledType", entry.type);
        cancel.put("cancelledLabel", cancelSummary(entry));
        cancel.put("amount", Math.abs(entry.amount));
        cancel.put("memo", memo);
        return cancel;
    }

    private JSONArray withCorrectionInserted(JSONArray array, String originalId, JSONObject replacement, JSONObject cancel) {
        JSONArray updated = new JSONArray();
        for (int index = 0; index < array.length(); index++) {
            Object item = array.opt(index);
            updated.put(item);
            JSONObject json = array.optJSONObject(index);
            if (json != null && originalId.equals(json.optString("id"))) {
                updated.put(replacement);
            }
        }
        updated.put(cancel);
        return updated;
    }

    private JSONArray entriesBefore(JSONArray array, int endExclusive) {
        JSONArray prefix = new JSONArray();
        for (int index = 0; index < endExclusive; index++) {
            prefix.put(array.opt(index));
        }
        return prefix;
    }

    private JSONObject findEntry(JSONArray array, String entryId) {
        int index = findEntryIndex(array, entryId);
        return index < 0 ? null : array.optJSONObject(index);
    }

    private int findEntryIndex(JSONArray array, String entryId) {
        for (int index = 0; index < array.length(); index++) {
            JSONObject json = array.optJSONObject(index);
            if (json != null && entryId.equals(json.optString("id"))) {
                return index;
            }
        }
        return -1;
    }

    private JSONObject baseEntry(String accountId, String type, String currency) {
        JSONObject json = new JSONObject();
        try {
            json.put("id", System.currentTimeMillis() + "-" + type);
            json.put("accountId", accountId);
            json.put("type", type);
            json.put("currency", currency);
            json.put("createdAt", now());
        } catch (JSONException ignored) {
        }
        return json;
    }

    private void putFxRate(JSONObject json, String currency, double usdKrw) throws JSONException {
        if ("USD".equals(currency) && usdKrw > 0) {
            json.put("fxRateKrw", usdKrw);
        } else if ("KRW".equals(currency)) {
            json.put("fxRateKrw", 1);
        }
    }

    private double fxRateFromConversion(String fromCurrency, String toCurrency, double fromAmount, double toAmount) {
        if ("KRW".equals(fromCurrency) && "USD".equals(toCurrency)) {
            return toAmount <= 0 ? 0 : fromAmount / toAmount;
        }
        if ("USD".equals(fromCurrency) && "KRW".equals(toCurrency)) {
            return fromAmount <= 0 ? 0 : toAmount / fromAmount;
        }
        return 0;
    }

    private boolean append(JSONObject entry) {
        JSONArray array = readEntriesForWrite();
        if (array == null) {
            return false;
        }
        array.put(entry);
        prefs.edit().putString(KEY_ENTRIES, array.toString()).apply();
        return true;
    }

    private JSONArray readEntries() {
        String raw = prefs.getString(KEY_ENTRIES, "[]");
        try {
            return new JSONArray(raw);
        } catch (JSONException error) {
            preserveCorruptEntries(raw, error);
            return new JSONArray();
        }
    }

    private JSONArray readEntriesForWrite() {
        String raw = prefs.getString(KEY_ENTRIES, "[]");
        try {
            return new JSONArray(raw);
        } catch (JSONException error) {
            preserveCorruptEntries(raw, error);
            return null;
        }
    }

    private JSONArray readAssetSnapshots() {
        String raw = prefs.getString(KEY_ASSET_SNAPSHOTS, "[]");
        try {
            return new JSONArray(raw);
        } catch (JSONException error) {
            preserveCorruptAssetSnapshots(raw);
            return new JSONArray();
        }
    }

    private JSONArray readAssetSnapshotsForWrite() {
        String raw = prefs.getString(KEY_ASSET_SNAPSHOTS, "[]");
        try {
            return new JSONArray(raw);
        } catch (JSONException error) {
            preserveCorruptAssetSnapshots(raw);
            return new JSONArray();
        }
    }

    private JSONObject readOrderTargets() {
        String raw = prefs.getString(KEY_ORDER_TARGETS, "{}");
        try {
            return new JSONObject(raw);
        } catch (JSONException error) {
            return new JSONObject();
        }
    }

    private void preserveCorruptEntries(String raw, JSONException error) {
        if (!prefs.contains(KEY_CORRUPT_ENTRIES)) {
            prefs.edit()
                    .putString(KEY_CORRUPT_ENTRIES, raw)
                    .putString(KEY_CORRUPT_MESSAGE, error.getMessage() == null ? "장부 JSON 손상" : error.getMessage())
                    .apply();
        }
    }

    private void preserveCorruptAssetSnapshots(String raw) {
        if (!prefs.contains(KEY_CORRUPT_ASSET_SNAPSHOTS)) {
            prefs.edit().putString(KEY_CORRUPT_ASSET_SNAPSHOTS, raw).apply();
        }
    }

    private static String todayKey() {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.KOREA).format(new Date());
    }

    private static String now() {
        return new SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.KOREA).format(new Date());
    }

    private static String shortDateLabel(String dateKey) {
        if (dateKey != null && dateKey.length() >= 10) {
            return dateKey.substring(5);
        }
        return dateKey == null ? "" : dateKey;
    }

    private static String monthKey(String dateKey) {
        if (dateKey != null && dateKey.length() >= 7) {
            return dateKey.substring(0, 7);
        }
        return dateKey == null ? "" : dateKey;
    }

    private static String monthLabel(String dateKey) {
        if (dateKey != null && dateKey.length() >= 7) {
            try {
                return Integer.parseInt(dateKey.substring(5, 7)) + "월";
            } catch (NumberFormatException ignored) {
                return dateKey.substring(5, 7);
            }
        }
        return dateKey == null ? "" : dateKey;
    }

    private static String weekKey(String dateKey) {
        Calendar calendar = calendarFromDateKey(dateKey);
        if (calendar == null) {
            return dateKey == null ? "" : dateKey;
        }
        return calendar.get(Calendar.YEAR) + "-W" + calendar.get(Calendar.WEEK_OF_YEAR);
    }

    private static String weekLabel(String dateKey) {
        Calendar calendar = calendarFromDateKey(dateKey);
        if (calendar == null) {
            return dateKey == null ? "" : dateKey;
        }
        int month = calendar.get(Calendar.MONTH) + 1;
        int day = calendar.get(Calendar.DAY_OF_MONTH);
        return month + "/" + day;
    }

    private static Calendar calendarFromDateKey(String dateKey) {
        try {
            Date date = new SimpleDateFormat("yyyy-MM-dd", Locale.KOREA).parse(dateKey);
            Calendar calendar = Calendar.getInstance(Locale.KOREA);
            calendar.setFirstDayOfWeek(Calendar.MONDAY);
            calendar.setMinimalDaysInFirstWeek(4);
            calendar.setTime(date);
            return calendar;
        } catch (ParseException | NullPointerException error) {
            return null;
        }
    }
}

final class Account {
    final String id;
    final String name;
    final String baseCurrency;
    final String role;
    final int color;

    Account(String id, String name, String baseCurrency, String role, int color) {
        this.id = id;
        this.name = name;
        this.baseCurrency = baseCurrency;
        this.role = role;
        this.color = color;
    }
}

final class PnlSummary {
    String accountId;
    String baseCurrency = "KRW";
    double realizedNative;
    double realizedKrw;
    double unrealizedNative;
    double unrealizedKrw;
    double investmentPnlNative;
    double investmentPnlKrw;
    double costBasisNative;
    double costBasisKrw;
    double netProceedsNative;
    double netProceedsKrw;
    double openCostNative;
    double openCostKrw;
    double openMarketNative;
    double openMarketKrw;
    double totalFeeNative;
    double totalFeeKrw;
    double buyFeeNative;
    double buyFeeKrw;
    double sellFeeNative;
    double sellFeeKrw;
    double grossDividendNative;
    double grossDividendKrw;
    double dividendTaxNative;
    double dividendTaxKrw;
    double netDividendNative;
    double netDividendKrw;
    int realizedSellCount;
    int untrackedSellCount;
    int openHoldingCount;
    int dividendCount;

    void refreshTotals() {
        investmentPnlNative = realizedNative + unrealizedNative + netDividendNative;
        investmentPnlKrw = realizedKrw + unrealizedKrw + netDividendKrw;
    }
}

final class AccountSnapshot {
    Account account;
    double cashKrw;
    double holdingKrw;
    double totalKrw;
    double nativeCash;
    double nativeHolding;
    double realizedPnlNative;
    double realizedPnlKrw;
    double unrealizedPnlNative;
    double unrealizedPnlKrw;
    double investmentPnlNative;
    double investmentPnlKrw;
    int holdingCount;
    int actionCount;
}

final class AssetSnapshotPoint {
    String id;
    String dateKey;
    String label;
    String createdAt;
    String reason;
    double totalKrw;
    double cashKrw;
    double holdingKrw;
    double usKrw;
    double krKrw;
    double pensionKrw;
    double usdKrw;
    double realizedPnlKrw;
    double unrealizedPnlKrw;
    double investmentPnlKrw;
    int pnlBasisVersion;
    int entryCount;

    static AssetSnapshotPoint fromJson(JSONObject json) {
        AssetSnapshotPoint point = new AssetSnapshotPoint();
        point.id = json.optString("id");
        point.dateKey = json.optString("dateKey");
        point.label = point.dateKey;
        point.createdAt = json.optString("createdAt");
        point.reason = json.optString("reason");
        point.totalKrw = json.optDouble("totalKrw", 0);
        point.cashKrw = json.optDouble("cashKrw", 0);
        point.holdingKrw = json.optDouble("holdingKrw", 0);
        point.usKrw = json.optDouble("usKrw", 0);
        point.krKrw = json.optDouble("krKrw", 0);
        point.pensionKrw = json.optDouble("pensionKrw", 0);
        point.usdKrw = json.optDouble("usdKrw", 0);
        point.realizedPnlKrw = json.optDouble("realizedPnlKrw", 0);
        point.unrealizedPnlKrw = json.optDouble("unrealizedPnlKrw", 0);
        point.investmentPnlKrw = json.optDouble("investmentPnlKrw", 0);
        point.pnlBasisVersion = json.optInt("pnlBasisVersion", 0);
        point.entryCount = json.optInt("entryCount", 0);
        return point;
    }

    AssetSnapshotPoint copy() {
        AssetSnapshotPoint point = new AssetSnapshotPoint();
        point.id = id;
        point.dateKey = dateKey;
        point.label = label;
        point.createdAt = createdAt;
        point.reason = reason;
        point.totalKrw = totalKrw;
        point.cashKrw = cashKrw;
        point.holdingKrw = holdingKrw;
        point.usKrw = usKrw;
        point.krKrw = krKrw;
        point.pensionKrw = pensionKrw;
        point.usdKrw = usdKrw;
        point.realizedPnlKrw = realizedPnlKrw;
        point.unrealizedPnlKrw = unrealizedPnlKrw;
        point.investmentPnlKrw = investmentPnlKrw;
        point.pnlBasisVersion = pnlBasisVersion;
        point.entryCount = entryCount;
        return point;
    }
}

final class LedgerEntry {
    String id;
    String accountId;
    String type;
    String currency;
    String signalId;
    String market;
    String strategyKey;
    String symbol;
    String name;
    String fromCurrency;
    String toCurrency;
    String voidedAt;
    String voidedBy;
    String cancelledEntryId;
    String cancelledType;
    String cancelledLabel;
    String createdAt;
    String memo;
    String lotMode;
    String selectedLotId;
    double quantity;
    double price;
    double fee;
    double amount;
    double netProceeds;
    double costBasis;
    double realizedPnl;
    double realizedPnlPercent;
    double fromAmount;
    double toAmount;
    double fxRateKrw;
    double grossDividend;
    double dividendTax;

    static LedgerEntry fromJson(JSONObject json) {
        LedgerEntry entry = new LedgerEntry();
        entry.id = json.optString("id");
        entry.accountId = json.optString("accountId", LedgerStore.ACCOUNT_KR);
        entry.type = json.optString("type");
        entry.currency = json.optString("currency", "KRW");
        entry.signalId = json.optString("signalId");
        entry.market = json.optString("market");
        entry.strategyKey = json.optString("strategyKey");
        entry.symbol = json.optString("symbol");
        entry.name = json.optString("name");
        entry.fromCurrency = json.optString("fromCurrency");
        entry.toCurrency = json.optString("toCurrency");
        entry.voidedAt = json.optString("voidedAt");
        entry.voidedBy = json.optString("voidedBy");
        entry.cancelledEntryId = json.optString("cancelledEntryId");
        entry.cancelledType = json.optString("cancelledType");
        entry.cancelledLabel = json.optString("cancelledLabel");
        entry.createdAt = json.optString("createdAt");
        entry.memo = json.optString("memo");
        entry.lotMode = json.optString("lotMode");
        entry.selectedLotId = json.optString("selectedLotId");
        entry.quantity = json.optDouble("quantity", 0);
        entry.price = json.optDouble("price", 0);
        entry.fee = json.optDouble("fee", 0);
        entry.amount = json.optDouble("amount", 0);
        entry.netProceeds = json.optDouble("netProceeds", 0);
        entry.costBasis = json.optDouble("costBasis", 0);
        entry.realizedPnl = json.optDouble("realizedPnl", 0);
        entry.realizedPnlPercent = json.optDouble("realizedPnlPercent", 0);
        entry.fromAmount = json.optDouble("fromAmount", 0);
        entry.toAmount = json.optDouble("toAmount", 0);
        entry.fxRateKrw = json.optDouble("fxRateKrw", 0);
        entry.grossDividend = json.optDouble("grossDividend", 0);
        entry.dividendTax = json.optDouble("dividendTax", 0);
        return entry;
    }
}

final class LotDisposition {
    final boolean ok;
    final String message;
    final String mode;
    final String selectedLotId;
    final double costBasis;
    final double netProceeds;
    final double realizedPnl;
    final double realizedPnlPercent;
    final JSONArray details;

    private LotDisposition(boolean ok, String message, String mode, String selectedLotId, double costBasis, double gross, double fee, JSONArray details) {
        this.ok = ok;
        this.message = message;
        this.mode = mode;
        this.selectedLotId = selectedLotId;
        this.costBasis = costBasis;
        this.netProceeds = gross - fee;
        this.realizedPnl = netProceeds - costBasis;
        this.realizedPnlPercent = costBasis <= 0 ? 0 : realizedPnl / costBasis * 100;
        this.details = details == null ? new JSONArray() : details;
    }

    static LotDisposition ok(String mode, String selectedLotId, double costBasis, double gross, double fee, JSONArray details) {
        return new LotDisposition(true, "ok", mode, selectedLotId, costBasis, gross, fee, details);
    }

    static LotDisposition fail(String message) {
        return new LotDisposition(false, message, "", "", 0, 0, 0, new JSONArray());
    }

    void putInto(JSONObject json) throws JSONException {
        json.put("lotMode", mode);
        if (selectedLotId != null && !selectedLotId.isEmpty()) {
            json.put("selectedLotId", selectedLotId);
        }
        json.put("netProceeds", netProceeds);
        json.put("costBasis", costBasis);
        json.put("realizedPnl", realizedPnl);
        json.put("realizedPnlPercent", realizedPnlPercent);
        json.put("lotDispositions", details);
    }
}

final class Holding {
    String accountId;
    String symbol;
    String name;
    String market;
    String currency;
    double quantity;
    double cost;
    double invested;
}

final class HoldingLot {
    String lotId;
    String accountId;
    String signalId;
    String strategyKey;
    String symbol;
    String name;
    String market;
    String currency;
    String openedAt;
    String openedDate;
    String sixMonthDate;
    String twelveMonthDate;
    double originalQuantity;
    double remainingQuantity;
    double price;
    double originalCost;
    double remainingCost;
    int ageDays;
    int daysUntilSixMonth;
    int daysUntilTwelveMonth;

    static HoldingLot fromBuy(JSONObject json) {
        HoldingLot lot = new HoldingLot();
        lot.lotId = json.optString("id");
        lot.accountId = json.optString("accountId");
        lot.signalId = json.optString("signalId");
        lot.strategyKey = json.optString("strategyKey");
        lot.symbol = json.optString("symbol");
        lot.name = json.optString("name", lot.symbol);
        lot.market = json.optString("market", "");
        lot.currency = json.optString("currency", "KRW");
        lot.openedAt = json.optString("createdAt");
        lot.openedDate = dateKey(lot.openedAt);
        lot.originalQuantity = json.optDouble("quantity", 0);
        lot.remainingQuantity = lot.originalQuantity;
        lot.price = json.optDouble("price", 0);
        lot.originalCost = json.optDouble("amount", 0) + json.optDouble("fee", 0);
        lot.remainingCost = lot.originalCost;
        lot.refreshSchedule();
        return lot;
    }

    void refreshSchedule() {
        Date opened = parseDate(openedDate);
        Date today = parseDate(todayKey());
        Date six = addMonths(opened, 6);
        Date twelve = addMonths(opened, 12);
        sixMonthDate = formatDate(six);
        twelveMonthDate = formatDate(twelve);
        ageDays = daysBetween(opened, today);
        daysUntilSixMonth = daysBetween(today, six);
        daysUntilTwelveMonth = daysBetween(today, twelve);
    }

    double sixMonthDueQuantity() {
        if (daysUntilSixMonth > 0 || daysUntilTwelveMonth <= 0) {
            return 0;
        }
        double targetRemaining = originalQuantity * 0.5;
        return Math.max(0, remainingQuantity - targetRemaining);
    }

    double twelveMonthDueQuantity() {
        return daysUntilTwelveMonth <= 0 ? remainingQuantity : 0;
    }

    double weeklyBreakDueQuantity(boolean trendBroken) {
        if (!trendBroken || daysUntilTwelveMonth <= 0 || sixMonthDueQuantity() > 0) {
            return 0;
        }
        return remainingQuantity;
    }

    private static String dateKey(String createdAt) {
        if (createdAt != null && createdAt.length() >= 10) {
            return createdAt.substring(0, 10);
        }
        return todayKey();
    }

    private static String todayKey() {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.KOREA).format(new Date());
    }

    private static Date parseDate(String value) {
        try {
            return new SimpleDateFormat("yyyy-MM-dd", Locale.KOREA).parse(value);
        } catch (ParseException error) {
            return new Date();
        }
    }

    private static Date addMonths(Date date, int months) {
        Calendar calendar = Calendar.getInstance(Locale.KOREA);
        calendar.setTime(date);
        calendar.add(Calendar.MONTH, months);
        return calendar.getTime();
    }

    private static int daysBetween(Date start, Date end) {
        long diff = end.getTime() - start.getTime();
        return (int) TimeUnit.MILLISECONDS.toDays(diff);
    }

    private static String formatDate(Date date) {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.KOREA).format(date);
    }
}

final class LotSummary {
    int openLots;
    int sixMonthDue;
    int twelveMonthDue;
}

final class ValidationResult {
    final boolean ok;
    final String message;

    private ValidationResult(boolean ok, String message) {
        this.ok = ok;
        this.message = message;
    }

    static ValidationResult ok(String message) {
        return new ValidationResult(true, message);
    }

    static ValidationResult fail(String message) {
        return new ValidationResult(false, message);
    }
}
