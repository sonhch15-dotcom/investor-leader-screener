import { createHash } from "node:crypto";
import fs from "node:fs/promises";

const result = JSON.parse(await fs.readFile("data/us-backtest-candidate-study.json", "utf8"));
const marketHistory = JSON.parse(await fs.readFile("data/us-candidate-market-history.json", "utf8"));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertClose(label, actual, expected, tolerance = 0.0001) {
  assert(Number.isFinite(actual), `${label} is not finite.`);
  assert(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected}, received ${actual}`);
}

function rows(section, count) {
  assert(result[section]?.rows?.length === count, `${section} row count changed.`);
  return result[section].rows;
}

assert(result.runId === "us-score-c-next-candidates-frozen-20260711-v1", "Unexpected run ID.");
assert(result.grade === "research", "Candidate study must remain research grade.");
assert(result.provenance.universeSize === 551, "Frozen universe size changed.");
assert(result.provenance.priceSnapshotHash === "493d56b6083cdf39d9d93920b9dbe051f7230b6478f465ce2843dc7eeefa3820", "Price snapshot hash changed.");
assert(marketHistory.hash === createHash("sha256").update(JSON.stringify(marketHistory.rows)).digest("hex"), "Market-history hash mismatch.");
assert(marketHistory.firstDate <= "2020-01-01", "QQQ warm-up history is too short.");
assert(marketHistory.asOf >= result.period.priceAsOf, "QQQ market history is stale.");

assertClose("Baseline total return", result.baseline.totalReturn, 5.2004);
assertClose("Baseline CAGR", result.baseline.cagr, 0.4557);
assertClose("Baseline MDD", result.baseline.maxDrawdown, -0.2038);
assertClose("Baseline robust return", result.baseline.robust.totalReturn, 4.6461);
assertClose("Baseline strict outlier return", result.baseline.strictOutlier.totalReturn, 3.1932);

const marketRows = rows("marketGate", 5);
assert(result.marketGate.below200Months === 15, "QQQ below-200 month count changed.");
assert(marketRows.every((row) => !row.status.passedResearchGate), "A market-gate candidate unexpectedly passed.");

const sectorRows = rows("sectorCap", 5);
assert(result.sectorCap.note.includes("one stock"), "Existing monthly sector rule is not documented.");
assert(sectorRows.every((row) => !row.status.passedResearchGate), "A sector-cap candidate unexpectedly passed.");

const exitRows = rows("exitSizing", 4);
assertClose("Rebuilt fixed-50 return", exitRows[0].totalReturn, result.baseline.totalReturn);
assertClose("Rebuilt fixed-50 MDD", exitRows[0].maxDrawdown, result.baseline.maxDrawdown);
assert(exitRows.every((row) => !row.status.passedResearchGate), "An exit-sizing candidate unexpectedly passed.");

const countRows = rows("monthlyCount", 5);
assert(result.monthlyCount.signalCounts[2] === 118, "Monthly two-stock trade count changed.");
assert(result.monthlyCount.signalCounts[3] === 177, "Monthly three-stock trade count changed.");
assert(result.monthlyCount.signalCounts[4] === 236, "Monthly four-stock trade count changed.");
assert(countRows.every((row) => !row.status.passedResearchGate), "A monthly-count candidate unexpectedly passed.");

assert(result.passedCandidates.length === 0, "No candidate should be promoted from this study.");
assert(result.pointInTimeUniverse.validReturnCalculated === false, "Point-in-time return must not be fabricated.");
assert(result.pointInTimeUniverse.status.includes("missing_point_in_time"), "Point-in-time data blocker is missing.");
assert(result.pointInTimeUniverse.dataOptions.length === 3, "Point-in-time data options are incomplete.");
assert(result.pointInTimeUniverse.dataOptions.every((row) => row.url.startsWith("https://")), "Point-in-time data links must use HTTPS.");
assert(Object.values(result.reproducibilityChecks).every(Boolean), "A reproducibility check failed.");

console.log("US candidate backtest verification passed.");
