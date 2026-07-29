from __future__ import annotations

import csv
import gzip
import json
from collections import Counter
from datetime import date
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
FORMS = {"10-Q", "10-K", "10-Q/A", "10-K/A"}
AS_OF = date(2026, 7, 29)
MIN_QUARTER_DAYS = 60
MAX_QUARTER_DAYS = 130

DURATION_TAGS = {
    "revenue": [
        "RevenueFromContractWithCustomerExcludingAssessedTax",
        "Revenues",
        "SalesRevenueNet",
        "OperatingRevenues",
    ],
    "net_income": ["NetIncomeLoss", "ProfitLoss"],
    "operating_cash_flow": [
        "NetCashProvidedByUsedInOperatingActivities",
        "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
    ],
}
EQUITY_TAGS = [
    "StockholdersEquity",
    "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
]
GROSS_COST_TAGS = {
    "GOOGL": "CostOfRevenue",
    "PG": "CostOfGoodsAndServicesSold",
    "COST": "CostOfGoodsAndServicesSold",
}
GROSS_UNAVAILABLE_NOTES = {
    "CAT": (
        "총매출에 Financial Products가 포함되지만 표준 cost 태그는 "
        "동일 범위가 아니어서 단순 차감 불가"
    ),
    "XOM": "gross profit 라인을 공시하지 않고 원가가 여러 비용 항목으로 분리됨",
    "LIN": "cost of sales가 감가상각·상각비 제외 기준이라 단순 차감 불가",
}
DEBT_FORMULAS = {
    "AAPL": [
        "CommercialPaper",
        "LongTermDebtCurrent",
        "LongTermDebtNoncurrent",
    ],
    "MSFT": [
        "CommercialPaper",
        "LongTermDebtCurrent",
        "LongTermDebtNoncurrent",
    ],
    "GOOGL": [
        "CommercialPaper",
        "LongTermDebtCurrent",
        "LongTermDebtNoncurrent",
    ],
    "HD": [
        "CommercialPaper",
        "LongTermDebtAndCapitalLeaseObligationsCurrent",
        "LongTermDebtAndCapitalLeaseObligations",
    ],
    "JNJ": ["ShortTermBorrowings", "LongTermDebtNoncurrent"],
    "PG": ["DebtCurrent", "LongTermDebtNoncurrent"],
    "COST": ["LongTermDebtCurrent", "LongTermDebtNoncurrent"],
    "CAT": ["ShortTermBorrowings", "LongTermDebtNoncurrent"],
    "XOM": ["DebtCurrent", "LongTermDebtAndCapitalLeaseObligations"],
    "LIN": ["DebtLongtermAndShorttermCombinedAmount"],
}
DEBT_MAPPING_STATUS = {
    "AAPL": "검증 필요: commercial paper와 장기부채 구성요소 합산",
    "MSFT": "불완전: commercial paper 미보고 분기를 0으로 간주할 수 없음",
    "GOOGL": "불완전: 태그 전환과 finance lease 포함 범위 확인 필요",
    "HD": "검증 필요: commercial paper와 current/noncurrent 합산",
    "JNJ": "불완전: current maturity가 분기별 short-term borrowings에 포함되는지 확인 필요",
    "PG": "검증 필요: DebtCurrent와 noncurrent debt 합산",
    "COST": "검증 필요: current/noncurrent debt 합산",
    "CAT": "불가: 표준 태그는 주로 연말 값만 제공",
    "XOM": "검증 필요: 선행 CIK의 current/noncurrent debt 합산",
    "LIN": "직접 총부채 표준 태그 사용 가능",
}


def parse_date(value: str) -> date:
    return date.fromisoformat(value)


def load_gzip(path: Path) -> dict[str, Any]:
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        return json.load(handle)


def source_record(tag: str, row: dict[str, Any]) -> dict[str, Any]:
    return {
        "tag": tag,
        "start": row.get("start"),
        "end": row.get("end"),
        "value": row.get("val"),
        "filed": row.get("filed"),
        "accession": row.get("accn"),
        "form": row.get("form"),
    }


def eligible_usd_rows(fact: dict[str, Any]) -> list[dict[str, Any]]:
    rows = []
    for row in (fact.get("units") or {}).get("USD", []):
        if row.get("form") not in FORMS:
            continue
        if not row.get("end") or not row.get("filed"):
            continue
        if parse_date(row["filed"]) > AS_OF:
            continue
        if not isinstance(row.get("val"), (int, float)):
            continue
        rows.append(row)
    return rows


def latest_by_interval(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    selected: dict[tuple[str | None, str], dict[str, Any]] = {}
    for row in rows:
        key = (row.get("start"), row["end"])
        current = selected.get(key)
        rank = (row["filed"], row.get("accn", ""), row.get("form", ""))
        current_rank = (
            (current["filed"], current.get("accn", ""), current.get("form", ""))
            if current
            else ("", "", "")
        )
        if current is None or rank > current_rank:
            selected[key] = row
    return list(selected.values())


def duration_series(
    gaap: dict[str, Any], tag: str
) -> dict[str, dict[str, Any]]:
    fact = gaap.get(tag)
    if not fact:
        return {}
    rows = [
        row
        for row in latest_by_interval(eligible_usd_rows(fact))
        if row.get("start")
    ]
    candidates: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        days = (parse_date(row["end"]) - parse_date(row["start"])).days
        if MIN_QUARTER_DAYS <= days <= MAX_QUARTER_DAYS:
            candidates.setdefault(row["end"], []).append(
                {
                    "value": row["val"],
                    "method": "direct",
                    "available_on": row["filed"],
                    "tags": [tag],
                    "sources": [source_record(tag, row)],
                }
            )

    by_start: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        by_start.setdefault(row["start"], []).append(row)
    for same_start in by_start.values():
        for longer in same_start:
            for shorter in same_start:
                if shorter["end"] >= longer["end"]:
                    continue
                residual_days = (
                    parse_date(longer["end"]) - parse_date(shorter["end"])
                ).days
                if not MIN_QUARTER_DAYS <= residual_days <= MAX_QUARTER_DAYS:
                    continue
                candidates.setdefault(longer["end"], []).append(
                    {
                        "value": longer["val"] - shorter["val"],
                        "method": "derived_ytd_difference",
                        "available_on": max(longer["filed"], shorter["filed"]),
                        "tags": [tag],
                        "sources": [
                            source_record(tag, longer),
                            source_record(tag, shorter),
                        ],
                    }
                )

    selected: dict[str, dict[str, Any]] = {}
    for end, choices in candidates.items():
        selected[end] = max(
            choices,
            key=lambda item: (
                item["available_on"],
                item["method"] == "direct",
            ),
        )
    return selected


def instant_series(
    gaap: dict[str, Any], tag: str
) -> dict[str, dict[str, Any]]:
    fact = gaap.get(tag)
    if not fact:
        return {}
    rows = [
        row
        for row in latest_by_interval(eligible_usd_rows(fact))
        if not row.get("start")
    ]
    return {
        row["end"]: {
            "value": row["val"],
            "method": "instant",
            "available_on": row["filed"],
            "tags": [tag],
            "sources": [source_record(tag, row)],
        }
        for row in rows
    }


def merge_tag_series(
    gaap: dict[str, Any],
    tags: list[str],
    *,
    instant: bool = False,
) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    extractor = instant_series if instant else duration_series
    for tag in tags:
        for end, point in extractor(gaap, tag).items():
            result.setdefault(end, point)
    return result


def difference_series(
    minuend: dict[str, dict[str, Any]],
    subtrahend: dict[str, dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    result = {}
    for end in minuend.keys() & subtrahend.keys():
        left = minuend[end]
        right = subtrahend[end]
        result[end] = {
            "value": left["value"] - right["value"],
            "method": "derived_revenue_minus_cost",
            "available_on": max(left["available_on"], right["available_on"]),
            "tags": [*left["tags"], *right["tags"]],
            "sources": [*left["sources"], *right["sources"]],
        }
    return result


def sum_component_series(
    gaap: dict[str, Any],
    tags: list[str],
) -> dict[str, dict[str, Any]]:
    components = {tag: instant_series(gaap, tag) for tag in tags}
    if not components:
        return {}
    common_ends = set.intersection(
        *(set(series) for series in components.values())
    )
    result = {}
    for end in common_ends:
        points = [components[tag][end] for tag in tags]
        result[end] = {
            "value": sum(point["value"] for point in points),
            "method": "sum_components" if len(tags) > 1 else "direct_total",
            "available_on": max(point["available_on"] for point in points),
            "tags": tags,
            "sources": [
                source
                for point in points
                for source in point["sources"]
            ],
        }
    return result


def amendment_summary(
    submissions: dict[str, Any], oldest_quarter_end: str
) -> dict[str, Any]:
    recent = (submissions.get("filings") or {}).get("recent") or {}
    forms = recent.get("form", [])
    dates = recent.get("filingDate", [])
    accessions = recent.get("accessionNumber", [])
    rows = [
        {"form": form, "filed": filed, "accession": accession}
        for form, filed, accession in zip(forms, dates, accessions)
        if form in {"10-Q/A", "10-K/A"}
    ]
    return {
        "count": len(rows),
        "filings": rows,
        "within_eight_quarter_window_count": sum(
            row["filed"] >= oldest_quarter_end for row in rows
        ),
    }


def choose_financial_registrant(
    company: dict[str, Any]
) -> dict[str, Any]:
    return next(
        (
            item
            for item in company["registrants"]
            if "us-gaap" in item["taxonomies"]
        ),
        company["registrants"][0],
    )


def tags_used(
    series: dict[str, dict[str, Any]], expected_ends: list[str]
) -> list[str]:
    return sorted(
        {
            tag
            for end in expected_ends
            if end in series
            for tag in series[end]["tags"]
        }
    )


def coverage(
    series: dict[str, dict[str, Any]], expected_ends: list[str]
) -> int:
    return sum(end in series for end in expected_ends)


def provenance_counts(
    series_by_field: dict[str, dict[str, dict[str, Any]]],
    expected_ends: list[str],
) -> dict[str, int]:
    sources = [
        source
        for series in series_by_field.values()
        for end in expected_ends
        if end in series
        for source in series[end]["sources"]
    ]
    return {
        "source_fact_count": len(sources),
        "filed_present": sum(bool(source.get("filed")) for source in sources),
        "accession_present": sum(
            bool(source.get("accession")) for source in sources
        ),
        "amended_source_fact_count": sum(
            str(source.get("form", "")).endswith("/A") for source in sources
        ),
    }


def analyze_company(company: dict[str, Any]) -> dict[str, Any]:
    symbol = company["symbol"]
    registrant = choose_financial_registrant(company)
    facts = load_gzip(Path(registrant["companyfacts_path"]))
    gaap = facts.get("facts", {}).get("us-gaap", {})

    revenue = merge_tag_series(gaap, DURATION_TAGS["revenue"])
    net_income = merge_tag_series(gaap, DURATION_TAGS["net_income"])
    operating_cash_flow = merge_tag_series(
        gaap, DURATION_TAGS["operating_cash_flow"]
    )
    equity = merge_tag_series(gaap, EQUITY_TAGS, instant=True)

    gross_profit = duration_series(gaap, "GrossProfit")
    gross_profit_note = "GrossProfit 직접 태그"
    if symbol in GROSS_UNAVAILABLE_NOTES:
        gross_profit = {}
        gross_profit_note = GROSS_UNAVAILABLE_NOTES[symbol]
    elif symbol in GROSS_COST_TAGS:
        cost_tag = GROSS_COST_TAGS[symbol]
        cost = duration_series(gaap, cost_tag)
        derived_gross_profit = difference_series(revenue, cost)
        for end, point in derived_gross_profit.items():
            gross_profit.setdefault(end, point)
        gross_profit_note = (
            f"GrossProfit 직접 태그 우선, 누락 분기는 매출 - {cost_tag} 파생"
            if duration_series(gaap, "GrossProfit")
            else f"매출 - {cost_tag} 파생"
        )
    elif not gross_profit:
        gross_profit_note = "동등한 표준 gross profit/cost 태그 없음"

    total_debt = sum_component_series(gaap, DEBT_FORMULAS[symbol])

    expected_ends = sorted(revenue, reverse=True)[:8]
    series_by_field = {
        "revenue": revenue,
        "net_income": net_income,
        "operating_cash_flow": operating_cash_flow,
        "equity": equity,
        "total_debt": total_debt,
        "gross_profit": gross_profit,
    }
    field_results = {
        field: {
            "quarters_available": coverage(series, expected_ends),
            "tags_used": tags_used(series, expected_ends),
            "missing_quarter_ends": [
                end for end in expected_ends if end not in series
            ],
            "methods_used": sorted(
                {
                    series[end]["method"]
                    for end in expected_ends
                    if end in series
                }
            ),
            "quarter_points": {
                end: series[end]
                for end in expected_ends
                if end in series
            },
        }
        for field, series in series_by_field.items()
    }

    submissions = load_gzip(Path(registrant["submissions_path"]))
    provenance = provenance_counts(series_by_field, expected_ends)
    latest_end = expected_ends[0]
    latest_debt_to_equity = None
    if latest_end in total_debt and latest_end in equity:
        latest_debt_to_equity = (
            total_debt[latest_end]["value"] / equity[latest_end]["value"]
        )
    return {
        "symbol": symbol,
        "current_cik": company["current_cik"],
        "financial_cik": registrant["cik"],
        "financial_cik_role": registrant["role"],
        "entity_name": registrant["entity_name"],
        "expected_quarter_ends": expected_ends,
        "expected_quarter_count": len(expected_ends),
        "fields": field_results,
        "all_six_fields_have_8_quarters": len(expected_ends) == 8
        and all(
            item["quarters_available"] == 8
            for item in field_results.values()
        ),
        "gross_profit_mapping_note": gross_profit_note,
        "debt_formula": DEBT_FORMULAS[symbol],
        "debt_mapping_status": DEBT_MAPPING_STATUS[symbol],
        "latest_debt_to_equity": latest_debt_to_equity,
        "provenance": provenance,
        "amendments": amendment_summary(
            submissions, min(expected_ends)
        ),
        "cik_lineage_used": registrant["role"] == "predecessor",
    }


def write_summary_csv(rows: list[dict[str, Any]]) -> None:
    fieldnames = [
        "symbol",
        "financial_cik",
        "revenue_q",
        "net_income_q",
        "ocf_q",
        "equity_q",
        "total_debt_q",
        "gross_profit_q",
        "filed_pct",
        "accession_pct",
        "amendment_count",
        "all_six_fields_have_8_quarters",
    ]
    with (ROOT / "summary.csv").open(
        "w", encoding="utf-8-sig", newline=""
    ) as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            count = row["provenance"]["source_fact_count"]
            writer.writerow(
                {
                    "symbol": row["symbol"],
                    "financial_cik": row["financial_cik"],
                    "revenue_q": row["fields"]["revenue"][
                        "quarters_available"
                    ],
                    "net_income_q": row["fields"]["net_income"][
                        "quarters_available"
                    ],
                    "ocf_q": row["fields"]["operating_cash_flow"][
                        "quarters_available"
                    ],
                    "equity_q": row["fields"]["equity"][
                        "quarters_available"
                    ],
                    "total_debt_q": row["fields"]["total_debt"][
                        "quarters_available"
                    ],
                    "gross_profit_q": row["fields"]["gross_profit"][
                        "quarters_available"
                    ],
                    "filed_pct": round(
                        100 * row["provenance"]["filed_present"] / count, 1
                    )
                    if count
                    else 0,
                    "accession_pct": round(
                        100
                        * row["provenance"]["accession_present"]
                        / count,
                        1,
                    )
                    if count
                    else 0,
                    "amendment_count": row["amendments"]["count"],
                    "all_six_fields_have_8_quarters": row[
                        "all_six_fields_have_8_quarters"
                    ],
                }
            )


def main() -> None:
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    rows = [analyze_company(company) for company in manifest["companies"]]
    field_totals = {
        field: sum(
            row["fields"][field]["quarters_available"] == 8 for row in rows
        )
        for field in [
            "revenue",
            "net_income",
            "operating_cash_flow",
            "equity",
            "total_debt",
            "gross_profit",
        ]
    }
    tag_variation = {
        field: sorted(
            {
                tag
                for row in rows
                for tag in row["fields"][field]["tags_used"]
            }
        )
        for field in field_totals
    }
    amendment_forms = Counter(
        filing["form"]
        for row in rows
        for filing in row["amendments"]["filings"]
    )
    payload = {
        "as_of": AS_OF.isoformat(),
        "method": {
            "quarter_days": [
                MIN_QUARTER_DAYS,
                MAX_QUARTER_DAYS,
            ],
            "duration_quarters": (
                "direct quarterly facts or YTD differences; latest filed "
                "version available by as_of"
            ),
            "instant_facts": (
                "latest filed version for each fiscal quarter end by as_of"
            ),
            "forms": sorted(FORMS),
            "missing_values": "never filled with zero",
        },
        "companies": rows,
        "companies_with_8_quarters_by_field": field_totals,
        "companies_with_all_six_fields_8_quarters": sum(
            row["all_six_fields_have_8_quarters"] for row in rows
        ),
        "tag_variation": tag_variation,
        "amendment_form_counts": dict(amendment_forms),
    }
    (ROOT / "results.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    write_summary_csv(rows)
    print(
        json.dumps(
            {
                "companies_with_8_quarters_by_field": field_totals,
                "companies_with_all_six_fields_8_quarters": payload[
                    "companies_with_all_six_fields_8_quarters"
                ],
                "amendment_form_counts": payload["amendment_form_counts"],
            },
            ensure_ascii=True,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
