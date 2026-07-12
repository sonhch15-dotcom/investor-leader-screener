import fs from "node:fs/promises";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const data = JSON.parse(await fs.readFile("data/taxonomy-structure-audit.json", "utf8"));
const catalog = JSON.parse(await fs.readFile("config/report-catalog.json", "utf8"));
const html = await fs.readFile("dashboard/taxonomy-leader-group-audit.html", "utf8");
const js = await fs.readFile("dashboard/taxonomy-leader-group-audit.js", "utf8");
const css = await fs.readFile("dashboard/taxonomy-leader-group-audit.css", "utf8");

assert(data.runId === "us-taxonomy-structure-frozen-20260712-v1", "Unexpected taxonomy audit run ID");
assert(data.grade === "exploratory_structure_audit", "Taxonomy audit must remain exploratory");
assert(data.structure.stockCount === 517, "Frozen stock count changed");
assert(data.structure.labelCount === 57, "Frozen label count changed");
assert(data.structure.broadLabelCount === 11, "Broad sector label count changed");
assert(data.structure.industryLikeLabelCount === 46, "Industry-like label count changed");
assert(data.structure.labelsAtMost2 === 40, "Small-label audit changed");

const byKey = new Map(data.results.map((row) => [row.key, row]));
for (const key of ["legacy_raw", "legacy_min8", "legacy_shrink8", "legacy_min8_shrink8", "no_group"]) {
  assert(byKey.has(key), `Missing taxonomy variant: ${key}`);
}
assert(byKey.get("legacy_raw").totalReturn > byKey.get("legacy_min8").totalReturn, "Raw/min8 sensitivity disappeared");
assert(byKey.get("legacy_shrink8").maxDrawdown > byKey.get("legacy_raw").maxDrawdown, "Shrinkage no longer improves MDD");
assert(byKey.get("legacy_raw").topSelectedGroups[0]?.group === "Electronic Components", "Top raw group changed");

const reports = catalog.groups.flatMap((group) => group.reports);
assert(reports.some((row) => row.id === "taxonomy-leader-group-audit"), "HTML report missing from catalog");
assert(reports.some((row) => row.id === "taxonomy-leader-group-audit-raw"), "Markdown report missing from catalog");
assert(html.includes("Executive Summary"), "Executive Summary label missing");
assert(html.includes("운용 변경 없음"), "Operational no-change notice missing");
assert(js.includes("taxonomy-structure-audit.json"), "Report does not load taxonomy audit data");
assert(js.includes("quantconnect-c-robustness-audit.json"), "Report does not load PIT audit data");
assert(css.includes("@media (max-width: 560px)"), "Mobile report breakpoint missing");

console.log("Taxonomy audit report verified.");
