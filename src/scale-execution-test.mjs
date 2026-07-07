import fs from "node:fs/promises";
import path from "node:path";
import { fetchChart, syntheticChart } from "./yahoo.mjs";
import { mean, round } from "./math.mjs";

const sample = process.argv.includes("--sample");
const sourcePath = path.join("data", "monthly-buy-rule-test-5y.json");
const outputJsonPath = path.join("data", "scale-execution-test.json");
const outputMdPath = "scale_execution_test.md";
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

function rowOffsetOnOrAfter(rows, date, offset) {
  const index = rows.findIndex((row) => row.date >= date && Number.isFinite(row.close));
  if (index === -1) return null;
  return rows[index + offset] ?? null;
}

function rowsBetween(rows, startDate, endDate) {
  return rows.filter((row) => row.date >= startDate && row.date < endDate && Number.isFinite(row.close));
}

function timelineDate(timeline, index, months) {
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
    ma10: movingAverage(closes, index, 10),
    rsi14: rsi(closes, index, 14)
  }));
}

function weeklyOnOrBefore(rows, date) {
  return rows.filter((row) => row.date <= date).at(-1) ?? null;
}

function consecutiveBelow10w(rows, index) {
  return index > 0
    && Number.isFinite(rows[index].ma10)
    && Number.isFinite(rows[index - 1].ma10)
    && rows[index].close < rows[index].ma10
    && rows[index - 1].close < rows[index - 1].ma10;
}

function weeklyExtensionExit(weekly, fixedExitDate, maxExitDate) {
  const fixedWeek = weeklyOnOrBefore(weekly, fixedExitDate);
  const alive = fixedWeek
    && Number.isFinite(fixedWeek.ma10)
    && Number.isFinite(fixedWeek.rsi14)
    && fixedWeek.close >= fixedWeek.ma10
    && fixedWeek.rsi14 >= 50;
  if (!alive) return { date: fixedExitDate, reason: "trend_not_alive_at_6m" };
  const startIndex = weekly.findIndex((row) => row.date > fixedExitDate);
  for (let index = Math.max(0, startIndex); index < weekly.length; index += 1) {
    const row = weekly[index];
    if (row.date > maxExitDate) break;
    if (consecutiveBelow10w(weekly, index)) return { date: row.date, reason: "two_week_10w_break" };
  }
  return { date: maxExitDate, reason: "max_12m" };
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
  for (let index = 0; index + fixedHoldMonths < timeline.length; index += 1) {
    const cohort = timeline[index];
    const fixedExitDate = timelineDate(timeline, index, fixedHoldMonths);
    const maxExitDate = timelineDate(timeline, index, maxHoldMonths);
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

function buyLots(rule, trade, dailyRows) {
  const cashPerLot = 1 / rule.buyOffsets.length;
  return rule.buyOffsets.map((offset) => {
    const row = rowOffsetOnOrAfter(dailyRows, trade.entryDate, offset);
    if (!row?.close) return null;
    const fee = cashPerLot * costBps / 10_000;
    return {
      date: row.date,
      price: row.close,
      cash: cashPerLot,
      shares: (cashPerLot - fee) / row.close
    };
  }).filter(Boolean);
}

function fixedSellLots(rule, trade, dailyRows, totalShares) {
  const sharePerLot = totalShares / rule.sellOffsets.length;
  return rule.sellOffsets.map((offset) => {
    const row = rowOffsetOnOrAfter(dailyRows, trade.fixedExitDate, offset);
    if (!row?.close) return null;
    return {
      date: row.date,
      price: row.close,
      shares: sharePerLot,
      reason: offset === 0 ? "fixed_6m" : `fixed_6m_plus_${offset}d`
    };
  }).filter(Boolean);
}

function halfWeeklySellLots(trade, dailyRows, weeklyRowsForSymbol, totalShares) {
  const fixed = rowOffsetOnOrAfter(dailyRows, trade.fixedExitDate, 0);
  const extended = weeklyExtensionExit(weeklyRowsForSymbol, trade.fixedExitDate, trade.maxExitDate);
  const extendedRow = rowOnOrAfter(dailyRows, extended.date);
  return [
    fixed ? {
      date: fixed.date,
      price: fixed.close,
      shares: totalShares * 0.5,
      reason: "half_fixed_6m"
    } : null,
    extendedRow ? {
      date: extendedRow.date,
      price: extendedRow.close,
      shares: totalShares * 0.5,
      reason: `half_${extended.reason}`
    } : null
  ].filter(Boolean);
}

function evaluateTrade(rule, trade, dailyMap, weeklyMap) {
  const dailyRows = dailyMap.get(trade.symbol) ?? [];
  const weeklyRowsForSymbol = weeklyMap.get(trade.symbol) ?? [];
  const buys = buyLots(rule, trade, dailyRows);
  if (buys.length !== rule.buyOffsets.length) {
    return { ...trade, rule: rule.key, label: rule.label, entered: false, reason: "missing_buy_price" };
  }
  const totalShares = buys.reduce((sum, lot) => sum + lot.shares, 0);
  const sells = rule.sellMode === "half_weekly"
    ? halfWeeklySellLots(trade, dailyRows, weeklyRowsForSymbol, totalShares)
    : fixedSellLots(rule, trade, dailyRows, totalShares);
  const expectedSellLots = rule.sellMode === "half_weekly" ? 2 : rule.sellOffsets.length;
  if (sells.length !== expectedSellLots) {
    return { ...trade, rule: rule.key, label: rule.label, entered: false, reason: "missing_sell_price" };
  }

  const grossProceeds = sells.reduce((sum, lot) => sum + lot.shares * lot.price, 0);
  const sellFee = grossProceeds * costBps / 10_000;
  const proceeds = grossProceeds - sellFee;
  const netReturn = proceeds - 1;
  const firstBuy = buys[0];
  const lastSell = sells.at(-1);
  const qqqRows = dailyMap.get("QQQ") ?? [];
  const qqqEntry = rowOnOrAfter(qqqRows, firstBuy.date);
  const qqqExit = rowOnOrAfter(qqqRows, lastSell.date);
  const qqqReturn = qqqEntry && qqqExit && qqqEntry.close ? qqqExit.close / qqqEntry.close - 1 : null;
  const holdDays = rowsBetween(dailyRows, firstBuy.date, lastSell.date).length;
  const averageBuyPrice = buys.reduce((sum, lot) => sum + lot.cash, 0) / totalShares;
  const averageSellPrice = grossProceeds / totalShares;
  return {
    ...trade,
    rule: rule.key,
    label: rule.label,
    entered: true,
    firstBuyDate: firstBuy.date,
    lastBuyDate: buys.at(-1).date,
    firstSellDate: sells[0].date,
    lastSellDate: lastSell.date,
    holdDays,
    averageBuyPrice: round(averageBuyPrice, 2),
    averageSellPrice: round(averageSellPrice, 2),
    return: round(netReturn, 4),
    qqqReturn: round(qqqReturn, 4),
    excessQqq: round(Number.isFinite(qqqReturn) ? netReturn - qqqReturn : null, 4),
    buyDates: buys.map((lot) => lot.date),
    sellDates: sells.map((lot) => lot.date),
    sellReasons: sells.map((lot) => lot.reason)
  };
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
  const baseline = new Map(baselineRows.filter((row) => row.entered).map((row) => [`${row.symbol}|${row.cohort}`, row]));
  const returns = entered.map((row) => row.return).filter(Number.isFinite);
  const qqqReturns = entered.map((row) => row.qqqReturn).filter(Number.isFinite);
  const improvements = entered
    .map((row) => {
      const base = baseline.get(`${row.symbol}|${row.cohort}`);
      return base ? row.return - base.return : null;
    })
    .filter(Number.isFinite);
  const robust = entered.filter((row) => Math.abs(row.return) < 3);
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
    averageHoldDays: round(mean(entered.map((row) => row.holdDays)), 1),
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
  lines.push("# Scale Execution Test");
  lines.push("");
  lines.push(`Generated at: ${result.generatedAt}`);
  lines.push(`Source strategy: ${result.strategyLabel}`);
  lines.push(`Source file: ${result.sourcePath}`);
  lines.push(`Completed selected trades: ${result.selectedTradeCount}`);
  lines.push(`Transaction cost: ${result.costBps} bps on each buy/sell cash flow`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| Rule | Entered | Skipped | Avg Hold Days | Avg Return | Median | Win Rate | Avg QQQ | Excess QQQ | Improvement vs Baseline |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const row of result.summaries) {
    lines.push(`| ${row.label} | ${row.enteredTrades} | ${row.skippedTrades} | ${formatNumber(row.averageHoldDays)} | ${formatPct(row.averageReturn)} | ${formatPct(row.medianReturn)} | ${formatPct(row.winRate)} | ${formatPct(row.averageQqqReturn)} | ${formatPct(row.averageExcessQqq)} | ${formatPct(row.averageImprovementVsBaseline)} |`);
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
  const source = JSON.parse(await fs.readFile(sourcePath, "utf8"));
  const strategy = (source.rankedResults ?? source.results ?? []).find((row) => row.label === strategyLabel);
  if (!strategy?.selectionTimeline?.length) {
    throw new Error(`Missing strategy timeline for ${strategyLabel}. Run monthly-buy-rule-test.mjs --years 5 first.`);
  }
  const trades = selectedTrades(strategy);
  const symbols = Array.from(new Set([...trades.map((row) => row.symbol), "QQQ"]));
  console.log(`Testing ${trades.length} completed trades across ${symbols.length} symbols.`);
  const { dailyMap, weeklyMap, errors } = await fetchPrices(symbols);
  const evaluations = executionRules.map((rule) => ({
    rule: rule.key,
    label: rule.label,
    rows: trades.map((trade) => evaluateTrade(rule, trade, dailyMap, weeklyMap))
  }));
  const baselineRows = evaluations.find((row) => row.rule === "lump_buy_lump_sell")?.rows ?? [];
  const summaries = evaluations.map((entry) => summarize(
    executionRules.find((rule) => rule.key === entry.rule),
    entry.rows,
    baselineRows
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
