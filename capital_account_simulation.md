# Capital Account Simulation

Generated at: 2026-07-08T04:35:30.186Z
Initial capital: 10,000,000
Transaction cost: 10 bps each buy/sell
Method: use the current Leader2 strategy trades, buy with limited cash, sell 50% at six months, sell remaining 50% by weekly extension rule.

## Scenario Comparison

| Scenario | Final Capital | Total Return | CAGR | Buys | Skipped | Min Cash | Cost | Note |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| Conservative: 5% / 15% cap | 32,237,026 | 222.4% | 27.4% | 106/106 | 0 | 3,213,895 | 128,365 | 10M capital, buy 500K per signal, max 1.5M original cost per symbol. |
| Base: 6.5% / 17.5% cap / 10% cash reserve | 38,350,030 | 283.5% | 32.1% | 106/106 | 0 | 1,178,064 | 164,715 | 10M capital, buy 650K per signal, max 1.75M per symbol, preserve 1M cash when possible. |
| Aggressive: 7% / 17.5% cap / 10% cash reserve | 40,232,421 | 302.3% | 33.4% | 106/106 | 0 | 1,000,000 | 174,734 | 10M capital, buy 700K per signal, max 1.75M per symbol, preserve 1M cash when possible. |
| Over-aggressive: 7.5% / 20% cap | 42,706,491 | 327.1% | 35.1% | 106/106 | 0 | 0 | 189,538 | 10M capital, buy 750K per signal, max 2M per symbol, no cash reserve. |
| Ramp aggressive: 3M 1M/750K/500K | 43,358,255 | 333.6% | 35.5% | 106/106 | 0 | -0 | 192,071 | First three months deploy faster: buy 1M when cash is above 3M, 750K normally, 500K when cash is tight; max 2.25M per symbol. |

## Recommended Operating Rule

Use the 3-month ramp aggressive version as the default operating rule.

- With 10,000,000 capital, buy up to 1,000,000 per new monthly recommendation during the first three months when cash is above 3,000,000.
- After the ramp period, buy 750,000 per new monthly recommendation.
- If cash falls below 1,000,000, reduce the next buy to 500,000 or skip the lower-priority duplicate.
- If the same symbol is recommended again, additional buys are allowed only until total original cost reaches 2,250,000.
- At six months, sell 50% of that specific monthly lot.
- Keep the remaining 50% only while the weekly extension rule allows it; otherwise sell it.
- Recalculate next month from current total capital and cash; do not use leverage or retroactively buy old signals.

## Best Scenario Details

Recommended: Ramp aggressive: 3M 1M/750K/500K
Final capital: 43,358,255 (333.6%)
Executed buys: 106, skipped buys: 0

### Largest Symbol Allocations

| Symbol | Buy Count | Total Buy Amount | Profit Proxy |
|---|---:|---:|---:|
| GE | 6 | 4,500,000 | 1,352,475 |
| HOOD | 5 | 3,750,000 | 3,993,525 |
| WDC | 5 | 3,750,000 | 7,449,600 |
| STX | 4 | 3,000,000 | 7,593,150 |
| PLTR | 3 | 2,500,000 | -256,050 |
| AMD | 3 | 2,250,000 | 332,550 |
| OXY | 3 | 2,250,000 | -71,625 |
| APA | 2 | 2,000,000 | 1,283,100 |
| ACGL | 3 | 2,000,000 | 357,875 |
| EXPE | 2 | 1,750,000 | -39,600 |

## Limitations

- This is a cash-constrained account simulation, but it uses stored average buy/sell prices from the existing backtest.
- It does not include taxes, FX, dividends, exact partial-fill prices, slippage beyond the configured cost, or mark-to-market daily drawdowns.
- The purpose is to decide position sizing and cash management, not to replace broker-grade execution accounting.
