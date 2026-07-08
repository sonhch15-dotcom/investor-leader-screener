# Capital Account Simulation

Generated at: 2026-07-08T03:36:41.363Z
Initial capital: 10,000,000
Transaction cost: 10 bps each buy/sell
Method: use the current Leader2 strategy trades, buy with limited cash, sell 50% at six months, sell remaining 50% by weekly extension rule.

## Scenario Comparison

| Scenario | Final Capital | Total Return | CAGR | Buys | Skipped | Min Cash | Cost | Note |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| 5% per signal / 15% symbol cap | 32,237,026 | 222.4% | 27.4% | 106/106 | 0 | 3,213,895 | 128,365 | 1천만 원 기준 신규 신호당 50만 원, 같은 종목 총 원금은 150만 원까지 |
| 7.5% per signal / 20% symbol cap | 42,706,491 | 327.1% | 35.1% | 106/106 | 0 | 0 | 189,538 | 1천만 원 기준 신규 신호당 75만 원, 같은 종목 총 원금은 200만 원까지 |
| 10% per signal / 20% symbol cap | 50,200,901 | 402.0% | 39.7% | 97/106 | 9 | -0 | 223,812 | 1천만 원 기준 신규 신호당 100만 원, 공격적 배분 |
| 12-slot dynamic / 15% symbol cap | 52,416,147 | 424.2% | 40.9% | 96/106 | 10 | -0 | 239,903 | 현재 계좌 기준 12개 슬롯으로 나눠 신규 신호마다 동적 배분 |

## Recommended Operating Rule

Use the 5% per signal / 15% symbol cap version as the default operating rule.

- With 10,000,000 capital, buy 500,000 per new monthly recommendation.
- Buy two names per month, so the planned monthly new capital is about 1,000,000.
- If the same symbol is recommended again, additional buys are allowed only until total original cost reaches 1,500,000.
- At six months, sell 50% of that specific monthly lot.
- Keep the remaining 50% only while the weekly extension rule allows it; otherwise sell it.
- If cash is short, skip the lower-ranked/duplicate buy rather than forcing leverage.

## Best Scenario Details

Recommended: 5% per signal / 15% symbol cap
Final capital: 32,237,026 (222.4%)
Executed buys: 106, skipped buys: 0

### Largest Symbol Allocations

| Symbol | Buy Count | Total Buy Amount | Profit Proxy |
|---|---:|---:|---:|
| GE | 6 | 3,000,000 | 901,650 |
| HOOD | 5 | 2,500,000 | 2,662,350 |
| WDC | 5 | 2,500,000 | 4,966,400 |
| STX | 4 | 2,000,000 | 5,062,100 |
| PLTR | 3 | 1,500,000 | -80,550 |
| AMD | 3 | 1,500,000 | 221,700 |
| OXY | 3 | 1,500,000 | -47,750 |
| ACGL | 3 | 1,500,000 | 284,250 |
| APA | 2 | 1,000,000 | 641,550 |
| EXPE | 2 | 1,000,000 | -40,100 |

## Limitations

- This is a cash-constrained account simulation, but it uses stored average buy/sell prices from the existing backtest.
- It does not include taxes, FX, dividends, exact partial-fill prices, slippage beyond the configured cost, or mark-to-market daily drawdowns.
- The purpose is to decide position sizing and cash management, not to replace broker-grade execution accounting.
