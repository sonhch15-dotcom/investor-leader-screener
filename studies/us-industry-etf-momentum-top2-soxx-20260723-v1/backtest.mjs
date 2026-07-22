import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { weeklyRows } from "../../src/backtest-execution-core.mjs";
import {
  buildPriceSnapshot,
  priceMapFromSnapshot,
  readPriceSnapshot,
  writePriceSnapshot
} from "../../src/backtest-price-snapshot.mjs";
import { fetchChart } from "../../src/yahoo.mjs";
import { round, weightedReturn } from "../../src/math.mjs";

const STUDY_DIR = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = path.join(STUDY_DIR, "price-snapshot.json.gz");
const RESULT_PATH = path.join(STUDY_DIR, "result.json");
const REPORT_PATH = path.join(STUDY_DIR, "report.md");

const INDUSTRY_ETFS = [
  "SOXX", "XSW", "XLC",
  "KRE", "KCE", "KIE",
  "XBI", "XPH", "XHE", "XHS",
  "XOP", "XES",
  "XAR", "XTN",
  "XRT", "XHB",
  "XME", "RWR",
  "XLP", "XLU"
];
const BROAD_SECTOR_ETFS = ["XLK", "XLF", "XLE", "XLV", "XLI", "XLY", "XLP", "XLU", "XLC", "XLRE", "XLB"];
const ALL_SYMBOLS = [...new Set(["QQQ", ...INDUSTRY_ETFS, ...BROAD_SECTOR_ETFS])];
const INITIAL_CAPITAL = 100_000_000;
const MAIN_COST_RATE = 0.0025;
const MIN_ORDER = 1_000_000;
const POSITION_CAP = 0.275;
const RAMP_BUY_COUNT = 6;
const HIGH_CASH_RATIO = 0.30;
const LOW_CASH_RATIO = 0.10;
const RAMP_BUY_PCT = 0.10;
const NORMAL_BUY_PCT = 0.075;
const DEFENSIVE_BUY_PCT = 0.05;

const refresh = process.argv.includes("--refresh");

function pct(value, digits = 1) {
  return Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%` : "-";
}

function pp(value, digits = 1) {
  return Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%p` : "-";
}

function money(value) {
  return Number.isFinite(value) ? `${Math.round(value).toLocaleString("ko-KR")}원` : "-";
}

function dateKey(date) {
  return String(date ?? "").slice(0, 10);
}

function monthKey(date) {
  return String(date ?? "").slice(0, 7);
}

function lastFriday(year, monthIndex) {
  const date = new Date(Date.UTC(year, monthIndex + 1, 0));
  while (date.getUTCDay() !== 5) date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function rowIndexOnOrBefore(rows, date) {
  let low = 0;
  let high = rows.length - 1;
  let match = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (rows[middle].date <= date) {
      match = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return match;
}

function rowOnOrBefore(rows, date) {
  const index = rowIndexOnOrBefore(rows, date);
  return index >= 0 ? rows[index] : null;
}

function rowAfter(rows, date) {
  const index = rowIndexOnOrBefore(rows, date);
  return rows[index + 1] ?? null;
}

function momentumAt(rows, date) {
  const index = rowIndexOnOrBefore(rows, date);
  if (index < 126) return null;
  const close = rows[index].close;
  const r1m = close / rows[index - 21].close - 1;
  const r3m = close / rows[index - 63].close - 1;
  const r6m = close / rows[index - 126].close - 1;
  return {
    close,
    r1m,
    r3m,
    r6m,
    momentum: weightedReturn({ r1m, r3m, r6m })
  };
}

async function fetchSnapshot() {
  const dailyMap = new Map();
  for (const symbol of ALL_SYMBOLS) {
    const rows = await fetchChart(symbol, { range: "10y" });
    dailyMap.set(symbol, rows);
    console.log(`Fetched ${symbol}: ${rows.length} rows (${rows[0]?.date} - ${rows.at(-1)?.date})`);
  }
  const snapshot = buildPriceSnapshot(dailyMap, { source: "yahoo-adjusted-close-10y" });
  await writePriceSnapshot(SNAPSHOT_PATH, snapshot);
  return snapshot;
}

async function loadSnapshot() {
  try {
    if (!refresh) return await readPriceSnapshot(SNAPSHOT_PATH);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return fetchSnapshot();
}

function buildCohorts(priceMap, asOf, universe) {
  const qqqRows = priceMap.get("QQQ") ?? [];
  const firstCommonDate = universe
    .map((symbol) => priceMap.get(symbol)?.[0]?.date)
    .filter(Boolean)
    .sort()
    .at(-1);
  const first = new Date(`${firstCommonDate}T00:00:00Z`);
  const last = new Date(`${asOf}T00:00:00Z`);
  const cohorts = [];

  for (let year = first.getUTCFullYear(); year <= last.getUTCFullYear(); year += 1) {
    const startMonth = year === first.getUTCFullYear() ? first.getUTCMonth() : 0;
    const endMonth = year === last.getUTCFullYear() ? last.getUTCMonth() : 11;
    for (let month = startMonth; month <= endMonth; month += 1) {
      const targetFriday = lastFriday(year, month);
      if (targetFriday > asOf) continue;
      const signalRow = rowOnOrBefore(qqqRows, targetFriday);
      if (!signalRow || monthKey(signalRow.date) !== `${year}-${String(month + 1).padStart(2, "0")}`) continue;
      const entryRow = rowAfter(qqqRows, signalRow.date);
      if (!entryRow) continue;

      const ranked = universe.map((symbol) => {
        const metrics = momentumAt(priceMap.get(symbol) ?? [], signalRow.date);
        return metrics ? { symbol, ...metrics } : null;
      }).filter(Boolean).sort((a, b) => (
        b.momentum - a.momentum || a.symbol.localeCompare(b.symbol)
      ));
      if (ranked.length !== universe.length) continue;

      cohorts.push({
        index: cohorts.length,
        signalMonth: `${year}-${String(month + 1).padStart(2, "0")}`,
        signalDate: signalRow.date,
        entryDate: entryRow.date,
        picks: ranked.slice(0, 2).map((row, rank) => ({
          ...row,
          rank: rank + 1
        })),
        ranking: ranked.map((row, rank) => ({
          symbol: row.symbol,
          rank: rank + 1,
          momentum: round(row.momentum, 6),
          r1m: round(row.r1m, 6),
          r3m: round(row.r3m, 6),
          r6m: round(row.r6m, 6)
        }))
      });
    }
  }
  return cohorts;
}

function belowMa10(row) {
  return Number.isFinite(row?.ma10) && row.close < row.ma10;
}

function exitPlan(priceMap, weeklyMap, cohorts, cohortIndex, symbol, asOf) {
  const fixedCohort = cohorts[cohortIndex + 6];
  if (!fixedCohort) return { fixed: null, final: null, eligibility: "not_due" };

  const weekly = weeklyMap.get(symbol) ?? [];
  const fixedWeekIndex = rowIndexOnOrBefore(weekly, fixedCohort.signalDate);
  const fixedWeek = fixedWeekIndex >= 0 ? weekly[fixedWeekIndex] : null;
  const eligible = Boolean(
    fixedWeek
    && Number.isFinite(fixedWeek.ma10)
    && Number.isFinite(fixedWeek.rsi14)
    && fixedWeek.close >= fixedWeek.ma10
    && fixedWeek.rsi14 >= 50
  );
  const fixed = { date: fixedCohort.entryDate, fraction: 0.5, reason: "half_fixed_6m" };
  if (!eligible) {
    return {
      fixed,
      final: { date: fixedCohort.entryDate, allRemaining: true, reason: "trend_not_alive_at_6m" },
      eligibility: "rejected"
    };
  }

  const maxCohort = cohorts[cohortIndex + 12];
  const maxExitDate = maxCohort?.entryDate ?? null;
  let breakExit = null;
  for (let index = fixedWeekIndex + 1; index < weekly.length; index += 1) {
    const current = weekly[index];
    const previous = weekly[index - 1];
    if (current.date > asOf || (maxExitDate && current.date >= maxExitDate)) break;
    if (belowMa10(current) && belowMa10(previous)) {
      const execution = rowAfter(priceMap.get(symbol) ?? [], current.date);
      if (execution && execution.date <= asOf) {
        breakExit = { date: execution.date, allRemaining: true, reason: "two_week_10w_break" };
      }
      break;
    }
  }

  const maxExit = maxExitDate && maxExitDate <= asOf
    ? { date: maxExitDate, allRemaining: true, reason: "max_12m" }
    : null;
  const final = [breakExit, maxExit].filter(Boolean).sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
  return { fixed, final, eligibility: "accepted" };
}

function buildTradePlans(priceMap, cohorts, asOf, universe) {
  const weeklyMap = new Map(universe.map((symbol) => [symbol, weeklyRows(priceMap.get(symbol) ?? [])]));
  return cohorts.flatMap((cohort) => cohort.picks.map((pick) => ({
    id: `${cohort.signalMonth}|${pick.symbol}`,
    cohortIndex: cohort.index,
    signalMonth: cohort.signalMonth,
    signalDate: cohort.signalDate,
    entryDate: cohort.entryDate,
    symbol: pick.symbol,
    rank: pick.rank,
    momentum: pick.momentum,
    exitPlan: exitPlan(priceMap, weeklyMap, cohorts, cohort.index, pick.symbol, asOf)
  })));
}

function priceOn(priceMap, symbol, date) {
  return rowOnOrBefore(priceMap.get(symbol) ?? [], date)?.close ?? null;
}

function positionCostBasis(lots, symbol) {
  return lots
    .filter((lot) => lot.symbol === symbol && lot.remainingShares > 0)
    .reduce((sum, lot) => sum + lot.remainingShares * lot.entryPrice, 0);
}

function accountEquity(account, priceMap, date) {
  const openValue = account.lots.reduce((sum, lot) => {
    if (lot.remainingShares <= 0) return sum;
    const price = priceOn(priceMap, lot.symbol, date) ?? lot.entryPrice;
    return sum + lot.remainingShares * price;
  }, 0);
  return account.cash + openValue;
}

function maxDrawdown(curve) {
  let peak = -Infinity;
  let worst = 0;
  let peakDate = null;
  let worstPeakDate = null;
  let troughDate = null;
  for (const row of curve) {
    if (row.equity > peak) {
      peak = row.equity;
      peakDate = row.date;
    }
    const drawdown = peak > 0 ? row.equity / peak - 1 : 0;
    if (drawdown < worst) {
      worst = drawdown;
      worstPeakDate = peakDate;
      troughDate = row.date;
    }
  }
  return { value: round(worst, 4), peakDate: worstPeakDate, troughDate };
}

function yearsBetween(start, end) {
  return Math.max(1 / 365.25, (new Date(`${end}T00:00:00Z`) - new Date(`${start}T00:00:00Z`)) / (365.25 * 86400000));
}

function performance(curve, initialCapital) {
  const first = curve[0];
  const last = curve.at(-1);
  const totalReturn = last.equity / initialCapital - 1;
  const years = yearsBetween(first.date, last.date);
  return {
    firstDate: first.date,
    lastDate: last.date,
    initialCapital: round(initialCapital, 2),
    finalCapital: round(last.equity, 2),
    totalReturn: round(totalReturn, 4),
    cagr: round((1 + totalReturn) ** (1 / years) - 1, 4),
    maxDrawdown: maxDrawdown(curve)
  };
}

function calendarReturns(curve, initialCapital) {
  const groups = new Map();
  for (const row of curve) {
    const year = row.date.slice(0, 4);
    const rows = groups.get(year) ?? [];
    rows.push(row);
    groups.set(year, rows);
  }
  let prior = initialCapital;
  return [...groups.entries()].map(([year, rows]) => {
    const end = rows.at(-1).equity;
    const value = end / prior - 1;
    prior = end;
    return { year, return: round(value, 4), endEquity: round(end, 2) };
  });
}

function simulate(priceMap, cohorts, tradePlans, costRate, universe) {
  const account = {
    cash: INITIAL_CAPITAL,
    lots: [],
    buyIndex: 0,
    totalCosts: 0,
    ledger: [],
    skipped: [],
    postBuyCashRatios: []
  };
  const tradeById = new Map(tradePlans.map((trade) => [trade.id, trade]));
  const buysByDate = new Map();
  const sellsByDate = new Map();

  for (const trade of tradePlans) {
    const buys = buysByDate.get(trade.entryDate) ?? [];
    buys.push(trade);
    buysByDate.set(trade.entryDate, buys);
    for (const event of [trade.exitPlan.fixed, trade.exitPlan.final].filter(Boolean)) {
      const sells = sellsByDate.get(event.date) ?? [];
      sells.push({ tradeId: trade.id, ...event });
      sellsByDate.set(event.date, sells);
    }
  }

  const qqqRows = priceMap.get("QQQ") ?? [];
  const firstDate = tradePlans[0]?.entryDate;
  const lastDate = qqqRows.at(-1)?.date;
  const curve = [];
  let maxObservedCostBasisRatio = 0;
  let maxObservedCostBasisDetail = null;
  let maxExecutedBuyCapRatio = 0;
  let capViolationCount = 0;

  for (const marketRow of qqqRows) {
    const date = marketRow.date;
    if (!firstDate || date < firstDate || date > lastDate) continue;

    const sellEvents = (sellsByDate.get(date) ?? []).sort((a, b) => a.tradeId.localeCompare(b.tradeId));
    for (const event of sellEvents) {
      const lot = account.lots.find((row) => row.id === event.tradeId);
      if (!lot || lot.remainingShares <= 0) continue;
      const price = priceOn(priceMap, lot.symbol, date);
      if (!Number.isFinite(price)) continue;
      const shares = event.allRemaining
        ? lot.remainingShares
        : Math.min(lot.remainingShares, lot.originalShares * event.fraction);
      const gross = shares * price;
      const fee = gross * costRate;
      account.cash += gross - fee;
      account.totalCosts += fee;
      lot.remainingShares = Math.max(0, lot.remainingShares - shares);
      account.ledger.push({
        date,
        type: "sell",
        symbol: lot.symbol,
        signalMonth: lot.signalMonth,
        reason: event.reason,
        price: round(price, 4),
        shares: round(shares, 8),
        amount: round(gross - fee, 2),
        fee: round(fee, 2),
        cash: round(account.cash, 2)
      });
    }

    const buyTrades = (buysByDate.get(date) ?? []).sort((a, b) => a.symbol.localeCompare(b.symbol));
    if (buyTrades.length) {
      const equity = accountEquity(account, priceMap, date);
      const cashRatio = equity > 0 ? account.cash / equity : 0;
      const basePct = account.buyIndex < RAMP_BUY_COUNT && cashRatio >= HIGH_CASH_RATIO
        ? RAMP_BUY_PCT
        : cashRatio <= LOW_CASH_RATIO ? DEFENSIVE_BUY_PCT : NORMAL_BUY_PCT;
      const wanted = buyTrades.map(() => equity * basePct);
      const investBudget = Math.min(
        wanted.reduce((sum, value) => sum + value, 0),
        account.cash / (1 + costRate)
      );
      const rooms = buyTrades.map((trade) => Math.max(
        0,
        equity * POSITION_CAP - positionCostBasis(account.lots, trade.symbol)
      ));
      const amounts = buyTrades.map(() => investBudget / buyTrades.length);
      for (let index = 0; index < amounts.length; index += 1) amounts[index] = Math.min(amounts[index], rooms[index]);

      for (let pass = 0; pass < 2; pass += 1) {
        let leftover = Math.max(0, investBudget - amounts.reduce((sum, value) => sum + value, 0));
        const roomIndexes = amounts
          .map((amount, index) => rooms[index] - amount >= MIN_ORDER ? index : -1)
          .filter((index) => index >= 0);
        if (leftover < MIN_ORDER || !roomIndexes.length) break;
        for (const index of roomIndexes) {
          const extra = Math.min(leftover / roomIndexes.length, rooms[index] - amounts[index]);
          amounts[index] += extra;
        }
      }

      account.buyIndex += buyTrades.length;
      for (let index = 0; index < buyTrades.length; index += 1) {
        const trade = buyTrades[index];
        const amount = Math.min(amounts[index], account.cash / (1 + costRate));
        const price = priceOn(priceMap, trade.symbol, date);
        if (amount < MIN_ORDER || !Number.isFinite(price)) {
          account.skipped.push({
            date,
            symbol: trade.symbol,
            signalMonth: trade.signalMonth,
            reason: rooms[index] < MIN_ORDER ? "position_cap" : "cash_or_minimum",
            wanted: round(wanted[index], 2),
            available: round(amount, 2)
          });
          continue;
        }
        const fee = amount * costRate;
        const shares = amount / price;
        const costBasisAfterBuy = positionCostBasis(account.lots, trade.symbol) + amount;
        const executedCapRatio = costBasisAfterBuy / equity;
        maxExecutedBuyCapRatio = Math.max(maxExecutedBuyCapRatio, executedCapRatio);
        if (executedCapRatio > POSITION_CAP + 1e-10) capViolationCount += 1;
        account.cash -= amount + fee;
        account.totalCosts += fee;
        account.lots.push({
          id: trade.id,
          symbol: trade.symbol,
          signalMonth: trade.signalMonth,
          entryDate: date,
          entryPrice: price,
          originalShares: shares,
          remainingShares: shares,
          buyAmount: amount
        });
        account.ledger.push({
          date,
          type: "buy",
          symbol: trade.symbol,
          signalMonth: trade.signalMonth,
          price: round(price, 4),
          shares: round(shares, 8),
          amount: round(amount + fee, 2),
          fee: round(fee, 2),
          cash: round(account.cash, 2)
        });
      }

      const postEquity = accountEquity(account, priceMap, date);
      account.postBuyCashRatios.push({
        signalMonth: buyTrades[0].signalMonth,
        date,
        basePct,
        cashRatio: postEquity > 0 ? account.cash / postEquity : null
      });
      for (const trade of buyTrades) {
        const costBasis = positionCostBasis(account.lots, trade.symbol);
        const ratio = costBasis / postEquity;
        if (ratio > maxObservedCostBasisRatio) {
          maxObservedCostBasisRatio = ratio;
          maxObservedCostBasisDetail = {
            date,
            symbol: trade.symbol,
            costBasis: round(costBasis, 2),
            preBuyEquity: round(equity, 2),
            postBuyEquity: round(postEquity, 2),
            ratio: round(ratio, 6)
          };
        }
      }
    }

    const equity = accountEquity(account, priceMap, date);
    curve.push({
      date,
      equity: round(equity, 2),
      cash: round(account.cash, 2),
      cashRatio: equity > 0 ? round(account.cash / equity, 6) : null,
      openLots: account.lots.filter((lot) => lot.remainingShares > 0).length
    });
  }

  const perf = performance(curve, INITIAL_CAPITAL);
  const rampEndDate = cohorts[2]?.entryDate;
  const postRamp = curve.filter((row) => row.date >= rampEndDate);
  const averageCashRatio = postRamp.reduce((sum, row) => sum + row.cashRatio, 0) / Math.max(1, postRamp.length);
  const selectionCounts = Object.fromEntries(universe.map((symbol) => [
    symbol,
    tradePlans.filter((trade) => trade.symbol === symbol).length
  ]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
  const exitReasonCounts = Object.fromEntries(account.ledger
    .filter((row) => row.type === "sell")
    .reduce((map, row) => map.set(row.reason, (map.get(row.reason) ?? 0) + 1), new Map()));

  return {
    costRate,
    ...perf,
    averageCashRatio: round(averageCashRatio, 4),
    finalCashRatio: curve.at(-1)?.cashRatio ?? null,
    maxObservedCostBasisRatio: round(maxObservedCostBasisRatio, 6),
    maxObservedCostBasisDetail,
    maxExecutedBuyCapRatio: round(maxExecutedBuyCapRatio, 6),
    capViolationCount,
    totalTransactionCosts: round(account.totalCosts, 2),
    attemptedBuys: tradePlans.length,
    executedBuys: account.ledger.filter((row) => row.type === "buy").length,
    skippedBuys: account.skipped.length,
    sellEvents: account.ledger.filter((row) => row.type === "sell").length,
    openLots: account.lots.filter((lot) => lot.remainingShares > 0).length,
    selectionCounts,
    exitReasonCounts,
    annualReturns: calendarReturns(curve, INITIAL_CAPITAL),
    postBuyCashRatios: account.postBuyCashRatios,
    ledger: account.ledger,
    skipped: account.skipped,
    curve
  };
}

function qqqBenchmark(priceMap, firstDate, lastDate, costRate) {
  const rows = (priceMap.get("QQQ") ?? []).filter((row) => row.date >= firstDate && row.date <= lastDate);
  const entry = rows[0];
  const shares = INITIAL_CAPITAL * (1 - costRate) / entry.close;
  const curve = rows.map((row) => ({
    date: row.date,
    equity: round(shares * row.close, 2)
  }));
  return {
    costRate,
    ...performance(curve, INITIAL_CAPITAL),
    annualReturns: calendarReturns(curve, INITIAL_CAPITAL),
    curve
  };
}

function cohortRows(cohorts, count = 12) {
  return cohorts.slice(-count).map((cohort) => ({
    signalMonth: cohort.signalMonth,
    signalDate: cohort.signalDate,
    entryDate: cohort.entryDate,
    picks: cohort.picks.map((pick) => ({
      symbol: pick.symbol,
      momentum: round(pick.momentum, 4),
      r1m: round(pick.r1m, 4),
      r3m: round(pick.r3m, 4),
      r6m: round(pick.r6m, 4)
    }))
  }));
}

function deterministicHash(result) {
  const stable = {
    contract: result.contract,
    data: result.data,
    main: {
      strategy: result.main.strategy,
      benchmark: result.main.benchmark,
      referenceBroadSector: result.main.referenceBroadSector,
      annualComparison: result.main.annualComparison,
      feeSensitivity: result.main.feeSensitivity,
      startDateSensitivity: result.main.startDateSensitivity,
      cohorts: result.cohorts
    }
  };
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

function report(result) {
  const strategy = result.main.strategy;
  const benchmark = result.main.benchmark;
  const broad = result.main.referenceBroadSector;
  const qqqDifference = strategy.totalReturn - benchmark.totalReturn;
  const broadDifference = strategy.totalReturn - broad.totalReturn;
  const winner = qqqDifference > 0 ? "세부 산업 ETF 전략" : "QQQ 계속 보유";
  const lines = [
    "# 미국 세부 산업 ETF 모멘텀 상위 2종 백테스트",
    "",
    `결론부터 말하면, 같은 기간에는 **${winner}**가 앞섰습니다. 세부 산업 ETF 전략은 ${pct(strategy.totalReturn)}, QQQ 계속 보유는 ${pct(benchmark.totalReturn)}로 차이는 ${pp(qqqDifference)}입니다.`,
    `기존 11개 섹터 ETF 전략 ${pct(broad.totalReturn)}와 비교하면 ${pp(broadDifference)} 차이입니다.`,
    "",
    "## 비교 결과",
    "",
    "| 항목 | 세부 산업 ETF | 기존 11개 섹터 ETF | QQQ 계속 보유 |",
    "|---|---:|---:|---:|",
    `| 시작 자금 | ${money(strategy.initialCapital)} | ${money(broad.initialCapital)} | ${money(benchmark.initialCapital)} |`,
    `| 마지막 자산 | ${money(strategy.finalCapital)} | ${money(broad.finalCapital)} | ${money(benchmark.finalCapital)} |`,
    `| 누적 수익률 | ${pct(strategy.totalReturn)} | ${pct(broad.totalReturn)} | ${pct(benchmark.totalReturn)} |`,
    `| 연평균 복리수익률 | ${pct(strategy.cagr)} | ${pct(broad.cagr)} | ${pct(benchmark.cagr)} |`,
    `| 최대 낙폭 | ${pct(strategy.maxDrawdown.value)} | ${pct(broad.maxDrawdown)} | ${pct(benchmark.maxDrawdown.value)} |`,
    "",
    `기간은 ${strategy.firstDate}부터 ${strategy.lastDate}까지입니다. 모든 후보가 126거래일 모멘텀을 계산할 수 있는 첫 신호부터 시작했습니다.`,
    "",
    "후보군: `SOXX, XSW, XLC, KRE, KCE, KIE, XBI, XPH, XHE, XHS, XOP, XES, XAR, XTN, XRT, XHB, XME, RWR, XLP, XLU`",
    "",
    "## 무엇을 사고팔았나",
    "",
    "1. 매월 마지막 금요일 종가까지의 데이터만 사용했습니다.",
    `2. 1개월 수익률 40%, 3개월 35%, 6개월 25%를 합산해 ${INDUSTRY_ETFS.length}개 ETF의 순위를 매겼습니다.`,
    "3. 다음 거래일에 상위 2개 ETF를 새 lot으로 매수했습니다.",
    "4. 각 lot은 6개월 뒤 50%를 매도했습니다. 그때 주봉 종가가 10주선 이상이고 RSI14가 50 이상이면 나머지 절반을 연장했습니다.",
    "5. 연장분은 10주선을 2주 연속 밑돌면 다음 거래일에 매도하고, 그렇지 않아도 12개월에는 정리했습니다.",
    `6. 매수와 매도마다 0.25% 비용을 적용했습니다. 총 거래비용은 ${money(strategy.totalTransactionCosts)}입니다.`,
    "",
    "## 자금 운용",
    "",
    `첫 3개월은 ETF당 계좌 평가액의 10%, 이후에는 7.5%를 기본 매수했습니다. 현금이 평가액의 10% 이하이면 5%로 줄이고, 같은 ETF의 남은 매수원금은 계좌 평가액의 27.5%를 넘지 않도록 했습니다. 램프 이후 평균 현금 비중은 ${pct(strategy.averageCashRatio)}였습니다.`,
    "",
    `매수 신호 ${strategy.attemptedBuys}건 중 ${strategy.executedBuys}건이 체결됐고 ${strategy.skippedBuys}건은 자금 또는 종목 한도 때문에 건너뛰었습니다. 마지막에는 ${strategy.openLots}개 lot이 아직 열려 있습니다.`,
    "",
    "## 연도별 성과",
    "",
    "| 연도 | 세부 산업 ETF | QQQ | 차이 |",
    "|---|---:|---:|---:|"
  ];
  for (const row of result.main.annualComparison) {
    lines.push(`| ${row.year} | ${pct(row.strategy)} | ${pct(row.qqq)} | ${pp(row.strategy - row.qqq)} |`);
  }
  lines.push(
    "",
    "## 시작연도를 바꾼 확인",
    "",
    "| 새로 시작한 해 | 세부 산업 ETF | QQQ | 차이 |",
    "|---|---:|---:|---:|"
  );
  for (const row of result.main.startDateSensitivity) {
    lines.push(`| ${row.startYear} | ${pct(row.strategyReturn)} | ${pct(row.qqqReturn)} | ${pp(row.excessReturn)} |`);
  }
  lines.push(
    "",
    "## 비용을 바꾼 확인",
    "",
    "| 편도 비용 | 세부 산업 ETF | QQQ | 차이 |",
    "|---|---:|---:|---:|"
  );
  for (const row of result.main.feeSensitivity) {
    lines.push(`| ${(row.costEachSide * 100).toFixed(2)}% | ${pct(row.strategyReturn)} | ${pct(row.qqqReturn)} | ${pp(row.excessReturn)} |`);
  }
  lines.push(
    "",
    "## 어떤 ETF가 자주 뽑혔나",
    "",
    `| ETF | 선정 횟수 | 전체 ${strategy.attemptedBuys}개 lot 중 비중 |`,
    "|---|---:|---:|"
  );
  for (const [symbol, count] of Object.entries(strategy.selectionCounts)) {
    lines.push(`| ${symbol} | ${count}회 | ${pct(count / strategy.attemptedBuys)} |`);
  }
  lines.push("");
  lines.push(
    "## 최근 12개월 선정",
    "",
    "| 신호월 | 신호 확인일 | 매수일 | 1위 | 2위 |",
    "|---|---|---|---|---|"
  );
  for (const cohort of result.recentCohorts) {
    const [first, second] = cohort.picks;
    lines.push(`| ${cohort.signalMonth} | ${cohort.signalDate} | ${cohort.entryDate} | ${first.symbol} (${pct(first.momentum)}) | ${second.symbol} (${pct(second.momentum)}) |`);
  }
  lines.push(
    "",
    "## 해석할 때 주의할 점",
    "",
    "- XLC가 2018년에 시작됐기 때문에 모든 ETF를 같은 조건으로 비교할 수 있는 기간은 그 이후로 제한됩니다.",
    "- 세부 산업 ETF 상당수는 대형주뿐 아니라 중소형주를 수정 동일가중으로 담습니다. 기존 11개 섹터와의 차이는 산업 세분화뿐 아니라 종목 규모와 가중 방식 차이도 포함합니다.",
    "- SOXX는 다른 SPDR Select Industry ETF와 지수 제공자와 가중 방식이 다릅니다. 반도체 대표성을 높이는 대신 완전히 동일한 방법론 비교는 아닙니다.",
    "- QQQ는 첫날 거의 전액 투자하지만 섹터 전략은 첫 3개월에 매월 약 20%씩 넣고 이후에도 순차적으로 투입합니다. 초기 하락장에서는 완충 효과가 있고 초기 상승장에서는 기회비용이 생깁니다.",
    "- 주봉 이탈 매도는 두 번째 주봉이 확정된 다음 거래일에 실행해 같은 종가에 미리 체결되는 오류를 피했습니다.",
    "- 이번 결과는 연구 후보의 1차 검증이며 기존 공식 전략이나 앱 신호를 변경하지 않습니다.",
    "",
    `재현 해시: \`${result.reproducibilityHash}\``
  );
  return `${lines.join("\n")}\n`;
}

async function main() {
  const snapshot = await loadSnapshot();
  const priceMap = priceMapFromSnapshot(snapshot);
  for (const symbol of ALL_SYMBOLS) {
    if (!(priceMap.get(symbol)?.length > 126)) throw new Error(`Insufficient data: ${symbol}`);
  }
  const asOf = [...ALL_SYMBOLS.map((symbol) => priceMap.get(symbol).at(-1).date)].sort()[0];
  const cohorts = buildCohorts(priceMap, asOf, INDUSTRY_ETFS);
  const broadCohorts = buildCohorts(priceMap, asOf, BROAD_SECTOR_ETFS);
  if (cohorts.length < 12) throw new Error(`Too few valid cohorts: ${cohorts.length}`);
  if (broadCohorts.length !== cohorts.length) throw new Error("Broad-sector and industry cohort counts differ");
  const trades = buildTradePlans(priceMap, cohorts, asOf, INDUSTRY_ETFS);
  const broadTrades = buildTradePlans(priceMap, broadCohorts, asOf, BROAD_SECTOR_ETFS);

  const strategy = simulate(priceMap, cohorts, trades, MAIN_COST_RATE, INDUSTRY_ETFS);
  const broadStrategy = simulate(priceMap, broadCohorts, broadTrades, MAIN_COST_RATE, BROAD_SECTOR_ETFS);
  const benchmark = qqqBenchmark(priceMap, strategy.firstDate, strategy.lastDate, MAIN_COST_RATE);
  if (broadStrategy.firstDate !== strategy.firstDate || broadStrategy.lastDate !== strategy.lastDate) {
    throw new Error("Broad-sector reference period does not match the industry strategy period");
  }
  const feeSensitivity = [0.001, 0.0025, 0.005].map((costRate) => {
    const scenario = simulate(priceMap, cohorts, trades, costRate, INDUSTRY_ETFS);
    const qqq = qqqBenchmark(priceMap, scenario.firstDate, scenario.lastDate, costRate);
    return {
      costEachSide: costRate,
      strategyReturn: scenario.totalReturn,
      qqqReturn: qqq.totalReturn,
      excessReturn: round(scenario.totalReturn - qqq.totalReturn, 4)
    };
  });
  const startDateSensitivity = [2019, 2020, 2021, 2022, 2023, 2024].map((year) => {
    const subset = cohorts
      .filter((cohort) => cohort.signalMonth >= `${year}-01`)
      .map((cohort, index) => ({ ...cohort, index }));
    const subsetTrades = buildTradePlans(priceMap, subset, asOf, INDUSTRY_ETFS);
    const scenario = simulate(priceMap, subset, subsetTrades, MAIN_COST_RATE, INDUSTRY_ETFS);
    const qqq = qqqBenchmark(priceMap, scenario.firstDate, scenario.lastDate, MAIN_COST_RATE);
    return {
      startYear: year,
      firstDate: scenario.firstDate,
      strategyReturn: scenario.totalReturn,
      qqqReturn: qqq.totalReturn,
      excessReturn: round(scenario.totalReturn - qqq.totalReturn, 4),
      strategyMdd: scenario.maxDrawdown.value,
      qqqMdd: qqq.maxDrawdown.value
    };
  });
  const qqqAnnual = new Map(benchmark.annualReturns.map((row) => [row.year, row.return]));
  const annualComparison = strategy.annualReturns.map((row) => ({
    year: row.year,
    strategy: row.return,
    qqq: qqqAnnual.get(row.year) ?? null
  }));

  const result = {
    generatedAt: new Date().toISOString(),
    studyId: "us-industry-etf-momentum-top2-soxx-20260723-v1",
    status: "research_only",
    contract: {
      universe: INDUSTRY_ETFS,
      benchmark: "QQQ buy and hold",
      signalTiming: "last tradable session on or before each calendar month's last Friday",
      executionTiming: "next trading day",
      momentum: "1M 40% + 3M 35% + 6M 25% using adjusted close",
      selectionsPerMonth: 2,
      holding: "overlapping monthly lots",
      exit: "sell 50% at 6 months; extend remainder only when weekly close >= MA10 and RSI14 >= 50; then exit after two weekly closes below MA10 or at 12 months",
      initialCapitalKrw: INITIAL_CAPITAL,
      fractionalShares: true,
      costEachSide: MAIN_COST_RATE,
      ramp: "first six buy signals 10% of current equity per pick; then 7.5%; use 5% when cash ratio <= 10%",
      positionCap: POSITION_CAP,
      minimumOrderKrw: MIN_ORDER
    },
    data: {
      source: snapshot.source,
      snapshotHash: snapshot.hash,
      snapshotAsOf: snapshot.asOf,
      commonAsOf: asOf,
      symbolCoverage: Object.fromEntries(ALL_SYMBOLS.map((symbol) => [symbol, {
        firstDate: priceMap.get(symbol)[0].date,
        lastDate: priceMap.get(symbol).at(-1).date,
        rows: priceMap.get(symbol).length
      }]))
    },
    cohorts: {
      count: cohorts.length,
      firstSignal: cohorts[0].signalDate,
      lastSignal: cohorts.at(-1).signalDate,
      selectionCount: trades.length
    },
    main: {
      strategy: { ...strategy, curve: undefined, ledger: undefined, postBuyCashRatios: undefined },
      benchmark: { ...benchmark, curve: undefined },
      referenceBroadSector: {
        studyId: "us-sector-etf-momentum-top2-same-snapshot-control",
        firstDate: broadStrategy.firstDate,
        lastDate: broadStrategy.lastDate,
        initialCapital: broadStrategy.initialCapital,
        finalCapital: broadStrategy.finalCapital,
        totalReturn: broadStrategy.totalReturn,
        cagr: broadStrategy.cagr,
        maxDrawdown: broadStrategy.maxDrawdown.value,
        cohortCount: broadCohorts.length,
        selectionCount: broadTrades.length
      },
      annualComparison,
      feeSensitivity,
      startDateSensitivity
    },
    recentCohorts: cohortRows(cohorts),
    allCohorts: cohortRows(cohorts, cohorts.length),
    audit: {
      allCohortsHaveTwoPicks: cohorts.every((cohort) => cohort.picks.length === 2),
      allRankingsHaveFullUniverse: cohorts.every((cohort) => cohort.ranking.length === INDUSTRY_ETFS.length),
      noNegativeCash: strategy.curve.every((row) => row.cash >= -1),
      passivePositionRatioObserved: strategy.maxObservedCostBasisRatio,
      positionCapLimit: POSITION_CAP,
      maxExecutedBuyCapRatio: strategy.maxExecutedBuyCapRatio,
      allExecutedBuysWithinPositionCap: strategy.capViolationCount === 0,
      broadControlNoNegativeCash: broadStrategy.curve.every((row) => row.cash >= -1),
      broadControlWithinPositionCap: broadStrategy.capViolationCount === 0,
      latestSignalUsesCompletedLastFriday: cohorts.at(-1).signalDate <= asOf,
      openLotsMarkedAtAsOf: strategy.lastDate === asOf
    }
  };
  result.reproducibilityHash = deterministicHash(result);

  await fs.writeFile(RESULT_PATH, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  await fs.writeFile(REPORT_PATH, report(result), "utf8");
  console.log(JSON.stringify({
    resultPath: RESULT_PATH,
    reportPath: REPORT_PATH,
    period: `${strategy.firstDate}..${strategy.lastDate}`,
    cohorts: cohorts.length,
    strategyReturn: strategy.totalReturn,
    qqqReturn: benchmark.totalReturn,
    strategyCagr: strategy.cagr,
    qqqCagr: benchmark.cagr,
    strategyMdd: strategy.maxDrawdown.value,
    qqqMdd: benchmark.maxDrawdown.value,
    averageCashRatio: strategy.averageCashRatio,
    skippedBuys: strategy.skippedBuys,
    hash: result.reproducibilityHash
  }, null, 2));
}

await main();
