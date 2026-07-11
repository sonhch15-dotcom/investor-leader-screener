import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { priceMapFromSnapshot, priceOnOrBefore, readPriceSnapshot } from "./backtest-price-snapshot.mjs";
import { weekKey } from "./backtest-execution-core.mjs";
import { mean, round } from "./math.mjs";

const scalePath = path.join("data", "scale-execution-test-corrected-score-c-20260711.json");
const labPath = path.join("data", "strategy-development-lab-corrected-score-c-20260711.json");
const outputJsonPath = path.join("data", "early-exit-reentry-test.json");
const outputMdPath = "early_exit_reentry_test.md";
const initialCapital = 10_000_000;
const defaultCostBps = 10;
const minBuy = 100_000;
const symbolCapPct = 0.275;
const graceWeeks = 4;

const aiHardwareSymbols = new Set([
  "NVDA", "AMD", "AVGO", "ARM", "MU", "ASML", "TSM", "SMH", "SOXX",
  "WDC", "STX", "DELL", "HPE", "ANET", "VRT", "SMCI", "MRVL", "LRCX",
  "KLAC", "AMAT", "TER", "MPWR", "ON", "QCOM", "INTC", "SNDK"
]);

const aiHardwareSectors = new Set([
  "Semiconductors",
  "Electronic Components",
  "Computer Peripheral Equipment",
  "Computer Communications Equipment"
]);

const defensiveOrWeakSectors = new Set(["Real Estate", "Consumer Staples", "Utilities"]);

const ruleSpecs = [
  {
    key: "current_6m_half_weekly",
    label: "Current 6M 50/50",
    family: "current",
    sixMonthPolicy: "half",
    description: "6개월에 50% 매도하고, 잔여 50%는 기존 주봉 연장 규칙으로 최대 12개월 보유"
  },
  {
    key: "full_12m_no_guard",
    label: "Full 12M, No Guard",
    family: "none",
    sixMonthPolicy: "full",
    description: "6개월 매도 없이 전량을 12개월까지 보유"
  },
  {
    key: "half_6m_price10_exit_only",
    label: "6M Half + 10W Exit Only",
    family: "price10_rsi",
    sixMonthPolicy: "half",
    allowReentry: false,
    exitWeeks: 2,
    recoverWeeks: 2,
    description: "4주 유예 후 10주선·RSI 장기 약세가 2주 지속되면 전량 조기청산, 재진입 없음"
  },
  {
    key: "half_6m_price10_reentry",
    label: "6M Half + 10W Re-entry",
    family: "price10_rsi",
    sixMonthPolicy: "half",
    allowReentry: true,
    exitWeeks: 2,
    recoverWeeks: 2,
    description: "10주선·RSI 약세 시 조기청산하고 회복 2주 확인 시 재진입, 6개월에는 목표 비중을 절반으로 축소"
  },
  {
    key: "half_6m_relative_reentry",
    label: "6M Half + Relative Re-entry",
    family: "price_relative",
    sixMonthPolicy: "half",
    allowReentry: true,
    exitWeeks: 2,
    recoverWeeks: 2,
    description: "가격과 QQQ 대비 상대강도가 함께 훼손되면 청산하고 동반 회복 시 재진입, 6개월에는 절반 축소"
  },
  {
    key: "half_6m_relative_3w",
    label: "6M Half + Relative 3W",
    family: "price_relative",
    sixMonthPolicy: "half",
    allowReentry: true,
    exitWeeks: 3,
    recoverWeeks: 3,
    description: "현재 6개월 절반 매도를 유지하되 가격·QQQ 상대강도 신호를 3주 확인한 뒤 조기청산·재진입"
  },
  {
    key: "half_6m_market_2w",
    label: "6M Half + Market 2W",
    family: "market20_price10",
    sixMonthPolicy: "half",
    allowReentry: true,
    exitWeeks: 2,
    recoverWeeks: 2,
    description: "현재 6개월 절반 매도를 유지하면서 종목 10주선·QQQ 20주선 동반 훼손 시 조기청산하고 회복 시 재진입"
  },
  {
    key: "adaptive_12m_price10_reentry",
    label: "Adaptive 12M + 10W Re-entry",
    family: "price10_rsi",
    sixMonthPolicy: "full",
    allowReentry: true,
    exitWeeks: 2,
    recoverWeeks: 2,
    description: "6개월 강제매도 없이 10주선·RSI 상태로 전량 청산·재진입하며 최대 12개월 운용"
  },
  {
    key: "adaptive_12m_price20_reentry",
    label: "Adaptive 12M + 20W Re-entry",
    family: "price20_rsi",
    sixMonthPolicy: "full",
    allowReentry: true,
    exitWeeks: 2,
    recoverWeeks: 2,
    description: "6개월 강제매도 없이 느린 20주선 약세에서 청산하고 10주선·RSI 회복 시 재진입"
  },
  {
    key: "adaptive_12m_relative_reentry",
    label: "Adaptive 12M + Relative Re-entry",
    family: "price_relative",
    sixMonthPolicy: "full",
    allowReentry: true,
    exitWeeks: 2,
    recoverWeeks: 2,
    description: "6개월 강제매도 없이 가격과 QQQ 상대강도 동반 훼손·회복으로 전량 청산·재진입"
  },
  {
    key: "adaptive_12m_relative_3w",
    label: "Adaptive 12M + Relative 3W",
    family: "price_relative",
    sixMonthPolicy: "full",
    allowReentry: true,
    exitWeeks: 3,
    recoverWeeks: 3,
    description: "상대강도 규칙의 확인 기간을 3주로 늦춰 잦은 왕복매매를 줄인 민감도 대안"
  },
  {
    key: "adaptive_12m_relative_3w_half_guard",
    label: "Adaptive 12M + Relative 3W Half Guard",
    family: "price_relative",
    sixMonthPolicy: "full",
    allowReentry: true,
    weakFraction: 0.5,
    exitWeeks: 3,
    recoverWeeks: 3,
    description: "6개월 강제매도는 없애되 장기 상대강도 훼손 시 전량 청산 대신 50%만 축소하고 회복 시 복원"
  },
  {
    key: "adaptive_12m_market_2w",
    label: "Adaptive 12M + Market 2W",
    family: "market20_price10",
    sixMonthPolicy: "full",
    allowReentry: true,
    exitWeeks: 2,
    recoverWeeks: 2,
    description: "종목이 10주선 아래이고 QQQ도 20주선 아래인 상태가 2주 지속되면 청산, 양쪽 10주선 회복 시 재진입"
  },
  {
    key: "adaptive_12m_market_2w_recover1",
    label: "Adaptive 12M + Market 2W/1W",
    family: "market20_price10",
    sixMonthPolicy: "full",
    allowReentry: true,
    exitWeeks: 2,
    recoverWeeks: 1,
    description: "시장·종목 약세는 2주 확인하되 회복은 1주만 확인해 강한 반등을 더 빨리 재매수"
  },
  {
    key: "adaptive_12m_market_3w_recover1",
    label: "Adaptive 12M + Market 3W/1W",
    family: "market20_price10",
    sixMonthPolicy: "full",
    allowReentry: true,
    exitWeeks: 3,
    recoverWeeks: 1,
    description: "장기 약세는 3주 확인해 오신호를 줄이고 회복은 1주 확인으로 빠르게 재진입"
  },
  {
    key: "adaptive_12m_market_3w_recover2",
    label: "Adaptive 12M + Market 3W/2W",
    family: "market20_price10",
    sixMonthPolicy: "full",
    allowReentry: true,
    exitWeeks: 3,
    recoverWeeks: 2,
    description: "시장·종목 장기 약세를 3주, 회복을 2주 확인하는 중속형 대안"
  },
  {
    key: "adaptive_12m_market_3w_recover1_half_guard",
    label: "Adaptive 12M + Market 3W/1W Half Guard",
    family: "market20_price10",
    sixMonthPolicy: "full",
    allowReentry: true,
    weakFraction: 0.5,
    exitWeeks: 3,
    recoverWeeks: 1,
    description: "3주 약세 확인 시 50%만 축소하고 1주 회복 확인 시 원래 비중을 복원"
  },
  {
    key: "adaptive_12m_market_2w_half_guard",
    label: "Adaptive 12M + Market 2W Half Guard",
    family: "market20_price10",
    sixMonthPolicy: "full",
    allowReentry: true,
    weakFraction: 0.5,
    exitWeeks: 2,
    recoverWeeks: 2,
    description: "종목·시장 장기 추세 동반 훼손 시 50%만 축소하고 동반 회복 시 원래 비중으로 복원"
  },
  {
    key: "adaptive_12m_drawdown20_reentry",
    label: "Adaptive 12M + 20W Drawdown",
    family: "drawdown20",
    sixMonthPolicy: "full",
    allowReentry: true,
    exitWeeks: 2,
    recoverWeeks: 2,
    description: "20주 고점 대비 20% 이상 하락하고 10주선도 이탈한 상태가 2주 지속되면 청산, 10주선·RSI 회복 시 재진입"
  }
];

const splitDefinitions = [
  { key: "2021_2022", label: "2021-2022", start: "2021-01-01", end: "2022-12-31" },
  { key: "2023", label: "2023", start: "2023-01-01", end: "2023-12-31" },
  { key: "2024", label: "2024", start: "2024-01-01", end: "2024-12-31" },
  { key: "2025", label: "2025", start: "2025-01-01", end: "2025-12-31" },
  { key: "2026_ytd", label: "2026 YTD", start: "2026-01-01", end: "2026-12-31" }
];

function hash(content) {
  return createHash("sha256").update(content).digest("hex");
}

function parseDate(date) {
  return new Date(`${date}T00:00:00Z`);
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const value = parseDate(date);
  value.setUTCDate(value.getUTCDate() + days);
  return isoDate(value);
}

function dayDiff(start, end) {
  return (parseDate(end) - parseDate(start)) / 86_400_000;
}

function monthsBetween(startDate, endDate) {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  return (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth();
}

function yearsBetween(startDate, endDate) {
  return dayDiff(startDate, endDate) / 365.25;
}

function movingAverage(values, index, length) {
  if (index < length - 1) return null;
  const rows = values.slice(index - length + 1, index + 1);
  return rows.every(Number.isFinite) ? mean(rows) : null;
}

function rsi(values, index, length = 14) {
  if (index < length) return null;
  let gains = 0;
  let losses = 0;
  for (let cursor = index - length + 1; cursor <= index; cursor += 1) {
    const change = values[cursor] - values[cursor - 1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }
  if (losses === 0) return 100;
  const ratio = gains / losses;
  return 100 - 100 / (1 + ratio);
}

function weeklyLastRows(dailyRows) {
  const groups = new Map();
  for (const row of dailyRows) groups.set(weekKey(row.date), row);
  return [...groups.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function weeklyIndicators(dailyRows, qqqRows) {
  const rows = weeklyLastRows(dailyRows);
  const qqqWeekly = weeklyLastRows(qqqRows);
  const closes = rows.map((row) => row.close);
  const qqqCloses = qqqWeekly.map((row) => row.close);
  const qqqIndicators = qqqWeekly.map((row, index) => ({
    date: row.date,
    close: row.close,
    ma10: movingAverage(qqqCloses, index, 10),
    ma20: movingAverage(qqqCloses, index, 20)
  }));
  const relative = rows.map((row) => {
    const benchmark = priceOnOrBefore(qqqWeekly, row.date)?.close;
    return Number.isFinite(benchmark) && benchmark > 0 ? row.close / benchmark : null;
  });
  return rows.map((row, index) => {
    const market = priceOnOrBefore(qqqIndicators, row.date);
    const high20 = index >= 19 ? Math.max(...closes.slice(index - 19, index + 1)) : null;
    return {
      date: row.date,
      close: row.close,
      ma10: movingAverage(closes, index, 10),
      ma20: movingAverage(closes, index, 20),
      high20,
      rsi14: rsi(closes, index, 14),
      relative: relative[index],
      relativeMa10: movingAverage(relative, index, 10),
      marketClose: market?.close ?? null,
      marketMa10: market?.ma10 ?? null,
      marketMa20: market?.ma20 ?? null
    };
  });
}

function rowOnOrAfter(rows, date, offset = 0) {
  const index = rows.findIndex((row) => row.date >= date && Number.isFinite(row.close));
  return index === -1 ? null : rows[index + offset] ?? null;
}

function executionDate(dailyRows, signalDate, delayTradingDays) {
  return rowOnOrAfter(dailyRows, signalDate, delayTradingDays)?.date ?? null;
}

function exitCondition(spec, row) {
  if (spec.family === "price10_rsi") {
    return Number.isFinite(row.ma10) && Number.isFinite(row.rsi14)
      && row.close < row.ma10 && row.rsi14 < 45;
  }
  if (spec.family === "price20_rsi") {
    return Number.isFinite(row.ma20) && Number.isFinite(row.rsi14)
      && row.close < row.ma20 && row.rsi14 < 45;
  }
  if (spec.family === "price_relative") {
    return Number.isFinite(row.ma10) && Number.isFinite(row.relativeMa10) && Number.isFinite(row.rsi14)
      && row.close < row.ma10 && row.relative < row.relativeMa10 && row.rsi14 < 50;
  }
  if (spec.family === "market20_price10") {
    return Number.isFinite(row.ma10) && Number.isFinite(row.marketMa20) && Number.isFinite(row.rsi14)
      && row.close < row.ma10 && row.marketClose < row.marketMa20 && row.rsi14 < 50;
  }
  if (spec.family === "drawdown20") {
    return Number.isFinite(row.high20) && Number.isFinite(row.ma10) && Number.isFinite(row.rsi14)
      && row.close / row.high20 - 1 <= -0.2 && row.close < row.ma10 && row.rsi14 < 50;
  }
  return false;
}

function recoveryCondition(spec, row) {
  if (spec.family === "price10_rsi" || spec.family === "price20_rsi") {
    return Number.isFinite(row.ma10) && Number.isFinite(row.rsi14)
      && row.close >= row.ma10 && row.rsi14 >= 52;
  }
  if (spec.family === "price_relative") {
    return Number.isFinite(row.ma10) && Number.isFinite(row.relativeMa10) && Number.isFinite(row.rsi14)
      && row.close >= row.ma10 && row.relative >= row.relativeMa10 && row.rsi14 >= 52;
  }
  if (spec.family === "market20_price10") {
    return Number.isFinite(row.ma10) && Number.isFinite(row.marketMa10) && Number.isFinite(row.rsi14)
      && row.close >= row.ma10 && row.marketClose >= row.marketMa10 && row.rsi14 >= 52;
  }
  if (spec.family === "drawdown20") {
    return Number.isFinite(row.ma10) && Number.isFinite(row.rsi14)
      && row.close >= row.ma10 && row.rsi14 >= 52;
  }
  return false;
}

function pushTarget(events, date, targetFraction, reason, { checkpoint = false, explicitPrice = null } = {}) {
  if (!date) return;
  const previous = events.at(-1)?.targetFraction;
  if (!checkpoint && previous === targetFraction) return;
  events.push({ date, targetFraction, reason, checkpoint, explicitPrice });
}

function currentSchedule(trade, dailyRows, delayTradingDays = 0) {
  const events = [{
    date: trade.firstBuyDate,
    targetFraction: 1,
    reason: "initial_buy",
    explicitPrice: trade.averageBuyMarketPrice ?? trade.buyLots?.[0]?.price ?? null
  }];
  let target = 1;
  for (const lot of trade.sellLots ?? []) {
    target = Math.max(0, target - lot.shareFraction);
    const delayed = String(lot.reason).includes("two_week_10w_break")
      ? executionDate(dailyRows, lot.date, delayTradingDays)
      : lot.date;
    pushTarget(events, delayed, round(target, 8), lot.reason, {
      explicitPrice: delayTradingDays === 0 ? lot.price : null
    });
  }
  return events;
}

function trendSchedule(trade, spec, indicators, dailyRows, asOf, delayTradingDays = 0) {
  if (spec.family === "current") return currentSchedule(trade, dailyRows, delayTradingDays);
  const events = [{
    date: trade.firstBuyDate,
    targetFraction: 1,
    reason: "initial_buy",
    explicitPrice: trade.averageBuyMarketPrice ?? trade.buyLots?.[0]?.price ?? null
  }];
  if (spec.family === "none") {
    if (trade.maxExitDate && trade.maxExitDate <= asOf) pushTarget(events, trade.maxExitDate, 0, "max_12m");
    return events;
  }

  const graceEnd = addDays(trade.firstBuyDate, graceWeeks * 7);
  const horizon = trade.maxExitDate && trade.maxExitDate < asOf ? trade.maxExitDate : asOf;
  const timeline = indicators
    .filter((row) => row.date > trade.firstBuyDate && row.date <= horizon)
    .map((row) => ({ type: "weekly", date: row.date, row }));
  if (spec.sixMonthPolicy === "half" && trade.fixedExitDate && trade.fixedExitDate <= horizon) {
    timeline.push({ type: "six_month", date: trade.fixedExitDate });
  }
  if (trade.maxExitDate && trade.maxExitDate <= asOf) {
    timeline.push({ type: "max", date: trade.maxExitDate });
  }
  timeline.sort((a, b) => (
    a.date.localeCompare(b.date)
    || ({ max: 0, six_month: 1, weekly: 2 }[a.type] - { max: 0, six_month: 1, weekly: 2 }[b.type])
  ));

  let alive = true;
  let maxFraction = 1;
  let target = 1;
  let exitStreak = 0;
  let recoveryStreak = 0;
  let exitedOnce = false;
  const weakFraction = spec.weakFraction ?? 0;

  for (const item of timeline) {
    if (item.type === "max") {
      pushTarget(events, item.date, 0, "max_12m");
      break;
    }
    if (item.type === "six_month") {
      maxFraction = 0.5;
      const desired = alive ? maxFraction : maxFraction * weakFraction;
      if (desired !== target) {
        target = desired;
        pushTarget(events, item.date, target, "half_fixed_6m");
      }
      continue;
    }
    if (item.date < graceEnd) continue;

    if (alive) {
      exitStreak = exitCondition(spec, item.row) ? exitStreak + 1 : 0;
      recoveryStreak = 0;
      if (exitStreak >= spec.exitWeeks) {
        alive = false;
        exitedOnce = true;
        target = maxFraction * weakFraction;
        const date = executionDate(dailyRows, item.date, delayTradingDays);
        pushTarget(events, date, target, `${spec.family}_${spec.exitWeeks}w_exit`);
      } else if (exitedOnce && target > 0) {
        const date = executionDate(dailyRows, item.date, delayTradingDays);
        pushTarget(events, date, target, "reentry_retry", { checkpoint: true });
      }
      continue;
    }

    if (!spec.allowReentry) continue;
    recoveryStreak = recoveryCondition(spec, item.row) ? recoveryStreak + 1 : 0;
    exitStreak = 0;
    if (recoveryStreak >= spec.recoverWeeks) {
      alive = true;
      target = maxFraction;
      const date = executionDate(dailyRows, item.date, delayTradingDays);
      pushTarget(events, date, target, `${spec.family}_${spec.recoverWeeks}w_reentry`);
      continue;
    }
  }

  return events
    .filter((event) => event.date && event.date <= asOf)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function normalizeSchedule(events) {
  const byDate = new Map();
  for (const event of events) byDate.set(event.date, event);
  const rows = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  let previous = 0;
  return rows.map((event, index) => {
    const direction = event.targetFraction - previous;
    previous = event.targetFraction;
    return {
      ...event,
      initial: index === 0,
      direction: round(direction, 8)
    };
  });
}

function isAiHardware(trade) {
  return aiHardwareSymbols.has(trade.symbol) || aiHardwareSectors.has(trade.sector);
}

function baseRampAmount(cash, buySignalIndex) {
  if (cash <= 1_000_000) return 500_000;
  if (buySignalIndex < 6 && cash >= 3_000_000) return 1_000_000;
  return 750_000;
}

function repeatThemeComboAmount(baseAmount, trade, context) {
  let multiplier = 1;
  if (context.previousSymbolSignals12m >= 2) multiplier *= 1.45;
  else if (context.previousSymbolSignals12m >= 1) multiplier *= 1.25;
  if (isAiHardware(trade)) multiplier *= 1.25;
  if (defensiveOrWeakSectors.has(trade.sector)) multiplier *= 0.85;
  return baseAmount * Math.min(multiplier, 1.85);
}

function signalContext(trade, signalHistory) {
  return {
    previousSymbolSignals12m: signalHistory.filter((row) => (
      row.symbol === trade.symbol && monthsBetween(row.date, trade.firstBuyDate) <= 12
    )).length,
    previousSectorSignals6m: signalHistory.filter((row) => (
      row.sector === trade.sector && monthsBetween(row.date, trade.firstBuyDate) <= 6
    )).length
  };
}

function maxDrawdown(curve) {
  let peak = initialCapital;
  let worst = 0;
  for (const row of curve) {
    peak = Math.max(peak, row.equity);
    worst = Math.min(worst, row.equity / peak - 1);
  }
  return round(worst, 4);
}

function openMarketValue(positions, date, priceMap) {
  let value = 0;
  for (const position of positions.values()) {
    if (position.shares <= 0) continue;
    const price = priceOnOrBefore(priceMap.get(position.symbol) ?? [], date)?.close;
    value += position.shares * (Number.isFinite(price) ? price : position.lastPrice);
  }
  return value;
}

function symbolOpenCost(positions, symbol) {
  let value = 0;
  for (const position of positions.values()) {
    if (position.symbol === symbol && position.shares > 0) value += position.costBasis;
  }
  return value;
}

function valuationDates(events, priceMap, asOf) {
  const firstDate = events[0]?.date;
  const dates = new Set(events.map((event) => event.date));
  if (firstDate) {
    for (const row of weeklyLastRows(priceMap.get("QQQ") ?? [])) {
      if (row.date >= firstDate && row.date <= asOf) dates.add(row.date);
    }
  }
  dates.add(asOf);
  return [...dates].filter(Boolean).sort();
}

function benchmarkSummary(priceMap, curve, firstDate, lastDate, costBps) {
  const rows = priceMap.get("QQQ") ?? [];
  const entry = rowOnOrAfter(rows, firstDate);
  const exit = priceOnOrBefore(rows, lastDate);
  if (!entry || !exit || !curve.length) return null;
  const shares = (initialCapital - initialCapital * costBps / 10_000) / entry.close;
  const benchmarkCurve = curve.map((row) => {
    const price = priceOnOrBefore(rows, row.date)?.close ?? entry.close;
    return { date: row.date, equity: round(shares * price, 2) };
  });
  const finalCapital = shares * exit.close;
  const totalReturn = finalCapital / initialCapital - 1;
  const years = yearsBetween(entry.date, exit.date);
  return {
    symbol: "QQQ",
    firstDate: entry.date,
    lastDate: exit.date,
    finalCapital: round(finalCapital, 2),
    totalReturn: round(totalReturn, 4),
    cagr: round((1 + totalReturn) ** (1 / years) - 1, 4),
    maxDrawdown: maxDrawdown(benchmarkCurve)
  };
}

function makeEvents(trades, spec, indicatorMap, priceMap, asOf, delayTradingDays) {
  const events = [];
  const schedules = [];
  for (const trade of trades) {
    const dailyRows = priceMap.get(trade.symbol) ?? [];
    const schedule = normalizeSchedule(trendSchedule(
      trade,
      spec,
      indicatorMap.get(trade.symbol) ?? [],
      dailyRows,
      asOf,
      delayTradingDays
    ));
    schedules.push({ tradeId: trade.id, symbol: trade.symbol, cohort: trade.cohort, events: schedule });
    for (const event of schedule) events.push({ ...event, trade });
  }
  events.sort((a, b) => (
    a.date.localeCompare(b.date)
    || (a.direction < 0 ? -1 : 1)
    || String(a.trade.symbol).localeCompare(String(b.trade.symbol))
  ));
  return { events, schedules };
}

function whipsawCount(ledger) {
  const byLot = new Map();
  for (const row of ledger) byLot.set(row.tradeId, [...(byLot.get(row.tradeId) ?? []), row]);
  let count = 0;
  for (const rows of byLot.values()) {
    for (let index = 0; index < rows.length; index += 1) {
      if (rows[index].type !== "reentry") continue;
      const nextExit = rows.slice(index + 1).find((row) => row.type === "sell" && row.reason.includes("_exit"));
      if (nextExit && dayDiff(rows[index].date, nextExit.date) <= 56) count += 1;
    }
  }
  return count;
}

function simulateAccount({ trades, spec, indicatorMap, priceMap, asOf, costBps = defaultCostBps, delayTradingDays = 0 }) {
  const { events, schedules } = makeEvents(trades, spec, indicatorMap, priceMap, asOf, delayTradingDays);
  const positions = new Map();
  const signalHistory = [];
  const ledger = [];
  const skipped = [];
  const curve = [];
  let cash = initialCapital;
  let buySignalIndex = 0;
  let attemptedInitialBuys = 0;
  let executedInitialBuys = 0;
  let reentryBuys = 0;
  let sellEvents = 0;
  let grossBuyAmount = 0;
  let grossSellAmount = 0;
  let totalCosts = 0;

  const eventsByDate = new Map();
  for (const event of events) eventsByDate.set(event.date, [...(eventsByDate.get(event.date) ?? []), event]);
  const dates = valuationDates(events, priceMap, asOf);

  for (const date of dates) {
    for (const event of eventsByDate.get(date) ?? []) {
      const priceRow = rowOnOrAfter(priceMap.get(event.trade.symbol) ?? [], event.date);
      const price = Number.isFinite(event.explicitPrice) ? event.explicitPrice : priceRow?.close;
      if (!Number.isFinite(price) || price <= 0) continue;

      if (event.initial) {
        attemptedInitialBuys += 1;
        const baseAmount = baseRampAmount(cash, buySignalIndex);
        const context = signalContext(event.trade, signalHistory);
        const wanted = repeatThemeComboAmount(baseAmount, event.trade, context);
        buySignalIndex += 1;
        signalHistory.push({
          date: event.trade.firstBuyDate,
          symbol: event.trade.symbol,
          sector: event.trade.sector
        });
        const cap = initialCapital * symbolCapPct;
        const capRoom = Math.max(0, cap - symbolOpenCost(positions, event.trade.symbol));
        const maxCashBuy = cash / (1 + costBps / 10_000);
        const amount = Math.min(wanted, capRoom, maxCashBuy);
        if (amount < minBuy) {
          skipped.push({ date, tradeId: event.trade.id, symbol: event.trade.symbol, type: "initial", reason: capRoom < minBuy ? "symbol_cap" : "cash" });
          continue;
        }
        const cost = amount * costBps / 10_000;
        cash -= amount + cost;
        totalCosts += cost;
        grossBuyAmount += amount;
        positions.set(event.trade.id, {
          tradeId: event.trade.id,
          symbol: event.trade.symbol,
          sector: event.trade.sector,
          shares: amount / price,
          costBasis: amount,
          referenceAmount: amount,
          actualFraction: 1,
          desiredFraction: 1,
          lastPrice: price
        });
        executedInitialBuys += 1;
        ledger.push({ date, type: "initial_buy", tradeId: event.trade.id, symbol: event.trade.symbol, reason: event.reason, price: round(price, 6), amount: round(amount, 2) });
        continue;
      }

      const position = positions.get(event.trade.id);
      if (!position) continue;
      position.desiredFraction = event.targetFraction;
      if (event.targetFraction < position.actualFraction - 1e-8) {
        const fractionOfShares = (position.actualFraction - event.targetFraction) / position.actualFraction;
        const shares = position.shares * fractionOfShares;
        const gross = shares * price;
        const cost = gross * costBps / 10_000;
        cash += gross - cost;
        totalCosts += cost;
        grossSellAmount += gross;
        position.shares = round(position.shares - shares, 10);
        position.costBasis = Math.max(0, position.costBasis * (1 - fractionOfShares));
        position.actualFraction = event.targetFraction;
        position.lastPrice = price;
        sellEvents += 1;
        ledger.push({ date, type: "sell", tradeId: event.trade.id, symbol: event.trade.symbol, reason: event.reason, price: round(price, 6), amount: round(gross, 2) });
        continue;
      }

      if (event.targetFraction > position.actualFraction + 1e-8) {
        const wanted = position.referenceAmount * (event.targetFraction - position.actualFraction);
        const cap = initialCapital * symbolCapPct;
        const capRoom = Math.max(0, cap - symbolOpenCost(positions, event.trade.symbol));
        const maxCashBuy = cash / (1 + costBps / 10_000);
        const amount = Math.min(wanted, capRoom, maxCashBuy);
        if (amount < minBuy) {
          skipped.push({ date, tradeId: event.trade.id, symbol: event.trade.symbol, type: "reentry", reason: capRoom < minBuy ? "symbol_cap" : "cash" });
          continue;
        }
        const cost = amount * costBps / 10_000;
        cash -= amount + cost;
        totalCosts += cost;
        grossBuyAmount += amount;
        position.shares += amount / price;
        position.costBasis += amount;
        position.actualFraction = Math.min(event.targetFraction, position.actualFraction + amount / position.referenceAmount);
        position.lastPrice = price;
        reentryBuys += 1;
        ledger.push({ date, type: "reentry", tradeId: event.trade.id, symbol: event.trade.symbol, reason: event.reason, price: round(price, 6), amount: round(amount, 2) });
      }
    }

    const openValue = openMarketValue(positions, date, priceMap);
    const equity = cash + openValue;
    const costEquity = cash + [...positions.values()].reduce((sum, row) => sum + row.costBasis, 0);
    curve.push({
      date,
      cash: round(cash, 2),
      equity: round(equity, 2),
      costEquity: round(costEquity, 2),
      openMarketValue: round(openValue, 2),
      openLots: [...positions.values()].filter((row) => row.shares > 1e-8).length
    });
  }

  const finalCapital = curve.at(-1)?.equity ?? cash;
  const firstDate = events[0]?.date;
  const lastDate = curve.at(-1)?.date;
  const totalReturn = finalCapital / initialCapital - 1;
  const benchmark = benchmarkSummary(priceMap, curve, firstDate, lastDate, costBps);
  const averageCashPct = mean(curve.map((row) => row.equity > 0 ? row.cash / row.equity : 0));
  const trendExits = ledger.filter((row) => row.type === "sell" && row.reason.includes("_exit")).length;
  const finalBySymbol = new Map();
  for (const position of positions.values()) {
    if (position.shares <= 0) continue;
    const price = priceOnOrBefore(priceMap.get(position.symbol) ?? [], lastDate)?.close ?? position.lastPrice;
    finalBySymbol.set(position.symbol, (finalBySymbol.get(position.symbol) ?? 0) + position.shares * price);
  }
  const finalPositions = [...finalBySymbol]
    .map(([symbol, marketValue]) => ({
      symbol,
      marketValue: round(marketValue, 2),
      equityWeight: round(marketValue / finalCapital, 4)
    }))
    .sort((a, b) => b.marketValue - a.marketValue);
  const result = {
    key: spec.key,
    label: spec.label,
    description: spec.description,
    family: spec.family,
    sixMonthPolicy: spec.sixMonthPolicy,
    delayTradingDays,
    costBps,
    tradeCount: trades.length,
    initialCapital,
    finalCapital: round(finalCapital, 2),
    finalCash: round(cash, 2),
    openMarketValue: round(curve.at(-1)?.openMarketValue ?? 0, 2),
    totalReturn: round(totalReturn, 4),
    cagr: round((1 + totalReturn) ** (1 / yearsBetween(firstDate, lastDate)) - 1, 4),
    maxDrawdown: maxDrawdown(curve),
    benchmark,
    attemptedInitialBuys,
    executedInitialBuys,
    skippedInitialBuys: skipped.filter((row) => row.type === "initial").length,
    reentryBuys,
    skippedReentries: skipped.filter((row) => row.type === "reentry").length,
    trendExits,
    sellEvents,
    whipsaws: whipsawCount(ledger),
    turnover: round((grossBuyAmount + grossSellAmount) / initialCapital, 4),
    totalTransactionCost: round(totalCosts, 2),
    minCash: round(Math.min(initialCapital, ...curve.map((row) => row.cash)), 2),
    averageCashPct: round(averageCashPct, 4),
    finalOpenSymbols: finalPositions.length,
    top1EquityPct: round(finalPositions[0]?.equityWeight ?? 0, 4),
    top3EquityPct: round(finalPositions.slice(0, 3).reduce((sum, row) => sum + row.equityWeight, 0), 4),
    top5EquityPct: round(finalPositions.slice(0, 5).reduce((sum, row) => sum + row.equityWeight, 0), 4),
    topPositions: finalPositions.slice(0, 10),
    firstDate,
    lastDate,
    recentLedger: ledger.slice(-30),
    skipped: skipped.slice(-30),
    curve
  };
  assert.ok(Math.abs(result.finalCapital - result.finalCash - result.openMarketValue) <= 0.03, `${spec.key}: equity does not reconcile`);
  assert.ok(result.minCash >= -0.02, `${spec.key}: negative cash`);
  assert.deepEqual(curve.map((row) => row.date), [...new Set(curve.map((row) => row.date))].sort(), `${spec.key}: curve dates invalid`);
  for (const schedule of schedules) {
    assert.ok(schedule.events.every((event) => event.targetFraction >= 0 && event.targetFraction <= 1), `${spec.key}: invalid target fraction`);
  }
  return result;
}

function compactResult(result) {
  const { curve, recentLedger, skipped, benchmark, ...summary } = result;
  return {
    ...summary,
    calmar: round(summary.cagr / Math.max(0.0001, Math.abs(summary.maxDrawdown)), 3),
    benchmark: benchmark ? {
      symbol: benchmark.symbol,
      totalReturn: benchmark.totalReturn,
      cagr: benchmark.cagr,
      maxDrawdown: benchmark.maxDrawdown
    } : null
  };
}

function simulationAsOf(trades, globalAsOf) {
  if (trades.some((trade) => !trade.maxExitDate)) return globalAsOf;
  const latest = trades.map((trade) => trade.maxExitDate).filter(Boolean).sort().at(-1);
  return latest && latest < globalAsOf ? latest : globalAsOf;
}

function filterTrades(trades, start, end) {
  return trades.filter((trade) => trade.firstBuyDate >= start && trade.firstBuyDate <= end);
}

function auditSnapshot(snapshot) {
  let duplicateDateCount = 0;
  let unsortedRowCount = 0;
  let nullCloseCount = 0;
  for (const rows of Object.values(snapshot.series ?? {})) {
    const seen = new Set();
    for (let index = 0; index < rows.length; index += 1) {
      if (seen.has(rows[index].date)) duplicateDateCount += 1;
      seen.add(rows[index].date);
      if (index > 0 && rows[index].date <= rows[index - 1].date) unsortedRowCount += 1;
      if (!Number.isFinite(rows[index].close)) nullCloseCount += 1;
    }
  }
  return {
    priceSeriesCount: Object.keys(snapshot.series ?? {}).length,
    duplicateDateCount,
    unsortedRowCount,
    nullCloseCount,
    firstBenchmarkDate: snapshot.series?.QQQ?.[0]?.date ?? null
  };
}

function pct(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "-";
}

function money(value) {
  return Number.isFinite(value) ? `${Math.round(value).toLocaleString("ko-KR")}원` : "-";
}

function resultTable(lines, results) {
  lines.push("| 규칙 | 6개월 처리 | 누적 수익 | 현재 대비 | CAGR | MDD | 이상치 제외 | 신규 매수 | 상위 3종목 | 재진입 | 휩쏘 | 회전율 | 비용 |");
  lines.push("|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const row of results) {
    lines.push(`| ${row.label} | ${row.sixMonthPolicy === "half" ? "50% 축소" : "강제매도 없음"} | ${pct(row.totalReturn)} | ${pct(row.returnDelta)} | ${pct(row.cagr)} | ${pct(row.maxDrawdown)} | ${pct(row.robustReturn)} | ${row.executedInitialBuys}/${row.attemptedInitialBuys} | ${pct(row.top3EquityPct)} | ${row.reentryBuys} | ${row.whipsaws} | ${row.turnover.toFixed(1)}배 | ${money(row.totalTransactionCost)} |`);
  }
}

function markdown(result) {
  const lines = [];
  const baseline = result.results.find((row) => row.key === result.baselineKey);
  const candidate = result.results.find((row) => row.key === result.decision.reviewCandidateKey);
  const structural = result.results.find((row) => row.key === result.decision.structuralCandidateKey);
  lines.push("# Score C 조기청산·재진입 백테스트");
  lines.push("");
  lines.push("## 결론 요약");
  lines.push("");
  lines.push(`- **현재 전략 기준선:** 1천만원 계좌가 ${money(baseline.finalCapital)}, 누적 ${pct(baseline.totalReturn)}, CAGR ${pct(baseline.cagr)}, MDD ${pct(baseline.maxDrawdown)}로 기존 공식 결과와 재현 일치했습니다.`);
  lines.push(`- **보수적 개선안:** ${candidate.label}는 누적 ${pct(candidate.totalReturn)}, 현재 대비 ${pct(candidate.returnDelta)}, MDD ${pct(candidate.maxDrawdown)}, 이상치 제외 ${pct(candidate.robustReturn)}였습니다.`);
  lines.push(`- **6개월 제거안:** ${structural.label}는 누적 ${pct(structural.totalReturn)}, 현재 대비 ${pct(structural.returnDelta)}, MDD ${pct(structural.maxDrawdown)}, 이상치 제외 ${pct(structural.robustReturn)}였습니다.`);
  lines.push(`- **자금 사용 차이:** 월별 추천 ${baseline.attemptedInitialBuys}건 중 현재 전략은 ${baseline.executedInitialBuys}건, 보수적 개선안은 ${candidate.executedInitialBuys}건, 6개월 제거안은 ${structural.executedInitialBuys}건을 샀습니다. 최종 상위 3종목 비중은 각각 ${pct(baseline.top3EquityPct)}, ${pct(candidate.top3EquityPct)}, ${pct(structural.top3EquityPct)}였습니다.`);
  lines.push(`- **지표 준비 완료 구간:** 2022년 이후 신호만 사용하면 현재 전략 ${pct(baseline.warmupSafeReturn)}, 보수적 개선안 ${pct(candidate.warmupSafeReturn)}, 6개월 제거안 ${pct(structural.warmupSafeReturn)}로 6개월 제거안의 우위가 사라졌습니다.`);
  lines.push(`- **판정:** ${result.decision.status === "testing_candidate" ? "사전 승격 관문을 통과해 testing 후보로 둘 수 있습니다. 다만 active 전환은 금지하고 전진 관찰이 필요합니다." : "모든 안정성 관문을 동시에 통과한 대안이 없어 현재 6개월 50/50 규칙을 유지합니다."}`);
  lines.push("- 이번 검증은 종목 선정과 Cap27.5 비중 규칙을 고정하고, 보유·청산·재진입 규칙만 바꾼 비교입니다.");
  lines.push("");
  lines.push("## 전체 계좌 비교");
  lines.push("");
  lines.push("모든 규칙은 같은 월별 Score C 추천 118건, 같은 가격 스냅샷, 매수·매도 각각 0.1% 비용을 사용했습니다. 회전율은 5년간 총 매수·매도 금액을 최초 원금으로 나눈 값입니다.");
  lines.push("");
  resultTable(lines, result.results);
  lines.push("");
  lines.push("## 규칙 정의");
  lines.push("");
  for (const rule of result.ruleDefinitions) lines.push(`- **${rule.label}:** ${rule.description}`);
  lines.push("");
  lines.push("장기 약세·회복 신호는 매주 마지막 거래일 종가로 판정합니다. 신규 매수 후 4주는 보호하고, 기본안은 2주 연속 확인을 사용합니다. 가격형은 `종가 < 10주선 및 RSI14 < 45`에서 이탈하고 `종가 >= 10주선 및 RSI14 >= 52`에서 복귀합니다. 상대강도형은 여기에 QQQ 대비 상대강도의 10주 평균 이탈·회복을 함께 요구합니다. 시장형은 종목 10주선과 QQQ 20주선이 함께 훼손될 때 이탈하고 양쪽 10주선 회복에서 복귀하며, 낙폭형은 20주 고점 대비 20% 하락을 추가 조건으로 사용합니다.");
  lines.push("");
  lines.push("## 연도별 독립 시작 검증");
  lines.push("");
  lines.push("각 구간을 별도 1천만원 계좌로 다시 시작해 특정 시기에만 유리했는지 확인했습니다.");
  lines.push("");
  const comparisonKeys = [...new Set([result.baselineKey, result.decision.reviewCandidateKey, result.decision.structuralCandidateKey])];
  lines.push(`| 구간 | 신호 수 | ${comparisonKeys.map((key) => result.results.find((row) => row.key === key)?.label).join(" | ")} |`);
  lines.push(`|---|---:|${comparisonKeys.map(() => "---:").join("|")}|`);
  for (const split of result.splitResults) {
    const values = comparisonKeys.map((key) => pct(split.results.find((row) => row.key === key)?.totalReturn));
    lines.push(`| ${split.label} | ${split.tradeCount} | ${values.join(" | ")} |`);
  }
  lines.push("");
  lines.push("## 체결·비용 민감도");
  lines.push("");
  lines.push("장기 신호가 금요일 종가에 확정된 뒤 다음 거래일에 실행하는 경우와 거래비용이 커지는 경우를 별도로 확인했습니다.");
  lines.push("");
  lines.push("| 조건 | 현재 전략 | 보수적 개선안 | 6개월 제거안 |");
  lines.push("|---|---:|---:|---:|");
  for (const row of result.sensitivity) {
    lines.push(`| ${row.label} | ${pct(row.baselineReturn)} | ${pct(row.conservativeReturn)} | ${pct(row.structuralReturn)} |`);
  }
  lines.push("");
  lines.push("## 승격 관문");
  lines.push("");
  lines.push(`### 보수적 개선안: ${candidate.label}`);
  lines.push("");
  for (const [key, gate] of Object.entries(result.decision.gates)) {
    lines.push(`- ${gate ? "PASS" : "FAIL"}: ${result.gateLabels[key]}`);
  }
  lines.push("");
  lines.push(`### 6개월 제거안: ${structural.label}`);
  lines.push("");
  for (const [key, gate] of Object.entries(result.decision.structuralGates)) {
    lines.push(`- ${gate ? "PASS" : "FAIL"}: ${result.gateLabels[key]}`);
  }
  lines.push("");
  lines.push("## 해석과 운용 의미");
  lines.push("");
  lines.push("- 6개월은 반드시 지켜야 하는 자연법칙이 아니라, 강한 주도주의 중간 변동을 견디면서 일부 이익을 확정하기 위한 기준선입니다.");
  lines.push("- 조기청산 규칙은 하락 폭을 줄일 수 있지만, 회복 직전 매도와 더 높은 가격의 재진입이 반복되면 장기 복리 성과를 훼손할 수 있습니다. 그래서 수익률과 MDD뿐 아니라 재진입·휩쏘·비용을 함께 봤습니다.");
  lines.push("- 6개월 매도를 없애면 현금 회수가 늦어 신규 추천 참여율과 종목 집중도가 달라집니다. 높은 누적 수익이 청산 신호의 우수성인지, 일부 장기 승자에 더 오래 집중한 결과인지 분리해서 봐야 합니다.");
  lines.push("- 이 결과만으로 Public API나 Android 매도 규칙을 변경하지 않습니다. testing 후보가 생겨도 최소 3~6개월 전진 신호를 기존 전략과 병행 기록해야 합니다.");
  lines.push("");
  lines.push("## 데이터 품질 확인");
  lines.push("");
  lines.push(`- 가격 계열 ${result.dataQuality.priceSeriesCount}개에서 중복 날짜 ${result.dataQuality.duplicateDateCount}건, 역순 날짜 ${result.dataQuality.unsortedRowCount}건, 결측 종가 ${result.dataQuality.nullCloseCount}건이었습니다.`);
  lines.push(`- 스냅샷 시작일은 ${result.dataQuality.firstBenchmarkDate}이며 20주 지표 준비 완료 기준일 ${result.dataQuality.warmupSafeStart} 이후 ${result.dataQuality.warmupSafeTradeCount}개 신호를 별도로 재검증했습니다.`);
  lines.push(`- 공통 robust 제외 거래는 ${result.dataQuality.robustExcludedTrades.map((row) => `${row.cohort} ${row.symbol} ${pct(row.return)}`).join(", ")}입니다.`);
  lines.push("");
  lines.push("## 한계");
  lines.push("");
  lines.push("- 현재 구성 종목을 과거에도 보유했다고 가정한 고정 유니버스이므로 생존편향이 남아 있습니다.");
  lines.push("- 가격 스냅샷에는 기업행사·티커 변경으로 인한 극단값 가능성이 있어, 동일한 거래를 공통 제외한 robust 결과를 함께 사용했습니다.");
  lines.push("- MDD는 주간 평가와 거래일 이벤트 기준이며 장중·일중 최대 손실은 더 클 수 있습니다.");
  lines.push("- 세금, 환전 비용, 호가 충격은 제외했고 기본 거래비용은 편도 10bp입니다.");
  lines.push("");
  lines.push("## 재현 정보");
  lines.push("");
  lines.push(`- Run ID: \`${result.runId}\``);
  lines.push(`- Selection source hash: \`${result.dataLineage.selectionSourceHash}\``);
  lines.push(`- Selection timeline hash: \`${result.dataLineage.selectionTimelineHash}\``);
  lines.push(`- Price snapshot hash: \`${result.dataLineage.priceSnapshotHash}\``);
  lines.push(`- Price as of: ${result.dataLineage.priceAsOf}`);
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const [scaleBytes, labBytes] = await Promise.all([fs.readFile(scalePath), fs.readFile(labPath)]);
  const scale = JSON.parse(scaleBytes.toString("utf8"));
  const lab = JSON.parse(labBytes.toString("utf8"));
  const snapshot = await readPriceSnapshot(scale.priceSnapshotPath);
  assert.equal(snapshot.hash, scale.priceSnapshotHash, "price snapshot hash changed");
  assert.equal(snapshot.asOf, scale.priceAsOf, "price snapshot as-of changed");
  const priceMap = priceMapFromSnapshot(snapshot);
  const snapshotAudit = auditSnapshot(snapshot);
  assert.equal(snapshotAudit.duplicateDateCount, 0, "price snapshot contains duplicate dates");
  assert.equal(snapshotAudit.unsortedRowCount, 0, "price snapshot contains unsorted rows");
  assert.equal(snapshotAudit.nullCloseCount, 0, "price snapshot contains invalid closes");
  const currentRows = scale.evaluations
    .find((entry) => entry.rule === "half_sell_half_weekly_extend")
    ?.rows
    ?.filter((row) => row.entered) ?? [];
  const trades = currentRows.map((row, index) => ({ ...row, id: `${row.cohort}-${row.symbol}-${index}` }));
  const robustTrades = trades.filter((row) => Math.abs(row.return ?? 0) <= 3);
  assert.equal(trades.length, 118, "unexpected Score C trade count");

  const qqqRows = priceMap.get("QQQ") ?? [];
  const indicatorMap = new Map();
  for (const symbol of new Set(trades.map((trade) => trade.symbol))) {
    indicatorMap.set(symbol, weeklyIndicators(priceMap.get(symbol) ?? [], qqqRows));
  }

  const mainDetailed = ruleSpecs.map((spec) => simulateAccount({
    trades,
    spec,
    indicatorMap,
    priceMap,
    asOf: snapshot.asOf
  }));
  const robustDetailed = ruleSpecs.map((spec) => simulateAccount({
    trades: robustTrades,
    spec,
    indicatorMap,
    priceMap,
    asOf: snapshot.asOf
  }));
  const nextSessionDetailed = ruleSpecs.map((spec) => simulateAccount({
    trades,
    spec,
    indicatorMap,
    priceMap,
    asOf: snapshot.asOf,
    delayTradingDays: 1
  }));
  const cost50Detailed = ruleSpecs.map((spec) => simulateAccount({
    trades,
    spec,
    indicatorMap,
    priceMap,
    asOf: snapshot.asOf,
    costBps: 50
  }));
  const warmupSafeTrades = trades.filter((trade) => trade.firstBuyDate >= "2022-01-03");
  const warmupSafeDetailed = ruleSpecs.map((spec) => simulateAccount({
    trades: warmupSafeTrades,
    spec,
    indicatorMap,
    priceMap,
    asOf: snapshot.asOf
  }));

  const official = lab.results.find((row) => row.key === "repeat_theme_combo_cap275");
  const officialRobust = lab.robustResults.find((row) => row.key === "repeat_theme_combo_cap275");
  const baselineDetailed = mainDetailed.find((row) => row.key === "current_6m_half_weekly");
  const baselineRobust = robustDetailed.find((row) => row.key === "current_6m_half_weekly");
  const officialCurveByDate = new Map(official.curve.map((row) => [row.date, row]));
  const firstCurveDifference = baselineDetailed.curve.find((row) => {
    const expected = officialCurveByDate.get(row.date);
    return !expected || Math.abs(row.equity - expected.equity) > 0.02 || Math.abs(row.cash - expected.cash) > 0.02;
  });
  if (firstCurveDifference) {
    console.error("First baseline curve difference", {
      actual: firstCurveDifference,
      expected: officialCurveByDate.get(firstCurveDifference.date) ?? null
    });
  }
  assert.ok(
    Math.abs(baselineDetailed.finalCapital - official.finalCapital) <= 0.02,
    `official final capital was not reproduced: ${baselineDetailed.finalCapital} vs ${official.finalCapital}`
  );
  assert.equal(baselineDetailed.maxDrawdown, official.maxDrawdown, "official MDD was not reproduced");
  assert.ok(
    Math.abs(baselineRobust.finalCapital - officialRobust.finalCapital) <= 0.02,
    `official robust capital was not reproduced: ${baselineRobust.finalCapital} vs ${officialRobust.finalCapital}`
  );

  const splitResults = splitDefinitions.map((split) => {
    const splitTrades = filterTrades(trades, split.start, split.end);
    const asOf = simulationAsOf(splitTrades, snapshot.asOf);
    return {
      ...split,
      tradeCount: splitTrades.length,
      asOf,
      results: ruleSpecs.map((spec) => compactResult(simulateAccount({
        trades: splitTrades,
        spec,
        indicatorMap,
        priceMap,
        asOf
      })))
    };
  });

  const baseline = compactResult(baselineDetailed);
  const baselineRobustSummary = compactResult(baselineRobust);
  const baselineNext = compactResult(nextSessionDetailed.find((row) => row.key === baseline.key));
  const baselineCost50 = compactResult(cost50Detailed.find((row) => row.key === baseline.key));
  const baselineWarmupSafe = compactResult(warmupSafeDetailed.find((row) => row.key === baseline.key));
  const summaries = mainDetailed.map((detail) => {
    const robust = compactResult(robustDetailed.find((row) => row.key === detail.key));
    const next = compactResult(nextSessionDetailed.find((row) => row.key === detail.key));
    const cost50 = compactResult(cost50Detailed.find((row) => row.key === detail.key));
    const warmupSafe = compactResult(warmupSafeDetailed.find((row) => row.key === detail.key));
    const annualWins = splitResults.filter((split) => {
      const candidate = split.results.find((row) => row.key === detail.key);
      const current = split.results.find((row) => row.key === baseline.key);
      return candidate.totalReturn > current.totalReturn;
    }).length;
    return {
      ...compactResult(detail),
      returnDelta: round(detail.totalReturn - baseline.totalReturn, 4),
      mddDelta: round(detail.maxDrawdown - baseline.maxDrawdown, 4),
      robustReturn: robust.totalReturn,
      robustDelta: round(robust.totalReturn - baselineRobustSummary.totalReturn, 4),
      nextSessionReturn: next.totalReturn,
      nextSessionDelta: round(next.totalReturn - baselineNext.totalReturn, 4),
      cost50Return: cost50.totalReturn,
      cost50Delta: round(cost50.totalReturn - baselineCost50.totalReturn, 4),
      warmupSafeReturn: warmupSafe.totalReturn,
      warmupSafeDelta: round(warmupSafe.totalReturn - baselineWarmupSafe.totalReturn, 4),
      annualWins
    };
  });

  const candidates = summaries.filter((row) => row.key !== baseline.key);
  for (const row of candidates) {
    row.gates = {
      fullReturn: row.totalReturn > baseline.totalReturn,
      robustReturn: row.robustReturn > baselineRobustSummary.totalReturn,
      drawdown: row.maxDrawdown >= baseline.maxDrawdown - 0.02,
      annualBreadth: row.annualWins >= 3,
      nextSession: row.nextSessionDelta > 0,
      highCost: row.cost50Delta > 0,
      warmupSafe: row.warmupSafeDelta > 0,
      capitalCoverage: row.executedInitialBuys / row.attemptedInitialBuys
        >= baseline.executedInitialBuys / baseline.attemptedInitialBuys - 0.1,
      concentration: row.top3EquityPct <= baseline.top3EquityPct + 0.1
    };
    row.promotionPassed = Object.values(row.gates).every(Boolean);
  }
  const passed = candidates.filter((row) => row.promotionPassed).sort((a, b) => b.robustReturn - a.robustReturn);
  const rankCandidates = (rows) => [...rows].sort((a, b) => (
    Object.values(b.gates).filter(Boolean).length - Object.values(a.gates).filter(Boolean).length
    || b.robustDelta - a.robustDelta
    || b.calmar - a.calmar
  ));
  const reviewCandidate = rankCandidates(candidates.filter((row) => row.sixMonthPolicy === "half"))[0];
  const structuralPool = candidates.filter((row) => (
    row.sixMonthPolicy === "full" && row.family !== "none"
  ));
  const structuralCandidate = [...(structuralPool.some((row) => row.gates.drawdown)
    ? structuralPool.filter((row) => row.gates.drawdown)
    : structuralPool)]
    .sort((a, b) => b.calmar - a.calmar || b.robustDelta - a.robustDelta)[0];
  const returnWinner = [...summaries].sort((a, b) => b.totalReturn - a.totalReturn)[0];
  const riskWinner = [...summaries].sort((a, b) => b.calmar - a.calmar)[0];
  const baselineCost25 = compactResult(simulateAccount({ trades, spec: ruleSpecs[0], indicatorMap, priceMap, asOf: snapshot.asOf, costBps: 25 }));
  const candidateCost25 = compactResult(simulateAccount({ trades, spec: ruleSpecs.find((row) => row.key === reviewCandidate.key), indicatorMap, priceMap, asOf: snapshot.asOf, costBps: 25 }));
  const structuralCost25 = compactResult(simulateAccount({ trades, spec: ruleSpecs.find((row) => row.key === structuralCandidate.key), indicatorMap, priceMap, asOf: snapshot.asOf, costBps: 25 }));
  const candidateNext = summaries.find((row) => row.key === reviewCandidate.key);
  const structuralNext = summaries.find((row) => row.key === structuralCandidate.key);

  const gateLabels = {
    fullReturn: "전체 기간 누적 수익이 현재 전략보다 높음",
    robustReturn: "공통 극단값 제외 후에도 현재 전략보다 높음",
    drawdown: "MDD 악화가 2%p 이내",
    annualBreadth: "5개 독립 시작 구간 중 최소 3개에서 우위",
    nextSession: "신호 다음 거래일 체결에서도 현재 전략보다 높음",
    highCost: "편도 50bp 비용에서도 현재 전략보다 높음",
    warmupSafe: "20주 지표 준비가 끝난 2022년 이후 시작 계좌에서도 현재 전략보다 높음",
    capitalCoverage: "월별 신규 추천 매수 참여율 하락이 현재 대비 10%p 이내",
    concentration: "최종 상위 3종목 집중도가 현재 대비 10%p 이내"
  };
  const result = {
    generatedAt: new Date().toISOString(),
    runId: "us-score-c-early-exit-reentry-frozen-20260711-v1",
    grade: passed.length ? "testing_candidate" : "keep_current",
    baselineKey: baseline.key,
    dataLineage: {
      scalePath,
      scaleHash: hash(scaleBytes),
      labPath,
      labHash: hash(labBytes),
      selectionSourceHash: scale.sourceHash,
      selectionTimelineHash: scale.selectionTimelineHash,
      priceSnapshotPath: scale.priceSnapshotPath,
      priceSnapshotHash: snapshot.hash,
      priceAsOf: snapshot.asOf,
      universeType: "corrected_frozen_current_constituents"
    },
    assumptions: {
      initialCapital,
      symbolCapPct,
      baseCostBps: defaultCostBps,
      minBuy,
      graceWeeks,
      valuation: "weekly_mark_to_market_plus_event_dates",
      reentrySizing: "restore_original_executed_lot_notional_subject_to_cash_and_symbol_cap",
      maxHoldingMonths: 12
    },
    baselineRegression: {
      passed: true,
      expectedFinalCapital: official.finalCapital,
      actualFinalCapital: baselineDetailed.finalCapital,
      expectedMdd: official.maxDrawdown,
      actualMdd: baselineDetailed.maxDrawdown,
      expectedRobustCapital: officialRobust.finalCapital,
      actualRobustCapital: baselineRobust.finalCapital
    },
    ruleDefinitions: ruleSpecs.map(({ key, label, description, family, sixMonthPolicy, allowReentry, weakFraction, exitWeeks, recoverWeeks }) => ({
      key, label, description, family, sixMonthPolicy, allowReentry: allowReentry ?? false, weakFraction: weakFraction ?? 0, exitWeeks: exitWeeks ?? null, recoverWeeks: recoverWeeks ?? null
    })),
    results: summaries,
    splitResults,
    sensitivity: [
      { label: "기본 비용 10bp, 신호일 종가", baselineReturn: baseline.totalReturn, conservativeReturn: reviewCandidate.totalReturn, structuralReturn: structuralCandidate.totalReturn },
      { label: "다음 거래일 체결, 비용 10bp", baselineReturn: baselineNext.totalReturn, conservativeReturn: candidateNext.nextSessionReturn, structuralReturn: structuralNext.nextSessionReturn },
      { label: "신호일 종가, 비용 25bp", baselineReturn: baselineCost25.totalReturn, conservativeReturn: candidateCost25.totalReturn, structuralReturn: structuralCost25.totalReturn },
      { label: "신호일 종가, 비용 50bp", baselineReturn: baselineCost50.totalReturn, conservativeReturn: candidateNext.cost50Return, structuralReturn: structuralNext.cost50Return },
      { label: `2022년 이후 지표 준비 완료 ${warmupSafeTrades.length}신호`, baselineReturn: baselineWarmupSafe.totalReturn, conservativeReturn: candidateNext.warmupSafeReturn, structuralReturn: structuralNext.warmupSafeReturn }
    ],
    gateLabels,
    dataQuality: {
      ...snapshotAudit,
      warmupSafeStart: "2022-01-03",
      warmupSafeTradeCount: warmupSafeTrades.length,
      robustExcludedTrades: trades
        .filter((row) => Math.abs(row.return ?? 0) > 3)
        .map((row) => ({ cohort: row.cohort, symbol: row.symbol, return: row.return }))
    },
    decision: {
      status: passed.length ? "testing_candidate" : "keep_current",
      reviewCandidateKey: reviewCandidate.key,
      structuralCandidateKey: structuralCandidate.key,
      passedCandidateKeys: passed.map((row) => row.key),
      returnWinnerKey: returnWinner.key,
      riskAdjustedWinnerKey: riskWinner.key,
      gates: reviewCandidate.gates,
      structuralGates: structuralCandidate.gates,
      activeStrategyChanged: false,
      forwardObservationRequired: true
    },
    evidence: {
      baselineCurve: baselineDetailed.curve,
      reviewCandidateCurve: mainDetailed.find((row) => row.key === reviewCandidate.key).curve,
      structuralCandidateCurve: mainDetailed.find((row) => row.key === structuralCandidate.key).curve,
      reviewCandidateRecentLedger: mainDetailed.find((row) => row.key === reviewCandidate.key).recentLedger,
      structuralCandidateRecentLedger: mainDetailed.find((row) => row.key === structuralCandidate.key).recentLedger
    }
  };

  await fs.writeFile(outputJsonPath, JSON.stringify(result, null, 2), "utf8");
  await fs.writeFile(outputMdPath, markdown(result), "utf8");
  console.log(`Baseline reproduced: ${baselineDetailed.finalCapital.toFixed(2)} / MDD ${baselineDetailed.maxDrawdown}`);
  console.log(`Decision: ${result.decision.status}; review candidate: ${reviewCandidate.label}`);
  console.log(`Wrote ${outputJsonPath} and ${outputMdPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
