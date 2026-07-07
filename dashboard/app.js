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

const strategyCatalog = [
  {
    key: "full_leader_top5",
    label: "Full Universe Leaders Top5",
    shortLabel: "Full Top5",
    description: "전체 유니버스 기준 상위 2개 주도 그룹 안에서 현재 Top20 중 상위 5개를 선택합니다.",
    groupMode: "leaderTop2",
    limit: 5
  },
  {
    key: "full_leader_top10",
    label: "Full Universe Leaders Top10",
    shortLabel: "Full Top10",
    description: "전체 유니버스 기준 상위 2개 주도 그룹 안에서 현재 Top20 중 상위 10개를 선택합니다.",
    groupMode: "leaderTop2",
    limit: 10
  },
  {
    key: "full_quality_leader_top10",
    label: "Full Quality Leaders Top10",
    shortLabel: "Quality Top10",
    description: "QQQ 상대강도, 50일선 breadth, 75점 이상 비율, Top50 포함 수를 통과한 주도 그룹에서 선택합니다.",
    groupMode: "qualityTop3",
    limit: 10
  }
];

let allRows = [];
let monthlyResult = null;
let fullGroupResult = null;
let screenerData = null;

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

function currentTop20(data) {
  return data.rows.filter((row) => row.status !== "excluded").slice(0, 20);
}

function currentGroupStats(data) {
  return data.currentGroupStats ?? [];
}

function qualityGroups(data) {
  return currentGroupStats(data)
    .filter((group) => (
      group.averageQqqExcessMomentum > 0
      && group.above50Rate >= 0.55
      && group.score75Rate >= 0.15
      && group.top50Count >= 2
    ))
    .slice(0, 3)
    .map((group) => group.group);
}

function groupsForStrategy(data, strategy) {
  const groups = currentGroupStats(data);
  if (strategy.groupMode === "qualityTop3") return qualityGroups(data);
  return groups.slice(0, 2).map((group) => group.group);
}

function rowsForStrategy(data, strategy) {
  const groups = new Set(groupsForStrategy(data, strategy));
  return currentTop20(data)
    .filter((row) => groups.has(row.sector))
    .slice(0, strategy.limit);
}

function strategyBacktest(strategyKey) {
  return fullGroupResult?.splits?.all?.results?.find((row) => row.key === strategyKey) ?? null;
}

function groupBacktest(groupName) {
  return fullGroupResult?.groupContribution?.find((row) => row.group === groupName) ?? null;
}

function candidateCard(row, strategy) {
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
        ${tag(row.sector)}
        ${tag(strategy.shortLabel)}
      </div>
      <div class="links">
        <a href="${tradingViewUrl(row.symbol)}" target="_blank" rel="noreferrer">TradingView</a>
        <a href="${yahooUrl(row.symbol)}" target="_blank" rel="noreferrer">Yahoo</a>
      </div>
    </article>
  `;
}

function renderCurrentLeaders(data) {
  const groups = currentGroupStats(data).slice(0, 6);
  document.getElementById("leader-sector-meta").textContent = `상위 ${groups.length}개 그룹`;
  document.getElementById("leader-sectors").innerHTML = groups.map((group, index) => {
    const history = groupBacktest(group.group);
    const warning = history && Number.isFinite(history.averageExcessQqq12m) && history.averageExcessQqq12m < 0
      ? tag("과거 QQQ 초과 약함", "warn")
      : "";
    return `
      <article class="card leader-card">
        <div class="card-head">
          <div>
            <div class="symbol">${index + 1}. ${group.group}</div>
            <div class="name">리더십 점수 ${number(group.leadershipScore)}</div>
          </div>
          <div class="score">${group.top50Count ?? 0}</div>
        </div>
        <div class="reasons">
          <div>QQQ 대비 현재 모멘텀: ${percent(group.averageQqqExcessMomentum)}</div>
          <div>50일선 위: ${percent(group.above50Rate)} / 200일선 위: ${percent(group.above200Rate)}</div>
          <div>과거 12M 평균 QQQ 초과: ${percent(history?.averageExcessQqq12m)}</div>
        </div>
        <div class="tags">${warning}${tag(`Top20 ${group.top20Count ?? 0}개`)}</div>
      </article>
    `;
  }).join("");
}

function renderStrategyPicks(data) {
  const total = strategyCatalog.reduce((sum, strategy) => sum + rowsForStrategy(data, strategy).length, 0);
  document.getElementById("strategy-pick-meta").textContent = `${total}개 전략 후보`;
  document.getElementById("strategy-picks").innerHTML = strategyCatalog.map((strategy) => {
    const rows = rowsForStrategy(data, strategy);
    const groups = groupsForStrategy(data, strategy);
    const backtest = strategyBacktest(strategy.key);
    const stats12m = backtest?.horizons?.["12m"];
    return `
      <section class="strategy-panel">
        <div class="strategy-header">
          <div>
            <h3>${strategy.label}</h3>
            <p class="small">${strategy.description}</p>
            <div class="tags">
              ${groups.map((group) => tag(group)).join("")}
              ${tag(`12M 평균 ${percent(stats12m?.averageReturn)}`)}
              ${tag(`QQQ 초과 ${percent(stats12m?.averageExcessQqq)}`)}
            </div>
          </div>
          <div class="strategy-count">${rows.length}</div>
        </div>
        <div class="cards picks-grid">
          ${rows.length ? rows.map((row) => candidateCard(row, strategy)).join("") : `<div class="card small">현재 이 전략이 선택한 후보가 없습니다.</div>`}
        </div>
      </section>
    `;
  }).join("");
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
      [row.top10, "bar-top"],
      [row.spy, "bar-spy"],
      [row.qqq, "bar-qqq"]
    ].forEach(([value, className], barIndex) => {
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
}

function strategyOptions() {
  const existing = new Set(fullGroupResult?.splits?.all?.results?.map((row) => row.key) ?? []);
  return strategyCatalog.filter((strategy) => existing.has(strategy.key));
}

function renderStrategyDetailControls() {
  const strategySelect = document.getElementById("strategy-select");
  const periodSelect = document.getElementById("strategy-period-select");
  const options = strategyOptions();
  strategySelect.innerHTML = options.map((strategy) => `<option value="${strategy.key}">${strategy.label}</option>`).join("");
  const selectedStrategy = fullGroupResult?.splits?.all?.results?.find((row) => row.key === strategySelect.value) ?? fullGroupResult?.splits?.all?.results?.find((row) => row.key === options[0]?.key);
  periodSelect.innerHTML = (selectedStrategy?.periodsDetail ?? [])
    .slice()
    .reverse()
    .map((period) => `<option value="${period.asOf}">${period.asOf} | ${period.symbols.length}개 | 12M ${percent(period["12m"]?.portfolioReturn)}</option>`)
    .join("");

  strategySelect.addEventListener("change", () => {
    renderStrategyPeriodOptions();
    renderStrategyPeriodDetail();
  });
  periodSelect.addEventListener("change", renderStrategyPeriodDetail);
  renderStrategyPeriodDetail();
}

function renderStrategyPeriodOptions() {
  const strategyKey = document.getElementById("strategy-select").value;
  const strategy = fullGroupResult?.splits?.all?.results?.find((row) => row.key === strategyKey);
  const periodSelect = document.getElementById("strategy-period-select");
  periodSelect.innerHTML = (strategy?.periodsDetail ?? [])
    .slice()
    .reverse()
    .map((period) => `<option value="${period.asOf}">${period.asOf} | ${period.symbols.length}개 | 12M ${percent(period["12m"]?.portfolioReturn)}</option>`)
    .join("");
}

function monthlyPeriod(asOf) {
  return monthlyResult?.periods?.find((period) => period.asOf === asOf);
}

function renderStrategyPeriodDetail() {
  const strategyKey = document.getElementById("strategy-select").value;
  const asOf = document.getElementById("strategy-period-select").value;
  const strategy = fullGroupResult?.splits?.all?.results?.find((row) => row.key === strategyKey);
  const detail = strategy?.periodsDetail?.find((period) => period.asOf === asOf);
  const monthly = monthlyPeriod(asOf);
  const body = document.getElementById("strategy-period-detail");
  const meta = document.getElementById("strategy-period-meta");
  if (!strategy || !detail) {
    body.innerHTML = `<tr><td colspan="9">선택 데이터가 없습니다.</td></tr>`;
    meta.textContent = "";
    return;
  }

  meta.innerHTML = `
    <strong>${strategy.label}</strong> | 선택 그룹: ${detail.selectedGroups.join(", ") || "-"} |
    3M ${percent(detail["3m"]?.portfolioReturn)} / 6M ${percent(detail["6m"]?.portfolioReturn)} / 12M ${percent(detail["12m"]?.portfolioReturn)}
  `;

  body.innerHTML = detail.symbols.map((symbol, index) => {
    const row = monthly?.selections?.find((item) => item.symbol === symbol);
    return `
      <tr>
        <td class="num">${index + 1}</td>
        <td><strong>${symbol}</strong><div class="small">${row?.name ?? ""}</div></td>
        <td>${row?.sector ?? "-"}</td>
        <td>${tag(statusLabel[row?.status], row?.status)}</td>
        <td class="num">${row?.score ?? "-"}</td>
        <td class="num">${percent(row?.returns?.["1m"])}</td>
        <td class="num">${percent(row?.returns?.["3m"])}</td>
        <td class="num">${percent(row?.returns?.["6m"])}</td>
        <td class="num">${percent(row?.returns?.["12m"])}</td>
      </tr>
    `;
  }).join("");
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

async function main() {
  try {
    screenerData = await fetchJson("data/screener-results.json");
    monthlyResult = await fetchJson("data/monthly-selection-test.json", false);
    fullGroupResult = await fetchJson("data/full-universe-group-test.json", false);
    allRows = screenerData.rows;
    document.getElementById("meta").textContent = `${screenerData.mode} | ${new Date(screenerData.generatedAt).toLocaleString()} | universe ${screenerData.universeSize}, priced ${screenerData.priceSeriesCount}`;
    renderMarket(screenerData);
    renderCurrentLeaders(screenerData);
    renderStrategyPicks(screenerData);
    renderFullGroupBacktest(fullGroupResult);
    renderMonthlySummary(monthlyResult);
    renderStrategyDetailControls();
    setupTabs();
  } catch (error) {
    document.getElementById("meta").textContent = error.message;
    document.getElementById("market").innerHTML = `<div class="metric"><div class="value">데이터 없음</div><div class="small">${error.message}</div></div>`;
  }
}

main();
