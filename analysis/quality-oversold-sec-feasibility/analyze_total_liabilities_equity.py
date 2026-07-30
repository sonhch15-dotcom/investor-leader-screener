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
MAX_PERIOD_AGE_DAYS = 250
FORMS = {"10-K", "10-K/A", "10-Q", "10-Q/A"}

LIABILITIES_TAG = "Liabilities"
TOTAL_TAG = "LiabilitiesAndStockholdersEquity"
TOTAL_EQUITY_TAG = (
    "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"
)
PARENT_EQUITY_TAG = "StockholdersEquity"
NCI_TAG = "MinorityInterest"
RELEVANT_TAGS = {
    LIABILITIES_TAG,
    TOTAL_TAG,
    TOTAL_EQUITY_TAG,
    PARENT_EQUITY_TAG,
    NCI_TAG,
}

MAX_IDENTITY_GAP = 0.005
MIN_OVERALL_COVERAGE = 0.90
MIN_SECTOR_COVERAGE = 0.80


def load_gzip_json(path: Path) -> dict[str, Any]:
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        return json.load(handle)


def source_record(tag: str, row: dict[str, Any]) -> dict[str, Any]:
    return {
        "tag": tag,
        "value": float(row["val"]),
        "end": row["end"],
        "filed": row["filed"],
        "form": row["form"],
        "accession": row["accn"],
        "frame": row.get("frame"),
        "source": "SEC Companyfacts",
    }


def filing_groups(
    gaap: dict[str, Any],
) -> dict[tuple[str, str, str, str], dict[str, list[dict[str, Any]]]]:
    groups: dict[
        tuple[str, str, str, str], dict[str, list[dict[str, Any]]]
    ] = defaultdict(lambda: defaultdict(list))
    for tag in RELEVANT_TAGS:
        fact = gaap.get(tag)
        if not fact:
            continue
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
            key = (row["filed"], row["accn"], row["form"], row["end"])
            groups[key][tag].append(source_record(tag, row))
    return groups


def latest_group(
    groups: dict[
        tuple[str, str, str, str], dict[str, list[dict[str, Any]]]
    ],
) -> tuple[
    tuple[str, str, str, str] | None,
    dict[str, list[dict[str, Any]]] | None,
]:
    if not groups:
        return None, None
    latest_accession = max(
        {(filed, accession, form) for filed, accession, form, _ in groups},
        key=lambda item: (item[0], item[1]),
    )
    candidates = [
        (key, facts)
        for key, facts in groups.items()
        if key[:3] == latest_accession
    ]
    return max(candidates, key=lambda item: item[0][3])


def unique_fact(
    facts: dict[str, list[dict[str, Any]]], tag: str
) -> tuple[dict[str, Any] | None, bool]:
    rows = facts.get(tag, [])
    if not rows:
        return None, False
    distinct = {row["value"] for row in rows}
    if len(distinct) != 1:
        return None, True
    return rows[0], False


def relative_gap(left: float, right: float, scale: float) -> float:
    return abs(left - right) / max(abs(scale), 1.0)


def derived_fact(
    tag: str,
    value: float,
    formula: str,
    sources: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "tag": tag,
        "value": value,
        "formula": formula,
        "sources": sources,
        "source": "derived from SEC Companyfacts",
    }


def resolve_group(
    facts: dict[str, list[dict[str, Any]]],
) -> dict[str, Any]:
    selected = {}
    conflicts = []
    for tag in RELEVANT_TAGS:
        fact, conflict = unique_fact(facts, tag)
        if conflict:
            conflicts.append(tag)
        elif fact is not None:
            selected[tag] = fact
    if conflicts:
        return {
            "status": "conflicting_duplicate_facts",
            "conflicting_tags": sorted(conflicts),
        }

    liabilities = selected.get(LIABILITIES_TAG)
    total = selected.get(TOTAL_TAG)
    direct_total_equity = selected.get(TOTAL_EQUITY_TAG)
    parent_equity = selected.get(PARENT_EQUITY_TAG)
    nci = selected.get(NCI_TAG)
    composed_equity = None
    if parent_equity is not None and nci is not None:
        composed_equity = derived_fact(
            "TotalEquity",
            parent_equity["value"] + nci["value"],
            "StockholdersEquity+MinorityInterest",
            [parent_equity, nci],
        )
    if direct_total_equity is not None and composed_equity is not None:
        gap = relative_gap(
            direct_total_equity["value"],
            composed_equity["value"],
            direct_total_equity["value"],
        )
        if gap > MAX_IDENTITY_GAP:
            return {
                "status": "inconsistent_equity_definitions",
                "equity_definition_gap": gap,
            }

    equity = direct_total_equity or composed_equity
    available = sum(item is not None for item in (liabilities, equity, total))
    if available < 2:
        return {"status": "insufficient_total_facts"}

    if liabilities is not None and equity is not None and total is not None:
        gap = relative_gap(
            total["value"],
            liabilities["value"] + equity["value"],
            total["value"],
        )
        if gap > MAX_IDENTITY_GAP:
            return {
                "status": "accounting_identity_mismatch",
                "accounting_identity_gap": gap,
            }

    if equity is None:
        equity = derived_fact(
            "TotalEquity",
            total["value"] - liabilities["value"],
            "LiabilitiesAndStockholdersEquity-Liabilities",
            [total, liabilities],
        )
    if liabilities is None:
        liabilities = derived_fact(
            LIABILITIES_TAG,
            total["value"] - equity["value"],
            "LiabilitiesAndStockholdersEquity-TotalEquity",
            [total, equity],
        )

    if liabilities["value"] < 0:
        return {
            "status": "negative_liabilities_invalid",
            "liabilities": liabilities,
            "equity": equity,
        }
    if equity["value"] <= 0:
        return {
            "status": "nonpositive_equity_auto_fail",
            "liabilities": liabilities,
            "equity": equity,
            "formula": (
                f"{liabilities.get('formula', liabilities['tag'])}/"
                f"{equity.get('formula', equity['tag'])}"
            ),
        }
    return {
        "status": "ratio_available",
        "liabilities": liabilities,
        "equity": equity,
        "ratio": liabilities["value"] / equity["value"],
        "formula": (
            f"{liabilities.get('formula', liabilities['tag'])}/"
            f"{equity.get('formula', equity['tag'])}"
        ),
    }


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
        "p90_diagnostic_only": quantile(values, 0.90),
        "p95": quantile(values, 0.95),
        "max": max(values),
    }


def fact_provenance_complete(fact: Any) -> bool:
    if not isinstance(fact, dict):
        return False
    if fact.get("accession") and fact.get("filed") and fact.get("tag"):
        return True
    sources = fact.get("sources")
    return bool(sources) and all(fact_provenance_complete(row) for row in sources)


def analyze() -> dict[str, Any]:
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    rows = []
    for issuer in manifest["issuers"]:
        payload = load_gzip_json(Path(issuer["path"]))
        gaap = (payload.get("facts") or {}).get("us-gaap") or {}
        key, facts = latest_group(filing_groups(gaap))
        if key is None or facts is None:
            resolved = {"status": "missing_relevant_filing_facts"}
            filed = accession = form = period_end = None
        else:
            filed, accession, form, period_end = key
            period_age = (AS_OF - date.fromisoformat(period_end)).days
            if period_age < 0 or period_age > MAX_PERIOD_AGE_DAYS:
                resolved = {
                    "status": "stale_or_future_period",
                    "period_age_days": period_age,
                }
            else:
                resolved = resolve_group(facts)
        status = resolved["status"]
        is_resolved = status in {
            "ratio_available",
            "nonpositive_equity_auto_fail",
        }
        provenance_complete = bool(
            is_resolved
            and filed
            and accession
            and fact_provenance_complete(resolved.get("liabilities"))
            and fact_provenance_complete(resolved.get("equity"))
        )
        rows.append(
            {
                "symbols": ",".join(issuer["symbols"]),
                "name": ",".join(issuer["names"]),
                "sector": issuer["sector"],
                "cik": issuer["financial_cik"],
                "status": status,
                "resolved": is_resolved,
                "provenance_complete": provenance_complete,
                "ratio": resolved.get("ratio"),
                "liabilities": (
                    resolved.get("liabilities") or {}
                ).get("value"),
                "equity": (resolved.get("equity") or {}).get("value"),
                "formula": resolved.get("formula"),
                "financial_period_end": period_end,
                "filed": filed,
                "accession": accession,
                "form": form,
                "detail": {
                    key: value
                    for key, value in resolved.items()
                    if key
                    not in {
                        "liabilities",
                        "equity",
                        "ratio",
                        "formula",
                    }
                },
            }
        )

    sector_counts: dict[str, Counter[str]] = defaultdict(Counter)
    for row in rows:
        counts = sector_counts[row["sector"]]
        counts["population"] += 1
        counts[row["status"]] += 1
        if row["resolved"]:
            counts["resolved"] += 1
        if row["provenance_complete"]:
            counts["provenance_complete"] += 1
    by_sector = []
    for sector in sorted(sector_counts):
        counts = sector_counts[sector]
        coverage = counts["resolved"] / counts["population"]
        by_sector.append(
            {
                "sector": sector,
                "population": counts["population"],
                "resolved": counts["resolved"],
                "coverage": coverage,
                "minimum": MIN_SECTOR_COVERAGE,
                "passes": coverage >= MIN_SECTOR_COVERAGE,
                "ratio_available": counts["ratio_available"],
                "nonpositive_equity_auto_fail": counts[
                    "nonpositive_equity_auto_fail"
                ],
            }
        )

    resolved_rows = [row for row in rows if row["resolved"]]
    ratio_values = [
        row["ratio"] for row in rows if row["ratio"] is not None
    ]
    overall_coverage = len(resolved_rows) / len(rows)
    provenance_rate = (
        sum(row["provenance_complete"] for row in resolved_rows)
        / len(resolved_rows)
        if resolved_rows
        else 0.0
    )
    overall_pass = overall_coverage >= MIN_OVERALL_COVERAGE
    sector_pass = all(row["passes"] for row in by_sector)
    provenance_pass = provenance_rate == 1.0
    passes = overall_pass and sector_pass and provenance_pass
    periods = [
        row["financial_period_end"]
        for row in rows
        if row["financial_period_end"]
    ]
    filings = [row["filed"] for row in rows if row["filed"]]
    formula_counts = Counter(
        row["formula"] for row in rows if row["formula"]
    )
    top_ratios = sorted(
        (
            {
                "symbols": row["symbols"],
                "name": row["name"],
                "sector": row["sector"],
                "ratio": row["ratio"],
                "equity": row["equity"],
                "liabilities": row["liabilities"],
                "financial_period_end": row["financial_period_end"],
                "filed": row["filed"],
                "accession": row["accession"],
            }
            for row in rows
            if row["ratio"] is not None
        ),
        key=lambda row: row["ratio"],
        reverse=True,
    )[:15]
    return {
        "preregistration": "PREREGISTRATION.v0.4.md",
        "source": "SEC Companyfacts snapshot",
        "source_generated_at_utc": manifest["generated_at_utc"],
        "as_of": AS_OF.isoformat(),
        "population": len(rows),
        "status_counts": dict(Counter(row["status"] for row in rows)),
        "formula_counts": dict(formula_counts),
        "coverage": {
            "resolved": len(resolved_rows),
            "overall": overall_coverage,
            "minimum_overall": MIN_OVERALL_COVERAGE,
            "overall_pass": overall_pass,
            "all_sector_pass": sector_pass,
            "provenance_rate": provenance_rate,
            "provenance_pass": provenance_pass,
            "passes_all_guardrails": passes,
            "by_sector": by_sector,
        },
        "distribution": (
            {
                **describe(ratio_values),
                "role": (
                    "current cross-sectional diagnostic only; not a "
                    "backtest or production threshold"
                ),
                "threshold_valid": False,
            }
            if passes
            else {
                "calculated": False,
                "reason": "Coverage or provenance guardrail failed.",
                "threshold_valid": False,
            }
        ),
        "quality_data_freshness": {
            "source_snapshot": manifest["generated_at_utc"],
            "financial_period_end_min": min(periods),
            "financial_period_end_max": max(periods),
            "filed_date_min": min(filings),
            "filed_date_max": max(filings),
        },
        "decision": {
            "retain_metric_definition": passes,
            "max_total_liabilities_to_equity": None,
            "backtest_threshold_status": (
                "UNSET_UNTIL_BACKTEST_START_AND_60_MONTH_CALIBRATION"
            ),
            "if_failed": (
                None
                if passes
                else (
                    "Do not try a third debt metric. Choose before returns "
                    "between removing the gate and stopping the project."
                )
            ),
        },
        "top_ratios_for_outlier_review": top_ratios,
        "rows": rows,
    }


def write_outputs(result: dict[str, Any]) -> None:
    (ROOT / "total_liabilities_equity_results.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    with (ROOT / "total_liabilities_equity_sector_coverage.csv").open(
        "w", encoding="utf-8-sig", newline=""
    ) as handle:
        fields = [
            "sector",
            "population",
            "resolved",
            "coverage",
            "minimum",
            "passes",
            "ratio_available",
            "nonpositive_equity_auto_fail",
        ]
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(
            {field: row[field] for field in fields}
            for row in result["coverage"]["by_sector"]
        )
    with (ROOT / "total_liabilities_equity_cross_section.csv").open(
        "w", encoding="utf-8-sig", newline=""
    ) as handle:
        fields = [
            "symbols",
            "name",
            "sector",
            "cik",
            "status",
            "resolved",
            "provenance_complete",
            "ratio",
            "liabilities",
            "equity",
            "formula",
            "financial_period_end",
            "filed",
            "accession",
            "form",
        ]
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(
            {field: row[field] for field in fields}
            for row in result["rows"]
        )


def main() -> None:
    result = analyze()
    write_outputs(result)
    print(
        json.dumps(
            {
                "status_counts": result["status_counts"],
                "formula_counts": result["formula_counts"],
                "coverage": result["coverage"],
                "distribution": result["distribution"],
                "quality_data_freshness": result[
                    "quality_data_freshness"
                ],
                "decision": result["decision"],
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
