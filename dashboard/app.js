const statusLabel = {
  buyable: "매수 가능",
  review: "매수 검토",
  strong_watch: "강한 감시",
  watch: "감시",
  excluded: "제외"
};

const setupLabel = {
  none: "없음",
  pullback_reacceleration: "눌림 재상승",
  volume_breakout: "거래량 돌파"
};

const semiconductorSymbols = new Set([
  "NVDA", "AVGO", "AMD", "ARM", "MRVL", "MU", "QCOM", "AMAT", "LRCX", "KLAC",
  "ASML", "TSM", "INTC", "ON", "MCHP", "MPWR", "ADI", "TXN", "NXPI", "TER",
  "SWKS", "QRVO", "SMCI", "DELL", "WDC", "STX", "SOXX", "SMH", "SOXL", "USD"
]);

let allRows = [];
let monthlyResult = null;
let fullGroupResult = null;

async function fetchJson(path, required = true) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) {
    if (!required) return null;
    throw new Error(`${path} 파일을 찾을 수 없습니다. refresh/build를 먼저 실행하세요.`);
  }
  return response.json();
}

function tag(text, className = "") {
  return `<span class="tag ${className}">${text ?? "-"}</span>`;
}

function percent(value) {
  if (!Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(1)}%`;
}

function number(value, digits = 1) {
  if (!Number.isFinite(value)) return "-";
  return value.toFixed(digits);
}

function average(values) {
  const clean = values.filter(Number.isFinite);
  if (!clean.length) return null;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function tradingViewUrl(symbol) {
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`;
}

function yahooUrl(symbol) {
  return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`;
}

function compactReason(row) {
  const reasons = row.reasons?.length ? row.reasons : ["차트 확인 필요"];
  const warnings = (row.warnings ?? []).slice(0, 2).map((item) => `경고: ${item}`);
  return [...reasons, ...warnings].join(" / ");
}

function miniChart(row) {
  const chart = row.chart ?? [];
  if (chart.length < 2) return `<div class="mini-chart small">차트 데이터 없음</div>`;
  const width = 320;
  const height = 96;
  const pad = 8;
  const closes = chart.map((item) => item.close).filter(Number.isFinite);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min || 1;
  const points = chart.map((item, index) => {
    const x = pad + (index / (chart.length - 1)) * (width - pad * 2);
    const y = height - pad - ((item.close - min) / span) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const area = `${pad},${height - pad} ${points.join(" ")} ${width - pad},${height - pad}`;
  return `
    <svg class="mini-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${row.symbol} price chart">
      <polygon class="chart-fill" points="${area}"></polygon>
      <polyline class="chart-line" points="${points.join(" ")}"></polyline>
    </svg>
  `;
}

function renderMarket(data) {
  const market = data.market;
  document.getElementById("market").innerHTML = `
    <div class="metric">
      <div class="label">시장 상태</div>
      <div class="value">${market.regime}</div>
      <div class="small">권장 1회 리스크 ${market.suggestedRiskPerTrade}</div>
    </div>
    <div class="metric">
      <div class="label">시장 점수</div>
      <div class="value">${market.score}</div>
    </div>
    <div class="metric">
      <div class="label">지수 추세</div>
      <div class="value">${market.components.indexTrend}</div>
    </div>
    <div class="metric">
      <div class="label">시장 폭</div>
      <div class="value">${market.components.breadth}</div>
    </div>
    <div class="metric">
      <div class="label">섹터 흐름</div>
      <div class="value">${market.components.sectorFlow}</div>
    </div>
  `;
}

function card(row) {
  return `
    <article class="card">
      <div class="card-head">
        <div>
          <div class="symbol">${row.symbol}</div>
          <div class="name">${row.name}</div>
        </div>
        <div class="score">${row.score}</div>
      </div>
      <div class="reasons">
        <div>${compactReason(row)}</div>
      </div>
      ${miniChart(row)}
      <div class="tags">
        ${tag(statusLabel[row.status], row.status)}
        ${tag(setupLabel[row.setup?.type] ?? row.setup?.type)}
        ${tag(row.sector)}
        ${(row.tags ?? []).slice(0, 3).map((item) => tag(item)).join("")}
      </div>
      <div class="links">
        <a href="${tradingViewUrl(row.symbol)}" target="_blank" rel="noreferrer">TradingView</a>
        <a href="${yahooUrl(row.symbol)}" target="_blank" rel="noreferrer">Yahoo</a>
      </div>
    </article>
  `;
}

function renderCards(data) {
  const buyable = data.rows.filter((row) => row.status === "buyable").slice(0, 10);
  const review = data.rows.filter((row) => row.status === "review").slice(0, 10);
  const strongWatch = data.rows.filter((row) => row.status === "strong_watch").slice(0, 10);
  document.getElementById("buyable-count").textContent = buyable.length;
  document.getElementById("review-count").textContent = review.length;
  document.getElementById("strong-watch-count").textContent = strongWatch.length;
  document.getElementById("buyable").innerHTML = buyable.length ? buyable.map(card).join("") : `<div class="card small">현재 매수 가능 후보가 없습니다.</div>`;
  document.getElementById("review").innerHTML = review.length ? review.map(card).join("") : `<div class="card small">현재 매수 검토 후보가 없습니다.</div>`;
  document.getElementById("strong-watch").innerHTML = strongWatch.length ? strongWatch.map(card).join("") : `<div class="card small">현재 강한 감시 후보가 없습니다.</div>`;
}

function buildFallbackGroupStats(rows) {
  const groups = new Map();
  for (const row of rows.filter((item) => item.type === "stock" && item.sector)) {
    const current = groups.get(row.sector) ?? [];
    current.push(row);
    groups.set(row.sector, current);
  }
  return Array.from(groups, ([group, groupRows]) => ({
    group,
    universeCount: groupRows.length,
    eligibleCount: groupRows.filter((row) => row.status !== "excluded").length,
    top20Count: allRows.filter((row) => row.status !== "excluded").slice(0, 20).filter((row) => row.sector === group).length,
    top50Count: allRows.filter((row) => row.status !== "excluded").slice(0, 50).filter((row) => row.sector === group).length,
    averageQqqExcessMomentum: average(groupRows.map((row) => row.returns?.excessQqq?.r3m)),
    above50Rate: average(groupRows.map((row) => row.metrics?.above50 ? 1 : 0)),
    above200Rate: average(groupRows.map((row) => row.metrics?.above200 ? 1 : 0)),
    score75Rate: average(groupRows.map((row) => row.score >= 75 ? 1 : 0)),
    leadershipScore: average(groupRows.map((row) => row.score)) ?? 0
  })).sort((a, b) => b.leadershipScore - a.leadershipScore);
}

function currentGroupStats(data) {
  return (data.currentGroupStats?.length ? data.currentGroupStats : buildFallbackGroupStats(data.rows)).slice(0, 8);
}

function renderCurrentLeaders(data) {
  const groups = currentGroupStats(data);
  const topGroups = new Set(groups.slice(0, 3).map((item) => item.group));
  const picks = data.rows
    .filter((row) => row.status !== "excluded")
    .filter((row) => topGroups.has(row.sector))
    .filter((row) => row.score >= 75)
    .sort((a, b) => {
      const groupDiff = [...topGroups].indexOf(a.sector) - [...topGroups].indexOf(b.sector);
      return groupDiff || b.score - a.score;
    })
    .slice(0, 10);

  document.getElementById("leader-sector-meta").textContent = `상위 ${Math.min(groups.length, 5)}개 그룹`;
  document.getElementById("leader-sectors").innerHTML = groups.slice(0, 5).map((group, index) => `
    <article class="card leader-card">
      <div class="card-head">
        <div>
          <div class="symbol">${index + 1}. ${group.group}</div>
          <div class="name">리더십 점수 ${number(group.leadershipScore)}</div>
        </div>
        <div class="score">${group.top50Count ?? 0}</div>
      </div>
      <div class="reasons">
        <div>QQQ 대비 모멘텀: ${percent(group.averageQqqExcessMomentum)}</div>
        <div>50일선 위 비율: ${percent(group.above50Rate)} / 200일선 위 비율: ${percent(group.above200Rate)}</div>
        <div>75점 이상 비율: ${percent(group.score75Rate)} / Top20 포함: ${group.top20Count ?? 0}개</div>
      </div>
    </article>
  `).join("");

  document.getElementById("leader-pick-meta").textContent = `${picks.length}개 후보`;
  document.getElementById("leader-picks").innerHTML = picks.length
    ? picks.map(card).join("")
    : `<div class="card small">현재 주도 섹터 안에서 75점 이상 후보가 없습니다.</div>`;
}

function rowHtml(row, index) {
  const setup = row.setup?.type ?? row.setup;
  return `
    <tr>
      <td class="num">${index + 1}</td>
      <td>
        <strong>${row.symbol}</strong>
        <div class="small">${row.name}</div>
        <div class="small"><a href="${tradingViewUrl(row.symbol)}" target="_blank" rel="noreferrer">TradingView</a></div>
      </td>
      <td>${tag(statusLabel[row.status], row.status)}</td>
      <td class="num">${row.score}</td>
      <td class="num">${row.scores?.relative?.total ?? "-"}</td>
      <td class="num">${row.scores?.momentum?.total ?? "-"}</td>
      <td class="num">${row.scores?.sectorTheme?.total ?? "-"}</td>
      <td class="num">${row.scores?.volume?.total ?? "-"}</td>
      <td>${setupLabel[setup] ?? setup}<div class="small">RR ${row.setup?.rewardRisk ?? "-"} / 손절 ${percent(row.setup?.stopDistance)}</div></td>
      <td>${compactReason(row)}<div class="small">${row.sector || row.group} ${(row.tags ?? []).join(", ")}</div></td>
    </tr>
  `;
}

function renderTable(rows) {
  document.getElementById("ranking").innerHTML = rows.map(rowHtml).join("");
}

function top10BenchmarkRows(data) {
  return ["1m", "3m", "6m", "12m"].map((horizon) => {
    const summaries = data.periods
      .map((period) => period.summaries.find((item) => item.topN === 10 && item.horizon === horizon))
      .filter(Boolean)
      .filter((item) => Number.isFinite(item.portfolioReturn));
    return {
      horizon,
      top10: average(summaries.map((item) => item.portfolioReturn)),
      spy: average(summaries.map((item) => item.spyReturn)),
      qqq: average(summaries.map((item) => item.qqqReturn))
    };
  });
}

function renderBenchmarkChart(data) {
  const target = document.getElementById("benchmark-chart");
  if (!data) {
    target.innerHTML = `<div class="small">월간 검증 데이터가 없습니다.</div>`;
    return;
  }
  const rows = top10BenchmarkRows(data);
  const width = 760;
  const height = 300;
  const pad = { top: 22, right: 20, bottom: 42, left: 48 };
  const maxValue = Math.max(...rows.flatMap((row) => [row.top10, row.spy, row.qqq]).filter(Number.isFinite), 0.01);
  const yMax = Math.max(0.1, maxValue * 1.15);
  const groupWidth = (width - pad.left - pad.right) / rows.length;
  const barWidth = Math.min(42, groupWidth / 5);
  const scaleY = (value) => height - pad.bottom - (value / yMax) * (height - pad.top - pad.bottom);
  const bars = [];
  rows.forEach((row, index) => {
    const start = pad.left + index * groupWidth + groupWidth / 2 - barWidth * 1.7;
    [
      ["top10", row.top10, "bar-top"],
      ["spy", row.spy, "bar-spy"],
      ["qqq", row.qqq, "bar-qqq"]
    ].forEach(([key, value, className], barIndex) => {
      const safeValue = Math.max(0, value ?? 0);
      const x = start + barIndex * barWidth * 1.2;
      const y = scaleY(safeValue);
      const h = height - pad.bottom - y;
      bars.push(`<rect class="${className}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth}" height="${h.toFixed(1)}"></rect>`);
      bars.push(`<text class="chart-label" x="${(x + barWidth / 2).toFixed(1)}" y="${(y - 5).toFixed(1)}" text-anchor="middle">${percent(value)}</text>`);
    });
    bars.push(`<text class="chart-axis" x="${(pad.left + index * groupWidth + groupWidth / 2).toFixed(1)}" y="${height - 14}" text-anchor="middle">${row.horizon.toUpperCase()}</text>`);
  });

  target.innerHTML = `
    <svg class="bar-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Top 10 benchmark comparison">
      <line x1="${pad.left}" y1="${height - pad.bottom}" x2="${width - pad.right}" y2="${height - pad.bottom}" stroke="#dde3ea"></line>
      <line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${height - pad.bottom}" stroke="#dde3ea"></line>
      <text class="chart-axis" x="6" y="${scaleY(yMax).toFixed(1)}">${percent(yMax)}</text>
      <text class="chart-axis" x="18" y="${height - pad.bottom + 4}">0%</text>
      ${bars.join("")}
    </svg>
    <div class="legend">
      <span class="top">Top 10</span>
      <span class="spy">SPY</span>
      <span class="qqq">QQQ</span>
    </div>
  `;
}

function renderFullGroupBacktest(data) {
  const meta = document.getElementById("full-group-meta");
  const body = document.getElementById("full-group-summary");
  const recent = document.getElementById("recent-group-leaders");
  if (!data) {
    meta.textContent = "데이터 없음";
    body.innerHTML = `<tr><td colspan="8">full-universe-group-test.json 파일이 없습니다.</td></tr>`;
    return;
  }
  meta.textContent = `${data.periodCount}개 월별 기준`;
  const interesting = ["full_quality_leader_top10", "full_leader_top5", "full_leader_top10", "baseline_top10", "baseline_top20"];
  const rows = data.splits.all.results
    .filter((row) => interesting.includes(row.key))
    .map((row) => ({ ...row, horizon: "12m", stats: row.horizons["12m"] }));
  body.innerHTML = rows.map((row) => `
    <tr>
      <td>${row.label}</td>
      <td>${row.horizon}</td>
      <td class="num">${percent(row.stats.averageReturn)}</td>
      <td class="num">${percent(row.stats.medianReturn)}</td>
      <td class="num">${percent(row.stats.positiveRate)}</td>
      <td class="num">${percent(row.stats.beatSpyRate)}</td>
      <td class="num">${percent(row.stats.beatQqqRate)}</td>
      <td class="num">${percent(row.stats.averageExcessQqq)}</td>
    </tr>
  `).join("");

  recent.innerHTML = data.recentLeadingGroups.slice(-6).map((row) => `
    <article class="card">
      <div class="card-head">
        <div>
          <div class="symbol">${row.asOf}</div>
          <div class="name">최근 주도 그룹</div>
        </div>
      </div>
      <div class="reasons">
        ${row.leadingGroups.slice(0, 3).map((group, index) => `<div>${index + 1}. ${group.group} (${number(group.leadershipScore)})</div>`).join("")}
      </div>
    </article>
  `).join("");
}

function semiconductorStats(data) {
  const map = new Map();
  let periodsWithSemis = 0;
  for (const period of data.periods ?? []) {
    const semis = period.selections.filter((row) => semiconductorSymbols.has(row.symbol));
    if (semis.length) periodsWithSemis += 1;
    for (const row of semis) {
      const current = map.get(row.symbol) ?? { symbol: row.symbol, name: row.name, count: 0, r3m: [], r12m: [] };
      current.count += 1;
      if (Number.isFinite(row.returns?.["3m"])) current.r3m.push(row.returns["3m"]);
      if (Number.isFinite(row.returns?.["12m"])) current.r12m.push(row.returns["12m"]);
      map.set(row.symbol, current);
    }
  }
  return {
    periodsWithSemis,
    names: Array.from(map.values())
      .map((row) => ({ ...row, average3m: average(row.r3m), average12m: average(row.r12m) }))
      .sort((a, b) => b.count - a.count)
  };
}

function renderSemiconductorSection(data) {
  if (!data) return;
  const stats = semiconductorStats(data);
  document.getElementById("semiconductor-meta").textContent = `${stats.periodsWithSemis}/${data.asOfCount}개 기준일에서 Top20 포함`;
  document.getElementById("semiconductor-cards").innerHTML = stats.names.slice(0, 8).map((row) => `
    <article class="card">
      <div class="card-head">
        <div>
          <div class="symbol">${row.symbol}</div>
          <div class="name">${row.name}</div>
        </div>
        <div class="score">${row.count}회</div>
      </div>
      <div class="reasons">
        <div>평균 3M: ${percent(row.average3m)}</div>
        <div>평균 12M: ${percent(row.average12m)}</div>
      </div>
    </article>
  `).join("");
}

function renderPeriodOptions(data) {
  const select = document.getElementById("period-select");
  if (!select || !data?.periods?.length) return;
  select.innerHTML = data.periods
    .slice()
    .reverse()
    .map((period) => {
      const top10 = period.summaries.find((item) => item.topN === 10 && item.horizon === "12m");
      return `<option value="${period.asOf}">${period.asOf} | ${period.market.regime} | Top10 12M ${percent(top10?.portfolioReturn)}</option>`;
    })
    .join("");
  select.addEventListener("change", () => renderPeriodDetail(data, select.value));
  renderPeriodDetail(data, select.value);
}

function renderPeriodDetail(data, asOf) {
  const body = document.getElementById("period-detail");
  const period = data?.periods?.find((item) => item.asOf === asOf);
  if (!body || !period) return;
  body.innerHTML = period.selections.slice(0, 20).map((row, index) => `
    <tr>
      <td class="num">${index + 1}</td>
      <td><strong>${row.symbol}</strong><div class="small">${row.name}</div></td>
      <td>${tag(statusLabel[row.status], row.status)}</td>
      <td class="num">${row.score}</td>
      <td>${setupLabel[row.setup] ?? row.setup}</td>
      <td class="num">${percent(row.returns["1m"])}</td>
      <td class="num">${percent(row.returns["3m"])}</td>
      <td class="num">${percent(row.returns["6m"])}</td>
      <td class="num">${percent(row.returns["12m"])}</td>
    </tr>
  `).join("");
}

function renderMonthlySummary(data) {
  const meta = document.getElementById("monthly-meta");
  const summary = document.getElementById("monthly-summary");
  const worst = document.getElementById("monthly-worst");
  const contributors = document.getElementById("monthly-contributors");
  if (!data) {
    meta.textContent = "데이터 없음";
    summary.innerHTML = `<tr><td colspan="9">monthly-selection-test.json 파일이 없습니다.</td></tr>`;
    return;
  }

  meta.textContent = `${data.startDate} ~ ${data.endDate} | ${data.asOfCount}개 기준일`;
  renderBenchmarkChart(data);
  summary.innerHTML = data.summary.map((row) => `
    <tr>
      <td class="num">Top ${row.topN}</td>
      <td>${row.horizon}</td>
      <td class="num">${percent(row.averageReturn)}</td>
      <td class="num">${percent(row.medianReturn)}</td>
      <td class="num">${percent(row.positiveRate)}</td>
      <td class="num">${percent(row.beatSpyRate)}</td>
      <td class="num">${percent(row.beatQqqRate)}</td>
      <td class="num">${percent(row.averageExcessSpy)}</td>
      <td class="num">${percent(row.averageExcessQqq)}</td>
    </tr>
  `).join("");

  worst.innerHTML = data.worstPeriods.slice(0, 5).map((period) => {
    const names = period.selected
      .slice()
      .sort((a, b) => (a.r3m ?? 0) - (b.r3m ?? 0))
      .slice(0, 3)
      .map((row) => `${row.symbol} ${percent(row.r3m)}`)
      .join(", ");
    return `
      <article class="card">
        <div class="card-head">
          <div>
            <div class="symbol">${period.asOf}</div>
            <div class="name">${period.regime}</div>
          </div>
          <div class="score">${percent(period.top10_3m)}</div>
        </div>
        <div class="reasons">
          <div>Top10 12M: ${percent(period.top10_12m)}</div>
          <div>손실 기여: ${names}</div>
        </div>
      </article>
    `;
  }).join("");

  contributors.innerHTML = data.contributions.mostSelected.slice(0, 8).map((row) => `
    <article class="card">
      <div class="card-head">
        <div>
          <div class="symbol">${row.symbol}</div>
          <div class="name">${row.name}</div>
        </div>
        <div class="score">${row.count}회</div>
      </div>
      <div class="reasons">
        <div>평균 3M: ${percent(row.average3m)}</div>
        <div>평균 12M: ${percent(row.average12m)}</div>
      </div>
    </article>
  `).join("");
  renderPeriodOptions(data);
  renderSemiconductorSection(data);
}

function setupTabs() {
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => {
      const tab = button.dataset.tab;
      document.querySelectorAll(".tab-button").forEach((item) => item.classList.toggle("active", item === button));
      document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.toggle("active", panel.id === `${tab}-panel`));
    });
  });
}

function applyFilter() {
  const q = document.getElementById("filter").value.trim().toLowerCase();
  if (!q) {
    renderTable(allRows);
    return;
  }
  renderTable(allRows.filter((row) => [
    row.symbol,
    row.name,
    row.sector,
    row.group,
    ...(row.tags ?? [])
  ].join(" ").toLowerCase().includes(q)));
}

async function main() {
  try {
    const data = await fetchJson("data/screener-results.json");
    monthlyResult = await fetchJson("data/monthly-selection-test.json", false);
    fullGroupResult = await fetchJson("data/full-universe-group-test.json", false);
    allRows = data.rows;
    document.getElementById("meta").textContent = `${data.mode} | ${new Date(data.generatedAt).toLocaleString()} | universe ${data.universeSize}, priced ${data.priceSeriesCount}`;
    renderMarket(data);
    renderCurrentLeaders(data);
    renderCards(data);
    renderTable(allRows);
    renderFullGroupBacktest(fullGroupResult);
    renderMonthlySummary(monthlyResult);
    setupTabs();
    document.getElementById("filter").addEventListener("input", applyFilter);
  } catch (error) {
    document.getElementById("meta").textContent = error.message;
    document.getElementById("market").innerHTML = `<div class="metric"><div class="value">데이터 없음</div><div class="small">${error.message}</div></div>`;
  }
}

main();
