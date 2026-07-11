import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { strategyTransitionState, validateStrategyTransitions } from "../src/strategy-transition-contract.mjs";

const root = process.cwd();
const apiDir = path.join(root, "dist", "api");
const requiredFiles = [
  "signals/latest.json",
  "signals/us/latest.json",
  "signals/kr-stock/latest.json",
  "signals/kr-etf/latest.json",
  "weekly-trends/latest.json",
  "prices/latest.json",
  "fx/latest.json",
  "strategies/catalog.json",
  "backtests/summary.json",
  "selections/us-score-c/latest.json"
];
const strategyStatuses = new Set(["active", "candidate", "testing", "paused", "retired"]);
const markets = ["US_STOCK", "KR_STOCK", "KR_ETF"];

function fail(message) {
  throw new Error(`Signal package verification failed: ${message}`);
}

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

async function readJson(relativePath) {
  const raw = await fs.readFile(path.join(apiDir, relativePath), "utf8");
  return { raw, json: JSON.parse(raw) };
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""));
}

function verifySignal(signal) {
  if (!signal.signalId || !signal.market || !signal.strategyKey || !signal.actionType) {
    fail(`signal identity is incomplete: ${JSON.stringify(signal)}`);
  }
  if (!strategyStatuses.has(signal.strategyStatus)) fail(`${signal.signalId} has invalid strategyStatus ${signal.strategyStatus}`);
  if (!validDate(signal.validFrom) || !validDate(signal.validUntil) || signal.validFrom > signal.validUntil) {
    fail(`${signal.signalId} has invalid validity window`);
  }
  if (!signal.scoreFormulaVersion || !signal.sectorMapVersion || !signal.universeHash || !signal.backtestRunId || !signal.dataAsOf) {
    fail(`${signal.signalId} is missing reproducibility metadata`);
  }
}

const { json: manifest } = await readJson("manifest.json");
if (!String(manifest.schemaVersion ?? "").startsWith("1.")) fail("unsupported manifest schema");
if (manifest.status !== "normal") fail(`manifest status is ${manifest.status}`);
if (!Number.isInteger(manifest.minAppVersionCode) || manifest.minAppVersionCode < 1) fail("minAppVersionCode is missing");
if (!Array.isArray(manifest.capabilities) || !manifest.capabilities.includes("weekly_exit_v2")) fail("capabilities are incomplete");
if (!manifest.capabilities.includes("six_month_extension_v1")) fail("six_month_extension_v1 capability is missing");
if (!manifest.capabilities.includes("strategy_transition_v1")) fail("strategy_transition_v1 capability is missing");

const records = new Map((manifest.files ?? []).map((record) => [String(record.path ?? "").replace(/^\//, ""), record]));
for (const relativePath of requiredFiles) {
  const record = records.get(relativePath);
  if (!record) fail(`manifest is missing ${relativePath}`);
  const { raw } = await readJson(relativePath);
  if (record.sha256 !== sha256(raw)) fail(`${relativePath} sha256 mismatch`);
}

const { json: latest } = await readJson("signals/latest.json");
if (latest.status !== "normal" || !Array.isArray(latest.signals)) fail("latest signals are not normal");
latest.signals.forEach(verifySignal);
for (const market of markets) {
  const active = latest.signals.filter((signal) => signal.market === market && signal.strategyStatus === "active");
  if (!active.length) fail(`${market} has no active signal`);
  if (new Set(active.map((signal) => signal.strategyKey)).size !== 1) fail(`${market} has multiple active strategy keys`);
}

const { json: usSignals } = await readJson("signals/us/latest.json");
const { json: catalog } = await readJson("strategies/catalog.json");
if (JSON.stringify(latest.strategyTransitions ?? []) !== JSON.stringify(usSignals.strategyTransitions ?? [])) {
  fail("global and US strategyTransitions disagree");
}
const transitionErrors = validateStrategyTransitions({
  transitions: latest.strategyTransitions,
  signalMonth: latest.signalMonth,
  signals: latest.signals,
  catalogStrategies: catalog.strategies
});
if (transitionErrors.length) fail(transitionErrors.join("; "));

const { json: scoreCSelection } = await readJson("selections/us-score-c/latest.json");
const usTransition = latest.strategyTransitions?.find((row) => row.market === "US_STOCK");
if (!usTransition) fail("US_STOCK transition is missing");
if (scoreCSelection.status !== "normal" || scoreCSelection.complete !== true) fail("Score C live selection is incomplete");
if (scoreCSelection.signalMonth !== latest.signalMonth) fail("Score C selection month does not match signal package");
if (scoreCSelection.strategyKey !== usTransition.toStrategyKey) fail("Score C selection strategyKey mismatch");
if (scoreCSelection.selectionSource !== "live_score_c_last_friday_v1") fail("Score C selection is not from the live monthly path");
if (!Array.isArray(scoreCSelection.currentPicks) || scoreCSelection.currentPicks.length !== 2) fail("Score C must select two stocks");
if (Number(scoreCSelection.coverageRatio ?? 0) < 0.98) fail("Score C price coverage is below 98%");
if (Number(scoreCSelection.selectionLagDays ?? 99) > 3) fail("Score C selection data is stale");
const expectedSymbols = scoreCSelection.currentPicks.map((row) => row.symbol).sort().join(",");
const scoreCSignals = latest.signals.filter((row) => row.market === "US_STOCK" && row.strategyKey === usTransition.toStrategyKey);
const actualSymbols = scoreCSignals.map((row) => row.symbol).sort().join(",");
if (actualSymbols !== expectedSymbols) fail("Score C API symbols do not match the live selection");
if (scoreCSignals.some((row) => row.selectionSource !== scoreCSelection.selectionSource)) fail("Score C signal provenance is missing");

const transitionState = strategyTransitionState({
  transition: usTransition,
  signalMonth: latest.signalMonth,
  generatedAt: manifest.generatedAt
});
const transitionEffective = transitionState.effective;
if (transitionState.stale) fail("Score C transition is due but the signal package is stale");
if (transitionEffective) {
  if (manifest.minAppVersionCode < 59) fail("effective Score C package must require app versionCode 59");
  if (scoreCSignals.some((row) => String(row.validFrom).slice(0, 7) !== latest.signalMonth)) {
    fail("effective Score C signals must start in the effective signal month");
  }
} else if (manifest.minAppVersionCode !== 58) {
  fail("pre-transition package must keep minAppVersionCode 58");
}

const { json: etf } = await readJson("signals/kr-etf/latest.json");
const activeEtf = etf.signals?.find((signal) => signal.strategyStatus === "active" && signal.actionType === "rebalance");
if (!activeEtf) fail("KR_ETF has no active rebalance signal");
if (!Array.isArray(etf.targetWeights) || !etf.targetWeights.length) fail("KR_ETF targetWeights are empty");
const targetSum = etf.targetWeights.reduce((sum, target) => sum + Number(target.targetWeight ?? 0), 0);
if (Math.abs(targetSum - 1) > 0.000001) fail(`KR_ETF target weight sum is ${targetSum}`);
for (const target of etf.targetWeights) {
  if (target.strategyKey !== activeEtf.strategyKey) fail(`${target.symbol} target strategyKey mismatch`);
  if (!target.symbol || !(Number(target.referencePrice) > 0)) fail("KR_ETF target is incomplete");
}

const { json: weekly } = await readJson("weekly-trends/latest.json");
if (!Array.isArray(weekly.trends) || !weekly.trends.length) fail("weekly trends are empty");
for (const trend of weekly.trends) {
  const metrics = trend.metrics ?? {};
  if (!(trend.sixMonthExtensionEligible === null || typeof trend.sixMonthExtensionEligible === "boolean")) {
    fail(`${trend.symbol} has invalid sixMonthExtensionEligible`);
  }
  if (typeof trend.postExtensionExitConfirmed !== "boolean") fail(`${trend.symbol} is missing postExtensionExitConfirmed`);
  if (trend.exitConfirmed !== trend.postExtensionExitConfirmed) fail(`${trend.symbol} exit compatibility fields disagree`);
  if (trend.trendState === "broken" && trend.exitConfirmed !== true) fail(`${trend.symbol} is broken without exitConfirmed`);
  if (trend.confirmationRequired === true && trend.exitConfirmed === true) fail(`${trend.symbol} cannot be pending and confirmed`);
  if (trend.postExtensionExitConfirmed && Number(metrics.belowTrendWeeks ?? 0) < 2) {
    fail(`${trend.symbol} exits without a two-week MA10 break`);
  }
  if (metrics.exitReason === "rsi_below_50" || trend.postExtensionExitReason === "rsi_below_50") {
    fail(`${trend.symbol} cannot use RSI-only post-extension exit`);
  }
  if (trend.sixMonthExtensionEligible === true
      && (!(Number(trend.close) >= Number(trend.weeklyTrendLine)) || !(Number(metrics.rsi14) >= 50))) {
    fail(`${trend.symbol} has invalid six-month extension eligibility`);
  }
}

const { json: prices } = await readJson("prices/latest.json");
if (!Array.isArray(prices.quotes) || !prices.quotes.length) fail("prices are empty");
for (const quote of prices.quotes) {
  if (quote.status === "normal" && (!validDate(quote.priceDate) || !(Number(quote.price) > 0))) {
    fail(`${quote.symbol} normal quote is incomplete`);
  }
}

const { json: fx } = await readJson("fx/latest.json");
const usd = fx.rates?.find((rate) => rate.currency === "USD");
if (!usd || !(Number(usd.rate) > 0) || !validDate(fx.asOf)) fail("USD/KRW rate is incomplete");

console.log(`Verified signal package: ${latest.signals.length} signals, ${weekly.trends.length} trends, ${prices.quotes.length} quotes`);
