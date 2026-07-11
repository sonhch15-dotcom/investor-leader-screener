import fs from "node:fs/promises";

const reportPath = "data/us-strategy-history-report.json";
const validationPath = "data/score-a-c-corrected-validation.json";
const [report, validation] = await Promise.all([
  fs.readFile(reportPath, "utf8").then(JSON.parse),
  fs.readFile(validationPath, "utf8").then(JSON.parse)
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function close(actual, expected, tolerance = 0.00015) {
  return Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;
}

function chronological(curve) {
  return curve.every((row, index) => index === 0 || row.date > curve[index - 1].date);
}

assert(report.schemaVersion === 1, "Unexpected history report schema version.");
assert(report.provenance.runId === validation.runId, "Validation run ID mismatch.");
assert(report.provenance.priceSnapshotHash === validation.provenance.priceSnapshotHash, "Price snapshot hash mismatch.");
assert(close(report.headline.scoreA.accountReturn, validation.scoreA.account.totalReturn), "Score A account return mismatch.");
assert(close(report.headline.scoreC.accountReturn, validation.scoreC.account.totalReturn), "Score C account return mismatch.");
assert(close(report.headline.scoreA.maxDrawdown, validation.scoreA.account.maxDrawdown), "Score A MDD mismatch.");
assert(close(report.headline.scoreC.maxDrawdown, validation.scoreC.account.maxDrawdown), "Score C MDD mismatch.");
assert(report.headline.scoreC.accountReturn > report.headline.scoreA.accountReturn, "Score C must exceed Score A in the frozen result.");
assert(report.headline.scoreC.robustReturn > report.headline.scoreA.robustReturn, "Score C robust result must exceed Score A.");

assert(report.selection.totalSlotsEach === 118, "Unexpected selection slot count.");
assert(report.selection.commonSlots + report.selection.aOnlySlots === report.selection.totalSlotsEach, "Score A slot reconciliation failed.");
assert(report.selection.commonSlots + report.selection.cOnlySlots === report.selection.totalSlotsEach, "Score C slot reconciliation failed.");
assert(report.selection.aOnlySlots === report.selection.cOnlySlots, "A-only and C-only slot counts differ.");
assert(report.selection.cOnly.averageReturn > report.selection.aOnly.averageReturn, "C-only average return must exceed A-only.");
assert(report.selection.cOnly.winRate < report.selection.aOnly.winRate, "Frozen result should document C's lower hit rate.");

for (const key of ["a", "c"]) {
  const exit = report.exits[key];
  assert(exit.improvedTrades + exit.worsenedTrades + exit.unchangedTrades === exit.pairedClosedTrades, `${key.toUpperCase()} paired exit counts do not reconcile.`);
  assert(exit.averageImprovement > 0, `${key.toUpperCase()} average exit improvement must be positive.`);
  assert(exit.robustAverageImprovement > 0, `${key.toUpperCase()} robust exit improvement must be positive.`);
  assert(report.account.current[key].totalReturn > report.account.fixedSixMonth[key].totalReturn, `${key.toUpperCase()} current account must exceed fixed six-month account.`);
  assert(chronological(report.account.current[key].curve), `${key.toUpperCase()} account curve is not chronological.`);
}

assert(chronological(report.account.current.qqq.curve), "QQQ curve is not chronological.");
const sourceIds = new Set(report.sources.map((source) => source.id));
assert(sourceIds.size === report.sources.length, "Duplicate source IDs found.");
assert(report.sources.every((source) => source.url.startsWith("https://")), "Every external source must use HTTPS.");
assert(report.regimes.every((regime) => regime.sourceIds.every((id) => sourceIds.has(id))), "A regime references a missing source.");
assert(report.caveats.some((item) => item.includes("생존자 편향")), "Survivorship-bias caveat is missing.");
assert(report.caveats.some((item) => item.includes("우측 검열")), "Right-censoring caveat is missing.");

console.log("US strategy history report verification passed.");
