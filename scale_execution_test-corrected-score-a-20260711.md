# Scale Execution Test

Generated at: 2026-07-11T01:10:31.416Z
Source strategy: Score A Current Sector20
Source file: data\sector-score-variant-test-corrected-frozen-20260711.json
Selected trades: 118
Price snapshot: data/sector-score-price-snapshot-corrected-frozen-20260711.json.gz (493d56b6083cdf39d9d93920b9dbe051f7230b6478f465ce2843dc7eeefa3820)
Transaction cost: 10 bps on each buy/sell cash flow

## Summary

| Rule | Entered | Closed | Open | Skipped | Avg Hold Days | Avg Return | Median | Win Rate | Avg QQQ | Excess QQQ | Improvement vs Baseline |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Lump Buy / Lump Sell | 118 | 106 | 12 | 0 | 125.3 | 28.2% | 11.7% | 75.5% | 7.6% | 20.6% | 0.0% |
| 3-Step Buy / Lump Sell | 116 | 106 | 10 | 2 | 125.3 | 26.9% | 12.4% | 75.5% | 7.6% | 19.3% | -1.4% |
| Lump Buy / 3-Step Sell | 118 | 104 | 14 | 0 | 135.3 | 28.7% | 11.2% | 72.1% | 8.5% | 20.2% | 2.5% |
| 3-Step Buy / 3-Step Sell | 116 | 104 | 12 | 2 | 135.3 | 27.6% | 11.3% | 74.0% | 8.5% | 19.1% | 1.4% |
| 50% Sell / 50% Weekly Extend | 118 | 98 | 20 | 0 | 150.9 | 23.9% | 9.1% | 74.5% | 8.3% | 15.6% | 9.0% |

## Robust Check

Extreme individual returns above +300% or below -300% are excluded here.

| Rule | Trades | Avg Return | Median | Win Rate | Excess QQQ | Improvement vs Baseline |
|---|---:|---:|---:|---:|---:|---:|
| Lump Buy / Lump Sell | 105 | 21.5% | 11.5% | 75.2% | 14.0% | 0.0% |
| 3-Step Buy / Lump Sell | 105 | 20.2% | 12.4% | 75.2% | 12.7% | -1.3% |
| Lump Buy / 3-Step Sell | 103 | 21.5% | 11.0% | 71.8% | 13.1% | 2.2% |
| 3-Step Buy / 3-Step Sell | 103 | 20.4% | 11.3% | 73.8% | 12.1% | 1.1% |
| 50% Sell / 50% Weekly Extend | 96 | 16.7% | 8.6% | 74.0% | 9.0% | 3.8% |

## Sell Reasons

| Rule | Reasons |
|---|---|
| Lump Buy / Lump Sell | fixed_6m: 106 |
| 3-Step Buy / Lump Sell | fixed_6m: 106 |
| Lump Buy / 3-Step Sell | fixed_6m: 106, fixed_6m_plus_5d: 106, fixed_6m_plus_10d: 104 |
| 3-Step Buy / 3-Step Sell | fixed_6m: 106, fixed_6m_plus_5d: 106, fixed_6m_plus_10d: 104 |
| 50% Sell / 50% Weekly Extend | half_fixed_6m: 106, half_two_week_10w_break: 45, half_trend_not_alive_at_6m: 48, half_max_12m: 5 |

## Recent Trades

### Lump Buy / Lump Sell

| Cohort | Symbol | Buy Dates | Sell Dates | Avg Buy | Avg Sell | Return | QQQ |
|---|---|---|---|---:|---:|---:|---:|
| 2026-01 | XOM | 2026-02-02 |  | 136.69 | - | - | - |
| 2026-01 | STX | 2026-02-02 |  | 432.32 | - | - | - |
| 2026-02 | TPL | 2026-03-02 |  | 530.81 | - | - | - |
| 2026-02 | GNRC | 2026-03-02 |  | 230.61 | - | - | - |
| 2026-03 | XOM | 2026-03-30 |  | 170.48 | - | - | - |
| 2026-03 | ETR | 2026-03-30 |  | 110.57 | - | - | - |
| 2026-04 | ARM | 2026-04-27 |  | 216.10 | - | - | - |
| 2026-04 | STX | 2026-04-27 |  | 596.03 | - | - | - |
| 2026-05 | ARM | 2026-06-01 |  | 409.26 | - | - | - |
| 2026-05 | STX | 2026-06-01 |  | 921.53 | - | - | - |
| 2026-06 | INTC | 2026-06-29 |  | 131.85 | - | - | - |
| 2026-06 | KLAC | 2026-06-29 |  | 278.67 | - | - | - |

### 3-Step Buy / Lump Sell

| Cohort | Symbol | Buy Dates | Sell Dates | Avg Buy | Avg Sell | Return | QQQ |
|---|---|---|---|---:|---:|---:|---:|
| 2025-12 | BIIB | 2025-12-29, 2026-01-06, 2026-01-13 | 2026-06-29 | 179.39 | 216.63 | 20.6% | 16.9% |
| 2025-12 | STX | 2025-12-29, 2026-01-06, 2026-01-13 | 2026-06-29 | 308.14 | 968.53 | 214.0% | 16.9% |
| 2026-01 | XOM | 2026-02-02, 2026-02-09, 2026-02-17 |  | 143.60 | - | - | - |
| 2026-01 | STX | 2026-02-02, 2026-02-09, 2026-02-17 |  | 423.90 | - | - | - |
| 2026-02 | TPL | 2026-03-02, 2026-03-09, 2026-03-16 |  | 532.26 | - | - | - |
| 2026-02 | GNRC | 2026-03-02, 2026-03-09, 2026-03-16 |  | 212.86 | - | - | - |
| 2026-03 | XOM | 2026-03-30, 2026-04-07, 2026-04-14 |  | 160.08 | - | - | - |
| 2026-03 | ETR | 2026-03-30, 2026-04-07, 2026-04-14 |  | 112.97 | - | - | - |
| 2026-04 | ARM | 2026-04-27, 2026-05-04, 2026-05-11 |  | 210.67 | - | - | - |
| 2026-04 | STX | 2026-04-27, 2026-05-04, 2026-05-11 |  | 709.21 | - | - | - |
| 2026-05 | ARM | 2026-06-01, 2026-06-08, 2026-06-15 |  | 387.15 | - | - | - |
| 2026-05 | STX | 2026-06-01, 2026-06-08, 2026-06-15 |  | 935.56 | - | - | - |

### Lump Buy / 3-Step Sell

| Cohort | Symbol | Buy Dates | Sell Dates | Avg Buy | Avg Sell | Return | QQQ |
|---|---|---|---|---:|---:|---:|---:|
| 2026-01 | XOM | 2026-02-02 |  | 136.69 | - | - | - |
| 2026-01 | STX | 2026-02-02 |  | 432.32 | - | - | - |
| 2026-02 | TPL | 2026-03-02 |  | 530.81 | - | - | - |
| 2026-02 | GNRC | 2026-03-02 |  | 230.61 | - | - | - |
| 2026-03 | XOM | 2026-03-30 |  | 170.48 | - | - | - |
| 2026-03 | ETR | 2026-03-30 |  | 110.57 | - | - | - |
| 2026-04 | ARM | 2026-04-27 |  | 216.10 | - | - | - |
| 2026-04 | STX | 2026-04-27 |  | 596.03 | - | - | - |
| 2026-05 | ARM | 2026-06-01 |  | 409.26 | - | - | - |
| 2026-05 | STX | 2026-06-01 |  | 921.53 | - | - | - |
| 2026-06 | INTC | 2026-06-29 |  | 131.85 | - | - | - |
| 2026-06 | KLAC | 2026-06-29 |  | 278.67 | - | - | - |

### 3-Step Buy / 3-Step Sell

| Cohort | Symbol | Buy Dates | Sell Dates | Avg Buy | Avg Sell | Return | QQQ |
|---|---|---|---|---:|---:|---:|---:|
| 2025-12 | BIIB | 2025-12-29, 2026-01-06, 2026-01-13 | 2026-06-29, 2026-07-07 | 179.39 | 211.17 | - | - |
| 2025-12 | STX | 2025-12-29, 2026-01-06, 2026-01-13 | 2026-06-29, 2026-07-07 | 308.14 | 898.09 | - | - |
| 2026-01 | XOM | 2026-02-02, 2026-02-09, 2026-02-17 |  | 143.60 | - | - | - |
| 2026-01 | STX | 2026-02-02, 2026-02-09, 2026-02-17 |  | 423.90 | - | - | - |
| 2026-02 | TPL | 2026-03-02, 2026-03-09, 2026-03-16 |  | 532.26 | - | - | - |
| 2026-02 | GNRC | 2026-03-02, 2026-03-09, 2026-03-16 |  | 212.86 | - | - | - |
| 2026-03 | XOM | 2026-03-30, 2026-04-07, 2026-04-14 |  | 160.08 | - | - | - |
| 2026-03 | ETR | 2026-03-30, 2026-04-07, 2026-04-14 |  | 112.97 | - | - | - |
| 2026-04 | ARM | 2026-04-27, 2026-05-04, 2026-05-11 |  | 210.67 | - | - | - |
| 2026-04 | STX | 2026-04-27, 2026-05-04, 2026-05-11 |  | 709.21 | - | - | - |
| 2026-05 | ARM | 2026-06-01, 2026-06-08, 2026-06-15 |  | 387.15 | - | - | - |
| 2026-05 | STX | 2026-06-01, 2026-06-08, 2026-06-15 |  | 935.56 | - | - | - |

### 50% Sell / 50% Weekly Extend

| Cohort | Symbol | Buy Dates | Sell Dates | Avg Buy | Avg Sell | Return | QQQ |
|---|---|---|---|---:|---:|---:|---:|
| 2026-01 | XOM | 2026-02-02 |  | 136.69 | - | - | - |
| 2026-01 | STX | 2026-02-02 |  | 432.32 | - | - | - |
| 2026-02 | TPL | 2026-03-02 |  | 530.81 | - | - | - |
| 2026-02 | GNRC | 2026-03-02 |  | 230.61 | - | - | - |
| 2026-03 | XOM | 2026-03-30 |  | 170.48 | - | - | - |
| 2026-03 | ETR | 2026-03-30 |  | 110.57 | - | - | - |
| 2026-04 | ARM | 2026-04-27 |  | 216.10 | - | - | - |
| 2026-04 | STX | 2026-04-27 |  | 596.03 | - | - | - |
| 2026-05 | ARM | 2026-06-01 |  | 409.26 | - | - | - |
| 2026-05 | STX | 2026-06-01 |  | 921.53 | - | - | - |
| 2026-06 | INTC | 2026-06-29 |  | 131.85 | - | - | - |
| 2026-06 | KLAC | 2026-06-29 |  | 278.67 | - | - | - |

## Notes

- Split buying can reduce bad timing risk, but it can also dilute fast-moving leaders.
- Split selling can keep exposure after the fixed six-month exit, but it can also give back gains.
- The 50/50 weekly extension rule sells half at six months and leaves half for the weekly trend rule.
- This test compares execution style, not stock selection. The selected symbols are unchanged.
