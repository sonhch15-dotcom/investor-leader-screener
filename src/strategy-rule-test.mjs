import fs from "node:fs/promises";
import path from "node:path";
import { mean, round } from "./math.mjs";

const inputPath = path.join("data", "monthly-selection-test.json");
const outputJsonPath = path.join("data", "strategy-rule-test.json");
const outputMdPath = "strategy_rule_test.md";

const horizons = ["1m", "3m", "6m", "12m"];
const aiHardwareSymbols = new Set([
  "NVDA", "AMD", "AVGO", "ARM", "MU", "ASML", "TSM", "SMH", "SOXX",
  "WDC", "STX", "DELL", "HPE", "ANET", "VRT", "SMCI", "MRVL", "LRCX",
  "KLAC", "AMAT", "TER", "MPWR", "ON", "QCOM", "INTC"
]);
const aiHardwareSectors = new Set([
  "Semiconductors",
  "Electronic Components",
  "Computer Peripheral Equipment",
  "Computer Communications Equipment"
]);
const weakSectors = new Set([
  "Energy",
  "Real Estate",
  "Health Care",
  "Materials",
  "Consumer Staples"
]);
const leadershipSectors = new Set([
  "Semiconductors",
  "Electronic Components",
  "Software",
  "Financials",
  "Industrials",
  "Consumer Discretionary"
]);

function isAiHardware(row) {
  return aiHardwareSymbols.has(row.symbol) || aiHardwareSectors.has(row.sector);
}

function clean(values) {
  return values.filter(Number.isFinite);
}

function median(values) {
  const rows = clean(values).sort((a, b) => a - b);
  if (!rows.length) return null;
  const middle = Math.floor(rows.length / 2);
  if (rows.length % 2) return rows[middle];
  return (rows[middle - 1] + rows[middle]) / 2;
}

function ratio(values, predicate) {
  const rows = clean(values);
  if (!rows.length) return null;
  return rows.filter(predicate).length / rows.length;
}

function avg(values) {
  return round(mean(clean(values)), 4);
}

function pct(value) {
  if (!Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(1)}%`;
}

function top(rows, count) {
  return rows.slice(0, count);
}

function withHistory(periods) {
  const seen = new Map();
  return periods.map((period, periodIndex) => {
    const rows = period.selections.map((row, rankIndex) => {
      const history = seen.get(row.symbol) ?? [];
      const previous12 = history.filter((item) => periodIndex - item.periodIndex <= 12).length;
      const previous6 = history.filter((item) => periodIndex - item.periodIndex <= 6).length;
      return {
        ...row,
        rank: rankIndex + 1,
        periodIndex,
        asOf: period.asOf,
        previousTop20Count12m: previous12,
        previousTop20Count6m: previous6,
        isAiHardware: isAiHardware(row)
      };
    });
    for (const row of rows) {
      const history = seen.get(row.symbol) ?? [];
      history.push({ periodIndex, asOf: period.asOf });
      seen.set(row.symbol, history);
    }
    return { ...period, rows };
  });
}

const strategies = [
  {
    key: "baseline_top10",
    label: "Baseline Top10",
    select: (rows) => top(rows, 10)
  },
  {
    key: "baseline_top20",
    label: "Baseline Top20",
    select: (rows) => top(rows, 20)
  },
  {
    key: "watch_top10",
    label: "Watch Top10",
    select: (rows) => top(rows.filter((row) => row.status === "watch"), 10)
  },
  {
    key: "score_75_79_top10",
    label: "Score 75-79 Top10",
    select: (rows) => top(rows.filter((row) => row.score >= 75 && row.score < 80), 10)
  },
  {
    key: "no_buyable_top10",
    label: "Exclude Buyable Top10",
    select: (rows) => top(rows.filter((row) => row.status !== "buyable"), 10)
  },
  {
    key: "avoid_weak_sectors_top10",
    label: "Avoid Weak Sectors Top10",
    select: (rows) => top(rows.filter((row) => !weakSectors.has(row.sector)), 10)
  },
  {
    key: "ai_hardware_top10",
    label: "AI/Semi Hardware Top10",
    select: (rows) => top(rows.filter((row) => row.isAiHardware), 10)
  },
  {
    key: "repeat_1plus_top10",
    label: "Repeated Once Top10",
    select: (rows) => top(rows.filter((row) => row.previousTop20Count12m >= 1), 10)
  },
  {
    key: "repeat_2plus_top10",
    label: "Repeated Twice Top10",
    select: (rows) => top(rows.filter((row) => row.previousTop20Count12m >= 2), 10)
  },
  {
    key: "candidate_balanced_top10",
    label: "Candidate Balanced Top10",
    select: (rows) => top(rows.filter((row) => {
      if (row.status === "buyable") return false;
      if (weakSectors.has(row.sector)) return false;
      if (row.score < 75 || row.score >= 85) return false;
      return row.isAiHardware || row.previousTop20Count12m >= 1 || leadershipSectors.has(row.sector);
    }), 10)
  }
];

function summarizePortfolio(periods, strategy, periodFilter = () => true) {
  const periodRows = [];
  for (const period of periods.filter(periodFilter)) {
    const selected = strategy.select(period.rows);
    const result = {
      asOf: period.asOf,
      selectedCount: selected.length,
      symbols: selected.map((row) => row.symbol)
    };
    for (const horizon of horizons) {
      const returns = selected.map((row) => row.returns?.[horizon]).filter(Number.isFinite);
      result[horizon] = {
        portfolioReturn: avg(returns),
        spyReturn: period.benchmarks?.SPY?.[horizon],
        qqqReturn: period.benchmarks?.QQQ?.[horizon]
      };
      result[horizon].excessSpy = round(result[horizon].portfolioReturn - result[horizon].spyReturn, 4);
      result[horizon].excessQqq = round(result[horizon].portfolioReturn - result[horizon].qqqReturn, 4);
    }
    periodRows.push(result);
  }
  return {
    key: strategy.key,
    label: strategy.label,
    periods: periodRows.length,
    activePeriods: periodRows.filter((row) => row.selectedCount > 0).length,
    emptyPeriods: periodRows.filter((row) => row.selectedCount === 0).length,
    averageSelectedCount: avg(periodRows.map((row) => row.selectedCount)),
    horizons: Object.fromEntries(horizons.map((horizon) => {
      const rows = periodRows.filter((row) => Number.isFinite(row[horizon].portfolioReturn));
      const returns = rows.map((row) => row[horizon].portfolioReturn);
      const excessSpy = rows.map((row) => row[horizon].excessSpy);
      const excessQqq = rows.map((row) => row[horizon].excessQqq);
      return [horizon, {
        periods: rows.length,
        averageReturn: avg(returns),
        medianReturn: round(median(returns), 4),
        positiveRate: round(ratio(returns, (value) => value > 0), 4),
        beatSpyRate: round(ratio(excessSpy, (value) => value > 0), 4),
        beatQqqRate: round(ratio(excessQqq, (value) => value > 0), 4),
        averageExcessSpy: avg(excessSpy),
        averageExcessQqq: avg(excessQqq)
      }];
    })),
    periodsDetail: periodRows
  };
}

function summarizeAll(data) {
  const periods = withHistory(data.periods ?? []);
  const splitIndex = Math.floor(periods.length / 2);
  const splits = [
    { key: "all", label: "All", filter: () => true },
    { key: "early", label: "Early Half", filter: (_, index) => index < splitIndex },
    { key: "late", label: "Late Half", filter: (_, index) => index >= splitIndex },
    { key: "recent12", label: "Recent 12", filter: (_, index) => index >= periods.length - 12 }
  ];
  return {
    generatedAt: new Date().toISOString(),
    sourceGeneratedAt: data.generatedAt,
    periodCount: periods.length,
    strategyDefinitions: strategies.map((strategy) => ({
      key: strategy.key,
      label: strategy.label
    })),
    splits: Object.fromEntries(splits.map((split) => [
      split.key,
      {
        label: split.label,
        results: strategies.map((strategy) => summarizePortfolio(
          periods,
          strategy,
          (period, index) => split.filter(period, index)
        ))
      }
    ]))
  };
}

function summaryTableRows(results, horizon) {
  return results
    .map((row) => ({
      key: row.key,
      label: row.label,
      activePeriods: row.activePeriods,
      emptyPeriods: row.emptyPeriods,
      averageSelectedCount: row.averageSelectedCount,
      ...row.horizons[horizon]
    }))
    .sort((a, b) => b.averageExcessQqq - a.averageExcessQqq);
}

function table(lines, rows) {
  lines.push("| Strategy | Active | Empty | Avg Names | Avg | Median | Positive | Beat SPY | Beat QQQ | Avg QQQ Excess |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const row of rows) {
    lines.push(`| ${row.label} | ${row.activePeriods} | ${row.emptyPeriods} | ${row.averageSelectedCount?.toFixed(1) ?? "-"} | ${pct(row.averageReturn)} | ${pct(row.medianReturn)} | ${pct(row.positiveRate)} | ${pct(row.beatSpyRate)} | ${pct(row.beatQqqRate)} | ${pct(row.averageExcessQqq)} |`);
  }
}

function markdown(result) {
  const lines = [];
  lines.push("# Strategy Rule Test");
  lines.push("");
  lines.push(`Generated at: ${result.generatedAt}`);
  lines.push(`Source data generated at: ${result.sourceGeneratedAt}`);
  lines.push(`Periods: ${result.periodCount}`);
  lines.push("");
  lines.push("## All Periods, 12M");
  lines.push("");
  table(lines, summaryTableRows(result.splits.all.results, "12m"));
  lines.push("");
  lines.push("## Late Half, 12M");
  lines.push("");
  table(lines, summaryTableRows(result.splits.late.results, "12m"));
  lines.push("");
  lines.push("## All Periods, 3M");
  lines.push("");
  table(lines, summaryTableRows(result.splits.all.results, "3m"));
  lines.push("");
  lines.push("## Recent 12 Periods, 3M");
  lines.push("");
  table(lines, summaryTableRows(result.splits.recent12.results, "3m"));
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("- Rules are tested on monthly Top20 selections, equal-weighted within each selected basket.");
  lines.push("- Empty periods mean the rule found no candidate that month.");
  lines.push("- Late half and recent 12 periods are used as a rough stability check, not a pure out-of-sample test.");
  lines.push("- The result still ignores taxes, fees, slippage, position sizing, stops, and 1H/4H timing.");
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const data = JSON.parse(await fs.readFile(inputPath, "utf8"));
  const result = summarizeAll(data);
  await fs.mkdir("data", { recursive: true });
  await fs.writeFile(outputJsonPath, JSON.stringify(result, null, 2), "utf8");
  await fs.writeFile(outputMdPath, markdown(result), "utf8");
  console.log(`Wrote ${outputJsonPath} and ${outputMdPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
