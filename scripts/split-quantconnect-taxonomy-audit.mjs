import fs from "node:fs/promises";
import path from "node:path";

const sourcePath = path.join("research", "quantconnect", "us_taxonomy_leader_group_audit.py");
const outputDir = path.join("research", "quantconnect", "cloud-taxonomy-audit");
const source = await fs.readFile(sourcePath, "utf8");
const marker = "class TaxonomyLeaderGroupAudit";
const markerIndex = source.indexOf(marker);

if (markerIndex < 0) throw new Error(`Missing split marker: ${marker}`);

const common = source.slice(0, markerIndex).trimEnd() + "\n";
const main = `from taxonomy_common import *\n${source.slice(markerIndex)}`;

for (const [name, content] of [["taxonomy_common.py", common], ["main.py", main]]) {
  if (content.length > 32_000) {
    throw new Error(`${name} exceeds QuantConnect's 32,000 character limit: ${content.length}`);
  }
}

await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(path.join(outputDir, "taxonomy_common.py"), common, "utf8");
await fs.writeFile(path.join(outputDir, "main.py"), main, "utf8");

console.log(`Wrote ${outputDir}/taxonomy_common.py (${common.length} chars)`);
console.log(`Wrote ${outputDir}/main.py (${main.length} chars)`);
