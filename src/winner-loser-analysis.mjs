import fs from "node:fs/promises";
import path from "node:path";
import { mean, round } from "./math.mjs";

const inputPath = path.join("data", "monthly-selection-test.json");
const outputJsonPath = path.join("data", "winner-loser-analysis.json");
const outputMdPath = "winner_loser_analysis.md";

const semiconductorSectors = new Set([
  "Semiconductors",
  "Electronic Components",
  "Computer Peripheral Equipment",
  "Computer Communications Equipment"
]);

const aiHardwareSymbols = new Set([
  "NVDA", "AMD", "AVGO", "ARM", "MU", "ASML", "TSM", "SMH", "SOXX",
  "WDC", "STX", "DELL", "HPE", "ANET", "VRT", "SMCI", "MRVL", "LRCX",
  "KLAC", "AMAT", "TER", "MPWR", "ON", "QCOM", "INTC"
]);

function clean(values) {
  return values.filter(Number.isFinite);
}

function ratio(values, predicate) {
  const rows = values.filter((value) => value != null);
  if (!rows.length) return null;
  return rows.filter(predicate).length / rows.length;
}

function pct(value) {
  if (!Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(1)}%`;
}

function avg(values) {
  return round(mean(clean(values)), 4);
}

function scoreBand(score) {
  if (score >= 85) return "85+";
  if (score >= 80) return "80-84";
  if (score >= 75) return "75-79";
  if (score >= 70) return "70-74";
  return "<70";
}

function classify(row) {
  const r12m = row.returns?.["12m"];
  const qqqExcess = row.excess?.["12m"]?.QQQ;
  if (!Number.isFinite(r12m) || !Number.isFinite(qqqExcess)) return "unknown";
  if (r12m >= 0.3 && qqqExcess >= 0.1) return "strong_winner";
  if (r12m > 0 && qqqExcess > 0) return "winner";
  if (r12m < 0 || qqqExcess <= -0.1) return "loser";
  return "positive_lagging";
}

function isAiHardware(row) {
  return semiconductorSectors.has(row.sector) || aiHardwareSymbols.has(row.symbol);
}

function flattenPeriods(periods) {
  return periods.flatMap((period) => period.selections.map((row, index) => ({
    ...row,
    asOf: period.asOf,
    marketRegime: period.market?.regime ?? "unknown",
    marketScore: period.market?.score ?? null,
    rank: index + 1,
    scoreBand: scoreBand(row.score),
    class: classify(row),
    isAiHardware: isAiHardware(row)
  }))).filter((row) => row.class !== "unknown");
}

function summarizeRows(rows) {
  return {
    count: rows.length,
    averageRank: avg(rows.map((row) => row.rank)),
    averageScore: avg(rows.map((row) => row.score)),
    average1m: avg(rows.map((row) => row.returns?.["1m"])),
    average3m: avg(rows.map((row) => row.returns?.["3m"])),
    average6m: avg(rows.map((row) => row.returns?.["6m"])),
    average12m: avg(rows.map((row) => row.returns?.["12m"])),
    averageExcessSpy12m: avg(rows.map((row) => row.excess?.["12m"]?.SPY)),
    averageExcessQqq12m: avg(rows.map((row) => row.excess?.["12m"]?.QQQ)),
    positive12mRate: round(ratio(rows.map((row) => row.returns?.["12m"]), (value) => value > 0), 4),
    beatQqq12mRate: round(ratio(rows.map((row) => row.excess?.["12m"]?.QQQ), (value) => value > 0), 4),
    setupRate: round(ratio(rows.map((row) => row.setup), (value) => value !== "none"), 4),
    aiHardwareRate: round(ratio(rows.map((row) => row.isAiHardware), Boolean), 4)
  };
}

function groupBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row) ?? "unknown";
    const current = map.get(key) ?? [];
    current.push(row);
    map.set(key, current);
  }
  return Array.from(map, ([key, group]) => ({ key, ...summarizeRows(group) }))
    .sort((a, b) => b.count - a.count);
}

function topWithin(rows, keyFn, limit = 10) {
  return groupBy(rows, keyFn)
    .filter((row) => row.count >= 3)
    .sort((a, b) => b.average12m - a.average12m)
    .slice(0, limit);
}

function symbolStats(rows) {
  return groupBy(rows, (row) => row.symbol)
    .map((row) => ({
      ...row,
      name: rows.find((item) => item.symbol === row.key)?.name
    }));
}

function buildAnalysis(data) {
  const cases = flattenPeriods(data.periods ?? []);
  const classOrder = ["strong_winner", "winner", "positive_lagging", "loser"];
  const byClass = Object.fromEntries(classOrder.map((key) => [
    key,
    summarizeRows(cases.filter((row) => row.class === key))
  ]));
  const sectors = groupBy(cases, (row) => row.sector);
  const statuses = groupBy(cases, (row) => row.status);
  const setups = groupBy(cases, (row) => row.setup);
  const regimes = groupBy(cases, (row) => row.marketRegime);
  const scoreBands = groupBy(cases, (row) => row.scoreBand)
    .sort((a, b) => Number.parseInt(b.key, 10) - Number.parseInt(a.key, 10));
  const symbols = symbolStats(cases);

  return {
    generatedAt: new Date().toISOString(),
    sourceGeneratedAt: data.generatedAt,
    periodCount: data.asOfCount,
    caseCount: cases.length,
    definition: {
      caseUnit: "monthly Top20 selection instance",
      strongWinner: "12M return >= 30% and 12M excess return over QQQ >= 10 percentage points",
      winner: "12M return > 0% and 12M return beats QQQ",
      loser: "12M return < 0% or 12M excess return versus QQQ <= -10 percentage points",
      positiveLagging: "12M return is positive, but it does not beat QQQ and does not lag QQQ by 10 percentage points or more"
    },
    overall: summarizeRows(cases),
    byClass,
    byScoreBand: scoreBands,
    byStatus: statuses,
    bySetup: setups,
    byRegime: regimes,
    bySector: sectors,
    bestSectors: topWithin(cases, (row) => row.sector, 10),
    worstSectors: groupBy(cases, (row) => row.sector)
      .filter((row) => row.count >= 3)
      .sort((a, b) => a.average12m - b.average12m)
      .slice(0, 10),
    aiHardware: {
      yes: summarizeRows(cases.filter((row) => row.isAiHardware)),
      no: summarizeRows(cases.filter((row) => !row.isAiHardware))
    },
    repeatedSymbols: symbols
      .filter((row) => row.count >= 5)
      .sort((a, b) => b.average12m - a.average12m)
      .slice(0, 15),
    bestCases: [...cases]
      .sort((a, b) => b.returns["12m"] - a.returns["12m"])
      .slice(0, 15)
      .map(caseRow),
    worstCases: [...cases]
      .sort((a, b) => a.returns["12m"] - b.returns["12m"])
      .slice(0, 15)
      .map(caseRow)
  };
}

function caseRow(row) {
  return {
    asOf: row.asOf,
    rank: row.rank,
    symbol: row.symbol,
    name: row.name,
    sector: row.sector,
    status: row.status,
    setup: row.setup,
    score: row.score,
    return12m: row.returns["12m"],
    excessQqq12m: row.excess["12m"].QQQ,
    class: row.class
  };
}

function table(lines, rows, columns) {
  lines.push(`| ${columns.map((col) => col.label).join(" | ")} |`);
  lines.push(`| ${columns.map((col) => col.align ?? "---").join(" | ")} |`);
  for (const row of rows) {
    lines.push(`| ${columns.map((col) => col.format ? col.format(row[col.key], row) : row[col.key]).join(" | ")} |`);
  }
}

function markdown(analysis) {
  const lines = [];
  lines.push("# Winner / Loser Analysis");
  lines.push("");
  lines.push(`Generated at: ${analysis.generatedAt}`);
  lines.push(`Source data generated at: ${analysis.sourceGeneratedAt}`);
  lines.push(`Cases: ${analysis.caseCount} monthly Top20 selection instances across ${analysis.periodCount} periods`);
  lines.push("");
  lines.push("## Definitions");
  lines.push("");
  lines.push("- Strong winner: 12M return >= 30% and QQQ excess >= +10%p.");
  lines.push("- Winner: 12M return > 0% and beat QQQ.");
  lines.push("- Loser: 12M return < 0% or lagged QQQ by at least 10%p.");
  lines.push("- Positive lagging: positive 12M return, but did not beat QQQ and did not badly lag QQQ.");
  lines.push("");
  lines.push("## Class Summary");
  lines.push("");
  table(lines, Object.entries(analysis.byClass).map(([key, value]) => ({ key, ...value })), [
    { key: "key", label: "Class" },
    { key: "count", label: "Count", align: "---:" },
    { key: "averageRank", label: "Avg Rank", align: "---:" },
    { key: "averageScore", label: "Avg Score", align: "---:" },
    { key: "average12m", label: "Avg 12M", align: "---:", format: pct },
    { key: "averageExcessQqq12m", label: "Avg QQQ Excess", align: "---:", format: pct },
    { key: "setupRate", label: "Setup Rate", align: "---:", format: pct },
    { key: "aiHardwareRate", label: "AI/Semi Rate", align: "---:", format: pct }
  ]);
  lines.push("");
  lines.push("## Score Bands");
  lines.push("");
  table(lines, analysis.byScoreBand, [
    { key: "key", label: "Score Band" },
    { key: "count", label: "Count", align: "---:" },
    { key: "average12m", label: "Avg 12M", align: "---:", format: pct },
    { key: "beatQqq12mRate", label: "Beat QQQ", align: "---:", format: pct },
    { key: "averageExcessQqq12m", label: "Avg QQQ Excess", align: "---:", format: pct }
  ]);
  lines.push("");
  lines.push("## Status / Setup");
  lines.push("");
  table(lines, analysis.byStatus, [
    { key: "key", label: "Status" },
    { key: "count", label: "Count", align: "---:" },
    { key: "average12m", label: "Avg 12M", align: "---:", format: pct },
    { key: "beatQqq12mRate", label: "Beat QQQ", align: "---:", format: pct }
  ]);
  lines.push("");
  table(lines, analysis.bySetup, [
    { key: "key", label: "Setup" },
    { key: "count", label: "Count", align: "---:" },
    { key: "average12m", label: "Avg 12M", align: "---:", format: pct },
    { key: "beatQqq12mRate", label: "Beat QQQ", align: "---:", format: pct }
  ]);
  lines.push("");
  lines.push("## Best Sectors");
  lines.push("");
  table(lines, analysis.bestSectors, [
    { key: "key", label: "Sector" },
    { key: "count", label: "Count", align: "---:" },
    { key: "average12m", label: "Avg 12M", align: "---:", format: pct },
    { key: "beatQqq12mRate", label: "Beat QQQ", align: "---:", format: pct },
    { key: "setupRate", label: "Setup Rate", align: "---:", format: pct }
  ]);
  lines.push("");
  lines.push("## AI / Semiconductor Hardware");
  lines.push("");
  table(lines, [
    { key: "AI/Semi", ...analysis.aiHardware.yes },
    { key: "Other", ...analysis.aiHardware.no }
  ], [
    { key: "key", label: "Group" },
    { key: "count", label: "Count", align: "---:" },
    { key: "average12m", label: "Avg 12M", align: "---:", format: pct },
    { key: "beatQqq12mRate", label: "Beat QQQ", align: "---:", format: pct },
    { key: "averageExcessQqq12m", label: "Avg QQQ Excess", align: "---:", format: pct }
  ]);
  lines.push("");
  lines.push("## Repeated Winners");
  lines.push("");
  table(lines, analysis.repeatedSymbols, [
    { key: "key", label: "Symbol" },
    { key: "name", label: "Name" },
    { key: "count", label: "Count", align: "---:" },
    { key: "average12m", label: "Avg 12M", align: "---:", format: pct },
    { key: "beatQqq12mRate", label: "Beat QQQ", align: "---:", format: pct }
  ]);
  lines.push("");
  lines.push("## Best Cases");
  lines.push("");
  table(lines, analysis.bestCases.slice(0, 10), [
    { key: "asOf", label: "As Of" },
    { key: "rank", label: "Rank", align: "---:" },
    { key: "symbol", label: "Symbol" },
    { key: "sector", label: "Sector" },
    { key: "score", label: "Score", align: "---:" },
    { key: "return12m", label: "12M", align: "---:", format: pct },
    { key: "excessQqq12m", label: "QQQ Excess", align: "---:", format: pct }
  ]);
  lines.push("");
  lines.push("## Worst Cases");
  lines.push("");
  table(lines, analysis.worstCases.slice(0, 10), [
    { key: "asOf", label: "As Of" },
    { key: "rank", label: "Rank", align: "---:" },
    { key: "symbol", label: "Symbol" },
    { key: "sector", label: "Sector" },
    { key: "score", label: "Score", align: "---:" },
    { key: "return12m", label: "12M", align: "---:", format: pct },
    { key: "excessQqq12m", label: "QQQ Excess", align: "---:", format: pct }
  ]);
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("- This is selection-instance analysis, so the same ticker can appear multiple times.");
  lines.push("- It tests selection power only. It does not include 1H/4H entries, stops, sizing, taxes, commissions, or slippage.");
  lines.push("- Current universe membership creates survivorship bias.");
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const raw = await fs.readFile(inputPath, "utf8");
  const data = JSON.parse(raw);
  const analysis = buildAnalysis(data);
  await fs.mkdir("data", { recursive: true });
  await fs.writeFile(outputJsonPath, JSON.stringify(analysis, null, 2), "utf8");
  await fs.writeFile(outputMdPath, markdown(analysis), "utf8");
  console.log(`Wrote ${outputJsonPath} and ${outputMdPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
