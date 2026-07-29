from __future__ import annotations

import ast
import unittest
from datetime import date
from pathlib import Path

import pandas as pd

from audit_legacy_price_coverage import coverage_for_range
from build_legacy_price_universe import build_episodes
from summarize_evaluation_coverage import summarize


ROOT = Path(__file__).resolve().parent


class PreReturnDataGateTest(unittest.TestCase):
    def test_annual_financial_gate_uses_worst_month(self) -> None:
        detail = {
            "months": [
                {
                    "month": "2015-10",
                    "overall_coverage": 0.91,
                    "minimum_sector_coverage": 0.81,
                    "provenance_rate": 1.0,
                    "coverage_eligible": True,
                },
                {
                    "month": "2015-11",
                    "overall_coverage": 0.899,
                    "minimum_sector_coverage": 0.95,
                    "provenance_rate": 1.0,
                    "coverage_eligible": False,
                },
            ]
        }
        result = summarize(detail)
        self.assertEqual(
            result["status"], "INVALID_EVALUATION_FINANCIAL_COVERAGE"
        )
        self.assertEqual(
            result["annual"][0]["minimum_overall_coverage"], 0.899
        )

    def test_legacy_episode_is_split_on_missing_month(self) -> None:
        snapshots = []
        for month in ("2015-10", "2015-12", "2016-01"):
            snapshots.append(
                {
                    "month": month,
                    "month_end": f"{month}-28",
                    "constituents": [
                        {
                            "symbol": "OLD",
                            "cik": "0000000001",
                            "name": "Old Co",
                            "sector": "Industrials",
                            "included_in_quality_universe": True,
                        }
                    ],
                }
            )
        result = build_episodes(snapshots)
        self.assertEqual(result["episode_count"], 2)

    def test_price_coverage_counts_dates_not_returns(self) -> None:
        expected = pd.DatetimeIndex(
            ["2020-01-02", "2020-01-03", "2020-01-06"]
        )
        observed = pd.DatetimeIndex(
            ["2020-01-02", "2020-01-03", "2020-01-06"]
        )
        result = coverage_for_range(
            expected, observed, date(2020, 1, 1), date(2020, 1, 31)
        )
        self.assertEqual(result["session_coverage"], 1.0)
        self.assertTrue(result["passes"])

    def test_price_audit_has_no_return_operations(self) -> None:
        tree = ast.parse(
            (ROOT / "audit_legacy_price_coverage.py").read_text(
                encoding="utf-8"
            )
        )
        attributes = {
            node.attr
            for node in ast.walk(tree)
            if isinstance(node, ast.Attribute)
        }
        self.assertFalse(
            attributes
            & {"pct_change", "cumprod", "shift", "rolling_return"}
        )


if __name__ == "__main__":
    unittest.main()
