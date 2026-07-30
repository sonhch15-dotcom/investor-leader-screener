from __future__ import annotations

import csv
import gzip
import json
import re
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path
from typing import Any

from lxml import etree

from analyze_fsds_debt import (
    CURRENT_DEBT_TAGS,
    CURRENT_LONG_TERM_PURE_TAGS,
    CURRENT_LONG_TERM_TAGS,
    DIRECT_TOTAL_TAGS,
    EQUITY_TAGS,
    NONCURRENT_COMBINED_TAGS,
    NONCURRENT_PURE_TAGS,
    PURE_TOTAL_TAGS,
    SHORT_TERM_DEBT_TAGS,
    ALL_LONG_TERM_COMBINED_TAGS,
    ALL_LONG_TERM_PURE_TAGS,
    combine,
    debt_from_rendered_statement,
    first,
)
from analyze_sp500_debt import (
    FINANCE_LEASE_CURRENT_TAGS,
    FINANCE_LEASE_NONCURRENT_TAGS,
    FINANCE_LEASE_TOTAL_TAGS,
)


ROOT = Path(__file__).resolve().parent
BASE_RESULTS_PATH = ROOT / "fsds_debt_results_2026q1.json"
INSTANCE_MANIFEST_PATH = ROOT / "fsds_instance_manifest.json"
POPULATION_MANIFEST_PATH = ROOT / "sp500_companyfacts_manifest.json"
PREREGISTRATION = "PREREGISTRATION.v0.3.md"

XBRLI = "http://www.xbrl.org/2003/instance"
XSI = "http://www.w3.org/2001/XMLSchema-instance"
XBRLDI = "http://xbrl.org/2006/xbrldi"
MIN_OVERALL_COVERAGE = 0.90
MIN_SECTOR_COVERAGE = 0.80

RELEVANT_STANDARD_TAGS = set(
    EQUITY_TAGS
    + DIRECT_TOTAL_TAGS
    + CURRENT_DEBT_TAGS
    + SHORT_TERM_DEBT_TAGS
    + CURRENT_LONG_TERM_TAGS
    + CURRENT_LONG_TERM_PURE_TAGS
    + NONCURRENT_COMBINED_TAGS
    + ALL_LONG_TERM_COMBINED_TAGS
    + NONCURRENT_PURE_TAGS
    + ALL_LONG_TERM_PURE_TAGS
    + PURE_TOTAL_TAGS
    + FINANCE_LEASE_TOTAL_TAGS
    + FINANCE_LEASE_CURRENT_TAGS
    + FINANCE_LEASE_NONCURRENT_TAGS
)

LEASE_EXCLUSIONS = (
    "maturity",
    "maturities",
    "payment",
    "payments",
    "expense",
    "interest",
    "rightofuse",
    "rouasset",
    "undiscounted",
    "weightedaverage",
    "fairvalue",
    "proceeds",
    "textblock",
)


def local_name(element: etree._Element) -> str:
    return etree.QName(element).localname


def namespace(element: etree._Element) -> str:
    return etree.QName(element).namespace or ""


def is_us_gaap(uri: str) -> bool:
    return "fasb.org/us-gaap/" in uri


def parse_number(text: str | None) -> float | None:
    if text is None:
        return None
    normalized = text.strip().replace(",", "")
    if not normalized:
        return None
    try:
        return float(normalized)
    except ValueError:
        return None


def normalize_date(value: str | None) -> str | None:
    if value is None:
        return None
    compact = value.replace("-", "")
    if len(compact) != 8 or not compact.isdigit():
        return None
    return date(
        int(compact[:4]), int(compact[4:6]), int(compact[6:])
    ).isoformat()


def context_metadata(
    root: etree._Element,
) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for context in root.findall(f".//{{{XBRLI}}}context"):
        instant = context.find(f".//{{{XBRLI}}}instant")
        dimensions = []
        for member in context.findall(f".//{{{XBRLDI}}}explicitMember"):
            dimensions.append(
                {
                    "dimension": member.get("dimension"),
                    "member": (member.text or "").strip(),
                }
            )
        for member in context.findall(f".//{{{XBRLDI}}}typedMember"):
            dimensions.append(
                {
                    "dimension": member.get("dimension"),
                    "member": "typedMember",
                }
            )
        result[context.get("id", "")] = {
            "instant": instant.text if instant is not None else None,
            "dimensions": dimensions,
        }
    return result


def usd_unit_ids(root: etree._Element) -> set[str]:
    result = set()
    for unit in root.findall(f".//{{{XBRLI}}}unit"):
        measures = [
            (measure.text or "").strip().lower()
            for measure in unit.findall(f".//{{{XBRLI}}}measure")
        ]
        if len(measures) == 1 and measures[0].endswith(":usd"):
            result.add(unit.get("id", ""))
    return result


def document_period_end(root: etree._Element) -> str | None:
    for element in root.iter():
        if local_name(element) != "DocumentPeriodEndDate":
            continue
        value = (element.text or "").strip()
        try:
            return date.fromisoformat(value).isoformat()
        except ValueError:
            continue
    return None


def nearest_instant(
    contexts: dict[str, dict[str, Any]], fsds_period: str
) -> str | None:
    target = date(
        int(fsds_period[:4]),
        int(fsds_period[4:6]),
        int(fsds_period[6:]),
    )
    candidates = set()
    for context in contexts.values():
        instant = context["instant"]
        if not instant:
            continue
        candidate = date.fromisoformat(instant)
        if abs((candidate - target).days) <= 7:
            candidates.add(candidate)
    if not candidates:
        return None
    selected = min(
        candidates, key=lambda item: (abs((item - target).days), item)
    )
    return selected.isoformat()


def source_record(
    element: etree._Element,
    value: float,
    context: dict[str, Any],
    filing: dict[str, Any],
) -> dict[str, Any]:
    return {
        "value": value,
        "tag": local_name(element),
        "namespace": namespace(element),
        "context_id": element.get("contextRef"),
        "dimensions": context["dimensions"],
        "unit_ref": element.get("unitRef"),
        "decimals": element.get("decimals"),
        "method": "official_xbrl_instance",
        "accession": filing["accession"],
        "filed": filing["filed"],
        "instance": filing["instance"],
    }


def looks_like_lease_liability(tag: str) -> bool:
    normalized = re.sub(r"[^a-z0-9]", "", tag.lower())
    has_lease = "financelease" in normalized or "capitallease" in normalized
    has_balance = "liabil" in normalized or "obligation" in normalized
    return (
        has_lease
        and has_balance
        and not any(word in normalized for word in LEASE_EXCLUSIONS)
    )


def collapse_standard_facts(
    facts: list[dict[str, Any]],
) -> tuple[dict[str, dict[str, Any]], list[str]]:
    by_tag: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for fact in facts:
        if (
            is_us_gaap(fact["namespace"])
            and fact["tag"] in RELEVANT_STANDARD_TAGS
            and not fact["dimensions"]
        ):
            by_tag[fact["tag"]].append(fact)

    result = {}
    conflicts = []
    for tag, candidates in by_tag.items():
        distinct = {candidate["value"] for candidate in candidates}
        if len(distinct) != 1:
            conflicts.append(tag)
            continue
        result[tag] = candidates[0]
    return result, sorted(conflicts)


def lease_total(
    values: dict[str, dict[str, Any]],
) -> dict[str, Any] | None:
    direct = first(values, FINANCE_LEASE_TOTAL_TAGS)
    if direct is not None:
        return {
            "value": direct["value"],
            "formula": direct["tag"],
            "sources": [direct],
        }
    return combine(
        "finance_lease_current_plus_noncurrent",
        [
            first(values, FINANCE_LEASE_CURRENT_TAGS),
            first(values, FINANCE_LEASE_NONCURRENT_TAGS),
        ],
    )


def lease_noncurrent(
    values: dict[str, dict[str, Any]],
) -> dict[str, Any] | None:
    direct = first(values, FINANCE_LEASE_NONCURRENT_TAGS)
    if direct is not None:
        return {
            "value": direct["value"],
            "formula": direct["tag"],
            "sources": [direct],
        }
    total = first(values, FINANCE_LEASE_TOTAL_TAGS)
    current = first(values, FINANCE_LEASE_CURRENT_TAGS)
    if total is None or current is None:
        return None
    return {
        "value": total["value"] - current["value"],
        "formula": "finance_lease_total_minus_current",
        "sources": [total, current],
    }


def analyze_instance(filing: dict[str, Any]) -> dict[str, Any]:
    with gzip.open(filing["path"], "rb") as handle:
        root = etree.fromstring(handle.read())
    contexts = context_metadata(root)
    period_end = document_period_end(root)
    if period_end is None:
        period_end = nearest_instant(contexts, filing["period"])
    units = usd_unit_ids(root)
    facts = []
    custom_candidates = []
    if period_end is not None:
        for element in root.iter():
            context_id = element.get("contextRef")
            if context_id not in contexts:
                continue
            context = contexts[context_id]
            if (
                context["instant"] != period_end
                or element.get("unitRef") not in units
                or element.get(f"{{{XSI}}}nil") == "true"
            ):
                continue
            value = parse_number(element.text)
            if value is None:
                continue
            source = source_record(element, value, context, filing)
            facts.append(source)
            if (
                looks_like_lease_liability(source["tag"])
                and (
                    not is_us_gaap(source["namespace"])
                    or source["dimensions"]
                )
            ):
                custom_candidates.append(source)

    values, conflicts = collapse_standard_facts(facts)
    equity = first(values, EQUITY_TAGS)
    total_lease = lease_total(values)
    noncurrent_lease = lease_noncurrent(values)
    strict_debt, _ = debt_from_rendered_statement(
        values, total_lease, noncurrent_lease
    )
    if strict_debt is not None and strict_debt["value"] < 0:
        strict_debt = None

    return {
        "cik": filing["cik"],
        "symbols": filing["symbols"],
        "name": filing["name"],
        "sector": filing["sector"],
        "accession": filing["accession"],
        "filed": filing["filed"],
        "form": filing["form"],
        "fsds_period": filing["period"],
        "document_period_end": period_end,
        "prior_status": filing["prior_status"],
        "equity": equity["value"] if equity else None,
        "equity_source": equity,
        "strict_debt": strict_debt["value"] if strict_debt else None,
        "strict_formula": strict_debt["formula"] if strict_debt else None,
        "strict_sources": strict_debt["sources"] if strict_debt else [],
        "strict_debt_to_equity": (
            strict_debt["value"] / equity["value"]
            if strict_debt and equity and equity["value"] > 0
            else None
        ),
        "standard_fact_conflicts": conflicts,
        "custom_or_dimensioned_lease_candidates": custom_candidates,
        "custom_candidates_used": False,
    }


def source_is_complete(source: Any) -> bool:
    if source is None:
        return False
    if isinstance(source, list):
        return bool(source) and all(source_is_complete(item) for item in source)
    if not isinstance(source, dict):
        return False
    if source.get("tag"):
        return True
    nested = source.get("sources")
    return source_is_complete(nested) if nested else False


def combine_results() -> dict[str, Any]:
    base = json.loads(BASE_RESULTS_PATH.read_text(encoding="utf-8"))
    instances = json.loads(
        INSTANCE_MANIFEST_PATH.read_text(encoding="utf-8")
    )
    population = json.loads(
        POPULATION_MANIFEST_PATH.read_text(encoding="utf-8")
    )
    base_by_cik = {row["cik"]: row for row in base["rows"]}
    fallback_by_cik = {}
    for index, filing in enumerate(instances["filings"], start=1):
        fallback_by_cik[filing["cik"]] = analyze_instance(filing)
        if index == 1 or index % 25 == 0 or index == len(
            instances["filings"]
        ):
            print(
                f"[instance-analysis] {index}/{len(instances['filings'])}",
                flush=True,
            )

    rows = []
    for issuer in population["issuers"]:
        cik = issuer["financial_cik"]
        base_row = base_by_cik.get(cik)
        fallback = fallback_by_cik.get(cik)
        if base_row is None:
            status = "missing_latest_submission"
            equity = None
            equity_source = None
            debt = None
            ratio = None
            formula = None
            sources = []
            period_end = None
            filed = None
            accession = None
        elif base_row["status"] == "strict_complete":
            status = "strict_complete_rendered_statement"
            equity = base_row["equity"]
            equity_source = base_row["equity_source"]
            debt = base_row["strict_debt"]
            ratio = base_row["strict_debt_to_equity"]
            formula = base_row["strict_formula"]
            sources = base_row["strict_sources"]
            period_end = normalize_date(base_row["period"])
            filed = normalize_date(base_row["filed"])
            accession = base_row["accession"]
        elif base_row["status"] == "nonpositive_equity":
            status = "nonpositive_equity_auto_fail"
            equity = base_row["equity"]
            equity_source = base_row["equity_source"]
            debt = None
            ratio = None
            formula = None
            sources = []
            period_end = normalize_date(base_row["period"])
            filed = normalize_date(base_row["filed"])
            accession = base_row["accession"]
        elif fallback and fallback["equity"] is not None and (
            fallback["equity"] <= 0
        ):
            status = "nonpositive_equity_auto_fail"
            equity = fallback["equity"]
            equity_source = fallback["equity_source"]
            debt = None
            ratio = None
            formula = None
            sources = []
            period_end = fallback["document_period_end"]
            filed = normalize_date(fallback["filed"])
            accession = fallback["accession"]
        elif fallback and fallback["strict_debt_to_equity"] is not None:
            status = "strict_complete_instance_fallback"
            equity = fallback["equity"]
            equity_source = fallback["equity_source"]
            debt = fallback["strict_debt"]
            ratio = fallback["strict_debt_to_equity"]
            formula = fallback["strict_formula"]
            sources = fallback["strict_sources"]
            period_end = fallback["document_period_end"]
            filed = normalize_date(fallback["filed"])
            accession = fallback["accession"]
        else:
            status = "unresolved_interest_bearing_debt"
            equity = fallback["equity"] if fallback else base_row["equity"]
            equity_source = (
                fallback["equity_source"]
                if fallback and fallback["equity_source"]
                else base_row["equity_source"]
            )
            debt = None
            ratio = None
            formula = None
            sources = []
            period_end = (
                fallback["document_period_end"]
                if fallback
                else normalize_date(base_row["period"])
            )
            filed = normalize_date(base_row["filed"])
            accession = base_row["accession"]

        resolved = status in {
            "strict_complete_rendered_statement",
            "strict_complete_instance_fallback",
            "nonpositive_equity_auto_fail",
        }
        provenance_complete = bool(
            resolved
            and filed
            and accession
            and source_is_complete(equity_source)
            and (
                status == "nonpositive_equity_auto_fail"
                or source_is_complete(sources)
            )
        )
        rows.append(
            {
                "symbols": ",".join(issuer["symbols"]),
                "name": ",".join(issuer["names"]),
                "sector": issuer["sector"],
                "cik": cik,
                "status": status,
                "resolved": resolved,
                "provenance_complete": provenance_complete,
                "equity": equity,
                "strict_debt": debt,
                "strict_debt_to_equity": ratio,
                "strict_formula": formula,
                "financial_period_end": period_end,
                "filed": filed,
                "accession": accession,
                "fallback_custom_candidate_count": len(
                    fallback[
                        "custom_or_dimensioned_lease_candidates"
                    ]
                )
                if fallback
                else 0,
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
                "strict_rendered": counts[
                    "strict_complete_rendered_statement"
                ],
                "strict_instance_fallback": counts[
                    "strict_complete_instance_fallback"
                ],
                "nonpositive_equity_auto_fail": counts[
                    "nonpositive_equity_auto_fail"
                ],
            }
        )

    resolved_rows = [row for row in rows if row["resolved"]]
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

    periods = [row["financial_period_end"] for row in rows if row["financial_period_end"]]
    filed_dates = [row["filed"] for row in rows if row["filed"]]
    custom_candidate_issuers = sum(
        bool(
            result["custom_or_dimensioned_lease_candidates"]
        )
        for result in fallback_by_cik.values()
    )
    return {
        "preregistration": PREREGISTRATION,
        "audit_correction": "DATA_AUDIT_CORRECTION.md",
        "source": "SEC Financial Statement Data Set 2026 Q1 and official filing XBRL instances",
        "quality_data_freshness": {
            "source_latest_filing_quarter": "2026 Q1",
            "financial_period_end_min": min(periods),
            "financial_period_end_max": max(periods),
            "filed_date_min": min(filed_dates),
            "filed_date_max": max(filed_dates),
        },
        "population": len(rows),
        "status_counts": dict(Counter(row["status"] for row in rows)),
        "baseline_corrected": {
            "strict_complete": sum(
                row["status"] == "strict_complete_rendered_statement"
                for row in rows
            ),
            "nonpositive_equity_auto_fail": sum(
                row["status"] == "nonpositive_equity_auto_fail"
                for row in rows
            )
            - sum(
                row["status"] == "nonpositive_equity_auto_fail"
                and row["cik"] in fallback_by_cik
                and base_by_cik.get(row["cik"], {}).get("status")
                != "nonpositive_equity"
                for row in rows
            ),
        },
        "instance_fallback": {
            "documents_analyzed": len(fallback_by_cik),
            "new_strict_complete": sum(
                row["status"] == "strict_complete_instance_fallback"
                for row in rows
            ),
            "new_nonpositive_equity_auto_fail": sum(
                row["status"] == "nonpositive_equity_auto_fail"
                and base_by_cik.get(row["cik"], {}).get("status")
                != "nonpositive_equity"
                for row in rows
            ),
            "issuers_with_custom_or_dimensioned_lease_candidates": (
                custom_candidate_issuers
            ),
            "custom_candidates_used": 0,
            "custom_candidate_rule": (
                "Logged for audit only. Not used because v0.3 forbids "
                "company-specific exceptions or ad hoc tag heuristics."
            ),
        },
        "coverage": {
            "resolved": len(resolved_rows),
            "overall": overall_coverage,
            "minimum_overall": MIN_OVERALL_COVERAGE,
            "overall_pass": overall_pass,
            "all_sector_pass": sector_pass,
            "provenance_rate": provenance_rate,
            "provenance_pass": provenance_pass,
            "by_sector": by_sector,
        },
        "decision": {
            "passes_all_preregistered_guardrails": passes,
            "action": (
                "RETAIN_INTEREST_BEARING_DEBT_DEFINITION"
                if passes
                else "REPLACE_DEBT_METRIC_DEFINITION"
            ),
            "max_debt_to_equity": None,
            "p90_calculated": False,
            "reason": (
                "All coverage and provenance guardrails passed."
                if passes
                else (
                    "At least one preregistered coverage guardrail failed. "
                    "No threshold or guardrail is adjusted."
                )
            ),
        },
        "fallback_details": list(fallback_by_cik.values()),
        "rows": rows,
    }


def write_outputs(result: dict[str, Any]) -> None:
    (ROOT / "fsds_instance_fallback_results.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    with (ROOT / "fsds_instance_fallback_sector_coverage.csv").open(
        "w", encoding="utf-8-sig", newline=""
    ) as handle:
        fields = [
            "sector",
            "population",
            "resolved",
            "coverage",
            "minimum",
            "passes",
            "strict_rendered",
            "strict_instance_fallback",
            "nonpositive_equity_auto_fail",
        ]
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(
            {field: row[field] for field in fields}
            for row in result["coverage"]["by_sector"]
        )
    with (ROOT / "fsds_instance_fallback_rows.csv").open(
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
            "strict_debt_to_equity",
            "strict_formula",
            "financial_period_end",
            "filed",
            "accession",
            "fallback_custom_candidate_count",
        ]
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(
            {field: row[field] for field in fields}
            for row in result["rows"]
        )


def main() -> None:
    result = combine_results()
    write_outputs(result)
    print(
        json.dumps(
            {
                "status_counts": result["status_counts"],
                "instance_fallback": result["instance_fallback"],
                "coverage": result["coverage"],
                "decision": result["decision"],
                "quality_data_freshness": result[
                    "quality_data_freshness"
                ],
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
