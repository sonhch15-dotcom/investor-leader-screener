# Korea Strategy Backtest

Generated: 2026-07-08T07:53:17.671Z
As of: 2026-07-08

## Caveat

- This is a first-pass Korea universe test using current blue-chip stocks and major ETFs. It can contain survivorship bias.
- Costs, taxes, dividend withholding, pension account restrictions, and live execution slippage are not fully modeled.

## Summary

| Strategy | Trades | Realized | Open | Avg Return | Benchmark | Excess | Win Rate | Portfolio Curve | MDD | 10M Account | Account MDD | Skips |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 한국 우량주 Leader2 | 100 | 83 | 17 | +48.1% | +24.3% | +23.8% | +73.5% | +1755.3% | -34.2% | +386.4% | -15.6% | 22 |
| 한국 ETF Rotation3 | 148 | 122 | 26 | +12.4% | +20.6% | -8.2% | +72.1% | +125.7% | -15.7% | +123.0% | -14.3% | 10 |
| KR Stock Market Filter | 60 | 43 | 17 | +42.6% | +27.8% | +14.8% | +69.8% | +861.7% | -33.8% | +268.6% | -21.1% | 13 |
| KR Stock No Repeat | 100 | 85 | 15 | +31.0% | +28.9% | +2.1% | +68.2% | +719.0% | -23.8% | +273.8% | -20.1% | 7 |
| KR Stock Overheat Filter | 100 | 83 | 17 | +44.0% | +24.3% | +19.8% | +72.3% | +1712.6% | -36.1% | +357.0% | -21.8% | 17 |
| KR Stock Pullback Entry | 85 | 73 | 12 | +47.7% | +26.8% | +20.9% | +74.0% | +1930.3% | -33.3% | +363.5% | -19.1% | 15 |
| KR Stock KOSPI Only | 100 | 83 | 17 | +39.8% | +25.3% | +14.5% | +72.3% | +1362.7% | -26.0% | +323.7% | -15.4% | 19 |
| KR Stock Top Score2 | 100 | 82 | 18 | +48.1% | +23.1% | +24.9% | +68.3% | +1715.8% | -38.9% | +352.6% | -19.8% | 20 |
| KR ETF Defensive Rotation | 148 | 122 | 26 | +11.4% | +20.5% | -9.1% | +74.6% | +111.6% | -15.7% | +118.1% | -14.2% | 13 |
| KR ETF No Repeat | 104 | 83 | 21 | +12.3% | +18.7% | -6.4% | +73.5% | +146.2% | -11.3% | +111.4% | -9.4% | 1 |
| KR ETF Pullback Entry | 140 | 120 | 20 | +11.4% | +20.3% | -8.9% | +73.3% | +119.7% | -14.9% | +105.7% | -14.5% | 13 |
| KR ETF Top2 Concentrated | 100 | 81 | 19 | +11.0% | +21.1% | -10.1% | +71.6% | +159.4% | -16.7% | +122.7% | -14.1% | 15 |
| KR ETF Top4 Diversified | 194 | 161 | 33 | +12.8% | +20.1% | -7.3% | +72.0% | +119.5% | -15.3% | +116.8% | -13.9% | 16 |
| KR ETF Rebalance Top2 | 50 | 0 | 2 | +89.9% | +158.9% | -69.0% | - | +89.9% | -28.2% | +89.9% | -28.2% | 0 |
| KR ETF Rebalance Top3 | 50 | 0 | 3 | +126.8% | +158.9% | -32.1% | - | +126.8% | -17.6% | +126.8% | -17.6% | 0 |
| KR ETF Absolute Momentum | 50 | 0 | 3 | +119.8% | +158.9% | -39.0% | - | +119.8% | -19.2% | +119.8% | -19.2% | 0 |
| KR ETF Core Satellite | 50 | 0 | 3 | +151.2% | +158.9% | -7.7% | - | +151.2% | -14.0% | +151.2% | -14.0% | 0 |
| KR ETF Core Satellite 60/30/10 | 50 | 0 | 3 | +165.8% | +158.9% | +6.9% | - | +165.8% | -14.4% | +165.8% | -14.4% | 0 |
| KR ETF Core Satellite 50/40/10 | 50 | 0 | 3 | +168.4% | +158.9% | +9.6% | - | +168.4% | -16.0% | +168.4% | -16.0% | 0 |
| KR ETF Core Satellite 70/20/10 | 50 | 0 | 3 | +161.9% | +158.9% | +3.0% | - | +161.9% | -12.9% | +161.9% | -12.9% | 0 |
| KR ETF Core Satellite 40/40/20 | 50 | 0 | 3 | +153.5% | +158.9% | -5.3% | - | +153.5% | -15.7% | +153.5% | -15.7% | 0 |
| KR ETF Risk Managed | 50 | 0 | 3 | +117.3% | +158.9% | -41.6% | - | +117.3% | -17.6% | +117.3% | -17.6% | 0 |

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

### 한국 ETF Rotation3
- 395160.KS KODEX 시스템반도체 / 반도체: score 77.12, 1M -14.6%, 3M +71.6%, 6M +145.5%
- 360750.KS TIGER 미국S&P500 / 미국 대표지수: score 76.78, 1M +0.2%, 3M +13.7%, 6M +13.4%
- 102110.KS TIGER 200 / 국내 대형주: score 72.62, 1M -10.1%, 3M +44.0%, 6M +93.5%

### KR Stock Market Filter
- 009150.KS 삼성전기 / 전자부품: score 79.21, 1M -24.9%, 3M +220.1%, 6M +480.0%
- 000660.KS SK하이닉스 / 반도체: score 78.55, 1M -6.3%, 3M +134.3%, 6M +219.5%

### KR Stock No Repeat
- 086790.KS 하나금융지주 / 금융: score 77.15, 1M +2.8%, 3M +9.8%, 6M +32.6%
- 005380.KS 현대차 / 자동차: score 62.89, 1M -27.6%, 3M -1.0%, 6M +57.3%

### KR Stock Overheat Filter
- 009150.KS 삼성전기 / 전자부품: score 79.21, 1M -24.9%, 3M +220.1%, 6M +480.0%
- 000660.KS SK하이닉스 / 반도체: score 78.55, 1M -6.3%, 3M +134.3%, 6M +219.5%

### KR Stock Pullback Entry
- 009150.KS 삼성전기 / 전자부품: score 79.21, 1M -24.9%, 3M +220.1%, 6M +480.0%
- 000660.KS SK하이닉스 / 반도체: score 78.55, 1M -6.3%, 3M +134.3%, 6M +219.5%

### KR Stock KOSPI Only
- 009150.KS 삼성전기 / 전자부품: score 79.09, 1M -24.9%, 3M +220.1%, 6M +480.0%
- 000660.KS SK하이닉스 / 반도체: score 78.33, 1M -6.3%, 3M +134.3%, 6M +219.5%

### KR Stock Top Score2
- 105560.KS KB금융 / 금융: score 85.86, 1M +10.5%, 3M +16.5%, 6M +39.5%
- 055550.KS 신한지주 / 금융: score 83.27, 1M +6.0%, 3M +16.4%, 6M +41.8%

### KR ETF Defensive Rotation
- 395160.KS KODEX 시스템반도체 / 반도체: score 77.12, 1M -14.6%, 3M +71.6%, 6M +145.5%
- 360750.KS TIGER 미국S&P500 / 미국 대표지수: score 76.78, 1M +0.2%, 3M +13.7%, 6M +13.4%
- 102110.KS TIGER 200 / 국내 대형주: score 72.62, 1M -10.1%, 3M +44.0%, 6M +93.5%

### KR ETF No Repeat
- 102970.KS KODEX 증권 / 금융: score 48.27, 1M -9.4%, 3M -13.9%, 6M +43.9%
- 117700.KS KODEX 건설 / 건설/인프라: score 35.96, 1M -14.9%, 3M -20.4%, 6M +44.6%

### KR ETF Pullback Entry
- 395160.KS KODEX 시스템반도체 / 반도체: score 77.12, 1M -14.6%, 3M +71.6%, 6M +145.5%
- 360750.KS TIGER 미국S&P500 / 미국 대표지수: score 76.78, 1M +0.2%, 3M +13.7%, 6M +13.4%
- 102110.KS TIGER 200 / 국내 대형주: score 72.62, 1M -10.1%, 3M +44.0%, 6M +93.5%

### KR ETF Top2 Concentrated
- 395160.KS KODEX 시스템반도체 / 반도체: score 77.12, 1M -14.6%, 3M +71.6%, 6M +145.5%
- 360750.KS TIGER 미국S&P500 / 미국 대표지수: score 76.78, 1M +0.2%, 3M +13.7%, 6M +13.4%

### KR ETF Top4 Diversified
- 395160.KS KODEX 시스템반도체 / 반도체: score 77.12, 1M -14.6%, 3M +71.6%, 6M +145.5%
- 360750.KS TIGER 미국S&P500 / 미국 대표지수: score 76.78, 1M +0.2%, 3M +13.7%, 6M +13.4%
- 102110.KS TIGER 200 / 국내 대형주: score 72.62, 1M -10.1%, 3M +44.0%, 6M +93.5%
- 140700.KS KODEX 보험 / 금융: score 72.5, 1M -2.8%, 3M +29.3%, 6M +53.2%

### KR ETF Rebalance Top2
- 395160.KS KODEX 시스템반도체 / 반도체: score 77.12, 1M -14.6%, 3M +71.6%, 6M +145.5%
- 360750.KS TIGER 미국S&P500 / 미국 대표지수: score 76.78, 1M +0.2%, 3M +13.7%, 6M +13.4%

### KR ETF Rebalance Top3
- 395160.KS KODEX 시스템반도체 / 반도체: score 77.12, 1M -14.6%, 3M +71.6%, 6M +145.5%
- 360750.KS TIGER 미국S&P500 / 미국 대표지수: score 76.78, 1M +0.2%, 3M +13.7%, 6M +13.4%
- 102110.KS TIGER 200 / 국내 대형주: score 72.62, 1M -10.1%, 3M +44.0%, 6M +93.5%

### KR ETF Absolute Momentum
- 395160.KS KODEX 시스템반도체 / 반도체: score 77.12, 1M -14.6%, 3M +71.6%, 6M +145.5%
- 360750.KS TIGER 미국S&P500 / 미국 대표지수: score 76.78, 1M +0.2%, 3M +13.7%, 6M +13.4%
- 102110.KS TIGER 200 / 국내 대형주: score 72.62, 1M -10.1%, 3M +44.0%, 6M +93.5%

### KR ETF Core Satellite
- 360750.KS TIGER 미국S&P500 / 미국 대표지수: score 76.78, 1M +0.2%, 3M +13.7%, 6M +13.4%
- 395160.KS KODEX 시스템반도체 / 반도체: score 77.12, 1M -14.6%, 3M +71.6%, 6M +145.5%
- 458730.KS TIGER 미국배당다우존스 / 미국 배당: score 72.35, 1M +0.4%, 3M +6.9%, 6M +23.6%

### KR ETF Core Satellite 60/30/10
- 360750.KS TIGER 미국S&P500 / 미국 대표지수: score 76.78, 1M +0.2%, 3M +13.7%, 6M +13.4%
- 395160.KS KODEX 시스템반도체 / 반도체: score 77.12, 1M -14.6%, 3M +71.6%, 6M +145.5%
- 458730.KS TIGER 미국배당다우존스 / 미국 배당: score 72.35, 1M +0.4%, 3M +6.9%, 6M +23.6%

### KR ETF Core Satellite 50/40/10
- 360750.KS TIGER 미국S&P500 / 미국 대표지수: score 76.78, 1M +0.2%, 3M +13.7%, 6M +13.4%
- 395160.KS KODEX 시스템반도체 / 반도체: score 77.12, 1M -14.6%, 3M +71.6%, 6M +145.5%
- 458730.KS TIGER 미국배당다우존스 / 미국 배당: score 72.35, 1M +0.4%, 3M +6.9%, 6M +23.6%

### KR ETF Core Satellite 70/20/10
- 360750.KS TIGER 미국S&P500 / 미국 대표지수: score 76.78, 1M +0.2%, 3M +13.7%, 6M +13.4%
- 395160.KS KODEX 시스템반도체 / 반도체: score 77.12, 1M -14.6%, 3M +71.6%, 6M +145.5%
- 458730.KS TIGER 미국배당다우존스 / 미국 배당: score 72.35, 1M +0.4%, 3M +6.9%, 6M +23.6%

### KR ETF Core Satellite 40/40/20
- 360750.KS TIGER 미국S&P500 / 미국 대표지수: score 76.78, 1M +0.2%, 3M +13.7%, 6M +13.4%
- 395160.KS KODEX 시스템반도체 / 반도체: score 77.12, 1M -14.6%, 3M +71.6%, 6M +145.5%
- 458730.KS TIGER 미국배당다우존스 / 미국 배당: score 72.35, 1M +0.4%, 3M +6.9%, 6M +23.6%

### KR ETF Risk Managed
- 395160.KS KODEX 시스템반도체 / 반도체: score 77.12, 1M -14.6%, 3M +71.6%, 6M +145.5%
- 360750.KS TIGER 미국S&P500 / 미국 대표지수: score 76.78, 1M +0.2%, 3M +13.7%, 6M +13.4%
- 102110.KS TIGER 200 / 국내 대형주: score 72.62, 1M -10.1%, 3M +44.0%, 6M +93.5%