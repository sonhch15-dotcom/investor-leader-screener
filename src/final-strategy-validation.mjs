import fs from "node:fs/promises";
import path from "node:path";

const monthlyPath = path.join("data", "monthly-buy-rule-test-5y.json");
const leaderExecutionPath = path.join("data", "scale-execution-test.json");
const convictionExecutionPath = path.join("data", "scale-execution-test-conviction.json");
const leaderLabPath = path.join("data", "strategy-development-lab.json");
const convictionLabPath = path.join("data", "strategy-development-lab-conviction.json");
const outputJsonPath = path.join("data", "final-strategy-validation.json");
const outputMdPath = "final_strategy_validation.md";

function pct(value) {
  if (!Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(1)}%`;
}

function money(value) {
  if (!Number.isFinite(value)) return "-";
  return Math.round(value).toLocaleString("ko-KR");
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function byKey(rows, key) {
  return rows.find((row) => row.key === key);
}

function halfWeeklySummary(data) {
  return data.summaries.find((row) => row.key === "half_sell_half_weekly_extend");
}

function accountRow(data, key) {
  return data.results.find((row) => row.key === key);
}

function selectedMonthlyRows(monthly) {
  return ["conviction_diverse2", "leader2_one_each", "baseline_top2"]
    .map((key) => byKey(monthly.rankedResults, key))
    .filter(Boolean);
}

function tableMonthly(lines, rows) {
  lines.push("| 선정 전략 | 5년 누적 | CAGR | QQQ 누적 | QQQ 초과 | MDD | 월간 플러스 | QQQ 월초과 | 평균 보유 종목 |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const row of rows) {
    lines.push(`| ${row.label} | ${pct(row.totalReturn)} | ${pct(row.cagr)} | ${pct(row.qqqTotalReturn)} | ${pct(row.excessQqqTotal)} | ${pct(row.maxDrawdown)} | ${pct(row.positiveMonthRate)} | ${pct(row.beatQqqMonthRate)} | ${row.averageHeldCount?.toFixed(1) ?? "-"} |`);
  }
}

function tableExecution(lines, rows) {
  lines.push("| 선정 전략 | 완료 거래 | 평균 보유일 | 평균 거래수익 | 중앙값 | 승률 | 평균 QQQ | 평균 QQQ 초과 | 매도 사유 |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---|");
  for (const row of rows) {
    const reasons = Object.entries(row.sellReasons ?? {}).map(([key, value]) => `${key}: ${value}`).join(", ");
    lines.push(`| ${row.strategyLabel} | ${row.enteredTrades} | ${row.averageHoldDays} | ${pct(row.averageReturn)} | ${pct(row.medianReturn)} | ${pct(row.winRate)} | ${pct(row.averageQqqReturn)} | ${pct(row.averageExcessQqq)} | ${reasons} |`);
  }
}

function tableAccount(lines, rows) {
  lines.push("| 최종 계좌 전략 | 선정 엔진 | 최종 자산 | 누적 수익률 | CAGR | MDD | 매수 | 스킵 | 최소 현금 |");
  lines.push("|---|---|---:|---:|---:|---:|---:|---:|---:|");
  for (const row of rows) {
    lines.push(`| ${row.label} | ${row.selectionEngine} | ${money(row.finalCapital)} | ${pct(row.totalReturn)} | ${pct(row.cagr)} | ${pct(row.maxDrawdownAtCost)} | ${row.executedBuys}/${row.attemptedBuys} | ${row.skippedBuys} | ${money(row.minCash)} |`);
  }
}

function recentSelections(strategy) {
  return (strategy.selectionTimeline ?? []).slice(-6).map((row) => ({
    asOf: row.asOf,
    entryDate: row.entryDate,
    symbols: row.symbols,
    groups: row.groups
  }));
}

function tableRecent(lines, title, rows) {
  lines.push(`### ${title}`);
  lines.push("");
  lines.push("| 기준월 | 매수일 | 신규 후보 | 섹터 |");
  lines.push("|---|---|---|---|");
  for (const row of rows) {
    lines.push(`| ${row.asOf} | ${row.entryDate} | ${(row.symbols ?? []).join(", ")} | ${(row.groups ?? []).join(", ")} |`);
  }
  lines.push("");
}

function markdown(result) {
  const lines = [];
  lines.push("# Final Strategy Validation");
  lines.push("");
  lines.push(`Generated at: ${result.generatedAt}`);
  lines.push(`Period: ${result.period.start} to ${result.period.end}`);
  lines.push("");
  lines.push("## 최종 결론");
  lines.push("");
  lines.push(`- 전체 완성 계좌 기준 1등은 **${result.finalWinner.label}** 입니다. 선정 엔진은 **${result.finalWinner.selectionEngine}**, 누적 수익률은 **${pct(result.finalWinner.totalReturn)}** 입니다.`);
  lines.push(`- 실전 우선 후보는 **Leader2 One Each + Repeat + Theme Combo Cap27.5** 입니다. 누적 **${pct(result.practicalWinner.totalReturn)}**, MDD **${pct(result.practicalWinner.maxDrawdownAtCost)}**로 Cap30보다 조금 보수적입니다.`);
  lines.push(`- 방금 개발한 **Conviction Diverse Top2**는 월별 선정력 테스트에서는 1등이었지만, 완성 계좌 검증에서는 기존 Leader2 기반 전략을 넘지 못했습니다.`);
  lines.push("- 따라서 Conviction Diverse는 active 승격이 아니라 보관/추가 연구 대상으로 두는 것이 맞습니다.");
  lines.push("");
  lines.push("## 1. 월별 선정력 검증");
  lines.push("");
  lines.push("이 단계는 매달 새 후보 2개를 고르고 6개월 슬리브로 보유했을 때의 순수 선정력입니다. 자금 한도, 중복 매수 제한, 주봉 연장 매도는 아직 완전히 반영하지 않습니다.");
  lines.push("");
  tableMonthly(lines, result.monthlySelectionRows);
  lines.push("");
  lines.push("해석: Conviction Diverse Top2는 이 단계에서 가장 좋았습니다. 다만 MDD도 더 크고, 실제 계좌에서 반복 종목이 계속 쌓일 때의 한도 문제는 이 표에 충분히 반영되지 않습니다.");
  lines.push("");
  lines.push("## 2. 매수/매도 실행 검증");
  lines.push("");
  lines.push("두 전략 모두 같은 실행 규칙을 적용했습니다. 월말 확정 후 다음 거래일에 매수하고, 6개월 뒤 50% 매도합니다. 남은 50%는 6개월 시점에 주봉 10주선 위 + RSI 50 이상이면 연장하고, 이후 10주선 2주 연속 이탈 또는 최대 12개월 도달 시 매도합니다.");
  lines.push("");
  tableExecution(lines, result.executionRows);
  lines.push("");
  lines.push("해석: Conviction Diverse는 월별 선정력은 강했지만, 실제 50% 매도 + 주봉 연장 매도 기준에서는 평균 거래수익이 Leader2보다 낮았습니다.");
  lines.push("");
  lines.push("## 3. 1천만원 자금 제한 계좌 검증");
  lines.push("");
  lines.push("초기 자본 1천만원, 매수/매도 비용 0.1%, 중복 종목 원금 한도, 현금 부족 시 스킵을 반영했습니다.");
  lines.push("");
  tableAccount(lines, result.accountRows);
  lines.push("");
  lines.push("해석: 완성 계좌에서는 Leader2 One Each에 Repeat + Theme Combo 배분을 붙인 전략이 가장 강했습니다. Conviction Diverse는 반복 종목 집중 때문에 실제 계좌에서 매수 스킵이 늘고, 최종 누적 성과가 낮아졌습니다.");
  lines.push("");
  lines.push("## 4. 최근 매수 후보 예시");
  lines.push("");
  tableRecent(lines, "Leader2 One Each", result.recentSelections.leader2);
  tableRecent(lines, "Conviction Diverse Top2", result.recentSelections.conviction);
  lines.push("## 전략별 매수/매도 방식");
  lines.push("");
  lines.push("- Leader2 One Each: 매월 주도 섹터 상위 2개를 찾고, 각 섹터에서 1등 종목을 하나씩 삽니다.");
  lines.push("- Conviction Diverse Top2: 전체 후보 중 기존 점수, 최근 Top20 반복, 최근 섹터 반복, AI/반도체 신호, 주요 이동평균 위치를 합산해 서로 다른 섹터 2개를 삽니다.");
  lines.push("- Repeat + Theme Combo 배분: 매수 대상은 Leader2가 고르고, 반복 추천 또는 AI/반도체 하드웨어 성격이면 매수 금액을 키웁니다. 종목당 한도는 Cap25, Cap27.5, Cap30으로 나뉩니다.");
  lines.push("- 공통 매도: 6개월에 50% 기본 매도, 잔여 50%는 주봉 추세가 살아 있으면 연장, 10주선 2주 이탈 또는 12개월 도달 시 정리합니다.");
  lines.push("");
  lines.push("## 최종 판정");
  lines.push("");
  lines.push("1. 현재까지 개발한 전략 중 성과 1등은 **Leader2 One Each + Repeat + Theme Combo Cap30**입니다.");
  lines.push("2. 실제 운용 우선안은 **Leader2 One Each + Repeat + Theme Combo Cap27.5**입니다. 성과는 거의 비슷하면서 과집중 위험을 조금 낮춥니다.");
  lines.push("3. Conviction Diverse Top2는 이번 검증으로 “추가 테스트 필요”가 아니라, **현재 active 전략을 대체하기에는 부족**하다는 판정입니다.");
  lines.push("4. Conviction Diverse의 아이디어 중 반복 추천/반복 섹터/AI 하드웨어 가중은 버리지 않고, 이미 성과가 좋은 Repeat + Theme Combo 배분 전략 안에서 활용하는 편이 낫습니다.");
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const [monthly, leaderExecution, convictionExecution, leaderLab, convictionLab] = await Promise.all([
    readJson(monthlyPath),
    readJson(leaderExecutionPath),
    readJson(convictionExecutionPath),
    readJson(leaderLabPath),
    readJson(convictionLabPath)
  ]);

  const leaderMonthly = byKey(monthly.rankedResults, "leader2_one_each");
  const convictionMonthly = byKey(monthly.rankedResults, "conviction_diverse2");
  const accountRows = [
    { ...accountRow(leaderLab, "repeat_theme_combo"), selectionEngine: "Leader2 One Each" },
    { ...accountRow(leaderLab, "repeat_theme_combo_cap275"), selectionEngine: "Leader2 One Each" },
    { ...accountRow(leaderLab, "active_ramp_aggressive_3m"), selectionEngine: "Leader2 One Each" },
    { ...accountRow(convictionLab, "repeat_theme_combo"), selectionEngine: "Conviction Diverse Top2" },
    { ...accountRow(convictionLab, "repeat_theme_combo_cap275"), selectionEngine: "Conviction Diverse Top2" },
    { ...accountRow(convictionLab, "active_ramp_aggressive_3m"), selectionEngine: "Conviction Diverse Top2" }
  ].filter(Boolean).sort((a, b) => b.totalReturn - a.totalReturn);

  const result = {
    generatedAt: new Date().toISOString(),
    period: {
      start: monthly.startDate,
      end: monthly.endDate
    },
    finalWinner: accountRows[0],
    practicalWinner: accountRows.find((row) => row.selectionEngine === "Leader2 One Each" && row.key === "repeat_theme_combo_cap275"),
    monthlySelectionRows: selectedMonthlyRows(monthly),
    executionRows: [
      { strategyLabel: "Leader2 One Each", ...halfWeeklySummary(leaderExecution) },
      { strategyLabel: "Conviction Diverse Top2", ...halfWeeklySummary(convictionExecution) }
    ],
    accountRows,
    recentSelections: {
      leader2: recentSelections(leaderMonthly),
      conviction: recentSelections(convictionMonthly)
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
