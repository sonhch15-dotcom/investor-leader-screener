import { createHash } from "node:crypto";
import { clamp, mean, round } from "./math.mjs";
import { scoreUniverse } from "./scoring.mjs";

export const SCORE_C_STRATEGY_KEY = "us_leader2_score_c_cap27_5";
export const SCORE_C_FORMULA_VERSION = "score_c_half_sector10_normalized_v1";
export const SCORE_C_SELECTION_SOURCE = "live_score_c_last_friday_v1";

function parseDate(value) {
  return new Date(`${value}T00:00:00Z`);
}

function isoDate(value) {
  return value.toISOString().slice(0, 10);
}

function rowsUntil(rows, asOf) {
  return (rows ?? []).filter((row) => row.date <= asOf);
}

function nextWeekday(value) {
  const date = parseDate(value);
  do date.setUTCDate(date.getUTCDate() + 1);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6);
  return isoDate(date);
}

function endOfMonth(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
}

function nextSignalMonth(selectionDate) {
  const date = parseDate(selectionDate);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)).toISOString().slice(0, 7);
}

function daysBetween(start, end) {
  return Math.round((parseDate(end) - parseDate(start)) / 86400000);
}

function lastFriday(year, month) {
  const date = new Date(Date.UTC(year, month + 1, 0));
  while (date.getUTCDay() !== 5) date.setUTCDate(date.getUTCDate() - 1);
  return isoDate(date);
}

export function completedMonthlySelectionDates(latestDate, count = 4) {
  const latest = parseDate(latestDate);
  const dates = [];
  const cursor = new Date(Date.UTC(latest.getUTCFullYear(), latest.getUTCMonth(), 1));
  while (dates.length < count) {
    const candidate = lastFriday(cursor.getUTCFullYear(), cursor.getUTCMonth());
    if (candidate <= latestDate) dates.push(candidate);
    cursor.setUTCMonth(cursor.getUTCMonth() - 1);
  }
  return dates.sort();
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
  const eligible = stocks.filter((row) => row.status !== "excluded");
  const top20 = eligible.slice(0, 20);
  const top50 = eligible.slice(0, 50);
  const top100 = eligible.slice(0, 100);
  const spyMomentum = weightedMomentum(rows.find((row) => row.symbol === "SPY")?.metrics);
  const qqqMomentum = weightedMomentum(rows.find((row) => row.symbol === "QQQ")?.metrics);
  const groups = new Map();

  for (const row of stocks) {
    const current = groups.get(row.sector) ?? [];
    current.push(row);
    groups.set(row.sector, current);
  }

  return Array.from(groups, ([group, groupRows]) => {
    const groupEligible = groupRows.filter((row) => row.status !== "excluded");
    const groupTop20 = top20.filter((row) => row.sector === group);
    const groupTop50 = top50.filter((row) => row.sector === group);
    const groupTop100 = top100.filter((row) => row.sector === group);
    const momentum = groupRows.map((row) => weightedMomentum(row.metrics));
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
      averageMomentum: round(mean(momentum), 4),
      averageSpyExcessMomentum: round(mean(momentum.map((value) => value - spyMomentum)), 4),
      averageQqqExcessMomentum: round(mean(momentum.map((value) => value - qqqMomentum)), 4),
      above50Rate: round(rate(groupRows, (row) => row.metrics?.above50), 4),
      above200Rate: round(rate(groupRows, (row) => row.metrics?.above200), 4),
      nearHighRate: round(rate(groupRows, (row) => row.metrics?.high52wDistance >= -0.1), 4),
      score75Rate: round(rate(groupRows, (row) => row.score >= 75), 4),
      score80Rate: round(rate(groupRows, (row) => row.score >= 80), 4)
    };
  }).filter((row) => row.universeCount >= 3);
}

function previousStats(history, groupName) {
  const rows = history
    .slice(-3)
    .map((period) => period.groupStats.find((group) => group.group === groupName))
    .filter(Boolean);
  return {
    periodsPresent: rows.length,
    averageTop50Count: mean(rows.map((row) => row.top50Count)) ?? 0
  };
}

function scoreGroup(group, history) {
  const previous = previousStats(history, group.group);
  const acceleration = group.top50Count - previous.averageTop50Count;
  return {
    ...group,
    top50Acceleration: round(acceleration, 2),
    leadershipScore: round(
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
    )
  };
}

function selectLeader2(period) {
  const selected = [];
  const used = new Set();
  for (const group of period.groupStats.slice(0, 2).map((row) => row.group)) {
    const row = period.candidates.find((candidate) => candidate.sector === group && !used.has(candidate.symbol));
    if (!row) continue;
    selected.push(row);
    used.add(row.symbol);
  }
  return selected.sort((a, b) => a.rank - b.rank);
}

function compactChart(rows, days = 126) {
  return rows.slice(-days).map((row) => ({
    date: row.date,
    close: round(row.close, 2),
    high: round(row.high ?? row.close, 2),
    low: round(row.low ?? row.close, 2),
    volume: row.volume
  }));
}

export function buildScoreCLiveSignal({ instruments, priceMap, generatedAt = new Date().toISOString() }) {
  const spyRows = priceMap.get("SPY") ?? [];
  const latestPriceDate = spyRows.at(-1)?.date;
  if (!latestPriceDate) throw new Error("Score C live selection requires SPY prices.");

  const selectionDates = completedMonthlySelectionDates(latestPriceDate, 4);
  const periods = [];
  for (const selectionAsOf of selectionDates) {
    const slicedPriceMap = new Map();
    for (const [symbol, rows] of priceMap) slicedPriceMap.set(symbol, rowsUntil(rows, selectionAsOf));
    const scored = scoreUniverse(instruments, slicedPriceMap, {
      sectorThemeWeight: 0.5,
      normalizeScore: true
    });
    const groupStats = buildGroupStats(scored.rows)
      .map((group) => scoreGroup(group, periods))
      .sort((a, b) => b.leadershipScore - a.leadershipScore);
    const candidates = scored.rows
      .filter((row) => row.type === "stock" && row.sector && row.status !== "excluded")
      .map((row, index) => ({ ...row, rank: index + 1 }));
    periods.push({ selectionAsOf, groupStats, candidates });
  }

  const current = periods.at(-1);
  const selected = selectLeader2(current);
  const selectionRows = rowsUntil(spyRows, current.selectionAsOf);
  const dataAsOf = selectionRows.at(-1)?.date ?? null;
  const futureEntry = spyRows.find((row) => row.date > current.selectionAsOf)?.date;
  const validFrom = futureEntry ?? nextWeekday(current.selectionAsOf);
  const signalMonth = nextSignalMonth(current.selectionAsOf);
  const pricedUniverseCount = instruments.filter((row) => {
    const latest = rowsUntil(priceMap.get(row.symbol), current.selectionAsOf).at(-1);
    if (!latest?.date) return false;
    const lag = daysBetween(latest.date, current.selectionAsOf);
    return lag >= 0 && lag <= 3;
  }).length;
  const coverageRatio = pricedUniverseCount / Math.max(1, instruments.length);
  const selectionLagDays = dataAsOf ? daysBetween(dataAsOf, current.selectionAsOf) : null;
  const complete = selected.length === 2
    && new Set(selected.map((row) => row.sector)).size === 2
    && coverageRatio >= 0.98
    && Number.isFinite(selectionLagDays)
    && selectionLagDays >= 0
    && selectionLagDays <= 3;

  return {
    schemaVersion: "1.0.0",
    generatedAt,
    status: complete ? "normal" : "needs_review",
    complete,
    strategyKey: SCORE_C_STRATEGY_KEY,
    scoreFormulaVersion: SCORE_C_FORMULA_VERSION,
    selectionSource: SCORE_C_SELECTION_SOURCE,
    selectionMethod: "last_completed_monthly_friday_leader2",
    selectionAsOf: current.selectionAsOf,
    dataAsOf,
    selectionLagDays,
    latestPriceDate,
    signalMonth,
    validFrom,
    validUntil: endOfMonth(signalMonth),
    historySelectionDates: selectionDates,
    universeSize: instruments.length,
    pricedUniverseCount,
    coverageRatio: round(coverageRatio, 4),
    universeHash: createHash("sha256").update(JSON.stringify(instruments)).digest("hex"),
    leadingGroups: current.groupStats.slice(0, 5).map((row, index) => ({
      rank: index + 1,
      group: row.group,
      leadershipScore: row.leadershipScore,
      top50Count: row.top50Count,
      top50Acceleration: row.top50Acceleration
    })),
    currentPicks: selected.map((row, index) => ({
      symbol: row.symbol,
      name: row.name,
      sector: row.sector,
      score: row.score,
      rank: index + 1,
      close: row.metrics?.close,
      lastDate: dataAsOf,
      validFrom,
      selectionAsOf: current.selectionAsOf,
      selectionSource: SCORE_C_SELECTION_SOURCE,
      scoreFormulaVersion: SCORE_C_FORMULA_VERSION,
      reasons: [...(row.reasons ?? []), "Score C: sector/theme score halved and normalized"],
      warnings: row.warnings ?? [],
      metrics: row.metrics,
      chart: compactChart(rowsUntil(priceMap.get(row.symbol), current.selectionAsOf))
    }))
  };
}
