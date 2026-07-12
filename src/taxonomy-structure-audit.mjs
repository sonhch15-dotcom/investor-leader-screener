import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { priceMapFromSnapshot, readPriceSnapshot } from "./backtest-price-snapshot.mjs";
import { scoreUniverse } from "./scoring.mjs";
import { clamp, mean, round } from "./math.mjs";

const UNIVERSE_PATH = "data/universe.json";
const SNAPSHOT_PATH = "data/sector-score-price-snapshot-corrected-frozen-20260711.json.gz";
const OUTPUT_PATH = "data/taxonomy-structure-audit.json";
const YEARS = 5;
const HOLD_MONTHS = 6;
const COST_BPS = 10;
const BROAD_SECTORS = new Set([
  "Communication Services",
  "Consumer Discretionary",
  "Consumer Staples",
  "Energy",
  "Financials",
  "Health Care",
  "Industrials",
  "Information Technology",
  "Materials",
  "Real Estate",
  "Utilities"
]);

const variants = [
  {
    key: "legacy_raw",
    label: "57개 혼합 분류 원형",
    mode: "group",
    minimumGroupSize: 3,
    shrinkStrength: 0
  },
  {
    key: "legacy_min8",
    label: "8종목 미만 그룹 제외",
    mode: "group",
    minimumGroupSize: 8,
    shrinkStrength: 0
  },
  {
    key: "legacy_shrink8",
    label: "소형 그룹 표본 보정",
    mode: "group",
    minimumGroupSize: 3,
    shrinkStrength: 8
  },
  {
    key: "legacy_min8_shrink8",
    label: "8종목 기준 + 표본 보정",
    mode: "group",
    minimumGroupSize: 8,
    shrinkStrength: 8
  },
  {
    key: "no_group",
    label: "업종 단계 없이 상위 2종목",
    mode: "individual"
  }
];

function parseDate(value) {
  return new Date(`${value}T00:00:00Z`);
}

function isoDate(value) {
  return value.toISOString().slice(0, 10);
}

function addYears(value, years) {
  const next = new Date(value);
  next.setUTCFullYear(next.getUTCFullYear() + years);
  return next;
}

function rowsUntil(rows, asOf) {
  return rows.filter((row) => row.date <= asOf);
}

function firstRowAfter(rows, date) {
  return rows.find((row) => row.date > date && Number.isFinite(row.close)) ?? null;
}

function rowOnOrAfter(rows, date) {
  return rows.find((row) => row.date >= date && Number.isFinite(row.close)) ?? null;
}

function monthlyLastFridays(startDate, endDate) {
  const dates = [];
  const cursor = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1));
  while (cursor <= endDate) {
    const lastDay = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
    while (lastDay.getUTCDay() !== 5) lastDay.setUTCDate(lastDay.getUTCDate() - 1);
    if (lastDay >= startDate && lastDay <= endDate) dates.push(isoDate(lastDay));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return dates;
}

function weightedMomentum(metrics) {
  const parts = [[metrics?.r1m, 0.4], [metrics?.r3m, 0.35], [metrics?.r6m, 0.25]]
    .filter(([value]) => Number.isFinite(value));
  if (!parts.length) return null;
  const weight = parts.reduce((sum, [, itemWeight]) => sum + itemWeight, 0);
  return parts.reduce((sum, [value, itemWeight]) => sum + value * itemWeight, 0) / weight;
}

function finiteMean(values) {
  return mean(values.filter(Number.isFinite));
}

function rate(rows, predicate) {
  return rows.length ? rows.filter(predicate).length / rows.length : null;
}

function periodReturn(priceMap, symbol, startDate, endDate) {
  const rows = priceMap.get(symbol) ?? [];
  const start = rowOnOrAfter(rows, startDate);
  const end = rowOnOrAfter(rows, endDate);
  if (!start || !end || !start.close) return null;
  return end.close / start.close - 1;
}

function basketReturn(priceMap, symbols, startDate, endDate) {
  return finiteMean(symbols.map((symbol) => periodReturn(priceMap, symbol, startDate, endDate)));
}

function annualizedReturn(totalReturn, months) {
  if (!months || !Number.isFinite(totalReturn) || totalReturn <= -1) return null;
  return (1 + totalReturn) ** (12 / months) - 1;
}

function maxDrawdown(curve) {
  let peak = 1;
  let worst = 0;
  for (const row of curve) {
    peak = Math.max(peak, row.equity);
    worst = Math.min(worst, row.equity / peak - 1);
  }
  return worst;
}

function buildGroupStats(rows) {
  const stocks = rows.filter((row) => row.type === "stock" && row.sector);
  const eligible = stocks.filter((row) => row.status !== "excluded");
  const top20 = eligible.slice(0, 20);
  const top50 = eligible.slice(0, 50);
  const top100 = eligible.slice(0, 100);
  const spyMomentum = weightedMomentum(rows.find((row) => row.symbol === "SPY")?.metrics);
  const qqqMomentum = weightedMomentum(rows.find((row) => row.symbol === "QQQ")?.metrics);
  const groups = new Map();

  for (const row of stocks) {
    const groupRows = groups.get(row.sector) ?? [];
    groupRows.push(row);
    groups.set(row.sector, groupRows);
  }

  return Array.from(groups, ([group, groupRows]) => {
    const groupEligible = groupRows.filter((row) => row.status !== "excluded");
    const groupMomentum = groupRows.map((row) => weightedMomentum(row.metrics));
    const groupTop20 = top20.filter((row) => row.sector === group);
    const groupTop50 = top50.filter((row) => row.sector === group);
    const groupTop100 = top100.filter((row) => row.sector === group);
    return {
      group,
      universeCount: groupRows.length,
      eligibleCount: groupEligible.length,
      top20Count: groupTop20.length,
      top50Count: groupTop50.length,
      top100Count: groupTop100.length,
      eligibleRate: groupEligible.length / groupRows.length,
      top50Concentration: groupTop50.length / groupRows.length,
      top100Concentration: groupTop100.length / groupRows.length,
      averageMomentum: finiteMean(groupMomentum),
      averageSpyExcessMomentum: finiteMean(groupMomentum.map((value) => value - spyMomentum)),
      averageQqqExcessMomentum: finiteMean(groupMomentum.map((value) => value - qqqMomentum)),
      above50Rate: rate(groupRows, (row) => row.metrics?.above50),
      above200Rate: rate(groupRows, (row) => row.metrics?.above200),
      nearHighRate: rate(groupRows, (row) => row.metrics?.high52wDistance >= -0.1),
      score75Rate: rate(groupRows, (row) => row.score >= 75),
      score80Rate: rate(groupRows, (row) => row.score >= 80)
    };
  });
}

const SHRINK_FIELDS = [
  "eligibleRate",
  "top50Concentration",
  "top100Concentration",
  "averageMomentum",
  "averageSpyExcessMomentum",
  "averageQqqExcessMomentum",
  "above50Rate",
  "above200Rate",
  "nearHighRate",
  "score75Rate",
  "score80Rate"
];

function weightedPrior(groups, field) {
  const valid = groups.filter((row) => Number.isFinite(row[field]) && row.universeCount > 0);
  const count = valid.reduce((sum, row) => sum + row.universeCount, 0);
  return count ? valid.reduce((sum, row) => sum + row[field] * row.universeCount, 0) / count : 0;
}

function shrinkGroups(groups, strength) {
  if (!strength) return groups.map((row) => ({ ...row }));
  const priors = Object.fromEntries(SHRINK_FIELDS.map((field) => [field, weightedPrior(groups, field)]));
  return groups.map((row) => {
    const adjusted = { ...row };
    for (const field of SHRINK_FIELDS) {
      const value = row[field];
      if (!Number.isFinite(value)) continue;
      adjusted[field] = (value * row.universeCount + priors[field] * strength)
        / (row.universeCount + strength);
    }
    return adjusted;
  });
}

function previousStats(history, groupName, lookback = 3) {
  const rows = history.slice(-lookback)
    .map((period) => period.groupStats.find((group) => group.group === groupName))
    .filter(Boolean);
  return {
    periodsPresent: rows.length,
    averageTop50Count: finiteMean(rows.map((row) => row.top50Count)) ?? 0
  };
}

function scoreGroup(group, history) {
  const previous = previousStats(history, group.group);
  const acceleration = group.top50Count - previous.averageTop50Count;
  const leadershipScore =
    clamp(group.averageQqqExcessMomentum, -0.2, 0.4) * 100
    + clamp(group.averageSpyExcessMomentum, -0.2, 0.4) * 60
    + group.above50Rate * 22
    + group.above200Rate * 16
    + group.nearHighRate * 16
    + group.score75Rate * 20
    + group.score80Rate * 12
    + group.eligibleRate * 12
    + group.top50Concentration * 90
    + group.top100Concentration * 35
    + group.top20Count * 8
    + clamp(acceleration, -4, 6) * 4
    + previous.periodsPresent * 4;
  return { ...group, leadershipScore: round(leadershipScore, 2) };
}

function selectRows(period, variant) {
  if (variant.mode === "individual") return period.candidates.slice(0, 2);
  const selected = [];
  for (const group of period.groupStats.slice(0, 2)) {
    const row = period.candidates.find((candidate) => candidate.sector === group.group);
    if (row) selected.push(row);
  }
  return selected;
}

async function buildBasePeriods(instruments, priceMap) {
  const latest = priceMap.get("SPY")?.at(-1)?.date;
  const endDate = parseDate(latest);
  const startDate = addYears(endDate, -YEARS);
  const periods = [];

  for (const [index, asOf] of monthlyLastFridays(startDate, endDate).entries()) {
    const sliced = new Map();
    for (const [symbol, rows] of priceMap) sliced.set(symbol, rowsUntil(rows, asOf));
    const scored = scoreUniverse(instruments, sliced, { sectorThemeWeight: 0, normalizeScore: true });
    const entryRow = firstRowAfter(priceMap.get("SPY") ?? [], asOf);
    if (!entryRow) continue;
    periods.push({
      asOf,
      entryDate: entryRow.date,
      groups: buildGroupStats(scored.rows),
      candidates: scored.rows
        .filter((row) => row.type === "stock" && row.sector && row.status !== "excluded")
        .map((row, rank) => ({ ...row, rank: rank + 1 }))
    });
    if ((index + 1) % 12 === 0) console.log(`Scored ${index + 1} signal months`);
  }
  return { periods, startDate: isoDate(startDate), endDate: isoDate(endDate) };
}

function buildVariantPeriods(basePeriods, variant) {
  if (variant.mode === "individual") {
    return basePeriods.map((period) => ({ ...period, groupStats: [] }));
  }
  const history = [];
  return basePeriods.map((period) => {
    const eligible = period.groups.filter((group) => group.universeCount >= variant.minimumGroupSize);
    const groupStats = shrinkGroups(eligible, variant.shrinkStrength)
      .map((group) => scoreGroup(group, history))
      .sort((a, b) => b.leadershipScore - a.leadershipScore);
    const built = { ...period, groupStats };
    history.push(built);
    return built;
  });
}

function sliceReturn(curve, start, end) {
  const rows = curve.filter((row) => row.asOf >= start && row.asOf <= end);
  const strategy = rows.reduce((equity, row) => equity * (1 + row.netReturn), 1) - 1;
  const qqq = rows.reduce((equity, row) => equity * (1 + row.qqqReturn), 1) - 1;
  return { months: rows.length, strategy: round(strategy, 4), qqq: round(qqq, 4), excess: round(strategy - qqq, 4) };
}

function simulate(priceMap, periods, variant) {
  let equity = 1;
  let qqqEquity = 1;
  const curve = [];
  const selections = [];

  for (const period of periods) {
    const rows = selectRows(period, variant);
    const groupByName = new Map(period.groupStats.map((row) => [row.group, row]));
    selections.push({
      asOf: period.asOf,
      entryDate: period.entryDate,
      symbols: rows.map((row) => row.symbol),
      groups: rows.map((row) => row.sector),
      groupSizes: rows.map((row) => groupByName.get(row.sector)?.universeCount ?? null)
    });
  }

  for (let index = 0; index < periods.length - 1; index += 1) {
    const current = periods[index];
    const next = periods[index + 1];
    const cohorts = [];
    for (let offset = 0; offset < HOLD_MONTHS; offset += 1) {
      const cohort = periods[index - offset];
      if (!cohort) continue;
      const rows = selectRows(cohort, variant);
      if (rows.length) cohorts.push(rows);
    }
    if (!cohorts.length) continue;
    const cohortReturns = cohorts
      .map((rows) => basketReturn(priceMap, rows.map((row) => row.symbol), current.entryDate, next.entryDate))
      .filter(Number.isFinite);
    const grossReturn = finiteMean(cohortReturns);
    const qqqReturn = periodReturn(priceMap, "QQQ", current.entryDate, next.entryDate);
    if (!Number.isFinite(grossReturn) || !Number.isFinite(qqqReturn)) continue;
    const turnoverWeight = 1 / HOLD_MONTHS;
    const netReturn = grossReturn - turnoverWeight * COST_BPS / 10_000
      - (index >= HOLD_MONTHS ? turnoverWeight * COST_BPS / 10_000 : 0);
    equity *= 1 + netReturn;
    qqqEquity *= 1 + qqqReturn;
    curve.push({
      asOf: current.asOf,
      netReturn: round(netReturn, 6),
      qqqReturn: round(qqqReturn, 6),
      equity: round(equity, 6),
      qqqEquity: round(qqqEquity, 6)
    });
  }

  const groupSizes = selections.flatMap((row) => row.groupSizes).filter(Number.isFinite);
  const selectedGroupCounts = new Map();
  for (const group of selections.flatMap((row) => row.groups)) {
    selectedGroupCounts.set(group, (selectedGroupCounts.get(group) ?? 0) + 1);
  }
  const totalReturn = equity - 1;
  const qqqTotalReturn = qqqEquity - 1;
  return {
    ...variant,
    totalReturn: round(totalReturn, 4),
    cagr: round(annualizedReturn(totalReturn, curve.length), 4),
    qqqTotalReturn: round(qqqTotalReturn, 4),
    excessReturn: round(totalReturn - qqqTotalReturn, 4),
    maxDrawdown: round(maxDrawdown(curve), 4),
    beatQqqMonthRate: round(curve.filter((row) => row.netReturn > row.qqqReturn).length / curve.length, 4),
    averageSelectedGroupSize: groupSizes.length ? round(finiteMean(groupSizes), 2) : null,
    smallGroupSelectionRate: groupSizes.length
      ? round(groupSizes.filter((size) => size <= 5).length / groupSizes.length, 4)
      : null,
    topSelectedGroups: Array.from(selectedGroupCounts, ([group, count]) => ({ group, count }))
      .sort((a, b) => b.count - a.count || a.group.localeCompare(b.group))
      .slice(0, 10),
    periods: {
      early: sliceReturn(curve, "2021-07-01", "2022-12-31"),
      middle: sliceReturn(curve, "2023-01-01", "2024-12-31"),
      recent: sliceReturn(curve, "2025-01-01", "2026-12-31")
    },
    curve,
    selections
  };
}

function overlapWithRaw(raw, candidate) {
  const byMonth = new Map(candidate.selections.map((row) => [row.asOf, new Set(row.symbols)]));
  const rates = raw.selections.filter((row) => row.symbols.length).map((row) => {
    const other = byMonth.get(row.asOf) ?? new Set();
    return row.symbols.filter((symbol) => other.has(symbol)).length / row.symbols.length;
  });
  return round(finiteMean(rates), 4);
}

function quantile(values, percentile) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.floor((sorted.length - 1) * percentile)];
}

function buildStructure(instruments) {
  const stocks = instruments.filter((row) => row.type === "stock" && row.sector);
  const groups = new Map();
  for (const row of stocks) {
    const items = groups.get(row.sector) ?? [];
    items.push(row);
    groups.set(row.sector, items);
  }
  const labels = Array.from(groups, ([label, rows]) => ({
    label,
    count: rows.length,
    level: BROAD_SECTORS.has(label) ? "broad_sector" : "industry_like",
    sourceMix: Array.from(new Set(rows.flatMap((row) => String(row.source).split(",")))).sort(),
    examples: rows.slice(0, 5).map((row) => row.symbol)
  })).sort((a, b) => a.count - b.count || a.label.localeCompare(b.label));
  const sizes = labels.map((row) => row.count);
  return {
    stockCount: stocks.length,
    labelCount: labels.length,
    broadLabelCount: labels.filter((row) => row.level === "broad_sector").length,
    industryLikeLabelCount: labels.filter((row) => row.level === "industry_like").length,
    minimumSize: Math.min(...sizes),
    medianSize: quantile(sizes, 0.5),
    maximumSize: Math.max(...sizes),
    labelsAtMost2: labels.filter((row) => row.count <= 2).length,
    labelsAtMost5: labels.filter((row) => row.count <= 5).length,
    labelsBelow8: labels.filter((row) => row.count < 8).length,
    labels
  };
}

async function main() {
  const instruments = JSON.parse(await fs.readFile(UNIVERSE_PATH, "utf8"));
  const snapshot = await readPriceSnapshot(SNAPSHOT_PATH);
  const priceMap = priceMapFromSnapshot(snapshot);
  const missing = instruments.filter((row) => !(priceMap.get(row.symbol)?.length));
  if (missing.length) throw new Error(`Price snapshot is missing ${missing.length} symbols.`);

  const built = await buildBasePeriods(instruments, priceMap);
  const results = variants.map((variant) => simulate(priceMap, buildVariantPeriods(built.periods, variant), variant));
  const raw = results.find((row) => row.key === "legacy_raw");
  for (const row of results) row.selectionOverlapWithRaw = overlapWithRaw(raw, row);

  const output = {
    generatedAt: new Date().toISOString(),
    runId: "us-taxonomy-structure-frozen-20260712-v1",
    grade: "exploratory_structure_audit",
    fixedInputs: {
      universePath: UNIVERSE_PATH,
      universeHash: createHash("sha256").update(JSON.stringify(instruments)).digest("hex"),
      snapshotPath: SNAPSHOT_PATH,
      snapshotHash: snapshot.hash,
      priceAsOf: snapshot.asOf,
      years: YEARS,
      individualScore: "no-sector normalized score; identical in every variant",
      holdingModel: `${HOLD_MONTHS}-month overlapping cohorts`,
      costBpsEachSide: COST_BPS
    },
    limitations: [
      "The universe is the stored 2026 constituent snapshot, not point-in-time membership.",
      "This isolates the selection layer and does not reproduce the Cap27.5 account or weekly extension exit.",
      "Morningstar labels are not present in this frozen local snapshot; coherent Morningstar evidence is taken from the separate QuantConnect audits."
    ],
    structure: buildStructure(instruments),
    results,
    rankedResults: [...results].sort((a, b) => b.totalReturn - a.totalReturn)
  };
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2), "utf8");
  console.log(`Wrote ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
