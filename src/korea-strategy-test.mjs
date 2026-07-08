import fs from "node:fs/promises";
import path from "node:path";
import { fetchChart, syntheticChart } from "./yahoo.mjs";
import { mean, round } from "./math.mjs";

const sample = process.argv.includes("--sample");
const years = Number(valueAfter("--years") ?? 5);
const outputJsonPath = path.join("data", "korea-strategy-dashboard.json");
const outputMdPath = "korea_strategy_backtest.md";
const configPath = path.join("config", "korea-universe.json");
const initialCapital = 10_000_000;

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

function parseDate(date) {
  return new Date(`${date}T00:00:00Z`);
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addMonths(dateString, months) {
  const date = parseDate(dateString);
  const day = date.getUTCDate();
  date.setUTCMonth(date.getUTCMonth() + months);
  if (date.getUTCDate() < day) date.setUTCDate(0);
  return isoDate(date);
}

function pct(entry, exit) {
  if (!Number.isFinite(entry) || !Number.isFinite(exit) || entry === 0) return null;
  return exit / entry - 1;
}

function rowOnOrAfter(rows, date) {
  return rows.find((row) => row.date >= date && Number.isFinite(row.close)) ?? null;
}

function firstRowAfter(rows, date) {
  return rows.find((row) => row.date > date && Number.isFinite(row.close)) ?? null;
}

function rowsUntil(rows, date) {
  return rows.filter((row) => row.date <= date && Number.isFinite(row.close));
}

function clean(values) {
  return values.filter(Number.isFinite);
}

function avg(values) {
  return mean(clean(values));
}

function sma(values, length) {
  if (values.length < length) return null;
  return avg(values.slice(-length));
}

function pctReturn(closes, days) {
  if (closes.length <= days) return null;
  const current = closes.at(-1);
  const previous = closes.at(-1 - days);
  return pct(previous, current);
}

function weightedMomentum(metric) {
  const parts = [
    [metric.r1m, 0.4],
    [metric.r3m, 0.35],
    [metric.r6m, 0.25]
  ].filter(([value]) => Number.isFinite(value));
  if (!parts.length) return null;
  const weight = parts.reduce((sum, [, itemWeight]) => sum + itemWeight, 0);
  return parts.reduce((sum, [value, itemWeight]) => sum + value * itemWeight, 0) / weight;
}

function percentileRank(values, value) {
  const rows = clean(values).sort((a, b) => a - b);
  if (!rows.length || !Number.isFinite(value)) return 0;
  return rows.filter((item) => item <= value).length / rows.length;
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

function weekKey(dateString) {
  const date = parseDate(dateString);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-${String(week).padStart(2, "0")}`;
}

function movingAverage(values, index, length) {
  if (index < length - 1) return null;
  const slice = values.slice(index - length + 1, index + 1);
  if (slice.some((value) => !Number.isFinite(value))) return null;
  return avg(slice);
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

function aliveWeekly(row) {
  return row
    && Number.isFinite(row.ma10)
    && Number.isFinite(row.rsi14)
    && row.close >= row.ma10
    && row.rsi14 >= 50;
}

function consecutiveBelow10w(rows, index) {
  return index > 0
    && Number.isFinite(rows[index].ma10)
    && Number.isFinite(rows[index - 1].ma10)
    && rows[index].close < rows[index].ma10
    && rows[index - 1].close < rows[index - 1].ma10;
}

function weeklyAtOrBefore(rows, date) {
  return rows.filter((row) => row.date <= date).at(-1) ?? null;
}

function weeklyIndexAfter(rows, date) {
  const index = rows.findIndex((row) => row.date > date);
  return index === -1 ? rows.length : index;
}

function monthlySignalDates(rows, startDate, endDate) {
  const months = new Map();
  for (const row of rows) {
    if (row.date < startDate || row.date > endDate) continue;
    months.set(row.date.slice(0, 7), row.date);
  }
  return Array.from(months.values()).sort();
}

function monthlyEndDates(rows, startDate, endDate) {
  const months = new Map();
  for (const row of rows) {
    if (row.date < startDate || row.date > endDate) continue;
    months.set(row.date.slice(0, 7), row.date);
  }
  return Array.from(months.values()).sort();
}

async function collectPrices(instruments) {
  const priceMap = new Map();
  const errors = [];
  for (const [index, instrument] of instruments.entries()) {
    try {
      const rows = sample
        ? syntheticChart(instrument.symbol, 1350)
        : await fetchChart(instrument.symbol, { range: "5y", interval: "1d" });
      priceMap.set(instrument.symbol, rows);
      if ((index + 1) % 20 === 0) console.log(`Fetched Korea ${index + 1}/${instruments.length}`);
    } catch (error) {
      errors.push({ symbol: instrument.symbol, name: instrument.name, error: error.message });
    }
  }
  return { priceMap, errors };
}

function metricsAt(rows, asOf) {
  const data = rowsUntil(rows, asOf);
  if (data.length < 210) return null;
  const closes = data.map((row) => row.close);
  const highs = data.map((row) => row.high ?? row.close);
  const values = data.map((row) => row.close * (row.volume ?? 0));
  const close = closes.at(-1);
  const high52w = Math.max(...highs.slice(-252));
  const ma20 = sma(closes, 20);
  const ma50 = sma(closes, 50);
  const ma200 = sma(closes, 200);
  const avgValue20 = avg(values.slice(-20));
  const r1m = pctReturn(closes, 21);
  const r3m = pctReturn(closes, 63);
  const r6m = pctReturn(closes, 126);
  const momentum = weightedMomentum({ r1m, r3m, r6m });
  return {
    date: data.at(-1).date,
    close,
    r1m,
    r3m,
    r6m,
    momentum,
    ma20,
    ma50,
    ma200,
    ma20Distance: Number.isFinite(ma20) ? close / ma20 - 1 : null,
    above50: Number.isFinite(ma50) ? close > ma50 : false,
    above200: Number.isFinite(ma200) ? close > ma200 : false,
    high52wDistance: Number.isFinite(high52w) ? close / high52w - 1 : null,
    avgValue20
  };
}

function scoreSnapshot(instruments, priceMap, asOf, options = {}) {
  const rows = instruments
    .map((instrument) => {
      const metric = metricsAt(priceMap.get(instrument.symbol) ?? [], asOf);
      if (!metric) return null;
      return { ...instrument, metric };
    })
    .filter(Boolean);
  const momentumValues = rows.map((row) => row.metric.momentum);
  const liquidityValues = rows.map((row) => row.metric.avgValue20);

  return rows.map((row) => {
    const momentumScore = percentileRank(momentumValues, row.metric.momentum) * 55;
    const liquidityScore = percentileRank(liquidityValues, row.metric.avgValue20) * 15;
    const trendScore = (row.metric.above50 ? 10 : 0) + (row.metric.above200 ? 10 : 0);
    const highScore = Number.isFinite(row.metric.high52wDistance)
      ? Math.max(0, 10 + row.metric.high52wDistance * 40)
      : 0;
    const score = momentumScore + liquidityScore + trendScore + highScore;
    const liquidEnough = row.metric.avgValue20 >= (options.minAvgValue20 ?? 0);
    const overheated = (Number.isFinite(row.metric.r1m) && row.metric.r1m > (options.maxR1m ?? Infinity))
      || (Number.isFinite(row.metric.ma20Distance) && row.metric.ma20Distance > (options.maxMa20Distance ?? Infinity));
    const trendEnough = options.requireAbove50 ? row.metric.above50 && row.metric.above200 : row.metric.above200;
    return {
      ...row,
      score: round(score, 2),
      eligible: liquidEnough && trendEnough && !overheated && Number.isFinite(row.metric.momentum)
    };
  }).sort((a, b) => b.score - a.score);
}

function groupStats(snapshot) {
  const top20 = snapshot.filter((row) => row.eligible).slice(0, 20);
  const groups = new Map();
  for (const row of snapshot) {
    const current = groups.get(row.group) ?? [];
    current.push(row);
    groups.set(row.group, current);
  }
  return Array.from(groups, ([group, rows]) => {
    const eligible = rows.filter((row) => row.eligible);
    const topCount = top20.filter((row) => row.group === group).length;
    const averageMomentum = avg(rows.map((row) => row.metric.momentum));
    const above200Rate = rows.filter((row) => row.metric.above200).length / rows.length;
    const leadershipScore = (averageMomentum ?? 0) * 100 + topCount * 6 + above200Rate * 12 + eligible.length;
    return {
      group,
      count: rows.length,
      eligibleCount: eligible.length,
      top20Count: topCount,
      averageMomentum: round(averageMomentum, 4),
      above200Rate: round(above200Rate, 4),
      leadershipScore: round(leadershipScore, 2)
    };
  }).filter((row) => row.eligibleCount > 0).sort((a, b) => b.leadershipScore - a.leadershipScore);
}

function selectStockLeaders(snapshot, count = 2) {
  const groups = groupStats(snapshot).slice(0, count);
  return groups.map((group) => {
    const row = snapshot.find((item) => item.group === group.group && item.eligible);
    return row ? { ...compactPick(row), groupRank: groups.indexOf(group) + 1, groupScore: group.leadershipScore } : null;
  }).filter(Boolean);
}

function selectEtfLeaders(snapshot, count = 3) {
  const selected = [];
  const seenGroups = new Set();
  for (const row of snapshot.filter((item) => item.eligible)) {
    if (seenGroups.has(row.group)) continue;
    selected.push(compactPick(row));
    seenGroups.add(row.group);
    if (selected.length >= count) break;
  }
  return selected;
}

function selectTopScoring(snapshot, count = 2) {
  return snapshot.filter((row) => row.eligible).slice(0, count).map(compactPick);
}

function activeSymbols(trades, signalDate) {
  return new Set(trades
    .filter((trade) => trade.entryDate <= signalDate && (!trade.exitDate || trade.exitDate >= signalDate))
    .map((trade) => trade.symbol));
}

function removeActive(snapshot, context) {
  const active = activeSymbols(context.trades ?? [], context.signalDate);
  return snapshot.filter((row) => !active.has(row.symbol));
}

function selectStockLeadersNoRepeat(snapshot, context) {
  return selectStockLeaders(removeActive(snapshot, context), 2);
}

function selectEtfLeadersNoRepeat(snapshot, context) {
  return selectEtfLeaders(removeActive(snapshot, context), 3);
}

function selectEtfDefensive(snapshot, context) {
  if (context.marketStrong) return selectEtfLeaders(snapshot, 3);

  const defensiveGroups = new Set(["채권", "원자재", "미국 대표지수", "미국 배당"]);
  const defensive = [];
  const seenGroups = new Set();
  for (const row of snapshot.filter((item) => item.eligible && defensiveGroups.has(item.group))) {
    if (seenGroups.has(row.group)) continue;
    defensive.push(compactPick(row));
    seenGroups.add(row.group);
    if (defensive.length >= 3) break;
  }

  if (defensive.length >= 3) return defensive;
  const fallback = selectEtfLeaders(snapshot, 3);
  for (const row of fallback) {
    if (!defensive.some((item) => item.symbol === row.symbol)) defensive.push(row);
    if (defensive.length >= 3) break;
  }
  return defensive;
}

function compactPick(row) {
  return {
    symbol: row.symbol,
    name: row.name,
    group: row.group,
    score: row.score,
    close: round(row.metric.close, 2),
    r1m: round(row.metric.r1m, 4),
    r3m: round(row.metric.r3m, 4),
    r6m: round(row.metric.r6m, 4),
    momentum: round(row.metric.momentum, 4),
    above200: row.metric.above200,
    avgValue20: Math.round(row.metric.avgValue20 ?? 0),
    chart: []
  };
}

function chartSlice(rows) {
  return rows.slice(-80).map((row) => ({ date: row.date, close: round(row.close, 2) }));
}

function pullbackEntry(rows, signalDate, { maxTradingDays = 21, maDistance = 0.05 } = {}) {
  const closes = rows.map((row) => row.close);
  const startIndex = rows.findIndex((row) => row.date > signalDate && Number.isFinite(row.close));
  if (startIndex === -1) return null;
  const endIndex = Math.min(rows.length - 1, startIndex + maxTradingDays - 1);
  for (let index = startIndex; index <= endIndex; index += 1) {
    const row = rows[index];
    const previous = rows[index - 1];
    const ma20 = movingAverage(closes, index, 20);
    if (!Number.isFinite(ma20) || !previous) continue;
    const nearMa20 = row.close <= ma20 * (1 + maDistance);
    const bounced = row.close >= previous.close;
    if (nearMa20 && bounced) return row;
  }
  return null;
}

function sellEventsFor(symbol, priceRows, entryDate, entryPrice, latestDate) {
  const halfDate = addMonths(entryDate, 6);
  const maxDate = addMonths(entryDate, 12);
  if (latestDate < halfDate) return { events: [], openStatus: "6개월 전 보유중", remainingWeight: 1 };

  const halfRow = rowOnOrAfter(priceRows, halfDate);
  if (!halfRow) return { events: [], openStatus: "가격 데이터 부족", remainingWeight: 1 };

  const events = [{
    date: halfRow.date,
    reason: "6개월 50% 매도",
    weight: 0.5,
    price: round(halfRow.close, 2),
    return: round(pct(entryPrice, halfRow.close), 4)
  }];

  const weekly = weeklyRows(priceRows);
  const halfWeek = weeklyAtOrBefore(weekly, halfRow.date);
  if (!aliveWeekly(halfWeek)) {
    events.push({
      date: halfRow.date,
      reason: "주봉 미충족 잔여 50% 매도",
      weight: 0.5,
      price: round(halfRow.close, 2),
      return: round(pct(entryPrice, halfRow.close), 4)
    });
    return { events, openStatus: "청산 완료", remainingWeight: 0 };
  }

  const startIndex = weeklyIndexAfter(weekly, halfRow.date);
  for (let index = startIndex; index < weekly.length; index += 1) {
    const week = weekly[index];
    if (week.date > latestDate || week.date > maxDate) break;
    if (consecutiveBelow10w(weekly, index)) {
      const row = rowOnOrAfter(priceRows, week.date) ?? halfRow;
      events.push({
        date: row.date,
        reason: "10주선 2주 연속 이탈",
        weight: 0.5,
        price: round(row.close, 2),
        return: round(pct(entryPrice, row.close), 4)
      });
      return { events, openStatus: "청산 완료", remainingWeight: 0 };
    }
  }

  if (latestDate >= maxDate) {
    const row = rowOnOrAfter(priceRows, maxDate) ?? halfRow;
    events.push({
      date: row.date,
      reason: "최대 12개월 보유",
      weight: 0.5,
      price: round(row.close, 2),
      return: round(pct(entryPrice, row.close), 4)
    });
    return { events, openStatus: "청산 완료", remainingWeight: 0 };
  }

  return { events, openStatus: "잔여 50% 연장 보유중", remainingWeight: 0.5 };
}

function periodReturn(priceMap, symbol, startDate, endDate) {
  const rows = priceMap.get(symbol) ?? [];
  const entry = rowOnOrAfter(rows, startDate);
  const exit = rowOnOrAfter(rows, endDate);
  return entry && exit ? pct(entry.close, exit.close) : null;
}

function marketState(priceMap, signalDate) {
  const metric = metricsAt(priceMap.get("069500.KS") ?? [], signalDate);
  return {
    strong: Boolean(metric?.above200 && Number.isFinite(metric.momentum) && metric.momentum > 0),
    above200: Boolean(metric?.above200),
    momentum: round(metric?.momentum, 4)
  };
}

function buildActivePortfolioCurve(trades, priceMap, monthEnds) {
  let equity = 1;
  const curve = [];
  for (let index = 1; index < monthEnds.length; index += 1) {
    const previousDate = monthEnds[index - 1];
    const currentDate = monthEnds[index];
    const returns = [];
    for (const trade of trades) {
      const exitDate = trade.exitDate ?? currentDate;
      if (trade.entryDate > previousDate || exitDate < currentDate) continue;
      const rows = priceMap.get(trade.symbol) ?? [];
      const previous = rowOnOrAfter(rows, previousDate);
      const current = rowOnOrAfter(rows, currentDate);
      const valueReturn = previous && current ? pct(previous.close, current.close) : null;
      if (Number.isFinite(valueReturn)) returns.push(valueReturn);
    }
    const monthlyReturn = avg(returns) ?? 0;
    equity *= 1 + monthlyReturn;
    curve.push({
      month: currentDate.slice(0, 7),
      asOf: currentDate,
      activeCount: returns.length,
      monthlyReturn: round(monthlyReturn, 4),
      strategyTotalReturn: round(equity - 1, 4),
      equity: round(equity, 4)
    });
  }
  return curve;
}

function buildPlannedBuys(trades, {
  initial = initialCapital,
  rampMonths = 3,
  rampMonthlyPct = 0.30,
  normalMonthlyPct = 0.15
} = {}) {
  const byMonth = new Map();
  for (const trade of trades) {
    const rows = byMonth.get(trade.month) ?? [];
    rows.push(trade);
    byMonth.set(trade.month, rows);
  }

  return Array.from(byMonth, ([month, rows]) => ({ month, rows }))
    .sort((a, b) => a.month.localeCompare(b.month))
    .flatMap((group, monthIndex) => {
      const monthlyPct = monthIndex < rampMonths ? rampMonthlyPct : normalMonthlyPct;
      const plannedAmount = initial * monthlyPct / Math.max(1, group.rows.length);
      return group.rows.map((trade) => ({ ...trade, plannedAmount }));
    })
    .sort((a, b) => a.entryDate.localeCompare(b.entryDate) || a.symbol.localeCompare(b.symbol));
}

function openSymbolCost(lots, symbol) {
  return lots
    .filter((lot) => lot.symbol === symbol && lot.remainingShares > 0)
    .reduce((sum, lot) => sum + lot.remainingCost, 0);
}

function lotMarketValue(lot, priceMap, date) {
  if (lot.remainingShares <= 0) return 0;
  const row = rowOnOrAfter(priceMap.get(lot.symbol) ?? [], date);
  return row ? lot.remainingShares * row.close : 0;
}

function simulateCapitalAccount(strategy, priceMap, monthEnds, {
  initial = initialCapital,
  symbolCapPct = 0.225,
  minBuyAmount = 10_000
} = {}) {
  let cash = initial;
  let realizedProfit = 0;
  let nextLotId = 1;
  const lots = [];
  const pendingSells = [];
  const ledger = [];
  const curve = [];
  const plannedBuys = buildPlannedBuys(strategy.trades ?? [], { initial });
  const buyDates = Array.from(new Set(plannedBuys.map((row) => row.entryDate))).sort();
  const markDates = [...monthEnds].sort();
  let buyIndex = 0;
  let markIndex = 0;
  let skippedBuys = 0;
  let executedBuys = 0;
  let minCash = cash;

  function processSells(date) {
    pendingSells.sort((a, b) => a.date.localeCompare(b.date));
    while (pendingSells.length && pendingSells[0].date <= date) {
      const action = pendingSells.shift();
      const lot = action.lot;
      if (!lot || lot.remainingShares <= 0) continue;
      const sellShares = Math.min(lot.remainingShares, lot.originalShares * action.weight);
      if (sellShares <= 0) continue;
      const proceeds = sellShares * action.price;
      const cost = lot.entryPrice * sellShares;
      cash += proceeds;
      realizedProfit += proceeds - cost;
      lot.remainingShares -= sellShares;
      lot.remainingCost = Math.max(0, lot.remainingCost - cost);
      ledger.push({
        type: "sell",
        date: action.date,
        symbol: lot.symbol,
        name: lot.name,
        reason: action.reason,
        shares: sellShares,
        price: action.price,
        amount: proceeds,
        profit: proceeds - cost,
        return: action.return
      });
      minCash = Math.min(minCash, cash);
    }
  }

  function processBuys(date) {
    const rows = plannedBuys.filter((row) => row.entryDate === date);
    for (const trade of rows) {
      const capRemaining = Math.max(0, initial * symbolCapPct - openSymbolCost(lots, trade.symbol));
      const amount = Math.min(trade.plannedAmount, capRemaining, cash);
      if (!Number.isFinite(amount) || amount < minBuyAmount || !Number.isFinite(trade.entryPrice) || trade.entryPrice <= 0) {
        skippedBuys += 1;
        ledger.push({
          type: "skip",
          date,
          symbol: trade.symbol,
          name: trade.name,
          reason: capRemaining < minBuyAmount ? "symbol_cap" : "cash_or_price",
          plannedAmount: trade.plannedAmount,
          cash
        });
        continue;
      }

      const shares = amount / trade.entryPrice;
      cash -= amount;
      executedBuys += 1;
      const lot = {
        id: nextLotId++,
        month: trade.month,
        symbol: trade.symbol,
        name: trade.name,
        group: trade.group,
        entryDate: date,
        entryPrice: trade.entryPrice,
        investedAmount: amount,
        originalShares: shares,
        remainingShares: shares,
        remainingCost: amount
      };
      lots.push(lot);
      ledger.push({
        type: "buy",
        date,
        symbol: trade.symbol,
        name: trade.name,
        group: trade.group,
        shares,
        price: trade.entryPrice,
        amount,
        plannedAmount: trade.plannedAmount
      });
      for (const event of trade.events ?? []) {
        pendingSells.push({
          lot,
          date: event.date,
          reason: event.reason,
          weight: event.weight,
          price: event.price,
          return: event.return
        });
      }
      minCash = Math.min(minCash, cash);
    }
  }

  function mark(date) {
    const openValue = lots.reduce((sum, lot) => sum + lotMarketValue(lot, priceMap, date), 0);
    const equity = cash + openValue;
    curve.push({
      month: date.slice(0, 7),
      asOf: date,
      cash: round(cash, 2),
      openValue: round(openValue, 2),
      equity: round(equity, 2),
      totalReturn: round(equity / initial - 1, 4),
      openLotCount: lots.filter((lot) => lot.remainingShares > 0).length
    });
  }

  while (buyIndex < buyDates.length || markIndex < markDates.length || pendingSells.length) {
    const nextBuyDate = buyDates[buyIndex] ?? "9999-99-99";
    const nextMarkDate = markDates[markIndex] ?? "9999-99-99";
    pendingSells.sort((a, b) => a.date.localeCompare(b.date));
    const nextSellDate = pendingSells[0]?.date ?? "9999-99-99";
    const date = [nextBuyDate, nextMarkDate, nextSellDate].sort()[0];
    if (date === "9999-99-99") break;

    processSells(date);
    while (buyDates[buyIndex] === date) {
      processBuys(date);
      buyIndex += 1;
    }
    while (markDates[markIndex] === date) {
      mark(date);
      markIndex += 1;
    }
  }

  const lastDate = monthEnds.at(-1) ?? strategy.trades?.at(-1)?.entryDate;
  if (!curve.length || curve.at(-1).asOf !== lastDate) mark(lastDate);
  const final = curve.at(-1) ?? { equity: initial, totalReturn: 0 };
  const openLots = lots.filter((lot) => lot.remainingShares > 0);
  return {
    initialCapital: initial,
    finalCapital: round(final.equity, 2),
    totalReturn: round(final.equity / initial - 1, 4),
    cagr: round(annualizedReturn(final.equity / initial - 1, curve.length), 4),
    maxDrawdown: maxDrawdown(curve.map((row) => ({ equity: row.equity / initial }))),
    executedBuys,
    skippedBuys,
    minCash: round(minCash, 2),
    realizedProfit: round(realizedProfit, 2),
    openValue: round(final.openValue, 2),
    openLotCount: openLots.length,
    curve,
    ledger: ledger.slice(-80),
    assumptions: {
      fractionalShares: true,
      rampMonths: 3,
      rampMonthlyPct: 0.30,
      normalMonthlyPct: 0.15,
      symbolCapPct
    }
  };
}

function combineAllocations(allocations) {
  const map = new Map();
  for (const allocation of allocations) {
    if (!allocation?.symbol || !Number.isFinite(allocation.weight) || allocation.weight <= 0) continue;
    const previous = map.get(allocation.symbol) ?? { ...allocation, weight: 0 };
    previous.weight += allocation.weight;
    map.set(allocation.symbol, previous);
  }
  const rows = Array.from(map.values());
  const total = rows.reduce((sum, row) => sum + row.weight, 0);
  if (!total) return [];
  return rows.map((row) => ({ ...row, weight: row.weight / total }));
}

function weightedPick(row, weight) {
  return row ? { ...compactPick(row), weight } : null;
}

function topUniqueGroups(snapshot, count, filter = () => true) {
  const selected = [];
  const seenGroups = new Set();
  for (const row of snapshot.filter((item) => item.eligible && filter(item))) {
    if (seenGroups.has(row.group)) continue;
    selected.push(row);
    seenGroups.add(row.group);
    if (selected.length >= count) break;
  }
  return selected;
}

function fallbackEtf(snapshot, symbols) {
  for (const symbol of symbols) {
    const row = snapshot.find((item) => item.symbol === symbol);
    if (row) return row;
  }
  return snapshot[0] ?? null;
}

function bestByGroups(snapshot, groups, count = 1) {
  return topUniqueGroups(snapshot, count, (row) => groups.has(row.group));
}

function selectRebalanceTopN(snapshot, count) {
  const picks = topUniqueGroups(snapshot, count);
  return combineAllocations(picks.map((row) => weightedPick(row, 1 / Math.max(1, picks.length))));
}

function selectAbsoluteMomentumEtfs(snapshot) {
  const picks = topUniqueGroups(snapshot, 3, (row) => row.metric.momentum > 0 && row.metric.r3m > 0);
  if (picks.length) return combineAllocations(picks.map((row) => weightedPick(row, 1 / picks.length)));
  const fallback = fallbackEtf(snapshot, ["153130.KS", "114260.KS", "148070.KS"]);
  return combineAllocations([weightedPick(fallback, 1)]);
}

function selectCoreSatelliteEtfs(snapshot) {
  return selectCoreSatelliteWithWeights(snapshot, { core: 0.5, satellite: 0.3, defensive: 0.2 });
}

function selectCoreSatelliteWithWeights(snapshot, weights) {
  const coreGroups = new Set(["미국 대표지수", "미국 성장주"]);
  const satelliteExcludes = new Set(["미국 대표지수", "미국 성장주", "미국 배당", "채권", "원자재"]);
  const defensiveGroups = new Set(["채권", "원자재", "미국 배당"]);
  const core = bestByGroups(snapshot, coreGroups, 1)[0] ?? fallbackEtf(snapshot, ["360750.KS", "133690.KS"]);
  const satellite = topUniqueGroups(snapshot, 1, (row) => !satelliteExcludes.has(row.group))[0] ?? core;
  const defensive = bestByGroups(snapshot, defensiveGroups, 1)[0] ?? fallbackEtf(snapshot, ["153130.KS", "132030.KS"]);
  return combineAllocations([
    weightedPick(core, weights.core),
    weightedPick(satellite, weights.satellite),
    weightedPick(defensive, weights.defensive)
  ]);
}

function strongMetric(priceMap, symbol, signalDate) {
  const metric = metricsAt(priceMap.get(symbol) ?? [], signalDate);
  return Boolean(metric?.above200 && Number.isFinite(metric.momentum) && metric.momentum > 0);
}

function selectRiskManagedEtfs(snapshot, context) {
  const kospiStrong = strongMetric(context.priceMap, "069500.KS", context.signalDate);
  const nasdaqStrong = strongMetric(context.priceMap, "133690.KS", context.signalDate);
  const defensiveGroups = new Set(["채권", "원자재", "미국 배당"]);
  const usGroups = new Set(["미국 대표지수", "미국 성장주", "미국 배당"]);

  if (!kospiStrong && !nasdaqStrong) {
    const defensive = bestByGroups(snapshot, defensiveGroups, 2);
    const fallback = defensive.length ? defensive : [fallbackEtf(snapshot, ["153130.KS", "114260.KS"])];
    return combineAllocations(fallback.map((row) => weightedPick(row, 1 / fallback.length)));
  }

  if (!kospiStrong && nasdaqStrong) {
    const us = bestByGroups(snapshot, usGroups, 2);
    const defensive = bestByGroups(snapshot, defensiveGroups, 1)[0] ?? fallbackEtf(snapshot, ["153130.KS"]);
    return combineAllocations([
      ...us.map((row) => weightedPick(row, 0.35)),
      weightedPick(defensive, 0.3)
    ]);
  }

  return selectRebalanceTopN(snapshot, 3);
}

function portfolioValue(holdings, cash, priceMap, date) {
  let value = cash;
  for (const [symbol, shares] of holdings) {
    const row = rowOnOrAfter(priceMap.get(symbol) ?? [], date);
    if (row) value += shares * row.close;
  }
  return value;
}

function nextTradeDateForAllocations(allocations, priceMap, signalDate) {
  const dates = allocations
    .map((allocation) => firstRowAfter(priceMap.get(allocation.symbol) ?? [], signalDate)?.date)
    .filter(Boolean)
    .sort();
  return dates[0] ?? null;
}

function simulateEtfRebalanceStrategy({
  key,
  label,
  description,
  instruments,
  priceMap,
  signalDates,
  monthEnds,
  benchmarkSymbol,
  selectWeights,
  minAvgValue20 = 1_000_000_000,
  initial = initialCapital
}) {
  const timeline = [];
  const rebalancePlans = [];
  const holdings = new Map();
  let cash = initial;
  let executedBuys = 0;
  let skippedBuys = 0;
  const ledger = [];
  const curve = [];

  for (const signalDate of signalDates) {
    const snapshot = scoreSnapshot(instruments, priceMap, signalDate, { minAvgValue20 });
    const allocations = combineAllocations(selectWeights(snapshot, { signalDate, priceMap }));
    const tradeDate = nextTradeDateForAllocations(allocations, priceMap, signalDate);
    const rows = allocations.map((allocation) => ({ ...allocation, chart: chartSlice(priceMap.get(allocation.symbol) ?? []) }));
    timeline.push({
      month: signalDate.slice(0, 7),
      signalDate,
      tradeDate,
      leaders: groupStats(snapshot).slice(0, 5),
      rows
    });
    if (tradeDate && allocations.length) rebalancePlans.push({ tradeDate, signalDate, allocations });
  }

  let rebalanceIndex = 0;
  for (const markDate of monthEnds) {
    while (rebalanceIndex < rebalancePlans.length && rebalancePlans[rebalanceIndex].tradeDate <= markDate) {
      const plan = rebalancePlans[rebalanceIndex];
      const equity = portfolioValue(holdings, cash, priceMap, plan.tradeDate);
      holdings.clear();
      cash = equity;
      for (const allocation of plan.allocations) {
        const row = rowOnOrAfter(priceMap.get(allocation.symbol) ?? [], plan.tradeDate);
        if (!row || row.close <= 0) {
          skippedBuys += 1;
          continue;
        }
        const amount = equity * allocation.weight;
        const shares = amount / row.close;
        holdings.set(allocation.symbol, shares);
        cash -= amount;
        executedBuys += 1;
        ledger.push({
          type: "rebalance",
          date: plan.tradeDate,
          symbol: allocation.symbol,
          name: allocation.name,
          group: allocation.group,
          weight: round(allocation.weight, 4),
          amount: round(amount, 2),
          price: round(row.close, 2)
        });
      }
      rebalanceIndex += 1;
    }
    const equity = portfolioValue(holdings, cash, priceMap, markDate);
    curve.push({
      month: markDate.slice(0, 7),
      asOf: markDate,
      cash: round(cash, 2),
      openValue: round(equity - cash, 2),
      equity: round(equity, 2),
      totalReturn: round(equity / initial - 1, 4),
      openLotCount: holdings.size
    });
  }

  const final = curve.at(-1) ?? { equity: initial, totalReturn: 0, openValue: 0 };
  const totalReturn = final.equity / initial - 1;
  const benchmarkReturn = periodReturn(priceMap, benchmarkSymbol, monthEnds[0], monthEnds.at(-1));
  const currentPicks = timeline.at(-1)?.rows ?? [];
  const capitalAccount = {
    initialCapital: initial,
    finalCapital: round(final.equity, 2),
    totalReturn: round(totalReturn, 4),
    cagr: round(annualizedReturn(totalReturn, curve.length), 4),
    maxDrawdown: maxDrawdown(curve.map((row) => ({ equity: row.equity / initial }))),
    executedBuys,
    skippedBuys,
    minCash: round(Math.min(...curve.map((row) => row.cash), initial), 2),
    realizedProfit: null,
    openValue: round(final.openValue, 2),
    openLotCount: holdings.size,
    curve,
    ledger: ledger.slice(-80),
    assumptions: {
      fractionalShares: true,
      monthlyRebalance: true,
      initialCapital: initial
    }
  };

  return {
    key,
    label,
    description,
    benchmarkSymbol,
    months: timeline.length,
    currentPicks,
    currentLeaders: timeline.at(-1)?.leaders ?? [],
    timeline,
    trades: [],
    realizedTrades: [],
    openTrades: [],
    summary: {
      tradeCount: rebalancePlans.length,
      realizedCount: 0,
      openCount: holdings.size,
      averageReturn: round(totalReturn, 4),
      averageBenchmarkReturn: round(benchmarkReturn, 4),
      averageExcessBenchmark: round(totalReturn - benchmarkReturn, 4),
      winRate: null,
      totalReturn: round(totalReturn, 4),
      cagr: round(annualizedReturn(totalReturn, curve.length), 4),
      maxDrawdown: capitalAccount.maxDrawdown
    },
    capitalAccount,
    curve: curve.map((row) => ({
      month: row.month,
      asOf: row.asOf,
      activeCount: row.openLotCount,
      monthlyReturn: null,
      strategyTotalReturn: row.totalReturn,
      equity: round(row.equity / initial, 4)
    }))
  };
}

function simulateStrategy({
  key,
  label,
  instruments,
  priceMap,
  signalDates,
  monthEnds,
  latestDate,
  benchmarkSymbol,
  select,
  minAvgValue20 = 1_000_000_000,
  snapshotOptions = {},
  entryRule = null,
  marketFilter = false,
  description = ""
}) {
  const timeline = [];
  const trades = [];
  for (const signalDate of signalDates) {
    const snapshot = scoreSnapshot(instruments, priceMap, signalDate, {
      minAvgValue20,
      ...snapshotOptions
    });
    const market = marketState(priceMap, signalDate);
    const selected = marketFilter && !market.strong
      ? []
      : select(snapshot, { trades, signalDate, priceMap, marketStrong: market.strong, market });
    timeline.push({
      month: signalDate.slice(0, 7),
      signalDate,
      market,
      leaders: groupStats(snapshot).slice(0, 5),
      rows: selected
    });

    for (const pick of selected) {
      const rows = priceMap.get(pick.symbol) ?? [];
      const entry = entryRule ? entryRule(rows, signalDate, pick) : firstRowAfter(rows, signalDate);
      if (!entry) continue;
      const { events, openStatus, remainingWeight } = sellEventsFor(pick.symbol, rows, entry.date, entry.close, latestDate);
      const realizedWeight = events.reduce((sum, event) => sum + event.weight, 0);
      const realizedReturn = events.length
        ? events.reduce((sum, event) => sum + event.return * event.weight, 0) / Math.max(0.01, realizedWeight)
        : null;
      const lastEvent = events.at(-1);
      const benchmarkReturn = lastEvent
        ? periodReturn(priceMap, benchmarkSymbol, entry.date, lastEvent.date)
        : null;
      const excessBenchmark = Number.isFinite(realizedReturn) && Number.isFinite(benchmarkReturn)
        ? realizedReturn - benchmarkReturn
        : null;
      const current = rows.at(-1);
      trades.push({
        month: signalDate.slice(0, 7),
        signalDate,
        entryDate: entry.date,
        symbol: pick.symbol,
        name: pick.name,
        group: pick.group,
        entryPrice: round(entry.close, 2),
        currentPrice: round(current?.close, 2),
        currentReturn: round(pct(entry.close, current?.close), 4),
        exitDate: lastEvent?.date ?? null,
        status: openStatus,
        remainingWeight,
        events,
        realizedReturn: round(realizedReturn, 4),
        benchmarkReturn: round(benchmarkReturn, 4),
        excessBenchmark: round(excessBenchmark, 4)
      });
    }
  }

  const realized = trades.filter((row) => row.realizedReturn !== null && row.remainingWeight === 0);
  const curve = buildActivePortfolioCurve(trades, priceMap, monthEnds);

  const currentPicks = timeline.at(-1)?.rows.map((row) => ({
    ...row,
    chart: chartSlice(priceMap.get(row.symbol) ?? [])
  })) ?? [];
  const baseStrategy = {
    trades,
    curve
  };
  const capitalAccount = simulateCapitalAccount(baseStrategy, priceMap, monthEnds);

  return {
    key,
    label,
    description,
    benchmarkSymbol,
    months: timeline.length,
    currentPicks,
    currentLeaders: timeline.at(-1)?.leaders ?? [],
    timeline,
    trades,
    realizedTrades: realized,
    openTrades: trades.filter((row) => row.remainingWeight > 0),
    summary: {
      tradeCount: trades.length,
      realizedCount: realized.length,
      openCount: trades.filter((row) => row.remainingWeight > 0).length,
      averageReturn: round(avg(realized.map((row) => row.realizedReturn)), 4),
      averageBenchmarkReturn: round(avg(realized.map((row) => row.benchmarkReturn)), 4),
      averageExcessBenchmark: round(avg(realized.map((row) => row.excessBenchmark)), 4),
      winRate: round(realized.filter((row) => row.realizedReturn > 0).length / Math.max(1, realized.length), 4),
      totalReturn: round(curve.at(-1)?.strategyTotalReturn, 4),
      cagr: round(annualizedReturn(curve.at(-1)?.strategyTotalReturn, curve.length), 4),
      maxDrawdown: maxDrawdown(curve)
    },
    capitalAccount,
    curve
  };
}

function pctText(value) {
  if (!Number.isFinite(value)) return "-";
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
}

function markdownReport(result) {
  const lines = [];
  lines.push("# Korea Strategy Backtest");
  lines.push("");
  lines.push(`Generated: ${result.generatedAt}`);
  lines.push(`As of: ${result.asOf}`);
  lines.push("");
  lines.push("## Caveat");
  lines.push("");
  lines.push("- This is a first-pass Korea universe test using current blue-chip stocks and major ETFs. It can contain survivorship bias.");
  lines.push("- Costs, taxes, dividend withholding, pension account restrictions, and live execution slippage are not fully modeled.");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| Strategy | Trades | Realized | Open | Avg Return | Benchmark | Excess | Win Rate | Portfolio Curve | MDD | 10M Account | Account MDD | Skips |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const strategy of result.strategies) {
    const s = strategy.summary;
    const account = strategy.capitalAccount ?? {};
    lines.push(`| ${strategy.label} | ${s.tradeCount} | ${s.realizedCount} | ${s.openCount} | ${pctText(s.averageReturn)} | ${pctText(s.averageBenchmarkReturn)} | ${pctText(s.averageExcessBenchmark)} | ${pctText(s.winRate)} | ${pctText(s.totalReturn)} | ${pctText(s.maxDrawdown)} | ${pctText(account.totalReturn)} | ${pctText(account.maxDrawdown)} | ${account.skippedBuys ?? "-"} |`);
  }
  lines.push("");
  lines.push("## 10M KRW Account Assumptions");
  lines.push("");
  lines.push("- Initial capital: 10,000,000 KRW.");
  lines.push("- Fractional shares are allowed, so high-priced Korean stocks can be bought by amount.");
  lines.push("- First 3 months: deploy up to 30% of initial capital per month, split equally across that month's picks.");
  lines.push("- After month 3: deploy up to 15% of initial capital per month, split equally across that month's picks.");
  lines.push("- Per-symbol original-cost cap: 22.5% of initial capital.");
  lines.push("- Sells follow the existing rule: sell 50% after 6 months, keep/sell the rest by weekly trend.");
  lines.push("");
  lines.push("## Current Picks");
  for (const strategy of result.strategies) {
    lines.push("");
    lines.push(`### ${strategy.label}`);
    for (const row of strategy.currentPicks) {
      lines.push(`- ${row.symbol} ${row.name} / ${row.group}: score ${row.score}, 1M ${pctText(row.r1m)}, 3M ${pctText(row.r3m)}, 6M ${pctText(row.r6m)}`);
    }
  }
  return lines.join("\n");
}

async function main() {
  const config = JSON.parse(await fs.readFile(configPath, "utf8"));
  const stocks = config.stocks.map((row) => ({ ...row, type: "stock" }));
  const etfs = config.etfs.map((row) => ({ ...row, type: "etf" }));
  const benchmarks = config.benchmarks.map((row) => ({ ...row, type: "benchmark" }));
  const unique = new Map();
  for (const instrument of [...stocks, ...etfs, ...benchmarks]) unique.set(instrument.symbol, instrument);

  const { priceMap, errors } = await collectPrices(Array.from(unique.values()));
  const benchmarkRows = priceMap.get("069500.KS") ?? Array.from(priceMap.values()).find((rows) => rows.length);
  if (!benchmarkRows?.length) throw new Error("No Korea benchmark data available.");

  const asOf = benchmarkRows.at(-1).date;
  const start = new Date(parseDate(asOf));
  start.setUTCFullYear(start.getUTCFullYear() - years);
  const signalDates = monthlySignalDates(benchmarkRows, isoDate(start), asOf);
  const monthEnds = monthlyEndDates(benchmarkRows, isoDate(start), asOf);
  const stockUniverse = stocks.filter((row) => priceMap.has(row.symbol));
  const kospiStockUniverse = stockUniverse.filter((row) => row.symbol.endsWith(".KS"));
  const etfUniverse = etfs.filter((row) => priceMap.has(row.symbol));
  const baseArgs = { priceMap, signalDates, monthEnds, latestDate: asOf };

  const stockStrategy = simulateStrategy({
    key: "kr_stocks",
    label: "한국 우량주 Leader2",
    instruments: stocks.filter((row) => priceMap.has(row.symbol)),
    priceMap,
    signalDates,
    monthEnds,
    latestDate: asOf,
    benchmarkSymbol: "069500.KS",
    minAvgValue20: 5_000_000_000,
    select: (snapshot) => selectStockLeaders(snapshot, 2)
  });

  const etfStrategy = simulateStrategy({
    key: "kr_etfs",
    label: "한국 ETF Rotation3",
    instruments: etfs.filter((row) => priceMap.has(row.symbol)),
    priceMap,
    signalDates,
    monthEnds,
    latestDate: asOf,
    benchmarkSymbol: "133690.KS",
    select: (snapshot) => selectEtfLeaders(snapshot, 3)
  });

  const extraStrategies = [
    simulateStrategy({
      ...baseArgs,
      key: "kr_stock_market_filter",
      label: "KR Stock Market Filter",
      description: "Base stock strategy, but no new buys when KODEX 200 is below 200D or momentum is negative.",
      instruments: stockUniverse,
      benchmarkSymbol: "069500.KS",
      minAvgValue20: 5_000_000_000,
      marketFilter: true,
      select: (snapshot) => selectStockLeaders(snapshot, 2)
    }),
    simulateStrategy({
      ...baseArgs,
      key: "kr_stock_no_repeat",
      label: "KR Stock No Repeat",
      description: "Base stock strategy, but skip symbols already held by previous monthly lots.",
      instruments: stockUniverse,
      benchmarkSymbol: "069500.KS",
      minAvgValue20: 5_000_000_000,
      select: selectStockLeadersNoRepeat
    }),
    simulateStrategy({
      ...baseArgs,
      key: "kr_stock_overheat_filter",
      label: "KR Stock Overheat Filter",
      description: "Base stock strategy, but exclude stocks with 1M return over 80% or price more than 35% above the 20D average.",
      instruments: stockUniverse,
      benchmarkSymbol: "069500.KS",
      minAvgValue20: 5_000_000_000,
      snapshotOptions: { maxR1m: 0.8, maxMa20Distance: 0.35 },
      select: (snapshot) => selectStockLeaders(snapshot, 2)
    }),
    simulateStrategy({
      ...baseArgs,
      key: "kr_stock_pullback_entry",
      label: "KR Stock Pullback Entry",
      description: "Base stock selection, but enter only if price pulls back near the 20D average and bounces within 21 trading days.",
      instruments: stockUniverse,
      benchmarkSymbol: "069500.KS",
      minAvgValue20: 5_000_000_000,
      entryRule: (rows, signalDate) => pullbackEntry(rows, signalDate),
      select: (snapshot) => selectStockLeaders(snapshot, 2)
    }),
    simulateStrategy({
      ...baseArgs,
      key: "kr_stock_kospi_only",
      label: "KR Stock KOSPI Only",
      description: "KOSPI names only, to check whether results depend too much on KOSDAQ leaders.",
      instruments: kospiStockUniverse,
      benchmarkSymbol: "069500.KS",
      minAvgValue20: 5_000_000_000,
      select: (snapshot) => selectStockLeaders(snapshot, 2)
    }),
    simulateStrategy({
      ...baseArgs,
      key: "kr_stock_top_score2",
      label: "KR Stock Top Score2",
      description: "Top 2 individual scores without group diversification.",
      instruments: stockUniverse,
      benchmarkSymbol: "069500.KS",
      minAvgValue20: 5_000_000_000,
      select: (snapshot) => selectTopScoring(snapshot, 2)
    }),
    simulateStrategy({
      ...baseArgs,
      key: "kr_etf_defensive",
      label: "KR ETF Defensive Rotation",
      description: "ETF rotation, but when KODEX 200 is weak, prefer bonds, commodities, dividends, or broad US ETFs.",
      instruments: etfUniverse,
      benchmarkSymbol: "133690.KS",
      select: selectEtfDefensive
    }),
    simulateStrategy({
      ...baseArgs,
      key: "kr_etf_no_repeat",
      label: "KR ETF No Repeat",
      description: "ETF rotation, but skip ETFs already held by previous monthly lots.",
      instruments: etfUniverse,
      benchmarkSymbol: "133690.KS",
      select: selectEtfLeadersNoRepeat
    }),
    simulateStrategy({
      ...baseArgs,
      key: "kr_etf_pullback_entry",
      label: "KR ETF Pullback Entry",
      description: "ETF rotation, but enter only after a 20D-average pullback and bounce within 21 trading days.",
      instruments: etfUniverse,
      benchmarkSymbol: "133690.KS",
      entryRule: (rows, signalDate) => pullbackEntry(rows, signalDate),
      select: (snapshot) => selectEtfLeaders(snapshot, 3)
    }),
    simulateStrategy({
      ...baseArgs,
      key: "kr_etf_top2",
      label: "KR ETF Top2 Concentrated",
      description: "More concentrated ETF rotation with only two ETF groups per month.",
      instruments: etfUniverse,
      benchmarkSymbol: "133690.KS",
      select: (snapshot) => selectEtfLeaders(snapshot, 2)
    }),
    simulateStrategy({
      ...baseArgs,
      key: "kr_etf_top4",
      label: "KR ETF Top4 Diversified",
      description: "More diversified ETF rotation with four ETF groups per month.",
      instruments: etfUniverse,
      benchmarkSymbol: "133690.KS",
      select: (snapshot) => selectEtfLeaders(snapshot, 4)
    })
  ];

  const etfRebalanceStrategies = [
    simulateEtfRebalanceStrategy({
      ...baseArgs,
      key: "kr_etf_rebalance_top2",
      label: "KR ETF Rebalance Top2",
      description: "Monthly rebalance 100% of the account into the top 2 ETF groups, 50/50.",
      instruments: etfUniverse,
      benchmarkSymbol: "133690.KS",
      selectWeights: (snapshot) => selectRebalanceTopN(snapshot, 2)
    }),
    simulateEtfRebalanceStrategy({
      ...baseArgs,
      key: "kr_etf_rebalance_top3",
      label: "KR ETF Rebalance Top3",
      description: "Monthly rebalance 100% of the account into the top 3 ETF groups, equal weight.",
      instruments: etfUniverse,
      benchmarkSymbol: "133690.KS",
      selectWeights: (snapshot) => selectRebalanceTopN(snapshot, 3)
    }),
    simulateEtfRebalanceStrategy({
      ...baseArgs,
      key: "kr_etf_absolute_momentum",
      label: "KR ETF Absolute Momentum",
      description: "Monthly rebalance into top ETFs only when absolute momentum is positive. If none qualify, move to short/bond ETFs.",
      instruments: etfUniverse,
      benchmarkSymbol: "133690.KS",
      selectWeights: selectAbsoluteMomentumEtfs
    }),
    simulateEtfRebalanceStrategy({
      ...baseArgs,
      key: "kr_etf_core_satellite",
      label: "KR ETF Core Satellite",
      description: "Monthly 50% US core, 30% strongest satellite ETF, 20% defensive ETF.",
      instruments: etfUniverse,
      benchmarkSymbol: "133690.KS",
      selectWeights: selectCoreSatelliteEtfs
    }),
    simulateEtfRebalanceStrategy({
      ...baseArgs,
      key: "kr_etf_core_satellite_60_30_10",
      label: "KR ETF Core Satellite 60/30/10",
      description: "Monthly 60% US core, 30% strongest satellite ETF, 10% defensive ETF.",
      instruments: etfUniverse,
      benchmarkSymbol: "133690.KS",
      selectWeights: (snapshot) => selectCoreSatelliteWithWeights(snapshot, { core: 0.6, satellite: 0.3, defensive: 0.1 })
    }),
    simulateEtfRebalanceStrategy({
      ...baseArgs,
      key: "kr_etf_core_satellite_50_40_10",
      label: "KR ETF Core Satellite 50/40/10",
      description: "Monthly 50% US core, 40% strongest satellite ETF, 10% defensive ETF.",
      instruments: etfUniverse,
      benchmarkSymbol: "133690.KS",
      selectWeights: (snapshot) => selectCoreSatelliteWithWeights(snapshot, { core: 0.5, satellite: 0.4, defensive: 0.1 })
    }),
    simulateEtfRebalanceStrategy({
      ...baseArgs,
      key: "kr_etf_core_satellite_70_20_10",
      label: "KR ETF Core Satellite 70/20/10",
      description: "Monthly 70% US core, 20% strongest satellite ETF, 10% defensive ETF.",
      instruments: etfUniverse,
      benchmarkSymbol: "133690.KS",
      selectWeights: (snapshot) => selectCoreSatelliteWithWeights(snapshot, { core: 0.7, satellite: 0.2, defensive: 0.1 })
    }),
    simulateEtfRebalanceStrategy({
      ...baseArgs,
      key: "kr_etf_core_satellite_40_40_20",
      label: "KR ETF Core Satellite 40/40/20",
      description: "Monthly 40% US core, 40% strongest satellite ETF, 20% defensive ETF.",
      instruments: etfUniverse,
      benchmarkSymbol: "133690.KS",
      selectWeights: (snapshot) => selectCoreSatelliteWithWeights(snapshot, { core: 0.4, satellite: 0.4, defensive: 0.2 })
    }),
    simulateEtfRebalanceStrategy({
      ...baseArgs,
      key: "kr_etf_risk_managed",
      label: "KR ETF Risk Managed",
      description: "Monthly ETF rotation with KOSPI/Nasdaq regime filter. Weak regimes move toward bond, gold, dividend, or broad US ETFs.",
      instruments: etfUniverse,
      benchmarkSymbol: "133690.KS",
      selectWeights: selectRiskManagedEtfs
    })
  ];

  const result = {
    generatedAt: new Date().toISOString(),
    asOf,
    years,
    universe: {
      stockCount: stocks.length,
      etfCount: etfs.length,
      fetchedCount: priceMap.size,
      errorCount: errors.length,
      errors
    },
    note: "First-pass Korea test. Current blue-chip and ETF universe can introduce survivorship bias.",
    strategies: [stockStrategy, etfStrategy, ...extraStrategies, ...etfRebalanceStrategies]
  };

  await fs.writeFile(outputJsonPath, `${JSON.stringify(result)}\n`, "utf8");
  await fs.writeFile(outputMdPath, markdownReport(result), "utf8");
  console.log(`Wrote ${outputJsonPath} and ${outputMdPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
