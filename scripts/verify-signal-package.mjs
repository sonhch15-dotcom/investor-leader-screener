import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

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
  "backtests/summary.json"
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
  if (trend.trendState === "broken" && trend.exitConfirmed !== true) fail(`${trend.symbol} is broken without exitConfirmed`);
  if (trend.confirmationRequired === true && trend.exitConfirmed === true) fail(`${trend.symbol} cannot be pending and confirmed`);
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
