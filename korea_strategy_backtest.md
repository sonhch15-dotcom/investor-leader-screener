# Korea Strategy Backtest

Generated: 2026-07-10T02:43:43.255Z
As of: 2026-07-10

## Caveat

- This is a first-pass Korea universe test using current blue-chip stocks and major ETFs. It can contain survivorship bias.
- Costs, taxes, dividend withholding, pension account restrictions, and live execution slippage are not fully modeled.

## Summary

| Strategy | Trades | Realized | Open | Avg Return | Benchmark | Excess | Win Rate | Portfolio Curve | MDD | 10M Account | Account MDD | Skips |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 한국 우량주 Leader2 | 100 | 83 | 17 | +48.1% | +24.3% | +23.8% | +73.5% | +1834.7% | -34.2% | +395.6% | -15.6% | 22 |
| KR ETF Core Satellite 50/40/10 | 50 | 0 | 3 | +177.7% | +213.5% | -35.8% | - | +177.7% | -16.0% | +177.7% | -16.0% | 0 |

## 10M KRW Account Assumptions

- Initial capital: 10,000,000 KRW.
- Fractional shares are allowed, so high-priced Korean stocks can be bought by amount.
- First 3 months: deploy up to 30% of initial capital per month, split equally across that month's picks.
- After month 3: deploy up to 15% of initial capital per month, split equally across that month's picks.
- Per-symbol original-cost cap: 22.5% of initial capital.
- Sells follow the existing rule: sell 50% after 6 months, keep/sell the rest by weekly trend.

## Current Picks

### 한국 우량주 Leader2
- 009150.KS 삼성전기 / 전자부품: score 79.21, 1M -12.6%, 3M +207.0%, 6M +484.4%
- 000660.KS SK하이닉스 / 반도체: score 88.55, 1M +4.7%, 3M +112.9%, 6M +216.6%

### KR ETF Core Satellite 50/40/10
- 379800.KS KODEX 미국S&P500TR / 미국 대표지수: score 78.61, 1M +1.6%, 3M +13.6%, 6M +14.8%
- 395160.KS KODEX 시스템반도체 / 반도체: score 77.69, 1M -3.0%, 3M +65.3%, 6M +136.3%
- 458730.KS TIGER 미국배당다우존스 / 미국 배당: score 67.85, 1M -0.9%, 3M +7.2%, 6M +21.8%