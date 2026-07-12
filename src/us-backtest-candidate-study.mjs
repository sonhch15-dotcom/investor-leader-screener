import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  evaluateTrade,
  rowOnOrAfter,
  rowOnOrBefore,
  weeklyRows
} from "./backtest-execution-core.mjs";
import {
  priceMapFromSnapshot,
  priceOnOrBefore,
  readPriceSnapshot
} from "./backtest-price-snapshot.mjs";
import { clamp, mean, round } from "./math.mjs";
import { scoreUniverse } from "./scoring.mjs";
import { loadTrades, scenarios, simulateScenario } from "./strategy-development-lab.mjs";
import { fetchChart } from "./yahoo.mjs";

const root = process.cwd();
const universePath = path.join(root, "data", "universe-corrected-frozen-20260711.json");
const snapshotPath = path.join(root, "data", "sector-score-price-snapshot-corrected-frozen-20260711.json.gz");
const selectionPath = path.join(root, "data", "sector-score-variant-test-corrected-frozen-20260711.json");
const scalePath = path.join(root, "data", "scale-execution-test-corrected-score-c-20260711.json");
const validationPath = path.join(root, "data", "score-a-c-corrected-validation.json");
const marketHistoryPath = path.join(root, "data", "us-candidate-market-history.json");
const outputJsonPath = path.join(root, "data", "us-backtest-candidate-study.json");
const outputMdPath = path.join(root, "us_backtest_candidate_study.md");

const refreshMarketHistory = process.argv.includes("--refresh-market-history");
const years = 5;
const fixedHoldMonths = 6;
const maxHoldMonths = 12;
const costBps = 10;
const scoreCOptions = { sectorThemeWeight: 0.5, normalizeScore: true };
const currentRule = {
  key: "half_sell_half_weekly_extend",
  label: "6개월 절반 매도 + 주봉 연장",
  buyOffsets: [0],
  sellMode: "half_weekly"
};
const baseScenario = scenarios.find((row) => row.key === "repeat_theme_combo_cap275");

if (!baseScenario) throw new Error("Cap27.5 account scenario is missing.");

function parseDate(date) {
  return new Date(`${date}T00:00:00Z`);
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addYears(date, value) {
  const next = new Date(date);
  next.setUTCFullYear(next.getUTCFullYear() + value);
  return next;
}

function monthKey(date) {
  return String(date ?? "").slice(0, 7);
}

function rowsUntil(rows, asOf) {
  return rows.filter((row) => row.date <= asOf);
}

function firstRowAfter(rows, date) {
  return rows.find((row) => row.date > date && Number.isFinite(row.close)) ?? null;
}

function monthlyLastFridays(startDate, endDate) {
  const dates = [];
  const cursor = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1));
  while (cursor <= endDate) {
    const lastDay = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
    while (lastDay.getUTCDay() !== 5) lastDay.setUTCDate(lastDay.getUTCDate() - 1);
    if (lastDay >= startDate && lastDay <= endDate) dates.push(isoDate(lastDay));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return dates;
}

function average(values) {
  const clean = values.filter(Number.isFinite);
  return clean.length ? mean(clean) : null;
}

function median(values) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return null;
  const middle = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[middle] : (clean[middle - 1] + clean[middle]) / 2;
}

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertClose(label, actual, expected, tolerance = 0.0001) {
  if (!Number.isFinite(actual) || !Number.isFinite(expected) || Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label}: expected ${expected}, received ${actual}`);
  }
}

function weightedMomentum(metrics) {
  const parts = [
    [metrics?.r1m, 0.4],
    [metrics?.r3m, 0.35],
    [metrics?.r6m, 0.25]
  ].filter(([value]) => Number.isFinite(value));
  if (!parts.length) return null;
  const totalWeight = parts.reduce((sum, [, weight]) => sum + weight, 0);
  return parts.reduce((sum, [value, weight]) => sum + value * weight, 0) / totalWeight;
}

function rate(rows, predicate) {
  return rows.length ? rows.filter(predicate).length / rows.length : null;
}

function buildGroupStats(rows) {
  const stocks = rows.filter((row) => row.type === "stock" && row.sector);
  const eligible = rows.filter((row) => row.type === "stock" && row.sector && row.status !== "excluded");
  const top20 = eligible.slice(0, 20);
  const top50 = eligible.slice(0, 50);
  const top100 = eligible.slice(0, 100);
  const spy = rows.find((row) => row.symbol === "SPY");
  const qqq = rows.find((row) => row.symbol === "QQQ");
  const qqqMomentum = weightedMomentum(qqq?.metrics);
  const spyMomentum = weightedMomentum(spy?.metrics);
  const groups = new Map();

  for (const row of stocks) {
    const groupRows = groups.get(row.sector) ?? [];
    groupRows.push(row);
    groups.set(row.sector, groupRows);
  }

  return Array.from(groups, ([group, groupRows]) => {
    const groupEligible = groupRows.filter((row) => row.status !== "excluded");
    const groupTop20 = top20.filter((row) => row.sector === group);
    const groupTop50 = top50.filter((row) => row.sector === group);
    const groupTop100 = top100.filter((row) => row.sector === group);
    const groupMomentum = groupRows.map((row) => weightedMomentum(row.metrics));
    return {
      group,
      universeCount: groupRows.length,
      eligibleCount: groupEligible.length,
      top20Count: groupTop20.length,
      top50Count: groupTop50.length,
      top100Count: groupTop100.length,
      eligibleRate: round(groupEligible.length / groupRows.length, 4),
      top50Concentration: round(groupTop50.length / Math.max(1, groupRows.length), 4),
      top100Concentration: round(groupTop100.length / Math.max(1, groupRows.length), 4),
      averageMomentum: round(average(groupMomentum), 4),
      averageSpyExcessMomentum: round(average(groupMomentum.map((value) => value - spyMomentum)), 4),
      averageQqqExcessMomentum: round(average(groupMomentum.map((value) => value - qqqMomentum)), 4),
      above50Rate: round(rate(groupRows, (row) => row.metrics?.above50), 4),
      above200Rate: round(rate(groupRows, (row) => row.metrics?.above200), 4),
      nearHighRate: round(rate(groupRows, (row) => row.metrics?.high52wDistance >= -0.1), 4),
      score75Rate: round(rate(groupRows, (row) => row.score >= 75), 4),
      score80Rate: round(rate(groupRows, (row) => row.score >= 80), 4)
    };
  }).filter((row) => row.universeCount >= 3);
}

function previousStats(history, groupName, lookback = 3) {
  const rows = history
    .slice(-lookback)
    .map((period) => period.groupStats.find((group) => group.group === groupName))
    .filter(Boolean);
  return {
    periodsPresent: rows.length,
    averageTop50Count: average(rows.map((row) => row.top50Count)) ?? 0
  };
}

function scoreGroup(group, history) {
  const previous = previousStats(history, group.group);
  const acceleration = group.top50Count - previous.averageTop50Count;
  const leadershipScore = round(
    clamp(group.averageQqqExcessMomentum, -0.2, 0.4) * 100
    + clamp(group.averageSpyExcessMomentum, -0.2, 0.4) * 60
    + group.above50Rate * 22
    + group.above200Rate * 16
    + group.nearHighRate * 16
    + group.score75Rate * 20
    + group.score80Rate * 12
    + group.eligibleRate * 12
    + group.top50Concentration * 90
    + group.top100Concentration * 35
    + group.top20Count * 8
    + clamp(acceleration, -4, 6) * 4
    + previous.periodsPresent * 4,
    2
  );
  return { ...group, top50Acceleration: round(acceleration, 2), leadershipScore };
}

async function buildScoreCPeriods(instruments, priceMap, asOf) {
  const endDate = parseDate(asOf);
  const startDate = addYears(endDate, -years);
  const asOfDates = monthlyLastFridays(startDate, endDate);
  const periods = [];
  const history = [];

  for (const asOfDate of asOfDates) {
    const slicedPriceMap = new Map();
    for (const [symbol, rows] of priceMap) slicedPriceMap.set(symbol, rowsUntil(rows, asOfDate));
    const scored = scoreUniverse(instruments, slicedPriceMap, scoreCOptions);
    const entry = firstRowAfter(priceMap.get("SPY") ?? [], asOfDate);
    if (!entry) continue;
    const groupStats = buildGroupStats(scored.rows)
      .map((group) => scoreGroup(group, history))
      .sort((a, b) => b.leadershipScore - a.leadershipScore);
    const candidates = scored.rows
      .filter((row) => row.type === "stock" && row.sector && row.status !== "excluded")
      .map((row, index) => ({ ...row, rank: index + 1 }));
    const period = { asOf: asOfDate, entryDate: entry.date, groupStats, candidates };
    periods.push(period);
    history.push(period);
  }
  return periods;
}

function selectOnePerLeadingGroup(period, count) {
  const selected = [];
  const usedSymbols = new Set();
  for (const group of period.groupStats.slice(0, count).map((row) => row.group)) {
    const row = period.candidates.find((candidate) => (
      candidate.sector === group && !usedSymbols.has(candidate.symbol)
    ));
    if (!row) continue;
    selected.push(row);
    usedSymbols.add(row.symbol);
  }
  return selected.sort((a, b) => a.rank - b.rank).slice(0, count);
}

function selectionTimeline(periods, count) {
  return periods.map((period) => {
    const rows = selectOnePerLeadingGroup(period, count);
    return {
      asOf: period.asOf,
      entryDate: period.entryDate,
      leadingGroups: period.groupStats.slice(0, Math.max(5, count)).map((row) => row.group),
      symbols: rows.map((row) => row.symbol),
      groups: rows.map((row) => row.sector),
      rows: rows.map((row) => ({
        symbol: row.symbol,
        name: row.name,
        sector: row.sector,
        score: row.score,
        rank: row.rank
      }))
    };
  });
}

function tradeSpecs(timeline) {
  const trades = [];
  for (let index = 0; index < timeline.length; index += 1) {
    const cohort = timeline[index];
    if (!cohort.entryDate) continue;
    for (const row of cohort.rows) {
      trades.push({
        cohortIndex: index,
        cohort: monthKey(cohort.asOf),
        signalDate: cohort.asOf,
        entryDate: cohort.entryDate,
        fixedExitDate: timeline[index + fixedHoldMonths]?.entryDate ?? null,
        maxExitDate: timeline[index + maxHoldMonths]?.entryDate ?? null,
        symbol: row.symbol,
        name: row.name ?? row.symbol,
        sector: row.sector,
        score: row.score,
        rank: row.rank
      });
    }
  }
  return trades;
}

function evaluateTimeline(timeline, dailyMap, weeklyMap, asOf) {
  return tradeSpecs(timeline).map((trade, index) => ({
    ...evaluateTrade(currentRule, trade, dailyMap, weeklyMap, {
      costBps,
      benchmarkSymbol: "QQQ",
      asOfDate: asOf
    }),
    id: `${trade.cohort}-${trade.symbol}-${index}`
  }));
}

function verifyOfficialSelections(officialSelection, timeline) {
  assert(officialSelection.length === timeline.length, "Score C timeline length changed.");
  for (let index = 0; index < timeline.length; index += 1) {
    const expected = officialSelection[index];
    const actual = timeline[index];
    assert(expected.asOf === actual.asOf, `Signal date changed at timeline index ${index}.`);
    assert(
      JSON.stringify(expected.symbols) === JSON.stringify(actual.symbols),
      `Score C selections changed for ${actual.asOf}: ${actual.symbols.join(", ")}`
    );
  }
}

function verifyOfficialTrades(officialTrades, replayTrades) {
  assert(officialTrades.length === replayTrades.length, "Official trade count changed.");
  for (let index = 0; index < officialTrades.length; index += 1) {
    const expected = officialTrades[index];
    const actual = replayTrades[index];
    assert(
      expected.cohort === actual.cohort && expected.symbol === actual.symbol,
      `Trade identity changed at index ${index}.`
    );
    assert(
      JSON.stringify(expected.sellDates) === JSON.stringify(actual.sellDates),
      `Sell dates changed for ${actual.cohort} ${actual.symbol}.`
    );
    assertClose(`${actual.cohort} ${actual.symbol} marked return`, actual.markedReturn, expected.markedReturn);
  }
}

async function marketHistory() {
  if (refreshMarketHistory) {
    const fetched = await fetchChart("QQQ", { range: "10y" });
    const rows = fetched
      .filter((row) => Number.isFinite(row.close))
      .map((row) => ({ date: row.date, close: round(row.close, 6) }));
    const payload = {
      generatedAt: new Date().toISOString(),
      source: "Yahoo Finance adjusted close via src/yahoo.mjs",
      symbol: "QQQ",
      firstDate: rows[0]?.date ?? null,
      asOf: rows.at(-1)?.date ?? null,
      hash: hash(rows),
      rows
    };
    await fs.writeFile(marketHistoryPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }

  const payload = JSON.parse(await fs.readFile(marketHistoryPath, "utf8"));
  assert(payload.hash === hash(payload.rows), "QQQ market-history hash mismatch.");
  assert(payload.rows.length >= 200, "QQQ market history needs at least 200 trading days.");
  return payload;
}

function movingAverageAt(rows, date, length) {
  let index = -1;
  for (let cursor = 0; cursor < rows.length && rows[cursor].date <= date; cursor += 1) index = cursor;
  if (index < length - 1) return null;
  const slice = rows.slice(index - length + 1, index + 1);
  if (slice.length !== length || slice.some((row) => !Number.isFinite(row.close))) return null;
  return {
    date: rows[index].date,
    close: rows[index].close,
    average: mean(slice.map((row) => row.close))
  };
}

function addMarketState(trades, qqqRows) {
  return trades.map((trade) => {
    const state = movingAverageAt(qqqRows, trade.signalDate, 200);
    return {
      ...trade,
      marketStateDate: state?.date ?? null,
      qqqClose: round(state?.close, 4),
      qqqMa200: round(state?.average, 4),
      qqqAbove200: state ? state.close >= state.average : null
    };
  });
}

function filterOfficialRobustTrades(trades) {
  return trades.filter((trade) => Math.abs(trade.return ?? 0) <= 3);
}

function filterStrictOutlierTrades(trades) {
  return trades.filter((trade) => {
    const value = Number.isFinite(trade.return) ? trade.return : trade.markedReturn;
    return !Number.isFinite(value) || Math.abs(value) <= 3;
  });
}

function compactAccount(row) {
  return {
    key: row.key,
    label: row.label,
    initialCapital: row.initialCapital,
    finalCapital: row.finalCapital,
    finalCash: row.finalCash,
    openMarketValue: row.openMarketValue,
    openLotCount: row.openLotCount,
    totalReturn: row.totalReturn,
    cagr: row.cagr,
    maxDrawdown: row.maxDrawdown,
    executedBuys: row.executedBuys,
    attemptedBuys: row.attemptedBuys,
    skippedBuys: row.skippedBuys,
    skipReasonCounts: row.skipReasonCounts,
    minCash: row.minCash,
    totalTransactionCost: row.totalTransactionCost,
    benchmarkReturn: row.benchmark?.totalReturn ?? null,
    firstDate: row.firstDate,
    lastDate: row.lastDate
  };
}

function simulateCompact(scenario, trades, valuation) {
  const result = simulateScenario(scenario, trades, valuation);
  const officialRobustTrades = filterOfficialRobustTrades(trades);
  const strictOutlierTrades = filterStrictOutlierTrades(trades);
  const robust = simulateScenario(scenario, officialRobustTrades, valuation);
  const strictOutlier = simulateScenario(scenario, strictOutlierTrades, valuation);
  return {
    ...compactAccount(result),
    robust: {
      tradeCount: officialRobustTrades.length,
      totalReturn: robust.totalReturn,
      cagr: robust.cagr,
      maxDrawdown: robust.maxDrawdown
    },
    strictOutlier: {
      tradeCount: strictOutlierTrades.length,
      totalReturn: strictOutlier.totalReturn,
      cagr: strictOutlier.cagr,
      maxDrawdown: strictOutlier.maxDrawdown
    }
  };
}

const cohortSplits = [
  { key: "early", label: "2021~2023 추천", start: "2021-01-01", end: "2023-12-31" },
  { key: "middle", label: "2024 추천", start: "2024-01-01", end: "2024-12-31" },
  { key: "recent", label: "2025~2026 추천", start: "2025-01-01", end: "2026-12-31" }
];

function splitResults(scenario, trades, valuation) {
  return Object.fromEntries(cohortSplits.map((split) => {
    const selected = trades.filter((trade) => (
      trade.firstBuyDate >= split.start && trade.firstBuyDate <= split.end
    ));
    return [split.key, {
      label: split.label,
      tradeCount: selected.length,
      ...compactAccount(simulateScenario(scenario, selected, valuation))
    }];
  }));
}

function scenarioResult(scenario, trades, valuation, baseline) {
  const account = simulateCompact(scenario, trades, valuation);
  return {
    ...account,
    totalReturnChange: round(account.totalReturn - baseline.totalReturn, 4),
    cagrChange: round(account.cagr - baseline.cagr, 4),
    maxDrawdownChange: round(account.maxDrawdown - baseline.maxDrawdown, 4),
    robustReturnChange: round(account.robust.totalReturn - baseline.robust.totalReturn, 4),
    strictOutlierReturnChange: round(account.strictOutlier.totalReturn - baseline.strictOutlier.totalReturn, 4),
    splits: splitResults(scenario, trades, valuation)
  };
}

function marketGateScenario(buyRatio) {
  return {
    ...baseScenario,
    key: `qqq_below_200_buy_${Math.round(buyRatio * 100)}`,
    label: buyRatio === 1
      ? "현재 규칙"
      : `QQQ 200일선 아래에서 평소의 ${Math.round(buyRatio * 100)}% 매수`,
    description: "QQQ가 월말 기준 200일 평균 아래일 때 신규 매수금만 줄인다.",
    size: (args) => baseScenario.size(args) * (args.trade.qqqAbove200 === false ? buyRatio : 1)
  };
}

function sectorCapScenario(capPct) {
  return {
    ...baseScenario,
    key: capPct ? `sector_cost_cap_${Math.round(capPct * 100)}` : "sector_cost_cap_none",
    label: capPct ? `한 업종 원금 ${Math.round(capPct * 100)}% 한도` : "현재 규칙(업종 한도 없음)",
    description: "동시에 보유한 같은 업종의 매수 원금 합계를 제한한다.",
    sectorCapPct: capPct
  };
}

function countScenario(count, mode) {
  const budgetRatio = mode === "budget_matched" ? 2 / count : 1;
  return {
    ...baseScenario,
    key: `monthly_${count}_${mode}`,
    label: count === 2
      ? "월 2종목(현재 규칙)"
      : mode === "budget_matched"
        ? `월 ${count}종목·월 예산 동일`
        : `월 ${count}종목·종목당 금액 유지`,
    description: mode === "budget_matched"
      ? "월 전체 신규 매수 예정액을 2종목 전략과 같게 맞춘다."
      : "종목당 주문금액을 유지해 종목 수만큼 월 투자 예정액이 늘어난다.",
    rampSignalCount: count * 3,
    size: (args) => baseScenario.size(args) * budgetRatio
  };
}

function extensionExit(weekly, fixedExitDate, maxExitDate, lastAvailableDate) {
  const startIndex = weekly.findIndex((row) => row.date > fixedExitDate);
  const scanEnd = maxExitDate ?? lastAvailableDate;
  if (startIndex !== -1) {
    for (let index = startIndex; index < weekly.length; index += 1) {
      const row = weekly[index];
      if (scanEnd && row.date > scanEnd) break;
      const previous = weekly[index - 1];
      if (
        previous
        && Number.isFinite(row.ma10)
        && Number.isFinite(previous.ma10)
        && row.close < row.ma10
        && previous.close < previous.ma10
      ) {
        return { resolved: true, date: row.date, reason: "two_week_10w_break" };
      }
    }
  }
  if (maxExitDate && lastAvailableDate >= maxExitDate) {
    return { resolved: true, date: maxExitDate, reason: "max_12m" };
  }
  return { resolved: false, date: null, reason: "open" };
}

function trendTier(weekly, fixedExitDate) {
  const row = rowOnOrBefore(weekly, fixedExitDate);
  if (!row || !Number.isFinite(row.ma10) || !Number.isFinite(row.rsi14)) return "unknown";
  if (row.close >= row.ma10 && row.rsi14 >= 60) return "strong";
  if (row.close >= row.ma10 && row.rsi14 >= 50) return "healthy";
  if (row.close >= row.ma10 && row.rsi14 >= 40) return "caution";
  return "broken";
}

function exitPolicyFraction(policy, tier) {
  if (tier === "unknown" || tier === "broken") return 1;
  if (policy.type === "fixed") return tier === "strong" || tier === "healthy" ? policy.fraction : 1;
  if (tier === "strong") return 0.25;
  if (tier === "healthy") return 0.5;
  return 0.75;
}

function rebuildTradeExit(trade, policy, dailyMap, weeklyMap, asOf) {
  if (!trade.fixedExitDate) return { ...trade, exitPolicyTier: "before_6m" };
  const daily = dailyMap.get(trade.symbol) ?? [];
  const weekly = weeklyMap.get(trade.symbol) ?? [];
  const fixedRow = rowOnOrAfter(daily, trade.fixedExitDate);
  if (!fixedRow) return { ...trade, exitPolicyTier: "missing_fixed_price" };
  const tier = trendTier(weekly, trade.fixedExitDate);
  const fixedFraction = exitPolicyFraction(policy, tier);
  const remainingFraction = round(1 - fixedFraction, 8);
  const sellLots = [{
    date: fixedRow.date,
    price: fixedRow.close,
    shareFraction: fixedFraction,
    reason: fixedFraction === 1 ? `adaptive_full_${tier}` : `adaptive_6m_${tier}`
  }];

  if (remainingFraction > 0) {
    const extension = extensionExit(weekly, trade.fixedExitDate, trade.maxExitDate, daily.at(-1)?.date ?? asOf);
    const extensionRow = extension.resolved ? rowOnOrAfter(daily, extension.date) : null;
    if (extensionRow) {
      sellLots.push({
        date: extensionRow.date,
        price: extensionRow.close,
        shareFraction: remainingFraction,
        reason: `adaptive_${extension.reason}`
      });
    }
  }

  const soldFraction = sellLots.reduce((sum, row) => sum + row.shareFraction, 0);
  const openFraction = Math.max(0, 1 - soldFraction);
  const markRow = rowOnOrBefore(daily, asOf);
  const buyPrice = trade.averageBuyMarketPrice ?? trade.buyLots?.[0]?.price ?? trade.averageBuyPrice;
  const grossValue = sellLots.reduce((sum, row) => sum + row.shareFraction * row.price, 0)
    + openFraction * (markRow?.close ?? buyPrice);
  const markedReturn = buyPrice ? grossValue / buyPrice - 1 : null;
  const closed = openFraction <= 1e-8;
  const soldValue = sellLots.reduce((sum, row) => sum + row.shareFraction * row.price, 0);

  return {
    ...trade,
    closed,
    censored: !closed,
    status: closed ? "closed" : "partially_realized",
    firstSellDate: sellLots[0]?.date ?? null,
    lastSellDate: sellLots.at(-1)?.date ?? null,
    evaluationEndDate: sellLots.at(-1)?.date ?? markRow?.date ?? trade.firstBuyDate,
    averageSellPrice: soldFraction ? round(soldValue / soldFraction, 4) : null,
    return: closed ? round(markedReturn, 4) : null,
    markedReturn: round(markedReturn, 4),
    openShareFraction: round(openFraction, 8),
    openMarketValue: round(openFraction * (markRow?.close ?? 0), 6),
    markDate: markRow?.date ?? null,
    sellDates: sellLots.map((row) => row.date),
    sellReasons: sellLots.map((row) => row.reason),
    sellLots,
    exitPolicyTier: tier,
    sixMonthSellFraction: fixedFraction
  };
}

function rebuildExitTrades(trades, policy, dailyMap, weeklyMap, asOf) {
  return trades.map((trade) => rebuildTradeExit(trade, policy, dailyMap, weeklyMap, asOf));
}

function tierCounts(trades) {
  const counts = new Map();
  for (const trade of trades) {
    const key = trade.exitPolicyTier ?? "unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries(counts);
}

function resultStatus(row, baseline) {
  const returnImproved = row.totalReturn > baseline.totalReturn;
  const robustImproved = row.robust.totalReturn > baseline.robust.totalReturn;
  const strictOutlierImproved = row.strictOutlier.totalReturn > baseline.strictOutlier.totalReturn;
  const drawdownGuard = row.maxDrawdown >= baseline.maxDrawdown - 0.02;
  const splitWins = Object.values(row.splits).filter((split, index) => {
    const key = Object.keys(row.splits)[index];
    return split.totalReturn > baseline.splits[key].totalReturn;
  }).length;
  return {
    returnImproved,
    robustImproved,
    strictOutlierImproved,
    drawdownGuard,
    splitWins,
    passedResearchGate: returnImproved && robustImproved && strictOutlierImproved && drawdownGuard && splitWins >= 2
  };
}

function pct(value) {
  return Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%` : "-";
}

function money(value) {
  return Number.isFinite(value) ? `${Math.round(value).toLocaleString("ko-KR")}원` : "-";
}

function resultTable(lines, rows) {
  lines.push("| 방법 | 최종 자산 | 누적 수익 | 연평균 | 최대 하락 | 현재 대비 | 매수/시도 | 건너뜀 | 연구 관문 |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---|");
  for (const row of rows) {
    lines.push(`| ${row.label} | ${money(row.finalCapital)} | ${pct(row.totalReturn)} | ${pct(row.cagr)} | ${pct(row.maxDrawdown)} | ${pct(row.totalReturnChange)} | ${row.executedBuys}/${row.attemptedBuys} | ${row.skippedBuys} | ${row.status?.passedResearchGate ? "통과" : "미통과"} |`);
  }
}

function markdown(result) {
  const lines = [];
  lines.push("# 미국 전략 다음 후보 백테스트");
  lines.push("");
  lines.push(`생성 시각: ${result.generatedAt}`);
  lines.push(`검증 기간: ${result.period.startDate} ~ ${result.period.endDate}`);
  lines.push(`기준 전략: 종목 힘 중심형 · 월 2종목 · Cap27.5 · 6개월 절반 매도 후 주봉 연장`);
  lines.push(`기준 결과: ${pct(result.baseline.totalReturn)}, 최대 하락 ${pct(result.baseline.maxDrawdown)}, QQQ ${pct(result.baseline.benchmarkReturn)}`);
  lines.push("");
  lines.push("## 먼저 알아둘 점");
  lines.push("");
  lines.push("- 모든 숫자는 같은 1천만원, 같은 0.1% 매수·매도 비용, 같은 고정 가격 자료로 다시 계산했다.");
  lines.push("- `현재 대비`는 후보 수익률에서 현재 전략 수익률을 뺀 값이다.");
  lines.push("- `최대 하락`은 계좌가 고점에서 가장 많이 줄었던 폭이다. 0에 가까울수록 버티기 쉬웠다는 뜻이다.");
  lines.push("- 연구 관문은 전체 수익, 기존 극단값 점검, 보유 중 종목까지 포함한 +300% 초대형 상승 제외 결과, 최대 하락, 기간 분할 중 두 구간 이상을 함께 본다.");
  lines.push("");
  lines.push("## 1. QQQ 200일 평균 아래에서 신규 매수 줄이기");
  lines.push("");
  lines.push(`월말 신호 ${result.marketGate.signalMonths}개월 중 QQQ가 200일 평균 아래였던 달은 ${result.marketGate.below200Months}개월이었다.`);
  lines.push("");
  resultTable(lines, result.marketGate.rows);
  lines.push("");
  lines.push("## 2. 계좌 전체 업종 원금 한도");
  lines.push("");
  lines.push("월별 추천 두 종목은 원래부터 서로 다른 업종이다. 여기서는 여러 달의 보유분이 쌓이면서 한 업종에 돈이 몰리는 문제를 시험했다.");
  lines.push("");
  resultTable(lines, result.sectorCap.rows);
  lines.push("");
  lines.push("## 3. 6개월 매도 비율 바꾸기");
  lines.push("");
  lines.push("고정 25%·50%·75%와, 주봉이 강하면 25%, 보통이면 50%, 약하면 75%, 흐름이 깨졌으면 전량 매도하는 가변 방식을 비교했다.");
  lines.push("");
  resultTable(lines, result.exitSizing.rows);
  lines.push("");
  lines.push("## 4. 매달 2·3·4종목 비교");
  lines.push("");
  lines.push("`월 예산 동일`은 종목 수가 늘어도 한 달 전체 예정 매수금은 같게 맞춘 방식이다. `종목당 금액 유지`는 종목 수만큼 필요한 현금도 늘어난다.");
  lines.push("");
  resultTable(lines, result.monthlyCount.rows);
  lines.push("");
  lines.push("## 5. 과거 실제 종목군 검증");
  lines.push("");
  lines.push(`상태: **${result.pointInTimeUniverse.statusLabel}**`);
  lines.push("");
  for (const note of result.pointInTimeUniverse.notes) lines.push(`- ${note}`);
  lines.push("");
  lines.push("확인한 데이터 경로:");
  for (const source of result.pointInTimeUniverse.dataOptions) {
    lines.push(`- [${source.label}](${source.url}): ${source.note}`);
  }
  lines.push("");
  lines.push("## 연구 관문을 통과한 후보");
  lines.push("");
  if (result.passedCandidates.length) {
    for (const row of result.passedCandidates) {
      lines.push(`- ${row.experiment}: ${row.label} · 누적 ${pct(row.totalReturn)} · 최대 하락 ${pct(row.maxDrawdown)}`);
    }
  } else {
    lines.push("- 이번 조건에서 현재 전략을 안정적으로 넘어선 후보는 없었다.");
  }
  lines.push("");
  lines.push("## 해석 제한");
  lines.push("");
  lines.push("- 현재 551종목을 과거에도 알았다고 보는 생존자 편향은 아직 남아 있다.");
  lines.push("- 세금, 환전 비용, 실제 주문 미끄러짐은 포함하지 않았다.");
  lines.push("- 같은 5년 자료에서 여러 후보를 고른 결과이므로, 통과 후보도 바로 실전 규칙으로 승격하지 않고 앞으로 들어올 신호로 확인해야 한다.");
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const [instruments, snapshot, selection, scale, validation, qqqHistory] = await Promise.all([
    fs.readFile(universePath, "utf8").then(JSON.parse),
    readPriceSnapshot(snapshotPath),
    fs.readFile(selectionPath, "utf8").then(JSON.parse),
    fs.readFile(scalePath, "utf8").then(JSON.parse),
    fs.readFile(validationPath, "utf8").then(JSON.parse),
    marketHistory()
  ]);

  assert(hash(instruments) === selection.universeHash, "Frozen universe hash changed.");
  assert(snapshot.hash === selection.priceSnapshotHash, "Frozen price snapshot hash changed.");
  assert(qqqHistory.asOf >= snapshot.asOf, "QQQ market history ends before the frozen snapshot.");

  const priceMap = priceMapFromSnapshot(snapshot);
  const weeklyMap = new Map([...priceMap].map(([symbol, rows]) => [symbol, weeklyRows(rows)]));
  const valuation = {
    asOf: snapshot.asOf,
    hash: snapshot.hash,
    path: "data/sector-score-price-snapshot-corrected-frozen-20260711.json.gz",
    priceMap
  };
  const periods = await buildScoreCPeriods(instruments, priceMap, snapshot.asOf);
  const officialC = selection.results.find((row) => row.key === "c_half_sector_normalized");
  const timelines = Object.fromEntries([2, 3, 4].map((count) => [count, selectionTimeline(periods, count)]));
  verifyOfficialSelections(officialC.selectionTimeline, timelines[2]);

  const countTrades = Object.fromEntries([2, 3, 4].map((count) => [
    count,
    evaluateTimeline(timelines[count], priceMap, weeklyMap, snapshot.asOf)
  ]));
  const officialTrades = loadTrades(scale, false);
  verifyOfficialTrades(officialTrades, countTrades[2]);

  const baseline = simulateCompact(baseScenario, countTrades[2], valuation);
  assertClose("Official Score C account return", baseline.totalReturn, validation.scoreC.account.totalReturn);
  assertClose("Official Score C account MDD", baseline.maxDrawdown, validation.scoreC.account.maxDrawdown);
  const baselineWithSplits = {
    ...baseline,
    splits: splitResults(baseScenario, countTrades[2], valuation)
  };

  const marketTrades = addMarketState(countTrades[2], qqqHistory.rows);
  assert(marketTrades.every((trade) => typeof trade.qqqAbove200 === "boolean"), "QQQ 200-day state has warm-up gaps.");
  const marketRows = [1, 0.75, 0.5, 0.25, 0]
    .map((ratio) => scenarioResult(marketGateScenario(ratio), marketTrades, valuation, baselineWithSplits));

  const sectorRows = [null, 0.55, 0.45, 0.35, 0.25]
    .map((cap) => scenarioResult(sectorCapScenario(cap), countTrades[2], valuation, baselineWithSplits));

  const countDefinitions = [
    { count: 2, mode: "budget_matched" },
    { count: 3, mode: "budget_matched" },
    { count: 4, mode: "budget_matched" },
    { count: 3, mode: "same_ticket" },
    { count: 4, mode: "same_ticket" }
  ];
  const countRows = countDefinitions.map(({ count, mode }) => scenarioResult(
    countScenario(count, mode),
    countTrades[count],
    valuation,
    baselineWithSplits
  ));

  const exitPolicies = [
    { key: "fixed_50", label: "현재 규칙·건강하면 50% 매도", type: "fixed", fraction: 0.5 },
    { key: "fixed_25", label: "건강하면 25% 매도", type: "fixed", fraction: 0.25 },
    { key: "fixed_75", label: "건강하면 75% 매도", type: "fixed", fraction: 0.75 },
    { key: "adaptive_25_50_75", label: "주봉에 따라 25%·50%·75%", type: "adaptive" }
  ];
  const exitRows = exitPolicies.map((policy) => {
    const trades = rebuildExitTrades(countTrades[2], policy, priceMap, weeklyMap, snapshot.asOf);
    const scenario = { ...baseScenario, key: policy.key, label: policy.label };
    return {
      ...scenarioResult(scenario, trades, valuation, baselineWithSplits),
      tierCounts: tierCounts(trades)
    };
  });
  assertClose("Rebuilt 50% exit return", exitRows[0].totalReturn, baseline.totalReturn);
  assertClose("Rebuilt 50% exit MDD", exitRows[0].maxDrawdown, baseline.maxDrawdown);

  const experimentGroups = [
    ["시장 약세 매수 조절", marketRows],
    ["계좌 업종 한도", sectorRows],
    ["6개월 매도 비율", exitRows],
    ["월 추천 종목 수", countRows]
  ];
  const passedCandidates = [];
  for (const [experiment, rows] of experimentGroups) {
    for (const row of rows) {
      row.status = resultStatus(row, baselineWithSplits);
      if (row.status.passedResearchGate && row.totalReturnChange > 0.0001) {
        passedCandidates.push({
          experiment,
          key: row.key,
          label: row.label,
          totalReturn: row.totalReturn,
          maxDrawdown: row.maxDrawdown,
          totalReturnChange: row.totalReturnChange
        });
      }
    }
  }
  passedCandidates.sort((a, b) => b.totalReturn - a.totalReturn);

  const result = {
    generatedAt: new Date().toISOString(),
    runId: "us-score-c-next-candidates-frozen-20260711-v1",
    grade: "research",
    period: {
      startDate: selection.startDate,
      endDate: selection.endDate,
      priceAsOf: snapshot.asOf,
      signalMonths: periods.length,
      accountStartDate: baseline.firstDate,
      accountEndDate: baseline.lastDate
    },
    provenance: {
      universePath: "data/universe-corrected-frozen-20260711.json",
      universeHash: selection.universeHash,
      universeSize: instruments.length,
      priceSnapshotPath: "data/sector-score-price-snapshot-corrected-frozen-20260711.json.gz",
      priceSnapshotHash: snapshot.hash,
      qqqMarketHistoryPath: "data/us-candidate-market-history.json",
      qqqMarketHistoryHash: qqqHistory.hash,
      qqqMarketHistoryFirstDate: qqqHistory.firstDate,
      transactionCostBps: costBps,
      initialCapital: 10_000_000
    },
    baseline: baselineWithSplits,
    marketGate: {
      question: "QQQ가 200일 평균 아래일 때 신규 매수금만 줄이면 손실을 줄이면서 수익을 지킬 수 있는가?",
      signalMonths: new Set(marketTrades.map((trade) => trade.cohort)).size,
      below200Months: new Set(marketTrades.filter((trade) => !trade.qqqAbove200).map((trade) => trade.cohort)).size,
      rows: marketRows
    },
    sectorCap: {
      question: "여러 달의 보유분이 쌓일 때 같은 업종 원금을 제한하면 계좌가 더 안정적인가?",
      note: "Monthly Score C already selects one stock from each of two different leading sectors.",
      rows: sectorRows
    },
    exitSizing: {
      question: "6개월 매도 비율을 고정하거나 주봉 상태에 따라 바꾸면 현재 50% 규칙보다 나은가?",
      tierDefinition: {
        strong: "주봉 종가가 10주 평균 이상이고 RSI14가 60 이상",
        healthy: "주봉 종가가 10주 평균 이상이고 RSI14가 50 이상",
        caution: "주봉 종가가 10주 평균 이상이고 RSI14가 40 이상",
        broken: "그 밖의 경우"
      },
      rows: exitRows
    },
    monthlyCount: {
      question: "월 2종목을 3~4종목으로 늘리면 같은 자금 안에서 성과가 더 안정적인가?",
      signalCounts: Object.fromEntries([2, 3, 4].map((count) => [count, countTrades[count].length])),
      rows: countRows
    },
    pointInTimeUniverse: {
      status: "blocked_missing_point_in_time_membership_and_delisted_prices",
      statusLabel: "성과 계산 보류",
      validReturnCalculated: false,
      notes: [
        "현재 자료는 2026년에 남아 있는 551종목과 그 가격만 담고 있어, 과거에 편출되거나 상장폐지된 종목이 없다.",
        "월별 S&P 500·Nasdaq-100 구성 종목, 당시 업종 분류, 상장폐지 종목의 배당·분할 반영 가격이 함께 있어야 같은 점수 계산을 할 수 있다.",
        "이 자료 없이 임의로 종목을 추가하면 오히려 미래 정보를 섞을 수 있으므로 수익률 숫자를 만들지 않았다.",
        "이 후보는 유료 또는 검증 가능한 point-in-time 데이터 확보 후 별도 실행해야 한다."
      ],
      dataOptions: [
        {
          label: "Nasdaq Global Index Watch",
          url: "https://www.nasdaq.com/solutions/global-indexes/data/giw",
          note: "Nasdaq가 일별 구성·비중과 과거 지수 자료를 제공하는 구독형 서비스"
        },
        {
          label: "S&P DJI Index Data",
          url: "https://www.spglobal.com/spdji/en/documents/index-policies/index-data-capabilities-brochure.pdf",
          note: "S&P DJI의 구성 종목·리밸런싱 자료 제공 경로"
        },
        {
          label: "Norgate Data",
          url: "https://norgatedata.com/ref/chartist.php",
          note: "상장폐지 종목을 포함한 생존자 편향 없는 미국 주가 데이터 구독 서비스"
        }
      ]
    },
    passedCandidates,
    reproducibilityChecks: {
      officialSelectionReplay: true,
      officialTradeReplay: true,
      officialAccountReturnReplay: true,
      officialAccountMddReplay: true,
      rebuiltExitBaselineReplay: true,
      marketGateWarmupComplete: true
    }
  };

  await fs.writeFile(outputJsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  await fs.writeFile(outputMdPath, `${markdown(result)}\n`, "utf8");
  console.log(`Wrote ${path.relative(root, outputJsonPath)} and ${path.relative(root, outputMdPath)}`);
}

const entryUrl = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;

if (import.meta.url === entryUrl) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
