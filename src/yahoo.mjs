import { createHash } from "node:crypto";

export function yahooSymbol(symbol) {
  return symbol.replaceAll(".", "-").toUpperCase();
}

export async function fetchChart(symbol, { range = "18mo", interval = "1d" } = {}) {
  const yahoo = yahooSymbol(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahoo)}?range=${range}&interval=${interval}&events=history`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 investor-leader-screener"
    }
  });
  if (!response.ok) {
    throw new Error(`Yahoo chart failed for ${symbol}: ${response.status}`);
  }
  const json = await response.json();
  const result = json.chart?.result?.[0];
  if (!result?.timestamp?.length) {
    throw new Error(`Yahoo chart returned no rows for ${symbol}`);
  }
  const quote = result.indicators?.quote?.[0] ?? {};
  const adjClose = result.indicators?.adjclose?.[0]?.adjclose ?? [];
  return result.timestamp.map((time, index) => ({
    date: new Date(time * 1000).toISOString().slice(0, 10),
    open: quote.open?.[index] ?? null,
    high: quote.high?.[index] ?? null,
    low: quote.low?.[index] ?? null,
    close: adjClose[index] ?? quote.close?.[index] ?? null,
    rawClose: quote.close?.[index] ?? null,
    volume: quote.volume?.[index] ?? null
  })).filter((row) => Number.isFinite(row.close) && Number.isFinite(row.volume));
}

export function syntheticChart(symbol, days = 340) {
  const hash = createHash("sha256").update(symbol).digest();
  let seed = hash.readUInt32BE(0);
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };

  const trend = 0.0002 + (random() - 0.35) * 0.0018;
  const volatility = 0.012 + random() * 0.035;
  let price = 40 + random() * 260;
  const rows = [];
  const today = new Date();

  for (let i = days - 1; i >= 0; i -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    const shock = (random() - 0.48) * volatility;
    price = Math.max(2, price * (1 + trend + shock));
    const intraday = price * (0.004 + random() * 0.025);
    const open = price * (1 + (random() - 0.5) * 0.015);
    const close = price;
    const high = Math.max(open, close) + intraday;
    const low = Math.max(1, Math.min(open, close) - intraday);
    const volume = Math.round(1_000_000 + random() * 35_000_000);
    rows.push({
      date: date.toISOString().slice(0, 10),
      open,
      high,
      low,
      close,
      rawClose: close,
      volume
    });
  }
  return rows;
}
