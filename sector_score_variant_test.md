# Sector Score Variant Test

Generated at: 2026-07-10T00:26:21.180Z
Period: 2021-07-09 to 2026-07-09
Mode: live

## Reproducibility Warning

이 결과는 공식 전략 변경 근거가 아니라 `Exploratory` 등급의 1차 실험입니다.

주의할 점:

- 이 테스트는 기존 `#backtest` 화면의 저장 유니버스/섹터 분류를 고정하지 않고 실행 시점에 유니버스를 다시 구성했습니다.
- 따라서 A Current Sector20은 점수 산식은 현재 방식과 같지만, 기존 공식 백테스트와 같은 입력 조건으로 실행된 결과가 아닙니다.
- 기존 공식 백테스트와 직접 비교하면 안 됩니다.
- 공식 비교를 하려면 동일 유니버스, 동일 섹터 분류, 동일 가격 데이터, 동일 매매 규칙을 고정한 뒤 A/B/C 산식만 바꿔 다시 검증해야 합니다.

## Purpose

개별 종목 점수 안에 섹터/테마 점수를 얼마나 반영할지 A/B/C로 나누어 Leader2 종목 선정력을 비교한다.

## Results

| Variant | Total | CAGR | QQQ | Excess | MDD | Win Rate | Beat QQQ Months |
|---|---:|---:|---:|---:|---:|---:|---:|
| B No Sector Normalized | 232.1% | 28.2% | 96.2% | 135.9% | -15.6% | 65.5% | 55.2% |
| C Half Sector10 Normalized | 153.1% | 21.2% | 96.2% | 56.9% | -22.9% | 55.2% | 55.2% |
| A Current Sector20 | 100.4% | 15.5% | 96.2% | 4.1% | -24.4% | 58.6% | 55.2% |

## Recent Selections

### B No Sector Normalized

| As Of | Entry | Symbols | Groups |
|---|---|---|---|
| 2025-07-25 | 2025-07-28 | TEL, FIX | Information Technology, Industrials |
| 2025-08-29 | 2025-09-02 | LITE, WYNN | Information Technology, Consumer Discretionary |
| 2025-09-26 | 2025-09-29 | APP, WBD | Information Technology, Communication Services |
| 2025-10-31 | 2025-11-03 | FSLR, CAH | Information Technology, Health Care |
| 2025-11-28 | 2025-12-01 | CIEN, REGN | Information Technology, Health Care |
| 2025-12-26 | 2025-12-29 | MU, CHRW | Information Technology, Industrials |
| 2026-01-30 | 2026-02-02 | LUV, HAL | Industrials, Energy |
| 2026-02-27 | 2026-03-02 | TPL, GNRC | Energy, Industrials |
| 2026-03-27 | 2026-03-30 | OXY, DOW | Energy, Materials |
| 2026-04-24 | 2026-04-27 | INTC, GEV | Information Technology, Industrials |
| 2026-05-29 | 2026-06-01 | DELL, DVA | Information Technology, Health Care |
| 2026-06-26 | 2026-06-29 | FTNT, CNC | Information Technology, Health Care |

### C Half Sector10 Normalized

| As Of | Entry | Symbols | Groups |
|---|---|---|---|
| 2025-07-25 | 2025-07-28 | FIX, TPR | Industrials, Consumer Discretionary |
| 2025-08-29 | 2025-09-02 | ECHO, WYNN | Communication Services, Consumer Discretionary |
| 2025-09-26 | 2025-09-29 | GOOGL, APP | Communication Services, Information Technology |
| 2025-10-31 | 2025-11-03 | FIX, AMD | Industrials, Information Technology |
| 2025-11-28 | 2025-12-01 | LLY, GOOGL | Health Care, Communication Services |
| 2025-12-26 | 2025-12-29 | C, CHRW | Financials, Industrials |
| 2026-01-30 | 2026-02-02 | HAL, LUV | Energy, Industrials |
| 2026-02-27 | 2026-03-02 | TPL, GNRC | Energy, Industrials |
| 2026-03-27 | 2026-03-30 | OXY, ETR | Energy, Utilities |
| 2026-04-24 | 2026-04-27 | GEV, INTC | Industrials, Information Technology |
| 2026-05-29 | 2026-06-01 | DELL, F | Information Technology, Consumer Discretionary |
| 2026-06-26 | 2026-06-29 | CNC, DAL | Health Care, Industrials |

### A Current Sector20

| As Of | Entry | Symbols | Groups |
|---|---|---|---|
| 2025-07-25 | 2025-07-28 | GE, TPR | Industrials, Consumer Discretionary |
| 2025-08-29 | 2025-09-02 | ECHO, WYNN | Communication Services, Consumer Discretionary |
| 2025-09-26 | 2025-09-29 | GOOGL, APP | Communication Services, Information Technology |
| 2025-10-31 | 2025-11-03 | FIX, AMD | Industrials, Information Technology |
| 2025-11-28 | 2025-12-01 | LLY, EXE | Health Care, Energy |
| 2025-12-26 | 2025-12-29 | C, BIIB | Financials, Health Care |
| 2026-01-30 | 2026-02-02 | XOM, FCX | Energy, Materials |
| 2026-02-27 | 2026-03-02 | TPL, GNRC | Energy, Industrials |
| 2026-03-27 | 2026-03-30 | XOM, ETR | Energy, Utilities |
| 2026-04-24 | 2026-04-27 | BKR, INTC | Energy, Information Technology |
| 2026-05-29 | 2026-06-01 | JBHT, DELL | Industrials, Information Technology |
| 2026-06-26 | 2026-06-29 | DAL, CNC | Industrials, Health Care |

## Interpretation Guide

- A Current Sector20: 현재 공식 방식이다. 개별 종목 점수에 섹터/테마 20점을 그대로 포함한다.
- B No Sector Normalized: 섹터/테마 점수를 제거하고 나머지 점수를 100점으로 환산한다. 섹터 중복 반영을 가장 강하게 제거한다.
- C Half Sector10 Normalized: 섹터/테마를 절반만 반영한다. 현재 방식과 완전 분리 방식의 절충안이다.
- 이 테스트는 종목 선정 엔진 비교용이다. Cap27.5 자금배분, 6개월 50% 매도 + 주봉 연장 매도까지 포함한 최종 계좌 검증은 별도 단계에서 다시 확인해야 한다.
