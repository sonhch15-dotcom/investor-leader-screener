from AlgorithmImports import *
from collections import defaultdict, deque
from datetime import datetime
import math

from qqq_momentum_stage1 import average, finite, percentile_map, sort_symbols, stdev
from qqq_momentum_stage3 import QqqMomentumStage3


INITIAL_CAPITAL = 100_000_000.0
COST_RATE = 0.0025
MEMBERSHIP_LAG_DAYS = 5
FIRST_SIGNAL = datetime(2010, 8, 27)
DEVELOP_START = datetime(2010, 8, 27).date()
DEVELOP_END = datetime(2021, 12, 31).date()
VALIDATE_START = datetime(2022, 1, 1).date()
VALIDATE_END = datetime(2024, 12, 31).date()
SIZES = list(range(5, 21))
SELECTION_MODES = ["BASE", "EMERGE"]
WEIGHT_MODES = ["EQUAL", "LEADER"]
CORRELATION_MODES = ["NONE", "CORR85"]
WINDOWS = [
    ("W1", datetime(2010, 8, 27).date(), datetime(2014, 12, 31).date()),
    ("W2", datetime(2015, 1, 1).date(), datetime(2018, 12, 31).date()),
    ("W3", datetime(2019, 1, 1).date(), datetime(2021, 12, 31).date()),
    ("W4", datetime(2022, 1, 1).date(), datetime(2024, 12, 31).date()),
]


class QqqImprovementStage1(QqqMomentumStage3):
    def initialize(self):
        self.set_start_date(2009, 6, 1)
        self.set_end_date(2024, 12, 31)
        self.set_cash(100_000)
        self.set_time_zone(TimeZones.NEW_YORK)

        self.universe_settings.resolution = Resolution.DAILY
        self.universe_settings.data_normalization_mode = DataNormalizationMode.ADJUSTED
        self.universe_settings.asynchronous = False

        self.rows = defaultdict(lambda: deque(maxlen=400))
        self.latest_prices = {}
        self.execution_prices = {}
        self.qqq_full = []
        self.qqq_members = set()
        self.qqq_weights = {}
        self.ever_members = set()
        self.membership_history = deque(maxlen=20)
        self.weight_history = deque(maxlen=20)
        self.manual_symbols = {}
        self.pending = None
        self.last_signal_month = None
        self.signal_count = 0
        self.delisting_records = []

        self.accounts = {}
        for selection_mode in SELECTION_MODES:
            for size in SIZES:
                for weight_mode in WEIGHT_MODES:
                    for correlation_mode in CORRELATION_MODES:
                        key = (
                            f"{selection_mode}__N{size}__{weight_mode}__"
                            f"{correlation_mode}"
                        )
                        account = self.new_stage2_account(
                            key, "M12_1", "DUAL", size, weight_mode
                        )
                        account.update({
                            "selection_mode": selection_mode,
                            "weight_mode": weight_mode,
                            "correlation_mode": correlation_mode,
                            "cost_rate": COST_RATE,
                            "last_established": [],
                            "last_emerging": [],
                            "shortfall_months": 0,
                        })
                        self.accounts[key] = account

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

    def on_data(self, data):
        date = self.time.date()
        if self.qqq_members and (
            not self.membership_history or self.membership_history[-1][0] != date
        ):
            self.membership_history.append((date, set(self.qqq_members)))
        if self.qqq_weights and (
            not self.weight_history or self.weight_history[-1][0] != date
        ):
            self.weight_history.append((date, dict(self.qqq_weights)))

        self.execution_prices = {}
        for symbol, bar in data.bars.items():
            row = {
                "date": date,
                "open": float(bar.open),
                "close": float(bar.close),
                "volume": float(bar.volume),
            }
            history = self.rows[symbol]
            if not history or history[-1]["date"] != date:
                history.append(row)
            self.latest_prices[symbol] = row["close"]
            self.execution_prices[symbol] = row["open"]
            if symbol == self.qqq and (
                not self.qqq_full or self.qqq_full[-1]["date"] != date
            ):
                self.qqq_full.append(row)

        if self.pending and date > self.pending["signal_date"] and self.qqq in data.bars:
            self.execute_pending(date)
        self.mark_accounts(date)

    def metric_for(self, symbol, qqq_returns):
        metric = super().metric_for(symbol, qqq_returns)
        if not metric:
            return None
        rows = list(self.rows.get(symbol, []))
        returns = {}
        for index in range(max(1, len(rows) - 121), len(rows)):
            previous = rows[index - 1]["close"]
            current = rows[index]["close"]
            if previous > 0 and current > 0:
                returns[rows[index]["date"]] = math.log(current / previous)
        metric["returns120"] = returns
        return metric

    def score_rows(self, rows):
        super().score_rows(rows)
        p3 = percentile_map(rows, "r3")
        p6 = percentile_map(rows, "r6")
        p12 = percentile_map(rows, "r12_1")
        for row in rows:
            symbol = row["symbol"]
            row["p3"] = p3.get(symbol, 0.0)
            row["p6"] = p6.get(symbol, 0.0)
            row["p12"] = p12.get(symbol, 0.0)
            row["emerge_score"] = (
                0.60 * row["p3"]
                + 0.40 * row["p6"]
                + 0.20 * max(0.0, row["p3"] - row["p12"])
            )

    def pair_correlation(self, left, right):
        shared = sorted(set(left["returns120"]) & set(right["returns120"]))
        if len(shared) < 80:
            return 0.0
        x = [left["returns120"][date] for date in shared]
        y = [right["returns120"][date] for date in shared]
        x_mean = sum(x) / len(x)
        y_mean = sum(y) / len(y)
        numerator = sum((a - x_mean) * (b - y_mean) for a, b in zip(x, y))
        x_scale = math.sqrt(sum((a - x_mean) ** 2 for a in x))
        y_scale = math.sqrt(sum((b - y_mean) ** 2 for b in y))
        denominator = x_scale * y_scale
        return numerator / denominator if denominator > 0 else 0.0

    def correlation_selection(self, candidates, size, chosen=None):
        selected = list(chosen or [])
        selected_symbols = {row["symbol"] for row in selected}
        output = []
        for row in candidates:
            if row["symbol"] in selected_symbols:
                continue
            if any(self.pair_correlation(row, prior) > 0.85 for prior in selected):
                continue
            selected.append(row)
            selected_symbols.add(row["symbol"])
            output.append(row)
            if len(output) >= size:
                break
        return output

    def choose_rows(self, account, ranked):
        size = account["size"]
        use_correlation = account["correlation_mode"] == "CORR85"
        if account["selection_mode"] == "BASE":
            selected = (
                self.correlation_selection(ranked, size)
                if use_correlation
                else ranked[:size]
            )
            return selected, selected, []

        established_count = int(math.ceil(size * 0.70))
        emerging_count = size - established_count
        established = (
            self.correlation_selection(ranked, established_count)
            if use_correlation
            else ranked[:established_count]
        )
        established_symbols = {row["symbol"] for row in established}
        emerging_ranked = sorted(
            [
                row for row in ranked
                if row["symbol"] not in established_symbols
                and row["p3"] > row["p12"]
            ],
            key=lambda row: (
                -row["emerge_score"],
                row["ticker"],
                str(row["symbol"].id),
            ),
        )
        emerging = (
            self.correlation_selection(
                emerging_ranked, emerging_count, chosen=established
            )
            if use_correlation
            else emerging_ranked[:emerging_count]
        )

        selected = established + emerging
        selected_symbols = {row["symbol"] for row in selected}
        for row in ranked:
            if len(selected) >= size:
                break
            if row["symbol"] in selected_symbols:
                continue
            if use_correlation and any(
                self.pair_correlation(row, prior) > 0.85 for prior in selected
            ):
                continue
            selected.append(row)
            established.append(row)
            selected_symbols.add(row["symbol"])
        return selected, established, emerging

    def create_signal(self, date):
        members = (
            self.membership_history[-1 - MEMBERSHIP_LAG_DAYS][1]
            if len(self.membership_history) > MEMBERSHIP_LAG_DAYS
            else set(self.qqq_members)
        )
        weights = (
            self.weight_history[-1 - MEMBERSHIP_LAG_DAYS][1]
            if len(self.weight_history) > MEMBERSHIP_LAG_DAYS
            else dict(self.qqq_weights)
        )
        qqq_returns = self.qqq_return_map()
        qqq_metric = self.metric_for(self.qqq, qqq_returns)
        if not members or not qqq_metric:
            self.debug(f"I1_SIGNAL_FAIL|{date}|members={len(members)}")
            return

        rows = []
        for symbol in sort_symbols(members):
            metric = self.metric_for(symbol, qqq_returns)
            if metric:
                metric["index_weight"] = max(0.0, weights.get(symbol, 0.0))
                rows.append(metric)
        self.score_rows(rows)
        eligible = [
            row for row in rows
            if row["above200"]
            and row["r6"] > qqq_metric["r6"]
            and row["r12_1"] > 0
        ]
        ranked = sorted(
            eligible,
            key=lambda row: (
                -row["scores"]["M12_1"],
                row["ticker"],
                str(row["symbol"].id),
            ),
        )

        selections = {}
        for key, account in self.accounts.items():
            selected, established, emerging = self.choose_rows(account, ranked)
            selections[key] = {
                "selected": selected,
                "established": established,
                "emerging": emerging,
            }
            if account["first_date"] is None:
                account["first_date"] = date
                account["curve"].append((date, account["cash"]))
        self.pending = {"signal_date": date, "selections": selections}
        self.signal_count += 1

    def trade_price_for(self, symbol):
        price = self.execution_prices.get(symbol)
        if finite(price) and price > 0:
            return float(price)
        return self.price_for(symbol)

    def account_equity_at_trade(self, account):
        value = account["cash"]
        for symbol, shares in account["positions"].items():
            price = self.trade_price_for(symbol)
            if price:
                value += shares * price
        return value

    def sell_value(self, account, symbol, gross_value, price=None):
        shares = account["positions"].get(symbol, 0.0)
        price = price if finite(price) and price > 0 else self.trade_price_for(symbol)
        if shares <= 0 or not price:
            return
        sell_shares = min(shares, gross_value / price)
        gross = sell_shares * price
        fee = gross * account.get("cost_rate", COST_RATE)
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
        price = self.trade_price_for(symbol)
        if not price or gross_value <= 0:
            return
        cost_rate = account.get("cost_rate", COST_RATE)
        gross = min(gross_value, account["cash"] / (1 + cost_rate))
        if gross <= 0:
            return
        fee = gross * cost_rate
        account["cash"] -= gross + fee
        account["fees"] += fee
        account["turnover"] += gross
        account["trade_count"] += 1
        account["positions"][symbol] = (
            account["positions"].get(symbol, 0.0) + gross / price
        )

    def capped_group(self, rows, budget, blended):
        if not rows or budget <= 0:
            return {}, budget
        index_total = sum(max(0.0, row["index_weight"]) for row in rows)
        raw = {}
        for row in rows:
            equal = 1.0 / len(rows)
            index_weight = (
                max(0.0, row["index_weight"]) / index_total
                if index_total > 0 else equal
            )
            raw[row["symbol"]] = (
                0.50 * equal + 0.50 * index_weight if blended else equal
            )

        targets = defaultdict(float)
        remaining = dict(raw)
        unallocated = budget
        while remaining and unallocated > 1e-12:
            denominator = sum(remaining.values())
            proposed = {
                symbol: unallocated * value / denominator
                for symbol, value in remaining.items()
            }
            over = [symbol for symbol, value in proposed.items() if value > 0.15]
            if not over:
                for symbol, value in proposed.items():
                    targets[symbol] += value
                unallocated = 0.0
                break
            for symbol in over:
                targets[symbol] += 0.15
                unallocated -= 0.15
                remaining.pop(symbol)
        return dict(targets), max(0.0, unallocated)

    def target_weights(self, account, bundle):
        selected = bundle["selected"][:account["size"]]
        targets = defaultdict(float)
        targets[self.qqq] = 0.25
        if account["weight_mode"] == "EQUAL":
            for row in selected:
                targets[row["symbol"]] += 0.75 / account["size"]
            targets[self.qqq] += 0.75 * (account["size"] - len(selected)) / account["size"]
            return targets

        if account["selection_mode"] == "BASE":
            group_targets, unused = self.capped_group(selected, 0.75, True)
            for symbol, weight in group_targets.items():
                targets[symbol] += weight
            targets[self.qqq] += unused
            return targets

        selected_symbols = {row["symbol"] for row in selected}
        established = [
            row for row in bundle["established"]
            if row["symbol"] in selected_symbols
        ]
        emerging = [
            row for row in bundle["emerging"]
            if row["symbol"] in selected_symbols
        ]
        established_targets, unused_established = self.capped_group(
            established, 0.60, True
        )
        emerging_targets, unused_emerging = self.capped_group(
            emerging, 0.15, False
        )
        for symbol, weight in established_targets.items():
            targets[symbol] += weight
        for symbol, weight in emerging_targets.items():
            targets[symbol] += weight
        targets[self.qqq] += unused_established + unused_emerging
        return targets

    def rebalance_account(self, account, raw_targets, date, bundle):
        target_weights = defaultdict(float)
        for symbol, weight in raw_targets.items():
            if weight > 0:
                target_weights[symbol] += float(weight)
        total = sum(target_weights.values())
        cash_weight = max(0.0, min(1.0, account.get("target_cash_weight", 0.0)))
        if total + cash_weight < 1.0 - 1e-9:
            target_weights[self.qqq] += 1.0 - total - cash_weight

        equity = self.account_equity_at_trade(account)
        if equity <= 0:
            return
        for symbol in list(account["positions"]):
            price = self.trade_price_for(symbol)
            if not price:
                continue
            current = account["positions"][symbol] * price
            desired = equity * target_weights.get(symbol, 0.0)
            if current > desired:
                self.sell_value(account, symbol, current - desired, price)

        equity_after_sales = self.account_equity_at_trade(account)
        deficits = []
        for symbol, weight in target_weights.items():
            price = self.trade_price_for(symbol)
            if not price:
                continue
            current = account["positions"].get(symbol, 0.0) * price
            desired = equity_after_sales * weight
            if desired > current:
                deficits.append((symbol, desired - current))
        wanted = sum(value for _, value in deficits)
        cost_rate = account.get("cost_rate", COST_RATE)
        cash_reserve = equity_after_sales * cash_weight
        available_cash = max(0.0, account["cash"] - cash_reserve)
        budget = min(wanted, available_cash / (1 + cost_rate))
        scale = budget / wanted if wanted > 0 else 0.0
        for symbol, value in deficits:
            self.buy_value(account, symbol, value * scale)

        account["first_date"] = account["first_date"] or date
        account["last_selection"] = [
            row["ticker"] for row in bundle["selected"][:account["size"]]
        ]
        account["last_established"] = [row["ticker"] for row in bundle["established"]]
        account["last_emerging"] = [row["ticker"] for row in bundle["emerging"]]
        if len(bundle["selected"]) < account["size"]:
            account["shortfall_months"] += 1
        post_equity = self.account_equity(account)
        account["cash_ratios"].append(
            account["cash"] / post_equity if post_equity > 0 else 0.0
        )
        self.update_max_weight(account)

    def execute_pending(self, date):
        for key, bundle in self.pending["selections"].items():
            account = self.accounts[key]
            self.rebalance_account(
                account, self.target_weights(account, bundle), date, bundle
            )
        self.pending = None

    def qqq_segment(self, start, end):
        rows = [
            row for row in self.qqq_full
            if start <= row["date"] <= end and row["close"] > 0
        ]
        if len(rows) < 2:
            return None
        first = rows[0]
        last = rows[-1]
        growth = last["close"] / first["close"] / (1 + COST_RATE)
        years = max((last["date"] - first["date"]).days / 365.25, 1 / 365.25)
        peak = first["close"]
        mdd = 0.0
        for row in rows:
            peak = max(peak, row["close"])
            mdd = min(mdd, row["close"] / peak - 1)
        return {
            "return": growth - 1,
            "cagr": growth ** (1 / years) - 1,
            "mdd": mdd,
        }

    def robust_score(self, stats, benchmarks):
        dev_excess = stats["DEV"]["cagr"] - benchmarks["DEV"]["cagr"]
        val_excess = stats["VAL"]["cagr"] - benchmarks["VAL"]["cagr"]
        val_mdd_gap = stats["VAL"]["mdd"] - benchmarks["VAL"]["mdd"]
        window_excess = [
            stats[name]["cagr"] - benchmarks[name]["cagr"]
            for name, _, _ in WINDOWS
        ]
        return (
            min(dev_excess, val_excess)
            + 0.35 * min(window_excess)
            + 0.25 * min(0.0, val_mdd_gap)
        )

    def on_end_of_algorithm(self):
        periods = {
            "DEV": (DEVELOP_START, DEVELOP_END),
            "VAL": (VALIDATE_START, VALIDATE_END),
        }
        periods.update({name: (start, end) for name, start, end in WINDOWS})
        benchmarks = {
            name: self.qqq_segment(start, end)
            for name, (start, end) in periods.items()
        }
        ranked = []
        for key, account in self.accounts.items():
            stats = {
                name: self.segment_stats(account, start, end)
                for name, (start, end) in periods.items()
            }
            score = self.robust_score(stats, benchmarks)
            dev_excess = stats["DEV"]["cagr"] - benchmarks["DEV"]["cagr"]
            val_excess = stats["VAL"]["cagr"] - benchmarks["VAL"]["cagr"]
            dev_gap = stats["DEV"]["mdd"] - benchmarks["DEV"]["mdd"]
            val_gap = stats["VAL"]["mdd"] - benchmarks["VAL"]["mdd"]
            accepted = (
                dev_excess > 0
                and val_excess > 0
                and dev_gap >= -0.05
                and val_gap >= -0.05
            )
            target_met = (
                dev_excess >= 0.05
                and val_excess >= 0.05
                and dev_gap >= -0.05
                and val_gap >= -0.05
            )
            ranked.append((score, key, account, stats, accepted, target_met))
        ranked.sort(key=lambda item: (-item[0], item[1]))

        bench_text = "|".join(
            f"{name}={stats['cagr']:.4f}/{stats['mdd']:.4f}"
            for name, stats in benchmarks.items()
        )
        self.debug(
            f"I1_META|signals={self.signal_count}|accounts={len(self.accounts)}|"
            f"ever={len(self.ever_members)}|cost={COST_RATE:.4f}|"
            f"execution=NEXT_OPEN|lag={MEMBERSHIP_LAG_DAYS}|"
            f"last={self.qqq_full[-1]['date'] if self.qqq_full else None}|"
            f"delist={len(set(self.delisting_records))}"
        )
        self.debug(f"I1_BENCH|{bench_text}")
        self.set_summary_statistic(
            "I1 Benchmark",
            f"DEV {benchmarks['DEV']['cagr']:.2%}/{benchmarks['DEV']['mdd']:.2%}; "
            f"VAL {benchmarks['VAL']['cagr']:.2%}/{benchmarks['VAL']['mdd']:.2%}",
        )
        for rank, (score, key, account, stats, accepted, target_met) in enumerate(
            ranked[:30], 1
        ):
            windows = ";".join(
                f"{name}:{stats[name]['cagr']:.4f}/{stats[name]['mdd']:.4f}"
                for name, _, _ in WINDOWS
            )
            self.debug(
                f"I1_RANK|rank={rank}|key={key}|accepted={int(accepted)}|"
                f"target={int(target_met)}|score={score:.4f}|"
                f"dev={stats['DEV']['cagr']:.4f}/{stats['DEV']['mdd']:.4f}|"
                f"val={stats['VAL']['cagr']:.4f}/{stats['VAL']['mdd']:.4f}|"
                f"windows={windows}|fees={account['fees']:.0f}|"
                f"turnover={account['turnover'] / INITIAL_CAPITAL:.2f}|"
                f"cash={average(account['cash_ratios']) or 0.0:.4f}|"
                f"maxw={account['max_weight']:.4f}|"
                f"shortfall={account['shortfall_months']}|"
                f"picks={','.join(account['last_selection'])}"
            )
            if rank <= 5:
                self.set_summary_statistic(
                    f"I1 Top {rank}",
                    f"{key}; DEV {stats['DEV']['cagr']:.2%}/{stats['DEV']['mdd']:.2%}; "
                    f"VAL {stats['VAL']['cagr']:.2%}/{stats['VAL']['mdd']:.2%}",
                )

        for size in SIZES:
            subset = [item for item in ranked if item[2]["size"] == size]
            best = subset[0]
            _, key, _, stats, accepted, target_met = best
            self.debug(
                f"I1_SIZE|n={size}|key={key}|accepted={int(accepted)}|"
                f"target={int(target_met)}|dev={stats['DEV']['cagr']:.4f}/"
                f"{stats['DEV']['mdd']:.4f}|val={stats['VAL']['cagr']:.4f}/"
                f"{stats['VAL']['mdd']:.4f}"
            )
            self.set_summary_statistic(
                f"I1 N{size:02d}",
                f"{key}; DEV {stats['DEV']['cagr']:.2%}/{stats['DEV']['mdd']:.2%}; "
                f"VAL {stats['VAL']['cagr']:.2%}/{stats['VAL']['mdd']:.2%}",
            )


class Main(QqqImprovementStage1):
    pass
