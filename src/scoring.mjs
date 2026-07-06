import { clamp, last, max, mean, min, pctReturn, round, scoreFromPercentile, sma, weightedReturn } from "./math.mjs";

const SECTOR_ETF = {
  "Technology": "XLK",
  "Communication Services": "XLC",
  "Consumer Discretionary": "XLY",
  "Consumer Staples": "XLP",
  "Energy": "XLE",
  "Financials": "XLF",
  "Health Care": "XLV",
  "Industrials": "XLI",
  "Materials": "XLB",
  "Real Estate": "XLRE",
  "Utilities": "XLU"
};

function safeRows(rows) {
  return rows.filter((row) => Number.isFinite(row.close) && Number.isFinite(row.volume));
}

function baseMetrics(rows) {
  const data = safeRows(rows);
  const closes = data.map((row) => row.close);
  const highs = data.map((row) => row.high ?? row.close);
  const lows = data.map((row) => row.low ?? row.close);
  const volumes = data.map((row) => row.volume);
  const close = last(closes);
  const avgVol20 = mean(volumes.slice(-20));
  const avgVol10 = mean(volumes.slice(-10));
  const avgVol50 = mean(volumes.slice(-50));
  const dollarVolumes = data.map((row) => row.close * row.volume);
  const avgDollar20 = mean(dollarVolumes.slice(-20));
  const upVolumes = [];
  const downVolumes = [];
  for (let i = Math.max(1, data.length - 20); i < data.length; i += 1) {
    if (data[i].close > data[i - 1].close) upVolumes.push(data[i].volume);
    if (data[i].close < data[i - 1].close) downVolumes.push(data[i].volume);
  }

  return {
    close,
    closes,
    highs,
    lows,
    volumes,
    returns: {
      r1m: pctReturn(closes, 21),
      r3m: pctReturn(closes, 63),
      r6m: pctReturn(closes, 126)
    },
    weightedMomentum: weightedReturn({
      r1m: pctReturn(closes, 21),
      r3m: pctReturn(closes, 63),
      r6m: pctReturn(closes, 126)
    }),
    sma5: sma(closes, 5),
    sma10: sma(closes, 10),
    sma20: sma(closes, 20),
    sma50: sma(closes, 50),
    sma200: sma(closes, 200),
    high20: max(highs.slice(-20)),
    prevHigh20: max(highs.slice(-21, -1)),
    low20: min(lows.slice(-20)),
    high52w: max(highs.slice(-252)),
    low10: min(lows.slice(-10)),
    high10: max(highs.slice(-10)),
    avgVol20,
    avgVol10,
    avgVol50,
    avgDollar20,
    volumeRatio10To50: avgVol50 ? avgVol10 / avgVol50 : null,
    upDownVolumeRatio: mean(downVolumes) ? mean(upVolumes) / mean(downVolumes) : null,
    lastVolume: last(volumes),
    lastDate: data.at(-1)?.date ?? null
  };
}

function movingAverageScore(metric) {
  let score = 0;
  if (metric.close > metric.sma20) score += 2;
  if (metric.close > metric.sma50) score += 2;
  if (metric.close > metric.sma200) score += 2;
  if (metric.sma20 > metric.sma50) score += 1;
  return score;
}

function highProximityScore(metric) {
  if (!metric.high52w || !metric.close) return 0;
  const distance = metric.close / metric.high52w - 1;
  if (distance >= -0.05) return 5;
  if (distance >= -0.10) return 4;
  if (distance >= -0.15) return 3;
  if (distance >= -0.25) return 2;
  return 0;
}

function overextensionPenalty(metric) {
  let penalty = 0;
  if (metric.sma20 && metric.close / metric.sma20 - 1 >= 0.15) penalty -= 1;
  if (metric.sma20 && metric.close / metric.sma20 - 1 >= 0.25) penalty -= 1;
  const r10 = pctReturn(metric.closes, 10);
  if (Number.isFinite(r10) && r10 >= 0.25) penalty -= 1;
  return Math.max(-3, penalty);
}

function dollarVolumeScore(value) {
  if (!Number.isFinite(value)) return 0;
  if (value >= 200_000_000) return 5;
  if (value >= 100_000_000) return 4;
  if (value >= 50_000_000) return 3;
  if (value >= 20_000_000) return 1;
  return 0;
}

function volumeIncreaseScore(value) {
  if (!Number.isFinite(value)) return 0;
  if (value >= 1.5) return 5;
  if (value >= 1.25) return 4;
  if (value >= 1.1) return 3;
  if (value >= 0.9) return 2;
  return 0;
}

function upDownVolumeScore(value) {
  if (!Number.isFinite(value)) return 0;
  if (value >= 1.3) return 5;
  if (value >= 1.15) return 4;
  if (value >= 1.0) return 3;
  if (value >= 0.85) return 1;
  return 0;
}

function trendScore(metric) {
  let score = 0;
  if (metric.close > metric.sma20) score += 8;
  if (metric.close > metric.sma50) score += 8;
  if (metric.close > metric.sma200) score += 8;
  if (metric.sma20 > metric.sma50) score += 8;
  if (metric.high10 > metric.prevHigh20 && metric.low10 > metric.low20) score += 8;
  return score;
}

function detectSetup(metric) {
  const warnings = [];
  const pullbackDrawdown = metric.high10 ? metric.low10 / metric.high10 - 1 : null;
  const pullback = metric.close > metric.sma50
    && pullbackDrawdown <= -0.05
    && pullbackDrawdown >= -0.15
    && metric.close > metric.sma10;
  const breakout = metric.close >= metric.prevHigh20
    && metric.lastVolume >= metric.avgVol20 * 1.3
    && metric.close > metric.sma20
    && metric.close > metric.sma50;

  let type = "none";
  let stop = null;
  let target = null;
  if (pullback) {
    type = "pullback_reacceleration";
    stop = metric.low10 * 0.99;
    target = metric.high52w && metric.high52w > metric.close
      ? metric.high52w
      : metric.close + (metric.high20 - metric.low20);
  } else if (breakout) {
    type = "volume_breakout";
    stop = metric.prevHigh20 * 0.98;
    target = metric.close + Math.max(metric.high20 - metric.low20, metric.close * 0.08);
  }

  const stopDistance = stop ? (metric.close - stop) / metric.close : null;
  const rewardRisk = stop && target && metric.close > stop ? (target - metric.close) / (metric.close - stop) : null;
  if (type !== "none" && (!Number.isFinite(rewardRisk) || rewardRisk < 2)) warnings.push("2R 수동 확인 필요");
  if (type !== "none" && stopDistance > 0.15) warnings.push("손절폭 과도");

  return {
    type,
    stop: round(stop, 2),
    target: round(target, 2),
    stopDistance: round(stopDistance, 4),
    rewardRisk: round(rewardRisk, 2),
    warnings
  };
}

export function scoreUniverse(instruments, priceMap) {
  const metrics = new Map();
  for (const instrument of instruments) {
    const rows = priceMap.get(instrument.symbol);
    if (rows?.length) metrics.set(instrument.symbol, baseMetrics(rows));
  }

  const spy = metrics.get("SPY");
  const qqq = metrics.get("QQQ");
  const weightedMomentumValues = Array.from(metrics.values()).map((metric) => metric.weightedMomentum);
  const spyExcess = new Map();
  const qqqExcess = new Map();

  for (const [symbol, metric] of metrics) {
    const spyRaw = weightedReturn({
      r1m: metric.returns.r1m - spy?.returns.r1m,
      r3m: metric.returns.r3m - spy?.returns.r3m,
      r6m: metric.returns.r6m - spy?.returns.r6m
    });
    const qqqRaw = weightedReturn({
      r1m: metric.returns.r1m - qqq?.returns.r1m,
      r3m: metric.returns.r3m - qqq?.returns.r3m,
      r6m: metric.returns.r6m - qqq?.returns.r6m
    });
    spyExcess.set(symbol, spyRaw);
    qqqExcess.set(symbol, qqqRaw);
  }

  const spyExcessValues = Array.from(spyExcess.values());
  const qqqExcessValues = Array.from(qqqExcess.values());

  const partial = new Map();
  for (const instrument of instruments) {
    const metric = metrics.get(instrument.symbol);
    if (!metric) continue;

    const relative = {
      spy: scoreFromPercentile(spyExcessValues, spyExcess.get(instrument.symbol), 15),
      qqq: scoreFromPercentile(qqqExcessValues, qqqExcess.get(instrument.symbol), 15),
      universe: scoreFromPercentile(weightedMomentumValues, metric.weightedMomentum, 5)
    };
    relative.total = round(relative.spy + relative.qqq + relative.universe, 2);

    const momentum = {
      returns: scoreFromPercentile(weightedMomentumValues, metric.weightedMomentum, 15),
      movingAverage: movingAverageScore(metric),
      highProximity: highProximityScore(metric),
      overextensionPenalty: overextensionPenalty(metric)
    };
    momentum.total = round(clamp(momentum.returns + momentum.movingAverage + momentum.highProximity + momentum.overextensionPenalty, 0, 30), 2);

    partial.set(instrument.symbol, { instrument, metric, relative, momentum });
  }

  const sectorAverages = new Map();
  for (const sector of new Set(instruments.map((item) => item.sector).filter(Boolean))) {
    const values = Array.from(partial.values())
      .filter((item) => item.instrument.sector === sector)
      .map((item) => item.relative.total + item.momentum.total);
    sectorAverages.set(sector, mean(values));
  }
  const sectorAverageValues = Array.from(sectorAverages.values());
  const sectorEtfRawValues = Object.values(SECTOR_ETF).map((symbol) => metrics.get(symbol)?.weightedMomentum);

  const strongTags = new Map();
  for (const item of partial.values()) {
    const strength = item.relative.total + item.momentum.total;
    if (strength >= 45) {
      for (const tag of item.instrument.tags ?? []) {
        strongTags.set(tag, (strongTags.get(tag) ?? 0) + 1);
      }
    }
  }

  const rows = [];
  for (const item of partial.values()) {
    const { instrument, metric, relative, momentum } = item;
    const sectorEtf = SECTOR_ETF[instrument.sector];
    const sectorEtfScore = scoreFromPercentile(sectorEtfRawValues, metrics.get(sectorEtf)?.weightedMomentum, 10);
    const sectorBreadthScore = scoreFromPercentile(sectorAverageValues, sectorAverages.get(instrument.sector), 7);
    let themeBonus = 0;
    if ((instrument.tags ?? []).length) themeBonus += 1;
    if ((instrument.tags ?? []).some((tag) => (strongTags.get(tag) ?? 0) >= 2)) themeBonus += 1;
    if ((instrument.tags ?? []).some((tag) => (strongTags.get(tag) ?? 0) >= 4)) themeBonus += 1;

    const sectorTheme = {
      sectorEtf: round(sectorEtfScore, 2),
      sectorBreadth: round(sectorBreadthScore, 2),
      themeBonus: Math.min(3, themeBonus)
    };
    sectorTheme.total = round(clamp(sectorTheme.sectorEtf + sectorTheme.sectorBreadth + sectorTheme.themeBonus, 0, 20), 2);

    const volume = {
      dollarVolume: dollarVolumeScore(metric.avgDollar20),
      volumeIncrease: volumeIncreaseScore(metric.volumeRatio10To50),
      upDownQuality: upDownVolumeScore(metric.upDownVolumeRatio)
    };
    volume.total = volume.dollarVolume + volume.volumeIncrease + volume.upDownQuality;

    const score = round(relative.total + momentum.total + sectorTheme.total + volume.total, 2);
    const setup = detectSetup(metric);
    const warnings = [...setup.warnings];
    if (instrument.leveraged) warnings.push("레버리지 ETF");
    if (volume.dollarVolume === 0) warnings.push("유동성 부족");
    if (momentum.overextensionPenalty <= -2) warnings.push("단기 과열");

    rows.push({
      symbol: instrument.symbol,
      name: instrument.name,
      type: instrument.type,
      group: instrument.group,
      sector: instrument.sector,
      tags: instrument.tags ?? [],
      leveraged: instrument.leveraged,
      underlying: instrument.underlying,
      score,
      status: "unclassified",
      scores: { relative, momentum, sectorTheme, volume },
      metrics: {
        close: round(metric.close, 2),
        r1m: round(metric.returns.r1m, 4),
        r3m: round(metric.returns.r3m, 4),
        r6m: round(metric.returns.r6m, 4),
        avgDollar20: round(metric.avgDollar20, 0),
        volumeRatio10To50: round(metric.volumeRatio10To50, 2),
        upDownVolumeRatio: round(metric.upDownVolumeRatio, 2),
        high52wDistance: round(metric.high52w ? metric.close / metric.high52w - 1 : null, 4),
        lastDate: metric.lastDate
      },
      setup,
      reasons: buildReasons({ relative, momentum, sectorTheme, volume, instrument }),
      warnings
    });
  }

  const market = scoreMarket(metrics, rows);
  for (const row of rows) row.status = classify(row, market);
  rows.sort((a, b) => b.score - a.score);
  return { generatedAt: new Date().toISOString(), market, rows };
}

function buildReasons({ relative, momentum, sectorTheme, volume, instrument }) {
  const reasons = [];
  if (relative.total >= 30) reasons.push("시장 대비 상대강도 우수");
  else if (relative.total >= 25) reasons.push("상대강도 양호");
  if (momentum.total >= 25) reasons.push("가격 모멘텀 강함");
  if (sectorTheme.total >= 16) reasons.push("섹터/테마 강세");
  if (volume.total >= 12) reasons.push("거래량/수급 양호");
  if (instrument.leveraged) reasons.push("강한 장에서만 검토할 레버리지 후보");
  return reasons.slice(0, 4);
}

function scoreMarket(metrics, rows) {
  const indexSymbols = ["SPY", "QQQ", "IWM"];
  const indexScores = indexSymbols.map((symbol) => metrics.get(symbol)).filter(Boolean).map(trendScore);
  const indexTrend = round(mean(indexScores), 2) ?? 0;

  const breadthPool = rows.filter((row) => row.type === "stock" && metrics.has(row.symbol));
  const above20 = breadthPool.filter((row) => metrics.get(row.symbol).close > metrics.get(row.symbol).sma20).length / Math.max(1, breadthPool.length);
  const above50 = breadthPool.filter((row) => metrics.get(row.symbol).close > metrics.get(row.symbol).sma50).length / Math.max(1, breadthPool.length);
  const newHighs = breadthPool.filter((row) => metrics.get(row.symbol).close >= metrics.get(row.symbol).high20).length;
  const newLows = breadthPool.filter((row) => metrics.get(row.symbol).close <= metrics.get(row.symbol).low20).length;
  const breadth = round(above20 * 10 + above50 * 10 + (newHighs > newLows ? 10 : newHighs === newLows ? 5 : 0), 2);

  const spyMomentum = metrics.get("SPY")?.weightedMomentum;
  const sectorSymbols = Object.values(SECTOR_ETF);
  const strongSectorRatio = sectorSymbols.filter((symbol) => metrics.get(symbol)?.weightedMomentum > spyMomentum).length / sectorSymbols.length;
  const sectorTrendRatio = sectorSymbols.filter((symbol) => {
    const metric = metrics.get(symbol);
    return metric?.close > metric?.sma20 && metric?.close > metric?.sma50;
  }).length / sectorSymbols.length;
  const sectorFlow = round(strongSectorRatio * 10 + sectorTrendRatio * 10, 2);

  const eventRisk = 0;
  const score = round(indexTrend + breadth + sectorFlow + eventRisk, 2);
  let regime = "매우 약함";
  if (score >= 75) regime = "강함";
  else if (score >= 55) regime = "보통";
  else if (score >= 35) regime = "약함";

  return {
    score,
    regime,
    components: {
      indexTrend,
      breadth,
      sectorFlow,
      eventRisk
    },
    suggestedRiskPerTrade: regime === "강함" ? "1.5%-2.0%" : regime === "보통" ? "1.0%-1.5%" : regime === "약함" ? "0.5%-1.0%" : "0%-0.5%"
  };
}

function classify(row, market) {
  if (row.score < 70 || row.scores.volume.dollarVolume === 0) return "excluded";
  if (row.score >= 80
    && market.regime !== "매우 약함"
    && row.setup.type !== "none"
    && row.setup.rewardRisk >= 2
    && row.setup.stopDistance <= 0.15) {
    return "buyable";
  }
  return "watch";
}
