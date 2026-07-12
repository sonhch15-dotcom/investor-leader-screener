const DATA_URL = window.location.pathname.includes("/dashboard/")
  ? "../data/quantconnect-point-in-time-audit.json"
  : "./data/quantconnect-point-in-time-audit.json";

const rounded = (value, digits) => (value + Math.sign(value) * 1e-9).toFixed(digits);
const percent = (value, digits = 1) => Number.isFinite(value)
  ? `${value >= 0 ? "+" : ""}${rounded(value * 100, digits)}%`
  : "-";
const points = (value, digits = 1) => Number.isFinite(value)
  ? `${value >= 0 ? "+" : ""}${rounded(value * 100, digits)}%포인트`
  : "-";
const money = (value) => Number.isFinite(value) ? `${Math.round(value).toLocaleString("ko-KR")}원` : "-";
const summary = (data, side, variant) => data[side].summaries.find((row) => row.variant === variant);
const yearly = (data, side, variant) => data[side].yearly.find((row) => row.variant === variant)?.returns ?? {};

function metricCard(label, value, note) {
  return `<article class="metric-card"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`;
}

function renderHeadline(data) {
  const pitA = summary(data, "pit", "A");
  const pitC = summary(data, "pit", "C");
  const fixedC = summary(data, "fixed", "C");
  const cInflation = fixedC.ret - pitC.ret;
  document.getElementById("headline-metrics").innerHTML = [
    metricCard("당시 종목 · 종목 힘 중심형", percent(pitC.ret), "1천만원 → 2,877만8,091원"),
    metricCard("현재 종목 고정으로 높아진 폭", points(cInflation), "같은 QuantConnect 조건 안에서 비교"),
    metricCard("보정 뒤 C형의 A형 초과", points(pitC.ret - pitA.ret), "종목 힘 중심형 우위는 유지"),
    metricCard("같은 기간 QQQ", percent(pitC.qqq), "시장 기준 ETF")
  ].join("");

  const finalInflation = fixedC.equity / pitC.equity - 1;
  document.getElementById("key-findings").innerHTML = [
    ["고정 명단은 결과를 높였습니다", `종목 힘 중심형의 마지막 자산이 당시 구성보다 ${percent(finalInflation)} 더 크게 계산됐습니다.`],
    ["C형 우위는 사라지지 않았습니다", `당시 구성에서도 C형 ${percent(pitC.ret)}, A형 ${percent(pitA.ret)}로 C형이 앞섰습니다.`],
    ["공식 승격 근거로는 아직 부족합니다", "데이터 종점과 과거 전용 종목의 업종 보완 한계가 있어 active 전략은 그대로 둡니다."]
  ].map(([title, body]) => `<article class="finding-card"><strong>${title}</strong><p>${body}</p></article>`).join("");
}

function renderBars(targetId, pit, fixed) {
  const maximum = Math.max(pit.ret, fixed.ret, 0.01);
  const rows = [
    { label: "당시 실제 구성", value: pit.ret, className: "" },
    { label: "현재 종목 517개 고정", value: fixed.ret, className: "fixed" }
  ];
  document.getElementById(targetId).innerHTML = rows.map((row) => `
    <div class="audit-bar-row">
      <div class="audit-bar-head"><span>${row.label}</span><strong>${percent(row.value)}</strong></div>
      <div class="audit-bar-track"><div class="audit-bar-fill ${row.className}" style="width:${Math.max(2, row.value / maximum * 100)}%"></div></div>
      <div class="audit-bar-caption">연평균 ${percent(row === rows[0] ? pit.cagr : fixed.cagr)} · 최대 하락 ${percent(row === rows[0] ? pit.mdd : fixed.mdd)}</div>
    </div>
  `).join("");
}

function renderComparison(data) {
  const pitA = summary(data, "pit", "A");
  const pitC = summary(data, "pit", "C");
  const fixedA = summary(data, "fixed", "A");
  const fixedC = summary(data, "fixed", "C");
  renderBars("a-comparison-bars", pitA, fixedA);
  renderBars("c-comparison-bars", pitC, fixedC);

  const rows = [
    ["섹터 흐름형", "당시 실제 구성", pitA],
    ["섹터 흐름형", "현재 종목 고정", fixedA],
    ["종목 힘 중심형", "당시 실제 구성", pitC],
    ["종목 힘 중심형", "현재 종목 고정", fixedC]
  ];
  document.getElementById("comparison-table").innerHTML = rows.map(([name, universe, row]) => `
    <tr>
      <td>${name}</td><td>${universe}</td>
      <td class="numeric positive-text">${percent(row.ret)}</td>
      <td class="numeric">${percent(row.cagr)}</td>
      <td class="numeric negative-text">${percent(row.mdd)}</td>
      <td class="numeric">${points(row.ret - row.qqq)}</td>
      <td class="numeric">${money(row.equity)}</td>
    </tr>
  `).join("");

  document.getElementById("pit-strategy-comparison").innerHTML = `
    <strong>${points(pitC.ret - pitA.ret)}</strong>
    <p>당시 실제 구성 종목으로 고쳐도 종목 힘 중심형의 누적 수익이 더 높았습니다. 다만 최대 하락은 C형 ${percent(pitC.mdd)}, A형 ${percent(pitA.mdd)}로 C형이 0.6%포인트 더 깊었습니다.</p>
  `;
}

function renderYearly(data) {
  const a = yearly(data, "pit", "A");
  const c = yearly(data, "pit", "C");
  const years = [...new Set([...Object.keys(a), ...Object.keys(c)])].sort();
  const maxAbs = Math.max(...years.flatMap((year) => [Math.abs(a[year] ?? 0), Math.abs(c[year] ?? 0)]), 0.01);
  const series = (label, value, className) => {
    const width = Math.abs(value) / maxAbs * 50;
    const negative = value < 0;
    return `<div class="year-series"><span>${label}</span><div class="year-track"><div class="year-fill ${className} ${negative ? "negative" : ""}" style="width:${width}%"></div></div><strong class="year-value">${percent(value)}</strong></div>`;
  };
  document.getElementById("yearly-chart").innerHTML = years.map((year) => `
    <div class="year-row"><span class="year-label">${year}</span><div class="year-bars">${series("섹터 흐름", a[year], "")}${series("종목 힘", c[year], "c")}</div></div>
  `).join("");
}

function overlapCard(name, overlap) {
  const total = overlap.two + overlap.one + overlap.zero;
  const segment = (count, className, label) => count
    ? `<span class="${className}" style="width:${count / total * 100}%">${count}</span>`
    : "";
  return `<article class="overlap-card"><h3>${name}</h3><div class="overlap-strip">${segment(overlap.two, "overlap-two", "2개 같음")}${segment(overlap.one, "overlap-one", "1개 같음")}${segment(overlap.zero, "overlap-zero", "모두 다름")}</div><div class="overlap-legend"><span><i style="background:var(--teal)"></i>2개 같음 ${overlap.two}개월</span><span><i style="background:var(--navy)"></i>1개 같음 ${overlap.one}개월</span><span><i style="background:var(--red)"></i>모두 다름 ${overlap.zero}개월</span></div></article>`;
}

function renderSelections(data) {
  const overlap = data.comparison.pitVsFixedSelectionOverlap;
  document.getElementById("overlap-cards").innerHTML = overlapCard("섹터 흐름형", overlap.A) + overlapCard("종목 힘 중심형", overlap.C);

  const labels = { A: "섹터 흐름형", C: "종목 힘 중심형" };
  document.getElementById("removed-selections").innerHTML = ["A", "C"].map((key) => `
    <div class="removed-column"><h4>${labels[key]}</h4><div class="ticker-list">${data.pit.outCurrent[key].map((item) => {
      const [ticker, month] = item.split("@");
      return `<span class="ticker-chip">${ticker} · ${month}</span>`;
    }).join("")}</div></div>
  `).join("");

  const fixedByMonth = new Map(data.fixed.signals.map((row) => [row.month, row]));
  document.getElementById("monthly-signals").innerHTML = data.pit.signals.map((row) => {
    const fixed = fixedByMonth.get(row.month) ?? { a: [], c: [] };
    return `<tr><td>${row.month}</td><td class="numeric">${row.universe}</td><td>${row.a.join(", ")}</td><td>${row.c.join(", ")}</td><td>${fixed.a.join(", ")}</td><td>${fixed.c.join(", ")}</td></tr>`;
  }).join("");
}

function renderSmoke(data) {
  document.getElementById("smoke-facts").innerHTML = [
    [data.smoke.delistedPrice.symbol, "상장폐지 종목 가격 조회"],
    [`$${data.smoke.delistedPrice.close.toFixed(2)}`, data.smoke.delistedPrice.date],
    [`${data.smoke.spyConstituents.count}개`, "SPY 당시 구성 종목"],
    [`${data.smoke.qqqConstituents.count}개`, "QQQ 당시 구성 종목"]
  ].map(([value, label]) => `<div class="smoke-fact"><strong>${value}</strong><span>${label}</span></div>`).join("");
}

function renderMethodology(data) {
  const cards = [
    ["가격 제공처", "QuantConnect Free"],
    ["실행 엔진", "LEAN master v17914"],
    ["추천월", `${data.period.signalMonths}개월`],
    ["마지막 가격", data.period.lastPriceDate],
    ["당시 유니버스", "SPY + QQQ 시점별 합집합"],
    ["고정 대조군", "현재 종목 517개"],
    ["초기 자금", "10,000,000원"],
    ["거래비용", "매수·매도 각각 0.1%"],
    ["매도 규칙", "6개월 50% + 잔여 주봉 연장"]
  ];
  document.getElementById("method-grid").innerHTML = cards.map(([label, value]) => `<article class="method-card"><span>${label}</span><strong>${value}</strong></article>`).join("");
  document.getElementById("limitation-list").innerHTML = [
    "QuantConnect 가격은 2026-04-13에서 끝나 이번 보고서에는 2026년 4~6월 신호가 없습니다.",
    "현재 종목은 기존 고정 업종표를 썼지만 과거에만 존재한 종목은 당시 Morningstar 업종으로 보완했습니다.",
    "PIT와 고정 대조군의 차이는 주로 생존편향이지만 티커 변경과 보완 업종표의 작은 영향이 남을 수 있습니다.",
    "이번 결과는 연구 자료이며 Public API, Android 주문 정책, active 전략을 자동으로 변경하지 않습니다."
  ].map((item) => `<li>${item}</li>`).join("");
}

async function main() {
  const response = await fetch(DATA_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`감사 데이터 요청 실패: ${response.status}`);
  const data = await response.json();
  renderHeadline(data);
  renderComparison(data);
  renderYearly(data);
  renderSelections(data);
  renderSmoke(data);
  renderMethodology(data);
  document.getElementById("as-of-chip").textContent = `가격 ${data.period.lastPriceDate}`;
  document.getElementById("footer-meta").textContent = `QuantConnect 프로젝트 ${data.project.id} · ${data.period.signalMonths}개월`;
  document.getElementById("loading-state").hidden = true;
}

document.getElementById("print-report").addEventListener("click", () => window.print());
main().catch((error) => {
  const loading = document.getElementById("loading-state");
  loading.classList.add("error");
  loading.textContent = error.message;
});
