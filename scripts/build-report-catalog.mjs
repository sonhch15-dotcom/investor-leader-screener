import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const configPath = path.join(root, "config", "report-catalog.json");
const outputPath = path.join(root, "data", "report-catalog.json");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const config = JSON.parse(await fs.readFile(configPath, "utf8"));
  assert(config.version === 1, "report catalog version must be 1");
  assert(Array.isArray(config.groups) && config.groups.length > 0, "report catalog groups are required");

  const ids = new Set();
  const hrefs = new Set();
  let reportCount = 0;
  for (const group of config.groups) {
    assert(group.id && group.label && Array.isArray(group.reports), `invalid report group: ${group.id ?? "unknown"}`);
    for (const report of group.reports) {
      report.href ??= report.source.replace(/^dashboard[\\/]/, "");
      assert(report.id && report.title && report.source && report.href, `invalid report in ${group.id}`);
      assert(!ids.has(report.id), `duplicate report id: ${report.id}`);
      assert(!hrefs.has(report.href), `duplicate report href: ${report.href}`);
      await fs.access(path.join(root, report.source));
      ids.add(report.id);
      hrefs.add(report.href);
      reportCount += 1;
    }
  }

  const output = { ...config, reportCount };
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`Built report catalog with ${reportCount} reports.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
