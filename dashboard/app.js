let dashboard = null;
let koreaDashboard = null;
let selectionStrategyLab = null;
let finalStrategyValidation = null;
let scoreVariantTest = null;
let scoreAScaleTest = null;
let scoreAStrategyLab = null;
let scoreCScaleTest = null;
let scoreCStrategyLab = null;
let scoreACorrectedValidation = null;
let koreaEtfValidation = null;
let showAllMonthlyExits = false;
let showAllRealizedTrades = false;
let showAllScoreCMonthlyExits = false;
let showAllScoreCRealizedTrades = false;
let showAllKoreaEtfRebalances = false;
let showAllKoreaStockMonthlySells = false;
let showAllKoreaEtfMonthlyReturns = false;
let accountState = null;
let koreaAccountState = null;

const RECENT_MONTHLY_EXIT_LIMIT = 12;
const RECENT_REALIZED_TRADE_LIMIT = 24;
const RECENT_KOREA_REBALANCE_LIMIT = 12;
const RECENT_KOREA_STOCK_SELL_LIMIT = 12;
const RECENT_KOREA_ETF_RETURN_LIMIT = 12;
const ACCOUNT_STORAGE_KEY = "leader2AccountV1";
const KOREA_ACCOUNT_STORAGE_KEY = "leader2KoreaAccountV1";
const ACTIVE_KOREA_ETF_KEY = "kr_etf_benchmark_or_alpha_defensive";
const NAV_GROUPS = {
  today: [{ tab: "today", label: "오늘" }],
  start: [
    { tab: "us-start", label: "미국 주식" },
    { tab: "korea-stock-start", label: "한국 주식" },
    { tab: "korea-etf-start", label: "한국 ETF" }
  ],
  ops: [
    { tab: "ops", label: "미국 주식" },
    { tab: "korea-invest-stock", label: "한국 주식" },
    { tab: "korea-invest-etf", label: "한국 ETF" }
  ],
  backtest: [
    { tab: "backtest", label: "미국 주식" },
    { tab: "us-score-c-backtest", label: "미국 A·C 검증" },
    { tab: "korea-stock-backtest", label: "한국 주식" },
    { tab: "korea-etf-backtest", label: "한국 ETF" }
  ],
  account: [
    { tab: "account", label: "미국 계좌" },
    { tab: "korea-account-stock", label: "한국 주식" },
    { tab: "korea-account-etf", label: "한국 ETF" }
  ],
  rules: [{ tab: "rules", label: "전략 규칙" }]
};
const PANEL_ALIASES = {
  "korea-invest-stock": "korea-invest",
  "korea-invest-etf": "korea-invest",
  "korea-account-stock": "korea-account",
  "korea-account-etf": "korea-account"
};
const LEGACY_TAB_MAP = {
  "korea-invest": "korea-invest-stock",
  "korea-account": "korea-account-stock"
};

async function fetchJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path} 파일을 불러오지 못했습니다.`);
  return response.json();
}

async function fetchOptionalJson(path) {
  try {
    return await fetchJson(path);
  } catch {
    return null;
  }
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

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function addMonthsToDate(dateString, months) {
  const date = new Date(`${dateString}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return dateString;
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

function id(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  if (scoreAScaleTest) return monthlySellEventRowsFromTrades(scoreATradeRows());
  const generated = dashboard.backtest.monthlySellEvents ?? [];
  if (generated.length) return generated;

  return monthlySellEventRowsFromTrades(dashboard.backtest.realizedTrades ?? []);
}

function monthlySellEventRowsFromTrades(trades) {
  const groups = new Map();
  for (const trade of trades ?? []) {
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
    averageEventReturn: row.returnWeight > 0
      ? row.weightedReturnSum / row.returnWeight
      : null,
    events: row.events.sort((a, b) => String(a.date).localeCompare(String(b.date)))
  })).sort((a, b) => String(a.month).localeCompare(String(b.month)));
}

const plannerModes = {
  ramp: {
    label: "공식 Cap27.5",
    capPct: 0.275,
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

const aiHardwareSymbols = new Set([
  "NVDA", "AMD", "AVGO", "ARM", "MU", "ASML", "TSM", "SMH", "SOXX",
  "WDC", "STX", "DELL", "HPE", "ANET", "VRT", "SMCI", "MRVL", "LRCX",
  "KLAC", "AMAT", "TER", "MPWR", "ON", "QCOM", "INTC", "SNDK"
]);

const aiHardwareSectors = new Set([
  "Semiconductors",
  "Electronic Components",
  "Computer Peripheral Equipment",
  "Computer Communications Equipment"
]);

const defensiveOrWeakSectors = new Set([
  "Real Estate",
  "Consumer Staples",
  "Utilities"
]);

const fallbackFxRate = 1380;
const officialUsStrategyName = "Leader2 + Repeat Theme Combo Cap27.5";

function krw(value) {
  if (!Number.isFinite(value)) return "-";
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

function parseAmount(value) {
  const numeric = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatIntegerInput(input) {
  const value = parseAmount(input.value);
  input.value = value ? Math.round(value).toLocaleString("ko-KR") : "";
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

function defaultAccount() {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    settings: {
      startMonth: "",
      capital: 10_000_000,
      cash: 10_000_000,
      fxRate: fallbackFxRate,
      mode: "ramp",
      shareMode: "whole"
    },
    lots: [],
    ledger: []
  };
}

function loadAccount() {
  try {
    const raw = localStorage.getItem(ACCOUNT_STORAGE_KEY);
    if (!raw) return defaultAccount();
    const parsed = JSON.parse(raw);
    return {
      ...defaultAccount(),
      ...parsed,
      settings: { ...defaultAccount().settings, ...(parsed.settings ?? {}) },
      lots: Array.isArray(parsed.lots) ? parsed.lots : [],
      ledger: Array.isArray(parsed.ledger) ? parsed.ledger : []
    };
  } catch {
    return defaultAccount();
  }
}

function saveAccount() {
  if (!accountState) return;
  accountState.updatedAt = new Date().toISOString();
  localStorage.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify(accountState));
}

function priceLookup() {
  const map = new Map();
  for (const row of dashboard.currentBuys ?? []) {
    if (Number.isFinite(row.close)) map.set(row.symbol, row.close);
  }
  for (const row of dashboard.portfolio?.holdings ?? []) {
    if (Number.isFinite(row.currentPrice)) map.set(row.symbol, row.currentPrice);
  }
  return map;
}

function lotRemainingShares(lot) {
  const sold = (lot.sells ?? []).reduce((sum, row) => sum + (Number(row.shares) || 0), 0);
  return Math.max(0, (Number(lot.shares) || 0) - sold);
}

function lotStatus(lot) {
  if (lot.status === "closed" || lotRemainingShares(lot) <= 0) return "closed";
  const today = todayDate();
  if (!lot.soldHalf && today >= lot.halfSellDate) return "half_due";
  if (lot.soldHalf && today >= lot.maxExitDate) return "final_due";
  if (lot.soldHalf) return "extended";
  return "hold";
}

function lotStatusLabel(status) {
  return {
    hold: "보유중",
    half_due: "50% 매도 필요",
    extended: "잔여 50% 연장중",
    final_due: "잔여 매도 필요",
    closed: "매도 완료"
  }[status] ?? status;
}

function accountTotals() {
  const prices = priceLookup();
  const fxRate = accountState?.settings?.fxRate || fallbackFxRate;
  const openLots = (accountState?.lots ?? []).filter((lot) => lotStatus(lot) !== "closed");
  const marketValue = openLots.reduce((sum, lot) => {
    const currentPrice = prices.get(lot.symbol) ?? lot.buyPriceUsd;
    return sum + lotRemainingShares(lot) * currentPrice * fxRate;
  }, 0);
  const cost = openLots.reduce((sum, lot) => {
    const remainingRatio = lot.shares ? lotRemainingShares(lot) / lot.shares : 0;
    return sum + lot.investedKrw * remainingRatio;
  }, 0);
  const realized = (accountState?.ledger ?? [])
    .filter((row) => row.type === "sell")
    .reduce((sum, row) => sum + (Number(row.realizedKrw) || 0), 0);
  const cash = Number(accountState?.settings?.cash) || 0;
  return {
    cash,
    openCount: openLots.length,
    marketValue,
    cost,
    equity: cash + marketValue,
    unrealized: marketValue - cost,
    realized
  };
}

function applyPlannerSettingsToForm() {
  if (!accountState) return;
  const settings = accountState.settings;
  const currentMonth = monthKeyFromDate(dashboard?.asOf);
  const startMonth = document.getElementById("planner-start-month");
  const capital = document.getElementById("planner-capital");
  const cash = document.getElementById("planner-cash");
  const fx = document.getElementById("planner-fx");
  const mode = document.getElementById("planner-mode");
  const shareMode = document.getElementById("planner-share-mode");
  if (startMonth) startMonth.value = settings.startMonth || currentMonth;
  if (capital) capital.value = Math.round(settings.capital || 0).toLocaleString("ko-KR");
  if (cash) cash.value = Math.round(settings.cash || 0).toLocaleString("ko-KR");
  if (fx) fx.value = Math.round(settings.fxRate || fallbackFxRate).toLocaleString("ko-KR");
  if (mode) mode.value = settings.mode || "ramp";
  if (shareMode) shareMode.value = settings.shareMode || "whole";
}

function persistPlannerSettings() {
  if (!accountState) return;
  accountState.settings = {
    ...accountState.settings,
    startMonth: document.getElementById("planner-start-month")?.value || accountState.settings.startMonth,
    capital: Math.max(0, parseAmount(document.getElementById("planner-capital")?.value)),
    cash: Math.max(0, parseAmount(document.getElementById("planner-cash")?.value)),
    fxRate: Math.max(0, parseAmount(document.getElementById("planner-fx")?.value) || fallbackFxRate),
    mode: document.getElementById("planner-mode")?.value || accountState.settings.mode,
    shareMode: document.getElementById("planner-share-mode")?.value || accountState.settings.shareMode
  };
  saveAccount();
}

function recordPlannedBuy(symbol) {
  const plan = buildPlannerPlan();
  const row = plan.buys.find((item) => item.symbol === symbol);
  if (!row || row.action !== "buy") return;
  const defaultShares = plan.shareMode === "fractional" ? row.shares.toFixed(4) : String(Math.floor(row.shares));
  const shares = Number(window.prompt(`${symbol} 매수 수량`, defaultShares));
  if (!Number.isFinite(shares) || shares <= 0) return;
  const buyPriceUsd = Number(window.prompt(`${symbol} 실제 매수가($)`, String(row.close)));
  if (!Number.isFinite(buyPriceUsd) || buyPriceUsd <= 0) return;
  const fxRate = Number(window.prompt("실제 적용 환율", String(plan.fxRate)));
  if (!Number.isFinite(fxRate) || fxRate <= 0) return;
  const buyDate = window.prompt("매수일", todayDate()) || todayDate();
  const investedUsd = shares * buyPriceUsd;
  const investedKrw = investedUsd * fxRate;
  const lot = {
    id: id("lot"),
    symbol: row.symbol,
    name: row.name,
    sector: row.sector,
    cohort: plan.currentMonth,
    signalDate: dashboard.asOf,
    buyDate,
    shares,
    buyPriceUsd,
    fxRate,
    investedUsd,
    investedKrw,
    soldHalf: false,
    status: "open",
    halfSellDate: addMonthsToDate(buyDate, 6),
    maxExitDate: addMonthsToDate(buyDate, 12),
    sells: []
  };
  accountState.lots.unshift(lot);
  accountState.settings.cash = Math.max(0, (accountState.settings.cash || 0) - investedKrw);
  accountState.ledger.unshift({
    id: id("ledger"),
    type: "buy",
    date: buyDate,
    symbol: row.symbol,
    amountKrw: investedKrw,
    amountUsd: investedUsd,
    note: `${shares}주 @ ${usd(buyPriceUsd)}`
  });
  saveAccount();
  applyPlannerSettingsToForm();
  renderPlanner();
  renderAccount();
}

function recordLotSell(lotId, mode) {
  const lot = accountState.lots.find((row) => row.id === lotId);
  if (!lot) return;
  const remaining = lotRemainingShares(lot);
  if (remaining <= 0) return;
  const defaultShares = mode === "half" ? Math.min(remaining, lot.shares / 2) : remaining;
  const shares = Number(window.prompt(`${lot.symbol} 매도 수량`, String(Number(defaultShares.toFixed(4)))));
  if (!Number.isFinite(shares) || shares <= 0 || shares > remaining) return;
  const sellPriceUsd = Number(window.prompt(`${lot.symbol} 실제 매도가($)`, String(lot.buyPriceUsd)));
  if (!Number.isFinite(sellPriceUsd) || sellPriceUsd <= 0) return;
  const fxRate = Number(window.prompt("실제 적용 환율", String(accountState.settings.fxRate || fallbackFxRate)));
  if (!Number.isFinite(fxRate) || fxRate <= 0) return;
  const sellDate = window.prompt("매도일", todayDate()) || todayDate();
  const proceedsUsd = shares * sellPriceUsd;
  const proceedsKrw = proceedsUsd * fxRate;
  const costBasisKrw = lot.investedKrw * (shares / lot.shares);
  const realizedKrw = proceedsKrw - costBasisKrw;
  lot.sells = lot.sells ?? [];
  lot.sells.push({ date: sellDate, shares, sellPriceUsd, fxRate, proceedsUsd, proceedsKrw, realizedKrw });
  if (mode === "half") lot.soldHalf = true;
  if (lotRemainingShares(lot) <= 0.000001) lot.status = "closed";
  accountState.settings.cash = (accountState.settings.cash || 0) + proceedsKrw;
  accountState.ledger.unshift({
    id: id("ledger"),
    type: "sell",
    date: sellDate,
    symbol: lot.symbol,
    amountKrw: proceedsKrw,
    amountUsd: proceedsUsd,
    realizedKrw,
    note: `${shares}주 @ ${usd(sellPriceUsd)}`
  });
  saveAccount();
  applyPlannerSettingsToForm();
  renderPlanner();
  renderAccount();
}

function renderAccount() {
  if (!accountState) return;
  const totals = accountTotals();
  const summary = document.getElementById("account-summary");
  if (summary) {
    summary.innerHTML = `
      <article class="kpi"><span>총 자산</span><strong>${krw(totals.equity)}</strong><small>현금 + 평가금액</small></article>
      <article class="kpi"><span>현금</span><strong>${krw(totals.cash)}</strong><small>다음 매수 가능 금액</small></article>
      <article class="kpi"><span>평가금액</span><strong>${krw(totals.marketValue)}</strong><small>${totals.openCount}개 lot 보유</small></article>
      <article class="kpi"><span>미실현 손익</span><strong class="${signedClass(totals.unrealized)}">${krw(totals.unrealized)}</strong><small>현재가 기준 추정</small></article>
      <article class="kpi"><span>실현 손익</span><strong class="${signedClass(totals.realized)}">${krw(totals.realized)}</strong><small>매도 기록 기준</small></article>
    `;
  }

  const actions = [];
  for (const lot of accountState.lots) {
    const status = lotStatus(lot);
    if (status === "half_due") actions.push({ lot, text: `${lot.symbol} 50% 매도 필요`, date: lot.halfSellDate, action: "half" });
    if (status === "final_due") actions.push({ lot, text: `${lot.symbol} 잔여 물량 매도 필요`, date: lot.maxExitDate, action: "full" });
  }
  const actionTarget = document.getElementById("account-actions");
  if (actionTarget) {
    actionTarget.innerHTML = actions.length ? actions.map(({ lot, text, date, action }) => `
      <article class="account-card urgent">
        <div><strong>${text}</strong><span>${date} 예정 | ${lot.cohort} 추천</span></div>
        <button class="secondary-button" data-sell-lot="${lot.id}" data-sell-mode="${action}" type="button">${action === "half" ? "50% 매도 기록" : "잔여 매도 기록"}</button>
      </article>
    `).join("") : `<p class="empty-state">오늘 당장 처리할 매도 알림은 없습니다.</p>`;
  }

  const prices = priceLookup();
  const lots = document.getElementById("account-lots");
  if (lots) {
    const openLots = accountState.lots.filter((lot) => lotStatus(lot) !== "closed");
    document.getElementById("account-lots-meta").textContent = `${openLots.length}개 lot`;
    lots.innerHTML = openLots.length ? openLots.map((lot) => {
      const status = lotStatus(lot);
      const currentPrice = prices.get(lot.symbol) ?? lot.buyPriceUsd;
      const remaining = lotRemainingShares(lot);
      const currentValue = remaining * currentPrice * (accountState.settings.fxRate || fallbackFxRate);
      const remainingCost = lot.investedKrw * (remaining / lot.shares);
      const ret = remainingCost ? currentValue / remainingCost - 1 : 0;
      return `
        <article class="account-card">
          <div>
            <strong>${lot.symbol} ${remaining.toFixed(4)}주</strong>
            <span>${lot.name} | ${lot.cohort} 추천 | ${lotStatusLabel(status)}</span>
          </div>
          <div class="account-card-metrics">
            <span>매수 ${formatDate(lot.buyDate)} @ ${usd(lot.buyPriceUsd)}</span>
            <span class="${signedClass(ret)}">현재 ${percent(ret)} | ${krw(currentValue)}</span>
            <span>50% 매도 ${lot.halfSellDate} | 최대 ${lot.maxExitDate}</span>
          </div>
          <div class="account-card-actions">
            ${!lot.soldHalf ? `<button class="secondary-button" data-sell-lot="${lot.id}" data-sell-mode="half" type="button">50% 매도 기록</button>` : ""}
            <button class="secondary-button" data-sell-lot="${lot.id}" data-sell-mode="full" type="button">잔여 매도 기록</button>
          </div>
        </article>
      `;
    }).join("") : `<p class="empty-state">아직 기록된 보유 lot이 없습니다. 투자 시작 탭에서 매수 기록을 남겨보세요.</p>`;
  }

  const ledger = document.getElementById("account-ledger");
  if (ledger) {
    ledger.innerHTML = accountState.ledger.length ? accountState.ledger.slice(0, 30).map((row) => `
      <article class="account-card">
        <div>
          <strong>${row.date} ${row.type}</strong>
          <span>${row.symbol ?? ""} ${row.note ?? ""}</span>
        </div>
        <b class="${signedClass(row.type === "withdrawal" ? -row.amountKrw : row.amountKrw)}">${krw(row.amountKrw)}</b>
      </article>
    `).join("") : `<p class="empty-state">아직 거래 기록이 없습니다.</p>`;
  }
}

function setupAccount() {
  accountState = loadAccount();
  const cashDate = document.getElementById("cash-flow-date");
  if (cashDate && !cashDate.value) cashDate.value = todayDate();
  document.addEventListener("click", (event) => {
    const buyButton = event.target.closest("[data-record-buy]");
    if (buyButton) recordPlannedBuy(buyButton.dataset.recordBuy);
    const sellButton = event.target.closest("[data-sell-lot]");
    if (sellButton) recordLotSell(sellButton.dataset.sellLot, sellButton.dataset.sellMode);
  });
  document.getElementById("cash-flow-save")?.addEventListener("click", () => {
    const type = document.getElementById("cash-flow-type")?.value ?? "deposit";
    const amount = Math.max(0, parseAmount(document.getElementById("cash-flow-amount")?.value));
    if (!amount) return;
    const date = document.getElementById("cash-flow-date")?.value || todayDate();
    const note = document.getElementById("cash-flow-note")?.value || "";
    accountState.settings.cash = type === "deposit"
      ? (accountState.settings.cash || 0) + amount
      : Math.max(0, (accountState.settings.cash || 0) - amount);
    accountState.ledger.unshift({ id: id("ledger"), type, date, amountKrw: amount, note });
    saveAccount();
    applyPlannerSettingsToForm();
    renderPlanner();
    renderAccount();
  });
  document.getElementById("account-export")?.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(accountState, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `leader2-account-${todayDate()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  });
  document.getElementById("account-import")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const imported = JSON.parse(await file.text());
    accountState = { ...defaultAccount(), ...imported };
    saveAccount();
    applyPlannerSettingsToForm();
    renderPlanner();
    renderAccount();
  });
  document.getElementById("account-reset")?.addEventListener("click", () => {
    if (!window.confirm("이 브라우저에 저장된 내 계좌 기록을 초기화할까요?")) return;
    accountState = defaultAccount();
    saveAccount();
    applyPlannerSettingsToForm();
    renderPlanner();
    renderAccount();
  });
  renderAccount();
}

function plannedBuyAmount(mode, capital, cash, monthsSinceStart) {
  if (mode === plannerModes.ramp) {
    if (monthsSinceStart < mode.rampMonths && cash >= capital * mode.highCashPct) {
      return { amount: capital * mode.rampPct, reason: "공식 Cap27.5 초기 램프업: 현금이 충분해 기본 10%에서 신호 가중 적용" };
    }
    if (cash <= capital * mode.lowCashPct) {
      return { amount: capital * mode.defensivePct, reason: "공식 Cap27.5 현금 방어: 기본 5%에서 신호 가중 적용" };
    }
  }
  return { amount: capital * mode.normalPct, reason: `${mode.label} 기본 비중` };
}

function repeatThemeContext(row) {
  const recent = finalStrategyValidation?.recentSelections?.leader2 ?? [];
  const prior = recent.filter((item) => item.entryDate < (dashboard?.asOf ?? "9999-99-99"));
  const previousSymbolSignals12m = prior.filter((item) => (item.symbols ?? []).includes(row.symbol)).length;
  const previousSectorSignals6m = prior.filter((item) => (item.groups ?? []).includes(row.sector)).length;
  const isAiHardware = aiHardwareSymbols.has(row.symbol) || aiHardwareSectors.has(row.sector);
  return { previousSymbolSignals12m, previousSectorSignals6m, isAiHardware };
}

function repeatThemeMultiplier(row) {
  const context = repeatThemeContext(row);
  let multiplier = 1;
  const reasons = [];
  if (context.previousSymbolSignals12m >= 2) {
    multiplier *= 1.45;
    reasons.push("최근 12개월 반복 추천 2회 이상");
  } else if (context.previousSymbolSignals12m >= 1) {
    multiplier *= 1.25;
    reasons.push("최근 12개월 반복 추천");
  }
  if (context.isAiHardware) {
    multiplier *= 1.25;
    reasons.push("AI/반도체 하드웨어 테마");
  }
  if (defensiveOrWeakSectors.has(row.sector)) {
    multiplier *= 0.85;
    reasons.push("방어/약세 섹터 감액");
  }
  return {
    multiplier: Math.min(multiplier, 1.85),
    context,
    reasons: reasons.length ? reasons : ["기본 Leader2 후보"]
  };
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
    const tilt = mode === plannerModes.ramp
      ? repeatThemeMultiplier(row)
      : { multiplier: 1, reasons: [mode.label] };
    const wanted = planned.amount * tilt.multiplier;
    const deployableCash = Math.max(0, cash - reserve);
    const budget = Math.min(wanted, capAmount, deployableCash);
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
      reason,
      multiplier: tilt.multiplier,
      signalReasons: tilt.reasons,
      previousSymbolSignals12m: tilt.context?.previousSymbolSignals12m ?? 0,
      previousSectorSignals6m: tilt.context?.previousSectorSignals6m ?? 0
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
      <p>${row.reason} | 가중 ${row.multiplier?.toFixed(2) ?? "1.00"}x (${row.signalReasons?.join(", ")})</p>
      <small>예상 주문: ${plan.shareMode === "fractional" ? row.shares.toFixed(4) : Math.floor(row.shares)}주 @ ${usd(row.close)} | 예산 ${krw(row.budget)} | 종목 한도 ${krw(row.capAmount)} | 반복 ${row.previousSymbolSignals12m}회 / 섹터 반복 ${row.previousSectorSignals6m}회</small>
      ${row.action === "buy" ? `<button class="secondary-button" data-record-buy="${row.symbol}" type="button">매수 기록</button>` : ""}
    </article>
  `).join("");

  document.getElementById("planner-weekly").innerHTML = `
    <ol class="flow-list">
      <li><strong>월초/현재:</strong> ${plan.currentMonth} Leader2 후보 2개를 확인합니다. 월중 데이터는 관찰 후보이며, 실제 매수 기준은 월말 확정 신호입니다.</li>
      <li><strong>매수 금액:</strong> 공식 Cap27.5는 기본 금액에 반복 추천, AI/반도체 하드웨어 신호를 가중하고 종목당 원금 한도를 27.5%로 제한합니다.</li>
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
      <li><strong>공식 전략:</strong> 종목 선정은 Leader2 One Each, 자금 배분은 Repeat + Theme Combo Cap27.5를 사용합니다.</li>
      <li><strong>현금 부족:</strong> 반복/테마 가중 후에도 최소 주문금액보다 작으면 대기하고, 다음 월 후보에서 다시 계산합니다.</li>
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
      persistPlannerSettings();
      renderPlanner();
      renderAccount();
    }
  } catch {
    input.value = Math.round(parseAmount(input.value) || fallbackFxRate).toLocaleString("ko-KR");
    persistPlannerSettings();
  }
}

function setupPlanner() {
  const form = document.getElementById("investment-planner-form");
  if (!form) return;
  applyPlannerSettingsToForm();
  ["planner-capital", "planner-cash", "planner-fx"].forEach((id) => {
    const input = document.getElementById(id);
    if (!input) return;
    formatIntegerInput(input);
    input.addEventListener("blur", () => {
      formatIntegerInput(input);
      persistPlannerSettings();
      renderPlanner();
      renderAccount();
    });
  });
  form.addEventListener("input", () => {
    persistPlannerSettings();
    renderPlanner();
    renderAccount();
  });
  form.addEventListener("change", () => {
    persistPlannerSettings();
    renderPlanner();
    renderAccount();
  });
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

function simplePickList(rows, type = "stock") {
  if (!rows?.length) return `<p class="empty-state">현재 표시할 후보가 없습니다.</p>`;
  return `
    <div class="template-picks">
      ${rows.slice(0, 4).map((row) => `
        <article>
          <strong>${row.symbol}</strong>
          <span>${row.name ?? row.sector ?? row.group ?? ""}</span>
          <small>${row.sector ?? row.group ?? "후보"}${Number.isFinite(row.weight) ? ` | 목표 ${weightText(row.weight)}` : ""}${Number.isFinite(row.score) ? ` | 점수 ${number(row.score, 1)}` : ""}</small>
        </article>
      `).join("")}
    </div>
  `;
}

function templateMetric(label, value, className = "") {
  return `
    <div>
      <span>${label}</span>
      <strong class="${className}">${value}</strong>
    </div>
  `;
}

function buildStrategyCatalog() {
  const usDue = (dashboard?.portfolio?.holdings ?? []).filter((row) => row.status === "sell_due").length;
  const usExtended = (dashboard?.portfolio?.holdings ?? []).filter((row) => row.status === "extended").length;
  const usAccount = dashboard?.backtest?.accountSimulation;
  const usFive = dashboard?.backtest?.fiveYear;
  const usCurve = dashboard?.backtest?.equityCurve ?? [];
  const usLastCurve = usCurve.at(-1) ?? {};
  const correctedUsAccount = scoreAAccountResult();
  const correctedUsSummary = scoreAScaleSummary();
  const correctedUsCurve = scoreACurveRows();
  const correctedUsLastCurve = correctedUsCurve.at(-1) ?? {};
  const stock = koreaStrategyByKey("kr_stocks");
  const etf = activeKoreaEtfStrategy();
  const stockAccount = stock?.capitalAccount ?? {};
  const etfAccount = etf?.capitalAccount ?? {};
  const stockRows = koreaStockPerformanceRows();
  const etfRows = koreaEtfPerformanceRows();
  const officialUs = finalStrategyValidation?.practicalWinner;

  const catalog = [
    {
      id: "us_leader_monthly_v1",
      assetClass: "us_stock",
      market: "US",
      asset: "미국 주식",
      title: "Leader2 + Repeat Theme Cap27.5",
      status: "active",
      statusLabel: usDue > 0 ? "매도 점검" : "매수 후보",
      statusTone: usDue > 0 ? "warning" : "buy",
      currency: "USD",
      tone: "us",
      accountLabel: "공격형 성장 계좌 | 공식 Cap27.5",
      type: "stock",
      benchmark: { symbol: "QQQ", label: "QQQ" },
      today: {
        summary: `${dashboard?.currentBuys?.length ?? 0}개 신규 후보`,
        detail: `Leader2로 종목을 고르고 Cap27.5로 금액을 정합니다. 매도 점검 ${usDue}건, 연장 보유 ${usExtended}건.`,
        primaryAction: "미국 매수 가이드 보기"
      },
      rules: {
        buy: ["월말 주도 섹터 상위 2곳에서 각 1개", "반복 추천/AI 하드웨어 후보는 매수 금액 가중", "종목당 원금 한도 27.5%"],
        sell: ["6개월 50% 매도", "잔여 50% 주봉 연장"],
        rebalance: [],
        checkCycle: "월말 확정, 매주 보유 점검"
      },
      currentPicks: dashboard?.currentBuys ?? [],
      backtest: {
        period: {
          start: correctedUsCurve[0]?.asOf ?? usCurve[0]?.asOf,
          end: correctedUsLastCurve.asOf ?? usLastCurve.asOf
        },
        metrics: {
          strategyReturn: correctedUsAccount?.totalReturn ?? officialUs?.totalReturn ?? usAccount?.totalReturn ?? usFive?.totalReturn,
          benchmarkReturn: correctedUsAccount?.benchmark?.totalReturn ?? correctedUsLastCurve.qqqTotalReturn ?? usLastCurve.qqqTotalReturn ?? usFive?.qqqTotalReturn,
          maxDrawdown: correctedUsAccount?.maxDrawdown ?? usFive?.maxDrawdown,
          winRate: correctedUsSummary?.winRate ?? dashboard?.backtest?.realizedSummary?.winRate,
          tradeCount: correctedUsAccount?.executedBuys ?? officialUs?.executedBuys ?? usAccount?.executedBuys ?? dashboard?.backtest?.realizedSummary?.count
        },
        equityCurve: correctedUsCurve.length ? correctedUsCurve : usCurve
      },
      tabs: { start: "us-start", operations: "ops", backtest: "backtest", account: "account" }
    },
    {
      id: "kr_stock_leader2_v1",
      assetClass: "kr_stock",
      market: "KR",
      asset: "한국 주식",
      title: "한국 우량주 Leader2",
      status: "active",
      statusLabel: "매수 후보",
      statusTone: "buy",
      currency: "KRW",
      tone: "kr-stock",
      accountLabel: "일반 계좌 공격형 | 월 2개 후보",
      type: "stock",
      benchmark: { symbol: stock?.benchmarkSymbol, label: benchmarkLabel(stock?.benchmarkSymbol) },
      today: {
        summary: `${stock?.currentPicks?.length ?? 0}개 신규 후보`,
        detail: "우량주 유니버스에서 주도 업종별 대표 종목을 확인합니다.",
        primaryAction: "한국 주식 후보 보기"
      },
      rules: {
        buy: ["월말 주도 업종 상위 2곳에서 각 1개"],
        sell: ["6개월 50% 매도", "잔여 50% 주봉 연장"],
        rebalance: [],
        checkCycle: "월말 확정, 매주 보유 점검"
      },
      currentPicks: stock?.currentPicks ?? [],
      backtest: {
        period: {
          start: stockRows[0]?.asOf ?? stockRows[0]?.month,
          end: stockRows.at(-1)?.asOf ?? stockRows.at(-1)?.month
        },
        metrics: {
          strategyReturn: stockAccount.totalReturn,
          benchmarkReturn: lastFiniteReturn(stockRows, "benchmarkTotalReturn"),
          maxDrawdown: stockAccount.maxDrawdown,
          winRate: stock?.summary?.winRate,
          tradeCount: stock?.summary?.tradeCount
        },
        equityCurve: stockRows
      },
      tabs: { start: "korea-stock-start", operations: "korea-invest-stock", backtest: "korea-stock-backtest", account: "korea-account-stock" }
    },
    {
      id: "kr_etf_benchmark_or_alpha_defensive_v1",
      assetClass: "kr_etf",
      market: "KR",
      asset: "한국 ETF",
      title: "ETF-I 주도·방어 1개",
      status: "active",
      statusLabel: "리밸런싱",
      statusTone: "rebalance",
      currency: "KRW",
      tone: "kr-etf",
      accountLabel: "연금/ETF 계좌 | 월간 리밸런싱",
      type: "etf",
      benchmark: { symbol: etf?.benchmarkSymbol, label: benchmarkLabel(etf?.benchmarkSymbol) },
      today: {
        summary: `${etf?.currentPicks?.length ?? 0}개 목표 ETF`,
        detail: "강한 장세에는 최상위 알파 ETF, 약한 장세에는 방어 ETF 1개로 월간 교체합니다.",
        primaryAction: "ETF 리밸런싱 보기"
      },
      rules: {
        buy: ["월말 시장 상태에 따라 주도 또는 방어 ETF 1개 선정"],
        sell: ["별도 6개월 매도 없음"],
        rebalance: ["매월 전체 계좌를 선정 ETF 100% 목표로 조정"],
        checkCycle: "월 1회 리밸런싱"
      },
      currentPicks: etf?.currentPicks ?? [],
      backtest: {
        period: {
          start: etfRows[0]?.asOf ?? etfRows[0]?.month,
          end: etfRows.at(-1)?.asOf ?? etfRows.at(-1)?.month
        },
        metrics: {
          strategyReturn: etfAccount.totalReturn,
          benchmarkReturn: lastFiniteReturn(etfRows, "benchmarkTotalReturn"),
          maxDrawdown: etfAccount.maxDrawdown,
          winRate: null,
          tradeCount: etf?.summary?.tradeCount
        },
        equityCurve: etfRows
      },
      tabs: { start: "korea-etf-start", operations: "korea-invest-etf", backtest: "korea-etf-backtest", account: "korea-account-etf" }
    }
  ];
  const bestSelectionRule = selectionStrategyLab?.rankings?.all6m?.[0];
  const convictionFinal = finalStrategyValidation?.accountRows?.find((row) => (
    row.selectionEngine === "Conviction Diverse Top2" && row.key === "repeat_theme_combo"
  ));
  const finalWinner = finalStrategyValidation?.finalWinner;
  const finalRecent = finalStrategyValidation?.recentSelections?.conviction?.at?.(-1);
  const bestDetail = finalRecent
    ? { symbols: finalRecent.symbols, sectors: finalRecent.groups }
    : bestSelectionRule?.latestSelection;
  if (bestSelectionRule) {
    catalog.push({
      id: "us_conviction_diverse_top2_candidate",
      assetClass: "us_stock",
      market: "US",
      asset: "미국 주식",
      title: bestSelectionRule.label,
      status: "testing",
      statusLabel: "테스트 중",
      statusTone: "warning",
      currency: "USD",
      tone: "us testing",
      accountLabel: "선정 규칙 후보 | 저장된 Top20 안에서 월 2개 선택",
      type: "stock",
      benchmark: { symbol: "LEADER2_BEST", label: "Leader2 1등" },
      today: {
        summary: convictionFinal
          ? `완성 계좌 ${percent(convictionFinal.totalReturn)}`
          : `6개월 평균 ${percent(bestSelectionRule.horizons?.["6m"]?.averageReturn)}`,
        detail: convictionFinal && finalWinner
          ? `월별 선정력은 좋았지만 Leader2 1등 ${percent(finalWinner.totalReturn)}보다 낮아 active 보류입니다.`
          : `QQQ 평균 초과 ${percent(bestSelectionRule.horizons?.["6m"]?.averageExcessQqq)}. 아직 완성 매도 규칙 검증 전 후보입니다.`,
        primaryAction: "검증 리포트 보기"
      },
      rules: {
        buy: ["점수, 반복 추천, 반복 섹터, AI/반도체, 눌림 재가속을 합산해 서로 다른 섹터 2개 선택"],
        sell: ["기존 Leader2 매도 규칙 연결 전"],
        rebalance: [],
        checkCycle: "testing: 계좌 시뮬레이션 필요"
      },
      currentPicks: (bestDetail?.symbols ?? []).map((symbol, index) => ({
        symbol,
        name: symbol,
        sector: bestDetail?.sectors?.[index] ?? "후보"
      })),
      backtest: {
        period: {
          start: selectionStrategyLab.sourceGeneratedAt,
          end: selectionStrategyLab.generatedAt
        },
        metrics: {
          strategyReturn: convictionFinal?.totalReturn ?? bestSelectionRule.horizons?.["6m"]?.averageReturn,
          benchmarkReturn: finalWinner?.totalReturn ?? bestSelectionRule.horizons?.["6m"]?.averageReturn - bestSelectionRule.horizons?.["6m"]?.averageExcessQqq,
          maxDrawdown: convictionFinal?.maxDrawdown ?? null,
          winRate: bestSelectionRule.horizons?.["6m"]?.beatQqqRate,
          tradeCount: convictionFinal?.executedBuys ?? bestSelectionRule.activePeriods
        },
        equityCurve: []
      },
      reportUrl: "final_strategy_validation.md",
      tabs: { start: "rules", operations: "rules", backtest: "rules", account: "rules" }
    });
  }
  return catalog;
}

function strategyTemplateCard(template) {
  return `
    <article class="strategy-template-card ${template.tone}">
      <div class="template-card-head">
        <div>
          <span class="asset-badge">${template.asset}</span>
          <h3>${template.title}</h3>
          <p>${template.account}</p>
        </div>
        <strong class="${signedClass(template.returnValue)}">${template.returnText}</strong>
      </div>
      <div class="template-action">
        <span class="action-badge ${template.statusTone}">${template.statusLabel}</span>
        <strong>${template.today}</strong>
        <p>${template.todayDetail}</p>
      </div>
      ${simplePickList(template.picks, template.type)}
      <div class="template-rule-grid">
        ${templateMetric("매수 기준", template.buyRule)}
        ${templateMetric("매도 기준", template.sellRule)}
        ${templateMetric("점검 주기", template.checkCycle)}
        ${templateMetric("비교 기준", template.benchmark)}
      </div>
      <div class="template-foot">
        <span>MDD ${template.mddText}</span>
        <button class="secondary-button" data-go-tab="${template.detailTab}" type="button">${template.detailButton}</button>
      </div>
    </article>
  `;
}

function buildStrategyTemplates() {
  return buildStrategyCatalog().filter((strategy) => strategy.status === "active").map((strategy) => ({
    asset: strategy.asset,
    title: strategy.title,
    account: strategy.accountLabel,
    type: strategy.type,
    tone: strategy.tone,
    statusLabel: strategy.statusLabel,
    statusTone: strategy.statusTone,
    today: strategy.today.summary,
    todayDetail: strategy.today.detail,
    picks: strategy.currentPicks,
    buyRule: strategy.rules.buy[0] ?? "-",
    sellRule: strategy.rules.rebalance[0] ?? strategy.rules.sell[0] ?? "-",
    checkCycle: strategy.rules.checkCycle,
    benchmark: strategy.benchmark.label,
    returnValue: strategy.backtest.metrics.strategyReturn,
    returnText: percent(strategy.backtest.metrics.strategyReturn),
    mddText: percent(strategy.backtest.metrics.maxDrawdown),
    detailTab: strategy.tabs.start,
    actionButton: strategy.today.primaryAction,
    detailButton: `${strategy.asset} 전략 보기`
  }));
}

function renderTodayDashboard() {
  const cards = document.getElementById("today-template-cards");
  if (!cards || !dashboard) return;
  const templates = buildStrategyTemplates();
  const meta = document.getElementById("today-meta");
  if (meta) meta.textContent = `${dashboard.asOf} 기준 | 3개 전략 동일 포맷`;

  document.getElementById("today-action-cards").innerHTML = templates.map((item) => `
    <article class="today-action-card ${item.tone}">
      <span>${item.asset}</span>
      <em class="action-badge ${item.statusTone}">${item.statusLabel}</em>
      <strong>${item.today}</strong>
      <p>${item.todayDetail}</p>
      <button class="secondary-button" data-go-tab="${item.detailTab}" type="button">${item.actionButton}</button>
    </article>
  `).join("");

  cards.innerHTML = templates.map(strategyTemplateCard).join("");
  document.getElementById("today-template-note").innerHTML = `
    <article><strong>1. 같은 순서</strong><span>모든 전략은 오늘 행동, 후보, 매수 기준, 매도 기준, 검증 결과 순서로 표시합니다.</span></article>
    <article><strong>2. 다른 매도 규칙</strong><span>미국/한국 개별주는 6개월 50% 매도 규칙을 쓰고, 한국 ETF는 매월 리밸런싱이 매도 역할을 합니다.</span></article>
    <article><strong>3. 새 전략 추가</strong><span>새 전략을 만들 때도 이 카드에 들어갈 항목을 먼저 정의한 뒤 백테스트와 계좌 기능을 붙입니다.</span></article>
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

function renderComparisonPerformanceChart({
  targetId,
  metaId,
  rows,
  strategyKey,
  benchmarkKey,
  strategyLabel,
  benchmarkLabel,
  ariaLabel
}) {
  const target = document.getElementById(targetId);
  const meta = document.getElementById(metaId);
  if (!target) return;
  const validRows = (rows ?? []).filter((row) => Number.isFinite(row[strategyKey]) || Number.isFinite(row[benchmarkKey]));
  if (meta) {
    meta.textContent = validRows.length
      ? `${validRows[0].asOf ?? validRows[0].month} ~ ${validRows.at(-1).asOf ?? validRows.at(-1).month}`
      : "데이터 없음";
  }
  if (validRows.length < 2) {
    target.innerHTML = `<p class="empty-state">성과 곡선 데이터가 없습니다.</p>`;
    return;
  }

  const width = 920;
  const height = 320;
  const pad = { top: 18, right: 24, bottom: 38, left: 54 };
  const values = validRows.flatMap((row) => [row[strategyKey], row[benchmarkKey]]).filter(Number.isFinite);
  const min = Math.min(0, ...values);
  const max = Math.max(0.1, ...values);
  const span = max - min || 1;
  const xFor = (row) => pad.left + (validRows.indexOf(row) / (validRows.length - 1)) * (width - pad.left - pad.right);
  const yFor = (value) => height - pad.bottom - ((value - min) / span) * (height - pad.top - pad.bottom);
  const zeroY = yFor(0);
  const strategyPath = linePath(validRows, strategyKey, xFor, yFor);
  const benchmarkPath = linePath(validRows, benchmarkKey, xFor, yFor);
  const last = validRows.at(-1);
  const firstLabel = String(validRows[0].asOf ?? validRows[0].month).slice(0, 7);
  const lastLabel = String(last.asOf ?? last.month).slice(0, 7);

  target.innerHTML = `
    <svg class="performance-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${ariaLabel}">
      <line class="axis" x1="${pad.left}" y1="${zeroY.toFixed(1)}" x2="${width - pad.right}" y2="${zeroY.toFixed(1)}"></line>
      <line class="axis" x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${height - pad.bottom}"></line>
      <text class="chart-axis" x="8" y="${(yFor(max) + 4).toFixed(1)}">${percent(max)}</text>
      <text class="chart-axis" x="8" y="${(yFor(min) + 4).toFixed(1)}">${percent(min)}</text>
      <path class="strategy-line" d="${strategyPath}"></path>
      <path class="qqq-line" d="${benchmarkPath}"></path>
      <text class="chart-axis" x="${pad.left}" y="${height - 12}">${firstLabel}</text>
      <text class="chart-axis" x="${width - pad.right - 52}" y="${height - 12}">${lastLabel}</text>
    </svg>
    <div class="legend">
      <span class="strategy">${strategyLabel} ${percent(last[strategyKey])}</span>
      <span class="qqq">${benchmarkLabel} ${percent(last[benchmarkKey])}</span>
    </div>
  `;
}

function backtestTemplateMetric(label, value, note = "", className = "") {
  return `
    <article>
      <span>${label}</span>
      <strong class="${className}">${value}</strong>
      ${note ? `<small>${note}</small>` : ""}
    </article>
  `;
}

function renderBacktestTemplate(targetId, config) {
  const target = document.getElementById(targetId);
  if (!target) return;
  const excess = Number.isFinite(config.strategyReturn) && Number.isFinite(config.benchmarkReturn)
    ? config.strategyReturn - config.benchmarkReturn
    : null;
  const verdict = Number.isFinite(excess)
    ? excess > 0
      ? `${config.benchmarkLabel}보다 ${percent(excess)} 더 좋았습니다.`
      : `${config.benchmarkLabel}보다 ${percent(Math.abs(excess))} 낮았습니다.`
    : "비교 지표 데이터가 부족합니다.";
  target.innerHTML = `
    <article class="backtest-template-card ${config.tone ?? ""}">
      <div class="backtest-template-head">
        <div>
          <span class="asset-badge">${config.asset}</span>
          <h3>${config.strategyName}</h3>
          <p>${config.description}</p>
        </div>
        <strong class="${signedClass(config.strategyReturn)}">${percent(config.strategyReturn)}</strong>
      </div>
      <div class="backtest-verdict">
        <span>기준 지표 비교</span>
        <strong>${verdict}</strong>
        <p>${config.periodLabel} | 비교 기준 ${config.benchmarkLabel}</p>
      </div>
      <div class="backtest-template-metrics">
        ${backtestTemplateMetric("전략 누적", percent(config.strategyReturn), "전략 규칙대로 운용", signedClass(config.strategyReturn))}
        ${backtestTemplateMetric(`${config.benchmarkLabel} 누적`, percent(config.benchmarkReturn), "같은 기간 기준 지표", signedClass(config.benchmarkReturn))}
        ${backtestTemplateMetric("초과 수익", percent(excess), "전략 - 기준 지표", signedClass(excess))}
        ${backtestTemplateMetric("MDD", percent(config.maxDrawdown), "기간 중 최대 낙폭", "negative")}
        ${backtestTemplateMetric("매매/리밸런싱", config.tradeCountLabel, config.tradeNote)}
        ${backtestTemplateMetric("승률", config.winRateLabel, config.winRateNote)}
      </div>
      <div class="backtest-template-rule">
        <strong>운용 규칙</strong>
        <span>${config.ruleSummary}</span>
      </div>
    </article>
  `;
}

function lastFiniteReturn(rows, key) {
  return [...(rows ?? [])].reverse().find((row) => Number.isFinite(row[key]))?.[key] ?? null;
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
  const correctedRows = scoreAScaleTest ? scoreARealizedTrades() : null;
  const allRows = [...(correctedRows ?? dashboard.backtest.realizedTrades ?? [])].reverse();
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

function renderBacktestKpis(targetId, config) {
  const target = document.getElementById(targetId);
  if (!target) return;
  const excess = Number.isFinite(config.strategyReturn) && Number.isFinite(config.benchmarkReturn)
    ? config.strategyReturn - config.benchmarkReturn
    : null;
  target.innerHTML = `
    <article class="kpi">
      <span>계좌 평가액</span>
      <strong>${config.finalValue}</strong>
      <small>${config.finalValueNote}</small>
    </article>
    <article class="kpi">
      <span>전략 누적 수익률</span>
      <strong class="${signedClass(config.strategyReturn)}">${percent(config.strategyReturn)}</strong>
      <small>${config.strategyNote}</small>
    </article>
    <article class="kpi">
      <span>${config.benchmarkLabel} 누적</span>
      <strong class="${signedClass(config.benchmarkReturn)}">${percent(config.benchmarkReturn)}</strong>
      <small>같은 기간 기준 지표</small>
    </article>
    <article class="kpi">
      <span>기준 지표 대비</span>
      <strong class="${signedClass(excess)}">${percent(excess)}</strong>
      <small>전략 - ${config.benchmarkLabel}</small>
    </article>
    <article class="kpi">
      <span>${config.activityLabel}</span>
      <strong>${config.activityValue}</strong>
      <small>${config.activityNote}</small>
    </article>
  `;
}

function renderBacktest() {
  const five = dashboard.backtest.fiveYear;
  const realized = dashboard.backtest.realizedSummary ?? {};
  const account = dashboard.backtest.accountSimulation;
  const official = finalStrategyValidation?.practicalWinner;
  const correctedAccount = scoreAAccountResult();
  const correctedSummary = scoreAScaleSummary();
  const curveRows = scoreACurveRows();
  const legacyCurveRows = dashboard.backtest.equityCurve ?? [];
  const lastCurve = curveRows.at(-1) ?? {};
  const legacyLastCurve = legacyCurveRows.at(-1) ?? {};
  const strategyReturn = correctedAccount?.totalReturn ?? official?.totalReturn ?? account?.totalReturn ?? five?.totalReturn;
  const benchmarkReturn = correctedAccount?.benchmark?.totalReturn ?? lastCurve.qqqTotalReturn ?? legacyLastCurve.qqqTotalReturn ?? five?.qqqTotalReturn;
  renderBacktestKpis("backtest-kpis", {
    finalValue: correctedAccount ? money(correctedAccount.finalCapital) : official ? money(official.finalCapital) : account ? money(account.finalCapital) : percent(five?.totalReturn),
    finalValueNote: correctedAccount
      ? `현금 ${money(correctedAccount.finalCash)} | 보유 ${money(correctedAccount.openMarketValue)}`
      : official ? `1천만원 시작 | ${official.label}` : account ? `1천만원 시작 | ${account.label}` : "자금 제한 없는 선정력 검증",
    strategyReturn,
    strategyNote: correctedAccount
      ? `Score A active | CAGR ${percent(correctedAccount.cagr)} | 시장가 MDD ${percent(correctedAccount.maxDrawdown)}`
      : official ? `공식 Cap27.5 | CAGR ${percent(official.cagr)}` : account ? `자금/현금 제한 반영 | CAGR ${percent(account.cagr)}` : "전략 규칙대로 운용",
    benchmarkLabel: "QQQ",
    benchmarkReturn,
    activityLabel: correctedAccount ? "계좌 매수/보유 lot" : "매수/청산",
    activityValue: correctedAccount
      ? `${correctedAccount.executedBuys}/${correctedAccount.openLotCount}`
      : official ? `${official.executedBuys}/${official.attemptedBuys}` : account ? `${account.executedBuys}/${account.attemptedBuys}` : `${realized.count ?? 0}건`,
    activityNote: correctedAccount
      ? `건너뜀 ${correctedAccount.skippedBuys} | 선택 종목 ${scoreAScaleTest?.symbolCount ?? 0}개`
      : official ? `건너뜀 ${official.skippedBuys}` : account ? `건너뜀 ${account.skippedBuys}` : `승률 ${plainPercent(realized.winRate)} | MDD ${percent(five?.maxDrawdown)}`
  });

  renderBacktestTemplate("backtest-template", {
    asset: "미국 주식",
    tone: "us",
    strategyName: "Score A Leader2 + Repeat Theme Combo Cap27.5",
    description: "현재 active인 Score A로 월간 주도 섹터 2개에서 각 1개 종목을 고르고, 반복 추천/AI 하드웨어 신호에 따라 매수 금액을 가중합니다. 종목당 원금 한도는 27.5%입니다.",
    benchmarkLabel: "QQQ",
    periodLabel: curveRows.length
      ? `${curveRows[0].asOf} ~ ${lastCurve.asOf}`
      : finalStrategyValidation?.period ? `${finalStrategyValidation.period.start} ~ ${finalStrategyValidation.period.end}` : "기간 데이터 없음",
    strategyReturn,
    benchmarkReturn,
    maxDrawdown: correctedAccount?.maxDrawdown ?? five?.maxDrawdown,
    tradeCountLabel: `${correctedAccount?.executedBuys ?? official?.executedBuys ?? account?.executedBuys ?? realized.count ?? 0}건`,
    tradeNote: correctedAccount
      ? `시도 ${correctedAccount.attemptedBuys}건 / 스킵 ${correctedAccount.skippedBuys}`
      : official ? `시도 ${official.attemptedBuys}건 / 스킵 ${official.skippedBuys}` : account ? `시도 ${account.attemptedBuys}건 / 스킵 ${account.skippedBuys}` : `${realized.count ?? 0}개 청산`,
    winRateLabel: plainPercent(correctedSummary?.winRate ?? realized.winRate),
    winRateNote: correctedSummary
      ? `${correctedSummary.closedTrades}개 청산 / ${correctedSummary.openTrades}개 미청산 (선정 거래)`
      : `${realized.count ?? 0}개 청산 기준`,
    ruleSummary: "월말 Score A 신규 후보 2개를 확정하고 공식 Cap27.5 비중으로 매수합니다. 매수 lot마다 6개월 후 50%를 매도하고, 남은 50%는 주봉 10주선과 RSI 조건이 유지될 때만 최대 12개월 연장합니다. 미완료 lot은 강제 청산하지 않고 시장가로 평가합니다."
  });

  if (curveRows.length) {
    renderComparisonPerformanceChart({
      targetId: "performance-chart",
      metaId: "curve-meta",
      rows: curveRows,
      strategyKey: "strategyTotalReturn",
      benchmarkKey: "qqqTotalReturn",
      strategyLabel: "Score A 계좌",
      benchmarkLabel: "QQQ",
      ariaLabel: "Score A strategy versus QQQ performance chart"
    });
  } else {
    renderPerformanceChart();
  }

  renderMonthlySellEvents();
  renderDetailedRealizedTrades();

  const annualComparisons = scoreACorrectedValidation?.annualComparisons ?? [];
  const yearlyTable = document.getElementById("yearly-body").closest("table");
  if (annualComparisons.length) {
    yearlyTable.querySelector("thead").innerHTML = `<tr><th>신호 구간</th><th>Score A</th><th>Score C</th><th>C-A</th><th>A MDD</th><th>C MDD</th></tr>`;
    document.getElementById("yearly-body").innerHTML = annualComparisons.map((row) => `
      <tr>
        <td>${row.label}</td>
        <td class="num ${signedClass(row.scoreAReturn)}">${percent(row.scoreAReturn)}</td>
        <td class="num ${signedClass(row.scoreCReturn)}">${percent(row.scoreCReturn)}</td>
        <td class="num ${signedClass(row.scoreCReturn - row.scoreAReturn)}">${percent(row.scoreCReturn - row.scoreAReturn)}</td>
        <td class="num negative">${percent(row.scoreAMaxDrawdown)}</td>
        <td class="num negative">${percent(row.scoreCMaxDrawdown)}</td>
      </tr>
    `).join("");
  } else {
    document.getElementById("yearly-body").innerHTML = (dashboard.backtest.yearly ?? []).map((row) => `
      <tr>
        <td>${row.year}</td>
        <td class="num ${signedClass(row.return)}">${percent(row.return)}</td>
        <td class="num ${signedClass(row.qqqReturn)}">${percent(row.qqqReturn)}</td>
        <td class="num ${signedClass(row.excessQqq)}">${percent(row.excessQqq)}</td>
        <td class="num">${plainPercent(row.beatQqqRate)}</td>
      </tr>
    `).join("");
  }

  const reports = [
    { label: "미국 주도주 전략 5년 복기", href: "us-strategy-history.html" },
    { label: "과거 실제 구성 종목 감사", href: "point-in-time-audit.html" },
    { label: "Score A·C 교정 검증", href: "score_a_c_corrected_validation.md" },
    ...(dashboard.backtest.reports ?? [])
  ];
  document.getElementById("report-links").innerHTML = reports.map((row) => `
    <a class="report-link" href="${row.href}" target="_blank" rel="noreferrer">${row.label}</a>
  `).join("");
}

function scoreCSelectionResult() {
  return scoreVariantTest?.results?.find((row) => row.key === "c_half_sector_normalized") ?? null;
}

function correctedScaleEvaluation(scaleTest) {
  return scaleTest?.evaluations?.find((row) => row.rule === "half_sell_half_weekly_extend") ?? null;
}

function correctedScaleSummary(scaleTest) {
  return scaleTest?.summaries?.find((row) => row.key === "half_sell_half_weekly_extend") ?? null;
}

function correctedAccountResult(strategyLab) {
  return strategyLab?.results?.find((row) => row.key === "repeat_theme_combo_cap275") ?? null;
}

function correctedTradeRows(scaleTest) {
  const sellCostRate = (scaleTest?.costBps ?? 0) / 10_000;
  return (correctedScaleEvaluation(scaleTest)?.rows ?? [])
    .filter((row) => row.entered)
    .map((row) => ({
      ...row,
      entryPrice: row.averageBuyMarketPrice ?? row.averageBuyPrice,
      exitPrice: row.averageSellPrice,
      exitDate: row.lastSellDate,
      exitMonth: String(row.lastSellDate ?? "").slice(0, 7),
      sellEvents: (row.sellLots ?? []).map((sell) => ({
        date: sell.date,
        month: String(sell.date).slice(0, 7),
        reason: sell.reason,
        weight: sell.shareFraction,
        price: sell.price,
        return: Number.isFinite(sell.price) && Number.isFinite(row.averageBuyPrice)
          ? sell.price * (1 - sellCostRate) / row.averageBuyPrice - 1
          : null
      }))
    }));
}

function correctedCurveRows(account) {
  const benchmarkByDate = new Map((account?.benchmark?.curve ?? []).map((row) => [row.date, row]));
  return (account?.curve ?? []).map((row) => ({
    ...row,
    asOf: row.date,
    strategyTotalReturn: Number.isFinite(row.equity) && account.initialCapital
      ? row.equity / account.initialCapital - 1
      : null,
    qqqTotalReturn: benchmarkByDate.get(row.date)?.totalReturn ?? null
  }));
}

function scoreAScaleSummary() {
  return correctedScaleSummary(scoreAScaleTest);
}

function scoreAAccountResult() {
  return correctedAccountResult(scoreAStrategyLab);
}

function scoreATradeRows() {
  return correctedTradeRows(scoreAScaleTest);
}

function scoreARealizedTrades() {
  return scoreATradeRows().filter((row) => row.closed);
}

function scoreACurveRows() {
  return correctedCurveRows(scoreAAccountResult());
}

function scoreCScaleEvaluation() {
  return correctedScaleEvaluation(scoreCScaleTest);
}

function scoreCScaleSummary() {
  return correctedScaleSummary(scoreCScaleTest);
}

function scoreCAccountResult() {
  return correctedAccountResult(scoreCStrategyLab);
}

function scoreCTradeRows() {
  return correctedTradeRows(scoreCScaleTest);
}

function scoreCRealizedTrades() {
  return scoreCTradeRows().filter((row) => row.closed);
}

function scoreCCurveRows() {
  return correctedCurveRows(scoreCAccountResult());
}

function renderScoreCEmpty() {
  const message = `<article class="kpi"><span>데이터</span><strong>-</strong><small>C안 백테스트 데이터가 아직 준비되지 않았습니다.</small></article>`;
  document.getElementById("score-c-kpis").innerHTML = message;
  document.getElementById("score-a-c-verdict").innerHTML = "";
  document.getElementById("score-c-backtest-template").innerHTML = `<p class="empty-state">C안 데이터 로드 실패</p>`;
  document.getElementById("score-c-performance-chart").innerHTML = "";
  document.getElementById("score-c-monthly-exits-body").innerHTML = "";
  document.getElementById("score-c-monthly-exits-cards").innerHTML = "";
  document.getElementById("score-c-realized-trades-body").innerHTML = "";
  document.getElementById("score-c-realized-trades-cards").innerHTML = "";
  document.getElementById("score-c-recent-selections").innerHTML = "";
}

function renderScoreACVerdict() {
  const validation = scoreACorrectedValidation;
  const scoreA = validation?.scoreA?.account;
  const scoreC = validation?.scoreC?.account;
  const target = document.getElementById("score-a-c-verdict");
  if (!target || !scoreA || !scoreC) {
    if (target) target.innerHTML = `<p class="empty-state">A·C 교정 검증 데이터가 없습니다.</p>`;
    return;
  }
  const passed = (validation.gates ?? []).filter((gate) => gate.passed).length;
  const annualWins = (validation.annualComparisons ?? []).filter((row) => row.winner === "Score C").length;
  target.innerHTML = `
    <article class="backtest-template-card us">
      <div class="backtest-template-head">
        <div>
          <span class="label">교정 엔진 · 고정 스냅샷</span>
          <strong>Score C는 검증 통과 후보, 실운용은 Score A 유지</strong>
          <p>실제 매도 가격, 미청산 보유분 시장가, 주간 MDD를 반영한 동일 조건 비교입니다.</p>
        </div>
        <span>${passed}/${validation.gates?.length ?? 0} 게이트 통과</span>
      </div>
      <div class="backtest-template-metrics">
        <article><span>Score A 계좌</span><strong>${percent(scoreA.totalReturn)}</strong><small>현재 active</small></article>
        <article><span>Score C 계좌</span><strong>${percent(scoreC.totalReturn)}</strong><small>validated candidate</small></article>
        <article><span>A 시장가 MDD</span><strong class="negative">${percent(scoreA.maxDrawdown)}</strong><small>원가 기준 아님</small></article>
        <article><span>C 시장가 MDD</span><strong class="negative">${percent(scoreC.maxDrawdown)}</strong><small>A 대비 ${percent(scoreC.maxDrawdown - scoreA.maxDrawdown)}</small></article>
        <article><span>연도별 우위</span><strong>${annualWins}/${validation.annualComparisons?.length ?? 0}</strong><small>독립 1천만원 계좌</small></article>
        <article><span>공식 승격</span><strong>보류</strong><small>시점별 유니버스·전진 관찰 필요</small></article>
      </div>
    </article>
  `;
}

function renderScoreCMonthlySellEvents() {
  const allRows = [...monthlySellEventRowsFromTrades(scoreCTradeRows())].reverse();
  const rows = showAllScoreCMonthlyExits ? allRows : allRows.slice(0, RECENT_MONTHLY_EXIT_LIMIT);
  document.getElementById("score-c-monthly-exit-meta").textContent = showAllScoreCMonthlyExits
    ? `전체 ${allRows.length}개월`
    : `최근 ${rows.length}개월 / 전체 ${allRows.length}개월`;
  document.getElementById("score-c-monthly-exits-body").innerHTML = rows.map((row) => `
    <tr>
      <td>${row.month}</td>
      <td>${row.eventCount}건<div class="sub">${(row.events ?? []).slice(0, 4).map((event) => `${event.date} ${event.symbol}`).join(" / ")}</div></td>
      <td class="num">${row.fixedCount}</td>
      <td class="num">${row.remainingCount}</td>
      <td class="num ${signedClass(row.averageEventReturn)}">${percent(row.averageEventReturn)}</td>
      <td><strong>${(row.symbols ?? []).join(", ")}</strong></td>
    </tr>
  `).join("");

  document.getElementById("score-c-monthly-exits-cards").innerHTML = rows.map((row) => `
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

  const button = document.getElementById("toggle-score-c-monthly-exits");
  button.hidden = allRows.length <= RECENT_MONTHLY_EXIT_LIMIT;
  button.textContent = showMoreLabel(showAllScoreCMonthlyExits, rows.length, allRows.length);
  button.onclick = () => {
    showAllScoreCMonthlyExits = !showAllScoreCMonthlyExits;
    renderScoreCMonthlySellEvents();
  };
}

function renderScoreCRealizedTrades() {
  const allRows = [...scoreCRealizedTrades()].reverse();
  const rows = showAllScoreCRealizedTrades ? allRows : allRows.slice(0, RECENT_REALIZED_TRADE_LIMIT);
  document.getElementById("score-c-realized-trade-meta").textContent = showAllScoreCRealizedTrades
    ? `전체 ${allRows.length}개 청산 완료`
    : `최근 ${rows.length}개 / 전체 ${allRows.length}개`;
  document.getElementById("score-c-realized-trades-body").innerHTML = rows.map((row) => `
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

  document.getElementById("score-c-realized-trades-cards").innerHTML = rows.map((row) => `
    <article class="result-card">
      <div class="card-head">
        <div>
          <h3>${row.symbol}</h3>
          <p>${row.cohort} 추천 | 매수 ${(row.buyDates ?? []).join(", ")}</p>
        </div>
        <strong class="${signedClass(row.return)}">${percent(row.return)}</strong>
      </div>
      <div class="mobile-price">
        <span>매수 ${money(row.entryPrice)} / 평균 매도 ${money(row.exitPrice)}</span>
        <span class="${signedClass(row.excessQqq)}">QQQ 대비 ${percent(row.excessQqq)}</span>
      </div>
      <ul class="event-list">${tradeSellEvents(row).map(eventLine).join("")}</ul>
    </article>
  `).join("");

  const button = document.getElementById("toggle-score-c-realized-trades");
  button.hidden = allRows.length <= RECENT_REALIZED_TRADE_LIMIT;
  button.textContent = showMoreLabel(showAllScoreCRealizedTrades, rows.length, allRows.length);
  button.onclick = () => {
    showAllScoreCRealizedTrades = !showAllScoreCRealizedTrades;
    renderScoreCRealizedTrades();
  };
}

function renderScoreCRecentSelections() {
  const result = scoreCSelectionResult();
  const rows = [...(result?.recentSelections ?? [])].reverse();
  document.getElementById("score-c-selection-meta").textContent = `최근 ${rows.length}개월`;
  document.getElementById("score-c-recent-selections").innerHTML = rows.map((month) => `
    <article class="result-card">
      <div class="card-head">
        <div>
          <h3>${month.asOf} 확정</h3>
          <p>매수 기준일 ${month.entryDate}</p>
        </div>
        <strong>${(month.rows ?? []).length}개</strong>
      </div>
      <div class="metric-line">
        ${(month.rows ?? []).map((row) => `
          <span><strong>${row.symbol}</strong> ${row.name} | ${row.sector} | 점수 ${number(row.score, 1)} | 순위 ${row.rank}</span>
        `).join("")}
      </div>
    </article>
  `).join("");
}

function renderScoreCBacktest() {
  const selection = scoreCSelectionResult();
  const account = scoreCAccountResult();
  const summary = scoreCScaleSummary();
  const curveRows = scoreCCurveRows();
  const lastCurve = curveRows.at(-1) ?? {};

  if (!selection || !account || !summary) {
    renderScoreCEmpty();
    return;
  }

  renderBacktestKpis("score-c-kpis", {
    finalValue: money(account.finalCapital),
    finalValueNote: `현금 ${money(account.finalCash)} | 보유 ${money(account.openMarketValue)}`,
    strategyReturn: account.totalReturn,
    strategyNote: `CAGR ${percent(account.cagr)} | 시장가 MDD ${percent(account.maxDrawdown)}`,
    benchmarkLabel: "QQQ",
    benchmarkReturn: account.benchmark?.totalReturn ?? lastCurve.qqqTotalReturn ?? selection.qqqTotalReturn,
    activityLabel: "계좌 매수/보유 lot",
    activityValue: `${account.executedBuys}/${account.openLotCount}`,
    activityNote: `건너뜀 ${account.skippedBuys} | 선택 종목 ${scoreCScaleTest?.symbolCount ?? 0}개`
  });

  renderScoreACVerdict();

  renderBacktestTemplate("score-c-backtest-template", {
    asset: "미국 주식 A·C 검증",
    tone: "us",
    strategyName: "C Half Sector10 Normalized + Cap27.5",
    description: "Score C는 섹터 점수를 10%로 낮춘 Leader2 후보입니다. 교정 백테스트를 통과했지만 실운용 active는 Score A로 유지합니다.",
    benchmarkLabel: "QQQ",
    periodLabel: curveRows.length ? `${curveRows[0].asOf} ~ ${curveRows.at(-1).asOf}` : "기간 데이터 없음",
    strategyReturn: account.totalReturn,
    benchmarkReturn: account.benchmark?.totalReturn ?? lastCurve.qqqTotalReturn ?? selection.qqqTotalReturn,
    maxDrawdown: account.maxDrawdown,
    tradeCountLabel: `${account.executedBuys}건`,
    tradeNote: `시도 ${account.attemptedBuys}건 / 스킵 ${account.skippedBuys}`,
    winRateLabel: plainPercent(summary.winRate),
    winRateNote: `${summary.closedTrades}개 청산 / ${summary.openTrades}개 미청산 (선정 거래)`,
    ruleSummary: "월말 C안 점수로 신규 후보 2개를 확정하고 다음 거래일 매수합니다. Cap27.5 계좌 규칙으로 종목당 최대 27.5%까지만 보유하며, 각 lot은 6개월 후 50%를 매도하고 남은 50%는 주봉 추세가 유지될 때만 최대 12개월까지 연장합니다. 미완료 lot은 강제 청산하지 않고 시장가로 평가합니다."
  });

  renderComparisonPerformanceChart({
    targetId: "score-c-performance-chart",
    metaId: "score-c-curve-meta",
    rows: curveRows,
    strategyKey: "strategyTotalReturn",
    benchmarkKey: "qqqTotalReturn",
    strategyLabel: "Score C 계좌",
    benchmarkLabel: "QQQ",
    ariaLabel: "C variant strategy versus QQQ performance chart"
  });

  renderScoreCMonthlySellEvents();
  renderScoreCRealizedTrades();
  renderScoreCRecentSelections();
}

function benchmarkLabel(symbol) {
  return {
    "069500.KS": "KOSPI200",
    "133690.KS": "TIGER 나스닥100"
  }[symbol] ?? symbol ?? "벤치마크";
}

function koreaTradeRows() {
  return koreaLiveStrategies().flatMap((strategy) => (
    strategy.trades ?? []
  ).map((trade) => ({ ...trade, strategyLabel: strategy.label })));
}

function koreaLiveStrategies() {
  return [koreaStrategyByKey("kr_stocks"), activeKoreaEtfStrategy()].filter(Boolean);
}

function koreaEtfRebalanceRows() {
  const strategy = activeKoreaEtfStrategy();
  if (!strategy) return [];
  const ledgerByDate = new Map();
  for (const event of strategy.capitalAccount?.ledger ?? []) {
    if (event.type !== "rebalance") continue;
    const rows = ledgerByDate.get(event.date) ?? [];
    rows.push(event);
    ledgerByDate.set(event.date, rows);
  }
  return (strategy.timeline ?? [])
    .filter((row) => row.tradeDate && (row.rows ?? []).length)
    .map((row) => {
      const ledgerRows = ledgerByDate.get(row.tradeDate) ?? [];
      const allocations = (ledgerRows.length ? ledgerRows : row.rows).map((item) => ({
        symbol: item.symbol,
        name: item.name,
        group: item.group,
        weight: item.weight,
        amount: item.amount,
        price: item.price ?? item.close,
        r3m: item.r3m
      })).sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
      return {
        month: row.month,
        signalDate: row.signalDate,
        tradeDate: row.tradeDate,
        leaders: row.leaders ?? [],
        allocations
      };
    });
}

function koreaEtfAllocationText(row) {
  return (row.allocations ?? [])
    .map((item) => `${weightText(item.weight)} ${item.symbol} ${item.name}`)
    .join(" / ");
}

function koreaStockMonthlySellRows() {
  const strategy = koreaStockStrategy();
  const grouped = new Map();
  for (const trade of strategy?.trades ?? []) {
    for (const event of trade.events ?? []) {
      const month = String(event.date ?? "").slice(0, 7);
      if (!month) continue;
      const row = grouped.get(month) ?? {
        month,
        events: [],
        eventCount: 0,
        fixedCount: 0,
        remainingCount: 0,
        returnSum: 0,
        benchmarkSum: 0,
        excessSum: 0,
        weightSum: 0,
        symbols: new Set()
      };
      const weight = Number(event.weight) || 1;
      row.eventCount += 1;
      if (String(event.reason ?? "").includes("6개월")) row.fixedCount += 1;
      else row.remainingCount += 1;
      row.returnSum += (Number(event.return) || 0) * weight;
      row.benchmarkSum += (Number(event.benchmarkReturn) || 0) * weight;
      row.excessSum += (Number(event.excessBenchmark) || 0) * weight;
      row.weightSum += weight;
      row.symbols.add(trade.symbol);
      row.events.push({ ...event, symbol: trade.symbol, name: trade.name, group: trade.group });
      grouped.set(month, row);
    }
  }
  return [...grouped.values()].map((row) => ({
    ...row,
    symbols: [...row.symbols],
    averageReturn: row.weightSum ? row.returnSum / row.weightSum : null,
    averageBenchmarkReturn: row.weightSum ? row.benchmarkSum / row.weightSum : null,
    averageExcessBenchmark: row.weightSum ? row.excessSum / row.weightSum : null
  })).sort((a, b) => a.month.localeCompare(b.month));
}

function koreaStockPerformanceRows() {
  const strategy = koreaStockStrategy();
  const benchmarkByMonth = new Map((strategy?.benchmarkCurve ?? []).map((row) => [row.month, row]));
  return (strategy?.curve ?? []).map((row) => ({
    month: row.month,
    asOf: row.asOf,
    strategyTotalReturn: row.strategyTotalReturn,
    benchmarkTotalReturn: benchmarkByMonth.get(row.month)?.totalReturn
  }));
}

function renderKoreaStockMonthlySells() {
  const allRows = [...koreaStockMonthlySellRows()].reverse();
  const rows = showAllKoreaStockMonthlySells ? allRows : allRows.slice(0, RECENT_KOREA_STOCK_SELL_LIMIT);
  const meta = document.getElementById("korea-stock-monthly-sell-meta");
  if (meta) {
    meta.textContent = showAllKoreaStockMonthlySells
      ? `전체 ${allRows.length}개월`
      : `최근 ${rows.length}개월 / 전체 ${allRows.length}개월`;
  }
  const body = document.getElementById("korea-stock-monthly-sell-body");
  if (body) body.innerHTML = rows.map((row) => `
    <tr>
      <td>${row.month}</td>
      <td>${row.eventCount}건<div class="sub">${row.events.slice(0, 4).map((event) => `${event.date} ${event.symbol}`).join(" / ")}</div></td>
      <td class="num">${row.fixedCount}</td>
      <td class="num">${row.remainingCount}</td>
      <td class="num ${signedClass(row.averageReturn)}">${percent(row.averageReturn)}</td>
      <td class="num ${signedClass(row.averageBenchmarkReturn)}">${percent(row.averageBenchmarkReturn)}</td>
      <td class="num ${signedClass(row.averageExcessBenchmark)}">${percent(row.averageExcessBenchmark)}</td>
      <td><strong>${row.symbols.join(", ")}</strong></td>
    </tr>
  `).join("");

  const cards = document.getElementById("korea-stock-monthly-sell-cards");
  if (cards) cards.innerHTML = rows.map((row) => `
    <article class="result-card">
      <div class="card-head">
        <div>
          <h3>${row.month} 매도 결과</h3>
          <p>총 ${row.eventCount}건 | 기본 ${row.fixedCount} / 잔여 ${row.remainingCount}</p>
        </div>
        <strong class="${signedClass(row.averageExcessBenchmark)}">${percent(row.averageExcessBenchmark)}</strong>
      </div>
      <div class="metric-line">
        <span>전략 ${percent(row.averageReturn)}</span>
        <span>KOSPI200 ${percent(row.averageBenchmarkReturn)}</span>
        <span>KOSPI 초과 ${percent(row.averageExcessBenchmark)}</span>
      </div>
      <ul class="event-list">${row.events.map((event) => `
        <li><strong>${event.date} ${event.symbol}</strong><span>${event.reason} | 전략 ${percent(event.return)} / KOSPI200 ${percent(event.benchmarkReturn)}</span></li>
      `).join("")}</ul>
    </article>
  `).join("");

  const button = document.getElementById("toggle-korea-stock-monthly-sells");
  if (button) {
    button.hidden = allRows.length <= RECENT_KOREA_STOCK_SELL_LIMIT;
    button.textContent = showMoreLabel(showAllKoreaStockMonthlySells, rows.length, allRows.length);
    button.onclick = () => {
      showAllKoreaStockMonthlySells = !showAllKoreaStockMonthlySells;
      renderKoreaStockMonthlySells();
    };
  }
}

function koreaEtfMonthlyReturnRows() {
  const strategy = activeKoreaEtfStrategy();
  const curve = strategy?.capitalAccount?.curve ?? [];
  const benchmarkByMonth = new Map((strategy?.capitalAccount?.benchmarkCurve ?? []).map((row) => [row.month, row]));
  return curve.map((row, index) => {
    const previous = index > 0 ? curve[index - 1] : row;
    const monthlyReturn = index > 0 && Number.isFinite(previous.equity) && previous.equity
      ? row.equity / previous.equity - 1
      : 0;
    const benchmark = benchmarkByMonth.get(row.month) ?? {};
    const benchmarkMonthly = Number.isFinite(benchmark.monthlyReturn) ? benchmark.monthlyReturn : null;
    return {
      ...row,
      monthlyReturn,
      benchmarkMonthlyReturn: benchmarkMonthly,
      benchmarkTotalReturn: benchmark.totalReturn,
      monthlyExcess: Number.isFinite(monthlyReturn) && Number.isFinite(benchmarkMonthly)
        ? monthlyReturn - benchmarkMonthly
        : null,
      totalExcess: Number.isFinite(row.totalReturn) && Number.isFinite(benchmark.totalReturn)
        ? row.totalReturn - benchmark.totalReturn
        : null
    };
  });
}

function koreaEtfPerformanceRows() {
  const strategy = activeKoreaEtfStrategy();
  const benchmarkByMonth = new Map((strategy?.capitalAccount?.benchmarkCurve ?? []).map((row) => [row.month, row]));
  return (strategy?.capitalAccount?.curve ?? []).map((row) => ({
    month: row.month,
    asOf: row.asOf,
    strategyTotalReturn: row.totalReturn,
    benchmarkTotalReturn: benchmarkByMonth.get(row.month)?.totalReturn
  }));
}

function renderKoreaEtfMonthlyReturns() {
  const allRows = [...koreaEtfMonthlyReturnRows()].reverse();
  const rows = showAllKoreaEtfMonthlyReturns ? allRows : allRows.slice(0, RECENT_KOREA_ETF_RETURN_LIMIT);
  const meta = document.getElementById("korea-etf-monthly-return-meta");
  if (meta) {
    meta.textContent = showAllKoreaEtfMonthlyReturns
      ? `전체 ${allRows.length}개월`
      : `최근 ${rows.length}개월 / 전체 ${allRows.length}개월`;
  }
  const body = document.getElementById("korea-etf-monthly-return-body");
  if (body) body.innerHTML = rows.map((row) => `
    <tr>
      <td>${row.month}</td>
      <td class="num ${signedClass(row.monthlyReturn)}">${percent(row.monthlyReturn)}</td>
      <td class="num ${signedClass(row.benchmarkMonthlyReturn)}">${percent(row.benchmarkMonthlyReturn)}</td>
      <td class="num ${signedClass(row.monthlyExcess)}">${percent(row.monthlyExcess)}</td>
      <td class="num ${signedClass(row.totalReturn)}">${percent(row.totalReturn)}</td>
      <td class="num ${signedClass(row.benchmarkTotalReturn)}">${percent(row.benchmarkTotalReturn)}</td>
      <td class="num">${krw(row.equity)}</td>
    </tr>
  `).join("");

  const cards = document.getElementById("korea-etf-monthly-return-cards");
  if (cards) cards.innerHTML = rows.map((row) => `
    <article class="result-card">
      <div class="card-head">
        <div>
          <h3>${row.month} ETF 월수익률</h3>
          <p>평가액 ${krw(row.equity)}</p>
        </div>
        <strong class="${signedClass(row.monthlyExcess)}">${percent(row.monthlyExcess)}</strong>
      </div>
      <div class="metric-line">
        <span>전략 ${percent(row.monthlyReturn)}</span>
        <span>KOSPI200 ${percent(row.benchmarkMonthlyReturn)}</span>
        <span>전략 누적 ${percent(row.totalReturn)}</span>
      </div>
    </article>
  `).join("");

  const button = document.getElementById("toggle-korea-etf-monthly-returns");
  if (button) {
    button.hidden = allRows.length <= RECENT_KOREA_ETF_RETURN_LIMIT;
    button.textContent = showMoreLabel(showAllKoreaEtfMonthlyReturns, rows.length, allRows.length);
    button.onclick = () => {
      showAllKoreaEtfMonthlyReturns = !showAllKoreaEtfMonthlyReturns;
      renderKoreaEtfMonthlyReturns();
    };
  }
}

function renderKoreaEtfRebalances() {
  const allRows = [...koreaEtfRebalanceRows()].reverse();
  const rows = showAllKoreaEtfRebalances ? allRows : allRows.slice(0, RECENT_KOREA_REBALANCE_LIMIT);
  const meta = document.getElementById("korea-etf-rebalance-meta");
  if (meta) {
    meta.textContent = showAllKoreaEtfRebalances
      ? `전체 ${allRows.length}개월`
      : `최근 ${rows.length}개월 / 전체 ${allRows.length}개월`;
  }

  const roleLabel = (index) => ["Core", "Satellite", "Defense"][index] ?? `ETF ${index + 1}`;
  const cell = (item, index) => item ? `
    <strong>${item.symbol}</strong>
    <div class="sub">${item.name}</div>
    <div class="sub">${roleLabel(index)} ${weightText(item.weight)} | ${item.group}</div>
    <div class="sub">${Number.isFinite(item.amount) ? krw(item.amount) : ""}${Number.isFinite(item.price) ? ` @ ${krw(item.price)}` : ""}</div>
  ` : "-";

  const body = document.getElementById("korea-etf-rebalance-body");
  if (body) body.innerHTML = rows.map((row) => `
    <tr>
      <td>${row.month}</td>
      <td>${row.signalDate}</td>
      <td>${row.tradeDate}</td>
      <td>${cell(row.allocations[0], 0)}</td>
      <td>${cell(row.allocations[1], 1)}</td>
      <td>${cell(row.allocations[2], 2)}</td>
      <td>${(row.leaders ?? []).slice(0, 3).map((leader) => `${leader.group} ${number(leader.leadershipScore, 1)}`).join(" / ")}</td>
    </tr>
  `).join("");

  const cards = document.getElementById("korea-etf-rebalance-cards");
  if (cards) cards.innerHTML = rows.map((row) => `
    <article class="result-card">
      <div class="card-head">
        <div>
          <h3>${row.month} ETF 리밸런싱</h3>
          <p>신호 ${row.signalDate} | 체결 ${row.tradeDate}</p>
        </div>
        <strong>${row.allocations.length}개</strong>
      </div>
      <div class="metric-line">
        ${(row.allocations ?? []).map((item, index) => `
          <span>${roleLabel(index)} ${weightText(item.weight)} ${item.symbol}</span>
        `).join("")}
      </div>
      <p class="reason">${koreaEtfAllocationText(row)}</p>
      <p class="reason">주도 그룹: ${(row.leaders ?? []).slice(0, 3).map((leader) => leader.group).join(" / ")}</p>
    </article>
  `).join("");

  const button = document.getElementById("toggle-korea-etf-rebalances");
  if (button) {
    button.hidden = allRows.length <= RECENT_KOREA_REBALANCE_LIMIT;
    button.textContent = showMoreLabel(showAllKoreaEtfRebalances, rows.length, allRows.length);
    button.onclick = () => {
      showAllKoreaEtfRebalances = !showAllKoreaEtfRebalances;
      renderKoreaEtfRebalances();
    };
  }
}

function koreaStrategyByKey(key) {
  return (koreaDashboard?.strategies ?? []).find((strategy) => strategy.key === key) ?? null;
}

function activeKoreaEtfStrategy() {
  const source = koreaEtfValidation?.variants?.find((strategy) => strategy.key === ACTIVE_KOREA_ETF_KEY)
    ?? koreaStrategyByKey("kr_etf_benchmark_or_alpha")
    ?? null;
  if (!source) return null;
  const timeline = source.timeline ?? (source.recentRebalances ?? []).map((row) => ({
    month: row.month,
    signalDate: row.signalDate,
    tradeDate: row.tradeDate,
    rows: row.allocations ?? []
  }));
  return {
    ...source,
    sourceLabel: source.label,
    label: "ETF-I 주도·방어 1개",
    capitalAccount: source.capitalAccount ?? source.account,
    timeline
  };
}

function weightText(value) {
  if (!Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(0)}%`;
}

function renderKoreaInvestEmpty() {
  const ids = [
    "korea-invest-kpis",
    "korea-invest-cards",
    "korea-etf-weights",
    "korea-stock-picks",
    "korea-execution-rules"
  ];
  for (const id of ids) {
    const target = document.getElementById(id);
    if (target) target.innerHTML = `<p class="empty-state">한국 전략 데이터가 아직 생성되지 않았습니다.</p>`;
  }
  const meta = document.getElementById("korea-invest-meta");
  if (meta) meta.textContent = "데이터 없음";
}

function strategyMetricCard(title, strategy, note) {
  const account = strategy?.capitalAccount ?? {};
  return `
    <article class="kpi">
      <span>${title}</span>
      <strong class="${signedClass(account.totalReturn)}">${percent(account.totalReturn)}</strong>
      <small>${krw(account.finalCapital)} | MDD ${percent(account.maxDrawdown)}${note ? ` | ${note}` : ""}</small>
    </article>
  `;
}

function renderKoreaInvest() {
  if (!koreaDashboard) {
    renderKoreaInvestEmpty();
    return;
  }

  const stock = koreaStrategyByKey("kr_stocks");
  const activeEtf = activeKoreaEtfStrategy();

  document.getElementById("korea-invest-meta").textContent = `${koreaDashboard.asOf} 기준 | 한국 주식 + ETF 운용`;
  document.getElementById("korea-invest-kpis").innerHTML = [
    strategyMetricCard("한국 ETF ETF-I", activeEtf, "월간 1개 리밸런싱"),
    strategyMetricCard("한국 우량주 Leader2", stock, "월간 후보 2개"),
    `<article class="kpi"><span>현재 ETF 후보</span><strong>${activeEtf?.currentPicks?.length ?? 0}개</strong><small>월 1회 리밸런싱</small></article>`
  ].join("");

  document.getElementById("korea-invest-cards").innerHTML = `
    <article class="korea-strategy-card featured">
      <span class="label">연금 / ETF 대표 전략</span>
      <h3>ETF-I 주도·방어 1개</h3>
      <p>강한 장세에는 최상위 알파 ETF, 약한 장세에는 방어 ETF 1개로 매월 전체 계좌를 리밸런싱합니다.</p>
      <div class="metric-line">
        <span>수익률 ${percent(activeEtf?.capitalAccount?.totalReturn)}</span>
        <span>최종 ${krw(activeEtf?.capitalAccount?.finalCapital)}</span>
        <span>MDD ${percent(activeEtf?.capitalAccount?.maxDrawdown)}</span>
      </div>
    </article>
    <article class="korea-strategy-card">
      <span class="label">한국 주식 대표 전략</span>
      <h3>우량주 Leader2</h3>
      <p>월말 기준 주도 업종 상위 2개에서 각 1개 종목을 고르고, 6개월 후 50% 매도 뒤 주봉 추세로 잔여 물량을 관리합니다.</p>
      <div class="metric-line">
        <span>수익률 ${percent(stock?.capitalAccount?.totalReturn)}</span>
        <span>최종 ${krw(stock?.capitalAccount?.finalCapital)}</span>
        <span>MDD ${percent(stock?.capitalAccount?.maxDrawdown)}</span>
      </div>
    </article>
  `;

  const etfAccountBase = 10_000_000;
  document.getElementById("korea-etf-meta").textContent = `${activeEtf?.label ?? "ETF-I"} | 1,000만원 예시`;
  document.getElementById("korea-etf-weights").innerHTML = (activeEtf?.currentPicks ?? []).map((row) => `
    <article class="buy-card">
      <div class="card-head">
        <div>
          <span class="label">${row.group}</span>
          <h3>${row.symbol}</h3>
          <p>${row.name}</p>
        </div>
        <strong>${weightText(row.weight)}</strong>
      </div>
      ${miniChart(row)}
      <div class="metric-line">
        <span>1,000만원 기준 ${krw(etfAccountBase * (row.weight ?? 0))}</span>
        <span>점수 ${number(row.score, 1)}</span>
        <span>3M ${percent(row.r3m)}</span>
      </div>
    </article>
  `).join("");

  document.getElementById("korea-stock-meta").textContent = `${stock?.label ?? "Leader2"} | 차트 확인 후 진입`;
  document.getElementById("korea-stock-picks").innerHTML = (stock?.currentPicks ?? []).map((row) => `
    <article class="buy-card">
      <div class="card-head">
        <div>
          <span class="label">${row.group}</span>
          <h3>${row.symbol}</h3>
          <p>${row.name}</p>
        </div>
        <strong class="${signedClass(row.r3m)}">${percent(row.r3m)}</strong>
      </div>
      ${miniChart(row)}
      <div class="metric-line">
        <span>점수 ${number(row.score, 1)}</span>
        <span>1M ${percent(row.r1m)}</span>
        <span>6M ${percent(row.r6m)}</span>
      </div>
    </article>
  `).join("");

  document.getElementById("korea-execution-rules").innerHTML = `
    <article>
      <h3>ETF 매수/매도</h3>
      <ol>
        <li>월말에 KODEX200이 200일선 위이고 모멘텀이 양수인지 확인합니다.</li>
        <li>강한 장세에는 주도 ETF 1개, 약한 장세에는 방어 ETF 1개를 확정합니다.</li>
        <li>다음 거래일에 기존 ETF를 정리하고 선정 ETF를 계좌의 100% 목표로 맞춥니다.</li>
        <li>별도 6개월 매도 규칙은 쓰지 않고 매월 리밸런싱이 매수/매도 역할을 합니다.</li>
      </ol>
    </article>
    <article>
      <h3>한국 주식 매수/매도</h3>
      <ol>
        <li>월말 주도 업종 상위 2개에서 각 1개 우량주를 선정합니다.</li>
        <li>매수 전 일봉, 4시간봉, 1시간봉으로 과열 여부와 진입 위치를 확인합니다.</li>
        <li>6개월 후 해당 lot의 50%를 기본 매도합니다.</li>
        <li>남은 50%는 주봉 10주선과 RSI 조건이 유지될 때만 연장 보유합니다.</li>
      </ol>
    </article>
    <article>
      <h3>권장 운용</h3>
      <ul>
        <li>연금 계좌는 ETF-I 주도·방어 전략을 우선 후보로 둡니다.</li>
        <li>일반 계좌의 공격형 자금은 한국 우량주 Leader2로 분리합니다.</li>
        <li>한국 주식과 ETF 성과는 섞어 보지 말고 각각 별도 계좌처럼 관리합니다.</li>
      </ul>
    </article>
  `;
}

function selectedKoreaEtfStrategy() {
  return activeKoreaEtfStrategy();
}

function koreaStockStrategy() {
  return koreaStrategyByKey("kr_stocks");
}

function defaultKoreaAccount() {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    settings: {
      etfCapital: 10_000_000,
      stockCapital: 10_000_000,
      etfMode: ACTIVE_KOREA_ETF_KEY
    },
    etfRebalances: [],
    stockLots: [],
    ledger: []
  };
}

function loadKoreaAccount() {
  try {
    const raw = localStorage.getItem(KOREA_ACCOUNT_STORAGE_KEY);
    if (!raw) return defaultKoreaAccount();
    const parsed = JSON.parse(raw);
    return {
      ...defaultKoreaAccount(),
      ...parsed,
      settings: { ...defaultKoreaAccount().settings, ...(parsed.settings ?? {}) },
      etfRebalances: Array.isArray(parsed.etfRebalances) ? parsed.etfRebalances : [],
      stockLots: Array.isArray(parsed.stockLots) ? parsed.stockLots : [],
      ledger: Array.isArray(parsed.ledger) ? parsed.ledger : []
    };
  } catch {
    return defaultKoreaAccount();
  }
}

function saveKoreaAccount() {
  if (!koreaAccountState) return;
  koreaAccountState.updatedAt = new Date().toISOString();
  localStorage.setItem(KOREA_ACCOUNT_STORAGE_KEY, JSON.stringify(koreaAccountState));
}

function applyKoreaAccountSettingsToForm() {
  if (!koreaAccountState) return;
  const etfCapital = document.getElementById("korea-etf-capital");
  const stockCapital = document.getElementById("korea-stock-capital");
  const etfMode = document.getElementById("korea-etf-mode");
  if (etfCapital) etfCapital.value = Math.round(koreaAccountState.settings.etfCapital || 0).toLocaleString("ko-KR");
  if (stockCapital) stockCapital.value = Math.round(koreaAccountState.settings.stockCapital || 0).toLocaleString("ko-KR");
  if (etfMode) etfMode.value = ACTIVE_KOREA_ETF_KEY;
}

function syncKoreaAccountSettingsFromForm() {
  if (!koreaAccountState) return;
  const etfMode = document.getElementById("korea-etf-mode")?.value;
  koreaAccountState.settings = {
    ...koreaAccountState.settings,
    etfCapital: Math.max(0, parseAmount(document.getElementById("korea-etf-capital")?.value)),
    stockCapital: Math.max(0, parseAmount(document.getElementById("korea-stock-capital")?.value)),
    etfMode: etfMode || ACTIVE_KOREA_ETF_KEY
  };
  saveKoreaAccount();
}

function koreaCurrentMonth() {
  return monthKeyFromDate(koreaDashboard?.asOf || todayDate());
}

function koreaLotRemainingShares(lot) {
  const sold = (lot.sells ?? []).reduce((sum, row) => sum + (Number(row.shares) || 0), 0);
  return Math.max(0, (Number(lot.shares) || 0) - sold);
}

function koreaLotStatus(lot) {
  if (lot.status === "closed" || koreaLotRemainingShares(lot) <= 0) return "closed";
  const today = todayDate();
  if (!lot.soldHalf && today >= lot.halfSellDate) return "half_due";
  if (lot.soldHalf && today >= lot.maxExitDate) return "final_due";
  if (lot.soldHalf) return "extended";
  return "hold";
}

function koreaLotStatusLabel(status) {
  return {
    hold: "보유중",
    half_due: "50% 매도 필요",
    extended: "나머지 50% 연장 보유",
    final_due: "나머지 매도 점검",
    closed: "매도 완료"
  }[status] ?? status;
}

function recordKoreaEtfRebalance() {
  if (!koreaAccountState) return;
  syncKoreaAccountSettingsFromForm();
  const etf = selectedKoreaEtfStrategy();
  if (!etf) return;
  const date = window.prompt("리밸런싱 기록일", todayDate()) || todayDate();
  const capital = Math.max(0, parseAmount(window.prompt("ETF 계좌 평가금액", String(koreaAccountState.settings.etfCapital))));
  if (!capital) return;
  const targets = (etf.currentPicks ?? []).map((row) => ({
    symbol: row.symbol,
    name: row.name,
    group: row.group,
    weight: row.weight ?? 0,
    targetAmount: capital * (row.weight ?? 0),
    close: row.close
  }));
  const record = {
    id: id("kr-etf"),
    date,
    month: koreaCurrentMonth(),
    strategyKey: etf.key,
    strategyLabel: etf.label,
    capital,
    targets
  };
  koreaAccountState.etfRebalances.unshift(record);
  koreaAccountState.ledger.unshift({
    id: id("kr-ledger"),
    type: "etf_rebalance",
    date,
    amountKrw: capital,
    note: `${etf.label} 리밸런싱 기록`
  });
  saveKoreaAccount();
  renderKoreaAccount();
}

function recordKoreaStockBuy(symbol) {
  if (!koreaAccountState) return;
  syncKoreaAccountSettingsFromForm();
  const stock = koreaStockStrategy();
  const row = (stock?.currentPicks ?? []).find((item) => item.symbol === symbol);
  if (!row) return;
  const pickCount = Math.max(1, stock?.currentPicks?.length ?? 1);
  const guideAmount = (koreaAccountState.settings.stockCapital || 0) * 0.15 / pickCount;
  const buyDate = window.prompt("매수일", todayDate()) || todayDate();
  const investedKrw = Math.max(0, parseAmount(window.prompt("매수 금액(원)", String(Math.round(guideAmount)))));
  if (!investedKrw) return;
  const buyPriceKrw = Math.max(0, parseAmount(window.prompt("실제 매수가(원)", String(row.close ?? ""))));
  if (!buyPriceKrw) return;
  const shares = investedKrw / buyPriceKrw;
  const lot = {
    id: id("kr-lot"),
    symbol: row.symbol,
    name: row.name,
    group: row.group,
    cohort: koreaCurrentMonth(),
    signalDate: koreaDashboard.asOf,
    buyDate,
    shares,
    buyPriceKrw,
    investedKrw,
    soldHalf: false,
    status: "open",
    halfSellDate: addMonthsToDate(buyDate, 6),
    maxExitDate: addMonthsToDate(buyDate, 12),
    sells: []
  };
  koreaAccountState.stockLots.unshift(lot);
  koreaAccountState.ledger.unshift({
    id: id("kr-ledger"),
    type: "stock_buy",
    date: buyDate,
    symbol: row.symbol,
    amountKrw: investedKrw,
    note: `${shares.toFixed(4)}주 @ ${krw(buyPriceKrw)}`
  });
  saveKoreaAccount();
  renderKoreaAccount();
}

function recordKoreaStockSell(lotId, mode) {
  if (!koreaAccountState) return;
  const lot = koreaAccountState.stockLots.find((row) => row.id === lotId);
  if (!lot) return;
  const remaining = koreaLotRemainingShares(lot);
  if (remaining <= 0) return;
  const defaultShares = mode === "half" ? Math.min(remaining, lot.shares / 2) : remaining;
  const shares = Number(window.prompt(`${lot.symbol} 매도 수량`, String(Number(defaultShares.toFixed(4)))));
  if (!Number.isFinite(shares) || shares <= 0 || shares > remaining) return;
  const sellPriceKrw = Math.max(0, parseAmount(window.prompt("실제 매도가(원)", String(lot.buyPriceKrw))));
  if (!sellPriceKrw) return;
  const sellDate = window.prompt("매도일", todayDate()) || todayDate();
  const proceedsKrw = shares * sellPriceKrw;
  const costBasisKrw = lot.investedKrw * (shares / lot.shares);
  const realizedKrw = proceedsKrw - costBasisKrw;
  lot.sells = lot.sells ?? [];
  lot.sells.push({ date: sellDate, shares, sellPriceKrw, proceedsKrw, realizedKrw });
  if (mode === "half") lot.soldHalf = true;
  if (koreaLotRemainingShares(lot) <= 0.000001) lot.status = "closed";
  koreaAccountState.ledger.unshift({
    id: id("kr-ledger"),
    type: "stock_sell",
    date: sellDate,
    symbol: lot.symbol,
    amountKrw: proceedsKrw,
    realizedKrw,
    note: `${shares.toFixed(4)}주 @ ${krw(sellPriceKrw)}`
  });
  saveKoreaAccount();
  renderKoreaAccount();
}

function renderKoreaStart() {
  if (!koreaDashboard) return;
  const etf = selectedKoreaEtfStrategy();
  const stock = koreaStockStrategy();
  const etfCapital = Math.max(0, parseAmount(document.getElementById("korea-etf-capital")?.value));
  const stockCapital = Math.max(0, parseAmount(document.getElementById("korea-stock-capital")?.value));

  const etfSummary = document.getElementById("korea-etf-start-summary");
  if (etfSummary) etfSummary.innerHTML = `
    <article class="kpi"><span>한국 ETF 계좌</span><strong>${krw(etfCapital)}</strong><small>${etf?.label ?? "-"}</small></article>
    <article class="kpi"><span>ETF 백테스트</span><strong class="${signedClass(etf?.capitalAccount?.totalReturn)}">${percent(etf?.capitalAccount?.totalReturn)}</strong><small>MDD ${percent(etf?.capitalAccount?.maxDrawdown)}</small></article>
    <article class="kpi"><span>운용 방식</span><strong>월간 리밸런싱</strong><small>월말 확정 후 다음 거래일</small></article>
  `;

  const stockSummary = document.getElementById("korea-stock-start-summary");
  if (stockSummary) stockSummary.innerHTML = `
    <article class="kpi"><span>한국 주식 계좌</span><strong>${krw(stockCapital)}</strong><small>${stock?.label ?? "-"}</small></article>
    <article class="kpi"><span>주식 백테스트</span><strong class="${signedClass(stock?.capitalAccount?.totalReturn)}">${percent(stock?.capitalAccount?.totalReturn)}</strong><small>MDD ${percent(stock?.capitalAccount?.maxDrawdown)}</small></article>
    <article class="kpi"><span>매도 규칙</span><strong>6개월 50%</strong><small>잔여 50%는 주봉 점검</small></article>
  `;

  const etfRules = document.getElementById("korea-etf-rule-cards");
  if (etfRules) etfRules.innerHTML = `
    <article>
      <h3>시장 상태</h3>
      <p>월말 KODEX200이 200일선 위이고 모멘텀이 양수면 강한 장세, 아니면 약한 장세로 판정합니다.</p>
    </article>
    <article>
      <h3>강한 장세</h3>
      <p>KOSPI200과 반도체·자동차·2차전지 등 알파 후보 중 점수가 가장 높은 ETF 1개를 100% 보유합니다.</p>
    </article>
    <article>
      <h3>약한 장세</h3>
      <p>금·채권 등 방어 후보 중 점수가 가장 높은 ETF 1개를 100% 보유하고, 다음 월말에 다시 판정합니다.</p>
    </article>
  `;

  document.getElementById("korea-start-etf").innerHTML = (etf?.currentPicks ?? []).map((row) => `
    <article class="planner-card buy">
      <strong>${row.symbol}</strong>
      <span>${row.name} | ${row.group}</span>
      <span>${weightText(row.weight)} / ${krw(etfCapital * (row.weight ?? 0))}</span>
      <small>월말 확정 후 다음 거래일에 전체 ETF 계좌를 목표 비중으로 맞춥니다.</small>
    </article>
  `).join("");

  const stockBuyAmount = stockCapital * 0.15 / Math.max(1, stock?.currentPicks?.length ?? 1);
  document.getElementById("korea-start-stocks").innerHTML = (stock?.currentPicks ?? []).map((row) => `
    <article class="planner-card buy">
      <strong>${row.symbol}</strong>
      <span>${row.name} | ${row.group}</span>
      <span>가이드 금액 ${krw(stockBuyAmount)}</span>
      <small>차트 확인 후 진입, 6개월 뒤 50% 매도와 주봉 연장 규칙을 적용합니다.</small>
    </article>
  `).join("");
}

function renderKoreaAccount() {
  if (!koreaDashboard) return;
  if (!koreaAccountState) koreaAccountState = loadKoreaAccount();
  const etf = selectedKoreaEtfStrategy();
  const stock = koreaStockStrategy();
  const etfCapital = koreaAccountState.settings.etfCapital || Math.max(0, parseAmount(document.getElementById("korea-etf-capital")?.value));
  const stockCapital = koreaAccountState.settings.stockCapital || Math.max(0, parseAmount(document.getElementById("korea-stock-capital")?.value));
  const openLots = koreaAccountState.stockLots.filter((lot) => koreaLotStatus(lot) !== "closed");
  const realized = koreaAccountState.ledger
    .filter((row) => row.type === "stock_sell")
    .reduce((sum, row) => sum + (Number(row.realizedKrw) || 0), 0);
  const latestRebalance = koreaAccountState.etfRebalances[0];

  document.getElementById("korea-account-meta").textContent = `${koreaDashboard.asOf} 기준 | ETF와 주식 계좌 분리`;
  document.getElementById("korea-account-summary").innerHTML = `
    <article class="kpi"><span>ETF 계좌 모드</span><strong>${etf?.label ?? "-"}</strong><small>${krw(etfCapital)} 기준</small></article>
    <article class="kpi"><span>ETF 기록</span><strong>${koreaAccountState.etfRebalances.length}회</strong><small>최근 ${latestRebalance?.date ?? "-"}</small></article>
    <article class="kpi"><span>한국 주식 lot</span><strong>${openLots.length}개</strong><small>${krw(stockCapital)} 기준</small></article>
    <article class="kpi"><span>실현 손익</span><strong class="${signedClass(realized)}">${krw(realized)}</strong><small>매도 기록 기준</small></article>
  `;

  document.getElementById("korea-account-etf").innerHTML = `
    <article class="account-card urgent">
      <div>
        <strong>이번 달 ETF 리밸런싱</strong>
        <span>${etf?.label ?? "-"} | ${koreaCurrentMonth()} 기준</span>
      </div>
      <button class="secondary-button" data-korea-action="record-etf-rebalance" type="button">리밸런싱 기록</button>
    </article>
    ${(etf?.currentPicks ?? []).map((row) => `
      <article class="account-card">
        <strong>${row.symbol}</strong>
        <span>${row.name} | ${row.group}</span>
        <div class="account-card-metrics">
          <span>목표 ${weightText(row.weight)}</span>
          <span>금액 ${krw(etfCapital * (row.weight ?? 0))}</span>
          <span>3M ${percent(row.r3m)}</span>
        </div>
      </article>
    `).join("")}
    <div class="account-history">
      <strong>최근 ETF 기록</strong>
      ${koreaAccountState.etfRebalances.length ? koreaAccountState.etfRebalances.slice(0, 5).map((record) => `
        <article class="mini-record">
          <span>${record.date} | ${record.strategyLabel}</span>
          <b>${krw(record.capital)}</b>
          <small>${record.targets.map((target) => `${target.symbol} ${weightText(target.weight)}`).join(" / ")}</small>
        </article>
      `).join("") : `<p class="empty-state">아직 ETF 리밸런싱 기록이 없습니다.</p>`}
    </div>
  `;

  const stockBuyAmount = stockCapital * 0.15 / Math.max(1, stock?.currentPicks?.length ?? 1);
  document.getElementById("korea-account-stocks").innerHTML = `
    ${(stock?.currentPicks ?? []).map((row) => `
      <article class="account-card">
        <div>
          <strong>${row.symbol}</strong>
          <span>${row.name} | ${row.group}</span>
        </div>
        <div class="account-card-metrics">
          <span>가이드 ${krw(stockBuyAmount)}</span>
          <span>현재가 ${krw(row.close)}</span>
          <span>1M ${percent(row.r1m)} / 6M ${percent(row.r6m)}</span>
        </div>
        <button class="secondary-button" data-korea-action="record-stock-buy" data-symbol="${row.symbol}" type="button">매수 기록</button>
      </article>
    `).join("")}
    <div class="account-history">
      <strong>보유/점검 lot</strong>
      ${openLots.length ? openLots.map((lot) => {
        const status = koreaLotStatus(lot);
        const remaining = koreaLotRemainingShares(lot);
        const currentPick = (stock?.currentPicks ?? []).find((row) => row.symbol === lot.symbol);
        const currentPrice = currentPick?.close ?? lot.buyPriceKrw;
        const value = remaining * currentPrice;
        const cost = lot.investedKrw * (remaining / lot.shares);
        const ret = cost ? value / cost - 1 : 0;
        return `
          <article class="account-card">
            <div>
              <strong>${lot.symbol} ${remaining.toFixed(4)}주</strong>
              <span>${lot.name} | ${lot.cohort} 추천 | ${koreaLotStatusLabel(status)}</span>
            </div>
            <div class="account-card-metrics">
              <span>매수 ${formatDate(lot.buyDate)} @ ${krw(lot.buyPriceKrw)}</span>
              <span class="${signedClass(ret)}">현재 ${percent(ret)} | ${krw(value)}</span>
              <span>50% 예정 ${lot.halfSellDate} | 최종 점검 ${lot.maxExitDate}</span>
            </div>
            <div class="account-card-actions">
              ${!lot.soldHalf ? `<button class="secondary-button" data-korea-action="record-stock-sell" data-lot-id="${lot.id}" data-mode="half" type="button">50% 매도 기록</button>` : ""}
              <button class="secondary-button" data-korea-action="record-stock-sell" data-lot-id="${lot.id}" data-mode="full" type="button">나머지 매도 기록</button>
            </div>
          </article>
        `;
      }).join("") : `<p class="empty-state">아직 한국 주식 매수 기록이 없습니다. 후보 카드에서 매수 기록을 남기면 여기에 표시됩니다.</p>`}
    </div>
  `;
}

function setupKoreaPlanner() {
  koreaAccountState = loadKoreaAccount();
  applyKoreaAccountSettingsToForm();
  const forms = [
    document.getElementById("korea-stock-planner-form"),
    document.getElementById("korea-etf-planner-form")
  ].filter(Boolean);
  if (!forms.length) return;
  ["korea-etf-capital", "korea-stock-capital"].forEach((id) => {
    const input = document.getElementById(id);
    if (!input) return;
    formatIntegerInput(input);
    input.addEventListener("blur", () => {
      formatIntegerInput(input);
      syncKoreaAccountSettingsFromForm();
      renderKoreaStart();
      renderKoreaAccount();
    });
  });
  forms.forEach((form) => {
    form.addEventListener("input", () => {
      syncKoreaAccountSettingsFromForm();
      renderKoreaStart();
      renderKoreaAccount();
    });
    form.addEventListener("change", () => {
      syncKoreaAccountSettingsFromForm();
      renderKoreaStart();
      renderKoreaAccount();
    });
  });
  document.getElementById("korea-account-panel")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-korea-action]");
    if (!button) return;
    if (button.dataset.koreaAction === "record-etf-rebalance") recordKoreaEtfRebalance();
    if (button.dataset.koreaAction === "record-stock-buy") recordKoreaStockBuy(button.dataset.symbol);
    if (button.dataset.koreaAction === "record-stock-sell") recordKoreaStockSell(button.dataset.lotId, button.dataset.mode);
  });
  renderKoreaStart();
  renderKoreaAccount();
}

function renderKoreaEmpty() {
  const meta = document.getElementById("korea-meta");
  if (meta) meta.textContent = "아직 백테스트 데이터 없음";
  const message = `
    <article class="kpi"><span>한국 전략</span><strong>준비중</strong><small>npm run test:korea 실행 후 표시</small></article>
  `;
  document.getElementById("korea-kpis").innerHTML = message;
  document.getElementById("korea-current-picks").innerHTML = `<p class="empty-state">한국 백테스트 데이터가 아직 생성되지 않았습니다.</p>`;
  document.getElementById("korea-summary-body").innerHTML = "";
  document.getElementById("korea-summary-cards").innerHTML = "";
  document.getElementById("korea-stock-monthly-sell-body").innerHTML = "";
  document.getElementById("korea-stock-monthly-sell-cards").innerHTML = "";
  document.getElementById("korea-trades-body").innerHTML = "";
  document.getElementById("korea-trades-cards").innerHTML = "";
  document.getElementById("korea-etf-kpis").innerHTML = message;
  document.getElementById("korea-etf-current-picks").innerHTML = `<p class="empty-state">한국 ETF 백테스트 데이터가 아직 생성되지 않았습니다.</p>`;
  document.getElementById("korea-etf-summary-body").innerHTML = "";
  document.getElementById("korea-etf-summary-cards").innerHTML = "";
  document.getElementById("korea-etf-monthly-return-body").innerHTML = "";
  document.getElementById("korea-etf-monthly-return-cards").innerHTML = "";
  document.getElementById("korea-etf-rebalance-body").innerHTML = "";
  document.getElementById("korea-etf-rebalance-cards").innerHTML = "";
}

function renderKoreaEtfBacktest() {
  const strategy = activeKoreaEtfStrategy();
  if (!strategy) return;
  const summary = strategy.summary ?? {};
  const account = strategy.capitalAccount ?? {};
  const etfPerformanceRows = koreaEtfPerformanceRows();
  const benchmarkReturn = lastFiniteReturn(etfPerformanceRows, "benchmarkTotalReturn");
  document.getElementById("korea-etf-backtest-meta").textContent = `${koreaEtfValidation?.asOf ?? koreaDashboard.asOf} 기준 | ${strategy.months ?? 0}개월`;
  renderBacktestKpis("korea-etf-kpis", {
    finalValue: krw(account.finalCapital),
    finalValueNote: "1천만원 시작 | ETF 계좌",
    strategyReturn: account.totalReturn,
    strategyNote: "ETF-I 월간 1개 리밸런싱",
    benchmarkLabel: benchmarkLabel(strategy.benchmarkSymbol),
    benchmarkReturn,
    activityLabel: "리밸런싱",
    activityValue: `${summary.tradeCount ?? 0}개월`,
    activityNote: `MDD ${percent(account.maxDrawdown)} | 보유 ETF ${summary.openCount ?? 0}개`
  });

  renderBacktestTemplate("korea-etf-backtest-template", {
    asset: "한국 ETF",
    tone: "kr-etf",
    strategyName: strategy.label,
    description: "강한 장세에는 최상위 알파 ETF, 약한 장세에는 방어 ETF 1개를 선택해 연금/ETF 계좌를 월간 리밸런싱합니다.",
    benchmarkLabel: benchmarkLabel(strategy.benchmarkSymbol),
    periodLabel: etfPerformanceRows.length ? `${etfPerformanceRows[0].asOf ?? etfPerformanceRows[0].month} ~ ${etfPerformanceRows.at(-1).asOf ?? etfPerformanceRows.at(-1).month}` : "기간 데이터 없음",
    strategyReturn: account.totalReturn,
    benchmarkReturn,
    maxDrawdown: account.maxDrawdown,
    tradeCountLabel: `${summary.tradeCount ?? 0}개월`,
    tradeNote: "월 1회 ETF 1개로 전체 계좌 리밸런싱",
    winRateLabel: "-",
    winRateNote: "ETF 전략은 승률보다 누적/낙폭 중심",
    ruleSummary: "매월 말 시장 상태를 판정합니다. 강한 장세에는 가장 강한 알파 ETF 1개, 약한 장세에는 가장 강한 방어 ETF 1개를 확정하고 다음 거래일에 계좌 전체를 100% 목표 비중으로 맞춥니다. 별도 6개월 매도 규칙은 쓰지 않습니다."
  });

  document.getElementById("korea-etf-current-picks").innerHTML = `
    <article class="korea-strategy-card">
      <div class="card-head">
        <div>
          <span class="label">${strategy.label}</span>
          <h3>${strategy.currentPicks?.length ?? 0}개 ETF</h3>
        </div>
        <strong>${benchmarkLabel(strategy.benchmarkSymbol)}</strong>
      </div>
      <div class="korea-pick-list">
        ${(strategy.currentPicks ?? []).map((row) => `
          <div class="korea-pick">
            <div class="card-head">
              <div>
                <h3>${row.symbol}</h3>
                <p>${row.name} | ${row.group}</p>
              </div>
              <strong>${weightText(row.weight)}</strong>
            </div>
            ${miniChart(row)}
            <div class="metric-line">
              <span>점수 ${number(row.score, 1)}</span>
              <span>1M ${percent(row.r1m)}</span>
              <span>3M ${percent(row.r3m)}</span>
              <span>6M ${percent(row.r6m)}</span>
            </div>
          </div>
        `).join("") || `<p class="empty-state">현재 후보 없음</p>`}
      </div>
    </article>
  `;

  renderComparisonPerformanceChart({
    targetId: "korea-etf-performance-chart",
    metaId: "korea-etf-curve-meta",
    rows: koreaEtfPerformanceRows(),
    strategyKey: "strategyTotalReturn",
    benchmarkKey: "benchmarkTotalReturn",
    strategyLabel: "ETF 전략",
    benchmarkLabel: "KOSPI200",
    ariaLabel: "Korea ETF strategy versus KOSPI200 performance chart"
  });

  document.getElementById("korea-etf-summary-body").innerHTML = `
    <tr>
      <td><strong>${strategy.label}</strong><div class="sub">${benchmarkLabel(strategy.benchmarkSymbol)} 비교</div></td>
      <td class="num">${summary.tradeCount ?? 0}</td>
      <td class="num">${summary.openCount ?? 0}</td>
      <td class="num ${signedClass(account.totalReturn)}">${percent(account.totalReturn)}</td>
      <td class="num ${signedClass(summary.averageBenchmarkReturn)}">${percent(summary.averageBenchmarkReturn)}</td>
      <td class="num ${signedClass(summary.averageExcessBenchmark)}">${percent(summary.averageExcessBenchmark)}</td>
      <td class="num">${krw(account.finalCapital)}</td>
      <td class="num negative">${percent(account.maxDrawdown)}</td>
    </tr>
  `;
  document.getElementById("korea-etf-summary-cards").innerHTML = `
    <article class="result-card">
      <div class="card-head">
        <div>
          <h3>${strategy.label}</h3>
          <p>${benchmarkLabel(strategy.benchmarkSymbol)} 비교</p>
        </div>
        <strong class="${signedClass(account.totalReturn)}">${percent(account.totalReturn)}</strong>
      </div>
      <div class="metric-line">
        <span>리밸런싱 ${summary.tradeCount ?? 0}개월</span>
        <span>KOSPI200 ${percent(summary.averageBenchmarkReturn)}</span>
        <span>KOSPI 초과 ${percent(summary.averageExcessBenchmark)}</span>
        <span>계좌 ${krw(account.finalCapital)}</span>
        <span>MDD ${percent(account.maxDrawdown)}</span>
      </div>
    </article>
  `;

  renderKoreaEtfMonthlyReturns();
  renderKoreaEtfRebalances();
}

function renderKorea() {
  if (!koreaDashboard) {
    renderKoreaEmpty();
    return;
  }

  const strategies = [koreaStockStrategy()].filter(Boolean);
  document.getElementById("korea-meta").textContent = `${koreaDashboard.asOf} 기준 | ${koreaDashboard.years}년 | 오류 ${koreaDashboard.universe?.errorCount ?? 0}건`;

  const mainStockStrategy = strategies[0];
  if (mainStockStrategy) {
    const summary = mainStockStrategy.summary ?? {};
    const account = mainStockStrategy.capitalAccount ?? {};
    const stockPerformanceRows = koreaStockPerformanceRows();
    const benchmarkReturn = lastFiniteReturn(stockPerformanceRows, "benchmarkTotalReturn");
    renderBacktestKpis("korea-kpis", {
      finalValue: krw(account.finalCapital),
      finalValueNote: "1천만원 시작 | 한국 주식 계좌",
      strategyReturn: account.totalReturn,
      strategyNote: "자금 제한 반영",
      benchmarkLabel: benchmarkLabel(mainStockStrategy.benchmarkSymbol),
      benchmarkReturn,
      activityLabel: "매수/청산",
      activityValue: `${summary.tradeCount ?? 0}건`,
      activityNote: `청산 ${summary.realizedCount ?? 0}건 / 보유 ${summary.openCount ?? 0}건 | MDD ${percent(account.maxDrawdown)}`
    });

    renderBacktestTemplate("korea-stock-backtest-template", {
      asset: "한국 주식",
      tone: "kr-stock",
      strategyName: mainStockStrategy.label,
      description: "한국 우량주 유니버스에서 월간 주도 업종 대표 종목을 선정하고, 6개월 50% 매도 후 잔여 물량은 주봉 추세로 관리합니다.",
      benchmarkLabel: benchmarkLabel(mainStockStrategy.benchmarkSymbol),
      periodLabel: stockPerformanceRows.length ? `${stockPerformanceRows[0].asOf ?? stockPerformanceRows[0].month} ~ ${stockPerformanceRows.at(-1).asOf ?? stockPerformanceRows.at(-1).month}` : "기간 데이터 없음",
      strategyReturn: account.totalReturn,
      benchmarkReturn,
      maxDrawdown: account.maxDrawdown,
      tradeCountLabel: `${summary.tradeCount ?? 0}건`,
      tradeNote: `청산 ${summary.realizedCount ?? 0}건 / 보유 ${summary.openCount ?? 0}건`,
      winRateLabel: plainPercent(summary.winRate),
      winRateNote: "청산 완료 기준",
      ruleSummary: "월말 주도 업종 상위 2곳에서 각 1개 우량주를 선정합니다. 각 매수 lot은 6개월 후 50%를 매도하고, 남은 50%는 주봉 조건이 유지될 때만 연장 보유합니다."
    });
  }

  document.getElementById("korea-current-picks").innerHTML = strategies.map((strategy) => `
    <article class="korea-strategy-card">
      <div class="card-head">
        <div>
          <span class="label">${strategy.label}</span>
          <h3>${strategy.currentPicks?.length ?? 0}개 후보</h3>
        </div>
        <strong>${benchmarkLabel(strategy.benchmarkSymbol)}</strong>
      </div>
      <div class="korea-pick-list">
        ${(strategy.currentPicks ?? []).map((row) => `
          <div class="korea-pick">
            <div class="card-head">
              <div>
                <h3>${row.symbol}</h3>
                <p>${row.name} | ${row.group}</p>
              </div>
              <strong class="${signedClass(row.r3m)}">${percent(row.r3m)}</strong>
            </div>
            ${miniChart(row)}
            <div class="metric-line">
              <span>점수 ${number(row.score, 1)}</span>
              <span>1M ${percent(row.r1m)}</span>
              <span>6M ${percent(row.r6m)}</span>
              <span>거래대금 ${krw(row.avgValue20)}</span>
            </div>
          </div>
        `).join("") || `<p class="empty-state">현재 후보 없음</p>`}
      </div>
    </article>
  `).join("");

  renderComparisonPerformanceChart({
    targetId: "korea-stock-performance-chart",
    metaId: "korea-stock-curve-meta",
    rows: koreaStockPerformanceRows(),
    strategyKey: "strategyTotalReturn",
    benchmarkKey: "benchmarkTotalReturn",
    strategyLabel: "주식 전략",
    benchmarkLabel: "KOSPI200",
    ariaLabel: "Korea stock strategy versus KOSPI200 performance chart"
  });

  document.getElementById("korea-summary-body").innerHTML = strategies.map((strategy) => {
    const s = strategy.summary ?? {};
    const account = strategy.capitalAccount ?? {};
    return `
      <tr>
        <td><strong>${strategy.label}</strong><div class="sub">${benchmarkLabel(strategy.benchmarkSymbol)} 비교</div></td>
        <td class="num">${s.tradeCount ?? 0}</td>
        <td class="num">${s.realizedCount ?? 0}</td>
        <td class="num">${s.openCount ?? 0}</td>
        <td class="num ${signedClass(s.averageReturn)}">${percent(s.averageReturn)}</td>
        <td class="num ${signedClass(s.averageBenchmarkReturn)}">${percent(s.averageBenchmarkReturn)}</td>
        <td class="num ${signedClass(s.averageExcessBenchmark)}">${percent(s.averageExcessBenchmark)}</td>
        <td class="num">${plainPercent(s.winRate)}</td>
        <td class="num ${signedClass(account.totalReturn)}">${percent(account.totalReturn)}<div class="sub">${krw(account.finalCapital)}</div></td>
        <td class="num negative">${percent(account.maxDrawdown)}</td>
        <td class="num">${account.skippedBuys ?? 0}</td>
      </tr>
    `;
  }).join("");

  document.getElementById("korea-summary-cards").innerHTML = strategies.map((strategy) => {
    const s = strategy.summary ?? {};
    const account = strategy.capitalAccount ?? {};
    return `
      <article class="result-card">
        <div class="card-head">
          <div>
            <h3>${strategy.label}</h3>
            <p>${benchmarkLabel(strategy.benchmarkSymbol)} 비교</p>
          </div>
          <strong class="${signedClass(account.totalReturn)}">${percent(account.totalReturn)}</strong>
        </div>
        <div class="metric-line">
          <span>매수 ${s.tradeCount ?? 0}</span>
          <span>청산 ${s.realizedCount ?? 0}</span>
          <span>보유 ${s.openCount ?? 0}</span>
          <span>승률 ${plainPercent(s.winRate)}</span>
          <span>KOSPI 초과 ${percent(s.averageExcessBenchmark)}</span>
          <span>계좌 ${krw(account.finalCapital)}</span>
          <span>MDD ${percent(account.maxDrawdown)}</span>
          <span>스킵 ${account.skippedBuys ?? 0}</span>
        </div>
      </article>
    `;
  }).join("");

  const trades = koreaTradeRows()
    .sort((a, b) => String(b.entryDate).localeCompare(String(a.entryDate)))
    .slice(0, 30);
  document.getElementById("korea-trades-meta").textContent = `최근 ${trades.length}건 / 전체 ${koreaTradeRows().length}건`;
  document.getElementById("korea-trades-body").innerHTML = trades.map((row) => `
    <tr>
      <td>${row.strategyLabel}</td>
      <td>${row.month}</td>
      <td><strong>${row.symbol}</strong><div class="sub">${row.name}</div></td>
      <td>${row.group}</td>
      <td>${row.entryDate}<div class="sub">@ ${krw(row.entryPrice)}</div></td>
      <td>${row.status}<div class="sub">${(row.events ?? []).map((event) => `${event.date} ${event.reason}`).join(" / ")}</div></td>
      <td class="num ${signedClass(row.realizedReturn)}">${percent(row.realizedReturn)}</td>
      <td class="num ${signedClass(row.currentReturn)}">${percent(row.currentReturn)}</td>
    </tr>
  `).join("");
  document.getElementById("korea-trades-cards").innerHTML = trades.map((row) => `
    <article class="result-card">
      <div class="card-head">
        <div>
          <h3>${row.symbol}</h3>
          <p>${row.strategyLabel} | ${row.month} 추천</p>
        </div>
        <strong class="${signedClass(row.currentReturn)}">${percent(row.currentReturn)}</strong>
      </div>
      <div class="mobile-price">
        <span>${row.name}</span>
        <span>${row.group}</span>
      </div>
      <div class="metric-line">
        <span>매수 ${row.entryDate}</span>
        <span>@ ${krw(row.entryPrice)}</span>
        <span>실현 ${percent(row.realizedReturn)}</span>
      </div>
      <p class="reason">${row.status} ${(row.events ?? []).map((event) => `${event.date} ${event.reason}`).join(" / ")}</p>
    </article>
  `).join("");

  renderKoreaStockMonthlySells();
  renderKoreaEtfBacktest();
}

function strategyStatusLabel(status) {
  return {
    active: "운용 중",
    testing: "테스트 중",
    paused: "보류",
    retired: "폐기"
  }[status] ?? status;
}

function strategyLibraryCard(strategy) {
  const metrics = strategy.backtest.metrics ?? {};
  const excess = Number.isFinite(metrics.strategyReturn) && Number.isFinite(metrics.benchmarkReturn)
    ? metrics.strategyReturn - metrics.benchmarkReturn
    : null;
  return `
    <article class="strategy-library-card ${strategy.tone}">
      <div class="strategy-library-head">
        <div>
          <span class="asset-badge">${strategy.asset}</span>
          <h3>${strategy.title}</h3>
          <p>${strategy.id} | ${strategyStatusLabel(strategy.status)} | ${strategy.rules.checkCycle}</p>
        </div>
        <span class="action-badge ${strategy.status === "active" ? "buy" : "warning"}">${strategyStatusLabel(strategy.status)}</span>
      </div>
      <div class="strategy-library-action">
        <strong>${strategy.today.summary}</strong>
        <span>${strategy.today.detail}</span>
      </div>
      <div class="strategy-library-metrics">
        ${templateMetric("전략", percent(metrics.strategyReturn), signedClass(metrics.strategyReturn))}
        ${templateMetric(strategy.benchmark.label, percent(metrics.benchmarkReturn), signedClass(metrics.benchmarkReturn))}
        ${templateMetric("초과", percent(excess), signedClass(excess))}
        ${templateMetric("MDD", percent(metrics.maxDrawdown), "negative")}
      </div>
      <div class="strategy-library-rules">
        <span>매수: ${strategy.rules.buy.join(" / ") || "-"}</span>
        <span>매도/리밸런싱: ${[...strategy.rules.sell, ...strategy.rules.rebalance].join(" / ") || "-"}</span>
      </div>
      <div class="template-foot">
        <span>후보 ${strategy.currentPicks.length}개 | 거래/리밸런싱 ${metrics.tradeCount ?? "-"}건</span>
        ${strategy.reportUrl
          ? `<a class="secondary-button" href="${strategy.reportUrl}" target="_blank" rel="noreferrer">검증 리포트</a>`
          : `<button class="secondary-button" data-go-tab="${strategy.tabs.backtest}" type="button">백테스트 보기</button>`}
      </div>
    </article>
  `;
}

function strategyLibraryHtml() {
  const strategies = buildStrategyCatalog();
  return `
    <section class="strategy-library-section">
      <div class="section-title">
        <div>
          <h2>전략 보관함</h2>
          <p>현재 운용 중인 전략들을 공통 템플릿으로 정리했습니다. 앞으로 새 전략도 이 구조에 등록한 뒤 화면에 노출합니다.</p>
        </div>
        <span>${strategies.length}개 등록</span>
      </div>
      <div class="strategy-library-grid">
        ${strategies.map(strategyLibraryCard).join("")}
      </div>
    </section>
    <section class="strategy-library-section">
      <div class="section-title compact">
        <div>
          <h2>새 전략 등록 필수 항목</h2>
          <p>전략이 늘어나도 화면을 새로 만들지 않기 위한 공통 입력 규격입니다.</p>
        </div>
      </div>
      <div class="template-principles">
        <article><strong>정체성</strong><span>전략 ID, 자산군, 시장, 상태, 기준 지표</span></article>
        <article><strong>오늘 행동</strong><span>상태 배지, 요약, 주요 버튼, 실행 대상</span></article>
        <article><strong>운용 규칙</strong><span>매수, 매도, 리밸런싱, 점검 주기</span></article>
        <article><strong>백테스트</strong><span>전략 누적, 기준 지표, 초과 수익, MDD, 승률</span></article>
        <article><strong>계좌 적용</strong><span>자본금 모델, 현재 보유, 다음 점검일</span></article>
        <article><strong>상태 관리</strong><span>운용 중, 테스트 중, 보류, 폐기</span></article>
      </div>
    </section>
  `;
}

function renderRules() {
  const panel = document.querySelector("#rules-panel .rules-panel");
  if (!panel) return;
  panel.innerHTML = `
    <div class="section-title">
      <div>
        <h2>전략 규칙과 보관함</h2>
        <p>현재 전략을 공통 템플릿으로 관리하고, 새 전략도 같은 규격으로 추가합니다.</p>
      </div>
      <span>공통 템플릿 v1</span>
    </div>
    ${strategyLibraryHtml()}
    <div class="rules-grid">
      <article>
        <h3>1. 투자 시작</h3>
        <ol>
          <li>투자 시작월, 총 자본금, 현재 현금, USD/KRW 환율을 입력합니다.</li>
          <li>시작월 이전 추천 종목은 소급 매수하지 않습니다.</li>
          <li>현재 월 후보 2개부터 새 계좌의 첫 매수 대상으로 봅니다.</li>
          <li>월중 후보는 관찰용이며, 실제 기준은 월말 확정 신호입니다.</li>
        </ol>
      </article>
      <article>
        <h3>2. 종목 선정</h3>
        <ul>
          <li>공식 전략명: Leader2 + Repeat Theme Combo Cap27.5</li>
          <li>월 신규 후보: 주도 섹터 상위 2개에서 각 1개 종목</li>
          <li>종목 선정은 Leader2 One Each 방식으로 고정합니다.</li>
          <li>중복 추천은 허용하지만 종목별 누적 원금 한도 27.5%를 넘기지 않습니다.</li>
          <li>주간 업데이트는 신규 매수 확정이 아니라 관찰과 보유 점검용입니다.</li>
        </ul>
      </article>
      <article>
        <h3>3. 매수 금액</h3>
        <ul>
          <li>공식 운용 모드: Repeat + Theme Combo Cap27.5</li>
          <li>기본 매수: 후보당 자본금의 7.5%</li>
          <li>초기 램프업: 시작 후 3개월 동안 현금이 충분하면 기본 10%에서 가중 적용</li>
          <li>가중 조건: 최근 12개월 반복 추천, AI/반도체 하드웨어, 강한 반복 테마</li>
          <li>현금 부족 구간: 기본 5%에서 가중 적용하거나 최소 주문 미만이면 대기</li>
          <li>종목별 누적 원금 한도: 자본금의 27.5%</li>
        </ul>
      </article>
      <article>
        <h3>4. 달러 환산</h3>
        <ul>
          <li>대시보드는 원화 자본금을 기준으로 매수 금액을 계산합니다.</li>
          <li>미국 주식 주문을 위해 USD/KRW 환율로 달러 예산을 함께 표시합니다.</li>
          <li>자동 환율 조회가 실패하거나 실제 환전 환율이 다르면 직접 수정합니다.</li>
          <li>1주 단위 주문은 살 수 있는 정수 주식 수만 계산하고 잔액은 현금으로 남깁니다.</li>
          <li>소수점 매수가 가능한 계좌라면 소수점 매수 모드를 사용할 수 있습니다.</li>
        </ul>
      </article>
      <article>
        <h3>5. 보유와 매도</h3>
        <ul>
          <li>각 매수 건은 독립된 월별 lot으로 관리합니다.</li>
          <li>기본 보유 6개월 도달 시 해당 lot의 50%를 매도합니다.</li>
          <li>남은 50%는 주봉 10주선 위 + RSI 50 이상이면 연장 보유합니다.</li>
          <li>10주선 2주 연속 이탈 또는 최대 12개월 도달 시 잔여분을 매도합니다.</li>
          <li>전략상 기본 손절은 없지만, 개별 악재나 급락장은 별도 수동 검토합니다.</li>
        </ul>
      </article>
      <article>
        <h3>6. 자본금 변동</h3>
        <ul>
          <li>입금이나 수익 증가분은 다음 월 매수 계산부터 반영합니다.</li>
          <li>출금이나 손실로 자본금이 줄면 현금부터 줄입니다.</li>
          <li>현금이 부족하면 매도 예정분, 주봉 약화분, 한도 초과 중복 종목 순서로 줄입니다.</li>
          <li>이미 지나간 월의 후보를 뒤늦게 매수하지 않습니다.</li>
        </ul>
      </article>
      <article>
        <h3>7. 실행 루틴</h3>
        <ol>
          <li>월말: 신규 후보 2개 확정 및 매수 금액 계산</li>
          <li>매수 전: 일봉, 4시간봉, 1시간봉으로 과열/진입 위치 확인</li>
          <li>매주: 보유 lot의 주봉 추세와 매도 예정일 점검</li>
          <li>다음 달: 새 후보 2개만 추가 검토하고 기존 lot은 별도 관리</li>
          <li>6개월/12개월: 부분 매도와 잔여 매도 규칙 실행</li>
        </ol>
      </article>
      <article>
        <h3>8. 한계와 주의</h3>
        <ul>
          <li>대시보드는 투자 판단 보조 도구이며 자동 주문 시스템이 아닙니다.</li>
          <li>백테스트에는 세금, 실제 환전 스프레드, 체결 슬리피지, 배당이 완전히 반영되지 않습니다.</li>
          <li>현재 데이터 기준의 후보는 미래 수익을 보장하지 않습니다.</li>
          <li>대시보드 수익률과 실제 계좌 수익률은 체결 시점과 환율 때문에 달라질 수 있습니다.</li>
        </ul>
      </article>
      <article>
        <h3>9. 한국 ETF ETF-I</h3>
        <ul>
          <li>대표 전략: ETF-I 주도·방어 1개</li>
          <li>월말 KODEX200이 200일선 위이고 모멘텀이 양수면 강한 장세로 봅니다.</li>
          <li>강한 장세에는 KOSPI 알파 후보 중 점수가 가장 높은 ETF 1개를 보유합니다.</li>
          <li>약한 장세에는 금·채권 등 방어 후보 중 점수가 가장 높은 ETF 1개를 보유합니다.</li>
          <li>매월 말 후보를 확정하고 다음 거래일에 계좌 전체를 선정 ETF 100%로 리밸런싱합니다.</li>
          <li>ETF 전략은 6개월 50% 매도 규칙을 쓰지 않고 월간 비중 조정이 매수와 매도 역할을 합니다.</li>
        </ul>
      </article>
      <article>
        <h3>10. 한국 우량주 Leader2</h3>
        <ul>
          <li>월말 기준 주도 업종 상위 2개에서 각 1개 우량주를 선정합니다.</li>
          <li>진입 전 일봉, 4시간봉, 1시간봉으로 과열과 눌림 여부를 확인합니다.</li>
          <li>각 매수 lot은 6개월 후 50%를 기본 매도합니다.</li>
          <li>남은 50%는 주봉 10주선과 RSI 조건이 살아 있으면 연장 보유합니다.</li>
          <li>KOSPI Only는 더 보수적인 대안으로, 코스닥 급등주 의존도를 줄이고 싶을 때 사용합니다.</li>
        </ul>
      </article>
      <article>
        <h3>11. 한국 계좌 분리 원칙</h3>
        <ul>
          <li>연금 계좌는 ETF-I 주도·방어 전략을 우선 후보로 둡니다.</li>
          <li>일반 계좌의 공격형 자금은 한국 우량주 Leader2로 분리합니다.</li>
          <li>한국 ETF와 한국 개별주는 매도 규칙이 다르므로 같은 수익률표로만 판단하지 않습니다.</li>
          <li>전략 변경은 백테스트 결과가 개선될 때만 반영하고, 대시보드에는 운용 중인 대표 전략을 우선 표시합니다.</li>
        </ul>
      </article>
    </div>
  `;
}

function primaryForTab(tab) {
  const normalizedTab = LEGACY_TAB_MAP[tab] ?? tab;
  return Object.entries(NAV_GROUPS).find(([, items]) => items.some((item) => item.tab === normalizedTab))?.[0] ?? "today";
}

function renderContextTabs(activeTab) {
  const target = document.getElementById("context-tabs");
  if (!target) return;
  const normalizedTab = LEGACY_TAB_MAP[activeTab] ?? activeTab;
  const primary = primaryForTab(normalizedTab);
  const items = NAV_GROUPS[primary] ?? [];
  target.innerHTML = items.length > 1
    ? `
      <span class="context-tabs-label">자산군 선택</span>
      <div class="context-tab-list">
        ${items.map((item) => `
          <button class="context-tab ${item.tab === normalizedTab ? "active" : ""}" data-context-tab="${item.tab}" type="button">${item.label}</button>
        `).join("")}
      </div>
    `
    : "";
}

function activateTab(tab, updateHash = true) {
  const normalizedTab = LEGACY_TAB_MAP[tab] ?? tab;
  const panelTab = PANEL_ALIASES[normalizedTab] ?? normalizedTab;
  const panel = document.getElementById(`${panelTab}-panel`);
  if (!panel) return;
  const primary = primaryForTab(normalizedTab);
  document.querySelectorAll(".tab-button").forEach((item) => item.classList.toggle("active", item.dataset.primary === primary));
  document.querySelectorAll(".tab-panel").forEach((item) => item.classList.toggle("active", item === panel));
  renderContextTabs(normalizedTab);
  if (updateHash) history.replaceState(null, "", `#${normalizedTab}`);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setupTabs() {
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => {
      activateTab(button.dataset.tab);
    });
  });
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-go-tab], [data-context-tab]");
    if (!button) return;
    activateTab(button.dataset.goTab || button.dataset.contextTab);
  });
  const initialTab = location.hash.replace("#", "");
  if (initialTab) {
    activateTab(initialTab, false);
  } else {
    renderContextTabs("today");
  }
  window.addEventListener("hashchange", () => {
    const tab = location.hash.replace("#", "");
    if (tab) activateTab(tab, false);
  });
}

async function main() {
  setupTabs();
  try {
    dashboard = await fetchJson("data/strategy-dashboard.json");
    koreaDashboard = await fetchOptionalJson("data/korea-strategy-dashboard.json");
    koreaEtfValidation = await fetchOptionalJson("data/korea-etf-score-variant-test.json");
    selectionStrategyLab = await fetchOptionalJson("data/selection-strategy-lab.json");
    finalStrategyValidation = await fetchOptionalJson("data/final-strategy-validation.json");
    scoreVariantTest = await fetchOptionalJson("data/sector-score-variant-test-corrected-frozen-20260711.json")
      ?? await fetchOptionalJson("data/sector-score-variant-test.json");
    scoreAScaleTest = await fetchOptionalJson("data/scale-execution-test-corrected-score-a-20260711.json");
    scoreAStrategyLab = await fetchOptionalJson("data/strategy-development-lab-corrected-score-a-20260711.json");
    scoreCScaleTest = await fetchOptionalJson("data/scale-execution-test-corrected-score-c-20260711.json")
      ?? await fetchOptionalJson("data/scale-execution-test-score-c.json");
    scoreCStrategyLab = await fetchOptionalJson("data/strategy-development-lab-corrected-score-c-20260711.json")
      ?? await fetchOptionalJson("data/strategy-development-lab-score-c.json");
    scoreACorrectedValidation = await fetchOptionalJson("data/score-a-c-corrected-validation.json");
    document.getElementById("meta").textContent = `${dashboard.asOf} | ${officialUsStrategyName} | updated ${new Date(dashboard.generatedAt).toLocaleString()}`;
    renderSummary();
    renderLeaders();
    renderBuys();
    renderSymbolHoldings();
    renderSymbolSellDue();
    renderBacktest();
    renderScoreCBacktest();
    renderKoreaInvest();
    renderKorea();
    renderTodayDashboard();
    renderRules();
    setupAccount();
    setupPlanner();
    setupKoreaPlanner();
  } catch (error) {
    document.getElementById("meta").textContent = error.message;
    document.querySelector("main").innerHTML = `<section class="panel"><h2>데이터 로드 실패</h2><p>${error.message}</p></section>`;
  }
}

main();
