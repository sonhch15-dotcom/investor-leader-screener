from __future__ import annotations

import json
import tempfile
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pandas as pd

from update_performance import (
    DISCLAIMER,
    HOLDING_PERIODS,
    aggregate_outcomes,
    build_entry_payload,
    ensure_entry,
    evaluate_track,
    render_performance,
    update_performance,
)


def history(
    sessions: list[date],
    *,
    entry_open: float,
    closes: dict[int, float],
) -> pd.DataFrame:
    values = [100.0 for _ in sessions]
    for session_number, value in closes.items():
        values[session_number - 1] = value
    opens = list(values)
    opens[0] = entry_open
    return pd.DataFrame(
        {
            "Open": opens,
            "Close": values,
            "Adj Close": values,
        },
        index=pd.to_datetime(sessions),
    )


def snapshot_payload(
    *,
    signal_date: str,
    symbols: tuple[str, ...] = ("AAA", "BBB"),
) -> dict:
    return {
        "disclaimer": DISCLAIMER,
        "schema_version": 1,
        "signal_date": signal_date,
        "signal_count": len(symbols),
        "signals": [
            {
                "symbol": symbol,
                "yahoo_ticker": symbol,
                "entry_price_assumption": {
                    "status": "PENDING_NEXT_TRADING_DAY_OPEN",
                },
            }
            for symbol in symbols
        ],
    }


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def complete_outcome(
    signal_date: str,
    *,
    cohort_return: float,
    spy_return: float,
    signal_count: int = 1,
) -> dict:
    return {
        "disclaimer": DISCLAIMER,
        "status": "COMPLETE",
        "signal_date": signal_date,
        "holding_period_trading_days": 63,
        "signal_count": signal_count,
        "cohort_total_return": cohort_return,
        "spy_total_return": spy_return,
        "excess_return_vs_spy": cohort_return - spy_return,
    }


class PerformanceCalculationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.signal_date = date(2026, 1, 1)
        self.sessions = [
            self.signal_date + timedelta(days=index)
            for index in range(1, 253)
        ]
        self.histories = {
            "SPY": history(
                self.sessions,
                entry_open=100.0,
                closes={63: 110.0, 126: 120.0, 252: 130.0},
            ),
            "AAA": history(
                self.sessions,
                entry_open=100.0,
                closes={63: 120.0, 126: 130.0, 252: 140.0},
            ),
            "BBB": history(
                self.sessions,
                entry_open=200.0,
                closes={
                    1: 200.0,
                    63: 200.0,
                    126: 240.0,
                    252: 180.0,
                },
            ),
        }

    def test_all_horizons_and_spy_excess_are_exact(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            snapshot_path = root / "signals" / "2026-01-01.json"
            snapshot = snapshot_payload(signal_date="2026-01-01")
            write_json(snapshot_path, snapshot)
            entry = build_entry_payload(
                snapshot_path,
                snapshot,
                self.histories,
                as_of=self.sessions[-1],
                generated_at_utc="2026-01-02T22:00:00+00:00",
            )
            entry_path = root / "entries" / "2026-01-01.json"
            write_json(entry_path, entry)

            expected = {
                63: (0.10, 0.10, 0.00),
                126: (0.25, 0.20, 0.05),
                252: (0.15, 0.30, -0.15),
            }
            for period in HOLDING_PERIODS:
                result = evaluate_track(
                    snapshot_path,
                    snapshot,
                    entry_path,
                    entry,
                    self.histories,
                    holding_period=period,
                    as_of=self.sessions[-1],
                    generated_at_utc="2026-12-31T22:00:00+00:00",
                )
                self.assertEqual(result["status"], "COMPLETE")
                self.assertAlmostEqual(
                    result["cohort_total_return"],
                    expected[period][0],
                )
                self.assertAlmostEqual(
                    result["spy_total_return"],
                    expected[period][1],
                )
                self.assertAlmostEqual(
                    result["excess_return_vs_spy"],
                    expected[period][2],
                )

    def test_entry_file_is_separate_and_never_overwritten(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            snapshot_path = (
                root / "signals" / "2026-01-01.json"
            )
            snapshot = snapshot_payload(signal_date="2026-01-01")
            write_json(snapshot_path, snapshot)
            original = snapshot_path.read_bytes()

            entry, entry_path, created = ensure_entry(
                snapshot_path,
                snapshot,
                self.histories,
                ledger_dir=root,
                as_of=self.sessions[0],
                generated_at_utc="2026-01-02T22:00:00+00:00",
            )
            first_entry_bytes = entry_path.read_bytes()
            _, _, created_again = ensure_entry(
                snapshot_path,
                snapshot,
                self.histories,
                ledger_dir=root,
                as_of=self.sessions[1],
                generated_at_utc="2026-01-03T22:00:00+00:00",
            )

            self.assertTrue(created)
            self.assertFalse(created_again)
            self.assertEqual(snapshot_path.read_bytes(), original)
            self.assertEqual(entry_path.read_bytes(), first_entry_bytes)
            self.assertEqual(entry["entry_date"], "2026-01-02")
            self.assertEqual(entry["status"], "COMPLETE")
            self.assertEqual(
                entry["signals"][0][
                    "next_trading_day_adjusted_open"
                ],
                100.0,
            )

    def test_right_censoring_has_no_return(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            snapshot_path = root / "signals" / "2026-01-01.json"
            snapshot = snapshot_payload(
                signal_date="2026-01-01",
                symbols=("AAA",),
            )
            write_json(snapshot_path, snapshot)
            short_histories = {
                ticker: frame.iloc[:20]
                for ticker, frame in self.histories.items()
                if ticker in {"SPY", "AAA"}
            }
            entry = build_entry_payload(
                snapshot_path,
                snapshot,
                short_histories,
                as_of=self.sessions[19],
                generated_at_utc="2026-01-02T22:00:00+00:00",
            )
            entry_path = root / "entries" / "2026-01-01.json"
            write_json(entry_path, entry)

            result = evaluate_track(
                snapshot_path,
                snapshot,
                entry_path,
                entry,
                short_histories,
                holding_period=63,
                as_of=self.sessions[19],
                generated_at_utc="2026-01-21T22:00:00+00:00",
            )

            self.assertEqual(result["status"], "RIGHT_CENSORED")
            self.assertNotIn("cohort_total_return", result)

    def test_exit_session_only_requires_adjusted_close(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            snapshot_path = root / "signals" / "2026-01-01.json"
            snapshot = snapshot_payload(
                signal_date="2026-01-01",
                symbols=("AAA",),
            )
            write_json(snapshot_path, snapshot)
            entry = build_entry_payload(
                snapshot_path,
                snapshot,
                self.histories,
                as_of=self.sessions[0],
                generated_at_utc="2026-01-02T22:00:00+00:00",
            )
            entry_path = root / "entries" / "2026-01-01.json"
            write_json(entry_path, entry)
            histories = {
                ticker: frame.copy()
                for ticker, frame in self.histories.items()
            }
            for ticker in ("SPY", "AAA"):
                histories[ticker].loc[
                    pd.Timestamp(self.sessions[62]),
                    "Open",
                ] = float("nan")

            result = evaluate_track(
                snapshot_path,
                snapshot,
                entry_path,
                entry,
                histories,
                holding_period=63,
                as_of=self.sessions[62],
                generated_at_utc="2026-03-05T22:00:00+00:00",
            )

            self.assertEqual(result["status"], "COMPLETE")
            self.assertAlmostEqual(result["cohort_total_return"], 0.20)
            self.assertAlmostEqual(result["spy_total_return"], 0.10)

    def test_ended_price_series_is_an_explicit_incident(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            snapshot_path = root / "signals" / "2026-01-01.json"
            snapshot = snapshot_payload(
                signal_date="2026-01-01",
                symbols=("AAA",),
            )
            write_json(snapshot_path, snapshot)
            entry = build_entry_payload(
                snapshot_path,
                snapshot,
                self.histories,
                as_of=self.sessions[0],
                generated_at_utc="2026-01-02T22:00:00+00:00",
            )
            entry_path = root / "entries" / "2026-01-01.json"
            write_json(entry_path, entry)
            ended = dict(self.histories)
            ended["AAA"] = ended["AAA"].iloc[:20]

            result = evaluate_track(
                snapshot_path,
                snapshot,
                entry_path,
                entry,
                ended,
                holding_period=63,
                as_of=self.sessions[62],
                generated_at_utc="2026-03-05T22:00:00+00:00",
            )

            self.assertEqual(
                result["status"],
                "DATA_INCIDENT_REVIEW_REQUIRED",
            )
            self.assertIn(
                "POSSIBLE_DELISTING_ACQUISITION_OR_TICKER_CHANGE",
                result["incidents"][0]["reason"],
            )
            self.assertNotIn("cohort_total_return", result)

    def test_monthly_cohorts_are_equal_weighted(self) -> None:
        outcomes = [
            complete_outcome(
                "2026-01-01",
                cohort_return=0.10,
                spy_return=0.05,
                signal_count=1,
            ),
            complete_outcome(
                "2026-02-01",
                cohort_return=0.30,
                spy_return=0.15,
                signal_count=9,
            ),
        ]

        aggregate = aggregate_outcomes(outcomes)

        self.assertAlmostEqual(
            aggregate["mean_cohort_total_return"],
            0.20,
        )
        self.assertAlmostEqual(
            aggregate["mean_spy_total_return"],
            0.10,
        )
        self.assertAlmostEqual(
            aggregate["mean_excess_return_vs_spy"],
            0.10,
        )

    def test_report_hides_averages_before_twenty_cohorts(self) -> None:
        outcomes = {
            period: {
                f"2026-{index + 1:02d}-01": complete_outcome(
                    f"2026-{index + 1:02d}-01",
                    cohort_return=0.10,
                    spy_return=0.05,
                )
                for index in range(19)
            }
            for period in HOLDING_PERIODS
        }

        report = render_performance(
            outcomes,
            [],
            as_of=date(2027, 12, 31),
        )

        self.assertEqual(report.count("표본 부족(19/20)"), 3)
        self.assertNotIn("전략 평균 총수익률", report)
        self.assertNotIn("SPY 평균 총수익률", report)
        self.assertNotIn("SPY 대비 평균 초과수익", report)

    def test_report_shows_averages_at_twenty_cohorts(self) -> None:
        outcomes = {
            period: {
                f"cohort-{index}": complete_outcome(
                    f"cohort-{index}",
                    cohort_return=0.10,
                    spy_return=0.05,
                )
                for index in range(20)
            }
            for period in HOLDING_PERIODS
        }

        report = render_performance(
            outcomes,
            [],
            as_of=date(2028, 8, 1),
        )

        self.assertNotIn("표본 부족", report)
        self.assertEqual(
            report.count("전략 평균 총수익률: 10.00%"),
            3,
        )
        self.assertEqual(
            report.count("SPY 대비 평균 초과수익: 5.00%"),
            3,
        )

    def test_empty_ledger_writes_only_sample_shortage(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            performance_path = root / "performance.md"

            result = update_performance(
                ledger_dir=root,
                performance_path=performance_path,
                as_of=date(2026, 7, 30),
                histories={},
                now=datetime(
                    2026,
                    7,
                    30,
                    22,
                    tzinfo=timezone.utc,
                ),
            )
            report = performance_path.read_text(encoding="utf-8")

            self.assertEqual(result["snapshot_count"], 0)
            self.assertEqual(report.count("표본 부족(0/20)"), 3)
            self.assertNotIn("평균 총수익률", report)

    def test_completed_outcomes_are_never_rewritten(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            snapshot_path = root / "signals" / "2026-01-01.json"
            write_json(
                snapshot_path,
                snapshot_payload(signal_date="2026-01-01"),
            )
            performance_path = root / "performance.md"
            first = update_performance(
                ledger_dir=root,
                performance_path=performance_path,
                as_of=self.sessions[-1],
                histories=self.histories,
                now=datetime(
                    2026,
                    12,
                    31,
                    22,
                    tzinfo=timezone.utc,
                ),
            )
            paths = [
                root / "outcomes" / str(period) / "2026-01-01.json"
                for period in HOLDING_PERIODS
            ]
            original = {path: path.read_bytes() for path in paths}
            revised = {
                ticker: frame.copy()
                for ticker, frame in self.histories.items()
            }
            for frame in revised.values():
                frame["Adj Close"] = frame["Adj Close"] * 10

            second = update_performance(
                ledger_dir=root,
                performance_path=performance_path,
                as_of=self.sessions[-1],
                histories=revised,
                now=datetime(
                    2027,
                    1,
                    1,
                    22,
                    tzinfo=timezone.utc,
                ),
            )

            self.assertEqual(len(first["created_outcomes"]), 3)
            self.assertEqual(second["created_outcomes"], [])
            for path in paths:
                self.assertEqual(path.read_bytes(), original[path])


if __name__ == "__main__":
    unittest.main()
