import fs from "node:fs/promises";
import path from "node:path";
import { buildUniverse } from "./universe.mjs";
import { fetchChart, syntheticChart } from "./yahoo.mjs";
import { scoreUniverse } from "./scoring.mjs";
import { mean, round } from "./math.mjs";

const sample = process.argv.includes("--sample");
const years = Number(valueAfter("--years") ?? 3);
const topGroups = [5, 10, 20];
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

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
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

function median(values) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return null;
  const mid = Math.floor(clean.length / 2);
  if (clean.length % 2) return clean[mid];
  return (clean[mid - 1] + clean[mid]) / 2;
}

function ratio(values, predicate) {
  const clean = values.filter(Number.isFinite);
  if (!clean.length) return null;
  return clean.filter(predicate).length / clean.length;
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

function benchmarkReturns(priceMap, asOf, entryDate) {
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

function evaluateRow(row, priceMap, asOf, entryDate, benchmarks) {
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
    scores: row.scores,
    metrics: row.metrics,
    setup: row.setup.type,
    entryDate: entry?.date ?? null,
    entryPrice: round(entry?.close, 2),
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
    const qqqMomentum = weightedMomentum(qqq?.metrics);
    const spyMomentum = weightedMomentum(spy?.metrics);
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
      eligibleAverageScore: round(mean(groupEligible.map((row) => row.score)), 2),
      averageMomentum: round(mean(groupMomentum), 4),
      averageSpyExcessMomentum: round(mean(groupMomentum.map((value) => value - spyMomentum)), 4),
      averageQqqExcessMomentum: round(mean(groupMomentum.map((value) => value - qqqMomentum)), 4),
      averageR1m: round(mean(groupRows.map((row) => row.metrics?.r1m)), 4),
      averageR3m: round(mean(groupRows.map((row) => row.metrics?.r3m)), 4),
      averageR6m: round(mean(groupRows.map((row) => row.metrics?.r6m)), 4),
      above20Rate: round(rate(groupRows, (row) => row.metrics?.above20), 4),
      above50Rate: round(rate(groupRows, (row) => row.metrics?.above50), 4),
      above200Rate: round(rate(groupRows, (row) => row.metrics?.above200), 4),
      nearHighRate: round(rate(groupRows, (row) => row.metrics?.high52wDistance >= -0.1), 4),
      score75Rate: round(rate(groupRows, (row) => row.score >= 75), 4),
      score80Rate: round(rate(groupRows, (row) => row.score >= 80), 4),
      setupRate: round(rate(groupEligible, (row) => row.setup?.type !== "none"), 4),
      averageDollar20: round(mean(groupRows.map((row) => row.metrics?.avgDollar20)), 0)
    };
  }).filter((row) => row.universeCount >= 3)
    .sort((a, b) => b.top50Count - a.top50Count || b.averageMomentum - a.averageMomentum);
}

function summarizeSelections(selections, benchmarks, topN, horizonKey) {
  const selected = selections.slice(0, topN);
  const returns = selected.map((row) => row.returns[horizonKey]).filter(Number.isFinite);
  const spy = benchmarks.SPY[horizonKey];
  const qqq = benchmarks.QQQ[horizonKey];
  return {
    topN,
    horizon: horizonKey,
    count: returns.length,
    averageReturn: round(mean(returns), 4),
    medianReturn: round(median(returns), 4),
    positiveRate: round(ratio(returns, (value) => value > 0), 4),
    beatSpyRate: round(ratio(returns, (value) => value > spy), 4),
    beatQqqRate: round(ratio(returns, (value) => value > qqq), 4),
    portfolioReturn: round(mean(returns), 4),
    spyReturn: spy,
    qqqReturn: qqq,
    excessSpy: round(mean(returns) - spy, 4),
    excessQqq: round(mean(returns) - qqq, 4)
  };
}

function aggregateSummaries(periods) {
  const rows = [];
  for (const topN of topGroups) {
    for (const horizon of horizons) {
      const matching = periods
        .map((period) => period.summaries.find((item) => item.topN === topN && item.horizon === horizon.key))
        .filter(Boolean)
        .filter((item) => Number.isFinite(item.portfolioReturn));
      const portfolioReturns = matching.map((item) => item.portfolioReturn);
      rows.push({
        topN,
        horizon: horizon.key,
        periods: matching.length,
        averageReturn: round(mean(portfolioReturns), 4),
        medianReturn: round(median(portfolioReturns), 4),
        positiveRate: round(ratio(portfolioReturns, (value) => value > 0), 4),
        beatSpyRate: round(ratio(matching.map((item) => item.excessSpy), (value) => value > 0), 4),
        beatQqqRate: round(ratio(matching.map((item) => item.excessQqq), (value) => value > 0), 4),
        averageExcessSpy: round(mean(matching.map((item) => item.excessSpy)), 4),
        averageExcessQqq: round(mean(matching.map((item) => item.excessQqq)), 4)
      });
    }
  }
  return rows;
}

function aggregateByRegime(periods) {
  const regimes = Array.from(new Set(periods.map((period) => period.market.regime)));
  const rows = [];
  for (const regime of regimes) {
    const regimePeriods = periods.filter((period) => period.market.regime === regime);
    for (const topN of topGroups) {
      for (const horizon of horizons) {
        const returns = regimePeriods
          .map((period) => period.summaries.find((item) => item.topN === topN && item.horizon === horizon.key)?.portfolioReturn)
          .filter(Number.isFinite);
        rows.push({
          regime,
          topN,
          horizon: horizon.key,
          periods: returns.length,
          averageReturn: round(mean(returns), 4),
          medianReturn: round(median(returns), 4),
          positiveRate: round(ratio(returns, (value) => value > 0), 4)
        });
      }
    }
  }
  return rows;
}

function contributionStats(periods) {
  const map = new Map();
  for (const period of periods) {
    const top20 = period.selections.slice(0, 20);
    for (const row of top20) {
      const current = map.get(row.symbol) ?? {
        symbol: row.symbol,
        name: row.name,
        count: 0,
        returns12m: [],
        returns3m: []
      };
      current.count += 1;
      if (Number.isFinite(row.returns["12m"])) current.returns12m.push(row.returns["12m"]);
      if (Number.isFinite(row.returns["3m"])) current.returns3m.push(row.returns["3m"]);
      map.set(row.symbol, current);
    }
  }
  const rows = Array.from(map.values()).map((row) => ({
    symbol: row.symbol,
    name: row.name,
    count: row.count,
    average3m: round(mean(row.returns3m), 4),
    average12m: round(mean(row.returns12m), 4)
  }));
  return {
    mostSelected: [...rows].sort((a, b) => b.count - a.count).slice(0, 10),
    best12m: [...rows].filter((row) => Number.isFinite(row.average12m)).sort((a, b) => b.average12m - a.average12m).slice(0, 10),
    worst12m: [...rows].filter((row) => Number.isFinite(row.average12m)).sort((a, b) => a.average12m - b.average12m).slice(0, 10)
  };
}

function worstPeriods(periods) {
  return periods
    .map((period) => ({
      asOf: period.asOf,
      entryDate: period.entryDate,
      regime: period.market.regime,
      top10_3m: period.summaries.find((item) => item.topN === 10 && item.horizon === "3m")?.portfolioReturn,
      top10_12m: period.summaries.find((item) => item.topN === 10 && item.horizon === "12m")?.portfolioReturn,
      selected: period.selections.slice(0, 10).map((row) => ({
        symbol: row.symbol,
        r3m: row.returns["3m"],
        r12m: row.returns["12m"]
      }))
    }))
    .filter((row) => Number.isFinite(row.top10_3m))
    .sort((a, b) => a.top10_3m - b.top10_3m)
    .slice(0, 10);
}

function formatPct(value) {
  if (!Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(1)}%`;
}

function markdownReport(result) {
  const lines = [];
  lines.push("# Monthly Selection Test Report");
  lines.push("");
  lines.push(`Generated at: ${result.generatedAt}`);
  lines.push(`Test range: ${result.startDate} to ${result.endDate}`);
  lines.push(`Basis: monthly last Friday, next trading-day close entry`);
  lines.push("");
  lines.push("## Summary Table");
  lines.push("");
  lines.push("| Top N | Horizon | Periods | Avg | Median | Positive | Beat SPY | Beat QQQ | Avg Excess SPY | Avg Excess QQQ |");
  lines.push("|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const row of result.summary) {
    lines.push(`| ${row.topN} | ${row.horizon} | ${row.periods} | ${formatPct(row.averageReturn)} | ${formatPct(row.medianReturn)} | ${formatPct(row.positiveRate)} | ${formatPct(row.beatSpyRate)} | ${formatPct(row.beatQqqRate)} | ${formatPct(row.averageExcessSpy)} | ${formatPct(row.averageExcessQqq)} |`);
  }
  lines.push("");
  lines.push("## Worst Top 10 3M Periods");
  lines.push("");
  lines.push("| As Of | Regime | Top10 3M | Top10 12M | Worst Names |");
  lines.push("|---|---|---:|---:|---|");
  for (const period of result.worstPeriods.slice(0, 5)) {
    const worstNames = [...period.selected].sort((a, b) => (a.r3m ?? 0) - (b.r3m ?? 0)).slice(0, 3).map((row) => `${row.symbol} ${formatPct(row.r3m)}`).join(", ");
    lines.push(`| ${period.asOf} | ${period.regime} | ${formatPct(period.top10_3m)} | ${formatPct(period.top10_12m)} | ${worstNames} |`);
  }
  lines.push("");
  lines.push("## Most Selected Top 20 Names");
  lines.push("");
  lines.push("| Symbol | Count | Avg 3M | Avg 12M |");
  lines.push("|---|---:|---:|---:|");
  for (const row of result.contributions.mostSelected) {
    lines.push(`| ${row.symbol} | ${row.count} | ${formatPct(row.average3m)} | ${formatPct(row.average12m)} |`);
  }
  lines.push("");
  lines.push("## Limitations");
  lines.push("");
  lines.push("- This validates stock-selection power, not full trade execution.");
  lines.push("- Current index membership is used, so survivorship bias remains.");
  lines.push("- No taxes, commissions, slippage, FX, or position sizing are included.");
  lines.push("- No 1H/4H entry timing or stop-loss execution is included.");
  lines.push("");
  return lines.join("\n");
}

async function main() {
  console.log(sample ? "Running monthly selection test with sample data." : "Running monthly selection test with live data.");
  const instruments = await buildUniverse({ sample });
  console.log(`Universe size: ${instruments.length}`);
  const { priceMap, errors } = await collectPrices(instruments);
  const endDate = parseDate(latestDate(priceMap));
  const startDate = addYears(endDate, -years);
  const asOfDates = monthlyLastFridays(startDate, endDate);
  const periods = [];

  for (const [index, asOf] of asOfDates.entries()) {
    const slicedPriceMap = new Map();
    for (const [symbol, rows] of priceMap) slicedPriceMap.set(symbol, rowsUntil(rows, asOf));
    const scored = scoreUniverse(instruments, slicedPriceMap);
    const entryRow = firstRowAfter(priceMap.get("SPY") ?? [], asOf);
    if (!entryRow) continue;
    const entryDate = entryRow.date;
    const benchmarks = benchmarkReturns(priceMap, asOf, entryDate);
    const selections = scored.rows
      .filter((row) => row.status !== "excluded")
      .slice(0, 20)
      .map((row) => evaluateRow(row, priceMap, asOf, entryDate, benchmarks));
    const summaries = [];
    for (const topN of topGroups) {
      for (const horizon of horizons) {
        summaries.push(summarizeSelections(selections, benchmarks, topN, horizon.key));
      }
    }
    periods.push({
      asOf,
      entryDate,
      market: scored.market,
      benchmarks,
      groupStats: buildGroupStats(scored.rows),
      selections,
      summaries
    });
    if ((index + 1) % 12 === 0) console.log(`Scored ${index + 1}/${asOfDates.length} periods`);
  }

  const result = {
    generatedAt: new Date().toISOString(),
    mode: sample ? "sample" : "live",
    years,
    startDate: isoDate(startDate),
    endDate: isoDate(endDate),
    asOfCount: periods.length,
    universeSize: instruments.length,
    summary: aggregateSummaries(periods),
    byRegime: aggregateByRegime(periods),
    worstPeriods: worstPeriods(periods),
    contributions: contributionStats(periods),
    periods,
    errors
  };

  await ensureDir("data");
  await fs.writeFile(path.join("data", "monthly-selection-test.json"), JSON.stringify(result, null, 2), "utf8");
  await fs.writeFile("monthly_selection_report.md", markdownReport(result), "utf8");
  console.log(`Wrote data/monthly-selection-test.json and monthly_selection_report.md (${periods.length} periods)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
