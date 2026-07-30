from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

import analyze_sec  # noqa: E402


class SecFeasibilityTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        manifest = json.loads(
            (ROOT / "manifest.json").read_text(encoding="utf-8")
        )
        cls.rows = {
            company["symbol"]: analyze_sec.analyze_company(company)
            for company in manifest["companies"]
        }

    def test_all_companies_have_eight_reference_quarters(self) -> None:
        self.assertEqual(set(self.rows), set(analyze_sec.DEBT_FORMULAS))
        for row in self.rows.values():
            self.assertEqual(row["expected_quarter_count"], 8)

    def test_core_standard_fields_have_eight_quarters(self) -> None:
        for row in self.rows.values():
            for field in (
                "revenue",
                "net_income",
                "operating_cash_flow",
                "equity",
            ):
                self.assertEqual(
                    row["fields"][field]["quarters_available"],
                    8,
                    f"{row['symbol']} {field}",
                )

    def test_provenance_is_complete_and_not_future_dated(self) -> None:
        for row in self.rows.values():
            provenance = row["provenance"]
            self.assertEqual(
                provenance["source_fact_count"],
                provenance["filed_present"],
            )
            self.assertEqual(
                provenance["source_fact_count"],
                provenance["accession_present"],
            )
            for field in row["fields"].values():
                for point in field["quarter_points"].values():
                    for source in point["sources"]:
                        self.assertLessEqual(
                            analyze_sec.parse_date(source["filed"]),
                            analyze_sec.AS_OF,
                        )

    def test_gross_profit_reconciles_when_both_tags_exist(self) -> None:
        cost_tags = {
            "AAPL": "CostOfGoodsAndServicesSold",
            "MSFT": "CostOfGoodsAndServicesSold",
            "HD": "CostOfRevenue",
            "JNJ": "CostOfGoodsAndServicesSold",
        }
        manifest = json.loads(
            (ROOT / "manifest.json").read_text(encoding="utf-8")
        )
        companies = {
            company["symbol"]: company for company in manifest["companies"]
        }
        for symbol, cost_tag in cost_tags.items():
            registrant = analyze_sec.choose_financial_registrant(
                companies[symbol]
            )
            facts = analyze_sec.load_gzip(
                Path(registrant["companyfacts_path"])
            )
            gaap = facts["facts"]["us-gaap"]
            revenue = analyze_sec.merge_tag_series(
                gaap, analyze_sec.DURATION_TAGS["revenue"]
            )
            cost = analyze_sec.duration_series(gaap, cost_tag)
            direct = analyze_sec.duration_series(gaap, "GrossProfit")
            ends = self.rows[symbol]["expected_quarter_ends"]
            for end in ends:
                self.assertAlmostEqual(
                    revenue[end]["value"] - cost[end]["value"],
                    direct[end]["value"],
                    delta=max(1.0, abs(direct[end]["value"]) * 1e-12),
                    msg=f"{symbol} {end}",
                )

    def test_xom_predecessor_lineage_is_used(self) -> None:
        row = self.rows["XOM"]
        self.assertEqual(row["current_cik"], "0002115436")
        self.assertEqual(row["financial_cik"], "0000034088")
        self.assertTrue(row["cik_lineage_used"])

    def test_missing_values_are_not_filled(self) -> None:
        self.assertEqual(
            self.rows["MSFT"]["fields"]["total_debt"][
                "quarters_available"
            ],
            5,
        )
        self.assertEqual(
            self.rows["CAT"]["fields"]["total_debt"][
                "quarters_available"
            ],
            2,
        )
        for symbol in ("CAT", "XOM", "LIN"):
            self.assertEqual(
                self.rows[symbol]["fields"]["gross_profit"][
                    "quarters_available"
                ],
                0,
            )


if __name__ == "__main__":
    unittest.main()
