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
  title: "미국 주식 Score A·C와 매도 규칙 역사 보고서",
  status: "Historical research report; no live strategy status change",
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
    note: "C는 섹터·테마 원점수를 20점에서 10점으로 낮춘 뒤 100점으로 정규화한다. 따라서 종목 자체 신호 비중은 A 80%에서 C 88.9%로 높아진다."
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
      title: "첫 난관: 인플레이션과 급격한 긴축",
      tone: "stress",
      evidence: "A의 2021-10 COIN은 6개월 수익률 -63.4%, C의 같은 달 APP은 -60.3%였다. 두 계좌의 2022년 최악 월은 6월과 9월이었다.",
      interpretation: "2022년 6월 CPI는 전년 대비 9.1%였고 연준은 6·7·9월에 각각 75bp씩 금리를 올렸다. Coinbase는 2022년 거래량이 50% 줄고 순매출이 74억달러에서 31억달러로 감소했다고 보고했다. 성장주 가치 압축과 업종 고유 충격이 겹친 구간이다.",
      lesson: "선정 점수가 높아도 유동성 축소 국면에서는 두 종목 집중 전략이 함께 흔들릴 수 있다. 6개월 규칙은 손실을 없애지 못하며, 신규 월별 lot의 크기 제한이 중요하다.",
      sourceIds: ["bls_2022_cpi", "fed_2022_actions", "coinbase_2022_10k"]
    },
    {
      key: "ai_2023_2024",
      period: "2023-02 ~ 2024-12",
      title: "강한 구간: AI 실적이 가격 모멘텀을 확인",
      tone: "growth",
      evidence: "독립 시작 구간 기준 C는 2023년 +70.5%, 2024년 +105.0%로 A의 +50.4%, +66.1%를 앞섰다. C만 고른 NVDA(2023-02)는 +87.9%, APP(2024-02)은 +259.9%였다.",
      interpretation: "연준이 2023년 말 금리를 동결하고 인플레이션 완화를 확인했다. NVIDIA 데이터센터 매출은 FY2024 2분기 전년 대비 171%, FY2025 1분기 427% 늘었고 AppLovin의 2024년 광고 매출은 75% 증가했다. 가격 모멘텀이 실제 실적으로 확인된 구간이다.",
      lesson: "C의 낮은 섹터 보너스는 이미 좋은 섹터라는 이유만으로 종목을 고르기보다, 그 안에서 상대강도·모멘텀·거래량이 더 강한 개별 승자를 고르는 데 유리했다.",
      sourceIds: ["fed_2023_hold", "nvidia_q2_2024", "nvidia_q1_2025", "applovin_2024"]
    },
    {
      key: "tariff_drawdown_2025",
      period: "2025-02-14 ~ 2025-04-04",
      title: "최대 계좌 낙폭: 관세 불확실성과 성장 둔화",
      tone: "stress",
      evidence: `A는 ${round(validation.scoreA.account.maxDrawdown * 100, 1)}% MDD, C는 ${round(validation.scoreC.account.maxDrawdown * 100, 1)}% MDD를 기록했고 두 전략의 고점·저점 날짜가 같았다.`,
      interpretation: "2월 13일 상호무역 계획 발표 뒤 4월 2일 10% 기본관세와 국가별 상호관세가 구체화됐다. 미국 1분기 GDP도 최종 추계에서 연율 -0.5%였다. 정책·공급망 불확실성과 성장 둔화가 집중 모멘텀 계좌 조정과 시간상 겹친다.",
      lesson: "C가 장기 수익률은 높았지만 최대 낙폭은 A보다 0.6%p 더 컸다. C를 택해도 약 -20%의 계좌 낙폭을 정상 범위로 감당해야 한다.",
      sourceIds: ["whitehouse_reciprocal_plan_2025", "whitehouse_tariffs_2025", "bea_q1_2025"]
    },
    {
      key: "storage_2025_2026",
      period: "2025-08 ~ 2026-06",
      title: "최고 구간: AI 저장장치로 리더십이 확산",
      tone: "growth",
      evidence: `C의 최고 12개월 구간은 약 ${round(curveAnalysis(currentCRecheck).rollingTwelveMonths.best.return * 100, 1)}%였다. C만 고른 STX(2025-07)는 현재 규칙 기준 +349.1%였고, 6개월 뒤 남긴 절반이 STX 2025-05 lot에서 고정 6개월 매도보다 +276.7%p를 더했다.`,
      interpretation: "AI 수요가 GPU뿐 아니라 데이터센터 저장장치로 확산됐다. Seagate FY2026 2분기 매출은 전년 대비 약 21.5%, GAAP 총마진은 34.9%에서 41.6%로 높아졌고 NVIDIA 데이터센터 분기 매출은 75% 늘었다. WDC와 Sandisk 분리도 저장장치 종목 구성을 바꿨다.",
      lesson: "큰 수익의 대부분은 소수의 추세 지속 종목에서 나왔다. 6개월에 전량 매도하면 손익 변동은 줄지만, 전략의 핵심인 오른쪽 꼬리 수익도 함께 잘린다.",
      sourceIds: ["seagate_q2_2026", "nvidia_fy_2026", "wdc_separation"]
    }
  ],
  caveats: [
    "현재 상장·구성 종목 551개를 과거 전체 기간에 적용한 고정 유니버스라 생존자 편향이 남아 있다.",
    "2026년 미청산 거래는 2026-07-10 종가로 평가한 우측 검열 자료다. 미실현 수익은 최종 확정 수익이 아니다.",
    "원인 설명은 공식 거시·기업 자료와 가격 움직임의 시간적 일치를 바탕으로 한 해석이며, 단일 사건의 인과를 증명하지 않는다.",
    "C의 평균 우위는 낮은 승률에도 불구하고 소수 초대형 승자가 만든 비대칭 수익에 크게 의존한다. +300% 초과 거래를 제외한 robust 계좌 결과도 C가 우세하지만 격차는 줄어든다.",
    "거래 비용은 매수·매도 각 10bp를 반영했지만 세금, 환전 스프레드, 실제 슬리피지와 주문 실패는 포함하지 않았다."
  ],
  sources
};

await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Wrote ${outputPath}`);
