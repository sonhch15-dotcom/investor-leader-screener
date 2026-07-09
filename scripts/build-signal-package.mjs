import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fetchChart } from "../src/yahoo.mjs";

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const schemaVersion = "1.0.0";
const generatedAt = new Date().toISOString();
const distApiDir = path.join(root, "dist", "api");
const appAssetApiDir = path.join(root, "app", "src", "main", "assets", "api");

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
      metrics: {
        distanceToTrendLine: null,
        rsi14: null
      }
    };
  }

  const distance = latest.close / latest.ma10 - 1;
  const rsiValue = latest.rsi14;
  const broken = latest.close < latest.ma10 || (Number.isFinite(rsiValue) && rsiValue < 50);
  const weakening = !broken && (distance < 0.05 || (Number.isFinite(rsiValue) && rsiValue < 55));
  return {
    market,
    symbol: row.symbol,
    name: row.name,
    currency: market === "US_STOCK" ? "USD" : "KRW",
    weekEndDate: latest.date,
    close: round(latest.close, 2),
    weeklyTrendLine: round(latest.ma10, 2),
    trendState: broken ? "broken" : weakening ? "weakening" : "alive",
    breakDate: broken ? latest.date : null,
    confirmationRequired: broken,
    metrics: {
      distanceToTrendLine: round(distance, 4),
      rsi14: round(rsiValue, 1)
    }
  };
}

function normalizeReason(reason) {
  return String(reason ?? "").trim();
}

function signalFromUs(row, index, signalMonth, validUntil) {
  return {
    signalId: `US-${signalMonth}-${row.symbol}-${String(index + 1).padStart(2, "0")}`,
    market: "US_STOCK",
    strategyKey: "us_leader2_repeat_theme_combo_cap27_5",
    actionType: "buy",
    symbol: row.symbol,
    name: row.name,
    sector: row.sector ?? "",
    currency: "USD",
    rank: index + 1,
    score: round(row.score, 2),
    targetWeight: null,
    referencePrice: round(row.close, 2),
    referenceDate: row.lastDate,
    validFrom: nextDay(row.lastDate),
    validUntil,
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

function signalFromKrStock(row, index, signalMonth, asOf, validUntil) {
  return {
    signalId: `KRSTOCK-${signalMonth}-${row.symbol}-${String(index + 1).padStart(2, "0")}`,
    market: "KR_STOCK",
    strategyKey: "kr_stock_leader2",
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

function signalFromEtf(strategy, signalMonth, asOf, validUntil) {
  return {
    signalId: `KRETF-${signalMonth}-REBALANCE-01`,
    market: "KR_ETF",
    strategyKey: "kr_etf_core_satellite_50_40_10",
    actionType: "rebalance",
    symbol: "KR_ETF_BASKET",
    name: strategy.label ?? "KR ETF Core Satellite",
    currency: "KRW",
    rank: 1,
    score: 100,
    targetWeight: null,
    referencePrice: 0,
    referenceDate: asOf,
    validFrom: nextDay(asOf),
    validUntil,
    reasons: [
      "Monthly rebalance window",
      "Core/Satellite/Defense target allocation check"
    ],
    warnings: [],
    orderHint: {
      budgetPolicy: "target_weight_rebalance",
      driftThreshold: 0.05,
      minTradeAmount: 50000,
      rounding: "floor_to_whole_share"
    }
  };
}

function etfTargetFromPick(row) {
  return {
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

async function main() {
  const us = await readJson("data/strategy-dashboard.json");
  const korea = await readJson("data/korea-strategy-dashboard.json");
  const krStock = korea.strategies?.find((strategy) => strategy.key === "kr_stocks") ?? {};
  const krEtf = korea.strategies?.find((strategy) => strategy.key === "kr_etf_core_satellite_50_40_10") ?? {};
  const asOf = [us.asOf, korea.asOf].filter(Boolean).sort().at(-1);
  const signalMonth = asOf.slice(0, 7);
  const validUntil = endOfMonth(signalMonth);

  const usSignals = (us.currentBuys ?? []).map((row, index) => signalFromUs(row, index, signalMonth, validUntil));
  const krStockSignals = (krStock.currentPicks ?? []).map((row, index) => signalFromKrStock(row, index, signalMonth, korea.asOf, validUntil));
  const etfTargets = (krEtf.currentPicks ?? []).map(etfTargetFromPick);
  const etfSignal = signalFromEtf(krEtf, signalMonth, korea.asOf, validUntil);
  const allSignals = [...usSignals, ...krStockSignals, etfSignal];

  const trendRows = [
    ...(us.currentBuys ?? []).map((row) => weeklyTrendFor(row, "US_STOCK")),
    ...(krStock.currentPicks ?? []).map((row) => weeklyTrendFor(row, "KR_STOCK")),
    ...(krEtf.currentPicks ?? []).map((row) => weeklyTrendFor(row, "KR_ETF"))
  ];

  const quoteCandidates = new Map();
  for (const row of us.currentBuys ?? []) addQuoteCandidate(quoteCandidates, row, "US_STOCK", us.asOf);
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
        strategyKey: "us_leader2_repeat_theme_combo_cap27_5",
        name: "US Leader2 + Repeat Theme Combo Cap27.5",
        market: "US_STOCK",
        status: "active",
        description: us.strategy?.summary ?? "",
        riskNotice: "Past validation results do not guarantee future returns."
      },
      {
        strategyKey: "kr_stock_leader2",
        name: krStock.label ?? "KR Stock Leader2",
        market: "KR_STOCK",
        status: "active",
        description: krStock.description ?? "",
        riskNotice: "Check trading halts, price limits, and liquidity before ordering."
      },
      {
        strategyKey: "kr_etf_core_satellite_50_40_10",
        name: krEtf.label ?? "KR ETF Core Satellite 50/40/10",
        market: "KR_ETF",
        status: "active",
        description: krEtf.description ?? "",
        riskNotice: "Check rebalance cost, tax, and minimum trade size."
      }
    ]
  };

  const summary = {
    schemaVersion,
    generatedAt,
    summaries: [
      {
        strategyKey: "us_leader2_repeat_theme_combo_cap27_5",
        period: us.backtest?.period ?? null,
        totalReturn: us.backtest?.totalReturn ?? null,
        maxDrawdown: us.backtest?.maxDrawdown ?? null,
        sourceFile: "data/strategy-dashboard.json"
      },
      {
        strategyKey: "kr_stock_leader2",
        period: krStock.months ? `${krStock.months} months` : null,
        totalReturn: krStock.summary?.totalReturn ?? null,
        maxDrawdown: krStock.capitalAccount?.maxDrawdown ?? null,
        tradeCount: krStock.summary?.tradeCount ?? null,
        sourceFile: "data/korea-strategy-dashboard.json"
      },
      {
        strategyKey: "kr_etf_core_satellite_50_40_10",
        period: krEtf.months ? `${krEtf.months} months` : null,
        totalReturn: krEtf.summary?.totalReturn ?? null,
        maxDrawdown: krEtf.capitalAccount?.maxDrawdown ?? null,
        tradeCount: krEtf.summary?.tradeCount ?? null,
        sourceFile: "data/korea-strategy-dashboard.json"
      }
    ]
  };

  const files = {
    "signals/latest.json": latestSignals,
    [`signals/${signalMonth}.json`]: latestSignals,
    "signals/us/latest.json": {
      ...latestSignals,
      market: "US_STOCK",
      signals: usSignals,
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
    markets: ["US_STOCK", "KR_STOCK", "KR_ETF"],
    files: makeFileRecords(files),
    nextExpectedRunAt: null
  };
  files["manifest.json"] = manifest;

  await writePackage(distApiDir, files);
  if (args.has("--app-assets")) {
    await writePackage(appAssetApiDir, {
      "manifest.json": manifest,
      "signals/latest.json": latestSignals,
      "weekly-trends/latest.json": weeklyTrends,
      "prices/latest.json": prices,
      "fx/latest.json": fx
    });
  }

  console.log(`Built signal package: ${allSignals.length} signals, ${trendRows.length} trends, ${prices.quotes.length} quotes`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
