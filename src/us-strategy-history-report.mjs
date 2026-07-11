import fs from "node:fs/promises";
import path from "node:path";
import {
  priceMapFromSnapshot,
  readPriceSnapshot
} from "./backtest-price-snapshot.mjs";
import {
  loadTrades,
  scenarios,
  simulateScenario
} from "./strategy-development-lab.mjs";

const root = process.cwd();
const outputPath = path.join(root, "data", "us-strategy-history-report.json");
const validationPath = path.join(root, "data", "score-a-c-corrected-validation.json");
const selectionPath = path.join(root, "data", "sector-score-variant-test-corrected-frozen-20260711.json");
const scaleAPath = path.join(root, "data", "scale-execution-test-corrected-score-a-20260711.json");
const scaleCPath = path.join(root, "data", "scale-execution-test-corrected-score-c-20260711.json");
const currentRule = "half_sell_half_weekly_extend";
const fixedRule = "lump_buy_lump_sell";
const accountScenarioKey = "repeat_theme_combo_cap275";

const sources = [
  {
    id: "bls_2022_cpi",
    publisher: "U.S. Bureau of Labor Statistics",
    title: "Consumer prices rose 9.1% in the year ended June 2022",
    date: "2022-07-18",
    url: "https://www.bls.gov/opub/ted/2022/consumer-prices-up-9-1-percent-over-the-year-ended-june-2022-largest-in-40-years.htm"
  },
  {
    id: "fed_2022_actions",
    publisher: "Federal Reserve",
    title: "Record of policy actions in 2022",
    date: "2023-04-28",
    url: "https://www.federalreserve.gov/publications/2022-ar-record-of-policy-actions-of-the-board-of-governors.htm"
  },
  {
    id: "coinbase_2022_10k",
    publisher: "U.S. SEC / Coinbase",
    title: "Coinbase 2022 Form 10-K",
    date: "2023-02-21",
    url: "https://www.sec.gov/Archives/edgar/data/1679788/000167978823000031/coin-20221231.htm"
  },
  {
    id: "fed_2023_hold",
    publisher: "Federal Reserve",
    title: "FOMC statement, December 2023",
    date: "2023-12-13",
    url: "https://www.federalreserve.gov/newsevents/pressreleases/monetary20231213a.htm"
  },
  {
    id: "nvidia_q2_2024",
    publisher: "NVIDIA Investor Relations",
    title: "NVIDIA second-quarter fiscal 2024 results",
    date: "2023-08-23",
    url: "https://investor.nvidia.com/news/press-release-details/2023/NVIDIA-Announces-Financial-Results-for-Second-Quarter-Fiscal-2024/default.aspx"
  },
  {
    id: "nvidia_q1_2025",
    publisher: "NVIDIA Investor Relations",
    title: "NVIDIA first-quarter fiscal 2025 results",
    date: "2024-05-22",
    url: "https://investor.nvidia.com/news/press-release-details/2024/NVIDIA-Announces-Financial-Results-for-First-Quarter-Fiscal-2025/default.aspx"
  },
  {
    id: "applovin_2024",
    publisher: "AppLovin Investor Relations",
    title: "AppLovin fourth-quarter and full-year 2024 results",
    date: "2025-02-12",
    url: "https://investors.applovin.com/news/news-details/2025/AppLovin-Announces-Fourth-Quarter-and-Full-Year-2024-Financial-Results/default.aspx"
  },
  {
    id: "whitehouse_tariffs_2025",
    publisher: "The White House",
    title: "April 2025 reciprocal tariff fact sheet",
    date: "2025-04-02",
    url: "https://www.whitehouse.gov/fact-sheets/2025/04/fact-sheet-president-donald-j-trump-declares-national-emergency-to-increase-our-competitive-edge-protect-our-sovereignty-and-strengthen-our-national-and-economic-security/"
  },
  {
    id: "whitehouse_reciprocal_plan_2025",
    publisher: "The White House",
    title: "February 2025 fair and reciprocal trade plan",
    date: "2025-02-13",
    url: "https://www.whitehouse.gov/fact-sheets/2025/02/fact-sheet-president-donald-j-trump-announces-fair-and-reciprocal-plan-on-trade/"
  },
  {
    id: "bea_q1_2025",
    publisher: "U.S. Bureau of Economic Analysis",
    title: "Gross domestic product, first quarter 2025, third estimate",
    date: "2025-06-26",
    url: "https://www.bea.gov/index.php/news/2025/gross-domestic-product-1st-quarter-2025-third-estimate-gdp-industry-and-corporate-profits"
  },
  {
    id: "wdc_separation",
    publisher: "Western Digital Investor Relations",
    title: "Western Digital completes planned company separation",
    date: "2025-02-24",
    url: "https://investor.wdc.com/news-releases/news-release-details/western-digital-completes-planned-company-separation"
  },
  {
    id: "seagate_q2_2026",
    publisher: "Seagate Investor Relations",
    title: "Seagate fiscal second-quarter 2026 results",
    date: "2026-01-27",
    url: "https://investors.seagate.com/news/news-details/2026/Seagate-Technology-Reports-Fiscal-Second-Quarter-2026-Financial-Results/"
  },
  {
    id: "nvidia_fy_2026",
    publisher: "NVIDIA Investor Relations",
    title: "NVIDIA fourth-quarter and fiscal 2026 results",
    date: "2026-02-25",
    url: "https://investor.nvidia.com/news/press-release-details/2026/NVIDIA-Announces-Financial-Results-for-Fourth-Quarter-and-Fiscal-2026/"
  }
];

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function mean(values) {
  const clean = values.filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null;
}

function median(values) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return null;
  const middle = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[middle] : (clean[middle - 1] + clean[middle]) / 2;
}

function tradeReturn(row) {
  return row.closed ? row.return : row.markedReturn;
}

function tradeKey(row) {
  return `${row.cohort}:${row.symbol}`;
}

function summarizeTradeReturns(rows) {
  const values = rows.map(tradeReturn).filter(Number.isFinite);
  const robust = values.filter((value) => Math.abs(value) <= 3);
  return {
    count: values.length,
    closedCount: rows.filter((row) => row.closed).length,
    openCount: rows.filter((row) => !row.closed).length,
    averageReturn: round(mean(values)),
    medianReturn: round(median(values)),
    winRate: round(values.filter((value) => value > 0).length / Math.max(values.length, 1)),
    robustAverageReturn: round(mean(robust)),
    robustCount: robust.length
  };
}

function compactTrade(row, extra = {}) {
  return {
    cohort: row.cohort,
    entryDate: row.firstBuyDate,
    symbol: row.symbol,
    name: row.name,
    sector: row.sector,
    score: row.score,
    rank: row.rank,
    closed: row.closed,
    status: row.status,
    return: round(tradeReturn(row)),
    fixedExitDate: row.fixedExitDate,
    finalExitDate: row.lastSellDate,
    ...extra
  };
}

function selectionComparison(selection, tradesA, tradesC) {
  const strategyA = selection.results.find((row) => row.key === "a_current_sector20");
  const strategyC = selection.results.find((row) => row.key === "c_half_sector_normalized");
  const cTradeMap = new Map(tradesC.map((row) => [tradeKey(row), row]));
  const aTradeMap = new Map(tradesA.map((row) => [tradeKey(row), row]));
  const timelineC = new Map(strategyC.selectionTimeline.map((row) => [row.asOf, row]));
  const rows = [];
  const aOnly = [];
  const cOnly = [];
  let commonSlots = 0;
  let exactOrderMonths = 0;
  let exactSetMonths = 0;

  for (const monthA of strategyA.selectionTimeline) {
    const monthC = timelineC.get(monthA.asOf);
    if (!monthC || (!monthA.symbols.length && !monthC.symbols.length)) continue;
    const aSet = new Set(monthA.symbols);
    const cSet = new Set(monthC.symbols);
    const common = monthA.symbols.filter((symbol) => cSet.has(symbol));
    const onlyA = monthA.symbols.filter((symbol) => !cSet.has(symbol));
    const onlyC = monthC.symbols.filter((symbol) => !aSet.has(symbol));
    commonSlots += common.length;
    const sameOrder = monthA.symbols.join("|") === monthC.symbols.join("|");
    const sameSet = onlyA.length === 0 && onlyC.length === 0;
    if (sameOrder) exactOrderMonths += 1;
    if (sameSet) exactSetMonths += 1;
    const cohort = monthA.asOf.slice(0, 7);
    rows.push({
      asOf: monthA.asOf,
      cohort,
      a: monthA.rows,
      c: monthC.rows,
      common,
      onlyA,
      onlyC,
      sameOrder,
      sameSet
    });
    for (const symbol of onlyA) {
      const trade = aTradeMap.get(`${cohort}:${symbol}`);
      if (trade) aOnly.push(trade);
    }
    for (const symbol of onlyC) {
      const trade = cTradeMap.get(`${cohort}:${symbol}`);
      if (trade) cOnly.push(trade);
    }
  }

  const sectorCounts = (timeline) => {
    const counts = new Map();
    for (const month of timeline) {
      for (const row of month.rows ?? []) counts.set(row.sector, (counts.get(row.sector) ?? 0) + 1);
    }
    return counts;
  };
  const aSectors = sectorCounts(strategyA.selectionTimeline);
  const cSectors = sectorCounts(strategyC.selectionTimeline);
  const sectors = [...new Set([...aSectors.keys(), ...cSectors.keys()])]
    .map((sector) => ({
      sector,
      a: aSectors.get(sector) ?? 0,
      c: cSectors.get(sector) ?? 0,
      change: (cSectors.get(sector) ?? 0) - (aSectors.get(sector) ?? 0)
    }))
    .sort((left, right) => Math.max(right.a, right.c) - Math.max(left.a, left.c));
  const byReturn = (items, direction = "desc") => [...items].sort((left, right) => (
    direction === "desc" ? tradeReturn(right) - tradeReturn(left) : tradeReturn(left) - tradeReturn(right)
  ));

  return {
    signalMonthCount: strategyA.selectionTimeline.length,
    monthCount: rows.length,
    totalSlotsEach: rows.reduce((sum, row) => sum + row.a.length, 0),
    commonSlots,
    aOnlySlots: aOnly.length,
    cOnlySlots: cOnly.length,
    exactOrderMonths,
    exactSetMonths,
    changedSetMonths: rows.length - exactSetMonths,
    common: summarizeTradeReturns(tradesA.filter((trade) => {
      const month = rows.find((row) => row.cohort === trade.cohort);
      return month?.common.includes(trade.symbol);
    })),
    aOnly: {
      ...summarizeTradeReturns(aOnly),
      all: byReturn(aOnly).map((row) => compactTrade(row)),
      best: byReturn(aOnly).slice(0, 10).map((row) => compactTrade(row)),
      worst: byReturn(aOnly, "asc").slice(0, 8).map((row) => compactTrade(row))
    },
    cOnly: {
      ...summarizeTradeReturns(cOnly),
      all: byReturn(cOnly).map((row) => compactTrade(row)),
      best: byReturn(cOnly).slice(0, 10).map((row) => compactTrade(row)),
      worst: byReturn(cOnly, "asc").slice(0, 8).map((row) => compactTrade(row))
    },
    sectors
  };
}

function exitComparison(scale) {
  const fixed = scale.evaluations.find((entry) => entry.rule === fixedRule).rows.filter((row) => row.entered);
  const current = scale.evaluations.find((entry) => entry.rule === currentRule).rows.filter((row) => row.entered);
  const fixedMap = new Map(fixed.map((row) => [tradeKey(row), row]));
  const pairs = current
    .filter((row) => row.closed && fixedMap.get(tradeKey(row))?.closed)
    .map((row) => {
      const base = fixedMap.get(tradeKey(row));
      return compactTrade(row, {
        fixedReturn: round(base.return),
        extensionReturn: round(row.return),
        improvement: round(row.return - base.return),
        sixMonthSellDate: row.firstSellDate,
        remainingSellDate: row.lastSellDate,
        remainingSellReason: row.sellReasons?.[1] ?? null
      });
    });
  const improvements = pairs.map((row) => row.improvement);
  const robustPairs = pairs.filter((row) => Math.abs(row.fixedReturn) <= 3 && Math.abs(row.extensionReturn) <= 3);
  const reasonCounts = {};
  for (const row of current) {
    for (const reason of row.sellReasons ?? []) reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
  }
  const sorted = [...pairs].sort((left, right) => right.improvement - left.improvement);
  return {
    pairedClosedTrades: pairs.length,
    improvedTrades: pairs.filter((row) => row.improvement > 0.00005).length,
    worsenedTrades: pairs.filter((row) => row.improvement < -0.00005).length,
    unchangedTrades: pairs.filter((row) => Math.abs(row.improvement) <= 0.00005).length,
    averageImprovement: round(mean(improvements)),
    medianImprovement: round(median(improvements)),
    robustAverageImprovement: round(mean(robustPairs.map((row) => row.improvement))),
    robustPairCount: robustPairs.length,
    reasonCounts,
    pairs: sorted,
    bestExtensions: sorted.slice(0, 10),
    worstGivebacks: sorted.slice(-10).reverse()
  };
}

function monthReturns(curve) {
  const monthEnd = new Map();
  for (const row of curve) monthEnd.set(row.date.slice(0, 7), row);
  const points = [...monthEnd.values()].sort((a, b) => a.date.localeCompare(b.date));
  let previousEquity = 10_000_000;
  return points.map((row) => {
    const monthlyReturn = row.equity / previousEquity - 1;
    previousEquity = row.equity;
    return { month: row.date.slice(0, 7), date: row.date, return: round(monthlyReturn), equity: row.equity };
  });
}

function drawdownEpisode(curve) {
  let peak = curve[0];
  let worst = { drawdown: 0, peak, trough: curve[0] };
  for (const row of curve) {
    if (row.equity > peak.equity) peak = row;
    const drawdown = row.equity / peak.equity - 1;
    if (drawdown < worst.drawdown) worst = { drawdown, peak, trough: row };
  }
  return {
    drawdown: round(worst.drawdown),
    peakDate: worst.peak.date,
    peakEquity: worst.peak.equity,
    troughDate: worst.trough.date,
    troughEquity: worst.trough.equity
  };
}

function rollingWindow(curve, days) {
  const dated = curve.map((row) => ({ ...row, timestamp: Date.parse(`${row.date}T00:00:00Z`) }));
  let best = null;
  let worst = null;
  for (let endIndex = 1; endIndex < dated.length; endIndex += 1) {
    const target = dated[endIndex].timestamp - days * 86_400_000;
    let start = dated[0];
    for (let index = 1; index < endIndex; index += 1) {
      if (dated[index].timestamp > target) break;
      start = dated[index];
    }
    if (dated[endIndex].timestamp - start.timestamp < (days - 14) * 86_400_000) continue;
    const result = {
      startDate: start.date,
      endDate: dated[endIndex].date,
      return: round(dated[endIndex].equity / start.equity - 1)
    };
    if (!best || result.return > best.return) best = result;
    if (!worst || result.return < worst.return) worst = result;
  }
  return { best, worst };
}

function curveAnalysis(account) {
  const months = monthReturns(account.curve);
  return {
    drawdown: drawdownEpisode(account.curve),
    bestMonths: [...months].sort((a, b) => b.return - a.return).slice(0, 8),
    worstMonths: [...months].sort((a, b) => a.return - b.return).slice(0, 8),
    rollingSixMonths: rollingWindow(account.curve, 182),
    rollingTwelveMonths: rollingWindow(account.curve, 365)
  };
}

function accountSummary(account, includeCurve = true) {
  const summary = {
    totalReturn: account.totalReturn,
    cagr: account.cagr,
    maxDrawdown: account.maxDrawdown,
    finalCapital: account.finalCapital,
    finalCash: account.finalCash,
    openMarketValue: account.openMarketValue,
    openLotCount: account.openLotCount,
    executedBuys: account.executedBuys,
    skippedBuys: account.skippedBuys,
    totalTransactionCost: account.totalTransactionCost ?? account.transactionCost
  };
  if (includeCurve) summary.curve = account.curve;
  return summary;
}

function assertClose(label, actual, expected, tolerance = 0.00015) {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label} mismatch: ${actual} vs ${expected}`);
  }
}

const [validation, selection, scaleA, scaleC] = await Promise.all([
  fs.readFile(validationPath, "utf8").then(JSON.parse),
  fs.readFile(selectionPath, "utf8").then(JSON.parse),
  fs.readFile(scaleAPath, "utf8").then(JSON.parse),
  fs.readFile(scaleCPath, "utf8").then(JSON.parse)
]);

if (scaleA.priceSnapshotHash !== scaleC.priceSnapshotHash || scaleA.priceSnapshotHash !== validation.provenance.priceSnapshotHash) {
  throw new Error("A, C, and validation must use the same frozen price snapshot.");
}

const snapshot = await readPriceSnapshot(path.resolve(root, scaleA.priceSnapshotPath));
if (snapshot.hash !== scaleA.priceSnapshotHash) throw new Error("Frozen price snapshot hash mismatch.");
const valuation = {
  asOf: snapshot.asOf,
  hash: snapshot.hash,
  path: scaleA.priceSnapshotPath,
  priceMap: priceMapFromSnapshot(snapshot)
};
const accountScenario = scenarios.find((row) => row.key === accountScenarioKey);
if (!accountScenario) throw new Error(`Missing account scenario: ${accountScenarioKey}`);

const tradesA = loadTrades(scaleA, false, currentRule);
const tradesC = loadTrades(scaleC, false, currentRule);
const currentARecheck = simulateScenario(accountScenario, tradesA, valuation);
const currentCRecheck = simulateScenario(accountScenario, tradesC, valuation);
assertClose("Score A current account return", currentARecheck.totalReturn, validation.scoreA.account.totalReturn);
assertClose("Score C current account return", currentCRecheck.totalReturn, validation.scoreC.account.totalReturn);
assertClose("Score A current MDD", currentARecheck.maxDrawdown, validation.scoreA.account.maxDrawdown);
assertClose("Score C current MDD", currentCRecheck.maxDrawdown, validation.scoreC.account.maxDrawdown);

const fixedA = simulateScenario(accountScenario, loadTrades(scaleA, false, fixedRule), valuation);
const fixedC = simulateScenario(accountScenario, loadTrades(scaleC, false, fixedRule), valuation);
const selectionDetail = selectionComparison(selection, tradesA, tradesC);
const exitsA = exitComparison(scaleA);
const exitsC = exitComparison(scaleC);

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  title: "미국 주도주 전략, 지난 5년을 다시 보다",
  status: "과거 결과를 이해하기 위한 연구 보고서이며 현재 매매 규칙은 변경하지 않음",
  strategyNames: {
    a: { displayName: "섹터 흐름형", internalCode: "Score A" },
    c: { displayName: "종목 힘 중심형", internalCode: "Score C" }
  },
  period: validation.period,
  provenance: {
    runId: validation.runId,
    universeSize: validation.period.universeSize,
    universeHash: validation.provenance.universeHash,
    priceSnapshotHash: validation.provenance.priceSnapshotHash,
    priceAsOf: validation.period.priceAsOf,
    transactionCostBps: validation.provenance.transactionCostBps,
    valuationMode: validation.provenance.valuationMode,
    incompleteTradePolicy: validation.provenance.incompleteTradePolicy
  },
  scoreWeights: {
    a: [
      { key: "relativeStrength", label: "상대강도", weight: 35 },
      { key: "momentum", label: "모멘텀", weight: 30 },
      { key: "volume", label: "거래량", weight: 15 },
      { key: "sectorTheme", label: "섹터·테마", weight: 20 }
    ],
    c: [
      { key: "relativeStrength", label: "상대강도", weight: round(35 / 90 * 100, 2) },
      { key: "momentum", label: "모멘텀", weight: round(30 / 90 * 100, 2) },
      { key: "volume", label: "거래량", weight: round(15 / 90 * 100, 2) },
      { key: "sectorTheme", label: "섹터·테마", weight: round(10 / 90 * 100, 2) }
    ],
    note: "섹터 흐름형은 잘나가는 업종에 20점을 줍니다. 종목 힘 중심형은 업종 점수를 10점으로 낮춰, 상대강도·상승 흐름·거래량처럼 종목 자체의 움직임을 88.9%까지 더 중요하게 봅니다."
  },
  headline: {
    scoreA: {
      selectionReturn: validation.scoreA.selection.totalReturn,
      accountReturn: validation.scoreA.account.totalReturn,
      cagr: validation.scoreA.account.cagr,
      maxDrawdown: validation.scoreA.account.maxDrawdown,
      robustReturn: validation.scoreA.account.robust.totalReturn
    },
    scoreC: {
      selectionReturn: validation.scoreC.selection.totalReturn,
      accountReturn: validation.scoreC.account.totalReturn,
      cagr: validation.scoreC.account.cagr,
      maxDrawdown: validation.scoreC.account.maxDrawdown,
      robustReturn: validation.scoreC.account.robust.totalReturn
    },
    qqq: validation.scoreA.account.benchmark,
    accountReturnAdvantage: round(validation.scoreC.account.totalReturn - validation.scoreA.account.totalReturn),
    finalCapitalAdvantage: round(validation.scoreC.account.finalCapital - validation.scoreA.account.finalCapital, 2)
  },
  account: {
    current: {
      a: accountSummary(currentARecheck),
      c: accountSummary(currentCRecheck),
      qqq: validation.scoreA.account.benchmark
    },
    fixedSixMonth: {
      a: accountSummary(fixedA, false),
      c: accountSummary(fixedC, false)
    },
    analysis: {
      a: curveAnalysis(currentARecheck),
      c: curveAnalysis(currentCRecheck)
    }
  },
  selection: selectionDetail,
  exits: { a: exitsA, c: exitsC },
  annualComparisons: validation.annualComparisons,
  regimes: [
    {
      key: "tightening_2022",
      period: "2021-11 ~ 2022-10",
      title: "첫 번째 고비: 물가와 금리가 빠르게 올랐던 2022년",
      tone: "stress",
      evidence: "섹터 흐름형이 2021년 10월에 고른 COIN은 6개월 동안 63.4% 떨어졌고, 종목 힘 중심형이 같은 달에 고른 APP도 60.3% 떨어졌습니다. 두 계좌 모두 2022년 6월과 9월이 특히 힘들었습니다.",
      interpretation: "2022년 6월 미국 소비자물가는 1년 전보다 9.1% 올랐고, 미국 중앙은행은 6월·7월·9월에 금리를 매번 0.75%포인트씩 올렸습니다. Coinbase는 그해 거래량이 절반으로 줄고 순매출도 74억달러에서 31억달러로 감소했다고 밝혔습니다. 금리가 오르자 미래 성장 기대가 큰 주식의 가격이 크게 낮아졌고, 암호화폐 시장의 문제까지 겹쳤습니다.",
      lesson: "점수가 높게 나온 종목도 시장 전체에서 돈이 빠져나갈 때는 크게 떨어질 수 있습니다. 6개월 매도 규칙이 모든 손실을 막아주지는 못하므로, 한 달에 새로 사는 금액과 한 종목에 넣는 돈의 상한이 중요합니다.",
      sourceIds: ["bls_2022_cpi", "fed_2022_actions", "coinbase_2022_10k"]
    },
    {
      key: "ai_2023_2024",
      period: "2023-02 ~ 2024-12",
      title: "가장 힘이 붙기 시작한 때: AI 기대가 실제 매출로 확인된 2023~2024년",
      tone: "growth",
      evidence: "2023년에 새로 시작했다고 보면 종목 힘 중심형은 70.5%, 섹터 흐름형은 50.4% 올랐습니다. 2024년 시작 계좌도 각각 105.0%와 66.1%였습니다. 종목 힘 중심형만 골랐던 NVDA와 APP 같은 종목이 큰 차이를 만들었습니다.",
      interpretation: "2023년 말 미국 중앙은행은 금리를 더 올리지 않고 유지했습니다. 동시에 NVIDIA의 데이터센터 매출은 전년보다 171%, 다음 해에는 427% 늘었고 AppLovin의 2024년 광고 매출도 75% 증가했습니다. 단순한 기대가 아니라 실제 매출 증가가 주가 상승을 뒷받침했습니다.",
      lesson: "업종 전체가 좋다는 이유만으로 고르기보다, 그 안에서 실제 주가가 더 강하고 거래도 활발한 종목을 고르는 편이 이 시기에는 유리했습니다.",
      sourceIds: ["fed_2023_hold", "nvidia_q2_2024", "nvidia_q1_2025", "applovin_2024"]
    },
    {
      key: "tariff_drawdown_2025",
      period: "2025-02-14 ~ 2025-04-04",
      title: "계좌가 가장 크게 줄었던 때: 2025년 관세 불확실성",
      tone: "stress",
      evidence: `섹터 흐름형 계좌는 고점에서 ${Math.abs(round(validation.scoreA.account.maxDrawdown * 100, 1))}%, 종목 힘 중심형은 ${Math.abs(round(validation.scoreC.account.maxDrawdown * 100, 1))}% 줄었습니다. 두 계좌 모두 2025년 2월 14일에 고점을 찍고 4월 4일에 가장 낮아졌습니다.`,
      interpretation: "2월 13일 미국의 상호무역 계획 발표 뒤 4월 2일 기본관세와 국가별 관세가 구체화됐습니다. 미국 경제도 2025년 1분기에 1년 기준으로 환산해 0.5% 줄었습니다. 앞으로의 비용과 경기를 예측하기 어려워지면서, 그동안 빠르게 올랐던 종목들이 함께 조정받은 시기와 겹칩니다.",
      lesson: "종목 힘 중심형은 장기 수익이 더 높았지만 중간에 떨어지는 폭도 0.6%포인트 더 컸습니다. 이 방식을 선택한다면 계좌가 한때 약 20% 줄어드는 상황을 실제로 견딜 수 있어야 합니다.",
      sourceIds: ["whitehouse_reciprocal_plan_2025", "whitehouse_tariffs_2025", "bea_q1_2025"]
    },
    {
      key: "storage_2025_2026",
      period: "2025-08 ~ 2026-06",
      title: "가장 좋았던 때: AI 수혜가 저장장치까지 넓어진 2025~2026년",
      tone: "growth",
      evidence: `종목 힘 중심형의 가장 좋았던 12개월 수익률은 약 ${round(curveAnalysis(currentCRecheck).rollingTwelveMonths.best.return * 100, 1)}%였습니다. 2025년 7월에 이 방식만 고른 STX는 349.1% 올랐습니다. 2025년 5월에 산 STX의 절반을 6개월 뒤에도 남겨둔 덕분에, 그때 모두 팔았을 때보다 수익률이 276.7%포인트 높아졌습니다.`,
      interpretation: "AI용 데이터가 급증하면서 수혜가 반도체를 넘어 저장장치 회사까지 넓어졌습니다. Seagate의 분기 매출은 전년보다 약 21.5% 늘었고, 제품을 팔고 남는 이익의 비율도 34.9%에서 41.6%로 좋아졌습니다. NVIDIA의 데이터센터 매출도 75% 증가했습니다.",
      lesson: "전체 수익의 상당 부분은 오래 상승한 몇 종목에서 나왔습니다. 6개월에 모두 팔면 마음은 편할 수 있지만, 크게 오른 종목의 남은 상승도 함께 포기하게 됩니다.",
      sourceIds: ["seagate_q2_2026", "nvidia_fy_2026", "wdc_separation"]
    }
  ],
  caveats: [
    "지금 상장돼 있는 551개 종목을 과거에도 그대로 있었다고 보고 계산했습니다. 당시에는 존재했지만 지금은 상장폐지된 종목이 빠져 있어 결과가 실제보다 좋아 보일 가능성이 있습니다.",
    "아직 매도 시점이 오지 않은 종목은 2026-07-10 주가로 임시 계산했습니다. 이 수익은 실제로 팔아 확정한 돈이 아닙니다.",
    "시장 배경 설명은 공식 경제·기업 자료와 주가가 움직인 시기를 비교한 해석입니다. 한 사건이 주가 움직임의 유일한 원인이라는 뜻은 아닙니다.",
    "종목 힘 중심형의 우위는 STX·APP처럼 매우 크게 오른 소수 종목의 영향을 많이 받았습니다. 300% 넘게 오른 거래를 빼도 앞섰지만 두 방식의 차이는 줄어듭니다.",
    "살 때와 팔 때 각각 0.1%의 비용은 반영했습니다. 세금, 원화와 달러를 바꾸는 비용, 주문 순간의 가격 차이, 주문이 체결되지 않는 상황은 포함하지 않았습니다."
  ],
  sources
};

await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Wrote ${outputPath}`);
