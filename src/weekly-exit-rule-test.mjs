import fs from "node:fs/promises";
import path from "node:path";
import { fetchChart, syntheticChart } from "./yahoo.mjs";
import { mean, round } from "./math.mjs";

const sample = process.argv.includes("--sample");
const sourcePath = path.join("data", "monthly-buy-rule-test-5y.json");
const outputJsonPath = path.join("data", "weekly-exit-rule-test.json");
const outputMdPath = "weekly_exit_rule_test.md";
const strategyLabel = "Leader2 One Each";
const fixedHoldMonths = 6;
const maxHoldMonths = 12;
const costBps = 10;

function monthKey(date) {
  return String(date ?? "").slice(0, 7);
}

function rowOnOrAfter(rows, date) {
  return rows.find((row) => row.date >= date && Number.isFinite(row.close)) ?? rows.at(-1) ?? null;
}

function rowsBetween(rows, startDate, endDate) {
  return rows.filter((row) => row.date >= startDate && row.date < endDate && Number.isFinite(row.close));
}

function addTradingMonthIndex(timeline, index, months) {
  return timeline[Math.min(timeline.length - 1, index + months)]?.entryDate ?? timeline.at(-1)?.entryDate;
}

function movingAverage(values, index, length) {
  if (index < length - 1) return null;
  const slice = values.slice(index - length + 1, index + 1).filter(Number.isFinite);
  if (slice.length !== length) return null;
  return mean(slice);
}

function rsi(values, index, length = 14) {
  if (index < length) return null;
  let gains = 0;
  let losses = 0;
  for (let i = index - length + 1; i <= index; i += 1) {
    const change = values[i] - values[i - 1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

function weekKey(dateString) {
  const date = new Date(`${dateString}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-${String(week).padStart(2, "0")}`;
}

function weeklyRows(dailyRows) {
  const groups = new Map();
  for (const row of dailyRows) groups.set(weekKey(row.date), row);
  const rows = Array.from(groups.values()).sort((a, b) => a.date.localeCompare(b.date));
  const closes = rows.map((row) => row.close);
  return rows.map((row, index) => ({
    date: row.date,
    close: row.close,
    high: row.high,
    low: row.low,
    ma10: movingAverage(closes, index, 10),
    ma30: movingAverage(closes, index, 30),
    rsi14: rsi(closes, index, 14)
  }));
}

function weeklyOnOrBefore(rows, date) {
  const eligible = rows.filter((row) => row.date <= date);
  return eligible.at(-1) ?? null;
}

function consecutiveBelow10w(rows, index) {
  return index > 0
    && Number.isFinite(rows[index].ma10)
    && Number.isFinite(rows[index - 1].ma10)
    && rows[index].close < rows[index].ma10
    && rows[index - 1].close < rows[index - 1].ma10;
}

function alive10w(row) {
  return row && Number.isFinite(row.ma10) && row.close >= row.ma10;
}

function alive10wRsi(row) {
  return alive10w(row) && Number.isFinite(row.rsi14) && row.rsi14 >= 50;
}

const exitRules = [
  {
    key: "fixed_6m",
    label: "Fixed 6M Exit",
    description: "기존 기준선: 6개월 보유 후 매도",
    exitDate: ({ fixedExitDate }) => ({ exitDate: fixedExitDate, reason: "fixed_6m" })
  },
  {
    key: "extend_10w_rsi_max12",
    label: "Extend 10W+RSI Max12",
    description: "6개월 시점에 주봉 10주선 위이고 RSI 50 이상이면 보유 연장, 2주 연속 10주선 이탈 또는 12개월 도달 시 매도",
    exitDate: ({ weekly, fixedExitDate, maxExitDate }) => extendedExitDate(weekly, fixedExitDate, maxExitDate, alive10wRsi)
  },
  {
    key: "extend_10w_only_max12",
    label: "Extend 10W Only Max12",
    description: "6개월 시점에 주봉 10주선 위이면 보유 연장, 2주 연속 10주선 이탈 또는 12개월 도달 시 매도",
    exitDate: ({ weekly, fixedExitDate, maxExitDate }) => extendedExitDate(weekly, fixedExitDate, maxExitDate, alive10w)
  }
];

function extendedExitDate(weekly, fixedExitDate, maxExitDate, alivePredicate) {
  const fixedWeek = weeklyOnOrBefore(weekly, fixedExitDate);
  if (!alivePredicate(fixedWeek)) return { exitDate: fixedExitDate, reason: "trend_not_alive_at_6m" };
  const startIndex = weekly.findIndex((row) => row.date > fixedExitDate);
  for (let index = Math.max(0, startIndex); index < weekly.length; index += 1) {
    const row = weekly[index];
    if (row.date > maxExitDate) break;
    if (consecutiveBelow10w(weekly, index)) return { exitDate: row.date, reason: "two_week_10w_break" };
  }
  return { exitDate: maxExitDate, reason: "max_12m" };
}

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
  for (let index = 0; index + fixedHoldMonths < timeline.length; index += 1) {
    const cohort = timeline[index];
    const fixedExitDate = addTradingMonthIndex(timeline, index, fixedHoldMonths);
    const maxExitDate = addTradingMonthIndex(timeline, index, maxHoldMonths);
    if (!cohort?.rows?.length || !cohort.entryDate || !fixedExitDate) continue;
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

function evaluateTrade(rule, trade, dailyMap, weeklyMap) {
  const daily = dailyMap.get(trade.symbol) ?? [];
  const weekly = weeklyMap.get(trade.symbol) ?? [];
  const entry = rowOnOrAfter(daily, trade.entryDate);
  const planned = rule.exitDate({ weekly, fixedExitDate: trade.fixedExitDate, maxExitDate: trade.maxExitDate });
  const exit = rowOnOrAfter(daily, planned.exitDate);
  const qqqDaily = dailyMap.get("QQQ") ?? [];
  const qqqEntry = rowOnOrAfter(qqqDaily, trade.entryDate);
  const qqqExit = rowOnOrAfter(qqqDaily, planned.exitDate);
  if (!entry || !exit || !entry.close || !exit.close) {
    return { ...trade, rule: rule.key, label: rule.label, entered: false, reason: "missing_price" };
  }
  const grossReturn = exit.close / entry.close - 1;
  const qqqReturn = qqqEntry && qqqExit && qqqEntry.close ? qqqExit.close / qqqEntry.close - 1 : null;
  const holdDays = rowsBetween(daily, trade.entryDate, exit.date).length;
  return {
    ...trade,
    rule: rule.key,
    label: rule.label,
    entered: true,
    exitDate: exit.date,
    exitReason: planned.reason,
    holdDays,
    entryPrice: round(entry.close, 2),
    exitPrice: round(exit.close, 2),
    return: round(grossReturn - (costBps * 2) / 10_000, 4),
    qqqReturn: round(qqqReturn, 4),
    excessQqq: round(Number.isFinite(qqqReturn) ? grossReturn - (costBps * 2) / 10_000 - qqqReturn : null, 4),
    extended: exit.date > trade.fixedExitDate
  };
}

function median(values) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return null;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
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

function annualizedReturn(totalReturn, months) {
  if (!Number.isFinite(totalReturn) || months <= 0) return null;
  return (1 + totalReturn) ** (12 / months) - 1;
}

function periodReturn(dailyMap, symbol, startDate, endDate) {
  const rows = dailyMap.get(symbol) ?? [];
  const start = rowOnOrAfter(rows, startDate);
  const end = rowOnOrAfter(rows, endDate);
  if (!start || !end || !start.close) return null;
  return end.close / start.close - 1;
}

function simulateCurve(evaluatedTrades, timeline, dailyMap) {
  let equity = 1;
  let qqqEquity = 1;
  const curve = [];
  const intervals = timeline
    .filter((row) => row.entryDate)
    .slice(0, -1)
    .map((row, index) => ({
      asOf: row.asOf,
      startDate: row.entryDate,
      endDate: timeline[index + 1].entryDate
    }));

  for (const interval of intervals) {
    const active = evaluatedTrades.filter((trade) => (
      trade.entered
      && trade.entryDate <= interval.startDate
      && trade.exitDate > interval.startDate
    ));
    if (!active.length) continue;
    const returns = active
      .map((trade) => periodReturn(dailyMap, trade.symbol, interval.startDate, interval.endDate))
      .filter(Number.isFinite);
    const qqqReturn = periodReturn(dailyMap, "QQQ", interval.startDate, interval.endDate);
    if (!returns.length || !Number.isFinite(qqqReturn)) continue;
    const netReturn = mean(returns);
    equity *= 1 + netReturn;
    qqqEquity *= 1 + qqqReturn;
    curve.push({
      asOf: interval.asOf,
      startDate: interval.startDate,
      endDate: interval.endDate,
      activeCount: active.length,
      netReturn: round(netReturn, 4),
      qqqReturn: round(qqqReturn, 4),
      equity: round(equity, 4),
      qqqEquity: round(qqqEquity, 4),
      excessQqq: round(netReturn - qqqReturn, 4)
    });
  }
  return curve;
}

function reasonCounts(rows) {
  const counts = new Map();
  for (const row of rows) counts.set(row.exitReason, (counts.get(row.exitReason) ?? 0) + 1);
  return Object.fromEntries(counts);
}

function summarize(rule, rows, timeline, dailyMap) {
  const entered = rows.filter((row) => row.entered);
  const returns = entered.map((row) => row.return).filter(Number.isFinite);
  const qqqReturns = entered.map((row) => row.qqqReturn).filter(Number.isFinite);
  const robust = entered.filter((row) => Math.abs(row.return) < 3);
  const robustReturns = robust.map((row) => row.return).filter(Number.isFinite);
  const robustQqqReturns = robust.map((row) => row.qqqReturn).filter(Number.isFinite);
  const curve = simulateCurve(entered, timeline, dailyMap);
  const totalReturn = curve.at(-1)?.equity - 1;
  const qqqTotalReturn = curve.at(-1)?.qqqEquity - 1;
  return {
    key: rule.key,
    label: rule.label,
    description: rule.description,
    trades: entered.length,
    extendedTrades: entered.filter((row) => row.extended).length,
    extensionRate: round(entered.filter((row) => row.extended).length / Math.max(1, entered.length), 4),
    averageHoldDays: round(mean(entered.map((row) => row.holdDays)), 1),
    averageReturn: round(mean(returns), 4),
    medianReturn: round(median(returns), 4),
    winRate: round(returns.filter((value) => value > 0).length / Math.max(1, returns.length), 4),
    averageQqqReturn: round(mean(qqqReturns), 4),
    averageExcessQqq: round(mean(returns) - mean(qqqReturns), 4),
    robust: {
      trades: robust.length,
      averageReturn: round(mean(robustReturns), 4),
      medianReturn: round(median(robustReturns), 4),
      winRate: round(robustReturns.filter((value) => value > 0).length / Math.max(1, robustReturns.length), 4),
      averageExcessQqq: round(mean(robustReturns) - mean(robustQqqReturns), 4)
    },
    proxyCurve: {
      months: curve.length,
      totalReturn: round(totalReturn, 4),
      qqqTotalReturn: round(qqqTotalReturn, 4),
      excessQqqTotal: round(totalReturn - qqqTotalReturn, 4),
      cagr: round(annualizedReturn(totalReturn, curve.length), 4),
      maxDrawdown: maxDrawdown(curve),
      averageActiveCount: round(mean(curve.map((row) => row.activeCount)), 1)
    },
    exitReasons: reasonCounts(entered),
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
  lines.push("# Weekly Exit Rule Test");
  lines.push("");
  lines.push(`Generated at: ${result.generatedAt}`);
  lines.push(`Source strategy: ${result.strategyLabel}`);
  lines.push(`Source file: ${result.sourcePath}`);
  lines.push(`Baseline hold: ${result.fixedHoldMonths} months`);
  lines.push(`Max extended hold: ${result.maxHoldMonths} months`);
  lines.push("");
  lines.push("## Trade-Level Summary");
  lines.push("");
  lines.push("| Rule | Trades | Extended | Avg Hold Days | Avg Return | Median | Win Rate | Avg QQQ | Excess QQQ |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const row of result.summaries) {
    lines.push(`| ${row.label} | ${row.trades} | ${formatPct(row.extensionRate)} | ${formatNumber(row.averageHoldDays)} | ${formatPct(row.averageReturn)} | ${formatPct(row.medianReturn)} | ${formatPct(row.winRate)} | ${formatPct(row.averageQqqReturn)} | ${formatPct(row.averageExcessQqq)} |`);
  }
  lines.push("");
  lines.push("## Portfolio Proxy Summary");
  lines.push("");
  lines.push("Monthly proxy curve uses equal weight across active positions each month. It is for rule comparison, not an exact account statement.");
  lines.push("");
  lines.push("| Rule | Months | Total | CAGR | QQQ Total | Excess QQQ | MDD | Avg Active |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|");
  for (const row of result.summaries) {
    lines.push(`| ${row.label} | ${row.proxyCurve.months} | ${formatPct(row.proxyCurve.totalReturn)} | ${formatPct(row.proxyCurve.cagr)} | ${formatPct(row.proxyCurve.qqqTotalReturn)} | ${formatPct(row.proxyCurve.excessQqqTotal)} | ${formatPct(row.proxyCurve.maxDrawdown)} | ${formatNumber(row.proxyCurve.averageActiveCount)} |`);
  }
  lines.push("");
  lines.push("## Robust Check");
  lines.push("");
  lines.push("Extreme individual returns above +300% or below -300% are excluded here.");
  lines.push("");
  lines.push("| Rule | Trades | Avg Return | Median | Win Rate | Excess QQQ |");
  lines.push("|---|---:|---:|---:|---:|---:|");
  for (const row of result.summaries) {
    lines.push(`| ${row.label} | ${row.robust.trades} | ${formatPct(row.robust.averageReturn)} | ${formatPct(row.robust.medianReturn)} | ${formatPct(row.robust.winRate)} | ${formatPct(row.robust.averageExcessQqq)} |`);
  }
  lines.push("");
  lines.push("## Exit Reasons");
  lines.push("");
  lines.push("| Rule | Reasons |");
  lines.push("|---|---|");
  for (const row of result.summaries) {
    lines.push(`| ${row.label} | ${Object.entries(row.exitReasons).map(([key, value]) => `${key}: ${value}`).join(", ")} |`);
  }
  lines.push("");
  lines.push("## Recent Trades");
  for (const row of result.summaries) {
    lines.push("");
    lines.push(`### ${row.label}`);
    lines.push("");
    lines.push("| Cohort | Symbol | Entry | Fixed Exit | Actual Exit | Reason | Hold Days | Return | QQQ |");
    lines.push("|---|---|---:|---:|---:|---|---:|---:|---:|");
    for (const trade of row.recentTrades) {
      lines.push(`| ${trade.cohort} | ${trade.symbol} | ${trade.entryDate} | ${trade.fixedExitDate} | ${trade.exitDate} | ${trade.exitReason} | ${trade.holdDays} | ${formatPct(trade.return)} | ${formatPct(trade.qqqReturn)} |`);
    }
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("- The tested extension rule does not try to predict the exact top.");
  lines.push("- It only asks whether a leader that is still above its weekly trend at month 6 should be held longer.");
  lines.push("- Weekly 10-week moving average breaks are slower than daily stops, so they can give back gains before exiting.");
  lines.push("- This test still uses current universe membership and can contain ticker-event distortions.");
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
  console.log(`Testing ${trades.length} completed trades across ${symbols.length} symbols.`);
  const { dailyMap, weeklyMap, errors } = await fetchPrices(symbols);
  const evaluations = exitRules.map((rule) => ({
    rule: rule.key,
    label: rule.label,
    rows: trades.map((trade) => evaluateTrade(rule, trade, dailyMap, weeklyMap))
  }));
  const summaries = evaluations.map((entry) => summarize(
    exitRules.find((rule) => rule.key === entry.rule),
    entry.rows,
    strategy.selectionTimeline,
    dailyMap
  ));
  const result = {
    generatedAt: new Date().toISOString(),
    mode: sample ? "sample" : "live",
    sourcePath,
    strategyLabel,
    fixedHoldMonths,
    maxHoldMonths,
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
