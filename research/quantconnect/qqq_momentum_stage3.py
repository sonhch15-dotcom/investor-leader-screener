from AlgorithmImports import *
from collections import defaultdict, deque
from datetime import datetime

from qqq_momentum_stage1 import average, percentile_map, sort_symbols
from qqq_momentum_stage2 import QqqMomentumStage2


INITIAL_CAPITAL = 100_000_000.0
COST_RATE = 0.001
MEMBERSHIP_LAG_DAYS = 5
SCORE_KEYS = [
    "M3",
    "M6",
    "M12_1",
    "FAST",
    "BLEND",
    "FAST_SKIP",
    "INDEX_MOM",
    "SMOOTH",
]
FILTER_KEYS = ["ALL", "MA200", "DUAL"]
SIZES = [2, 3, 5, 10]
MODES = ["STRICT", "COHORT3", "COHORT6", "INDEXW"]
WINDOWS = [
    ("W1", datetime(2010, 8, 27).date(), datetime(2014, 12, 31).date()),
    ("W2", datetime(2015, 1, 1).date(), datetime(2018, 12, 31).date()),
    ("W3", datetime(2019, 1, 1).date(), datetime(2022, 12, 31).date()),
    ("W4", datetime(2023, 1, 1).date(), datetime(2024, 12, 31).date()),
]
FULL_START = datetime(2010, 8, 27).date()
FULL_END = datetime(2024, 12, 31).date()


class QqqMomentumStage3(QqqMomentumStage2):
    def initialize(self):
        self.set_start_date(2009, 6, 1)
        self.set_end_date(2024, 12, 31)
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
        for score in SCORE_KEYS:
            for filter_key in FILTER_KEYS:
                for size in SIZES:
                    for mode in MODES:
                        key = f"{score}__{filter_key}__N{size}__{mode}"
                        self.accounts[key] = self.new_stage2_account(
                            key, score, filter_key, size, mode
                        )

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

    def select_qqq(self, constituents):
        rows = list(constituents)
        members = {row.symbol for row in rows}
        self.qqq_members = members
        self.qqq_weights = {
            row.symbol: max(0.0, float(row.weight or 0.0))
            for row in rows
        }
        self.ever_members.update(members)
        return sort_symbols(members)

    def on_data(self, data):
        super().on_data(data)
        date = self.time.date()
        if self.qqq_weights and (not self.weight_history or self.weight_history[-1][0] != date):
            self.weight_history.append((date, dict(self.qqq_weights)))

    def metric_for(self, symbol, qqq_returns):
        metric = super().metric_for(symbol, qqq_returns)
        if not metric:
            return None
        rows = list(self.rows.get(symbol, []))
        closes = [row["close"] for row in rows]
        metric["r3_1"] = closes[-22] / closes[-64] - 1
        metric["r6_1"] = closes[-22] / closes[-127] - 1
        return metric

    def score_rows(self, rows):
        p3 = percentile_map(rows, "r3")
        p6 = percentile_map(rows, "r6")
        p12 = percentile_map(rows, "r12_1")
        p3_1 = percentile_map(rows, "r3_1")
        p6_1 = percentile_map(rows, "r6_1")
        pweight = percentile_map(rows, "index_weight")
        psmooth = percentile_map(rows, "id", higher=False)

        for row in rows:
            symbol = row["symbol"]
            blend = 0.20 * p3[symbol] + 0.35 * p6[symbol] + 0.45 * p12[symbol]
            row["scores"] = {
                "M3": p3[symbol],
                "M6": p6[symbol],
                "M12_1": p12[symbol],
                "FAST": 0.55 * p3[symbol] + 0.45 * p6[symbol],
                "BLEND": blend,
                "FAST_SKIP": 0.40 * p3_1[symbol] + 0.60 * p6_1[symbol],
                "INDEX_MOM": (
                    0.15 * pweight[symbol]
                    + 0.35 * p3[symbol]
                    + 0.25 * p6[symbol]
                    + 0.25 * p12[symbol]
                ),
                "SMOOTH": 0.80 * blend + 0.20 * psmooth[symbol],
            }

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
            self.debug(f"SIGNAL_FAIL|{date}|members={len(members)}|qqq={int(bool(qqq_metric))}")
            return

        rows = []
        for symbol in sort_symbols(members):
            metric = self.metric_for(symbol, qqq_returns)
            if metric:
                metric["index_weight"] = weights.get(symbol, 0.0)
                rows.append(metric)
        if len(rows) < 20:
            self.debug(f"SIGNAL_FAIL|{date}|eligible={len(rows)}")
            return
        self.score_rows(rows)

        rankings = {}
        for score in SCORE_KEYS:
            for filter_key in FILTER_KEYS:
                eligible = self.eligible_rows(rows, filter_key, qqq_metric)
                rankings[(score, filter_key)] = sorted(
                    eligible,
                    key=lambda row: (
                        -row["scores"][score],
                        row["ticker"],
                        str(row["symbol"].id),
                    ),
                )

        selections = {}
        for key, account in self.accounts.items():
            ranked = rankings[(account["score"], account["filter"])]
            selections[key] = ranked[: account["size"]]
        self.pending = {"signal_date": date, "selections": selections}
        self.signal_count += 1

    def index_weight_targets(self, selected, size):
        chosen = selected[:size]
        available_weight = len(chosen) / size
        denominator = sum(row["index_weight"] for row in chosen)
        if denominator <= 0:
            return self.equal_targets(chosen, size)
        targets = defaultdict(float)
        for row in chosen:
            targets[row["symbol"]] += available_weight * row["index_weight"] / denominator
        if available_weight < 1.0:
            targets[self.qqq] += 1.0 - available_weight
        return targets

    def execute_pending(self, date):
        for key, selected in self.pending["selections"].items():
            account = self.accounts[key]
            mode = account["mode"]
            if mode in ("COHORT3", "COHORT6"):
                targets = self.cohort_targets(account, selected)
            elif mode == "INDEXW":
                targets = self.index_weight_targets(selected, account["size"])
            else:
                targets = self.equal_targets(selected, account["size"])
            self.rebalance_targets(account, targets, date, selected)
        self.pending = None

    def consistency_score(self, stats, benchmarks):
        excess = [stats[name]["cagr"] - benchmarks[name]["cagr"] for name, _, _ in WINDOWS]
        drawdown_edges = [
            stats[name]["mdd"] - benchmarks[name]["mdd"]
            for name, _, _ in WINDOWS
        ]
        mean_excess = sum(excess) / len(excess)
        worst_excess = min(excess)
        worst_drawdown = min(drawdown_edges)
        return mean_excess + 0.50 * worst_excess + 0.20 * min(0.0, worst_drawdown)

    def on_end_of_algorithm(self):
        benchmarks = {
            name: self.qqq_segment(start, end)
            for name, start, end in WINDOWS
        }
        full_benchmark = self.qqq_segment(FULL_START, FULL_END)
        rows = []
        for key, account in self.accounts.items():
            stats = {
                name: self.segment_stats(account, start, end)
                for name, start, end in WINDOWS
            }
            full = self.segment_stats(account, FULL_START, FULL_END)
            rows.append({
                "key": key,
                "account": account,
                "stats": stats,
                "full": full,
                "score": self.consistency_score(stats, benchmarks),
            })
        rows.sort(key=lambda row: (-row["score"], row["key"]))

        bench_text = "|".join(
            f"{name}={benchmarks[name]['cagr']:.4f}/{benchmarks[name]['mdd']:.4f}"
            for name, _, _ in WINDOWS
        )
        self.debug(
            f"QQQ3_META|signals={self.signal_count}|accounts={len(self.accounts)}|"
            f"ever={len(self.ever_members)}|cost={COST_RATE:.4f}|delist={len(set(self.delisting_records))}"
        )
        self.debug(
            f"QQQ3_BENCH|{bench_text}|FULL={full_benchmark['cagr']:.4f}/{full_benchmark['mdd']:.4f}"
        )
        for rank, row in enumerate(rows[:20], 1):
            stats = row["stats"]
            excess = {
                name: stats[name]["cagr"] - benchmarks[name]["cagr"]
                for name, _, _ in WINDOWS
            }
            positive = sum(value > 0 for value in excess.values())
            accepted = (
                positive >= 3
                and row["full"]["cagr"] > full_benchmark["cagr"]
                and min(
                    stats[name]["mdd"] - benchmarks[name]["mdd"]
                    for name, _, _ in WINDOWS
                ) >= -0.15
            )
            account = row["account"]
            periods = ";".join(
                f"{name}:{stats[name]['cagr']:.4f}/{stats[name]['mdd']:.4f}/{excess[name]:+.4f}"
                for name, _, _ in WINDOWS
            )
            self.debug(
                f"QQQ3_RANK|rank={rank}|key={row['key']}|accepted={int(accepted)}|"
                f"score={row['score']:.4f}|positive={positive}|periods={periods}|"
                f"full={row['full']['cagr']:.4f}/{row['full']['mdd']:.4f}|"
                f"fees={account['fees']:.0f}|turnover={account['turnover'] / INITIAL_CAPITAL:.2f}|"
                f"cash={average(account['cash_ratios']) or 0.0:.4f}|maxw={account['max_weight']:.4f}|"
                f"picks={','.join(account['last_selection'])}"
            )


class Main(QqqMomentumStage3):
    pass
