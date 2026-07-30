from __future__ import annotations

import gzip
import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
FORMS = {"10-Q", "10-K", "10-Q/A", "10-K/A"}
EXACT_TAGS = {
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "Revenues",
    "SalesRevenueNet",
    "SalesRevenueGoodsNet",
    "SalesRevenueServicesNet",
    "OperatingRevenues",
    "RegulatedAndUnregulatedOperatingRevenue",
    "NetIncomeLoss",
    "ProfitLoss",
    "NetCashProvidedByUsedInOperatingActivities",
    "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
    "StockholdersEquity",
    "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
    "GrossProfit",
    "CostOfGoodsAndServiceExcludingDepreciationDepletionAndAmortization",
    "CostOfGoodsAndServicesSold",
    "CostOfRevenue",
    "CostOfGoodsSold",
    "CostOfProductsSold",
    "CostOfServices",
    "CostOfSales",
    "CostOfProductsAndServices",
    "CommercialPaper",
    "DebtCurrent",
    "OtherShortTermBorrowings",
    "ShortTermBorrowings",
    "DebtLongtermAndShorttermCombinedAmount",
    "LongTermDebt",
    "LongTermDebtCurrent",
    "LongTermDebtNoncurrent",
    "LongTermDebtAndFinanceLeaseObligations",
    "LongTermDebtAndCapitalLeaseObligations",
    "LongTermDebtAndCapitalLeaseObligationsCurrent",
    "LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities",
    "DebtAndFinanceLeaseObligations",
    "DebtAndCapitalLeaseObligations",
}


def load_gzip(path: Path) -> dict[str, Any]:
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        return json.load(handle)


def usd_rows(fact: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        row
        for row in (fact.get("units") or {}).get("USD", [])
        if row.get("form") in FORMS
    ]


def main() -> None:
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    for company in manifest["companies"]:
        registrant = next(
            (
                item
                for item in company["registrants"]
                if "us-gaap" in item["taxonomies"]
            ),
            company["registrants"][0],
        )
        payload = load_gzip(Path(registrant["companyfacts_path"]))
        gaap = payload.get("facts", {}).get("us-gaap", {})
        print(
            f"\n{company['symbol']} CIK{registrant['cik']} "
            f"({registrant['role']})"
        )
        for tag, fact in gaap.items():
            if tag not in EXACT_TAGS:
                continue
            rows = usd_rows(fact)
            if not rows:
                continue
            recent_rows = [row for row in rows if row.get("end", "") >= "2023-01-01"]
            if not recent_rows:
                continue
            starts = sum("start" in row for row in recent_rows)
            latest = max(row.get("end", "") for row in recent_rows)
            print(
                f"{tag}: recent={len(recent_rows)}, duration={starts}, "
                f"latest={latest}, label={fact.get('label')}"
            )


if __name__ == "__main__":
    main()
