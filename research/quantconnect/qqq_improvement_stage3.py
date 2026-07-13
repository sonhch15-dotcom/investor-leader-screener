from AlgorithmImports import *
from collections import defaultdict, deque
from datetime import datetime
import math

from qqq_momentum_stage1 import average, finite, stdev
from qqq_improvement_stage1 import (
    COST_RATE,
    DEVELOP_END,
    DEVELOP_START,
    INITIAL_CAPITAL,
    MEMBERSHIP_LAG_DAYS,
    VALIDATE_END,
    VALIDATE_START,
    WINDOWS,
)
from qqq_improvement_stage2 import QqqImprovementStage2


BASE_POLICIES = [
    ("N9_BASE_STRICT", 9, "BASE", "STRICT", "IMMEDIATE", True),
    ("N12_EMERGE_STRICT", 12, "EMERGE", "STRICT", "IMMEDIATE", True),
]
RISK_MODELS = ["VOL", "CREDIT"]
VIX_MODES = ["FIXED", "RELATIVE"]
STATE_LEVELS = {"NORMAL": 0, "CAUTION": 1, "RISK": 2}
LEVEL_STATES = {value: key for key, value in STATE_LEVELS.items()}
SUPPORT_TICKERS = {"BIL", "GLD", "HYG", "LQD", "VIX"}


class QqqImprovementStage3(QqqImprovementStage2):
    def initialize(self):
        super().initialize()
        self.rows = defaultdict(lambda: deque(maxlen=900))
        self.accounts = {}
        for (
            policy,
            size,
            selection_mode,
            rebalance_mode,
            reentry_mode,
            weekly_exit,
        ) in BASE_POLICIES:
            for risk_model in RISK_MODELS:
                for vix_mode in VIX_MODES:
                    key = f"{policy}__{risk_model}__{vix_mode}"
                    account = self.new_stage2_account(
                        key, "M12_1", "DUAL", size, "LEADER"
                    )
                    account.update({
                        "profile": policy,
                        "selection_mode": selection_mode,
                        "weight_mode": "LEADER",
                        "correlation_mode": "CORR85",
                        "rebalance_mode": rebalance_mode,
                        "reentry_mode": reentry_mode,
                        "weekly_exit_enabled": weekly_exit,
                        "risk_model": risk_model,
                        "vix_mode": vix_mode,
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
                        "support_tickers": set(SUPPORT_TICKERS),
                        "risk_state": "NORMAL",
                        "recovery_streak": 0,
                        "state_changes": 0,
                        "vix_alarms": 0,
                        "state_weeks": defaultdict(int),
                        "last_bundle": None,
                    })
                    self.accounts[key] = account

        self.bil = self.add_equity(
            "BIL", Resolution.DAILY,
            data_normalization_mode=DataNormalizationMode.ADJUSTED,
        ).symbol
        self.gld = self.add_equity(
            "GLD", Resolution.DAILY,
            data_normalization_mode=DataNormalizationMode.ADJUSTED,
        ).symbol
        self.hyg = self.add_equity(
            "HYG", Resolution.DAILY,
            data_normalization_mode=DataNormalizationMode.ADJUSTED,
        ).symbol
        self.lqd = self.add_equity(
            "LQD", Resolution.DAILY,
            data_normalization_mode=DataNormalizationMode.ADJUSTED,
        ).symbol
        self.vix = self.add_index("VIX", Resolution.DAILY).symbol
        self.vix_rows = deque(maxlen=400)
        self.pending_risk_rebalances = set()

    def on_securities_changed(self, changes):
        for security in changes.added_securities:
            symbol = security.symbol
            if symbol == self.vix or len(self.rows[symbol]) >= 253:
                continue
            try:
                history = self.history(symbol, 900, Resolution.DAILY)
                if history.empty:
                    continue
                existing = self.rows[symbol]
                loaded = []
                for index, row in history.iterrows():
                    stamp = index[-1] if isinstance(index, tuple) else index
                    date = (
                        stamp.to_pydatetime().date()
                        if hasattr(stamp, "to_pydatetime")
                        else stamp.date()
                    )
                    loaded.append({
                        "date": date,
                        "open": float(row.get("open", row["close"])),
                        "close": float(row["close"]),
                        "volume": float(row.get("volume", 0.0)),
                    })
                for item in sorted(loaded, key=lambda value: value["date"]):
                    if not existing or existing[-1]["date"] != item["date"]:
                        existing.append(item)
            except Exception as error:
                self.debug(f"I3_WARMUP_FAIL|{symbol.value}|{str(error)[:80]}")

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
            if symbol == self.vix:
                if not self.vix_rows or self.vix_rows[-1]["date"] != date:
                    self.vix_rows.append(row)
            if symbol == self.qqq and (
                not self.qqq_full or self.qqq_full[-1]["date"] != date
            ):
                self.qqq_full.append(row)

        if self.pending_weekly_exits and date > self.pending_weekly_exits["signal_date"]:
            self.execute_weekly_exits()
        if self.pending and date > self.pending["signal_date"] and self.qqq in data.bars:
            self.execute_pending(date)
            self.pending_risk_rebalances.clear()
        elif self.pending_risk_rebalances:
            self.execute_risk_rebalances(date)
        self.mark_accounts(date)

    def process_weekly(self):
        date = self.time.date()
        if date < datetime(2010, 8, 27).date():
            return
        self.create_weekly_exits(date)
        self.update_risk_states()
        month = (date.year, date.month)
        last_friday = self.last_friday(date.year, date.month)
        if (
            date <= last_friday
            and (last_friday - date).days <= 4
            and self.last_signal_month != month
        ):
            self.create_signal(date)
            self.last_signal_month = month

    def create_weekly_exits(self, date):
        exits = {}
        for key, account in self.accounts.items():
            if not account["weekly_exit_enabled"]:
                continue
            symbols = [
                symbol for symbol, shares in account["positions"].items()
                if symbol != self.qqq
                and symbol.value not in account["support_tickers"]
                and shares > 0
                and self.below_ma200(symbol)
            ]
            if symbols:
                exits[key] = symbols
        self.pending_weekly_exits = (
            {"signal_date": date, "accounts": exits} if exits else None
        )

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
            if account["risk_state"] == "NORMAL":
                self.buy_value(account, self.qqq, account["cash"] / (1 + COST_RATE))
            else:
                initial_cash = account["cash"]
                self.buy_value(
                    account, self.bil, initial_cash * 0.50 / (1 + COST_RATE)
                )
                self.buy_value(
                    account, self.gld, account["cash"] / (1 + COST_RATE)
                )
        self.pending_weekly_exits = None

    def percentile(self, values, fraction):
        clean = sorted(value for value in values if finite(value))
        if not clean:
            return None
        index = int(round((len(clean) - 1) * fraction))
        return clean[max(0, min(index, len(clean) - 1))]

    def qqq_risk_inputs(self):
        rows = list(self.rows.get(self.qqq, []))
        if len(rows) < 777:
            return None
        closes = [row["close"] for row in rows]
        returns = [
            math.log(closes[index] / closes[index - 1])
            for index in range(1, len(closes))
            if closes[index - 1] > 0 and closes[index] > 0
        ]
        rolling = []
        start = max(20, len(returns) - 756)
        for index in range(start, len(returns) + 1):
            value = stdev(returns[index - 20:index])
            if value is not None:
                rolling.append(value * math.sqrt(252))
        current_vol = rolling[-1] if rolling else None
        vol_threshold = self.percentile(rolling[:-1] or rolling, 0.80)
        return {
            "trend_bad": closes[-1] < sum(closes[-200:]) / 200,
            "below50": closes[-1] < sum(closes[-50:]) / 50,
            "vol_bad": (
                current_vol is not None
                and vol_threshold is not None
                and current_vol > vol_threshold
            ),
        }

    def breadth_bad(self):
        members = (
            self.membership_history[-1 - MEMBERSHIP_LAG_DAYS][1]
            if len(self.membership_history) > MEMBERSHIP_LAG_DAYS
            else set(self.qqq_members)
        )
        states = []
        for symbol in members:
            rows = list(self.rows.get(symbol, []))
            if len(rows) >= 200:
                closes = [row["close"] for row in rows[-200:]]
                states.append(closes[-1] >= sum(closes) / len(closes))
        return bool(states) and sum(states) / len(states) < 0.50

    def credit_bad(self):
        hyg = {row["date"]: row["close"] for row in self.rows.get(self.hyg, [])}
        lqd = {row["date"]: row["close"] for row in self.rows.get(self.lqd, [])}
        shared = sorted(set(hyg) & set(lqd))[-200:]
        if len(shared) < 200:
            return False
        ratios = [hyg[date] / lqd[date] for date in shared if lqd[date] > 0]
        return len(ratios) >= 200 and ratios[-1] < sum(ratios) / len(ratios)

    def vix_alarm(self, mode, qqq_inputs):
        closes = [row["close"] for row in self.vix_rows if row["close"] > 0]
        if len(closes) < 252 or not qqq_inputs["below50"]:
            return False
        if mode == "FIXED":
            return closes[-1] >= 30
        threshold = self.percentile(closes[-252:], 0.90)
        five_day_jump = closes[-1] / closes[-6] - 1 if closes[-6] > 0 else 0.0
        return closes[-1] >= threshold and five_day_jump >= 0.20

    def raw_risk_level(self, account, qqq_inputs, breadth):
        third_bad = (
            qqq_inputs["vol_bad"]
            if account["risk_model"] == "VOL"
            else self.credit_bad()
        )
        bad_count = int(qqq_inputs["trend_bad"]) + int(breadth) + int(third_bad)
        raw = 0 if bad_count == 0 else 1 if bad_count == 1 else 2
        alarm = self.vix_alarm(account["vix_mode"], qqq_inputs)
        if alarm:
            raw = min(2, raw + 1)
            account["vix_alarms"] += 1
        return raw, alarm

    def update_risk_states(self):
        qqq_inputs = self.qqq_risk_inputs()
        if not qqq_inputs:
            return
        breadth = self.breadth_bad()
        for key, account in self.accounts.items():
            target, alarm = self.raw_risk_level(account, qqq_inputs, breadth)
            current = STATE_LEVELS[account["risk_state"]]
            new_level = current
            if target > current:
                new_level = min(2, current + 1)
                account["recovery_streak"] = 0
            elif target < current and not alarm:
                account["recovery_streak"] += 1
                if account["recovery_streak"] >= 2:
                    new_level = max(0, current - 1)
                    account["recovery_streak"] = 0
            else:
                account["recovery_streak"] = 0
            if new_level != current:
                account["risk_state"] = LEVEL_STATES[new_level]
                account["state_changes"] += 1
                self.pending_risk_rebalances.add(key)
            account["state_weeks"][account["risk_state"]] += 1

    def target_weights(self, account, bundle):
        account["target_cash_weight"] = 0.0
        base = super().target_weights(account, bundle)
        leader_rows = {row["symbol"] for row in bundle["selected"]}
        leader_weights = {
            symbol: weight for symbol, weight in base.items()
            if symbol in leader_rows
        }
        leader_total = sum(leader_weights.values())
        proportions = (
            {symbol: weight / leader_total for symbol, weight in leader_weights.items()}
            if leader_total > 0 else {}
        )
        state = account["risk_state"]
        leader_budget = 0.75 if state == "NORMAL" else 0.25 if state == "CAUTION" else 0.0
        qqq_budget = 0.25 if state in ("NORMAL", "RISK") else 0.50
        defense_budget = 0.0 if state == "NORMAL" else 0.25 if state == "CAUTION" else 0.75
        targets = defaultdict(float)
        targets[self.qqq] = qqq_budget
        for symbol, proportion in proportions.items():
            targets[symbol] += leader_budget * proportion
        if not proportions:
            if state == "NORMAL":
                targets[self.qqq] += leader_budget
            else:
                defense_budget += leader_budget
        targets[self.bil] += defense_budget * 0.50
        targets[self.gld] += defense_budget * 0.50
        return targets

    def execute_pending(self, date):
        bundles = dict(self.pending["selections"])
        super().execute_pending(date)
        for key, bundle in bundles.items():
            self.accounts[key]["last_bundle"] = bundle

    def execute_risk_rebalances(self, date):
        for key in sorted(self.pending_risk_rebalances):
            account = self.accounts[key]
            bundle = account.get("last_bundle")
            if not bundle:
                continue
            self.rebalance_account(
                account, self.target_weights(account, bundle), date, bundle
            )
        self.pending_risk_rebalances.clear()

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
            "I3 Benchmark",
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
            weeks = account["state_weeks"]
            self.set_summary_statistic(
                f"I3 Rank {rank}",
                f"{key}; ok={int(accepted)}; "
                f"DEV {stats['DEV']['cagr']:.2%}/{stats['DEV']['mdd']:.2%}; "
                f"VAL {stats['VAL']['cagr']:.2%}/{stats['VAL']['mdd']:.2%}; "
                f"turn {account['turnover'] / INITIAL_CAPITAL:.1f}x; "
                f"state {weeks['NORMAL']}/{weeks['CAUTION']}/{weeks['RISK']}; "
                f"changes/vix {account['state_changes']}/{account['vix_alarms']}",
            )


class Main(QqqImprovementStage3):
    pass
