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

let allRows = [];

async function loadData() {
  const response = await fetch("data/screener-results.json", { cache: "no-store" });
  if (!response.ok) throw new Error("data/screener-results.json 파일이 없습니다. 먼저 refresh를 실행하세요.");
  return response.json();
}

function tag(text, className = "") {
  return `<span class="tag ${className}">${text}</span>`;
}

function percent(value) {
  if (value === null || value === undefined) return "-";
  return `${(value * 100).toFixed(1)}%`;
}

function tradingViewUrl(symbol) {
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`;
}

function yahooUrl(symbol) {
  return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`;
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
  const m = data.market;
  document.getElementById("market").innerHTML = `
    <div class="metric">
      <div class="label">시장 상태</div>
      <div class="value">${m.regime}</div>
      <div class="small">권장 1회 리스크 ${m.suggestedRiskPerTrade}</div>
    </div>
    <div class="metric">
      <div class="label">시장 점수</div>
      <div class="value">${m.score}</div>
    </div>
    <div class="metric">
      <div class="label">지수 추세</div>
      <div class="value">${m.components.indexTrend}</div>
    </div>
    <div class="metric">
      <div class="label">시장 폭</div>
      <div class="value">${m.components.breadth}</div>
    </div>
    <div class="metric">
      <div class="label">섹터 흐름</div>
      <div class="value">${m.components.sectorFlow}</div>
    </div>
  `;
}

function card(row) {
  const reasons = row.reasons.length ? row.reasons : ["수동 검토 필요"];
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
        ${reasons.map((item) => `<div>${item}</div>`).join("")}
      </div>
      ${miniChart(row)}
      <div class="tags">
        ${tag(statusLabel[row.status], row.status)}
        ${tag(setupLabel[row.setup.type])}
        ${(row.tags ?? []).slice(0, 4).map((item) => tag(item)).join("")}
        ${(row.warnings ?? []).slice(0, 3).map((item) => tag(item, "warn")).join("")}
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

function rowHtml(row, index) {
  const reasonText = [...(row.reasons ?? []), ...(row.warnings ?? []).map((item) => `경고: ${item}`)].join(" / ");
  return `
    <tr>
      <td class="num">${index + 1}</td>
      <td><strong>${row.symbol}</strong><div class="small">${row.name}</div><div class="small"><a href="${tradingViewUrl(row.symbol)}" target="_blank" rel="noreferrer">TradingView</a></div></td>
      <td>${tag(statusLabel[row.status], row.status)}</td>
      <td class="num">${row.score}</td>
      <td class="num">${row.scores.relative.total}</td>
      <td class="num">${row.scores.momentum.total}</td>
      <td class="num">${row.scores.sectorTheme.total}</td>
      <td class="num">${row.scores.volume.total}</td>
      <td>${setupLabel[row.setup.type]}<div class="small">RR ${row.setup.rewardRisk ?? "-"} / 손절 ${percent(row.setup.stopDistance)}</div></td>
      <td>${reasonText || "수동 검토 필요"}<div class="small">${row.sector || row.group} ${(row.tags ?? []).join(", ")}</div></td>
    </tr>
  `;
}

function renderTable(rows) {
  document.getElementById("ranking").innerHTML = rows.map(rowHtml).join("");
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
    const data = await loadData();
    allRows = data.rows;
    document.getElementById("meta").textContent = `${data.mode} | ${new Date(data.generatedAt).toLocaleString()} | universe ${data.universeSize}, priced ${data.priceSeriesCount}`;
    renderMarket(data);
    renderCards(data);
    renderTable(allRows);
    document.getElementById("filter").addEventListener("input", applyFilter);
  } catch (error) {
    document.getElementById("meta").textContent = error.message;
    document.getElementById("market").innerHTML = `<div class="metric"><div class="value">데이터 없음</div><div class="small">${error.message}</div></div>`;
  }
}

main();
