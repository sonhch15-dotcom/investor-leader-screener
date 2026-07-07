import fs from "node:fs/promises";
import path from "node:path";
import { mean, round } from "./math.mjs";

const inputPath = path.join("data", "monthly-selection-test.json");
const outputJsonPath = path.join("data", "sector-diversification-test.json");
const outputMdPath = "sector_diversification_test.md";
const horizons = ["1m", "3m", "6m", "12m"];

function clean(values) {
  return values.filter(Number.isFinite);
}

function avg(values) {
  return round(mean(clean(values)), 4);
}

function median(values) {
  const rows = clean(values).sort((a, b) => a - b);
  if (!rows.length) return null;
  const middle = Math.floor(rows.length / 2);
  return rows.length % 2 ? rows[middle] : (rows[middle - 1] + rows[middle]) / 2;
}

function ratio(values, predicate) {
  const rows = clean(values);
  if (!rows.length) return null;
  return rows.filter(predicate).length / rows.length;
}

function pct(value) {
  if (!Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(1)}%`;
}

function scoreGroup(group, history) {
  const previous = history.slice(-3)
    .map((period) => period.groupStats.find((item) => item.group === group.group))
    .filter(Boolean);
  const priorTop50 = mean(previous.map((item) => item.top50Count)) ?? 0;
  const acceleration = group.top50Count - priorTop50;
  const leadershipScore = round(
    Math.max(-0.2, Math.min(0.4, group.averageQqqExcessMomentum)) * 100
    + Math.max(-0.2, Math.min(0.4, group.averageSpyExcessMomentum)) * 60
    + group.above50Rate * 22
    + group.above200Rate * 16
    + group.nearHighRate * 16
    + group.score75Rate * 20
    + group.score80Rate * 12
    + group.eligibleRate * 12
    + group.top50Concentration * 90
    + group.top100Concentration * 35
    + group.top20Count * 8
    + Math.max(-4, Math.min(6, acceleration)) * 4
    + previous.length * 4,
    2
  );
  return {
    ...group,
    top50Acceleration: round(acceleration, 2),
    leadershipScore
  };
}

function annotatePeriods(periods) {
  const history = [];
  return periods.map((period) => {
    const groupStats = (period.groupStats ?? [])
      .map((group) => scoreGroup(group, history))
      .sort((a, b) => b.leadershipScore - a.leadershipScore);
    const annotated = {
      ...period,
      groupStats,
      selections: period.selections.map((row, index) => ({ ...row, rank: index + 1 }))
    };
    history.push(annotated);
    return annotated;
  });
}

function leaderGroups(period, count) {
  return period.groupStats.slice(0, count).map((group) => group.group);
}

function qualityGroups(period, count) {
  return period.groupStats
    .filter((group) => (
      group.averageQqqExcessMomentum > 0
      && group.above50Rate >= 0.55
      && group.score75Rate >= 0.15
      && group.top50Count >= 2
    ))
    .slice(0, count)
    .map((group) => group.group);
}

function selectByGroups(period, groups, limit) {
  const set = new Set(groups);
  return period.selections.filter((row) => set.has(row.sector)).slice(0, limit);
}

function selectCapped(period, groups, totalLimit, perSectorLimit) {
  const set = new Set(groups);
  const counts = new Map();
  const selected = [];
  for (const row of period.selections) {
    if (!set.has(row.sector)) continue;
    const count = counts.get(row.sector) ?? 0;
    if (count >= perSectorLimit) continue;
    selected.push(row);
    counts.set(row.sector, count + 1);
    if (selected.length >= totalLimit) break;
  }
  return selected;
}

function selectBalanced(period, groups, perSectorLimit) {
  const selected = [];
  for (const group of groups) {
    selected.push(...period.selections.filter((row) => row.sector === group).slice(0, perSectorLimit));
  }
  return selected.sort((a, b) => a.rank - b.rank);
}

const strategies = [
  {
    key: "concentrated_top5",
    label: "Concentrated Top5",
    description: "상위 2개 주도 그룹에서 최대 5개 선택",
    select: (period) => selectByGroups(period, leaderGroups(period, 2), 5)
  },
  {
    key: "concentrated_top10",
    label: "Concentrated Top10",
    description: "상위 2개 주도 그룹에서 최대 10개 선택",
    select: (period) => selectByGroups(period, leaderGroups(period, 2), 10)
  },
  {
    key: "broad_top10",
    label: "Broad Top10",
    description: "상위 3개 주도 그룹에서 최대 10개 선택",
    select: (period) => selectByGroups(period, leaderGroups(period, 3), 10)
  },
  {
    key: "capped_top10_2_per_sector",
    label: "Capped Top10, Max 2/Sector",
    description: "상위 5개 주도 그룹에서 섹터당 최대 2개, 총 10개 선택",
    select: (period) => selectCapped(period, leaderGroups(period, 5), 10, 2)
  },
  {
    key: "capped_top10_3_per_sector",
    label: "Capped Top10, Max 3/Sector",
    description: "상위 5개 주도 그룹에서 섹터당 최대 3개, 총 10개 선택",
    select: (period) => selectCapped(period, leaderGroups(period, 5), 10, 3)
  },
  {
    key: "balanced_top6_3x2",
    label: "Balanced Top6, 3x2",
    description: "상위 3개 주도 그룹에서 각 2개 선택",
    select: (period) => selectBalanced(period, leaderGroups(period, 3), 2)
  },
  {
    key: "balanced_top10_5x2",
    label: "Balanced Top10, 5x2",
    description: "상위 5개 주도 그룹에서 각 2개 선택",
    select: (period) => selectBalanced(period, leaderGroups(period, 5), 2).slice(0, 10)
  },
  {
    key: "quality_capped_top10",
    label: "Quality Capped Top10",
    description: "품질 조건 통과 그룹에서 섹터당 최대 2개, 총 10개 선택",
    select: (period) => selectCapped(period, qualityGroups(period, 5), 10, 2)
  }
];

function concentrationStats(selected) {
  if (!selected.length) {
    return {
      sectorCount: 0,
      maxSectorWeight: null,
      selectedSectors: []
    };
  }
  const counts = new Map();
  for (const row of selected) counts.set(row.sector, (counts.get(row.sector) ?? 0) + 1);
  const sectorCounts = Array.from(counts.values());
  return {
    sectorCount: counts.size,
    maxSectorWeight: Math.max(...sectorCounts) / selected.length,
    selectedSectors: Array.from(counts, ([sector, count]) => ({ sector, count }))
      .sort((a, b) => b.count - a.count || a.sector.localeCompare(b.sector))
  };
}

function summarizeStrategy(periods, strategy) {
  const periodRows = periods.map((period) => {
    const selected = strategy.select(period);
    const concentration = concentrationStats(selected);
    const result = {
      asOf: period.asOf,
      selectedCount: selected.length,
      leadingGroups: period.groupStats.slice(0, 5).map((group) => group.group),
      symbols: selected.map((row) => row.symbol),
      selectedSectors: concentration.selectedSectors,
      sectorCount: concentration.sectorCount,
      maxSectorWeight: round(concentration.maxSectorWeight, 4)
    };
    for (const horizon of horizons) {
      const returns = selected.map((row) => row.returns?.[horizon]).filter(Number.isFinite);
      const portfolioReturn = avg(returns);
      const spyReturn = period.benchmarks?.SPY?.[horizon];
      const qqqReturn = period.benchmarks?.QQQ?.[horizon];
      result[horizon] = {
        portfolioReturn,
        spyReturn,
        qqqReturn,
        excessSpy: round(portfolioReturn - spyReturn, 4),
        excessQqq: round(portfolioReturn - qqqReturn, 4)
      };
    }
    return result;
  });

  return {
    key: strategy.key,
    label: strategy.label,
    description: strategy.description,
    periods: periodRows.length,
    activePeriods: periodRows.filter((row) => row.selectedCount > 0).length,
    emptyPeriods: periodRows.filter((row) => row.selectedCount === 0).length,
    averageSelectedCount: avg(periodRows.map((row) => row.selectedCount)),
    averageSectorCount: avg(periodRows.map((row) => row.sectorCount)),
    averageMaxSectorWeight: avg(periodRows.map((row) => row.maxSectorWeight)),
    horizons: Object.fromEntries(horizons.map((horizon) => {
      const rows = periodRows.filter((row) => Number.isFinite(row[horizon].portfolioReturn));
      const returns = rows.map((row) => row[horizon].portfolioReturn);
      const excessSpy = rows.map((row) => row[horizon].excessSpy);
      const excessQqq = rows.map((row) => row[horizon].excessQqq);
      return [horizon, {
        periods: rows.length,
        averageReturn: avg(returns),
        medianReturn: round(median(returns), 4),
        positiveRate: round(ratio(returns, (value) => value > 0), 4),
        beatSpyRate: round(ratio(excessSpy, (value) => value > 0), 4),
        beatQqqRate: round(ratio(excessQqq, (value) => value > 0), 4),
        averageExcessSpy: avg(excessSpy),
        averageExcessQqq: avg(excessQqq),
        worstReturn: returns.length ? round(Math.min(...returns), 4) : null
      }];
    })),
    periodsDetail: periodRows
  };
}

function splitPeriods(periods) {
  const splitIndex = Math.floor(periods.length / 2);
  return [
    { key: "all", label: "All", periods },
    { key: "early", label: "Early Half", periods: periods.slice(0, splitIndex) },
    { key: "late", label: "Late Half", periods: periods.slice(splitIndex) },
    { key: "recent12", label: "Recent 12", periods: periods.slice(-12) }
  ];
}

function rowsFor(results, horizon) {
  return results
    .map((result) => ({
      key: result.key,
      label: result.label,
      activePeriods: result.activePeriods,
      emptyPeriods: result.emptyPeriods,
      averageSelectedCount: result.averageSelectedCount,
      averageSectorCount: result.averageSectorCount,
      averageMaxSectorWeight: result.averageMaxSectorWeight,
      ...result.horizons[horizon]
    }))
    .sort((a, b) => b.averageExcessQqq - a.averageExcessQqq);
}

function table(lines, rows) {
  lines.push("| Strategy | Active | Empty | Avg Names | Avg Sectors | Max Sector Wt | Avg | Median | Positive | Beat QQQ | Avg QQQ Excess | Worst |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const row of rows) {
    lines.push(`| ${row.label} | ${row.activePeriods} | ${row.emptyPeriods} | ${number(row.averageSelectedCount)} | ${number(row.averageSectorCount)} | ${pct(row.averageMaxSectorWeight)} | ${pct(row.averageReturn)} | ${pct(row.medianReturn)} | ${pct(row.positiveRate)} | ${pct(row.beatQqqRate)} | ${pct(row.averageExcessQqq)} | ${pct(row.worstReturn)} |`);
  }
}

function number(value, digits = 1) {
  if (!Number.isFinite(value)) return "-";
  return value.toFixed(digits);
}

function markdown(result) {
  const lines = [];
  lines.push("# Sector Diversification Test");
  lines.push("");
  lines.push(`Generated at: ${result.generatedAt}`);
  lines.push(`Source data generated at: ${result.sourceGeneratedAt}`);
  lines.push(`Periods: ${result.periodCount}`);
  lines.push("");
  lines.push("## All Periods, 12M");
  lines.push("");
  table(lines, rowsFor(result.splits.all.results, "12m"));
  lines.push("");
  lines.push("## All Periods, 3M");
  lines.push("");
  table(lines, rowsFor(result.splits.all.results, "3m"));
  lines.push("");
  lines.push("## Recent 12 Periods, 3M");
  lines.push("");
  table(lines, rowsFor(result.splits.recent12.results, "3m"));
  lines.push("");
  lines.push("## Late Half, 12M");
  lines.push("");
  table(lines, rowsFor(result.splits.late.results, "12m"));
  lines.push("");
  lines.push("## Recent Strategy Examples");
  lines.push("");
  for (const strategy of result.splits.all.results) {
    const recent = strategy.periodsDetail.slice(-3);
    lines.push(`### ${strategy.label}`);
    lines.push("");
    lines.push("| As Of | Symbols | Sectors | 3M | 12M |");
    lines.push("|---|---|---|---:|---:|");
    for (const period of recent) {
      const sectors = period.selectedSectors.map((item) => `${item.sector} ${item.count}`).join(", ");
      lines.push(`| ${period.asOf} | ${period.symbols.join(", ")} | ${sectors} | ${pct(period["3m"].portfolioReturn)} | ${pct(period["12m"].portfolioReturn)} |`);
    }
    lines.push("");
  }
  lines.push("## Notes");
  lines.push("");
  lines.push("- This test still selects only from the monthly Top20 rows because forward returns are stored for those rows.");
  lines.push("- The test compares selection baskets, not a full account equity curve with monthly overlapping positions.");
  lines.push("- A next pass should simulate an account with position limits, monthly additions, exits, and turnover.");
  lines.push("");
  return lines.join("\n");
}

function buildResult(data) {
  const periods = annotatePeriods(data.periods ?? []);
  if (!periods.every((period) => period.groupStats?.length)) {
    throw new Error("monthly-selection-test.json does not contain groupStats. Run src/monthly-selection-test.mjs first.");
  }
  const splits = splitPeriods(periods);
  return {
    generatedAt: new Date().toISOString(),
    sourceGeneratedAt: data.generatedAt,
    periodCount: periods.length,
    method: {
      question: "Should a monthly leader signal be concentrated in the top sector, or diversified across leading sectors?",
      constraints: [
        "Uses only each monthly as-of group leadership and Top20 candidates",
        "Does not use future returns for selection",
        "Compares concentration statistics and forward returns by horizon"
      ]
    },
    splits: Object.fromEntries(splits.map((split) => [
      split.key,
      {
        label: split.label,
        results: strategies.map((strategy) => summarizeStrategy(split.periods, strategy))
      }
    ]))
  };
}

async function main() {
  const data = JSON.parse(await fs.readFile(inputPath, "utf8"));
  const result = buildResult(data);
  await fs.mkdir("data", { recursive: true });
  await fs.writeFile(outputJsonPath, JSON.stringify(result, null, 2), "utf8");
  await fs.writeFile(outputMdPath, markdown(result), "utf8");
  console.log(`Wrote ${outputJsonPath} and ${outputMdPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
