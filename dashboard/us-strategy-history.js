const DATA_URL = "./data/us-strategy-history-report.json";
const CANDIDATE_DATA_URL = "./data/us-backtest-candidate-study.json";
const SECTOR_FLOW_NAME = "섹터 흐름형";
const STOCK_STRENGTH_NAME = "종목 힘 중심형";

const percent = (value, digits = 1) => Number.isFinite(value)
  ? `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`
  : "-";
const plainPercent = (value, digits = 1) => Number.isFinite(value)
  ? `${(value * 100).toFixed(digits)}%`
  : "-";
const points = (value, digits = 1) => Number.isFinite(value)
  ? `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%포인트`
  : "-";
const plainPoints = (value, digits = 1) => Number.isFinite(value)
  ? `${Math.abs(value * 100).toFixed(digits)}%포인트`
  : "-";
const pointNumber = (value, digits = 1) => Number.isFinite(value)
  ? `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}`
  : "-";
const money = (value) => Number.isFinite(value)
  ? `${Math.round(value).toLocaleString("ko-KR")}원`
  : "-";
const compactMoney = (value) => {
  if (!Number.isFinite(value)) return "-";
  if (Math.abs(value) >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}억원`;
  if (Math.abs(value) >= 10_000) return `${Math.round(value / 10_000).toLocaleString("ko-KR")}만원`;
  return money(value);
};
const formatDate = (date) => date ? date.replaceAll("-", ".") : "-";
const signedClass = (value) => value < 0 ? "negative-text" : "positive-text";
const sectorLabel = (sector) => ({
  "Electronic Components": "전자부품",
  Financials: "금융",
  Software: "소프트웨어",
  "Consumer Discretionary": "선택소비",
  Semiconductors: "반도체",
  Industrials: "산업재",
  "Consumer Staples": "필수소비",
  "Communication Services": "통신·미디어",
  "Health Care": "헬스케어",
  "Real Estate": "부동산",
  Energy: "에너지",
  Utilities: "전기·가스",
  Materials: "소재",
  Biotechnology: "바이오"
})[sector] ?? sector;
const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

function metricCard(label, value, note) {
  return `<article class="metric-card"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`;
}

function renderSummary(data) {
  const { headline, selection, exits } = data;
  const mddCost = Math.abs(headline.scoreC.maxDrawdown - headline.scoreA.maxDrawdown);
  const summary = [
    `<strong>1천만원으로 시작했다면 ${STOCK_STRENGTH_NAME}은 약 ${compactMoney(data.account.current.c.finalCapital)}, ${SECTOR_FLOW_NAME}은 약 ${compactMoney(data.account.current.a.finalCapital)}이 됐습니다.</strong> 두 계좌의 최종 차이는 약 ${compactMoney(headline.finalCapitalAdvantage)}이었습니다.`,
    `<strong>${STOCK_STRENGTH_NAME}이 매번 더 자주 맞힌 것은 아닙니다.</strong> 서로 다르게 고른 36건에서 돈을 번 거래의 비율은 ${plainPercent(selection.cOnly.winRate)}로 ${SECTOR_FLOW_NAME}의 ${plainPercent(selection.aOnly.winRate)}보다 낮았습니다. 대신 한 건당 평균 수익은 ${percent(selection.cOnly.averageReturn)}로 훨씬 컸습니다.`,
    `<strong>6개월 뒤 절반을 남겨둔 선택은 한 거래당 평균 ${points(exits.c.averageImprovement)}를 더했습니다.</strong> 대부분의 거래에서는 차이가 작았지만, STX나 APP처럼 오래 오른 몇 종목에서 큰 추가 수익이 나왔습니다. +300% 넘게 오른 초대박 거래를 빼도 평균 ${points(exits.c.robustAverageImprovement)}가 남았습니다.`,
    `<strong>좋은 결과만 있었던 것은 아닙니다.</strong> ${STOCK_STRENGTH_NAME} 계좌는 가장 힘들 때 고점에서 ${plainPercent(Math.abs(headline.scoreC.maxDrawdown))} 줄었고, ${SECTOR_FLOW_NAME}보다 ${plainPoints(mddCost)} 더 깊게 떨어졌습니다. 2022년과 2025년에는 실제로 버티기 어려운 시간이 있었습니다.`
  ];
  document.getElementById("executive-summary-list").innerHTML = summary
    .map((text) => `<article class="summary-point"><p>${text}</p></article>`).join("");
  document.getElementById("headline-metrics").innerHTML = [
    metricCard(STOCK_STRENGTH_NAME, percent(headline.scoreC.accountReturn), `연평균 ${percent(headline.scoreC.cagr)} · 최대 하락 ${percent(headline.scoreC.maxDrawdown)}`),
    metricCard(SECTOR_FLOW_NAME, percent(headline.scoreA.accountReturn), `연평균 ${percent(headline.scoreA.cagr)} · 최대 하락 ${percent(headline.scoreA.maxDrawdown)}`),
    metricCard("QQQ 시장 기준", percent(headline.qqq.totalReturn), `연평균 ${percent(headline.qqq.cagr)} · 최대 하락 ${percent(headline.qqq.maxDrawdown)}`),
    metricCard("누적 차이(%포인트)", pointNumber(headline.accountReturnAdvantage), `${STOCK_STRENGTH_NAME}이 더 높음`)
  ].join("");
}

function renderScoreWeights(data) {
  const palette = ["#174a70", "#2d6f8e", "#6096ac", "#0f766e"];
  const row = (key, label) => {
    const weights = data.scoreWeights[key];
    return `<div class="stacked-row">
      <div class="stacked-row-head"><span>${label}</span><span>개별 종목 ${weights.slice(0, 3).reduce((sum, item) => sum + item.weight, 0).toFixed(1)}%</span></div>
      <div class="stacked-bar">${weights.map((item) => `<div class="stacked-segment" data-short="${item.weight.toFixed(0)}" style="width:${item.weight}%;background:${palette[weights.indexOf(item)]}" title="${escapeHtml(item.label)} ${item.weight.toFixed(1)}%">${item.weight >= 15 ? `${escapeHtml(item.label)} ${item.weight.toFixed(0)}` : item.weight.toFixed(1)}</div>`).join("")}</div>
    </div>`;
  };
  const legend = data.scoreWeights.a.map((item, index) => `<span style="--swatch:${palette[index]}">${escapeHtml(item.label)}</span>`).join("");
  document.getElementById("score-weight-chart").innerHTML = `${row("a", SECTOR_FLOW_NAME)}${row("c", STOCK_STRENGTH_NAME)}<div class="stacked-legend">${legend}</div>`;
  document.getElementById("score-weight-note").textContent = data.scoreWeights.note;
}

function renderSlots(data) {
  const selection = data.selection;
  const commonWidth = selection.commonSlots / selection.totalSlotsEach * 100;
  const changedWidth = selection.cOnlySlots / selection.totalSlotsEach * 100;
  document.getElementById("slot-comparison").innerHTML = `
    <div class="slot-bar" aria-label="공통 ${selection.commonSlots}, 서로 다른 ${selection.cOnlySlots}">
      <div class="slot-segment common" style="width:${commonWidth}%">공통 ${selection.commonSlots}</div>
      <div class="slot-segment changed" style="width:${changedWidth}%">다름 ${selection.cOnlySlots}</div>
    </div>
    <div class="slot-labels">
      <div><span>같은 종목</span><strong>${selection.commonSlots}</strong><span>${plainPercent(selection.commonSlots / selection.totalSlotsEach, 0)}</span></div>
      <div><span>서로 다른 종목</span><strong>${selection.cOnlySlots}</strong><span>${selection.changedSetMonths}개월에서 발생</span></div>
    </div>`;
}

function linePath(rows, xScale, yScale, value) {
  return rows.map((row, index) => `${index ? "L" : "M"}${xScale(row.date).toFixed(1)},${yScale(value(row)).toFixed(1)}`).join(" ");
}

function renderEquityChart(data) {
  const series = [
    { key: "c", rows: data.account.current.c.curve, value: (row) => row.equity / 10_000_000 - 1, className: "chart-path-c" },
    { key: "a", rows: data.account.current.a.curve, value: (row) => row.equity / 10_000_000 - 1, className: "chart-path-a" },
    { key: "qqq", rows: data.account.current.qqq.curve, value: (row) => row.totalReturn, className: "chart-path-benchmark" }
  ];
  const compact = window.innerWidth <= 560;
  const width = compact ? 360 : 920;
  const height = compact ? 250 : 360;
  const margin = compact
    ? { top: 12, right: 8, bottom: 34, left: 42 }
    : { top: 16, right: 18, bottom: 42, left: 58 };
  const start = Math.min(...series.flatMap((item) => item.rows.map((row) => Date.parse(row.date))));
  const end = Math.max(...series.flatMap((item) => item.rows.map((row) => Date.parse(row.date))));
  const values = series.flatMap((item) => item.rows.map(item.value));
  const minValue = Math.floor(Math.min(0, ...values) * 2) / 2;
  const maxValue = Math.ceil(Math.max(...values));
  const xScale = (date) => margin.left + (Date.parse(date) - start) / (end - start) * (width - margin.left - margin.right);
  const yScale = (value) => margin.top + (maxValue - value) / (maxValue - minValue) * (height - margin.top - margin.bottom);
  const yTicks = [minValue, ...Array.from({ length: maxValue + 1 }, (_, index) => index)]
    .filter((value, index, rows) => rows.indexOf(value) === index);
  const years = [2022, 2023, 2024, 2025, 2026];
  const grid = yTicks.map((tick) => `<line class="chart-grid" x1="${margin.left}" x2="${width - margin.right}" y1="${yScale(tick)}" y2="${yScale(tick)}"></line><text class="chart-axis" x="${margin.left - 8}" y="${yScale(tick) + 4}" text-anchor="end">${Math.round(tick * 100)}%</text>`).join("");
  const xTicks = years.map((year) => {
    const x = xScale(`${year}-01-01`);
    return `<line class="chart-grid" x1="${x}" x2="${x}" y1="${margin.top}" y2="${height - margin.bottom}"></line><text class="chart-axis" x="${x}" y="${height - 15}" text-anchor="middle">${year}</text>`;
  }).join("");
  const paths = series.map((item) => `<path class="${item.className}" d="${linePath(item.rows, xScale, yScale, item.value)}"></path>`).join("");
  document.getElementById("equity-chart").innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${grid}${xTicks}${paths}</svg>`;
}

function comparisonBar(label, aValue, cValue, formatter = percent) {
  const max = Math.max(Math.abs(aValue), Math.abs(cValue), 0.0001);
  return `<div class="comparison-row">
    <div class="comparison-row-head"><span>${label} · ${SECTOR_FLOW_NAME}</span><strong>${formatter(aValue)}</strong></div><div class="bar-track"><div class="bar-fill" style="width:${Math.abs(aValue) / max * 100}%"></div></div>
    <div class="comparison-row-head"><span>${label} · ${STOCK_STRENGTH_NAME}</span><strong>${formatter(cValue)}</strong></div><div class="bar-track"><div class="bar-fill c" style="width:${Math.abs(cValue) / max * 100}%"></div></div>
  </div>`;
}

function renderDifferentPicks(data) {
  const a = data.selection.aOnly;
  const c = data.selection.cOnly;
  document.getElementById("different-pick-stats").innerHTML = [
    comparisonBar("평균", a.averageReturn, c.averageReturn),
    comparisonBar("중앙값", a.medianReturn, c.medianReturn),
    comparisonBar("돈을 번 거래 비율", a.winRate, c.winRate, plainPercent),
    comparisonBar("+300% 넘은 종목을 뺀 평균", a.robustAverageReturn, c.robustAverageReturn)
  ].join("");
}

function renderSectorShift(data) {
  const rows = [...data.selection.sectors].sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 10);
  const max = Math.max(...rows.map((row) => Math.abs(row.change)), 1);
  document.getElementById("sector-shift-chart").innerHTML = rows.map((row) => `
    <div class="diverging-row">
      <span class="diverging-label" title="${escapeHtml(row.sector)}">${escapeHtml(sectorLabel(row.sector))}</span>
      <div class="diverging-track"><span class="diverging-fill ${row.change >= 0 ? "positive" : "negative"}" style="width:${Math.abs(row.change) / max * 50}%"></span></div>
      <span class="diverging-value ${signedClass(row.change)}">${row.change > 0 ? "+" : ""}${row.change}</span>
    </div>`).join("");
}

function annualLabel(key) {
  return ({
    wf_2021_2022: "2021-22",
    wf_2023: "2023",
    wf_2024: "2024",
    wf_2025: "2025",
    wf_2026_ytd: "2026 현재"
  })[key] ?? key;
}

function renderAnnual(data) {
  const max = Math.max(...data.annualComparisons.flatMap((row) => [row.scoreAReturn, row.scoreCReturn]));
  document.getElementById("annual-comparison").innerHTML = data.annualComparisons.map((row) => `
    <div class="annual-row">
      <div class="annual-label">${annualLabel(row.key)}</div>
      <div class="annual-bars">
        <div class="annual-series"><span title="${SECTOR_FLOW_NAME}">섹터</span><div class="bar-track"><div class="bar-fill" style="width:${row.scoreAReturn / max * 100}%"></div></div><strong>${percent(row.scoreAReturn)}</strong></div>
        <div class="annual-series"><span title="${STOCK_STRENGTH_NAME}">종목</span><div class="bar-track"><div class="bar-fill c" style="width:${row.scoreCReturn / max * 100}%"></div></div><strong>${percent(row.scoreCReturn)}</strong></div>
      </div>
    </div>`).join("");
}

function uniqueTrades(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = `${row.cohort}:${row.symbol}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function tradeRows(group) {
  return uniqueTrades(group.all ?? [...group.best, ...group.worst]).map((row) => `
    <tr><td>${row.cohort}</td><td><strong>${escapeHtml(row.symbol)}</strong><br>${escapeHtml(row.name)}</td><td>${escapeHtml(sectorLabel(row.sector))}</td><td class="numeric ${signedClass(row.return)}">${percent(row.return)}</td><td>${row.closed ? "매도 완료" : "보유 중"}</td></tr>`).join("");
}

function renderSelectionTables(data) {
  document.getElementById("c-only-trades").innerHTML = tradeRows(data.selection.cOnly);
  document.getElementById("a-only-trades").innerHTML = tradeRows(data.selection.aOnly);
}

function renderExitAccount(data) {
  const rows = [
    { key: "a", label: SECTOR_FLOW_NAME, fixed: data.account.fixedSixMonth.a.totalReturn, current: data.account.current.a.totalReturn },
    { key: "c", label: STOCK_STRENGTH_NAME, fixed: data.account.fixedSixMonth.c.totalReturn, current: data.account.current.c.totalReturn }
  ];
  const max = Math.max(...rows.flatMap((row) => [row.fixed, row.current]));
  document.getElementById("exit-account-comparison").innerHTML = rows.map((row) => `
    <div class="comparison-row">
      <div class="comparison-row-head"><span>${row.label} · 6개월 전량</span><strong>${percent(row.fixed)}</strong></div><div class="bar-track"><div class="bar-fill fixed" style="width:${row.fixed / max * 100}%"></div></div>
      <div class="comparison-row-head"><span>${row.label} · 50% + 연장</span><strong>${percent(row.current)}</strong></div><div class="bar-track"><div class="bar-fill ${row.label.endsWith("C") ? "c" : ""}" style="width:${row.current / max * 100}%"></div></div>
      <p class="chart-note">6개월에 모두 팔았을 때보다 ${points(row.current - row.fixed)} 높음 · 가장 깊은 하락 ${percent(data.account.current[row.key].maxDrawdown)}</p>
    </div>`).join("");
}

function renderPairedExit(data) {
  const row = data.exits.c;
  document.getElementById("paired-exit-stats").innerHTML = `
    <div class="paired-stat"><strong class="positive-text">${row.improvedTrades}</strong><span>더 좋아짐</span></div>
    <div class="paired-stat"><strong>${row.unchangedTrades}</strong><span>차이 없음</span></div>
    <div class="paired-stat"><strong class="negative-text">${row.worsenedTrades}</strong><span>더 나빠짐</span></div>
    <div class="paired-callout"><strong>한 거래당 평균 ${points(row.averageImprovement)}</strong> · 가운데 거래는 ${points(row.medianImprovement)} · +300% 넘은 거래를 빼면 평균 ${points(row.robustAverageImprovement)}</div>`;
}

function impactGroup(title, rows, className) {
  const max = Math.max(...rows.map((row) => Math.abs(row.improvement)), 0.001);
  return `<div class="impact-group"><p class="mini-label">${title} · 이 묶음 안에서 막대 길이 비교</p>${rows.map((row) => `
    <div class="impact-row">
      <div class="impact-label"><strong>${escapeHtml(row.symbol)}</strong><span>${row.cohort}</span></div>
      <div class="impact-track"><div class="impact-fill ${className}" style="width:${Math.abs(row.improvement) / max * 100}%"></div></div>
      <div class="impact-value ${signedClass(row.improvement)}">${points(row.improvement)}</div>
    </div>`).join("")}</div>`;
}

function renderExtensionImpact(data) {
  const gains = data.exits.c.bestExtensions.filter((row) => row.improvement > 0).slice(0, 7);
  const losses = data.exits.c.worstGivebacks.filter((row) => row.improvement < 0).slice(0, 7);
  document.getElementById("extension-impact-chart").innerHTML = `${impactGroup("추가 수익 상위", gains, "positive")}${impactGroup("되돌림 상위", losses, "negative")}`;
  const rows = data.exits.c.pairs;
  document.getElementById("extension-trades").innerHTML = rows.map((row) => `
    <tr><td>${row.cohort}</td><td><strong>${escapeHtml(row.symbol)}</strong><br>${escapeHtml(row.name)}</td><td>${formatDate(row.entryDate)}</td><td>${formatDate(row.sixMonthSellDate)}</td><td>${formatDate(row.remainingSellDate)}</td><td class="numeric ${signedClass(row.fixedReturn)}">${percent(row.fixedReturn)}</td><td class="numeric ${signedClass(row.extensionReturn)}">${percent(row.extensionReturn)}</td><td class="numeric ${signedClass(row.improvement)}">${points(row.improvement)}</td></tr>`).join("");
}

function renderPeriods(data) {
  const c = data.account.analysis.c;
  const cards = [
    ["가장 좋았던 한 달", percent(c.bestMonths[0].return), c.bestMonths[0].month],
    ["가장 힘들었던 한 달", percent(c.worstMonths[0].return), c.worstMonths[0].month],
    ["가장 좋았던 12개월", percent(c.rollingTwelveMonths.best.return), `${c.rollingTwelveMonths.best.startDate.slice(0, 7)} ~ ${c.rollingTwelveMonths.best.endDate.slice(0, 7)}`],
    ["계좌가 가장 크게 줄었을 때", percent(c.drawdown.drawdown), `${c.drawdown.peakDate} ~ ${c.drawdown.troughDate}`]
  ];
  document.getElementById("best-worst-periods").innerHTML = cards.map(([label, value, note]) => `<article class="period-card"><span>${label}</span><strong class="${value.startsWith("-") ? "negative-text" : "positive-text"}">${value}</strong><small>${note}</small></article>`).join("");
}

function renderRegimes(data) {
  const sources = new Map(data.sources.map((source) => [source.id, source]));
  document.getElementById("regime-list").innerHTML = data.regimes.map((regime) => `
    <article class="regime-card ${regime.tone}">
      <div class="regime-head"><h3>${escapeHtml(regime.title)}</h3><span class="regime-period">${escapeHtml(regime.period)}</span></div>
      <div class="regime-columns">
        <div><strong>그때 계좌에서는</strong><p>${escapeHtml(regime.evidence)}</p></div>
        <div><strong>당시 시장에서는</strong><p>${escapeHtml(regime.interpretation)}</p></div>
        <div><strong>다음에 기억할 점</strong><p>${escapeHtml(regime.lesson)}</p></div>
      </div>
      <div class="source-chips">${regime.sourceIds.map((id) => {
        const source = sources.get(id);
        return source ? `<a class="source-chip" href="${source.url}" target="_blank" rel="noreferrer">${escapeHtml(source.publisher)} · ${escapeHtml(source.date.slice(0, 4))}</a>` : "";
      }).join("")}</div>
    </article>`).join("");
}

function renderMethodology(data) {
  const methodRows = [
    ["검증에 쓴 기간", `${data.period.accountStartDate} ~ ${data.period.accountEndDate}`],
    ["마지막 주가 기준일", data.provenance.priceAsOf],
    ["검토한 종목", `${data.provenance.universeSize}종목`],
    ["한 달에 새로 산 종목", "2종목"],
    ["처음 넣은 돈", "10,000,000원"],
    ["가정한 거래 비용", "살 때 0.1% · 팔 때 0.1%"],
    ["보유 중인 계좌 계산", "매주 실제 종가로 다시 평가"],
    ["아직 팔지 않은 종목", `${data.provenance.priceAsOf} 종가로 임시 평가`],
    ["계산 결과 식별 번호", data.provenance.runId]
  ];
  document.getElementById("method-grid").innerHTML = methodRows.map(([label, value]) => `<article class="method-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`).join("");
  document.getElementById("caveat-list").innerHTML = data.caveats.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  document.getElementById("source-list").innerHTML = data.sources.map((source) => `<li><a href="${source.url}" target="_blank" rel="noreferrer">${escapeHtml(source.title)}</a> · ${escapeHtml(source.publisher)} · ${escapeHtml(source.date)}</li>`).join("");
}

function candidateBadge(label, tone = "neutral") {
  return `<span class="candidate-badge ${tone}">${escapeHtml(label)}</span>`;
}

function candidateCard(index, title, verdict, tone, body, facts, sources = []) {
  return `<article class="candidate-result-card">
    <div class="candidate-result-number">${index}</div>
    <div class="candidate-result-body">
      <div class="candidate-result-head"><h3>${escapeHtml(title)}</h3>${candidateBadge(verdict, tone)}</div>
      <p>${body}</p>
      <div class="candidate-facts">${facts.map((fact) => `<span>${fact}</span>`).join("")}</div>
      ${sources.length ? `<div class="candidate-sources">${sources.map((source) => `<a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.label)}</a>`).join("")}</div>` : ""}
    </div>
  </article>`;
}

function renderCandidateResults(data) {
  const baseline = data.baseline;
  const market50 = data.marketGate.rows.find((row) => row.key === "qqq_below_200_buy_50");
  const sector25 = data.sectorCap.rows.find((row) => row.key === "sector_cost_cap_25");
  const exit25 = data.exitSizing.rows.find((row) => row.key === "fixed_25");
  const exitAdaptive = data.exitSizing.rows.find((row) => row.key === "adaptive_25_50_75");
  const count3 = data.monthlyCount.rows.find((row) => row.key === "monthly_3_budget_matched");
  const count4 = data.monthlyCount.rows.find((row) => row.key === "monthly_4_budget_matched");

  document.getElementById("candidate-summary").innerHTML = [
    metricCard("현재 전략", percent(baseline.totalReturn), `최대 하락 ${percent(baseline.maxDrawdown)}`),
    metricCard("연구 관문 통과", `${data.passedCandidates.length}개`, "전체·극단값 제외·기간 분할 확인"),
    metricCard("QQQ 200일선 아래", `${data.marketGate.below200Months}/${data.marketGate.signalMonths}개월`, "월말 신호 기준"),
    metricCard("과거 실제 종목군", "계산 보류", "유효한 과거 구성 자료 필요")
  ].join("");

  const cards = [
    candidateCard(
      1,
      "약세장에서 새 매수를 절반으로 줄이기",
      "채택 안 함",
      "reject",
      `15개월에 적용했지만 누적 수익은 <strong>${percent(market50.totalReturn)}</strong>로 현재보다 ${plainPoints(Math.abs(market50.totalReturnChange))} 낮았습니다. 전체 기간의 최대 하락도 ${percent(market50.maxDrawdown)}로 줄지 않았습니다. 이미 들고 있던 종목이 하락하는 문제라 새 매수만 줄여서는 부족했습니다.`,
      [`현재 ${percent(baseline.totalReturn)}`, `절반 매수 ${percent(market50.totalReturn)}`, `최대 하락 ${percent(market50.maxDrawdown)}`]
    ),
    candidateCard(
      2,
      "계좌 전체에서 한 업종의 원금을 제한하기",
      "현재 유지",
      "reject",
      `월별 두 종목은 원래부터 서로 다른 업종입니다. 누적 보유분에 25% 한도를 걸면 최대 하락은 ${percent(sector25.maxDrawdown)}까지 줄었지만, 누적 수익도 <strong>${percent(sector25.totalReturn)}</strong>로 크게 낮아졌습니다. 전자부품·반도체의 긴 상승 흐름까지 너무 일찍 막았습니다.`,
      [`현재 ${percent(baseline.totalReturn)}`, `25% 한도 ${percent(sector25.totalReturn)}`, `하락폭 ${percent(sector25.maxDrawdown)}`]
    ),
    candidateCard(
      3,
      "6개월 매도 비율을 25%·50%·75%로 바꾸기",
      "추가 관찰",
      "watch",
      `25%만 팔면 누적 수익은 <strong>${percent(exit25.totalReturn)}</strong>, 주봉에 따라 바꾸면 ${percent(exitAdaptive.totalReturn)}로 높아졌습니다. 하지만 보유 중인 종목까지 포함해 +300% 넘은 거래를 빼면 각각 ${percent(exit25.strictOutlier.totalReturn)}와 ${percent(exitAdaptive.strictOutlier.totalReturn)}로 현재의 ${percent(baseline.strictOutlier.totalReturn)}보다 낮았습니다. 몇 개 큰 승자에 더 의존한 결과라 아직 규칙을 바꾸기 어렵습니다.`,
      [`25% 매도 ${percent(exit25.totalReturn)}`, `가변 매도 ${percent(exitAdaptive.totalReturn)}`, `기간 우위 1/3구간`]
    ),
    candidateCard(
      4,
      "매달 3~4종목으로 늘리기",
      "2종목 유지",
      "reject",
      `한 달 전체 매수 예정액을 같게 맞추면 3종목은 ${percent(count3.totalReturn)}, 4종목은 ${percent(count4.totalReturn)}였습니다. 종목 수가 늘면서 가장 강한 두 종목의 비중이 옅어졌고, 세 검증 구간 모두 현재 2종목보다 낮았습니다.`,
      [`2종목 ${percent(baseline.totalReturn)}`, `3종목 ${percent(count3.totalReturn)}`, `4종목 ${percent(count4.totalReturn)}`]
    ),
    candidateCard(
      5,
      "그 당시 실제 종목만 사용하기",
      "자료 확보 필요",
      "blocked",
      "현재 파일에는 지금 남아 있는 551종목만 있어 상장폐지·편출 종목을 포함한 정직한 수익률을 만들 수 없습니다. 월별 지수 구성, 당시 업종, 상장폐지 종목의 조정 가격이 함께 있는 자료를 확보하기 전까지는 숫자를 만들지 않는 것이 맞습니다.",
      ["수익률 계산 안 함", "현재 생존자 편향 남음", "유료 데이터 경로 확인"],
      data.pointInTimeUniverse.dataOptions
    )
  ];
  document.getElementById("candidate-result-list").innerHTML = cards.join("");

  const detailGroups = [
    ["시장 약세", data.marketGate.rows],
    ["업종 한도", data.sectorCap.rows],
    ["매도 비율", data.exitSizing.rows],
    ["종목 수", data.monthlyCount.rows]
  ];
  document.getElementById("candidate-detail-rows").innerHTML = detailGroups.flatMap(([experiment, rows]) => rows.map((row) => {
    const isBaseline = Math.abs(row.totalReturnChange) < 0.00005;
    const verdict = isBaseline ? "기준" : row.status.passedResearchGate ? "통과" : "미통과";
    return `<tr><td>${escapeHtml(experiment)}</td><td>${escapeHtml(row.label)}</td><td class="numeric ${signedClass(row.totalReturn)}">${percent(row.totalReturn)}</td><td class="numeric ${signedClass(row.totalReturnChange)}">${points(row.totalReturnChange)}</td><td class="numeric negative-text">${percent(row.maxDrawdown)}</td><td>${candidateBadge(verdict, isBaseline ? "neutral" : row.status.passedResearchGate ? "pass" : "reject")}</td></tr>`;
  })).join("");
}

function renderMeta(data) {
  document.getElementById("as-of-chip").textContent = `${data.provenance.priceAsOf} 주가 기준`;
  document.getElementById("footer-meta").textContent = `계산 기준 ${data.provenance.priceAsOf} · 보고서 갱신 ${data.generatedAt.slice(0, 10)}`;
  document.getElementById("print-report").addEventListener("click", () => window.print());
}

async function main() {
  const loading = document.getElementById("loading-state");
  try {
    const [response, candidateResponse] = await Promise.all([
      fetch(DATA_URL, { cache: "no-store" }),
      fetch(CANDIDATE_DATA_URL, { cache: "no-store" })
    ]);
    if (!response.ok) throw new Error(`보고서 HTTP ${response.status}`);
    if (!candidateResponse.ok) throw new Error(`후보 백테스트 HTTP ${candidateResponse.status}`);
    const [data, candidateData] = await Promise.all([response.json(), candidateResponse.json()]);
    renderMeta(data);
    renderSummary(data);
    renderScoreWeights(data);
    renderSlots(data);
    renderEquityChart(data);
    renderDifferentPicks(data);
    renderSectorShift(data);
    renderAnnual(data);
    renderSelectionTables(data);
    renderExitAccount(data);
    renderPairedExit(data);
    renderExtensionImpact(data);
    renderPeriods(data);
    renderRegimes(data);
    renderCandidateResults(candidateData);
    renderMethodology(data);
    let compactChart = window.innerWidth <= 560;
    window.addEventListener("resize", () => {
      const nextCompact = window.innerWidth <= 560;
      if (nextCompact !== compactChart) {
        compactChart = nextCompact;
        renderEquityChart(data);
      }
    });
    loading.hidden = true;
  } catch (error) {
    loading.classList.add("error");
    loading.textContent = `보고서 데이터를 불러오지 못했습니다: ${error.message}`;
    console.error(error);
  }
}

main();
