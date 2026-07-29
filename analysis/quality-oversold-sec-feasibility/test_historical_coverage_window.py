from __future__ import annotations

import ast
import unittest
from pathlib import Path

from historical_coverage_window import (
    CoverageRow,
    YearMonth,
    build_parser,
    select_first_signal_window,
)


ROOT = Path(__file__).resolve().parent
FORBIDDEN_IMPORT_ROOTS = {
    "yfinance",
    "pandas_datareader",
    "pykrx",
    "quantconnect",
}


def row(
    month: str,
    overall: float = 0.90,
    sector: float = 0.80,
    provenance: float = 1.00,
) -> CoverageRow:
    return CoverageRow(
        month=YearMonth.parse(month),
        overall_coverage=overall,
        minimum_sector_coverage=sector,
        provenance_rate=provenance,
    )


class HistoricalCoverageWindowTests(unittest.TestCase):
    def test_earliest_consecutive_window_is_selected(self) -> None:
        result = select_first_signal_window(
            [
                row("2010-01"),
                row("2010-02"),
                row("2010-03"),
                row("2010-04"),
            ],
            calibration_months=3,
        )
        self.assertEqual(result["calibration_start_month"], "2010-01")
        self.assertEqual(result["calibration_end_month"], "2010-03")
        self.assertEqual(result["first_signal_month"], "2010-04")

    def test_missing_month_breaks_the_streak(self) -> None:
        result = select_first_signal_window(
            [
                row("2010-01"),
                row("2010-02"),
                row("2010-04"),
                row("2010-05"),
                row("2010-06"),
            ],
            calibration_months=3,
        )
        self.assertEqual(result["calibration_start_month"], "2010-04")
        self.assertEqual(result["first_signal_month"], "2010-07")

    def test_failed_coverage_breaks_the_streak(self) -> None:
        result = select_first_signal_window(
            [
                row("2010-01"),
                row("2010-02", overall=0.8999),
                row("2010-03"),
                row("2010-04"),
                row("2010-05"),
            ],
            calibration_months=3,
        )
        self.assertEqual(result["calibration_start_month"], "2010-03")
        self.assertEqual(result["first_signal_month"], "2010-06")

    def test_no_valid_window_does_not_choose_a_date(self) -> None:
        result = select_first_signal_window(
            [row("2010-01"), row("2010-02", provenance=0.999)],
            calibration_months=2,
        )
        self.assertEqual(result["status"], "NO_VALID_BACKTEST_START")
        self.assertIsNone(result["first_signal_month"])
        self.assertFalse(result["prices_accessed"])
        self.assertFalse(result["returns_calculated"])

    def test_cli_has_no_price_or_return_arguments(self) -> None:
        destinations = {
            action.dest for action in build_parser()._actions  # noqa: SLF001
        }
        self.assertEqual(
            destinations,
            {"help", "coverage_csv", "output_json"},
        )

    def test_module_has_no_market_data_imports(self) -> None:
        source = (ROOT / "historical_coverage_window.py").read_text(
            encoding="utf-8"
        )
        tree = ast.parse(source)
        imported_roots: set[str] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported_roots.update(
                    alias.name.split(".", 1)[0] for alias in node.names
                )
            elif isinstance(node, ast.ImportFrom) and node.module:
                imported_roots.add(node.module.split(".", 1)[0])
        self.assertFalse(imported_roots & FORBIDDEN_IMPORT_ROOTS)


if __name__ == "__main__":
    unittest.main()
