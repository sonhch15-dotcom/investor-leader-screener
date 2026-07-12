from AlgorithmImports import *
from collections import defaultdict, deque
from datetime import datetime
import calendar
import math

INITIAL_KRW = 100_000_000.0
USD_KRW = 1501.4
INITIAL_USD = INITIAL_KRW / USD_KRW
FIRST_SIGNAL = datetime(2010, 8, 27)
LAST_SIGNAL = datetime(2026, 6, 26)
EXECUTION_DELAY_DAYS = 1
MEMBERSHIP_LAG_DAYS = 5
MAX_POSITION = 0.275
SLOT_MONTHS = 9
MIN_BUY = INITIAL_USD * 0.0001

SECTOR_TICKERS = {
    MorningstarSectorCode.BASIC_MATERIALS: "XLB",
    MorningstarSectorCode.CONSUMER_CYCLICAL: "XLY",
    MorningstarSectorCode.FINANCIAL_SERVICES: "XLF",
    MorningstarSectorCode.REAL_ESTATE: "XLRE",
    MorningstarSectorCode.CONSUMER_DEFENSIVE: "XLP",
    MorningstarSectorCode.HEALTHCARE: "XLV",
    MorningstarSectorCode.UTILITIES: "XLU",
    MorningstarSectorCode.COMMUNICATION_SERVICES: "XLC",
    MorningstarSectorCode.ENERGY: "XLE",
    MorningstarSectorCode.INDUSTRIALS: "XLI",
    MorningstarSectorCode.TECHNOLOGY: "XLK",
}
SEED_TAGS = {
    "AAPL": ["t"], "MSFT": ["t", "a"],
    "NVDA": ["s", "a"], "AVGO": ["s"],
    "AMD": ["s", "a"], "AMZN": ["c", "l", "a"],
    "META": ["m", "a"], "GOOGL": ["m", "a"],
    "TSLA": ["v"], "LLY": ["h"], "JPM": ["f"],
    "XOM": ["e"], "GE": ["i", "d"],
    "PLTR": ["a", "d"], "ARM": ["s", "a"],
}
AI_HARDWARE = {
    "NVDA", "AMD", "AVGO", "ARM", "MU", "ASML", "TSM", "WDC", "STX",
    "DELL", "HPE", "ANET", "VRT", "SMCI", "MRVL", "LRCX", "KLAC",
    "AMAT", "TER", "MPWR", "ON", "QCOM", "INTC", "SNDK",
}
ACCOUNT_SPECS = [
    ("A_PATH10", "A", "path", 0.001, 0.0),
    ("C_PATH10", "C", "path", 0.001, 0.0),
    ("A_SLOT10", "A", "slot", 0.001, 0.0),
    ("C_SLOT10", "C", "slot", 0.001, 0.0),
    ("A_SLOT25", "A", "slot", 0.0025, 0.0025),
    ("C_SLOT25", "C", "slot", 0.0025, 0.0025),
    ("A_RAMP10", "A", "ramp", 0.001, 0.0),
    ("C_RAMP10", "C", "ramp", 0.001, 0.0),
    ("A_RAMP25", "A", "ramp", 0.0025, 0.0025),
    ("C_RAMP25", "C", "ramp", 0.0025, 0.0025),
]


def finite(value):
    try:
        return value is not None and math.isfinite(float(value))
    except Exception:
        return False


def average(values):
    clean = [float(value) for value in values if finite(value)]
    return sum(clean) / len(clean) if clean else None


def clamp(value, lower, upper):
    return min(upper, max(lower, float(value))) if finite(value) else lower


def pct_return(values, days):
    return values[-1] / values[-1 - days] - 1 if len(values) > days and values[-1 - days] else None


def weighted_return(returns):
    parts = [(returns.get("r1m"), 0.4), (returns.get("r3m"), 0.35), (returns.get("r6m"), 0.25)]
    valid = [(value, weight) for value, weight in parts if finite(value)]
    total = sum(weight for _, weight in valid)
    return sum(value * weight for value, weight in valid) / total if total else None


def percentile_score(values, value, maximum):
    clean = sorted(float(item) for item in values if finite(item))
    return round(sum(item <= value for item in clean) / len(clean) * maximum, 2) if clean and finite(value) else 0.0


def dollar_volume_score(value):
    if not finite(value): return 0
    if value >= 200_000_000: return 5
    if value >= 100_000_000: return 4
    if value >= 50_000_000: return 3
    if value >= 20_000_000: return 1
    return 0


def volume_increase_score(value):
    if not finite(value): return 0
    if value >= 1.5: return 5
    if value >= 1.25: return 4
    if value >= 1.1: return 3
    if value >= 0.9: return 2
    return 0


def up_down_volume_score(value):
    if not finite(value): return 0
    if value >= 1.3: return 5
    if value >= 1.15: return 4
    if value >= 1.0: return 3
    if value >= 0.85: return 1
    return 0


def base_metrics(rows):
    data = [row for row in rows if finite(row["close"]) and finite(row["volume"])]
    if not data: return None
    closes = [row["close"] for row in data]
    highs = [row["high"] for row in data]
    volumes = [row["volume"] for row in data]
    returns = {"r1m": pct_return(closes, 21), "r3m": pct_return(closes, 63), "r6m": pct_return(closes, 126)}
    up_volumes, down_volumes = [], []
    for index in range(max(1, len(data) - 20), len(data)):
        if closes[index] > closes[index - 1]: up_volumes.append(volumes[index])
        elif closes[index] < closes[index - 1]: down_volumes.append(volumes[index])
    avg10, avg50, avg_down = average(volumes[-10:]), average(volumes[-50:]), average(down_volumes)
    metric = {
        "close": closes[-1], "closes": closes, "returns": returns,
        "momentum": weighted_return(returns),
        "sma20": average(closes[-20:]) if len(closes) >= 20 else None,
        "sma50": average(closes[-50:]) if len(closes) >= 50 else None,
        "sma200": average(closes[-200:]) if len(closes) >= 200 else None,
        "high52": max(highs[-252:]),
        "avg_dollar20": average([row["close"] * row["volume"] for row in data[-20:]]),
        "volume_ratio": avg10 / avg50 if avg50 else None,
        "up_down_ratio": (average(up_volumes) or 0) / avg_down if avg_down else None,
    }
    metric["above50"] = finite(metric["sma50"]) and metric["close"] > metric["sma50"]
    metric["above200"] = finite(metric["sma200"]) and metric["close"] > metric["sma200"]
    metric["near_high"] = metric["close"] / metric["high52"] - 1 >= -0.10
    return metric


def moving_average_score(metric):
    score = 0
    if finite(metric["sma20"]) and metric["close"] > metric["sma20"]: score += 2
    if finite(metric["sma50"]) and metric["close"] > metric["sma50"]: score += 2
    if finite(metric["sma200"]) and metric["close"] > metric["sma200"]: score += 2
    if finite(metric["sma20"]) and finite(metric["sma50"]) and metric["sma20"] > metric["sma50"]: score += 1
    return score


def high_proximity_score(metric):
    distance = metric["close"] / metric["high52"] - 1
    if distance >= -0.05: return 5
    if distance >= -0.10: return 4
    if distance >= -0.15: return 3
    if distance >= -0.25: return 2
    return 0


def overextension_penalty(metric):
    penalty = 0
    if finite(metric["sma20"]) and metric["close"] / metric["sma20"] - 1 >= 0.15: penalty -= 1
    if finite(metric["sma20"]) and metric["close"] / metric["sma20"] - 1 >= 0.25: penalty -= 1
    r10 = pct_return(metric["closes"], 10)
    if finite(r10) and r10 >= 0.25: penalty -= 1
    return max(-3, penalty)


def weekly_rows(daily_rows):
    grouped = {}
    for row in daily_rows:
        iso = row["date"].isocalendar()
        grouped[(iso.year, iso.week)] = row
    rows = [grouped[key] for key in sorted(grouped)]
    closes, result = [row["close"] for row in rows], []
    for index, row in enumerate(rows):
        ma10 = average(closes[index - 9:index + 1]) if index >= 9 else None
        rsi14 = None
        if index >= 14:
            gains, losses = 0.0, 0.0
            for cursor in range(index - 13, index + 1):
                change = closes[cursor] - closes[cursor - 1]
                if change > 0: gains += change
                else: losses += abs(change)
            rsi14 = 100.0 if losses == 0 else 100 - 100 / (1 + gains / losses)
        result.append({"date": row["date"], "close": row["close"], "ma10": ma10, "rsi14": rsi14})
    return result


def make_account(key, strategy, allocator, cost_rate, fx_fee):
    cash = INITIAL_USD * (1 - fx_fee)
    return {
        "key": key, "strategy": strategy, "allocator": allocator, "cost_rate": cost_rate,
        "fx_fee": fx_fee,
        "cash": cash, "lots": [], "signal_history": [], "curve": [], "buy_index": 0,
        "attempted": 0, "executed": 0, "skipped_cash": 0, "skipped_cap": 0,
        "costs": INITIAL_USD * fx_fee, "fx_cost": INITIAL_USD * fx_fee,
        "first_buy_date": None, "selected": [], "planned": 0.0, "funded": 0.0,
    }


class Usd100mCoherentCapitalAudit(QCAlgorithm):
    def initialize(self):
        self.set_start_date(2009, 6, 1)
        self.set_end_date(2026, 7, 10)
        self.set_cash(INITIAL_USD)
        self.set_time_zone(TimeZones.NEW_YORK)
        self.universe_settings.resolution = Resolution.DAILY
        self.universe_settings.asynchronous = False
        self.rows = defaultdict(lambda: deque(maxlen=270))
        self.latest_prices, self.qqq_full = {}, []
        self.spy_members, self.qqq_members, self.ever_members = set(), set(), set()
        self.membership_history = deque(maxlen=20)
        self.pending, self.cohort_index, self.last_signal_month = None, 0, None
        self.delisting_records = []
        self.selectors = {"A": {"group_history": []}, "C": {"group_history": []}}
        self.accounts = {key: make_account(key, strategy, allocator, cost, fx) for key, strategy, allocator, cost, fx in ACCOUNT_SPECS}
        self.etfs = {}
        for ticker in ["SPY", "QQQ"] + list(SECTOR_TICKERS.values()):
            self.etfs[ticker] = self.add_equity(ticker, Resolution.DAILY, data_normalization_mode=DataNormalizationMode.ADJUSTED).symbol
        self.spy, self.qqq = self.etfs["SPY"], self.etfs["QQQ"]
        self.sector_etf = {sector: self.etfs[ticker] for sector, ticker in SECTOR_TICKERS.items()}
        self.defensive_sectors = {MorningstarSectorCode.REAL_ESTATE, MorningstarSectorCode.CONSUMER_DEFENSIVE, MorningstarSectorCode.UTILITIES}
        self.add_universe(self.universe.etf(self.spy, self.universe_settings, self.select_spy))
        self.add_universe(self.universe.etf(self.qqq, self.universe_settings, self.select_qqq))
        self.schedule.on(self.date_rules.week_end(self.spy), self.time_rules.after_market_close(self.spy, 5), self.process_weekly_tasks)

    def select_spy(self, constituents):
        self.spy_members = {row.symbol for row in constituents}
        self.ever_members.update(self.spy_members)
        return list(self.spy_members)

    def select_qqq(self, constituents):
        self.qqq_members = {row.symbol for row in constituents}
        self.ever_members.update(self.qqq_members)
        return list(self.qqq_members)

    def on_data(self, data):
        current_date = self.time.date()
        members = self.spy_members | self.qqq_members
        if members and (not self.membership_history or self.membership_history[-1][0] != current_date):
            self.membership_history.append((current_date, set(members)))
        for symbol, bar in data.bars.items():
            row = {"date": current_date, "open": float(bar.open), "high": float(bar.high), "low": float(bar.low), "close": float(bar.close), "volume": float(bar.volume)}
            if not self.rows[symbol] or self.rows[symbol][-1]["date"] != current_date: self.rows[symbol].append(row)
            self.latest_prices[symbol] = row["close"]
            if symbol == self.qqq and (not self.qqq_full or self.qqq_full[-1]["date"] != current_date): self.qqq_full.append(row)
        if self.pending and current_date > self.pending["signal_date"].date() and self.spy in data.bars:
            if self.pending["delay_days"] < EXECUTION_DELAY_DAYS: self.pending["delay_days"] += 1
            else: self.execute_cohort(current_date)
        self.mark_accounts(current_date)

    def on_securities_changed(self, changes):
        if self.time.date() < FIRST_SIGNAL.date(): return
        for security in changes.added_securities:
            symbol = security.symbol
            if len(self.rows[symbol]) >= 200: continue
            try:
                history = self.history(symbol, 270, Resolution.DAILY)
                if history.empty: continue
                for index, row in history.iterrows():
                    stamp = index[-1] if isinstance(index, tuple) else index
                    date = stamp.to_pydatetime().date() if hasattr(stamp, "to_pydatetime") else stamp.date()
                    self.rows[symbol].append({"date": date, "open": float(row["open"]), "high": float(row["high"]), "low": float(row["low"]), "close": float(row["close"]), "volume": float(row["volume"])})
            except Exception:
                pass

    def last_friday(self, year, month):
        day = calendar.monthrange(year, month)[1]
        date = datetime(year, month, day)
        while date.weekday() != 4:
            day -= 1
            date = datetime(year, month, day)
        return date

    def build_shared_rows(self, members):
        metrics = {}
        for symbol in set(members) | set(self.etfs.values()):
            metric = base_metrics(list(self.rows[symbol]))
            if metric: metrics[symbol] = metric
        spy_metric, qqq_metric = metrics.get(self.spy), metrics.get(self.qqq)
        momentum_values = [metrics[symbol]["momentum"] for symbol in members if symbol in metrics]
        spy_excess, qqq_excess = {}, {}
        for symbol in members:
            metric = metrics.get(symbol)
            if not metric: continue
            spy_excess[symbol] = weighted_return({key: metric["returns"].get(key) - spy_metric["returns"].get(key) if spy_metric and finite(metric["returns"].get(key)) and finite(spy_metric["returns"].get(key)) else None for key in ["r1m", "r3m", "r6m"]})
            qqq_excess[symbol] = weighted_return({key: metric["returns"].get(key) - qqq_metric["returns"].get(key) if qqq_metric and finite(metric["returns"].get(key)) and finite(qqq_metric["returns"].get(key)) else None for key in ["r1m", "r3m", "r6m"]})
        rows = []
        for symbol in members:
            metric = metrics.get(symbol)
            if not metric or not self.securities.contains_key(symbol): continue
            fundamental = self.securities[symbol].fundamentals
            if fundamental is None or not fundamental.has_fundamental_data: continue
            classification = fundamental.asset_classification
            sector, group = int(classification.morningstar_sector_code), int(classification.morningstar_industry_group_code)
            if sector <= 0 or group <= 0: continue
            relative = percentile_score(list(spy_excess.values()), spy_excess.get(symbol), 15) + percentile_score(list(qqq_excess.values()), qqq_excess.get(symbol), 15) + percentile_score(momentum_values, metric["momentum"], 5)
            momentum = clamp(percentile_score(momentum_values, metric["momentum"], 15) + moving_average_score(metric) + high_proximity_score(metric) + overextension_penalty(metric), 0, 30)
            ticker = symbol.value.replace(".", "-")
            rows.append({"symbol": symbol, "ticker": symbol.value, "sector": sector, "group": group, "tags": SEED_TAGS.get(ticker, []), "metric": metric, "relative": relative, "momentum_score": momentum, "strength": relative + momentum})
        sector_averages = {sector: average(row["strength"] for row in rows if row["sector"] == sector) for sector in {row["sector"] for row in rows}}
        sector_values, sector_etf_values = list(sector_averages.values()), [metrics.get(symbol, {}).get("momentum") for symbol in self.sector_etf.values()]
        strong_tags = defaultdict(int)
        for row in rows:
            if row["strength"] >= 45:
                for tag in row["tags"]: strong_tags[tag] += 1
        for row in rows:
            theme_bonus = 1 if row["tags"] else 0
            if any(strong_tags[tag] >= 2 for tag in row["tags"]): theme_bonus += 1
            if any(strong_tags[tag] >= 4 for tag in row["tags"]): theme_bonus += 1
            sector_symbol = self.sector_etf.get(row["sector"])
            sector_momentum = metrics.get(sector_symbol, {}).get("momentum") if sector_symbol else None
            row["sector_theme"] = clamp(percentile_score(sector_etf_values, sector_momentum, 10) + percentile_score(sector_values, sector_averages.get(row["sector"]), 7) + min(3, theme_bonus), 0, 20)
            row["dollar_score"] = dollar_volume_score(row["metric"]["avg_dollar20"])
            row["volume_score"] = row["dollar_score"] + volume_increase_score(row["metric"]["volume_ratio"]) + up_down_volume_score(row["metric"]["up_down_ratio"])
            row["ai_hardware"] = row["ticker"].replace(".", "-") in AI_HARDWARE
        return rows

    def score_variant(self, shared, sector_weight, normalize):
        maximum, result = 35 + 30 + 15 + 20 * sector_weight, []
        for source in shared:
            row = dict(source)
            raw = row["relative"] + row["momentum_score"] + row["sector_theme"] * sector_weight + row["volume_score"]
            row["score"] = raw / maximum * 100 if normalize else raw
            row["eligible"] = row["score"] >= 70 and row["dollar_score"] > 0
            result.append(row)
        return sorted(result, key=lambda row: row["score"], reverse=True)

    def select_leader2(self, selector, rows):
        eligible = [row for row in rows if row["eligible"]]
        for rank, row in enumerate(eligible, 1): row["rank"] = rank
        top20, top50, top100 = eligible[:20], eligible[:50], eligible[:100]
        qqq_momentum = base_metrics(list(self.rows[self.qqq]))["momentum"]
        spy_momentum = base_metrics(list(self.rows[self.spy]))["momentum"]
        stats = []
        for group in {row["group"] for row in rows}:
            group_rows = [row for row in rows if row["group"] == group]
            if len(group_rows) < 3: continue
            group_eligible = [row for row in group_rows if row["eligible"]]
            previous = []
            for period in selector["group_history"][-3:]:
                match = next((item for item in period if item["group"] == group), None)
                if match: previous.append(match)
            current_top50 = sum(row["group"] == group for row in top50)
            stat = {
                "group": group, "top20": sum(row["group"] == group for row in top20), "top50": current_top50,
                "top100": sum(row["group"] == group for row in top100), "eligible_rate": len(group_eligible) / len(group_rows),
                "top50_concentration": current_top50 / len(group_rows), "top100_concentration": sum(row["group"] == group for row in top100) / len(group_rows),
                "avg_momentum": average(row["metric"]["momentum"] for row in group_rows),
                "above50": average(1 if row["metric"]["above50"] else 0 for row in group_rows),
                "above200": average(1 if row["metric"]["above200"] else 0 for row in group_rows),
                "near_high": average(1 if row["metric"]["near_high"] else 0 for row in group_rows),
                "score75": average(1 if row["score"] >= 75 else 0 for row in group_rows),
                "score80": average(1 if row["score"] >= 80 else 0 for row in group_rows),
            }
            acceleration = current_top50 - (average(item["top50"] for item in previous) or 0)
            stat["leadership"] = clamp(stat["avg_momentum"] - qqq_momentum, -0.2, 0.4) * 100 + clamp(stat["avg_momentum"] - spy_momentum, -0.2, 0.4) * 60 + stat["above50"] * 22 + stat["above200"] * 16 + stat["near_high"] * 16 + stat["score75"] * 20 + stat["score80"] * 12 + stat["eligible_rate"] * 12 + stat["top50_concentration"] * 90 + stat["top100_concentration"] * 35 + stat["top20"] * 8 + clamp(acceleration, -4, 6) * 4 + len(previous) * 4
            stats.append(stat)
        stats.sort(key=lambda row: row["leadership"], reverse=True)
        selector["group_history"].append(stats)
        selected, used = [], set()
        for stat in stats[:2]:
            match = next((row for row in eligible if row["group"] == stat["group"] and row["symbol"] not in used), None)
            if match:
                selected.append(match)
                used.add(match["symbol"])
        return sorted(selected, key=lambda row: row["rank"])[:2]

    def create_signal(self):
        members = self.membership_history[-1 - MEMBERSHIP_LAG_DAYS][1] if len(self.membership_history) > MEMBERSHIP_LAG_DAYS else self.spy_members | self.qqq_members
        if not members: return
        shared = self.build_shared_rows(members)
        selections = {
            "A": self.select_leader2(self.selectors["A"], self.score_variant(shared, 1.0, False)),
            "C": self.select_leader2(self.selectors["C"], self.score_variant(shared, 0.5, True)),
        }
        self.pending = {"index": self.cohort_index, "signal_date": self.time, "delay_days": 0, "selections": selections}
        self.debug(f"PICK|{self.time:%Y-%m}|A={','.join(row['ticker'] for row in selections['A'])}|C={','.join(row['ticker'] for row in selections['C'])}")
        self.cohort_index += 1

    def process_calendar_exits(self, account, cohort_index, date, signal_date):
        for lot in list(account["lots"]):
            if lot["remaining"] <= 0: continue
            if not lot["fixed_done"] and lot["cohort"] + 6 == cohort_index:
                self.sell_lot(account, lot, 0.5, date, "half_fixed_6m")
                weekly = weekly_rows([row for row in self.rows[lot["symbol"]] if row["date"] <= signal_date])
                current = weekly[-1] if weekly else None
                alive = current and finite(current["ma10"]) and finite(current["rsi14"]) and current["close"] >= current["ma10"] and current["rsi14"] >= 50
                lot["fixed_done"] = True
                if alive:
                    lot["extended"], lot["fixed_date"] = True, date
                else: self.sell_lot(account, lot, 0.5, date, "trend_not_alive_at_6m")
            if lot["remaining"] > 0 and lot["cohort"] + 12 == cohort_index: self.sell_lot(account, lot, 1.0, date, "max_12m")

    def multiplier(self, account, selected, cohort):
        prior = sum(item["symbol"] == selected["symbol"] and cohort - item["cohort"] <= 12 for item in account["signal_history"])
        account["signal_history"].append({"cohort": cohort, "symbol": selected["symbol"]})
        account["buy_index"] += 1
        value = 1.45 if prior >= 2 else 1.25 if prior >= 1 else 1.0
        if selected["ai_hardware"]: value *= 1.25
        if selected["sector"] in self.defensive_sectors: value *= 0.85
        return min(value, 1.85)

    def cap_room(self, account, selected):
        open_cost = sum(lot["remaining"] * lot["entry_price"] for lot in account["lots"] if lot["symbol"] == selected["symbol"])
        return max(0.0, INITIAL_USD * MAX_POSITION - open_cost)

    def buy_lot(self, account, selected, cohort, signal_date, date, amount):
        account["attempted"] += 1
        room = self.cap_room(account, selected)
        amount = min(amount, room, account["cash"] / (1 + account["cost_rate"]))
        if room < MIN_BUY:
            account["skipped_cap"] += 1
            return
        price = self.latest_prices.get(selected["symbol"])
        if amount < MIN_BUY or not finite(price) or price <= 0:
            account["skipped_cash"] += 1
            return
        cost, shares = amount * account["cost_rate"], amount / price
        account["cash"] -= amount + cost
        account["costs"] += cost
        account["funded"] += amount
        account["executed"] += 1
        account["first_buy_date"] = account["first_buy_date"] or date
        lot = {"symbol": selected["symbol"], "ticker": selected["ticker"], "cohort": cohort, "signal_date": signal_date, "entry_date": date, "entry_price": price, "entry_cost": cost, "proceeds": 0.0, "original": shares, "remaining": shares, "fixed_done": False, "extended": False, "fixed_date": None}
        account["lots"].append(lot)
        account["selected"].append(lot)

    def execute_month_buys(self, account, selections, cohort, signal_date, date):
        picks = sorted(selections, key=lambda row: row["ticker"])
        weights = [self.multiplier(account, selected, cohort) for selected in picks]
        if account["allocator"] == "path":
            for selected, weight in zip(picks, weights):
                if account["cash"] <= INITIAL_USD * 0.10: base = INITIAL_USD * 0.05
                elif account["buy_index"] <= 6 and account["cash"] >= INITIAL_USD * 0.30: base = INITIAL_USD * 0.10
                else: base = INITIAL_USD * 0.075
                wanted = base * weight
                account["planned"] += wanted
                self.buy_lot(account, selected, cohort, signal_date, date, wanted)
            return
        if account["allocator"] == "ramp":
            base_pct = 0.10 if account["buy_index"] <= 6 else 0.075
            wanted = [self.account_equity(account) * base_pct * weight for weight in weights]
            account["planned"] += sum(wanted)
            invest_budget = min(sum(wanted), account["cash"] / (1 + account["cost_rate"]))
        else:
            spend_budget = min(account["cash"], self.account_equity(account) / SLOT_MONTHS)
            invest_budget = spend_budget / (1 + account["cost_rate"])
            account["planned"] += invest_budget
        total_weight = sum(weights) or 1.0
        amounts = [min(invest_budget * weight / total_weight, self.cap_room(account, selected)) for selected, weight in zip(picks, weights)]
        leftover = max(0.0, invest_budget - sum(amounts))
        for _ in range(2):
            room_indexes = [index for index, selected in enumerate(picks) if self.cap_room(account, selected) - amounts[index] > MIN_BUY]
            if not room_indexes or leftover < MIN_BUY: break
            room_weight = sum(weights[index] for index in room_indexes)
            for index in room_indexes:
                extra = min(leftover * weights[index] / room_weight, self.cap_room(account, picks[index]) - amounts[index])
                amounts[index] += extra
            leftover = max(0.0, invest_budget - sum(amounts))
        for selected, amount in zip(picks, amounts): self.buy_lot(account, selected, cohort, signal_date, date, amount)

    def execute_cohort(self, date):
        pending = self.pending
        for account in self.accounts.values():
            self.process_calendar_exits(account, pending["index"], date, pending["signal_date"].date())
            self.execute_month_buys(account, pending["selections"][account["strategy"]], pending["index"], pending["signal_date"].date(), date)
        self.pending = None

    def sell_lot(self, account, lot, fraction, date, reason, override_price=None):
        if lot["remaining"] <= 0: return
        shares = lot["remaining"] if fraction >= 1 else min(lot["remaining"], lot["original"] * fraction)
        price = override_price if finite(override_price) else self.latest_prices.get(lot["symbol"])
        if not finite(price) or price <= 0: return
        gross, cost = shares * price, shares * price * account["cost_rate"]
        account["cash"] += gross - cost
        account["costs"] += cost
        lot["proceeds"] += gross - cost
        lot["remaining"] = max(0.0, lot["remaining"] - shares)
        lot["last_exit_date"], lot["last_exit_reason"] = date, reason

    def process_weekly_tasks(self):
        date = self.time.date()
        if FIRST_SIGNAL.date() <= date <= LAST_SIGNAL.date():
            last_friday, month_key = self.last_friday(date.year, date.month).date(), (date.year, date.month)
            if date <= last_friday and (last_friday - date).days <= 4 and self.last_signal_month != month_key:
                self.create_signal()
                self.last_signal_month = month_key
        for account in self.accounts.values():
            for lot in account["lots"]:
                if lot["remaining"] <= 0 or not lot["extended"] or date <= lot["fixed_date"]: continue
                weekly = weekly_rows(list(self.rows[lot["symbol"]]))
                if len(weekly) < 2: continue
                current, previous = weekly[-1], weekly[-2]
                broken = finite(current["ma10"]) and finite(previous["ma10"]) and current["close"] < current["ma10"] and previous["close"] < previous["ma10"]
                if broken: self.sell_lot(account, lot, 1.0, date, "two_week_10w_break")
        self.mark_accounts(date)

    def on_delistings(self, delistings):
        for symbol, event in delistings.items():
            selected = False
            for account in self.accounts.values():
                for lot in account["lots"]:
                    if lot["symbol"] == symbol and lot["remaining"] > 0:
                        selected = True
                        event_price = float(event.price) if finite(event.price) and float(event.price) > 0 else None
                        self.sell_lot(account, lot, 1.0, self.time.date(), "delisting", event_price)
            if selected: self.delisting_records.append(f"{symbol.value}@{self.time:%Y-%m-%d}")

    def account_equity(self, account):
        return account["cash"] + sum(lot["remaining"] * self.latest_prices.get(lot["symbol"], lot["entry_price"]) for lot in account["lots"] if lot["remaining"] > 0)

    def mark_accounts(self, date):
        for account in self.accounts.values():
            if account["first_buy_date"] is None: continue
            equity = self.account_equity(account)
            row = {"date": date, "equity": equity, "cash": account["cash"]}
            if account["curve"] and account["curve"][-1]["date"] == date: account["curve"][-1] = row
            else: account["curve"].append(row)

    def summarize(self, account):
        equity, start = self.account_equity(account), account["first_buy_date"]
        total_return = equity / INITIAL_USD - 1
        years = max((self.time.date() - start).days / 365.25, 1 / 365.25)
        cagr = (1 + total_return) ** (1 / years) - 1 if total_return > -1 else -1
        peak, mdd = INITIAL_USD, 0.0
        for row in account["curve"]:
            peak = max(peak, row["equity"])
            mdd = min(mdd, row["equity"] / peak - 1)
        qqq_rows = [row for row in self.qqq_full if row["date"] >= start]
        qqq_return = qqq_rows[-1]["close"] / qqq_rows[0]["close"] * (1 - account["fx_fee"]) * (1 - account["cost_rate"]) - 1 if qqq_rows else None
        cash_ratios = [row["cash"] / row["equity"] for row in account["curve"] if row["equity"] > 0]
        return {"equity": equity, "return": total_return, "cagr": cagr, "mdd": mdd, "qqq": qqq_return, "avg_cash": average(cash_ratios), "min_cash": min((row["cash"] for row in account["curve"]), default=account["cash"])}

    def tail_stats(self, account):
        profits = []
        for lot in account["selected"]:
            open_value = lot["remaining"] * self.latest_prices.get(lot["symbol"], lot["entry_price"])
            profit = lot["proceeds"] + open_value - lot["original"] * lot["entry_price"] - lot["entry_cost"]
            profits.append((profit, f"{lot['ticker']}@{lot['signal_date']:%Y-%m}"))
        profits.sort(reverse=True)
        top1, top2 = profits[0] if profits else (0, "-"), profits[1] if len(profits) > 1 else (0, "-")
        equity = self.account_equity(account)
        return top1, top2, (equity - top1[0] - top2[0]) / INITIAL_USD - 1

    def on_end_of_algorithm(self):
        last_data = self.qqq_full[-1]["date"] if self.qqq_full else None
        self.debug(f"CAPITAL_META|initial_krw={INITIAL_KRW:.0f}|usdkrw={USD_KRW:.1f}|initial_usd={INITIAL_USD:.2f}|signals={self.cohort_index}|ever={len(self.ever_members)}|last_data={last_data}|delay={EXECUTION_DELAY_DAYS}|lag={MEMBERSHIP_LAG_DAYS}|taxonomy=MORNINGSTAR_COHERENT_V2|slot_months={SLOT_MONTHS}")
        for key, account in self.accounts.items():
            summary = self.summarize(account)
            top1, top2, without2 = self.tail_stats(account)
            self.debug(f"SUMMARY|{key}|ret={summary['return']:.4f}|cagr={summary['cagr']:.4f}|mdd={summary['mdd']:.4f}|qqq={summary['qqq']:.4f}|buys={account['executed']}/{account['attempted']}|skip_cash={account['skipped_cash']}|skip_cap={account['skipped_cap']}|cash={account['cash']:.2f}|equity_usd={summary['equity']:.2f}")
            self.debug(f"DETAIL|{key}|cost={account['costs']:.2f}|funded={account['funded']:.2f}|planned={account['planned']:.2f}|avg_cash={summary['avg_cash']:.4f}|min_cash={summary['min_cash']:.2f}")
            self.debug(f"TAIL|{key}|top1={top1[1]}:{top1[0]:.2f}|top2={top2[1]}:{top2[0]:.2f}|ret_without2={without2:.4f}")
        self.debug(f"SELECTED_DELIST|{','.join(sorted(set(self.delisting_records))) or '-'}")
