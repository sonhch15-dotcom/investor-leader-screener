import fs from "node:fs/promises";

const WIKI_SP500 = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies";
const WIKI_NASDAQ100 = "https://en.wikipedia.org/wiki/Nasdaq-100";

export async function loadUniverseConfig(path = "config/universe.json") {
  return JSON.parse(await fs.readFile(path, "utf8"));
}

function cleanText(html) {
  return html
    .replace(/<sup[\s\S]*?<\/sup>/gi, "")
    .replace(/<span[\s\S]*?<\/span>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#160;|&nbsp;/g, " ")
    .replace(/&#91;.*?&#93;/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSymbol(symbol) {
  return cleanText(symbol).replace(".", "-").toUpperCase();
}

function parseTables(html) {
  const tables = [];
  const tableMatches = html.match(/<table[\s\S]*?<\/table>/gi) ?? [];
  for (const table of tableMatches) {
    const rows = [];
    const rowMatches = table.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
    for (const row of rowMatches) {
      const cells = [];
      const cellMatches = row.match(/<t[hd][\s\S]*?<\/t[hd]>/gi) ?? [];
      for (const cell of cellMatches) cells.push(cleanText(cell));
      if (cells.length) rows.push(cells);
    }
    if (rows.length) tables.push(rows);
  }
  return tables;
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 investor-leader-screener"
    }
  });
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
  return response.text();
}

function parseSp500(html) {
  const tables = parseTables(html);
  const table = tables.find((rows) => rows[0]?.some((cell) => /Symbol/i.test(cell)) && rows[0]?.some((cell) => /GICS Sector/i.test(cell)));
  if (!table) return [];
  const header = table[0];
  const symbolIndex = header.findIndex((cell) => /Symbol/i.test(cell));
  const nameIndex = header.findIndex((cell) => /Security/i.test(cell));
  const sectorIndex = header.findIndex((cell) => /GICS Sector/i.test(cell));
  return table.slice(1).map((row) => ({
    symbol: normalizeSymbol(row[symbolIndex] ?? ""),
    name: cleanText(row[nameIndex] ?? ""),
    sector: cleanText(row[sectorIndex] ?? ""),
    source: "sp500"
  })).filter((item) => item.symbol);
}

function parseNasdaq100(html) {
  const tables = parseTables(html);
  const table = tables.find((rows) => rows[0]?.some((cell) => /Ticker/i.test(cell)) && rows[0]?.some((cell) => /Company|Security/i.test(cell)));
  if (!table) return [];
  const header = table[0];
  const symbolIndex = header.findIndex((cell) => /Ticker/i.test(cell));
  const nameIndex = header.findIndex((cell) => /Company|Security/i.test(cell));
  const sectorIndex = header.findIndex((cell) => /GICS Sector|Sector/i.test(cell));
  return table.slice(1).map((row) => ({
    symbol: normalizeSymbol(row[symbolIndex] ?? ""),
    name: cleanText(row[nameIndex] ?? ""),
    sector: sectorIndex >= 0 ? cleanText(row[sectorIndex] ?? "") : "",
    source: "nasdaq100"
  })).filter((item) => item.symbol);
}

function mergeInstrument(map, item) {
  const symbol = normalizeSymbol(item.symbol);
  if (!symbol) return;
  const previous = map.get(symbol) ?? {};
  map.set(symbol, {
    symbol,
    name: item.name || previous.name || symbol,
    type: item.type || previous.type || "stock",
    group: item.group || previous.group || "stock",
    sector: item.sector || previous.sector || "",
    tags: Array.from(new Set([...(previous.tags ?? []), ...(item.tags ?? [])])),
    source: Array.from(new Set([...(previous.source ? String(previous.source).split(",") : []), ...(item.source ? [item.source] : [])])).join(","),
    leveraged: item.leveraged || previous.leveraged || false,
    underlying: item.underlying || previous.underlying || null
  });
}

export async function buildUniverse({ sample = false } = {}) {
  const config = await loadUniverseConfig();
  const map = new Map();

  for (const stock of config.seedStocks) mergeInstrument(map, { ...stock, type: "stock", source: "seed" });

  if (!sample) {
    try {
      const [sp500Html, nasdaqHtml] = await Promise.all([fetchText(WIKI_SP500), fetchText(WIKI_NASDAQ100)]);
      for (const stock of parseSp500(sp500Html)) mergeInstrument(map, { ...stock, type: "stock" });
      for (const stock of parseNasdaq100(nasdaqHtml)) mergeInstrument(map, { ...stock, type: "stock" });
    } catch (error) {
      console.warn(`Universe fetch failed; using seed stocks only. ${error.message}`);
    }
  }

  const etfGroups = [
    ...(config.marketEtfs ?? []),
    ...(config.sectorEtfs ?? []),
    ...(config.themeEtfs ?? []),
    ...(config.leveragedEtfs ?? [])
  ];
  for (const etf of etfGroups) mergeInstrument(map, { ...etf, type: "etf", source: "config" });

  return Array.from(map.values()).sort((a, b) => a.symbol.localeCompare(b.symbol));
}
