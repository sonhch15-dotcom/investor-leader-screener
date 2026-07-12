import fs from "node:fs/promises";

const data = JSON.parse(await fs.readFile("data/quantconnect-c-robustness-audit.json", "utf8"));
const universe = JSON.parse(await fs.readFile("data/universe-corrected-frozen-20260711.json", "utf8"));
const algorithm = await fs.readFile("research/quantconnect/us_long_horizon_audit.py", "utf8");
const report = await fs.readFile("quantconnect_c_robustness_audit.md", "utf8");
const html = await fs.readFile("dashboard/c-robustness-audit.html", "utf8");
const browserScript = await fs.readFile("dashboard/c-robustness-audit.js", "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function finite(value, label) {
  assert(Number.isFinite(value), `${label} must be finite`);
}

assert(data.runId === "us-score-a-c-quantconnect-long-robustness-20260712-v1", "Unexpected runId");
assert(data.status === "promotion_gate_failed", "Audit status must remain promotion_gate_failed");
assert(data.period.signalMonths === 188, "Expected 188 monthly signals");
assert(data.period.firstSignal === "2010-08-27", "Unexpected first signal date");
assert(data.period.lastPriceDate === "2026-04-13", "Unexpected last price date");

const stocks = universe.filter((row) => row.type === "stock");
const labels = new Set(stocks.map((row) => row.sector));
assert(stocks.length === data.classificationAudit.frozenStockCount, "Frozen stock count mismatch");
assert(labels.size === data.classificationAudit.frozenLabels, "Frozen classification label count mismatch");
assert(data.classificationAudit.broadSectorLabels + data.classificationAudit.granularIndustryLabels === labels.size, "Classification label split mismatch");

const runs = Object.values(data.runs);
for (const run of runs) {
  finite(run.a.return, "A return");
  finite(run.c.return, "C return");
  finite(run.a.mdd, "A MDD");
  finite(run.c.mdd, "C MDD");
  assert(run.a.attempts === 376 && run.c.attempts === 376, "Every long run must preserve 376 attempted buys");
  assert(run.a.buys + run.a.skips === 376, "A buy accounting mismatch");
  assert(run.c.buys + run.c.skips === 376, "C buy accounting mismatch");
}

const clean = data.runs.coherentMorningstar;
const base = data.runs.productionCompatibleBase;
const cost = data.runs.costOnly;
const timing = data.runs.timingOnly;
const combined = data.runs.combinedStress;

assert(Math.abs(clean.c.return - clean.a.return) < 0.001, "Coherent taxonomy A/C return gap should be effectively zero");
assert(clean.c.mdd < clean.a.mdd - 0.1, "Coherent taxonomy must retain C's materially deeper drawdown");
assert(base.c.return > base.a.return && base.c.return - base.a.return < 0.05, "Base C edge must remain positive but small");
assert(base.c.mdd < base.a.mdd, "Base C MDD should be worse than A");
assert(cost.c.return < cost.a.return, "Cost-only stress must reverse the A/C ranking");
assert(cost.c.skips > base.c.skips, "Cost-only stress must expose additional C buy skips");
assert(timing.c.return > timing.a.return, "Timing-only test should retain a small C edge");
assert(timing.c.mdd < timing.a.mdd, "Timing-only C MDD should remain worse");
assert(combined.c.return < combined.a.return, "Combined stress must reverse the A/C ranking");
assert(base.tail.c.returnWithoutTop2 > base.tail.a.returnWithoutTop2, "C edge should remain after removing two top lots");

assert(data.annualProductionCompatibleBase.length === 17, "Expected 17 calendar-year rows");
assert(new Set(data.annualProductionCompatibleBase.map((row) => row.year)).size === 17, "Annual rows must be unique");
assert(data.selectedDelistings.length === 7, "Expected seven selected delisting events in the long base run");
assert(data.decision.promotionGatePassed === false, "Promotion gate must remain failed");
assert(data.decision.operationalChangeApplied === false, "Research audit must not silently change production state");
assert(data.requiredBeforeReconsideration.length >= 4, "Required remediation steps are missing");

assert(algorithm.includes('FIRST_SIGNAL = datetime(2010, 8, 27)'), "Long algorithm start contract missing");
assert(algorithm.includes('CLASSIFICATION_MODE = "LEGACY_COMPAT"'), "Saved algorithm must preserve the production-compatible base mode");
assert(algorithm.includes("def tail_stats"), "Tail concentration audit is missing");
assert(algorithm.includes("MEMBERSHIP_LAG_DAYS"), "Membership lag stress control is missing");
assert(algorithm.length < 32000, "QuantConnect algorithm exceeds the cloud editor limit");
assert(report.includes("자동으로 공식 승격하는 계획은 **일단 멈추는 것이 맞다**"), "Human-readable decision is missing");
assert(report.includes("+202.21%") && report.includes("-35.46%"), "Report does not include coherent taxonomy results");
assert(html.includes("C 전략, 8월에") && html.includes("promotion-gates"), "Pages report structure is missing");
assert(browserScript.includes("quantconnect-c-robustness-audit.json"), "Pages report is not wired to the audit data");

console.log("C robustness audit verified: long PIT, taxonomy, cost, timing and tail checks are internally consistent.");
