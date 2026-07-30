from __future__ import annotations

import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from snapshot_ledger import DISCLAIMER, create_snapshot


def write_json(path: Path, payload: dict) -> None:
    path.write_text(
        json.dumps(payload, ensure_ascii=False),
        encoding="utf-8",
    )


def daily_payload(*, first_trading_day: bool) -> dict:
    return {
        "disclaimer": DISCLAIMER,
        "generated_at_utc": "2026-08-03T22:00:00+00:00",
        "market_data_date": "2026-08-03",
        "market_calendar": {
            "market_date": "2026-08-03",
            "is_first_trading_day_of_month": first_trading_day,
        },
        "funnel": {"final_signals": 1},
        "watchlist_drawdown_breadth": {
            "drawdown_condition_pass": 5,
            "watchlist_securities": 31,
            "share": 5 / 31,
        },
        "signal_tag_distribution": {
            "trend": {"추세이탈": 1},
            "decline_cause": {"시장동반": 1},
        },
        "market_context": {
            "sp500_index": {"drawdown_pct": 4.0},
            "spy": {"adjusted_close": 700.0},
            "sp500_constituent_drawdown_median_pct": 12.0,
            "sp500_constituent_drawdown_distribution_pct": {
                "sample_count": 500,
                "q1_pct": 6.0,
                "median_pct": 12.0,
                "q3_pct": 20.0,
            },
        },
        "sector_drawdown_medians_pct": {
            "Information Technology": 29.0,
        },
        "sector_drawdown_distributions_pct": {
            "Information Technology": {
                "sample_count": 73,
                "q1_pct": 12.0,
                "median_pct": 29.0,
                "q3_pct": 40.0,
            },
        },
        "sector_median_sample_counts": {
            "Information Technology": 73,
        },
        "signals": [
            {
                "symbol": "TEST",
                "adjusted_close": 100.0,
                "sector_drawdown_median_pct": 29.0,
                "sp500_constituent_drawdown_median_pct": 12.0,
                "drawdown_to_sector_median_ratio": 1.2,
                "trend": "추세이탈",
                "decline_cause": "시장동반",
            }
        ],
    }


def watchlist_payload() -> dict:
    return {
        "disclaimer": DISCLAIMER,
        "generated_at_utc": "2026-07-30T00:00:00+00:00",
        "as_of_date": "2026-07-30",
        "financial_data_freshness": {"latest": "2026 Q1"},
        "funnel": {"watchlist_securities": 31},
    }


class SnapshotLedgerTest(unittest.TestCase):
    def test_non_first_trading_day_does_not_create_snapshot(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            daily_path = root / "daily.json"
            watchlist_path = root / "watchlist.json"
            write_json(
                daily_path,
                daily_payload(first_trading_day=False),
            )
            write_json(watchlist_path, watchlist_payload())

            result = create_snapshot(
                daily_path=daily_path,
                watchlist_path=watchlist_path,
                ledger_dir=root / "ledger",
            )

            self.assertIsNone(result)
            self.assertFalse((root / "ledger" / "signals").exists())

    def test_snapshot_is_immutable_and_keeps_median_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            daily_path = root / "daily.json"
            watchlist_path = root / "watchlist.json"
            write_json(
                daily_path,
                daily_payload(first_trading_day=True),
            )
            write_json(watchlist_path, watchlist_payload())
            now = datetime(2026, 8, 3, 22, tzinfo=timezone.utc)

            output = create_snapshot(
                daily_path=daily_path,
                watchlist_path=watchlist_path,
                ledger_dir=root / "ledger",
                now=now,
            )
            snapshot = json.loads(output.read_text(encoding="utf-8"))

            self.assertEqual(snapshot["signal_count"], 1)
            self.assertEqual(
                snapshot["market_context"][
                    "sp500_constituent_drawdown_median_pct"
                ],
                12.0,
            )
            self.assertEqual(
                snapshot["signals"][0][
                    "sector_drawdown_median_pct"
                ],
                29.0,
            )
            self.assertEqual(
                snapshot["signals"][0][
                    "drawdown_to_sector_median_ratio"
                ],
                1.2,
            )
            self.assertEqual(
                snapshot["sector_drawdown_distributions_pct"][
                    "Information Technology"
                ]["q1_pct"],
                12.0,
            )
            self.assertEqual(
                snapshot["signals"][0]["entry_price_assumption"][
                    "status"
                ],
                "PENDING_NEXT_TRADING_DAY_OPEN",
            )
            with self.assertRaises(FileExistsError):
                create_snapshot(
                    daily_path=daily_path,
                    watchlist_path=watchlist_path,
                    ledger_dir=root / "ledger",
                    now=now,
                )


if __name__ == "__main__":
    unittest.main()
