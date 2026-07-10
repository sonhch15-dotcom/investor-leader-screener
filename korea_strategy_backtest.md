# Korea Strategy Backtest

Generated: 2026-07-10T03:16:53.783Z
As of: 2026-07-10

## Caveat

- This is a first-pass Korea universe test using current blue-chip stocks and major ETFs. It can contain survivorship bias.
- Costs, taxes, dividend withholding, pension account restrictions, and live execution slippage are not fully modeled.

## Summary

| Strategy | Trades | Realized | Open | Avg Return | Benchmark | Excess | Win Rate | Portfolio Curve | MDD | 10M Account | Account MDD | Skips |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 한국 우량주 Leader2 | 100 | 83 | 17 | +48.1% | +24.3% | +23.8% | +73.5% | +1852.1% | -34.2% | +397.0% | -15.6% | 22 |
| KR ETF Benchmark Or Alpha | 50 | 0 | 1 | +385.6% | +216.7% | +169.0% | - | +385.6% | -19.3% | +385.6% | -19.3% | 0 |

## 10M KRW Account Assumptions

- Initial capital: 10,000,000 KRW.
- Fractional shares are allowed, so high-priced Korean stocks can be bought by amount.
- First 3 months: deploy up to 30% of initial capital per month, split equally across that month's picks.
- After month 3: deploy up to 15% of initial capital per month, split equally across that month's picks.
- Per-symbol original-cost cap: 22.5% of initial capital.
- Sells follow the existing rule: sell 50% after 6 months, keep/sell the rest by weekly trend.

## Current Picks

### 한국 우량주 Leader2
- 009150.KS 삼성전기 / 전자부품: score 89.21, 1M -11.7%, 3M +210.1%, 6M +490.4%
- 000660.KS SK하이닉스 / 반도체: score 88.55, 1M +5.3%, 3M +114.3%, 6M +218.6%

### KR ETF Benchmark Or Alpha
- 395160.KS KODEX 시스템반도체 / 반도체: score 77.69, 1M -2.0%, 3M +67.1%, 6M +138.8%