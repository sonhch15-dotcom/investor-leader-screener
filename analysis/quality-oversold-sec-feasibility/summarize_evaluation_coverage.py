from __future__ import annotations

import argparse
import csv
import json
from collections import defaultdict
from pathlib import Path
from typing import Any


MIN_OVERALL_COVERAGE = 0.90
MIN_SECTOR_COVERAGE = 0.80
REQUIRED_PROVENANCE_RATE = 1.00
EVALUATION_START_MONTH = "2015-10"


def summarize(
    detail: dict[str, Any],
    start_month: str = EVALUATION_START_MONTH,
) -> dict[str, Any]:
    months = [
        row for row in detail["months"] if row["month"] >= start_month
    ]
    if not months:
        raise ValueError("No evaluation months")

    by_year: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for row in months:
        by_year[int(row["month"][:4])].append(row)

    first_year = int(months[0]["month"][:4])
    last_year = int(months[-1]["month"][:4])
    annual = []
    for year, rows in sorted(by_year.items()):
        rows.sort(key=lambda row: row["month"])
        minimum_overall = min(row["overall_coverage"] for row in rows)
        minimum_sector = min(
            row["minimum_sector_coverage"] for row in rows
        )
        minimum_provenance = min(row["provenance_rate"] for row in rows)
        passing_months = sum(row["coverage_eligible"] for row in rows)
        expected_months = 12
        partial = (
            year == first_year
            and rows[0]["month"][5:] != "01"
        ) or (
            year == last_year
            and rows[-1]["month"][5:] != "12"
        )
        passes = (
            passing_months == len(rows)
            and minimum_overall >= MIN_OVERALL_COVERAGE
            and minimum_sector >= MIN_SECTOR_COVERAGE
            and minimum_provenance == REQUIRED_PROVENANCE_RATE
        )
        annual.append(
            {
                "year": year,
                "period_start": rows[0]["month"],
                "period_end": rows[-1]["month"],
                "months_evaluated": len(rows),
                "expected_full_year_months": expected_months,
                "year_scope": "PARTIAL_YEAR" if partial else "FULL_YEAR",
                "minimum_overall_coverage": minimum_overall,
                "minimum_sector_coverage": minimum_sector,
                "minimum_provenance_rate": minimum_provenance,
                "passing_months": passing_months,
                "year_passes": passes,
            }
        )

    all_pass = all(row["year_passes"] for row in annual)
    return {
        "preregistration": "PREREGISTRATION.v0.8.md",
        "data_scope": "evaluation_financial_coverage_no_prices_no_returns",
        "evaluation_start_month": months[0]["month"],
        "evaluation_end_month": months[-1]["month"],
        "months_evaluated": len(months),
        "minimum_overall_coverage": MIN_OVERALL_COVERAGE,
        "minimum_sector_coverage": MIN_SECTOR_COVERAGE,
        "required_provenance_rate": REQUIRED_PROVENANCE_RATE,
        "status": (
            "VALID_EVALUATION_FINANCIAL_COVERAGE"
            if all_pass
            else "INVALID_EVALUATION_FINANCIAL_COVERAGE"
        ),
        "prices_accessed": False,
        "returns_calculated": False,
        "annual": annual,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--detail-json", type=Path, required=True)
    parser.add_argument("--output-json", type=Path, required=True)
    parser.add_argument("--output-csv", type=Path, required=True)
    args = parser.parse_args()

    detail = json.loads(args.detail_json.read_text(encoding="utf-8"))
    result = summarize(detail)
    args.output_json.write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    with args.output_csv.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle, fieldnames=list(result["annual"][0])
        )
        writer.writeheader()
        writer.writerows(result["annual"])


if __name__ == "__main__":
    main()
