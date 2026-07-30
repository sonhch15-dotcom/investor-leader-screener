from __future__ import annotations

import copy
import unittest
from datetime import date, timedelta

from update_watchlist import DISCLAIMER, build_issuers
from watchlist_core import (
    MAX_TOTAL_LIABILITIES_TO_EQUITY,
    evaluate_issuer,
)


AS_OF = date(2026, 7, 30)
QUARTERS = [
    ("2024-04-01", "2024-06-30"),
    ("2024-07-01", "2024-09-30"),
    ("2024-10-01", "2024-12-31"),
    ("2025-01-01", "2025-03-31"),
    ("2025-04-01", "2025-06-30"),
    ("2025-07-01", "2025-09-30"),
    ("2025-10-01", "2025-12-31"),
    ("2026-01-01", "2026-03-31"),
]


def duration_fact(values: list[float], unit: str = "USD") -> dict:
    rows = []
    for index, ((start, end), value) in enumerate(
        zip(QUARTERS, values, strict=True)
    ):
        filed = date.fromisoformat(end) + timedelta(days=40)
        rows.append(
            {
                "start": start,
                "end": end,
                "val": value,
                "filed": filed.isoformat(),
                "accn": f"0000000000-26-{index:06d}",
                "form": "10-Q",
            }
        )
    return {"units": {unit: rows}}


def instant_fact(values: list[float]) -> dict:
    rows = []
    for index, ((_, end), value) in enumerate(
        zip(QUARTERS, values, strict=True)
    ):
        filed = date.fromisoformat(end) + timedelta(days=40)
        rows.append(
            {
                "end": end,
                "val": value,
                "filed": filed.isoformat(),
                "accn": f"0000000000-26-{index:06d}",
                "form": "10-Q",
            }
        )
    return {"units": {"USD": rows}}


def companyfacts(*, gross_profit: bool = False) -> dict:
    facts = {
        "RevenueFromContractWithCustomerExcludingAssessedTax": (
            duration_fact([100, 105, 110, 115, 120, 125, 130, 135])
        ),
        "NetIncomeLoss": duration_fact([10] * 8),
        "NetCashProvidedByUsedInOperatingActivities": duration_fact(
            [12] * 8
        ),
        (
            "StockholdersEquityIncludingPortionAttributableTo"
            "NoncontrollingInterest"
        ): instant_fact([100] * 8),
    }
    if gross_profit:
        facts["GrossProfit"] = duration_fact(
            [60, 63, 66, 69, 72, 75, 78, 81]
        )
    return {"facts": {"us-gaap": facts}}


def issuer() -> dict:
    return {
        "issuer_id": "0000000001",
        "current_cik": "0000000001",
        "financial_cik": "0000000001",
        "sector": "Industrials",
        "symbols": ["TEST"],
        "names": ["Test Corp"],
        "securities": [
            {
                "symbol": "TEST",
                "yahoo_ticker": "TEST",
                "name": "Test Corp",
            }
        ],
    }


def balance(
    *,
    period: str,
    liabilities: float,
    equity: float,
    status: str = "ratio_available",
) -> dict:
    return {
        "dataset_quarter": "test",
        "status": status,
        "resolved": True,
        "provenance_complete": True,
        "ratio": (
            liabilities / equity if status == "ratio_available" else None
        ),
        "liabilities": liabilities,
        "equity": equity,
        "formula": "Liabilities/TotalEquity",
        "financial_period_end": period,
        "filed": (
            date.fromisoformat(period) + timedelta(days=40)
        ).isoformat(),
        "accession": "0000000000-26-000001",
        "form": "10-Q",
    }


def nonpayer_status() -> dict:
    return {
        "classification": "NO_DIVIDEND_PAYMENT_TRAILING_365D",
        "trailing_start": "2025-07-30",
        "as_of_date": AS_OF.isoformat(),
        "payments": [],
        "source": "test",
    }


def evaluate(facts: dict | None = None) -> dict:
    return evaluate_issuer(
        issuer(),
        facts or companyfacts(),
        balance(
            period="2026-03-31",
            liabilities=50,
            equity=100,
        ),
        balance(
            period="2025-03-31",
            liabilities=45,
            equity=100,
        ),
        AS_OF,
        nonpayer_status(),
    )


class WatchlistRulesTest(unittest.TestCase):
    def test_preregistered_threshold_and_disclaimer_are_exact(self) -> None:
        self.assertEqual(
            MAX_TOTAL_LIABILITIES_TO_EQUITY,
            1.268891979601298,
        )
        self.assertEqual(
            DISCLAIMER,
            "검증된 성과 우위 없음 · 조사 후보 목록",
        )

    def test_missing_gross_profit_is_tagged_not_excluded(self) -> None:
        result = evaluate()

        self.assertEqual(result["stage"], "WATCHLIST")
        self.assertTrue(result["data_complete"])
        self.assertIn("GROSS_MARGIN_NOT_EVALUABLE", result["tags"])
        self.assertEqual(result["red_flags"], [])

    def test_missing_required_cash_flow_is_data_insufficient(self) -> None:
        facts = companyfacts()
        del facts["facts"]["us-gaap"][
            "NetCashProvidedByUsedInOperatingActivities"
        ]

        result = evaluate(facts)

        self.assertEqual(result["stage"], "DATA_INSUFFICIENT")
        self.assertFalse(result["data_complete"])
        self.assertIn(
            "OPERATING_CASH_FLOW_4_QUARTERS_MISSING",
            result["data_insufficient_reasons"],
        )

    def test_each_of_latest_four_net_income_quarters_must_be_positive(
        self,
    ) -> None:
        facts = companyfacts()
        net_income_rows = facts["facts"]["us-gaap"]["NetIncomeLoss"][
            "units"
        ]["USD"]
        net_income_rows[-1]["val"] = -1

        result = evaluate(facts)

        self.assertEqual(result["stage"], "QUALITY_GATE_FAILED")
        self.assertGreater(result["metrics"]["ttm_net_income"], 0)
        self.assertIn(
            "NET_INCOME_NOT_POSITIVE_IN_EACH_OF_LATEST_4_QUARTERS",
            result["quality_failures"],
        )

    def test_nonpositive_equity_is_quality_failure_not_missing(self) -> None:
        facts = companyfacts()
        equity_tag = (
            "StockholdersEquityIncludingPortionAttributableTo"
            "NoncontrollingInterest"
        )
        facts["facts"]["us-gaap"][equity_tag]["units"]["USD"][-1][
            "val"
        ] = -10

        result = evaluate_issuer(
            issuer(),
            facts,
            balance(
                period="2026-03-31",
                liabilities=50,
                equity=-10,
                status="nonpositive_equity_auto_fail",
            ),
            balance(
                period="2025-03-31",
                liabilities=45,
                equity=100,
            ),
            AS_OF,
            nonpayer_status(),
        )

        self.assertTrue(result["data_complete"])
        self.assertEqual(result["stage"], "QUALITY_GATE_FAILED")
        self.assertIn(
            "NONPOSITIVE_EQUITY_AUTO_FAIL",
            result["quality_failures"],
        )

    def test_zero_prior_liabilities_is_not_silently_skipped(self) -> None:
        result = evaluate_issuer(
            issuer(),
            companyfacts(),
            balance(
                period="2026-03-31",
                liabilities=50,
                equity=100,
            ),
            balance(
                period="2025-03-31",
                liabilities=0,
                equity=100,
            ),
            AS_OF,
            nonpayer_status(),
        )

        self.assertEqual(result["stage"], "DATA_INSUFFICIENT")
        self.assertIn(
            "PRIOR_YEAR_TOTAL_LIABILITIES_NONPOSITIVE",
            result["data_insufficient_reasons"],
        )

    def test_current_payer_without_sec_dividend_history_is_incomplete(
        self,
    ) -> None:
        result = evaluate_issuer(
            issuer(),
            companyfacts(),
            balance(
                period="2026-03-31",
                liabilities=50,
                equity=100,
            ),
            balance(
                period="2025-03-31",
                liabilities=45,
                equity=100,
            ),
            AS_OF,
            {
                "classification": "CURRENT_PAYER",
                "trailing_start": "2025-07-30",
                "as_of_date": AS_OF.isoformat(),
                "payments": [
                    {
                        "date": "2026-06-01",
                        "amount": 0.25,
                    }
                ],
                "source": "test",
            },
        )

        self.assertEqual(result["stage"], "DATA_INSUFFICIENT")
        self.assertIn(
            "DIVIDEND_HISTORY_DATA_INSUFFICIENT",
            result["data_insufficient_reasons"],
        )

    def test_nonpayer_gets_explicit_not_applicable_tag(self) -> None:
        result = evaluate()

        self.assertEqual(result["stage"], "WATCHLIST")
        self.assertIn(
            "DIVIDEND_CUT_NOT_APPLICABLE_NON_PAYER",
            result["tags"],
        )

    def test_gross_margin_drop_is_a_red_flag(self) -> None:
        facts = companyfacts(gross_profit=True)
        gross_rows = facts["facts"]["us-gaap"]["GrossProfit"]["units"][
            "USD"
        ]
        gross_rows[-1]["val"] = 40

        result = evaluate(facts)

        self.assertEqual(result["stage"], "RED_FLAG_FAILED")
        self.assertIn(
            "GROSS_MARGIN_YOY_DROP_5PCT_POINTS",
            result["red_flags"],
        )
        self.assertNotIn("GROSS_MARGIN_NOT_EVALUABLE", result["tags"])

    def test_share_classes_keep_security_name_mapping(self) -> None:
        securities = [
            {
                "symbol": "ZZZ.B",
                "yahoo_ticker": "ZZZ-B",
                "name": "Zeta Class B",
                "sector": "Industrials",
                "cik": "0000000123",
            },
            {
                "symbol": "ZZZ.A",
                "yahoo_ticker": "ZZZ-A",
                "name": "Zeta Class A",
                "sector": "Industrials",
                "cik": "0000000123",
            },
        ]

        included, excluded = build_issuers(copy.deepcopy(securities))

        self.assertEqual(excluded, [])
        self.assertEqual(len(included), 1)
        self.assertEqual(
            included[0]["securities"],
            [
                {
                    "symbol": "ZZZ.A",
                    "yahoo_ticker": "ZZZ-A",
                    "name": "Zeta Class A",
                },
                {
                    "symbol": "ZZZ.B",
                    "yahoo_ticker": "ZZZ-B",
                    "name": "Zeta Class B",
                },
            ],
        )


if __name__ == "__main__":
    unittest.main()
