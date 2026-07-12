from AlgorithmImports import *
from collections import defaultdict, deque
from datetime import datetime

from qqq_momentum_stage1 import average
from qqq_momentum_stage4 import QqqMomentumStage4


INITIAL_CAPITAL = 100_000_000.0
COST_RATE = 0.001
TRAIN_START = datetime(2010, 8, 27).date()
TRAIN_END = datetime(2024, 12, 31).date()
HOLDOUT_START = datetime(2025, 1, 1).date()
HOLDOUT_END = datetime(2026, 7, 10).date()
POLICIES = {
    "BASE": (0.00, 1.00),
    "CAP20": (0.00, 0.20),
    "CAP25": (0.00, 0.25),
    "CAP30": (0.00, 0.30),
    "CAP35": (0.00, 0.35),
    "CAP40": (0.00, 0.40),
    "CORE25_CAP25": (0.25, 0.25),
    "CORE40_CAP20": (0.40, 0.20),
}


class QqqMomentumStage5(QqqMomentumStage4):
    def initialize(self):
        self.set_start_date(2009, 6, 1)
        self.set_end_date(2026, 7, 10)
        self.set_cash(100_000)
        self.set_time_zone(TimeZones.NEW_YORK)

        self.universe_settings.resolution = Resolution.DAILY
        self.universe_settings.data_normalization_mode = DataNormalizationMode.ADJUSTED
        self.universe_settings.asynchronous = False

        self.rows = defaultdict(lambda: deque(maxlen=340))
        self.latest_prices = {}
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
        for policy in POLICIES:
            key = f"M12_1__DUAL__N10__{policy}"
            account = self.new_stage2_account(key, "M12_1", "DUAL", 10, policy)
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

    def capped_targets(self, selected, core_weight, cap):
        chosen = selected[:10]
        if not chosen:
            return {self.qqq: 1.0}
        satellite_budget = 1.0 - core_weight
        weights = {row["symbol"]: max(0.0, row["index_weight"]) for row in chosen}
        if sum(weights.values()) <= 0:
            weights = {row["symbol"]: 1.0 for row in chosen}

        targets = defaultdict(float)
        remaining = dict(weights)
        budget = satellite_budget
        while remaining and budget > 1e-12:
            denominator = sum(remaining.values())
            proposed = {
                symbol: budget * value / denominator
                for symbol, value in remaining.items()
            }
            over = [symbol for symbol, value in proposed.items() if value > cap]
            if not over:
                for symbol, value in proposed.items():
                    targets[symbol] += value
                budget = 0.0
                break
            for symbol in over:
                targets[symbol] += cap
                budget -= cap
                remaining.pop(symbol)
        targets[self.qqq] += core_weight + max(0.0, budget)
        return targets

    def execute_pending(self, date):
        for key, selected in self.pending["selections"].items():
            account = self.accounts[key]
            core_weight, cap = POLICIES[account["mode"]]
            targets = self.capped_targets(selected, core_weight, cap)
            self.rebalance_targets(account, targets, date, selected)
        self.pending = None

    def on_end_of_algorithm(self):
        train_benchmark = self.qqq_segment(TRAIN_START, TRAIN_END)
        holdout_benchmark = self.qqq_segment(HOLDOUT_START, HOLDOUT_END)
        self.debug(
            f"QQQ5_META|signals={self.signal_count}|accounts={len(self.accounts)}|"
            f"cost={COST_RATE:.4f}|last={self.qqq_full[-1]['date'] if self.qqq_full else None}"
        )
        self.debug(
            f"QQQ5_BENCH|train={train_benchmark['cagr']:.4f}/{train_benchmark['mdd']:.4f}|"
            f"holdout={holdout_benchmark['cagr']:.4f}/{holdout_benchmark['mdd']:.4f}"
        )
        rows = []
        for key, account in self.accounts.items():
            train = self.segment_stats(account, TRAIN_START, TRAIN_END)
            holdout = self.segment_stats(account, HOLDOUT_START, HOLDOUT_END)
            accepted = (
                train["cagr"] > train_benchmark["cagr"]
                and holdout["cagr"] > holdout_benchmark["cagr"]
                and holdout["mdd"] >= holdout_benchmark["mdd"] - 0.10
            )
            score = (
                holdout["cagr"] - holdout_benchmark["cagr"]
                + 0.25 * min(0.0, holdout["mdd"] - holdout_benchmark["mdd"])
            )
            rows.append((score, key, account, train, holdout, accepted))
        rows.sort(key=lambda row: (-row[0], row[1]))
        for rank, (score, key, account, train, holdout, accepted) in enumerate(rows, 1):
            self.debug(
                f"QQQ5_RANK|rank={rank}|key={key}|accepted={int(accepted)}|score={score:.4f}|"
                f"train={train['cagr']:.4f}/{train['mdd']:.4f}|"
                f"holdout={holdout['return']:.4f}/{holdout['cagr']:.4f}/{holdout['mdd']:.4f}|"
                f"fees={account['fees']:.0f}|turnover={account['turnover'] / INITIAL_CAPITAL:.2f}|"
                f"cash={average(account['cash_ratios']) or 0.0:.4f}|maxw={account['max_weight']:.4f}"
            )


class Main(QqqMomentumStage5):
    pass
