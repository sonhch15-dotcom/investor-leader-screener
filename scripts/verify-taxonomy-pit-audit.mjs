import assert from "node:assert/strict";
import fs from "node:fs/promises";

const data = JSON.parse(await fs.readFile("data/quantconnect-taxonomy-leader-group-audit.json", "utf8"));
const html = await fs.readFile("dashboard/taxonomy-pit-audit.html", "utf8");
const css = await fs.readFile("dashboard/taxonomy-pit-audit.css", "utf8");
const client = await fs.readFile("dashboard/taxonomy-pit-audit.js", "utf8");
const report = await fs.readFile("quantconnect_taxonomy_pit_audit.md", "utf8");
const source = await fs.readFile("research/quantconnect/us_taxonomy_leader_group_audit.py", "utf8");
const cloudMain = await fs.readFile("research/quantconnect/cloud-taxonomy-audit/main.py", "utf8");
const catalog = JSON.parse(await fs.readFile("config/report-catalog.json", "utf8"));

const rows = new Map(data.rankedResults.map((row) => [row.key, row]));
const baseline = rows.get("A__MSTAR_GROUP_RAW");
const candidate = rows.get("A__MSTAR_ADAPTIVE");
const candidateC = rows.get("C__MSTAR_ADAPTIVE");

assert.equal(data.runId, "us-taxonomy-leader-group-pit-100m-20260712-v1");
assert.equal(data.status, "research_candidate_not_promoted");
assert.equal(data.period.signalMonths, 188);
assert.equal(data.period.everConstituents, 966);
assert.equal(data.period.lastPriceDate, "2026-04-13");
assert.equal(data.capitalContract.initialKrw, 100_000_000);
assert.equal(data.rankedResults.length, 14);
assert.equal(data.rawLogLines.length, 93);
assert.equal(data.reproducibility.repeatedRuns, 2);
assert.equal(data.reproducibility.exactLogMatch, true);
assert.equal(data.classificationAudit.observedChangeEvents, 0);
assert.equal(data.classificationAudit.observedChangedSymbols, 0);
assert.equal(data.selectedDelistings.count, 18);

assert.ok(baseline && candidate && candidateC, "baseline and candidates are required");
assert.equal(baseline.totalReturn, 2.133);
assert.equal(baseline.maxDrawdown, -0.2032);
assert.equal(candidate.totalReturn, 2.4839);
assert.equal(candidate.maxDrawdown, -0.1886);
assert.equal(candidate.topWinners[0].lot, "CEG@2011-09");
assert.equal(candidate.topWinners[0].profitKrw, 45_202_420);
assert.equal(data.comparison.returnDelta, 0.3509);
assert.equal(data.comparison.periodDeltas.design, -0.1537);
assert.equal(data.comparison.returnWithoutTop2Delta, 0.0045);
assert.equal(data.comparison.adaptiveAminusC.returnDelta, 0.3872);
assert.equal(candidate.selectionOverlap.morningstarRaw.exactTwoRate, 0.25);
assert.equal(candidate.selectedGroupSize.atMost4Rate, 0);
assert.equal(data.decision.operationalChange, false);
assert.equal(data.decision.androidImpact, "none");
assert.ok(data.limitations.some((item) => item.includes("CEG@2011-09")), "SID audit caveat is missing");

const failedGates = data.promotionGates.filter((gate) => gate.status === "failed").map((gate) => gate.key);
assert.deepEqual(failedGates, ["all_periods", "benchmark", "forward"]);
assert.equal(data.promotionGates.find((gate) => gate.key === "winner_dependence")?.status, "warning");

assert.ok(html.includes("Executive Summary · 핵심 결론"));
assert.ok(html.includes("작은 업종을 합치면"));
assert.ok(html.includes("연구 후보 유지"));
assert.ok(html.includes("운용은 그대로"));
assert.ok(html.includes("CEG@2011-09"));
assert.ok(html.includes("quantconnect_taxonomy_pit_audit.md"));
assert.ok(html.includes("quantconnect.com/docs/v2/writing-algorithms/datasets/morningstar/us-fundamental-data"));
assert.ok(client.includes("quantconnect-taxonomy-leader-group-audit.json"));
assert.ok(client.includes("renderPeriods(data)"));
assert.ok(client.includes("renderDecision(data)"));
assert.ok(css.includes("@media (max-width: 560px)"));
assert.ok(css.includes(".strategy-bar-row { grid-template-columns: minmax(0, 1fr) 62px;"));
assert.ok(report.includes("+35.09%p"));
assert.ok(report.includes("+0.45%p"));
assert.ok(report.includes("Security Identifier"));

assert.ok(source.includes("def sort_symbols(values):"), "deterministic symbol sorting is missing");
assert.ok(source.includes('rows.sort(key=lambda row: (-row["score"], row["ticker_key"]))'), "score tie-break is missing");
assert.ok(cloudMain.length <= 32_000, `QuantConnect main.py exceeds 32,000 chars: ${cloudMain.length}`);

const reports = catalog.groups.flatMap((group) => group.reports);
assert.ok(reports.some((item) => item.id === "taxonomy-pit-audit" && item.source === "dashboard/taxonomy-pit-audit.html"));
assert.ok(reports.some((item) => item.id === "taxonomy-pit-audit-raw" && item.source === "quantconnect_taxonomy_pit_audit.md"));

console.log("Verified long-horizon taxonomy PIT audit and report.");
