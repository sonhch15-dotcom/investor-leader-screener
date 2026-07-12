import assert from "node:assert/strict";
import fs from "node:fs/promises";

const result = JSON.parse(await fs.readFile("data/quantconnect-us-100m-capital-audit.json", "utf8"));
const report = await fs.readFile("dashboard/us-100m-capital-audit.html", "utf8");
const scenarios = new Map(result.scenarios.map((row) => [row.key, row]));

assert.equal(result.capitalContract.initialKrw, 100_000_000);
assert.equal(result.capitalContract.initialUsd, 66_604.5);
assert.equal(result.period.signalMonths, 188);
assert.equal(result.period.plannedLots, 376);
assert.equal(scenarios.size, 10);
assert.ok([...scenarios.values()].every((row) => row.cashSkips === 0), "cash skips must stay at zero");
for (const row of scenarios.values()) {
  assert.equal(row.buys + row.cashSkips + row.capSkips, row.attempts, `${row.key}: attempt accounting mismatch`);
  assert.ok(Math.abs(row.finalUsd / result.capitalContract.initialUsd - 1 - row.return) < 0.0002, `${row.key}: return does not match final USD`);
  assert.equal(Math.round(row.finalUsd * result.capitalContract.usdKrw), row.finalKrw, `${row.key}: KRW conversion mismatch`);
}

const a = scenarios.get("A_RAMP25");
const c = scenarios.get("C_RAMP25");
assert.ok(a && c, "stress ramp scenarios are missing");
assert.ok(a.return > c.return, "A must beat C under the coherent 100M stress contract");
assert.ok(a.cagr > c.cagr, "A CAGR must beat C");
assert.ok(a.mdd > c.mdd, "A drawdown must be shallower than C");
assert.ok(a.returnWithoutTop2 > c.returnWithoutTop2, "A must remain ahead after removing the two largest lots");
assert.ok(result.benchmark.stressReturn > a.return, "QQQ opportunity-cost warning must remain visible");
assert.equal(result.selectedDelistings.length, 4);
assert.equal(result.decision.selection, "Keep A active and C candidate");
assert.ok(report.includes("5억 1,175만원") && report.includes("+411.8%"), "A headline is stale");
assert.ok(report.includes("4억 8,951만원") && report.includes("+389.5%"), "C headline is stale");
assert.ok(report.includes("16억 1,907만원") && report.includes("+1,519.1%"), "QQQ headline is stale");

console.log("Verified US 100M KRW capital audit.");
