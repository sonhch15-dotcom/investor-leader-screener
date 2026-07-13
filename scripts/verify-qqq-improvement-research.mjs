import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";


const logDir = new URL("../research/quantconnect/logs/", import.meta.url);
const required = [
  "qqq_improvement_stage1_20260713.json",
  "qqq_improvement_stage2_20260713.json",
  "qqq_improvement_stage3_20260713.json",
  "qqq_improvement_stage4_stress_20260713.json",
  "qqq_improvement_quality_20260713.json",
];
const sourceByLog = {
  "qqq_improvement_stage1_20260713.json": "qqq_improvement_stage1.py",
  "qqq_improvement_stage2_20260713.json": "qqq_improvement_stage2.py",
  "qqq_improvement_stage3_20260713.json": "qqq_improvement_stage3.py",
  "qqq_improvement_stage4_stress_20260713.json": "qqq_improvement_stage4_stress.py",
  "qqq_improvement_quality_20260713.json": "qqq_improvement_quality_test.py",
};


function assert(condition, message) {
  if (!condition) throw new Error(message);
}


const logs = {};
for (const filename of required) {
  const value = JSON.parse(await readFile(new URL(filename, logDir), "utf8"));
  assert(value.valid === true, `${filename}: valid must be true`);
  assert(
    value.engineFix === "preserve_universe_symbol_v1",
    `${filename}: corrected Symbol contract is missing`,
  );
  assert(Array.isArray(value.results) && value.results.length > 0, `${filename}: no results`);
  const source = await readFile(new URL(`../${sourceByLog[filename]}`, logDir), "utf8");
  const sourceHash = createHash("sha256").update(source.replaceAll("\r\n", "\n")).digest("hex");
  assert(value.codeHashSha256 === sourceHash, `${filename}: source hash does not match`);
  logs[filename] = value;
}

const stress = logs["qqq_improvement_stage4_stress_20260713.json"];
assert(stress.reproducibility?.exactMatch === true, "duplicate rerun did not match");
for (const name of ["W1", "W2", "W3", "W4"]) {
  assert(stress.results.some((item) => item.label === `I4W ${name}`), `${name} is missing`);
}
assert(
  stress.results.some(
    (item) => item.row.startsWith("OPEN_25BP;") && item.row.includes("target=0"),
  ),
  "final research leader or no-promotion result is missing",
);

const risk = logs["qqq_improvement_stage3_20260713.json"];
assert(
  risk.results.filter((item) => item.label.startsWith("I3 Rank")).every(
    (item) => item.row.includes("ok=0"),
  ),
  "risk branch should have no surviving candidate",
);

console.log(JSON.stringify({
  ok: true,
  engineFix: "preserve_universe_symbol_v1",
  requiredLogs: required.length,
  duplicateRunsMatch: true,
  holdout2025Opened: false,
  promotion: "none",
}, null, 2));
