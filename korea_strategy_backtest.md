# Korea Strategy Backtest

Generated: 2026-07-10T04:02:59.514Z
As of: 2026-07-10

## Caveat

- This is a first-pass Korea universe test using current blue-chip stocks and major ETFs. It can contain survivorship bias.
- Costs, taxes, dividend withholding, pension account restrictions, and live execution slippage are not fully modeled.

## Summary

| Strategy | Trades | Realized | Open | Avg Return | Benchmark | Excess | Win Rate | Portfolio Curve | MDD | 10M Account | Account MDD | Skips |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 한국 우량주 Leader2 | 100 | 83 | 17 | +48.1% | +24.3% | +23.8% | +73.5% | +1862.6% | -34.2% | +398.2% | -15.6% | 22 |
| KR ETF Benchmark Or Alpha | 50 | 0 | 1 | +390.0% | +218.8% | +171.2% | - | +390.0% | -19.3% | +390.0% | -19.3% | 0 |

## 10M KRW Account Assumptions

- Initial capital: 10,000,000 KRW.
- Fractional shares are allowed, so high-priced Korean stocks can be bought by amount.
- First 3 months: deploy up to 30% of initial capital per month, split equally across that month's picks.
- After month 3: deploy up to 15% of initial capital per month, split equally across that month's picks.
- Per-symbol original-cost cap: 22.5% of initial capital.
- Sells follow the existing rule: sell 50% after 6 months, keep/sell the rest by weekly trend.

## Current Picks

### 한국 우량주 Leader2
- 009150.KS 삼성전기 / 전자부품: score 89.21, 1M -11.3%, 3M +211.7%, 6M +493.3%
- 000660.KS SK하이닉스 / 반도체: score 88.55, 1M +6.5%, 3M +116.7%, 6M +222.2%

### KR ETF Benchmark Or Alpha
- 395160.KS KODEX 시스템반도체 / 반도체: score 87.69, 1M -1.1%, 3M +68.6%, 6M +140.9%