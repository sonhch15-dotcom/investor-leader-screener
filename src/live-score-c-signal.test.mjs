import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { priceMapFromSnapshot, readPriceSnapshot } from "./backtest-price-snapshot.mjs";
import { buildScoreCLiveSignal } from "./live-score-c-signal.mjs";

const instruments = JSON.parse(await fs.readFile("data/universe-corrected-frozen-20260711.json", "utf8"));
const snapshot = await readPriceSnapshot("data/sector-score-price-snapshot-corrected-frozen-20260711.json.gz");
const result = buildScoreCLiveSignal({
  instruments,
  priceMap: priceMapFromSnapshot(snapshot),
  generatedAt: "2026-07-11T00:00:00.000Z"
});

assert.equal(result.complete, true);
assert.equal(result.status, "normal");
assert.equal(result.selectionAsOf, "2026-06-26");
assert.equal(result.signalMonth, "2026-07");
assert.equal(result.validFrom, "2026-06-29");
assert.deepEqual(result.currentPicks.map((row) => row.symbol), ["INTC", "KLAC"]);
assert.deepEqual(result.currentPicks.map((row) => row.sector), ["Semiconductors", "Electronic Components"]);
assert.equal(result.historySelectionDates.length, 4);
assert.ok(result.coverageRatio >= 0.98);

const futurePriceMap = new Map();
for (const [symbol, rows] of priceMapFromSnapshot(snapshot)) {
  const last = rows.at(-1);
  futurePriceMap.set(symbol, [
    ...rows,
    { ...last, date: "2026-07-31" }
  ]);
}
const august = buildScoreCLiveSignal({
  instruments,
  priceMap: futurePriceMap,
  generatedAt: "2026-08-01T00:00:00.000Z"
});
assert.equal(august.complete, true);
assert.equal(august.selectionAsOf, "2026-07-31");
assert.equal(august.dataAsOf, "2026-07-31");
assert.equal(august.signalMonth, "2026-08");
assert.equal(august.validFrom, "2026-08-03");
assert.equal(august.currentPicks.length, 2);
if (process.env.SCORE_C_SIMULATION_OUT) {
  await fs.writeFile(process.env.SCORE_C_SIMULATION_OUT, `${JSON.stringify(august, null, 2)}\n`, "utf8");
}

console.log("Live Score C signal tests passed.");
