import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fetchChart } from "../src/yahoo.mjs";

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const schemaVersion = "1.1.0";
const generatedAt = new Date().toISOString();
const distApiDir = path.join(root, "dist", "api");
const appAssetApiDir = path.join(root, "investor-run-android", "app", "src", "main", "assets", "api");
const usBaselineStrategy = {
  signalIdPrefix: "US",
  strategyKey: "us_leader2_repeat_theme_combo_cap27_5",
  name: "US Leader2 + Repeat Theme Combo Cap27.5",
  market: "US_STOCK",
  status: "active",
  validationStage: "corrected_control",
  scoreFormulaVersion: "score_a_sector20_v1",
  sectorMapVersion: "universe_sector_snapshot_v1",
  backtestRunId: "us-score-a-c-corrected-frozen-20260711"
};
const usScoreCStrategy = {
  signalIdPrefix: "USC",
  strategyKey: "us_leader2_score_c_cap27_5",
  name: "US Leader2 Score C Half Sector10 Cap27.5",
  market: "US_STOCK",
  status: "candidate",
  validationStage: "validated_candidate",
  scoreFormulaVersion: "score_c_half_sector10_normalized_v1",
  sectorMapVersion: "universe_sector_snapshot_v1",
  backtestRunId: "us-score-a-c-corrected-frozen-20260711"
};
const krStockStrategy = {
  strategyKey: "kr_stock_leader2",
  name: "KR Stock Leader2",
  market: "KR_STOCK",
  status: "active",
  scoreFormulaVersion: "kr_leader2_v1",
  sectorMapVersion: "kr_universe_group_snapshot_v1",
  backtestRunId: "korea_strategy_dashboard"
};
const KR_ETF_ACTIVE_STRATEGY_KEY = "kr_etf_benchmark_or_alpha_defensive";
const KR_ETF_LEGACY_STRATEGY_KEY = "kr_etf_benchmark_or_alpha";
const KR_ETF_5Y_VALIDATION_FILE = "data/korea-etf-score-variant-test.json";
const KR_ETF_10Y_VALIDATION_FILE = "data/korea-etf-10y-validation.json";
const krEtfStrategyDefinitions = {
  [KR_ETF_ACTIVE_STRATEGY_KEY]: {
    strategyKey: KR_ETF_ACTIVE_STRATEGY_KEY,
    name: "KR ETF Benchmark Or Alpha Defensive",
    market: "KR_ETF",
    status: "active",
    scoreFormulaVersion: "kr_etf_benchmark_or_alpha_defensive_v1",
    sectorMapVersion: "kr_etf_alpha_defensive_bucket_v1",
    backtestRunId: "korea_etf_10y_validation_2026-07-10",
    description: "Monthly ETF-I rotation. If KODEX 200 is strong, hold the top domestic alpha ETF; if weak, hold the strongest defensive ETF.",
    reasons: [
      "Monthly rebalance window",
      "KODEX 200 trend gate: above the 200-day average with positive momentum means alpha-on",
      "Alpha-on: rebalance 100% into the highest-scoring domestic alpha ETF",
      "Weak benchmark: rebalance 100% into the highest-scoring defensive ETF"
    ],
    warnings: [
      "This strategy can concentrate the ETF account in one ETF.",
      "Before ordering, check pension-account tradability, minimum trade amount, fees, and taxes."
    ]
  },
  [KR_ETF_LEGACY_STRATEGY_KEY]: {
    strategyKey: KR_ETF_LEGACY_STRATEGY_KEY,
    name: "KR ETF Benchmark Or Alpha",
    market: "KR_ETF",
    status: "candidate",
    scoreFormulaVersion: "kr_etf_benchmark_or_alpha_v1",
    sectorMapVersion: "kr_etf_alpha_bucket_v1",
    backtestRunId: "korea_etf_score_variant_test_2026-07-10",
    description: "Legacy ETF-H comparison. If KODEX 200 is strong, hold the top domestic alpha ETF; otherwise hold KODEX 200.",
    reasons: [
      "Monthly rebalance window",
      "Benchmark Or Alpha target allocation check",
      "If KODEX 200 trend is strong, use the highest-scoring KOSPI alpha ETF; otherwise hold KODEX 200"
    ],
    warnings: [
      "Legacy comparison strategy. Use ETF-I defensive as the app default unless intentionally testing."
    ]
  }
};

function round(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function endOfMonth(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
}

function nextDay(dateString) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function weekKey(dateString) {
  const date = new Date(`${dateString}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function movingAverage(values, index, length) {
  if (index < length - 1) return null;
  const slice = values.slice(index - length + 1, index + 1);
  if (!slice.every(Number.isFinite)) return null;
  return slice.reduce((sum, value) => sum + value, 0) / length;
}

function rsi(values, index, length = 14) {
  if (index < length) return null;
  let gains = 0;
  let losses = 0;
  for (let i = index - length + 1; i <= index; i += 1) {
    const change = values[i] - values[i - 1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

function weeklyRows(chart = []) {
  const groups = new Map();
  for (const row of chart) {
    if (row?.date && Number.isFinite(row.close)) groups.set(weekKey(row.date), row);
  }
  const rows = Array.from(groups.values()).sort((a, b) => a.date.localeCompare(b.date));
  const closes = rows.map((row) => row.close);
  return rows.map((row, index) => ({
    date: row.date,
    close: row.close,
    ma10: movingAverage(closes, index, 10),
    rsi14: rsi(closes, index, 14)
  }));
}

function weeklyTrendFor(row, market) {
  const weekly = weeklyRows(row.chart);
  const latest = weekly.at(-1);
  if (!latest || !Number.isFinite(latest.close) || !Number.isFinite(latest.ma10)) {
    return {
      market,
      symbol: row.symbol,
      name: row.name,
      currency: market === "US_STOCK" ? "USD" : "KRW",
      weekEndDate: row.lastDate ?? row.date ?? null,
      close: round(row.close ?? row.price, 2),
      weeklyTrendLine: null,
      trendState: "needs_review",
      breakDate: null,
      confirmationRequired: true,
      exitConfirmed: false,
      sixMonthExtensionEligible: null,
      sixMonthExtensionReason: "metrics_unavailable",
      postExtensionExitConfirmed: false,
      postExtensionExitReason: null,
      metrics: {
        distanceToTrendLine: null,
        rsi14: null,
        belowTrendWeeks: 0,
        exitReason: null
      }
    };
  }

  const previous = weekly.at(-2);
  const distance = latest.close / latest.ma10 - 1;
  const rsiValue = latest.rsi14;
  const belowTrend = latest.close < latest.ma10;
  const previousBelowTrend = Number.isFinite(previous?.close)
    && Number.isFinite(previous?.ma10)
    && previous.close < previous.ma10;
  const belowTrendWeeks = belowTrend ? (previousBelowTrend ? 2 : 1) : 0;
  const rsiAvailable = Number.isFinite(rsiValue);
  const sixMonthExtensionEligible = rsiAvailable ? !belowTrend && rsiValue >= 50 : null;
  const sixMonthExtensionReason = !rsiAvailable
    ? "metrics_unavailable"
    : belowTrend
      ? "close_below_ma10"
      : rsiValue < 50
        ? "rsi_below_50"
        : "close_above_ma10_and_rsi_at_least_50";
  const exitConfirmed = belowTrendWeeks >= 2;
  const confirmationRequired = belowTrend && !exitConfirmed;
  const weakening = !exitConfirmed && (belowTrend || distance < 0.05 || (Number.isFinite(rsiValue) && rsiValue < 55));
  return {
    market,
    symbol: row.symbol,
    name: row.name,
    currency: market === "US_STOCK" ? "USD" : "KRW",
    weekEndDate: latest.date,
    close: round(latest.close, 2),
    weeklyTrendLine: round(latest.ma10, 2),
    trendState: exitConfirmed ? "broken" : weakening ? "weakening" : "alive",
    breakDate: exitConfirmed ? latest.date : null,
    confirmationRequired,
    exitConfirmed,
    sixMonthExtensionEligible,
    sixMonthExtensionReason,
    postExtensionExitConfirmed: exitConfirmed,
    postExtensionExitReason: exitConfirmed ? "two_week_ma10_break" : null,
    metrics: {
      distanceToTrendLine: round(distance, 4),
      rsi14: round(rsiValue, 1),
      belowTrendWeeks,
      exitReason: belowTrendWeeks >= 2 ? "two_week_ma10_break" : null
    }
  };
}

function normalizeReason(reason) {
  return String(reason ?? "").trim();
}

function strategyMetadata(strategy, dataAsOf, universeHash) {
  return {
    scoreFormulaVersion: strategy.scoreFormulaVersion ?? "",
    sectorMapVersion: strategy.sectorMapVersion ?? "",
    universeHash: universeHash ?? "",
    backtestRunId: strategy.backtestRunId ?? "",
    dataAsOf: dataAsOf ?? "",
    strategyStatus: strategy.status ?? "",
    validationStage: strategy.validationStage ?? ""
  };
}

function catalogStrategy(strategy) {
  const { signalIdPrefix, ...visible } = strategy;
  return visible;
}

function validFromFor(row, referenceDate) {
  if (row.validFrom) return row.validFrom;
  if (row.entryDate) return row.entryDate;
  return referenceDate ? nextDay(referenceDate) : "";
}

function signalFromUs(row, index, signalMonth, validUntil, strategy, dataAsOf, universeHash) {
  const referenceDate = row.lastDate ?? row.asOf ?? dataAsOf ?? "";
  return {
    signalId: `${strategy.signalIdPrefix ?? "US"}-${signalMonth}-${row.symbol}-${String(index + 1).padStart(2, "0")}`,
    market: "US_STOCK",
    strategyKey: strategy.strategyKey,
    actionType: "buy",
    symbol: row.symbol,
    name: row.name,
    sector: row.sector ?? "",
    currency: "USD",
    rank: index + 1,
    score: round(row.score, 2),
    targetWeight: null,
    referencePrice: round(fallbackPrice(row), 2),
    referenceDate,
    validFrom: validFromFor(row, referenceDate),
    validUntil,
    ...strategyMetadata(strategy, dataAsOf, universeHash),
    reasons: (row.reasons ?? []).map(normalizeReason).filter(Boolean),
    warnings: row.warnings ?? [],
    metrics: {
      r1m: round(row.metrics?.r1m),
      r3m: round(row.metrics?.r3m),
      r6m: round(row.metrics?.r6m),
      high52wDistance: round(row.metrics?.high52wDistance),
      avgDollar20: round(row.metrics?.avgDollar20, 0)
    },
    orderHint: {
      budgetPolicy: "strategy_position_sizing",
      baseBuyRatioInitial: 0.10,
      baseBuyRatioNormal: 0.075,
      defensiveBuyRatio: 0.05,
      rampSignalCount: 6,
      rampCashThresholdRatio: 0.30,
      defensiveCashThresholdRatio: 0.10,
      symbolCapRatio: 0.275,
      repeatSymbolMultiplier1: 1.25,
      repeatSymbolMultiplier2: 1.45,
      aiHardwareMultiplier: 1.25,
      defensiveSectorMultiplier: 0.85,
      maxMultiplier: 1.85,
      rounding: "floor_to_whole_share"
    }
  };
}

function signalFromKrStock(row, index, signalMonth, asOf, validUntil, universeHash) {
  return {
    signalId: `KRSTOCK-${signalMonth}-${row.symbol}-${String(index + 1).padStart(2, "0")}`,
    market: "KR_STOCK",
    strategyKey: krStockStrategy.strategyKey,
    actionType: "buy",
    symbol: row.symbol,
    name: row.name,
    sector: row.group ?? "",
    currency: "KRW",
    rank: index + 1,
    score: round(row.score, 2),
    targetWeight: null,
    referencePrice: round(row.close, 0),
    referenceDate: asOf,
    validFrom: nextDay(asOf),
    validUntil,
    ...strategyMetadata(krStockStrategy, asOf, universeHash),
    reasons: [
      `Group leader: ${row.group}`,
      "KR Stock Leader2 rank passed",
      "Relative momentum passed"
    ],
    warnings: [],
    metrics: {
      r1m: round(row.r1m),
      r3m: round(row.r3m),
      r6m: round(row.r6m),
      momentum: round(row.momentum),
      avgValue20: round(row.avgValue20, 0)
    },
    orderHint: {
      budgetPolicy: "kr_leader2_capital_account",
      rampMonthlyRatio: 0.30,
      normalMonthlyRatio: 0.15,
      rampMonths: 3,
      symbolCapRatio: 0.225,
      minTradeAmount: 10000,
      rounding: "floor_to_whole_share"
    }
  };
}

function krEtfDefinitionFor(strategy) {
  const definition = krEtfStrategyDefinitions[strategy?.key] ?? krEtfStrategyDefinitions[KR_ETF_ACTIVE_STRATEGY_KEY];
  return {
    ...definition,
    strategyKey: strategy?.key ?? definition.strategyKey,
    name: strategy?.label ?? definition.name
  };
}

function findEtfStrategy(data, key) {
  return data?.variants?.find((strategy) => strategy.key === key)
    ?? data?.strategies?.find((strategy) => strategy.key === key)
    ?? null;
}

function chooseEtfSignalStrategy(korea, etfFiveYear, etfTenYear) {
  return findEtfStrategy(etfFiveYear, KR_ETF_ACTIVE_STRATEGY_KEY)
    ?? findEtfStrategy(etfTenYear, KR_ETF_ACTIVE_STRATEGY_KEY)
    ?? findEtfStrategy(korea, KR_ETF_ACTIVE_STRATEGY_KEY)
    ?? findEtfStrategy(korea, KR_ETF_LEGACY_STRATEGY_KEY)
    ?? findEtfStrategy(etfFiveYear, KR_ETF_LEGACY_STRATEGY_KEY)
    ?? {};
}

function backtestSummary(strategy, sourceFile) {
  if (!strategy) return null;
  return {
    period: strategy.months ? `${strategy.months} months` : null,
    totalReturn: strategy.summary?.totalReturn ?? strategy.account?.totalReturn ?? strategy.capitalAccount?.totalReturn ?? null,
    cagr: strategy.summary?.cagr ?? strategy.account?.cagr ?? strategy.capitalAccount?.cagr ?? null,
    maxDrawdown: strategy.summary?.maxDrawdown ?? strategy.account?.maxDrawdown ?? strategy.capitalAccount?.maxDrawdown ?? null,
    tradeCount: strategy.summary?.tradeCount ?? strategy.account?.executedBuys ?? strategy.capitalAccount?.executedBuys ?? null,
    sourceFile
  };
}

function signalFromEtf(strategy, strategyDefinition, signalMonth, asOf, validUntil, universeHash) {
  return {
    signalId: `KRETF-${signalMonth}-REBALANCE-01`,
    market: "KR_ETF",
    strategyKey: strategyDefinition.strategyKey,
    actionType: "rebalance",
    symbol: "KR_ETF_BASKET",
    name: strategy.label ?? strategyDefinition.name,
    currency: "KRW",
    rank: 1,
    score: 100,
    targetWeight: null,
    referencePrice: 0,
    referenceDate: asOf,
    validFrom: nextDay(asOf),
    validUntil,
    ...strategyMetadata(strategyDefinition, asOf, universeHash),
    reasons: strategyDefinition.reasons ?? [],
    warnings: strategyDefinition.warnings ?? [],
    orderHint: {
      budgetPolicy: "target_weight_rebalance",
      driftThreshold: 0.05,
      minTradeAmount: 50000,
      concentrationLimit: 1,
      requiresPensionTradabilityCheck: true,
      rounding: "floor_to_whole_share"
    }
  };
}

function etfTargetFromPick(row, strategyKey) {
  return {
    strategyKey,
    symbol: row.symbol,
    name: row.name,
    role: row.group ?? "target",
    targetWeight: round(row.weight ?? 0),
    referencePrice: round(row.close ?? row.price, 0),
    currency: "KRW",
    metrics: {
      r1m: round(row.r1m),
      r3m: round(row.r3m),
      r6m: round(row.r6m),
      momentum: round(row.momentum)
    }
  };
}

function fallbackPrice(row) {
  return row?.currentPrice ?? row?.close ?? row?.price ?? row?.referencePrice ?? null;
}

function fallbackDate(row, defaultDate) {
  return row?.lastDate ?? row?.date ?? row?.asOf ?? defaultDate ?? null;
}

function addQuoteCandidate(candidates, row, market, defaultDate) {
  if (!row?.symbol || row.symbol === "KR_ETF_BASKET") return;
  const existing = candidates.get(row.symbol);
  const candidate = {
    symbol: row.symbol,
    name: row.name ?? row.symbol,
    market,
    currency: market === "US_STOCK" ? "USD" : "KRW",
    fallbackPrice: fallbackPrice(row),
    fallbackDate: fallbackDate(row, defaultDate)
  };
  if (!existing || !Number.isFinite(existing.fallbackPrice)) {
    candidates.set(row.symbol, candidate);
  }
}

async function resolveQuote(candidate) {
  try {
    const rows = await fetchChart(candidate.symbol, { range: "5d", interval: "1d" });
    const latest = rows.at(-1);
    if (latest && Number.isFinite(latest.close)) {
      return {
        symbol: candidate.symbol,
        name: candidate.name,
        market: candidate.market,
        currency: candidate.currency,
        price: round(latest.close, candidate.currency === "USD" ? 2 : 0),
        priceDate: latest.date,
        source: "yahoo",
        status: "normal"
      };
    }
    throw new Error("No latest quote row");
  } catch (error) {
    return {
      symbol: candidate.symbol,
      name: candidate.name,
      market: candidate.market,
      currency: candidate.currency,
      price: round(candidate.fallbackPrice, candidate.currency === "USD" ? 2 : 0),
      priceDate: candidate.fallbackDate,
      source: "strategy-dashboard-fallback",
      status: Number.isFinite(candidate.fallbackPrice) ? "delayed" : "failed",
      error: error.message
    };
  }
}

async function resolveUsdKrw(asOf) {
  const envRate = Number.parseFloat(process.env.USD_KRW ?? "");
  if (Number.isFinite(envRate)) {
    return {
      schemaVersion,
      generatedAt,
      asOf,
      status: "normal",
      baseCurrency: "KRW",
      rates: [
        {
          currency: "USD",
          rate: round(envRate, 2),
          source: "USD_KRW env"
        }
      ]
    };
  }

  try {
    const rows = await fetchChart("KRW=X", { range: "5d", interval: "1d" });
    const latest = rows.at(-1);
    if (latest && Number.isFinite(latest.close)) {
      return {
        schemaVersion,
        generatedAt,
        asOf: latest.date,
        status: "normal",
        baseCurrency: "KRW",
        rates: [
          {
            currency: "USD",
            rate: round(latest.close, 2),
            source: "yahoo:KRW=X"
          }
        ]
      };
    }
    throw new Error("No latest FX row");
  } catch (error) {
    return {
      schemaVersion,
      generatedAt,
      asOf,
      status: "delayed",
      baseCurrency: "KRW",
      rates: [
        {
          currency: "USD",
          rate: 1378.5,
          source: "manual-default",
          error: error.message
        }
      ]
    };
  }
}

async function buildPrices(candidates, asOf) {
  const quotes = [];
  for (const candidate of candidates.values()) {
    quotes.push(await resolveQuote(candidate));
  }
  const failed = quotes.filter((quote) => quote.status === "failed").length;
  const delayed = quotes.filter((quote) => quote.status === "delayed").length;
  return {
    schemaVersion,
    generatedAt,
    asOf,
    status: failed > 0 ? "needs_review" : delayed > 0 ? "delayed" : "normal",
    quotes
  };
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(path.join(root, filePath), "utf8"));
}

async function readOptionalJson(filePath) {
  try {
    return await readJson(filePath);
  } catch {
    return null;
  }
}

async function fileHash(filePath) {
  try {
    return sha256(await fs.readFile(path.join(root, filePath), "utf8"));
  } catch {
    return "";
  }
}

function stringify(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

async function writePackage(outputDir, files) {
  await fs.mkdir(outputDir, { recursive: true });
  for (const [relativePath, value] of Object.entries(files)) {
    const filePath = path.join(outputDir, relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, stringify(value), "utf8");
  }
}

function makeFileRecords(files) {
  return Object.entries(files).map(([relativePath, value]) => {
    const content = stringify(value);
    return {
      path: `/${relativePath.replaceAll(path.sep, "/")}`,
      version: value.signalMonth ?? value.asOfWeek ?? value.asOf ?? generatedAt,
      sha256: sha256(content),
      updatedAt: generatedAt,
      status: value.status ?? "normal"
    };
  });
}

function rowsBySymbol(...groups) {
  const rows = new Map();
  for (const group of groups) {
    for (const row of group ?? []) {
      if (row?.symbol && !rows.has(row.symbol)) rows.set(row.symbol, row);
    }
  }
  return rows;
}

function latestScoreVariantRows(scoreVariantData, key, sourceRows) {
  const variant = scoreVariantData?.results?.find((row) => row.key === key)
    ?? scoreVariantData?.rankedResults?.find((row) => row.key === key);
  const selection = variant?.recentSelections?.at(-1);
  if (!selection?.rows?.length) return [];
  return selection.rows.map((row) => {
    const source = sourceRows.get(row.symbol) ?? {};
    return {
      ...source,
      ...row,
      lastDate: selection.asOf ?? source.lastDate,
      validFrom: selection.entryDate,
      reasons: [
        ...(source.reasons ?? []),
        "Score C: sector/theme score halved and normalized"
      ],
      warnings: [
        ...(source.warnings ?? []),
        "Validated candidate: shadow-test before official replacement"
      ]
    };
  });
}

async function main() {
  const us = await readJson("data/strategy-dashboard.json");
  const scoreVariants = await readOptionalJson("data/sector-score-variant-test-corrected-frozen-20260711.json")
    ?? await readOptionalJson("data/sector-score-variant-test.json");
  const correctedUsValidation = await readOptionalJson("data/score-a-c-corrected-validation.json");
  const korea = await readJson("data/korea-strategy-dashboard.json");
  const etfFiveYear = await readOptionalJson(KR_ETF_5Y_VALIDATION_FILE);
  const etfTenYear = await readOptionalJson(KR_ETF_10Y_VALIDATION_FILE);
  const krStock = korea.strategies?.find((strategy) => strategy.key === "kr_stocks") ?? {};
  const krEtf = chooseEtfSignalStrategy(korea, etfFiveYear, etfTenYear);
  const krEtfDefinition = krEtfDefinitionFor(krEtf);
  const krEtfLegacy = findEtfStrategy(etfFiveYear, KR_ETF_LEGACY_STRATEGY_KEY)
    ?? findEtfStrategy(etfTenYear, KR_ETF_LEGACY_STRATEGY_KEY);
  const krEtfFiveYearSummary = findEtfStrategy(etfFiveYear, krEtfDefinition.strategyKey);
  const krEtfTenYearSummary = findEtfStrategy(etfTenYear, krEtfDefinition.strategyKey);
  const krEtfAsOf = krEtf.asOf ?? etfFiveYear?.asOf ?? etfTenYear?.asOf ?? korea.asOf;
  const asOf = [us.asOf, korea.asOf, krEtfAsOf].filter(Boolean).sort().at(-1);
  const signalMonth = asOf.slice(0, 7);
  const validUntil = endOfMonth(signalMonth);
  const usUniverseHash = correctedUsValidation?.provenance?.universeHash
    ?? await fileHash("data/universe.json");
  const koreaUniverseHash = await fileHash("data/korea-strategy-dashboard.json");
  const krEtfUniverseHash = await fileHash(KR_ETF_5Y_VALIDATION_FILE);
  const usSourceRows = rowsBySymbol(us.currentBuys, us.portfolio?.holdings);
  const usScoreCRows = latestScoreVariantRows(scoreVariants, "c_half_sector_normalized", usSourceRows);

  const usSignals = (us.currentBuys ?? []).map((row, index) => signalFromUs(row, index, signalMonth, validUntil, usBaselineStrategy, us.asOf, usUniverseHash));
  const usScoreCSignals = usScoreCRows.map((row, index) => signalFromUs(row, index, signalMonth, validUntil, usScoreCStrategy, row.lastDate ?? us.asOf, usUniverseHash));
  const krStockSignals = (krStock.currentPicks ?? []).map((row, index) => signalFromKrStock(row, index, signalMonth, korea.asOf, validUntil, koreaUniverseHash));
  const etfTargets = (krEtf.currentPicks ?? []).map((row) => etfTargetFromPick(row, krEtfDefinition.strategyKey));
  const etfSignal = signalFromEtf(krEtf, krEtfDefinition, signalMonth, krEtfAsOf, validUntil, krEtfUniverseHash);
  const allSignals = [...usSignals, ...usScoreCSignals, ...krStockSignals, etfSignal];

  const trendRows = [
    ...(us.currentBuys ?? []).map((row) => weeklyTrendFor(row, "US_STOCK")),
    ...usScoreCRows.map((row) => weeklyTrendFor(row, "US_STOCK")),
    ...(krStock.currentPicks ?? []).map((row) => weeklyTrendFor(row, "KR_STOCK")),
    ...(krEtf.currentPicks ?? []).map((row) => weeklyTrendFor(row, "KR_ETF"))
  ];

  const quoteCandidates = new Map();
  for (const row of us.currentBuys ?? []) addQuoteCandidate(quoteCandidates, row, "US_STOCK", us.asOf);
  for (const row of usScoreCRows) addQuoteCandidate(quoteCandidates, row, "US_STOCK", row.lastDate ?? us.asOf);
  for (const row of us.portfolio?.holdings ?? []) addQuoteCandidate(quoteCandidates, row, "US_STOCK", us.asOf);
  for (const row of krStock.currentPicks ?? []) addQuoteCandidate(quoteCandidates, row, "KR_STOCK", korea.asOf);
  for (const row of krStock.openTrades ?? []) addQuoteCandidate(quoteCandidates, row, "KR_STOCK", korea.asOf);
  for (const row of krEtf.currentPicks ?? []) addQuoteCandidate(quoteCandidates, row, "KR_ETF", korea.asOf);
  for (const row of krEtf.openTrades ?? []) addQuoteCandidate(quoteCandidates, row, "KR_ETF", korea.asOf);
  const prices = await buildPrices(quoteCandidates, asOf);

  const latestSignals = {
    schemaVersion,
    signalMonth,
    generatedAt,
    asOf,
    status: allSignals.length ? "normal" : "failed",
    signals: allSignals,
    targetWeights: etfTargets,
    excludedCandidates: []
  };

  const weeklyTrends = {
    schemaVersion,
    generatedAt,
    asOfWeek: trendRows.map((row) => row.weekEndDate).filter(Boolean).sort().at(-1)
      ? weekKey(trendRows.map((row) => row.weekEndDate).filter(Boolean).sort().at(-1))
      : null,
    status: trendRows.length ? "normal" : "needs_review",
    trends: trendRows
  };

  const fx = await resolveUsdKrw(asOf);

  const strategies = {
    schemaVersion,
    generatedAt,
    strategies: [
      {
        ...catalogStrategy(usBaselineStrategy),
        description: us.strategy?.summary ?? "",
        universeHash: usUniverseHash,
        dataAsOf: us.asOf,
        validationReports: [
          "score_a_c_corrected_validation.md",
          "backtest_reproducibility_whitepaper.md"
        ],
        validation: correctedUsValidation ? {
          grade: "Corrected Control",
          role: "active_baseline",
          totalReturn: correctedUsValidation.scoreA?.account?.totalReturn,
          cagr: correctedUsValidation.scoreA?.account?.cagr,
          maxDrawdown: correctedUsValidation.scoreA?.account?.maxDrawdown,
          benchmarkReturn: correctedUsValidation.scoreA?.account?.benchmark?.totalReturn
        } : null,
        riskNotice: "Past validation results do not guarantee future returns."
      },
      {
        ...catalogStrategy(usScoreCStrategy),
        description: "Validated candidate: sector/theme score is halved in individual stock scoring while Leader2 sector selection and Cap27.5 execution remain unchanged.",
        universeHash: usUniverseHash,
        dataAsOf: usScoreCRows[0]?.lastDate ?? us.asOf,
        validationReports: [
          "score_a_c_corrected_validation.md",
          "backtest_reproducibility_whitepaper.md"
        ],
        validation: correctedUsValidation ? {
          grade: correctedUsValidation.grade,
          role: "promotion_candidate",
          candidatePassed: correctedUsValidation.candidatePassed,
          totalReturn: correctedUsValidation.scoreC?.account?.totalReturn,
          cagr: correctedUsValidation.scoreC?.account?.cagr,
          maxDrawdown: correctedUsValidation.scoreC?.account?.maxDrawdown,
          benchmarkReturn: correctedUsValidation.scoreC?.account?.benchmark?.totalReturn,
          annualWins: correctedUsValidation.annualComparisons?.filter((row) => row.winner === "Score C").length,
          annualTests: correctedUsValidation.annualComparisons?.length
        } : null,
        riskNotice: "Validated candidate only. The active strategy remains Score A until point-in-time universe and forward-observation gates are satisfied."
      },
      {
        ...catalogStrategy(krStockStrategy),
        name: krStock.label ?? "KR Stock Leader2",
        description: krStock.description ?? "",
        universeHash: koreaUniverseHash,
        dataAsOf: korea.asOf,
        riskNotice: "Check trading halts, price limits, and liquidity before ordering."
      },
      {
        ...catalogStrategy(krEtfDefinition),
        name: krEtf.label ?? krEtfDefinition.name,
        description: krEtf.description ?? krEtfDefinition.description ?? "",
        universeHash: krEtfUniverseHash,
        dataAsOf: krEtfAsOf,
        validationReports: [
          "korea_etf_10y_validation.md",
          "korea_etf_score_variant_test.md"
        ],
        validation: {
          fiveYear: backtestSummary(krEtfFiveYearSummary, KR_ETF_5Y_VALIDATION_FILE),
          tenYear: backtestSummary(krEtfTenYearSummary, KR_ETF_10Y_VALIDATION_FILE)
        },
        riskNotice: "ETF-I can rebalance 100% into one ETF. Check pension-account tradability, rebalance cost, tax, and minimum trade size before ordering."
      },
      ...(krEtfLegacy ? [{
        ...catalogStrategy(krEtfDefinitionFor(krEtfLegacy)),
        name: krEtfLegacy.label ?? krEtfStrategyDefinitions[KR_ETF_LEGACY_STRATEGY_KEY].name,
        description: krEtfLegacy.description ?? krEtfStrategyDefinitions[KR_ETF_LEGACY_STRATEGY_KEY].description,
        universeHash: krEtfUniverseHash,
        dataAsOf: krEtfAsOf,
        validationReports: [
          "korea_etf_score_variant_test.md"
        ],
        validation: {
          fiveYear: backtestSummary(krEtfLegacy, KR_ETF_5Y_VALIDATION_FILE)
        },
        riskNotice: "Legacy ETF-H comparison. Prefer ETF-I defensive for the app default unless deliberately testing the old KODEX200 fallback."
      }] : [])
    ]
  };

  const krEtfBacktest = backtestSummary(krEtf, KR_ETF_5Y_VALIDATION_FILE);
  const krEtfTenYearBacktest = backtestSummary(krEtfTenYearSummary, KR_ETF_10Y_VALIDATION_FILE);

  const summary = {
    schemaVersion,
    generatedAt,
    summaries: [
      {
        strategyKey: usBaselineStrategy.strategyKey,
        period: correctedUsValidation
          ? `${correctedUsValidation.period?.accountStartDate}..${correctedUsValidation.period?.accountEndDate}`
          : us.backtest?.period ?? null,
        totalReturn: correctedUsValidation?.scoreA?.account?.totalReturn ?? us.backtest?.totalReturn ?? null,
        cagr: correctedUsValidation?.scoreA?.account?.cagr ?? null,
        maxDrawdown: correctedUsValidation?.scoreA?.account?.maxDrawdown ?? us.backtest?.maxDrawdown ?? null,
        benchmarkReturn: correctedUsValidation?.scoreA?.account?.benchmark?.totalReturn ?? null,
        sourceFile: correctedUsValidation ? "data/score-a-c-corrected-validation.json" : "data/strategy-dashboard.json"
      },
      {
        strategyKey: usScoreCStrategy.strategyKey,
        period: correctedUsValidation
          ? `${correctedUsValidation.period?.accountStartDate}..${correctedUsValidation.period?.accountEndDate}`
          : null,
        totalReturn: correctedUsValidation?.scoreC?.account?.totalReturn ?? null,
        cagr: correctedUsValidation?.scoreC?.account?.cagr ?? null,
        maxDrawdown: correctedUsValidation?.scoreC?.account?.maxDrawdown ?? null,
        benchmarkReturn: correctedUsValidation?.scoreC?.account?.benchmark?.totalReturn ?? null,
        sourceFile: "data/score-a-c-corrected-validation.json",
        status: usScoreCStrategy.status,
        validationStage: usScoreCStrategy.validationStage
      },
      {
        strategyKey: krStockStrategy.strategyKey,
        period: krStock.months ? `${krStock.months} months` : null,
        totalReturn: krStock.summary?.totalReturn ?? null,
        maxDrawdown: krStock.capitalAccount?.maxDrawdown ?? null,
        tradeCount: krStock.summary?.tradeCount ?? null,
        sourceFile: "data/korea-strategy-dashboard.json"
      },
      {
        strategyKey: krEtfDefinition.strategyKey,
        period: krEtfBacktest?.period ?? null,
        totalReturn: krEtfBacktest?.totalReturn ?? null,
        cagr: krEtfBacktest?.cagr ?? null,
        maxDrawdown: krEtfBacktest?.maxDrawdown ?? null,
        tradeCount: krEtfBacktest?.tradeCount ?? null,
        sourceFile: KR_ETF_5Y_VALIDATION_FILE,
        validation: {
          fiveYear: krEtfBacktest,
          tenYear: krEtfTenYearBacktest
        }
      }
    ]
  };

  const files = {
    "signals/latest.json": latestSignals,
    [`signals/${signalMonth}.json`]: latestSignals,
    "signals/us/latest.json": {
      ...latestSignals,
      market: "US_STOCK",
      signals: [...usSignals, ...usScoreCSignals],
      targetWeights: []
    },
    "signals/kr-stock/latest.json": {
      ...latestSignals,
      market: "KR_STOCK",
      signals: krStockSignals,
      targetWeights: []
    },
    "signals/kr-etf/latest.json": {
      ...latestSignals,
      market: "KR_ETF",
      signals: [etfSignal],
      targetWeights: etfTargets
    },
    "weekly-trends/latest.json": weeklyTrends,
    "prices/latest.json": prices,
    "fx/latest.json": fx,
    "strategies/catalog.json": strategies,
    "backtests/summary.json": summary
  };

  const manifest = {
    schemaVersion,
    packageVersion: generatedAt,
    generatedAt,
    status: "normal",
    minAppVersionCode: 58,
    capabilities: [
      "strategy_status_gate",
      "signal_validity_gate",
      "etf_zero_target_liquidation",
      "weekly_exit_v2",
      "six_month_extension_v1"
    ],
    markets: ["US_STOCK", "KR_STOCK", "KR_ETF"],
    files: makeFileRecords(files),
    nextExpectedRunAt: null
  };
  files["manifest.json"] = manifest;

  await writePackage(distApiDir, files);
  if (args.has("--app-assets")) {
    await writePackage(appAssetApiDir, files);
  }

  console.log(`Built signal package: ${allSignals.length} signals, ${trendRows.length} trends, ${prices.quotes.length} quotes`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
