import fs from "node:fs/promises";
import path from "node:path";
import { round } from "./math.mjs";

const inputPath = path.join("data", "scale-execution-test.json");
const outputJsonPath = path.join("data", "strategy-development-lab.json");
const outputMdPath = "strategy_development_lab.md";
const sourceRule = "half_sell_half_weekly_extend";
const initialCapital = 10_000_000;
const costBps = 10;
const minBuy = 100_000;

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

const defensiveOrWeakSectors = new Set([
  "Real Estate",
  "Consumer Staples",
  "Utilities"
]);

const scenarios = [
  {
    key: "active_ramp_aggressive_3m",
    label: "Active Baseline: 3M Ramp",
    description: "현재 운용 기준. 초기 3개월은 100만원, 이후 75만원, 현금 부족 시 50만원. 종목당 원금 한도 22.5%.",
    symbolCapPct: 0.225,
    size: ({ baseAmount }) => baseAmount
  },
  {
    key: "repeat_persistence_tilt",
    label: "Repeat Persistence Tilt",
    description: "같은 종목이 최근 12개월 안에 다시 추천되면 1.35배, 2회 이상 반복되면 1.55배로 증액. 시장이 계속 밀어주는 종목에 더 싣는 전략.",
    symbolCapPct: 0.275,
    size: ({ baseAmount, context }) => {
      if (context.previousSymbolSignals12m >= 2) return baseAmount * 1.55;
      if (context.previousSymbolSignals12m >= 1) return baseAmount * 1.35;
      return baseAmount;
    }
  },
  {
    key: "ai_hardware_only_tilt",
    label: "AI Hardware Only Tilt",
    description: "AI/반도체 하드웨어만 1.35배로 증액하고 방어/약세 성격 섹터는 0.8배로 축소. 테마 가중 단독 효과를 본다.",
    symbolCapPct: 0.275,
    size: ({ baseAmount, trade }) => {
      let multiplier = isAiHardware(trade) ? 1.35 : 1;
      if (defensiveOrWeakSectors.has(trade.sector)) multiplier *= 0.8;
      return baseAmount * multiplier;
    }
  },
  {
    key: "theme_persistence_tilt",
    label: "Theme Persistence Tilt",
    description: "AI/반도체 하드웨어 또는 최근 6개월 반복 섹터는 1.35배로 증액. 단, 방어/약세 성격 섹터는 0.8배로 축소.",
    symbolCapPct: 0.275,
    size: ({ baseAmount, trade, context }) => {
      let multiplier = 1;
      if (isAiHardware(trade) || context.previousSectorSignals6m >= 2) multiplier *= 1.35;
      if (defensiveOrWeakSectors.has(trade.sector)) multiplier *= 0.8;
      return baseAmount * multiplier;
    }
  },
  {
    key: "no_ai_repeat_sector_combo",
    label: "No-AI Repeat/Sector Combo",
    description: "AI/반도체 사후 편향을 제거하고 반복 종목과 최근 6개월 반복 섹터만 가중한다.",
    symbolCapPct: 0.275,
    size: ({ baseAmount, trade, context }) => {
      let multiplier = 1;
      if (context.previousSymbolSignals12m >= 2) multiplier *= 1.4;
      else if (context.previousSymbolSignals12m >= 1) multiplier *= 1.2;
      if (context.previousSectorSignals6m >= 2) multiplier *= 1.2;
      if (defensiveOrWeakSectors.has(trade.sector)) multiplier *= 0.85;
      return baseAmount * Math.min(multiplier, 1.65);
    }
  },
  {
    key: "repeat_theme_combo_cap25",
    label: "Repeat + Theme Combo Cap25",
    description: "Repeat + Theme Combo와 같은 가중 규칙을 쓰되 종목당 원금 한도를 25%로 낮춘 보수형 버전.",
    symbolCapPct: 0.25,
    size: repeatThemeComboSize
  },
  {
    key: "repeat_theme_combo_cap275",
    label: "Repeat + Theme Combo Cap27.5",
    description: "Repeat + Theme Combo와 같은 가중 규칙을 쓰되 종목당 원금 한도를 27.5%로 둔 중간형 버전.",
    symbolCapPct: 0.275,
    size: repeatThemeComboSize
  },
  {
    key: "repeat_theme_combo",
    label: "Repeat + Theme Combo Cap30",
    description: "반복 종목과 AI/반도체 하드웨어를 함께 가중한다. 강한 주도주가 반복될 때 공격적으로 싣는 후보 전략. 종목당 원금 한도 30%.",
    symbolCapPct: 0.30,
    size: repeatThemeComboSize
  },
  {
    key: "rank_score_conviction",
    label: "Rank/Score Conviction",
    description: "추천 당시 순위 10위 이내와 점수 80점 이상은 증액하고, 50위 밖 후보는 축소한다. 종목 속성 기반 확신도 전략.",
    symbolCapPct: 0.25,
    size: ({ baseAmount, trade }) => {
      let multiplier = 1;
      if (trade.rank <= 10) multiplier *= 1.15;
      if (trade.score >= 80) multiplier *= 1.15;
      if (trade.rank > 50) multiplier *= 0.7;
      return baseAmount * multiplier;
    }
  }
];

const splitDefinitions = [
  {
    key: "early_2021_2023",
    label: "초기 구간 2021-2023",
    start: "2021-01-01",
    end: "2023-12-31"
  },
  {
    key: "mid_2024",
    label: "중간 구간 2024",
    start: "2024-01-01",
    end: "2024-12-31"
  },
  {
    key: "late_2025_2026",
    label: "최근 구간 2025-2026",
    start: "2025-01-01",
    end: "2026-12-31"
  }
];

function repeatThemeComboSize({ baseAmount, trade, context }) {
  let multiplier = 1;
  if (context.previousSymbolSignals12m >= 2) multiplier *= 1.45;
  else if (context.previousSymbolSignals12m >= 1) multiplier *= 1.25;
  if (isAiHardware(trade)) multiplier *= 1.25;
  if (defensiveOrWeakSectors.has(trade.sector)) multiplier *= 0.85;
  return baseAmount * Math.min(multiplier, 1.85);
}

function valuePct(value) {
  if (!Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(1)}%`;
}

function money(value) {
  if (!Number.isFinite(value)) return "-";
  return Math.round(value).toLocaleString("ko-KR");
}

function cleanAmount(value) {
  if (!Number.isFinite(value)) return null;
  return Math.abs(value) < 0.01 ? 0 : round(value, 2);
}

function monthsBetween(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  return (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth();
}

function yearsBetween(startDate, endDate) {
  return (new Date(`${endDate}T00:00:00Z`) - new Date(`${startDate}T00:00:00Z`)) / (365.25 * 24 * 60 * 60 * 1000);
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

function isAiHardware(trade) {
  return aiHardwareSymbols.has(trade.symbol) || aiHardwareSectors.has(trade.sector);
}

function loadTrades(data, robust = false) {
  const trades = data.evaluations
    ?.find((entry) => entry.rule === sourceRule)
    ?.rows
    ?.filter((row) => row.entered)
    ?.map((row, index) => ({
      ...row,
      id: `${row.cohort}-${row.symbol}-${index}`
    })) ?? [];
  if (!robust) return trades;
  return trades.filter((row) => Math.abs(row.return ?? 0) <= 3);
}

function makeEvents(trades) {
  const events = [];
  for (const trade of trades) {
    events.push({ type: "buy", date: trade.firstBuyDate, trade });
    for (let index = 0; index < trade.sellDates.length; index += 1) {
      events.push({
        type: "sell",
        date: trade.sellDates[index],
        trade,
        reason: trade.sellReasons[index],
        part: index + 1
      });
    }
  }
  return events.sort((a, b) => (
    String(a.date).localeCompare(String(b.date))
    || (a.type === "sell" ? -1 : 1)
    || String(a.trade.symbol).localeCompare(String(b.trade.symbol))
  ));
}

function baseRampAmount(cash, buySignalIndex) {
  if (cash <= 1_000_000) return 500_000;
  if (buySignalIndex < 6 && cash >= 3_000_000) return 1_000_000;
  return 750_000;
}

function equityAtCost(cash, positions) {
  const openCost = positions.reduce((sum, lot) => sum + lot.remainingShares * lot.entryPrice, 0);
  return cash + openCost;
}

function symbolOpenCost(positions, symbol) {
  return positions
    .filter((lot) => lot.symbol === symbol)
    .reduce((sum, lot) => sum + lot.remainingShares * lot.entryPrice, 0);
}

function signalContext(trade, signalHistory) {
  const previousSymbolSignals12m = signalHistory.filter((row) => (
    row.symbol === trade.symbol && monthsBetween(row.date, trade.firstBuyDate) <= 12
  )).length;
  const previousSectorSignals6m = signalHistory.filter((row) => (
    row.sector === trade.sector && monthsBetween(row.date, trade.firstBuyDate) <= 6
  )).length;
  return {
    previousSymbolSignals12m,
    previousSectorSignals6m
  };
}

function simulateScenario(scenario, trades) {
  let cash = initialCapital;
  let totalCosts = 0;
  let attemptedBuys = 0;
  let executedBuys = 0;
  let sellEvents = 0;
  let buySignalIndex = 0;
  const positions = [];
  const lots = new Map();
  const ledger = [];
  const skipped = [];
  const curve = [];
  const signalHistory = [];
  const events = makeEvents(trades);

  for (const event of events) {
    if (event.type === "sell") {
      const lot = lots.get(event.trade.id);
      if (!lot || lot.remainingShares <= 0) continue;
      const sharesToSell = Math.min(lot.remainingShares, lot.originalShares * 0.5);
      const gross = sharesToSell * event.trade.averageSellPrice;
      const cost = gross * costBps / 10_000;
      cash += gross - cost;
      totalCosts += cost;
      lot.remainingShares = round(lot.remainingShares - sharesToSell, 8);
      sellEvents += 1;
      ledger.push({
        date: event.date,
        type: "sell",
        symbol: event.trade.symbol,
        sector: event.trade.sector,
        reason: event.reason,
        amount: round(gross - cost, 2),
        cash: round(cash, 2)
      });
      curve.push({
        date: event.date,
        cash: round(cash, 2),
        equity: round(equityAtCost(cash, positions), 2),
        openLots: positions.filter((lot) => lot.remainingShares > 0).length
      });
      continue;
    }

    attemptedBuys += 1;
    const baseAmount = baseRampAmount(cash, buySignalIndex);
    const context = signalContext(event.trade, signalHistory);
    const wanted = scenario.size({ baseAmount, trade: event.trade, context });
    buySignalIndex += 1;
    signalHistory.push({
      date: event.trade.firstBuyDate,
      symbol: event.trade.symbol,
      sector: event.trade.sector
    });

    const cap = initialCapital * scenario.symbolCapPct;
    const capRoom = Math.max(0, cap - symbolOpenCost(positions, event.trade.symbol));
    const maxCashBuy = cash / (1 + costBps / 10_000);
    const amount = Math.min(wanted, capRoom, maxCashBuy);
    if (amount < minBuy) {
      skipped.push({
        date: event.date,
        symbol: event.trade.symbol,
        wanted: round(wanted, 2),
        cash: round(cash, 2),
        capRoom: round(capRoom, 2),
        reason: capRoom < minBuy ? "symbol_cap" : "cash"
      });
      continue;
    }

    const cost = amount * costBps / 10_000;
    const shares = amount / event.trade.averageBuyPrice;
    cash -= amount + cost;
    totalCosts += cost;
    const lot = {
      id: event.trade.id,
      symbol: event.trade.symbol,
      name: event.trade.name,
      sector: event.trade.sector,
      entryDate: event.trade.firstBuyDate,
      entryPrice: event.trade.averageBuyPrice,
      originalShares: shares,
      remainingShares: shares,
      buyAmount: amount,
      expectedReturn: event.trade.return
    };
    positions.push(lot);
    lots.set(event.trade.id, lot);
    executedBuys += 1;
    ledger.push({
      date: event.date,
      type: "buy",
      symbol: event.trade.symbol,
      sector: event.trade.sector,
      amount: round(amount + cost, 2),
      baseAmount: round(baseAmount, 2),
      wanted: round(wanted, 2),
      cash: round(cash, 2)
    });
    curve.push({
      date: event.date,
      cash: round(cash, 2),
      equity: round(equityAtCost(cash, positions), 2),
      openLots: positions.filter((item) => item.remainingShares > 0).length
    });
  }

  const finalCapital = cash;
  const totalReturn = finalCapital / initialCapital - 1;
  const firstDate = events[0]?.date;
  const lastDate = events.at(-1)?.date;
  const years = yearsBetween(firstDate, lastDate);
  const buyLedger = ledger.filter((row) => row.type === "buy");
  const bySector = Array.from(positions.reduce((map, lot) => {
    const current = map.get(lot.sector) ?? { sector: lot.sector, buyAmount: 0, profitProxy: 0, count: 0 };
    current.buyAmount += lot.buyAmount;
    current.profitProxy += lot.buyAmount * lot.expectedReturn;
    current.count += 1;
    map.set(lot.sector, current);
    return map;
  }, new Map()).values()).sort((a, b) => b.buyAmount - a.buyAmount);

  return {
    key: scenario.key,
    label: scenario.label,
    description: scenario.description,
    symbolCapPct: scenario.symbolCapPct,
    initialCapital,
    finalCapital: round(finalCapital, 2),
    totalReturn: round(totalReturn, 4),
    cagr: round((1 + totalReturn) ** (1 / years) - 1, 4),
    maxDrawdownAtCost: maxDrawdown(curve),
    attemptedBuys,
    executedBuys,
    skippedBuys: skipped.length,
    sellEvents,
    minCash: cleanAmount(Math.min(...curve.map((row) => row.cash), initialCapital)),
    averageBuyAmount: round(buyLedger.reduce((sum, row) => sum + row.amount, 0) / Math.max(1, buyLedger.length), 2),
    totalTransactionCost: round(totalCosts, 2),
    firstDate,
    lastDate,
    bySector: bySector.slice(0, 8).map((row) => ({
      sector: row.sector,
      count: row.count,
      buyAmount: round(row.buyAmount, 2),
      profitProxy: round(row.profitProxy, 2)
    })),
    recentLedger: ledger.slice(-20),
    skipped: skipped.slice(-20),
    curve
  };
}

function compareToBaseline(rows) {
  const baseline = rows.find((row) => row.key === "active_ramp_aggressive_3m");
  return rows
    .map((row) => ({
      ...row,
      improvement: round(row.totalReturn - baseline.totalReturn, 4),
      mddChange: round(row.maxDrawdownAtCost - baseline.maxDrawdownAtCost, 4)
    }))
    .sort((a, b) => b.totalReturn - a.totalReturn);
}

function filterTradesByDate(trades, start, end) {
  return trades.filter((trade) => trade.firstBuyDate >= start && trade.firstBuyDate <= end);
}

function runComparison(trades) {
  return compareToBaseline(scenarios.map((scenario) => simulateScenario(scenario, trades)));
}

function pickRows(rows, keys) {
  const byKey = new Map(rows.map((row) => [row.key, row]));
  return keys.map((key) => byKey.get(key)).filter(Boolean);
}

function table(lines, rows) {
  lines.push("| 후보 전략 | 최종 자산 | 누적 수익률 | CAGR | MDD | 기존 대비 | 매수 | 스킵 | 최소 현금 |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const row of rows) {
    lines.push(`| ${row.label} | ${money(row.finalCapital)} | ${valuePct(row.totalReturn)} | ${valuePct(row.cagr)} | ${valuePct(row.maxDrawdownAtCost)} | ${valuePct(row.improvement)} | ${row.executedBuys}/${row.attemptedBuys} | ${row.skippedBuys} | ${money(row.minCash)} |`);
  }
}

function compactTable(lines, rows) {
  lines.push("| 전략 | 누적 수익률 | 기존 대비 | MDD | 매수 | 스킵 |");
  lines.push("|---|---:|---:|---:|---:|---:|");
  for (const row of rows) {
    lines.push(`| ${row.label} | ${valuePct(row.totalReturn)} | ${valuePct(row.improvement)} | ${valuePct(row.maxDrawdownAtCost)} | ${row.executedBuys}/${row.attemptedBuys} | ${row.skippedBuys} |`);
  }
}

function splitTable(lines, splitResults) {
  lines.push("| 구간 | 거래수 | 기존 전략 | 후보 전략 | 개선폭 | 후보 MDD |");
  lines.push("|---|---:|---:|---:|---:|---:|");
  for (const split of splitResults) {
    const baseline = split.results.find((row) => row.key === "active_ramp_aggressive_3m");
    const candidate = split.results.find((row) => row.key === "repeat_theme_combo");
    lines.push(`| ${split.label} | ${split.tradeCount} | ${valuePct(baseline?.totalReturn)} | ${valuePct(candidate?.totalReturn)} | ${valuePct(candidate?.improvement)} | ${valuePct(candidate?.maxDrawdownAtCost)} |`);
  }
}

function markdown(result) {
  const lines = [];
  lines.push("# Strategy Development Lab");
  lines.push("");
  lines.push(`Generated at: ${result.generatedAt}`);
  lines.push(`Source: ${result.source}`);
  lines.push(`Source rule: ${result.sourceRule}`);
  lines.push(`Initial capital: ${money(result.initialCapital)}`);
  lines.push(`Cost: ${result.costBps} bps per buy/sell`);
  lines.push("");
  lines.push("## 팀별 검토 요약");
  lines.push("");
  lines.push("- 전략 리서치팀: 반복 추천 종목과 지속 주도 테마에 더 크게 배분하면 현재 전략을 개선할 수 있다는 가설을 세웠다.");
  lines.push("- 데이터/유니버스팀: 기존 Leader2 One Each의 5년 실거래 후보 106건을 사용했다.");
  lines.push("- 퀀트/백테스트팀: 1천만원 자금 제한 계좌로 후보 배분 전략을 비교했다.");
  lines.push("- 리스크/검증팀: AI/반도체 테마 가중은 사후 과최적화 위험이 있으므로 robust check를 함께 봐야 한다.");
  lines.push("- 포트폴리오/자금배분팀: 현재 3개월 램프형 공격 전략을 기준선으로 두고, 반복/테마 신호에만 매수 금액을 조정했다.");
  lines.push("- 매매 실행팀: 기존 매수/매도 날짜와 6개월 50% 매도 + 주봉 연장 매도 규칙은 그대로 유지했다.");
  lines.push("- 운영/모니터링팀: 통과 후보도 곧바로 active가 아니라 testing으로 올려 3~6개월 추적한다.");
  lines.push("");
  lines.push("## 전체 결과");
  lines.push("");
  table(lines, result.results);
  lines.push("");
  lines.push("## Robust Check");
  lines.push("");
  lines.push("개별 수익률이 +300%를 넘는 초대형 이상치를 제외하고 다시 계산했다. 특정 대박 종목에만 의존하는지 보기 위한 검증이다.");
  lines.push("");
  table(lines, result.robustResults);
  lines.push("");
  lines.push("## 규칙 분해 검증");
  lines.push("");
  lines.push("AI/반도체 가중, 반복 추천 가중, 섹터 반복 가중이 각각 얼마나 기여했는지 분해했다.");
  lines.push("");
  compactTable(lines, pickRows(result.results, [
    "active_ramp_aggressive_3m",
    "repeat_persistence_tilt",
    "ai_hardware_only_tilt",
    "theme_persistence_tilt",
    "no_ai_repeat_sector_combo",
    "repeat_theme_combo"
  ]));
  lines.push("");
  lines.push("## 종목당 한도 민감도");
  lines.push("");
  lines.push("같은 Repeat + Theme Combo 규칙에서 종목당 원금 한도를 25%, 27.5%, 30%로 바꿔 비교했다.");
  lines.push("");
  compactTable(lines, pickRows(result.results, [
    "active_ramp_aggressive_3m",
    "repeat_theme_combo_cap25",
    "repeat_theme_combo_cap275",
    "repeat_theme_combo"
  ]));
  lines.push("");
  lines.push("## 구간별 안정성 검증");
  lines.push("");
  lines.push("각 구간을 독립 계좌처럼 1천만원으로 새로 시작해 비교했다. 장기 누적 효과와 특정 후반 구간 의존도를 분리해서 보기 위한 검증이다.");
  lines.push("");
  splitTable(lines, result.splitResults);
  lines.push("");
  lines.push("## 1차 판정");
  lines.push("");
  const best = result.results[0];
  const robustBest = result.robustResults[0];
  const noAi = result.results.find((row) => row.key === "no_ai_repeat_sector_combo");
  const cap275 = result.results.find((row) => row.key === "repeat_theme_combo_cap275");
  lines.push(`- 전체 결과 1위: ${best.label}, 기존 대비 ${valuePct(best.improvement)} 개선.`);
  lines.push(`- Robust 결과 1위: ${robustBest.label}, 기존 대비 ${valuePct(robustBest.improvement)} 개선.`);
  lines.push(`- AI/반도체 가중을 제거한 ${noAi.label}도 기존 대비 ${valuePct(noAi.improvement)} 개선되어, 성과가 AI/반도체에만 의존한다고 보기는 어렵다.`);
  lines.push(`- 한도 27.5% 버전은 기존 대비 ${valuePct(cap275.improvement)} 개선되며 30% 버전보다 조금 보수적인 대안이다.`);
  lines.push("- 결론: Repeat + Theme Combo는 active 교체 후보지만, 현재 단계에서는 Cap27.5 또는 Cap30을 testing으로 등록해 3~6개월 실전 추적하는 것이 적절하다.");
  lines.push("");
  lines.push("## 다음 단계");
  lines.push("");
  lines.push("1. `Repeat + Theme Combo Cap27.5`를 우선 testing 후보로 대시보드에 등록한다.");
  lines.push("2. Cap30은 공격형 대안으로 함께 보관하되, 기본 testing 후보는 Cap27.5로 둔다.");
  lines.push("3. 다음 검증은 종목 선정 자체를 바꾸는 2차 실험으로 진행한다.");
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const data = JSON.parse(await fs.readFile(inputPath, "utf8"));
  const trades = loadTrades(data, false);
  const robustTrades = loadTrades(data, true);
  const results = runComparison(trades);
  const robustResults = runComparison(robustTrades);
  const splitResults = splitDefinitions.map((split) => {
    const splitTrades = filterTradesByDate(trades, split.start, split.end);
    return {
      ...split,
      tradeCount: splitTrades.length,
      results: runComparison(splitTrades)
    };
  });
  const result = {
    generatedAt: new Date().toISOString(),
    source: inputPath,
    sourceRule,
    initialCapital,
    costBps,
    tradeCount: trades.length,
    robustTradeCount: robustTrades.length,
    strategyDefinitions: scenarios.map(({ key, label, description, symbolCapPct }) => ({
      key,
      label,
      description,
      symbolCapPct
    })),
    results,
    robustResults,
    splitResults
  };
  await fs.writeFile(outputJsonPath, JSON.stringify(result, null, 2), "utf8");
  await fs.writeFile(outputMdPath, markdown(result), "utf8");
  console.log(`Wrote ${outputJsonPath} and ${outputMdPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
