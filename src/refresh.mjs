import fs from "node:fs/promises";
import path from "node:path";
import { buildUniverse } from "./universe.mjs";
import { fetchChart, syntheticChart } from "./yahoo.mjs";
import { scoreUniverse } from "./scoring.mjs";
import { clamp, mean, round } from "./math.mjs";

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

function weightedMomentum(metrics) {
  const parts = [
    [metrics?.r1m, 0.4],
    [metrics?.r3m, 0.35],
    [metrics?.r6m, 0.25]
  ];
  const valid = parts.filter(([value]) => Number.isFinite(value));
  if (!valid.length) return null;
  const weight = valid.reduce((sum, [, itemWeight]) => sum + itemWeight, 0);
  return valid.reduce((sum, [value, itemWeight]) => sum + value * itemWeight, 0) / weight;
}

function rate(rows, predicate) {
  if (!rows.length) return null;
  return rows.filter(predicate).length / rows.length;
}

function buildCurrentGroupStats(rows) {
  const stocks = rows.filter((row) => row.type === "stock" && row.sector);
  const eligible = stocks.filter((row) => row.status !== "excluded");
  const top20 = eligible.slice(0, 20);
  const top50 = eligible.slice(0, 50);
  const top100 = eligible.slice(0, 100);
  const spy = rows.find((row) => row.symbol === "SPY");
  const qqq = rows.find((row) => row.symbol === "QQQ");
  const spyMomentum = weightedMomentum(spy?.metrics);
  const qqqMomentum = weightedMomentum(qqq?.metrics);
  const groups = new Map();

  for (const row of stocks) {
    const current = groups.get(row.sector) ?? [];
    current.push(row);
    groups.set(row.sector, current);
  }

  return Array.from(groups, ([group, groupRows]) => {
    const groupEligible = groupRows.filter((row) => row.status !== "excluded");
    const groupTop20 = top20.filter((row) => row.sector === group);
    const groupTop50 = top50.filter((row) => row.sector === group);
    const groupTop100 = top100.filter((row) => row.sector === group);
    const momentumValues = groupRows.map((row) => weightedMomentum(row.metrics));
    const averageQqqExcessMomentum = mean(momentumValues.map((value) => value - qqqMomentum));
    const averageSpyExcessMomentum = mean(momentumValues.map((value) => value - spyMomentum));
    const above50Rate = rate(groupRows, (row) => row.metrics?.above50);
    const above200Rate = rate(groupRows, (row) => row.metrics?.above200);
    const nearHighRate = rate(groupRows, (row) => row.metrics?.high52wDistance >= -0.1);
    const score75Rate = rate(groupRows, (row) => row.score >= 75);
    const score80Rate = rate(groupRows, (row) => row.score >= 80);
    const top50Concentration = groupTop50.length / Math.max(1, groupRows.length);
    const top100Concentration = groupTop100.length / Math.max(1, groupRows.length);
    const eligibleRate = groupEligible.length / Math.max(1, groupRows.length);
    const leadershipScore = round(
      clamp(averageQqqExcessMomentum, -0.2, 0.4) * 100
      + clamp(averageSpyExcessMomentum, -0.2, 0.4) * 60
      + above50Rate * 22
      + above200Rate * 16
      + nearHighRate * 16
      + score75Rate * 20
      + score80Rate * 12
      + eligibleRate * 12
      + top50Concentration * 90
      + top100Concentration * 35
      + groupTop20.length * 8,
      2
    );

    return {
      group,
      universeCount: groupRows.length,
      eligibleCount: groupEligible.length,
      top20Count: groupTop20.length,
      top50Count: groupTop50.length,
      top100Count: groupTop100.length,
      eligibleRate: round(eligibleRate, 4),
      top50Concentration: round(top50Concentration, 4),
      averageScore: round(mean(groupRows.map((row) => row.score)), 2),
      averageMomentum: round(mean(momentumValues), 4),
      averageSpyExcessMomentum: round(averageSpyExcessMomentum, 4),
      averageQqqExcessMomentum: round(averageQqqExcessMomentum, 4),
      above50Rate: round(above50Rate, 4),
      above200Rate: round(above200Rate, 4),
      nearHighRate: round(nearHighRate, 4),
      score75Rate: round(score75Rate, 4),
      score80Rate: round(score80Rate, 4),
      leadershipScore
    };
  })
    .filter((row) => row.universeCount >= 3)
    .sort((a, b) => b.leadershipScore - a.leadershipScore);
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
  results.currentGroupStats = buildCurrentGroupStats(results.rows);

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
