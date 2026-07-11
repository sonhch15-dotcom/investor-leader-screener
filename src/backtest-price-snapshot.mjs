import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gzip, gunzip } from "node:zlib";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

function hashJson(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function buildPriceSnapshot(dailyMap, { firstDate = null, source = "yahoo" } = {}) {
  const series = {};
  for (const symbol of [...dailyMap.keys()].sort()) {
    series[symbol] = (dailyMap.get(symbol) ?? [])
      .filter((row) => (!firstDate || row.date >= firstDate) && Number.isFinite(row.close))
      .map((row) => {
        const snapshotRow = { date: row.date, close: row.close };
        for (const field of ["open", "high", "low", "rawClose", "volume"]) {
          if (Number.isFinite(row[field])) snapshotRow[field] = row[field];
        }
        return snapshotRow;
      });
  }
  const qqqRows = series.QQQ ?? Object.values(series).find((rows) => rows.length) ?? [];
  const asOf = qqqRows.at(-1)?.date ?? null;
  const hash = hashJson({ version: 1, firstDate, asOf, series });
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    source,
    firstDate,
    asOf,
    hash,
    series
  };
}

export function priceMapFromSnapshot(snapshot) {
  return new Map(Object.entries(snapshot.series ?? {}));
}

export function priceOnOrBefore(rows, date) {
  if (!rows?.length || !date) return null;
  let low = 0;
  let high = rows.length - 1;
  let match = null;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const row = rows[middle];
    if (row.date <= date) {
      if (Number.isFinite(row.close)) match = row;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return match;
}

export async function writePriceSnapshot(filePath, snapshot) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const json = `${JSON.stringify(snapshot)}\n`;
  if (filePath.endsWith(".gz")) {
    await fs.writeFile(filePath, await gzipAsync(Buffer.from(json, "utf8")));
  } else {
    await fs.writeFile(filePath, json, "utf8");
  }
}

export async function readPriceSnapshot(filePath) {
  const raw = await fs.readFile(filePath);
  const json = filePath.endsWith(".gz")
    ? (await gunzipAsync(raw)).toString("utf8")
    : raw.toString("utf8");
  const snapshot = JSON.parse(json);
  const expectedHash = hashJson({
    version: snapshot.version,
    firstDate: snapshot.firstDate ?? null,
    asOf: snapshot.asOf ?? null,
    series: snapshot.series ?? {}
  });
  if (snapshot.hash !== expectedHash) {
    throw new Error(`Price snapshot hash mismatch: ${filePath}`);
  }
  return snapshot;
}

export function relativeSnapshotPath(root, filePath) {
  return path.relative(root, filePath).replaceAll("\\", "/");
}
