from AlgorithmImports import *
from collections import defaultdict
from datetime import datetime
import math

from qqq_momentum_stage1 import average, finite, sort_symbols
from qqq_improvement_stage1 import COST_RATE, INITIAL_CAPITAL, MEMBERSHIP_LAG_DAYS
from qqq_improvement_stage2 import QqqImprovementStage2


BASELINE = "BASELINE_M12_1"
SURPRISE_VETO = "NEGATIVE_SURPRISE_VETO"
FIRST_TEST_SIGNAL = datetime(2019, 1, 25).date()
DEVELOP_START = FIRST_TEST_SIGNAL
DEVELOP_END = datetime(2021, 12, 31).date()
VALIDATE_START = datetime(2022, 1, 1).date()
VALIDATE_END = datetime(2024, 12, 31).date()
RECENCY_DAYS = 140
SURPRISE_FLOOR = 0.05
WINDOWS = [
    ("W1", FIRST_TEST_SIGNAL, datetime(2020, 12, 31).date()),
    ("W2", datetime(2021, 1, 1).date(), datetime(2021, 12, 31).date()),
    ("W3", datetime(2022, 1, 1).date(), datetime(2022, 12, 31).date()),
    ("W4", datetime(2023, 1, 1).date(), datetime(2024, 12, 31).date()),
]


class QqqEstimizeSurpriseVetoTest(QqqImprovementStage2):
    def initialize(self):
        self.release_symbols = {}
        self.latest_release = {}
        self.release_events = 0
        self.coverage_records = []
        super().initialize()

        self.accounts = {}
        for key, signal_mode in [
            (BASELINE, "BASELINE"),
            (SURPRISE_VETO, "SURPRISE_VETO"),
        ]:
            account = self.new_stage2_account(key, "M12_1", "DUAL", 9, "LEADER")
            account.update({
                "profile": "N9_BASE_CORR",
                "selection_mode": "BASE",
                "weight_mode": "LEADER",
                "correlation_mode": "CORR85",
                "rebalance_mode": "STRICT",
                "reentry_mode": "IMMEDIATE",
                "signal_mode": signal_mode,
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

    def on_securities_changed(self, changes):
        super().on_securities_changed(changes)
        for security in changes.added_securities:
            symbol = security.symbol
            if symbol == self.qqq or symbol not in self.qqq_members:
                continue
            if symbol in self.release_symbols:
                continue
            try:
                self.release_symbols[symbol] = self.add_data(
                    EstimizeRelease,
                    symbol,
                    Resolution.DAILY,
                    fill_forward=False,
                ).symbol
            except Exception as error:
                self.debug(f"ES_SUB_FAIL|{symbol.value}|{str(error)[:80]}")

    def on_data(self, data):
        date = self.time.date()
        for dataset_symbol, point in data.get(EstimizeRelease).items():
            actual = float(point.eps) if finite(point.eps) else None
            estimate = (
                float(point.consensus_eps_estimate)
                if finite(point.consensus_eps_estimate) else None
            )
            if actual is None or estimate is None:
                continue
            self.latest_release[dataset_symbol.underlying] = {
                "date": date,
                "surprise": (
                    (actual - estimate) / max(abs(estimate), SURPRISE_FLOOR)
                ),
            }
            self.release_events += 1
        super().on_data(data)

    def recent_release(self, symbol, date):
        release = self.latest_release.get(symbol)
        if not release:
            return None
        age = (date - release["date"]).days
        return release if 0 <= age <= RECENCY_DAYS else None

    def create_signal(self, date):
        if date < FIRST_TEST_SIGNAL:
            return
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
                -row["scores"]["M12_1"],
                row["ticker"],
                str(row["symbol"].id),
            ),
        )

        recent = {
            row["symbol"]: self.recent_release(row["symbol"], date)
            for row in ranked
        }
        negative_symbols = {
            symbol for symbol, release in recent.items()
            if release is not None and release["surprise"] < 0
        }
        self.coverage_records.append({
            "date": date,
            "eligible": len(ranked),
            "recent": sum(value is not None for value in recent.values()),
            "negative": len(negative_symbols),
        })

        self.month_index += 1
        selections = {}
        for key, account in self.accounts.items():
            account_ranked = (
                [row for row in ranked if row["symbol"] not in negative_symbols]
                if account["signal_mode"] == "SURPRISE_VETO"
                else ranked
            )
            bundle = self.strict_bundle(account, account_ranked)
            self.update_emerging_age(account, bundle)
            selections[key] = bundle
            if account["first_date"] is None:
                account["first_date"] = date
                account["curve"].append((date, account["cash"]))
        self.pending = {"signal_date": date, "selections": selections}
        self.signal_count += 1

    def coverage_summary(self, label, start, end):
        rows = [
            row for row in self.coverage_records
            if start <= row["date"] <= end
        ]
        eligible = sum(row["eligible"] for row in rows)
        recent = sum(row["recent"] for row in rows)
        negative = sum(row["negative"] for row in rows)
        self.debug(
            f"ES_COVERAGE|period={label}|months={len(rows)}|eligible={eligible}|"
            f"recent={recent}|coverage={recent / eligible if eligible else 0:.6f}|"
            f"negative={negative}|negative_known={negative / recent if recent else 0:.6f}"
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
        stats_by_key = {
            key: {
                name: self.segment_stats(account, start, end)
                for name, (start, end) in periods.items()
            }
            for key, account in self.accounts.items()
        }

        self.debug(
            f"ES_META|signals={self.signal_count}|ever={len(self.ever_members)}|"
            f"release_subscriptions={len(self.release_symbols)}|"
            f"release_events={self.release_events}|cost={COST_RATE:.4f}|"
            f"recency={RECENCY_DAYS}|execution=NEXT_OPEN|membership_lag=5|"
            f"last={self.qqq_full[-1]['date'] if self.qqq_full else None}"
        )
        self.coverage_summary("DEV", DEVELOP_START, DEVELOP_END)
        self.coverage_summary("VAL", VALIDATE_START, VALIDATE_END)
        for name, stats in benchmarks.items():
            self.debug(
                f"ES_BENCH|period={name}|return={stats['return']:.6f}|"
                f"cagr={stats['cagr']:.6f}|mdd={stats['mdd']:.6f}"
            )

        baseline_stats = stats_by_key[BASELINE]
        for key in [BASELINE, SURPRISE_VETO]:
            account = self.accounts[key]
            stats = stats_by_key[key]
            dev_q_gap = stats["DEV"]["cagr"] - benchmarks["DEV"]["cagr"]
            val_q_gap = stats["VAL"]["cagr"] - benchmarks["VAL"]["cagr"]
            dev_mdd_gap = stats["DEV"]["mdd"] - benchmarks["DEV"]["mdd"]
            val_mdd_gap = stats["VAL"]["mdd"] - benchmarks["VAL"]["mdd"]
            beats_baseline = (
                key == BASELINE
                or (
                    stats["DEV"]["cagr"] > baseline_stats["DEV"]["cagr"]
                    and stats["VAL"]["cagr"] > baseline_stats["VAL"]["cagr"]
                )
            )
            target_met = (
                dev_q_gap >= 0.05
                and val_q_gap >= 0.05
                and dev_mdd_gap >= -0.05
                and val_mdd_gap >= -0.05
                and beats_baseline
            )
            self.debug(
                f"ES_RESULT|key={key}|target={int(target_met)}|"
                f"beats_baseline={int(beats_baseline)}|fees={account['fees']:.2f}|"
                f"turnover={account['turnover'] / INITIAL_CAPITAL:.6f}|"
                f"cash={average(account['cash_ratios']) or 0.0:.6f}|"
                f"maxw={account['max_weight']:.6f}|weekly={account['weekly_exits']}|"
                f"trades={account['trade_count']}|picks={','.join(account['last_selection'])}"
            )
            for name, value in stats.items():
                self.debug(
                    f"ES_PERIOD|key={key}|period={name}|"
                    f"return={value['return']:.6f}|cagr={value['cagr']:.6f}|"
                    f"mdd={value['mdd']:.6f}"
                )

        self.set_summary_statistic(
            "ES Benchmark",
            f"DEV {benchmarks['DEV']['cagr']:.2%}/{benchmarks['DEV']['mdd']:.2%}; "
            f"VAL {benchmarks['VAL']['cagr']:.2%}/{benchmarks['VAL']['mdd']:.2%}",
        )
        for key in [BASELINE, SURPRISE_VETO]:
            stats = stats_by_key[key]
            self.set_summary_statistic(
                f"ES {key}",
                f"DEV {stats['DEV']['cagr']:.2%}/{stats['DEV']['mdd']:.2%}; "
                f"VAL {stats['VAL']['cagr']:.2%}/{stats['VAL']['mdd']:.2%}",
            )


class Main(QqqEstimizeSurpriseVetoTest):
    pass
