const loading = document.querySelector("#loading-state");

function pct(value, digits = 1) {
  if (!Number.isFinite(value)) return "해당 없음";
  const scale = 10 ** digits;
  const percentage = value * 100;
  const rounded = Math.sign(percentage) * Math.round((Math.abs(percentage) + Number.EPSILON) * scale) / scale;
  const sign = value > 0 ? "+" : "";
  return `${sign}${rounded.toFixed(digits)}%`;
}

function pp(value, digits = 1) {
  if (!Number.isFinite(value)) return "해당 없음";
  return `${(value * 100).toFixed(digits)}%p`;
}

function dateOnly(value) {
  return value ? new Date(value).toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" }) : "-";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function metric(label, value, note) {
  return `<article class="metric-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></article>`;
}

function finding(title, body) {
  return `<article class="finding-card"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(body)}</p></article>`;
}

function readingFor(key) {
  const readings = {
    legacy_raw: ["착시 위험", "warning", "작은 혼합 그룹의 영향이 큼"],
    legacy_min8: ["대조군", "", "작은 그룹을 통째로 빼는 거친 방식"],
    legacy_shrink8: ["다음 후보", "candidate", "위험을 낮추며 정보를 일부 보존"],
    legacy_min8_shrink8: ["보수 대조군", "", "두 보정을 함께 적용"],
    no_group: ["대조군", "", "업종 단계의 기여 확인용"]
  };
  return readings[key] ?? ["연구", "", ""];
}

function renderHeadline(audit) {
  const structure = audit.structure;
  document.querySelector("#headline-metrics").innerHTML = [
    metric("저장된 분류 라벨", `${structure.labelCount}개`, "한 단계로 설계된 체계가 아님"),
    metric("라벨당 중앙 종목 수", `${structure.medianSize}개`, "절반은 1종목짜리 라벨"),
    metric("2종목 이하 라벨", `${structure.labelsAtMost2}개`, "현재 최소 3종목 규칙에서 제외"),
    metric("원형 → 8종목 기준", "+919.5% → +423.7%", "같은 가격·같은 종목 점수")
  ].join("");

  document.querySelector("#key-findings").innerHTML = [
    finding("57개는 세밀한 업종표가 아닙니다", "넓은 섹터 11개와 세부 업종명 46개가 같은 칸에 섞인 수집 결과입니다."),
    finding("높은 수익률은 분류 구조에 민감합니다", "4종목짜리 전자부품 그룹이 25번 선택됐고, 작은 그룹을 막자 최근 수익이 크게 낮아졌습니다."),
    finding("일관 분류는 위험을 낮췄습니다", "장기 PIT에서 Morningstar 분류의 수익은 낮았지만 최대 하락은 혼합 분류보다 훨씬 얕았습니다.")
  ].join("");
}

function renderStructure(audit) {
  const structure = audit.structure;
  document.querySelector("#taxonomy-counts").innerHTML = [
    [structure.labelCount, "전체 라벨"],
    [structure.labelsAtMost2, "1~2종목"],
    [structure.labelsBelow8, "8종목 미만"]
  ].map(([value, label]) => `<div class="taxonomy-count"><strong>${value}</strong><span>${label}</span></div>`).join("");

  document.querySelector("#mixed-labels").innerHTML = [
    ["넓은 GICS 섹터", structure.broadLabelCount],
    ["세부 업종처럼 보이는 라벨", structure.industryLikeLabelCount],
    ["가장 작은 그룹", `${structure.minimumSize}종목`],
    ["가장 큰 그룹", `${structure.maximumSize}종목`]
  ].map(([label, value]) => `<div class="mixed-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");

  document.querySelector("#label-grid").innerHTML = structure.labels
    .map((row) => `<div class="label-item ${row.count <= 2 ? "small" : ""}" title="예: ${escapeHtml(row.examples.join(", "))}"><span>${escapeHtml(row.label)}</span><strong>${row.count}</strong></div>`)
    .join("");
}

function renderVariantBars(audit) {
  const rows = [...audit.rankedResults, {
    key: "qqq",
    label: "QQQ 계속 보유",
    totalReturn: audit.results[0].qqqTotalReturn
  }];
  const maximum = Math.max(...rows.map((row) => row.totalReturn));
  document.querySelector("#variant-bars").innerHTML = rows.map((row) => {
    const classes = row.key === "qqq" ? "benchmark" : row.key === "legacy_shrink8" ? "candidate" : "";
    return `<div class="return-bar-row ${classes}">
      <div class="return-bar-label">${escapeHtml(row.label)}</div>
      <div class="return-bar-track"><div class="return-bar-fill" style="width:${Math.max(1, row.totalReturn / maximum * 100).toFixed(2)}%"></div></div>
      <div class="return-bar-value">${pct(row.totalReturn)}</div>
    </div>`;
  }).join("");
}

function renderVariantTable(audit) {
  const displayOrder = ["legacy_raw", "legacy_shrink8", "legacy_min8", "legacy_min8_shrink8", "no_group"];
  const byKey = new Map(audit.results.map((row) => [row.key, row]));
  document.querySelector("#variant-results").innerHTML = displayOrder.map((key) => {
    const row = byKey.get(key);
    const [reading, badgeClass, detail] = readingFor(key);
    const rowClass = key === "legacy_raw" ? "raw-row" : key === "legacy_shrink8" ? "candidate-row" : "";
    return `<tr class="${rowClass}">
      <td><strong>${escapeHtml(row.label)}</strong><br><small>${escapeHtml(detail)}</small></td>
      <td class="numeric">${pct(row.totalReturn)}</td>
      <td class="numeric">${pct(row.maxDrawdown)}</td>
      <td class="numeric">${Number.isFinite(row.smallGroupSelectionRate) ? pct(row.smallGroupSelectionRate) : "해당 없음"}</td>
      <td class="numeric">${pct(row.selectionOverlapWithRaw)}</td>
      <td><span class="reading-badge ${badgeClass}">${escapeHtml(reading)}</span></td>
    </tr>`;
  }).join("");
}

function renderPeriods(audit) {
  const rows = [
    audit.results.find((row) => row.key === "legacy_raw"),
    audit.results.find((row) => row.key === "legacy_shrink8"),
    audit.results.find((row) => row.key === "legacy_min8"),
    audit.results.find((row) => row.key === "no_group")
  ];
  const labels = { early: "2021~2022", middle: "2023~2024", recent: "2025~2026" };
  document.querySelector("#period-compare").innerHTML = rows.map((row) => `<div class="period-row">
    <div class="period-label"><strong>${escapeHtml(row.label)}</strong><span>업종 처리 방식</span></div>
    <div class="period-series">${Object.entries(labels).map(([key, label]) => `<div class="period-value"><span>${label}</span><strong>${pct(row.periods[key].strategy)}</strong></div>`).join("")}</div>
  </div>`).join("");
}

function pitCard(title, description, run, coherent = false) {
  const names = [
    ["섹터 흐름 중심", run.a],
    ["종목 힘 균형", run.c]
  ];
  return `<article class="pit-card ${coherent ? "coherent" : ""}">
    <h3>${escapeHtml(title)}</h3>
    <p>${escapeHtml(description)}</p>
    ${names.map(([name, result]) => `<div class="pit-stat"><strong>${escapeHtml(name)}</strong><span>누적 ${pct(result.return)}</span><strong class="risk">MDD ${pct(result.mdd)}</strong></div>`).join("")}
    <div class="pit-benchmark">같은 기간 QQQ <strong>${pct(run.qqqReturn)}</strong></div>
  </article>`;
}

function renderPit(robustness) {
  document.querySelector("#pit-results").innerHTML = [
    pitCard("Morningstar 일관 분류", "모든 종목에 sector와 industry group을 같은 기준으로 적용", robustness.runs.coherentMorningstar, true),
    pitCard("기존 57개 호환 분류", "현재 종목은 혼합 라벨, 과거에만 있던 종목은 Morningstar로 보충", robustness.runs.productionCompatibleBase)
  ].join("");
}

function renderMethod(audit, robustness) {
  const input = audit.fixedInputs;
  document.querySelector("#method-grid").innerHTML = [
    metric("구조 실험 등급", "탐색용", "공식 전략 변경 근거로 단독 사용 금지"),
    metric("고정 유니버스", `${audit.structure.stockCount}종목`, input.universeHash.slice(0, 12)),
    metric("가격 기준일", input.priceAsOf, input.snapshotHash.slice(0, 12)),
    metric("개별 종목 점수", "무섹터 정규화", "모든 구조 실험에서 동일"),
    metric("겹침 보유", `${input.holdingModel.match(/\d+/)?.[0] ?? 6}개월`, "매달 새 추천을 같은 비중으로 추가"),
    metric("장기 PIT 기간", `${robustness.period.firstSignal} ~ ${robustness.period.lastPriceDate}`, `${robustness.period.signalMonths}개월 신호`)
  ].join("");

  const limitations = [
    ...audit.limitations,
    ...robustness.limitations,
    "새로운 Morningstar 표본 보정 장기 배치는 아직 완료 결과로 채택하지 않았다. 이 보고서는 완료·저장된 검증값만 사용한다."
  ];
  document.querySelector("#limitation-list").innerHTML = [...new Set(limitations)]
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");
}

async function main() {
  const [auditResponse, robustnessResponse] = await Promise.all([
    fetch("./data/taxonomy-structure-audit.json"),
    fetch("./data/quantconnect-c-robustness-audit.json")
  ]);
  if (!auditResponse.ok || !robustnessResponse.ok) throw new Error("검증 데이터를 불러오지 못했습니다.");
  const [audit, robustness] = await Promise.all([auditResponse.json(), robustnessResponse.json()]);

  renderHeadline(audit);
  renderStructure(audit);
  renderVariantBars(audit);
  renderVariantTable(audit);
  renderPeriods(audit);
  renderPit(robustness);
  renderMethod(audit, robustness);

  document.querySelector("#as-of-chip").textContent = `가격 ${audit.fixedInputs.priceAsOf}`;
  document.querySelector("#footer-meta").textContent = `생성 ${dateOnly(audit.generatedAt)} · ${audit.runId}`;
  document.querySelector("#print-report").addEventListener("click", () => window.print());
  loading.hidden = true;
}

main().catch((error) => {
  console.error(error);
  loading.textContent = error.message;
  loading.classList.add("error");
});
