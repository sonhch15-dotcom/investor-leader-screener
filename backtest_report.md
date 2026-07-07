# Backtest Report

Generated at: 2026-07-07T05:42:33.849Z
As-of date: 2025-07-06
Entry rule: first trading day after as-of date
Exit date: 2026-07-06

## Summary

- Universe size: 551
- Scored candidates: 548
- Selected top N: 10
- Average return to latest: 33.2%
- SPY return: 22.4%
- QQQ return: 31.6%

## Horizon Returns

| Horizon | Average Top N |
|---|---:|
| 1m | 2.2% |
| 3m | 13.0% |
| 6m | 12.4% |
| 12m | 33.2% |

## Selected Candidates

| Symbol | Status | Score | Setup | Entry | Latest Return | 1M | 3M | 6M | 12M | Notes |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|---|
| HWM | review | 85.65 | pullback_reacceleration | 179.84 | 54.5% | 1.0% | 5.8% | 19.3% | 54.5% | 시장 대비 상대강도 우수; 가격 모멘텀 강함; 거래량/수급 양호; Warning: 2R 수동 확인 필요 |
| NTRS | strong_watch | 84.72 | none | 125.65 | 44.2% | -2.2% | 3.5% | 13.5% | 44.2% | 시장 대비 상대강도 우수; 가격 모멘텀 강함; 거래량/수급 양호 |
| RCL | strong_watch | 84.48 | none | 325 | -11.5% | -4.5% | -3.2% | -8.9% | -11.5% | 시장 대비 상대강도 우수; 가격 모멘텀 강함; 거래량/수급 양호 |
| COIN | strong_watch | 84.38 | none | 357.1 | -52.7% | -15.0% | 8.1% | -29.8% | -52.7% | 시장 대비 상대강도 우수; 거래량/수급 양호 |
| HOOD | strong_watch | 82.65 | none | 93.46 | 25.8% | 13.0% | 54.4% | 30.2% | 25.8% | 시장 대비 상대강도 우수; 가격 모멘텀 강함; 거래량/수급 양호 |
| UBER | review | 82.08 | pullback_reacceleration | 96.68 | -25.1% | -7.7% | 3.5% | -11.5% | -25.1% | 시장 대비 상대강도 우수; 가격 모멘텀 강함; Warning: 2R 수동 확인 필요 |
| GS | review | 81.82 | pullback_reacceleration | 699.97 | 50.8% | 1.9% | 12.7% | 35.8% | 50.8% | 시장 대비 상대강도 우수; 가격 모멘텀 강함; 거래량/수급 양호; Warning: 2R 수동 확인 필요 |
| GE | strong_watch | 81.81 | none | 247.39 | 53.1% | 9.5% | 20.1% | 32.0% | 53.1% | 시장 대비 상대강도 우수; 거래량/수급 양호 |
| GEV | review | 81.81 | pullback_reacceleration | 528.85 | 117.8% | 25.4% | 13.8% | 29.6% | 117.8% | 시장 대비 상대강도 우수; 가격 모멘텀 강함; Warning: 2R 수동 확인 필요 |
| PWR | review | 81.28 | pullback_reacceleration | 385.47 | 74.9% | 0.4% | 10.9% | 13.6% | 74.9% | 시장 대비 상대강도 우수; 가격 모멘텀 강함; Warning: 2R 수동 확인 필요 |

## Important Limitations

- This is a historical stock-selection test, not a full trade execution backtest.
- It uses the current S&P 500/Nasdaq 100 universe, so survivorship bias exists.
- It assumes buying the first trading day after the as-of date.
- It does not include taxes, commissions, slippage, FX, or position sizing.
- Intraday 1H/4H timing is not included yet.
