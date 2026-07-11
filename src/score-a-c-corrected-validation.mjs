import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const selectionPath = path.join("data", "sector-score-variant-test-corrected-frozen-20260711.json");
const scoreAPath = path.join("data", "strategy-development-lab-corrected-score-a-20260711.json");
const scoreCPath = path.join("data", "strategy-development-lab-corrected-score-c-20260711.json");
const outputJsonPath = path.join("data", "score-a-c-corrected-validation.json");
const outputMdPath = "score_a_c_corrected_validation.md";
const capKey = "repeat_theme_combo_cap275";

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function capResult(rows) {
  return rows.find((row) => row.key === capKey);
}

function selectionResult(data, key) {
  const row = data.results.find((item) => item.key === key);
  return {
    totalReturn: row.totalReturn,
    cagr: row.cagr,
    maxDrawdown: row.maxDrawdown,
    qqqTotalReturn: row.qqqTotalReturn,
    periodCount: row.periodCount
  };
}

function accountResult(data) {
  const row = capResult(data.results);
  const robust = capResult(data.robustResults);
  return {
    totalReturn: row.totalReturn,
    cagr: row.cagr,
    maxDrawdown: row.maxDrawdown,
    legacyCostMdd: row.maxDrawdownAtCost,
    finalCapital: row.finalCapital,
    finalCash: row.finalCash,
    openMarketValue: row.openMarketValue,
    openLotCount: row.openLotCount,
    executedBuys: row.executedBuys,
    skippedBuys: row.skippedBuys,
    transactionCost: row.totalTransactionCost,
    benchmark: row.benchmark,
    robust: {
      totalReturn: robust.totalReturn,
      cagr: robust.cagr,
      maxDrawdown: robust.maxDrawdown
    }
  };
}

function pct(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "-";
}

const selection = await readJson(selectionPath);
const scoreAData = await readJson(scoreAPath);
const scoreCData = await readJson(scoreCPath);

if (scoreAData.priceSnapshotHash !== scoreCData.priceSnapshotHash) {
  throw new Error("Score A and C must use the same frozen price snapshot.");
}
if (scoreAData.valuationMode !== "weekly_mark_to_market" || scoreCData.valuationMode !== "weekly_mark_to_market") {
  throw new Error("Corrected validation requires weekly mark-to-market account curves.");
}

const scoreA = {
  selection: selectionResult(selection, "a_current_sector20"),
  account: accountResult(scoreAData)
};
const scoreC = {
  selection: selectionResult(selection, "c_half_sector_normalized"),
  account: accountResult(scoreCData)
};

const annualComparisons = scoreAData.walkForwardResults.map((period) => {
  const scoreAPeriod = capResult(period.results);
  const scoreCPeriod = capResult(
    scoreCData.walkForwardResults.find((row) => row.key === period.key).results
  );
  return {
    key: period.key,
    label: period.label,
    scoreATradeCount: period.tradeCount,
    scoreCTradeCount: scoreCData.walkForwardResults.find((row) => row.key === period.key).tradeCount,
    scoreAReturn: scoreAPeriod.totalReturn,
    scoreCReturn: scoreCPeriod.totalReturn,
    scoreAMaxDrawdown: scoreAPeriod.maxDrawdown,
    scoreCMaxDrawdown: scoreCPeriod.maxDrawdown,
    winner: scoreCPeriod.totalReturn > scoreAPeriod.totalReturn ? "Score C" : "Score A"
  };
});

const gates = [
  {
    key: "same_frozen_snapshot",
    label: "동일 고정 가격 스냅샷",
    passed: scoreAData.priceSnapshotHash === scoreCData.priceSnapshotHash
      && scoreAData.priceSnapshotHash === selection.priceSnapshotHash
  },
  {
    key: "full_period_return",
    label: "전체 계좌 수익률 우위",
    passed: scoreC.account.totalReturn > scoreA.account.totalReturn
  },
  {
    key: "robust_return",
    label: "300% 초과 거래 제외 계좌 수익률 우위",
    passed: scoreC.account.robust.totalReturn > scoreA.account.robust.totalReturn
  },
  {
    key: "annual_consistency",
    label: "연도별 독립 계좌 4개 이상 우위",
    passed: annualComparisons.filter((row) => row.winner === "Score C").length >= 4
  },
  {
    key: "drawdown_guardrail",
    label: "시장가 MDD 악화 3%p 이내",
    passed: scoreC.account.maxDrawdown >= scoreA.account.maxDrawdown - 0.03
  },
  {
    key: "benchmark",
    label: "전체 계좌 QQQ 초과",
    passed: scoreC.account.totalReturn > scoreC.account.benchmark.totalReturn
  },
  {
    key: "reproducibility_metadata",
    label: "유니버스·가격 해시 기록",
    passed: Boolean(selection.universeHash && selection.priceSnapshotHash)
  }
];

const candidatePassed = gates.every((gate) => gate.passed);
const result = {
  generatedAt: new Date().toISOString(),
  runId: "us-score-a-c-corrected-frozen-20260711",
  grade: "Candidate",
  period: {
    startDate: selection.startDate,
    endDate: selection.endDate,
    accountStartDate: scoreA.account.benchmark.firstDate,
    accountEndDate: scoreA.account.benchmark.lastDate,
    priceAsOf: selection.priceAsOf,
    universeSize: selection.universeSize
  },
  provenance: {
    universeSource: selection.universeSource,
    universeHash: selection.universeHash,
    universeHashDefinition: "SHA-256 of JSON.stringify(normalized instrument array), not raw file bytes",
    priceSnapshotPath: selection.priceSnapshotPath,
    priceSnapshotHash: selection.priceSnapshotHash,
    priceSnapshotHashDefinition: "SHA-256 of canonical uncompressed snapshot payload: version, firstDate, asOf, series",
    priceSnapshotPublishedToPages: false,
    valuationMode: scoreAData.valuationMode,
    incompleteTradePolicy: scoreAData.incompleteTradePolicy,
    transactionCostBps: scoreAData.costBps
  },
  strategy: {
    selectionCount: 2,
    accountRule: "Repeat + Theme Combo Cap27.5",
    exitRule: "6-month 50% sell; remaining 50% weekly 10-week MA and RSI extension",
    benchmark: "QQQ"
  },
  scoreA,
  scoreC,
  annualComparisons,
  gates,
  candidatePassed,
  decision: {
    scoreCStatus: candidatePassed ? "validated_candidate" : "candidate_failed",
    liveActiveStrategy: "Score A Leader2 Cap27.5",
    recommendedSelectionCount: 2,
    officialPromotion: false,
    officialPromotionBlocker: "The fixed universe is a current-constituent snapshot rather than a point-in-time historical membership dataset, and Score C has no untouched forward observation period yet.",
    nextAction: candidatePassed
      ? "Keep Score C in shadow/testing status and collect forward signals while building a point-in-time universe audit."
      : "Retain Score A and investigate failed gates."
  }
};

const lines = [
  "# Corrected Score A vs Score C Validation",
  "",
  `Run ID: ${result.runId}`,
  `Grade: ${result.grade}`,
  `Selection period: ${result.period.startDate} to ${result.period.endDate}`,
  `Account period: ${result.period.accountStartDate} to ${result.period.accountEndDate}`,
  `Universe: ${result.period.universeSize}`,
  `Price snapshot: ${result.provenance.priceSnapshotHash}`,
  "",
  "## Corrected Account Results",
  "",
  "| Metric | Score A | Score C |",
  "|---|---:|---:|",
  `| Selection return | ${pct(scoreA.selection.totalReturn)} | ${pct(scoreC.selection.totalReturn)} |`,
  `| Account return | ${pct(scoreA.account.totalReturn)} | ${pct(scoreC.account.totalReturn)} |`,
  `| Account CAGR | ${pct(scoreA.account.cagr)} | ${pct(scoreC.account.cagr)} |`,
  `| Market-value MDD | ${pct(scoreA.account.maxDrawdown)} | ${pct(scoreC.account.maxDrawdown)} |`,
  `| Robust return | ${pct(scoreA.account.robust.totalReturn)} | ${pct(scoreC.account.robust.totalReturn)} |`,
  `| QQQ return | ${pct(scoreA.account.benchmark.totalReturn)} | ${pct(scoreC.account.benchmark.totalReturn)} |`,
  "",
  "## Annual Signal Cohorts",
  "",
  "| Cohort | Score A | Score C | Winner | A MDD | C MDD |",
  "|---|---:|---:|---|---:|---:|",
  ...annualComparisons.map((row) => (
    `| ${row.label} | ${pct(row.scoreAReturn)} | ${pct(row.scoreCReturn)} | ${row.winner} | ${pct(row.scoreAMaxDrawdown)} | ${pct(row.scoreCMaxDrawdown)} |`
  )),
  "",
  "## Promotion Gates",
  "",
  ...gates.map((gate) => `- ${gate.passed ? "PASS" : "FAIL"}: ${gate.label}`),
  "",
  "## Decision",
  "",
  `- Candidate result: ${result.decision.scoreCStatus}`,
  `- Live active: ${result.decision.liveActiveStrategy}`,
  `- Official promotion: ${result.decision.officialPromotion}`,
  `- Blocker: ${result.decision.officialPromotionBlocker}`,
  `- Next: ${result.decision.nextAction}`,
  ""
];

await fs.writeFile(outputJsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
await fs.writeFile(outputMdPath, lines.join("\n"), "utf8");
console.log(`Wrote ${outputJsonPath} and ${outputMdPath}`);
