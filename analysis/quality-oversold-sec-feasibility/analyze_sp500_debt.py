from __future__ import annotations

import csv
import gzip
import json
import math
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
MANIFEST_PATH = ROOT / "sp500_companyfacts_manifest.json"
AS_OF = date(2026, 7, 29)
MAX_END_AGE_DAYS = 200
FORMS = {"10-Q", "10-K", "10-Q/A", "10-K/A"}

EQUITY_TAGS = (
    "StockholdersEquity",
    "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
)

FINANCE_LEASE_TOTAL_TAGS = (
    "FinanceLeaseLiability",
    "CapitalLeaseObligations",
)
FINANCE_LEASE_CURRENT_TAGS = (
    "FinanceLeaseLiabilityCurrent",
    "CapitalLeaseObligationsCurrent",
)
FINANCE_LEASE_NONCURRENT_TAGS = (
    "FinanceLeaseLiabilityNoncurrent",
    "CapitalLeaseObligationsNoncurrent",
)


def read_gzip_json(path: Path) -> dict[str, Any]:
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        return json.load(handle)


def source_record(tag: str, row: dict[str, Any]) -> dict[str, Any]:
    return {
        "tag": tag,
        "end": row["end"],
        "value": row["val"],
        "filed": row["filed"],
        "form": row["form"],
        "accession": row["accn"],
        "frame": row.get("frame"),
    }


def instant_points(
    gaap: dict[str, Any], tag: str
) -> dict[str, dict[str, Any]]:
    fact = gaap.get(tag)
    if not fact:
        return {}
    rows = []
    for row in (fact.get("units") or {}).get("USD", []):
        if (
            row.get("start")
            or not row.get("end")
            or not row.get("filed")
            or not row.get("accn")
            or row.get("form") not in FORMS
            or date.fromisoformat(row["filed"]) > AS_OF
        ):
            continue
        rows.append(row)

    latest: dict[str, dict[str, Any]] = {}
    for row in rows:
        key = row["end"]
        current = latest.get(key)
        row_order = (row["filed"], row["accn"])
        current_order = (
            (current["filed"], current["accn"]) if current else ("", "")
        )
        if current is None or row_order > current_order:
            latest[key] = row
    return {
        end: {
            "value": row["val"],
            "sources": [source_record(tag, row)],
        }
        for end, row in latest.items()
    }


def point(
    series_by_tag: dict[str, dict[str, dict[str, Any]]],
    tag: str,
    end: str,
) -> dict[str, Any] | None:
    return series_by_tag.get(tag, {}).get(end)


def first_point(
    series_by_tag: dict[str, dict[str, dict[str, Any]]],
    tags: tuple[str, ...],
    end: str,
) -> dict[str, Any] | None:
    for tag in tags:
        value = point(series_by_tag, tag, end)
        if value is not None:
            return value
    return None


def combine(
    formula: str, components: list[dict[str, Any] | None]
) -> dict[str, Any] | None:
    if any(component is None for component in components):
        return None
    valid = [component for component in components if component is not None]
    return {
        "value": sum(component["value"] for component in valid),
        "formula": formula,
        "sources": [
            source
            for component in valid
            for source in component["sources"]
        ],
    }


def lease_total(
    series: dict[str, dict[str, dict[str, Any]]], end: str
) -> dict[str, Any] | None:
    direct = first_point(series, FINANCE_LEASE_TOTAL_TAGS, end)
    if direct is not None:
        return direct
    return combine(
        "finance_lease_current_plus_noncurrent",
        [
            first_point(series, FINANCE_LEASE_CURRENT_TAGS, end),
            first_point(series, FINANCE_LEASE_NONCURRENT_TAGS, end),
        ],
    )


def lease_noncurrent(
    series: dict[str, dict[str, dict[str, Any]]], end: str
) -> dict[str, Any] | None:
    direct = first_point(series, FINANCE_LEASE_NONCURRENT_TAGS, end)
    if direct is not None:
        return direct
    total = first_point(series, FINANCE_LEASE_TOTAL_TAGS, end)
    current = first_point(series, FINANCE_LEASE_CURRENT_TAGS, end)
    if total is None or current is None:
        return None
    return {
        "value": total["value"] - current["value"],
        "formula": "finance_lease_total_minus_current",
        "sources": total["sources"] + current["sources"],
    }


def debt_candidates(
    series: dict[str, dict[str, dict[str, Any]]], end: str
) -> list[dict[str, Any] | None]:
    direct_finance = point(series, "DebtAndFinanceLeaseObligations", end)
    direct_capital = point(series, "DebtAndCapitalLeaseObligations", end)
    debt_current = point(series, "DebtCurrent", end)
    short_term = point(series, "ShortTermBorrowings", end)
    long_term_current = point(series, "LongTermDebtCurrent", end)
    long_term_noncurrent = point(series, "LongTermDebtNoncurrent", end)
    combined_pure_debt = point(
        series, "DebtLongtermAndShorttermCombinedAmount", end
    )
    finance_noncurrent = point(
        series, "LongTermDebtAndFinanceLeaseObligationsNoncurrent", end
    )
    finance_current = point(
        series, "LongTermDebtAndFinanceLeaseObligationsCurrent", end
    )
    capital_noncurrent = point(
        series, "LongTermDebtAndCapitalLeaseObligations", end
    )
    capital_current = point(
        series, "LongTermDebtAndCapitalLeaseObligationsCurrent", end
    )

    return [
        (
            {
                **direct_finance,
                "formula": "DebtAndFinanceLeaseObligations",
            }
            if direct_finance is not None
            else None
        ),
        (
            {
                **direct_capital,
                "formula": "DebtAndCapitalLeaseObligations",
            }
            if direct_capital is not None
            else None
        ),
        combine(
            "DebtCurrent"
            "+LongTermDebtAndFinanceLeaseObligationsNoncurrent",
            [debt_current, finance_noncurrent],
        ),
        combine(
            "DebtCurrent+LongTermDebtAndCapitalLeaseObligations",
            [debt_current, capital_noncurrent],
        ),
        combine(
            "ShortTermBorrowings"
            "+LongTermDebtAndFinanceLeaseObligationsCurrent"
            "+LongTermDebtAndFinanceLeaseObligationsNoncurrent",
            [short_term, finance_current, finance_noncurrent],
        ),
        combine(
            "ShortTermBorrowings"
            "+LongTermDebtAndCapitalLeaseObligationsCurrent"
            "+LongTermDebtAndCapitalLeaseObligations",
            [short_term, capital_current, capital_noncurrent],
        ),
        combine(
            "DebtLongtermAndShorttermCombinedAmount+FinanceLeaseLiability",
            [combined_pure_debt, lease_total(series, end)],
        ),
        combine(
            "DebtCurrent+LongTermDebtNoncurrent"
            "+FinanceLeaseLiabilityNoncurrent",
            [debt_current, long_term_noncurrent, lease_noncurrent(series, end)],
        ),
        combine(
            "ShortTermBorrowings+LongTermDebtCurrent"
            "+LongTermDebtNoncurrent+FinanceLeaseLiability",
            [
                short_term,
                long_term_current,
                long_term_noncurrent,
                lease_total(series, end),
            ],
        ),
    ]


def latest_complete_observation(
    gaap: dict[str, Any]
) -> tuple[dict[str, Any] | None, str]:
    relevant_tags = set(EQUITY_TAGS)
    relevant_tags.update(FINANCE_LEASE_TOTAL_TAGS)
    relevant_tags.update(FINANCE_LEASE_CURRENT_TAGS)
    relevant_tags.update(FINANCE_LEASE_NONCURRENT_TAGS)
    relevant_tags.update(
        {
            "DebtAndFinanceLeaseObligations",
            "DebtAndCapitalLeaseObligations",
            "DebtCurrent",
            "ShortTermBorrowings",
            "LongTermDebtCurrent",
            "LongTermDebtNoncurrent",
            "DebtLongtermAndShorttermCombinedAmount",
            "LongTermDebtAndFinanceLeaseObligationsNoncurrent",
            "LongTermDebtAndFinanceLeaseObligationsCurrent",
            "LongTermDebtAndCapitalLeaseObligations",
            "LongTermDebtAndCapitalLeaseObligationsCurrent",
        }
    )
    series = {
        tag: instant_points(gaap, tag)
        for tag in relevant_tags
        if tag in gaap
    }
    equity_by_end: dict[str, dict[str, Any]] = {}
    for tag in EQUITY_TAGS:
        for end, equity in series.get(tag, {}).items():
            equity_by_end.setdefault(end, equity)

    recent_ends = sorted(
        (
            end
            for end in equity_by_end
            if 0 <= (AS_OF - date.fromisoformat(end)).days <= MAX_END_AGE_DAYS
        ),
        reverse=True,
    )
    if not recent_ends:
        return None, "missing_or_stale_equity"

    saw_nonpositive_equity = False
    for end in recent_ends:
        equity = equity_by_end[end]
        if equity["value"] <= 0:
            saw_nonpositive_equity = True
            continue
        debt = next(
            (
                candidate
                for candidate in debt_candidates(series, end)
                if candidate is not None
            ),
            None,
        )
        if debt is None:
            continue
        return (
            {
                "end": end,
                "age_days": (AS_OF - date.fromisoformat(end)).days,
                "debt": debt["value"],
                "equity": equity["value"],
                "debt_to_equity": debt["value"] / equity["value"],
                "debt_formula": debt["formula"],
                "debt_sources": debt["sources"],
                "equity_sources": equity["sources"],
            },
            "complete",
        )
    if saw_nonpositive_equity:
        return None, "nonpositive_equity"
    return None, "incomplete_debt_definition"


def debt_tag_diagnostic(gaap: dict[str, Any]) -> dict[str, Any]:
    equity_ends = set()
    for tag in EQUITY_TAGS:
        equity_ends.update(instant_points(gaap, tag))
    recent_ends = sorted(
        (
            end
            for end in equity_ends
            if 0 <= (AS_OF - date.fromisoformat(end)).days <= MAX_END_AGE_DAYS
        ),
        reverse=True,
    )
    if not recent_ends:
        return {"latest_recent_equity_end": None, "available_debt_like_tags": []}
    end = recent_ends[0]
    keywords = (
        "Debt",
        "Borrow",
        "FinanceLease",
        "CapitalLease",
        "CommercialPaper",
    )
    available = []
    for tag, fact in gaap.items():
        if not any(keyword in tag for keyword in keywords):
            continue
        value = instant_points(gaap, tag).get(end)
        if value is None:
            continue
        available.append(
            {
                "tag": tag,
                "value": value["value"],
                "label": fact.get("label"),
            }
        )
    return {
        "latest_recent_equity_end": end,
        "available_debt_like_tags": sorted(
            available, key=lambda row: row["tag"]
        ),
    }


def linear_quantile(values: list[float], probability: float) -> float:
    ordered = sorted(values)
    if not ordered:
        raise ValueError("cannot calculate a quantile of an empty sample")
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
        "p10": linear_quantile(values, 0.10),
        "p25": linear_quantile(values, 0.25),
        "median": linear_quantile(values, 0.50),
        "p75": linear_quantile(values, 0.75),
        "p90": linear_quantile(values, 0.90),
        "p95": linear_quantile(values, 0.95),
        "max": max(values),
    }


def analyze() -> dict[str, Any]:
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    rows = []
    for issuer in manifest["issuers"]:
        payload = read_gzip_json(Path(issuer["path"]))
        gaap = (payload.get("facts") or {}).get("us-gaap") or {}
        observation, status = latest_complete_observation(gaap)
        diagnostic = debt_tag_diagnostic(gaap)
        row = {
            "symbols": ",".join(issuer["symbols"]),
            "name": issuer["names"][0],
            "sector": issuer["sector"],
            "financial_cik": issuer["financial_cik"],
            "current_cik": issuer["current_cik"],
            "lineage_override": issuer["lineage_override"],
            "status": status,
            "end": None,
            "age_days": None,
            "debt": None,
            "equity": None,
            "debt_to_equity": None,
            "debt_formula": None,
            "debt_sources": [],
            "equity_sources": [],
            **diagnostic,
        }
        if observation is not None:
            row.update(observation)
        rows.append(row)

    sector_counts: dict[str, Counter[str]] = defaultdict(Counter)
    for row in rows:
        sector_counts[row["sector"]]["eligible"] += 1
        sector_counts[row["sector"]][row["status"]] += 1
    sector_summary = []
    for sector in sorted(sector_counts):
        counts = sector_counts[sector]
        eligible = counts["eligible"]
        complete = counts["complete"]
        sector_summary.append(
            {
                "sector": sector,
                "eligible_issuers": eligible,
                "complete_issuers": complete,
                "coverage": complete / eligible,
                "missing_or_stale_equity": counts["missing_or_stale_equity"],
                "nonpositive_equity": counts["nonpositive_equity"],
                "incomplete_debt_definition": counts[
                    "incomplete_debt_definition"
                ],
            }
        )

    complete_rows = [row for row in rows if row["status"] == "complete"]
    values = [row["debt_to_equity"] for row in complete_rows]
    overall_coverage = len(complete_rows) / len(rows)
    overall_guardrail = overall_coverage >= 0.90
    sector_guardrail = all(
        row["coverage"] >= 0.80 for row in sector_summary
    )
    provenance_guardrail = all(
        source.get("filed") and source.get("accession")
        for row in complete_rows
        for source in row["debt_sources"] + row["equity_sources"]
    )
    valid_for_threshold = (
        overall_guardrail and sector_guardrail and provenance_guardrail
    )
    distribution = describe(values)
    threshold = round(distribution["p90"], 2) if valid_for_threshold else None

    formula_counts = Counter(
        row["debt_formula"] for row in complete_rows
    )
    incomplete_tag_counts = Counter(
        fact["tag"]
        for row in rows
        if row["status"] == "incomplete_debt_definition"
        for fact in row["available_debt_like_tags"]
    )
    result = {
        "generated_from": str(MANIFEST_PATH),
        "as_of": AS_OF.isoformat(),
        "maximum_statement_end_age_days": MAX_END_AGE_DAYS,
        "population": {
            **manifest["universe"],
            "analyzed_included_issuers": len(rows),
        },
        "debt_definition": (
            "short-term interest-bearing borrowings + current long-term debt "
            "+ noncurrent interest-bearing debt + finance lease liabilities; "
            "operating leases and operating liabilities excluded"
        ),
        "coverage": {
            "overall": overall_coverage,
            "complete_issuers": len(complete_rows),
            "eligible_issuers": len(rows),
            "status_counts": dict(Counter(row["status"] for row in rows)),
            "by_sector": sector_summary,
        },
        "guardrails": {
            "overall_at_least_90_percent": overall_guardrail,
            "every_sector_at_least_80_percent": sector_guardrail,
            "filed_and_accession_for_every_used_fact": provenance_guardrail,
            "valid_for_threshold": valid_for_threshold,
        },
        "distribution": distribution,
        "formula_counts": dict(formula_counts),
        "incomplete_tag_counts": dict(incomplete_tag_counts.most_common()),
        "proposed_max_debt_to_equity": threshold,
        "rows": rows,
    }
    return result


def write_outputs(result: dict[str, Any]) -> None:
    (ROOT / "sp500_debt_results.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    fieldnames = [
        "symbols",
        "name",
        "sector",
        "financial_cik",
        "current_cik",
        "lineage_override",
        "status",
        "end",
        "age_days",
        "debt",
        "equity",
        "debt_to_equity",
        "debt_formula",
    ]
    with (ROOT / "sp500_debt_cross_section.csv").open(
        "w", encoding="utf-8-sig", newline=""
    ) as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in result["rows"]:
            writer.writerow({field: row.get(field) for field in fieldnames})
    with (ROOT / "sp500_debt_sector_coverage.csv").open(
        "w", encoding="utf-8-sig", newline=""
    ) as handle:
        rows = result["coverage"]["by_sector"]
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    result = analyze()
    write_outputs(result)
    print(
        json.dumps(
            {
                "coverage": result["coverage"],
                "guardrails": result["guardrails"],
                "distribution": result["distribution"],
                "formula_counts": result["formula_counts"],
                "proposed_max_debt_to_equity": result[
                    "proposed_max_debt_to_equity"
                ],
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
