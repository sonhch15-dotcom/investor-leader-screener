let dashboard = null;
let showAllMonthlyExits = false;
let showAllRealizedTrades = false;

const RECENT_MONTHLY_EXIT_LIMIT = 12;
const RECENT_REALIZED_TRADE_LIMIT = 24;

async function fetchJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path} 파일을 불러오지 못했습니다.`);
  return response.json();
}

function percent(value) {
  if (!Number.isFinite(value)) return "-";
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
}

function plainPercent(value) {
  if (!Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(1)}%`;
}

function money(value) {
  if (!Number.isFinite(value)) return "-";
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function number(value, digits = 1) {
  if (!Number.isFinite(value)) return "-";
  return value.toFixed(digits);
}

function signedClass(value) {
  if (!Number.isFinite(value) || value === 0) return "flat";
  return value > 0 ? "positive" : "negative";
}

function statusLabel(status) {
  return {
    new: "신규",
    hold: "보유",
    extended: "50% 연장 보유",
    sell_due: "잔여 매도 점검"
  }[status] ?? status;
}

function sellReasonLabel(reason) {
  return {
    half_fixed_6m: "6개월 50% 매도",
    half_trend_not_alive_at_6m: "주봉 약화로 연장 없음",
    half_two_week_10w_break: "10주선 2주 이탈",
    half_max_12m: "최대 12개월 도달"
  }[reason] ?? reason;
}

function weeklyTrendText(row) {
  const trend = row.weeklyTrend ?? {};
  if (!trend.date) return "주봉 데이터 없음";
  const state = trend.alive ? "주봉 연장 가능" : "주봉 연장 불가";
  return `${state} | 10W ${money(trend.ma10)} | RSI ${number(trend.rsi14, 1)}`;
}

function sortByRecentCohort(rows) {
  return [...rows].sort((a, b) => {
    const cohortCompare = String(b.cohort).localeCompare(String(a.cohort));
    if (cohortCompare !== 0) return cohortCompare;
    return String(a.symbol).localeCompare(String(b.symbol));
  });
}

function sortActionRows(rows) {
  const priority = { sell_due: 0, extended: 1, hold: 2, new: 3 };
  return [...rows].sort((a, b) => {
    const priorityCompare = (priority[a.status] ?? 99) - (priority[b.status] ?? 99);
    if (priorityCompare !== 0) return priorityCompare;
    return String(b.cohort).localeCompare(String(a.cohort));
  });
}

function tag(text, className = "") {
  return `<span class="tag ${className}">${text}</span>`;
}

function formatDate(value) {
  return value || "-";
}

function actionDate(row) {
  if (row.status === "sell_due") return row.stopDate ?? row.maxExitDate ?? row.halfSellDate;
  if (row.status === "extended") return row.stopDate ?? row.maxExitDate;
  if (row.status === "hold") return row.halfSellDate;
  return row.entryDate;
}

function groupStatus(rows) {
  if (rows.some((row) => row.status === "sell_due")) return "sell_due";
  if (rows.some((row) => row.status === "extended")) return "extended";
  if (rows.some((row) => row.status === "new")) return "new";
  return "hold";
}

function groupHoldings(rows) {
  const groups = new Map();
  for (const row of rows) {
    const current = groups.get(row.symbol) ?? {
      symbol: row.symbol,
      name: row.name,
      sector: row.sector,
      currentPrice: row.currentPrice,
      tradingViewUrl: row.tradingViewUrl,
      yahooUrl: row.yahooUrl,
      lots: []
    };
    current.lots.push(row);
    if (Number.isFinite(row.currentPrice)) current.currentPrice = row.currentPrice;
    groups.set(row.symbol, current);
  }

  return Array.from(groups.values()).map((group) => {
    const lots = sortByRecentCohort(group.lots);
    const investedLots = lots.filter((row) => row.status !== "new");
    const weightedLots = investedLots.filter((row) => Number.isFinite(row.entryPrice) && Number.isFinite(row.remainingWeight));
    const totalWeight = weightedLots.reduce((sum, row) => sum + row.remainingWeight, 0);
    const averageEntry = totalWeight
      ? weightedLots.reduce((sum, row) => sum + row.entryPrice * row.remainingWeight, 0) / totalWeight
      : null;
    const currentReturn = Number.isFinite(averageEntry) && Number.isFinite(group.currentPrice) && averageEntry
      ? group.currentPrice / averageEntry - 1
      : null;
    return {
      ...group,
      lots,
      status: groupStatus(lots),
      totalWeight,
      averageEntry,
      currentReturn,
      nextDate: lots.map(actionDate).filter(Boolean).sort()[0] ?? null,
      sellDueCount: lots.filter((row) => row.status === "sell_due").length,
      extendedCount: lots.filter((row) => row.status === "extended").length
    };
  }).sort((a, b) => {
    const priority = { sell_due: 0, extended: 1, hold: 2, new: 3 };
    const priorityCompare = (priority[a.status] ?? 99) - (priority[b.status] ?? 99);
    if (priorityCompare !== 0) return priorityCompare;
    return String(a.nextDate ?? "9999").localeCompare(String(b.nextDate ?? "9999"));
  });
}

function lotLine(row) {
  const firstSell = row.status === "new"
    ? "진입 대기"
    : `50% 매도 ${formatDate(row.halfSellDate)}`;
  const remainingSell = row.status === "sell_due"
    ? `잔여 매도 ${formatDate(row.stopDate ?? row.maxExitDate)}`
    : row.status === "extended"
      ? `잔여 50% 연장 중, 최대 ${formatDate(row.maxExitDate)}`
      : `잔여 판단 ${formatDate(row.halfSellDate)}`;
  return `
    <li>
      <strong>${row.cohort}</strong>
      <span>매수 ${formatDate(row.entryDate)} @ ${money(row.entryPrice)}</span>
      <span class="${signedClass(row.currentReturn)}">현재 ${percent(row.currentReturn)}</span>
      <span>${firstSell}</span>
      <span>${remainingSell}</span>
    </li>
  `;
}

function lotList(rows) {
  return `<ul class="lot-list">${rows.map(lotLine).join("")}</ul>`;
}

function eventLine(event) {
  return `
    <li>
      <strong>${event.date}</strong>
      <span>${event.symbol} ${sellReasonLabel(event.reason)}</span>
      <span>${event.cohort} 추천</span>
      <span class="${signedClass(event.return)}">${percent(event.return)}</span>
    </li>
  `;
}

function tradeSellEvents(row) {
  const events = row.sellEvents?.length
    ? row.sellEvents
    : (row.sellDates ?? []).map((date, index) => ({
      date,
      month: String(date).slice(0, 7),
      reason: row.sellReasons?.[index] ?? "sell",
      weight: (row.sellDates ?? []).length >= 2 ? 0.5 : 1,
      price: row.exitPrice,
      return: row.return
    }));
  return events.map((event) => ({
    ...event,
    symbol: event.symbol ?? row.symbol,
    name: event.name ?? row.name,
    sector: event.sector ?? row.sector,
    cohort: event.cohort ?? row.cohort,
    entryDate: event.entryDate ?? row.entryDate,
    entryPrice: event.entryPrice ?? row.entryPrice
  }));
}

function monthlySellEventRows() {
  const generated = dashboard.backtest.monthlySellEvents ?? [];
  if (generated.length) return generated;

  const groups = new Map();
  for (const trade of dashboard.backtest.realizedTrades ?? []) {
    for (const event of tradeSellEvents(trade)) {
      const current = groups.get(event.month) ?? {
        month: event.month,
        events: [],
        fixedCount: 0,
        remainingCount: 0,
        symbols: [],
        weightedReturnSum: 0,
        returnWeight: 0
      };
      current.events.push(event);
      if (event.reason === "half_fixed_6m") current.fixedCount += 1;
      else current.remainingCount += 1;
      if (!current.symbols.includes(event.symbol)) current.symbols.push(event.symbol);
      if (Number.isFinite(event.return)) {
        current.weightedReturnSum += event.return * (event.weight ?? 1);
        current.returnWeight += event.weight ?? 1;
      }
      groups.set(event.month, current);
    }
  }
  return Array.from(groups.values()).map((row) => ({
    month: row.month,
    eventCount: row.events.length,
    fixedCount: row.fixedCount,
    remainingCount: row.remainingCount,
    symbols: row.symbols,
    averageEventReturn: row.weightedReturnSum / Math.max(1, row.returnWeight),
    events: row.events.sort((a, b) => String(a.date).localeCompare(String(b.date)))
  })).sort((a, b) => String(a.month).localeCompare(String(b.month)));
}

const plannerModes = {
  ramp: {
    label: "3개월 램프형 공격",
    capPct: 0.225,
    normalPct: 0.075,
    rampPct: 0.10,
    defensivePct: 0.05,
    rampMonths: 3,
    highCashPct: 0.30,
    lowCashPct: 0.10,
    reservePct: 0
  },
  base: {
    label: "개선 기본형",
    capPct: 0.175,
    normalPct: 0.065,
    reservePct: 0.10
  },
  over: {
    label: "과공격형",
    capPct: 0.20,
    normalPct: 0.075,
    reservePct: 0
  }
};

const fallbackFxRate = 1380;

function parseAmount(value) {
  const numeric = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatIntegerInput(input) {
  const value = parseAmount(input.value);
  input.value = value ? Math.round(value).toLocaleString("ko-KR") : "";
}

function krw(value) {
  if (!Number.isFinite(value)) return "-";
  return `₩${Math.round(value).toLocaleString("ko-KR")}`;
}

function usd(value) {
  if (!Number.isFinite(value)) return "-";
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function monthKeyFromDate(value) {
  return String(value ?? "").slice(0, 7);
}

function monthDiff(startMonth, endMonth) {
  if (!/^\d{4}-\d{2}$/.test(startMonth) || !/^\d{4}-\d{2}$/.test(endMonth)) return 0;
  const [startYear, startM] = startMonth.split("-").map(Number);
  const [endYear, endM] = endMonth.split("-").map(Number);
  return Math.max(0, (endYear - startYear) * 12 + endM - startM);
}

function plannedBuyAmount(mode, capital, cash, monthsSinceStart) {
  if (mode === plannerModes.ramp) {
    if (monthsSinceStart < mode.rampMonths && cash >= capital * mode.highCashPct) {
      return { amount: capital * mode.rampPct, reason: "초기 3개월 램프업: 현금이 충분해 자본금의 10% 매수" };
    }
    if (cash <= capital * mode.lowCashPct) {
      return { amount: capital * mode.defensivePct, reason: "현금 부족 방어: 자본금의 5%로 축소" };
    }
  }
  return { amount: capital * mode.normalPct, reason: `${mode.label} 기본 비중` };
}

function sharePlan(row, krwBudget, fxRate, shareMode) {
  const price = row.close;
  const usdBudget = fxRate > 0 ? krwBudget / fxRate : 0;
  if (!Number.isFinite(price) || price <= 0 || usdBudget <= 0) {
    return { shares: 0, usdUsed: 0, krwUsed: 0, leftoverKrw: krwBudget };
  }
  const rawShares = usdBudget / price;
  const shares = shareMode === "fractional" ? rawShares : Math.floor(rawShares);
  const usdUsed = shares * price;
  const krwUsed = usdUsed * fxRate;
  return {
    shares,
    usdUsed,
    krwUsed,
    leftoverKrw: Math.max(0, krwBudget - krwUsed)
  };
}

function allocationGradient(rows) {
  const colors = ["#2563eb", "#16a34a", "#f59e0b", "#94a3b8"];
  let cursor = 0;
  const parts = rows.map((row, index) => {
    const start = cursor;
    cursor += row.pct;
    return `${colors[index % colors.length]} ${start}% ${cursor}%`;
  });
  parts.push(`#e5e7eb ${cursor}% 100%`);
  return `conic-gradient(${parts.join(", ")})`;
}

function buildPlannerPlan() {
  const currentMonth = monthKeyFromDate(dashboard.asOf);
  const startMonth = document.getElementById("planner-start-month")?.value || currentMonth;
  const capital = Math.max(0, parseAmount(document.getElementById("planner-capital")?.value));
  let cash = Math.max(0, parseAmount(document.getElementById("planner-cash")?.value));
  const fxRate = Math.max(0, parseAmount(document.getElementById("planner-fx")?.value) || fallbackFxRate);
  const shareMode = document.getElementById("planner-share-mode")?.value ?? "whole";
  const monthsSinceStart = monthDiff(startMonth, currentMonth);
  const mode = plannerModes[document.getElementById("planner-mode")?.value] ?? plannerModes.ramp;
  const minOrder = Math.max(100_000, capital * 0.01);
  const reserve = capital * (mode.reservePct ?? 0);
  const buys = [];
  const isFutureStart = startMonth > currentMonth;
  const candidates = isFutureStart ? [] : (dashboard.currentBuys ?? []);

  for (const row of candidates) {
    const capAmount = capital * mode.capPct;
    const planned = plannedBuyAmount(mode, capital, cash, monthsSinceStart);
    const deployableCash = Math.max(0, cash - reserve);
    const budget = Math.min(planned.amount, capAmount, deployableCash);
    const shares = sharePlan(row, budget, fxRate, shareMode);
    const amount = shareMode === "fractional" ? budget : shares.krwUsed;
    const action = amount >= minOrder && shares.shares > 0 ? "buy" : "skip";
    const reason = deployableCash < minOrder
      ? `현금 방어선 ${krw(reserve)} 때문에 대기`
      : shareMode === "whole" && shares.shares < 1
        ? "1주 매수에 필요한 달러 예산이 부족해 대기"
        : planned.reason;
    buys.push({
      ...row,
      capAmount,
      budget,
      amount,
      usdBudget: budget / fxRate,
      shares: shares.shares,
      usdUsed: shares.usdUsed,
      krwUsed: amount,
      leftoverKrw: shares.leftoverKrw,
      action,
      reason
    });
    if (action === "buy") cash -= amount;
  }

  const totalBuy = buys.reduce((sum, row) => sum + (row.action === "buy" ? row.amount : 0), 0);
  const allocationRows = buys.filter((row) => row.action === "buy").map((row) => ({
    symbol: row.symbol,
    amount: row.amount,
    pct: capital > 0 ? row.amount / capital * 100 : 0
  }));

  return {
    capital,
    startingCash: Math.max(0, parseAmount(document.getElementById("planner-cash")?.value)),
    endingCash: cash,
    fxRate,
    shareMode,
    startMonth,
    currentMonth,
    monthsSinceStart,
    isFutureStart,
    mode,
    buys,
    totalBuy,
    allocationRows,
    cashPct: capital > 0 ? Math.max(0, cash) / capital * 100 : 0,
    reserve,
    minOrder
  };
}

function renderPlanner() {
  const target = document.getElementById("planner-summary");
  if (!target || !dashboard) return;
  const plan = buildPlannerPlan();
  const skipped = plan.buys.filter((row) => row.action !== "buy").length;
  const signalMeta = document.getElementById("planner-signal-meta");
  if (signalMeta) {
    signalMeta.textContent = `${plan.currentMonth} ${plan.startMonth === plan.currentMonth ? "현재 후보" : "현재월 기준"} | 환율 ${plan.fxRate.toLocaleString("ko-KR")}`;
  }
  const donut = document.getElementById("planner-donut");
  if (donut) {
    donut.style.background = allocationGradient(plan.allocationRows);
    donut.innerHTML = `
      <div>
        <span>매수 비중</span>
        <strong>${plainPercent(plan.capital ? plan.totalBuy / plan.capital : 0)}</strong>
        <small>현금 ${plainPercent(plan.cashPct / 100)}</small>
      </div>
    `;
  }
  target.innerHTML = `
    <article class="kpi"><span>운용 모드</span><strong>${plan.mode.label}</strong><small>시작월 ${plan.startMonth}</small></article>
    <article class="kpi"><span>이번 달 매수 예정</span><strong>${krw(plan.totalBuy)}</strong><small>${usd(plan.totalBuy / plan.fxRate)} | ${plan.buys.length - skipped}건 실행 / ${skipped}건 대기</small></article>
    <article class="kpi"><span>예상 잔여 현금</span><strong>${krw(plan.endingCash)}</strong><small>${usd(plan.endingCash / plan.fxRate)} | 시작 현금 ${krw(plan.startingCash)}</small></article>
    <article class="kpi"><span>종목당 한도</span><strong>${plainPercent(plan.mode.capPct)}</strong><small>최소 주문 ${krw(plan.minOrder)}</small></article>
  `;

  document.getElementById("planner-buys").innerHTML = plan.isFutureStart
    ? `<p class="empty-state">투자 시작월이 현재 데이터 월(${plan.currentMonth})보다 늦습니다. 해당 월 데이터가 생기면 신규 후보 2개를 계산합니다.</p>`
    : plan.buys.map((row) => `
    <article class="planner-card ${row.action}">
      <div>
        <strong>${row.symbol}</strong>
        <span>${row.name} | ${row.sector}</span>
      </div>
      <b>${row.action === "buy" ? `${krw(row.amount)} / ${usd(row.usdUsed)}` : "대기"}</b>
      <p>${row.reason}</p>
      <small>예상 주문: ${plan.shareMode === "fractional" ? row.shares.toFixed(4) : Math.floor(row.shares)}주 @ ${usd(row.close)} | 예산 ${krw(row.budget)} | 종목 한도 ${krw(row.capAmount)}</small>
    </article>
  `).join("");

  document.getElementById("planner-weekly").innerHTML = `
    <ol class="flow-list">
      <li><strong>월초/현재:</strong> ${plan.currentMonth} 후보 2개를 확인합니다. 월중 데이터는 관찰 후보이며, 실제 매수 기준은 월말 확정 신호입니다.</li>
      <li><strong>매수 후 매주:</strong> 새 종목을 더 사는 것이 아니라 보유 종목의 주봉 추세와 6개월 50% 매도 예정일을 점검합니다.</li>
      <li><strong>다음 달:</strong> 새 월의 추천 2개가 나오면 남은 현금과 새 자본금 기준으로 매수금을 다시 계산합니다.</li>
      <li><strong>6개월 후:</strong> 각 매수 건별로 50%를 기본 매도하고, 나머지 50%는 주봉 조건이 유지될 때만 연장합니다.</li>
    </ol>
  `;

  document.getElementById("planner-rules").innerHTML = `
    <ul class="rule-list">
      <li><strong>과거 추천:</strong> 시작월 이전 후보는 매수하지 않습니다. 새 계좌는 현재 월 후보부터 기록을 쌓습니다.</li>
      <li><strong>환율:</strong> 자동 조회 환율을 기본으로 쓰되, 실제 환전 환율과 수수료가 다르면 직접 수정합니다.</li>
      <li><strong>자본금 증가:</strong> 다음 월 리밸런싱부터 새 자본금 기준으로 매수금과 종목 한도를 다시 계산합니다.</li>
      <li><strong>자본금 감소/출금:</strong> 현금으로 먼저 처리합니다. 부족하면 매도 예정분, 주봉 약화분, 동일 종목 한도 초과분 순서로 줄입니다.</li>
      <li><strong>현금 부족:</strong> 이번 달 후보 2개 중 중복 종목보다 신규 섹터/신규 종목을 우선하고, 최소 주문금액보다 작으면 대기합니다.</li>
      <li><strong>1주 단위 주문:</strong> 달러 예산으로 살 수 있는 정수 주식 수를 계산하고, 남는 달러는 다음 매수 현금으로 남깁니다.</li>
    </ul>
  `;
}

async function updateFxRate() {
  const input = document.getElementById("planner-fx");
  if (!input) return;
  try {
    const response = await fetch("https://open.er-api.com/v6/latest/USD", { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();
    const rate = data?.rates?.KRW;
    if (Number.isFinite(rate)) {
      input.value = Math.round(rate).toLocaleString("ko-KR");
      renderPlanner();
    }
  } catch {
    input.value = Math.round(parseAmount(input.value) || fallbackFxRate).toLocaleString("ko-KR");
  }
}

function setupPlanner() {
  const form = document.getElementById("investment-planner-form");
  if (!form) return;
  const currentMonth = monthKeyFromDate(dashboard?.asOf);
  const startMonth = document.getElementById("planner-start-month");
  if (startMonth && !startMonth.value) startMonth.value = currentMonth;
  ["planner-capital", "planner-cash", "planner-fx"].forEach((id) => {
    const input = document.getElementById(id);
    if (!input) return;
    formatIntegerInput(input);
    input.addEventListener("blur", () => {
      formatIntegerInput(input);
      renderPlanner();
    });
  });
  form.addEventListener("input", renderPlanner);
  form.addEventListener("change", renderPlanner);
  renderPlanner();
  updateFxRate();
}

function miniChart(row) {
  const chart = row.chart ?? [];
  if (chart.length < 2) return `<div class="mini-chart empty">차트 데이터 없음</div>`;
  const width = 340;
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
    <svg class="mini-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${row.symbol} chart">
      <polygon class="chart-fill" points="${area}"></polygon>
      <polyline class="chart-line" points="${points.join(" ")}"></polyline>
    </svg>
  `;
}

function renderSummary() {
  const s = dashboard.portfolio.summary;
  const market = dashboard.market ?? {};
  document.getElementById("action-summary").innerHTML = `
    <article class="kpi">
      <span>신규 매수 후보</span>
      <strong>${s.newCount}개</strong>
      <small>차트 확인 후 진입</small>
    </article>
    <article class="kpi">
      <span>전략 기준 보유</span>
      <strong>${s.holdingCount}개</strong>
      <small>6개월 + 주봉 연장 관리</small>
    </article>
    <article class="kpi">
      <span>연장/매도 점검</span>
      <strong>${s.extendedCount ?? 0}/${s.sellDueCount}개</strong>
      <small>연장 보유 / 매도 필요</small>
    </article>
    <article class="kpi">
      <span>보유 평균 수익률</span>
      <strong class="${signedClass(s.averageReturn)}">${percent(s.averageReturn)}</strong>
      <small>전략 기준</small>
    </article>
    <article class="kpi">
      <span>시장 상태</span>
      <strong>${market.regime ?? "-"}</strong>
      <small>시장 점수 ${market.score ?? "-"}</small>
    </article>
  `;
}

function renderLeaders() {
  const leaders = dashboard.leaders ?? [];
  document.getElementById("leader-meta").textContent = `${dashboard.asOf} 기준`;
  document.getElementById("leader-sectors").innerHTML = leaders.map((leader) => `
    <article class="leader-card ${leader.rank <= 2 ? "primary" : ""}">
      <div class="rank">#${leader.rank}</div>
      <div>
        <h3>${leader.group}</h3>
        <p>리더십 ${number(leader.leadershipScore, 1)}</p>
      </div>
      <div class="leader-metrics">
        <span>QQQ 모멘텀 ${percent(leader.averageQqqExcessMomentum)}</span>
        <span>50일선 위 ${plainPercent(leader.above50Rate)}</span>
        <span>Top50 ${leader.top50Count ?? 0}개</span>
      </div>
    </article>
  `).join("");
}

function renderBuys() {
  document.getElementById("current-buys").innerHTML = (dashboard.currentBuys ?? []).map((row) => `
    <article class="buy-card">
      <div class="card-head">
        <div>
          <span class="label">신규 매수 후보</span>
          <h3>${row.symbol}</h3>
          <p>${row.name}</p>
        </div>
        <strong>${number(row.score, 1)}</strong>
      </div>
      ${miniChart(row)}
      <div class="metric-line">
        <span>${row.sector}</span>
        <span>1M ${percent(row.metrics?.r1m)}</span>
        <span>3M ${percent(row.metrics?.r3m)}</span>
      </div>
      <p class="reason">${(row.reasons ?? []).slice(0, 2).join(" / ") || "주도 섹터 1등 후보"}</p>
      <div class="links">
        <a href="https://www.tradingview.com/chart/?symbol=${encodeURIComponent(row.symbol)}" target="_blank" rel="noreferrer">TradingView</a>
        <a href="https://finance.yahoo.com/quote/${encodeURIComponent(row.symbol)}" target="_blank" rel="noreferrer">Yahoo</a>
      </div>
    </article>
  `).join("");
}

function renderHoldings() {
  const holdings = sortByRecentCohort(dashboard.portfolio.holdings ?? []);
  document.getElementById("holdings-meta").textContent = `전략 기준 ${holdings.length}개 | 최신 추천월 먼저`;
  document.getElementById("holdings-body").innerHTML = holdings.map((row) => `
    <tr>
      <td>${row.cohort}</td>
      <td><strong>${row.symbol}</strong><div class="sub">${row.name}</div></td>
      <td>${row.sector}</td>
      <td class="num">${money(row.entryPrice)}</td>
      <td class="num">${money(row.currentPrice)}</td>
      <td class="num ${signedClass(row.currentReturn)}">${percent(row.currentReturn)}</td>
      <td class="num">${row.ageMonths}개월</td>
      <td>${tag(statusLabel(row.status), row.status)}</td>
      <td><strong>${row.actionLabel ?? "-"}</strong><div class="sub">${row.remainingSellRule ?? weeklyTrendText(row)}</div></td>
      <td><a href="${row.tradingViewUrl}" target="_blank" rel="noreferrer">차트</a></td>
    </tr>
  `).join("");

  document.getElementById("holdings-cards").innerHTML = holdings.map((row) => `
    <article class="mobile-holding">
      <div class="card-head">
        <div>
          <h3>${row.symbol}</h3>
          <p>${row.sector} | ${row.cohort} 추천 | ${row.ageMonths}개월</p>
        </div>
        ${tag(statusLabel(row.status), row.status)}
      </div>
      <div class="mobile-price">
        <span>${money(row.entryPrice)} → ${money(row.currentPrice)}</span>
        <strong class="${signedClass(row.currentReturn)}">${percent(row.currentReturn)}</strong>
      </div>
      <p class="reason"><strong>${row.actionLabel ?? "-"}</strong> | ${row.remainingSellRule ?? weeklyTrendText(row)}</p>
      <div class="links">
        <a href="${row.tradingViewUrl}" target="_blank" rel="noreferrer">TradingView</a>
        <a href="${row.yahooUrl}" target="_blank" rel="noreferrer">Yahoo</a>
      </div>
    </article>
  `).join("");
}

function renderSellDue() {
  const rows = sortActionRows((dashboard.portfolio.holdings ?? []).filter((row) => (
    row.status === "sell_due" || row.status === "extended"
  )));
  document.getElementById("sell-due").innerHTML = rows.length
    ? rows.map((row) => `
      <article class="due-item">
        <strong>${row.symbol}</strong>
        <span>${row.cohort} 추천 | ${row.sector} | ${row.actionLabel} | ${row.remainingSellRule}</span>
        <b class="${signedClass(row.currentReturn)}">${percent(row.currentReturn)}</b>
      </article>
    `).join("")
    : `<p class="empty-state">이번 리밸런싱에서 50% 매도/연장 점검할 종목이 없습니다.</p>`;
}

function renderGroupedHoldings() {
  const holdings = sortByRecentCohort(dashboard.portfolio.holdings ?? []);
  const groups = groupHoldings(holdings);
  const totalLots = groups.reduce((sum, group) => sum + group.lots.length, 0);
  const table = document.getElementById("holdings-body").closest("table");
  table.querySelector("thead").innerHTML = `
    <tr>
      <th>종목</th>
      <th>섹터</th>
      <th>추천/매수 묶음</th>
      <th>평균 보유가</th>
      <th>현재가</th>
      <th>통합 수익률</th>
      <th>상태</th>
      <th>다음 매도/점검</th>
      <th>링크</th>
    </tr>
  `;
  document.getElementById("holdings-meta").textContent = `종목 ${groups.length}개 | 추천 묶음 ${totalLots}개`;
  document.getElementById("holdings-body").innerHTML = groups.map((group) => `
    <tr>
      <td><strong>${group.symbol}</strong><div class="sub">${group.name}</div></td>
      <td>${group.sector}</td>
      <td>${lotList(group.lots)}</td>
      <td class="num">${money(group.averageEntry)}</td>
      <td class="num">${money(group.currentPrice)}</td>
      <td class="num ${signedClass(group.currentReturn)}">${percent(group.currentReturn)}</td>
      <td>${tag(statusLabel(group.status), group.status)}<div class="sub">남은 비중 ${number(group.totalWeight, 1)}</div></td>
      <td><strong>${formatDate(group.nextDate)}</strong><div class="sub">${group.sellDueCount ? `${group.sellDueCount}건 잔여 매도 필요` : group.extendedCount ? `${group.extendedCount}건 주봉 연장 중` : "6개월 50% 매도일 대기"}</div></td>
      <td><a href="${group.tradingViewUrl}" target="_blank" rel="noreferrer">차트</a></td>
    </tr>
  `).join("");

  document.getElementById("holdings-cards").innerHTML = groups.map((group) => `
    <article class="mobile-holding">
      <div class="card-head">
        <div>
          <h3>${group.symbol}</h3>
          <p>${group.sector} | 추천 묶음 ${group.lots.length}개</p>
        </div>
        ${tag(statusLabel(group.status), group.status)}
      </div>
      <div class="mobile-price">
        <span>평균 ${money(group.averageEntry)} → 현재 ${money(group.currentPrice)}</span>
        <strong class="${signedClass(group.currentReturn)}">${percent(group.currentReturn)}</strong>
      </div>
      ${lotList(group.lots)}
      <p class="reason"><strong>다음 점검 ${formatDate(group.nextDate)}</strong> | ${group.sellDueCount ? `${group.sellDueCount}건 잔여 매도 필요` : group.extendedCount ? `${group.extendedCount}건 주봉 연장 중` : "6개월 50% 매도일 대기"}</p>
      <div class="links">
        <a href="${group.tradingViewUrl}" target="_blank" rel="noreferrer">TradingView</a>
        <a href="${group.yahooUrl}" target="_blank" rel="noreferrer">Yahoo</a>
      </div>
    </article>
  `).join("");
}

function renderGroupedSellDue() {
  const actionRows = (dashboard.portfolio.holdings ?? []).filter((row) => (
    row.status === "sell_due" || row.status === "extended"
  ));
  const groups = groupHoldings(actionRows);
  document.getElementById("sell-due").innerHTML = groups.length
    ? groups.map((group) => `
      <article class="due-item grouped-due">
        <div>
          <strong>${group.symbol}</strong>
          <span>${group.sector} | ${group.sellDueCount ? `${group.sellDueCount}건 잔여 매도 필요` : `${group.extendedCount}건 연장 보유`}</span>
        </div>
        ${lotList(group.lots)}
        <b class="${signedClass(group.currentReturn)}">${percent(group.currentReturn)}</b>
      </article>
    `).join("")
    : `<p class="empty-state">이번 리밸런싱에서 50% 매도/연장 점검할 종목이 없습니다.</p>`;
}

function clearStatusLabel(status) {
  return {
    new: "신규 매수 후보",
    hold: "보유중",
    extended: "잔여 물량 유지중",
    sell_due: "매도 필요"
  }[status] ?? status;
}

function clearStatusTag(status) {
  return `<span class="tag ${status}">${clearStatusLabel(status)}</span>`;
}

function clearWeeklyTrendText(row) {
  const trend = row.weeklyTrend ?? {};
  if (!trend.date) return "주봉 데이터 없음";
  const state = trend.alive ? "주봉 유지" : "주봉 약화";
  return `${state} | 10W ${money(trend.ma10)} | RSI ${number(trend.rsi14, 1)}`;
}

function lotPositionWeight(row) {
  if (row.status === "new") return 0;
  if (row.status === "hold") return 1;
  return 0.5;
}

function lotStatusText(row) {
  if (row.status === "new") return "신규 매수 후보";
  if (row.status === "hold") return `보유중 | 50% 매도 예정 ${formatDate(row.halfSellDate)}`;
  if (row.status === "extended") return `50% 매도 완료 | 나머지 50% 유지중 | 최대 ${formatDate(row.maxExitDate)}`;
  if (row.status === "sell_due") return `50% 매도 완료 | 잔여 물량 매도 필요 ${formatDate(row.stopDate ?? row.maxExitDate ?? row.halfSellDate)}`;
  return row.actionLabel ?? "-";
}

function lotNextActionText(row) {
  if (row.status === "new") return `매수 기준일 ${formatDate(row.entryDate)}`;
  if (row.status === "hold") return `다음 행동: ${formatDate(row.halfSellDate)} 50% 기본 매도`;
  if (row.status === "extended") return `잔여 50%: ${clearWeeklyTrendText(row)}`;
  if (row.status === "sell_due") return `매도 사유: ${row.stopReason ?? row.remainingSellRule ?? "전략상 잔여 매도 조건 도달"}`;
  return row.remainingSellRule ?? "-";
}

function buildSymbolGroups(rows) {
  const groups = new Map();
  for (const row of rows) {
    const group = groups.get(row.symbol) ?? {
      symbol: row.symbol,
      name: row.name,
      sector: row.sector,
      currentPrice: row.currentPrice,
      tradingViewUrl: row.tradingViewUrl,
      yahooUrl: row.yahooUrl,
      lots: []
    };
    group.lots.push(row);
    if (Number.isFinite(row.currentPrice)) group.currentPrice = row.currentPrice;
    groups.set(row.symbol, group);
  }

  return Array.from(groups.values()).map((group) => {
    const lots = sortByRecentCohort(group.lots);
    const weightedLots = lots
      .map((row) => ({ row, weight: lotPositionWeight(row) }))
      .filter((item) => item.weight > 0 && Number.isFinite(item.row.entryPrice));
    const totalWeight = weightedLots.reduce((sum, item) => sum + item.weight, 0);
    const averageEntry = totalWeight
      ? weightedLots.reduce((sum, item) => sum + item.row.entryPrice * item.weight, 0) / totalWeight
      : null;
    const aggregateReturn = Number.isFinite(averageEntry) && Number.isFinite(group.currentPrice) && averageEntry
      ? group.currentPrice / averageEntry - 1
      : null;
    const status = groupStatus(lots);
    const nextDate = lots.map(actionDate).filter(Boolean).sort()[0] ?? null;
    return {
      ...group,
      lots,
      status,
      totalBuys: lots.length,
      totalWeight,
      averageEntry,
      aggregateReturn,
      nextDate,
      sellDueCount: lots.filter((row) => row.status === "sell_due").length,
      extendedCount: lots.filter((row) => row.status === "extended").length,
      holdCount: lots.filter((row) => row.status === "hold").length,
      newCount: lots.filter((row) => row.status === "new").length
    };
  }).sort((a, b) => {
    const priority = { sell_due: 0, extended: 1, hold: 2, new: 3 };
    const priorityCompare = (priority[a.status] ?? 99) - (priority[b.status] ?? 99);
    if (priorityCompare !== 0) return priorityCompare;
    return String(a.symbol).localeCompare(String(b.symbol));
  });
}

function symbolStatusSummary(group) {
  const parts = [];
  if (group.sellDueCount) parts.push(`매도 필요 ${group.sellDueCount}건`);
  if (group.extendedCount) parts.push(`나머지 물량 유지 ${group.extendedCount}건`);
  if (group.holdCount) parts.push(`보유중 ${group.holdCount}건`);
  if (group.newCount) parts.push(`신규 후보 ${group.newCount}건`);
  return parts.join(" / ") || "-";
}

function symbolLotList(lots) {
  return `<ul class="symbol-lot-list">${lots.map((row) => `
    <li class="${row.status}">
      <div class="lot-top">
        <strong>${row.cohort} 추천</strong>
        ${clearStatusTag(row.status)}
      </div>
      <div class="lot-grid">
        <span>매수일</span><b>${formatDate(row.entryDate)}</b>
        <span>매수가</span><b>${money(row.entryPrice)}</b>
        <span>현재 수익률</span><b class="${signedClass(row.currentReturn)}">${percent(row.currentReturn)}</b>
        <span>매도 상태</span><b>${lotStatusText(row)}</b>
      </div>
      <p>${lotNextActionText(row)}</p>
    </li>
  `).join("")}</ul>`;
}

function renderSymbolHoldings() {
  const groups = buildSymbolGroups(dashboard.portfolio.holdings ?? []);
  const totalLots = groups.reduce((sum, group) => sum + group.lots.length, 0);
  const table = document.getElementById("holdings-body").closest("table");
  table.querySelector("thead").innerHTML = `
    <tr>
      <th>종목</th>
      <th>종합 수익률</th>
      <th>매수 기록</th>
      <th>상태 요약</th>
      <th>다음 점검</th>
      <th>링크</th>
    </tr>
  `;
  document.getElementById("holdings-meta").textContent = `종목별 묶음 ${groups.length}개 | 전체 추천/매수 기록 ${totalLots}건`;
  document.getElementById("holdings-body").innerHTML = groups.map((group) => `
    <tr>
      <td><strong>${group.symbol}</strong><div class="sub">${group.name}</div><div class="sub">${group.sector}</div></td>
      <td class="num ${signedClass(group.aggregateReturn)}">${percent(group.aggregateReturn)}<div class="sub">평균 ${money(group.averageEntry)} → 현재 ${money(group.currentPrice)}</div></td>
      <td>${symbolLotList(group.lots)}</td>
      <td>${clearStatusTag(group.status)}<div class="sub">${symbolStatusSummary(group)}</div></td>
      <td><strong>${formatDate(group.nextDate)}</strong><div class="sub">전략상 남은 비중 ${number(group.totalWeight, 1)}</div></td>
      <td><a href="${group.tradingViewUrl}" target="_blank" rel="noreferrer">차트</a></td>
    </tr>
  `).join("");

  document.getElementById("holdings-cards").innerHTML = groups.map((group) => `
    <article class="symbol-card mobile-holding ${group.status}">
      <div class="symbol-card-head">
        <div>
          <span class="label">종목별 묶음</span>
          <h3>${group.symbol}</h3>
          <p>${group.name} | ${group.sector}</p>
        </div>
        <strong class="${signedClass(group.aggregateReturn)}">${percent(group.aggregateReturn)}</strong>
      </div>
      <div class="symbol-card-metrics">
        <span>총 ${group.totalBuys}회 매수</span>
        <span>평균 ${money(group.averageEntry)}</span>
        <span>현재 ${money(group.currentPrice)}</span>
      </div>
      <div class="symbol-card-status">
        ${clearStatusTag(group.status)}
        <span>${symbolStatusSummary(group)}</span>
      </div>
      ${symbolLotList(group.lots)}
      <div class="links">
        <a href="${group.tradingViewUrl}" target="_blank" rel="noreferrer">TradingView</a>
        <a href="${group.yahooUrl}" target="_blank" rel="noreferrer">Yahoo</a>
      </div>
    </article>
  `).join("");
}

function renderSymbolSellDue() {
  const groups = buildSymbolGroups((dashboard.portfolio.holdings ?? []).filter((row) => (
    row.status === "sell_due" || row.status === "extended"
  )));
  document.getElementById("sell-due").innerHTML = groups.length
    ? groups.map((group) => `
      <article class="due-item grouped-due">
        <div>
          <strong>${group.symbol}</strong>
          <span>${symbolStatusSummary(group)}</span>
        </div>
        ${symbolLotList(group.lots)}
        <b class="${signedClass(group.aggregateReturn)}">${percent(group.aggregateReturn)}</b>
      </article>
    `).join("")
    : `<p class="empty-state">이번 리밸런싱에서 50% 매도/연장 점검할 종목이 없습니다.</p>`;
}

function linePath(rows, valueKey, xFor, yFor) {
  return rows
    .filter((row) => Number.isFinite(row[valueKey]))
    .map((row, index) => `${index === 0 ? "M" : "L"} ${xFor(row).toFixed(1)} ${yFor(row[valueKey]).toFixed(1)}`)
    .join(" ");
}

function renderPerformanceChart() {
  const rows = dashboard.backtest.equityCurve ?? [];
  const target = document.getElementById("performance-chart");
  document.getElementById("curve-meta").textContent = rows.length
    ? `${rows[0].asOf} ~ ${rows.at(-1).asOf}`
    : "데이터 없음";
  if (rows.length < 2) {
    target.innerHTML = `<p class="empty-state">성과 곡선 데이터가 없습니다.</p>`;
    return;
  }

  const width = 920;
  const height = 320;
  const pad = { top: 18, right: 24, bottom: 38, left: 54 };
  const values = rows.flatMap((row) => [row.strategyTotalReturn, row.qqqTotalReturn]).filter(Number.isFinite);
  const min = Math.min(0, ...values);
  const max = Math.max(0.1, ...values);
  const span = max - min || 1;
  const xFor = (row) => pad.left + (rows.indexOf(row) / (rows.length - 1)) * (width - pad.left - pad.right);
  const yFor = (value) => height - pad.bottom - ((value - min) / span) * (height - pad.top - pad.bottom);
  const zeroY = yFor(0);
  const strategyPath = linePath(rows, "strategyTotalReturn", xFor, yFor);
  const qqqPath = linePath(rows, "qqqTotalReturn", xFor, yFor);
  const last = rows.at(-1);

  target.innerHTML = `
    <svg class="performance-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Strategy versus QQQ performance chart">
      <line class="axis" x1="${pad.left}" y1="${zeroY.toFixed(1)}" x2="${width - pad.right}" y2="${zeroY.toFixed(1)}"></line>
      <line class="axis" x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${height - pad.bottom}"></line>
      <text class="chart-axis" x="8" y="${(yFor(max) + 4).toFixed(1)}">${percent(max)}</text>
      <text class="chart-axis" x="8" y="${(yFor(min) + 4).toFixed(1)}">${percent(min)}</text>
      <path class="strategy-line" d="${strategyPath}"></path>
      <path class="qqq-line" d="${qqqPath}"></path>
      <text class="chart-axis" x="${pad.left}" y="${height - 12}">${rows[0].asOf.slice(0, 7)}</text>
      <text class="chart-axis" x="${width - pad.right - 52}" y="${height - 12}">${last.asOf.slice(0, 7)}</text>
    </svg>
    <div class="legend">
      <span class="strategy">전략 ${percent(last.strategyTotalReturn)}</span>
      <span class="qqq">QQQ ${percent(last.qqqTotalReturn)}</span>
    </div>
  `;
}

function showMoreLabel(showAll, visibleCount, totalCount) {
  return showAll
    ? `최근만 보기 (${visibleCount}/${totalCount})`
    : `전체 보기 (${totalCount}개)`;
}

function renderMonthlySellEvents() {
  const allRows = [...monthlySellEventRows()].reverse();
  const rows = showAllMonthlyExits ? allRows : allRows.slice(0, RECENT_MONTHLY_EXIT_LIMIT);
  const table = document.getElementById("monthly-exits-body").closest("table");
  table.querySelector("thead").innerHTML = `
    <tr>
      <th>월</th>
      <th>실제 매도 이벤트</th>
      <th>50% 기본매도</th>
      <th>잔여 매도</th>
      <th>평균 이벤트 수익률</th>
      <th>종목</th>
    </tr>
  `;
  document.getElementById("monthly-exit-meta").textContent = showAllMonthlyExits
    ? `전체 ${allRows.length}개월`
    : `최근 ${rows.length}개월 / 전체 ${allRows.length}개월`;
  document.getElementById("monthly-exits-body").innerHTML = rows.map((row) => `
    <tr>
      <td>${row.month}</td>
      <td>${row.eventCount}건<div class="sub">${(row.events ?? []).slice(0, 4).map((event) => `${event.date} ${event.symbol}`).join(" / ")}</div></td>
      <td class="num">${row.fixedCount}</td>
      <td class="num">${row.remainingCount}</td>
      <td class="num ${signedClass(row.averageEventReturn)}">${percent(row.averageEventReturn)}</td>
      <td><strong>${(row.symbols ?? []).join(", ")}</strong></td>
    </tr>
  `).join("");

  document.getElementById("monthly-exits-cards").innerHTML = rows.map((row) => `
    <article class="result-card">
      <div class="card-head">
        <div>
          <h3>${row.month} 실제 매도</h3>
          <p>총 ${row.eventCount}건 | 기본 ${row.fixedCount} / 잔여 ${row.remainingCount}</p>
        </div>
        <strong class="${signedClass(row.averageEventReturn)}">${percent(row.averageEventReturn)}</strong>
      </div>
      <ul class="event-list">${(row.events ?? []).map(eventLine).join("")}</ul>
    </article>
  `).join("");

  const button = document.getElementById("toggle-monthly-exits");
  button.hidden = allRows.length <= RECENT_MONTHLY_EXIT_LIMIT;
  button.textContent = showMoreLabel(showAllMonthlyExits, rows.length, allRows.length);
  button.onclick = () => {
    showAllMonthlyExits = !showAllMonthlyExits;
    renderMonthlySellEvents();
  };
}

function renderMonthlyExits() {
  const allRows = [...(dashboard.backtest.monthlyExits ?? [])].reverse();
  const rows = showAllMonthlyExits ? allRows : allRows.slice(0, RECENT_MONTHLY_EXIT_LIMIT);
  document.getElementById("monthly-exit-meta").textContent = showAllMonthlyExits
    ? `전체 ${allRows.length}개월`
    : `최근 ${rows.length}개월 / 전체 ${allRows.length}개월`;
  document.getElementById("monthly-exits-body").innerHTML = rows.map((row) => `
    <tr>
      <td>${row.exitMonth}</td>
      <td><strong>${row.symbols.join(", ")}</strong></td>
      <td>${row.sectors.join(", ")}</td>
      <td class="num ${signedClass(row.averageReturn)}">${percent(row.averageReturn)}</td>
      <td class="num ${signedClass(row.qqqReturn)}">${percent(row.qqqReturn)}</td>
      <td class="num ${signedClass(row.excessQqq)}">${percent(row.excessQqq)}</td>
      <td class="num">${plainPercent(row.winRate)}</td>
    </tr>
  `).join("");

  document.getElementById("monthly-exits-cards").innerHTML = rows.map((row) => `
    <article class="result-card">
      <div class="card-head">
        <div>
          <h3>${row.exitMonth} 매도</h3>
          <p>${row.symbols.join(", ")}</p>
        </div>
        <strong class="${signedClass(row.averageReturn)}">${percent(row.averageReturn)}</strong>
      </div>
      <div class="metric-line">
        <span>QQQ ${percent(row.qqqReturn)}</span>
        <span>초과 ${percent(row.excessQqq)}</span>
        <span>승률 ${plainPercent(row.winRate)}</span>
      </div>
      <p class="reason">${row.sectors.join(", ")}</p>
    </article>
  `).join("");

  const button = document.getElementById("toggle-monthly-exits");
  button.hidden = allRows.length <= RECENT_MONTHLY_EXIT_LIMIT;
  button.textContent = showMoreLabel(showAllMonthlyExits, rows.length, allRows.length);
  button.onclick = () => {
    showAllMonthlyExits = !showAllMonthlyExits;
    renderMonthlyExits();
  };
}

function renderDetailedRealizedTrades() {
  const allRows = [...(dashboard.backtest.realizedTrades ?? [])].reverse();
  const rows = showAllRealizedTrades ? allRows : allRows.slice(0, RECENT_REALIZED_TRADE_LIMIT);
  const table = document.getElementById("realized-trades-body").closest("table");
  table.querySelector("thead").innerHTML = `
    <tr>
      <th>추천월</th>
      <th>종목</th>
      <th>매수일/매수가</th>
      <th>매도 이벤트</th>
      <th>최종 청산월</th>
      <th>실현 수익률</th>
      <th>QQQ</th>
      <th>초과</th>
    </tr>
  `;
  document.getElementById("realized-trade-meta").textContent = showAllRealizedTrades
    ? `전체 ${allRows.length}개 청산 완료`
    : `최근 ${rows.length}개 / 전체 ${allRows.length}개`;
  document.getElementById("realized-trades-body").innerHTML = rows.map((row) => `
    <tr>
      <td>${row.cohort}</td>
      <td><strong>${row.symbol}</strong><div class="sub">${row.name}</div><div class="sub">${row.sector}</div></td>
      <td>${(row.buyDates ?? []).join(", ")}<div class="sub">@ ${money(row.entryPrice)}</div></td>
      <td><ul class="event-list">${tradeSellEvents(row).map(eventLine).join("")}</ul></td>
      <td>${row.exitMonth}</td>
      <td class="num ${signedClass(row.return)}">${percent(row.return)}</td>
      <td class="num ${signedClass(row.qqqReturn)}">${percent(row.qqqReturn)}</td>
      <td class="num ${signedClass(row.excessQqq)}">${percent(row.excessQqq)}</td>
    </tr>
  `).join("");

  document.getElementById("realized-trades-cards").innerHTML = rows.map((row) => `
    <article class="result-card">
      <div class="card-head">
        <div>
          <h3>${row.symbol}</h3>
          <p>${row.cohort} 추천 | 매수 ${(row.buyDates ?? []).join(", ")}</p>
        </div>
        <strong class="${signedClass(row.return)}">${percent(row.return)}</strong>
      </div>
      <div class="mobile-price">
        <span>매수가 ${money(row.entryPrice)}</span>
        <span class="${signedClass(row.excessQqq)}">QQQ 대비 ${percent(row.excessQqq)}</span>
      </div>
      <ul class="event-list">${tradeSellEvents(row).map(eventLine).join("")}</ul>
    </article>
  `).join("");

  const button = document.getElementById("toggle-realized-trades");
  button.hidden = allRows.length <= RECENT_REALIZED_TRADE_LIMIT;
  button.textContent = showMoreLabel(showAllRealizedTrades, rows.length, allRows.length);
  button.onclick = () => {
    showAllRealizedTrades = !showAllRealizedTrades;
    renderDetailedRealizedTrades();
  };
}

function renderRealizedTrades() {
  const allRows = [...(dashboard.backtest.realizedTrades ?? [])].reverse();
  const rows = showAllRealizedTrades ? allRows : allRows.slice(0, RECENT_REALIZED_TRADE_LIMIT);
  document.getElementById("realized-trade-meta").textContent = showAllRealizedTrades
    ? `전체 ${allRows.length}개 청산 완료`
    : `최근 ${rows.length}개 / 전체 ${allRows.length}개`;
  document.getElementById("realized-trades-body").innerHTML = rows.map((row) => `
    <tr>
      <td>${row.cohort}</td>
      <td>${row.exitMonth}</td>
      <td><strong>${row.symbol}</strong><div class="sub">${row.name}</div></td>
      <td>${row.sector}</td>
      <td class="num">${money(row.entryPrice)}</td>
      <td class="num">${money(row.exitPrice)}</td>
      <td>${(row.sellReasons ?? []).map(sellReasonLabel).join(" / ") || "-"}</td>
      <td class="num ${signedClass(row.return)}">${percent(row.return)}</td>
      <td class="num ${signedClass(row.qqqReturn)}">${percent(row.qqqReturn)}</td>
      <td class="num ${signedClass(row.excessQqq)}">${percent(row.excessQqq)}</td>
    </tr>
  `).join("");

  document.getElementById("realized-trades-cards").innerHTML = rows.map((row) => `
    <article class="result-card">
      <div class="card-head">
        <div>
          <h3>${row.symbol}</h3>
          <p>${row.cohort} 추천 → ${row.exitMonth} 매도</p>
        </div>
        <strong class="${signedClass(row.return)}">${percent(row.return)}</strong>
      </div>
      <div class="mobile-price">
        <span>${money(row.entryPrice)} → ${money(row.exitPrice)}</span>
        <span class="${signedClass(row.excessQqq)}">QQQ 대비 ${percent(row.excessQqq)}</span>
      </div>
      <div class="metric-line">
        <span>${row.sector}</span>
        <span>QQQ ${percent(row.qqqReturn)}</span>
      </div>
      <p class="reason">${(row.sellReasons ?? []).map(sellReasonLabel).join(" / ") || "-"}</p>
    </article>
  `).join("");

  const button = document.getElementById("toggle-realized-trades");
  button.hidden = allRows.length <= RECENT_REALIZED_TRADE_LIMIT;
  button.textContent = showMoreLabel(showAllRealizedTrades, rows.length, allRows.length);
  button.onclick = () => {
    showAllRealizedTrades = !showAllRealizedTrades;
    renderRealizedTrades();
  };
}

function renderBacktest() {
  const five = dashboard.backtest.fiveYear;
  const three = dashboard.backtest.threeYear;
  const realized = dashboard.backtest.realizedSummary ?? {};
  const account = dashboard.backtest.accountSimulation;
  document.getElementById("backtest-kpis").innerHTML = `
    <article class="kpi"><span>5년 누적수익</span><strong>${percent(five?.totalReturn)}</strong><small>QQQ ${percent(five?.qqqTotalReturn)}</small></article>
    <article class="kpi"><span>5년 CAGR</span><strong>${percent(five?.cagr)}</strong><small>연복리</small></article>
    <article class="kpi"><span>5년 MDD</span><strong class="negative">${percent(five?.maxDrawdown)}</strong><small>최대낙폭</small></article>
    <article class="kpi"><span>청산 종목 평균</span><strong class="${signedClass(realized.averageReturn)}">${percent(realized.averageReturn)}</strong><small>${realized.count ?? 0}개 청산</small></article>
    <article class="kpi"><span>청산 승률</span><strong>${plainPercent(realized.winRate)}</strong><small>3년 누적 ${percent(three?.totalReturn)}</small></article>
  `;

  if (account) {
    document.getElementById("backtest-kpis").innerHTML = `
      <article class="kpi"><span>1천만원 계좌</span><strong>${money(account.finalCapital)}</strong><small>${account.label}</small></article>
      <article class="kpi"><span>계좌 총수익률</span><strong class="${signedClass(account.totalReturn)}">${percent(account.totalReturn)}</strong><small>CAGR ${percent(account.cagr)}</small></article>
      <article class="kpi"><span>매수 실행</span><strong>${account.executedBuys}/${account.attemptedBuys}</strong><small>건너뜀 ${account.skippedBuys}</small></article>
      <article class="kpi"><span>최소 현금</span><strong>${money(account.minCash)}</strong><small>현금 부족 여부 확인</small></article>
      <article class="kpi"><span>기존 5년 전략</span><strong>${percent(five?.totalReturn)}</strong><small>QQQ ${percent(five?.qqqTotalReturn)} | 청산 ${realized.count ?? 0}개</small></article>
    `;
  }

  renderPerformanceChart();

  renderMonthlySellEvents();
  renderDetailedRealizedTrades();

  document.getElementById("yearly-body").innerHTML = (dashboard.backtest.yearly ?? []).map((row) => `
    <tr>
      <td>${row.year}</td>
      <td class="num ${signedClass(row.return)}">${percent(row.return)}</td>
      <td class="num ${signedClass(row.qqqReturn)}">${percent(row.qqqReturn)}</td>
      <td class="num ${signedClass(row.excessQqq)}">${percent(row.excessQqq)}</td>
      <td class="num">${plainPercent(row.beatQqqRate)}</td>
    </tr>
  `).join("");

  document.getElementById("report-links").innerHTML = (dashboard.backtest.reports ?? []).map((row) => `
    <a class="report-link" href="${row.href}" target="_blank" rel="noreferrer">${row.label}</a>
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
    dashboard = await fetchJson("data/strategy-dashboard.json");
    document.getElementById("meta").textContent = `${dashboard.asOf} | ${dashboard.strategy.name} | updated ${new Date(dashboard.generatedAt).toLocaleString()}`;
    renderSummary();
    renderLeaders();
    renderBuys();
    renderSymbolHoldings();
    renderSymbolSellDue();
    renderBacktest();
    setupPlanner();
    setupTabs();
  } catch (error) {
    document.getElementById("meta").textContent = error.message;
    document.querySelector("main").innerHTML = `<section class="panel"><h2>데이터 로드 실패</h2><p>${error.message}</p></section>`;
  }
}

main();
