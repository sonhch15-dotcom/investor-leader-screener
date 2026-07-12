from AlgorithmImports import *
from collections import defaultdict, deque
from datetime import datetime

from qqq_momentum_stage1 import average
from qqq_momentum_stage3 import QqqMomentumStage3


INITIAL_CAPITAL = 100_000_000.0
COST_RATE = 0.001
STRATEGY_KEY = "M12_1__DUAL__N10__INDEXW"
TRAIN_START = datetime(2010, 8, 27).date()
TRAIN_END = datetime(2024, 12, 31).date()
HOLDOUT_START = datetime(2025, 1, 1).date()
HOLDOUT_END = datetime(2026, 7, 10).date()


class QqqMomentumStage4(QqqMomentumStage3):
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

        account = self.new_stage2_account(
            STRATEGY_KEY, "M12_1", "DUAL", 10, "INDEXW"
        )
        account["target_history"] = []
        self.accounts = {STRATEGY_KEY: account}

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

    def execute_pending(self, date):
        selected = self.pending["selections"][STRATEGY_KEY]
        account = self.accounts[STRATEGY_KEY]
        targets = self.index_weight_targets(selected, account["size"])
        normalized = self.normalize_targets(targets)
        account["target_history"].append((
            date,
            sorted(
                [(symbol.value, weight) for symbol, weight in normalized.items()],
                key=lambda row: (-row[1], row[0]),
            ),
        ))
        self.rebalance_targets(account, targets, date, selected)
        self.pending = None

    def on_end_of_algorithm(self):
        account = self.accounts[STRATEGY_KEY]
        train = self.segment_stats(account, TRAIN_START, TRAIN_END)
        holdout = self.segment_stats(account, HOLDOUT_START, HOLDOUT_END)
        full = self.segment_stats(account, TRAIN_START, HOLDOUT_END)
        train_benchmark = self.qqq_segment(TRAIN_START, TRAIN_END)
        holdout_benchmark = self.qqq_segment(HOLDOUT_START, HOLDOUT_END)
        full_benchmark = self.qqq_segment(TRAIN_START, HOLDOUT_END)

        self.debug(
            f"QQQ4_META|key={STRATEGY_KEY}|signals={self.signal_count}|ever={len(self.ever_members)}|"
            f"cost={COST_RATE:.4f}|delist={len(set(self.delisting_records))}|"
            f"last={self.qqq_full[-1]['date'] if self.qqq_full else None}"
        )
        self.debug(
            f"QQQ4_TRAIN|strategy={train['return']:.4f}/{train['cagr']:.4f}/{train['mdd']:.4f}|"
            f"qqq={train_benchmark['return']:.4f}/{train_benchmark['cagr']:.4f}/{train_benchmark['mdd']:.4f}"
        )
        self.debug(
            f"QQQ4_HOLDOUT|strategy={holdout['return']:.4f}/{holdout['cagr']:.4f}/{holdout['mdd']:.4f}|"
            f"qqq={holdout_benchmark['return']:.4f}/{holdout_benchmark['cagr']:.4f}/{holdout_benchmark['mdd']:.4f}"
        )
        self.debug(
            f"QQQ4_FULL|strategy={full['return']:.4f}/{full['cagr']:.4f}/{full['mdd']:.4f}|"
            f"qqq={full_benchmark['return']:.4f}/{full_benchmark['cagr']:.4f}/{full_benchmark['mdd']:.4f}|"
            f"fees={account['fees']:.0f}|turnover={account['turnover'] / INITIAL_CAPITAL:.2f}|"
            f"trades={account['trade_count']}|cash={average(account['cash_ratios']) or 0.0:.4f}|"
            f"maxw={account['max_weight']:.4f}"
        )
        for date, targets in account["target_history"]:
            if date < HOLDOUT_START:
                continue
            target_text = ",".join(f"{ticker}:{weight:.4f}" for ticker, weight in targets)
            self.debug(f"QQQ4_MONTH|date={date}|targets={target_text}")


class Main(QqqMomentumStage4):
    pass
