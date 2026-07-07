import fs from "node:fs/promises";
import path from "node:path";
import { clamp, mean, round } from "./math.mjs";

const inputPath = path.join("data", "monthly-selection-test.json");
const outputJsonPath = path.join("data", "full-universe-group-test.json");
const outputMdPath = "full_universe_group_test.md";
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

function previousStats(history, groupName, lookback = 3) {
  const rows = history
    .slice(-lookback)
    .map((period) => period.groupStats.find((group) => group.group === groupName))
    .filter(Boolean);
  return {
    periodsPresent: rows.length,
    averageTop50Count: mean(rows.map((row) => row.top50Count)) ?? 0,
    averageLeadershipScore: mean(rows.map((row) => row.leadershipScore)) ?? 0
  };
}

function scoreGroup(group, history) {
  const previous = previousStats(history, group.group);
  const acceleration = group.top50Count - previous.averageTop50Count;
  const leadershipScore = round(
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
    + previous.periodsPresent * 4,
    2
  );
  return {
    ...group,
    priorPeriodsPresent: previous.periodsPresent,
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

function top(rows, count) {
  return rows.slice(0, count);
}

function leaderSet(period, count) {
  return new Set(period.groupStats.slice(0, count).map((group) => group.group));
}

function emergingSet(period, count) {
  return new Set(period.groupStats
    .filter((group) => group.top50Acceleration > 0 && group.averageQqqExcessMomentum > 0)
    .slice(0, count)
    .map((group) => group.group));
}

function qualitySet(period, count) {
  return new Set(period.groupStats
    .filter((group) => (
      group.averageQqqExcessMomentum > 0
      && group.above50Rate >= 0.55
      && group.score75Rate >= 0.15
      && group.top50Count >= 2
    ))
    .slice(0, count)
    .map((group) => group.group));
}

const strategies = [
  {
    key: "baseline_top10",
    label: "Baseline Top10",
    select: (period) => top(period.selections, 10)
  },
  {
    key: "baseline_top20",
    label: "Baseline Top20",
    select: (period) => top(period.selections, 20)
  },
  {
    key: "full_leader_top10",
    label: "Full Universe Leaders Top10",
    select: (period) => {
      const groups = leaderSet(period, 2);
      return top(period.selections.filter((row) => groups.has(row.sector)), 10);
    }
  },
  {
    key: "full_leader_top5",
    label: "Full Universe Leaders Top5",
    select: (period) => {
      const groups = leaderSet(period, 2);
      return top(period.selections.filter((row) => groups.has(row.sector)), 5);
    }
  },
  {
    key: "full_broad_leader_top10",
    label: "Full Broad Leaders Top10",
    select: (period) => {
      const groups = leaderSet(period, 3);
      return top(period.selections.filter((row) => groups.has(row.sector)), 10);
    }
  },
  {
    key: "full_emerging_leader_top10",
    label: "Full Emerging Leaders Top10",
    select: (period) => {
      const groups = emergingSet(period, 3);
      return top(period.selections.filter((row) => groups.has(row.sector)), 10);
    }
  },
  {
    key: "full_quality_leader_top10",
    label: "Full Quality Leaders Top10",
    select: (period) => {
      const groups = qualitySet(period, 3);
      return top(period.selections.filter((row) => groups.has(row.sector)), 10);
    }
  }
];

function summarizeStrategy(periods, strategy) {
  const periodRows = periods.map((period) => {
    const selected = strategy.select(period);
    const result = {
      asOf: period.asOf,
      selectedCount: selected.length,
      leadingGroups: period.groupStats.slice(0, 3).map((group) => group.group),
      selectedGroups: Array.from(new Set(selected.map((row) => row.sector))),
      symbols: selected.map((row) => row.symbol)
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
    periods: periodRows.length,
    activePeriods: periodRows.filter((row) => row.selectedCount > 0).length,
    emptyPeriods: periodRows.filter((row) => row.selectedCount === 0).length,
    averageSelectedCount: avg(periodRows.map((row) => row.selectedCount)),
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
        averageExcessQqq: avg(excessQqq)
      }];
    })),
    periodsDetail: periodRows
  };
}

function groupContribution(periods) {
  const map = new Map();
  for (const period of periods) {
    for (const group of period.groupStats.slice(0, 3)) {
      const current = map.get(group.group) ?? {
        group: group.group,
        top3Months: 0,
        top1Months: 0,
        scores: [],
        returns12m: [],
        excessQqq12m: []
      };
      current.top3Months += 1;
      if (period.groupStats[0]?.group === group.group) current.top1Months += 1;
      current.scores.push(group.leadershipScore);
      const selected = period.selections.filter((row) => row.sector === group.group);
      current.returns12m.push(...selected.map((row) => row.returns?.["12m"]).filter(Number.isFinite));
      current.excessQqq12m.push(...selected.map((row) => row.excess?.["12m"]?.QQQ).filter(Number.isFinite));
      map.set(group.group, current);
    }
  }
  return Array.from(map.values())
    .map((row) => ({
      group: row.group,
      top3Months: row.top3Months,
      top1Months: row.top1Months,
      averageLeadershipScore: round(mean(row.scores), 2),
      average12m: avg(row.returns12m),
      averageExcessQqq12m: avg(row.excessQqq12m)
    }))
    .sort((a, b) => b.top3Months - a.top3Months || b.averageExcessQqq12m - a.averageExcessQqq12m);
}

function buildResult(data) {
  const periods = annotatePeriods(data.periods ?? []);
  if (!periods.every((period) => period.groupStats.length)) {
    throw new Error("monthly-selection-test.json does not contain groupStats. Run src/monthly-selection-test.mjs first.");
  }
  const splitIndex = Math.floor(periods.length / 2);
  const splits = [
    { key: "all", label: "All", periods },
    { key: "early", label: "Early Half", periods: periods.slice(0, splitIndex) },
    { key: "late", label: "Late Half", periods: periods.slice(splitIndex) },
    { key: "recent12", label: "Recent 12", periods: periods.slice(-12) }
  ];
  return {
    generatedAt: new Date().toISOString(),
    sourceGeneratedAt: data.generatedAt,
    periodCount: periods.length,
    method: {
      unit: "full universe group statistics saved at each monthly as-of date",
      noFutureInputs: [
        "group average SPY/QQQ excess momentum",
        "group 20/50/200-day breadth",
        "near 52-week high breadth",
        "score 75/80 breadth",
        "top50/top100 representation",
        "prior 3-month persistence and top50 acceleration"
      ],
      excludedInputs: [
        "future returns",
        "future winner labels",
        "manual AI/semiconductor filters"
      ]
    },
    splits: Object.fromEntries(splits.map((split) => [
      split.key,
      {
        label: split.label,
        results: strategies.map((strategy) => summarizeStrategy(split.periods, strategy))
      }
    ])),
    groupContribution: groupContribution(periods),
    recentLeadingGroups: periods.slice(-12).map((period) => ({
      asOf: period.asOf,
      leadingGroups: period.groupStats.slice(0, 5).map((group) => ({
        group: group.group,
        leadershipScore: group.leadershipScore,
        averageQqqExcessMomentum: group.averageQqqExcessMomentum,
        above50Rate: group.above50Rate,
        above200Rate: group.above200Rate,
        score75Rate: group.score75Rate,
        top50Count: group.top50Count,
        top50Acceleration: group.top50Acceleration
      }))
    }))
  };
}

function rowsFor(results, horizon) {
  return results
    .map((result) => ({
      label: result.label,
      activePeriods: result.activePeriods,
      emptyPeriods: result.emptyPeriods,
      averageSelectedCount: result.averageSelectedCount,
      ...result.horizons[horizon]
    }))
    .sort((a, b) => b.averageExcessQqq - a.averageExcessQqq);
}

function table(lines, rows) {
  lines.push("| Strategy | Active | Empty | Avg Names | Avg | Median | Positive | Beat SPY | Beat QQQ | Avg QQQ Excess |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const row of rows) {
    lines.push(`| ${row.label} | ${row.activePeriods} | ${row.emptyPeriods} | ${row.averageSelectedCount?.toFixed(1) ?? "-"} | ${pct(row.averageReturn)} | ${pct(row.medianReturn)} | ${pct(row.positiveRate)} | ${pct(row.beatSpyRate)} | ${pct(row.beatQqqRate)} | ${pct(row.averageExcessQqq)} |`);
  }
}

function markdown(result) {
  const lines = [];
  lines.push("# Full Universe Group Test");
  lines.push("");
  lines.push(`Generated at: ${result.generatedAt}`);
  lines.push(`Source data generated at: ${result.sourceGeneratedAt}`);
  lines.push(`Periods: ${result.periodCount}`);
  lines.push("");
  lines.push("## Method");
  lines.push("");
  lines.push("This test ranks groups using full-universe group breadth and momentum available at each as-of date. It does not use future returns or manual AI/semiconductor filters.");
  lines.push("");
  lines.push("## All Periods, 12M");
  lines.push("");
  table(lines, rowsFor(result.splits.all.results, "12m"));
  lines.push("");
  lines.push("## Late Half, 12M");
  lines.push("");
  table(lines, rowsFor(result.splits.late.results, "12m"));
  lines.push("");
  lines.push("## All Periods, 3M");
  lines.push("");
  table(lines, rowsFor(result.splits.all.results, "3m"));
  lines.push("");
  lines.push("## Recent 12 Periods, 3M");
  lines.push("");
  table(lines, rowsFor(result.splits.recent12.results, "3m"));
  lines.push("");
  lines.push("## Top Full-Universe Groups");
  lines.push("");
  lines.push("| Group | Top3 Months | #1 Months | Avg Leadership | Avg 12M | Avg QQQ Excess |");
  lines.push("|---|---:|---:|---:|---:|---:|");
  for (const row of result.groupContribution.slice(0, 15)) {
    lines.push(`| ${row.group} | ${row.top3Months} | ${row.top1Months} | ${row.averageLeadershipScore} | ${pct(row.average12m)} | ${pct(row.averageExcessQqq12m)} |`);
  }
  lines.push("");
  lines.push("## Recent Full-Universe Leaders");
  lines.push("");
  lines.push("| As Of | #1 | #2 | #3 | #4 | #5 |");
  lines.push("|---|---|---|---|---|---|");
  for (const row of result.recentLeadingGroups) {
    lines.push(`| ${row.asOf} | ${row.leadingGroups.map((group) => group.group).join(" | ")} |`);
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("- Selection is still restricted to monthly Top20 rows because forward returns are currently evaluated only for those rows.");
  lines.push("- A next pass can evaluate forward returns for every eligible row, which would allow selecting new leaders outside the Top20.");
  lines.push("- Results still ignore trade timing, stops, sizing, taxes, commissions, and slippage.");
  lines.push("");
  return lines.join("\n");
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
