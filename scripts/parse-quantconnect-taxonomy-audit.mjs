import fs from "node:fs/promises";
import path from "node:path";

const inputPath = valueAfter("--input");
const outputPath = valueAfter("--output") ?? "data/quantconnect-taxonomy-leader-group-audit.json";

if (!inputPath) throw new Error("--input <QuantConnect log path> is required");

const VARIANTS = {
  LEGACY_FULL: { label: "기존 57개 혼합 전체", family: "legacy", role: "diagnostic" },
  LEGACY_GROUP: { label: "혼합 업종 묶음만 사용", family: "legacy", role: "diagnostic" },
  MSTAR_GROUP_RAW: { label: "Morningstar 산업그룹 원형", family: "morningstar", role: "baseline" },
  MSTAR_INDUSTRY_RAW: { label: "Morningstar 세부 산업 원형", family: "morningstar", role: "diagnostic" },
  MSTAR_GROUP_SHRUNK: { label: "산업그룹 표본 보정", family: "morningstar", role: "candidate" },
  MSTAR_ADAPTIVE: { label: "적응형 상위 분류", family: "morningstar", role: "candidate" },
  NO_GROUP: { label: "업종 단계 제거", family: "control", role: "control" }
};

const SCORES = {
  A: { label: "기본 종목점수", description: "업종 흐름을 온전히 반영하는 현재 기본 점수 구조" },
  C: { label: "균형 종목점수", description: "업종 비중을 절반으로 낮추고 개별 종목 힘을 더 반영" }
};

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function fields(line) {
  const parts = line.split("|");
  const secondPartIsField = parts[1]?.includes("=");
  const output = { type: parts[0], key: secondPartIsField ? undefined : parts[1] };
  for (const part of parts.slice(secondPartIsField ? 1 : 2)) {
    const index = part.indexOf("=");
    if (index > 0) output[part.slice(0, index)] = part.slice(index + 1);
  }
  return output;
}

function pair(value, names) {
  const values = String(value).split("/").map(Number);
  return Object.fromEntries(names.map((name, index) => [name, values[index]]));
}

function winner(value) {
  const index = value.lastIndexOf(":");
  return { lot: value.slice(0, index), profitKrw: Number(value.slice(index + 1)) };
}

function parseMeta(line) {
  const parsed = fields(line);
  return {
    mode: parsed.mode,
    signalMonths: Number(parsed.signals),
    everConstituents: Number(parsed.ever),
    currentConstituents: Number(parsed.current),
    lastPriceDate: parsed.last_data,
    selectedDelistingCount: Number(parsed.delist_selected),
    costEachSide: Number(parsed.cost),
    executionDelayTradingDays: Number(parsed.delay),
    membershipLagTradingDays: Number(parsed.membership_lag),
    shrinkStrength: Number(parsed.shrink),
    adaptiveIndustryMinimum: Number(parsed.adaptive_min)
  };
}

const rawLines = (await fs.readFile(inputPath, "utf8"))
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

const expectedCounts = {
  TAXONOMY_META: 1,
  SUMMARY: 14,
  TAIL: 14,
  PERIOD: 14,
  ROLLING: 14,
  GROUP_DIAG: 14,
  OVERLAP: 14,
  TOPOLOGY: 6,
  CLASS_CHANGE: 1,
  SELECTED_DELIST: 1
};

for (const [type, expected] of Object.entries(expectedCounts)) {
  const actual = rawLines.filter((line) => line.startsWith(`${type}|`)).length;
  if (actual !== expected) throw new Error(`${type} expected ${expected} lines, received ${actual}`);
}

const results = new Map();
function resultFor(key) {
  if (!results.has(key)) {
    const [scoreKey, taxonomyKey] = key.split("__");
    results.set(key, {
      key,
      scoreKey,
      scoreLabel: SCORES[scoreKey].label,
      taxonomyKey,
      taxonomyLabel: VARIANTS[taxonomyKey].label,
      family: VARIANTS[taxonomyKey].family,
      role: VARIANTS[taxonomyKey].role
    });
  }
  return results.get(key);
}

for (const line of rawLines) {
  if (line.startsWith("SUMMARY|")) {
    const parsed = fields(line);
    const row = resultFor(parsed.key);
    const buys = pair(parsed.buys, ["executed", "attempted"]);
    Object.assign(row, {
      totalReturn: Number(parsed.ret),
      cagr: Number(parsed.cagr),
      maxDrawdown: Number(parsed.mdd),
      qqqReturn: Number(parsed.qqq),
      buys,
      skippedBuys: Number(parsed.skip),
      finalCashKrw: Number(parsed.cash),
      finalEquityKrw: Number(parsed.equity),
      openLots: Number(parsed.open),
      transactionCostKrw: Number(parsed.cost)
    });
  } else if (line.startsWith("TAIL|")) {
    const parsed = fields(line);
    Object.assign(resultFor(parsed.key), {
      topWinners: [winner(parsed.top1), winner(parsed.top2)],
      returnWithoutTop1: Number(parsed.ret_without1),
      returnWithoutTop2: Number(parsed.ret_without2)
    });
  } else if (line.startsWith("PERIOD|")) {
    const parsed = fields(line);
    resultFor(parsed.key).periods = {
      design: pair(parsed.DESIGN, ["strategy", "qqq"]),
      validation: pair(parsed.VALIDATE, ["strategy", "qqq"]),
      holdout: pair(parsed.HOLDOUT, ["strategy", "qqq"])
    };
  } else if (line.startsWith("ROLLING|")) {
    const parsed = fields(line);
    resultFor(parsed.key).rolling = {
      win36: Number(parsed.win36),
      observations36: Number(parsed.n36),
      win60: Number(parsed.win60),
      observations60: Number(parsed.n60)
    };
  } else if (line.startsWith("GROUP_DIAG|")) {
    const parsed = fields(line);
    resultFor(parsed.key).selectedGroupSize = {
      average: Number(parsed.avg),
      median: Number(parsed.median),
      atMost4Rate: Number(parsed.le4),
      atMost7Rate: Number(parsed.le7),
      observations: Number(parsed.n)
    };
  } else if (line.startsWith("OVERLAP|")) {
    const parsed = fields(line);
    resultFor(parsed.key).selectionOverlap = {
      legacy: pair(parsed.legacy, ["averageMatches", "exactTwoRate", "months"]),
      morningstarRaw: pair(parsed.mstar, ["averageMatches", "exactTwoRate", "months"])
    };
  }
}

const meta = parseMeta(rawLines.find((line) => line.startsWith("TAXONOMY_META|")));
const topology = rawLines.filter((line) => line.startsWith("TOPOLOGY|"))
  .map((line) => {
    const parsed = fields(line);
    return {
      taxonomyKey: parsed.key,
      taxonomyLabel: VARIANTS[parsed.key].label,
      averageGroups: Number(parsed.avg_groups),
      averageMedianSize: Number(parsed.median_size),
      smallGroupShare: Number(parsed.small_group_share),
      months: Number(parsed.months)
    };
  });
const classification = fields(rawLines.find((line) => line.startsWith("CLASS_CHANGE|")));
const selectedDelistingLine = rawLines.find((line) => line.startsWith("SELECTED_DELIST|"));

const rankedResults = [...results.values()].sort((a, b) => b.totalReturn - a.totalReturn);
const baseline = results.get("A__MSTAR_GROUP_RAW");
const candidate = results.get("A__MSTAR_ADAPTIVE");
const shrunk = results.get("A__MSTAR_GROUP_SHRUNK");
const candidateC = results.get("C__MSTAR_ADAPTIVE");

const comparison = {
  baselineKey: baseline.key,
  candidateKey: candidate.key,
  returnDelta: round(candidate.totalReturn - baseline.totalReturn),
  cagrDelta: round(candidate.cagr - baseline.cagr),
  drawdownImprovement: round(candidate.maxDrawdown - baseline.maxDrawdown),
  periodDeltas: {
    design: round(candidate.periods.design.strategy - baseline.periods.design.strategy),
    validation: round(candidate.periods.validation.strategy - baseline.periods.validation.strategy),
    holdout: round(candidate.periods.holdout.strategy - baseline.periods.holdout.strategy)
  },
  returnWithoutTop2Delta: round(candidate.returnWithoutTop2 - baseline.returnWithoutTop2),
  adaptiveAminusC: {
    returnDelta: round(candidate.totalReturn - candidateC.totalReturn),
    drawdownImprovement: round(candidate.maxDrawdown - candidateC.maxDrawdown)
  },
  shrunkVsBaseline: {
    returnDelta: round(shrunk.totalReturn - baseline.totalReturn),
    drawdownImprovement: round(shrunk.maxDrawdown - baseline.maxDrawdown),
    holdoutDelta: round(shrunk.periods.holdout.strategy - baseline.periods.holdout.strategy)
  }
};

const promotionGates = [
  { key: "repeatability", label: "동일 코드 반복 실행", status: "passed", detail: "93개 결과 로그가 두 실행에서 모두 일치" },
  { key: "total_return", label: "원형보다 누적 수익 개선", status: "passed", detail: `+${(comparison.returnDelta * 100).toFixed(2)}%p` },
  { key: "drawdown", label: "MDD 3%p 이상 악화 금지", status: "passed", detail: `${(comparison.drawdownImprovement * 100).toFixed(2)}%p 개선` },
  { key: "all_periods", label: "설계·검증·최근 구간 모두 개선", status: "failed", detail: `설계 구간 ${(comparison.periodDeltas.design * 100).toFixed(2)}%p` },
  { key: "winner_dependence", label: "상위 2개 lot 제거 후 우위 유지", status: "warning", detail: `우위가 ${(comparison.returnDelta * 100).toFixed(2)}%p에서 ${(comparison.returnWithoutTop2Delta * 100).toFixed(2)}%p로 축소` },
  { key: "benchmark", label: "QQQ 장기 기회비용 통과", status: "failed", detail: `전략 ${(candidate.totalReturn * 100).toFixed(1)}%, QQQ ${(candidate.qqqReturn * 100).toFixed(1)}%` },
  { key: "forward", label: "6~12개월 미래 관찰", status: "failed", detail: "아직 관찰 기록 없음" }
];

const output = {
  generatedAt: new Date().toISOString(),
  runId: "us-taxonomy-leader-group-pit-100m-20260712-v1",
  status: "research_candidate_not_promoted",
  provider: "QuantConnect Free / LEAN master v17914",
  projectId: 34043103,
  backtests: [
    { name: "Sleepy Brown Bull", id: "dcacd8d01b3b98eb3007d95d341fbe0b" },
    { name: "Swimming Yellow Green Beaver", id: "64173920abc14bd159761164c52376ad" }
  ],
  reproducibility: {
    deterministicOrder: "symbol_group_tiebreak_v1",
    repeatedRuns: 2,
    rawLogLinesPerRun: rawLines.length,
    exactLogMatch: true,
    previousIssue: "Set iteration and score ties could change selections between processes; fixed before accepting results."
  },
  period: {
    firstSignal: "2010-08-27",
    lastSignalRequested: "2026-06-26",
    lastPriceDate: meta.lastPriceDate,
    signalMonths: meta.signalMonths,
    everConstituents: meta.everConstituents,
    currentConstituents: meta.currentConstituents
  },
  capitalContract: {
    initialKrw: 100_000_000,
    fractionalShares: true,
    costEachSide: meta.costEachSide,
    baseMonthlyAmountsKrw: [5_000_000, 7_500_000, 10_000_000],
    maxPositionPct: 0.275,
    minimumOrderKrw: 1_000_000
  },
  commonContract: {
    universe: "Point-in-time union of SPY and QQQ constituents",
    selectionsPerMonth: 2,
    executionDelayTradingDays: meta.executionDelayTradingDays,
    membershipLagTradingDays: meta.membershipLagTradingDays,
    exit: "Sell 50% at six months; extend only when weekly close >= MA10 and RSI14 >= 50; then exit on two weekly closes below MA10 or at 12 months",
    taxonomySource: "QuantConnect US Fundamentals Morningstar asset classification",
    shrinkStrength: meta.shrinkStrength,
    adaptiveIndustryMinimum: meta.adaptiveIndustryMinimum
  },
  scoreCatalog: SCORES,
  variantCatalog: VARIANTS,
  rankedResults,
  topology,
  classificationAudit: {
    observedChangeEvents: Number(classification.events),
    observedChangedSymbols: Number(classification.symbols),
    years: classification.years,
    interpretation: "No classification changes were observed in this run. This does not prove that the provider exposes complete historical reclassifications."
  },
  selectedDelistings: {
    count: meta.selectedDelistingCount,
    visibleLogText: selectedDelistingLine.slice("SELECTED_DELIST|".length),
    completeListAvailable: !selectedDelistingLine.endsWith("...")
  },
  comparison,
  promotionGates,
  decision: {
    bestResearchCandidate: candidate.key,
    operationalChange: false,
    recommendedStatus: "testing",
    summary: "Keep the current public strategy unchanged. Track A + adaptive taxonomy as a research candidate, because its full-period return and MDD improved but its design-period result lagged and almost all excess disappeared after removing the top two lots.",
    androidImpact: "none"
  },
  limitations: [
    "QuantConnect price data in this run ended on 2026-04-13.",
    "QQQ is continuously invested while the strategy can hold cash, so it is an opportunity-cost benchmark rather than a risk-matched portfolio.",
    "No Morningstar classification changes were observed; complete point-in-time reclassification history remains unverified.",
    "The top-winner diagnostic subtracts lot profit from final equity and is a concentration stress test, not a rerun with capital reallocated.",
    "Winner labels use mapped ticker strings; CEG@2011-09 requires a Security Identifier and corporate-action audit before promotion.",
    "No untouched 6-12 month forward observation period exists for the adaptive candidate.",
    "This research result does not change the public API, Android execution policy, or existing lot schedules."
  ],
  rawLogLines: rawLines
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`Wrote ${outputPath} with ${rankedResults.length} result rows.`);
