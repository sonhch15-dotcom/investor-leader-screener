import fs from "node:fs/promises";
import path from "node:path";
import { buildUniverse } from "./universe.mjs";
import { fetchChart, syntheticChart } from "./yahoo.mjs";
import { scoreUniverse } from "./scoring.mjs";

const sample = process.argv.includes("--sample");

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function collectPrices(instruments) {
  const priceMap = new Map();
  const errors = [];
  for (const [index, instrument] of instruments.entries()) {
    try {
      const rows = sample ? syntheticChart(instrument.symbol) : await fetchChart(instrument.symbol);
      priceMap.set(instrument.symbol, rows);
      if ((index + 1) % 50 === 0) console.log(`Fetched ${index + 1}/${instruments.length}`);
    } catch (error) {
      errors.push({ symbol: instrument.symbol, error: error.message });
      if (sample) priceMap.set(instrument.symbol, syntheticChart(instrument.symbol));
    }
  }
  return { priceMap, errors };
}

function compactChart(rows, days = 126) {
  return rows.slice(-days).map((row) => ({
    date: row.date,
    close: Number(row.close?.toFixed?.(2) ?? row.close),
    high: Number(row.high?.toFixed?.(2) ?? row.high),
    low: Number(row.low?.toFixed?.(2) ?? row.low),
    volume: row.volume
  }));
}

async function main() {
  console.log(sample ? "Running with synthetic sample data." : "Running with live Yahoo Finance data.");
  const instruments = await buildUniverse({ sample });
  console.log(`Universe size: ${instruments.length}`);
  const { priceMap, errors } = await collectPrices(instruments);
  const results = scoreUniverse(instruments, priceMap);
  const chartSymbols = new Set(
    results.rows
      .filter((row) => row.status !== "excluded")
      .slice(0, 120)
      .map((row) => row.symbol)
  );
  for (const row of results.rows) {
    if (chartSymbols.has(row.symbol)) {
      row.chart = compactChart(priceMap.get(row.symbol) ?? []);
    }
  }
  results.mode = sample ? "sample" : "live";
  results.universeSize = instruments.length;
  results.priceSeriesCount = priceMap.size;
  results.errors = errors;
  results.summary = {
    buyable: results.rows.filter((row) => row.status === "buyable").length,
    review: results.rows.filter((row) => row.status === "review").length,
    strongWatch: results.rows.filter((row) => row.status === "strong_watch").length,
    watch: results.rows.filter((row) => row.status === "watch").length,
    excluded: results.rows.filter((row) => row.status === "excluded").length
  };

  await ensureDir("data");
  await fs.writeFile(path.join("data", "screener-results.json"), JSON.stringify(results, null, 2), "utf8");
  await fs.writeFile(path.join("data", "universe.json"), JSON.stringify(instruments, null, 2), "utf8");
  console.log(`Wrote data/screener-results.json (${results.rows.length} rows)`);
  if (errors.length) console.log(`Completed with ${errors.length} data errors. See JSON errors field.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
