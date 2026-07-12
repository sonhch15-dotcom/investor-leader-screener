from AlgorithmImports import *
from collections import defaultdict, deque
from datetime import datetime
import calendar
import math


INITIAL_CAPITAL = 100_000_000.0
COST_RATE = 0.001
MEMBERSHIP_LAG_DAYS = 5
FIRST_SIGNAL = datetime(2010, 8, 27)
SIZES = [1, 2, 3, 5, 10]
SCORE_KEYS = ["M12_1", "BLEND", "INTERMEDIATE", "RISK", "BETA_RESID", "SMOOTH"]
FILTER_KEYS = ["ALL", "MA200", "DUAL"]
DESIGN_START = datetime(2010, 8, 27).date()
DESIGN_END = datetime(2018, 12, 31).date()
VALIDATE_START = datetime(2019, 1, 1).date()
VALIDATE_END = datetime(2022, 12, 31).date()


def finite(value):
    try:
        return value is not None and math.isfinite(float(value))
    except Exception:
        return False


def average(values):
    clean = [float(value) for value in values if finite(value)]
    return sum(clean) / len(clean) if clean else None


def stdev(values):
    clean = [float(value) for value in values if finite(value)]
    if len(clean) < 2:
        return None
    mean = sum(clean) / len(clean)
    variance = sum((value - mean) ** 2 for value in clean) / (len(clean) - 1)
    return math.sqrt(max(0.0, variance))


def sort_symbols(symbols):
    return sorted(symbols, key=lambda symbol: (symbol.value, str(symbol.id)))


def percentile_map(rows, field, higher=True):
    clean = [row for row in rows if finite(row.get(field))]
    clean.sort(key=lambda row: (float(row[field]), row["ticker"], str(row["symbol"].id)))
    count = len(clean)
    output = {}
    for index, row in enumerate(clean):
        value = 50.0 if count == 1 else index / (count - 1) * 100.0
        output[row["symbol"]] = value if higher else 100.0 - value
    return output


class QqqMomentumStage1(QCAlgorithm):
    def initialize(self):
        self.set_start_date(2009, 6, 1)
        self.set_end_date(2022, 12, 31)
        self.set_cash(100_000)
        self.set_time_zone(TimeZones.NEW_YORK)

        self.universe_settings.resolution = Resolution.DAILY
        self.universe_settings.data_normalization_mode = DataNormalizationMode.ADJUSTED
        self.universe_settings.asynchronous = False

        self.rows = defaultdict(lambda: deque(maxlen=340))
        self.latest_prices = {}
        self.qqq_full = []
        self.qqq_members = set()
        self.ever_members = set()
        self.membership_history = deque(maxlen=20)
        self.manual_symbols = {}
        self.pending = None
        self.last_signal_month = None
        self.signal_count = 0
        self.delisting_records = []

        self.accounts = {}
        for score in SCORE_KEYS:
            for filter_key in FILTER_KEYS:
                for size in SIZES:
                    key = f"{score}__{filter_key}__N{size}"
                    self.accounts[key] = self.new_account(key, score, filter_key, size)

        self.qqq = self.add_equity(
            "QQQ",
            Resolution.DAILY,
            data_normalization_mode=DataNormalizationMode.ADJUSTED,
        ).symbol
        self.add_universe(self.universe.etf(self.qqq, self.universe_settings, self.select_qqq))
        self.schedule.on(
            self.date_rules.week_end(self.qqq),
            self.time_rules.after_market_close(self.qqq, 5),
            self.process_weekly,
        )

    def new_account(self, key, score, filter_key, size):
        return {
            "key": key,
            "score": score,
            "filter": filter_key,
            "size": size,
            "cash": INITIAL_CAPITAL,
            "positions": {},
            "curve": [],
            "cash_ratios": [],
            "fees": 0.0,
            "turnover": 0.0,
            "trade_count": 0,
            "first_date": None,
            "last_selection": [],
            "max_weight": 0.0,
        }

    def select_qqq(self, constituents):
        members = {row.symbol for row in constituents}
        self.qqq_members = members
        self.ever_members.update(members)
        return sort_symbols(members)

    def on_securities_changed(self, changes):
        for security in changes.added_securities:
            symbol = security.symbol
            if symbol == self.qqq or len(self.rows[symbol]) >= 253:
                continue
            try:
                history = self.history(symbol, 340, Resolution.DAILY)
                if history.empty:
                    continue
                existing = self.rows[symbol]
                loaded = []
                for index, row in history.iterrows():
                    stamp = index[-1] if isinstance(index, tuple) else index
                    date = stamp.to_pydatetime().date() if hasattr(stamp, "to_pydatetime") else stamp.date()
                    loaded.append({
                        "date": date,
                        "close": float(row["close"]),
                        "volume": float(row["volume"]),
                    })
                for row in sorted(loaded, key=lambda item: item["date"]):
                    if not existing or existing[-1]["date"] != row["date"]:
                        existing.append(row)
            except Exception as error:
                self.debug(f"WARMUP_FAIL|{symbol.value}|{str(error)[:80]}")

    def on_data(self, data):
        date = self.time.date()
        if self.qqq_members and (not self.membership_history or self.membership_history[-1][0] != date):
            self.membership_history.append((date, set(self.qqq_members)))

        for symbol, bar in data.bars.items():
            row = {"date": date, "close": float(bar.close), "volume": float(bar.volume)}
            history = self.rows[symbol]
            if not history or history[-1]["date"] != date:
                history.append(row)
            self.latest_prices[symbol] = row["close"]
            if symbol == self.qqq and (not self.qqq_full or self.qqq_full[-1]["date"] != date):
                self.qqq_full.append(row)

        if self.pending and date > self.pending["signal_date"] and self.qqq in data.bars:
            self.execute_pending(date)
        self.mark_accounts(date)

    def last_friday(self, year, month):
        day = calendar.monthrange(year, month)[1]
        value = datetime(year, month, day)
        while value.weekday() != 4:
            day -= 1
            value = datetime(year, month, day)
        return value.date()

    def process_weekly(self):
        date = self.time.date()
        if date < FIRST_SIGNAL.date():
            return
        month = (date.year, date.month)
        last_friday = self.last_friday(date.year, date.month)
        if date <= last_friday and (last_friday - date).days <= 4 and self.last_signal_month != month:
            self.create_signal(date)
            self.last_signal_month = month

    def qqq_return_map(self):
        rows = list(self.rows[self.qqq])
        output = {}
        for index in range(1, len(rows)):
            previous = rows[index - 1]["close"]
            current = rows[index]["close"]
            if previous > 0 and current > 0:
                output[rows[index]["date"]] = math.log(current / previous)
        return output

    def metric_for(self, symbol, qqq_returns):
        rows = list(self.rows.get(symbol, []))
        if len(rows) < 253:
            return None
        closes = [row["close"] for row in rows]
        if min(closes[-253:]) <= 0:
            return None

        end_1m = len(rows) - 22
        start_12m = len(rows) - 253
        start_6m = len(rows) - 127
        start_3m = len(rows) - 64
        r3 = closes[-1] / closes[start_3m] - 1
        r6 = closes[-1] / closes[start_6m] - 1
        r12_1 = closes[end_1m] / closes[start_12m] - 1
        intermediate = closes[start_6m] / closes[start_12m] - 1
        ma200 = sum(closes[-200:]) / 200

        recent_returns = [
            math.log(closes[index] / closes[index - 1])
            for index in range(len(rows) - 62, len(rows))
        ]
        vol60 = (stdev(recent_returns) or 0.0) * math.sqrt(252)

        formation = []
        paired = []
        for index in range(start_12m + 1, end_1m + 1):
            stock_return = math.log(closes[index] / closes[index - 1])
            formation.append(stock_return)
            qqq_return = qqq_returns.get(rows[index]["date"])
            if finite(qqq_return):
                paired.append((stock_return, qqq_return))

        positive = sum(value > 0 for value in formation) / len(formation) if formation else 0.0
        negative = sum(value < 0 for value in formation) / len(formation) if formation else 0.0
        information_discreteness = (1 if r12_1 >= 0 else -1) * (negative - positive)

        beta_residual = None
        if len(paired) >= 150:
            denominator = sum(market * market for _, market in paired)
            beta = sum(stock * market for stock, market in paired) / denominator if denominator > 0 else 0.0
            residuals = [stock - beta * market for stock, market in paired]
            residual_vol = stdev(residuals)
            if residual_vol and residual_vol > 0:
                beta_residual = sum(residuals) / residual_vol / math.sqrt(len(residuals))

        return {
            "symbol": symbol,
            "ticker": symbol.value,
            "r3": r3,
            "r6": r6,
            "r12_1": r12_1,
            "intermediate": intermediate,
            "vol60": vol60,
            "above200": closes[-1] >= ma200,
            "id": information_discreteness,
            "beta_residual": beta_residual,
        }

    def score_rows(self, rows):
        p3 = percentile_map(rows, "r3")
        p6 = percentile_map(rows, "r6")
        p12 = percentile_map(rows, "r12_1")
        pintermediate = percentile_map(rows, "intermediate")
        plow_vol = percentile_map(rows, "vol60", higher=False)
        presidual = percentile_map(rows, "beta_residual")
        psmooth = percentile_map(rows, "id", higher=False)

        for row in rows:
            symbol = row["symbol"]
            blend = 0.20 * p3.get(symbol, 0) + 0.35 * p6.get(symbol, 0) + 0.45 * p12.get(symbol, 0)
            row["scores"] = {
                "M12_1": p12.get(symbol, 0),
                "BLEND": blend,
                "INTERMEDIATE": pintermediate.get(symbol, 0),
                "RISK": 0.80 * blend + 0.20 * plow_vol.get(symbol, 0),
                "BETA_RESID": presidual.get(symbol, 0),
                "SMOOTH": 0.75 * blend + 0.25 * psmooth.get(symbol, 0),
            }

    def create_signal(self, date):
        members = (
            self.membership_history[-1 - MEMBERSHIP_LAG_DAYS][1]
            if len(self.membership_history) > MEMBERSHIP_LAG_DAYS
            else set(self.qqq_members)
        )
        qqq_returns = self.qqq_return_map()
        qqq_metric = self.metric_for(self.qqq, qqq_returns)
        if not members or not qqq_metric:
            self.debug(f"SIGNAL_FAIL|{date}|members={len(members)}|qqq={int(bool(qqq_metric))}")
            return

        rows = []
        for symbol in sort_symbols(members):
            metric = self.metric_for(symbol, qqq_returns)
            if metric:
                rows.append(metric)
        if len(rows) < 20:
            self.debug(f"SIGNAL_FAIL|{date}|eligible={len(rows)}")
            return
        self.score_rows(rows)

        selections = {}
        for score in SCORE_KEYS:
            for filter_key in FILTER_KEYS:
                if filter_key == "ALL":
                    eligible = rows
                elif filter_key == "MA200":
                    eligible = [row for row in rows if row["above200"]]
                else:
                    eligible = [
                        row for row in rows
                        if row["above200"]
                        and row["r6"] > qqq_metric["r6"]
                        and row["r12_1"] > 0
                    ]
                ranked = sorted(
                    eligible,
                    key=lambda row: (-row["scores"][score], row["ticker"], str(row["symbol"].id)),
                )
                for size in SIZES:
                    key = f"{score}__{filter_key}__N{size}"
                    selections[key] = [row["symbol"] for row in ranked[:size]]

        self.pending = {"signal_date": date, "selections": selections}
        self.signal_count += 1

    def ensure_manual(self, symbol):
        if symbol == self.qqq:
            return symbol
        if symbol in self.manual_symbols:
            return self.manual_symbols[symbol]
        manual = self.add_equity(
            symbol.value,
            Resolution.DAILY,
            data_normalization_mode=DataNormalizationMode.ADJUSTED,
        ).symbol
        self.manual_symbols[symbol] = manual
        if manual != symbol and symbol in self.latest_prices:
            self.latest_prices[manual] = self.latest_prices[symbol]
        return manual

    def price_for(self, symbol):
        price = self.latest_prices.get(symbol)
        return float(price) if finite(price) and price > 0 else None

    def account_equity(self, account):
        value = account["cash"]
        for symbol, shares in account["positions"].items():
            price = self.price_for(symbol)
            if price:
                value += shares * price
        return value

    def sell_value(self, account, symbol, gross_value, price=None):
        shares = account["positions"].get(symbol, 0.0)
        price = price if finite(price) and price > 0 else self.price_for(symbol)
        if shares <= 0 or not price:
            return
        sell_shares = min(shares, gross_value / price)
        gross = sell_shares * price
        fee = gross * COST_RATE
        account["cash"] += gross - fee
        account["fees"] += fee
        account["turnover"] += gross
        account["trade_count"] += 1
        remaining = shares - sell_shares
        if remaining <= 1e-10:
            account["positions"].pop(symbol, None)
        else:
            account["positions"][symbol] = remaining

    def buy_value(self, account, symbol, gross_value):
        price = self.price_for(symbol)
        if not price or gross_value <= 0:
            return
        gross = min(gross_value, account["cash"] / (1 + COST_RATE))
        if gross <= 0:
            return
        fee = gross * COST_RATE
        account["cash"] -= gross + fee
        account["fees"] += fee
        account["turnover"] += gross
        account["trade_count"] += 1
        account["positions"][symbol] = account["positions"].get(symbol, 0.0) + gross / price

    def rebalance_equal(self, account, selected, date):
        selected = [self.ensure_manual(symbol) for symbol in selected]
        size = account["size"]
        target_weights = defaultdict(float)
        for symbol in selected[:size]:
            target_weights[symbol] += 1.0 / size
        missing = size - min(size, len(selected))
        if missing > 0:
            target_weights[self.qqq] += missing / size

        equity = self.account_equity(account)
        if equity <= 0:
            return
        for symbol in list(account["positions"]):
            price = self.price_for(symbol)
            if not price:
                continue
            current = account["positions"][symbol] * price
            desired = equity * target_weights.get(symbol, 0.0)
            if current > desired:
                self.sell_value(account, symbol, current - desired)

        equity_after_sales = self.account_equity(account)
        deficits = []
        for symbol, weight in target_weights.items():
            price = self.price_for(symbol)
            if not price:
                continue
            current = account["positions"].get(symbol, 0.0) * price
            desired = equity_after_sales * weight
            if desired > current:
                deficits.append((symbol, desired - current))
        wanted = sum(value for _, value in deficits)
        budget = min(wanted, account["cash"] / (1 + COST_RATE))
        scale = budget / wanted if wanted > 0 else 0.0
        for symbol, value in deficits:
            self.buy_value(account, symbol, value * scale)

        account["first_date"] = account["first_date"] or date
        account["last_selection"] = [symbol.value for symbol in selected[:size]]
        post_equity = self.account_equity(account)
        account["cash_ratios"].append(account["cash"] / post_equity if post_equity > 0 else 0.0)
        self.update_max_weight(account)

    def update_max_weight(self, account):
        equity = self.account_equity(account)
        if equity <= 0:
            return
        for symbol, shares in account["positions"].items():
            price = self.price_for(symbol)
            if price:
                account["max_weight"] = max(account["max_weight"], shares * price / equity)

    def execute_pending(self, date):
        for key, selected in self.pending["selections"].items():
            self.rebalance_equal(self.accounts[key], selected, date)
        self.pending = None

    def mark_accounts(self, date):
        for account in self.accounts.values():
            if account["first_date"] is None:
                continue
            equity = self.account_equity(account)
            if account["curve"] and account["curve"][-1][0] == date:
                account["curve"][-1] = (date, equity)
            else:
                account["curve"].append((date, equity))
            self.update_max_weight(account)

    def on_delistings(self, delistings):
        for symbol, event in delistings.items():
            if event.type != DelistingType.WARNING:
                continue
            used = False
            for account in self.accounts.values():
                shares = account["positions"].get(symbol, 0.0)
                if shares > 0:
                    self.sell_value(account, symbol, shares * float(event.price), float(event.price))
                    used = True
            if used:
                self.delisting_records.append(f"{symbol.value}@{self.time:%Y-%m-%d}")

    def values_between(self, rows, start, end):
        return [(date, value) for date, value in rows if start <= date <= end and finite(value) and value > 0]

    def segment_stats(self, account, start, end):
        rows = self.values_between(account["curve"], start, end)
        if len(rows) < 2:
            return None
        first_date, first = rows[0]
        last_date, last = rows[-1]
        total_return = last / first - 1
        years = max((last_date - first_date).days / 365.25, 1 / 365.25)
        cagr = (last / first) ** (1 / years) - 1
        peak = first
        mdd = 0.0
        for _, value in rows:
            peak = max(peak, value)
            mdd = min(mdd, value / peak - 1)
        return {"return": total_return, "cagr": cagr, "mdd": mdd}

    def qqq_segment(self, start, end):
        rows = [row for row in self.qqq_full if start <= row["date"] <= end and row["close"] > 0]
        if len(rows) < 2:
            return None
        first = rows[0]
        last = rows[-1]
        growth = last["close"] / first["close"] / (1 + COST_RATE)
        total_return = growth - 1
        years = max((last["date"] - first["date"]).days / 365.25, 1 / 365.25)
        cagr = growth ** (1 / years) - 1
        peak = first["close"]
        mdd = 0.0
        for row in rows:
            peak = max(peak, row["close"])
            mdd = min(mdd, row["close"] / peak - 1)
        return {"return": total_return, "cagr": cagr, "mdd": mdd}

    def utility(self, strategy, benchmark):
        if not strategy or not benchmark:
            return -999.0
        excess_cagr = strategy["cagr"] - benchmark["cagr"]
        drawdown_edge = strategy["mdd"] - benchmark["mdd"]
        return excess_cagr + 0.25 * drawdown_edge

    def on_end_of_algorithm(self):
        design_benchmark = self.qqq_segment(DESIGN_START, DESIGN_END)
        validate_benchmark = self.qqq_segment(VALIDATE_START, VALIDATE_END)
        design_rows = []
        for key, account in self.accounts.items():
            design = self.segment_stats(account, DESIGN_START, DESIGN_END)
            validate = self.segment_stats(account, VALIDATE_START, VALIDATE_END)
            design_rows.append({
                "key": key,
                "account": account,
                "design": design,
                "validate": validate,
                "design_utility": self.utility(design, design_benchmark),
            })
        design_rows.sort(key=lambda row: (-row["design_utility"], row["key"]))
        design_top = design_rows[:15]
        validate_rows = []
        for row in design_top:
            row["validate_utility"] = self.utility(row["validate"], validate_benchmark)
            validate_rows.append(row)
        validate_rows.sort(key=lambda row: (-row["validate_utility"], row["key"]))
        finalists = validate_rows[:5]

        last_price_date = self.qqq_full[-1]["date"] if self.qqq_full else None
        self.debug(
            f"QQQ_META|stage=1|signals={self.signal_count}|accounts={len(self.accounts)}|"
            f"ever={len(self.ever_members)}|last={last_price_date}|cost={COST_RATE:.4f}|"
            f"membership_lag={MEMBERSHIP_LAG_DAYS}|delist={len(set(self.delisting_records))}"
        )
        self.debug(
            f"QQQ_BENCH|DESIGN={design_benchmark['return']:.4f}/{design_benchmark['cagr']:.4f}/{design_benchmark['mdd']:.4f}|"
            f"VALIDATE={validate_benchmark['return']:.4f}/{validate_benchmark['cagr']:.4f}/{validate_benchmark['mdd']:.4f}"
        )
        for rank, row in enumerate(design_top, 1):
            stats = row["design"]
            self.debug(
                f"QQQ_DESIGN|rank={rank}|key={row['key']}|ret={stats['return']:.4f}|"
                f"cagr={stats['cagr']:.4f}|mdd={stats['mdd']:.4f}|utility={row['design_utility']:.4f}"
            )
        for rank, row in enumerate(validate_rows, 1):
            stats = row["validate"]
            self.debug(
                f"QQQ_VALIDATE|rank={rank}|key={row['key']}|ret={stats['return']:.4f}|"
                f"cagr={stats['cagr']:.4f}|mdd={stats['mdd']:.4f}|utility={row['validate_utility']:.4f}"
            )
        for rank, row in enumerate(finalists, 1):
            account = row["account"]
            design = row["design"]
            validate = row["validate"]
            cash_average = average(account["cash_ratios"]) or 0.0
            self.debug(
                f"QQQ_FINALIST|rank={rank}|key={row['key']}|"
                f"design={design['return']:.4f}/{design['mdd']:.4f}|"
                f"validate={validate['return']:.4f}/{validate['mdd']:.4f}|"
                f"fees={account['fees']:.0f}|trades={account['trade_count']}|"
                f"turnover={account['turnover'] / INITIAL_CAPITAL:.2f}|cash_avg={cash_average:.4f}|"
                f"max_weight={account['max_weight']:.4f}|picks={','.join(account['last_selection'])}"
            )


class Main(QqqMomentumStage1):
    pass
