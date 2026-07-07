# Weekly Dropout Rule Test

Generated at: 2026-07-07T22:22:16.929Z
Source strategy: Leader2 One Each
Source file: data\monthly-buy-rule-test-5y.json
Weekly dropout signal: 2 consecutive weekly observations after 4 grace weeks

## Summary

The baseline for the improvement column is the current 50/50 weekly extension rule.

| Rule | Trades | Avg Hold Days | Avg Return | Median | Win Rate | Avg QQQ | Excess QQQ | Improvement vs Current |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Fixed 6M | 106 | 125.3 | 28.1% | 11.8% | 75.5% | 7.6% | 20.5% | -14.0% |
| Current 50/50 Weekly | 106 | 151.1 | 42.1% | 11.0% | 76.4% | 9.1% | 33.1% | 0.0% |
| Early Exit: Symbol Drop | 106 | 26.0 | 3.7% | 1.1% | 56.6% | 0.8% | 2.9% | -38.5% |
| Early Exit: Group Top2 Drop | 106 | 37.5 | 9.4% | 0.6% | 52.8% | 1.3% | 8.1% | -32.8% |
| Early Exit: Group Top5 Drop | 106 | 60.5 | 19.5% | 3.5% | 61.3% | 3.5% | 16.0% | -22.7% |
| 50/50 + Extension Top5 Guard | 106 | 140.6 | 39.4% | 11.7% | 76.4% | 8.5% | 30.9% | -2.7% |

## Robust Check

Extreme individual returns above +300% or below -300% are excluded here.

| Rule | Trades | Avg Return | Median | Win Rate | Excess QQQ | Improvement vs Current |
|---|---:|---:|---:|---:|---:|---:|
| Fixed 6M | 105 | 21.4% | 11.5% | 75.2% | 13.9% | -13.5% |
| Current 50/50 Weekly | 102 | 24.1% | 9.8% | 75.5% | 15.8% | 0.0% |
| Early Exit: Symbol Drop | 106 | 3.7% | 1.1% | 56.6% | 2.9% | -38.5% |
| Early Exit: Group Top2 Drop | 106 | 9.4% | 0.6% | 52.8% | 8.1% | -32.8% |
| Early Exit: Group Top5 Drop | 105 | 12.6% | 3.5% | 61.0% | 9.3% | -22.2% |
| 50/50 + Extension Top5 Guard | 102 | 21.3% | 11.1% | 75.5% | 13.6% | -2.8% |

## Sell Reasons

| Rule | Reasons |
|---|---|
| Fixed 6M | fixed_6m: 106 |
| Current 50/50 Weekly | half_fixed_6m: 106, half_two_week_10w_break: 45, half_trend_not_alive_at_6m: 48, half_max_12m: 13 |
| Early Exit: Symbol Drop | symbol_top2_2w_drop: 106 |
| Early Exit: Group Top2 Drop | group_top2_2w_drop: 104, fixed_6m: 2 |
| Early Exit: Group Top5 Drop | group_top5_2w_drop: 93, fixed_6m: 13 |
| 50/50 + Extension Top5 Guard | half_fixed_6m: 106, half_group_top5_2w_drop: 34, half_trend_not_alive_at_6m: 48, half_two_week_10w_break: 15, half_max_12m: 9 |

## Best And Worst Trades

| Rule | Best | Worst |
|---|---|---|
| Fixed 6M | 2025-11 SNDK 737.9% | 2021-10 COIN -63.5% |
| Current 50/50 Weekly | 2025-11 SNDK 806.6% | 2021-10 COIN -63.5% |
| Early Exit: Symbol Drop | 2025-08 WDC 98.4% | 2024-06 ARM -30.7% |
| Early Exit: Group Top2 Drop | 2025-08 WDC 242.8% | 2024-06 ARM -30.7% |
| Early Exit: Group Top5 Drop | 2025-11 SNDK 737.9% | 2024-06 ARM -30.7% |
| 50/50 + Extension Top5 Guard | 2025-11 SNDK 806.6% | 2021-10 COIN -63.5% |

## Recent Trades

### Fixed 6M

| Cohort | Symbol | Sector | Sell Dates | Reasons | Return | QQQ |
|---|---|---|---|---|---:|---:|
| 2025-07 | GE | Industrials | 2026-02-02 | fixed_6m | 14.1% | 10.5% |
| 2025-07 | TPR | Consumer Discretionary | 2026-02-02 | fixed_6m | 18.1% | 10.5% |
| 2025-08 | WYNN | Consumer Discretionary | 2026-03-02 | fixed_6m | -17.4% | 7.8% |
| 2025-08 | WDC | Electronic Components | 2026-03-02 | fixed_6m | 230.2% | 7.8% |
| 2025-09 | WDC | Electronic Components | 2026-03-30 | fixed_6m | 115.7% | -6.5% |
| 2025-09 | INTC | Semiconductors | 2026-03-30 | fixed_6m | 19.3% | -6.5% |
| 2025-10 | AMD | Semiconductors | 2026-04-27 | fixed_6m | 28.7% | 5.3% |
| 2025-10 | WDC | Electronic Components | 2026-04-27 | fixed_6m | 153.7% | 5.3% |
| 2025-11 | LLY | Health Care | 2026-06-01 | fixed_6m | 2.5% | 20.6% |
| 2025-11 | SNDK | Electronic Components | 2026-06-01 | fixed_6m | 737.9% | 20.6% |
| 2025-12 | BIIB | Health Care | 2026-06-29 | fixed_6m | 22.3% | 16.9% |
| 2025-12 | STX | Electronic Components | 2026-06-29 | fixed_6m | 244.9% | 16.9% |

### Current 50/50 Weekly

| Cohort | Symbol | Sector | Sell Dates | Reasons | Return | QQQ |
|---|---|---|---|---|---:|---:|
| 2025-07 | GE | Industrials | 2026-02-02, 2026-02-02 | half_fixed_6m, half_trend_not_alive_at_6m | 14.1% | 10.5% |
| 2025-07 | TPR | Consumer Discretionary | 2026-02-02, 2026-03-20 | half_fixed_6m, half_two_week_10w_break | 23.4% | 2.7% |
| 2025-08 | WYNN | Consumer Discretionary | 2026-03-02, 2026-03-02 | half_fixed_6m, half_trend_not_alive_at_6m | -17.4% | 7.8% |
| 2025-08 | WDC | Electronic Components | 2026-03-02, 2026-06-29 | half_fixed_6m, half_max_12m | 464.0% | 28.6% |
| 2025-09 | WDC | Electronic Components | 2026-03-30, 2026-06-29 | half_fixed_6m, half_max_12m | 287.4% | 21.4% |
| 2025-09 | INTC | Semiconductors | 2026-03-30, 2026-03-30 | half_fixed_6m, half_trend_not_alive_at_6m | 19.3% | -6.5% |
| 2025-10 | AMD | Semiconductors | 2026-04-27, 2026-06-29 | half_fixed_6m, half_max_12m | 68.1% | 15.0% |
| 2025-10 | WDC | Electronic Components | 2026-04-27, 2026-06-29 | half_fixed_6m, half_max_12m | 233.3% | 15.0% |
| 2025-11 | LLY | Health Care | 2026-06-01, 2026-06-29 | half_fixed_6m, half_max_12m | 9.4% | 17.8% |
| 2025-11 | SNDK | Electronic Components | 2026-06-01, 2026-06-29 | half_fixed_6m, half_max_12m | 806.6% | 17.8% |
| 2025-12 | BIIB | Health Care | 2026-06-29, 2026-06-29 | half_fixed_6m, half_max_12m | 22.3% | 16.9% |
| 2025-12 | STX | Electronic Components | 2026-06-29, 2026-06-29 | half_fixed_6m, half_max_12m | 244.9% | 16.9% |

### Early Exit: Symbol Drop

| Cohort | Symbol | Sector | Sell Dates | Reasons | Return | QQQ |
|---|---|---|---|---|---:|---:|
| 2025-07 | GE | Industrials | 2025-09-02 | symbol_top2_2w_drop | 1.6% | -0.4% |
| 2025-07 | TPR | Consumer Discretionary | 2025-09-02 | symbol_top2_2w_drop | -7.1% | -0.4% |
| 2025-08 | WYNN | Consumer Discretionary | 2025-10-13 | symbol_top2_2w_drop | -10.5% | 6.6% |
| 2025-08 | WDC | Electronic Components | 2025-11-17 | symbol_top2_2w_drop | 98.4% | 6.9% |
| 2025-09 | WDC | Electronic Components | 2025-11-17 | symbol_top2_2w_drop | 39.0% | 0.8% |
| 2025-09 | INTC | Semiconductors | 2025-11-03 | symbol_top2_2w_drop | 14.4% | 5.6% |
| 2025-10 | AMD | Semiconductors | 2025-12-08 | symbol_top2_2w_drop | -15.0% | -1.2% |
| 2025-10 | WDC | Electronic Components | 2025-12-08 | symbol_top2_2w_drop | 7.3% | -1.2% |
| 2025-11 | LLY | Health Care | 2026-01-05 | symbol_top2_2w_drop | -1.8% | 0.3% |
| 2025-11 | SNDK | Electronic Components | 2026-01-05 | symbol_top2_2w_drop | 30.2% | 0.3% |
| 2025-12 | BIIB | Health Care | 2026-02-02 | symbol_top2_2w_drop | 1.1% | 0.9% |
| 2025-12 | STX | Electronic Components | 2026-02-23 | symbol_top2_2w_drop | 44.6% | -3.1% |

### Early Exit: Group Top2 Drop

| Cohort | Symbol | Sector | Sell Dates | Reasons | Return | QQQ |
|---|---|---|---|---|---:|---:|
| 2025-07 | GE | Industrials | 2025-09-02 | group_top2_2w_drop | 1.6% | -0.4% |
| 2025-07 | TPR | Consumer Discretionary | 2025-09-29 | group_top2_2w_drop | 1.1% | 5.5% |
| 2025-08 | WYNN | Consumer Discretionary | 2025-10-13 | group_top2_2w_drop | -10.5% | 6.6% |
| 2025-08 | WDC | Electronic Components | 2026-02-23 | group_top2_2w_drop | 242.8% | 6.6% |
| 2025-09 | WDC | Electronic Components | 2026-02-23 | group_top2_2w_drop | 140.2% | 0.6% |
| 2025-09 | INTC | Semiconductors | 2025-11-17 | group_top2_2w_drop | 0.5% | 0.8% |
| 2025-10 | AMD | Semiconductors | 2025-12-22 | group_top2_2w_drop | -17.4% | -1.9% |
| 2025-10 | WDC | Electronic Components | 2026-02-23 | group_top2_2w_drop | 77.4% | -4.7% |
| 2025-11 | LLY | Health Care | 2026-01-12 | group_top2_2w_drop | 2.0% | 1.8% |
| 2025-11 | SNDK | Electronic Components | 2026-02-23 | group_top2_2w_drop | 216.9% | -2.4% |
| 2025-12 | BIIB | Health Care | 2026-02-02 | group_top2_2w_drop | 1.1% | 0.9% |
| 2025-12 | STX | Electronic Components | 2026-02-23 | group_top2_2w_drop | 44.6% | -3.1% |

### Early Exit: Group Top5 Drop

| Cohort | Symbol | Sector | Sell Dates | Reasons | Return | QQQ |
|---|---|---|---|---|---:|---:|
| 2025-07 | GE | Industrials | 2025-09-08 | group_top5_2w_drop | 1.8% | 1.9% |
| 2025-07 | TPR | Consumer Discretionary | 2025-10-13 | group_top5_2w_drop | 3.5% | 6.1% |
| 2025-08 | WYNN | Consumer Discretionary | 2025-10-13 | group_top5_2w_drop | -10.5% | 6.6% |
| 2025-08 | WDC | Electronic Components | 2026-03-02 | fixed_6m | 230.2% | 7.8% |
| 2025-09 | WDC | Electronic Components | 2026-03-30 | fixed_6m | 115.7% | -6.5% |
| 2025-09 | INTC | Semiconductors | 2025-11-17 | group_top5_2w_drop | 0.5% | 0.8% |
| 2025-10 | AMD | Semiconductors | 2025-12-22 | group_top5_2w_drop | -17.4% | -1.9% |
| 2025-10 | WDC | Electronic Components | 2026-04-27 | fixed_6m | 153.7% | 5.3% |
| 2025-11 | LLY | Health Care | 2026-01-26 | group_top5_2w_drop | 0.3% | 1.5% |
| 2025-11 | SNDK | Electronic Components | 2026-06-01 | fixed_6m | 737.9% | 20.6% |
| 2025-12 | BIIB | Health Care | 2026-02-02 | group_top5_2w_drop | 1.1% | 0.9% |
| 2025-12 | STX | Electronic Components | 2026-06-29 | fixed_6m | 244.9% | 16.9% |

### 50/50 + Extension Top5 Guard

| Cohort | Symbol | Sector | Sell Dates | Reasons | Return | QQQ |
|---|---|---|---|---|---:|---:|
| 2025-07 | GE | Industrials | 2026-02-02, 2026-02-02 | half_fixed_6m, half_trend_not_alive_at_6m | 14.1% | 10.5% |
| 2025-07 | TPR | Consumer Discretionary | 2026-02-02, 2026-02-09 | half_fixed_6m, half_group_top5_2w_drop | 29.5% | 8.4% |
| 2025-08 | WYNN | Consumer Discretionary | 2026-03-02, 2026-03-02 | half_fixed_6m, half_trend_not_alive_at_6m | -17.4% | 7.8% |
| 2025-08 | WDC | Electronic Components | 2026-03-02, 2026-06-29 | half_fixed_6m, half_max_12m | 464.0% | 28.6% |
| 2025-09 | WDC | Electronic Components | 2026-03-30, 2026-06-29 | half_fixed_6m, half_max_12m | 287.4% | 21.4% |
| 2025-09 | INTC | Semiconductors | 2026-03-30, 2026-03-30 | half_fixed_6m, half_trend_not_alive_at_6m | 19.3% | -6.5% |
| 2025-10 | AMD | Semiconductors | 2026-04-27, 2026-06-29 | half_fixed_6m, half_max_12m | 68.1% | 15.0% |
| 2025-10 | WDC | Electronic Components | 2026-04-27, 2026-06-29 | half_fixed_6m, half_max_12m | 233.3% | 15.0% |
| 2025-11 | LLY | Health Care | 2026-06-01, 2026-06-22 | half_fixed_6m, half_group_top5_2w_drop | 3.4% | 20.0% |
| 2025-11 | SNDK | Electronic Components | 2026-06-01, 2026-06-29 | half_fixed_6m, half_max_12m | 806.6% | 17.8% |
| 2025-12 | BIIB | Health Care | 2026-06-29, 2026-06-29 | half_fixed_6m, half_max_12m | 22.3% | 16.9% |
| 2025-12 | STX | Electronic Components | 2026-06-29, 2026-06-29 | half_fixed_6m, half_max_12m | 244.9% | 16.9% |

## Interpretation Notes

- Symbol dropout is intentionally strict: it asks whether leaving the weekly top two selected names should force a sale.
- Group Top2 dropout is less strict than symbol dropout but still reacts quickly when a sector loses the leading slot.
- Group Top5 dropout is the slower warning version: it tolerates normal sector rotation unless the group falls out of the broader leader pack.
- The extension guard tests the idea that weekly dropout should manage only the extended half after month six, not the whole position before month six.
- This still uses current universe membership and can contain survivorship and ticker-event distortions.
