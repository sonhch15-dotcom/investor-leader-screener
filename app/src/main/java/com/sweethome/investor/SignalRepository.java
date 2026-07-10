package com.sweethome.investor;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

final class SignalRepository {
    private static final String PREFS = "signal_package_cache";
    private static final String KEY_BASE_URL = "base_url";
    private static final String KEY_MANIFEST = "manifest_json";
    private static final String KEY_SIGNALS = "signals_json";
    private static final String KEY_WEEKLY = "weekly_json";
    private static final String KEY_PRICES = "prices_json";
    private static final String KEY_FX = "fx_json";
    private static final String KEY_LAST_SUCCESSFUL_SYNC_AT = "last_successful_sync_at";
    private static final String KEY_LAST_SYNC_ERROR = "last_sync_error";
    private static final String KEY_LIVE_PRICES = "live_prices_json";
    private static final String KEY_LIVE_FX = "live_fx_json";
    private static final String KEY_LAST_LIVE_SYNC_AT = "last_live_sync_at";
    private static final String KEY_LAST_LIVE_SYNC_ERROR = "last_live_sync_error";

    String schemaVersion = "1.0.0";
    String packageVersion = "";
    String generatedAt = "";
    String asOf = "";
    String status = "failed";
    String signalMonth = "";
    String dataMessage = "";
    String priceAsOf = "";
    String priceStatus = "failed";
    String fxAsOf = "";
    String fxStatus = "failed";
    String fxSource = "";
    String lastSuccessfulSyncAt = "";
    String lastSyncError = "";
    String lastLiveQuoteSyncAt = "";
    String lastLiveQuoteError = "";
    int quoteFailedCount = 0;
    int staleQuoteCount = 0;
    String source = "asset";
    double usdKrw = 1378.5;
    final List<StrategySignal> signals = new ArrayList<>();
    final List<EtfTarget> etfTargets = new ArrayList<>();
    final Map<String, WeeklyTrend> trends = new HashMap<>();
    final Map<String, PriceQuote> prices = new HashMap<>();

    static SignalRepository load(Context context) {
        SharedPreferences prefs = prefs(context);
        String manifest = prefs.getString(KEY_MANIFEST, null);
        String signals = prefs.getString(KEY_SIGNALS, null);
        String weekly = prefs.getString(KEY_WEEKLY, null);
        String prices = prefs.getString(KEY_PRICES, null);
        String fx = prefs.getString(KEY_FX, null);
        if (manifest != null && signals != null && weekly != null && prices != null && fx != null) {
            try {
                if (!isAssetPackageNewer(context, manifest)) {
                    SignalRepository repository = parsePackage(manifest, signals, weekly, prices, fx, "remote cache");
                    repository.attachSyncState(prefs);
                    return repository;
                }
                clearRemoteCache(context);
            } catch (IOException | JSONException ignored) {
                clearRemoteCache(context);
            }
        }

        try {
            SignalRepository repository = parsePackage(
                    readAsset(context, "api/manifest.json"),
                    readAsset(context, "api/signals/latest.json"),
                    readAsset(context, "api/weekly-trends/latest.json"),
                    readAsset(context, "api/prices/latest.json"),
                    readAsset(context, "api/fx/latest.json"),
                    "asset"
            );
            repository.attachSyncState(prefs);
            return repository;
        } catch (IOException | JSONException error) {
            SignalRepository repository = new SignalRepository();
            repository.status = "failed";
            repository.dataMessage = error.getMessage() == null ? "데이터 로드 실패" : error.getMessage();
            repository.attachSyncState(prefs);
            return repository;
        }
    }

    private static boolean isAssetPackageNewer(Context context, String cachedManifestText) throws IOException, JSONException {
        JSONObject cached = new JSONObject(cachedManifestText);
        JSONObject asset = new JSONObject(readAsset(context, "api/manifest.json"));
        String cachedVersion = cached.optString("packageVersion", cached.optString("generatedAt", ""));
        String assetVersion = asset.optString("packageVersion", asset.optString("generatedAt", ""));
        return !cachedVersion.isEmpty() && !assetVersion.isEmpty() && assetVersion.compareTo(cachedVersion) > 0;
    }

    static String remoteBaseUrl(Context context) {
        return prefs(context).getString(KEY_BASE_URL, "");
    }

    static void setRemoteBaseUrl(Context context, String baseUrl) {
        prefs(context).edit().putString(KEY_BASE_URL, normalizeBaseUrl(baseUrl)).apply();
    }

    static void clearRemoteCache(Context context) {
        prefs(context).edit()
                .remove(KEY_MANIFEST)
                .remove(KEY_SIGNALS)
                .remove(KEY_WEEKLY)
                .remove(KEY_PRICES)
                .remove(KEY_FX)
                .remove(KEY_LIVE_PRICES)
                .remove(KEY_LIVE_FX)
                .remove(KEY_LAST_LIVE_SYNC_AT)
                .remove(KEY_LAST_LIVE_SYNC_ERROR)
                .apply();
    }

    static SyncResult syncFromRemote(Context context, String baseUrl) {
        String normalized = normalizeBaseUrl(baseUrl);
        if (normalized.isEmpty()) {
            return SyncResult.failure("GitHub Pages API URL이 비어 있습니다.");
        }
        try {
            String manifest = fetchText(normalized + "/manifest.json");
            if (isAssetPackageNewer(context, manifest)) {
                return SyncResult.failure("원격 데이터가 현재 APK 내장 데이터보다 오래되어 적용하지 않았습니다.");
            }
            String signals = fetchText(normalized + "/signals/latest.json");
            String weekly = fetchText(normalized + "/weekly-trends/latest.json");
            String prices = fetchText(normalized + "/prices/latest.json");
            String fx = fetchText(normalized + "/fx/latest.json");
            validateManifestAndPayloads(manifest, signals, weekly, prices, fx);
            SignalRepository repository = parsePackage(manifest, signals, weekly, prices, fx, "remote");
            String syncedAt = now();
            prefs(context).edit()
                    .putString(KEY_BASE_URL, normalized)
                    .putString(KEY_MANIFEST, manifest)
                    .putString(KEY_SIGNALS, signals)
                    .putString(KEY_WEEKLY, weekly)
                    .putString(KEY_PRICES, prices)
                    .putString(KEY_FX, fx)
                    .putString(KEY_LAST_SUCCESSFUL_SYNC_AT, syncedAt)
                    .remove(KEY_LAST_SYNC_ERROR)
                    .apply();
            repository.lastSuccessfulSyncAt = syncedAt;
            repository.lastSyncError = "";
            return SyncResult.success(repository, "원격 신호와 시세를 동기화했습니다.");
        } catch (IOException | JSONException error) {
            String message = error.getMessage() == null ? "원격 동기화 실패" : error.getMessage();
            prefs(context).edit().putString(KEY_LAST_SYNC_ERROR, message).apply();
            return SyncResult.failure(message);
        }
    }

    static SyncResult syncNoKeyMarketData(Context context, SignalRepository repository, List<QuoteRequest> requests) {
        if (repository == null) {
            return SyncResult.failure("현재 신호 저장소가 없습니다.");
        }
        List<QuoteRequest> targets = uniqueRequests(requests);
        List<PriceQuote> liveQuotes = new ArrayList<>();
        List<String> errors = new ArrayList<>();
        if (!targets.isEmpty()) {
            try {
                liveQuotes.addAll(fetchYahooQuoteBatch(targets));
            } catch (IOException | JSONException error) {
                // Yahoo's batch quote endpoint can reject direct clients. Per-symbol chart fallback below is authoritative.
            }
            Set<String> completed = new HashSet<>();
            for (PriceQuote quote : liveQuotes) {
                completed.add(quote.symbol);
            }
            for (QuoteRequest request : targets) {
                if (completed.contains(request.symbol)) {
                    continue;
                }
                try {
                    PriceQuote quote = fetchYahooChartQuote(request);
                    if (quote.price > 0) {
                        liveQuotes.add(quote);
                        completed.add(request.symbol);
                    }
                } catch (IOException | JSONException error) {
                    errors.add(request.symbol + ": " + shortMessage(error));
                }
            }
        }

        FxQuote fxQuote = null;
        try {
            fxQuote = fetchFrankfurterUsdKrw();
        } catch (IOException | JSONException error) {
            try {
                fxQuote = fetchYahooUsdKrw();
            } catch (IOException | JSONException yahooError) {
                errors.add("환율: Frankfurter " + shortMessage(error) + " / Yahoo " + shortMessage(yahooError));
            }
        }

        boolean hasQuote = !liveQuotes.isEmpty();
        boolean hasFx = fxQuote != null && fxQuote.rate > 0;
        String syncedAt = now();
        SharedPreferences.Editor editor = prefs(context).edit();
        QuoteMergeResult mergedQuotes;
        try {
            mergedQuotes = hasQuote
                    ? mergeLiveQuotes(prefs(context).getString(KEY_LIVE_PRICES, null), liveQuotes, targets)
                    : new QuoteMergeResult(liveQuotes, 0);
            if (hasQuote) {
                editor.putString(KEY_LIVE_PRICES, livePricesJson(mergedQuotes.quotes));
            }
            if (hasFx) {
                editor.putString(KEY_LIVE_FX, liveFxJson(fxQuote));
            }
            if (hasQuote || hasFx) {
                editor.putString(KEY_LAST_LIVE_SYNC_AT, syncedAt);
                if (errors.isEmpty()) {
                    editor.remove(KEY_LAST_LIVE_SYNC_ERROR);
                } else {
                    editor.putString(KEY_LAST_LIVE_SYNC_ERROR, joinErrors(errors));
                }
            } else {
                editor.putString(KEY_LAST_LIVE_SYNC_ERROR, joinErrors(errors));
            }
            editor.apply();
            repository.applyLiveOverlay(prefs(context));
        } catch (JSONException error) {
            String message = "직접 시세 저장 실패: " + shortMessage(error);
            prefs(context).edit().putString(KEY_LAST_LIVE_SYNC_ERROR, message).apply();
            return SyncResult.failure(message);
        }

        if (hasQuote || hasFx) {
            String message = "직접 시세 갱신: 가격 " + liveQuotes.size() + "개"
                    + (hasQuote && mergedQuotes.reusedCount > 0 ? " · 이전 정상 " + mergedQuotes.reusedCount + "개 유지" : "")
                    + (hasFx ? " · 환율 " + String.format(Locale.US, "%.2f", fxQuote.rate) : " · 환율 실패");
            if (!errors.isEmpty()) {
                message += " · 일부 실패 " + errors.size() + "건";
            }
            return SyncResult.success(repository, message);
        }
        return SyncResult.failure(errors.isEmpty() ? "직접 시세 갱신 실패" : joinErrors(errors));
    }

    private static List<QuoteRequest> uniqueRequests(List<QuoteRequest> requests) {
        Map<String, QuoteRequest> unique = new LinkedHashMap<>();
        if (requests != null) {
            for (QuoteRequest request : requests) {
                if (request != null && request.symbol != null && !request.symbol.trim().isEmpty()) {
                    unique.put(request.symbol, request);
                }
            }
        }
        return new ArrayList<>(unique.values());
    }

    private static List<PriceQuote> fetchYahooQuoteBatch(List<QuoteRequest> requests) throws IOException, JSONException {
        Map<String, QuoteRequest> byYahooSymbol = new HashMap<>();
        List<String> yahooSymbols = new ArrayList<>();
        for (QuoteRequest request : requests) {
            String yahooSymbol = yahooSymbolFor(request);
            byYahooSymbol.put(yahooSymbol, request);
            yahooSymbols.add(encode(yahooSymbol));
        }
        String url = "https://query1.finance.yahoo.com/v7/finance/quote?symbols=" + join(yahooSymbols, ",");
        JSONObject root = new JSONObject(fetchText(url, 7_000, 7_000));
        JSONObject response = root.optJSONObject("quoteResponse");
        JSONArray result = response == null ? null : response.optJSONArray("result");
        if (result == null) {
            throw new JSONException("quoteResponse.result 없음");
        }
        List<PriceQuote> quotes = new ArrayList<>();
        for (int index = 0; index < result.length(); index++) {
            JSONObject item = result.optJSONObject(index);
            if (item == null) {
                continue;
            }
            QuoteRequest request = byYahooSymbol.get(item.optString("symbol"));
            if (request == null) {
                continue;
            }
            double price = firstPositive(item, "regularMarketPrice", "postMarketPrice", "preMarketPrice");
            if (price <= 0) {
                continue;
            }
            PriceQuote quote = new PriceQuote();
            quote.symbol = request.symbol;
            quote.name = firstText(item, request.name, "shortName", "longName", "displayName");
            quote.market = request.market;
            quote.currency = firstText(item, request.currency, "currency");
            quote.price = price;
            quote.priceDate = dateFromEpochSeconds(item.optLong("regularMarketTime", 0));
            quote.source = "yahoo-quote";
            quote.status = "normal";
            quotes.add(quote);
        }
        return quotes;
    }

    private static PriceQuote fetchYahooChartQuote(QuoteRequest request) throws IOException, JSONException {
        String yahooSymbol = yahooSymbolFor(request);
        String url = "https://query1.finance.yahoo.com/v8/finance/chart/" + encode(yahooSymbol) + "?range=5d&interval=1d";
        JSONObject root = new JSONObject(fetchText(url, 7_000, 7_000));
        JSONObject chart = root.optJSONObject("chart");
        JSONArray result = chart == null ? null : chart.optJSONArray("result");
        if (result == null || result.length() == 0) {
            throw new JSONException("chart.result 없음");
        }
        JSONObject data = result.getJSONObject(0);
        JSONObject meta = data.optJSONObject("meta");
        if (meta == null) {
            throw new JSONException("chart.meta 없음");
        }
        double price = meta.optDouble("regularMarketPrice", 0);
        if (price <= 0) {
            price = latestClose(data);
        }
        if (price <= 0) {
            throw new JSONException("가격 없음");
        }
        PriceQuote quote = new PriceQuote();
        quote.symbol = request.symbol;
        quote.name = request.name;
        quote.market = request.market;
        quote.currency = meta.optString("currency", request.currency);
        quote.price = price;
        quote.priceDate = dateFromEpochSeconds(meta.optLong("regularMarketTime", 0));
        quote.source = "yahoo-chart";
        quote.status = "normal";
        return quote;
    }

    private static FxQuote fetchFrankfurterUsdKrw() throws IOException, JSONException {
        String raw = fetchText("https://api.frankfurter.dev/v2/rates?base=USD&quotes=KRW", 7_000, 7_000).trim();
        double rate = 0;
        String date = todayKey();
        if (raw.startsWith("[")) {
            JSONArray rows = new JSONArray(raw);
            JSONObject row = rows.length() == 0 ? null : rows.getJSONObject(0);
            if (row != null) {
                rate = row.optDouble("rate", 0);
                date = row.optString("date", date);
            }
        } else {
            JSONObject root = new JSONObject(raw);
            JSONObject rates = root.optJSONObject("rates");
            rate = rates == null ? root.optDouble("rate", 0) : rates.optDouble("KRW", 0);
            date = root.optString("date", date);
        }
        if (rate <= 0) {
            throw new JSONException("KRW 환율 없음");
        }
        return new FxQuote(rate, date, "frankfurter");
    }

    private static FxQuote fetchYahooUsdKrw() throws IOException, JSONException {
        QuoteRequest request = new QuoteRequest("KRW=X", "USD/KRW", "FX", "KRW");
        PriceQuote quote = fetchYahooChartQuote(request);
        if (quote.price <= 0) {
            throw new JSONException("Yahoo FX 가격 없음");
        }
        return new FxQuote(quote.price, quote.priceDate, "yahoo-chart:KRW=X");
    }

    private static String livePricesJson(List<PriceQuote> quotes) throws JSONException {
        JSONObject root = new JSONObject();
        JSONArray array = new JSONArray();
        String asOf = "";
        for (PriceQuote quote : quotes) {
            array.put(quote.toJson());
            if (quote.priceDate != null && quote.priceDate.compareTo(asOf) > 0) {
                asOf = quote.priceDate;
            }
        }
        root.put("schemaVersion", "1.0.0");
        root.put("generatedAt", now());
        root.put("asOf", asOf.isEmpty() ? todayKey() : asOf);
        root.put("status", "normal");
        root.put("quotes", array);
        return root.toString();
    }

    private static String liveFxJson(FxQuote fxQuote) throws JSONException {
        JSONObject root = new JSONObject();
        JSONArray rates = new JSONArray();
        JSONObject rate = new JSONObject();
        rate.put("currency", "USD");
        rate.put("rate", fxQuote.rate);
        rate.put("source", fxQuote.source);
        rates.put(rate);
        root.put("schemaVersion", "1.0.0");
        root.put("generatedAt", now());
        root.put("asOf", fxQuote.dateKey == null || fxQuote.dateKey.isEmpty() ? todayKey() : fxQuote.dateKey);
        root.put("status", "normal");
        root.put("baseCurrency", "KRW");
        root.put("rates", rates);
        return root.toString();
    }

    static QuoteMergeResult mergeLiveQuotes(String cachedRaw, List<PriceQuote> freshQuotes, List<QuoteRequest> targets) throws JSONException {
        List<PriceQuote> cachedQuotes = new ArrayList<>();
        if (cachedRaw != null && !cachedRaw.trim().isEmpty()) {
            JSONObject cached = new JSONObject(cachedRaw);
            JSONArray quoteArray = cached.optJSONArray("quotes");
            if (quoteArray != null) {
                for (int index = 0; index < quoteArray.length(); index++) {
                    cachedQuotes.add(PriceQuote.fromJson(quoteArray.getJSONObject(index)));
                }
            }
        }
        return mergeLiveQuoteLists(cachedQuotes, freshQuotes, targets);
    }

    static QuoteMergeResult mergeLiveQuoteLists(List<PriceQuote> cachedQuotes, List<PriceQuote> freshQuotes, List<QuoteRequest> targets) {
        Map<String, PriceQuote> merged = new LinkedHashMap<>();
        Set<String> requested = new HashSet<>();
        for (QuoteRequest target : targets) {
            if (target != null && target.symbol != null && !target.symbol.isEmpty()) {
                requested.add(target.symbol);
            }
        }
        for (PriceQuote quote : freshQuotes) {
            if (quote != null && quote.price > 0 && quote.symbol != null && !quote.symbol.isEmpty()) {
                merged.put(quote.symbol, quote);
            }
        }
        int reused = 0;
        for (PriceQuote quote : cachedQuotes) {
            if (quote == null || quote.symbol.isEmpty() || merged.containsKey(quote.symbol) || !requested.contains(quote.symbol)) {
                continue;
            }
            if (quote.price > 0 && "normal".equals(quote.status) && !containsRiskWord(quote.source)) {
                merged.put(quote.symbol, quote);
                reused++;
            }
        }
        return new QuoteMergeResult(new ArrayList<>(merged.values()), reused);
    }

    private static SignalRepository parsePackage(
            String manifestText,
            String latestText,
            String weeklyText,
            String pricesText,
            String fxText,
            String source
    ) throws JSONException {
        SignalRepository repository = new SignalRepository();
        repository.source = source;
        JSONObject manifest = new JSONObject(manifestText);
        repository.schemaVersion = manifest.optString("schemaVersion", "1.0.0");
        repository.packageVersion = manifest.optString("packageVersion", "");
        repository.generatedAt = manifest.optString("generatedAt", "");
        repository.status = manifest.optString("status", "normal");

        JSONObject latest = new JSONObject(latestText);
        repository.signalMonth = latest.optString("signalMonth", "");
        repository.asOf = latest.optString("asOf", "");
        repository.status = latest.optString("status", repository.status);
        JSONArray signalArray = latest.optJSONArray("signals");
        if (signalArray != null) {
            for (int index = 0; index < signalArray.length(); index++) {
                repository.signals.add(StrategySignal.fromJson(signalArray.getJSONObject(index)));
            }
        }
        JSONArray targets = latest.optJSONArray("targetWeights");
        if (targets != null) {
            for (int index = 0; index < targets.length(); index++) {
                repository.etfTargets.add(EtfTarget.fromJson(targets.getJSONObject(index)));
            }
        }

        JSONObject weekly = new JSONObject(weeklyText);
        JSONArray trendArray = weekly.optJSONArray("trends");
        if (trendArray != null) {
            for (int index = 0; index < trendArray.length(); index++) {
                WeeklyTrend trend = WeeklyTrend.fromJson(trendArray.getJSONObject(index));
                repository.trends.put(trend.symbol, trend);
            }
        }

        JSONObject prices = new JSONObject(pricesText);
        repository.priceAsOf = prices.optString("asOf", "");
        repository.priceStatus = prices.optString("status", "normal");
        JSONArray quoteArray = prices.optJSONArray("quotes");
        if (quoteArray != null) {
            for (int index = 0; index < quoteArray.length(); index++) {
                PriceQuote quote = PriceQuote.fromJson(quoteArray.getJSONObject(index));
                repository.prices.put(quote.symbol, quote);
                if (quote.price <= 0 || "failed".equals(quote.status) || containsRiskWord(quote.source)) {
                    repository.quoteFailedCount++;
                } else if (!"normal".equals(quote.status)) {
                    repository.staleQuoteCount++;
                }
            }
        }

        JSONObject fx = new JSONObject(fxText);
        repository.fxAsOf = fx.optString("asOf", "");
        repository.fxStatus = fx.optString("status", "normal");
        JSONArray rates = fx.optJSONArray("rates");
        if (rates != null) {
            for (int index = 0; index < rates.length(); index++) {
                JSONObject rate = rates.getJSONObject(index);
                if ("USD".equals(rate.optString("currency"))) {
                    repository.usdKrw = rate.optDouble("rate", repository.usdKrw);
                    repository.fxSource = rate.optString("source", repository.fxSource);
                    if (!rate.optString("error", "").isEmpty()) {
                        repository.fxStatus = "failed";
                    }
                }
            }
        }
        repository.refreshReliabilityState();
        return repository;
    }

    private void attachSyncState(SharedPreferences prefs) {
        lastSuccessfulSyncAt = prefs.getString(KEY_LAST_SUCCESSFUL_SYNC_AT, "");
        lastSyncError = prefs.getString(KEY_LAST_SYNC_ERROR, "");
        applyLiveOverlay(prefs);
    }

    private void applyLiveOverlay(SharedPreferences prefs) {
        lastLiveQuoteSyncAt = prefs.getString(KEY_LAST_LIVE_SYNC_AT, "");
        lastLiveQuoteError = prefs.getString(KEY_LAST_LIVE_SYNC_ERROR, "");
        applyLivePrices(prefs.getString(KEY_LIVE_PRICES, null));
        applyLiveFx(prefs.getString(KEY_LIVE_FX, null));
        refreshReliabilityState();
    }

    private void applyLivePrices(String raw) {
        if (raw == null || raw.trim().isEmpty()) {
            refreshReliabilityState();
            return;
        }
        try {
            JSONObject live = new JSONObject(raw);
            String liveAsOf = live.optString("asOf", "");
            if (!liveAsOf.isEmpty()) {
                priceAsOf = liveAsOf;
            }
            priceStatus = live.optString("status", priceStatus);
            JSONArray quoteArray = live.optJSONArray("quotes");
            if (quoteArray != null) {
                for (int index = 0; index < quoteArray.length(); index++) {
                    PriceQuote quote = PriceQuote.fromJson(quoteArray.getJSONObject(index));
                    if (quote.price > 0 && !quote.symbol.isEmpty()) {
                        prices.put(quote.symbol, quote);
                    }
                }
            }
        } catch (JSONException ignored) {
            lastLiveQuoteError = "직접 가격 캐시 파싱 실패";
        }
    }

    private void applyLiveFx(String raw) {
        if (raw == null || raw.trim().isEmpty()) {
            refreshReliabilityState();
            return;
        }
        try {
            JSONObject live = new JSONObject(raw);
            String liveAsOf = live.optString("asOf", "");
            if (!liveAsOf.isEmpty()) {
                fxAsOf = liveAsOf;
            }
            fxStatus = live.optString("status", fxStatus);
            JSONArray rates = live.optJSONArray("rates");
            if (rates != null) {
                for (int index = 0; index < rates.length(); index++) {
                    JSONObject rate = rates.getJSONObject(index);
                    if ("USD".equals(rate.optString("currency")) && rate.optDouble("rate", 0) > 0) {
                        usdKrw = rate.optDouble("rate", usdKrw);
                        fxSource = rate.optString("source", fxSource);
                    }
                }
            }
        } catch (JSONException ignored) {
            lastLiveQuoteError = "직접 환율 캐시 파싱 실패";
        }
    }

    private void refreshReliabilityState() {
        quoteFailedCount = 0;
        staleQuoteCount = 0;
        for (PriceQuote quote : prices.values()) {
            if (quote.price <= 0 || "failed".equals(quote.status) || containsRiskWord(quote.source)) {
                quoteFailedCount++;
            } else if (!"normal".equals(quote.status)) {
                staleQuoteCount++;
            }
        }
        dataMessage = hasReliableTradingData() ? "정상" : dataReliabilityMessage();
    }

    boolean hasReliableTradingData() {
        return "normal".equals(status)
                && "normal".equals(priceStatus)
                && "normal".equals(fxStatus)
                && quoteFailedCount == 0
                && staleQuoteCount == 0;
    }

    boolean isQuoteReliable(String symbol) {
        PriceQuote quote = prices.get(symbol);
        return quote != null
                && quote.price > 0
                && "normal".equals(quote.status)
                && !containsRiskWord(quote.source);
    }

    boolean canTradeSymbol(String symbol) {
        return "normal".equals(status)
                && "normal".equals(fxStatus)
                && isQuoteReliable(symbol);
    }

    double effectiveTrendClose(WeeklyTrend trend) {
        PriceQuote quote = trendOverlayQuote(trend);
        if (quote != null) {
            return quote.price;
        }
        return trend == null ? 0 : trend.close;
    }

    String effectiveTrendDate(WeeklyTrend trend) {
        PriceQuote quote = trendOverlayQuote(trend);
        if (quote != null && quote.priceDate != null && !quote.priceDate.isEmpty()) {
            return quote.priceDate;
        }
        return trend == null ? "" : safe(trend.weekEndDate);
    }

    String effectiveTrendState(WeeklyTrend trend) {
        if (trend == null) {
            return "unknown";
        }
        if ("broken".equals(trend.trendState) && !isTrendBrokenNow(trend)) {
            return "normal";
        }
        return trend.trendState;
    }

    boolean trendUsesLatestQuote(WeeklyTrend trend) {
        return trendOverlayQuote(trend) != null;
    }

    boolean isTrendBrokenNow(WeeklyTrend trend) {
        if (trend == null || !"broken".equals(trend.trendState)) {
            return false;
        }
        PriceQuote quote = trendOverlayQuote(trend);
        double latestPrice = quote == null ? 0 : quote.price;
        return StrategyMath.weeklyBreakStillValid(trend.close, trend.weeklyTrendLine, latestPrice);
    }

    private PriceQuote trendOverlayQuote(WeeklyTrend trend) {
        if (trend == null || trend.symbol == null || trend.symbol.isEmpty() || !isQuoteReliable(trend.symbol)) {
            return null;
        }
        PriceQuote quote = prices.get(trend.symbol);
        if (quote == null || quote.price <= 0) {
            return null;
        }
        String quoteDay = dateKey(quote.priceDate);
        if (quoteDay.isEmpty()) {
            return null;
        }
        String trendDay = trend.breakDate == null || trend.breakDate.isEmpty()
                ? dateKey(trend.weekEndDate)
                : dateKey(trend.breakDate);
        if (!trendDay.isEmpty() && quoteDay.compareTo(trendDay) < 0) {
            return null;
        }
        return quote;
    }

    String quoteStatusText(String symbol) {
        PriceQuote quote = prices.get(symbol);
        if (quote == null) {
            return "가격 없음";
        }
        String statusText = quote.status == null || quote.status.isEmpty() ? "unknown" : quote.status;
        String sourceText = quote.source == null || quote.source.isEmpty() ? "source 없음" : quote.source;
        return statusText + " · " + safe(quote.priceDate) + " · " + sourceText;
    }

    String dataReliabilityMessage() {
        if (!"normal".equals(status)) {
            return "신호 상태: " + status;
        }
        if (!"normal".equals(priceStatus)) {
            return "가격 상태: " + priceStatus;
        }
        if (!"normal".equals(fxStatus)) {
            return "환율 상태: " + fxStatus;
        }
        if (quoteFailedCount > 0) {
            return "가격 실패 " + quoteFailedCount + "개";
        }
        if (staleQuoteCount > 0) {
            return "지연 가격 " + staleQuoteCount + "개";
        }
        return "정상";
    }

    private static void validateManifestAndPayloads(
            String manifestText,
            String signalsText,
            String weeklyText,
            String pricesText,
            String fxText
    ) throws JSONException, IOException {
        JSONObject manifest = new JSONObject(manifestText);
        String schemaVersion = manifest.optString("schemaVersion", "");
        if (!schemaVersion.startsWith("1.")) {
            throw new IOException("지원하지 않는 schemaVersion: " + schemaVersion);
        }
        if ("failed".equals(manifest.optString("status"))) {
            throw new IOException("manifest 상태가 failed입니다.");
        }
        validateManifestFile(manifest, "/signals/latest.json", signalsText, true);
        validateManifestFile(manifest, "/weekly-trends/latest.json", weeklyText, true);
        validateManifestFile(manifest, "/prices/latest.json", pricesText, false);
        validateManifestFile(manifest, "/fx/latest.json", fxText, false);
    }

    private static void validateManifestFile(JSONObject manifest, String path, String text, boolean requireNormal) throws JSONException, IOException {
        JSONArray files = manifest.optJSONArray("files");
        if (files == null) {
            throw new IOException("manifest.files가 없습니다.");
        }
        for (int index = 0; index < files.length(); index++) {
            JSONObject file = files.getJSONObject(index);
            if (!path.equals(file.optString("path"))) {
                continue;
            }
            String status = file.optString("status", "normal");
            if ("failed".equals(status) || (requireNormal && !"normal".equals(status))) {
                throw new IOException(path + " 상태가 " + status + "입니다.");
            }
            String expectedHash = file.optString("sha256", "");
            if (!expectedHash.isEmpty() && !expectedHash.equals(sha256(text))) {
                throw new IOException(path + " sha256 검증 실패");
            }
            return;
        }
        throw new IOException(path + " 항목이 manifest에 없습니다.");
    }

    private static String sha256(String text) throws IOException {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(text.getBytes(StandardCharsets.UTF_8));
            StringBuilder builder = new StringBuilder();
            for (byte value : hash) {
                builder.append(String.format(Locale.US, "%02x", value));
            }
            return builder.toString();
        } catch (NoSuchAlgorithmException error) {
            throw new IOException("SHA-256을 사용할 수 없습니다.", error);
        }
    }

    private static boolean containsRiskWord(String value) {
        String text = value == null ? "" : value.toLowerCase(Locale.US);
        return text.contains("fallback") || text.contains("manual") || text.contains("failed");
    }

    private static String safe(String value) {
        return value == null || value.isEmpty() ? "-" : value;
    }

    private static String dateKey(String value) {
        if (value == null) {
            return "";
        }
        String trimmed = value.trim();
        return trimmed.length() >= 10 ? trimmed.substring(0, 10) : "";
    }

    private static String now() {
        return new SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.KOREA).format(new Date());
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static String normalizeBaseUrl(String baseUrl) {
        String normalized = String.valueOf(baseUrl == null ? "" : baseUrl).trim();
        while (normalized.endsWith("/")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        return normalized;
    }

    private static String fetchText(String urlString) throws IOException {
        return fetchText(urlString, 10_000, 10_000);
    }

    private static String fetchText(String urlString, int connectTimeoutMs, int readTimeoutMs) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(urlString).openConnection();
        connection.setConnectTimeout(connectTimeoutMs);
        connection.setReadTimeout(readTimeoutMs);
        connection.setRequestProperty("User-Agent", "Mozilla/5.0 InvestorRunAndroid/0.3");
        connection.setRequestProperty("Accept", "application/json,text/plain,*/*");
        int code = connection.getResponseCode();
        if (code < 200 || code >= 300) {
            throw new IOException("HTTP " + code + ": " + urlString);
        }
        try (InputStream input = connection.getInputStream();
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
            return output.toString(StandardCharsets.UTF_8.name());
        } finally {
            connection.disconnect();
        }
    }

    private static String encode(String value) throws IOException {
        return URLEncoder.encode(value, StandardCharsets.UTF_8.name());
    }

    private static String join(List<String> values, String separator) {
        StringBuilder builder = new StringBuilder();
        for (String value : values) {
            if (builder.length() > 0) {
                builder.append(separator);
            }
            builder.append(value);
        }
        return builder.toString();
    }

    private static String joinErrors(List<String> errors) {
        if (errors == null || errors.isEmpty()) {
            return "";
        }
        int limit = Math.min(3, errors.size());
        StringBuilder builder = new StringBuilder();
        for (int index = 0; index < limit; index++) {
            if (builder.length() > 0) {
                builder.append(" / ");
            }
            builder.append(errors.get(index));
        }
        if (errors.size() > limit) {
            builder.append(" 외 ").append(errors.size() - limit).append("건");
        }
        return builder.toString();
    }

    private static String shortMessage(Exception error) {
        String message = error.getMessage();
        if (message == null || message.trim().isEmpty()) {
            return error.getClass().getSimpleName();
        }
        return message.length() > 80 ? message.substring(0, 80) : message;
    }

    private static String yahooSymbolFor(QuoteRequest request) {
        String symbol = request.symbol.trim();
        if ("KR_STOCK".equals(request.market) || "KR_ETF".equals(request.market)) {
            if (symbol.endsWith(".KS") || symbol.endsWith(".KQ")) {
                return symbol;
            }
            return symbol + ".KS";
        }
        return symbol;
    }

    private static double firstPositive(JSONObject json, String... keys) {
        for (String key : keys) {
            double value = json.optDouble(key, 0);
            if (value > 0) {
                return value;
            }
        }
        return 0;
    }

    private static String firstText(JSONObject json, String fallback, String... keys) {
        for (String key : keys) {
            String value = json.optString(key, "");
            if (!value.trim().isEmpty()) {
                return value;
            }
        }
        return fallback == null ? "" : fallback;
    }

    private static double latestClose(JSONObject chartResult) {
        JSONObject indicators = chartResult.optJSONObject("indicators");
        JSONArray quoteArray = indicators == null ? null : indicators.optJSONArray("quote");
        JSONObject quote = quoteArray == null || quoteArray.length() == 0 ? null : quoteArray.optJSONObject(0);
        JSONArray closes = quote == null ? null : quote.optJSONArray("close");
        if (closes == null) {
            return 0;
        }
        for (int index = closes.length() - 1; index >= 0; index--) {
            if (!closes.isNull(index)) {
                double close = closes.optDouble(index, 0);
                if (close > 0) {
                    return close;
                }
            }
        }
        return 0;
    }

    private static String dateFromEpochSeconds(long epochSeconds) {
        if (epochSeconds <= 0) {
            return todayKey();
        }
        return new SimpleDateFormat("yyyy-MM-dd", Locale.KOREA).format(new Date(epochSeconds * 1000L));
    }

    private static String todayKey() {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.KOREA).format(new Date());
    }

    private static String readAsset(Context context, String path) throws IOException {
        try (InputStream input = context.getAssets().open(path);
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
            return output.toString(StandardCharsets.UTF_8.name());
        }
    }

    StrategySignal findSignal(String signalId) {
        for (StrategySignal signal : signals) {
            if (signal.signalId.equals(signalId)) {
                return signal;
            }
        }
        return null;
    }

    double referencePrice(String symbol) {
        PriceQuote quote = prices.get(symbol);
        if (quote != null && quote.price > 0) {
            return quote.price;
        }
        for (StrategySignal signal : signals) {
            if (signal.symbol.equals(symbol) && signal.referencePrice > 0) {
                return signal.referencePrice;
            }
        }
        for (EtfTarget target : etfTargets) {
            if (target.symbol.equals(symbol)) {
                return target.referencePrice;
            }
        }
        WeeklyTrend trend = trends.get(symbol);
        if (trend != null && trend.close > 0) {
            return trend.close;
        }
        return 0;
    }

    String nameFor(String symbol) {
        PriceQuote quote = prices.get(symbol);
        if (quote != null && !quote.name.isEmpty()) {
            return quote.name;
        }
        for (StrategySignal signal : signals) {
            if (signal.symbol.equals(symbol)) {
                return signal.name;
            }
        }
        for (EtfTarget target : etfTargets) {
            if (target.symbol.equals(symbol)) {
                return target.name;
            }
        }
        WeeklyTrend trend = trends.get(symbol);
        return trend == null ? symbol : trend.name;
    }

    String currencyFor(String symbol) {
        PriceQuote quote = prices.get(symbol);
        if (quote != null && !quote.currency.isEmpty()) {
            return quote.currency;
        }
        for (StrategySignal signal : signals) {
            if (signal.symbol.equals(symbol)) {
                return signal.currency;
            }
        }
        for (EtfTarget target : etfTargets) {
            if (target.symbol.equals(symbol)) {
                return target.currency;
            }
        }
        WeeklyTrend trend = trends.get(symbol);
        return trend == null ? "KRW" : trend.currency;
    }
}

final class PriceQuote {
    String symbol;
    String name;
    String market;
    String currency;
    String priceDate;
    String source;
    String status;
    double price;

    static PriceQuote fromJson(JSONObject json) {
        PriceQuote quote = new PriceQuote();
        quote.symbol = json.optString("symbol");
        quote.name = json.optString("name");
        quote.market = json.optString("market");
        quote.currency = json.optString("currency", "KRW");
        quote.priceDate = json.optString("priceDate");
        quote.source = json.optString("source");
        quote.status = json.optString("status", "normal");
        quote.price = json.optDouble("price", 0);
        return quote;
    }

    JSONObject toJson() throws JSONException {
        JSONObject json = new JSONObject();
        json.put("symbol", symbol);
        json.put("name", name);
        json.put("market", market);
        json.put("currency", currency);
        json.put("price", price);
        json.put("priceDate", priceDate);
        json.put("source", source);
        json.put("status", status);
        return json;
    }
}

final class QuoteRequest {
    final String symbol;
    final String name;
    final String market;
    final String currency;

    QuoteRequest(String symbol, String name, String market, String currency) {
        this.symbol = symbol == null ? "" : symbol;
        this.name = name == null ? this.symbol : name;
        this.market = market == null ? "" : market;
        this.currency = currency == null ? "" : currency;
    }
}

final class FxQuote {
    final double rate;
    final String dateKey;
    final String source;

    FxQuote(double rate, String dateKey, String source) {
        this.rate = rate;
        this.dateKey = dateKey == null ? "" : dateKey;
        this.source = source == null ? "" : source;
    }
}

final class SyncResult {
    final boolean success;
    final String message;
    final SignalRepository repository;

    private SyncResult(boolean success, String message, SignalRepository repository) {
        this.success = success;
        this.message = message;
        this.repository = repository;
    }

    static SyncResult success(SignalRepository repository, String message) {
        return new SyncResult(true, message, repository);
    }

    static SyncResult failure(String message) {
        return new SyncResult(false, message, null);
    }
}

final class QuoteMergeResult {
    final List<PriceQuote> quotes;
    final int reusedCount;

    QuoteMergeResult(List<PriceQuote> quotes, int reusedCount) {
        this.quotes = quotes;
        this.reusedCount = reusedCount;
    }
}

final class StrategySignal {
    String signalId;
    String market;
    String strategyKey;
    String actionType;
    String symbol;
    String name;
    String sector;
    String currency;
    String referenceDate;
    String validFrom;
    String validUntil;
    String orderHint = "";
    String scoreFormulaVersion = "";
    String sectorMapVersion = "";
    String universeHash = "";
    String backtestRunId = "";
    String dataAsOf = "";
    String strategyStatus = "";
    double driftThreshold = 0.015;
    double minTradeAmount = 50000;
    double concentrationLimit = 0;
    boolean requiresPensionTradabilityCheck = false;
    double rank;
    double score;
    double referencePrice;
    final List<String> reasons = new ArrayList<>();
    final List<String> warnings = new ArrayList<>();

    static StrategySignal fromJson(JSONObject json) throws JSONException {
        StrategySignal signal = new StrategySignal();
        signal.signalId = json.optString("signalId");
        signal.market = json.optString("market");
        signal.strategyKey = json.optString("strategyKey");
        signal.actionType = json.optString("actionType");
        signal.symbol = json.optString("symbol");
        signal.name = json.optString("name");
        signal.sector = json.optString("sector");
        signal.currency = json.optString("currency", "KRW");
        signal.referenceDate = json.optString("referenceDate");
        signal.validUntil = json.optString("validUntil");
        signal.scoreFormulaVersion = json.optString("scoreFormulaVersion");
        signal.sectorMapVersion = json.optString("sectorMapVersion");
        signal.universeHash = json.optString("universeHash");
        signal.backtestRunId = json.optString("backtestRunId");
        signal.dataAsOf = json.optString("dataAsOf");
        signal.strategyStatus = json.optString("strategyStatus");
        signal.rank = json.optDouble("rank", 0);
        signal.score = json.optDouble("score", 0);
        signal.referencePrice = json.optDouble("referencePrice", 0);
        signal.validFrom = json.optString("validFrom");
        JSONArray reasonArray = json.optJSONArray("reasons");
        if (reasonArray != null) {
            for (int index = 0; index < reasonArray.length(); index++) {
                signal.reasons.add(reasonArray.optString(index));
            }
        }
        JSONArray warningArray = json.optJSONArray("warnings");
        if (warningArray != null) {
            for (int index = 0; index < warningArray.length(); index++) {
                signal.warnings.add(warningArray.optString(index));
            }
        }
        JSONObject orderHintObject = json.optJSONObject("orderHint");
        if (orderHintObject != null) {
            signal.orderHint = orderHintObject.optString("budgetPolicy", "");
            signal.driftThreshold = orderHintObject.optDouble("driftThreshold", signal.driftThreshold);
            signal.minTradeAmount = orderHintObject.optDouble("minTradeAmount", signal.minTradeAmount);
            signal.concentrationLimit = orderHintObject.optDouble("concentrationLimit", signal.concentrationLimit);
            signal.requiresPensionTradabilityCheck = orderHintObject.optBoolean("requiresPensionTradabilityCheck", false);
        }
        return signal;
    }
}

final class EtfTarget {
    String symbol;
    String name;
    String role;
    String currency;
    double targetWeight;
    double referencePrice;

    static EtfTarget fromJson(JSONObject json) {
        EtfTarget target = new EtfTarget();
        target.symbol = json.optString("symbol");
        target.name = json.optString("name");
        target.role = json.optString("role");
        target.currency = json.optString("currency", "KRW");
        target.targetWeight = json.optDouble("targetWeight", 0);
        target.referencePrice = json.optDouble("referencePrice", 0);
        return target;
    }
}

final class WeeklyTrend {
    String market;
    String symbol;
    String name;
    String currency;
    String weekEndDate;
    String trendState;
    String breakDate;
    boolean confirmationRequired;
    double close;
    double weeklyTrendLine;

    static WeeklyTrend fromJson(JSONObject json) {
        WeeklyTrend trend = new WeeklyTrend();
        trend.market = json.optString("market");
        trend.symbol = json.optString("symbol");
        trend.name = json.optString("name");
        trend.currency = json.optString("currency", "KRW");
        trend.weekEndDate = json.optString("weekEndDate");
        trend.trendState = json.optString("trendState", "needs_review");
        trend.breakDate = json.optString("breakDate", "");
        trend.confirmationRequired = json.optBoolean("confirmationRequired", false);
        trend.close = json.optDouble("close", 0);
        trend.weeklyTrendLine = json.optDouble("weeklyTrendLine", 0);
        return trend;
    }
}
