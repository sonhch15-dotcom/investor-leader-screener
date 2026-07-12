const loading = document.querySelector("#loading-state");

function pct(value, digits = 1) {
  if (!Number.isFinite(value)) return "해당 없음";
  const number = value * 100;
  const sign = number > 0 ? "+" : "";
  return `${sign}${number.toFixed(digits)}%`;
}

function pp(value, digits = 2) {
  if (!Number.isFinite(value)) return "해당 없음";
  const number = value * 100;
  const sign = number > 0 ? "+" : "";
  return `${sign}${number.toFixed(digits)}%p`;
}

function krw(value) {
  return Number.isFinite(value) ? `${Math.round(value).toLocaleString("ko-KR")}원` : "해당 없음";
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

const scoreNames = {
  A: "업종 흐름 반영형",
  C: "종목 힘 균형형"
};

const taxonomyNames = {
  LEGACY_FULL: "기존 혼합표 전체",
  LEGACY_GROUP: "기존 혼합 업종만",
  MSTAR_GROUP_RAW: "일관 업종 원형",
  MSTAR_INDUSTRY_RAW: "세밀 업종 원형",
  MSTAR_GROUP_SHRUNK: "작은 그룹 점수 완화",
  MSTAR_ADAPTIVE: "작은 업종 합치기",
  NO_GROUP: "업종 없이 종목만"
};

const taxonomyDescriptions = {
  LEGACY_FULL: "서로 깊이가 다른 57개 라벨과 섹터를 함께 쓰는 과거 호환 방식입니다.",
  LEGACY_GROUP: "혼합 57개 라벨을 업종 단계에만 쓰는 진단용 방식입니다.",
  MSTAR_GROUP_RAW: "모든 종목을 Morningstar 산업그룹으로 똑같이 나눈 연구 기준선입니다.",
  MSTAR_INDUSTRY_RAW: "더 세밀한 Morningstar 산업을 그대로 써 작은 그룹이 많아지는 대조안입니다.",
  MSTAR_GROUP_SHRUNK: "작은 그룹의 점수를 큰 그룹 평균 쪽으로 완화합니다.",
  MSTAR_ADAPTIVE: "세부 업종이 8종목 미만이면 상위 산업그룹으로 합쳐 평가합니다.",
  NO_GROUP: "업종 흐름을 빼고 개별 종목 점수만 쓰는 대조군입니다."
};

const roleNames = {
  baseline: "기준선",
  candidate: "연구 후보",
  diagnostic: "진단용",
  control: "대조군"
};

function resultFor(data, key) {
  const row = data.rankedResults.find((item) => item.key === key);
  if (!row) throw new Error(`결과가 없습니다: ${key}`);
  return row;
}

function renderSummary(data) {
  const baseline = resultFor(data, data.comparison.baselineKey);
  const candidate = resultFor(data, data.comparison.candidateKey);
  document.querySelector("#headline-metrics").innerHTML = [
    metric("후보 누적 수익", pct(candidate.totalReturn), `원형 ${pct(baseline.totalReturn)}`),
    metric("후보 최대 하락", pct(candidate.maxDrawdown), `원형 ${pct(baseline.maxDrawdown)}`),
    metric("초반 구간 차이", pp(data.comparison.periodDeltas.design), "후보가 원형보다 뒤짐"),
    metric("대박 2건 제외 우위", pp(data.comparison.returnWithoutTop2Delta), "35.09%p에서 거의 사라짐")
  ].join("");

  document.querySelector("#key-findings").innerHTML = [
    finding("전체 숫자는 분명 개선됐습니다", "작은 업종을 합치자 누적 수익은 35.09%p 높아지고 최대 하락도 1.46%p 얕아졌습니다."),
    finding("모든 시기에서 좋아진 것은 아닙니다", "2010~2018년에는 후보가 15.37%p 뒤졌고, 좋아진 결과는 2019년 이후에 집중됐습니다."),
    finding("한 번의 큰 수익이 결론을 바꿨습니다", "최고 수익 lot 두 개를 빼면 후보와 원형의 차이는 0.45%p뿐입니다.")
  ].join("");
}

function renderContract(data) {
  const period = data.period;
  const capital = data.capitalContract;
  document.querySelector("#contract-grid").innerHTML = [
    metric("검증 신호", `${period.signalMonths}개월`, `${period.firstSignal}부터`),
    metric("한때 포함된 종목", `${period.everConstituents}개`, `현재 ${period.currentConstituents}개`),
    metric("초기 자금", krw(capital.initialKrw), "소수점 거래 가정"),
    metric("월 추천", "2종목", "총 376회 매수 시도"),
    metric("거래비용", "편도 0.10%", "매수와 매도 각각 반영"),
    metric("선택 후 상장폐지", `${data.selectedDelistings.count}건`, "기업행위 포함")
  ].join("");

  const order = ["MSTAR_GROUP_RAW", "MSTAR_ADAPTIVE", "MSTAR_GROUP_SHRUNK", "MSTAR_INDUSTRY_RAW", "NO_GROUP", "LEGACY_GROUP", "LEGACY_FULL"];
  document.querySelector("#variant-explainer").innerHTML = order.map((key) => {
    const item = data.variantCatalog[key];
    return `<article class="variant-item">
      <div class="variant-item-head"><h3>${escapeHtml(taxonomyNames[key])}</h3><span class="role-chip ${escapeHtml(item.role)}">${escapeHtml(roleNames[item.role])}</span></div>
      <p>${escapeHtml(taxonomyDescriptions[key])}</p>
    </article>`;
  }).join("");
}

function renderResults(data) {
  const keys = ["A__MSTAR_GROUP_RAW", "A__MSTAR_GROUP_SHRUNK", "A__MSTAR_ADAPTIVE", "A__NO_GROUP"];
  const rows = keys.map((key) => resultFor(data, key));
  const maximum = Math.max(...rows.map((row) => row.totalReturn));
  document.querySelector("#strategy-bars").innerHTML = rows.map((row) => {
    const className = row.taxonomyKey === "MSTAR_ADAPTIVE" ? "candidate" : row.role === "control" ? "control" : "";
    return `<div class="strategy-bar-row ${className}">
      <div class="strategy-bar-label"><strong>${escapeHtml(taxonomyNames[row.taxonomyKey])}</strong><span>${escapeHtml(scoreNames[row.scoreKey])}</span></div>
      <div class="strategy-bar-track"><div class="strategy-bar-fill" style="width:${Math.max(1, row.totalReturn / maximum * 100).toFixed(2)}%"></div></div>
      <div class="strategy-bar-value">${pct(row.totalReturn)}</div>
    </div>`;
  }).join("");

  const qqq = rows[0].qqqReturn;
  document.querySelector("#benchmark-callout").innerHTML = `<div><h3>같은 기간 QQQ를 계속 보유했다면</h3><p>전략보다 위험이 큰지 작은지를 맞춘 비교가 아니라, 현금을 오래 들고 있었을 때 놓친 시장 상승을 보여주는 기회비용 기준입니다.</p></div><strong>${pct(qqq)}</strong>`;

  const baseline = resultFor(data, data.comparison.baselineKey);
  const candidate = resultFor(data, data.comparison.candidateKey);
  document.querySelector("#baseline-candidate-pair").innerHTML = [
    resultCard(baseline, "연구 기준선", false),
    resultCard(candidate, "이번 연구 후보", true)
  ].join("");

  document.querySelector("#all-results").innerHTML = data.rankedResults.map((row, index) => {
    const rowClass = row.role === "baseline" ? "baseline-row" : row.role === "candidate" ? "candidate-row" : row.role === "diagnostic" ? "diagnostic-row" : "";
    return `<tr class="${rowClass}">
      <td>${index + 1}</td>
      <td>${escapeHtml(scoreNames[row.scoreKey])}</td>
      <td><strong>${escapeHtml(taxonomyNames[row.taxonomyKey])}</strong></td>
      <td class="numeric">${pct(row.totalReturn)}</td>
      <td class="numeric">${pct(row.cagr)}</td>
      <td class="numeric">${pct(row.maxDrawdown)}</td>
      <td class="numeric">${row.buys.executed}/${row.buys.attempted}</td>
      <td><span class="role-chip ${escapeHtml(row.role)}">${escapeHtml(roleNames[row.role])}</span></td>
    </tr>`;
  }).join("");
}

function resultCard(row, label, candidate) {
  return `<article class="evidence-card result-card ${candidate ? "candidate" : ""}">
    <p class="mini-label">${escapeHtml(label)}</p>
    <h3>${escapeHtml(taxonomyNames[row.taxonomyKey])}</h3>
    <p>${escapeHtml(scoreNames[row.scoreKey])} · 최종 자산 ${escapeHtml(krw(row.finalEquityKrw))}</p>
    <div class="result-stat-grid">
      <div class="result-stat"><span>누적 수익</span><strong>${pct(row.totalReturn)}</strong></div>
      <div class="result-stat"><span>연평균</span><strong>${pct(row.cagr)}</strong></div>
      <div class="result-stat risk"><span>최대 하락</span><strong>${pct(row.maxDrawdown)}</strong></div>
    </div>
  </article>`;
}

function renderPeriods(data) {
  const baseline = resultFor(data, data.comparison.baselineKey);
  const candidate = resultFor(data, data.comparison.candidateKey);
  const periods = [
    ["design", "설계 확인 구간", "2010-08 ~ 2018-12"],
    ["validation", "중간 검증 구간", "2019-01 ~ 2022-12"],
    ["holdout", "최근 확인 구간", "2023-01 ~ 2026-04"]
  ];
  document.querySelector("#period-cards").innerHTML = periods.map(([key, title, range]) => {
    const delta = data.comparison.periodDeltas[key];
    const status = delta >= 0 ? "passed" : "failed";
    return `<article class="period-compare-card ${status}">
      <span>${escapeHtml(range)}</span><h3>${escapeHtml(title)}</h3>
      <div class="period-values">
        <div><small>일관 업종 원형</small><strong>${pct(baseline.periods[key].strategy)}</strong></div>
        <div><small>작은 업종 합치기</small><strong>${pct(candidate.periods[key].strategy)}</strong></div>
      </div>
      <div class="period-delta">후보 차이 ${pp(delta)}</div>
    </article>`;
  }).join("");
}

function renderConcentration(data) {
  const baseline = resultFor(data, data.comparison.baselineKey);
  const candidate = resultFor(data, data.comparison.candidateKey);
  document.querySelector("#winner-cards").innerHTML = [
    winnerCard(baseline, "일관 업종 원형", false),
    winnerCard(candidate, "작은 업종 합치기", true)
  ].join("");
}

function winnerCard(row, label, candidate) {
  return `<article class="tail-card winner-card ${candidate ? "candidate" : ""}">
    <h3>${escapeHtml(label)}</h3><p>가장 큰 수익을 만든 월별 매수 묶음</p>
    <div class="winner-lots">${row.topWinners.map((winner) => `<div class="winner-lot"><span>${escapeHtml(winner.lot)}</span><strong>+${escapeHtml(krw(winner.profitKrw))}</strong></div>`).join("")}</div>
    <div class="winner-after">
      <div><span>최고 1건 제외</span><strong>${pct(row.returnWithoutTop1)}</strong></div>
      <div><span>최고 2건 제외</span><strong>${pct(row.returnWithoutTop2)}</strong></div>
    </div>
  </article>`;
}

function renderStructure(data) {
  const baseline = resultFor(data, data.comparison.baselineKey);
  const candidate = resultFor(data, data.comparison.candidateKey);
  const groupRows = [
    [baseline, "일관 업종 원형", false],
    [candidate, "작은 업종 합치기", true]
  ];
  document.querySelector("#group-size-compare").innerHTML = groupRows.map(([row, label, isCandidate]) => `<div class="group-size-row ${isCandidate ? "candidate" : ""}">
    <div class="group-size-head"><span>${escapeHtml(label)} · 평균 ${row.selectedGroupSize.average.toFixed(1)}종목</span><strong>4종목 이하 ${pct(row.selectedGroupSize.atMost4Rate)}</strong></div>
    <div class="mini-track"><div class="mini-fill" style="width:${Math.max(1, row.selectedGroupSize.atMost7Rate * 100).toFixed(2)}%"></div></div>
    <div class="group-size-head"><span>7종목 이하 선택 비율</span><strong>${pct(row.selectedGroupSize.atMost7Rate)}</strong></div>
  </div>`).join("");

  const overlap = candidate.selectionOverlap.morningstarRaw;
  document.querySelector("#overlap-summary").innerHTML = `<div class="overlap-big"><strong>${overlap.averageMatches.toFixed(2)} / 2종목</strong><span>한 달 평균 같은 종목 수</span></div>
    <div class="overlap-facts">
      <div><strong>${pct(overlap.exactTwoRate)}</strong><span>두 종목 모두 같았던 달</span></div>
      <div><strong>${pct(1 - overlap.exactTwoRate)}</strong><span>한 종목 이상 달라진 달</span></div>
    </div>`;

  const adaptiveA = resultFor(data, "A__MSTAR_ADAPTIVE");
  const adaptiveC = resultFor(data, "C__MSTAR_ADAPTIVE");
  document.querySelector("#score-pair").innerHTML = [adaptiveA, adaptiveC].map((row) => `<div class="score-card"><span>${escapeHtml(scoreNames[row.scoreKey])}</span><strong>${pct(row.totalReturn)}</strong><small>MDD ${pct(row.maxDrawdown)} · 연평균 ${pct(row.cagr)}</small></div>`).join("");
}

function renderDecision(data) {
  const statusLabels = { passed: "통과", failed: "실패", warning: "주의" };
  const icons = { passed: "통과", failed: "실패", warning: "주의" };
  document.querySelector("#gate-list").innerHTML = data.promotionGates.map((gate) => `<article class="gate-row ${escapeHtml(gate.status)}">
    <span class="gate-icon" aria-hidden="true">${gate.status === "passed" ? "O" : gate.status === "failed" ? "X" : "!"}</span>
    <div><strong>${escapeHtml(gate.label)}</strong><p>${escapeHtml(gate.detail)}</p></div>
    <span class="gate-status">${escapeHtml(statusLabels[gate.status] ?? icons[gate.status])}</span>
  </article>`).join("");
}

function renderMethodology(data) {
  const limitations = [
    `이번 QuantConnect 가격 데이터는 ${data.period.lastPriceDate}에 끝났습니다. 그 이후 월의 결과는 포함하지 않았습니다.`,
    "QQQ는 전액 계속 투자하지만 전략은 현금을 보유할 수 있어, QQQ 비교는 위험을 맞춘 대결이 아니라 장기 기회비용 비교입니다.",
    "이번 실행에서는 Morningstar 분류 변경이 0건으로 관찰됐습니다. 제공처가 과거의 모든 재분류 이력을 완전하게 노출한다는 뜻은 아닙니다.",
    "최고 수익 lot 제외 결과는 최종 자산에서 이익을 단순 차감한 집중도 검사이며, 남은 자금을 다시 배분해 돌린 백테스트는 아닙니다.",
    "작은 업종 합치기는 아직 규칙을 고정한 뒤 관찰한 6~12개월의 미래 표본이 없습니다.",
    "이번 연구는 Public API, Android 실행 정책과 기존 lot 일정을 바꾸지 않습니다."
  ];
  document.querySelector("#limitation-list").innerHTML = limitations.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

async function main() {
  const response = await fetch("./data/quantconnect-taxonomy-leader-group-audit.json");
  if (!response.ok) throw new Error("장기 검증 데이터를 불러오지 못했습니다.");
  const data = await response.json();

  renderSummary(data);
  renderContract(data);
  renderResults(data);
  renderPeriods(data);
  renderConcentration(data);
  renderStructure(data);
  renderDecision(data);
  renderMethodology(data);

  document.querySelector("#as-of-chip").textContent = `가격 ${data.period.lastPriceDate}`;
  document.querySelector("#footer-meta").textContent = `생성 ${dateOnly(data.generatedAt)} · ${data.runId}`;
  document.querySelector("#print-report").addEventListener("click", () => window.print());
  loading.hidden = true;
}

main().catch((error) => {
  console.error(error);
  loading.textContent = error.message;
  loading.classList.add("error");
});
