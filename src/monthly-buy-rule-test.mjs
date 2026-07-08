import fs from "node:fs/promises";
import path from "node:path";
import { buildUniverse } from "./universe.mjs";
import { fetchChart, syntheticChart } from "./yahoo.mjs";
import { scoreUniverse } from "./scoring.mjs";
import { clamp, mean, round } from "./math.mjs";

const sample = process.argv.includes("--sample");
const years = Number(valueAfter("--years") ?? 3);
const holdMonths = Number(valueAfter("--hold-months") ?? 6);
const costBps = Number(valueAfter("--cost-bps") ?? 10);
const outputSuffix = safeSuffix(valueAfter("--output-suffix") ?? "");
const outputJsonPath = path.join("data", `monthly-buy-rule-test${outputSuffix}.json`);
const outputMdPath = `monthly_buy_rule_test${outputSuffix}.md`;

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function safeSuffix(value) {
  if (!value) return "";
  const suffix = value.startsWith("-") ? value : `-${value}`;
  return suffix.replace(/[^a-z0-9_-]/gi, "");
}

function parseDate(date) {
  return new Date(`${date}T00:00:00Z`);
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addYears(date, yearsToAdd) {
  const next = new Date(date);
  next.setUTCFullYear(next.getUTCFullYear() + yearsToAdd);
  return next;
}

function rowsUntil(rows, asOf) {
  return rows.filter((row) => row.date <= asOf);
}

function firstRowAfter(rows, date) {
  return rows.find((row) => row.date > date && Number.isFinite(row.close)) ?? null;
}

function rowOnOrAfter(rows, date) {
  return rows.find((row) => row.date >= date && Number.isFinite(row.close)) ?? rows.at(-1) ?? null;
}

function latestDate(priceMap) {
  const spy = priceMap.get("SPY") ?? Array.from(priceMap.values()).find((rows) => rows.length);
  return spy?.at(-1)?.date ?? isoDate(new Date());
}

function monthlyLastFridays(startDate, endDate) {
  const dates = [];
  const cursor = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1));
  while (cursor <= endDate) {
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth();
    const lastDay = new Date(Date.UTC(year, month + 1, 0));
    while (lastDay.getUTCDay() !== 5) lastDay.setUTCDate(lastDay.getUTCDate() - 1);
    if (lastDay >= startDate && lastDay <= endDate) dates.push(isoDate(lastDay));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return dates;
}

function clean(values) {
  return values.filter(Number.isFinite);
}

function avg(values) {
  return round(mean(clean(values)), 4);
}

function median(values) {
  const rows = clean(values).sort((a, b) => a - b);
  if (!rows.length) return null;
  const middle = Math.floor(rows.length / 2);
  return rows.length % 2 ? rows[middle] : (rows[middle - 1] + rows[middle]) / 2;
}

function ratio(values, predicate) {
  const rows = clean(values);
  if (!rows.length) return null;
  return rows.filter(predicate).length / rows.length;
}

function standardDeviation(values) {
  const rows = clean(values);
  if (rows.length < 2) return null;
  const average = mean(rows);
  const variance = mean(rows.map((value) => (value - average) ** 2));
  return Math.sqrt(variance);
}

function annualizedReturn(totalReturn, months) {
  if (!Number.isFinite(totalReturn) || months <= 0) return null;
  return (1 + totalReturn) ** (12 / months) - 1;
}

function annualizedVolatility(monthlyReturns) {
  const monthlyVol = standardDeviation(monthlyReturns);
  if (!Number.isFinite(monthlyVol)) return null;
  return monthlyVol * Math.sqrt(12);
}

function maxDrawdown(curve) {
  let peak = 1;
  let worst = 0;
  for (const row of curve) {
    peak = Math.max(peak, row.equity);
    worst = Math.min(worst, row.equity / peak - 1);
  }
  return round(worst, 4);
}

function periodReturn(priceMap, symbol, startDate, endDate) {
  const rows = priceMap.get(symbol) ?? [];
  const entry = rowOnOrAfter(rows, startDate);
  const exit = rowOnOrAfter(rows, endDate);
  if (!entry || !exit || entry.close === 0) return null;
  return exit.close / entry.close - 1;
}

function basketReturn(priceMap, symbols, startDate, endDate) {
  const returns = symbols
    .map((symbol) => periodReturn(priceMap, symbol, startDate, endDate))
    .filter(Number.isFinite);
  return mean(returns);
}

async function collectPrices(instruments) {
  const priceMap = new Map();
  const errors = [];
  for (const [index, instrument] of instruments.entries()) {
    try {
      const rows = sample ? syntheticChart(instrument.symbol, 900) : await fetchChart(instrument.symbol, { range: "5y" });
      priceMap.set(instrument.symbol, rows);
      if ((index + 1) % 50 === 0) console.log(`Fetched ${index + 1}/${instruments.length}`);
    } catch (error) {
      errors.push({ symbol: instrument.symbol, error: error.message });
      if (sample) priceMap.set(instrument.symbol, syntheticChart(instrument.symbol, 900));
    }
  }
  return { priceMap, errors };
}

function weightedMomentum(metrics) {
  const parts = [
    [metrics?.r1m, 0.4],
    [metrics?.r3m, 0.35],
    [metrics?.r6m, 0.25]
  ];
  const valid = parts.filter(([value]) => Number.isFinite(value));
  if (!valid.length) return null;
  const weight = valid.reduce((sum, [, itemWeight]) => sum + itemWeight, 0);
  return valid.reduce((sum, [value, itemWeight]) => sum + value * itemWeight, 0) / weight;
}

function rate(rows, predicate) {
  if (!rows.length) return null;
  return rows.filter(predicate).length / rows.length;
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
    const current = groups.get(row.sector) ?? [];
    current.push(row);
    groups.set(row.sector, current);
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
      averageMomentum: round(mean(groupMomentum), 4),
      averageSpyExcessMomentum: round(mean(groupMomentum.map((value) => value - spyMomentum)), 4),
      averageQqqExcessMomentum: round(mean(groupMomentum.map((value) => value - qqqMomentum)), 4),
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
    averageTop50Count: mean(rows.map((row) => row.top50Count)) ?? 0
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
  return {
    ...group,
    top50Acceleration: round(acceleration, 2),
    leadershipScore
  };
}

function leaderGroups(period, count) {
  return period.groupStats.slice(0, count).map((group) => group.group);
}

function qualityGroups(period, count) {
  return period.groupStats
    .filter((group) => (
      group.averageQqqExcessMomentum > 0
      && group.above50Rate >= 0.55
      && group.score75Rate >= 0.15
      && group.top50Count >= 2
    ))
    .slice(0, count)
    .map((group) => group.group);
}

function selectByGroups(period, groups, limit) {
  const set = new Set(groups);
  return period.candidates.filter((row) => set.has(row.sector)).slice(0, limit);
}

function selectCapped(period, groups, totalLimit, perSectorLimit) {
  const set = new Set(groups);
  const counts = new Map();
  const selected = [];
  for (const row of period.candidates) {
    if (!set.has(row.sector)) continue;
    const count = counts.get(row.sector) ?? 0;
    if (count >= perSectorLimit) continue;
    selected.push(row);
    counts.set(row.sector, count + 1);
    if (selected.length >= totalLimit) break;
  }
  return selected;
}

function topOnePerGroup(period, groups, totalLimit) {
  const selected = [];
  const used = new Set();
  for (const group of groups) {
    const row = period.candidates.find((candidate) => candidate.sector === group && !used.has(candidate.symbol));
    if (!row) continue;
    selected.push(row);
    used.add(row.symbol);
    if (selected.length >= totalLimit) break;
  }
  return selected.sort((a, b) => a.rank - b.rank);
}

function qualityStock(row) {
  return row.metrics?.above20
    && row.metrics?.above50
    && row.metrics?.above200
    && row.metrics?.high52wDistance >= -0.12
    && row.score >= 75;
}

const aiHardwareSymbols = new Set([
  "NVDA", "AMD", "AVGO", "ARM", "MU", "ASML", "TSM", "SMH", "SOXX",
  "WDC", "STX", "DELL", "HPE", "ANET", "VRT", "SMCI", "MRVL", "LRCX",
  "KLAC", "AMAT", "TER", "MPWR", "ON", "QCOM", "INTC", "SNDK"
]);

const aiHardwareSectors = new Set([
  "Semiconductors",
  "Electronic Components",
  "Computer Peripheral Equipment",
  "Computer Communications Equipment"
]);

const weakerSectors = new Set([
  "Real Estate",
  "Consumer Staples",
  "Utilities"
]);

function isAiHardware(row) {
  return aiHardwareSymbols.has(row.symbol) || aiHardwareSectors.has(row.sector);
}

function monthsBetween(startDate, endDate) {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  return (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth();
}

function enrichPeriods(periods) {
  const symbolSeen = new Map();
  const sectorSeen = new Map();
  return periods.map((period) => {
    const candidates = period.candidates.map((row) => {
      const symbolHistory = symbolSeen.get(row.symbol) ?? [];
      const sectorHistory = sectorSeen.get(row.sector) ?? [];
      return {
        ...row,
        previousSymbolTop20_12m: symbolHistory.filter((date) => monthsBetween(date, period.entryDate) <= 12).length,
        previousSectorTop20_6m: sectorHistory.filter((date) => monthsBetween(date, period.entryDate) <= 6).length,
        isAiHardware: isAiHardware(row)
      };
    });
    for (const row of candidates.slice(0, 20)) {
      symbolSeen.set(row.symbol, [...(symbolSeen.get(row.symbol) ?? []), period.entryDate]);
      sectorSeen.set(row.sector, [...(sectorSeen.get(row.sector) ?? []), period.entryDate]);
    }
    return { ...period, candidates };
  });
}

function convictionScore(row) {
  let score = row.score ?? 0;
  score += (row.previousSymbolTop20_12m ?? 0) * 3.5;
  score += Math.min(row.previousSectorTop20_6m ?? 0, 6) * 1.2;
  if (row.isAiHardware) score += 5;
  if (row.metrics?.above50 && row.metrics?.above200) score += 2;
  if (weakerSectors.has(row.sector)) score -= 4;
  if (row.metrics?.high52wDistance > -0.01) score -= 1.5;
  return score;
}

function convictionDiverse(period, count = 2) {
  const selected = [];
  const sectors = new Set();
  const rows = [...period.candidates]
    .filter((row) => !weakerSectors.has(row.sector))
    .sort((a, b) => convictionScore(b) - convictionScore(a) || a.rank - b.rank);
  for (const row of rows) {
    if (sectors.has(row.sector)) continue;
    selected.push(row);
    sectors.add(row.sector);
    if (selected.length >= count) break;
  }
  return selected;
}

const rules = [
  {
    key: "main_rank2",
    label: "Main Top2",
    description: "Top 2 from Leader Top5 Cap2 Top10",
    select: (period) => selectCapped(period, leaderGroups(period, 5), 10, 2).slice(0, 2)
  },
  {
    key: "main_diverse2",
    label: "Main Diverse 2",
    description: "Top 2 from leading 5 groups, max 1 per sector",
    select: (period) => selectCapped(period, leaderGroups(period, 5), 2, 1)
  },
  {
    key: "leader2_rank2",
    label: "Leader2 Top2",
    description: "Top 2 from the top 2 leading groups",
    select: (period) => selectByGroups(period, leaderGroups(period, 2), 2)
  },
  {
    key: "leader2_one_each",
    label: "Leader2 One Each",
    description: "One name from each of the top 2 leading groups",
    select: (period) => topOnePerGroup(period, leaderGroups(period, 2), 2)
  },
  {
    key: "leader3_one_each_top2",
    label: "Leader3 One Each Top2",
    description: "One name from each of the top 3 groups, then best 2 by rank",
    select: (period) => topOnePerGroup(period, leaderGroups(period, 3), 3).slice(0, 2)
  },
  {
    key: "quality_rank2",
    label: "Quality Top2",
    description: "Top 2 from quality leading groups",
    select: (period) => selectCapped(period, qualityGroups(period, 5), 10, 2).slice(0, 2)
  },
  {
    key: "quality_diverse2",
    label: "Quality Diverse 2",
    description: "Top 2 from quality leading groups, max 1 per sector",
    select: (period) => selectCapped(period, qualityGroups(period, 5), 2, 1)
  },
  {
    key: "strict_quality_main2",
    label: "Strict Quality Main2",
    description: "Main leading groups, but require price above key moving averages and score >= 75",
    select: (period) => selectCapped(period, leaderGroups(period, 5), 10, 2).filter(qualityStock).slice(0, 2)
  },
  {
    key: "conviction_diverse2",
    label: "Conviction Diverse Top2",
    description: "Top 2 by score, repeated Top20 signal, repeated sector leadership, AI hardware signal, and sector diversity",
    select: (period) => convictionDiverse(period, 2)
  },
  {
    key: "baseline_top2",
    label: "Baseline Top2",
    description: "Top 2 from all eligible stocks",
    select: (period) => period.candidates.slice(0, 2)
  }
];

function simulateRule(priceMap, periods, rule) {
  let equity = 1;
  let spyEquity = 1;
  let qqqEquity = 1;
  const curve = [];
  const monthlyReturns = [];
  const selectedPeriods = [];

  for (let index = 0; index < periods.length - 1; index += 1) {
    const current = periods[index];
    const next = periods[index + 1];
    if (!current.entryDate || !next.entryDate) continue;

    const activeCohorts = [];
    for (let offset = 0; offset < holdMonths; offset += 1) {
      const cohortIndex = index - offset;
      if (cohortIndex < 0) continue;
      const cohort = periods[cohortIndex];
      const selected = rule.select(cohort);
      if (!selected.length) continue;
      activeCohorts.push({
        asOf: cohort.asOf,
        ageMonths: offset,
        rows: selected
      });
    }
    if (!activeCohorts.length) continue;

    const cohortReturns = activeCohorts
      .map((cohort) => basketReturn(priceMap, cohort.rows.map((row) => row.symbol), current.entryDate, next.entryDate))
      .filter(Number.isFinite);
    if (!cohortReturns.length) continue;

    const grossReturn = mean(cohortReturns);
    const newCohortWeight = 1 / holdMonths;
    const openCost = newCohortWeight * costBps / 10_000;
    const closeCost = index >= holdMonths ? newCohortWeight * costBps / 10_000 : 0;
    const transactionCost = openCost + closeCost;
    const netReturn = grossReturn - transactionCost;
    const spyReturn = periodReturn(priceMap, "SPY", current.entryDate, next.entryDate);
    const qqqReturn = periodReturn(priceMap, "QQQ", current.entryDate, next.entryDate);
    if (!Number.isFinite(netReturn) || !Number.isFinite(spyReturn) || !Number.isFinite(qqqReturn)) continue;

    const newest = rule.select(current);
    if (newest.length) selectedPeriods.push(newest.length);
    equity *= 1 + netReturn;
    spyEquity *= 1 + spyReturn;
    qqqEquity *= 1 + qqqReturn;
    monthlyReturns.push(netReturn);
    const uniqueHeld = new Set(activeCohorts.flatMap((cohort) => cohort.rows.map((row) => row.symbol)));
    curve.push({
      asOf: current.asOf,
      entryDate: current.entryDate,
      exitDate: next.entryDate,
      activeCohorts: activeCohorts.length,
      uniqueHeldCount: uniqueHeld.size,
      newestSymbols: newest.map((row) => row.symbol),
      newestGroups: Array.from(new Set(newest.map((row) => row.sector))),
      leadingGroups: leaderGroups(current, 5),
      grossReturn: round(grossReturn, 4),
      transactionCost: round(transactionCost, 4),
      netReturn: round(netReturn, 4),
      spyReturn: round(spyReturn, 4),
      qqqReturn: round(qqqReturn, 4),
      excessQqq: round(netReturn - qqqReturn, 4),
      equity: round(equity, 4),
      spyEquity: round(spyEquity, 4),
      qqqEquity: round(qqqEquity, 4)
    });
  }

  const totalReturn = equity - 1;
  const qqqTotalReturn = qqqEquity - 1;
  const drawdown = maxDrawdown(curve);
  const cagr = annualizedReturn(totalReturn, curve.length);
  const selectionTimeline = periods.map((period) => {
    const selected = rule.select(period);
    return {
      asOf: period.asOf,
      entryDate: period.entryDate,
      leadingGroups: leaderGroups(period, 5),
      symbols: selected.map((row) => row.symbol),
      groups: Array.from(new Set(selected.map((row) => row.sector))),
      rows: selected.map((row) => ({
        symbol: row.symbol,
        name: row.name,
        sector: row.sector,
        score: row.score,
        rank: row.rank
      }))
    };
  });
  return {
    key: rule.key,
    label: rule.label,
    description: rule.description,
    holdMonths,
    months: curve.length,
    activeSelectionPeriods: selectedPeriods.length,
    averageNewBuys: avg(selectedPeriods),
    averageHeldCount: avg(curve.map((row) => row.uniqueHeldCount)),
    totalReturn: round(totalReturn, 4),
    spyTotalReturn: round(spyEquity - 1, 4),
    qqqTotalReturn: round(qqqTotalReturn, 4),
    excessQqqTotal: round(totalReturn - qqqTotalReturn, 4),
    cagr: round(cagr, 4),
    maxDrawdown: drawdown,
    returnToDrawdown: round(Number.isFinite(cagr) && drawdown < 0 ? cagr / Math.abs(drawdown) : null, 2),
    annualizedVolatility: round(annualizedVolatility(monthlyReturns), 4),
    averageMonthlyReturn: avg(monthlyReturns),
    medianMonthlyReturn: round(median(monthlyReturns), 4),
    positiveMonthRate: round(ratio(monthlyReturns, (value) => value > 0), 4),
    beatQqqMonthRate: round(ratio(curve.map((row) => row.excessQqq), (value) => value > 0), 4),
    totalTransactionCost: round(curve.reduce((sum, row) => sum + row.transactionCost, 0), 4),
    selectionTimeline,
    curve
  };
}

function rankResults(results) {
  return [...results].sort((a, b) => (
    b.excessQqqTotal - a.excessQqqTotal
    || b.returnToDrawdown - a.returnToDrawdown
    || b.cagr - a.cagr
  ));
}

function formatPct(value) {
  if (!Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(1)}%`;
}

function formatNumber(value, digits = 1) {
  if (!Number.isFinite(value)) return "-";
  return value.toFixed(digits);
}

function table(lines, rows) {
  lines.push("| Rule | Months | Avg Buys | Avg Held | Total | CAGR | QQQ Total | Excess QQQ | MDD | Avg Month | Positive | Beat QQQ | Vol | Cost |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const row of rows) {
    lines.push(`| ${row.label} | ${row.months} | ${formatNumber(row.averageNewBuys)} | ${formatNumber(row.averageHeldCount)} | ${formatPct(row.totalReturn)} | ${formatPct(row.cagr)} | ${formatPct(row.qqqTotalReturn)} | ${formatPct(row.excessQqqTotal)} | ${formatPct(row.maxDrawdown)} | ${formatPct(row.averageMonthlyReturn)} | ${formatPct(row.positiveMonthRate)} | ${formatPct(row.beatQqqMonthRate)} | ${formatPct(row.annualizedVolatility)} | ${formatPct(row.totalTransactionCost)} |`);
  }
}

function markdown(result) {
  const lines = [];
  lines.push("# Monthly Buy Rule Test");
  lines.push("");
  lines.push(`Generated at: ${result.generatedAt}`);
  lines.push(`Mode: ${result.mode}`);
  lines.push(`Range: ${result.startDate} to ${result.endDate}`);
  lines.push(`Holding window: ${result.holdMonths} months`);
  lines.push(`Transaction cost: ${result.costBps} bps per open/close cohort weight`);
  lines.push("");
  lines.push("## Ranked Results");
  lines.push("");
  table(lines, result.rankedResults);
  lines.push("");
  lines.push("## Recent Selections");
  lines.push("");
  for (const row of result.rankedResults.slice(0, 5)) {
    lines.push(`### ${row.label}`);
    lines.push("");
    lines.push("| As Of | New Buys | Groups | Leading Groups | Net | QQQ | Equity |");
    lines.push("|---|---|---|---|---:|---:|---:|");
    for (const period of row.curve.slice(-6)) {
      lines.push(`| ${period.asOf} | ${period.newestSymbols.join(", ")} | ${period.newestGroups.join(", ")} | ${period.leadingGroups.join(", ")} | ${formatPct(period.netReturn)} | ${formatPct(period.qqqReturn)} | ${formatNumber(period.equity, 2)} |`);
    }
    lines.push("");
  }
  lines.push("## Notes");
  lines.push("");
  lines.push("- Each rule buys up to two new names per month and holds each monthly sleeve for six months.");
  lines.push("- Cohorts are equally weighted. Within each monthly cohort, selected symbols are equally weighted.");
  lines.push("- This still ignores taxes, FX, intraday execution quality, stop execution, and survivorship bias in the source universe.");
  lines.push("");
  return lines.join("\n");
}

async function buildPeriods(instruments, priceMap) {
  const endDate = parseDate(latestDate(priceMap));
  const startDate = addYears(endDate, -years);
  const asOfDates = monthlyLastFridays(startDate, endDate);
  const periods = [];
  const history = [];

  for (const [index, asOf] of asOfDates.entries()) {
    const slicedPriceMap = new Map();
    for (const [symbol, rows] of priceMap) slicedPriceMap.set(symbol, rowsUntil(rows, asOf));
    const scored = scoreUniverse(instruments, slicedPriceMap);
    const entryRow = firstRowAfter(priceMap.get("SPY") ?? [], asOf);
    if (!entryRow) continue;
    const groupStats = buildGroupStats(scored.rows)
      .map((group) => scoreGroup(group, history))
      .sort((a, b) => b.leadershipScore - a.leadershipScore);
    const candidates = scored.rows
      .filter((row) => row.type === "stock" && row.sector && row.status !== "excluded")
      .map((row, rowIndex) => ({ ...row, rank: rowIndex + 1 }));
    const period = {
      asOf,
      entryDate: entryRow.date,
      groupStats,
      candidates
    };
    periods.push(period);
    history.push(period);
    if ((index + 1) % 12 === 0) console.log(`Scored ${index + 1}/${asOfDates.length} periods`);
  }

  return { periods, startDate: isoDate(startDate), endDate: isoDate(endDate) };
}

async function main() {
  console.log(sample ? "Running monthly-buy-rule test with sample data." : "Running monthly-buy-rule test with live data.");
  const instruments = await buildUniverse({ sample });
  console.log(`Universe size: ${instruments.length}`);
  const { priceMap, errors } = await collectPrices(instruments);
  const rawPeriods = await buildPeriods(instruments, priceMap);
  const periods = enrichPeriods(rawPeriods.periods);
  const { startDate, endDate } = rawPeriods;
  const results = rules.map((rule) => simulateRule(priceMap, periods, rule));
  const rankedResults = rankResults(results);
  const result = {
    generatedAt: new Date().toISOString(),
    mode: sample ? "sample" : "live",
    years,
    startDate,
    endDate,
    periodCount: periods.length,
    holdMonths,
    costBps,
    universeSize: instruments.length,
    priceSeriesCount: priceMap.size,
    errors,
    rankedResults,
    results
  };
  await fs.mkdir("data", { recursive: true });
  await fs.writeFile(outputJsonPath, JSON.stringify(result, null, 2), "utf8");
  await fs.writeFile(outputMdPath, markdown(result), "utf8");
  console.log(`Wrote ${outputJsonPath} and ${outputMdPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
