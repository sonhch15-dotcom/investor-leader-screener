import fs from "node:fs/promises";
import path from "node:path";
import { buildUniverse } from "./universe.mjs";
import { fetchChart, syntheticChart } from "./yahoo.mjs";
import { scoreUniverse } from "./scoring.mjs";
import { clamp, mean, round } from "./math.mjs";

const sample = process.argv.includes("--sample");
const years = Number(valueAfter("--years") ?? 3);
const outputJsonPath = path.join("data", "full-candidate-diversification-test.json");
const outputMdPath = "full_candidate_diversification_test.md";
const horizons = [
  { key: "1m", calendarMonths: 1 },
  { key: "3m", calendarMonths: 3 },
  { key: "6m", calendarMonths: 6 },
  { key: "12m", calendarMonths: 12 }
];

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function parseDate(date) {
  return new Date(`${date}T00:00:00Z`);
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addMonths(date, months) {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
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

function exitRowOnOrAfter(rows, date) {
  const lastAvailable = rows.at(-1);
  if (!lastAvailable || lastAvailable.date < date) return null;
  return rows.find((row) => row.date >= date && Number.isFinite(row.close)) ?? null;
}

function pct(entry, exit) {
  if (!entry || !exit || !Number.isFinite(entry.close) || !Number.isFinite(exit.close) || entry.close === 0) return null;
  return exit.close / entry.close - 1;
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

function benchmarkReturns(priceMap, entryDate) {
  const result = {};
  for (const symbol of ["SPY", "QQQ"]) {
    const rows = priceMap.get(symbol) ?? [];
    const entry = rowOnOrAfter(rows, entryDate);
    result[symbol] = {};
    for (const horizon of horizons) {
      const exitDate = isoDate(addMonths(parseDate(entryDate), horizon.calendarMonths));
      const exit = exitRowOnOrAfter(rows, exitDate);
      result[symbol][horizon.key] = round(pct(entry, exit), 4);
    }
  }
  return result;
}

function evaluateRow(row, priceMap, entryDate, benchmarks) {
  const rows = priceMap.get(row.symbol) ?? [];
  const entry = rowOnOrAfter(rows, entryDate);
  const returns = {};
  for (const horizon of horizons) {
    const targetDate = isoDate(addMonths(parseDate(entryDate), horizon.calendarMonths));
    const exit = exitRowOnOrAfter(rows, targetDate);
    returns[horizon.key] = round(pct(entry, exit), 4);
  }
  return {
    symbol: row.symbol,
    name: row.name,
    type: row.type,
    sector: row.sector,
    tags: row.tags ?? [],
    status: row.status,
    score: row.score,
    returns,
    excess: Object.fromEntries(horizons.map((horizon) => [
      horizon.key,
      {
        SPY: round(returns[horizon.key] - benchmarks.SPY[horizon.key], 4),
        QQQ: round(returns[horizon.key] - benchmarks.QQQ[horizon.key], 4)
      }
    ]))
  };
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
      averageScore: round(mean(groupRows.map((row) => row.score)), 2),
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

function top(rows, count) {
  return rows.slice(0, count);
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
  return top(period.candidates.filter((row) => set.has(row.sector)), limit);
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

const strategies = [
  {
    key: "baseline_top10",
    label: "Baseline Top10",
    select: (period) => top(period.candidates, 10)
  },
  {
    key: "leader_top2_top5",
    label: "Leader Top2 Top5",
    select: (period) => selectByGroups(period, leaderGroups(period, 2), 5)
  },
  {
    key: "leader_top2_top10",
    label: "Leader Top2 Top10",
    select: (period) => selectByGroups(period, leaderGroups(period, 2), 10)
  },
  {
    key: "leader_top3_top10",
    label: "Leader Top3 Top10",
    select: (period) => selectByGroups(period, leaderGroups(period, 3), 10)
  },
  {
    key: "leader_top5_cap2_top10",
    label: "Leader Top5 Cap2 Top10",
    select: (period) => selectCapped(period, leaderGroups(period, 5), 10, 2)
  },
  {
    key: "leader_top5_cap3_top10",
    label: "Leader Top5 Cap3 Top10",
    select: (period) => selectCapped(period, leaderGroups(period, 5), 10, 3)
  },
  {
    key: "quality_top5_cap2_top10",
    label: "Quality Top5 Cap2 Top10",
    select: (period) => selectCapped(period, qualityGroups(period, 5), 10, 2)
  }
];

function concentrationStats(selected) {
  if (!selected.length) return { sectorCount: 0, maxSectorWeight: null };
  const counts = new Map();
  for (const row of selected) counts.set(row.sector, (counts.get(row.sector) ?? 0) + 1);
  return {
    sectorCount: counts.size,
    maxSectorWeight: Math.max(...counts.values()) / selected.length
  };
}

function summarizeStrategy(periods, strategy) {
  const periodRows = periods.map((period) => {
    const selected = strategy.select(period);
    const concentration = concentrationStats(selected);
    const result = {
      asOf: period.asOf,
      entryDate: period.entryDate,
      selectedCount: selected.length,
      leadingGroups: leaderGroups(period, 5),
      symbols: selected.map((row) => row.symbol),
      selectedGroups: Array.from(new Set(selected.map((row) => row.sector))),
      sectorCount: concentration.sectorCount,
      maxSectorWeight: round(concentration.maxSectorWeight, 4)
    };
    for (const horizon of horizons) {
      const returns = selected.map((row) => row.returns?.[horizon.key]).filter(Number.isFinite);
      const portfolioReturn = avg(returns);
      const spyReturn = period.benchmarks?.SPY?.[horizon.key];
      const qqqReturn = period.benchmarks?.QQQ?.[horizon.key];
      result[horizon.key] = {
        portfolioReturn,
        spyReturn,
        qqqReturn,
        excessSpy: round(portfolioReturn - spyReturn, 4),
        excessQqq: round(portfolioReturn - qqqReturn, 4)
      };
    }
    return result;
  });

  return {
    key: strategy.key,
    label: strategy.label,
    periods: periodRows.length,
    activePeriods: periodRows.filter((row) => row.selectedCount > 0).length,
    emptyPeriods: periodRows.filter((row) => row.selectedCount === 0).length,
    averageSelectedCount: avg(periodRows.map((row) => row.selectedCount)),
    averageSectorCount: avg(periodRows.map((row) => row.sectorCount)),
    averageMaxSectorWeight: avg(periodRows.map((row) => row.maxSectorWeight)),
    horizons: Object.fromEntries(horizons.map((horizon) => {
      const rows = periodRows.filter((row) => Number.isFinite(row[horizon.key].portfolioReturn));
      const returns = rows.map((row) => row[horizon.key].portfolioReturn);
      const excessSpy = rows.map((row) => row[horizon.key].excessSpy);
      const excessQqq = rows.map((row) => row[horizon.key].excessQqq);
      return [horizon.key, {
        periods: rows.length,
        averageReturn: avg(returns),
        medianReturn: round(median(returns), 4),
        positiveRate: round(ratio(returns, (value) => value > 0), 4),
        beatSpyRate: round(ratio(excessSpy, (value) => value > 0), 4),
        beatQqqRate: round(ratio(excessQqq, (value) => value > 0), 4),
        averageExcessSpy: avg(excessSpy),
        averageExcessQqq: avg(excessQqq),
        worstReturn: returns.length ? round(Math.min(...returns), 4) : null
      }];
    })),
    periodsDetail: periodRows
  };
}

function splitPeriods(periods) {
  const splitIndex = Math.floor(periods.length / 2);
  return [
    { key: "all", label: "All", periods },
    { key: "early", label: "Early Half", periods: periods.slice(0, splitIndex) },
    { key: "late", label: "Late Half", periods: periods.slice(splitIndex) },
    { key: "recent12", label: "Recent 12", periods: periods.slice(-12) }
  ];
}

function rowsFor(results, horizon) {
  return results
    .map((result) => ({
      label: result.label,
      activePeriods: result.activePeriods,
      emptyPeriods: result.emptyPeriods,
      averageSelectedCount: result.averageSelectedCount,
      averageSectorCount: result.averageSectorCount,
      averageMaxSectorWeight: result.averageMaxSectorWeight,
      ...result.horizons[horizon]
    }))
    .sort((a, b) => b.averageExcessQqq - a.averageExcessQqq);
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
  lines.push("| Strategy | Active | Empty | Avg Names | Avg Sectors | Max Sector Wt | Avg | Median | Beat QQQ | Avg QQQ Excess | Worst |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const row of rows) {
    lines.push(`| ${row.label} | ${row.activePeriods} | ${row.emptyPeriods} | ${formatNumber(row.averageSelectedCount)} | ${formatNumber(row.averageSectorCount)} | ${formatPct(row.averageMaxSectorWeight)} | ${formatPct(row.averageReturn)} | ${formatPct(row.medianReturn)} | ${formatPct(row.beatQqqRate)} | ${formatPct(row.averageExcessQqq)} | ${formatPct(row.worstReturn)} |`);
  }
}

function markdown(result) {
  const lines = [];
  lines.push("# Full Candidate Diversification Test");
  lines.push("");
  lines.push(`Generated at: ${result.generatedAt}`);
  lines.push(`Mode: ${result.mode}`);
  lines.push(`Range: ${result.startDate} to ${result.endDate}`);
  lines.push(`Periods: ${result.periodCount}`);
  lines.push(`Universe: ${result.universeSize}, price series: ${result.priceSeriesCount}`);
  lines.push("");
  lines.push("## All Periods, 12M");
  lines.push("");
  table(lines, rowsFor(result.splits.all.results, "12m"));
  lines.push("");
  lines.push("## All Periods, 3M");
  lines.push("");
  table(lines, rowsFor(result.splits.all.results, "3m"));
  lines.push("");
  lines.push("## Recent 12 Periods, 3M");
  lines.push("");
  table(lines, rowsFor(result.splits.recent12.results, "3m"));
  lines.push("");
  lines.push("## Recent Examples");
  lines.push("");
  for (const strategy of result.splits.all.results) {
    lines.push(`### ${strategy.label}`);
    lines.push("");
    lines.push("| As Of | Symbols | Groups | 3M | 12M |");
    lines.push("|---|---|---|---:|---:|");
    for (const period of strategy.periodsDetail.slice(-3)) {
      lines.push(`| ${period.asOf} | ${period.symbols.join(", ")} | ${period.selectedGroups.join(", ")} | ${formatPct(period["3m"].portfolioReturn)} | ${formatPct(period["12m"].portfolioReturn)} |`);
    }
    lines.push("");
  }
  lines.push("## Notes");
  lines.push("");
  lines.push("- This evaluates all eligible scored candidates for each monthly as-of date, not only the monthly Top20.");
  lines.push("- Selection still ignores taxes, commissions, slippage, stops, FX, and intraday timing.");
  lines.push("- Current index membership is used, so survivorship bias remains.");
  lines.push("");
  return lines.join("\n");
}

async function main() {
  console.log(sample ? "Running full candidate diversification test with sample data." : "Running full candidate diversification test with live data.");
  const instruments = await buildUniverse({ sample });
  console.log(`Universe size: ${instruments.length}`);
  const { priceMap, errors } = await collectPrices(instruments);
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
    const entryDate = entryRow.date;
    const benchmarks = benchmarkReturns(priceMap, entryDate);
    const groupStats = buildGroupStats(scored.rows)
      .map((group) => scoreGroup(group, history))
      .sort((a, b) => b.leadershipScore - a.leadershipScore);
    const candidates = scored.rows
      .filter((row) => row.type === "stock" && row.sector && row.status !== "excluded")
      .map((row) => evaluateRow(row, priceMap, entryDate, benchmarks));
    const period = {
      asOf,
      entryDate,
      benchmarks,
      groupStats,
      candidates
    };
    periods.push(period);
    history.push(period);
    if ((index + 1) % 12 === 0) console.log(`Scored ${index + 1}/${asOfDates.length} periods`);
  }

  const splits = Object.fromEntries(splitPeriods(periods).map((split) => [
    split.key,
    {
      label: split.label,
      results: strategies.map((strategy) => summarizeStrategy(split.periods, strategy))
    }
  ]));

  const result = {
    generatedAt: new Date().toISOString(),
    mode: sample ? "sample" : "live",
    years,
    startDate: isoDate(startDate),
    endDate: isoDate(endDate),
    periodCount: periods.length,
    universeSize: instruments.length,
    priceSeriesCount: priceMap.size,
    errors,
    splits
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
