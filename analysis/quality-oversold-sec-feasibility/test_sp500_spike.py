from __future__ import annotations

import json
import unittest
from pathlib import Path

from analyze_fsds_debt import (
    debt_from_rendered_statement,
    rendered_value,
)
from analyze_fsds_instance_fallback import (
    looks_like_lease_liability,
    nearest_instant,
    normalize_date,
)
from analyze_total_liabilities_equity_fsds import resolve_issuer
from analyze_sp500_debt import linear_quantile


ROOT = Path(__file__).resolve().parent


def fact(tag: str, value: float) -> dict[str, object]:
    return {
        "tag": tag,
        "value": value,
        "method": "test",
        "line": 1,
        "label": tag,
    }


def statement_line(
    line: int,
    tag: str,
    value: float,
    label: str,
    segments: str = "",
) -> dict[str, object]:
    return {
        "line": line,
        "tag": tag,
        "version": "us-gaap/2025",
        "label": label,
        "values": [
            {
                "value": value,
                "segments": segments,
                "footnote": "",
            }
        ],
    }


class RenderedValueTests(unittest.TestCase):
    def test_entity_wide_value_takes_priority_over_dimensions(self) -> None:
        line = {
            "values": [
                {"value": 10.0, "segments": "ProductOrService=A;"},
                {"value": 20.0, "segments": ""},
            ]
        }
        self.assertEqual(rendered_value(line), (20.0, "entity_wide"))

    def test_dimension_sum_deduplicates_segment_alias(self) -> None:
        line = {
            "values": [
                {
                    "value": 20.0,
                    "segments": "ProductOrService=FinancialProducts;",
                },
                {
                    "value": 20.0,
                    "segments": "ProductOrService=FinancialProductsSegment;",
                },
                {
                    "value": 10.0,
                    "segments": "ProductOrService=MachineryPowerEnergy;",
                },
            ]
        }
        self.assertEqual(
            rendered_value(line), (30.0, "summed_rendered_dimensions")
        )


class DebtDefinitionTests(unittest.TestCase):
    def test_explicit_capital_lease_debt_is_strict_complete(self) -> None:
        values = {
            "DebtCurrent": fact("DebtCurrent", 9.0),
            "LongTermDebtAndCapitalLeaseObligations": fact(
                "LongTermDebtAndCapitalLeaseObligations", 34.0
            ),
        }
        strict, reported = debt_from_rendered_statement(values, lease=None)
        self.assertIsNotNone(strict)
        self.assertEqual(strict["value"], 43.0)
        self.assertEqual(strict, reported)

    def test_pure_debt_without_finance_lease_is_not_strict(self) -> None:
        values = {
            "LongTermDebtCurrent": fact("LongTermDebtCurrent", 10.0),
            "LongTermDebtNoncurrent": fact(
                "LongTermDebtNoncurrent", 30.0
            ),
        }
        strict, reported = debt_from_rendered_statement(values, lease=None)
        self.assertIsNone(strict)
        self.assertEqual(reported["value"], 40.0)

    def test_missing_short_term_debt_is_not_strict(self) -> None:
        values = {
            "LongTermDebtCurrent": fact("LongTermDebtCurrent", 10.0),
            "LongTermDebtNoncurrent": fact(
                "LongTermDebtNoncurrent", 30.0
            ),
        }
        lease = fact("FinanceLeaseLiability", 5.0)
        strict, reported = debt_from_rendered_statement(values, lease=lease)
        self.assertIsNone(strict)
        self.assertEqual(reported["value"], 45.0)

    def test_all_explicit_pure_debt_components_are_strict(self) -> None:
        values = {
            "ShortTermBorrowings": fact("ShortTermBorrowings", 2.0),
            "LongTermDebtCurrent": fact("LongTermDebtCurrent", 10.0),
            "LongTermDebtNoncurrent": fact(
                "LongTermDebtNoncurrent", 30.0
            ),
        }
        lease = fact("FinanceLeaseLiability", 5.0)
        strict, reported = debt_from_rendered_statement(values, lease=lease)
        self.assertEqual(strict["value"], 47.0)
        self.assertEqual(strict, reported)

    def test_combined_long_term_missing_short_term_is_not_strict(self) -> None:
        values = {
            "LongTermDebtAndFinanceLeaseObligationsCurrent": fact(
                "LongTermDebtAndFinanceLeaseObligationsCurrent", 10.0
            ),
            "LongTermDebtAndFinanceLeaseObligationsNoncurrent": fact(
                "LongTermDebtAndFinanceLeaseObligationsNoncurrent", 30.0
            ),
        }
        strict, reported = debt_from_rendered_statement(values, lease=None)
        self.assertIsNone(strict)
        self.assertIsNone(reported)

    def test_current_debt_with_pure_noncurrent_needs_noncurrent_lease(
        self,
    ) -> None:
        values = {
            "DebtCurrent": fact("DebtCurrent", 9.0),
            "LongTermDebtNoncurrent": fact(
                "LongTermDebtNoncurrent", 30.0
            ),
        }
        lease_total = fact("FinanceLeaseLiability", 5.0)
        strict, _ = debt_from_rendered_statement(
            values, lease=lease_total, lease_noncurrent=None
        )
        self.assertIsNone(strict)
        lease_noncurrent = fact("FinanceLeaseLiabilityNoncurrent", 4.0)
        strict, reported = debt_from_rendered_statement(
            values,
            lease=lease_total,
            lease_noncurrent=lease_noncurrent,
        )
        self.assertEqual(strict["value"], 43.0)
        self.assertEqual(strict, reported)


class QuantileTests(unittest.TestCase):
    def test_linear_p90_interpolation(self) -> None:
        self.assertAlmostEqual(linear_quantile([0.0, 1.0, 2.0], 0.90), 1.8)


class InstanceFallbackRuleTests(unittest.TestCase):
    def test_nearest_instant_allows_non_calendar_fiscal_period(self) -> None:
        contexts = {
            "fiscal": {"instant": "2025-12-27", "dimensions": []},
            "prior": {"instant": "2025-09-27", "dimensions": []},
        }
        self.assertEqual(
            nearest_instant(contexts, "20251231"), "2025-12-27"
        )

    def test_custom_lease_candidate_rule_excludes_expense(self) -> None:
        self.assertTrue(
            looks_like_lease_liability(
                "CompanyFinanceLeaseLiabilityNoncurrent"
            )
        )
        self.assertFalse(
            looks_like_lease_liability("FinanceLeaseInterestExpense")
        )

    def test_dates_are_normalized_for_freshness_report(self) -> None:
        self.assertEqual(normalize_date("20260331"), "2026-03-31")
        self.assertEqual(normalize_date("2026-03-31"), "2026-03-31")


class TotalLiabilitiesEquityTests(unittest.TestCase):
    def test_presentation_certified_parent_equity_is_allowed(self) -> None:
        issuer = {
            "balance_sheet_lines": [
                statement_line(
                    10,
                    "StockholdersEquity",
                    40.0,
                    "Total stockholders' equity",
                ),
                statement_line(
                    11,
                    "LiabilitiesAndStockholdersEquity",
                    100.0,
                    "Total liabilities and stockholders' equity",
                ),
            ]
        }
        result = resolve_issuer(issuer)
        self.assertEqual(result["status"], "ratio_available")
        self.assertEqual(result["liabilities"]["value"], 60.0)
        self.assertEqual(result["ratio"], 1.5)

    def test_dimensioned_equity_component_is_not_used_as_total(self) -> None:
        issuer = {
            "balance_sheet_lines": [
                statement_line(
                    10,
                    "Liabilities",
                    60.0,
                    "Total liabilities",
                ),
                statement_line(
                    11,
                    "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
                    -2.0,
                    "Accumulated other comprehensive income",
                    "EquityComponents=AccumulatedOtherComprehensiveIncome;",
                ),
                statement_line(
                    12,
                    "StockholdersEquity",
                    40.0,
                    "Total stockholders' equity",
                ),
                statement_line(
                    13,
                    "LiabilitiesAndStockholdersEquity",
                    100.0,
                    "Total liabilities and stockholders' equity",
                ),
            ]
        }
        result = resolve_issuer(issuer)
        self.assertEqual(result["status"], "ratio_available")
        self.assertEqual(result["equity"]["value"], 40.0)

    def test_accounting_identity_mismatch_is_rejected(self) -> None:
        issuer = {
            "balance_sheet_lines": [
                statement_line(
                    10, "Liabilities", 70.0, "Total liabilities"
                ),
                statement_line(
                    11,
                    "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
                    40.0,
                    "Total equity",
                ),
                statement_line(
                    12,
                    "LiabilitiesAndStockholdersEquity",
                    100.0,
                    "Total liabilities and equity",
                ),
            ]
        }
        result = resolve_issuer(issuer)
        self.assertEqual(result["status"], "accounting_identity_mismatch")


class SpikeEvidenceTests(unittest.TestCase):
    def test_cat_inline_fallback_matches_eight_narrative_totals(self) -> None:
        result = json.loads(
            (ROOT / "inline_fallback_results.json").read_text(
                encoding="utf-8"
            )
        )
        self.assertEqual(result["coverage"]["available"], 8)
        self.assertEqual(result["coverage"]["narrative_matches"], 8)

    def test_energy_has_no_direct_eight_quarter_gross_profit(self) -> None:
        result = json.loads(
            (ROOT / "sp500_gross_profit_results.json").read_text(
                encoding="utf-8"
            )
        )
        energy = next(
            row for row in result["by_sector"] if row["sector"] == "Energy"
        )
        self.assertEqual(energy["direct_8_of_8"], 0)

    def test_instance_fallback_does_not_use_custom_candidates(self) -> None:
        result = json.loads(
            (ROOT / "fsds_instance_fallback_results.json").read_text(
                encoding="utf-8"
            )
        )
        self.assertEqual(
            result["instance_fallback"]["custom_candidates_used"], 0
        )
        self.assertIsNone(
            result["decision"]["max_debt_to_equity"]
        )

    def test_total_liabilities_metric_passes_coverage_not_threshold(
        self,
    ) -> None:
        result = json.loads(
            (ROOT / "total_liabilities_equity_fsds_results.json").read_text(
                encoding="utf-8"
            )
        )
        self.assertTrue(result["coverage"]["passes_all_guardrails"])
        self.assertFalse(result["decision"]["current_p90_is_threshold"])
        self.assertIsNone(
            result["decision"]["max_total_liabilities_to_equity"]
        )
        exclusions = [
            row
            for row in result["rows"]
            if row["status"] == "nonpositive_equity_auto_fail"
        ]
        self.assertEqual(len(exclusions), 22)
        symbols = {row["symbols"] for row in exclusions}
        self.assertTrue({"MCD", "SBUX"}.issubset(symbols))
        self.assertTrue(all(row["equity"] <= 0 for row in exclusions))

    def test_v05_uses_p50_calibration_and_keeps_threshold_unset(
        self,
    ) -> None:
        preregistration = (ROOT / "PREREGISTRATION.v0.5.md").read_text(
            encoding="utf-8"
        )
        self.assertIn(
            "LEVERAGE_THRESHOLD_QUANTILE = 0.50",
            preregistration,
        )
        self.assertIn(
            "MAX_TOTAL_LIABILITIES_TO_EQUITY = None",
            preregistration,
        )
        self.assertIn(
            "NONPOSITIVE_EQUITY_AUTO_FAIL",
            preregistration,
        )


if __name__ == "__main__":
    unittest.main()
