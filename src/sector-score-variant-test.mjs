import fs from "node:fs/promises";
import path from "node:path";
import { buildUniverse } from "./universe.mjs";
import { fetchChart, syntheticChart } from "./yahoo.mjs";
import { scoreUniverse } from "./scoring.mjs";
import { clamp, mean, round } from "./math.mjs";

const sample = process.argv.includes("--sample");
const years = Number(valueAfter("--years") ?? 5);
const holdMonths = Number(valueAfter("--hold-months") ?? 6);
const costBps = Number(valueAfter("--cost-bps") ?? 10);
const outputJsonPath = path.join("data", "sector-score-variant-test.json");
const outputMdPath = "sector_score_variant_test.md";

const variants = [
  {
    key: "a_current_sector20",
    label: "A Current Sector20",
    description: "현재 방식. 개별 점수에 섹터/테마 20점을 그대로 포함한다.",
    scoreOptions: {}
  },
  {
    key: "b_no_sector_normalized",
    label: "B No Sector Normalized",
    description: "개별 점수에서 섹터/테마를 제외하고 100점으로 재환산한다.",
    scoreOptions: { sectorThemeWeight: 0, normalizeScore: true }
  },
  {
    key: "c_half_sector_normalized",
    label: "C Half Sector10 Normalized",
    description: "개별 점수에서 섹터/테마를 절반만 반영하고 100점으로 재환산한다.",
    scoreOptions: { sectorThemeWeight: 0.5, normalizeScore: true }
  }
];

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function parseDate(date) {
  return new Date(`${date}T00:00:00Z`);
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addYears(date, yearsToAdd) {
  const next = new Date(date);
  next.setUTCFullYear(next.getUTCFullYear() + yearsToAdd);
  return next;
}

function addMonths(date, monthsToAdd) {
  const next = parseDate(date);
  next.setUTCMonth(next.getUTCMonth() + monthsToAdd);
  return isoDate(next);
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

function latestDate(priceMap) {
  const spy = priceMap.get("SPY") ?? Array.from(priceMap.values()).find((rows) => rows.length);
  return spy?.at(-1)?.date ?? isoDate(new Date());
}

function monthlyLastFridays(startDate, endDate) {
  const dates = [];
  const cursor = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1));
  while (cursor <= endDate) {
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth();
    const lastDay = new Date(Date.UTC(year, month + 1, 0));
    while (lastDay.getUTCDay() !== 5) lastDay.setUTCDate(lastDay.getUTCDate() - 1);
    if (lastDay >= startDate && lastDay <= endDate) dates.push(isoDate(lastDay));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return dates;
}

function clean(values) {
  return values.filter(Number.isFinite);
}

function avg(values) {
  return round(mean(clean(values)), 4);
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

function periodReturn(priceMap, symbol, startDate, endDate) {
  const rows = priceMap.get(symbol);
  if (!rows?.length) return null;
  const start = rowOnOrAfter(rows, startDate);
  const end = rowOnOrAfter(rows, endDate);
  if (!start || !end || !start.close) return null;
  return end.close / start.close - 1;
}

function basketReturn(priceMap, symbols, startDate, endDate) {
  const returns = symbols
    .map((symbol) => periodReturn(priceMap, symbol, startDate, endDate))
    .filter(Number.isFinite);
  return mean(returns);
}

async function collectPrices(instruments) {
  const priceMap = new Map();
  const errors = [];
  for (const [index, instrument] of instruments.entries()) {
    try {
      const rows = sample ? syntheticChart(instrument.symbol, 1400) : await fetchChart(instrument.symbol, { range: "5y" });
      priceMap.set(instrument.symbol, rows);
      if ((index + 1) % 50 === 0) console.log(`Fetched ${index + 1}/${instruments.length}`);
    } catch (error) {
      errors.push({ symbol: instrument.symbol, error: error.message });
      if (sample) priceMap.set(instrument.symbol, syntheticChart(instrument.symbol, 1400));
    }
  }
  return { priceMap, errors };
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

function buildGroupStats(rows) {
  const stocks = rows.filter((row) => row.type === "stock" && row.sector);
  const eligible = rows.filter((row) => row.type === "stock" && row.sector && row.status !== "excluded");
  const top20 = eligible.slice(0, 20);
  const top50 = eligible.slice(0, 50);
  const top100 = eligible.slice(0, 100);
  const spy = rows.find((row) => row.symbol === "SPY");
  const qqq = rows.find((row) => row.symbol === "QQQ");
  const qqqMomentum = weightedMomentum(qqq?.metrics);
  const spyMomentum = weightedMomentum(spy?.metrics);
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
    const groupMomentum = groupRows.map((row) => weightedMomentum(row.metrics));
    return {
      group,
      universeCount: groupRows.length,
      eligibleCount: groupEligible.length,
      top20Count: groupTop20.length,
      top50Count: groupTop50.length,
      top100Count: groupTop100.length,
      eligibleRate: round(groupEligible.length / groupRows.length, 4),
      top50Concentration: round(groupTop50.length / Math.max(1, groupRows.length), 4),
      top100Concentration: round(groupTop100.length / Math.max(1, groupRows.length), 4),
      averageMomentum: round(mean(groupMomentum), 4),
      averageSpyExcessMomentum: round(mean(groupMomentum.map((value) => value - spyMomentum)), 4),
      averageQqqExcessMomentum: round(mean(groupMomentum.map((value) => value - qqqMomentum)), 4),
      above50Rate: round(rate(groupRows, (row) => row.metrics?.above50), 4),
      above200Rate: round(rate(groupRows, (row) => row.metrics?.above200), 4),
      nearHighRate: round(rate(groupRows, (row) => row.metrics?.high52wDistance >= -0.1), 4),
      score75Rate: round(rate(groupRows, (row) => row.score >= 75), 4),
      score80Rate: round(rate(groupRows, (row) => row.score >= 80), 4)
    };
  }).filter((row) => row.universeCount >= 3);
}

function previousStats(history, groupName, lookback = 3) {
  const rows = history
    .slice(-lookback)
    .map((period) => period.groupStats.find((group) => group.group === groupName))
    .filter(Boolean);
  return {
    periodsPresent: rows.length,
    averageTop50Count: mean(rows.map((row) => row.top50Count)) ?? 0
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
  return { ...group, top50Acceleration: round(acceleration, 2), leadershipScore };
}

function leaderGroups(period, count) {
  return period.groupStats.slice(0, count).map((group) => group.group);
}

function topOnePerGroup(period, groups, totalLimit) {
  const selected = [];
  const used = new Set();
  for (const group of groups) {
    const row = period.candidates.find((candidate) => candidate.sector === group && !used.has(candidate.symbol));
    if (!row) continue;
    selected.push(row);
    used.add(row.symbol);
    if (selected.length >= totalLimit) break;
  }
  return selected.sort((a, b) => a.rank - b.rank);
}

function selectLeader2(period) {
  return topOnePerGroup(period, leaderGroups(period, 2), 2);
}

async function buildPeriods(instruments, priceMap, variant) {
  const endDate = parseDate(latestDate(priceMap));
  const startDate = addYears(endDate, -years);
  const asOfDates = monthlyLastFridays(startDate, endDate);
  const periods = [];
  const history = [];

  for (const [index, asOf] of asOfDates.entries()) {
    const slicedPriceMap = new Map();
    for (const [symbol, rows] of priceMap) slicedPriceMap.set(symbol, rowsUntil(rows, asOf));
    const scored = scoreUniverse(instruments, slicedPriceMap, variant.scoreOptions);
    const entryRow = firstRowAfter(priceMap.get("SPY") ?? [], asOf);
    if (!entryRow) continue;
    const groupStats = buildGroupStats(scored.rows)
      .map((group) => scoreGroup(group, history))
      .sort((a, b) => b.leadershipScore - a.leadershipScore);
    const candidates = scored.rows
      .filter((row) => row.type === "stock" && row.sector && row.status !== "excluded")
      .map((row, rowIndex) => ({ ...row, rank: rowIndex + 1 }));
    const period = { asOf, entryDate: entryRow.date, groupStats, candidates };
    periods.push(period);
    history.push(period);
    if ((index + 1) % 12 === 0) console.log(`${variant.label}: scored ${index + 1}/${asOfDates.length} periods`);
  }

  return { periods, startDate: isoDate(startDate), endDate: isoDate(endDate) };
}

function simulateVariant(priceMap, periods, variant) {
  let equity = 1;
  let qqqEquity = 1;
  const curve = [];
  const monthlyReturns = [];
  const selectedCounts = [];

  for (let index = 0; index < periods.length - 1; index += 1) {
    const current = periods[index];
    const next = periods[index + 1];
    if (!current.entryDate || !next.entryDate) continue;

    const activeCohorts = [];
    for (let offset = 0; offset < holdMonths; offset += 1) {
      const cohortIndex = index - offset;
      if (cohortIndex < 0) continue;
      const cohort = periods[cohortIndex];
      const selected = selectLeader2(cohort);
      if (!selected.length) continue;
      activeCohorts.push({ asOf: cohort.asOf, ageMonths: offset, rows: selected });
    }
    if (!activeCohorts.length) continue;

    const cohortReturns = activeCohorts
      .map((cohort) => basketReturn(priceMap, cohort.rows.map((row) => row.symbol), current.entryDate, next.entryDate))
      .filter(Number.isFinite);
    if (!cohortReturns.length) continue;

    const grossReturn = mean(cohortReturns);
    const newCohortWeight = 1 / holdMonths;
    const transactionCost = newCohortWeight * costBps / 10_000 + (index >= holdMonths ? newCohortWeight * costBps / 10_000 : 0);
    const netReturn = grossReturn - transactionCost;
    const qqqReturn = periodReturn(priceMap, "QQQ", current.entryDate, next.entryDate);
    if (!Number.isFinite(netReturn) || !Number.isFinite(qqqReturn)) continue;

    const newest = selectLeader2(current);
    if (newest.length) selectedCounts.push(newest.length);
    equity *= 1 + netReturn;
    qqqEquity *= 1 + qqqReturn;
    monthlyReturns.push(netReturn);
    const uniqueHeld = new Set(activeCohorts.flatMap((cohort) => cohort.rows.map((row) => row.symbol)));
    curve.push({
      asOf: current.asOf,
      entryDate: current.entryDate,
      exitDate: next.entryDate,
      newestSymbols: newest.map((row) => row.symbol),
      newestGroups: newest.map((row) => row.sector),
      leadingGroups: leaderGroups(current, 5),
      uniqueHeldCount: uniqueHeld.size,
      netReturn: round(netReturn, 4),
      qqqReturn: round(qqqReturn, 4),
      equity: round(equity, 4),
      qqqEquity: round(qqqEquity, 4)
    });
  }

  const totalReturn = equity - 1;
  const qqqTotalReturn = qqqEquity - 1;
  const selectionTimeline = periods.map((period) => {
    const selected = selectLeader2(period);
    return {
      asOf: period.asOf,
      entryDate: period.entryDate,
      leadingGroups: leaderGroups(period, 5),
      symbols: selected.map((row) => row.symbol),
      groups: selected.map((row) => row.sector),
      rows: selected.map((row) => ({
        symbol: row.symbol,
        name: row.name,
        sector: row.sector,
        score: row.score,
        rank: row.rank
      }))
    };
  });

  return {
    key: variant.key,
    label: variant.label,
    description: variant.description,
    totalReturn: round(totalReturn, 4),
    cagr: round(annualizedReturn(totalReturn, curve.length), 4),
    qqqTotalReturn: round(qqqTotalReturn, 4),
    qqqExcess: round(totalReturn - qqqTotalReturn, 4),
    maxDrawdown: round(maxDrawdown(curve), 4),
    winRate: round(monthlyReturns.filter((value) => value > 0).length / Math.max(1, monthlyReturns.length), 4),
    beatQqqMonthRate: round(curve.filter((row) => row.netReturn > row.qqqReturn).length / Math.max(1, curve.length), 4),
    averageNewBuys: round(mean(selectedCounts), 2),
    periodCount: curve.length,
    curve,
    selectionTimeline,
    recentSelections: selectionTimeline.slice(-12)
  };
}

function pct(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "-";
}

function markdown(result) {
  const lines = [];
  lines.push("# Sector Score Variant Test");
  lines.push("");
  lines.push(`Generated at: ${result.generatedAt}`);
  lines.push(`Period: ${result.startDate} to ${result.endDate}`);
  lines.push(`Mode: ${result.mode}`);
  lines.push("");
  lines.push("## Purpose");
  lines.push("");
  lines.push("개별 종목 점수 안에 섹터/테마 점수를 얼마나 반영할지 A/B/C로 나누어 Leader2 종목 선정력을 비교한다.");
  lines.push("");
  lines.push("## Results");
  lines.push("");
  lines.push("| Variant | Total | CAGR | QQQ | Excess | MDD | Win Rate | Beat QQQ Months |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|");
  for (const row of result.rankedResults) {
    lines.push(`| ${row.label} | ${pct(row.totalReturn)} | ${pct(row.cagr)} | ${pct(row.qqqTotalReturn)} | ${pct(row.qqqExcess)} | ${pct(row.maxDrawdown)} | ${pct(row.winRate)} | ${pct(row.beatQqqMonthRate)} |`);
  }
  lines.push("");
  lines.push("## Recent Selections");
  for (const row of result.rankedResults) {
    lines.push("");
    lines.push(`### ${row.label}`);
    lines.push("");
    lines.push("| As Of | Entry | Symbols | Groups |");
    lines.push("|---|---|---|---|");
    for (const period of row.recentSelections) {
      lines.push(`| ${period.asOf} | ${period.entryDate} | ${period.symbols.join(", ")} | ${period.groups.join(", ")} |`);
    }
  }
  lines.push("");
  lines.push("## Interpretation Guide");
  lines.push("");
  lines.push("- A Current Sector20: 현재 공식 방식이다. 개별 종목 점수에 섹터/테마 20점을 그대로 포함한다.");
  lines.push("- B No Sector Normalized: 섹터/테마 점수를 제거하고 나머지 점수를 100점으로 환산한다. 섹터 중복 반영을 가장 강하게 제거한다.");
  lines.push("- C Half Sector10 Normalized: 섹터/테마를 절반만 반영한다. 현재 방식과 완전 분리 방식의 절충안이다.");
  lines.push("- 이 테스트는 종목 선정 엔진 비교용이다. Cap27.5 자금배분, 6개월 50% 매도 + 주봉 연장 매도까지 포함한 최종 계좌 검증은 별도 단계에서 다시 확인해야 한다.");
  lines.push("");
  return lines.join("\n");
}

async function main() {
  console.log(sample ? "Running sector score variant test with sample data." : "Running sector score variant test with live data.");
  const instruments = await buildUniverse({ sample });
  console.log(`Universe size: ${instruments.length}`);
  const { priceMap, errors } = await collectPrices(instruments);
  const results = [];
  let sharedDates = null;

  for (const variant of variants) {
    const built = await buildPeriods(instruments, priceMap, variant);
    sharedDates ??= { startDate: built.startDate, endDate: built.endDate };
    results.push(simulateVariant(priceMap, built.periods, variant));
  }

  const rankedResults = [...results].sort((a, b) => b.totalReturn - a.totalReturn);
  const result = {
    generatedAt: new Date().toISOString(),
    mode: sample ? "sample" : "live",
    years,
    holdMonths,
    costBps,
    startDate: sharedDates?.startDate,
    endDate: sharedDates?.endDate,
    universeSize: instruments.length,
    priceSeriesCount: priceMap.size,
    errors,
    rankedResults,
    results
  };

  await fs.mkdir("data", { recursive: true });
  await fs.writeFile(outputJsonPath, JSON.stringify(result, null, 2), "utf8");
  await fs.writeFile(outputMdPath, markdown(result), "utf8");
  console.log(`Wrote ${outputJsonPath} and ${outputMdPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
