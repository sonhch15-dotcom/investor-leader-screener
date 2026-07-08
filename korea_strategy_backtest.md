# Korea Strategy Backtest

Generated: 2026-07-08T10:33:05.797Z
As of: 2026-07-08

## Caveat

- This is a first-pass Korea universe test using current blue-chip stocks and major ETFs. It can contain survivorship bias.
- Costs, taxes, dividend withholding, pension account restrictions, and live execution slippage are not fully modeled.

## Summary

| Strategy | Trades | Realized | Open | Avg Return | Benchmark | Excess | Win Rate | Portfolio Curve | MDD | 10M Account | Account MDD | Skips |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 한국 우량주 Leader2 | 100 | 83 | 17 | +48.1% | +24.3% | +23.8% | +73.5% | +1755.3% | -34.2% | +386.4% | -15.6% | 22 |
| KR ETF Core Satellite 50/40/10 | 50 | 0 | 3 | +168.4% | +202.1% | -33.7% | - | +168.4% | -16.0% | +168.4% | -16.0% | 0 |

## 10M KRW Account Assumptions

- Initial capital: 10,000,000 KRW.
- Fractional shares are allowed, so high-priced Korean stocks can be bought by amount.
- First 3 months: deploy up to 30% of initial capital per month, split equally across that month's picks.
- After month 3: deploy up to 15% of initial capital per month, split equally across that month's picks.
- Per-symbol original-cost cap: 22.5% of initial capital.
- Sells follow the existing rule: sell 50% after 6 months, keep/sell the rest by weekly trend.

## Current Picks

### 한국 우량주 Leader2
- 009150.KS 삼성전기 / 전자부품: score 79.21, 1M -24.9%, 3M +220.1%, 6M +480.0%
- 000660.KS SK하이닉스 / 반도체: score 78.55, 1M -6.3%, 3M +134.3%, 6M +219.5%

### KR ETF Core Satellite 50/40/10
- 360750.KS TIGER 미국S&P500 / 미국 대표지수: score 76.78, 1M +0.2%, 3M +13.7%, 6M +13.4%
- 395160.KS KODEX 시스템반도체 / 반도체: score 77.12, 1M -14.6%, 3M +71.6%, 6M +145.5%
- 458730.KS TIGER 미국배당다우존스 / 미국 배당: score 72.35, 1M +0.4%, 3M +6.9%, 6M +23.6%