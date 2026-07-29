from __future__ import annotations

import csv
import gzip
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from analyze_sec import (
    DURATION_TAGS,
    difference_series,
    duration_series,
    merge_tag_series,
)


ROOT = Path(__file__).resolve().parent
MANIFEST_PATH = ROOT / "sp500_companyfacts_manifest.json"
EXPECTED_QUARTERS = 8
COST_TAGS = [
    "CostOfRevenue",
    "CostOfGoodsAndServicesSold",
    "CostOfGoodsSold",
]


def load_gzip(path: Path) -> dict[str, Any]:
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        return json.load(handle)


def analyze() -> dict[str, Any]:
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    rows = []
    for issuer in manifest["issuers"]:
        payload = load_gzip(Path(issuer["path"]))
        gaap = (payload.get("facts") or {}).get("us-gaap") or {}
        revenue = merge_tag_series(gaap, DURATION_TAGS["revenue"])
        direct_gross = duration_series(gaap, "GrossProfit")
        cost = merge_tag_series(gaap, COST_TAGS)
        derived_gross = difference_series(revenue, cost)
        expected_ends = sorted(revenue, reverse=True)[:EXPECTED_QUARTERS]
        direct_count = sum(end in direct_gross for end in expected_ends)
        derived_count = sum(end in derived_gross for end in expected_ends)
        if len(expected_ends) < EXPECTED_QUARTERS:
            status = "insufficient_revenue_quarters"
        elif direct_count == EXPECTED_QUARTERS:
            status = "direct_gross_profit_8_of_8"
        elif derived_count == EXPECTED_QUARTERS:
            status = "derived_candidate_8_of_8_scope_unvalidated"
        else:
            status = "gross_profit_incomplete"
        rows.append(
            {
                "symbols": ",".join(issuer["symbols"]),
                "name": issuer["names"][0],
                "sector": issuer["sector"],
                "financial_cik": issuer["financial_cik"],
                "expected_quarter_count": len(expected_ends),
                "direct_gross_profit_count": direct_count,
                "derived_candidate_count": derived_count,
                "status": status,
                "expected_ends": expected_ends,
                "direct_tags": sorted(
                    {
                        tag
                        for end in expected_ends
                        if end in direct_gross
                        for tag in direct_gross[end]["tags"]
                    }
                ),
                "derived_tags": sorted(
                    {
                        tag
                        for end in expected_ends
                        if end in derived_gross
                        for tag in derived_gross[end]["tags"]
                    }
                ),
            }
        )

    by_sector: dict[str, Counter[str]] = defaultdict(Counter)
    for row in rows:
        counter = by_sector[row["sector"]]
        counter["issuers"] += 1
        counter[row["status"]] += 1
    sector_summary = []
    for sector in sorted(by_sector):
        counter = by_sector[sector]
        issuers = counter["issuers"]
        direct = counter["direct_gross_profit_8_of_8"]
        candidate = counter["derived_candidate_8_of_8_scope_unvalidated"]
        sector_summary.append(
            {
                "sector": sector,
                "issuers": issuers,
                "direct_8_of_8": direct,
                "direct_coverage": direct / issuers,
                "direct_or_unvalidated_derived_8_of_8": direct + candidate,
                "upper_bound_coverage_before_scope_validation": (
                    direct + candidate
                )
                / issuers,
            }
        )
    return {
        "generated_from": str(MANIFEST_PATH),
        "expected_quarters": EXPECTED_QUARTERS,
        "cost_tags_for_unvalidated_candidate_derivation": COST_TAGS,
        "warning": (
            "Revenue minus cost is only an upper-bound coverage candidate. "
            "It is not accepted unless the revenue and cost scopes are "
            "verified issuer by issuer."
        ),
        "status_counts": dict(Counter(row["status"] for row in rows)),
        "by_sector": sector_summary,
        "rows": rows,
    }


def write_outputs(result: dict[str, Any]) -> None:
    (ROOT / "sp500_gross_profit_results.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    with (ROOT / "sp500_gross_profit_coverage.csv").open(
        "w", encoding="utf-8-sig", newline=""
    ) as handle:
        rows = result["by_sector"]
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    result = analyze()
    write_outputs(result)
    print(
        json.dumps(
            {
                "status_counts": result["status_counts"],
                "by_sector": result["by_sector"],
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
