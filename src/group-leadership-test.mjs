import fs from "node:fs/promises";
import path from "node:path";
import { clamp, mean, round } from "./math.mjs";

const inputPath = path.join("data", "monthly-selection-test.json");
const outputJsonPath = path.join("data", "group-leadership-test.json");
const outputMdPath = "group_leadership_test.md";
const horizons = ["1m", "3m", "6m", "12m"];

const hindsightAiHardwareGroups = new Set([
  "Semiconductors",
  "Electronic Components",
  "Computer Peripheral Equipment",
  "Computer Communications Equipment",
  "Computer Services"
]);

function clean(values) {
  return values.filter(Number.isFinite);
}

function avg(values) {
  return round(mean(clean(values)), 4);
}

function median(values) {
  const rows = clean(values).sort((a, b) => a - b);
  if (!rows.length) return null;
  const mid = Math.floor(rows.length / 2);
  return rows.length % 2 ? rows[mid] : (rows[mid - 1] + rows[mid]) / 2;
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

function labelGroup(row) {
  return row.sector || "Unknown";
}

function groupRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = labelGroup(row);
    const current = groups.get(key) ?? [];
    current.push(row);
    groups.set(key, current);
  }
  return groups;
}

function previousGroupStats(history, group, lookback = 3) {
  const recent = history.slice(-lookback);
  if (!recent.length) {
    return {
      previousPeriodsPresent: 0,
      previousAverageCount: 0,
      previousAverageScore: 0
    };
  }
  const rows = recent.map((period) => period.groups.find((item) => item.group === group)).filter(Boolean);
  return {
    previousPeriodsPresent: rows.length,
    previousAverageCount: mean(rows.map((row) => row.count)) ?? 0,
    previousAverageScore: mean(rows.map((row) => row.averageScore)) ?? 0
  };
}

function scoreGroup(group, rows, history) {
  const previous = previousGroupStats(history, group);
  const count = rows.length;
  const top10Count = rows.filter((row) => row.rank <= 10).length;
  const averageRank = mean(rows.map((row) => row.rank));
  const averageScore = mean(rows.map((row) => row.score));
  const setupRate = rows.filter((row) => row.setup !== "none").length / count;
  const watchRate = rows.filter((row) => row.status === "watch" || row.status === "strong_watch").length / count;
  const acceleration = count - previous.previousAverageCount;
  const persistence = previous.previousPeriodsPresent;

  const leadershipScore = round(
    count * 12
    + top10Count * 8
    + clamp(20 - averageRank, 0, 20)
    + clamp((averageScore - 70) * 1.2, 0, 24)
    + setupRate * 6
    + watchRate * 4
    + persistence * 5
    + clamp(acceleration, -3, 5) * 5,
    2
  );

  return {
    group,
    count,
    top10Count,
    averageRank: round(averageRank, 2),
    averageScore: round(averageScore, 2),
    setupRate: round(setupRate, 4),
    watchRate: round(watchRate, 4),
    previousPeriodsPresent: persistence,
    acceleration: round(acceleration, 2),
    leadershipScore
  };
}

function annotatePeriods(periods) {
  const history = [];
  return periods.map((period) => {
    const rows = period.selections.map((row, index) => ({
      ...row,
      rank: index + 1,
      group: labelGroup(row)
    }));
    const groups = Array.from(groupRows(rows), ([group, groupedRows]) => scoreGroup(group, groupedRows, history))
      .sort((a, b) => b.leadershipScore - a.leadershipScore);
    const annotated = {
      ...period,
      rows,
      groups,
      leadingGroups: groups.slice(0, 3)
    };
    history.push(annotated);
    return annotated;
  });
}

function selectTop(rows, count) {
  return rows.slice(0, count);
}

function groupSet(period, count = 2) {
  return new Set(period.leadingGroups.slice(0, count).map((group) => group.group));
}

const strategies = [
  {
    key: "baseline_top10",
    label: "Baseline Top10",
    select: (period) => selectTop(period.rows, 10)
  },
  {
    key: "baseline_top20",
    label: "Baseline Top20",
    select: (period) => selectTop(period.rows, 20)
  },
  {
    key: "leader_groups_top10",
    label: "Auto Leader Groups Top10",
    select: (period) => {
      const leaders = groupSet(period, 2);
      return selectTop(period.rows.filter((row) => leaders.has(row.group)), 10);
    }
  },
  {
    key: "leader_groups_top5",
    label: "Auto Leader Groups Top5",
    select: (period) => {
      const leaders = groupSet(period, 2);
      return selectTop(period.rows.filter((row) => leaders.has(row.group)), 5);
    }
  },
  {
    key: "broad_leader_groups_top10",
    label: "Auto Broad Leader Groups Top10",
    select: (period) => {
      const leaders = groupSet(period, 3);
      return selectTop(period.rows.filter((row) => leaders.has(row.group)), 10);
    }
  },
  {
    key: "emerging_leader_groups_top10",
    label: "Emerging Leader Groups Top10",
    select: (period) => {
      const leaders = new Set(period.groups
        .filter((group) => group.count >= 2 && group.acceleration > 0)
        .slice(0, 3)
        .map((group) => group.group));
      return selectTop(period.rows.filter((row) => leaders.has(row.group)), 10);
    }
  },
  {
    key: "persistent_leader_groups_top10",
    label: "Persistent Leader Groups Top10",
    select: (period) => {
      const leaders = new Set(period.groups
        .filter((group) => group.count >= 2 && group.previousPeriodsPresent >= 1)
        .slice(0, 3)
        .map((group) => group.group));
      return selectTop(period.rows.filter((row) => leaders.has(row.group)), 10);
    }
  },
  {
    key: "leader_watch_75_84_top10",
    label: "Leader Watch 75-84 Top10",
    select: (period) => {
      const leaders = groupSet(period, 3);
      return selectTop(period.rows.filter((row) => (
        leaders.has(row.group)
        && row.score >= 75
        && row.score < 85
        && row.status !== "buyable"
      )), 10);
    }
  }
];

function summarizeStrategy(periods, strategy) {
  const periodRows = periods.map((period) => {
    const selected = strategy.select(period);
    const result = {
      asOf: period.asOf,
      selectedCount: selected.length,
      leadingGroups: period.leadingGroups.map((group) => group.group),
      selectedGroups: Array.from(new Set(selected.map((row) => row.group))),
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

function groupTimeline(periods) {
  return periods.map((period) => ({
    asOf: period.asOf,
    leadingGroups: period.leadingGroups,
    laterKnownAiHardwareCaptured: period.leadingGroups.some((group) => hindsightAiHardwareGroups.has(group.group))
  }));
}

function groupContribution(periods) {
  const map = new Map();
  for (const period of periods) {
    for (const group of period.groups) {
      const current = map.get(group.group) ?? {
        group: group.group,
        leaderAppearances: 0,
        topLeaderAppearances: 0,
        returns12m: [],
        excessQqq12m: []
      };
      const rank = period.groups.findIndex((item) => item.group === group.group) + 1;
      if (rank <= 3) {
        current.leaderAppearances += 1;
        const selected = period.rows.filter((row) => row.group === group.group);
        current.returns12m.push(...selected.map((row) => row.returns?.["12m"]).filter(Number.isFinite));
        current.excessQqq12m.push(...selected.map((row) => row.excess?.["12m"]?.QQQ).filter(Number.isFinite));
      }
      if (rank === 1) current.topLeaderAppearances += 1;
      map.set(group.group, current);
    }
  }
  return Array.from(map.values())
    .filter((row) => row.leaderAppearances > 0)
    .map((row) => ({
      group: row.group,
      leaderAppearances: row.leaderAppearances,
      topLeaderAppearances: row.topLeaderAppearances,
      average12m: avg(row.returns12m),
      averageExcessQqq12m: avg(row.excessQqq12m)
    }))
    .sort((a, b) => b.leaderAppearances - a.leaderAppearances || b.averageExcessQqq12m - a.averageExcessQqq12m);
}

function buildResult(data) {
  const periods = annotatePeriods(data.periods ?? []);
  const splitIndex = Math.floor(periods.length / 2);
  const splits = [
    { key: "all", label: "All", periods },
    { key: "early", label: "Early Half", periods: periods.slice(0, splitIndex) },
    { key: "late", label: "Late Half", periods: periods.slice(splitIndex) },
    { key: "recent12", label: "Recent 12", periods: periods.slice(-12) }
  ];
  const timeline = groupTimeline(periods);
  return {
    generatedAt: new Date().toISOString(),
    sourceGeneratedAt: data.generatedAt,
    periodCount: periods.length,
    method: {
      unit: "sector/industry labels already present in each monthly Top20 row",
      noFutureInputs: [
        "current Top20 group count",
        "current Top10 group count",
        "current average rank",
        "current average score",
        "current setup/watch mix",
        "prior 3-month group persistence",
        "current group count acceleration versus prior 3 months"
      ],
      excludedInputs: [
        "future returns",
        "future winner labels",
        "AI/semiconductor manual filter"
      ]
    },
    splits: Object.fromEntries(splits.map((split) => [
      split.key,
      {
        label: split.label,
        results: strategies.map((strategy) => summarizeStrategy(split.periods, strategy))
      }
    ])),
    groupTimeline: timeline,
    aiHardwareDiagnostic: {
      note: "This is a hindsight diagnostic only. It is not used in strategy selection.",
      periodsWithLaterKnownAiHardwareInTop3Groups: timeline.filter((row) => row.laterKnownAiHardwareCaptured).length,
      totalPeriods: timeline.length
    },
    groupContribution: groupContribution(periods),
    periods: periods.map((period) => ({
      asOf: period.asOf,
      leadingGroups: period.leadingGroups,
      selections: period.rows.map((row) => ({
        rank: row.rank,
        symbol: row.symbol,
        group: row.group,
        score: row.score,
        status: row.status,
        setup: row.setup,
        r3m: row.returns?.["3m"],
        r12m: row.returns?.["12m"]
      }))
    }))
  };
}

function table(lines, rows) {
  lines.push("| Strategy | Active | Empty | Avg Names | Avg | Median | Positive | Beat SPY | Beat QQQ | Avg QQQ Excess |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const row of rows) {
    lines.push(`| ${row.label} | ${row.activePeriods} | ${row.emptyPeriods} | ${row.averageSelectedCount?.toFixed(1) ?? "-"} | ${pct(row.averageReturn)} | ${pct(row.medianReturn)} | ${pct(row.positiveRate)} | ${pct(row.beatSpyRate)} | ${pct(row.beatQqqRate)} | ${pct(row.averageExcessQqq)} |`);
  }
}

function strategyRows(results, horizon) {
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

function markdown(result) {
  const lines = [];
  lines.push("# Group Leadership Test");
  lines.push("");
  lines.push(`Generated at: ${result.generatedAt}`);
  lines.push(`Source data generated at: ${result.sourceGeneratedAt}`);
  lines.push(`Periods: ${result.periodCount}`);
  lines.push("");
  lines.push("## Method");
  lines.push("");
  lines.push("This test does not select AI/semiconductors directly. It scores the current monthly Top20 groups by representation, rank, score, setup mix, prior persistence, and recent acceleration.");
  lines.push("");
  lines.push("## All Periods, 12M");
  lines.push("");
  table(lines, strategyRows(result.splits.all.results, "12m"));
  lines.push("");
  lines.push("## Late Half, 12M");
  lines.push("");
  table(lines, strategyRows(result.splits.late.results, "12m"));
  lines.push("");
  lines.push("## All Periods, 3M");
  lines.push("");
  table(lines, strategyRows(result.splits.all.results, "3m"));
  lines.push("");
  lines.push("## Recent 12 Periods, 3M");
  lines.push("");
  table(lines, strategyRows(result.splits.recent12.results, "3m"));
  lines.push("");
  lines.push("## Top Group Appearances");
  lines.push("");
  lines.push("| Group | Top3 Months | #1 Months | Avg 12M | Avg QQQ Excess |");
  lines.push("|---|---:|---:|---:|---:|");
  for (const row of result.groupContribution.slice(0, 15)) {
    lines.push(`| ${row.group} | ${row.leaderAppearances} | ${row.topLeaderAppearances} | ${pct(row.average12m)} | ${pct(row.averageExcessQqq12m)} |`);
  }
  lines.push("");
  lines.push("## Later-Known AI/Semi Diagnostic");
  lines.push("");
  lines.push(`Later-known AI/semi hardware groups appeared in the automatically detected Top3 groups in ${result.aiHardwareDiagnostic.periodsWithLaterKnownAiHardwareInTop3Groups}/${result.aiHardwareDiagnostic.totalPeriods} periods.`);
  lines.push("This is only a diagnostic label and was not used in selection.");
  lines.push("");
  lines.push("## Recent Leading Groups");
  lines.push("");
  lines.push("| As Of | #1 Group | #2 Group | #3 Group |");
  lines.push("|---|---|---|---|");
  for (const row of result.groupTimeline.slice(-12)) {
    lines.push(`| ${row.asOf} | ${row.leadingGroups[0]?.group ?? "-"} | ${row.leadingGroups[1]?.group ?? "-"} | ${row.leadingGroups[2]?.group ?? "-"} |`);
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("- This is a first-pass leadership engine using only saved monthly Top20 rows.");
  lines.push("- A stronger second pass should store every scored universe row each month, then compute true group breadth outside the Top20.");
  lines.push("- Results still ignore trade timing, stops, slippage, taxes, commissions, and position sizing.");
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
