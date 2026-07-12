import assert from "node:assert/strict";
import fs from "node:fs/promises";

const data = JSON.parse(await fs.readFile("data/quantconnect-point-in-time-audit.json", "utf8"));
const code = await fs.readFile("research/quantconnect/us_point_in_time_audit.py", "utf8");

const byVariant = (side, variant) => data[side].summaries.find((row) => row.variant === variant);
const pitA = byVariant("pit", "A");
const pitC = byVariant("pit", "C");
const fixedA = byVariant("fixed", "A");
const fixedC = byVariant("fixed", "C");

assert.equal(data.period.signalMonths, 56);
assert.equal(data.period.lastPriceDate, "2026-04-13");
assert.equal(data.pit.signals.length, 56);
assert.equal(data.fixed.signals.length, 56);
assert(data.pit.yearly.every((row) => Object.keys(row.returns).length === 6));
assert(data.fixed.yearly.every((row) => Object.keys(row.returns).length === 6));
assert.equal(data.cleanClassificationSensitivity.summaries.length, 2);
assert(data.pit.signals.every((row) => row.a.length === 2 && row.c.length === 2));
assert(data.fixed.signals.every((row) => row.a.length === 2 && row.c.length === 2));
assert(fixedA.ret > pitA.ret, "fixed A should expose a positive survivorship uplift");
assert(fixedC.ret > pitC.ret, "fixed C should expose a positive survivorship uplift");
assert(pitC.ret > pitA.ret, "Score C direction should remain ahead after PIT correction");
assert.equal(data.pit.outCurrent.A.length, 15);
assert.equal(data.pit.outCurrent.C.length, 15);
assert.deepEqual(data.pit.selectedDelisting, ["PXD@2024-05-03"]);
assert.equal(data.fixed.selectedDelisting.length, 0);
assert.match(code, /UNIVERSE_MODE = "PIT"/);
assert.match(code, /CLASSIFICATION_MODE = "LEGACY_COMPAT"/);
assert.match(code, /self\.universe\.etf\(self\.spy/);
assert.match(code, /self\.universe\.etf\(self\.qqq/);

console.log("Point-in-time audit verification passed.");
