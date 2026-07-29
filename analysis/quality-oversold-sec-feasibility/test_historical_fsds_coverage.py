from __future__ import annotations

import ast
import csv
import json
import tempfile
import unittest
from datetime import date
from pathlib import Path

from build_historical_fsds_coverage import (
    Filing,
    issuer_population,
    mapping_for_company,
    resolve_population_row,
)
from derive_calibration_p50 import derive


ROOT = Path(__file__).resolve().parent


def filing(period: date) -> Filing:
    return Filing(
        cik="0000000001",
        accession="0000000001-20-000001",
        filed=date(2020, 4, 30),
        period=period,
        form="10-K",
        instance_ticker="ABC",
        balance_sheet_lines=[],
    )


class CoverageMechanicsTest(unittest.TestCase):
    def test_unique_recent_instance_ticker_mapping(self) -> None:
        company = {"symbol": "ABC", "cik": None}
        result = mapping_for_company(
            company,
            date(2020, 6, 30),
            {"ABC": {"0000000001": date(2020, 4, 30)}},
        )
        self.assertEqual(result[0], "0000000001")
        self.assertEqual(result[1], "unique_sec_instance_ticker")

    def test_ambiguous_instance_ticker_is_not_selected(self) -> None:
        company = {"symbol": "ABC", "cik": None}
        result = mapping_for_company(
            company,
            date(2020, 6, 30),
            {
                "ABC": {
                    "0000000001": date(2020, 4, 30),
                    "0000000002": date(2020, 5, 1),
                }
            },
        )
        self.assertIsNone(result[0])
        self.assertEqual(result[1], "ambiguous_sec_instance_ticker")

    def test_numeric_cik_collapses_share_classes(self) -> None:
        snapshot = {
            "constituents": [
                {
                    "symbol": "ABC.A",
                    "name": "ABC",
                    "sector": "Industrials",
                    "cik": "0000000001",
                    "included_in_quality_universe": True,
                },
                {
                    "symbol": "ABC.B",
                    "name": "ABC",
                    "sector": "Industrials",
                    "cik": "0000000001",
                    "included_in_quality_universe": True,
                },
            ]
        }
        population = issuer_population(snapshot, date(2020, 6, 30), {})
        self.assertEqual(len(population), 1)
        self.assertEqual(population[0]["symbols"], "ABC.A,ABC.B")

    def test_stale_latest_filing_does_not_fall_back(self) -> None:
        company = {
            "symbols": "ABC",
            "names": "ABC",
            "sector": "Industrials",
            "sector_conflict": False,
            "mapped_cik": "0000000001",
            "mapping_method": "wikipedia_numeric_cik",
            "mapping_candidates": ["0000000001"],
        }
        row = resolve_population_row(
            company,
            date(2021, 1, 31),
            {"0000000001": filing(date(2020, 1, 1))},
        )
        self.assertEqual(row["status"], "stale_financial_period")
        self.assertFalse(row["resolved"])

    def test_p50_uses_only_ratio_available_in_window(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            rows_path = root / "rows.csv"
            window_path = root / "window.json"
            with rows_path.open("w", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(
                    handle, fieldnames=["month", "status", "ratio"]
                )
                writer.writeheader()
                writer.writerows(
                    [
                        {
                            "month": "2020-01",
                            "status": "ratio_available",
                            "ratio": "1",
                        },
                        {
                            "month": "2020-01",
                            "status": "nonpositive_equity_auto_fail",
                            "ratio": "",
                        },
                        {
                            "month": "2020-02",
                            "status": "ratio_available",
                            "ratio": "3",
                        },
                    ]
                )
            window_path.write_text(
                json.dumps(
                    {
                        "status": "VALID_BACKTEST_START",
                        "calibration_start_month": "2020-01",
                        "calibration_end_month": "2020-02",
                        "first_signal_month": "2020-03",
                        "calibration_months": 2,
                    }
                ),
                encoding="utf-8",
            )
            result = derive(rows_path, window_path)
            self.assertEqual(result["max_total_liabilities_to_equity"], 2.0)

    def test_coverage_modules_do_not_import_price_packages(self) -> None:
        banned = {"yfinance", "pandas_datareader", "pykrx", "quantconnect"}
        for name in (
            "fetch_sec_fsds_archives.py",
            "build_historical_fsds_coverage.py",
            "derive_calibration_p50.py",
        ):
            tree = ast.parse((ROOT / name).read_text(encoding="utf-8"))
            imports = {
                alias.name.split(".")[0]
                for node in ast.walk(tree)
                if isinstance(node, (ast.Import, ast.ImportFrom))
                for alias in node.names
            }
            self.assertFalse(imports & banned)


if __name__ == "__main__":
    unittest.main()
