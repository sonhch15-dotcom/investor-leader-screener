from AlgorithmImports import *
from collections import defaultdict

from qqq_momentum_stage1 import finite
from qqq_improvement_stage1 import (
    DEVELOP_END,
    DEVELOP_START,
    INITIAL_CAPITAL,
    VALIDATE_END,
    VALIDATE_START,
    WINDOWS,
)
from qqq_improvement_stage2 import QqqImprovementStage2


QUALITY_MODES = ["BASELINE", "MIN_QUALITY"]


class QqqImprovementQualityTest(QqqImprovementStage2):
    def initialize(self):
        super().initialize()
        self.accounts = {}
        for quality_mode in QUALITY_MODES:
            account = self.new_stage2_account(
                quality_mode, "M12_1", "DUAL", 9, "LEADER"
            )
            account.update({
                "profile": "N9_BASE_CORR",
                "selection_mode": "BASE",
                "weight_mode": "LEADER",
                "correlation_mode": "CORR85",
                "rebalance_mode": "STRICT",
                "reentry_mode": "IMMEDIATE",
                "quality_mode": quality_mode,
                "cost_rate": 0.0025,
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
                "quality_checked": 0,
                "quality_rejected": 0,
                "quality_missing": 0,
            })
            self.accounts[quality_mode] = account
        self.quality_cache = {}

    def ratio_value(self, container, name):
        series = getattr(container, name, None)
        if series is None:
            return None
        for period in ("one_year", "twelve_months", "three_months"):
            value = getattr(series, period, None)
            try:
                number = float(value)
            except (TypeError, ValueError):
                continue
            if finite(number) and abs(number) < 1e6:
                return number
        return None

    def quality_result(self, symbol):
        cache_key = (self.time.date(), symbol)
        if cache_key in self.quality_cache:
            return self.quality_cache[cache_key]
        try:
            fundamental = self.fundamentals(symbol)
            if not fundamental or not fundamental.has_fundamental_data:
                result = (True, True)
            else:
                ratios = fundamental.operation_ratios
                values = [
                    (self.ratio_value(ratios, "roic"), lambda value: value < -0.10),
                    (
                        self.ratio_value(ratios, "revenue_growth"),
                        lambda value: value < -0.20,
                    ),
                    (
                        self.ratio_value(ratios, "debt_to_assets"),
                        lambda value: value > 0.90,
                    ),
                ]
                available = [item for item in values if item[0] is not None]
                severe = sum(test(value) for value, test in available)
                result = (len(available) < 2 or severe < 2, len(available) < 2)
        except Exception:
            result = (True, True)
        self.quality_cache[cache_key] = result
        return result

    def choose_rows(self, account, ranked):
        if account["quality_mode"] == "BASELINE":
            return super().choose_rows(account, ranked)
        filtered = []
        for row in ranked:
            accepted, missing = self.quality_result(row["symbol"])
            account["quality_checked"] += 1
            account["quality_missing"] += int(missing)
            account["quality_rejected"] += int(not accepted)
            if accepted:
                filtered.append(row)
        return super().choose_rows(account, filtered)

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
            "I4Q Benchmark",
            f"DEV {benchmarks['DEV']['cagr']:.2%}/{benchmarks['DEV']['mdd']:.2%}; "
            f"VAL {benchmarks['VAL']['cagr']:.2%}/{benchmarks['VAL']['mdd']:.2%}",
        )
        for rank, key in enumerate(QUALITY_MODES, 1):
            account = self.accounts[key]
            stats = {
                name: self.segment_stats(account, start, end)
                for name, (start, end) in periods.items()
            }
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
            self.set_summary_statistic(
                f"I4Q {rank}",
                f"{key}; ok={int(accepted)}; target={int(target_met)}; "
                f"DEV {stats['DEV']['cagr']:.2%}/{stats['DEV']['mdd']:.2%}; "
                f"VAL {stats['VAL']['cagr']:.2%}/{stats['VAL']['mdd']:.2%}; "
                f"checked/rejected/missing {account['quality_checked']}/"
                f"{account['quality_rejected']}/{account['quality_missing']}; "
                f"turn {account['turnover'] / INITIAL_CAPITAL:.1f}x",
            )


class Main(QqqImprovementQualityTest):
    pass
