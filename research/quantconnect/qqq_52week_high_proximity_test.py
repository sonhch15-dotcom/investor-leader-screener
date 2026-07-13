from AlgorithmImports import *
from collections import defaultdict

from qqq_momentum_stage1 import average
from qqq_improvement_stage1 import (
    COST_RATE,
    DEVELOP_END,
    DEVELOP_START,
    INITIAL_CAPITAL,
    VALIDATE_END,
    VALIDATE_START,
    WINDOWS,
)
from qqq_improvement_stage2 import QqqImprovementStage2


BASELINE = "BASELINE_M12_1"
HIGH52 = "HIGH52_PROXIMITY"


class Qqq52WeekHighProximityTest(QqqImprovementStage2):
    def initialize(self):
        super().initialize()
        self.accounts = {}
        for key, rank_mode in [(BASELINE, "M12_1"), (HIGH52, "HIGH52")]:
            account = self.new_stage2_account(key, "M12_1", "DUAL", 9, "LEADER")
            account.update({
                "profile": "N9_BASE_CORR",
                "selection_mode": "BASE",
                "weight_mode": "LEADER",
                "correlation_mode": "CORR85",
                "rebalance_mode": "STRICT",
                "reentry_mode": "IMMEDIATE",
                "rank_mode": rank_mode,
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

    def metric_for(self, symbol, qqq_returns):
        metric = super().metric_for(symbol, qqq_returns)
        if not metric:
            return None
        closes = [row["close"] for row in list(self.rows.get(symbol, []))[-252:]]
        trailing_high = max(closes) if closes else 0.0
        metric["high52_proximity"] = (
            closes[-1] / trailing_high if trailing_high > 0 else 0.0
        )
        return metric

    def choose_rows(self, account, ranked):
        if account["rank_mode"] == "HIGH52":
            ranked = sorted(
                ranked,
                key=lambda row: (
                    -row["high52_proximity"],
                    row["ticker"],
                    str(row["symbol"].id),
                ),
            )
        return super().choose_rows(account, ranked)

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

        self.debug(
            f"H52_META|signals={self.signal_count}|ever={len(self.ever_members)}|"
            f"cost={COST_RATE:.4f}|execution=NEXT_OPEN|membership_lag=5|"
            f"last={self.qqq_full[-1]['date'] if self.qqq_full else None}|"
            f"delist={len(set(self.delisting_records))}"
        )
        for name, stats in benchmarks.items():
            self.debug(
                f"H52_BENCH|period={name}|return={stats['return']:.6f}|"
                f"cagr={stats['cagr']:.6f}|mdd={stats['mdd']:.6f}"
            )
        self.set_summary_statistic(
            "H52 Benchmark",
            f"DEV {benchmarks['DEV']['cagr']:.2%}/{benchmarks['DEV']['mdd']:.2%}; "
            f"VAL {benchmarks['VAL']['cagr']:.2%}/{benchmarks['VAL']['mdd']:.2%}",
        )

        for key in [BASELINE, HIGH52]:
            account = self.accounts[key]
            stats = {
                name: self.segment_stats(account, start, end)
                for name, (start, end) in periods.items()
            }
            dev_excess = stats["DEV"]["cagr"] - benchmarks["DEV"]["cagr"]
            val_excess = stats["VAL"]["cagr"] - benchmarks["VAL"]["cagr"]
            dev_mdd_gap = stats["DEV"]["mdd"] - benchmarks["DEV"]["mdd"]
            val_mdd_gap = stats["VAL"]["mdd"] - benchmarks["VAL"]["mdd"]
            target_met = (
                dev_excess >= 0.05
                and val_excess >= 0.05
                and dev_mdd_gap >= -0.05
                and val_mdd_gap >= -0.05
            )
            self.debug(
                f"H52_RESULT|key={key}|target={int(target_met)}|"
                f"fees={account['fees']:.2f}|"
                f"turnover={account['turnover'] / INITIAL_CAPITAL:.6f}|"
                f"cash={average(account['cash_ratios']) or 0.0:.6f}|"
                f"maxw={account['max_weight']:.6f}|"
                f"weekly={account['weekly_exits']}|"
                f"trades={account['trade_count']}|"
                f"picks={','.join(account['last_selection'])}"
            )
            for name, value in stats.items():
                self.debug(
                    f"H52_PERIOD|key={key}|period={name}|"
                    f"return={value['return']:.6f}|cagr={value['cagr']:.6f}|"
                    f"mdd={value['mdd']:.6f}"
                )
            self.set_summary_statistic(
                f"H52 {key}",
                f"target={int(target_met)}; "
                f"DEV {stats['DEV']['cagr']:.2%}/{stats['DEV']['mdd']:.2%}; "
                f"VAL {stats['VAL']['cagr']:.2%}/{stats['VAL']['mdd']:.2%}",
            )


class Main(Qqq52WeekHighProximityTest):
    pass
