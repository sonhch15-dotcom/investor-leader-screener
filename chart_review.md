# Chart Review

Review date: 2026-07-07 KST

This is a first chart review based on the screener output in `data/screener-results.json`.

Important: this is not a buy recommendation. The goal is to separate strong candidates into clearer review buckets.

## Market Context

- Market regime: normal
- Market score: 65.64
- Suggested risk per trade: 1.0%-1.5%
- Screener universe: 551 instruments

Current classification:

| Status | Count |
|---|---:|
| Buyable | 1 |
| Review | 8 |
| Strong watch | 4 |
| Watch | 82 |
| Excluded | 456 |

## Status Definitions

### Buyable

The screener found:

- Score 80+
- Valid setup
- Stop distance acceptable
- Reward/risk at least 2R by the current automated calculation

This still needs manual chart confirmation before any real trade.

### Review

The instrument is strong and has a setup, but the automated reward/risk calculation is not good enough.

Most review names need manual confirmation of:

- Real support level
- Real stop level
- Better target than the conservative automated target
- Whether 2R is actually possible

### Strong Watch

The instrument is strong, but no clean entry setup is detected yet.

These are usually better watched for:

- Pullback to support
- Breakout with volume
- Clear stop-loss area

## Top Candidates

| Symbol | Status | Score | 6M Chart Move | 20D Position | 52W High Distance | Setup | RR | Stop | Notes |
|---|---|---:|---:|---:|---:|---|---:|---:|---|
| TECH | Strong watch | 84.95 | +19.3% | 100% | -1.7% | None | - | - | Strong, near highs, but no entry setup. |
| MRNA | Buyable | 84.69 | +165.1% | 100% | -4.4% | Volume breakout | 19.82 | 2.5% | Very strong but short-term overextended. Needs manual caution. |
| UAL | Strong watch | 84.11 | +17.2% | 89% | -4.5% | None | - | - | Strong airline candidate, but no clean setup. |
| DAL | Review | 83.39 | +33.5% | 88% | -4.2% | Pullback reacceleration | 0.48 | 9.1% | Strong, but current automated 2R fails. |
| IBKR | Review | 81.74 | +42.9% | 93% | -1.9% | Pullback reacceleration | 0.18 | 10.6% | Strong trend, but target/stop math is poor. |
| LUV | Review | 81.55 | +24.1% | 89% | -7.8% | Pullback reacceleration | 1.06 | 8.0% | Airline group strength, but still below 2R. |
| CNC | Review | 81.22 | +58.1% | 70% | -4.7% | Pullback reacceleration | 0.65 | 7.5% | Strong, but needs better target confirmation. |
| WST | Review | 81.14 | +29.6% | 84% | -2.7% | Pullback reacceleration | 0.28 | 10.1% | Strong, near high, but automated RR weak. |
| CAT | Strong watch | 80.47 | +62.8% | 54% | -9.7% | None | - | - | Big 6M strength, but no entry setup now. |
| GE | Review | 80.47 | +18.2% | 100% | -1.1% | Pullback reacceleration | 0.12 | 9.1% | Very near high; automated target too conservative. |
| GEV | Review | 80.11 | +69.8% | 93% | -3.7% | Pullback reacceleration | 0.32 | 12.1% | Strong trend, but stop is wide and RR fails. |
| UNH | Review | 80.05 | +25.9% | 68% | -2.8% | Pullback reacceleration | 0.56 | 5.3% | Strong recovery, but needs better target confirmation. |
| HOOD | Strong watch | 80.00 | +2.0% | 100% | -23.6% | None | - | - | Relative score is high, but still far from 52W high. |

## First Review Takeaways

### 1. The new classification is better than the original watch-only view.

Before:

```text
Buyable: 0
Watch: 95
```

After:

```text
Buyable: 1
Review: 8
Strong watch: 4
Watch: 82
```

This is more useful because strong names with a possible setup are separated from strong names that need more waiting.

### 2. The automated 2R calculation is still too conservative.

Many strong names are failing because the current target is too close.

Examples:

- DAL
- IBKR
- GE
- GEV
- WST

These may still be valid trend-following candidates if the real target is not just the prior high.

### 3. MRNA should be treated carefully despite the buyable label.

MRNA passed the automated buyable rules, but it has a major warning:

- 6-month move: +165.1%
- 20-day position: 100%
- Short-term overextension warning

This is a strong breakout candidate, but it is also the kind of chart where chasing risk can be high.

### 4. Airlines appear as a group.

UAL, DAL, and LUV all appear near the top.

This suggests a group/industry move rather than a single isolated ticker. That is useful, but individual entry quality still matters.

### 5. Industrial leaders need closer manual review.

GE, GEV, and CAT show strong trend behavior.

The automated setup logic is not yet good enough to judge these cleanly because the target calculation is too conservative near highs.

## Next Adjustments

Recommended next changes:

1. Keep the current `Buyable` status, but treat it as `Auto Buyable - manual confirmation required`.
2. Add a `Review` section to the dashboard, already implemented.
3. Improve the target calculation for trend leaders near 52-week highs.
4. Add larger chart view per ticker.
5. Add simple moving averages to the mini chart.
6. Add manual review fields later:
   - good setup
   - wait
   - reject
   - note

## Immediate Manual Review Priority

Review in this order:

1. MRNA: breakout but overextended
2. GE / GEV: industrial leadership, target model likely too conservative
3. DAL / UAL / LUV: airline group strength
4. IBKR: strong but stop/target needs inspection
5. CNC / UNH / WST: health care strength, needs target confirmation
