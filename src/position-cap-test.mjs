import fs from "node:fs/promises";
import path from "node:path";
import { fetchChart, syntheticChart } from "./yahoo.mjs";
import { mean, round } from "./math.mjs";

const inputPath = path.join("data", "full-candidate-diversification-test.json");
const outputJsonPath = path.join("data", "position-cap-test.json");
const outputMdPath = "position_cap_test.md";
const sample = process.argv.includes("--sample");
const costBps = Number(valueAfter("--cost-bps") ?? 10);
const holdMonths = Number(valueAfter("--hold-months") ?? 6);
const positionCaps = [10, 20, 30, 40, 60];

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

function activeCandidates(periods, index) {
  const candidates = [];
  const seen = new Set();
  for (let offset = 0; offset < holdMonths; offset += 1) {
    const cohortIndex = index - offset;
    if (cohortIndex < 0) continue;
    const period = periods[cohortIndex];
    for (const [rank, symbol] of (period.symbols ?? []).entries()) {
      if (seen.has(symbol)) continue;
      seen.add(symbol);
      candidates.push({
        symbol,
        rank: rank + 1,
        cohortIndex,
        ageMonths: offset,
        asOf: period.asOf,
        groups: period.selectedGroups ?? []
      });
    }
  }
  return candidates.sort((a, b) => b.cohortIndex - a.cohortIndex || a.rank - b.rank || a.symbol.localeCompare(b.symbol));
}

function weights(symbols) {
  if (!symbols.length) return new Map();
  const weight = 1 / symbols.length;
  return new Map(symbols.map((symbol) => [symbol, weight]));
}

function turnover(previousWeights, nextWeights) {
  const symbols = new Set([...previousWeights.keys(), ...nextWeights.keys()]);
  let traded = 0;
  for (const symbol of symbols) traded += Math.abs((nextWeights.get(symbol) ?? 0) - (previousWeights.get(symbol) ?? 0));
  return round(traded, 4);
}

function simulateCap(priceMap, strategy, cap) {
  let equity = 1;
  let spyEquity = 1;
  let qqqEquity = 1;
  let previousWeights = new Map();
  const curve = [];
  const monthlyReturns = [];
  const turnovers = [];
  const allPeriods = strategy.periodsDetail ?? [];

  for (let index = 0; index < allPeriods.length - 1; index += 1) {
    const current = allPeriods[index];
    const next = allPeriods[index + 1];
    if (!current.entryDate || !next.entryDate) continue;

    const selected = activeCandidates(allPeriods, index).slice(0, cap);
    const symbols = selected.map((row) => row.symbol);
    if (!symbols.length) continue;

    const returns = symbols
      .map((symbol) => periodReturn(priceMap, symbol, current.entryDate, next.entryDate))
      .filter(Number.isFinite);
    const grossReturn = mean(returns);
    const spyReturn = periodReturn(priceMap, "SPY", current.entryDate, next.entryDate);
    const qqqReturn = periodReturn(priceMap, "QQQ", current.entryDate, next.entryDate);
    if (!Number.isFinite(grossReturn) || !Number.isFinite(spyReturn) || !Number.isFinite(qqqReturn)) continue;

    const nextWeights = weights(symbols);
    const periodTurnover = turnover(previousWeights, nextWeights);
    const transactionCost = periodTurnover * costBps / 10_000;
    const netReturn = grossReturn - transactionCost;

    equity *= 1 + netReturn;
    spyEquity *= 1 + spyReturn;
    qqqEquity *= 1 + qqqReturn;
    monthlyReturns.push(netReturn);
    turnovers.push(periodTurnover);
    curve.push({
      asOf: current.asOf,
      entryDate: current.entryDate,
      exitDate: next.entryDate,
      selectedCount: symbols.length,
      candidateCount: activeCandidates(allPeriods, index).length,
      symbols,
      averageAgeMonths: avg(selected.map((row) => row.ageMonths)),
      newestGroups: current.selectedGroups ?? [],
      grossReturn: round(grossReturn, 4),
      transactionCost: round(transactionCost, 4),
      netReturn: round(netReturn, 4),
      spyReturn: round(spyReturn, 4),
      qqqReturn: round(qqqReturn, 4),
      excessQqq: round(netReturn - qqqReturn, 4),
      turnover: periodTurnover,
      equity: round(equity, 4),
      spyEquity: round(spyEquity, 4),
      qqqEquity: round(qqqEquity, 4)
    });
    previousWeights = nextWeights;
  }

  const totalReturn = equity - 1;
  const qqqTotalReturn = qqqEquity - 1;
  const drawdown = maxDrawdown(curve);
  const cagr = annualizedReturn(totalReturn, curve.length);
  return {
    strategyKey: strategy.key,
    strategyLabel: strategy.label,
    holdMonths,
    maxPositions: cap,
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
    averageSelectedCount: avg(curve.map((row) => row.selectedCount)),
    averageCandidateCount: avg(curve.map((row) => row.candidateCount)),
    averageTurnover: avg(turnovers),
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

function formatNumber(value, digits = 2) {
  if (!Number.isFinite(value)) return "-";
  return value.toFixed(digits);
}

function table(lines, rows) {
  lines.push("| Strategy | Max Pos | Months | Total | CAGR | QQQ Total | Excess QQQ | MDD | Avg Month | Positive | Beat QQQ | Avg Held | Avg Candidates | Turnover | Cost |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const row of rows) {
    lines.push(`| ${row.strategyLabel} | ${row.maxPositions} | ${row.months} | ${formatPct(row.totalReturn)} | ${formatPct(row.cagr)} | ${formatPct(row.qqqTotalReturn)} | ${formatPct(row.excessQqqTotal)} | ${formatPct(row.maxDrawdown)} | ${formatPct(row.averageMonthlyReturn)} | ${formatPct(row.positiveMonthRate)} | ${formatPct(row.beatQqqMonthRate)} | ${formatNumber(row.averageSelectedCount, 1)} | ${formatNumber(row.averageCandidateCount, 1)} | ${formatNumber(row.averageTurnover, 2)} | ${formatPct(row.totalTransactionCost)} |`);
  }
}

function markdown(result) {
  const lines = [];
  lines.push("# Position Cap Test");
  lines.push("");
  lines.push(`Generated at: ${result.generatedAt}`);
  lines.push(`Source generated at: ${result.sourceGeneratedAt}`);
  lines.push(`Mode: ${result.mode}`);
  lines.push(`Holding window: ${result.holdMonths} months`);
  lines.push(`Transaction cost: ${result.costBps} bps per turnover unit`);
  lines.push("");
  lines.push("## Best Position Cap By Strategy");
  lines.push("");
  table(lines, result.bestByStrategy);
  lines.push("");
  lines.push("## Main Strategy Position Cap Comparison");
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
    .sort((a, b) => a.maxPositions - b.maxPositions)) {
    lines.push(`### Max ${row.maxPositions}`);
    lines.push("");
    lines.push("| As Of | Held | Candidates | Net | QQQ | Equity | Newest Groups | First 8 Symbols |");
    lines.push("|---|---:|---:|---:|---:|---:|---|---|");
    for (const period of row.curve.slice(-6)) {
      lines.push(`| ${period.asOf} | ${period.selectedCount} | ${period.candidateCount} | ${formatPct(period.netReturn)} | ${formatPct(period.qqqReturn)} | ${formatNumber(period.equity)} | ${period.newestGroups.join(", ")} | ${period.symbols.slice(0, 8).join(", ")} |`);
    }
    lines.push("");
  }
  lines.push("## Notes");
  lines.push("");
  lines.push("- The 6-month overlap window combines the current monthly basket and the prior five monthly baskets.");
  lines.push("- Duplicate symbols are held once, with the most recent signal taking priority.");
  lines.push("- When candidates exceed the cap, newer monthly signals are kept before older signals.");
  lines.push("- This still ignores taxes, FX, intraday execution quality, stop execution, and survivorship bias in the source universe.");
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const data = JSON.parse(await fs.readFile(inputPath, "utf8"));
  const symbols = uniqueSymbols(data);
  console.log(sample ? "Running position-cap test with sample data." : "Running position-cap test with live data.");
  console.log(`Symbols needed: ${symbols.length}`);
  const { priceMap, errors } = await collectPrices(symbols);
  const strategies = data.splits?.all?.results ?? [];
  const results = strategies.flatMap((strategy) => positionCaps.map((cap) => simulateCap(priceMap, strategy, cap)));
  const result = {
    generatedAt: new Date().toISOString(),
    sourceGeneratedAt: data.generatedAt,
    mode: sample ? "sample" : "live",
    costBps,
    holdMonths,
    positionCaps,
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
