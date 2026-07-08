import fs from "node:fs/promises";
import path from "node:path";
import { fetchChart, syntheticChart } from "./yahoo.mjs";
import { round } from "./math.mjs";

const sample = process.argv.includes("--sample");
const screenerPath = path.join("data", "screener-results.json");
const buyRule5yPath = path.join("data", "monthly-buy-rule-test-5y.json");
const buyRule3yPath = path.join("data", "monthly-buy-rule-test.json");
const scaleExecutionPath = path.join("data", "scale-execution-test.json");
const capitalAccountPath = path.join("data", "capital-account-simulation.json");
const outputPath = path.join("data", "strategy-dashboard.json");
const strategyLabel = "Leader2 One Each";
const currentExecutionRule = "half_sell_half_weekly_extend";

function percentReturn(entryPrice, currentPrice) {
  if (!Number.isFinite(entryPrice) || !Number.isFinite(currentPrice) || entryPrice === 0) return null;
  return round(currentPrice / entryPrice - 1, 4);
}

function monthKey(date) {
  return String(date ?? "").slice(0, 7);
}

function addMonths(dateString, months) {
  const date = new Date(`${dateString}T00:00:00Z`);
  const day = date.getUTCDate();
  date.setUTCMonth(date.getUTCMonth() + months);
  if (date.getUTCDate() < day) date.setUTCDate(0);
  return date.toISOString().slice(0, 10);
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function completedMonths(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  let months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth();
  if (end.getUTCDate() < start.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

function rowOnOrAfter(rows, date) {
  return rows.find((row) => row.date >= date && Number.isFinite(row.close)) ?? rows.at(-1) ?? null;
}

function movingAverage(values, index, length) {
  if (index < length - 1) return null;
  const slice = values.slice(index - length + 1, index + 1).filter(Number.isFinite);
  if (slice.length !== length) return null;
  return slice.reduce((sum, value) => sum + value, 0) / slice.length;
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

function weeklyTrend(priceRows) {
  const latest = weeklyRows(priceRows).at(-1);
  const alive = latest
    && Number.isFinite(latest.ma10)
    && Number.isFinite(latest.rsi14)
    && latest.close >= latest.ma10
    && latest.rsi14 >= 50;
  return {
    date: latest?.date ?? null,
    close: round(latest?.close, 2),
    ma10: round(latest?.ma10, 2),
    rsi14: round(latest?.rsi14, 1),
    alive: Boolean(alive)
  };
}

function weeklyOnOrBefore(rows, date) {
  return rows.filter((row) => row.date <= date).at(-1) ?? null;
}

function weeklyIndexAfter(rows, date) {
  const index = rows.findIndex((row) => row.date > date);
  return index === -1 ? rows.length : index;
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

function extensionDecision(priceRows, halfSellDate, maxExitDate, currentAsOf) {
  if (currentAsOf < halfSellDate) {
    return { phase: "pre_half", remainingWeight: 1, stopDate: null, stopReason: null };
  }

  const weekly = weeklyRows(priceRows);
  const halfWeek = weeklyOnOrBefore(weekly, halfSellDate);
  if (!aliveWeekly(halfWeek)) {
    return {
      phase: "exit_at_half",
      remainingWeight: 0,
      stopDate: halfSellDate,
      stopReason: "6개월 시점 주봉 10주선+RSI 조건 미충족"
    };
  }

  const startIndex = weeklyIndexAfter(weekly, halfSellDate);
  for (let index = startIndex; index < weekly.length; index += 1) {
    const row = weekly[index];
    if (row.date > currentAsOf || row.date > maxExitDate) break;
    if (consecutiveBelow10w(weekly, index)) {
      return {
        phase: "trend_exit",
        remainingWeight: 0,
        stopDate: row.date,
        stopReason: "10주선 2주 연속 이탈"
      };
    }
  }

  if (currentAsOf >= maxExitDate) {
    return {
      phase: "max_exit",
      remainingWeight: 0,
      stopDate: maxExitDate,
      stopReason: "최대 12개월 도달"
    };
  }

  return {
    phase: "extended",
    remainingWeight: 0.5,
    stopDate: null,
    stopReason: null
  };
}

function periodReturn(priceMap, symbol, startDate, endDate) {
  const rows = priceMap.get(symbol) ?? [];
  const entry = rowOnOrAfter(rows, startDate);
  const exit = rowOnOrAfter(rows, endDate);
  if (!entry || !exit || !entry.close) return null;
  return exit.close / entry.close - 1;
}

function sortByDate(rows, key = "date") {
  return [...rows].sort((a, b) => String(a[key]).localeCompare(String(b[key])));
}

async function optionalJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function pickStrategy(data) {
  return data?.rankedResults?.find((row) => row.label === strategyLabel)
    ?? data?.results?.find((row) => row.label === strategyLabel)
    ?? null;
}

function eligibleStocks(screener) {
  return (screener.rows ?? []).filter((row) => row.type === "stock" && row.sector && row.status !== "excluded");
}

function currentLeaders(screener) {
  return (screener.currentGroupStats ?? []).slice(0, 5).map((group, index) => ({
    rank: index + 1,
    group: group.group,
    leadershipScore: group.leadershipScore,
    averageQqqExcessMomentum: group.averageQqqExcessMomentum,
    above50Rate: group.above50Rate,
    above200Rate: group.above200Rate,
    top20Count: group.top20Count,
    top50Count: group.top50Count,
    top50Acceleration: group.top50Acceleration
  }));
}

function currentBuyCandidates(screener) {
  const rows = eligibleStocks(screener);
  return currentLeaders(screener).slice(0, 2).map((leader) => {
    const row = rows.find((item) => item.sector === leader.group);
    if (!row) return null;
    return {
      symbol: row.symbol,
      name: row.name,
      sector: row.sector,
      score: row.score,
      status: row.status,
      close: row.metrics?.close,
      lastDate: row.metrics?.lastDate,
      reasons: row.reasons ?? [],
      warnings: row.warnings ?? [],
      metrics: {
        r1m: row.metrics?.r1m,
        r3m: row.metrics?.r3m,
        r6m: row.metrics?.r6m,
        high52wDistance: row.metrics?.high52wDistance,
        avgDollar20: row.metrics?.avgDollar20
      },
      chart: row.chart ?? [],
      leader
    };
  }).filter(Boolean);
}

function buyCandidateFromRow(row, leader) {
  return {
    symbol: row.symbol,
    name: row.name,
    sector: row.sector,
    score: row.score,
    status: row.status,
    close: row.metrics?.close,
    lastDate: row.metrics?.lastDate,
    reasons: row.reasons ?? [],
    warnings: row.warnings ?? [],
    metrics: {
      r1m: row.metrics?.r1m,
      r3m: row.metrics?.r3m,
      r6m: row.metrics?.r6m,
      high52wDistance: row.metrics?.high52wDistance,
      avgDollar20: row.metrics?.avgDollar20
    },
    chart: row.chart ?? [],
    leader
  };
}

function monthlyLockedBuyCandidates(screener, existingDashboard, currentAsOf) {
  const existingBuys = existingDashboard?.currentBuys ?? [];
  if (monthKey(existingDashboard?.asOf) !== monthKey(currentAsOf) || !existingBuys.length) {
    return currentBuyCandidates(screener);
  }

  const currentRows = new Map((screener.rows ?? []).map((row) => [row.symbol, row]));
  const leaders = currentLeaders(screener);
  return existingBuys.map((existing) => {
    const row = currentRows.get(existing.symbol);
    if (!row) return existing;
    const leader = leaders.find((item) => item.group === row.sector) ?? existing.leader;
    return buyCandidateFromRow(row, leader);
  });
}

function currentCohort(currentAsOf, currentBuys) {
  return {
    asOf: currentAsOf,
    entryDate: currentBuys[0]?.lastDate ?? currentAsOf,
    leadingGroups: currentBuys.map((row) => row.leader?.group).filter(Boolean),
    symbols: currentBuys.map((row) => row.symbol),
    groups: currentBuys.map((row) => row.sector),
    rows: currentBuys.map((row) => ({
      symbol: row.symbol,
      name: row.name,
      sector: row.sector,
      score: row.score,
      rank: null
    })),
    current: true
  };
}

function latestSelectionCohorts(strategy, currentAsOf, currentBuys) {
  const timeline = strategy?.selectionTimeline ?? [];
  const currentMonth = monthKey(currentAsOf);
  const prior = timeline
    .filter((cohort) => monthKey(cohort.asOf) !== currentMonth)
    .slice(-5);
  return [...prior, currentCohort(currentAsOf, currentBuys)].filter((cohort) => cohort.rows?.length);
}

function portfolioCohorts(strategy, currentAsOf, currentBuys) {
  const currentMonth = monthKey(currentAsOf);
  const timeline = strategy?.selectionTimeline ?? [];
  const activeOrActionable = timeline.filter((cohort) => (
    cohort?.rows?.length
    && cohort.entryDate
    && monthKey(cohort.asOf) !== currentMonth
    && cohort.entryDate <= currentAsOf
    && addMonths(cohort.entryDate, 12) >= addDays(currentAsOf, -21)
  ));
  return [...activeOrActionable, currentCohort(currentAsOf, currentBuys)].filter((cohort) => cohort.rows?.length);
}

function portfolioCohortsFromExisting(existingDashboard, currentAsOf, currentBuys) {
  const currentMonth = monthKey(currentAsOf);
  const prior = (existingDashboard?.portfolio?.cohorts ?? [])
    .filter((cohort) => (
      !cohort.current
      && cohort?.rows?.length
      && cohort.entryDate
      && monthKey(cohort.asOf) !== currentMonth
      && cohort.entryDate <= currentAsOf
      && addMonths(cohort.entryDate, 12) >= addDays(currentAsOf, -21)
    ));
  return [...prior, currentCohort(currentAsOf, currentBuys)].filter((cohort) => cohort.rows?.length);
}

async function fetchPrices(symbols) {
  const priceMap = new Map();
  const errors = [];
  for (const symbol of symbols) {
    try {
      priceMap.set(symbol, sample ? syntheticChart(symbol, 900) : await fetchChart(symbol, { range: "5y" }));
    } catch (error) {
      errors.push({ symbol, error: error.message });
      if (sample) priceMap.set(symbol, syntheticChart(symbol, 900));
    }
  }
  return { priceMap, errors };
}

function holdingAction({ status, weekly, halfSellDate, maxExitDate, extension }) {
  if (status === "new") {
    return {
      actionLabel: "월간 후보 고정",
      nextAction: "차트 확인 후 진입",
      remainingSellRule: "매수 후보는 다음 월간 리밸런싱 전까지 교체하지 않음"
    };
  }
  if (status === "hold") {
    return {
      actionLabel: "보유",
      nextAction: `${halfSellDate} 50% 매도 점검`,
      remainingSellRule: "6개월 도달 전까지는 주간 탈락만으로 매도하지 않음"
    };
  }
  if (status === "extended") {
    return {
      actionLabel: "잔여 50% 연장 보유",
      nextAction: "주봉 추세 유지 여부 점검",
      remainingSellRule: `남은 50%는 10주선 2주 연속 이탈 또는 ${maxExitDate} 도달 시 매도`
    };
  }
  if (extension?.stopReason) {
    return {
      actionLabel: "잔여 50% 매도",
      nextAction: `${extension.stopDate} 기준 잔여분 매도`,
      remainingSellRule: extension.stopReason
    };
  }
  if (weekly.alive) {
    return {
      actionLabel: "50% 매도 + 50% 연장",
      nextAction: `${halfSellDate} 50% 매도`,
      remainingSellRule: `남은 50%는 10주선 2주 연속 이탈 또는 ${maxExitDate} 도달 시 매도`
    };
  }
  return {
    actionLabel: "전량 정리",
    nextAction: `${halfSellDate} 50% 매도 후 잔여분도 정리`,
    remainingSellRule: "6개월 시점에 주봉 10주선+RSI 조건 미충족"
  };
}

function buildHoldings(cohorts, priceMap, screener, currentAsOf) {
  const currentRows = new Map((screener.rows ?? []).map((row) => [row.symbol, row]));
  const rows = [];
  cohorts.forEach((cohort) => {
    for (const item of cohort.rows ?? []) {
      const priceRows = priceMap.get(item.symbol) ?? [];
      const entry = rowOnOrAfter(priceRows, cohort.entryDate);
      const current = priceRows.at(-1);
      const currentRow = currentRows.get(item.symbol);
      const currentPrice = currentRow?.metrics?.close ?? current?.close;
      const entryPrice = cohort.current ? currentPrice : entry?.close;
      const halfSellDate = addMonths(cohort.entryDate, 6);
      const maxExitDate = addMonths(cohort.entryDate, 12);
      const ageMonths = completedMonths(cohort.entryDate, currentAsOf);
      const weekly = weeklyTrend(priceRows);
      const extension = extensionDecision(priceRows, halfSellDate, maxExitDate, currentAsOf);
      const status = cohort.current
        ? "new"
        : extension.phase === "pre_half"
          ? "hold"
          : extension.phase === "extended"
            ? "extended"
            : "sell_due";
      const action = holdingAction({ status, weekly, halfSellDate, maxExitDate, extension });
      rows.push({
        cohort: monthKey(cohort.asOf),
        asOf: cohort.asOf,
        entryDate: cohort.entryDate,
        halfSellDate,
        maxExitDate,
        remainingWeight: extension.remainingWeight,
        extensionPhase: extension.phase,
        stopDate: extension.stopDate,
        stopReason: extension.stopReason,
        symbol: item.symbol,
        name: currentRow?.name ?? item.name ?? item.symbol,
        sector: currentRow?.sector ?? item.sector,
        score: currentRow?.score ?? item.score,
        entryPrice: round(entryPrice, 2),
        currentPrice: round(currentPrice, 2),
        currentReturn: percentReturn(entryPrice, currentPrice),
        ageMonths,
        status,
        weeklyTrend: weekly,
        ...action,
        tradingViewUrl: `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(item.symbol)}`,
        yahooUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(item.symbol)}`
      });
    }
  });
  return rows;
}

function portfolioSummary(holdings) {
  const invested = holdings.filter((row) => row.status !== "new" && Number.isFinite(row.currentReturn));
  const allWithReturn = holdings.filter((row) => Number.isFinite(row.currentReturn));
  const best = [...allWithReturn].sort((a, b) => b.currentReturn - a.currentReturn)[0] ?? null;
  const worst = [...allWithReturn].sort((a, b) => a.currentReturn - b.currentReturn)[0] ?? null;
  return {
    holdingCount: holdings.length,
    newCount: holdings.filter((row) => row.status === "new").length,
    extendedCount: holdings.filter((row) => row.status === "extended").length,
    sellDueCount: holdings.filter((row) => row.status === "sell_due").length,
    averageReturn: round(
      invested.reduce((sum, row) => sum + row.currentReturn, 0) / Math.max(1, invested.length),
      4
    ),
    best,
    worst
  };
}

function buildRealizedTrades(strategy, priceMap, holdMonths) {
  const timeline = strategy?.selectionTimeline ?? [];
  const trades = [];
  for (let index = 0; index + holdMonths < timeline.length; index += 1) {
    const cohort = timeline[index];
    const exitCohort = timeline[index + holdMonths];
    if (!cohort?.rows?.length || !cohort.entryDate || !exitCohort?.entryDate) continue;
    for (const item of cohort.rows) {
      const rows = priceMap.get(item.symbol) ?? [];
      const qqqRows = priceMap.get("QQQ") ?? [];
      const entry = rowOnOrAfter(rows, cohort.entryDate);
      const exit = rowOnOrAfter(rows, exitCohort.entryDate);
      const qqqEntry = rowOnOrAfter(qqqRows, cohort.entryDate);
      const qqqExit = rowOnOrAfter(qqqRows, exitCohort.entryDate);
      if (!entry || !exit || !entry.close) continue;
      const returnValue = exit.close / entry.close - 1;
      const qqqReturn = qqqEntry && qqqExit && qqqEntry.close
        ? qqqExit.close / qqqEntry.close - 1
        : null;
      trades.push({
        cohort: monthKey(cohort.asOf),
        entryDate: cohort.entryDate,
        exitMonth: monthKey(exitCohort.asOf),
        exitAsOf: exitCohort.asOf,
        exitDate: exitCohort.entryDate,
        symbol: item.symbol,
        name: item.name ?? item.symbol,
        sector: item.sector,
        score: item.score,
        rank: item.rank,
        entryPrice: round(entry.close, 2),
        exitPrice: round(exit.close, 2),
        return: round(returnValue, 4),
        qqqReturn: round(qqqReturn, 4),
        excessQqq: round(Number.isFinite(qqqReturn) ? returnValue - qqqReturn : null, 4)
      });
    }
  }
  return sortByDate(trades, "exitDate");
}

function executionRows(scaleExecution) {
  return scaleExecution?.evaluations
    ?.find((entry) => entry.rule === currentExecutionRule)
    ?.rows
    ?.filter((row) => row.entered) ?? null;
}

function sellEventsForTrade(row, priceMap) {
  const priceRows = priceMap?.get(row.symbol) ?? [];
  const sellDates = row.sellDates ?? [row.firstSellDate, row.lastSellDate].filter(Boolean);
  const sellReasons = row.sellReasons ?? [];
  const eventWeight = sellDates.length >= 2 ? 0.5 : 1;
  return sellDates.map((date, index) => {
    const price = rowOnOrAfter(priceRows, date)?.close ?? null;
    return {
      date,
      month: monthKey(date),
      reason: sellReasons[index] ?? "sell",
      weight: eventWeight,
      price: round(price, 2),
      return: round(percentReturn(row.averageBuyPrice, price), 4)
    };
  });
}

function realizedTradesFromExecution(rows, priceMap) {
  if (!rows?.length) return [];
  return sortByDate(rows.map((row) => ({
    cohort: row.cohort,
    entryDate: row.firstBuyDate ?? row.entryDate,
    exitMonth: monthKey(row.lastSellDate),
    exitDate: row.lastSellDate,
    symbol: row.symbol,
    name: row.name ?? row.symbol,
    sector: row.sector,
    score: row.score,
    rank: row.rank,
    entryPrice: row.averageBuyPrice,
    exitPrice: row.averageSellPrice,
    return: row.return,
    qqqReturn: row.qqqReturn,
    excessQqq: row.excessQqq,
    buyDates: row.buyDates ?? [row.firstBuyDate].filter(Boolean),
    sellDates: row.sellDates ?? [row.firstSellDate, row.lastSellDate].filter(Boolean),
    sellReasons: row.sellReasons ?? [],
    sellEvents: sellEventsForTrade(row, priceMap)
  })), "exitDate");
}

function realizedSummary(trades) {
  const valid = trades.filter((row) => Number.isFinite(row.return));
  const best = [...valid].sort((a, b) => b.return - a.return)[0] ?? null;
  const worst = [...valid].sort((a, b) => a.return - b.return)[0] ?? null;
  const averageReturn = valid.reduce((sum, row) => sum + row.return, 0) / Math.max(1, valid.length);
  const averageQqq = valid
    .filter((row) => Number.isFinite(row.qqqReturn))
    .reduce((sum, row) => sum + row.qqqReturn, 0) / Math.max(1, valid.filter((row) => Number.isFinite(row.qqqReturn)).length);
  return {
    count: valid.length,
    winRate: round(valid.filter((row) => row.return > 0).length / Math.max(1, valid.length), 4),
    averageReturn: round(averageReturn, 4),
    averageQqqReturn: round(averageQqq, 4),
    averageExcessQqq: round(averageReturn - averageQqq, 4),
    best,
    worst
  };
}

function monthlyExits(trades) {
  const groups = new Map();
  for (const trade of trades) {
    const current = groups.get(trade.exitMonth) ?? {
      exitMonth: trade.exitMonth,
      exitDate: trade.exitDate,
      count: 0,
      symbols: [],
      sectors: [],
      returnSum: 0,
      qqqReturnSum: 0,
      qqqCount: 0,
      winners: 0
    };
    current.count += 1;
    current.symbols.push(trade.symbol);
    if (trade.sector && !current.sectors.includes(trade.sector)) current.sectors.push(trade.sector);
    current.returnSum += trade.return;
    if (Number.isFinite(trade.qqqReturn)) {
      current.qqqReturnSum += trade.qqqReturn;
      current.qqqCount += 1;
    }
    if (trade.return > 0) current.winners += 1;
    groups.set(trade.exitMonth, current);
  }
  return Array.from(groups.values()).map((row) => ({
    exitMonth: row.exitMonth,
    exitDate: row.exitDate,
    count: row.count,
    symbols: row.symbols,
    sectors: row.sectors,
    averageReturn: round(row.returnSum / row.count, 4),
    qqqReturn: round(row.qqqReturnSum / Math.max(1, row.qqqCount), 4),
    excessQqq: round(row.returnSum / row.count - row.qqqReturnSum / Math.max(1, row.qqqCount), 4),
    winRate: round(row.winners / row.count, 4)
  }));
}

function monthlySellEvents(trades) {
  const groups = new Map();
  for (const trade of trades) {
    const fallbackEvents = (trade.sellDates ?? []).map((date, index) => ({
      date,
      month: monthKey(date),
      reason: trade.sellReasons?.[index] ?? "sell",
      weight: (trade.sellDates ?? []).length >= 2 ? 0.5 : 1,
      price: trade.exitPrice,
      return: trade.return
    }));
    for (const rawEvent of (trade.sellEvents?.length ? trade.sellEvents : fallbackEvents)) {
      const event = {
        ...rawEvent,
        month: rawEvent.month ?? monthKey(rawEvent.date)
      };
      if (!event.month) continue;
      const current = groups.get(event.month) ?? {
        month: event.month,
        events: [],
        fixedCount: 0,
        remainingCount: 0,
        returnWeight: 0,
        weightedReturnSum: 0,
        symbols: []
      };
      const entry = {
        ...event,
        symbol: trade.symbol,
        name: trade.name,
        sector: trade.sector,
        cohort: trade.cohort,
        entryDate: trade.entryDate,
        entryPrice: trade.entryPrice
      };
      current.events.push(entry);
      if (event.reason === "half_fixed_6m") current.fixedCount += 1;
      else current.remainingCount += 1;
      if (Number.isFinite(event.return)) {
        current.returnWeight += event.weight;
        current.weightedReturnSum += event.return * event.weight;
      }
      if (!current.symbols.includes(trade.symbol)) current.symbols.push(trade.symbol);
      groups.set(event.month, current);
    }
  }
  return Array.from(groups.values()).map((row) => ({
    month: row.month,
    eventCount: row.events.length,
    fixedCount: row.fixedCount,
    remainingCount: row.remainingCount,
    symbols: row.symbols,
    averageEventReturn: round(row.weightedReturnSum / Math.max(1, row.returnWeight), 4),
    events: sortByDate(row.events, "date")
  }));
}

function activeWeight(trade, startDate) {
  const sellDates = trade.sellDates ?? [];
  if (!sellDates.length || trade.exitDate <= startDate) return 0;
  if (sellDates.length >= 2 && sellDates[0] <= startDate && sellDates.at(-1) > startDate) return 0.5;
  return trade.entryDate <= startDate && trade.exitDate > startDate ? 1 : 0;
}

function currentExecutionCurve(trades, timeline, priceMap) {
  let equity = 1;
  let qqqEquity = 1;
  const curve = [];
  const intervals = (timeline ?? [])
    .filter((row) => row.entryDate)
    .slice(0, -1)
    .map((row, index) => ({
      asOf: row.asOf,
      entryDate: row.entryDate,
      exitDate: timeline[index + 1].entryDate
    }));

  for (const interval of intervals) {
    const weightedReturns = trades.map((trade) => {
      const weight = activeWeight(trade, interval.entryDate);
      const value = weight ? periodReturn(priceMap, trade.symbol, interval.entryDate, interval.exitDate) : null;
      return Number.isFinite(value) ? { value, weight } : null;
    }).filter(Boolean);
    const totalWeight = weightedReturns.reduce((sum, row) => sum + row.weight, 0);
    const qqqReturn = periodReturn(priceMap, "QQQ", interval.entryDate, interval.exitDate);
    if (!totalWeight || !Number.isFinite(qqqReturn)) continue;
    const netReturn = weightedReturns.reduce((sum, row) => sum + row.value * row.weight, 0) / totalWeight;
    equity *= 1 + netReturn;
    qqqEquity *= 1 + qqqReturn;
    curve.push({
      asOf: interval.asOf,
      entryDate: interval.entryDate,
      exitDate: interval.exitDate,
      netReturn: round(netReturn, 4),
      qqqReturn: round(qqqReturn, 4),
      excessQqq: round(netReturn - qqqReturn, 4),
      equity: round(equity, 4),
      qqqEquity: round(qqqEquity, 4),
      strategyTotalReturn: round(equity - 1, 4),
      qqqTotalReturn: round(qqqEquity - 1, 4),
      uniqueHeldCount: weightedReturns.length,
      newestSymbols: []
    });
  }
  return curve;
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
  return round((1 + totalReturn) ** (12 / months) - 1, 4);
}

function compactExecutionResult(curve) {
  if (!curve?.length) return null;
  const last = curve.at(-1);
  return {
    label: "50% Sell / 50% Weekly Extend",
    months: curve.length,
    totalReturn: last.strategyTotalReturn,
    cagr: annualizedReturn(last.strategyTotalReturn, curve.length),
    qqqTotalReturn: last.qqqTotalReturn,
    excessQqqTotal: round(last.strategyTotalReturn - last.qqqTotalReturn, 4),
    maxDrawdown: maxDrawdown(curve),
    positiveMonthRate: round(curve.filter((row) => row.netReturn > 0).length / curve.length, 4),
    beatQqqMonthRate: round(curve.filter((row) => row.excessQqq > 0).length / curve.length, 4),
    averageHeldCount: round(curve.reduce((sum, row) => sum + row.uniqueHeldCount, 0) / curve.length, 1),
    averageNewBuys: 2
  };
}

function yearlyPerformance(strategy) {
  const curve = Array.isArray(strategy) ? strategy : strategy?.curve ?? [];
  const years = new Map();
  for (const point of curve) {
    const year = point.asOf.slice(0, 4);
    const current = years.get(year) ?? { year, months: 0, value: 1, spy: 1, qqq: 1, beatQqq: 0 };
    current.months += 1;
    current.value *= 1 + point.netReturn;
    current.spy *= 1 + point.spyReturn;
    current.qqq *= 1 + point.qqqReturn;
    if (point.excessQqq > 0) current.beatQqq += 1;
    years.set(year, current);
  }
  return Array.from(years.values()).map((row) => ({
    year: row.year,
    months: row.months,
    return: round(row.value - 1, 4),
    spyReturn: round(row.spy - 1, 4),
    qqqReturn: round(row.qqq - 1, 4),
    excessQqq: round(row.value - row.qqq, 4),
    beatQqqRate: round(row.beatQqq / row.months, 4)
  }));
}

function compactBacktestResult(row) {
  if (!row) return null;
  return {
    label: row.label,
    months: row.months,
    totalReturn: row.totalReturn,
    cagr: row.cagr,
    qqqTotalReturn: row.qqqTotalReturn,
    excessQqqTotal: row.excessQqqTotal,
    maxDrawdown: row.maxDrawdown,
    positiveMonthRate: row.positiveMonthRate,
    beatQqqMonthRate: row.beatQqqMonthRate,
    averageHeldCount: row.averageHeldCount,
    averageNewBuys: row.averageNewBuys
  };
}

function compactCurve(strategy, existingDashboard) {
  if (strategy?.curve?.length) {
    return strategy.curve.map((row) => ({
      asOf: row.asOf,
      entryDate: row.entryDate,
      exitDate: row.exitDate,
      netReturn: row.netReturn,
      qqqReturn: row.qqqReturn,
      excessQqq: row.excessQqq,
      equity: row.equity,
      qqqEquity: row.qqqEquity,
      strategyTotalReturn: round(row.equity - 1, 4),
      qqqTotalReturn: round(row.qqqEquity - 1, 4),
      uniqueHeldCount: row.uniqueHeldCount,
      newestSymbols: row.newestSymbols ?? []
    }));
  }
  return existingDashboard?.backtest?.equityCurve ?? [];
}

async function main() {
  const screener = JSON.parse(await fs.readFile(screenerPath, "utf8"));
  const existingDashboard = await optionalJson(outputPath);
  const buyRule5y = await optionalJson(buyRule5yPath);
  const buyRule3y = await optionalJson(buyRule3yPath);
  const scaleExecution = await optionalJson(scaleExecutionPath);
  const capitalAccount = await optionalJson(capitalAccountPath);
  const strategy5y = pickStrategy(buyRule5y);
  const strategy3y = pickStrategy(buyRule3y);
  const currentExecutionRows = executionRows(scaleExecution);

  const currentAsOf = screener.rows?.find((row) => row.metrics?.lastDate)?.metrics?.lastDate
    ?? screener.generatedAt.slice(0, 10);
  const leaders = currentLeaders(screener);
  const currentBuys = monthlyLockedBuyCandidates(screener, existingDashboard, currentAsOf);
  const cohorts = strategy5y?.selectionTimeline?.length
    ? portfolioCohorts(strategy5y, currentAsOf, currentBuys)
    : portfolioCohortsFromExisting(existingDashboard, currentAsOf, currentBuys);
  if (!cohorts.length) {
    throw new Error("No strategy cohorts available. Run monthly-buy-rule-test.mjs --years 5 once or keep data/strategy-dashboard.json.");
  }

  const realizedSymbols = strategy5y?.selectionTimeline?.length
    ? strategy5y.selectionTimeline.flatMap((cohort) => (cohort.rows ?? []).map((row) => row.symbol))
    : [];
  const symbols = Array.from(new Set([
    ...cohorts.flatMap((cohort) => cohort.rows.map((row) => row.symbol)),
    ...realizedSymbols,
    "QQQ"
  ]));
  const { priceMap, errors } = await fetchPrices(symbols);
  const holdings = buildHoldings(cohorts, priceMap, screener, currentAsOf);
  const realizedTrades = currentExecutionRows?.length
    ? realizedTradesFromExecution(currentExecutionRows, priceMap)
    : strategy5y?.selectionTimeline?.length
      ? buildRealizedTrades(strategy5y, priceMap, strategy5y.holdMonths ?? 6)
      : existingDashboard?.backtest?.realizedTrades ?? [];
  const executionCurve = currentExecutionRows?.length && strategy5y?.selectionTimeline?.length
    ? currentExecutionCurve(realizedTrades, strategy5y.selectionTimeline, priceMap)
    : null;
  const currentCurve = executionCurve?.length
    ? executionCurve
    : compactCurve(strategy5y, existingDashboard);
  const currentFiveYear = executionCurve?.length
    ? compactExecutionResult(executionCurve)
    : compactBacktestResult(strategy5y) ?? existingDashboard?.backtest?.fiveYear ?? null;

  const result = {
    generatedAt: new Date().toISOString(),
    asOf: currentAsOf,
    sourceGeneratedAt: screener.generatedAt,
    strategy: {
      name: "Leader2 One Each",
      shortName: "월 2개 주도주",
      summary: "상위 주도 섹터 2개에서 각각 1등 종목 1개씩 매수하고, 6개월 후 50%를 매도합니다. 나머지 50%는 주봉 10주선+RSI 추세가 살아 있으면 최대 12개월까지 연장합니다.",
      monthlyBuys: 2,
      holdingMonths: "6개월 + 주봉 연장",
      stopRule: "기본 손절 없음",
      executionNote: "월말 확정 후보는 해당 월의 매수 기준으로 고정, 주간 업데이트는 관찰과 보유 관리용"
    },
    market: screener.market,
    leaders,
    currentBuys,
    portfolio: {
      cohorts,
      holdings,
      summary: portfolioSummary(holdings)
    },
    backtest: {
      threeYear: compactBacktestResult(strategy3y) ?? existingDashboard?.backtest?.threeYear ?? null,
      fiveYear: currentFiveYear,
      equityCurve: currentCurve,
      realizedSummary: realizedSummary(realizedTrades),
      monthlyExits: monthlyExits(realizedTrades),
      monthlySellEvents: monthlySellEvents(realizedTrades),
      realizedTrades,
      accountSimulation: capitalAccount?.recommended ?? null,
      accountComparison: capitalAccount?.results ?? [],
      comparison: [],
      yearly: currentCurve?.length
        ? yearlyPerformance(currentCurve)
        : existingDashboard?.backtest?.yearly ?? [],
      reports: [
        { label: "Capital Account Simulation", href: "capital_account_simulation.md" },
        { label: "일봉 진입 필터 검증", href: "daily_entry_filter_test.md" },
        { label: "주봉 매도 연장 검증", href: "weekly_exit_rule_test.md" },
        { label: "분할 매수/매도 검증", href: "scale_execution_test.md" },
        { label: "주간 주도주 탈락 검증", href: "weekly_dropout_rule_test.md" },
        { label: "5년 월 2개 규칙 검증", href: "monthly_buy_rule_test-5y.md" },
        { label: "3년 월 2개 규칙 검증", href: "monthly_buy_rule_test.md" },
        { label: "보유기간 검증", href: "holding_period_test.md" },
        { label: "손절 규칙 검증", href: "stop_rule_test.md" },
        { label: "포지션 수 제한 검증", href: "position_cap_test.md" }
      ]
    },
    errors
  };

  await fs.mkdir("data", { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(result, null, 2), "utf8");
  console.log(`Wrote ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
