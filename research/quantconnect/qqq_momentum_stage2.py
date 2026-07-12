from AlgorithmImports import *
from collections import defaultdict, deque
from datetime import datetime

from qqq_momentum_stage1 import (
    QqqMomentumStage1,
    average,
    finite,
    sort_symbols,
)


INITIAL_CAPITAL = 100_000_000.0
COST_RATE = 0.001
MEMBERSHIP_LAG_DAYS = 5
SCORE_KEYS = ["M12_1", "BETA_RESID"]
FILTER_KEYS = ["ALL", "MA200", "DUAL"]
SIZES = [3, 5, 10]
MODES = ["STRICT", "BUFFER2", "COHORT3", "COHORT6", "INVOL"]
DESIGN_START = datetime(2010, 8, 27).date()
DESIGN_END = datetime(2018, 12, 31).date()
VALIDATE_START = datetime(2019, 1, 1).date()
VALIDATE_END = datetime(2022, 12, 31).date()
AUDIT_START = datetime(2023, 1, 1).date()
AUDIT_END = datetime(2024, 12, 31).date()


class QqqMomentumStage2(QqqMomentumStage1):
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
        self.ever_members = set()
        self.membership_history = deque(maxlen=20)
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

    def new_stage2_account(self, key, score, filter_key, size, mode):
        horizon = 3 if mode == "COHORT3" else 6
        return {
            "key": key,
            "score": score,
            "filter": filter_key,
            "size": size,
            "mode": mode,
            "cash": INITIAL_CAPITAL,
            "positions": {},
            "curve": [],
            "cash_ratios": [],
            "fees": 0.0,
            "turnover": 0.0,
            "trade_count": 0,
            "first_date": None,
            "last_selection": [],
            "max_weight": 0.0,
            "cohorts": deque(maxlen=horizon),
        }

    def eligible_rows(self, rows, filter_key, qqq_metric):
        if filter_key == "ALL":
            return rows
        if filter_key == "MA200":
            return [row for row in rows if row["above200"]]
        return [
            row
            for row in rows
            if row["above200"]
            and row["r6"] > qqq_metric["r6"]
            and row["r12_1"] > 0
        ]

    def buffered_selection(self, account, ranked):
        size = account["size"]
        current = {
            symbol.value
            for symbol, shares in account["positions"].items()
            if shares > 0 and symbol != self.qqq
        }
        retained = [row for row in ranked[: 2 * size] if row["ticker"] in current]
        selected = list(retained)
        selected_symbols = {row["symbol"] for row in selected}
        for row in ranked:
            if row["symbol"] in selected_symbols:
                continue
            selected.append(row)
            selected_symbols.add(row["symbol"])
            if len(selected) >= size:
                break
        return selected[:size]

    def create_signal(self, date):
        members = (
            self.membership_history[-1 - MEMBERSHIP_LAG_DAYS][1]
            if len(self.membership_history) > MEMBERSHIP_LAG_DAYS
            else set(self.qqq_members)
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
            if account["mode"] == "BUFFER2":
                selections[key] = self.buffered_selection(account, ranked)
            else:
                selections[key] = ranked[: account["size"]]

        self.pending = {"signal_date": date, "selections": selections}
        self.signal_count += 1

    def normalize_targets(self, raw_targets):
        mapped = defaultdict(float)
        for symbol, weight in raw_targets.items():
            if weight <= 0:
                continue
            mapped[self.ensure_manual(symbol)] += float(weight)
        total = sum(mapped.values())
        if total <= 0:
            return {self.qqq: 1.0}
        return {symbol: weight / total for symbol, weight in mapped.items()}

    def equal_targets(self, selected, size):
        targets = defaultdict(float)
        for row in selected[:size]:
            targets[row["symbol"]] += 1.0 / size
        missing = size - min(size, len(selected))
        if missing > 0:
            targets[self.qqq] += missing / size
        return targets

    def inverse_vol_targets(self, selected, size):
        chosen = selected[:size]
        available_weight = len(chosen) / size
        raw = []
        for row in chosen:
            volatility = max(float(row["vol60"]), 0.05)
            raw.append((row["symbol"], 1.0 / volatility))
        denominator = sum(value for _, value in raw)
        targets = defaultdict(float)
        if denominator > 0:
            for symbol, value in raw:
                targets[symbol] += available_weight * value / denominator
        if available_weight < 1.0:
            targets[self.qqq] += 1.0 - available_weight
        return targets

    def cohort_targets(self, account, selected):
        account["cohorts"].append([row["symbol"] for row in selected[: account["size"]]])
        targets = defaultdict(float)
        cohort_count = len(account["cohorts"])
        for cohort in account["cohorts"]:
            for symbol in cohort:
                targets[symbol] += 1.0 / cohort_count / account["size"]
            missing = account["size"] - len(cohort)
            if missing > 0:
                targets[self.qqq] += missing / cohort_count / account["size"]
        return targets

    def rebalance_targets(self, account, raw_targets, date, selected):
        target_weights = self.normalize_targets(raw_targets)
        equity = self.account_equity(account)
        if equity <= 0:
            return

        for symbol in list(account["positions"]):
            price = self.price_for(symbol)
            if not price:
                continue
            current = account["positions"][symbol] * price
            desired = equity * target_weights.get(symbol, 0.0)
            if current > desired:
                self.sell_value(account, symbol, current - desired)

        equity_after_sales = self.account_equity(account)
        deficits = []
        for symbol, weight in target_weights.items():
            price = self.price_for(symbol)
            if not price:
                continue
            current = account["positions"].get(symbol, 0.0) * price
            desired = equity_after_sales * weight
            if desired > current:
                deficits.append((symbol, desired - current))
        wanted = sum(value for _, value in deficits)
        budget = min(wanted, account["cash"] / (1 + COST_RATE))
        scale = budget / wanted if wanted > 0 else 0.0
        for symbol, value in deficits:
            self.buy_value(account, symbol, value * scale)

        account["first_date"] = account["first_date"] or date
        account["last_selection"] = [row["ticker"] for row in selected[: account["size"]]]
        post_equity = self.account_equity(account)
        account["cash_ratios"].append(account["cash"] / post_equity if post_equity > 0 else 0.0)
        self.update_max_weight(account)

    def execute_pending(self, date):
        for key, selected in self.pending["selections"].items():
            account = self.accounts[key]
            mode = account["mode"]
            if mode in ("COHORT3", "COHORT6"):
                targets = self.cohort_targets(account, selected)
            elif mode == "INVOL":
                targets = self.inverse_vol_targets(selected, account["size"])
            else:
                targets = self.equal_targets(selected, account["size"])
            self.rebalance_targets(account, targets, date, selected)
        self.pending = None

    def robust_score(self, design, validate, design_benchmark, validate_benchmark):
        if not design or not validate:
            return -999.0
        minimum_excess = min(
            design["cagr"] - design_benchmark["cagr"],
            validate["cagr"] - validate_benchmark["cagr"],
        )
        worst_drawdown_edge = min(
            design["mdd"] - design_benchmark["mdd"],
            validate["mdd"] - validate_benchmark["mdd"],
        )
        return minimum_excess + 0.25 * min(0.0, worst_drawdown_edge)

    def audit_score(self, audit, audit_benchmark):
        if not audit:
            return -999.0
        return (
            audit["cagr"] - audit_benchmark["cagr"]
            + 0.25 * min(0.0, audit["mdd"] - audit_benchmark["mdd"])
        )

    def on_end_of_algorithm(self):
        design_benchmark = self.qqq_segment(DESIGN_START, DESIGN_END)
        validate_benchmark = self.qqq_segment(VALIDATE_START, VALIDATE_END)
        audit_benchmark = self.qqq_segment(AUDIT_START, AUDIT_END)
        rows = []
        for key, account in self.accounts.items():
            design = self.segment_stats(account, DESIGN_START, DESIGN_END)
            validate = self.segment_stats(account, VALIDATE_START, VALIDATE_END)
            audit = self.segment_stats(account, AUDIT_START, AUDIT_END)
            rows.append({
                "key": key,
                "account": account,
                "design": design,
                "validate": validate,
                "audit": audit,
                "robust": self.robust_score(
                    design, validate, design_benchmark, validate_benchmark
                ),
            })
        rows.sort(key=lambda row: (-row["robust"], row["key"]))
        preselected = rows[:20]
        for row in preselected:
            row["audit_score"] = self.audit_score(row["audit"], audit_benchmark)
        audit_rows = sorted(preselected, key=lambda row: (-row["audit_score"], row["key"]))

        self.debug(
            f"QQQ2_META|signals={self.signal_count}|accounts={len(self.accounts)}|"
            f"ever={len(self.ever_members)}|cost={COST_RATE:.4f}|delist={len(set(self.delisting_records))}"
        )
        self.debug(
            f"QQQ2_BENCH|DESIGN={design_benchmark['return']:.4f}/{design_benchmark['cagr']:.4f}/{design_benchmark['mdd']:.4f}|"
            f"VALIDATE={validate_benchmark['return']:.4f}/{validate_benchmark['cagr']:.4f}/{validate_benchmark['mdd']:.4f}|"
            f"AUDIT={audit_benchmark['return']:.4f}/{audit_benchmark['cagr']:.4f}/{audit_benchmark['mdd']:.4f}"
        )
        for rank, row in enumerate(preselected, 1):
            design = row["design"]
            validate = row["validate"]
            self.debug(
                f"QQQ2_PRE|rank={rank}|key={row['key']}|robust={row['robust']:.4f}|"
                f"design={design['cagr']:.4f}/{design['mdd']:.4f}|"
                f"validate={validate['cagr']:.4f}/{validate['mdd']:.4f}"
            )
        for rank, row in enumerate(audit_rows[:10], 1):
            account = row["account"]
            audit = row["audit"]
            accepted = (
                row["design"]["cagr"] > design_benchmark["cagr"]
                and row["validate"]["cagr"] > validate_benchmark["cagr"]
                and audit["cagr"] > audit_benchmark["cagr"]
                and audit["mdd"] >= audit_benchmark["mdd"] - 0.10
            )
            self.debug(
                f"QQQ2_AUDIT|rank={rank}|key={row['key']}|accepted={int(accepted)}|"
                f"ret={audit['return']:.4f}|cagr={audit['cagr']:.4f}|mdd={audit['mdd']:.4f}|"
                f"score={row['audit_score']:.4f}|fees={account['fees']:.0f}|"
                f"turnover={account['turnover'] / INITIAL_CAPITAL:.2f}|trades={account['trade_count']}|"
                f"cash={average(account['cash_ratios']) or 0.0:.4f}|maxw={account['max_weight']:.4f}|"
                f"picks={','.join(account['last_selection'])}"
            )


class Main(QqqMomentumStage2):
    pass
