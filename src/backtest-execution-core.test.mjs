import assert from "node:assert/strict";
import {
  evaluateTrade,
  rowOnOrAfter,
  weeklyExtensionExit,
  weeklyRows
} from "./backtest-execution-core.mjs";
import { buildPriceSnapshot } from "./backtest-price-snapshot.mjs";

function dailySeries(startDate, days, startPrice = 100, dailyReturn = 0.001) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const rows = [];
  let price = startPrice;
  for (let offset = 0; offset < days; offset += 1) {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + offset);
    price *= 1 + dailyReturn;
    rows.push({ date: date.toISOString().slice(0, 10), close: price });
  }
  return rows;
}

const shortRows = [
  { date: "2026-01-02", close: 100, high: 102, low: 99, volume: 1000 },
  { date: "2026-01-05", close: 101, high: 103, low: 100, volume: 1200 }
];
assert.equal(rowOnOrAfter(shortRows, "2026-02-01"), null, "future prices must not fall back to the final row");
const snapshot = buildPriceSnapshot(new Map([["TEST", shortRows]]));
assert.equal(snapshot.series.TEST[0].high, 102, "snapshots must preserve scoring fields");
assert.equal(snapshot.series.TEST[0].volume, 1000, "snapshots must preserve volume");

const risingDaily = dailySeries("2025-01-01", 300);
const risingWeekly = weeklyRows(risingDaily);
const censored = weeklyExtensionExit(risingWeekly, "2025-07-01", null, "2025-10-27");
assert.deepEqual(censored, {
  resolved: false,
  date: null,
  reason: "right_censored"
});

const rule = {
  key: "half_sell_half_weekly_extend",
  label: "50% Sell / 50% Weekly Extend",
  buyOffsets: [0],
  sellMode: "half_weekly"
};
const trade = {
  cohort: "2025-08",
  entryDate: "2025-08-01",
  fixedExitDate: null,
  maxExitDate: null,
  symbol: "TEST",
  name: "Test",
  sector: "Test",
  score: 80,
  rank: 1
};
const qqqRows = dailySeries("2025-01-01", 300, 200, 0.0005);
const dailyMap = new Map([
  ["TEST", risingDaily],
  ["QQQ", qqqRows]
]);
const weeklyMap = new Map([
  ["TEST", risingWeekly],
  ["QQQ", weeklyRows(qqqRows)]
]);
const openTrade = evaluateTrade(rule, trade, dailyMap, weeklyMap, {
  costBps: 10,
  asOfDate: "2025-10-27"
});
assert.equal(openTrade.entered, true);
assert.equal(openTrade.closed, false);
assert.equal(openTrade.censored, true);
assert.equal(openTrade.status, "open");
assert.equal(openTrade.return, null);
assert.equal(openTrade.sellLots.length, 0);
assert.ok(openTrade.openShareFraction > 0.999999);
assert.ok(Number.isFinite(openTrade.markedReturn));

console.log("Backtest execution core tests passed.");
