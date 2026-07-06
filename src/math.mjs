export function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function mean(values) {
  const clean = values.filter(Number.isFinite);
  if (!clean.length) return null;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

export function last(values) {
  return values.length ? values[values.length - 1] : null;
}

export function sma(values, days) {
  if (values.length < days) return null;
  return mean(values.slice(-days));
}

export function max(values) {
  const clean = values.filter(Number.isFinite);
  return clean.length ? Math.max(...clean) : null;
}

export function min(values) {
  const clean = values.filter(Number.isFinite);
  return clean.length ? Math.min(...clean) : null;
}

export function pctReturn(values, days) {
  if (values.length <= days) return null;
  const current = last(values);
  const previous = values[values.length - 1 - days];
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return current / previous - 1;
}

export function weightedReturn(returns) {
  const parts = [
    [returns.r1m, 0.4],
    [returns.r3m, 0.35],
    [returns.r6m, 0.25]
  ];
  const valid = parts.filter(([value]) => Number.isFinite(value));
  if (!valid.length) return null;
  const weight = valid.reduce((sum, [, w]) => sum + w, 0);
  return valid.reduce((sum, [value, w]) => sum + value * w, 0) / weight;
}

export function percentileRank(values, value) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length || !Number.isFinite(value)) return 0;
  let belowOrEqual = 0;
  for (const item of clean) {
    if (item <= value) belowOrEqual += 1;
  }
  return belowOrEqual / clean.length;
}

export function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function scoreFromPercentile(values, value, maxScore) {
  return round(percentileRank(values, value) * maxScore, 2);
}
