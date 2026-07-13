from AlgorithmImports import *
from collections import defaultdict

from qqq_improvement_stage1 import (
    DEVELOP_END,
    DEVELOP_START,
    INITIAL_CAPITAL,
    VALIDATE_END,
    VALIDATE_START,
    WINDOWS,
)
from qqq_improvement_stage2 import QqqImprovementStage2


STRESS_CASES = [
    ("OPEN_25BP", "OPEN", 0.0025),
    ("OPEN_50BP", "OPEN", 0.0050),
    ("CLOSE_25BP", "CLOSE", 0.0025),
    ("CLOSE_50BP", "CLOSE", 0.0050),
]


class QqqImprovementStage4Stress(QqqImprovementStage2):
    def initialize(self):
        super().initialize()
        self.accounts = {}
        for key, execution_mode, cost_rate in STRESS_CASES:
            account = self.new_stage2_account(
                key, "M12_1", "DUAL", 9, "LEADER"
            )
            account.update({
                "profile": "N9_BASE_CORR",
                "selection_mode": "BASE",
                "weight_mode": "LEADER",
                "correlation_mode": "CORR85",
                "rebalance_mode": "STRICT",
                "reentry_mode": "IMMEDIATE",
                "execution_mode": execution_mode,
                "cost_rate": cost_rate,
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
        self.active_execution_mode = "OPEN"

    def trade_price_for(self, symbol):
        if self.active_execution_mode == "CLOSE":
            return self.price_for(symbol)
        return super().trade_price_for(symbol)

    def rebalance_account(self, account, raw_targets, date, bundle):
        self.active_execution_mode = account["execution_mode"]
        try:
            super().rebalance_account(account, raw_targets, date, bundle)
        finally:
            self.active_execution_mode = "OPEN"

    def execute_weekly_exits(self):
        for key, symbols in self.pending_weekly_exits["accounts"].items():
            account = self.accounts[key]
            self.active_execution_mode = account["execution_mode"]
            try:
                for symbol in symbols:
                    shares = account["positions"].get(symbol, 0.0)
                    price = self.trade_price_for(symbol)
                    if shares <= 0 or not price:
                        continue
                    self.sell_value(account, symbol, shares * price, price)
                    self.block_symbol(account, symbol)
                    account["weekly_exits"] += 1
                self.buy_value(
                    account,
                    self.qqq,
                    account["cash"] / (1 + account["cost_rate"]),
                )
            finally:
                self.active_execution_mode = "OPEN"
        self.pending_weekly_exits = None

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
            "I4S Benchmark",
            f"DEV {benchmarks['DEV']['cagr']:.2%}/{benchmarks['DEV']['mdd']:.2%}; "
            f"VAL {benchmarks['VAL']['cagr']:.2%}/{benchmarks['VAL']['mdd']:.2%}",
        )

        ranked = []
        for key, account in self.accounts.items():
            stats = {
                name: self.segment_stats(account, start, end)
                for name, (start, end) in periods.items()
            }
            ranked.append((self.robust_score(stats, benchmarks), key, account, stats))
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
            target_met = (
                dev_excess >= 0.05 and val_excess >= 0.05
                and dev_gap >= -0.05 and val_gap >= -0.05
            )
            daily_moves = [
                account["curve"][index][1] / account["curve"][index - 1][1] - 1
                for index in range(1, len(account["curve"]))
                if account["curve"][index - 1][1] > 0
            ]
            self.set_summary_statistic(
                f"I4S Rank {rank}",
                f"{key}; ok={int(accepted)}; target={int(target_met)}; "
                f"DEV {stats['DEV']['cagr']:.2%}/{stats['DEV']['mdd']:.2%}; "
                f"VAL {stats['VAL']['cagr']:.2%}/{stats['VAL']['mdd']:.2%}; "
                f"turn {account['turnover'] / INITIAL_CAPITAL:.1f}x; "
                f"day {max(daily_moves, default=0.0):.1%}/"
                f"{min(daily_moves, default=0.0):.1%}",
            )
            if key == "OPEN_25BP":
                for window_name, _, _ in WINDOWS:
                    self.set_summary_statistic(
                        f"I4W {window_name}",
                        f"STR {stats[window_name]['cagr']:.2%}/"
                        f"{stats[window_name]['mdd']:.2%}; "
                        f"QQQ {benchmarks[window_name]['cagr']:.2%}/"
                        f"{benchmarks[window_name]['mdd']:.2%}",
                    )


class Main(QqqImprovementStage4Stress):
    pass
