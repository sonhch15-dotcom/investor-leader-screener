import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const studiesRoot = path.join(root, "studies");
const catalogPath = path.join(root, "config", "backtest-experiment-catalog.json");
const catalogMarkdownPath = path.join(root, "backtest_experiment_catalog.md");
const allowedStatuses = new Set(["retained_rule", "rejected", "invalidated", "superseded", "exploratory_only", "provisional"]);
const allowedRerunReasons = new Set(["reproduction", "engine_fix", "new_independent_data", "cost_stress"]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function studyPaths() {
  const supplied = process.argv.slice(2);
  if (supplied.length) return supplied.map((entry) => path.resolve(root, entry));
  const entries = await fs.readdir(studiesRoot, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(studiesRoot, entry.name, "study.json"));
}

const [catalogText, catalogMarkdown] = await Promise.all([
  fs.readFile(catalogPath, "utf8"),
  fs.readFile(catalogMarkdownPath, "utf8")
]);
const catalog = JSON.parse(catalogText);
assert(catalog.schemaVersion === 1, "unsupported backtest catalog schemaVersion");
assert(Array.isArray(catalog.experiments) && catalog.experiments.length > 0, "backtest catalog is empty");

const catalogById = new Map();
const catalogByFingerprint = new Map();
const catalogByConcept = new Map();
for (const experiment of catalog.experiments) {
  assert(experiment.id && experiment.title && experiment.market, "catalog experiment identity is incomplete");
  assert(!catalogById.has(experiment.id), `catalog duplicate id ${experiment.id}`);
  assert(allowedStatuses.has(experiment.status), `${experiment.id}: unsupported status ${experiment.status}`);
  assert(experiment.hypothesisKey && experiment.fingerprint, `${experiment.id}: hypothesis and fingerprint are required`);
  assert(!catalogByFingerprint.has(experiment.fingerprint), `${experiment.id}: duplicate catalog fingerprint shared with ${catalogByFingerprint.get(experiment.fingerprint)}`);
  assert(Array.isArray(experiment.conceptKeys) && experiment.conceptKeys.length > 0, `${experiment.id}: conceptKeys are required`);
  assert(Array.isArray(experiment.testedDimensions) && experiment.testedDimensions.length > 0, `${experiment.id}: testedDimensions are required`);
  assert(experiment.conclusion && experiment.repeatPolicy, `${experiment.id}: conclusion and repeatPolicy are required`);
  catalogById.set(experiment.id, experiment);
  catalogByFingerprint.set(experiment.fingerprint, experiment.id);
  assert(catalogMarkdown.includes(`\`${experiment.id}\``), `${experiment.id}: missing from readable catalog`);
  for (const conceptKey of new Set([experiment.hypothesisKey, ...experiment.conceptKeys])) {
    const conceptOwners = catalogByConcept.get(conceptKey) ?? [];
    conceptOwners.push(experiment.id);
    catalogByConcept.set(conceptKey, conceptOwners);
  }
}

assert(Array.isArray(catalog.unstartedHypotheses), "unstartedHypotheses must be an array");
const unstartedKeys = new Set();
for (const hypothesis of catalog.unstartedHypotheses) {
  assert(hypothesis.hypothesisKey && hypothesis.title && hypothesis.dataGate, "unstarted hypothesis is incomplete");
  assert(!unstartedKeys.has(hypothesis.hypothesisKey), `duplicate unstarted hypothesis ${hypothesis.hypothesisKey}`);
  assert(!catalogByConcept.has(hypothesis.hypothesisKey), `${hypothesis.hypothesisKey}: unstarted hypothesis is already cataloged as tested`);
  assert(catalogMarkdown.includes(`\`${hypothesis.hypothesisKey}\``), `${hypothesis.hypothesisKey}: missing from readable catalog`);
  unstartedKeys.add(hypothesis.hypothesisKey);
}

const ids = new Set();
const studyFingerprints = new Map();
const paths = await studyPaths();
assert(paths.length > 0, "no strategy studies found");
for (const studyPath of paths) {
  const study = JSON.parse(await fs.readFile(studyPath, "utf8"));
  assert(study.schemaVersion === 2, `${studyPath}: unsupported schemaVersion`);
  assert(study.id && study.title && study.market && study.status, `${studyPath}: identity fields are required`);
  assert(!ids.has(study.id), `${studyPath}: duplicate id ${study.id}`);
  const novelty = study.noveltyContract;
  assert(novelty?.priorArtReviewed === true, `${study.id}: priorArtReviewed must be true before backtesting`);
  assert(novelty.primaryConceptKey && novelty.primaryConceptKey !== "TODO", `${study.id}: primaryConceptKey is required`);
  assert(novelty.primaryExperimentFingerprint && novelty.primaryExperimentFingerprint !== "TODO", `${study.id}: primaryExperimentFingerprint is required`);
  assert(Array.isArray(novelty.nearestPriorExperimentIds) && novelty.nearestPriorExperimentIds.length > 0, `${study.id}: nearestPriorExperimentIds are required`);
  assert(novelty.novelDimension && novelty.novelDimension.length >= 20, `${study.id}: novelDimension must explain the meaningful change`);
  for (const priorId of novelty.nearestPriorExperimentIds) {
    assert(catalogById.has(priorId), `${study.id}: unknown prior experiment ${priorId}`);
  }

  const sameCatalogId = catalogById.get(study.id);
  const fingerprintOwner = catalogByFingerprint.get(novelty.primaryExperimentFingerprint);
  const conceptOwners = catalogByConcept.get(novelty.primaryConceptKey) ?? [];
  if (sameCatalogId) {
    assert(sameCatalogId.fingerprint === novelty.primaryExperimentFingerprint, `${study.id}: study fingerprint differs from its catalog record`);
    assert(sameCatalogId.hypothesisKey === novelty.primaryConceptKey, `${study.id}: study concept differs from its catalog record`);
  }

  const duplicateIds = new Set([
    ...(fingerprintOwner && fingerprintOwner !== study.id ? [fingerprintOwner] : []),
    ...conceptOwners.filter((owner) => owner !== study.id)
  ]);
  if (duplicateIds.size > 0) {
    assert(novelty.rerunOf && duplicateIds.has(novelty.rerunOf), `${study.id}: duplicate hypothesis/fingerprint; set rerunOf to one of ${[...duplicateIds].join(", ")}`);
    assert(allowedRerunReasons.has(novelty.rerunReason), `${study.id}: rerunReason must be one of ${[...allowedRerunReasons].join(", ")}`);
  } else {
    assert(novelty.rerunOf === null && novelty.rerunReason === null, `${study.id}: rerun fields must stay null for a new experiment`);
  }

  const priorStudyOwner = studyFingerprints.get(novelty.primaryExperimentFingerprint);
  assert(!priorStudyOwner || novelty.rerunOf === priorStudyOwner, `${study.id}: duplicate study fingerprint shared with ${priorStudyOwner}`);
  studyFingerprints.set(novelty.primaryExperimentFingerprint, study.id);
  assert(study.dataContract?.membershipMode, `${study.id}: membershipMode is required`);
  assert(study.dataContract?.taxonomy, `${study.id}: taxonomy is required`);
  assert(study.capitalContract?.initialKrw > 0, `${study.id}: initialKrw must be positive`);
  assert(Array.isArray(study.capitalContract?.transactionCostBpsPerSide), `${study.id}: cost scenarios are required`);
  assert(study.executionContract?.entryTiming, `${study.id}: entryTiming is required`);
  assert(Array.isArray(study.robustnessChecks) && study.robustnessChecks.length >= 4, `${study.id}: robustness checks are incomplete`);
  assert(study.promotionGates?.requiresForwardShadow === true, `${study.id}: forward shadow gate must stay enabled`);
  ids.add(study.id);
}

console.log(`Verified ${catalog.experiments.length} catalog experiment(s) and ${paths.length} strategy study contract(s).`);
