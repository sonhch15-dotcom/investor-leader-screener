from __future__ import annotations

from datetime import date
from typing import Any


FORMS = {"10-Q", "10-K", "10-Q/A", "10-K/A"}
MIN_QUARTER_DAYS = 60
MAX_QUARTER_DAYS = 130
MAX_FINANCIAL_PERIOD_AGE_DAYS = 250

MIN_ROE = 0.15
MAX_TOTAL_LIABILITIES_TO_EQUITY = 1.268891979601298
MAX_LIABILITIES_YOY_GROWTH = 0.30
MAX_GROSS_MARGIN_DROP = 0.05

REVENUE_TAGS = [
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "Revenues",
    "SalesRevenueNet",
    "OperatingRevenues",
]
NET_INCOME_TAGS = ["NetIncomeLoss", "ProfitLoss"]
OPERATING_CASH_FLOW_TAGS = [
    "NetCashProvidedByUsedInOperatingActivities",
    "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
]
EQUITY_TAGS = [
    "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
    "StockholdersEquity",
]
DIVIDEND_PER_SHARE_TAGS = [
    "CommonStockDividendsPerShareDeclared",
    "CommonStockDividendsPerShareCashPaid",
]


def parse_date(value: str) -> date:
    return date.fromisoformat(value)


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


def eligible_rows(
    fact: dict[str, Any],
    unit: str,
    as_of: date,
) -> list[dict[str, Any]]:
    rows = []
    for row in (fact.get("units") or {}).get(unit, []):
        if row.get("form") not in FORMS:
            continue
        if not row.get("end") or not row.get("filed"):
            continue
        if parse_date(row["filed"]) > as_of:
            continue
        if not isinstance(row.get("val"), (int, float)):
            continue
        rows.append(row)
    return rows


def latest_by_interval(
    rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    selected: dict[tuple[str | None, str], dict[str, Any]] = {}
    for row in rows:
        key = (row.get("start"), row["end"])
        current = selected.get(key)
        rank = (
            row["filed"],
            row.get("accn", ""),
            row.get("form", ""),
        )
        current_rank = (
            (
                current["filed"],
                current.get("accn", ""),
                current.get("form", ""),
            )
            if current
            else ("", "", "")
        )
        if current is None or rank > current_rank:
            selected[key] = row
    return list(selected.values())


def duration_tag_series(
    gaap: dict[str, Any],
    tag: str,
    as_of: date,
    *,
    unit: str = "USD",
) -> dict[str, dict[str, Any]]:
    fact = gaap.get(tag)
    if not fact:
        return {}
    rows = [
        row
        for row in latest_by_interval(eligible_rows(fact, unit, as_of))
        if row.get("start")
    ]
    candidates: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        days = (parse_date(row["end"]) - parse_date(row["start"])).days
        if MIN_QUARTER_DAYS <= days <= MAX_QUARTER_DAYS:
            candidates.setdefault(row["end"], []).append(
                {
                    "value": float(row["val"]),
                    "method": "direct_quarter",
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
                    parse_date(longer["end"])
                    - parse_date(shorter["end"])
                ).days
                if not (
                    MIN_QUARTER_DAYS
                    <= residual_days
                    <= MAX_QUARTER_DAYS
                ):
                    continue
                candidates.setdefault(longer["end"], []).append(
                    {
                        "value": float(longer["val"] - shorter["val"]),
                        "method": "derived_ytd_difference",
                        "available_on": max(
                            longer["filed"], shorter["filed"]
                        ),
                        "tags": [tag],
                        "sources": [
                            source_record(tag, longer),
                            source_record(tag, shorter),
                        ],
                    }
                )

    return {
        end: max(
            choices,
            key=lambda item: (
                item["available_on"],
                item["method"] == "direct_quarter",
            ),
        )
        for end, choices in candidates.items()
    }


def duration_series(
    gaap: dict[str, Any],
    tags: list[str],
    as_of: date,
    *,
    unit: str = "USD",
) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for tag in tags:
        for end, point in duration_tag_series(
            gaap, tag, as_of, unit=unit
        ).items():
            result.setdefault(end, point)
    return result


def instant_tag_series(
    gaap: dict[str, Any],
    tag: str,
    as_of: date,
) -> dict[str, dict[str, Any]]:
    fact = gaap.get(tag)
    if not fact:
        return {}
    rows = [
        row
        for row in latest_by_interval(
            eligible_rows(fact, "USD", as_of)
        )
        if not row.get("start")
    ]
    return {
        row["end"]: {
            "value": float(row["val"]),
            "method": "instant",
            "available_on": row["filed"],
            "tags": [tag],
            "sources": [source_record(tag, row)],
        }
        for row in rows
    }


def instant_series(
    gaap: dict[str, Any],
    tags: list[str],
    as_of: date,
) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for tag in tags:
        for end, point in instant_tag_series(gaap, tag, as_of).items():
            result.setdefault(end, point)
    return result


def series_provenance(
    series: dict[str, dict[str, Any]],
    periods: list[str],
) -> dict[str, Any]:
    points = [series[period] for period in periods if period in series]
    sources = [
        source
        for point in points
        for source in point.get("sources", [])
    ]
    return {
        "periods": [period for period in periods if period in series],
        "tags": sorted(
            {
                tag
                for point in points
                for tag in point.get("tags", [])
            }
        ),
        "methods": sorted(
            {point.get("method") for point in points if point.get("method")}
        ),
        "latest_filed": max(
            (source["filed"] for source in sources if source.get("filed")),
            default=None,
        ),
        "accessions": sorted(
            {
                source["accession"]
                for source in sources
                if source.get("accession")
            }
        ),
    }


def dividend_red_flag(
    gaap: dict[str, Any],
    quarter_ends: list[str],
    as_of: date,
    payment_status: dict[str, Any] | None = None,
) -> dict[str, Any]:
    market_classification = (
        payment_status or {}
    ).get("classification")
    if market_classification == "NO_DIVIDEND_PAYMENT_TRAILING_365D":
        return {
            "status": "NOT_APPLICABLE_NON_PAYER",
            "triggered": False,
            "data_complete": True,
            "periods": [],
            "values": [],
            "payment_status": payment_status,
        }

    series = duration_series(
        gaap,
        DIVIDEND_PER_SHARE_TAGS,
        as_of,
        unit="USD/shares",
    )
    positive_history = [
        point for point in series.values() if point["value"] > 0
    ]
    if not positive_history:
        return {
            "status": (
                "DIVIDEND_HISTORY_DATA_INSUFFICIENT"
                if market_classification == "CURRENT_PAYER"
                else "DIVIDEND_PAYER_STATUS_UNAVAILABLE"
            ),
            "triggered": False,
            "data_complete": False,
            "periods": [],
            "values": [],
            "payment_status": payment_status,
        }
    if len(quarter_ends) < 5:
        return {
            "status": "DIVIDEND_HISTORY_DATA_INSUFFICIENT",
            "triggered": False,
            "data_complete": False,
            "periods": quarter_ends,
            "values": [],
            "payment_status": payment_status,
        }
    periods = quarter_ends[:5]
    if any(period not in series for period in periods):
        return {
            "status": "DIVIDEND_HISTORY_DATA_INSUFFICIENT",
            "triggered": False,
            "data_complete": False,
            "periods": [period for period in periods if period in series],
            "values": [
                series[period]["value"]
                for period in periods
                if period in series
            ],
            "payment_status": payment_status,
        }
    chronological = list(reversed(periods))
    values = [series[period]["value"] for period in chronological]
    if any(value < 0 for value in values):
        return {
            "status": "DIVIDEND_HISTORY_INVALID",
            "triggered": False,
            "data_complete": False,
            "periods": chronological,
            "values": values,
            "payment_status": payment_status,
        }
    cuts = [
        {
            "prior_period": chronological[index - 1],
            "current_period": chronological[index],
            "prior_value": values[index - 1],
            "current_value": values[index],
        }
        for index in range(1, len(values))
        if values[index] + 1e-12 < values[index - 1]
    ]
    return {
        "status": "DIVIDEND_CUT_DETECTED" if cuts else "PASS",
        "triggered": bool(cuts),
        "data_complete": True,
        "periods": chronological,
        "values": values,
        "cuts": cuts,
        "provenance": series_provenance(series, periods),
        "payment_status": payment_status,
    }


def balance_provenance(row: dict[str, Any] | None) -> dict[str, Any]:
    if not row:
        return {}
    return {
        "dataset_quarter": row.get("dataset_quarter"),
        "financial_period_end": row.get("financial_period_end"),
        "filed": row.get("filed"),
        "accession": row.get("accession"),
        "form": row.get("form"),
        "formula": row.get("formula"),
        "status": row.get("status"),
    }


def evaluate_issuer(
    issuer: dict[str, Any],
    companyfacts: dict[str, Any] | None,
    current_balance: dict[str, Any] | None,
    prior_balance: dict[str, Any] | None,
    as_of: date,
    dividend_payment_status: dict[str, Any] | None = None,
) -> dict[str, Any]:
    base = {
        "issuer_id": issuer["issuer_id"],
        "cik": issuer["current_cik"],
        "financial_cik": issuer["financial_cik"],
        "symbols": issuer["symbols"],
        "names": issuer["names"],
        "securities": issuer["securities"],
        "sector": issuer["sector"],
    }
    data_reasons: list[str] = []
    if companyfacts is None:
        return {
            **base,
            "stage": "DATA_INSUFFICIENT",
            "data_complete": False,
            "data_insufficient_reasons": ["COMPANYFACTS_UNAVAILABLE"],
            "quality_failures": [],
            "red_flags": [],
            "tags": [],
        }

    gaap = (companyfacts.get("facts") or {}).get("us-gaap", {})
    if not gaap:
        return {
            **base,
            "stage": "DATA_INSUFFICIENT",
            "data_complete": False,
            "data_insufficient_reasons": ["US_GAAP_FACTS_UNAVAILABLE"],
            "quality_failures": [],
            "red_flags": [],
            "tags": [],
        }

    revenue = duration_series(gaap, REVENUE_TAGS, as_of)
    net_income = duration_series(gaap, NET_INCOME_TAGS, as_of)
    operating_cash_flow = duration_series(
        gaap, OPERATING_CASH_FLOW_TAGS, as_of
    )
    equity = instant_series(gaap, EQUITY_TAGS, as_of)
    gross_profit = duration_series(gaap, ["GrossProfit"], as_of)

    quarter_ends = sorted(revenue, reverse=True)[:8]
    if len(quarter_ends) < 8:
        data_reasons.append("REVENUE_8_QUARTERS_MISSING")
    if quarter_ends:
        age = (as_of - parse_date(quarter_ends[0])).days
        if age > MAX_FINANCIAL_PERIOD_AGE_DAYS:
            data_reasons.append("INCOME_STATEMENT_STALE")
    latest_four = quarter_ends[:4]
    prior_four = quarter_ends[4:8]
    for label, series, periods in (
        ("NET_INCOME_4_QUARTERS_MISSING", net_income, latest_four),
        (
            "OPERATING_CASH_FLOW_4_QUARTERS_MISSING",
            operating_cash_flow,
            latest_four,
        ),
        ("EQUITY_CURRENT_AND_PRIOR_MISSING", equity, quarter_ends[:5]),
    ):
        if len(periods) < (5 if label.startswith("EQUITY") else 4):
            if label not in data_reasons:
                data_reasons.append(label)
        elif label.startswith("EQUITY"):
            if periods[0] not in series or periods[4] not in series:
                data_reasons.append(label)
        elif any(period not in series for period in periods):
            data_reasons.append(label)

    allowed_balance_statuses = {
        "ratio_available",
        "nonpositive_equity_auto_fail",
    }
    if current_balance is None:
        data_reasons.append("CURRENT_BALANCE_SHEET_MISSING")
    elif (
        current_balance.get("status") not in allowed_balance_statuses
        or not current_balance.get("provenance_complete")
    ):
        data_reasons.append(
            "CURRENT_TOTAL_LIABILITIES_EQUITY_UNRESOLVED"
        )
    else:
        balance_age = (
            as_of
            - parse_date(current_balance["financial_period_end"])
        ).days
        if balance_age > MAX_FINANCIAL_PERIOD_AGE_DAYS:
            data_reasons.append("CURRENT_BALANCE_SHEET_STALE")

    if prior_balance is None:
        data_reasons.append("PRIOR_YEAR_BALANCE_SHEET_MISSING")
    elif (
        prior_balance.get("status") not in allowed_balance_statuses
        or not prior_balance.get("provenance_complete")
    ):
        data_reasons.append(
            "PRIOR_YEAR_TOTAL_LIABILITIES_EQUITY_UNRESOLVED"
        )
    elif prior_balance.get("liabilities") is None or (
        prior_balance["liabilities"] <= 0
    ):
        data_reasons.append(
            "PRIOR_YEAR_TOTAL_LIABILITIES_NONPOSITIVE"
        )
    elif current_balance and current_balance.get("financial_period_end"):
        day_gap = (
            parse_date(current_balance["financial_period_end"])
            - parse_date(prior_balance["financial_period_end"])
        ).days
        if not 300 <= day_gap <= 430:
            data_reasons.append("LIABILITIES_YOY_PERIOD_MISMATCH")

    dividend = dividend_red_flag(
        gaap,
        quarter_ends,
        as_of,
        dividend_payment_status,
    )
    if not dividend["data_complete"]:
        data_reasons.append(dividend["status"])

    if data_reasons:
        return {
            **base,
            "stage": "DATA_INSUFFICIENT",
            "data_complete": False,
            "data_insufficient_reasons": sorted(set(data_reasons)),
            "quality_failures": [],
            "red_flags": [],
            "tags": (
                ["DIVIDEND_CUT_NOT_APPLICABLE_NON_PAYER"]
                if dividend["status"] == "NOT_APPLICABLE_NON_PAYER"
                else []
            ),
            "red_flag_metrics": {"dividend": dividend},
            "financial_periods": {
                "income_statement_latest": (
                    quarter_ends[0] if quarter_ends else None
                ),
                "balance_sheet_current": (
                    current_balance.get("financial_period_end")
                    if current_balance
                    else None
                ),
                "balance_sheet_prior": (
                    prior_balance.get("financial_period_end")
                    if prior_balance
                    else None
                ),
            },
        }

    ttm_net_income = sum(
        net_income[period]["value"] for period in latest_four
    )
    quarterly_net_income = [
        {
            "period": period,
            "value": net_income[period]["value"],
        }
        for period in latest_four
    ]
    ttm_operating_cash_flow = sum(
        operating_cash_flow[period]["value"]
        for period in latest_four
    )
    current_revenue = sum(
        revenue[period]["value"] for period in latest_four
    )
    prior_revenue = sum(
        revenue[period]["value"] for period in prior_four
    )
    current_equity = equity[quarter_ends[0]]["value"]
    prior_equity = equity[quarter_ends[4]]["value"]
    average_equity = (current_equity + prior_equity) / 2
    roe = (
        ttm_net_income / average_equity
        if average_equity > 0
        else None
    )
    leverage_ratio = current_balance.get("ratio")

    metrics = {
        "ttm_net_income": ttm_net_income,
        "quarterly_net_income": quarterly_net_income,
        "ttm_operating_cash_flow": ttm_operating_cash_flow,
        "ttm_revenue": current_revenue,
        "prior_ttm_revenue": prior_revenue,
        "revenue_growth": (
            current_revenue / prior_revenue - 1
            if prior_revenue != 0
            else None
        ),
        "current_equity": current_equity,
        "prior_year_equity": prior_equity,
        "average_equity": average_equity,
        "roe": roe,
        "total_liabilities_to_equity": leverage_ratio,
    }

    quality_failures = []
    if any(point["value"] <= 0 for point in quarterly_net_income):
        quality_failures.append(
            "NET_INCOME_NOT_POSITIVE_IN_EACH_OF_LATEST_4_QUARTERS"
        )
    if ttm_operating_cash_flow <= 0:
        quality_failures.append(
            "TTM_OPERATING_CASH_FLOW_NOT_POSITIVE"
        )
    if ttm_operating_cash_flow < ttm_net_income:
        quality_failures.append(
            "OPERATING_CASH_FLOW_BELOW_NET_INCOME"
        )
    if current_equity <= 0 or current_balance["status"] == (
        "nonpositive_equity_auto_fail"
    ):
        quality_failures.append("NONPOSITIVE_EQUITY_AUTO_FAIL")
    elif average_equity <= 0:
        quality_failures.append(
            "NONPOSITIVE_AVERAGE_EQUITY_AUTO_FAIL"
        )
    elif roe is None or roe < MIN_ROE:
        quality_failures.append("ROE_BELOW_MINIMUM")
    if (
        leverage_ratio is not None
        and leverage_ratio
        > MAX_TOTAL_LIABILITIES_TO_EQUITY
    ):
        quality_failures.append(
            "TOTAL_LIABILITIES_TO_EQUITY_ABOVE_MAXIMUM"
        )
    if current_revenue < prior_revenue:
        quality_failures.append("TTM_REVENUE_BELOW_PRIOR_TTM")

    revenue_yoy_declines = [
        revenue[quarter_ends[index]]["value"]
        < revenue[quarter_ends[index + 4]]["value"]
        for index in range(2)
    ]
    liabilities_growth = (
        current_balance["liabilities"]
        / prior_balance["liabilities"]
        - 1
        if prior_balance["liabilities"] != 0
        else None
    )
    red_flags = []
    if all(revenue_yoy_declines):
        red_flags.append("REVENUE_YOY_DECLINE_TWO_CONSECUTIVE_QUARTERS")
    if (
        liabilities_growth is not None
        and liabilities_growth >= MAX_LIABILITIES_YOY_GROWTH
    ):
        red_flags.append("TOTAL_LIABILITIES_YOY_INCREASE_30PCT")

    latest_period = quarter_ends[0]
    prior_year_period = quarter_ends[4]
    tags = (
        ["DIVIDEND_CUT_NOT_APPLICABLE_NON_PAYER"]
        if dividend["status"] == "NOT_APPLICABLE_NON_PAYER"
        else []
    )
    gross_margin = {
        "status": "GROSS_MARGIN_NOT_EVALUABLE",
        "triggered": False,
        "current": None,
        "prior_year": None,
        "change": None,
    }
    if (
        latest_period in gross_profit
        and prior_year_period in gross_profit
        and revenue[latest_period]["value"] != 0
        and revenue[prior_year_period]["value"] != 0
    ):
        current_margin = (
            gross_profit[latest_period]["value"]
            / revenue[latest_period]["value"]
        )
        prior_margin = (
            gross_profit[prior_year_period]["value"]
            / revenue[prior_year_period]["value"]
        )
        margin_change = current_margin - prior_margin
        gross_triggered = margin_change <= -MAX_GROSS_MARGIN_DROP
        gross_margin = {
            "status": "TRIGGERED" if gross_triggered else "PASS",
            "triggered": gross_triggered,
            "current": current_margin,
            "prior_year": prior_margin,
            "change": margin_change,
        }
        if gross_triggered:
            red_flags.append("GROSS_MARGIN_YOY_DROP_5PCT_POINTS")
    else:
        tags.append("GROSS_MARGIN_NOT_EVALUABLE")

    if dividend["triggered"]:
        red_flags.append("DIVIDEND_CUT_WITHIN_ONE_YEAR")

    stage = (
        "QUALITY_GATE_FAILED"
        if quality_failures
        else "RED_FLAG_FAILED"
        if red_flags
        else "WATCHLIST"
    )
    provenance = {
        "revenue": series_provenance(revenue, quarter_ends),
        "net_income": series_provenance(net_income, latest_four),
        "operating_cash_flow": series_provenance(
            operating_cash_flow, latest_four
        ),
        "equity": series_provenance(
            equity, [quarter_ends[0], quarter_ends[4]]
        ),
        "current_balance_sheet": balance_provenance(current_balance),
        "prior_balance_sheet": balance_provenance(prior_balance),
        "gross_profit": series_provenance(
            gross_profit,
            [latest_period, prior_year_period],
        ),
        "dividend_per_share": dividend.get("provenance", {}),
    }
    return {
        **base,
        "stage": stage,
        "data_complete": True,
        "data_insufficient_reasons": [],
        "quality_failures": quality_failures,
        "red_flags": red_flags,
        "tags": tags,
        "metrics": metrics,
        "red_flag_metrics": {
            "revenue_yoy_declines_latest_two": revenue_yoy_declines,
            "liabilities_yoy_growth": liabilities_growth,
            "gross_margin": gross_margin,
            "dividend": dividend,
        },
        "financial_periods": {
            "income_statement_latest": latest_period,
            "income_statement_oldest": quarter_ends[-1],
            "balance_sheet_current": current_balance[
                "financial_period_end"
            ],
            "balance_sheet_prior": prior_balance[
                "financial_period_end"
            ],
        },
        "provenance": provenance,
    }
