import fs from "node:fs/promises";
import path from "node:path";
import { fetchChart, syntheticChart } from "./yahoo.mjs";
import { mean, round } from "./math.mjs";

const inputPath = path.join("data", "full-candidate-diversification-test.json");
const outputJsonPath = path.join("data", "sleeve-size-test.json");
const outputMdPath = "sleeve_size_test.md";
const sample = process.argv.includes("--sample");
const costBps = Number(valueAfter("--cost-bps") ?? 10);
const holdMonths = Number(valueAfter("--hold-months") ?? 6);
const monthlyBuyCounts = [2, 3, 5, 10];

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
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

function rowOnOrAfter(rows, date) {
  return rows.find((row) => row.date >= date && Number.isFinite(row.close)) ?? rows.at(-1) ?? null;
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

function uniqueSymbols(data) {
  const symbols = new Set(["SPY", "QQQ"]);
  for (const strategy of data.splits?.all?.results ?? []) {
    for (const period of strategy.periodsDetail ?? []) {
      for (const symbol of period.symbols ?? []) symbols.add(symbol);
    }
  }
  return Array.from(symbols).sort();
}

async function collectPrices(symbols) {
  const priceMap = new Map();
  const errors = [];
  for (const [index, symbol] of symbols.entries()) {
    try {
      const rows = sample ? syntheticChart(symbol, 900) : await fetchChart(symbol, { range: "5y" });
      priceMap.set(symbol, rows);
      if ((index + 1) % 50 === 0) console.log(`Fetched ${index + 1}/${symbols.length}`);
    } catch (error) {
      errors.push({ symbol, error: error.message });
      if (sample) priceMap.set(symbol, syntheticChart(symbol, 900));
    }
  }
  return { priceMap, errors };
}

function activeCohorts(periods, index, monthlyBuyCount) {
  const cohorts = [];
  for (let offset = 0; offset < holdMonths; offset += 1) {
    const cohortIndex = index - offset;
    if (cohortIndex < 0) continue;
    const period = periods[cohortIndex];
    const symbols = (period.symbols ?? []).slice(0, monthlyBuyCount);
    if (!symbols.length) continue;
    cohorts.push({
      asOf: period.asOf,
      ageMonths: offset,
      symbols,
      groups: period.selectedGroups ?? []
    });
  }
  return cohorts;
}

function simulateSleeve(priceMap, strategy, monthlyBuyCount) {
  let equity = 1;
  let spyEquity = 1;
  let qqqEquity = 1;
  const curve = [];
  const monthlyReturns = [];
  const allPeriods = strategy.periodsDetail ?? [];

  for (let index = 0; index < allPeriods.length - 1; index += 1) {
    const current = allPeriods[index];
    const next = allPeriods[index + 1];
    if (!current.entryDate || !next.entryDate) continue;

    const cohorts = activeCohorts(allPeriods, index, monthlyBuyCount);
    const cohortReturns = cohorts
      .map((cohort) => basketReturn(priceMap, cohort.symbols, current.entryDate, next.entryDate))
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

    equity *= 1 + netReturn;
    spyEquity *= 1 + spyReturn;
    qqqEquity *= 1 + qqqReturn;
    monthlyReturns.push(netReturn);
    const uniqueHeld = new Set(cohorts.flatMap((cohort) => cohort.symbols));
    curve.push({
      asOf: current.asOf,
      entryDate: current.entryDate,
      exitDate: next.entryDate,
      activeCohorts: cohorts.length,
      uniqueHeldCount: uniqueHeld.size,
      newestSymbols: (current.symbols ?? []).slice(0, monthlyBuyCount),
      newestGroups: current.selectedGroups ?? [],
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
  return {
    strategyKey: strategy.key,
    strategyLabel: strategy.label,
    holdMonths,
    monthlyBuyCount,
    expectedMaxPositions: monthlyBuyCount * holdMonths,
    months: curve.length,
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
    averageUniqueHeldCount: avg(curve.map((row) => row.uniqueHeldCount)),
    totalTransactionCost: round(curve.reduce((sum, row) => sum + row.transactionCost, 0), 4),
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

function bestByStrategy(results) {
  const map = new Map();
  for (const result of results) {
    const current = map.get(result.strategyKey);
    if (!current || result.excessQqqTotal > current.excessQqqTotal) map.set(result.strategyKey, result);
  }
  return Array.from(map.values()).sort((a, b) => b.excessQqqTotal - a.excessQqqTotal);
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
  lines.push("| Strategy | Buy/Month | Max Pos | Months | Total | CAGR | QQQ Total | Excess QQQ | MDD | Avg Month | Positive | Beat QQQ | Avg Held | Cost |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const row of rows) {
    lines.push(`| ${row.strategyLabel} | ${row.monthlyBuyCount} | ${row.expectedMaxPositions} | ${row.months} | ${formatPct(row.totalReturn)} | ${formatPct(row.cagr)} | ${formatPct(row.qqqTotalReturn)} | ${formatPct(row.excessQqqTotal)} | ${formatPct(row.maxDrawdown)} | ${formatPct(row.averageMonthlyReturn)} | ${formatPct(row.positiveMonthRate)} | ${formatPct(row.beatQqqMonthRate)} | ${formatNumber(row.averageUniqueHeldCount)} | ${formatPct(row.totalTransactionCost)} |`);
  }
}

function markdown(result) {
  const lines = [];
  lines.push("# Sleeve Size Test");
  lines.push("");
  lines.push(`Generated at: ${result.generatedAt}`);
  lines.push(`Source generated at: ${result.sourceGeneratedAt}`);
  lines.push(`Mode: ${result.mode}`);
  lines.push(`Holding window: ${result.holdMonths} months`);
  lines.push(`Transaction cost: ${result.costBps} bps per open/close cohort weight`);
  lines.push("");
  lines.push("## Best Monthly Buy Count By Strategy");
  lines.push("");
  table(lines, result.bestByStrategy);
  lines.push("");
  lines.push("## Main Strategy Sleeve Comparison");
  lines.push("");
  table(lines, result.results.filter((row) => row.strategyKey === "leader_top5_cap2_top10")
    .sort((a, b) => b.excessQqqTotal - a.excessQqqTotal));
  lines.push("");
  lines.push("## Top Overall Results");
  lines.push("");
  table(lines, result.rankedResults.slice(0, 12));
  lines.push("");
  lines.push("## Recent Main Strategy Months");
  lines.push("");
  for (const row of result.results
    .filter((item) => item.strategyKey === "leader_top5_cap2_top10")
    .sort((a, b) => a.monthlyBuyCount - b.monthlyBuyCount)) {
    lines.push(`### Buy ${row.monthlyBuyCount}/Month`);
    lines.push("");
    lines.push("| As Of | Held | Net | QQQ | Equity | Newest Groups | Newest Symbols |");
    lines.push("|---|---:|---:|---:|---:|---|---|");
    for (const period of row.curve.slice(-6)) {
      lines.push(`| ${period.asOf} | ${period.uniqueHeldCount} | ${formatPct(period.netReturn)} | ${formatPct(period.qqqReturn)} | ${formatNumber(period.equity, 2)} | ${period.newestGroups.join(", ")} | ${period.newestSymbols.join(", ")} |`);
    }
    lines.push("");
  }
  lines.push("## Notes");
  lines.push("");
  lines.push("- This models the account as monthly sleeves. Each month adds a new sleeve and each sleeve is held for six months.");
  lines.push("- Buy 3/month means up to about 18 positions, while buy 5/month means up to about 30 positions.");
  lines.push("- Cohorts are equally weighted. Within each monthly cohort, selected symbols are equally weighted.");
  lines.push("- This still ignores taxes, FX, intraday execution quality, stop execution, and survivorship bias in the source universe.");
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const data = JSON.parse(await fs.readFile(inputPath, "utf8"));
  const symbols = uniqueSymbols(data);
  console.log(sample ? "Running sleeve-size test with sample data." : "Running sleeve-size test with live data.");
  console.log(`Symbols needed: ${symbols.length}`);
  const { priceMap, errors } = await collectPrices(symbols);
  const strategies = data.splits?.all?.results ?? [];
  const results = strategies.flatMap((strategy) => monthlyBuyCounts.map((count) => simulateSleeve(priceMap, strategy, count)));
  const result = {
    generatedAt: new Date().toISOString(),
    sourceGeneratedAt: data.generatedAt,
    mode: sample ? "sample" : "live",
    costBps,
    holdMonths,
    monthlyBuyCounts,
    symbolCount: symbols.length,
    priceSeriesCount: priceMap.size,
    errors,
    bestByStrategy: bestByStrategy(results),
    rankedResults: rankResults(results),
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
