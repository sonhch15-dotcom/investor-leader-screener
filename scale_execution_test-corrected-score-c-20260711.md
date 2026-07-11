# Scale Execution Test

Generated at: 2026-07-11T01:10:31.358Z
Source strategy: Score C Half Sector10 Normalized
Source file: data\sector-score-variant-test-corrected-frozen-20260711.json
Selected trades: 118
Price snapshot: data/sector-score-price-snapshot-corrected-frozen-20260711.json.gz (493d56b6083cdf39d9d93920b9dbe051f7230b6478f465ce2843dc7eeefa3820)
Transaction cost: 10 bps on each buy/sell cash flow

## Summary

| Rule | Entered | Closed | Open | Skipped | Avg Hold Days | Avg Return | Median | Win Rate | Avg QQQ | Excess QQQ | Improvement vs Baseline |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Lump Buy / Lump Sell | 118 | 106 | 12 | 0 | 125.3 | 33.4% | 12.0% | 73.6% | 7.6% | 25.9% | 0.0% |
| 3-Step Buy / Lump Sell | 116 | 106 | 10 | 2 | 125.3 | 32.1% | 12.4% | 73.6% | 7.6% | 24.5% | -1.4% |
| Lump Buy / 3-Step Sell | 118 | 104 | 14 | 0 | 135.3 | 34.5% | 11.6% | 71.2% | 8.5% | 26.0% | 2.9% |
| 3-Step Buy / 3-Step Sell | 116 | 104 | 12 | 2 | 135.3 | 33.3% | 11.6% | 72.1% | 8.5% | 24.9% | 1.7% |
| 50% Sell / 50% Weekly Extend | 118 | 97 | 21 | 0 | 154.3 | 31.2% | 10.1% | 71.1% | 8.7% | 22.5% | 12.3% |

## Robust Check

Extreme individual returns above +300% or below -300% are excluded here.

| Rule | Trades | Avg Return | Median | Win Rate | Excess QQQ | Improvement vs Baseline |
|---|---:|---:|---:|---:|---:|---:|
| Lump Buy / Lump Sell | 105 | 26.8% | 11.9% | 73.3% | 19.3% | 0.0% |
| 3-Step Buy / Lump Sell | 105 | 25.4% | 12.3% | 73.3% | 18.0% | -1.3% |
| Lump Buy / 3-Step Sell | 103 | 27.3% | 11.4% | 70.9% | 18.9% | 2.5% |
| 3-Step Buy / 3-Step Sell | 103 | 26.2% | 11.4% | 71.8% | 17.9% | 1.5% |
| 50% Sell / 50% Weekly Extend | 95 | 24.0% | 9.2% | 70.5% | 16.0% | 7.1% |

## Sell Reasons

| Rule | Reasons |
|---|---|
| Lump Buy / Lump Sell | fixed_6m: 106 |
| 3-Step Buy / Lump Sell | fixed_6m: 106 |
| Lump Buy / 3-Step Sell | fixed_6m: 106, fixed_6m_plus_5d: 106, fixed_6m_plus_10d: 104 |
| 3-Step Buy / 3-Step Sell | fixed_6m: 106, fixed_6m_plus_5d: 106, fixed_6m_plus_10d: 104 |
| 50% Sell / 50% Weekly Extend | half_fixed_6m: 106, half_trend_not_alive_at_6m: 47, half_two_week_10w_break: 45, half_max_12m: 5 |

## Recent Trades

### Lump Buy / Lump Sell

| Cohort | Symbol | Buy Dates | Sell Dates | Avg Buy | Avg Sell | Return | QQQ |
|---|---|---|---|---:|---:|---:|---:|
| 2026-01 | HAL | 2026-02-02 |  | 32.57 | - | - | - |
| 2026-01 | STX | 2026-02-02 |  | 432.32 | - | - | - |
| 2026-02 | TPL | 2026-03-02 |  | 530.81 | - | - | - |
| 2026-02 | SNDK | 2026-03-02 |  | 619.70 | - | - | - |
| 2026-03 | OXY | 2026-03-30 |  | 66.00 | - | - | - |
| 2026-03 | WDC | 2026-03-30 |  | 251.86 | - | - | - |
| 2026-04 | ARM | 2026-04-27 |  | 216.10 | - | - | - |
| 2026-04 | STX | 2026-04-27 |  | 596.03 | - | - | - |
| 2026-05 | MRVL | 2026-06-01 |  | 219.65 | - | - | - |
| 2026-05 | STX | 2026-06-01 |  | 921.53 | - | - | - |
| 2026-06 | INTC | 2026-06-29 |  | 131.85 | - | - | - |
| 2026-06 | KLAC | 2026-06-29 |  | 278.67 | - | - | - |

### 3-Step Buy / Lump Sell

| Cohort | Symbol | Buy Dates | Sell Dates | Avg Buy | Avg Sell | Return | QQQ |
|---|---|---|---|---:|---:|---:|---:|
| 2025-12 | CHRW | 2025-12-29, 2026-01-06, 2026-01-13 | 2026-06-29 | 167.27 | 184.75 | 10.3% | 16.9% |
| 2025-12 | STX | 2025-12-29, 2026-01-06, 2026-01-13 | 2026-06-29 | 308.14 | 968.53 | 214.0% | 16.9% |
| 2026-01 | HAL | 2026-02-02, 2026-02-09, 2026-02-17 |  | 33.52 | - | - | - |
| 2026-01 | STX | 2026-02-02, 2026-02-09, 2026-02-17 |  | 423.90 | - | - | - |
| 2026-02 | TPL | 2026-03-02, 2026-03-09, 2026-03-16 |  | 532.26 | - | - | - |
| 2026-02 | SNDK | 2026-03-02, 2026-03-09, 2026-03-16 |  | 634.20 | - | - | - |
| 2026-03 | OXY | 2026-03-30, 2026-04-07, 2026-04-14 |  | 60.95 | - | - | - |
| 2026-03 | WDC | 2026-03-30, 2026-04-07, 2026-04-14 |  | 302.96 | - | - | - |
| 2026-04 | ARM | 2026-04-27, 2026-05-04, 2026-05-11 |  | 210.67 | - | - | - |
| 2026-04 | STX | 2026-04-27, 2026-05-04, 2026-05-11 |  | 709.21 | - | - | - |
| 2026-05 | MRVL | 2026-06-01, 2026-06-08, 2026-06-15 |  | 266.77 | - | - | - |
| 2026-05 | STX | 2026-06-01, 2026-06-08, 2026-06-15 |  | 935.56 | - | - | - |

### Lump Buy / 3-Step Sell

| Cohort | Symbol | Buy Dates | Sell Dates | Avg Buy | Avg Sell | Return | QQQ |
|---|---|---|---|---:|---:|---:|---:|
| 2026-01 | HAL | 2026-02-02 |  | 32.57 | - | - | - |
| 2026-01 | STX | 2026-02-02 |  | 432.32 | - | - | - |
| 2026-02 | TPL | 2026-03-02 |  | 530.81 | - | - | - |
| 2026-02 | SNDK | 2026-03-02 |  | 619.70 | - | - | - |
| 2026-03 | OXY | 2026-03-30 |  | 66.00 | - | - | - |
| 2026-03 | WDC | 2026-03-30 |  | 251.86 | - | - | - |
| 2026-04 | ARM | 2026-04-27 |  | 216.10 | - | - | - |
| 2026-04 | STX | 2026-04-27 |  | 596.03 | - | - | - |
| 2026-05 | MRVL | 2026-06-01 |  | 219.65 | - | - | - |
| 2026-05 | STX | 2026-06-01 |  | 921.53 | - | - | - |
| 2026-06 | INTC | 2026-06-29 |  | 131.85 | - | - | - |
| 2026-06 | KLAC | 2026-06-29 |  | 278.67 | - | - | - |

### 3-Step Buy / 3-Step Sell

| Cohort | Symbol | Buy Dates | Sell Dates | Avg Buy | Avg Sell | Return | QQQ |
|---|---|---|---|---:|---:|---:|---:|
| 2025-12 | CHRW | 2025-12-29, 2026-01-06, 2026-01-13 | 2026-06-29, 2026-07-07 | 167.27 | 187.85 | - | - |
| 2025-12 | STX | 2025-12-29, 2026-01-06, 2026-01-13 | 2026-06-29, 2026-07-07 | 308.14 | 898.09 | - | - |
| 2026-01 | HAL | 2026-02-02, 2026-02-09, 2026-02-17 |  | 33.52 | - | - | - |
| 2026-01 | STX | 2026-02-02, 2026-02-09, 2026-02-17 |  | 423.90 | - | - | - |
| 2026-02 | TPL | 2026-03-02, 2026-03-09, 2026-03-16 |  | 532.26 | - | - | - |
| 2026-02 | SNDK | 2026-03-02, 2026-03-09, 2026-03-16 |  | 634.20 | - | - | - |
| 2026-03 | OXY | 2026-03-30, 2026-04-07, 2026-04-14 |  | 60.95 | - | - | - |
| 2026-03 | WDC | 2026-03-30, 2026-04-07, 2026-04-14 |  | 302.96 | - | - | - |
| 2026-04 | ARM | 2026-04-27, 2026-05-04, 2026-05-11 |  | 210.67 | - | - | - |
| 2026-04 | STX | 2026-04-27, 2026-05-04, 2026-05-11 |  | 709.21 | - | - | - |
| 2026-05 | MRVL | 2026-06-01, 2026-06-08, 2026-06-15 |  | 266.77 | - | - | - |
| 2026-05 | STX | 2026-06-01, 2026-06-08, 2026-06-15 |  | 935.56 | - | - | - |

### 50% Sell / 50% Weekly Extend

| Cohort | Symbol | Buy Dates | Sell Dates | Avg Buy | Avg Sell | Return | QQQ |
|---|---|---|---|---:|---:|---:|---:|
| 2026-01 | HAL | 2026-02-02 |  | 32.57 | - | - | - |
| 2026-01 | STX | 2026-02-02 |  | 432.32 | - | - | - |
| 2026-02 | TPL | 2026-03-02 |  | 530.81 | - | - | - |
| 2026-02 | SNDK | 2026-03-02 |  | 619.70 | - | - | - |
| 2026-03 | OXY | 2026-03-30 |  | 66.00 | - | - | - |
| 2026-03 | WDC | 2026-03-30 |  | 251.86 | - | - | - |
| 2026-04 | ARM | 2026-04-27 |  | 216.10 | - | - | - |
| 2026-04 | STX | 2026-04-27 |  | 596.03 | - | - | - |
| 2026-05 | MRVL | 2026-06-01 |  | 219.65 | - | - | - |
| 2026-05 | STX | 2026-06-01 |  | 921.53 | - | - | - |
| 2026-06 | INTC | 2026-06-29 |  | 131.85 | - | - | - |
| 2026-06 | KLAC | 2026-06-29 |  | 278.67 | - | - | - |

## Notes

- Split buying can reduce bad timing risk, but it can also dilute fast-moving leaders.
- Split selling can keep exposure after the fixed six-month exit, but it can also give back gains.
- The 50/50 weekly extension rule sells half at six months and leaves half for the weekly trend rule.
- This test compares execution style, not stock selection. The selected symbols are unchanged.
