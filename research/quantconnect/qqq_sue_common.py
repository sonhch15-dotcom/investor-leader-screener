from AlgorithmImports import *
from collections import defaultdict, deque
from datetime import datetime
import calendar
import math


START_DATE = (2006, 1, 1)
END_DATE = (2024, 12, 31)
FIRST_SIGNAL = datetime(2010, 8, 27).date()
DEVELOP_END = datetime(2021, 12, 31).date()
VALIDATE_START = datetime(2022, 1, 1).date()
MEMBERSHIP_LAG_DAYS = 5
FUNDAMENTAL_CAPTURE_SIZE = 1500
MIN_POOLED_COVERAGE = 0.70
MIN_YEAR_COVERAGE = 0.60
MIN_ENTRY_COVERAGE = 0.95
HORIZONS = {3: 63, 6: 126, 12: 252}


def finite(value):
    try:
        return value is not None and math.isfinite(float(value))
    except Exception:
        return False


def average(values):
    clean = [float(value) for value in values if finite(value)]
    return sum(clean) / len(clean) if clean else None


def median(values):
    clean = sorted(float(value) for value in values if finite(value))
    if not clean:
        return None
    middle = len(clean) // 2
    if len(clean) % 2:
        return clean[middle]
    return (clean[middle - 1] + clean[middle]) / 2


def population_stdev(values):
    clean = [float(value) for value in values if finite(value)]
    if len(clean) < 2:
        return None
    mean = sum(clean) / len(clean)
    return math.sqrt(sum((value - mean) ** 2 for value in clean) / len(clean))


def symbol_key(symbol):
    return (symbol.value, str(symbol.id))


def rank_values(values):
    order = sorted(range(len(values)), key=lambda index: (values[index], index))
    ranks = [0.0] * len(values)
    start = 0
    while start < len(order):
        end = start + 1
        while end < len(order) and values[order[end]] == values[order[start]]:
            end += 1
        rank = (start + end - 1) / 2 + 1
        for position in range(start, end):
            ranks[order[position]] = rank
        start = end
    return ranks


def correlation(left, right):
    if len(left) != len(right) or len(left) < 2:
        return None
    left_mean = average(left)
    right_mean = average(right)
    numerator = sum((a - left_mean) * (b - right_mean) for a, b in zip(left, right))
    left_scale = math.sqrt(sum((value - left_mean) ** 2 for value in left))
    right_scale = math.sqrt(sum((value - right_mean) ** 2 for value in right))
    denominator = left_scale * right_scale
    return numerator / denominator if denominator > 0 else None


def spearman(values):
    return correlation([1, 2, 3, 4, 5], rank_values(values))


class QqqSueBase(QCAlgorithm):
    def initialize(self):
        self.set_start_date(*START_DATE)
        self.set_end_date(*END_DATE)
        self.set_cash(100_000)
        self.set_time_zone(TimeZones.NEW_YORK)

        self.universe_settings.resolution = Resolution.DAILY
        self.universe_settings.data_normalization_mode = DataNormalizationMode.ADJUSTED
        self.universe_settings.asynchronous = False

        self.qqq_members = set()
        self.ever_members = set()
        self.membership_history = deque(maxlen=20)
        self.eps_snapshots = defaultdict(dict)
        self.pending = None
        self.open_cohorts = []
        self.cohort_results = []
        self.signal_count = 0
        self.last_signal_month = None
        self.audit_records = []
        self.entry_records = []

        self.fundamental_points = 0
        self.snapshot_updates = 0
        self.snapshot_overwrites = 0
        self.forced_exit_records = set()

        self.qqq = self.add_equity(
            "QQQ",
            Resolution.DAILY,
            data_normalization_mode=DataNormalizationMode.ADJUSTED,
        ).symbol
        self.add_universe(self.universe.etf(self.qqq, self.universe_settings, self.select_qqq))
        self.add_universe(self.capture_fundamentals)
        self.schedule.on(
            self.date_rules.week_end(self.qqq),
            self.time_rules.after_market_close(self.qqq, 5),
            self.process_weekly,
        )

    def required_symbols(self):
        required = set()
        if self.pending:
            for rows in self.pending.get("groups", {}).values():
                required.update(row["symbol"] for row in rows)
        for cohort in self.open_cohorts:
            for entries in cohort["groups"].values():
                required.update(entry["symbol"] for entry in entries)
        return required

    def select_qqq(self, constituents):
        members = {row.symbol for row in constituents}
        self.qqq_members = members
        self.ever_members.update(members)
        return sorted(members | self.required_symbols(), key=symbol_key)

    def field_number(self, field):
        if field is None:
            return None
        for attribute in ("three_months", "value"):
            try:
                value = getattr(field, attribute)
                if finite(value) and abs(float(value)) < 1e6:
                    return float(value)
            except Exception:
                continue
        return None

    def capture_fundamentals(self, fundamentals):
        observed_date = self.time.date()
        last_friday = self.last_friday(observed_date.year, observed_date.month)
        days_to_signal = (last_friday - observed_date).days
        if days_to_signal < 0 or days_to_signal > 1:
            return []

        rows = list(fundamentals)
        valid = []
        current = []
        for row in rows:
            try:
                if not row.has_fundamental_data:
                    continue
                if row.symbol in self.qqq_members:
                    current.append(row)
                if finite(row.dollar_volume):
                    valid.append(row)
            except Exception:
                continue
        valid.sort(key=lambda row: (-float(row.dollar_volume),) + symbol_key(row.symbol))
        selected = {row.symbol: row for row in valid[:FUNDAMENTAL_CAPTURE_SIZE]}
        for row in current:
            selected[row.symbol] = row
        snapshot_month = (observed_date.year, observed_date.month)
        for symbol in sorted(selected, key=symbol_key):
            eps = self.field_number(selected[symbol].earning_reports.basic_eps)
            if eps is None:
                continue
            self.fundamental_points += 1
            if snapshot_month in self.eps_snapshots[symbol]:
                self.snapshot_overwrites += 1
            self.eps_snapshots[symbol][snapshot_month] = eps
            self.snapshot_updates += 1
        return []

    def sue_for(self, symbol, signal_date):
        signal_month = (signal_date.year, signal_date.month)
        months = sorted(
            month for month in self.eps_snapshots.get(symbol, {})
            if month <= signal_month
        )
        if len(months) < 36:
            return None, "history", None

        months = months[-36:]
        month_indexes = [year * 12 + month for year, month in months]
        if month_indexes[-1] - month_indexes[0] != 35:
            return None, "month_gap", None

        eps = [self.eps_snapshots[symbol][month] for month in months]
        changes = [
            eps[35 - offset] - eps[23 - offset]
            for offset in range(0, 24, 3)
        ]
        denominator = population_stdev(changes)
        if denominator is None or denominator <= 1e-9:
            return None, "zero_std", 0
        value = changes[0] / denominator
        if not finite(value):
            return None, "invalid", 0
        return value, "valid", 0

    def signal_members(self):
        if len(self.membership_history) > MEMBERSHIP_LAG_DAYS:
            return set(self.membership_history[-1 - MEMBERSHIP_LAG_DAYS][1])
        return set(self.qqq_members)

    def signal_rows(self, signal_date):
        members = self.signal_members()
        rows = []
        reasons = defaultdict(int)
        ages = []
        for symbol in sorted(members, key=symbol_key):
            value, reason, age = self.sue_for(symbol, signal_date)
            reasons[reason] += 1
            if value is not None:
                rows.append({"symbol": symbol, "ticker": symbol.value, "sue": value})
                ages.append(age)
        self.audit_records.append({
            "date": signal_date,
            "members": len(members),
            "valid": len(rows),
            "reasons": dict(reasons),
            "median_age": median(ages),
            "sue_min": min((row["sue"] for row in rows), default=None),
            "sue_median": median(row["sue"] for row in rows),
            "sue_max": max((row["sue"] for row in rows), default=None),
        })
        self.signal_count += 1
        return rows

    def last_friday(self, year, month):
        day = calendar.monthrange(year, month)[1]
        value = datetime(year, month, day)
        while value.weekday() != 4:
            day -= 1
            value = datetime(year, month, day)
        return value.date()

    def process_weekly(self):
        current = self.time.date()
        if current < FIRST_SIGNAL:
            return
        month = (current.year, current.month)
        last_friday = self.last_friday(current.year, current.month)
        if current <= last_friday and (last_friday - current).days <= 4 and self.last_signal_month != month:
            self.create_signal(current)
            self.last_signal_month = month

    def create_signal(self, signal_date):
        self.signal_rows(signal_date)

    def execute_pending(self, data, current):
        return

    def update_cohorts(self, data, current):
        return

    def bar_for(self, data, symbol):
        return data.bars[symbol] if symbol in data.bars else None

    def on_data(self, data):
        current = self.time.date()
        if self.qqq_members and (
            not self.membership_history or self.membership_history[-1][0] != current
        ):
            self.membership_history.append((current, set(self.qqq_members)))

        if self.pending and current > self.pending["signal_date"] and self.qqq in data.bars:
            self.execute_pending(data, current)
        self.update_cohorts(data, current)

    def on_delistings(self, delistings):
        for symbol, event in delistings.items():
            if event.type != DelistingType.WARNING or not finite(event.price) or float(event.price) <= 0:
                continue
            for cohort in self.open_cohorts:
                for entries in cohort["groups"].values():
                    for entry in entries:
                        if entry["symbol"] == symbol and not entry.get("forced"):
                            entry["last"] = float(event.price)
                            entry["last_date"] = self.time.date()
                            entry["forced"] = True
                            self.forced_exit_records.add(
                                (str(symbol.id), self.time.date().isoformat())
                            )

    def period_records(self, start, end):
        return [record for record in self.audit_records if start <= record["date"] <= end]

    def coverage_summary(self, start, end):
        records = self.period_records(start, end)
        members = sum(record["members"] for record in records)
        valid = sum(record["valid"] for record in records)
        reasons = defaultdict(int)
        for record in records:
            for reason, count in record["reasons"].items():
                reasons[reason] += count
        return {
            "signals": len(records),
            "members": members,
            "valid": valid,
            "coverage": valid / members if members else 0.0,
            "reasons": dict(reasons),
        }

    def year_summaries(self):
        output = []
        years = sorted({record["date"].year for record in self.audit_records})
        for year in years:
            records = [record for record in self.audit_records if record["date"].year == year]
            members = sum(record["members"] for record in records)
            valid = sum(record["valid"] for record in records)
            output.append({
                "year": year,
                "signals": len(records),
                "members": members,
                "valid": valid,
                "coverage": valid / members if members else 0.0,
                "age": median(record["median_age"] for record in records),
            })
        return output

    def data_gate(self):
        development = self.coverage_summary(FIRST_SIGNAL, DEVELOP_END)
        validation = self.coverage_summary(VALIDATE_START, datetime(2024, 12, 31).date())
        year_rows = self.year_summaries()
        year_gate = bool(year_rows) and all(
            row["coverage"] >= MIN_YEAR_COVERAGE for row in year_rows
        )
        passed = (
            development["coverage"] >= MIN_POOLED_COVERAGE
            and validation["coverage"] >= MIN_POOLED_COVERAGE
            and year_gate
        )
        return passed, development, validation, year_rows

    def emit_data_quality(self, prefix):
        passed, development, validation, year_rows = self.data_gate()
        self.debug(
            f"{prefix}_DQ_META|signals={self.signal_count}|ever={len(self.ever_members)}|"
            f"fundamental_points={self.fundamental_points}|snapshots={self.snapshot_updates}|"
            f"overwrites={self.snapshot_overwrites}|symbols={len(self.eps_snapshots)}"
        )
        for label, row in (("DEV", development), ("VAL", validation)):
            reasons = ",".join(
                f"{reason}:{count}"
                for reason, count in sorted(row["reasons"].items())
            )
            self.debug(
                f"{prefix}_DQ_PERIOD|period={label}|signals={row['signals']}|"
                f"members={row['members']}|valid={row['valid']}|"
                f"coverage={row['coverage']:.6f}|reasons={reasons}"
            )
        for row in year_rows:
            self.debug(
                f"{prefix}_DQ_YEAR|year={row['year']}|signals={row['signals']}|"
                f"members={row['members']}|valid={row['valid']}|"
                f"coverage={row['coverage']:.6f}|median_age={row['age'] or 0:.1f}"
            )
        for ticker in ("AAPL", "MSFT", "NVDA"):
            symbols = [symbol for symbol in self.eps_snapshots if symbol.value == ticker]
            if not symbols:
                continue
            symbol = sorted(symbols, key=symbol_key)[-1]
            months = sorted(self.eps_snapshots[symbol])[-4:]
            payload = ",".join(
                f"{year:04d}-{month:02d}={self.eps_snapshots[symbol][(year, month)]:.4f}"
                for year, month in months
            )
            self.debug(
                f"{prefix}_DQ_SAMPLE|ticker={ticker}|sid={symbol.id}|"
                f"months={len(self.eps_snapshots[symbol])}|values={payload}"
            )
        self.debug(
            f"{prefix}_DQ_GATE|pass={int(passed)}|dev={development['coverage']:.6f}|"
            f"val={validation['coverage']:.6f}|year_min="
            f"{min((row['coverage'] for row in year_rows), default=0.0):.6f}"
        )
        return passed, development, validation


class QqqSueDataAudit(QqqSueBase):
    def on_end_of_algorithm(self):
        passed, development, validation = self.emit_data_quality("SUE")
        self.set_summary_statistic(
            "SUE Data Gate",
            f"pass={int(passed)}; DEV {development['coverage']:.1%}; "
            f"VAL {validation['coverage']:.1%}",
        )


class QqqSueSignalValidation(QqqSueBase):
    def initialize(self):
        super().initialize()
        self.intended_q5 = []
        self.quintile_turnovers = []
        self.skipped_entry_cohorts = 0

    def create_signal(self, signal_date):
        rows = self.signal_rows(signal_date)
        rows.sort(key=lambda row: (row["sue"],) + symbol_key(row["symbol"]))
        if len(rows) < 50:
            return
        groups = {quintile: [] for quintile in range(1, 6)}
        for index, row in enumerate(rows):
            quintile = min(5, int(index * 5 / len(rows)) + 1)
            groups[quintile].append(row)

        q5 = {row["symbol"] for row in groups[5]}
        if self.intended_q5:
            previous = self.intended_q5[-1]
            denominator = max(1, len(q5))
            self.quintile_turnovers.append(1 - len(previous & q5) / denominator)
        self.intended_q5.append(q5)
        self.pending = {
            "signal_date": signal_date,
            "signal_index": self.signal_count - 1,
            "groups": groups,
        }

    def execute_pending(self, data, current):
        qqq_bar = self.bar_for(data, self.qqq)
        if qqq_bar is None or not finite(qqq_bar.open) or float(qqq_bar.open) <= 0:
            return
        groups = {}
        intended = 0
        entered = 0
        for quintile, rows in self.pending["groups"].items():
            entries = []
            intended += len(rows)
            for row in rows:
                bar = self.bar_for(data, row["symbol"])
                if bar is None or not finite(bar.open) or float(bar.open) <= 0:
                    continue
                entries.append({
                    "symbol": row["symbol"],
                    "ticker": row["ticker"],
                    "sue": row["sue"],
                    "entry": float(bar.open),
                    "last": float(bar.open),
                    "last_date": current,
                    "forced": False,
                })
            entered += len(entries)
            groups[quintile] = entries
        coverage = entered / intended if intended else 0.0
        self.entry_records.append({
            "signal_date": self.pending["signal_date"],
            "entry_date": current,
            "intended": intended,
            "entered": entered,
            "coverage": coverage,
        })
        if coverage < MIN_ENTRY_COVERAGE or any(not groups[q] for q in range(1, 6)):
            self.skipped_entry_cohorts += 1
            self.pending = None
            return
        self.open_cohorts.append({
            "signal_date": self.pending["signal_date"],
            "signal_index": self.pending["signal_index"],
            "entry_date": current,
            "qqq_entry": float(qqq_bar.open),
            "days": 0,
            "groups": groups,
            "completed": set(),
        })
        self.pending = None

    def finish_horizon(self, cohort, months, current, qqq_close):
        for quintile in range(1, 6):
            entries = cohort["groups"][quintile]
            returns = [entry["last"] / entry["entry"] - 1 for entry in entries]
            stale = sum(entry["last_date"] != current and not entry["forced"] for entry in entries)
            forced = sum(entry["forced"] for entry in entries)
            qqq_return = qqq_close / cohort["qqq_entry"] - 1
            self.cohort_results.append({
                "signal_date": cohort["signal_date"],
                "signal_index": cohort["signal_index"],
                "entry_date": cohort["entry_date"],
                "exit_date": current,
                "months": months,
                "quintile": quintile,
                "return": average(returns),
                "qqq": qqq_return,
                "excess": average(returns) - qqq_return,
                "count": len(returns),
                "forced": forced,
                "stale": stale,
            })

    def update_cohorts(self, data, current):
        qqq_bar = self.bar_for(data, self.qqq)
        if qqq_bar is None or not finite(qqq_bar.close) or float(qqq_bar.close) <= 0:
            return
        for cohort in self.open_cohorts:
            cohort["days"] += 1
            for entries in cohort["groups"].values():
                for entry in entries:
                    if entry["forced"]:
                        continue
                    bar = self.bar_for(data, entry["symbol"])
                    if bar is not None and finite(bar.close) and float(bar.close) > 0:
                        entry["last"] = float(bar.close)
                        entry["last_date"] = current
            for months, trading_days in HORIZONS.items():
                if cohort["days"] >= trading_days and months not in cohort["completed"]:
                    self.finish_horizon(cohort, months, current, float(qqq_bar.close))
                    cohort["completed"].add(months)
        self.open_cohorts = [
            cohort for cohort in self.open_cohorts if 12 not in cohort["completed"]
        ]

    def period_result_rows(self, label, months):
        if label == "DEV":
            return [
                row for row in self.cohort_results
                if row["months"] == months and FIRST_SIGNAL <= row["signal_date"] <= DEVELOP_END
            ]
        return [
            row for row in self.cohort_results
            if row["months"] == months and VALIDATE_START <= row["signal_date"] <= datetime(2024, 12, 31).date()
        ]

    def horizon_summary(self, label, months):
        rows = self.period_result_rows(label, months)
        quintiles = {}
        for quintile in range(1, 6):
            selected = [row for row in rows if row["quintile"] == quintile]
            quintiles[quintile] = {
                "cohorts": len(selected),
                "return": average(row["return"] for row in selected),
                "qqq": average(row["qqq"] for row in selected),
                "excess": average(row["excess"] for row in selected),
                "forced": sum(row["forced"] for row in selected),
                "stale": sum(row["stale"] for row in selected),
            }
        if any(quintiles[q]["return"] is None for q in range(1, 6)):
            return {"quintiles": quintiles, "pass": False}

        excesses = [quintiles[q]["excess"] for q in range(1, 6)]
        rho = spearman(excesses)
        spread = quintiles[5]["return"] - quintiles[1]["return"]
        top_excess = quintiles[5]["excess"]
        by_signal = defaultdict(dict)
        signal_indices = {}
        for row in rows:
            by_signal[row["signal_date"]][row["quintile"]] = row["return"]
            signal_indices[row["signal_date"]] = row["signal_index"]
        offsets = defaultdict(list)
        for signal_date, values in by_signal.items():
            if 1 in values and 5 in values:
                offset = signal_indices[signal_date] % months
                offsets[offset].append(values[5] - values[1])
        positive_offsets = sum((average(values) or 0.0) > 0 for values in offsets.values())
        offset_share = positive_offsets / len(offsets) if offsets else 0.0
        passed = (
            rho is not None and rho >= 0.50
            and spread > 0
            and top_excess > 0
            and offset_share >= 0.50
        )
        return {
            "quintiles": quintiles,
            "rho": rho,
            "spread": spread,
            "top_excess": top_excess,
            "positive_offsets": positive_offsets,
            "offsets": len(offsets),
            "offset_share": offset_share,
            "pass": passed,
        }

    def on_end_of_algorithm(self):
        data_passed, development, validation = self.emit_data_quality("SUE")
        summaries = {}
        for label in ("DEV", "VAL"):
            for months in (3, 6, 12):
                summary = self.horizon_summary(label, months)
                summaries[(label, months)] = summary
                for quintile in range(1, 6):
                    row = summary["quintiles"][quintile]
                    self.debug(
                        f"SUE_Q|period={label}|h={months}|q={quintile}|"
                        f"cohorts={row['cohorts']}|return={row['return'] or 0:.6f}|"
                        f"qqq={row['qqq'] or 0:.6f}|excess={row['excess'] or 0:.6f}|"
                        f"forced={row['forced']}|stale={row['stale']}"
                    )
                self.debug(
                    f"SUE_SPREAD|period={label}|h={months}|pass={int(summary['pass'])}|"
                    f"rho={summary.get('rho') or 0:.6f}|spread={summary.get('spread') or 0:.6f}|"
                    f"top_excess={summary.get('top_excess') or 0:.6f}|"
                    f"offset_positive={summary.get('positive_offsets', 0)}|"
                    f"offset_total={summary.get('offsets', 0)}|"
                    f"offset_share={summary.get('offset_share', 0):.6f}"
                )

        passing_horizons = [
            months for months in (3, 6, 12)
            if summaries[("DEV", months)]["pass"] and summaries[("VAL", months)]["pass"]
        ]
        entry_intended = sum(row["intended"] for row in self.entry_records)
        entry_count = sum(row["entered"] for row in self.entry_records)
        entry_coverage = entry_count / entry_intended if entry_intended else 0.0
        target = data_passed and len(passing_horizons) >= 2 and entry_coverage >= MIN_ENTRY_COVERAGE
        self.debug(
            f"SUE_SIGNAL_META|cohorts={len(set(row['signal_date'] for row in self.cohort_results))}|"
            f"results={len(self.cohort_results)}|open_incomplete={len(self.open_cohorts)}|"
            f"entry_coverage={entry_coverage:.6f}|entry_skipped={self.skipped_entry_cohorts}|"
            f"q5_turnover={average(self.quintile_turnovers) or 0:.6f}|"
            f"forced={len(self.forced_exit_records)}"
        )
        self.debug(
            f"SUE_SIGNAL_GATE|pass={int(target)}|data_pass={int(data_passed)}|"
            f"passing_horizons={','.join(str(value) for value in passing_horizons) or 'NONE'}|"
            f"dev_coverage={development['coverage']:.6f}|"
            f"val_coverage={validation['coverage']:.6f}|entry_coverage={entry_coverage:.6f}"
        )
        self.set_summary_statistic(
            "SUE Signal Gate",
            f"pass={int(target)}; horizons={','.join(str(value) for value in passing_horizons) or 'none'}; "
            f"coverage {development['coverage']:.1%}/{validation['coverage']:.1%}",
        )
