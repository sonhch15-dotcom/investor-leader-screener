import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { readPriceSnapshot } from "../src/backtest-price-snapshot.mjs";

const defaultPairs = [
  {
    scale: "data/scale-execution-test-corrected-score-a-20260711.json",
    lab: "data/strategy-development-lab-corrected-score-a-20260711.json"
  },
  {
    scale: "data/scale-execution-test-corrected-score-c-20260711.json",
    lab: "data/strategy-development-lab-corrected-score-c-20260711.json"
  }
];

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function roundedMdd(curve, initialCapital) {
  let peak = initialCapital;
  let worst = 0;
  for (const row of curve) {
    assert.ok(Number.isFinite(row.equity), `non-finite equity at ${row.date}`);
    peak = Math.max(peak, row.equity);
    worst = Math.min(worst, row.equity / peak - 1);
  }
  return Math.round(worst * 10_000) / 10_000;
}

async function verifyPair(scalePath, labPath) {
  const scaleBytes = await fs.readFile(scalePath);
  const scale = JSON.parse(scaleBytes.toString("utf8"));
  const lab = JSON.parse(await fs.readFile(labPath, "utf8"));
  assert.equal(scale.incompleteTradePolicy, "right_censored");
  assert.equal(scale.valuationMode, "weekly_mark_to_market");
  assert.equal(scale.mode, "snapshot_replay");
  assert.equal(lab.incompleteTradePolicy, "right_censored");
  assert.equal(lab.valuationMode, "weekly_mark_to_market");
  assert.equal(lab.priceSnapshotHash, scale.priceSnapshotHash);

  const sourceBytes = await fs.readFile(scale.sourcePath);
  assert.equal(hash(sourceBytes), scale.sourceHash, "selection source hash changed");
  const source = JSON.parse(sourceBytes.toString("utf8"));
  const timelineHashes = (source.rankedResults ?? source.results ?? [])
    .map((row) => hash(JSON.stringify(row.selectionTimeline ?? [])));
  assert.ok(timelineHashes.includes(scale.selectionTimelineHash), "selection timeline hash is not in source");
  const snapshot = await readPriceSnapshot(scale.priceSnapshotPath);
  assert.equal(snapshot.hash, scale.priceSnapshotHash, "price snapshot hash changed");
  assert.equal(snapshot.asOf, scale.priceAsOf, "price snapshot as-of changed");

  const evaluation = scale.evaluations
    .find((entry) => entry.rule === "half_sell_half_weekly_extend");
  const trades = evaluation?.rows ?? [];
  const entered = trades.filter((trade) => trade.entered);
  const closed = entered.filter((trade) => trade.closed);
  const summary = scale.summaries.find((row) => row.key === "half_sell_half_weekly_extend");
  assert.equal(scale.selectedTradeCount, trades.length);
  assert.equal(summary.enteredTrades, entered.length);
  assert.equal(summary.closedTrades, closed.length);
  assert.equal(summary.openTrades, entered.length - closed.length);
  assert.ok(entered.some((trade) => trade.censored), "expected right-censored open trades");

  for (const trade of entered) {
    assert.ok(Array.isArray(trade.buyLots) && trade.buyLots.length > 0, "buy lots must be explicit");
    assert.ok(Array.isArray(trade.sellLots), "sell lots must be explicit");
    const soldFraction = trade.sellLots.reduce((sum, lot) => sum + lot.shareFraction, 0);
    assert.ok(soldFraction >= 0 && soldFraction <= 1.00000001, "sold fraction must stay within one lot");
    assert.ok(trade.closed ? Math.abs(soldFraction - 1) <= 1e-8 : soldFraction < 1, "closed flag and sold fraction disagree");
    assert.ok(trade.buyLots.every((lot) => Number.isFinite(lot.price) && lot.date >= trade.entryDate));
    assert.ok(trade.sellLots.every((lot) => (
      Number.isFinite(lot.price)
      && Number.isFinite(lot.shareFraction)
      && lot.shareFraction > 0
      && lot.date >= trade.firstBuyDate
      && lot.date <= scale.priceAsOf
    )), "sell lots must have valid historical event prices and fractions");
    assert.ok(trade.maxExitDate || !(trade.sellReasons ?? []).includes("half_max_12m"), "incomplete 12-month exits must not be forced");
  }

  for (const result of lab.results) {
    assert.ok(Number.isFinite(result.maxDrawdown), `${result.key} needs market-value MDD`);
    assert.ok(Number.isFinite(result.maxDrawdownAtCost), `${result.key} needs legacy cost MDD for audit`);
    assert.ok(Number.isFinite(result.finalCash));
    assert.ok(Number.isFinite(result.openMarketValue));
    assert.ok(Math.abs(result.finalCapital - result.finalCash - result.openMarketValue) <= 0.02);
    assert.equal(result.valuationMode, "weekly_mark_to_market");
    assert.equal(result.maxDrawdown, roundedMdd(result.curve, result.initialCapital));
    assert.ok(result.benchmark && result.benchmark.symbol === "QQQ");
    assert.equal(result.benchmark.maxDrawdown, roundedMdd(result.benchmark.curve, result.initialCapital));
    const dates = result.curve.map((row) => row.date);
    assert.deepEqual(dates, [...new Set(dates)].sort(), `${result.key} curve dates must be unique and sorted`);
  }

  console.log(`Corrected backtest verified: ${scalePath} + ${labPath}`);
}

const requestedScale = valueAfter("--scale");
const requestedLab = valueAfter("--lab");
if (Boolean(requestedScale) !== Boolean(requestedLab)) {
  throw new Error("Pass both --scale and --lab, or neither to verify the default Score A/C pair.");
}
const pairs = requestedScale ? [{ scale: requestedScale, lab: requestedLab }] : defaultPairs;
for (const pair of pairs) await verifyPair(pair.scale, pair.lab);
