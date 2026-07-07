# Weekly Exit Rule Test

Generated at: 2026-07-07T16:14:49.545Z
Source strategy: Leader2 One Each
Source file: data\monthly-buy-rule-test-5y.json
Baseline hold: 6 months
Max extended hold: 12 months

## Trade-Level Summary

| Rule | Trades | Extended | Avg Hold Days | Avg Return | Median | Win Rate | Avg QQQ | Excess QQQ |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Fixed 6M Exit | 106 | 0.0% | 125.3 | 28.1% | 11.8% | 75.5% | 7.6% | 20.5% |
| Extend 10W+RSI Max12 | 106 | 52.8% | 151.1 | 56.1% | 11.4% | 73.6% | 9.1% | 47.1% |
| Extend 10W Only Max12 | 106 | 65.1% | 154.7 | 55.6% | 10.3% | 72.6% | 8.8% | 46.8% |

## Portfolio Proxy Summary

Monthly proxy curve uses equal weight across active positions each month. It is for rule comparison, not an exact account statement.

| Rule | Months | Total | CAGR | QQQ Total | Excess QQQ | MDD | Avg Active |
|---|---:|---:|---:|---:|---:|---:|---:|
| Fixed 6M Exit | 58 | 742.9% | 55.4% | 96.2% | 646.7% | -17.8% | 11.0 |
| Extend 10W+RSI Max12 | 58 | 876.8% | 60.3% | 96.2% | 780.6% | -16.1% | 13.6 |
| Extend 10W Only Max12 | 58 | 834.1% | 58.8% | 96.2% | 737.9% | -15.8% | 13.9 |

## Robust Check

Extreme individual returns above +300% or below -300% are excluded here.

| Rule | Trades | Avg Return | Median | Win Rate | Excess QQQ |
|---|---:|---:|---:|---:|---:|
| Fixed 6M Exit | 105 | 21.4% | 11.5% | 75.2% | 13.9% |
| Extend 10W+RSI Max12 | 99 | 19.4% | 9.2% | 71.7% | 11.6% |
| Extend 10W Only Max12 | 99 | 18.8% | 8.6% | 70.7% | 11.3% |

## Exit Reasons

| Rule | Reasons |
|---|---|
| Fixed 6M Exit | fixed_6m: 106 |
| Extend 10W+RSI Max12 | two_week_10w_break: 45, trend_not_alive_at_6m: 48, max_12m: 13 |
| Extend 10W Only Max12 | two_week_10w_break: 58, trend_not_alive_at_6m: 35, max_12m: 13 |

## Recent Trades

### Fixed 6M Exit

| Cohort | Symbol | Entry | Fixed Exit | Actual Exit | Reason | Hold Days | Return | QQQ |
|---|---|---:|---:|---:|---|---:|---:|---:|
| 2025-07 | GE | 2025-07-28 | 2026-02-02 | 2026-02-02 | fixed_6m | 130 | 14.1% | 10.5% |
| 2025-07 | TPR | 2025-07-28 | 2026-02-02 | 2026-02-02 | fixed_6m | 130 | 18.1% | 10.5% |
| 2025-08 | WYNN | 2025-09-02 | 2026-03-02 | 2026-03-02 | fixed_6m | 124 | -17.4% | 7.8% |
| 2025-08 | WDC | 2025-09-02 | 2026-03-02 | 2026-03-02 | fixed_6m | 124 | 230.2% | 7.8% |
| 2025-09 | WDC | 2025-09-29 | 2026-03-30 | 2026-03-30 | fixed_6m | 125 | 115.7% | -6.5% |
| 2025-09 | INTC | 2025-09-29 | 2026-03-30 | 2026-03-30 | fixed_6m | 125 | 19.3% | -6.5% |
| 2025-10 | AMD | 2025-11-03 | 2026-04-27 | 2026-04-27 | fixed_6m | 119 | 28.7% | 5.3% |
| 2025-10 | WDC | 2025-11-03 | 2026-04-27 | 2026-04-27 | fixed_6m | 119 | 153.7% | 5.3% |
| 2025-11 | LLY | 2025-12-01 | 2026-06-01 | 2026-06-01 | fixed_6m | 124 | 2.5% | 20.6% |
| 2025-11 | SNDK | 2025-12-01 | 2026-06-01 | 2026-06-01 | fixed_6m | 124 | 737.9% | 20.6% |
| 2025-12 | BIIB | 2025-12-29 | 2026-06-29 | 2026-06-29 | fixed_6m | 124 | 22.3% | 16.9% |
| 2025-12 | STX | 2025-12-29 | 2026-06-29 | 2026-06-29 | fixed_6m | 124 | 244.9% | 16.9% |

### Extend 10W+RSI Max12

| Cohort | Symbol | Entry | Fixed Exit | Actual Exit | Reason | Hold Days | Return | QQQ |
|---|---|---:|---:|---:|---|---:|---:|---:|
| 2025-07 | GE | 2025-07-28 | 2026-02-02 | 2026-02-02 | trend_not_alive_at_6m | 130 | 14.1% | 10.5% |
| 2025-07 | TPR | 2025-07-28 | 2026-02-02 | 2026-03-20 | two_week_10w_break | 163 | 28.7% | 2.7% |
| 2025-08 | WYNN | 2025-09-02 | 2026-03-02 | 2026-03-02 | trend_not_alive_at_6m | 124 | -17.4% | 7.8% |
| 2025-08 | WDC | 2025-09-02 | 2026-03-02 | 2026-06-29 | max_12m | 206 | 697.8% | 28.6% |
| 2025-09 | WDC | 2025-09-29 | 2026-03-30 | 2026-06-29 | max_12m | 187 | 459.1% | 21.4% |
| 2025-09 | INTC | 2025-09-29 | 2026-03-30 | 2026-03-30 | trend_not_alive_at_6m | 125 | 19.3% | -6.5% |
| 2025-10 | AMD | 2025-11-03 | 2026-04-27 | 2026-06-29 | max_12m | 162 | 107.6% | 15.0% |
| 2025-10 | WDC | 2025-11-03 | 2026-04-27 | 2026-06-29 | max_12m | 162 | 313.0% | 15.0% |
| 2025-11 | LLY | 2025-12-01 | 2026-06-01 | 2026-06-29 | max_12m | 143 | 16.5% | 17.8% |
| 2025-11 | SNDK | 2025-12-01 | 2026-06-01 | 2026-06-29 | max_12m | 143 | 875.4% | 17.8% |
| 2025-12 | BIIB | 2025-12-29 | 2026-06-29 | 2026-06-29 | max_12m | 124 | 22.3% | 16.9% |
| 2025-12 | STX | 2025-12-29 | 2026-06-29 | 2026-06-29 | max_12m | 124 | 244.9% | 16.9% |

### Extend 10W Only Max12

| Cohort | Symbol | Entry | Fixed Exit | Actual Exit | Reason | Hold Days | Return | QQQ |
|---|---|---:|---:|---:|---|---:|---:|---:|
| 2025-07 | GE | 2025-07-28 | 2026-02-02 | 2026-02-02 | trend_not_alive_at_6m | 130 | 14.1% | 10.5% |
| 2025-07 | TPR | 2025-07-28 | 2026-02-02 | 2026-03-20 | two_week_10w_break | 163 | 28.7% | 2.7% |
| 2025-08 | WYNN | 2025-09-02 | 2026-03-02 | 2026-03-02 | trend_not_alive_at_6m | 124 | -17.4% | 7.8% |
| 2025-08 | WDC | 2025-09-02 | 2026-03-02 | 2026-06-29 | max_12m | 206 | 697.8% | 28.6% |
| 2025-09 | WDC | 2025-09-29 | 2026-03-30 | 2026-06-29 | max_12m | 187 | 459.1% | 21.4% |
| 2025-09 | INTC | 2025-09-29 | 2026-03-30 | 2026-03-30 | trend_not_alive_at_6m | 125 | 19.3% | -6.5% |
| 2025-10 | AMD | 2025-11-03 | 2026-04-27 | 2026-06-29 | max_12m | 162 | 107.6% | 15.0% |
| 2025-10 | WDC | 2025-11-03 | 2026-04-27 | 2026-06-29 | max_12m | 162 | 313.0% | 15.0% |
| 2025-11 | LLY | 2025-12-01 | 2026-06-01 | 2026-06-29 | max_12m | 143 | 16.5% | 17.8% |
| 2025-11 | SNDK | 2025-12-01 | 2026-06-01 | 2026-06-29 | max_12m | 143 | 875.4% | 17.8% |
| 2025-12 | BIIB | 2025-12-29 | 2026-06-29 | 2026-06-29 | max_12m | 124 | 22.3% | 16.9% |
| 2025-12 | STX | 2025-12-29 | 2026-06-29 | 2026-06-29 | max_12m | 124 | 244.9% | 16.9% |

## Notes

- The tested extension rule does not try to predict the exact top.
- It only asks whether a leader that is still above its weekly trend at month 6 should be held longer.
- Weekly 10-week moving average breaks are slower than daily stops, so they can give back gains before exiting.
- This test still uses current universe membership and can contain ticker-event distortions.
