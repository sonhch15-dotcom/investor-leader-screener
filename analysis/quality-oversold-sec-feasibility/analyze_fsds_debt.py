from __future__ import annotations

import csv
import gzip
import json
import math
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path
from typing import Any

from analyze_sp500_debt import (
    FINANCE_LEASE_CURRENT_TAGS,
    FINANCE_LEASE_NONCURRENT_TAGS,
    FINANCE_LEASE_TOTAL_TAGS,
    instant_points,
)


ROOT = Path(__file__).resolve().parent
BALANCE_SHEETS_PATH = ROOT / "fsds_balance_sheets_2026q1.json"
MANIFEST_PATH = ROOT / "sp500_companyfacts_manifest.json"

EQUITY_TAGS = (
    "StockholdersEquity",
    "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
)
DIRECT_TOTAL_TAGS = (
    "DebtAndFinanceLeaseObligations",
    "DebtAndCapitalLeaseObligations",
)
CURRENT_DEBT_TAGS = (
    "DebtCurrent",
    "DebtCurrentNetOfIssuanceCost",
)
SHORT_TERM_DEBT_TAGS = ("ShortTermBorrowings",)
CURRENT_LONG_TERM_TAGS = (
    "LongTermDebtAndFinanceLeaseObligationsCurrent",
    "LongTermDebtAndCapitalLeaseObligationsCurrent",
    "LongTermDebtAndFinanceLeasesCurrent",
    "LongTermDebtAndFinanceLeaseCurrent",
)
CURRENT_LONG_TERM_PURE_TAGS = ("LongTermDebtCurrent",)
NONCURRENT_COMBINED_TAGS = (
    "LongTermDebtAndFinanceLeaseObligationsNoncurrent",
    "LongTermDebtAndCapitalLeaseObligations",
    "LongTermDebtAndFinanceLeasesNoncurrent",
    "LongTermDebtAndFinanceLeases",
    "LongTermDebtAndFinanceLease",
    "LongTermDebtAndLeaseObligationExcludingCurrentMaturities",
)
ALL_LONG_TERM_COMBINED_TAGS = (
    "LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities",
    "LongTermDebtAndFinanceLeaseObligations",
)
NONCURRENT_PURE_TAGS = (
    "LongTermDebtNoncurrent",
    "LongTermNotesPayable",
    "LongTermNotesAndLoans",
    "NotesPayableNoncurrent",
    "UnsecuredLongTermDebt",
    "OtherLongTermDebtNoncurrent",
    "ConvertibleLongTermNotesPayable",
    "LongTermLineOfCredit",
)
ALL_LONG_TERM_PURE_TAGS = ("LongTermDebt",)
PURE_TOTAL_TAGS = ("DebtLongtermAndShorttermCombinedAmount",)


def load_gzip(path: Path) -> dict[str, Any]:
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        return json.load(handle)


def normalize_segments(segments: str) -> tuple[str, ...]:
    normalized = []
    for part in segments.strip(";").split(";"):
        if not part:
            continue
        axis, member = part.split("=", 1)
        if member.endswith("Segment"):
            member = member[: -len("Segment")]
        normalized.append(f"{axis}={member}")
    return tuple(sorted(normalized))


def rendered_value(line: dict[str, Any]) -> tuple[float, str] | None:
    entity_wide = [
        value for value in line["values"] if not value["segments"]
    ]
    if entity_wide:
        return entity_wide[0]["value"], "entity_wide"

    by_axes: dict[tuple[str, ...], dict[tuple[str, ...], float]] = defaultdict(
        dict
    )
    for value in line["values"]:
        normalized = normalize_segments(value["segments"])
        axes = tuple(item.split("=", 1)[0] for item in normalized)
        by_axes[axes].setdefault(normalized, value["value"])
    if not by_axes:
        return None
    axes, members = max(
        by_axes.items(),
        key=lambda item: (len(item[1]), -len(item[0])),
    )
    del axes
    return sum(members.values()), "summed_rendered_dimensions"


def line_values(issuer: dict[str, Any]) -> dict[str, dict[str, Any]]:
    result = {}
    for line in issuer["balance_sheet_lines"]:
        collapsed = rendered_value(line)
        if collapsed is None:
            continue
        value, method = collapsed
        current = result.get(line["tag"])
        candidate = {
            "value": value,
            "method": method,
            "line": line["line"],
            "label": line["label"],
            "tag": line["tag"],
        }
        if current is None or line["line"] < current["line"]:
            result[line["tag"]] = candidate
    return result


def first(
    values: dict[str, dict[str, Any]], tags: tuple[str, ...]
) -> dict[str, Any] | None:
    return next((values[tag] for tag in tags if tag in values), None)


def combine(
    formula: str, components: list[dict[str, Any] | None]
) -> dict[str, Any] | None:
    if any(component is None for component in components):
        return None
    valid = [component for component in components if component is not None]
    return {
        "value": sum(component["value"] for component in valid),
        "formula": formula,
        "sources": valid,
    }


def nearest_point(
    series: dict[str, dict[str, dict[str, Any]]],
    tags: tuple[str, ...],
    period: str,
    tolerance_days: int = 7,
) -> dict[str, Any] | None:
    target = date(
        int(period[:4]), int(period[4:6]), int(period[6:])
    )
    candidates = []
    for tag in tags:
        for end, point in series.get(tag, {}).items():
            distance = abs((date.fromisoformat(end) - target).days)
            if distance <= tolerance_days:
                candidates.append((distance, tag, point))
    if not candidates:
        return None
    _, tag, point = min(candidates, key=lambda item: (item[0], item[1]))
    return {
        "value": point["value"],
        "method": "companyfacts_note_fact",
        "tag": tag,
        "sources": point["sources"],
    }


def finance_lease_total(
    gaap: dict[str, Any], period: str
) -> dict[str, Any] | None:
    tags = set(FINANCE_LEASE_TOTAL_TAGS)
    tags.update(FINANCE_LEASE_CURRENT_TAGS)
    tags.update(FINANCE_LEASE_NONCURRENT_TAGS)
    series = {
        tag: instant_points(gaap, tag) for tag in tags if tag in gaap
    }
    direct = nearest_point(series, FINANCE_LEASE_TOTAL_TAGS, period)
    if direct is not None:
        return direct
    current = nearest_point(series, FINANCE_LEASE_CURRENT_TAGS, period)
    noncurrent = nearest_point(
        series, FINANCE_LEASE_NONCURRENT_TAGS, period
    )
    return combine("finance_lease_current_plus_noncurrent", [current, noncurrent])


def finance_lease_noncurrent(
    gaap: dict[str, Any], period: str
) -> dict[str, Any] | None:
    tags = set(FINANCE_LEASE_TOTAL_TAGS)
    tags.update(FINANCE_LEASE_CURRENT_TAGS)
    tags.update(FINANCE_LEASE_NONCURRENT_TAGS)
    series = {
        tag: instant_points(gaap, tag) for tag in tags if tag in gaap
    }
    direct = nearest_point(
        series, FINANCE_LEASE_NONCURRENT_TAGS, period
    )
    if direct is not None:
        return direct
    total = nearest_point(series, FINANCE_LEASE_TOTAL_TAGS, period)
    current = nearest_point(series, FINANCE_LEASE_CURRENT_TAGS, period)
    if total is None or current is None:
        return None
    return {
        "value": total["value"] - current["value"],
        "formula": "finance_lease_total_minus_current",
        "sources": total["sources"] + current["sources"],
    }


def debt_from_rendered_statement(
    values: dict[str, dict[str, Any]],
    lease: dict[str, Any] | None,
    lease_noncurrent: dict[str, Any] | None = None,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    direct = first(values, DIRECT_TOTAL_TAGS)
    if direct is not None:
        result = {
            "value": direct["value"],
            "formula": direct["tag"],
            "sources": [direct],
        }
        return result, result

    current_debt = first(values, CURRENT_DEBT_TAGS)
    short_term_debt = first(values, SHORT_TERM_DEBT_TAGS)
    current_long_term = first(values, CURRENT_LONG_TERM_TAGS)
    current_long_term_pure = first(values, CURRENT_LONG_TERM_PURE_TAGS)
    noncurrent_combined = first(values, NONCURRENT_COMBINED_TAGS)
    all_long_term_combined = first(values, ALL_LONG_TERM_COMBINED_TAGS)
    noncurrent_pure = first(values, NONCURRENT_PURE_TAGS)
    all_long_term_pure = first(values, ALL_LONG_TERM_PURE_TAGS)
    pure_total = first(values, PURE_TOTAL_TAGS)

    combined_candidates = [
        combine(
            "current_debt+combined_noncurrent_debt_and_finance_lease",
            [current_debt, noncurrent_combined],
        ),
        combine(
            "short_term_debt+current_long_term"
            "+combined_noncurrent_debt_and_finance_lease",
            [short_term_debt, current_long_term, noncurrent_combined],
        ),
        combine(
            "short_term_debt+all_long_term_debt_and_finance_lease",
            [short_term_debt, all_long_term_combined],
        ),
        combine(
            "pure_total_debt+reported_finance_lease",
            [pure_total, lease],
        ),
        combine(
            "current_debt+noncurrent_debt"
            "+reported_noncurrent_finance_lease",
            [current_debt, noncurrent_pure, lease_noncurrent],
        ),
        combine(
            "short_term_debt+current_long_term+noncurrent_debt"
            "+reported_finance_lease",
            [
                short_term_debt,
                current_long_term_pure,
                noncurrent_pure,
                lease,
            ],
        ),
        combine(
            "short_term_debt+all_long_term_debt"
            "+reported_finance_lease",
            [short_term_debt, all_long_term_pure, lease],
        ),
    ]
    strict = next(
        (candidate for candidate in combined_candidates if candidate), None
    )
    if strict is not None:
        return strict, strict

    reported_candidates = [
        (
            {
                "value": pure_total["value"],
                "formula": pure_total["tag"],
                "sources": [pure_total],
            }
            if pure_total
            else None
        ),
        combine(
            "short_term_debt+current_long_term+noncurrent_debt",
            [short_term_debt, current_long_term_pure, noncurrent_pure],
        ),
        combine(
            "current_debt+noncurrent_debt",
            [current_debt, noncurrent_pure],
        ),
        combine(
            "current_long_term+noncurrent_debt",
            [current_long_term_pure, noncurrent_pure],
        ),
        combine(
            "short_term_debt+all_long_term_debt",
            [short_term_debt, all_long_term_pure],
        ),
        (
            {
                "value": all_long_term_pure["value"],
                "formula": all_long_term_pure["tag"],
                "sources": [all_long_term_pure],
            }
            if all_long_term_pure
            else None
        ),
        (
            {
                "value": noncurrent_pure["value"],
                "formula": noncurrent_pure["tag"],
                "sources": [noncurrent_pure],
            }
            if noncurrent_pure
            else None
        ),
    ]
    reported = next(
        (candidate for candidate in reported_candidates if candidate), None
    )
    if reported is None:
        if lease is not None:
            lease_only = {
                "value": lease["value"],
                "formula": "reported_finance_lease_only",
                "sources": [lease],
            }
            return None, lease_only
        return None, None
    if lease is None:
        return None, reported
    with_lease = {
        "value": reported["value"] + lease["value"],
        "formula": f"{reported['formula']}+reported_finance_lease",
        "sources": reported["sources"] + [lease],
    }
    return None, with_lease


def quantile(values: list[float], probability: float) -> float:
    ordered = sorted(values)
    position = (len(ordered) - 1) * probability
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    weight = position - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def describe(values: list[float]) -> dict[str, float | int]:
    return {
        "count": len(values),
        "min": min(values),
        "p25": quantile(values, 0.25),
        "median": quantile(values, 0.50),
        "p75": quantile(values, 0.75),
        "p90": quantile(values, 0.90),
        "p95": quantile(values, 0.95),
        "max": max(values),
    }


def analyze() -> dict[str, Any]:
    balance_sheets = json.loads(
        BALANCE_SHEETS_PATH.read_text(encoding="utf-8")
    )
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    companyfacts_by_cik = {
        issuer["financial_cik"]: Path(issuer["path"])
        for issuer in manifest["issuers"]
    }
    rows = []
    for issuer in balance_sheets["issuers"]:
        values = line_values(issuer)
        equity = first(values, EQUITY_TAGS)
        payload = load_gzip(companyfacts_by_cik[issuer["cik"]])
        gaap = (payload.get("facts") or {}).get("us-gaap") or {}
        lease = finance_lease_total(gaap, issuer["period"])
        lease_noncurrent = finance_lease_noncurrent(
            gaap, issuer["period"]
        )
        strict_debt, reported_debt = debt_from_rendered_statement(
            values, lease, lease_noncurrent
        )
        if equity is None:
            status = "missing_equity"
        elif equity["value"] <= 0:
            status = "nonpositive_equity"
        elif strict_debt is not None:
            status = "strict_complete"
        elif reported_debt is not None:
            status = "reported_debt_only_finance_lease_unverified"
        else:
            status = "missing_debt"
        rows.append(
            {
                "symbols": ",".join(issuer["symbols"]),
                "name": issuer["name"],
                "sector": issuer["sector"],
                "cik": issuer["cik"],
                "accession": issuer["accession"],
                "form": issuer["form"],
                "filed": issuer["filed"],
                "period": issuer["period"],
                "status": status,
                "equity": equity["value"] if equity else None,
                "equity_source": equity,
                "strict_debt": (
                    strict_debt["value"] if strict_debt else None
                ),
                "reported_debt": (
                    reported_debt["value"] if reported_debt else None
                ),
                "strict_debt_to_equity": (
                    strict_debt["value"] / equity["value"]
                    if strict_debt and equity and equity["value"] > 0
                    else None
                ),
                "reported_debt_to_equity": (
                    reported_debt["value"] / equity["value"]
                    if reported_debt and equity and equity["value"] > 0
                    else None
                ),
                "strict_formula": (
                    strict_debt["formula"] if strict_debt else None
                ),
                "strict_sources": (
                    strict_debt["sources"] if strict_debt else []
                ),
                "reported_formula": (
                    reported_debt["formula"] if reported_debt else None
                ),
                "finance_lease_fact_present": lease is not None,
            }
        )

    strict_values = [
        row["strict_debt_to_equity"]
        for row in rows
        if row["strict_debt_to_equity"] is not None
    ]
    reported_values = [
        row["reported_debt_to_equity"]
        for row in rows
        if row["reported_debt_to_equity"] is not None
    ]
    sector: dict[str, Counter[str]] = defaultdict(Counter)
    for row in rows:
        sector[row["sector"]]["matched"] += 1
        sector[row["sector"]][row["status"]] += 1
        if row["strict_debt_to_equity"] is not None:
            sector[row["sector"]]["strict_ratio_available"] += 1
        if row["reported_debt_to_equity"] is not None:
            sector[row["sector"]]["reported_ratio_available"] += 1
    by_sector = []
    for name in sorted(sector):
        counts = sector[name]
        by_sector.append(
            {
                "sector": name,
                "matched_submissions": counts["matched"],
                "strict_complete": counts["strict_ratio_available"],
                "strict_coverage": counts["strict_ratio_available"]
                / counts["matched"],
                "reported_complete": counts["reported_ratio_available"],
                "reported_coverage": counts["reported_ratio_available"]
                / counts["matched"],
            }
        )
    population = balance_sheets["population_issuers"]
    result = {
        "source": str(BALANCE_SHEETS_PATH),
        "dataset_filing_window": "2026 Q1",
        "population_issuers": population,
        "matched_submissions": balance_sheets[
            "matched_latest_submissions"
        ],
        "status_counts": dict(Counter(row["status"] for row in rows)),
        "strict": {
            "complete_issuers": len(strict_values),
            "coverage_of_population": len(strict_values) / population,
            "distribution": describe(strict_values),
            "threshold_valid": False,
            "reason": (
                "Strict coverage remains below the preregistered 90% "
                "population and 80% per-sector guardrails."
            ),
        },
        "reported_materiality_convention": {
            "complete_issuers": len(reported_values),
            "coverage_of_population": len(reported_values) / population,
            "distribution": describe(reported_values),
            "p90_rounded_two_decimals": round(
                quantile(reported_values, 0.90), 2
            ),
            "warning": (
                "This convention uses the complete rendered balance sheet "
                "and treats an absent separately reported finance-lease "
                "liability as immaterial. It is not the frozen strict rule."
            ),
        },
        "by_sector": by_sector,
        "rows": rows,
    }
    return result


def write_outputs(result: dict[str, Any]) -> None:
    (ROOT / "fsds_debt_results_2026q1.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    with (ROOT / "fsds_debt_cross_section_2026q1.csv").open(
        "w", encoding="utf-8-sig", newline=""
    ) as handle:
        fields = [
            "symbols",
            "name",
            "sector",
            "cik",
            "accession",
            "form",
            "filed",
            "period",
            "status",
            "equity",
            "strict_debt",
            "reported_debt",
            "strict_debt_to_equity",
            "reported_debt_to_equity",
            "strict_formula",
            "reported_formula",
            "finance_lease_fact_present",
        ]
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(
            {field: row.get(field) for field in fields}
            for row in result["rows"]
        )


def main() -> None:
    result = analyze()
    write_outputs(result)
    print(
        json.dumps(
            {
                "status_counts": result["status_counts"],
                "strict": result["strict"],
                "reported_materiality_convention": result[
                    "reported_materiality_convention"
                ],
                "by_sector": result["by_sector"],
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
