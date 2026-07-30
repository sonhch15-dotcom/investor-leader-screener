from __future__ import annotations

import unittest
from datetime import date, timedelta
from pathlib import Path
import tempfile

import pandas as pd

from daily_scan import (
    build_scan,
    evaluate_price,
    extract_histories,
    market_session_status,
    write_new_json,
    wilder_rsi,
)


MARKET_DATE = date(2026, 7, 29)


def history(
    closes: list[float],
    *,
    end: date = MARKET_DATE,
) -> pd.DataFrame:
    dates = pd.bdate_range(
        end=end,
        periods=len(closes),
    )
    return pd.DataFrame(
        {
            "Close": [value * 2 for value in closes],
            "Adj Close": closes,
            "High": [value * 2 for value in closes],
        },
        index=dates,
    )


class IndicatorTest(unittest.TestCase):
    def test_wilder_rsi_edge_cases(self) -> None:
        increasing = pd.Series(range(1, 30), dtype="float64")
        flat = pd.Series([10.0] * 30)

        self.assertEqual(wilder_rsi(increasing), 100.0)
        self.assertEqual(wilder_rsi(flat), 50.0)

    def test_price_indicators_use_adjusted_prices(self) -> None:
        closes = [100.0] * 251 + [80.0]
        frame = history(closes)
        frame["High"] = frame["Close"] * 1.1

        result = evaluate_price(frame, MARKET_DATE)

        self.assertEqual(result["status"], "AVAILABLE")
        self.assertEqual(result["adjusted_close"], 80.0)
        self.assertAlmostEqual(
            result["high_52_week_adjusted"],
            110.0,
        )
        self.assertAlmostEqual(
            result["drawdown_pct"],
            (1 - 80 / 110) * 100,
        )
        self.assertEqual(result["trend"], "추세이탈")

    def test_short_history_is_data_insufficient(self) -> None:
        result = evaluate_price(history([100.0] * 251), MARKET_DATE)

        self.assertEqual(result["status"], "DATA_INSUFFICIENT")
        self.assertEqual(
            result["reason"],
            "ADJUSTED_PRICE_252D_MISSING",
        )


class DownloadShapeTest(unittest.TestCase):
    def test_extracts_ticker_first_multiindex(self) -> None:
        frame = pd.concat(
            {
                "AAA": history([100.0] * 252),
                "BBB": history([90.0] * 252),
            },
            axis=1,
        )

        result = extract_histories(frame, ["AAA", "BBB"])

        self.assertEqual(set(result), {"AAA", "BBB"})
        self.assertIn("Adj Close", result["AAA"].columns)

    def test_market_session_status_distinguishes_closed_day(self) -> None:
        index = history([100.0] * 252)

        open_status = market_session_status(index, MARKET_DATE)
        closed_status = market_session_status(
            index,
            MARKET_DATE + timedelta(days=1),
        )

        self.assertTrue(open_status["is_requested_date_available"])
        self.assertFalse(closed_status["is_requested_date_available"])
        self.assertEqual(
            closed_status["latest_available_market_date"],
            MARKET_DATE.isoformat(),
        )


class ScanTest(unittest.TestCase):
    def test_sector_median_uses_full_constituent_universe(self) -> None:
        index = history([100.0] * 252)
        signal = history([100.0] * 251 + [80.0])
        peer_one = history([100.0] * 251 + [85.0])
        peer_two = history([100.0] * 251 + [90.0])
        constituents = {
            "constituents": [
                {
                    "symbol": "AAA",
                    "yahoo_ticker": "AAA",
                    "name": "AAA",
                    "sector": "Industrials",
                },
                {
                    "symbol": "BBB",
                    "yahoo_ticker": "BBB",
                    "name": "BBB",
                    "sector": "Industrials",
                },
                {
                    "symbol": "CCC",
                    "yahoo_ticker": "CCC",
                    "name": "CCC",
                    "sector": "Industrials",
                },
            ]
        }
        watchlist = {
            "as_of_date": "2026-07-29",
            "generated_at_utc": "2026-07-29T22:00:00+00:00",
            "financial_data_freshness": {},
            "watchlist": [
                {
                    "symbol": "AAA",
                    "yahoo_ticker": "AAA",
                    "name": "AAA",
                    "sector": "Industrials",
                    "roe": 0.2,
                    "total_liabilities_to_equity": 0.5,
                    "financial_periods": {},
                    "tags": [],
                }
            ]
        }

        payload = build_scan(
            as_of=MARKET_DATE,
            constituents_payload=constituents,
            watchlist_payload=watchlist,
            histories={
                "^GSPC": index,
                "SPY": index,
                "AAA": signal,
                "BBB": peer_one,
                "CCC": peer_two,
            },
            missing_downloads=[],
        )

        row = payload["watchlist_scan"][0]
        self.assertAlmostEqual(row["sector_drawdown_median_pct"], 15)
        self.assertEqual(row["decline_cause"], "개별하락")
        self.assertAlmostEqual(
            row["drawdown_to_sector_median_ratio"],
            20 / 15,
        )
        self.assertTrue(row["drawdown_condition_pass"])
        self.assertTrue(row["rsi_condition_pass"])
        self.assertEqual(
            payload["sector_median_sample_counts"]["Industrials"],
            3,
        )
        distribution = payload[
            "sector_drawdown_distributions_pct"
        ]["Industrials"]
        self.assertEqual(distribution["sample_count"], 3)
        self.assertAlmostEqual(distribution["q1_pct"], 12.5)
        self.assertAlmostEqual(distribution["median_pct"], 15.0)
        self.assertAlmostEqual(distribution["q3_pct"], 17.5)
        self.assertAlmostEqual(
            row["sp500_constituent_drawdown_median_pct"],
            15,
        )
        self.assertAlmostEqual(
            payload["market_context"][
                "sp500_constituent_drawdown_median_pct"
            ],
            15,
        )
        self.assertEqual(
            payload["watchlist_drawdown_breadth"],
            {
                "drawdown_condition_pass": 1,
                "watchlist_securities": 1,
                "share": 1.0,
            },
        )
        self.assertEqual(payload["funnel"]["final_signals"], 1)

    def test_daily_result_is_append_only(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "2026-07-29.json"

            write_new_json(output, {"version": 1})

            with self.assertRaises(FileExistsError):
                write_new_json(output, {"version": 2})


if __name__ == "__main__":
    unittest.main()
