import fs from "node:fs/promises";
import path from "node:path";
import { buildUniverse } from "./universe.mjs";
import { fetchChart, syntheticChart } from "./yahoo.mjs";
import { scoreUniverse } from "./scoring.mjs";
import { clamp, mean, round } from "./math.mjs";

const sample = process.argv.includes("--sample");
const sourcePath = path.join("data", "monthly-buy-rule-test-5y.json");
const outputJsonPath = path.join("data", "weekly-dropout-rule-test.json");
const outputMdPath = "weekly_dropout_rule_test.md";
const strategyLabel = "Leader2 One Each";
const fixedHoldMonths = 6;
const maxHoldMonths = 12;
const costBps = 10;
const consecutiveDropWeeks = 2;
const graceWeeks = 4;

function monthKey(date) {
  return String(date ?? "").slice(0, 7);
}

function parseDate(date) {
  return new Date(`${date}T00:00:00Z`);
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(dateString, days) {
  const date = parseDate(dateString);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

function latestDate(priceMap) {
  const spy = priceMap.get("SPY") ?? Array.from(priceMap.values()).find((rows) => rows.length);
  return spy?.at(-1)?.date ?? isoDate(new Date());
}

function rowsUntil(rows, asOf) {
  return rows.filter((row) => row.date <= asOf);
}

function rowOnOrAfter(rows, date) {
  return rows.find((row) => row.date >= date && Number.isFinite(row.close)) ?? rows.at(-1) ?? null;
}

function firstRowAfter(rows, date) {
  return rows.find((row) => row.date > date && Number.isFinite(row.close)) ?? null;
}

function rowsBetween(rows, startDate, endDate) {
  return rows.filter((row) => row.date >= startDate && row.date < endDate && Number.isFinite(row.close));
}

function weeklyFridays(startDate, endDate) {
  const dates = [];
  const cursor = parseDate(startDate);
  while (cursor.getUTCDay() !== 5) cursor.setUTCDate(cursor.getUTCDate() + 1);
  const end = parseDate(endDate);
  while (cursor <= end) {
    dates.push(isoDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return dates;
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
  const date = parseDate(dateString);
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
  const qqqMomentum = weightedMomentum(qqq?.metrics);
  const spyMomentum = weightedMomentum(spy?.metrics);
  const groups = new Map();

  for (const row of stocks) groups.set(row.sector, [...(groups.get(row.sector) ?? []), row]);

  return Array.from(groups, ([group, groupRows]) => {
    const groupEligible = groupRows.filter((row) => row.status !== "excluded");
    const groupTop20 = top20.filter((row) => row.sector === group);
    const groupTop50 = top50.filter((row) => row.sector === group);
    const groupTop100 = top100.filter((row) => row.sector === group);
    const groupMomentum = groupRows.map((row) => weightedMomentum(row.metrics));
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
      averageMomentum: round(mean(groupMomentum), 4),
      averageSpyExcessMomentum: round(mean(groupMomentum.map((value) => value - spyMomentum)), 4),
      averageQqqExcessMomentum: round(mean(groupMomentum.map((value) => value - qqqMomentum)), 4),
      above50Rate: round(rate(groupRows, (row) => row.metrics?.above50), 4),
      above200Rate: round(rate(groupRows, (row) => row.metrics?.above200), 4),
      nearHighRate: round(rate(groupRows, (row) => row.metrics?.high52wDistance >= -0.1), 4),
      score75Rate: round(rate(groupRows, (row) => row.score >= 75), 4),
      score80Rate: round(rate(groupRows, (row) => row.score >= 80), 4)
    };
  }).filter((row) => row.universeCount >= 3);
}

function previousStats(history, groupName, lookback = 3) {
  const rows = history
    .slice(-lookback)
    .map((period) => period.groupStats.find((group) => group.group === groupName))
    .filter(Boolean);
  return {
    periodsPresent: rows.length,
    averageTop50Count: mean(rows.map((row) => row.top50Count)) ?? 0
  };
}

function scoreGroup(group, history) {
  const previous = previousStats(history, group.group);
  const acceleration = group.top50Count - previous.averageTop50Count;
  const leadershipScore = round(
    clamp(group.averageQqqExcessMomentum, -0.2, 0.4) * 100
    + clamp(group.averageSpyExcessMomentum, -0.2, 0.4) * 60
    + group.above50Rate * 22
    + group.above200Rate * 16
    + group.nearHighRate * 16
    + group.score75Rate * 20
    + group.score80Rate * 12
    + group.eligibleRate * 12
    + group.top50Concentration * 90
    + group.top100Concentration * 35
    + group.top20Count * 8
    + clamp(acceleration, -4, 6) * 4
    + previous.periodsPresent * 4,
    2
  );
  return { ...group, top50Acceleration: round(acceleration, 2), leadershipScore };
}

function leaderGroups(period, count) {
  return period.groupStats.slice(0, count).map((group) => group.group);
}

function topOnePerGroup(period, groups, totalLimit) {
  const selected = [];
  const used = new Set();
  for (const group of groups) {
    const row = period.candidates.find((candidate) => candidate.sector === group && !used.has(candidate.symbol));
    if (!row) continue;
    selected.push(row);
    used.add(row.symbol);
    if (selected.length >= totalLimit) break;
  }
  return selected.sort((a, b) => a.rank - b.rank);
}

async function collectPrices(instruments) {
  const priceMap = new Map();
  const weeklyMap = new Map();
  const errors = [];
  for (const [index, instrument] of instruments.entries()) {
    try {
      const rows = sample ? syntheticChart(instrument.symbol, 900) : await fetchChart(instrument.symbol, { range: "5y" });
      priceMap.set(instrument.symbol, rows);
      weeklyMap.set(instrument.symbol, weeklyRows(rows));
      if ((index + 1) % 50 === 0) console.log(`Fetched ${index + 1}/${instruments.length}`);
    } catch (error) {
      errors.push({ symbol: instrument.symbol, error: error.message });
      if (sample) {
        const rows = syntheticChart(instrument.symbol, 900);
        priceMap.set(instrument.symbol, rows);
        weeklyMap.set(instrument.symbol, weeklyRows(rows));
      }
    }
  }
  return { priceMap, weeklyMap, errors };
}

async function buildWeeklyObservations(instruments, priceMap, source) {
  const startDate = source.startDate ?? source.rankedResults?.[0]?.selectionTimeline?.[0]?.asOf;
  const endDate = latestDate(priceMap);
  const dates = weeklyFridays(startDate, endDate);
  const periods = [];
  const history = [];

  for (const [index, asOf] of dates.entries()) {
    const slicedPriceMap = new Map();
    for (const [symbol, rows] of priceMap) slicedPriceMap.set(symbol, rowsUntil(rows, asOf));
    const scored = scoreUniverse(instruments, slicedPriceMap);
    const entryRow = firstRowAfter(priceMap.get("SPY") ?? [], asOf);
    if (!entryRow) continue;
    const groupStats = buildGroupStats(scored.rows)
      .map((group) => scoreGroup(group, history))
      .sort((a, b) => b.leadershipScore - a.leadershipScore);
    const candidates = scored.rows
      .filter((row) => row.type === "stock" && row.sector && row.status !== "excluded")
      .map((row, rowIndex) => ({ ...row, rank: rowIndex + 1 }));
    const period = { asOf, entryDate: entryRow.date, groupStats, candidates };
    const selected = topOnePerGroup(period, leaderGroups(period, 2), 2);
    periods.push({
      asOf,
      entryDate: entryRow.date,
      top2Groups: leaderGroups(period, 2),
      top5Groups: leaderGroups(period, 5),
      selectedSymbols: selected.map((row) => row.symbol),
      selectedRows: selected.map((row) => ({ symbol: row.symbol, sector: row.sector, rank: row.rank, score: row.score }))
    });
    history.push(period);
    if ((index + 1) % 52 === 0) console.log(`Scored ${index + 1}/${dates.length} weekly observations`);
  }

  return periods;
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

function isDropped(observation, trade, mode) {
  if (mode === "symbol_top2") return !observation.selectedSymbols.includes(trade.symbol);
  if (mode === "group_top2") return !observation.top2Groups.includes(trade.sector);
  if (mode === "group_top5") return !observation.top5Groups.includes(trade.sector);
  return false;
}

function firstDropSignal(trade, observations, mode, startDate, endDate) {
  let streak = 0;
  const graceDate = addDays(trade.entryDate, graceWeeks * 7);
  for (const observation of observations) {
    if (observation.entryDate < startDate || observation.entryDate < graceDate) continue;
    if (observation.entryDate > endDate) break;
    streak = isDropped(observation, trade, mode) ? streak + 1 : 0;
    if (streak >= consecutiveDropWeeks) {
      return {
        date: observation.entryDate,
        reason: `${mode}_${consecutiveDropWeeks}w_drop`,
        asOf: observation.asOf
      };
    }
  }
  return null;
}

const rules = [
  {
    key: "fixed_6m",
    label: "Fixed 6M",
    description: "기준 비교용: 6개월 후 전량 매도",
    sellLots: ({ trade }) => [{ date: trade.fixedExitDate, weight: 1, reason: "fixed_6m" }]
  },
  {
    key: "current_half_weekly",
    label: "Current 50/50 Weekly",
    description: "현재 운영 후보: 6개월에 50% 매도, 나머지 50%는 주봉 10주선+RSI로 최대 12개월 연장",
    sellLots: ({ trade, weekly }) => {
      const extension = weeklyExtensionExit(weekly, trade.fixedExitDate, trade.maxExitDate);
      return [
        { date: trade.fixedExitDate, weight: 0.5, reason: "half_fixed_6m" },
        { date: extension.date, weight: 0.5, reason: `half_${extension.reason}` }
      ];
    }
  },
  {
    key: "early_symbol_top2_drop",
    label: "Early Exit: Symbol Drop",
    description: "매수 후 4주 유예, 종목이 주간 Leader2 후보에서 2주 연속 빠지면 조기 전량 매도",
    sellLots: ({ trade, observations }) => {
      const drop = firstDropSignal(trade, observations, "symbol_top2", trade.entryDate, trade.fixedExitDate);
      return [{ date: drop?.date ?? trade.fixedExitDate, weight: 1, reason: drop?.reason ?? "fixed_6m" }];
    }
  },
  {
    key: "early_group_top2_drop",
    label: "Early Exit: Group Top2 Drop",
    description: "매수 후 4주 유예, 보유 종목의 섹터가 주간 Top2 그룹에서 2주 연속 탈락하면 조기 전량 매도",
    sellLots: ({ trade, observations }) => {
      const drop = firstDropSignal(trade, observations, "group_top2", trade.entryDate, trade.fixedExitDate);
      return [{ date: drop?.date ?? trade.fixedExitDate, weight: 1, reason: drop?.reason ?? "fixed_6m" }];
    }
  },
  {
    key: "early_group_top5_drop",
    label: "Early Exit: Group Top5 Drop",
    description: "매수 후 4주 유예, 보유 종목의 섹터가 주간 Top5 그룹에서 2주 연속 탈락하면 조기 전량 매도",
    sellLots: ({ trade, observations }) => {
      const drop = firstDropSignal(trade, observations, "group_top5", trade.entryDate, trade.fixedExitDate);
      return [{ date: drop?.date ?? trade.fixedExitDate, weight: 1, reason: drop?.reason ?? "fixed_6m" }];
    }
  },
  {
    key: "extension_group_top5_guard",
    label: "50/50 + Extension Top5 Guard",
    description: "6개월 전에는 무시. 6개월 이후 연장분만 섹터 Top5 탈락 또는 주봉 추세 훼손 시 매도",
    sellLots: ({ trade, weekly, observations }) => {
      const extension = weeklyExtensionExit(weekly, trade.fixedExitDate, trade.maxExitDate);
      const drop = firstDropSignal(trade, observations, "group_top5", trade.fixedExitDate, trade.maxExitDate);
      const guardedDate = drop && drop.date < extension.date ? drop.date : extension.date;
      return [
        { date: trade.fixedExitDate, weight: 0.5, reason: "half_fixed_6m" },
        { date: guardedDate, weight: 0.5, reason: drop && drop.date < extension.date ? `half_${drop.reason}` : `half_${extension.reason}` }
      ];
    }
  }
];

function evaluateTrade(rule, trade, priceMap, weeklyMap, observations) {
  const dailyRows = priceMap.get(trade.symbol) ?? [];
  const weekly = weeklyMap.get(trade.symbol) ?? [];
  const entry = rowOnOrAfter(dailyRows, trade.entryDate);
  if (!entry?.close) return { ...trade, rule: rule.key, label: rule.label, entered: false, reason: "missing_entry_price" };

  const lots = rule.sellLots({ trade, weekly, observations });
  const sells = lots.map((lot) => {
    const row = rowOnOrAfter(dailyRows, lot.date);
    if (!row?.close) return null;
    return { ...lot, date: row.date, price: row.close };
  }).filter(Boolean);
  if (sells.length !== lots.length) return { ...trade, rule: rule.key, label: rule.label, entered: false, reason: "missing_exit_price" };

  const netReturn = sells.reduce((sum, sell) => sum + sell.weight * (sell.price / entry.close - 1), 0) - (costBps * 2) / 10_000;
  const lastSell = sells.at(-1);
  const qqqRows = priceMap.get("QQQ") ?? [];
  const qqqEntry = rowOnOrAfter(qqqRows, entry.date);
  const qqqExit = rowOnOrAfter(qqqRows, lastSell.date);
  const qqqReturn = qqqEntry && qqqExit && qqqEntry.close ? qqqExit.close / qqqEntry.close - 1 : null;
  return {
    ...trade,
    rule: rule.key,
    label: rule.label,
    entered: true,
    entryPrice: round(entry.close, 2),
    firstSellDate: sells[0].date,
    lastSellDate: lastSell.date,
    holdDays: rowsBetween(dailyRows, entry.date, lastSell.date).length,
    return: round(netReturn, 4),
    qqqReturn: round(qqqReturn, 4),
    excessQqq: round(Number.isFinite(qqqReturn) ? netReturn - qqqReturn : null, 4),
    sellReasons: sells.map((sell) => sell.reason),
    sellDates: sells.map((sell) => sell.date)
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
    .map((row) => baseline.get(`${row.symbol}|${row.cohort}`)?.return != null ? row.return - baseline.get(`${row.symbol}|${row.cohort}`).return : null)
    .filter(Number.isFinite);
  const robust = entered.filter((row) => Math.abs(row.return) < 3);
  const robustReturns = robust.map((row) => row.return).filter(Number.isFinite);
  const robustQqqReturns = robust.map((row) => row.qqqReturn).filter(Number.isFinite);
  const robustImprovements = robust
    .map((row) => baseline.get(`${row.symbol}|${row.cohort}`)?.return != null ? row.return - baseline.get(`${row.symbol}|${row.cohort}`).return : null)
    .filter(Number.isFinite);
  return {
    key: rule.key,
    label: rule.label,
    description: rule.description,
    enteredTrades: entered.length,
    averageHoldDays: round(mean(entered.map((row) => row.holdDays)), 1),
    averageReturn: round(mean(returns), 4),
    medianReturn: round(median(returns), 4),
    winRate: round(returns.filter((value) => value > 0).length / Math.max(1, returns.length), 4),
    averageQqqReturn: round(mean(qqqReturns), 4),
    averageExcessQqq: round(mean(returns) - mean(qqqReturns), 4),
    averageImprovementVsCurrent: round(mean(improvements), 4),
    robust: {
      trades: robust.length,
      averageReturn: round(mean(robustReturns), 4),
      medianReturn: round(median(robustReturns), 4),
      winRate: round(robustReturns.filter((value) => value > 0).length / Math.max(1, robustReturns.length), 4),
      averageExcessQqq: round(mean(robustReturns) - mean(robustQqqReturns), 4),
      averageImprovementVsCurrent: round(mean(robustImprovements), 4)
    },
    sellReasons: reasonCounts(entered),
    recentTrades: entered.slice(-12),
    bestTrade: [...entered].sort((a, b) => b.return - a.return)[0] ?? null,
    worstTrade: [...entered].sort((a, b) => a.return - b.return)[0] ?? null
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
  lines.push("# Weekly Dropout Rule Test");
  lines.push("");
  lines.push(`Generated at: ${result.generatedAt}`);
  lines.push(`Source strategy: ${result.strategyLabel}`);
  lines.push(`Source file: ${result.sourcePath}`);
  lines.push(`Weekly dropout signal: ${result.consecutiveDropWeeks} consecutive weekly observations after ${result.graceWeeks} grace weeks`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("The baseline for the improvement column is the current 50/50 weekly extension rule.");
  lines.push("");
  lines.push("| Rule | Trades | Avg Hold Days | Avg Return | Median | Win Rate | Avg QQQ | Excess QQQ | Improvement vs Current |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const row of result.summaries) {
    lines.push(`| ${row.label} | ${row.enteredTrades} | ${formatNumber(row.averageHoldDays)} | ${formatPct(row.averageReturn)} | ${formatPct(row.medianReturn)} | ${formatPct(row.winRate)} | ${formatPct(row.averageQqqReturn)} | ${formatPct(row.averageExcessQqq)} | ${formatPct(row.averageImprovementVsCurrent)} |`);
  }
  lines.push("");
  lines.push("## Robust Check");
  lines.push("");
  lines.push("Extreme individual returns above +300% or below -300% are excluded here.");
  lines.push("");
  lines.push("| Rule | Trades | Avg Return | Median | Win Rate | Excess QQQ | Improvement vs Current |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|");
  for (const row of result.summaries) {
    lines.push(`| ${row.label} | ${row.robust.trades} | ${formatPct(row.robust.averageReturn)} | ${formatPct(row.robust.medianReturn)} | ${formatPct(row.robust.winRate)} | ${formatPct(row.robust.averageExcessQqq)} | ${formatPct(row.robust.averageImprovementVsCurrent)} |`);
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
  lines.push("## Best And Worst Trades");
  lines.push("");
  lines.push("| Rule | Best | Worst |");
  lines.push("|---|---|---|");
  for (const row of result.summaries) {
    const best = row.bestTrade ? `${row.bestTrade.cohort} ${row.bestTrade.symbol} ${formatPct(row.bestTrade.return)}` : "-";
    const worst = row.worstTrade ? `${row.worstTrade.cohort} ${row.worstTrade.symbol} ${formatPct(row.worstTrade.return)}` : "-";
    lines.push(`| ${row.label} | ${best} | ${worst} |`);
  }
  lines.push("");
  lines.push("## Recent Trades");
  for (const row of result.summaries) {
    lines.push("");
    lines.push(`### ${row.label}`);
    lines.push("");
    lines.push("| Cohort | Symbol | Sector | Sell Dates | Reasons | Return | QQQ |");
    lines.push("|---|---|---|---|---|---:|---:|");
    for (const trade of row.recentTrades) {
      lines.push(`| ${trade.cohort} | ${trade.symbol} | ${trade.sector} | ${trade.sellDates.join(", ")} | ${trade.sellReasons.join(", ")} | ${formatPct(trade.return)} | ${formatPct(trade.qqqReturn)} |`);
    }
  }
  lines.push("");
  lines.push("## Interpretation Notes");
  lines.push("");
  lines.push("- Symbol dropout is intentionally strict: it asks whether leaving the weekly top two selected names should force a sale.");
  lines.push("- Group Top2 dropout is less strict than symbol dropout but still reacts quickly when a sector loses the leading slot.");
  lines.push("- Group Top5 dropout is the slower warning version: it tolerates normal sector rotation unless the group falls out of the broader leader pack.");
  lines.push("- The extension guard tests the idea that weekly dropout should manage only the extended half after month six, not the whole position before month six.");
  lines.push("- This still uses current universe membership and can contain survivorship and ticker-event distortions.");
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const source = JSON.parse(await fs.readFile(sourcePath, "utf8"));
  const strategy = (source.rankedResults ?? source.results ?? []).find((row) => row.label === strategyLabel);
  if (!strategy?.selectionTimeline?.length) {
    throw new Error(`Missing strategy timeline for ${strategyLabel}. Run monthly-buy-rule-test.mjs --years 5 --output-suffix 5y first.`);
  }

  const instruments = await buildUniverse({ sample });
  console.log(`Universe size: ${instruments.length}`);
  const { priceMap, weeklyMap, errors } = await collectPrices(instruments);
  const observations = await buildWeeklyObservations(instruments, priceMap, source);
  const trades = selectedTrades(strategy);
  console.log(`Testing ${trades.length} selected trades against ${observations.length} weekly observations.`);

  const evaluations = rules.map((rule) => ({
    rule: rule.key,
    label: rule.label,
    rows: trades.map((trade) => evaluateTrade(rule, trade, priceMap, weeklyMap, observations))
  }));
  const baselineRows = evaluations.find((entry) => entry.rule === "current_half_weekly")?.rows ?? [];
  const summaries = evaluations.map((entry) => summarize(
    rules.find((rule) => rule.key === entry.rule),
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
    consecutiveDropWeeks,
    graceWeeks,
    selectedTradeCount: trades.length,
    observationCount: observations.length,
    universeSize: instruments.length,
    priceSeriesCount: priceMap.size,
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
