from AlgorithmImports import *
from collections import defaultdict, deque
from datetime import datetime
import calendar
import math

from qqq_momentum_stage1 import average, finite, sort_symbols
from qqq_improvement_stage1 import (
    COST_RATE,
    DEVELOP_END,
    DEVELOP_START,
    FIRST_SIGNAL,
    INITIAL_CAPITAL,
    MEMBERSHIP_LAG_DAYS,
    VALIDATE_END,
    VALIDATE_START,
    WINDOWS,
    QqqImprovementStage1,
)


PROFILES = [
    ("N9_BASE_CORR", 9, "BASE", "LEADER", "CORR85"),
    ("N12_EMERGE_CORR", 12, "EMERGE", "LEADER", "CORR85"),
]
REBALANCE_MODES = ["STRICT", "BUFFER2"]
REENTRY_MODES = ["IMMEDIATE", "WAIT1"]


class QqqImprovementStage2(QqqImprovementStage1):
    def initialize(self):
        super().initialize()
        self.accounts = {}
        for profile, size, selection_mode, weight_mode, correlation_mode in PROFILES:
            for rebalance_mode in REBALANCE_MODES:
                for reentry_mode in REENTRY_MODES:
                    key = f"{profile}__{rebalance_mode}__{reentry_mode}"
                    account = self.new_stage2_account(
                        key, "M12_1", "DUAL", size, weight_mode
                    )
                    account.update({
                        "profile": profile,
                        "selection_mode": selection_mode,
                        "weight_mode": weight_mode,
                        "correlation_mode": correlation_mode,
                        "rebalance_mode": rebalance_mode,
                        "reentry_mode": reentry_mode,
                        "cost_rate": COST_RATE,
                        "last_established": [],
                        "last_emerging": [],
                        "shortfall_months": 0,
                        "outside_counts": defaultdict(int),
                        "blocked_until": {},
                        "emerging_age": {},
                        "weekly_exits": 0,
                        "rank_exits": 0,
                        "emerging_exits": 0,
                        "support_tickers": set(),
                    })
                    self.accounts[key] = account
        self.pending_weekly_exits = None
        self.month_index = 0

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

        if self.pending_weekly_exits and date > self.pending_weekly_exits["signal_date"]:
            self.execute_weekly_exits()
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
        self.create_weekly_exits(date)
        month = (date.year, date.month)
        last_friday = self.last_friday(date.year, date.month)
        if (
            date <= last_friday
            and (last_friday - date).days <= 4
            and self.last_signal_month != month
        ):
            self.create_signal(date)
            self.last_signal_month = month

    def below_ma200(self, symbol):
        rows = list(self.rows.get(symbol, []))
        if len(rows) < 200:
            return False
        closes = [row["close"] for row in rows[-200:]]
        return closes[-1] < sum(closes) / len(closes)

    def create_weekly_exits(self, date):
        exits = {}
        for key, account in self.accounts.items():
            symbols = [
                symbol for symbol, shares in account["positions"].items()
                if symbol != self.qqq
                and symbol.value not in account.get("support_tickers", set())
                and shares > 0
                and self.below_ma200(symbol)
            ]
            if symbols:
                exits[key] = symbols
        self.pending_weekly_exits = (
            {"signal_date": date, "accounts": exits} if exits else None
        )

    def block_symbol(self, account, symbol):
        ticker = symbol.value
        account["emerging_age"].pop(ticker, None)
        account["outside_counts"].pop(ticker, None)
        if account["reentry_mode"] == "WAIT1":
            account["blocked_until"][ticker] = self.month_index + 2

    def execute_weekly_exits(self):
        for key, symbols in self.pending_weekly_exits["accounts"].items():
            account = self.accounts[key]
            for symbol in symbols:
                shares = account["positions"].get(symbol, 0.0)
                price = self.trade_price_for(symbol)
                if shares <= 0 or not price:
                    continue
                self.sell_value(account, symbol, shares * price, price)
                self.block_symbol(account, symbol)
                account["weekly_exits"] += 1
            self.buy_value(account, self.qqq, account["cash"] / (1 + COST_RATE))
        self.pending_weekly_exits = None

    def allowed_ranked(self, account, ranked):
        if account["reentry_mode"] == "IMMEDIATE":
            return ranked
        return [
            row for row in ranked
            if account["blocked_until"].get(row["ticker"], -1) <= self.month_index
        ]

    def established_pool(self, account, ranked):
        count = int(math.ceil(account["size"] * 0.70))
        return {row["ticker"] for row in ranked[:count]}

    def apply_emerging_expiry(self, account, ranked):
        established = self.established_pool(account, ranked)
        expired = {
            ticker for ticker, age in account["emerging_age"].items()
            if age >= 2 and ticker not in established
        }
        return [row for row in ranked if row["ticker"] not in expired], expired

    def buffered_bundle(self, account, ranked, all_rows):
        size = account["size"]
        ranked_by_ticker = {row["ticker"]: row for row in ranked}
        all_by_ticker = {row["ticker"]: row for row in all_rows}
        top2n = {row["ticker"] for row in ranked[: 2 * size]}
        established_pool = self.established_pool(account, ranked)
        current = sorted(
            [
                symbol.value for symbol, shares in account["positions"].items()
                if symbol != self.qqq
                and symbol.value not in account.get("support_tickers", set())
                and shares > 0
            ]
        )

        retained = []
        emerging_exits = set()
        rank_exits = set()
        for ticker in current:
            if ticker in top2n:
                account["outside_counts"][ticker] = 0
            else:
                account["outside_counts"][ticker] += 1
            expired_emerging = (
                account["emerging_age"].get(ticker, 0) >= 2
                and ticker not in established_pool
            )
            expired_rank = account["outside_counts"][ticker] >= 2
            if expired_emerging:
                emerging_exits.add(ticker)
                continue
            if expired_rank:
                rank_exits.add(ticker)
                continue
            row = all_by_ticker.get(ticker)
            if row:
                retained.append(row)

        account["emerging_exits"] += len(emerging_exits)
        account["rank_exits"] += len(rank_exits)
        eligible_ranked = self.allowed_ranked(account, ranked)
        desired, desired_established, desired_emerging = self.choose_rows(
            account, eligible_ranked
        )
        selected = list(retained)
        selected_tickers = {row["ticker"] for row in selected}
        for row in desired + eligible_ranked:
            if len(selected) >= size:
                break
            if row["ticker"] in selected_tickers:
                continue
            if account["correlation_mode"] == "CORR85" and any(
                self.pair_correlation(row, prior) > 0.85 for prior in selected
            ):
                continue
            selected.append(row)
            selected_tickers.add(row["ticker"])

        desired_emerging_tickers = {row["ticker"] for row in desired_emerging}
        emerging = [
            row for row in selected
            if row["ticker"] in desired_emerging_tickers
            or (
                account["emerging_age"].get(row["ticker"], 0) > 0
                and row["ticker"] not in established_pool
            )
        ]
        emerging_tickers = {row["ticker"] for row in emerging}
        established = [row for row in selected if row["ticker"] not in emerging_tickers]
        return {
            "selected": selected,
            "established": established,
            "emerging": emerging,
        }

    def strict_bundle(self, account, ranked):
        adjusted, expired = self.apply_emerging_expiry(account, ranked)
        account["emerging_exits"] += len(
            expired & {
                symbol.value for symbol, shares in account["positions"].items()
                if symbol != self.qqq
                and symbol.value not in account.get("support_tickers", set())
                and shares > 0
            }
        )
        allowed = self.allowed_ranked(account, adjusted)
        selected, established, emerging = self.choose_rows(account, allowed)
        return {
            "selected": selected,
            "established": established,
            "emerging": emerging,
        }

    def update_emerging_age(self, account, bundle):
        emerging = {row["ticker"] for row in bundle["emerging"]}
        selected = {row["ticker"] for row in bundle["selected"]}
        for ticker in list(account["emerging_age"]):
            if ticker not in selected or ticker not in emerging:
                account["emerging_age"].pop(ticker, None)
        for ticker in emerging:
            account["emerging_age"][ticker] = account["emerging_age"].get(ticker, 0) + 1

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
                -row["scores"]["M12_1"], row["ticker"], str(row["symbol"].id)
            ),
        )

        self.month_index += 1
        selections = {}
        for key, account in self.accounts.items():
            bundle = (
                self.buffered_bundle(account, ranked, rows)
                if account["rebalance_mode"] == "BUFFER2"
                else self.strict_bundle(account, ranked)
            )
            self.update_emerging_age(account, bundle)
            selections[key] = bundle
            if account["first_date"] is None:
                account["first_date"] = date
                account["curve"].append((date, account["cash"]))
        self.pending = {"signal_date": date, "selections": selections}
        self.signal_count += 1

    def execute_pending(self, date):
        for key, bundle in self.pending["selections"].items():
            account = self.accounts[key]
            current = {
                symbol for symbol, shares in account["positions"].items()
                if symbol != self.qqq
                and symbol.value not in account.get("support_tickers", set())
                and shares > 0
            }
            target_tickers = {row["ticker"] for row in bundle["selected"]}
            removed = [symbol for symbol in current if symbol.value not in target_tickers]
            self.rebalance_account(
                account, self.target_weights(account, bundle), date, bundle
            )
            for symbol in removed:
                self.block_symbol(account, symbol)
        self.pending = None

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
        self.set_summary_statistic(
            "I2 Benchmark",
            f"DEV {benchmarks['DEV']['cagr']:.2%}/{benchmarks['DEV']['mdd']:.2%}; "
            f"VAL {benchmarks['VAL']['cagr']:.2%}/{benchmarks['VAL']['mdd']:.2%}",
        )

        ranked = []
        for key, account in self.accounts.items():
            stats = {
                name: self.segment_stats(account, start, end)
                for name, (start, end) in periods.items()
            }
            score = self.robust_score(stats, benchmarks)
            ranked.append((score, key, account, stats))
        ranked.sort(key=lambda item: (-item[0], item[1]))

        for rank, (_, key, account, stats) in enumerate(ranked, 1):
            dev_excess = stats["DEV"]["cagr"] - benchmarks["DEV"]["cagr"]
            val_excess = stats["VAL"]["cagr"] - benchmarks["VAL"]["cagr"]
            dev_gap = stats["DEV"]["mdd"] - benchmarks["DEV"]["mdd"]
            val_gap = stats["VAL"]["mdd"] - benchmarks["VAL"]["mdd"]
            accepted = (
                dev_excess > 0 and val_excess > 0
                and dev_gap >= -0.05 and val_gap >= -0.05
            )
            self.set_summary_statistic(
                f"I2 Rank {rank}",
                f"{key}; ok={int(accepted)}; "
                f"DEV {stats['DEV']['cagr']:.2%}/{stats['DEV']['mdd']:.2%}; "
                f"VAL {stats['VAL']['cagr']:.2%}/{stats['VAL']['mdd']:.2%}; "
                f"turn {account['turnover'] / INITIAL_CAPITAL:.1f}x; "
                f"cash {average(account['cash_ratios']) or 0.0:.2%}; "
                f"weekly/rank/emerge {account['weekly_exits']}/"
                f"{account['rank_exits']}/{account['emerging_exits']}",
            )


class Main(QqqImprovementStage2):
    pass
