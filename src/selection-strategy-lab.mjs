import fs from "node:fs/promises";
import path from "node:path";
import { mean, round } from "./math.mjs";

const inputPath = path.join("data", "monthly-selection-test.json");
const outputJsonPath = path.join("data", "selection-strategy-lab.json");
const outputMdPath = "selection_strategy_lab.md";
const horizons = ["1m", "3m", "6m", "12m"];
const initialCapital = 10_000_000;
const buyAmountPerName = 750_000;
const tradeCostRate = 0.001;

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

const weakerSectors = new Set([
  "Real Estate",
  "Consumer Staples",
  "Utilities"
]);

function isAiHardware(row) {
  return aiHardwareSymbols.has(row.symbol) || aiHardwareSectors.has(row.sector);
}

function clean(values) {
  return values.filter(Number.isFinite);
}

function avg(values) {
  return round(mean(clean(values)), 4);
}

function median(values) {
  const rows = clean(values).sort((a, b) => a - b);
  if (!rows.length) return null;
  const middle = Math.floor(rows.length / 2);
  return rows.length % 2 ? rows[middle] : (rows[middle - 1] + rows[middle]) / 2;
}

function ratio(values, predicate) {
  const rows = clean(values);
  if (!rows.length) return null;
  return round(rows.filter(predicate).length / rows.length, 4);
}

function pct(value) {
  if (!Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(1)}%`;
}

function krw(value) {
  if (!Number.isFinite(value)) return "-";
  return Math.round(value).toLocaleString("ko-KR");
}

function addMonths(dateString, months) {
  const date = new Date(`${dateString}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return dateString;
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

function top(rows, count = 2) {
  return rows.slice(0, count);
}

function diverse(rows, count = 2) {
  const selected = [];
  const sectors = new Set();
  for (const row of rows) {
    if (sectors.has(row.sector)) continue;
    selected.push(row);
    sectors.add(row.sector);
    if (selected.length >= count) break;
  }
  return selected;
}

function withHistory(periods) {
  const symbolSeen = new Map();
  const sectorSeen = new Map();
  return periods.map((period, periodIndex) => {
    const rows = period.selections.map((row, rankIndex) => {
      const symbolHistory = symbolSeen.get(row.symbol) ?? [];
      const sectorHistory = sectorSeen.get(row.sector) ?? [];
      const previousSymbol12 = symbolHistory.filter((item) => periodIndex - item.periodIndex <= 12).length;
      const previousSymbol6 = symbolHistory.filter((item) => periodIndex - item.periodIndex <= 6).length;
      const previousSector6 = sectorHistory.filter((item) => periodIndex - item.periodIndex <= 6).length;
      return {
        ...row,
        rank: rankIndex + 1,
        periodIndex,
        asOf: period.asOf,
        previousSymbol12,
        previousSymbol6,
        previousSector6,
        isAiHardware: isAiHardware(row)
      };
    });
    for (const row of rows) {
      const symbolHistory = symbolSeen.get(row.symbol) ?? [];
      symbolHistory.push({ periodIndex, asOf: period.asOf });
      symbolSeen.set(row.symbol, symbolHistory);
      const sectorHistory = sectorSeen.get(row.sector) ?? [];
      sectorHistory.push({ periodIndex, asOf: period.asOf });
      sectorSeen.set(row.sector, sectorHistory);
    }
    return { ...period, rows };
  });
}

function quality(row) {
  return row.metrics?.above20
    && row.metrics?.above50
    && row.metrics?.above200
    && row.score >= 75
    && row.metrics?.high52wDistance >= -0.15;
}

function notTooExtended(row) {
  return row.score >= 75
    && row.score < 88
    && row.metrics?.high52wDistance <= -0.015
    && row.metrics?.high52wDistance >= -0.18;
}

function reacceleration(row) {
  return row.setup === "pullback_reacceleration"
    && row.metrics?.above50
    && row.metrics?.above200
    && row.score >= 75;
}

function convictionScore(row) {
  let score = row.score ?? 0;
  score += (row.previousSymbol12 ?? 0) * 3.5;
  score += Math.min(row.previousSector6 ?? 0, 6) * 1.2;
  if (row.isAiHardware) score += 5;
  if (row.setup === "pullback_reacceleration") score += 2;
  if (weakerSectors.has(row.sector)) score -= 4;
  if (row.metrics?.high52wDistance > -0.01) score -= 1.5;
  return score;
}

function byConviction(rows) {
  return [...rows].sort((a, b) => convictionScore(b) - convictionScore(a));
}

const strategies = [
  {
    key: "baseline_top2",
    label: "Baseline Top2",
    description: "월별 Top20 후보 중 점수 상위 2개를 그대로 선택한다.",
    select: (rows) => top(rows)
  },
  {
    key: "diverse_top2",
    label: "Diverse Top2",
    description: "월별 후보 중 서로 다른 섹터 2개를 선택한다.",
    select: (rows) => diverse(rows)
  },
  {
    key: "repeat_once_top2",
    label: "Repeat Once Top2",
    description: "최근 12개월 안에 한 번 이상 Top20에 등장한 종목만 선택한다.",
    select: (rows) => top(rows.filter((row) => row.previousSymbol12 >= 1))
  },
  {
    key: "repeat_twice_top2",
    label: "Repeat Twice Top2",
    description: "최근 12개월 안에 두 번 이상 Top20에 등장한 종목만 선택한다.",
    select: (rows) => top(rows.filter((row) => row.previousSymbol12 >= 2))
  },
  {
    key: "ai_or_repeat_top2",
    label: "AI or Repeat Top2",
    description: "AI/반도체 하드웨어이거나 반복 추천된 종목을 선택한다.",
    select: (rows) => top(rows.filter((row) => row.isAiHardware || row.previousSymbol12 >= 1))
  },
  {
    key: "no_ai_repeat_sector_top2",
    label: "No-AI Repeat/Sector Top2",
    description: "AI/반도체 태그 없이 반복 종목 또는 반복 섹터만 선택한다.",
    select: (rows) => top(rows.filter((row) => row.previousSymbol12 >= 1 || row.previousSector6 >= 2))
  },
  {
    key: "quality_reaccel_top2",
    label: "Quality Reaccel Top2",
    description: "주요 이동평균 위에 있고 눌림 후 재가속 신호가 있는 종목만 선택한다.",
    select: (rows) => top(rows.filter(reacceleration))
  },
  {
    key: "anti_chase_top2",
    label: "Anti-Chase Top2",
    description: "52주 고점에 너무 붙은 종목을 피하고 75~88점 구간의 강한 후보를 선택한다.",
    select: (rows) => top(rows.filter(notTooExtended))
  },
  {
    key: "quality_diverse_top2",
    label: "Quality Diverse Top2",
    description: "품질 조건을 통과한 후보 중 서로 다른 섹터 2개를 선택한다.",
    select: (rows) => diverse(rows.filter(quality))
  },
  {
    key: "conviction_combo_top2",
    label: "Conviction Combo Top2",
    description: "점수, 반복 추천, 반복 섹터, AI/반도체, 눌림 재가속을 합산한 확신도 상위 2개를 선택한다.",
    select: (rows) => top(byConviction(rows.filter((row) => !weakerSectors.has(row.sector))))
  },
  {
    key: "conviction_diverse_top2",
    label: "Conviction Diverse Top2",
    description: "확신도 순으로 고르되 서로 다른 섹터 2개를 선택한다.",
    select: (rows) => diverse(byConviction(rows.filter((row) => !weakerSectors.has(row.sector))))
  }
];

const splitDefinitions = [
  { key: "all", label: "전체", filter: () => true },
  { key: "early", label: "초기 절반", filter: (_, index, periods) => index < Math.floor(periods.length / 2) },
  { key: "late", label: "후기 절반", filter: (_, index, periods) => index >= Math.floor(periods.length / 2) },
  { key: "recent12", label: "최근 12개월", filter: (_, index, periods) => index >= periods.length - 12 }
];

function summarizeStrategy(periods, strategy, periodFilter = () => true, robust = false) {
  const detailRows = [];
  const filteredPeriods = periods.filter(periodFilter);
  for (const period of filteredPeriods) {
    const selected = strategy.select(period.rows).slice(0, 2);
    const row = {
      asOf: period.asOf,
      entryDate: period.entryDate,
      selectedCount: selected.length,
      symbols: selected.map((item) => item.symbol),
      sectors: selected.map((item) => item.sector)
    };
    for (const horizon of horizons) {
      const returns = selected
        .map((item) => item.returns?.[horizon])
        .filter(Number.isFinite)
        .filter((value) => !robust || Math.abs(value) <= 3);
      row[horizon] = {
        portfolioReturn: avg(returns),
        qqqReturn: period.benchmarks?.QQQ?.[horizon],
        spyReturn: period.benchmarks?.SPY?.[horizon]
      };
      row[horizon].excessQqq = round(row[horizon].portfolioReturn - row[horizon].qqqReturn, 4);
      row[horizon].excessSpy = round(row[horizon].portfolioReturn - row[horizon].spyReturn, 4);
    }
    detailRows.push(row);
  }
  const horizonsSummary = Object.fromEntries(horizons.map((horizon) => {
    const rows = detailRows.filter((row) => Number.isFinite(row[horizon].portfolioReturn));
    const returns = rows.map((row) => row[horizon].portfolioReturn);
    const excessQqq = rows.map((row) => row[horizon].excessQqq);
    return [horizon, {
      periods: rows.length,
      averageReturn: avg(returns),
      medianReturn: round(median(returns), 4),
      positiveRate: ratio(returns, (value) => value > 0),
      beatQqqRate: ratio(excessQqq, (value) => value > 0),
      averageExcessQqq: avg(excessQqq)
    }];
  }));
  return {
    key: strategy.key,
    label: strategy.label,
    description: strategy.description,
    activePeriods: detailRows.filter((row) => row.selectedCount > 0).length,
    emptyPeriods: detailRows.filter((row) => row.selectedCount === 0).length,
    averageSelectedCount: avg(detailRows.map((row) => row.selectedCount)),
    horizons: horizonsSummary,
    latestSelection: detailRows.at(-1)
  };
}

function rankRows(rows, horizon = "6m") {
  return [...rows].sort((a, b) => (
    (b.horizons[horizon].averageExcessQqq ?? -999) - (a.horizons[horizon].averageExcessQqq ?? -999)
    || (b.horizons[horizon].averageReturn ?? -999) - (a.horizons[horizon].averageReturn ?? -999)
  ));
}

function maxDrawdown(values) {
  let peak = -Infinity;
  let mdd = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    peak = Math.max(peak, value);
    if (peak > 0) mdd = Math.min(mdd, value / peak - 1);
  }
  return round(mdd, 4);
}

function simulateFixed6mAccount(periods, strategy) {
  let cash = initialCapital;
  let benchmarkCash = initialCapital;
  const exits = [];
  const benchmarkExits = [];
  const equityEvents = [{ date: periods[0]?.entryDate ?? periods[0]?.asOf, value: initialCapital }];
  const benchmarkEvents = [{ date: periods[0]?.entryDate ?? periods[0]?.asOf, value: initialCapital }];
  let buys = 0;
  let skipped = 0;

  function processExits(date) {
    for (const exit of exits.filter((item) => !item.processed && item.date <= date)) {
      cash += exit.proceeds;
      exit.processed = true;
    }
    for (const exit of benchmarkExits.filter((item) => !item.processed && item.date <= date)) {
      benchmarkCash += exit.proceeds;
      exit.processed = true;
    }
  }

  function accountValue() {
    return cash + exits
      .filter((item) => !item.processed)
      .reduce((sum, item) => sum + item.principal, 0);
  }

  function benchmarkValue() {
    return benchmarkCash + benchmarkExits
      .filter((item) => !item.processed)
      .reduce((sum, item) => sum + item.principal, 0);
  }

  for (const period of periods) {
    processExits(period.entryDate);
    const selected = strategy.select(period.rows).slice(0, 2)
      .filter((row) => Number.isFinite(row.returns?.["6m"]));
    const qqqReturn = period.benchmarks?.QQQ?.["6m"];
    if (!selected.length || !Number.isFinite(qqqReturn)) {
      skipped += 1;
      equityEvents.push({ date: period.entryDate, value: accountValue() });
      benchmarkEvents.push({ date: period.entryDate, value: benchmarkValue() });
      continue;
    }
    for (const row of selected) {
      const grossBuy = Math.min(buyAmountPerName, cash / (1 + tradeCostRate));
      if (grossBuy <= 1) {
        skipped += 1;
        continue;
      }
      cash -= grossBuy * (1 + tradeCostRate);
      exits.push({
        date: addMonths(period.entryDate, 6),
        principal: grossBuy,
        proceeds: grossBuy * (1 + row.returns["6m"]) * (1 - tradeCostRate)
      });
      buys += 1;
    }
    const benchmarkGrossBuy = Math.min(buyAmountPerName * selected.length, benchmarkCash / (1 + tradeCostRate));
    benchmarkCash -= benchmarkGrossBuy * (1 + tradeCostRate);
    benchmarkExits.push({
      date: addMonths(period.entryDate, 6),
      principal: benchmarkGrossBuy,
      proceeds: benchmarkGrossBuy * (1 + qqqReturn) * (1 - tradeCostRate)
    });
    equityEvents.push({ date: period.entryDate, value: accountValue() });
    benchmarkEvents.push({ date: period.entryDate, value: benchmarkValue() });
  }

  const finalExitDates = [...new Set([...exits, ...benchmarkExits].map((item) => item.date))].sort();
  for (const date of finalExitDates) {
    processExits(date);
    equityEvents.push({ date, value: accountValue() });
    benchmarkEvents.push({ date, value: benchmarkValue() });
  }

  return {
    key: strategy.key,
    label: strategy.label,
    initialCapital,
    buyAmountPerName,
    finalAsset: round(cash, 0),
    benchmarkFinalAsset: round(benchmarkCash, 0),
    totalReturn: round(cash / initialCapital - 1, 4),
    benchmarkReturn: round(benchmarkCash / initialCapital - 1, 4),
    excessReturn: round(cash / initialCapital - benchmarkCash / initialCapital, 4),
    maxDrawdown: maxDrawdown(equityEvents.map((row) => row.value)),
    benchmarkMaxDrawdown: maxDrawdown(benchmarkEvents.map((row) => row.value)),
    buys,
    skippedPeriods: skipped
  };
}

function accountTable(lines, rows) {
  lines.push("| 전략 | 최종 자산 | 누적 | QQQ 누적 | 초과 | MDD | 매수 | 스킵월 |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|");
  for (const row of rows) {
    lines.push(`| ${row.label} | ${krw(row.finalAsset)} | ${pct(row.totalReturn)} | ${pct(row.benchmarkReturn)} | ${pct(row.excessReturn)} | ${pct(row.maxDrawdown)} | ${row.buys} | ${row.skippedPeriods} |`);
  }
}

function table(lines, rows, horizon = "6m") {
  lines.push("| 전략 | Active | Empty | Avg Names | Avg | Median | Positive | Beat QQQ | Avg QQQ Excess |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const row of rows) {
    const h = row.horizons[horizon];
    lines.push(`| ${row.label} | ${row.activePeriods} | ${row.emptyPeriods} | ${row.averageSelectedCount?.toFixed(1) ?? "-"} | ${pct(h.averageReturn)} | ${pct(h.medianReturn)} | ${pct(h.positiveRate)} | ${pct(h.beatQqqRate)} | ${pct(h.averageExcessQqq)} |`);
  }
}

function splitTable(lines, splitResults, candidateKey, baselineKey = "baseline_top2", horizon = "6m") {
  lines.push("| 구간 | 기준 QQQ 초과 | 후보 QQQ 초과 | 후보 평균수익 | 개선폭 | Active | Empty |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|");
  for (const split of splitResults) {
    const baseline = split.results.find((row) => row.key === baselineKey);
    const candidate = split.results.find((row) => row.key === candidateKey);
    const baselineExcess = baseline?.horizons[horizon]?.averageExcessQqq;
    const candidateExcess = candidate?.horizons[horizon]?.averageExcessQqq;
    lines.push(`| ${split.label} | ${pct(baselineExcess)} | ${pct(candidateExcess)} | ${pct(candidate?.horizons[horizon]?.averageReturn)} | ${pct(candidateExcess - baselineExcess)} | ${candidate?.activePeriods ?? 0} | ${candidate?.emptyPeriods ?? 0} |`);
  }
}

function markdown(result) {
  const lines = [];
  lines.push("# Selection Strategy Lab");
  lines.push("");
  lines.push(`Generated at: ${result.generatedAt}`);
  lines.push(`Source: ${result.source}`);
  lines.push(`Periods: ${result.periodCount}`);
  lines.push("Test target: monthly 2-stock selection from saved Top20 candidates.");
  lines.push("");
  lines.push("## 팀별 검토 요약");
  lines.push("");
  lines.push("- 전략 리서치팀: 반복 추천, AI/반도체, 눌림 재가속, 과열 회피, 섹터 분산 후보를 제안했다.");
  lines.push("- 데이터/유니버스팀: 기존 월별 Top20 후보와 1/3/6/12개월 사후 수익률을 사용했다.");
  lines.push("- 퀀트/백테스트팀: 월 2개 선정 기준으로 6개월과 12개월 성과를 비교했다.");
  lines.push("- 리스크/검증팀: 빈 달이 많은 전략, AI/반도체 의존 전략, 최근 구간 편향 전략을 따로 표시했다.");
  lines.push("- 포트폴리오/자금배분팀: 이 결과는 선정 규칙 후보이며, 실제 투입 전에는 1천만원 계좌 시뮬레이션으로 다시 검증해야 한다.");
  lines.push("");
  lines.push("## 6개월 성과 순위");
  lines.push("");
  table(lines, result.rankings.all6m, "6m");
  lines.push("");
  lines.push("## 12개월 성과 순위");
  lines.push("");
  table(lines, result.rankings.all12m, "12m");
  lines.push("");
  lines.push("## Robust Check, 6개월");
  lines.push("");
  lines.push("개별 후보 수익률이 +300%를 넘는 이상치를 제외하고 다시 계산했다.");
  lines.push("");
  table(lines, result.rankings.robust6m, "6m");
  lines.push("");
  lines.push("## 1천만원 계좌 프록시, 6개월 고정 보유");
  lines.push("");
  lines.push("후보당 75만원을 매수하고 6개월 뒤 전량 매도한다고 가정했다. 거래비용은 매수/매도 각각 0.1%로 반영했다. 주봉 연장 매도까지 반영한 완성 계좌 백테스트는 다음 단계에서 별도 검증해야 한다.");
  lines.push("");
  accountTable(lines, result.accountSimulations);
  lines.push("");
  const best = result.rankings.all6m[0];
  const robustBest = result.rankings.robust6m[0];
  const accountBest = result.accountSimulations[0];
  lines.push("## 구간별 안정성");
  lines.push("");
  splitTable(lines, result.splitResults, best.key, "baseline_top2", "6m");
  lines.push("");
  lines.push("## 1차 판정");
  lines.push("");
  lines.push(`- 6개월 기준 1위: ${best.label}, 평균 QQQ 초과 ${pct(best.horizons["6m"].averageExcessQqq)}.`);
  lines.push(`- Robust 6개월 기준 1위: ${robustBest.label}, 평균 QQQ 초과 ${pct(robustBest.horizons["6m"].averageExcessQqq)}.`);
  lines.push(`- 1천만원 6개월 고정 보유 프록시 1위: ${accountBest.label}, 누적 ${pct(accountBest.totalReturn)}, QQQ 대비 ${pct(accountBest.excessReturn)}.`);
  lines.push("- 다만 이 실험은 저장된 Top20 후보 안에서 고르는 규칙 검증이며, 현재 Leader2 계좌 전략과 바로 1:1 교체할 수 있는 완성 백테스트는 아니다.");
  lines.push("- 다음 단계는 상위 후보를 월별 매수/매도 계좌 시뮬레이션에 연결해 실제 자금 제한 조건으로 재검증하는 것이다.");
  lines.push("");
  lines.push("## 후보 전략 설명");
  lines.push("");
  for (const strategy of result.strategyDefinitions) {
    lines.push(`- ${strategy.label}: ${strategy.description}`);
  }
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const data = JSON.parse(await fs.readFile(inputPath, "utf8"));
  const periods = withHistory(data.periods ?? []);
  const allResults = strategies.map((strategy) => summarizeStrategy(periods, strategy));
  const robustResults = strategies.map((strategy) => summarizeStrategy(periods, strategy, () => true, true));
  const splitResults = splitDefinitions.map((split) => ({
    key: split.key,
    label: split.label,
    results: strategies.map((strategy) => summarizeStrategy(
      periods,
      strategy,
      (period, index) => split.filter(period, index, periods)
    ))
  }));
  const accountSimulations = rankRows(strategies.map((strategy) => {
    const simulation = simulateFixed6mAccount(periods, strategy);
    return {
      ...simulation,
      horizons: {
        "6m": {
          averageReturn: simulation.totalReturn,
          averageExcessQqq: simulation.excessReturn
        }
      }
    };
  }), "6m");
  const result = {
    generatedAt: new Date().toISOString(),
    source: inputPath,
    sourceGeneratedAt: data.generatedAt,
    periodCount: periods.length,
    strategyDefinitions: strategies.map(({ key, label, description }) => ({ key, label, description })),
    results: allResults,
    robustResults,
    splitResults,
    accountSimulations,
    rankings: {
      all6m: rankRows(allResults, "6m"),
      all12m: rankRows(allResults, "12m"),
      robust6m: rankRows(robustResults, "6m")
    }
  };
  await fs.writeFile(outputJsonPath, JSON.stringify(result, null, 2), "utf8");
  await fs.writeFile(outputMdPath, markdown(result), "utf8");
  console.log(`Wrote ${outputJsonPath} and ${outputMdPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
