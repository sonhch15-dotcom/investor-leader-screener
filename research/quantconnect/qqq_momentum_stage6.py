from AlgorithmImports import *
from collections import defaultdict, deque
from datetime import datetime

from qqq_momentum_stage1 import average, finite
from qqq_momentum_stage5 import QqqMomentumStage5


INITIAL_CAPITAL = 100_000_000.0
TRAIN_START = datetime(2010, 8, 27).date()
TRAIN_END = datetime(2024, 12, 31).date()
HOLDOUT_START = datetime(2025, 1, 1).date()
HOLDOUT_END = datetime(2026, 7, 10).date()
COSTS = {
    "C10": 0.0010,
    "C25": 0.0025,
    "C50": 0.0050,
}


class QqqMomentumStage6(QqqMomentumStage5):
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
        for label, cost_rate in COSTS.items():
            key = f"M12_1__DUAL__N10__CORE25_CAP25__{label}"
            account = self.new_stage2_account(key, "M12_1", "DUAL", 10, label)
            account["cost_rate"] = cost_rate
            account["fee_history"] = []
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

    def sell_value(self, account, symbol, gross_value, price=None):
        shares = account["positions"].get(symbol, 0.0)
        price = price if finite(price) and price > 0 else self.price_for(symbol)
        if shares <= 0 or not price:
            return
        sell_shares = min(shares, gross_value / price)
        gross = sell_shares * price
        fee = gross * account["cost_rate"]
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
        cost_rate = account["cost_rate"]
        gross = min(gross_value, account["cash"] / (1 + cost_rate))
        if gross <= 0:
            return
        fee = gross * cost_rate
        account["cash"] -= gross + fee
        account["fees"] += fee
        account["turnover"] += gross
        account["trade_count"] += 1
        account["positions"][symbol] = account["positions"].get(symbol, 0.0) + gross / price

    def execute_pending(self, date):
        for key, selected in self.pending["selections"].items():
            account = self.accounts[key]
            targets = self.capped_targets(selected, 0.25, 0.25)
            self.rebalance_targets(account, targets, date, selected)
            account["fee_history"].append((date, account["fees"]))
        self.pending = None

    def holdout_fees(self, account):
        before = [fees for date, fees in account["fee_history"] if date < HOLDOUT_START]
        start_fees = before[-1] if before else 0.0
        return account["fees"] - start_fees

    def on_end_of_algorithm(self):
        train_benchmark = self.qqq_segment(TRAIN_START, TRAIN_END)
        holdout_benchmark = self.qqq_segment(HOLDOUT_START, HOLDOUT_END)
        full_benchmark = self.qqq_segment(TRAIN_START, HOLDOUT_END)
        self.debug(
            f"QQQ6_META|signals={self.signal_count}|accounts={len(self.accounts)}|"
            f"last={self.qqq_full[-1]['date'] if self.qqq_full else None}"
        )
        self.debug(
            f"QQQ6_BENCH|train={train_benchmark['cagr']:.4f}/{train_benchmark['mdd']:.4f}|"
            f"holdout={holdout_benchmark['return']:.4f}/{holdout_benchmark['cagr']:.4f}/{holdout_benchmark['mdd']:.4f}|"
            f"full={full_benchmark['cagr']:.4f}/{full_benchmark['mdd']:.4f}"
        )
        for label, cost_rate in COSTS.items():
            key = f"M12_1__DUAL__N10__CORE25_CAP25__{label}"
            account = self.accounts[key]
            train = self.segment_stats(account, TRAIN_START, TRAIN_END)
            holdout = self.segment_stats(account, HOLDOUT_START, HOLDOUT_END)
            full = self.segment_stats(account, TRAIN_START, HOLDOUT_END)
            accepted = (
                train["cagr"] > train_benchmark["cagr"]
                and holdout["cagr"] > holdout_benchmark["cagr"]
                and holdout["mdd"] >= holdout_benchmark["mdd"] - 0.10
            )
            self.debug(
                f"QQQ6_COST|label={label}|cost={cost_rate:.4f}|accepted={int(accepted)}|"
                f"train={train['cagr']:.4f}/{train['mdd']:.4f}|"
                f"holdout={holdout['return']:.4f}/{holdout['cagr']:.4f}/{holdout['mdd']:.4f}|"
                f"full={full['cagr']:.4f}/{full['mdd']:.4f}|"
                f"fees_all={account['fees']:.0f}|fees_holdout={self.holdout_fees(account):.0f}|"
                f"turnover={account['turnover'] / INITIAL_CAPITAL:.2f}|"
                f"cash={average(account['cash_ratios']) or 0.0:.4f}|maxw={account['max_weight']:.4f}"
            )


class Main(QqqMomentumStage6):
    pass
