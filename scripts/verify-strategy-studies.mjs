import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const studiesRoot = path.join(root, "studies");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function studyPaths() {
  const supplied = process.argv.slice(2);
  if (supplied.length) return supplied.map((entry) => path.resolve(root, entry));
  const entries = await fs.readdir(studiesRoot, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(studiesRoot, entry.name, "study.json"));
}

const ids = new Set();
const paths = await studyPaths();
assert(paths.length > 0, "no strategy studies found");
for (const studyPath of paths) {
  const study = JSON.parse(await fs.readFile(studyPath, "utf8"));
  assert(study.schemaVersion === 1, `${studyPath}: unsupported schemaVersion`);
  assert(study.id && study.title && study.market && study.status, `${studyPath}: identity fields are required`);
  assert(!ids.has(study.id), `${studyPath}: duplicate id ${study.id}`);
  assert(study.dataContract?.membershipMode, `${study.id}: membershipMode is required`);
  assert(study.dataContract?.taxonomy, `${study.id}: taxonomy is required`);
  assert(study.capitalContract?.initialKrw > 0, `${study.id}: initialKrw must be positive`);
  assert(Array.isArray(study.capitalContract?.transactionCostBpsPerSide), `${study.id}: cost scenarios are required`);
  assert(study.executionContract?.entryTiming, `${study.id}: entryTiming is required`);
  assert(Array.isArray(study.robustnessChecks) && study.robustnessChecks.length >= 4, `${study.id}: robustness checks are incomplete`);
  assert(study.promotionGates?.requiresForwardShadow === true, `${study.id}: forward shadow gate must stay enabled`);
  ids.add(study.id);
}

console.log(`Verified ${paths.length} strategy study contract(s).`);
