import fs from "node:fs/promises";
import path from "node:path";
import { mean, round } from "./math.mjs";

const inputPath = path.join("data", "full-candidate-diversification-test.json");
const outputJsonPath = path.join("data", "portfolio-simulation-test.json");
const outputMdPath = "portfolio_simulation_test.md";
const costBps = Number(valueAfter("--cost-bps") ?? 10);

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

function maxDrawdown(equityCurve) {
  let peak = 1;
  let worst = 0;
  for (const row of equityCurve) {
    peak = Math.max(peak, row.equity);
    const drawdown = row.equity / peak - 1;
    worst = Math.min(worst, drawdown);
  }
  return round(worst, 4);
}

function weights(symbols) {
  if (!symbols.length) return new Map();
  const weight = 1 / symbols.length;
  return new Map(symbols.map((symbol) => [symbol, weight]));
}

function turnover(previousWeights, nextWeights) {
  const symbols = new Set([...previousWeights.keys(), ...nextWeights.keys()]);
  let traded = 0;
  for (const symbol of symbols) {
    traded += Math.abs((nextWeights.get(symbol) ?? 0) - (previousWeights.get(symbol) ?? 0));
  }
  return round(traded, 4);
}

function simulateStrategy(strategy) {
  let equity = 1;
  let spyEquity = 1;
  let qqqEquity = 1;
  let previousWeights = new Map();
  const curve = [];
  const monthlyReturns = [];
  const spyReturns = [];
  const qqqReturns = [];
  const turnovers = [];

  for (const period of strategy.periodsDetail) {
    const grossReturn = period["1m"]?.portfolioReturn;
    const spyReturn = period["1m"]?.spyReturn;
    const qqqReturn = period["1m"]?.qqqReturn;
    if (!Number.isFinite(grossReturn) || !Number.isFinite(spyReturn) || !Number.isFinite(qqqReturn)) continue;

    const nextWeights = weights(period.symbols ?? []);
    const periodTurnover = turnover(previousWeights, nextWeights);
    const cost = periodTurnover * costBps / 10_000;
    const netReturn = grossReturn - cost;

    equity *= 1 + netReturn;
    spyEquity *= 1 + spyReturn;
    qqqEquity *= 1 + qqqReturn;
    monthlyReturns.push(netReturn);
    spyReturns.push(spyReturn);
    qqqReturns.push(qqqReturn);
    turnovers.push(periodTurnover);
    curve.push({
      asOf: period.asOf,
      entryDate: period.entryDate,
      symbols: period.symbols,
      selectedGroups: period.selectedGroups,
      grossReturn,
      transactionCost: round(cost, 4),
      netReturn: round(netReturn, 4),
      spyReturn,
      qqqReturn,
      excessSpy: round(netReturn - spyReturn, 4),
      excessQqq: round(netReturn - qqqReturn, 4),
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
  const vol = annualizedVolatility(monthlyReturns);
  const cagr = annualizedReturn(totalReturn, curve.length);
  return {
    key: strategy.key,
    label: strategy.label,
    months: curve.length,
    totalReturn: round(totalReturn, 4),
    spyTotalReturn: round(spyTotalReturn, 4),
    qqqTotalReturn: round(qqqTotalReturn, 4),
    excessSpyTotal: round(totalReturn - spyTotalReturn, 4),
    excessQqqTotal: round(totalReturn - qqqTotalReturn, 4),
    cagr: round(cagr, 4),
    spyCagr: round(annualizedReturn(spyTotalReturn, curve.length), 4),
    qqqCagr: round(annualizedReturn(qqqTotalReturn, curve.length), 4),
    averageMonthlyReturn: avg(monthlyReturns),
    medianMonthlyReturn: round(median(monthlyReturns), 4),
    positiveMonthRate: round(ratio(monthlyReturns, (value) => value > 0), 4),
    beatSpyMonthRate: round(ratio(curve.map((row) => row.excessSpy), (value) => value > 0), 4),
    beatQqqMonthRate: round(ratio(curve.map((row) => row.excessQqq), (value) => value > 0), 4),
    maxDrawdown: maxDrawdown(curve),
    annualizedVolatility: round(vol, 4),
    returnToDrawdown: round(Number.isFinite(cagr) && maxDrawdown(curve) < 0 ? cagr / Math.abs(maxDrawdown(curve)) : null, 2),
    averageTurnover: avg(turnovers),
    totalTransactionCost: round(curve.reduce((sum, row) => sum + row.transactionCost, 0), 4),
    curve
  };
}

function rankResults(results) {
  return [...results].sort((a, b) => (
    b.excessQqqTotal - a.excessQqqTotal
    || b.cagr - a.cagr
    || b.returnToDrawdown - a.returnToDrawdown
  ));
}

function formatPct(value) {
  if (!Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(1)}%`;
}

function formatNumber(value, digits = 2) {
  if (!Number.isFinite(value)) return "-";
  return value.toFixed(digits);
}

function markdown(result) {
  const lines = [];
  lines.push("# Portfolio Simulation Test");
  lines.push("");
  lines.push(`Generated at: ${result.generatedAt}`);
  lines.push(`Source generated at: ${result.sourceGeneratedAt}`);
  lines.push(`Transaction cost: ${result.costBps} bps per turnover unit`);
  lines.push(`Method: monthly rebalance, equal-weight basket, 1-month holding return`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| Strategy | Months | Total | CAGR | QQQ Total | Excess QQQ | MDD | Avg Month | Positive | Beat QQQ | Avg Turnover | Cost |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const row of result.rankedResults) {
    lines.push(`| ${row.label} | ${row.months} | ${formatPct(row.totalReturn)} | ${formatPct(row.cagr)} | ${formatPct(row.qqqTotalReturn)} | ${formatPct(row.excessQqqTotal)} | ${formatPct(row.maxDrawdown)} | ${formatPct(row.averageMonthlyReturn)} | ${formatPct(row.positiveMonthRate)} | ${formatPct(row.beatQqqMonthRate)} | ${formatNumber(row.averageTurnover)} | ${formatPct(row.totalTransactionCost)} |`);
  }
  lines.push("");
  lines.push("## Recent Months");
  lines.push("");
  for (const strategy of result.rankedResults.slice(0, 3)) {
    lines.push(`### ${strategy.label}`);
    lines.push("");
    lines.push("| As Of | Net | QQQ | Equity | Symbols | Groups |");
    lines.push("|---|---:|---:|---:|---|---|");
    for (const row of strategy.curve.slice(-6)) {
      lines.push(`| ${row.asOf} | ${formatPct(row.netReturn)} | ${formatPct(row.qqqReturn)} | ${formatNumber(row.equity)} | ${row.symbols.join(", ")} | ${row.selectedGroups.join(", ")} |`);
    }
    lines.push("");
  }
  lines.push("## Notes");
  lines.push("");
  lines.push("- This is closer to a real portfolio than average forward-return tests because it compounds monthly returns.");
  lines.push("- It still does not include stop-loss execution, intramonth timing, taxes, FX, or real fills.");
  lines.push("- Current index membership is used in the source test, so survivorship bias remains.");
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const data = JSON.parse(await fs.readFile(inputPath, "utf8"));
  const strategies = data.splits?.all?.results ?? [];
  const results = strategies.map(simulateStrategy);
  const rankedResults = rankResults(results);
  const result = {
    generatedAt: new Date().toISOString(),
    sourceGeneratedAt: data.generatedAt,
    costBps,
    method: {
      source: inputPath,
      rebalance: "monthly",
      holdingPeriod: "1m",
      weighting: "equal weight",
      transactionCost: `${costBps} bps per turnover unit`
    },
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
