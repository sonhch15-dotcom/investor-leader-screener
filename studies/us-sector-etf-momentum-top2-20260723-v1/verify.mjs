import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPriceSnapshot } from "../../src/backtest-price-snapshot.mjs";

const dir = path.dirname(fileURLToPath(import.meta.url));
const result = JSON.parse(await fs.readFile(path.join(dir, "result.json"), "utf8"));
const report = await fs.readFile(path.join(dir, "report.md"), "utf8");
const snapshot = await readPriceSnapshot(path.join(dir, "price-snapshot.json.gz"));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function nearlyEqual(left, right, tolerance = 1e-4) {
  return Math.abs(left - right) <= tolerance;
}

const strategy = result.main.strategy;
const benchmark = result.main.benchmark;
assert(snapshot.hash === result.data.snapshotHash, "snapshot hash does not match result metadata");
assert(result.cohorts.count === 91 && result.cohorts.selectionCount === 182, "unexpected cohort or selection count");
assert(result.audit.allCohortsHaveTwoPicks, "a cohort does not contain exactly two picks");
assert(result.audit.allRankingsHaveElevenEtfs, "a signal did not rank all 11 ETFs");
assert(result.audit.noNegativeCash, "account cash became negative");
assert(result.audit.allExecutedBuysWithinPositionCap, "an executed buy exceeded the 27.5% cap");
assert(result.audit.openLotsMarkedAtAsOf, "open lots were not marked at the common as-of date");
assert(strategy.firstDate === benchmark.firstDate && strategy.lastDate === benchmark.lastDate, "strategy and benchmark dates differ");
assert(nearlyEqual(strategy.finalCapital / strategy.initialCapital - 1, strategy.totalReturn), "strategy return does not reconcile to final capital");
assert(nearlyEqual(benchmark.finalCapital / benchmark.initialCapital - 1, benchmark.totalReturn), "benchmark return does not reconcile to final capital");
assert(result.main.feeSensitivity.every((row, index, rows) => index === 0 || row.strategyReturn < rows[index - 1].strategyReturn), "strategy fee sensitivity is not monotonic");
assert(result.main.startDateSensitivity.every((row) => row.excessReturn < 0), "fresh-start conclusion changed");
assert(report.includes("+127.2%") && report.includes("+380.0%"), "report headline does not match result data");
assert(strategy.totalReturn < benchmark.totalReturn, "promotion decision no longer matches the result");

console.log(`Verified ${result.studyId}: ${result.reproducibilityHash}`);
