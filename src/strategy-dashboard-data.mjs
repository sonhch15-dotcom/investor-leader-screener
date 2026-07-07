import fs from "node:fs/promises";
import path from "node:path";
import { fetchChart, syntheticChart } from "./yahoo.mjs";
import { round } from "./math.mjs";

const sample = process.argv.includes("--sample");
const screenerPath = path.join("data", "screener-results.json");
const buyRule5yPath = path.join("data", "monthly-buy-rule-test-5y.json");
const buyRule3yPath = path.join("data", "monthly-buy-rule-test.json");
const scaleExecutionPath = path.join("data", "scale-execution-test.json");
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

function rowOnOrAfter(rows, date) {
  return rows.find((row) => row.date >= date && Number.isFinite(row.close)) ?? rows.at(-1) ?? null;
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

function latestSelectionCohortsFromExisting(existingDashboard, currentAsOf, currentBuys) {
  const currentMonth = monthKey(currentAsOf);
  const prior = (existingDashboard?.portfolio?.cohorts ?? [])
    .filter((cohort) => !cohort.current && monthKey(cohort.asOf) !== currentMonth)
    .slice(-5);
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

function buildHoldings(cohorts, priceMap, screener) {
  const currentRows = new Map((screener.rows ?? []).map((row) => [row.symbol, row]));
  const rows = [];
  cohorts.forEach((cohort, cohortIndex) => {
    const ageMonths = cohorts.length - 1 - cohortIndex;
    const status = cohort.current ? "new" : ageMonths >= 5 ? "sell_due" : "hold";
    for (const item of cohort.rows ?? []) {
      const priceRows = priceMap.get(item.symbol) ?? [];
      const entry = rowOnOrAfter(priceRows, cohort.entryDate);
      const current = priceRows.at(-1);
      const currentRow = currentRows.get(item.symbol);
      const currentPrice = currentRow?.metrics?.close ?? current?.close;
      const entryPrice = cohort.current ? currentPrice : entry?.close;
      rows.push({
        cohort: monthKey(cohort.asOf),
        asOf: cohort.asOf,
        entryDate: cohort.entryDate,
        symbol: item.symbol,
        name: currentRow?.name ?? item.name ?? item.symbol,
        sector: currentRow?.sector ?? item.sector,
        score: currentRow?.score ?? item.score,
        entryPrice: round(entryPrice, 2),
        currentPrice: round(currentPrice, 2),
        currentReturn: percentReturn(entryPrice, currentPrice),
        ageMonths,
        status,
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

function realizedTradesFromExecution(rows) {
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
    sellReasons: row.sellReasons ?? []
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
  const strategy5y = pickStrategy(buyRule5y);
  const strategy3y = pickStrategy(buyRule3y);
  const currentExecutionRows = executionRows(scaleExecution);

  const currentAsOf = screener.rows?.find((row) => row.metrics?.lastDate)?.metrics?.lastDate
    ?? screener.generatedAt.slice(0, 10);
  const leaders = currentLeaders(screener);
  const currentBuys = currentBuyCandidates(screener);
  const cohorts = strategy5y?.selectionTimeline?.length
    ? latestSelectionCohorts(strategy5y, currentAsOf, currentBuys)
    : latestSelectionCohortsFromExisting(existingDashboard, currentAsOf, currentBuys);
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
  const holdings = buildHoldings(cohorts, priceMap, screener);
  const realizedTrades = currentExecutionRows?.length
    ? realizedTradesFromExecution(currentExecutionRows)
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
      executionNote: "신규 후보는 차트 확인 후 진입, 주간 업데이트는 관찰과 보유 관리용"
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
      realizedTrades,
      comparison: [],
      yearly: currentCurve?.length
        ? yearlyPerformance(currentCurve)
        : existingDashboard?.backtest?.yearly ?? [],
      reports: [
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
