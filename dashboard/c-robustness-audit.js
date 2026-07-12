const DATA_URL = window.location.pathname.includes("/dashboard/")
  ? "../data/quantconnect-c-robustness-audit.json"
  : "./data/quantconnect-c-robustness-audit.json";

const rounded = (value, digits) => (value + Math.sign(value) * 1e-9).toFixed(digits);
const percent = (value, digits = 1) => Number.isFinite(value)
  ? `${value >= 0 ? "+" : ""}${rounded(value * 100, digits)}%`
  : "-";
const points = (value, digits = 1) => Number.isFinite(value)
  ? `${value >= 0 ? "+" : ""}${rounded(value * 100, digits)}%p`
  : "-";
const money = (value) => Number.isFinite(value) ? `${Math.round(value).toLocaleString("ko-KR")}원` : "-";

function metricCard(label, value, note) {
  return `<article class="metric-card"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`;
}

function renderHeadline(data) {
  const clean = data.runs.coherentMorningstar;
  const base = data.runs.productionCompatibleBase;
  const cost = data.runs.costOnly;
  document.getElementById("headline-metrics").innerHTML = [
    metricCard("장기 추천 기간", `${data.period.signalMonths}개월`, "2010-08 ~ 2026-03"),
    metricCard("기본 조건 C-A", points(base.c.return - base.a.return, 2), "연평균 차이 +0.09%p"),
    metricCard("일관 분류 C 위험 차이", points(clean.c.mdd - clean.a.mdd, 2), "C의 최대 하락이 더 깊음"),
    metricCard("높은 비용 C-A", points(cost.c.return - cost.a.return, 2), "매수·매도 각각 0.25%")
  ].join("");

  document.getElementById("key-findings").innerHTML = [
    ["일관 분류에서 우위가 사라졌습니다", `C ${percent(clean.c.return, 2)}, A ${percent(clean.a.return, 2)}로 사실상 같은 수익이었습니다.`],
    ["거래비용이 순위를 뒤집었습니다", `비용을 각각 0.25%로 높이자 C가 A보다 ${points(cost.c.return - cost.a.return, 2)} 뒤졌습니다.`],
    ["대박 한 종목만의 문제는 아닙니다", "최고 수익 lot 두 개를 빼도 C의 작은 우위는 남았습니다. 분류와 현금 경로가 더 큰 문제입니다."]
  ].map(([title, body]) => `<article class="finding-card"><strong>${title}</strong><p>${body}</p></article>`).join("");
}

function longRow(classification, strategy, row) {
  return `<tr><td>${classification}</td><td>${strategy}</td><td class="numeric positive-text">${percent(row.return, 2)}</td><td class="numeric">${percent(row.cagr, 2)}</td><td class="numeric negative-text">${percent(row.mdd, 2)}</td><td class="numeric">${row.buys}/${row.attempts}</td><td class="numeric">${row.skips}건</td></tr>`;
}

function renderLongResults(data) {
  const clean = data.runs.coherentMorningstar;
  const base = data.runs.productionCompatibleBase;
  document.getElementById("long-results").innerHTML = [
    longRow("Morningstar 일관", "섹터 흐름형", clean.a),
    longRow("Morningstar 일관", "종목 힘 중심형", clean.c),
    longRow("기존 운용 호환", "섹터 흐름형", base.a),
    longRow("기존 운용 호환", "종목 힘 중심형", base.c)
  ].join("");
}

function renderTaxonomy(data) {
  const audit = data.classificationAudit;
  document.getElementById("taxonomy-counts").innerHTML = [
    [audit.frozenLabels, "전체 라벨"],
    [audit.broadSectorLabels, "넓은 섹터"],
    [audit.granularIndustryLabels, "세부 산업"]
  ].map(([value, label]) => `<div class="taxonomy-count"><strong>${value}</strong><span>${label}</span></div>`).join("");

  const clean = data.runs.coherentMorningstar;
  document.getElementById("coherent-risk").innerHTML = [
    ["섹터 흐름형", clean.a.return, clean.a.mdd],
    ["종목 힘 중심형", clean.c.return, clean.c.mdd]
  ].map(([label, ret, mdd]) => `<div class="risk-row"><strong>${label}</strong><span>수익 ${percent(ret, 2)}</span><b>${percent(mdd, 2)}</b></div>`).join("");
}

function renderStress(data) {
  const rows = [
    ["기본 · 비용 0.1%", data.runs.productionCompatibleBase, "base"],
    ["비용만 0.25%", data.runs.costOnly, "failed"],
    ["매수 1일 + 구성 5일 지연", data.runs.timingOnly, "passed"],
    ["높은 비용 + 두 지연", data.runs.combinedStress, "failed"]
  ];
  document.getElementById("stress-results").innerHTML = rows.map(([label, run, state]) => `
    <tr class="${state === "failed" ? "failed-row" : state === "passed" ? "passed-row" : ""}">
      <td>${label}</td>
      <td class="numeric">${percent(run.a.return, 2)}</td>
      <td class="numeric">${percent(run.c.return, 2)}</td>
      <td class="numeric ${run.c.return >= run.a.return ? "positive-text" : "negative-text"}">${points(run.c.return - run.a.return, 2)}</td>
      <td class="numeric negative-text">${percent(run.a.mdd, 2)}</td>
      <td class="numeric negative-text">${percent(run.c.mdd, 2)}</td>
      <td class="numeric">${run.c.skips}건</td>
    </tr>
  `).join("");
}

function tailCard(name, tail) {
  return `<article class="tail-card">
    <h3>${name}</h3>
    <div class="tail-lots">
      <div class="tail-lot"><span>${tail.top1.lot}</span><strong>${money(tail.top1.profit)}</strong></div>
      <div class="tail-lot"><span>${tail.top2.lot}</span><strong>${money(tail.top2.profit)}</strong></div>
    </div>
    <div class="tail-removal">
      <div><span>최고 1개 제외</span><strong>${percent(tail.returnWithoutTop1, 2)}</strong></div>
      <div><span>최고 2개 제외</span><strong>${percent(tail.returnWithoutTop2, 2)}</strong></div>
    </div>
  </article>`;
}

function renderTail(data) {
  const tail = data.runs.productionCompatibleBase.tail;
  document.getElementById("tail-results").innerHTML = tailCard("섹터 흐름형", tail.a) + tailCard("종목 힘 중심형", tail.c);
}

function renderDecision(data) {
  const gates = [
    ["일관된 업종표에서도 A보다 우수", "수익은 사실상 같고 C 최대 하락이 14.92%p 더 깊었습니다.", false],
    ["2010~2026 장기 PIT에서 확실한 우위", "C 누적 우위 4.64%p, 연평균 우위 0.09%p에 그쳤습니다.", false],
    ["높은 비용과 시차에도 우위", "시차만 통과했고 높은 비용과 복합 조건에서 순위가 뒤집혔습니다.", false],
    ["최고 수익 종목을 빼도 우위", "최고 두 lot 제외 뒤 C가 5.97%p 앞섰습니다.", true]
  ];
  document.getElementById("promotion-gates").innerHTML = gates.map(([title, note, passed]) => `
    <article class="gate-row ${passed ? "passed" : "failed"}"><span class="gate-icon">${passed ? "✓" : "×"}</span><div><strong>${title}</strong><p>${note}</p></div><span class="gate-status">${passed ? "통과" : "실패"}</span></article>
  `).join("");
  document.getElementById("required-work").innerHTML = data.requiredBeforeReconsideration.map((item) => `<li>${item}</li>`).join("");
}

function renderMethodology(data) {
  const contract = data.commonContract;
  const cards = [
    ["가격 제공처", "QuantConnect Free"],
    ["실행 엔진", "LEAN master v17914"],
    ["당시 유니버스", "SPY + QQQ 시점별 합집합"],
    ["월별 추천", `${data.period.signalMonths}개월 × 2종목`],
    ["초기 자금", money(contract.initialCapital)],
    ["기본 비용", "매수·매도 각각 0.1%"],
    ["마지막 가격", data.period.lastPriceDate],
    ["과거 등장 종목", `${data.period.everConstituents}개`]
  ];
  document.getElementById("method-grid").innerHTML = cards.map(([label, value]) => `<article class="method-card"><span>${label}</span><strong>${value}</strong></article>`).join("");
  document.getElementById("annual-results").innerHTML = data.annualProductionCompatibleBase.map((row) => `<tr><td>${row.year}</td><td class="numeric ${row.a >= 0 ? "positive-text" : "negative-text"}">${percent(row.a, 2)}</td><td class="numeric ${row.c >= 0 ? "positive-text" : "negative-text"}">${percent(row.c, 2)}</td><td class="numeric ${row.c >= row.a ? "positive-text" : "negative-text"}">${points(row.c - row.a, 2)}</td></tr>`).join("");
  document.getElementById("limitation-list").innerHTML = data.limitations.map((item) => `<li>${item}</li>`).join("");
}

async function main() {
  const response = await fetch(DATA_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`장기 검증 데이터 요청 실패: ${response.status}`);
  const data = await response.json();
  renderHeadline(data);
  renderLongResults(data);
  renderTaxonomy(data);
  renderStress(data);
  renderTail(data);
  renderDecision(data);
  renderMethodology(data);
  document.getElementById("as-of-chip").textContent = `가격 ${data.period.lastPriceDate}`;
  document.getElementById("footer-meta").textContent = `QuantConnect 프로젝트 ${data.projectId} · ${data.period.signalMonths}개월`;
  document.getElementById("loading-state").hidden = true;
}

document.getElementById("print-report").addEventListener("click", () => window.print());
main().catch((error) => {
  const loading = document.getElementById("loading-state");
  loading.classList.add("error");
  loading.textContent = error.message;
});
