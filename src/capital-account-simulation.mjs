import fs from "node:fs/promises";
import path from "node:path";
import { round } from "./math.mjs";

const inputPath = path.join("data", "scale-execution-test.json");
const outputJsonPath = path.join("data", "capital-account-simulation.json");
const outputMdPath = "capital_account_simulation.md";
const rule = "half_sell_half_weekly_extend";
const initialCapital = Number(valueAfter("--capital") ?? 10_000_000);
const costBps = Number(valueAfter("--cost-bps") ?? 10);
const minBuy = Number(valueAfter("--min-buy") ?? 100_000);

const scenarios = [
  {
    key: "fixed_5pct_cap15",
    label: "5% per signal / 15% symbol cap",
    description: "1천만 원 기준 신규 신호당 50만 원, 같은 종목 총 원금은 150만 원까지",
    type: "fixed",
    perSignalPct: 0.05,
    symbolCapPct: 0.15
  },
  {
    key: "fixed_7_5pct_cap20",
    label: "7.5% per signal / 20% symbol cap",
    description: "1천만 원 기준 신규 신호당 75만 원, 같은 종목 총 원금은 200만 원까지",
    type: "fixed",
    perSignalPct: 0.075,
    symbolCapPct: 0.20
  },
  {
    key: "fixed_10pct_cap20",
    label: "10% per signal / 20% symbol cap",
    description: "1천만 원 기준 신규 신호당 100만 원, 공격적 배분",
    type: "fixed",
    perSignalPct: 0.10,
    symbolCapPct: 0.20
  },
  {
    key: "dynamic_12_slots_cap15",
    label: "12-slot dynamic / 15% symbol cap",
    description: "현재 계좌 기준 12개 슬롯으로 나눠 신규 신호마다 동적 배분",
    type: "dynamic",
    slots: 12,
    symbolCapPct: 0.15
  }
];

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

function pct(value) {
  if (!Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(1)}%`;
}

function money(value) {
  if (!Number.isFinite(value)) return "-";
  return Math.round(value).toLocaleString("ko-KR");
}

function yearsBetween(startDate, endDate) {
  return (new Date(`${endDate}T00:00:00Z`) - new Date(`${startDate}T00:00:00Z`)) / (365.25 * 24 * 60 * 60 * 1000);
}

function maxDrawdown(curve) {
  let peak = initialCapital;
  let worst = 0;
  for (const row of curve) {
    peak = Math.max(peak, row.equity);
    worst = Math.min(worst, row.equity / peak - 1);
  }
  return round(worst, 4);
}

function loadTrades(data) {
  return data.evaluations
    ?.find((entry) => entry.rule === rule)
    ?.rows
    ?.filter((row) => row.entered)
    ?.map((row, index) => ({
      ...row,
      id: `${row.cohort}-${row.symbol}-${index}`
    })) ?? [];
}

function targetBuyAmount(scenario, equity) {
  if (scenario.type === "dynamic") return equity / scenario.slots;
  return initialCapital * scenario.perSignalPct;
}

function equityAtCost(cash, positions) {
  const openCost = positions.reduce((sum, lot) => sum + lot.remainingShares * lot.entryPrice, 0);
  return cash + openCost;
}

function symbolOpenCost(positions, symbol) {
  return positions
    .filter((lot) => lot.symbol === symbol)
    .reduce((sum, lot) => sum + lot.remainingShares * lot.entryPrice, 0);
}

function makeEvents(trades) {
  const events = [];
  for (const trade of trades) {
    events.push({ type: "buy", date: trade.firstBuyDate, trade });
    for (let index = 0; index < trade.sellDates.length; index += 1) {
      events.push({
        type: "sell",
        date: trade.sellDates[index],
        trade,
        reason: trade.sellReasons[index],
        part: index + 1
      });
    }
  }
  return events.sort((a, b) => (
    String(a.date).localeCompare(String(b.date))
    || (a.type === "sell" ? -1 : 1)
    || String(a.trade.symbol).localeCompare(String(b.trade.symbol))
  ));
}

function simulateScenario(scenario, trades) {
  let cash = initialCapital;
  let totalCosts = 0;
  const positions = [];
  const lots = new Map();
  const events = makeEvents(trades);
  const ledger = [];
  const skipped = [];
  const curve = [];
  let attemptedBuys = 0;
  let executedBuys = 0;
  let sellEvents = 0;

  for (const event of events) {
    if (event.type === "sell") {
      const lot = lots.get(event.trade.id);
      if (!lot || lot.remainingShares <= 0) continue;
      const sharesToSell = Math.min(lot.remainingShares, lot.originalShares * 0.5);
      const gross = sharesToSell * event.trade.averageSellPrice;
      const cost = gross * costBps / 10_000;
      cash += gross - cost;
      totalCosts += cost;
      lot.remainingShares = round(lot.remainingShares - sharesToSell, 8);
      sellEvents += 1;
      ledger.push({
        date: event.date,
        type: "sell",
        cohort: event.trade.cohort,
        symbol: event.trade.symbol,
        reason: event.reason,
        amount: round(gross - cost, 2),
        price: event.trade.averageSellPrice,
        cash: round(cash, 2)
      });
      curve.push({
        date: event.date,
        cash: round(cash, 2),
        equity: round(equityAtCost(cash, positions), 2),
        openLots: positions.filter((lot) => lot.remainingShares > 0).length
      });
      continue;
    }

    attemptedBuys += 1;
    const equity = equityAtCost(cash, positions);
    const wanted = targetBuyAmount(scenario, equity);
    const cap = initialCapital * scenario.symbolCapPct;
    const capRoom = Math.max(0, cap - symbolOpenCost(positions, event.trade.symbol));
    const maxCashBuy = cash / (1 + costBps / 10_000);
    const amount = Math.min(wanted, capRoom, maxCashBuy);
    if (amount < minBuy) {
      skipped.push({
        date: event.date,
        cohort: event.trade.cohort,
        symbol: event.trade.symbol,
        wanted: round(wanted, 2),
        cash: round(cash, 2),
        capRoom: round(capRoom, 2),
        reason: capRoom < minBuy ? "symbol_cap" : "cash"
      });
      continue;
    }
    const cost = amount * costBps / 10_000;
    const shares = amount / event.trade.averageBuyPrice;
    cash -= amount + cost;
    totalCosts += cost;
    const lot = {
      id: event.trade.id,
      cohort: event.trade.cohort,
      symbol: event.trade.symbol,
      name: event.trade.name,
      sector: event.trade.sector,
      entryDate: event.trade.firstBuyDate,
      entryPrice: event.trade.averageBuyPrice,
      originalShares: shares,
      remainingShares: shares,
      buyAmount: amount,
      expectedReturn: event.trade.return
    };
    positions.push(lot);
    lots.set(event.trade.id, lot);
    executedBuys += 1;
    ledger.push({
      date: event.date,
      type: "buy",
      cohort: event.trade.cohort,
      symbol: event.trade.symbol,
      amount: round(amount + cost, 2),
      price: event.trade.averageBuyPrice,
      cash: round(cash, 2)
    });
    curve.push({
      date: event.date,
      cash: round(cash, 2),
      equity: round(equityAtCost(cash, positions), 2),
      openLots: positions.filter((item) => item.remainingShares > 0).length
    });
  }

  const finalCapital = cash;
  const totalReturn = finalCapital / initialCapital - 1;
  const firstDate = events[0]?.date;
  const lastDate = events.at(-1)?.date;
  const years = yearsBetween(firstDate, lastDate);
  const cagr = (1 + totalReturn) ** (1 / years) - 1;
  const realizedProfit = finalCapital - initialCapital;
  const skipByReason = skipped.reduce((acc, row) => {
    acc[row.reason] = (acc[row.reason] ?? 0) + 1;
    return acc;
  }, {});
  const buyAmounts = ledger.filter((row) => row.type === "buy").map((row) => row.amount);
  const topSymbols = Array.from(positions.reduce((map, lot) => {
    const current = map.get(lot.symbol) ?? { symbol: lot.symbol, buyAmount: 0, profitProxy: 0, count: 0 };
    current.buyAmount += lot.buyAmount;
    current.profitProxy += lot.buyAmount * lot.expectedReturn;
    current.count += 1;
    map.set(lot.symbol, current);
    return map;
  }, new Map()).values())
    .sort((a, b) => b.buyAmount - a.buyAmount)
    .slice(0, 10)
    .map((row) => ({
      symbol: row.symbol,
      count: row.count,
      buyAmount: round(row.buyAmount, 2),
      profitProxy: round(row.profitProxy, 2)
    }));

  return {
    ...scenario,
    initialCapital,
    finalCapital: round(finalCapital, 2),
    realizedProfit: round(realizedProfit, 2),
    totalReturn: round(totalReturn, 4),
    cagr: round(cagr, 4),
    maxDrawdownAtCost: maxDrawdown(curve),
    attemptedBuys,
    executedBuys,
    skippedBuys: skipped.length,
    skippedByReason: skipByReason,
    sellEvents,
    averageBuyAmount: round(buyAmounts.reduce((sum, value) => sum + value, 0) / Math.max(1, buyAmounts.length), 2),
    minCash: round(Math.min(...curve.map((row) => row.cash), initialCapital), 2),
    totalTransactionCost: round(totalCosts, 2),
    firstDate,
    lastDate,
    years: round(years, 2),
    topSymbols,
    recentLedger: ledger.slice(-30),
    skipped: skipped.slice(-30),
    curve
  };
}

function markdown(result) {
  const lines = [];
  lines.push("# Capital Account Simulation");
  lines.push("");
  lines.push(`Generated at: ${result.generatedAt}`);
  lines.push(`Initial capital: ${money(result.initialCapital)}`);
  lines.push(`Transaction cost: ${result.costBps} bps each buy/sell`);
  lines.push("Method: use the current Leader2 strategy trades, buy with limited cash, sell 50% at six months, sell remaining 50% by weekly extension rule.");
  lines.push("");
  lines.push("## Scenario Comparison");
  lines.push("");
  lines.push("| Scenario | Final Capital | Total Return | CAGR | Buys | Skipped | Min Cash | Cost | Note |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---|");
  for (const row of result.results) {
    lines.push(`| ${row.label} | ${money(row.finalCapital)} | ${pct(row.totalReturn)} | ${pct(row.cagr)} | ${row.executedBuys}/${row.attemptedBuys} | ${row.skippedBuys} | ${money(row.minCash)} | ${money(row.totalTransactionCost)} | ${row.description} |`);
  }
  lines.push("");
  lines.push("## Recommended Operating Rule");
  lines.push("");
  lines.push("Use the 5% per signal / 15% symbol cap version as the default operating rule.");
  lines.push("");
  lines.push("- With 10,000,000 capital, buy 500,000 per new monthly recommendation.");
  lines.push("- Buy two names per month, so the planned monthly new capital is about 1,000,000.");
  lines.push("- If the same symbol is recommended again, additional buys are allowed only until total original cost reaches 1,500,000.");
  lines.push("- At six months, sell 50% of that specific monthly lot.");
  lines.push("- Keep the remaining 50% only while the weekly extension rule allows it; otherwise sell it.");
  lines.push("- If cash is short, skip the lower-ranked/duplicate buy rather than forcing leverage.");
  lines.push("");
  lines.push("## Best Scenario Details");
  lines.push("");
  const best = result.recommended;
  lines.push(`Recommended: ${best.label}`);
  lines.push(`Final capital: ${money(best.finalCapital)} (${pct(best.totalReturn)})`);
  lines.push(`Executed buys: ${best.executedBuys}, skipped buys: ${best.skippedBuys}`);
  lines.push("");
  lines.push("### Largest Symbol Allocations");
  lines.push("");
  lines.push("| Symbol | Buy Count | Total Buy Amount | Profit Proxy |");
  lines.push("|---|---:|---:|---:|");
  for (const row of best.topSymbols) {
    lines.push(`| ${row.symbol} | ${row.count} | ${money(row.buyAmount)} | ${money(row.profitProxy)} |`);
  }
  lines.push("");
  lines.push("## Limitations");
  lines.push("");
  lines.push("- This is a cash-constrained account simulation, but it uses stored average buy/sell prices from the existing backtest.");
  lines.push("- It does not include taxes, FX, dividends, exact partial-fill prices, slippage beyond the configured cost, or mark-to-market daily drawdowns.");
  lines.push("- The purpose is to decide position sizing and cash management, not to replace broker-grade execution accounting.");
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const data = JSON.parse(await fs.readFile(inputPath, "utf8"));
  const trades = loadTrades(data);
  const results = scenarios.map((scenario) => simulateScenario(scenario, trades));
  const recommended = results.find((row) => row.key === "fixed_5pct_cap15");
  const result = {
    generatedAt: new Date().toISOString(),
    source: inputPath,
    rule,
    initialCapital,
    costBps,
    minBuy,
    tradeCount: trades.length,
    results,
    recommended
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
