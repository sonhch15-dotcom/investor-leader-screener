import { mean, round } from "./math.mjs";

export function rowOnOrAfter(rows, date) {
  if (!date) return null;
  return rows.find((row) => row.date >= date && Number.isFinite(row.close)) ?? null;
}

export function rowOnOrBefore(rows, date) {
  if (!date) return null;
  return rows.filter((row) => row.date <= date && Number.isFinite(row.close)).at(-1) ?? null;
}

export function rowOffsetOnOrAfter(rows, date, offset) {
  if (!date) return null;
  const index = rows.findIndex((row) => row.date >= date && Number.isFinite(row.close));
  if (index === -1) return null;
  return rows[index + offset] ?? null;
}

function rowsBetween(rows, startDate, endDate) {
  return rows.filter((row) => row.date >= startDate && row.date < endDate && Number.isFinite(row.close));
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
  for (let cursor = index - length + 1; cursor <= index; cursor += 1) {
    const change = values[cursor] - values[cursor - 1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }
  if (losses === 0) return 100;
  const ratio = gains / losses;
  return 100 - 100 / (1 + ratio);
}

export function weekKey(dateString) {
  const date = new Date(`${dateString}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-${String(week).padStart(2, "0")}`;
}

export function weeklyRows(dailyRows) {
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

function consecutiveBelow10w(rows, index) {
  return index > 0
    && Number.isFinite(rows[index].ma10)
    && Number.isFinite(rows[index - 1].ma10)
    && rows[index].close < rows[index].ma10
    && rows[index - 1].close < rows[index - 1].ma10;
}

export function weeklyExtensionExit(weekly, fixedExitDate, maxExitDate, lastAvailableDate) {
  if (!fixedExitDate) return { resolved: false, date: null, reason: "before_6m" };
  const fixedWeek = rowOnOrBefore(weekly, fixedExitDate);
  const alive = fixedWeek
    && Number.isFinite(fixedWeek.ma10)
    && Number.isFinite(fixedWeek.rsi14)
    && fixedWeek.close >= fixedWeek.ma10
    && fixedWeek.rsi14 >= 50;
  if (!alive) {
    return { resolved: true, date: fixedExitDate, reason: "trend_not_alive_at_6m" };
  }

  const scanEnd = maxExitDate ?? lastAvailableDate;
  const startIndex = weekly.findIndex((row) => row.date > fixedExitDate);
  if (startIndex !== -1) {
    for (let index = startIndex; index < weekly.length; index += 1) {
      const row = weekly[index];
      if (scanEnd && row.date > scanEnd) break;
      if (consecutiveBelow10w(weekly, index)) {
        return { resolved: true, date: row.date, reason: "two_week_10w_break" };
      }
    }
  }

  if (maxExitDate && lastAvailableDate && lastAvailableDate >= maxExitDate) {
    return { resolved: true, date: maxExitDate, reason: "max_12m" };
  }
  return { resolved: false, date: null, reason: "right_censored" };
}

function buyLots(rule, trade, dailyRows, costBps) {
  const cashPerLot = 1 / rule.buyOffsets.length;
  return rule.buyOffsets.map((offset) => {
    const row = rowOffsetOnOrAfter(dailyRows, trade.entryDate, offset);
    if (!row?.close) return null;
    const fee = cashPerLot * costBps / 10_000;
    return {
      date: row.date,
      price: row.close,
      cash: cashPerLot,
      fee,
      shares: (cashPerLot - fee) / row.close
    };
  }).filter(Boolean);
}

function fixedSellLots(rule, trade, dailyRows, totalShares) {
  if (!trade.fixedExitDate) return [];
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
  if (!trade.fixedExitDate) return [];
  const fixed = rowOffsetOnOrAfter(dailyRows, trade.fixedExitDate, 0);
  if (!fixed) return [];
  const lastAvailableDate = dailyRows.at(-1)?.date ?? null;
  const extended = weeklyExtensionExit(
    weeklyRowsForSymbol,
    trade.fixedExitDate,
    trade.maxExitDate,
    lastAvailableDate
  );
  const extendedRow = extended.resolved ? rowOnOrAfter(dailyRows, extended.date) : null;
  return [
    {
      date: fixed.date,
      price: fixed.close,
      shares: totalShares * 0.5,
      reason: "half_fixed_6m"
    },
    extendedRow ? {
      date: extendedRow.date,
      price: extendedRow.close,
      shares: totalShares * 0.5,
      reason: `half_${extended.reason}`
    } : null
  ].filter(Boolean);
}

export function evaluateTrade(rule, trade, dailyMap, weeklyMap, {
  costBps = 10,
  benchmarkSymbol = "QQQ",
  asOfDate = null
} = {}) {
  const dailyRows = dailyMap.get(trade.symbol) ?? [];
  const weeklyRowsForSymbol = weeklyMap.get(trade.symbol) ?? [];
  const buys = buyLots(rule, trade, dailyRows, costBps);
  if (buys.length !== rule.buyOffsets.length) {
    return { ...trade, rule: rule.key, label: rule.label, entered: false, reason: "missing_buy_price" };
  }

  const totalShares = buys.reduce((sum, lot) => sum + lot.shares, 0);
  const sells = rule.sellMode === "half_weekly"
    ? halfWeeklySellLots(trade, dailyRows, weeklyRowsForSymbol, totalShares)
    : fixedSellLots(rule, trade, dailyRows, totalShares);
  const soldShares = sells.reduce((sum, lot) => sum + lot.shares, 0);
  const openShares = Math.max(0, totalShares - soldShares);
  const closed = openShares <= totalShares * 1e-8;
  const grossProceeds = sells.reduce((sum, lot) => sum + lot.shares * lot.price, 0);
  const sellFee = grossProceeds * costBps / 10_000;
  const realizedProceeds = grossProceeds - sellFee;
  const markDate = asOfDate ?? dailyRows.at(-1)?.date ?? null;
  const markRow = rowOnOrBefore(dailyRows, markDate);
  const openMarketValue = markRow ? openShares * markRow.close : 0;
  const markedReturn = realizedProceeds + openMarketValue - 1;
  const netReturn = closed ? realizedProceeds - 1 : null;
  const firstBuy = buys[0];
  const lastSell = sells.at(-1) ?? null;
  const evaluationEndDate = lastSell?.date ?? markRow?.date ?? firstBuy.date;
  const benchmarkRows = dailyMap.get(benchmarkSymbol) ?? [];
  const benchmarkEntry = rowOnOrAfter(benchmarkRows, firstBuy.date);
  const benchmarkExit = rowOnOrBefore(benchmarkRows, evaluationEndDate);
  const benchmarkReturn = benchmarkEntry && benchmarkExit && benchmarkEntry.close
    ? benchmarkExit.close / benchmarkEntry.close - 1
    : null;
  const holdDays = rowsBetween(dailyRows, firstBuy.date, evaluationEndDate).length;
  const effectiveBuyPrice = buys.reduce((sum, lot) => sum + lot.cash, 0) / totalShares;
  const marketBuyPrice = buys.reduce((sum, lot) => sum + lot.price * lot.shares, 0) / totalShares;
  const averageSellPrice = soldShares > 0 ? grossProceeds / soldShares : null;

  return {
    ...trade,
    rule: rule.key,
    label: rule.label,
    entered: true,
    closed,
    censored: !closed,
    status: closed ? "closed" : sells.length ? "partially_realized" : "open",
    firstBuyDate: firstBuy.date,
    lastBuyDate: buys.at(-1).date,
    firstSellDate: sells[0]?.date ?? null,
    lastSellDate: lastSell?.date ?? null,
    evaluationEndDate,
    holdDays,
    averageBuyPrice: round(effectiveBuyPrice, 2),
    averageBuyMarketPrice: round(marketBuyPrice, 2),
    averageSellPrice: round(averageSellPrice, 2),
    return: round(netReturn, 4),
    markedReturn: round(markedReturn, 4),
    qqqReturn: round(closed ? benchmarkReturn : null, 4),
    qqqMarkedReturn: round(benchmarkReturn, 4),
    excessQqq: round(closed && Number.isFinite(benchmarkReturn) ? netReturn - benchmarkReturn : null, 4),
    openShareFraction: round(openShares / totalShares, 8),
    openMarketValue: round(openMarketValue, 6),
    markDate: markRow?.date ?? null,
    buyDates: buys.map((lot) => lot.date),
    sellDates: sells.map((lot) => lot.date),
    sellReasons: sells.map((lot) => lot.reason),
    buyLots: buys.map((lot) => ({
      date: lot.date,
      price: round(lot.price, 6),
      cashFraction: round(lot.cash, 8)
    })),
    sellLots: sells.map((lot) => ({
      date: lot.date,
      price: round(lot.price, 6),
      shareFraction: round(lot.shares / totalShares, 8),
      reason: lot.reason
    }))
  };
}
