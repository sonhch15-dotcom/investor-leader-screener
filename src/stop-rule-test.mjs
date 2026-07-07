import fs from "node:fs/promises";
import path from "node:path";
import { fetchChart, syntheticChart } from "./yahoo.mjs";
import { mean, round } from "./math.mjs";

const inputPath = path.join("data", "full-candidate-diversification-test.json");
const outputJsonPath = path.join("data", "stop-rule-test.json");
const outputMdPath = "stop_rule_test.md";
const sample = process.argv.includes("--sample");
const costBps = Number(valueAfter("--cost-bps") ?? 10);

const rules = [
  { key: "no_stop", label: "No Stop" },
  { key: "fixed_7", label: "Fixed -7%", initialStopPct: 0.07 },
  { key: "fixed_10", label: "Fixed -10%", initialStopPct: 0.10 },
  { key: "fixed_12", label: "Fixed -12%", initialStopPct: 0.12 },
  { key: "trail_15_10", label: "Trail +15%/-10%", activationPct: 0.15, trailPct: 0.10 },
  { key: "fixed10_trail20_10", label: "Fixed -10% + Trail +20%/-10%", initialStopPct: 0.10, activationPct: 0.20, trailPct: 0.10 }
];

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

function rowsBetween(rows, startDate, endDate) {
  return rows.filter((row) => row.date > startDate && row.date <= endDate && Number.isFinite(row.close));
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

function benchmarkReturn(priceMap, symbol, entryDate, exitDate) {
  const rows = priceMap.get(symbol) ?? [];
  const entry = rowOnOrAfter(rows, entryDate);
  const exit = rowOnOrAfter(rows, exitDate);
  if (!entry || !exit || entry.close === 0) return null;
  return exit.close / entry.close - 1;
}

function simulatePosition(priceMap, symbol, entryDate, exitDate, rule) {
  const rows = priceMap.get(symbol) ?? [];
  const entry = rowOnOrAfter(rows, entryDate);
  const scheduledExit = rowOnOrAfter(rows, exitDate);
  if (!entry || !scheduledExit || entry.close === 0) return null;

  const monthRows = rowsBetween(rows, entry.date, scheduledExit.date);
  let highest = entry.close;
  let stopPrice = Number.isFinite(rule.initialStopPct) ? entry.close * (1 - rule.initialStopPct) : null;

  for (const row of monthRows) {
    highest = Math.max(highest, row.high ?? row.close);
    if (Number.isFinite(rule.activationPct) && highest >= entry.close * (1 + rule.activationPct)) {
      const trailingStop = highest * (1 - rule.trailPct);
      stopPrice = Math.max(stopPrice ?? 0, trailingStop);
    }
    const low = row.low ?? row.close;
    if (Number.isFinite(stopPrice) && low <= stopPrice) {
      const open = row.open ?? row.close;
      const exitPrice = open < stopPrice ? open : stopPrice;
      return {
        symbol,
        entryDate: entry.date,
        exitDate: row.date,
        entryPrice: round(entry.close, 2),
        exitPrice: round(exitPrice, 2),
        return: round(exitPrice / entry.close - 1, 4),
        stopped: true
      };
    }
  }

  return {
    symbol,
    entryDate: entry.date,
    exitDate: scheduledExit.date,
    entryPrice: round(entry.close, 2),
    exitPrice: round(scheduledExit.close, 2),
    return: round(scheduledExit.close / entry.close - 1, 4),
    stopped: false
  };
}

function simulateStrategy(priceMap, strategy, rule) {
  let equity = 1;
  let spyEquity = 1;
  let qqqEquity = 1;
  let previousWeights = new Map();
  const curve = [];
  const monthlyReturns = [];
  const turnovers = [];
  let stoppedPositions = 0;
  let evaluatedPositions = 0;

  for (let index = 0; index < strategy.periodsDetail.length - 1; index += 1) {
    const period = strategy.periodsDetail[index];
    const nextPeriod = strategy.periodsDetail[index + 1];
    const entryDate = period.entryDate;
    const exitDate = nextPeriod.entryDate;
    if (!entryDate || !exitDate) continue;

    const positions = (period.symbols ?? [])
      .map((symbol) => simulatePosition(priceMap, symbol, entryDate, exitDate, rule))
      .filter(Boolean);
    if (!positions.length) continue;

    const nextWeights = weights(positions.map((position) => position.symbol));
    const periodTurnover = turnover(previousWeights, nextWeights);
    const transactionCost = periodTurnover * costBps / 10_000;
    const grossReturn = mean(positions.map((position) => position.return));
    const netReturn = grossReturn - transactionCost;
    const spyReturn = benchmarkReturn(priceMap, "SPY", entryDate, exitDate);
    const qqqReturn = benchmarkReturn(priceMap, "QQQ", entryDate, exitDate);
    if (!Number.isFinite(netReturn) || !Number.isFinite(spyReturn) || !Number.isFinite(qqqReturn)) continue;

    stoppedPositions += positions.filter((position) => position.stopped).length;
    evaluatedPositions += positions.length;
    equity *= 1 + netReturn;
    spyEquity *= 1 + spyReturn;
    qqqEquity *= 1 + qqqReturn;
    monthlyReturns.push(netReturn);
    turnovers.push(periodTurnover);
    curve.push({
      asOf: period.asOf,
      entryDate,
      exitDate,
      symbols: positions.map((position) => position.symbol),
      selectedGroups: period.selectedGroups ?? [],
      grossReturn: round(grossReturn, 4),
      transactionCost: round(transactionCost, 4),
      netReturn: round(netReturn, 4),
      spyReturn: round(spyReturn, 4),
      qqqReturn: round(qqqReturn, 4),
      excessSpy: round(netReturn - spyReturn, 4),
      excessQqq: round(netReturn - qqqReturn, 4),
      stoppedCount: positions.filter((position) => position.stopped).length,
      turnover: periodTurnover,
      equity: round(equity, 4),
      spyEquity: round(spyEquity, 4),
      qqqEquity: round(qqqEquity, 4)
    });
    previousWeights = nextWeights;
  }

  const totalReturn = equity - 1;
  const spyTotalReturn = spyEquity - 1;
  const qqqTotalReturn = qqqEquity - 1;
  const cagr = annualizedReturn(totalReturn, curve.length);
  const drawdown = maxDrawdown(curve);
  return {
    strategyKey: strategy.key,
    strategyLabel: strategy.label,
    ruleKey: rule.key,
    ruleLabel: rule.label,
    months: curve.length,
    totalReturn: round(totalReturn, 4),
    spyTotalReturn: round(spyTotalReturn, 4),
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
    averageTurnover: avg(turnovers),
    totalTransactionCost: round(curve.reduce((sum, row) => sum + row.transactionCost, 0), 4),
    stopHitRate: round(stoppedPositions / evaluatedPositions, 4),
    curve
  };
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
  lines.push("| Strategy | Rule | Months | Total | CAGR | QQQ Total | Excess QQQ | MDD | Avg Month | Positive | Beat QQQ | Stop Hit |");
  lines.push("|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const row of rows) {
    lines.push(`| ${row.strategyLabel} | ${row.ruleLabel} | ${row.months} | ${formatPct(row.totalReturn)} | ${formatPct(row.cagr)} | ${formatPct(row.qqqTotalReturn)} | ${formatPct(row.excessQqqTotal)} | ${formatPct(row.maxDrawdown)} | ${formatPct(row.averageMonthlyReturn)} | ${formatPct(row.positiveMonthRate)} | ${formatPct(row.beatQqqMonthRate)} | ${formatPct(row.stopHitRate)} |`);
  }
}

function markdown(result) {
  const lines = [];
  lines.push("# Stop Rule Test");
  lines.push("");
  lines.push(`Generated at: ${result.generatedAt}`);
  lines.push(`Source generated at: ${result.sourceGeneratedAt}`);
  lines.push(`Mode: ${result.mode}`);
  lines.push(`Transaction cost: ${result.costBps} bps per turnover unit`);
  lines.push("");
  lines.push("## Best Rule By Strategy");
  lines.push("");
  table(lines, result.bestByStrategy);
  lines.push("");
  lines.push("## Main Strategy Rule Comparison");
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
    .filter((item) => item.strategyKey === "leader_top5_cap2_top10" && ["no_stop", "fixed_10", "fixed10_trail20_10"].includes(item.ruleKey))
    .sort((a, b) => a.ruleKey.localeCompare(b.ruleKey))) {
    lines.push(`### ${row.ruleLabel}`);
    lines.push("");
    lines.push("| As Of | Net | QQQ | Stopped | Equity | Groups |");
    lines.push("|---|---:|---:|---:|---:|---|");
    for (const period of row.curve.slice(-6)) {
      lines.push(`| ${period.asOf} | ${formatPct(period.netReturn)} | ${formatPct(period.qqqReturn)} | ${period.stoppedCount} | ${formatNumber(period.equity)} | ${period.selectedGroups.join(", ")} |`);
    }
    lines.push("");
  }
  lines.push("## Notes");
  lines.push("");
  lines.push("- Stops are tested with daily OHLC data. If the open gaps below the stop, the open price is used.");
  lines.push("- Stopped positions stay in cash until the next monthly rebalance.");
  lines.push("- This still ignores taxes, FX, intraday execution quality, and survivorship bias in the source universe.");
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const data = JSON.parse(await fs.readFile(inputPath, "utf8"));
  const symbols = uniqueSymbols(data);
  console.log(sample ? "Running stop-rule test with sample data." : "Running stop-rule test with live data.");
  console.log(`Symbols needed: ${symbols.length}`);
  const { priceMap, errors } = await collectPrices(symbols);
  const strategies = data.splits?.all?.results ?? [];
  const results = strategies.flatMap((strategy) => rules.map((rule) => simulateStrategy(priceMap, strategy, rule)));
  const result = {
    generatedAt: new Date().toISOString(),
    sourceGeneratedAt: data.generatedAt,
    mode: sample ? "sample" : "live",
    costBps,
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
