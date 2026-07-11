import fs from "node:fs/promises";
import { priceMapFromSnapshot, readPriceSnapshot } from "./backtest-price-snapshot.mjs";
import { buildScoreCLiveSignal } from "./live-score-c-signal.mjs";

const instruments = JSON.parse(await fs.readFile("data/universe-corrected-frozen-20260711.json", "utf8"));
const snapshot = await readPriceSnapshot("data/sector-score-price-snapshot-corrected-frozen-20260711.json.gz");
const result = buildScoreCLiveSignal({ instruments, priceMap: priceMapFromSnapshot(snapshot) });

await fs.writeFile("data/score-c-live.json", `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(`Wrote data/score-c-live.json for ${result.signalMonth}: ${result.currentPicks.map((row) => row.symbol).join(", ")}`);
