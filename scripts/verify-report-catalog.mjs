import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const catalog = JSON.parse(await fs.readFile(path.join(root, "data", "report-catalog.json"), "utf8"));
const reports = catalog.groups.flatMap((group) => group.reports);
const verifyDist = process.argv.includes("--dist");

if (catalog.reportCount !== reports.length) throw new Error("reportCount does not match catalog entries");
if (new Set(reports.map((report) => report.id)).size !== reports.length) throw new Error("report ids are not unique");
if (new Set(reports.map((report) => report.href)).size !== reports.length) throw new Error("report hrefs are not unique");
for (const report of reports) await fs.access(path.join(root, report.source));
if (verifyDist) {
  for (const report of reports) await fs.access(path.join(root, "dist", report.href));
}

console.log(`Verified ${reports.length} report links${verifyDist ? " in dist" : ""}.`);
