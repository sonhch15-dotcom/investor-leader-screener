# Korea Strategy Backtest

Generated: 2026-07-10T03:02:48.098Z
As of: 2026-07-10

## Caveat

- This is a first-pass Korea universe test using current blue-chip stocks and major ETFs. It can contain survivorship bias.
- Costs, taxes, dividend withholding, pension account restrictions, and live execution slippage are not fully modeled.

## Summary

| Strategy | Trades | Realized | Open | Avg Return | Benchmark | Excess | Win Rate | Portfolio Curve | MDD | 10M Account | Account MDD | Skips |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 한국 우량주 Leader2 | 100 | 83 | 17 | +48.1% | +24.3% | +23.8% | +73.5% | +1849.8% | -34.2% | +396.7% | -15.6% | 22 |
| KR ETF Core Satellite 50/40/10 | 50 | 0 | 3 | +179.1% | +216.2% | -37.1% | - | +179.1% | -16.0% | +179.1% | -16.0% | 0 |

## 10M KRW Account Assumptions

- Initial capital: 10,000,000 KRW.
- Fractional shares are allowed, so high-priced Korean stocks can be bought by amount.
- First 3 months: deploy up to 30% of initial capital per month, split equally across that month's picks.
- After month 3: deploy up to 15% of initial capital per month, split equally across that month's picks.
- Per-symbol original-cost cap: 22.5% of initial capital.
- Sells follow the existing rule: sell 50% after 6 months, keep/sell the rest by weekly trend.

## Current Picks

### 한국 우량주 Leader2
- 009150.KS 삼성전기 / 전자부품: score 89.21, 1M -12.1%, 3M +208.8%, 6M +487.8%
- 000660.KS SK하이닉스 / 반도체: score 88.55, 1M +5.4%, 3M +114.5%, 6M +218.9%

### KR ETF Core Satellite 50/40/10
- 379800.KS KODEX 미국S&P500TR / 미국 대표지수: score 78.67, 1M +1.7%, 3M +13.8%, 6M +14.9%
- 091170.KS KODEX 은행 / 금융: score 77.85, 1M +12.9%, 3M +8.6%, 6M +32.6%
- 458730.KS TIGER 미국배당다우존스 / 미국 배당: score 67.89, 1M -0.8%, 3M +7.3%, 6M +21.9%