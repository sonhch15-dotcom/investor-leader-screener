import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPriceSnapshot } from "../../src/backtest-price-snapshot.mjs";

const dir = path.dirname(fileURLToPath(import.meta.url));
const result = JSON.parse(await fs.readFile(path.join(dir, "result.json"), "utf8"));
const study = JSON.parse(await fs.readFile(path.join(dir, "study.json"), "utf8"));
const report = await fs.readFile(path.join(dir, "report.md"), "utf8");
const snapshot = await readPriceSnapshot(path.join(dir, "price-snapshot.json.gz"));

const expectedUniverse = [
  "SOXX", "XSW", "XLC",
  "KRE", "KCE", "KIE",
  "XBI", "XPH", "XHE", "XHS",
  "XOP", "XES",
  "XAR", "XTN",
  "XRT", "XHB",
  "XME", "RWR",
  "XLP", "XLU"
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function nearlyEqual(left, right, tolerance = 1e-4) {
  return Math.abs(left - right) <= tolerance;
}

function pct(value) {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
}

const strategy = result.main.strategy;
const benchmark = result.main.benchmark;
const broad = result.main.referenceBroadSector;
assert(result.studyId === study.id, "study identity does not match result");
assert(snapshot.hash === result.data.snapshotHash, "snapshot hash does not match result metadata");
assert(JSON.stringify(result.contract.universe) === JSON.stringify(expectedUniverse), "ETF universe or ordering changed");
assert(result.contract.universe.includes("SOXX") && result.contract.universe.includes("XLC"), "SOXX or XLC is missing");
assert(!result.contract.universe.includes("XSD") && !result.contract.universe.includes("XTL"), "excluded proxy returned to the universe");
assert(result.cohorts.count >= 80, "too few monthly cohorts");
assert(result.cohorts.selectionCount === result.cohorts.count * 2, "each cohort must create exactly two selections");
assert(result.audit.allCohortsHaveTwoPicks, "a cohort does not contain exactly two picks");
assert(result.audit.allRankingsHaveFullUniverse, "a signal did not rank all 20 ETFs");
assert(result.audit.noNegativeCash, "account cash became negative");
assert(result.audit.allExecutedBuysWithinPositionCap, "an executed buy exceeded the 27.5% cap");
assert(result.audit.broadControlNoNegativeCash, "broad-sector control cash became negative");
assert(result.audit.broadControlWithinPositionCap, "broad-sector control exceeded the 27.5% cap");
assert(result.audit.openLotsMarkedAtAsOf, "open lots were not marked at the common as-of date");
assert(strategy.firstDate === benchmark.firstDate && strategy.lastDate === benchmark.lastDate, "strategy and benchmark dates differ");
assert(strategy.firstDate === broad.firstDate && strategy.lastDate === broad.lastDate, "broad-sector reference dates differ");
assert(nearlyEqual(strategy.finalCapital / strategy.initialCapital - 1, strategy.totalReturn), "strategy return does not reconcile to final capital");
assert(nearlyEqual(benchmark.finalCapital / benchmark.initialCapital - 1, benchmark.totalReturn), "benchmark return does not reconcile to final capital");
assert(result.main.feeSensitivity.every((row, index, rows) => index === 0 || row.strategyReturn < rows[index - 1].strategyReturn), "strategy fee sensitivity is not monotonic");
assert(result.main.startDateSensitivity.length === 6, "fresh-start sensitivity is incomplete");
assert(result.main.startDateSensitivity.every((row) => Number.isFinite(row.excessReturn)), "fresh-start result is not finite");
assert(report.includes("미국 세부 산업 ETF") && report.includes(pct(strategy.totalReturn)) && report.includes(pct(benchmark.totalReturn)), "report headline does not match result data");
assert(study.dataContract.survivorshipBiasControlled === false, "current-product universe limitation must remain disclosed");

console.log(`Verified ${result.studyId}: ${result.reproducibilityHash}`);
