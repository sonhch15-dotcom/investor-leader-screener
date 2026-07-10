# Sector Score Variant Test

Generated at: 2026-07-10T00:57:19.345Z
Period: 2021-07-09 to 2026-07-09
Mode: live
Universe source: data/universe.json

## Reproducibility Note

This run uses the stored universe and sector snapshot so A/B/C changes only the individual score formula.

- Universe source: `data/universe.json` by default.
- Fixed items: universe, sector classification, price collection method, Leader2 buy rule, six-month rolling hold test.
- Changed item: individual stock score formula only.
- Remaining limitation: prices are still re-fetched at run time. Official promotion still needs fixed price snapshots plus Cap27.5 account-level validation.

## Purpose

Compare A/B/C variants for how much sector/theme score should be included in the individual stock score before Leader2 sector selection.

## Results

| Variant | Total | CAGR | QQQ | Excess | MDD | Win Rate | Beat QQQ Months |
|---|---:|---:|---:|---:|---:|---:|---:|
| B No Sector Normalized | 919.1% | 61.7% | 96.2% | 822.9% | -22.0% | 65.5% | 60.3% |
| C Half Sector10 Normalized | 913.1% | 61.5% | 96.2% | 816.9% | -14.7% | 65.5% | 63.8% |
| A Current Sector20 | 532.5% | 46.5% | 96.2% | 436.3% | -18.0% | 63.8% | 62.1% |

## Recent Selections

### B No Sector Normalized

| As Of | Entry | Symbols | Groups |
|---|---|---|---|
| 2025-07-25 | 2025-07-28 | FIX, STX | Industrials, Electronic Components |
| 2025-08-29 | 2025-09-02 | WDC, ALAB | Electronic Components, Semiconductors |
| 2025-09-26 | 2025-09-29 | WDC, INTC | Electronic Components, Semiconductors |
| 2025-10-31 | 2025-11-03 | WDC, AMD | Electronic Components, Semiconductors |
| 2025-11-28 | 2025-12-01 | REGN, SNDK | Biotechnology, Electronic Components |
| 2025-12-26 | 2025-12-29 | STX, CHRW | Electronic Components, Industrials |
| 2026-01-30 | 2026-02-02 | MU, STX | Semiconductors, Electronic Components |
| 2026-02-27 | 2026-03-02 | TPL, SNDK | Energy, Electronic Components |
| 2026-03-27 | 2026-03-30 | OXY, WDC | Energy, Electronic Components |
| 2026-04-24 | 2026-04-27 | INTC, STX | Semiconductors, Electronic Components |
| 2026-05-29 | 2026-06-01 | MRVL, STX | Semiconductors, Electronic Components |
| 2026-06-26 | 2026-06-29 | INTC, KLAC | Semiconductors, Electronic Components |

### C Half Sector10 Normalized

| As Of | Entry | Symbols | Groups |
|---|---|---|---|
| 2025-07-25 | 2025-07-28 | FIX, STX | Industrials, Electronic Components |
| 2025-08-29 | 2025-09-02 | WYNN, WDC | Consumer Discretionary, Electronic Components |
| 2025-09-26 | 2025-09-29 | WDC, INTC | Electronic Components, Semiconductors |
| 2025-10-31 | 2025-11-03 | AMD, WDC | Semiconductors, Electronic Components |
| 2025-11-28 | 2025-12-01 | LLY, SNDK | Health Care, Electronic Components |
| 2025-12-26 | 2025-12-29 | CHRW, STX | Industrials, Electronic Components |
| 2026-01-30 | 2026-02-02 | HAL, STX | Energy, Electronic Components |
| 2026-02-27 | 2026-03-02 | TPL, SNDK | Energy, Electronic Components |
| 2026-03-27 | 2026-03-30 | OXY, WDC | Energy, Electronic Components |
| 2026-04-24 | 2026-04-27 | ARM, STX | Semiconductors, Electronic Components |
| 2026-05-29 | 2026-06-01 | MRVL, STX | Semiconductors, Electronic Components |
| 2026-06-26 | 2026-06-29 | INTC, KLAC | Semiconductors, Electronic Components |

### A Current Sector20

| As Of | Entry | Symbols | Groups |
|---|---|---|---|
| 2025-07-25 | 2025-07-28 | GE, TPR | Industrials, Consumer Discretionary |
| 2025-08-29 | 2025-09-02 | WYNN, WDC | Consumer Discretionary, Electronic Components |
| 2025-09-26 | 2025-09-29 | WDC, INTC | Electronic Components, Semiconductors |
| 2025-10-31 | 2025-11-03 | AMD, WDC | Semiconductors, Electronic Components |
| 2025-11-28 | 2025-12-01 | LLY, SNDK | Health Care, Electronic Components |
| 2025-12-26 | 2025-12-29 | BIIB, STX | Health Care, Electronic Components |
| 2026-01-30 | 2026-02-02 | XOM, STX | Energy, Electronic Components |
| 2026-02-27 | 2026-03-02 | TPL, GNRC | Energy, Industrials |
| 2026-03-27 | 2026-03-30 | XOM, ETR | Energy, Utilities |
| 2026-04-24 | 2026-04-27 | ARM, STX | Semiconductors, Electronic Components |
| 2026-05-29 | 2026-06-01 | ARM, STX | Semiconductors, Electronic Components |
| 2026-06-26 | 2026-06-29 | DAL, KLAC | Industrials, Electronic Components |

## Interpretation Guide

- A Current Sector20: current official individual score style, including full sector/theme score.
- B No Sector Normalized: removes sector/theme from the individual score and rescales the remaining score to 100.
- C Half Sector10 Normalized: includes half of sector/theme score and rescales to 100.
- This test compares the selection engine only. Cap27.5 sizing and the final half-sell plus weekly-extension account simulation must be validated separately.
