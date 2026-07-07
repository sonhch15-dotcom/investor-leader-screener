import fs from "node:fs/promises";
import path from "node:path";
import { buildUniverse } from "./universe.mjs";
import { fetchChart, syntheticChart } from "./yahoo.mjs";
import { scoreUniverse } from "./scoring.mjs";
import { round } from "./math.mjs";

const sample = process.argv.includes("--sample");
const asOfArg = valueAfter("--as-of");
const topArg = Number(valueAfter("--top") ?? 10);
const topN = Number.isFinite(topArg) && topArg > 0 ? topArg : 10;

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function parseDate(date) {
  return new Date(`${date}T00:00:00Z`);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function oneYearBefore(date) {
  const next = new Date(date);
  next.setUTCFullYear(next.getUTCFullYear() - 1);
  return next;
}

function latestDate(priceMap) {
  const spy = priceMap.get("SPY") ?? Array.from(priceMap.values()).find((rows) => rows.length);
  return spy?.at(-1)?.date ?? isoDate(new Date());
}

function rowsUntil(rows, asOf) {
  return rows.filter((row) => row.date <= asOf);
}

function firstRowAfter(rows, date) {
  return rows.find((row) => row.date > date && Number.isFinite(row.close)) ?? null;
}

function rowOnOrAfter(rows, date) {
  return rows.find((row) => row.date >= date && Number.isFinite(row.close)) ?? rows.at(-1) ?? null;
}

function pct(entry, exit) {
  if (!entry || !exit || !Number.isFinite(entry.close) || !Number.isFinite(exit.close) || entry.close === 0) return null;
  return exit.close / entry.close - 1;
}

async function collectPrices(instruments) {
  const priceMap = new Map();
  const errors = [];
  for (const [index, instrument] of instruments.entries()) {
    try {
      const rows = sample ? syntheticChart(instrument.symbol) : await fetchChart(instrument.symbol, { range: "2y" });
      priceMap.set(instrument.symbol, rows);
      if ((index + 1) % 50 === 0) console.log(`Fetched ${index + 1}/${instruments.length}`);
    } catch (error) {
      errors.push({ symbol: instrument.symbol, error: error.message });
      if (sample) priceMap.set(instrument.symbol, syntheticChart(instrument.symbol));
    }
  }
  return { priceMap, errors };
}

function benchmarkReturn(priceMap, symbol, entryDate, exitDate) {
  const rows = priceMap.get(symbol) ?? [];
  const entry = firstRowAfter(rows, entryDate);
  const exit = rowOnOrAfter(rows, exitDate);
  return {
    symbol,
    entryDate: entry?.date ?? null,
    entryPrice: round(entry?.close, 2),
    exitDate: exit?.date ?? null,
    exitPrice: round(exit?.close, 2),
    return: round(pct(entry, exit), 4)
  };
}

function evaluateCandidate(row, priceMap, asOf, latest) {
  const rows = priceMap.get(row.symbol) ?? [];
  const entry = firstRowAfter(rows, asOf);
  const horizons = [
    ["1m", 21],
    ["3m", 63],
    ["6m", 126],
    ["12m", 252]
  ];
  const horizonReturns = {};
  for (const [label, days] of horizons) {
    if (!entry) {
      horizonReturns[label] = null;
      continue;
    }
    const targetDate = isoDate(addDays(parseDate(entry.date), Math.round(days * 1.45)));
    const exit = rowOnOrAfter(rows, targetDate);
    horizonReturns[label] = round(pct(entry, exit), 4);
  }

  const exit = rowOnOrAfter(rows, latest);
  return {
    symbol: row.symbol,
    name: row.name,
    statusAtAsOf: row.status,
    scoreAtAsOf: row.score,
    sector: row.sector,
    setupAtAsOf: row.setup.type,
    warningsAtAsOf: row.warnings ?? [],
    reasonsAtAsOf: row.reasons ?? [],
    entryDate: entry?.date ?? null,
    entryPrice: round(entry?.close, 2),
    exitDate: exit?.date ?? null,
    exitPrice: round(exit?.close, 2),
    returnToLatest: round(pct(entry, exit), 4),
    horizonReturns
  };
}

function averageReturn(rows, key) {
  const values = rows.map((row) => row[key]).filter(Number.isFinite);
  if (!values.length) return null;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length, 4);
}

function averageNestedReturn(rows, label) {
  const values = rows.map((row) => row.horizonReturns?.[label]).filter(Number.isFinite);
  if (!values.length) return null;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length, 4);
}

function formatPct(value) {
  if (!Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(1)}%`;
}

function markdownReport(result) {
  const lines = [];
  lines.push("# Backtest Report");
  lines.push("");
  lines.push(`Generated at: ${result.generatedAt}`);
  lines.push(`As-of date: ${result.asOf}`);
  lines.push(`Entry rule: first trading day after as-of date`);
  lines.push(`Exit date: ${result.latestDate}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Universe size: ${result.universeSize}`);
  lines.push(`- Scored candidates: ${result.scoredRows}`);
  lines.push(`- Selected top N: ${result.topN}`);
  lines.push(`- Average return to latest: ${formatPct(result.summary.averageReturnToLatest)}`);
  lines.push(`- SPY return: ${formatPct(result.benchmarks.SPY.return)}`);
  lines.push(`- QQQ return: ${formatPct(result.benchmarks.QQQ.return)}`);
  lines.push("");
  lines.push("## Horizon Returns");
  lines.push("");
  lines.push("| Horizon | Average Top N |");
  lines.push("|---|---:|");
  for (const label of ["1m", "3m", "6m", "12m"]) {
    lines.push(`| ${label} | ${formatPct(result.summary.horizonAverages[label])} |`);
  }
  lines.push("");
  lines.push("## Selected Candidates");
  lines.push("");
  lines.push("| Symbol | Status | Score | Setup | Entry | Latest Return | 1M | 3M | 6M | 12M | Notes |");
  lines.push("|---|---|---:|---|---:|---:|---:|---:|---:|---:|---|");
  for (const row of result.selected) {
    lines.push([
      row.symbol,
      row.statusAtAsOf,
      row.scoreAtAsOf,
      row.setupAtAsOf,
      row.entryPrice ?? "-",
      formatPct(row.returnToLatest),
      formatPct(row.horizonReturns["1m"]),
      formatPct(row.horizonReturns["3m"]),
      formatPct(row.horizonReturns["6m"]),
      formatPct(row.horizonReturns["12m"]),
      [...row.reasonsAtAsOf, ...row.warningsAtAsOf.map((item) => `Warning: ${item}`)].join("; ")
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |"));
  }
  lines.push("");
  lines.push("## Important Limitations");
  lines.push("");
  lines.push("- This is a historical stock-selection test, not a full trade execution backtest.");
  lines.push("- It uses the current S&P 500/Nasdaq 100 universe, so survivorship bias exists.");
  lines.push("- It assumes buying the first trading day after the as-of date.");
  lines.push("- It does not include taxes, commissions, slippage, FX, or position sizing.");
  lines.push("- Intraday 1H/4H timing is not included yet.");
  lines.push("");
  return lines.join("\n");
}

async function main() {
  console.log(sample ? "Running historical test with sample data." : "Running historical test with live Yahoo Finance data.");
  const instruments = await buildUniverse({ sample });
  console.log(`Universe size: ${instruments.length}`);
  const { priceMap, errors } = await collectPrices(instruments);
  const latest = latestDate(priceMap);
  const asOf = asOfArg ?? isoDate(oneYearBefore(parseDate(latest)));
  const slicedPriceMap = new Map();
  for (const [symbol, rows] of priceMap) slicedPriceMap.set(symbol, rowsUntil(rows, asOf));

  const scored = scoreUniverse(instruments, slicedPriceMap);
  const selectedRows = scored.rows
    .filter((row) => row.status !== "excluded")
    .slice(0, topN);
  const selected = selectedRows.map((row) => evaluateCandidate(row, priceMap, asOf, latest));
  const result = {
    generatedAt: new Date().toISOString(),
    mode: sample ? "sample" : "live",
    asOf,
    latestDate: latest,
    topN,
    universeSize: instruments.length,
    scoredRows: scored.rows.length,
    asOfMarket: scored.market,
    benchmarks: {
      SPY: benchmarkReturn(priceMap, "SPY", asOf, latest),
      QQQ: benchmarkReturn(priceMap, "QQQ", asOf, latest)
    },
    summary: {
      averageReturnToLatest: averageReturn(selected, "returnToLatest"),
      horizonAverages: {
        "1m": averageNestedReturn(selected, "1m"),
        "3m": averageNestedReturn(selected, "3m"),
        "6m": averageNestedReturn(selected, "6m"),
        "12m": averageNestedReturn(selected, "12m")
      }
    },
    selected,
    errors
  };

  await ensureDir("data");
  await fs.writeFile(path.join("data", "backtest-results.json"), JSON.stringify(result, null, 2), "utf8");
  await fs.writeFile("backtest_report.md", markdownReport(result), "utf8");
  console.log(`Wrote data/backtest-results.json and backtest_report.md for ${asOf}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
