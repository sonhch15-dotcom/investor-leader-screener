import fs from "node:fs/promises";
import path from "node:path";
import { fetchChart, syntheticChart } from "./yahoo.mjs";
import { mean, round } from "./math.mjs";

const sample = process.argv.includes("--sample");
const sourcePath = path.join("data", "monthly-buy-rule-test-5y.json");
const outputJsonPath = path.join("data", "daily-entry-filter-test.json");
const outputMdPath = "daily_entry_filter_test.md";
const strategyLabel = "Leader2 One Each";
const holdMonths = 6;
const costBps = 10;

function valueDate(date) {
  return String(date ?? "").slice(0, 10);
}

function monthKey(date) {
  return String(date ?? "").slice(0, 7);
}

function rowOnOrAfter(rows, date) {
  return rows.find((row) => row.date >= date && Number.isFinite(row.close)) ?? null;
}

function rowsBetween(rows, startDate, endDate) {
  return rows.filter((row) => row.date >= startDate && row.date < endDate && Number.isFinite(row.close));
}

function movingAverage(rows, index, length) {
  if (index < length - 1) return null;
  const slice = rows.slice(index - length + 1, index + 1).map((row) => row.close).filter(Number.isFinite);
  if (slice.length !== length) return null;
  return mean(slice);
}

function highestHigh(rows, index, length) {
  if (index < length) return null;
  const slice = rows.slice(index - length, index).map((row) => row.high ?? row.close).filter(Number.isFinite);
  if (slice.length !== length) return null;
  return Math.max(...slice);
}

function annotateRows(rows) {
  return rows.map((row, index) => {
    const ma20 = movingAverage(rows, index, 20);
    const ma50 = movingAverage(rows, index, 50);
    const priorMa20 = index > 0 ? movingAverage(rows, index - 1, 20) : null;
    const ma20FiveAgo = index >= 5 ? movingAverage(rows, index - 5, 20) : null;
    return {
      ...row,
      index,
      ma20,
      ma50,
      priorMa20,
      ma20Slope5: Number.isFinite(ma20) && Number.isFinite(ma20FiveAgo) ? ma20 / ma20FiveAgo - 1 : null,
      high10: highestHigh(rows, index, 10),
      high5: highestHigh(rows, index, 5)
    };
  });
}

function isUptrend(row) {
  return row.close > row.ma20 && row.close > row.ma50 && row.ma20Slope5 >= -0.003;
}

function firstEligibleRow(rows, scheduledEntryDate, exitDate, maxWaitDays, predicate) {
  const candidates = rowsBetween(rows, scheduledEntryDate, exitDate).slice(0, maxWaitDays + 1);
  return candidates.find(predicate) ?? null;
}

const entryRules = [
  {
    key: "immediate",
    label: "Immediate Entry",
    description: "선정 후 다음 거래일 종가에 바로 진입",
    maxWaitDays: 0,
    entry: (rows, scheduledEntryDate, exitDate) => rowOnOrAfter(rows, scheduledEntryDate)
  },
  {
    key: "trend_20_50_wait10",
    label: "Trend 20/50 Wait10",
    description: "최대 10거래일 대기, 종가가 20일선/50일선 위이고 20일선 기울기가 꺾이지 않을 때 진입",
    maxWaitDays: 10,
    entry: (rows, scheduledEntryDate, exitDate) => firstEligibleRow(
      rows,
      scheduledEntryDate,
      exitDate,
      10,
      (row) => isUptrend(row)
    )
  },
  {
    key: "reclaim_20_wait15",
    label: "Reclaim 20MA Wait15",
    description: "최대 15거래일 대기, 50일선 위에서 20일선을 재돌파할 때 진입",
    maxWaitDays: 15,
    entry: (rows, scheduledEntryDate, exitDate) => firstEligibleRow(
      rows,
      scheduledEntryDate,
      exitDate,
      15,
      (row) => row.close > row.ma20
        && row.close > row.ma50
        && row.ma20Slope5 >= -0.005
        && row.index > 0
        && rows[row.index - 1]?.close <= row.priorMa20
    )
  },
  {
    key: "breakout_10_wait15",
    label: "10D Breakout Wait15",
    description: "최대 15거래일 대기, 20일선/50일선 위에서 직전 10일 고점을 돌파할 때 진입",
    maxWaitDays: 15,
    entry: (rows, scheduledEntryDate, exitDate) => firstEligibleRow(
      rows,
      scheduledEntryDate,
      exitDate,
      15,
      (row) => isUptrend(row) && row.close > row.high10
    )
  },
  {
    key: "pullback_strength_wait20",
    label: "Pullback Strength Wait20",
    description: "최대 20거래일 대기, 20일선 부근 눌림 이후 5일 고점을 재돌파할 때 진입",
    maxWaitDays: 20,
    entry: (rows, scheduledEntryDate, exitDate) => {
      const candidates = rowsBetween(rows, scheduledEntryDate, exitDate).slice(0, 21);
      let sawPullback = false;
      for (const row of candidates) {
        if (Number.isFinite(row.ma20) && row.low <= row.ma20 * 1.015) sawPullback = true;
        if (sawPullback && isUptrend(row) && row.close > row.high5) return row;
      }
      return null;
    }
  }
];

async function fetchPrices(symbols) {
  const priceMap = new Map();
  const errors = [];
  for (const [index, symbol] of symbols.entries()) {
    try {
      const rows = sample ? syntheticChart(symbol, 2600) : await fetchChart(symbol, { range: "10y" });
      priceMap.set(symbol, annotateRows(rows));
      if ((index + 1) % 25 === 0) console.log(`Fetched ${index + 1}/${symbols.length}`);
    } catch (error) {
      errors.push({ symbol, error: error.message });
      if (sample) priceMap.set(symbol, annotateRows(syntheticChart(symbol, 2600)));
    }
  }
  return { priceMap, errors };
}

function selectedTrades(strategy) {
  const timeline = strategy.selectionTimeline ?? [];
  const trades = [];
  for (let index = 0; index + holdMonths < timeline.length; index += 1) {
    const cohort = timeline[index];
    const exitCohort = timeline[index + holdMonths];
    if (!cohort?.rows?.length || !cohort.entryDate || !exitCohort?.entryDate) continue;
    for (const row of cohort.rows) {
      trades.push({
        cohort: monthKey(cohort.asOf),
        asOf: valueDate(cohort.asOf),
        scheduledEntryDate: valueDate(cohort.entryDate),
        scheduledExitDate: valueDate(exitCohort.entryDate),
        exitMonth: monthKey(exitCohort.asOf),
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

function evaluateTrade(rule, trade, priceMap) {
  const rows = priceMap.get(trade.symbol) ?? [];
  const qqqRows = priceMap.get("QQQ") ?? [];
  const entry = rule.entry(rows, trade.scheduledEntryDate, trade.scheduledExitDate);
  const baselineEntry = rowOnOrAfter(rows, trade.scheduledEntryDate);
  const exit = rowOnOrAfter(rows, trade.scheduledExitDate);
  if (!baselineEntry || !exit || !exit.close || !baselineEntry.close) {
    return { ...trade, entered: false, skipReason: "missing_price" };
  }
  if (!entry || !entry.close || entry.date >= trade.scheduledExitDate) {
    return {
      ...trade,
      entered: false,
      skipReason: "no_signal",
      baselineReturn: round(exit.close / baselineEntry.close - 1 - (costBps * 2) / 10_000, 4)
    };
  }
  const qqqEntry = rowOnOrAfter(qqqRows, entry.date);
  const qqqExit = rowOnOrAfter(qqqRows, trade.scheduledExitDate);
  const baselineQqqEntry = rowOnOrAfter(qqqRows, trade.scheduledEntryDate);
  const grossReturn = exit.close / entry.close - 1;
  const baselineGrossReturn = exit.close / baselineEntry.close - 1;
  const qqqReturn = qqqEntry && qqqExit && qqqEntry.close ? qqqExit.close / qqqEntry.close - 1 : null;
  const baselineQqqReturn = baselineQqqEntry && qqqExit && baselineQqqEntry.close
    ? qqqExit.close / baselineQqqEntry.close - 1
    : null;
  const delayDays = rowsBetween(rows, trade.scheduledEntryDate, entry.date).length;
  const netReturn = grossReturn - (costBps * 2) / 10_000;
  const baselineReturn = baselineGrossReturn - (costBps * 2) / 10_000;
  return {
    ...trade,
    entered: true,
    entryDate: entry.date,
    exitDate: exit.date,
    delayDays,
    entryPrice: round(entry.close, 2),
    exitPrice: round(exit.close, 2),
    return: round(netReturn, 4),
    baselineReturn: round(baselineReturn, 4),
    entryImprovement: round(netReturn - baselineReturn, 4),
    qqqReturn: round(qqqReturn, 4),
    baselineQqqReturn: round(baselineQqqReturn, 4),
    excessQqq: round(Number.isFinite(qqqReturn) ? netReturn - qqqReturn : null, 4)
  };
}

function median(values) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return null;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
}

function summarize(rule, rows, baselineRows) {
  const entered = rows.filter((row) => row.entered);
  const baselineReturns = baselineRows.map((row) => row.baselineReturn).filter(Number.isFinite);
  const returns = entered.map((row) => row.return).filter(Number.isFinite);
  const qqqReturns = entered.map((row) => row.qqqReturn).filter(Number.isFinite);
  const improvements = entered.map((row) => row.entryImprovement).filter(Number.isFinite);
  const robustEntered = entered.filter((row) => Math.abs(row.return) < 3);
  const robustReturns = robustEntered.map((row) => row.return).filter(Number.isFinite);
  const robustQqqReturns = robustEntered.map((row) => row.qqqReturn).filter(Number.isFinite);
  const robustImprovements = robustEntered.map((row) => row.entryImprovement).filter(Number.isFinite);
  const skipped = rows.filter((row) => !row.entered);
  const missedBaseline = skipped.map((row) => row.baselineReturn).filter(Number.isFinite);
  return {
    key: rule.key,
    label: rule.label,
    description: rule.description,
    maxWaitDays: rule.maxWaitDays,
    testedTrades: rows.length,
    enteredTrades: entered.length,
    skippedTrades: skipped.length,
    participationRate: round(entered.length / Math.max(1, rows.length), 4),
    averageDelayDays: round(mean(entered.map((row) => row.delayDays)), 2),
    averageReturn: round(mean(returns), 4),
    medianReturn: round(median(returns), 4),
    winRate: round(returns.filter((value) => value > 0).length / Math.max(1, returns.length), 4),
    averageQqqReturn: round(mean(qqqReturns), 4),
    averageExcessQqq: round(mean(returns) - mean(qqqReturns), 4),
    averageBaselineReturnAll: round(mean(baselineReturns), 4),
    averageEntryImprovement: round(mean(improvements), 4),
    averageMissedBaselineReturn: round(mean(missedBaseline), 4),
    robust: {
      enteredTrades: robustEntered.length,
      averageReturn: round(mean(robustReturns), 4),
      medianReturn: round(median(robustReturns), 4),
      winRate: round(robustReturns.filter((value) => value > 0).length / Math.max(1, robustReturns.length), 4),
      averageExcessQqq: round(mean(robustReturns) - mean(robustQqqReturns), 4),
      averageEntryImprovement: round(mean(robustImprovements), 4)
    },
    bestTrade: [...entered].sort((a, b) => b.return - a.return)[0] ?? null,
    worstTrade: [...entered].sort((a, b) => a.return - b.return)[0] ?? null,
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
  lines.push("# Daily Entry Filter Test");
  lines.push("");
  lines.push(`Generated at: ${result.generatedAt}`);
  lines.push(`Source strategy: ${result.strategyLabel}`);
  lines.push(`Source file: ${result.sourcePath}`);
  lines.push(`Holding window: ${result.holdMonths} months from scheduled monthly sleeve`);
  lines.push(`Transaction cost: ${result.costBps} bps entry + ${result.costBps} bps exit`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| Rule | Entered | Skipped | Participation | Avg Delay | Avg Return | Median | Win Rate | Avg QQQ | Excess QQQ | Entry Improvement | Missed Baseline |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const row of result.summaries) {
    lines.push(`| ${row.label} | ${row.enteredTrades} | ${row.skippedTrades} | ${formatPct(row.participationRate)} | ${formatNumber(row.averageDelayDays, 1)} | ${formatPct(row.averageReturn)} | ${formatPct(row.medianReturn)} | ${formatPct(row.winRate)} | ${formatPct(row.averageQqqReturn)} | ${formatPct(row.averageExcessQqq)} | ${formatPct(row.averageEntryImprovement)} | ${formatPct(row.averageMissedBaselineReturn)} |`);
  }
  lines.push("");
  lines.push("## Robust Check");
  lines.push("");
  lines.push("Extreme individual returns above +300% or below -300% are excluded here to reduce ticker/event distortion.");
  lines.push("");
  lines.push("| Rule | Entered | Avg Return | Median | Win Rate | Excess QQQ | Entry Improvement |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|");
  for (const row of result.summaries) {
    lines.push(`| ${row.label} | ${row.robust.enteredTrades} | ${formatPct(row.robust.averageReturn)} | ${formatPct(row.robust.medianReturn)} | ${formatPct(row.robust.winRate)} | ${formatPct(row.robust.averageExcessQqq)} | ${formatPct(row.robust.averageEntryImprovement)} |`);
  }
  lines.push("");
  lines.push("## Interpretation Notes");
  lines.push("");
  lines.push("- Entry Improvement compares the selected entry rule against buying the same symbol immediately on the scheduled entry date.");
  lines.push("- Missed Baseline is the average return of trades skipped by that rule if they had been bought immediately.");
  lines.push("- This is a first daily-bar test. It does not yet use 4H or 1H candles.");
  lines.push("- Exit is still the original six-month sleeve exit date, so this isolates entry timing instead of changing the whole portfolio rotation.");
  lines.push("");
  lines.push("## Recent Entered Trades By Rule");
  for (const row of result.summaries) {
    lines.push("");
    lines.push(`### ${row.label}`);
    lines.push("");
    lines.push("| Cohort | Symbol | Scheduled | Entry | Exit | Delay | Return | Immediate | Improvement | QQQ |");
    lines.push("|---|---|---:|---:|---:|---:|---:|---:|---:|---:|");
    for (const trade of row.recentTrades) {
      lines.push(`| ${trade.cohort} | ${trade.symbol} | ${trade.scheduledEntryDate} | ${trade.entryDate} | ${trade.exitDate} | ${trade.delayDays} | ${formatPct(trade.return)} | ${formatPct(trade.baselineReturn)} | ${formatPct(trade.entryImprovement)} | ${formatPct(trade.qqqReturn)} |`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const source = JSON.parse(await fs.readFile(sourcePath, "utf8"));
  const strategy = (source.rankedResults ?? source.results ?? []).find((row) => row.label === strategyLabel);
  if (!strategy?.selectionTimeline?.length) {
    throw new Error(`Missing strategy timeline for ${strategyLabel}. Run monthly-buy-rule-test.mjs --years 5 first.`);
  }
  const trades = selectedTrades(strategy);
  const symbols = Array.from(new Set([...trades.map((row) => row.symbol), "QQQ"]));
  console.log(`Testing ${trades.length} selected trades across ${symbols.length} symbols.`);
  const { priceMap, errors } = await fetchPrices(symbols);
  const evaluations = entryRules.map((rule) => ({
    rule: rule.key,
    label: rule.label,
    rows: trades.map((trade) => evaluateTrade(rule, trade, priceMap))
  }));
  const baselineRows = evaluations.find((row) => row.rule === "immediate")?.rows ?? [];
  const summaries = evaluations.map((row) => summarize(entryRules.find((rule) => rule.key === row.rule), row.rows, baselineRows));
  const result = {
    generatedAt: new Date().toISOString(),
    mode: sample ? "sample" : "live",
    sourcePath,
    strategyLabel,
    holdMonths,
    costBps,
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
