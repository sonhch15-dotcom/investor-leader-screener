import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { evaluateTrade, weeklyRows } from "./backtest-execution-core.mjs";
import {
  buildPriceSnapshot,
  priceMapFromSnapshot,
  readPriceSnapshot,
  relativeSnapshotPath,
  writePriceSnapshot
} from "./backtest-price-snapshot.mjs";
import { fetchChart, syntheticChart } from "./yahoo.mjs";
import { mean, round } from "./math.mjs";

const sample = process.argv.includes("--sample");
const sourcePath = path.join("data", valueAfter("--source") ?? "monthly-buy-rule-test-5y.json");
const outputSuffix = safeSuffix(valueAfter("--output-suffix") ?? "");
const outputJsonPath = path.join("data", `scale-execution-test${outputSuffix}.json`);
const outputMdPath = `scale_execution_test${outputSuffix}.md`;
const snapshotInPath = valueAfter("--snapshot-in");
const snapshotOutPath = valueAfter("--snapshot-out")
  ?? path.join("data", `scale-execution-price-snapshot${outputSuffix}.json.gz`);
const strategyLabel = valueAfter("--strategy-label") ?? "Leader2 One Each";
const strategyKey = valueAfter("--strategy-key");
const fixedHoldMonths = 6;
const maxHoldMonths = 12;
const costBps = 10;

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

function monthKey(date) {
  return String(date ?? "").slice(0, 7);
}

function timelineDate(timeline, index, months) {
  return timeline[index + months]?.entryDate ?? null;
}

const executionRules = [
  {
    key: "lump_buy_lump_sell",
    label: "Lump Buy / Lump Sell",
    description: "기준선: 예정일에 전량 매수, 6개월 뒤 전량 매도",
    buyOffsets: [0],
    sellOffsets: [0],
    sellMode: "fixed"
  },
  {
    key: "split_buy_3_lump_sell",
    label: "3-Step Buy / Lump Sell",
    description: "매수는 0/5/10거래일 3회 분할, 매도는 6개월 뒤 전량",
    buyOffsets: [0, 5, 10],
    sellOffsets: [0],
    sellMode: "fixed"
  },
  {
    key: "lump_buy_split_sell_3",
    label: "Lump Buy / 3-Step Sell",
    description: "매수는 전량, 매도는 6개월 시점부터 0/5/10거래일 3회 분할",
    buyOffsets: [0],
    sellOffsets: [0, 5, 10],
    sellMode: "fixed"
  },
  {
    key: "split_buy_3_split_sell_3",
    label: "3-Step Buy / 3-Step Sell",
    description: "매수와 매도를 각각 0/5/10거래일 3회 분할",
    buyOffsets: [0, 5, 10],
    sellOffsets: [0, 5, 10],
    sellMode: "fixed"
  },
  {
    key: "half_sell_half_weekly_extend",
    label: "50% Sell / 50% Weekly Extend",
    description: "6개월 시점에 50% 매도, 나머지 50%는 주봉 10주선+RSI 규칙으로 최대 12개월 보유",
    buyOffsets: [0],
    sellMode: "half_weekly"
  }
];

async function fetchPrices(symbols) {
  const dailyMap = new Map();
  const weeklyMap = new Map();
  const errors = [];
  for (const [index, symbol] of symbols.entries()) {
    try {
      const daily = sample ? syntheticChart(symbol, 3000) : await fetchChart(symbol, { range: "10y" });
      dailyMap.set(symbol, daily);
      weeklyMap.set(symbol, weeklyRows(daily));
      if ((index + 1) % 25 === 0) console.log(`Fetched ${index + 1}/${symbols.length}`);
    } catch (error) {
      errors.push({ symbol, error: error.message });
      if (sample) {
        const daily = syntheticChart(symbol, 3000);
        dailyMap.set(symbol, daily);
        weeklyMap.set(symbol, weeklyRows(daily));
      }
    }
  }
  return { dailyMap, weeklyMap, errors };
}

function selectedTrades(strategy) {
  const timeline = strategy.selectionTimeline ?? [];
  const trades = [];
  for (let index = 0; index < timeline.length; index += 1) {
    const cohort = timeline[index];
    const fixedExitDate = timelineDate(timeline, index, fixedHoldMonths);
    const maxExitDate = timelineDate(timeline, index, maxHoldMonths);
    if (!cohort?.rows?.length || !cohort.entryDate) continue;
    for (const row of cohort.rows) {
      trades.push({
        cohortIndex: index,
        cohort: monthKey(cohort.asOf),
        entryDate: cohort.entryDate,
        fixedExitDate,
        maxExitDate,
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

function median(values) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return null;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
}

function reasonCounts(rows) {
  const counts = new Map();
  for (const row of rows) {
    for (const reason of row.sellReasons ?? []) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return Object.fromEntries(counts);
}

function summarize(rule, rows, baselineRows) {
  const entered = rows.filter((row) => row.entered);
  const closed = entered.filter((row) => row.closed);
  const baseline = new Map(baselineRows.filter((row) => row.closed).map((row) => [`${row.symbol}|${row.cohort}`, row]));
  const returns = closed.map((row) => row.return).filter(Number.isFinite);
  const qqqReturns = closed.map((row) => row.qqqReturn).filter(Number.isFinite);
  const improvements = closed
    .map((row) => {
      const base = baseline.get(`${row.symbol}|${row.cohort}`);
      return base ? row.return - base.return : null;
    })
    .filter(Number.isFinite);
  const robust = closed.filter((row) => Math.abs(row.return) < 3);
  const robustReturns = robust.map((row) => row.return).filter(Number.isFinite);
  const robustQqqReturns = robust.map((row) => row.qqqReturn).filter(Number.isFinite);
  const robustImprovements = robust
    .map((row) => {
      const base = baseline.get(`${row.symbol}|${row.cohort}`);
      return base ? row.return - base.return : null;
    })
    .filter(Number.isFinite);
  return {
    key: rule.key,
    label: rule.label,
    description: rule.description,
    trades: rows.length,
    enteredTrades: entered.length,
    skippedTrades: rows.length - entered.length,
    closedTrades: closed.length,
    openTrades: entered.length - closed.length,
    averageHoldDays: round(mean(closed.map((row) => row.holdDays)), 1),
    averageReturn: round(mean(returns), 4),
    medianReturn: round(median(returns), 4),
    winRate: round(returns.filter((value) => value > 0).length / Math.max(1, returns.length), 4),
    averageQqqReturn: round(mean(qqqReturns), 4),
    averageExcessQqq: round(mean(returns) - mean(qqqReturns), 4),
    averageImprovementVsBaseline: round(mean(improvements), 4),
    robust: {
      trades: robust.length,
      averageReturn: round(mean(robustReturns), 4),
      medianReturn: round(median(robustReturns), 4),
      winRate: round(robustReturns.filter((value) => value > 0).length / Math.max(1, robustReturns.length), 4),
      averageExcessQqq: round(mean(robustReturns) - mean(robustQqqReturns), 4),
      averageImprovementVsBaseline: round(mean(robustImprovements), 4)
    },
    sellReasons: reasonCounts(entered),
    bestTrade: [...closed].sort((a, b) => b.return - a.return)[0] ?? null,
    worstTrade: [...closed].sort((a, b) => a.return - b.return)[0] ?? null,
    recentTrades: entered.slice(-12)
  };
}

function formatPct(value) {
  if (!Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(1)}%`;
}

function formatNumber(value, digits = 1) {
  if (!Number.isFinite(value)) return "-";
  return value.toFixed(digits);
}

function markdown(result) {
  const lines = [];
  lines.push("# Scale Execution Test");
  lines.push("");
  lines.push(`Generated at: ${result.generatedAt}`);
  lines.push(`Source strategy: ${result.strategyLabel}`);
  lines.push(`Source file: ${result.sourcePath}`);
  lines.push(`Selected trades: ${result.selectedTradeCount}`);
  lines.push(`Price snapshot: ${result.priceSnapshotPath} (${result.priceSnapshotHash})`);
  lines.push(`Transaction cost: ${result.costBps} bps on each buy/sell cash flow`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| Rule | Entered | Closed | Open | Skipped | Avg Hold Days | Avg Return | Median | Win Rate | Avg QQQ | Excess QQQ | Improvement vs Baseline |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const row of result.summaries) {
    lines.push(`| ${row.label} | ${row.enteredTrades} | ${row.closedTrades} | ${row.openTrades} | ${row.skippedTrades} | ${formatNumber(row.averageHoldDays)} | ${formatPct(row.averageReturn)} | ${formatPct(row.medianReturn)} | ${formatPct(row.winRate)} | ${formatPct(row.averageQqqReturn)} | ${formatPct(row.averageExcessQqq)} | ${formatPct(row.averageImprovementVsBaseline)} |`);
  }
  lines.push("");
  lines.push("## Robust Check");
  lines.push("");
  lines.push("Extreme individual returns above +300% or below -300% are excluded here.");
  lines.push("");
  lines.push("| Rule | Trades | Avg Return | Median | Win Rate | Excess QQQ | Improvement vs Baseline |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|");
  for (const row of result.summaries) {
    lines.push(`| ${row.label} | ${row.robust.trades} | ${formatPct(row.robust.averageReturn)} | ${formatPct(row.robust.medianReturn)} | ${formatPct(row.robust.winRate)} | ${formatPct(row.robust.averageExcessQqq)} | ${formatPct(row.robust.averageImprovementVsBaseline)} |`);
  }
  lines.push("");
  lines.push("## Sell Reasons");
  lines.push("");
  lines.push("| Rule | Reasons |");
  lines.push("|---|---|");
  for (const row of result.summaries) {
    lines.push(`| ${row.label} | ${Object.entries(row.sellReasons).map(([key, value]) => `${key}: ${value}`).join(", ")} |`);
  }
  lines.push("");
  lines.push("## Recent Trades");
  for (const row of result.summaries) {
    lines.push("");
    lines.push(`### ${row.label}`);
    lines.push("");
    lines.push("| Cohort | Symbol | Buy Dates | Sell Dates | Avg Buy | Avg Sell | Return | QQQ |");
    lines.push("|---|---|---|---|---:|---:|---:|---:|");
    for (const trade of row.recentTrades) {
      lines.push(`| ${trade.cohort} | ${trade.symbol} | ${trade.buyDates.join(", ")} | ${trade.sellDates.join(", ")} | ${formatNumber(trade.averageBuyPrice, 2)} | ${formatNumber(trade.averageSellPrice, 2)} | ${formatPct(trade.return)} | ${formatPct(trade.qqqReturn)} |`);
    }
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("- Split buying can reduce bad timing risk, but it can also dilute fast-moving leaders.");
  lines.push("- Split selling can keep exposure after the fixed six-month exit, but it can also give back gains.");
  lines.push("- The 50/50 weekly extension rule sells half at six months and leaves half for the weekly trend rule.");
  lines.push("- This test compares execution style, not stock selection. The selected symbols are unchanged.");
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const sourceBytes = await fs.readFile(sourcePath);
  const source = JSON.parse(sourceBytes.toString("utf8"));
  const strategy = (source.rankedResults ?? source.results ?? []).find((row) => (
    strategyKey ? row.key === strategyKey : row.label === strategyLabel
  ));
  if (!strategy?.selectionTimeline?.length) {
    throw new Error(`Missing strategy timeline for ${strategyKey ?? strategyLabel}. Run monthly-buy-rule-test.mjs --years 5 first.`);
  }
  const trades = selectedTrades(strategy);
  const symbols = Array.from(new Set([...trades.map((row) => row.symbol), "QQQ"]));
  console.log(`Testing ${trades.length} selected trades across ${symbols.length} symbols.`);
  let snapshot;
  let errors = [];
  let snapshotPath = snapshotInPath;
  if (snapshotInPath) {
    snapshot = await readPriceSnapshot(snapshotInPath);
  } else {
    const fetched = await fetchPrices(symbols);
    errors = fetched.errors;
    const firstDate = trades.map((row) => row.entryDate).sort()[0] ?? null;
    snapshot = buildPriceSnapshot(fetched.dailyMap, {
      firstDate,
      source: sample ? "synthetic" : "yahoo-adjusted-close"
    });
    snapshotPath = snapshotOutPath;
    await writePriceSnapshot(snapshotOutPath, snapshot);
  }
  const dailyMap = priceMapFromSnapshot(snapshot);
  const missingSymbols = symbols.filter((symbol) => !(dailyMap.get(symbol)?.length));
  if (missingSymbols.length) {
    throw new Error(`Price snapshot is missing symbols: ${missingSymbols.join(", ")}`);
  }
  const weeklyMap = new Map([...dailyMap].map(([symbol, rows]) => [symbol, weeklyRows(rows)]));
  const evaluations = executionRules.map((rule) => ({
    rule: rule.key,
    label: rule.label,
    rows: trades.map((trade) => evaluateTrade(rule, trade, dailyMap, weeklyMap, {
      costBps,
      benchmarkSymbol: "QQQ",
      asOfDate: snapshot.asOf
    }))
  }));
  const baselineRows = evaluations.find((row) => row.rule === "lump_buy_lump_sell")?.rows ?? [];
  const summaries = evaluations.map((entry) => summarize(
    executionRules.find((rule) => rule.key === entry.rule),
    entry.rows,
    baselineRows
  ));
  const result = {
    generatedAt: new Date().toISOString(),
    mode: snapshotInPath ? "snapshot_replay" : sample ? "sample" : "live",
    sourcePath,
    sourceHash: createHash("sha256").update(sourceBytes).digest("hex"),
    selectionTimelineHash: createHash("sha256").update(JSON.stringify(strategy.selectionTimeline)).digest("hex"),
    strategyLabel,
    fixedHoldMonths,
    maxHoldMonths,
    costBps,
    valuationMode: "weekly_mark_to_market",
    incompleteTradePolicy: "right_censored",
    priceSnapshotPath: relativeSnapshotPath(process.cwd(), path.resolve(snapshotPath)),
    priceSnapshotHash: snapshot.hash,
    priceAsOf: snapshot.asOf,
    selectedTradeCount: trades.length,
    symbolCount: symbols.length,
    errors,
    summaries,
    evaluations
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
