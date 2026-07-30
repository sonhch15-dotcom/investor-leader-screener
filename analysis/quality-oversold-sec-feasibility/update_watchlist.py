from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import io
import json
import os
import subprocess
import time
import urllib.request
import zipfile
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from io import StringIO
from pathlib import Path
from collections.abc import Iterator
from typing import Any

import pandas as pd
import yfinance as yf

from analyze_total_liabilities_equity_fsds import (
    resolve_issuer,
    source_complete,
)
from watchlist_core import (
    MAX_FINANCIAL_PERIOD_AGE_DAYS,
    MAX_GROSS_MARGIN_DROP,
    MAX_LIABILITIES_YOY_GROWTH,
    MAX_TOTAL_LIABILITIES_TO_EQUITY,
    MIN_ROE,
    evaluate_issuer,
)


ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
RAW_COMPANYFACTS_DIR = ROOT / "raw" / "watchlist_companyfacts"
CONSTITUENTS_PATH = DATA_DIR / "sp500_constituents.json"
COMPANYFACTS_MANIFEST_PATH = DATA_DIR / "companyfacts_manifest.json"
DIVIDEND_STATUS_PATH = DATA_DIR / "dividend_payment_status.json"
WATCHLIST_PATH = DATA_DIR / "watchlist.json"

WIKIPEDIA_URL = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"
SEC_COMPANYFACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts"
DISCLAIMER = "검증된 성과 우위 없음 · 조사 후보 목록"
EXCLUDED_SECTORS = {"Financials", "Real Estate", "Utilities"}
EXPECTED_SECTORS = 11
MIN_CONSTITUENTS = 490
MAX_CONSTITUENTS = 510
FORMS = {"10-Q", "10-K", "10-Q/A", "10-K/A"}


def yahoo_symbol(symbol: str) -> str:
    return symbol.replace(".", "-")


def atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.tmp")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


def fetch_constituents() -> dict[str, Any]:
    request = urllib.request.Request(
        WIKIPEDIA_URL,
        headers={"User-Agent": "quality-oversold-screener/1.0"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        html = response.read().decode("utf-8")
    tables = pd.read_html(StringIO(html), attrs={"id": "constituents"})
    if len(tables) != 1:
        raise RuntimeError(
            f"Expected one S&P 500 table, found {len(tables)}"
        )
    frame = tables[0]
    required = {"Symbol", "Security", "GICS Sector", "CIK"}
    missing = required - set(frame.columns)
    if missing:
        raise RuntimeError(
            f"Wikipedia constituent columns missing: {sorted(missing)}"
        )
    rows = []
    for source in frame.to_dict(orient="records"):
        symbol = str(source["Symbol"]).strip()
        name = str(source["Security"]).strip()
        sector = str(source["GICS Sector"]).strip()
        try:
            cik = f"{int(source['CIK']):010d}"
        except (TypeError, ValueError):
            cik = None
        rows.append(
            {
                "symbol": symbol,
                "yahoo_ticker": yahoo_symbol(symbol),
                "name": name,
                "sector": sector,
                "cik": cik,
            }
        )
    rows.sort(key=lambda item: item["symbol"])
    validate_constituents(rows)
    payload = {
        "disclaimer": DISCLAIMER,
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "source": WIKIPEDIA_URL,
        "count": len(rows),
        "constituents": rows,
    }
    atomic_write_json(CONSTITUENTS_PATH, payload)
    return payload


def validate_constituents(rows: list[dict[str, Any]]) -> None:
    if not MIN_CONSTITUENTS <= len(rows) <= MAX_CONSTITUENTS:
        raise RuntimeError(
            f"Unexpected S&P 500 security count: {len(rows)}"
        )
    symbols = [row["symbol"] for row in rows]
    if len(symbols) != len(set(symbols)):
        raise RuntimeError("Duplicate S&P 500 symbols")
    sectors = {row["sector"] for row in rows}
    if len(sectors) != EXPECTED_SECTORS:
        raise RuntimeError(
            f"Expected {EXPECTED_SECTORS} GICS sectors, found {len(sectors)}"
        )


def load_constituents(use_cache: bool) -> dict[str, Any]:
    if use_cache:
        payload = json.loads(CONSTITUENTS_PATH.read_text(encoding="utf-8"))
        validate_constituents(payload["constituents"])
        if payload.get("disclaimer") != DISCLAIMER:
            payload = {**payload, "disclaimer": DISCLAIMER}
            atomic_write_json(CONSTITUENTS_PATH, payload)
        return payload
    try:
        return fetch_constituents()
    except Exception:
        if not CONSTITUENTS_PATH.exists():
            raise
        payload = json.loads(CONSTITUENTS_PATH.read_text(encoding="utf-8"))
        validate_constituents(payload["constituents"])
        payload = {
            **payload,
            "disclaimer": DISCLAIMER,
            "load_status": "CACHE_AFTER_NETWORK_ERROR",
        }
        atomic_write_json(CONSTITUENTS_PATH, payload)
        return payload


def lineage_by_successor() -> dict[tuple[str, str], str]:
    path = ROOT / "cik_lineage.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    return {
        (row["symbol"], row["successor_cik"]): row["predecessor_cik"]
        for row in payload["lineages"]
    }


def build_issuers(
    constituents: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    lineage = lineage_by_successor()
    grouped: dict[str, dict[str, Any]] = {}
    for security in constituents:
        key = security["cik"] or f"MISSING_CIK:{security['symbol']}"
        issuer = grouped.setdefault(
            key,
            {
                "issuer_id": key,
                "current_cik": security["cik"],
                "financial_cik": security["cik"],
                "securities": [],
                "sector": security["sector"],
            },
        )
        if issuer["sector"] != security["sector"]:
            raise RuntimeError(
                f"Issuer {key} spans multiple sectors"
            )
        issuer["securities"].append(
            {
                "symbol": security["symbol"],
                "yahoo_ticker": security["yahoo_ticker"],
                "name": security["name"],
            }
        )
    for issuer in grouped.values():
        issuer["securities"].sort(key=lambda row: row["symbol"])
        issuer["symbols"] = [
            security["symbol"] for security in issuer["securities"]
        ]
        issuer["names"] = [
            security["name"] for security in issuer["securities"]
        ]
        for symbol in issuer["symbols"]:
            predecessor = lineage.get((symbol, issuer["current_cik"]))
            if predecessor:
                issuer["financial_cik"] = predecessor
                break
    issuers = sorted(grouped.values(), key=lambda row: row["issuer_id"])
    excluded = [
        row for row in issuers if row["sector"] in EXCLUDED_SECTORS
    ]
    included = [
        row for row in issuers if row["sector"] not in EXCLUDED_SECTORS
    ]
    return included, excluded


def git_value(key: str) -> str | None:
    result = subprocess.run(
        ["git", "config", "--get", key],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    value = result.stdout.strip()
    return value or None


def sec_user_agent() -> str:
    configured = os.environ.get("SEC_USER_AGENT")
    if configured:
        return configured
    name = git_value("user.name") or "quality-oversold-screener"
    email = git_value("user.email") or "research@example.invalid"
    return f"{name} quality-oversold-screener {email}"


def fetch_companyfacts_bytes(cik: str, user_agent: str) -> bytes:
    url = f"{SEC_COMPANYFACTS_URL}/CIK{cik}.json"
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": user_agent,
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def load_companyfacts(
    issuers: list[dict[str, Any]],
    *,
    use_cache: bool,
    pause_seconds: float,
) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    RAW_COMPANYFACTS_DIR.mkdir(parents=True, exist_ok=True)
    user_agent = sec_user_agent()
    facts_by_issuer = {}
    manifest_rows = []
    for index, issuer in enumerate(issuers, start=1):
        cik = issuer["financial_cik"]
        if not cik:
            manifest_rows.append(
                {
                    "issuer_id": issuer["issuer_id"],
                    "symbols": issuer["symbols"],
                    "financial_cik": None,
                    "status": "CIK_MISSING",
                }
            )
            continue
        path = RAW_COMPANYFACTS_DIR / f"CIK{cik}.json.gz"
        source = None
        error = None
        raw = None
        if use_cache and path.exists():
            with gzip.open(path, "rb") as handle:
                raw = handle.read()
            source = "cache"
        else:
            try:
                raw = fetch_companyfacts_bytes(cik, user_agent)
                with gzip.open(path, "wb", compresslevel=9) as handle:
                    handle.write(raw)
                source = "network"
            except Exception as exception:
                error = f"{type(exception).__name__}: {exception}"
                if path.exists():
                    with gzip.open(path, "rb") as handle:
                        raw = handle.read()
                    source = "cache_after_network_error"
            if index < len(issuers):
                time.sleep(pause_seconds)
        if raw is not None:
            facts_by_issuer[issuer["issuer_id"]] = json.loads(
                raw.decode("utf-8")
            )
        manifest_rows.append(
            {
                "issuer_id": issuer["issuer_id"],
                "symbols": issuer["symbols"],
                "financial_cik": cik,
                "status": "AVAILABLE" if raw is not None else "UNAVAILABLE",
                "source": source,
                "error": error,
                "path": str(path.relative_to(ROOT)),
                "url": f"{SEC_COMPANYFACTS_URL}/CIK{cik}.json",
                "sha256_uncompressed": (
                    hashlib.sha256(raw).hexdigest()
                    if raw is not None
                    else None
                ),
            }
        )
        if index == 1 or index % 25 == 0 or index == len(issuers):
            print(
                f"[companyfacts] {index}/{len(issuers)} "
                f"{','.join(issuer['symbols'])} {source or 'unavailable'}",
                flush=True,
            )
    manifest = {
        "disclaimer": DISCLAIMER,
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "source": SEC_COMPANYFACTS_URL,
        "request_pause_seconds": pause_seconds,
        "issuers": manifest_rows,
    }
    atomic_write_json(COMPANYFACTS_MANIFEST_PATH, manifest)
    return facts_by_issuer, manifest


def ticker_frame(
    frame: pd.DataFrame,
    ticker: str,
    ticker_count: int,
) -> pd.DataFrame | None:
    if isinstance(frame.columns, pd.MultiIndex):
        if ticker not in frame.columns.get_level_values(0):
            return None
        return frame[ticker]
    return frame if ticker_count == 1 else None


def fetch_dividend_payment_status(
    issuers: list[dict[str, Any]],
    as_of: date,
) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    trailing_start = as_of - timedelta(days=365)
    tickers = sorted(
        {
            security["yahoo_ticker"]
            for issuer in issuers
            for security in issuer["securities"]
        }
    )
    frame = yf.download(
        tickers,
        start=trailing_start.isoformat(),
        end=(as_of + timedelta(days=1)).isoformat(),
        actions=True,
        auto_adjust=False,
        progress=False,
        threads=True,
        group_by="ticker",
    )
    statuses: dict[str, dict[str, Any]] = {}
    rows = []
    for issuer in issuers:
        payments = []
        price_observations = 0
        securities = []
        for security in issuer["securities"]:
            ticker = security["yahoo_ticker"]
            security_frame = ticker_frame(frame, ticker, len(tickers))
            observations = 0
            security_payments = []
            if security_frame is not None:
                if "Close" in security_frame:
                    observations = int(
                        security_frame["Close"].notna().sum()
                    )
                if "Dividends" in security_frame:
                    security_payments = [
                        {
                            "date": index.date().isoformat(),
                            "amount": float(value),
                        }
                        for index, value in security_frame[
                            "Dividends"
                        ].dropna().items()
                        if float(value) > 0
                    ]
            price_observations += observations
            payments.extend(
                {
                    **payment,
                    "ticker": ticker,
                }
                for payment in security_payments
            )
            securities.append(
                {
                    "symbol": security["symbol"],
                    "yahoo_ticker": ticker,
                    "price_observations": observations,
                    "payments": security_payments,
                }
            )
        payments.sort(
            key=lambda row: (row["date"], row["ticker"], row["amount"])
        )
        classification = (
            "CURRENT_PAYER"
            if payments
            else "NO_DIVIDEND_PAYMENT_TRAILING_365D"
            if price_observations
            else "MARKET_DATA_UNAVAILABLE"
        )
        status = {
            "issuer_id": issuer["issuer_id"],
            "symbols": issuer["symbols"],
            "classification": classification,
            "trailing_start": trailing_start.isoformat(),
            "as_of_date": as_of.isoformat(),
            "price_observations": price_observations,
            "payments": payments,
            "securities": securities,
            "source": "Yahoo Finance via yfinance",
        }
        statuses[issuer["issuer_id"]] = status
        rows.append(status)
    payload = {
        "disclaimer": DISCLAIMER,
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "source": "Yahoo Finance via yfinance",
        "purpose": (
            "Classify current dividend payer status only; SEC facts "
            "remain the dividend-cut test source"
        ),
        "as_of_date": as_of.isoformat(),
        "trailing_start": trailing_start.isoformat(),
        "classification_counts": dict(
            sorted(Counter(row["classification"] for row in rows).items())
        ),
        "issuers": rows,
    }
    atomic_write_json(DIVIDEND_STATUS_PATH, payload)
    return statuses, payload


def load_dividend_payment_status(
    issuers: list[dict[str, Any]],
    as_of: date,
    *,
    use_cache: bool,
) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    if not use_cache:
        return fetch_dividend_payment_status(issuers, as_of)
    payload = json.loads(
        DIVIDEND_STATUS_PATH.read_text(encoding="utf-8")
    )
    if payload["as_of_date"] != as_of.isoformat():
        raise RuntimeError(
            "Cached dividend payer status does not match --as-of"
        )
    statuses = {
        row["issuer_id"]: row for row in payload["issuers"]
    }
    expected = {issuer["issuer_id"] for issuer in issuers}
    if set(statuses) != expected:
        raise RuntimeError(
            "Cached dividend payer status issuer set changed"
        )
    return statuses, payload


def text_rows(
    archive: zipfile.ZipFile, name: str
) -> Iterator[dict[str, str]]:
    with archive.open(name) as binary:
        text = io.TextIOWrapper(binary, encoding="utf-8", newline="")
        yield from csv.DictReader(text, delimiter="\t")


def selected_submissions(
    rows: Iterator[dict[str, str]],
    ciks: set[str],
) -> dict[str, dict[str, str]]:
    selected = {}
    for row in rows:
        cik = f"{int(row['cik']):010d}"
        if cik not in ciks or row["form"] not in FORMS:
            continue
        current = selected.get(cik)
        rank = (row["filed"], row["adsh"])
        current_rank = (
            (current["filed"], current["adsh"])
            if current
            else ("", "")
        )
        if current is None or rank > current_rank:
            selected[cik] = row
    return selected


def extract_balance_rows(
    zip_path: Path,
    dataset_quarter: str,
    issuers: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    by_financial_cik = {
        issuer["financial_cik"]: issuer
        for issuer in issuers
        if issuer["financial_cik"]
    }
    with zipfile.ZipFile(zip_path) as archive:
        submissions = selected_submissions(
            text_rows(archive, "sub.txt"),
            set(by_financial_cik),
        )
        accession_to_cik = {
            row["adsh"]: cik for cik, row in submissions.items()
        }
        presentation: dict[str, list[dict[str, str]]] = defaultdict(list)
        needed_tags: dict[str, set[tuple[str, str]]] = defaultdict(set)
        for row in text_rows(archive, "pre.txt"):
            if (
                row["adsh"] not in accession_to_cik
                or row["stmt"] != "BS"
                or row["inpth"] != "0"
            ):
                continue
            presentation[row["adsh"]].append(row)
            needed_tags[row["adsh"]].add((row["tag"], row["version"]))

        facts: dict[
            tuple[str, str, str, str], list[dict[str, str]]
        ] = defaultdict(list)
        for row in text_rows(archive, "num.txt"):
            accession = row["adsh"]
            if (
                accession not in accession_to_cik
                or row["qtrs"] != "0"
                or row["uom"] != "USD"
                or row["coreg"]
                or not row["value"]
                or (row["tag"], row["version"])
                not in needed_tags[accession]
            ):
                continue
            facts[
                (
                    accession,
                    row["tag"],
                    row["version"],
                    row["ddate"],
                )
            ].append(row)

    extracted = {}
    for cik, submission in submissions.items():
        issuer = by_financial_cik[cik]
        accession = submission["adsh"]
        period = submission["period"]
        lines = []
        for row in sorted(
            presentation[accession], key=lambda item: int(item["line"])
        ):
            values = facts.get(
                (accession, row["tag"], row["version"], period), []
            )
            if not values:
                continue
            lines.append(
                {
                    "line": int(row["line"]),
                    "tag": row["tag"],
                    "version": row["version"],
                    "label": row["plabel"],
                    "values": [
                        {
                            "value": float(value["value"]),
                            "segments": value["segments"],
                            "footnote": value["footnote"],
                        }
                        for value in values
                    ],
                }
            )
        resolved = resolve_issuer(
            {
                "balance_sheet_lines": lines,
            }
        )
        status = resolved["status"]
        is_resolved = status in {
            "ratio_available",
            "nonpositive_equity_auto_fail",
        }
        provenance_complete = bool(
            is_resolved
            and submission["filed"]
            and accession
            and source_complete(resolved.get("liabilities"))
            and source_complete(resolved.get("equity"))
        )
        extracted[issuer["issuer_id"]] = {
            "dataset_quarter": dataset_quarter,
            "status": status,
            "resolved": is_resolved,
            "provenance_complete": provenance_complete,
            "ratio": resolved.get("ratio"),
            "liabilities": (
                resolved.get("liabilities") or {}
            ).get("value"),
            "equity": (resolved.get("equity") or {}).get("value"),
            "formula": resolved.get("formula"),
            "financial_period_end": (
                f"{period[:4]}-{period[4:6]}-{period[6:]}"
            ),
            "filed": (
                f"{submission['filed'][:4]}-{submission['filed'][4:6]}-"
                f"{submission['filed'][6:]}"
            ),
            "accession": accession,
            "form": submission["form"],
        }
    return extracted


def reason_counts(
    rows: list[dict[str, Any]], field: str
) -> dict[str, int]:
    return dict(
        sorted(
            Counter(
                reason
                for row in rows
                for reason in row.get(field, [])
            ).items()
        )
    )


def freshness_summary(
    rows: list[dict[str, Any]],
    current_quarter: str,
) -> dict[str, Any]:
    def period_bounds(
        selected: list[dict[str, Any]], field: str
    ) -> dict[str, Any]:
        periods = [
            row.get("financial_periods", {}).get(field)
            for row in selected
            if row.get("financial_periods", {}).get(field)
        ]
        return {
            "issuer_count": len(periods),
            "min": min(periods) if periods else None,
            "max": max(periods) if periods else None,
        }

    data_complete = [row for row in rows if row["data_complete"]]
    watchlist = [row for row in rows if row["stage"] == "WATCHLIST"]
    return {
        "sec_fsds_latest_filing_quarter": current_quarter,
        "all_evaluated_issuers": {
            "income_statement_latest": period_bounds(
                rows, "income_statement_latest"
            ),
            "balance_sheet_current": period_bounds(
                rows, "balance_sheet_current"
            ),
        },
        "data_complete_issuers": {
            "income_statement_latest": period_bounds(
                data_complete, "income_statement_latest"
            ),
            "balance_sheet_current": period_bounds(
                data_complete, "balance_sheet_current"
            ),
        },
        "watchlist_issuers": {
            "income_statement_latest": period_bounds(
                watchlist, "income_statement_latest"
            ),
            "balance_sheet_current": period_bounds(
                watchlist, "balance_sheet_current"
            ),
        },
    }


def validate_payload(payload: dict[str, Any]) -> None:
    if payload["disclaimer"] != DISCLAIMER:
        raise RuntimeError("Missing mandatory performance disclaimer")
    if (
        payload["thresholds"]["max_total_liabilities_to_equity"]
        != MAX_TOTAL_LIABILITIES_TO_EQUITY
    ):
        raise RuntimeError("Preregistered leverage threshold changed")

    funnel = payload["funnel"]
    results = payload["audit"]["issuer_results"]
    stage_counts = Counter(row["stage"] for row in results)
    if len(results) != funnel["sector_included_issuers"]:
        raise RuntimeError("Issuer audit does not match included funnel")
    if sum(stage_counts.values()) != funnel["sector_included_issuers"]:
        raise RuntimeError("Issuer stages do not reconcile")
    if (
        funnel["data_complete_issuers"]
        != len(results) - stage_counts["DATA_INSUFFICIENT"]
    ):
        raise RuntimeError("Data-complete funnel does not reconcile")
    if funnel["quality_gate_pass_issuers"] != (
        stage_counts["RED_FLAG_FAILED"] + stage_counts["WATCHLIST"]
    ):
        raise RuntimeError("Quality-gate funnel does not reconcile")
    if funnel["watchlist_issuers"] != stage_counts["WATCHLIST"]:
        raise RuntimeError("Watchlist issuer funnel does not reconcile")

    issuer_ids = [row["issuer_id"] for row in results]
    if len(issuer_ids) != len(set(issuer_ids)):
        raise RuntimeError("Duplicate issuer audit rows")

    watchlist = payload["watchlist"]
    symbols = [row["symbol"] for row in watchlist]
    if len(symbols) != len(set(symbols)):
        raise RuntimeError("Duplicate watchlist symbols")
    if len(watchlist) != funnel["watchlist_securities"]:
        raise RuntimeError("Watchlist security funnel does not reconcile")

    required_series = (
        "revenue",
        "net_income",
        "operating_cash_flow",
        "equity",
    )
    required_balances = (
        "current_balance_sheet",
        "prior_balance_sheet",
    )
    for row in watchlist:
        if row["sector"] in EXCLUDED_SECTORS:
            raise RuntimeError(
                f"Excluded sector reached watchlist: {row['symbol']}"
            )
        if row["roe"] is None or row[
            "total_liabilities_to_equity"
        ] is None:
            raise RuntimeError(
                f"Required watchlist metric missing: {row['symbol']}"
            )
        for field in required_series:
            provenance = row["provenance"][field]
            if not provenance.get("latest_filed") or not provenance.get(
                "accessions"
            ):
                raise RuntimeError(
                    f"{field} provenance missing: {row['symbol']}"
                )
        for field in required_balances:
            provenance = row["provenance"][field]
            if not provenance.get("filed") or not provenance.get(
                "accession"
            ):
                raise RuntimeError(
                    f"{field} provenance missing: {row['symbol']}"
                )


def build_payload(
    *,
    as_of: date,
    constituents: dict[str, Any],
    included_issuers: list[dict[str, Any]],
    excluded_issuers: list[dict[str, Any]],
    evaluations: list[dict[str, Any]],
    companyfacts_manifest: dict[str, Any],
    dividend_status_manifest: dict[str, Any],
    current_fsds: Path,
    prior_fsds: Path,
    current_quarter: str,
    prior_quarter: str,
) -> dict[str, Any]:
    data_complete = [
        row for row in evaluations if row["data_complete"]
    ]
    quality_pass = [
        row
        for row in evaluations
        if row["stage"] in {"RED_FLAG_FAILED", "WATCHLIST"}
    ]
    watchlist_issuers = [
        row for row in evaluations if row["stage"] == "WATCHLIST"
    ]
    red_flag_exclusions = [
        row for row in evaluations if row["stage"] == "RED_FLAG_FAILED"
    ]
    watchlist = []
    for row in watchlist_issuers:
        for security in row["securities"]:
            watchlist.append(
                {
                    "symbol": security["symbol"],
                    "yahoo_ticker": security["yahoo_ticker"],
                    "name": security["name"],
                    "sector": row["sector"],
                    "cik": row["cik"],
                    "financial_cik": row["financial_cik"],
                    "roe": row["metrics"]["roe"],
                    "total_liabilities_to_equity": row["metrics"][
                        "total_liabilities_to_equity"
                    ],
                    "metrics": row["metrics"],
                    "tags": row["tags"],
                    "red_flag_metrics": row["red_flag_metrics"],
                    "financial_periods": row["financial_periods"],
                    "provenance": row["provenance"],
                }
            )
    watchlist.sort(key=lambda item: item["symbol"])

    nonpositive = [
        {
            "symbols": row["symbols"],
            "names": row["names"],
            "sector": row["sector"],
            "financial_periods": row.get("financial_periods", {}),
            "reason": "NONPOSITIVE_EQUITY_AUTO_FAIL",
        }
        for row in evaluations
        if "NONPOSITIVE_EQUITY_AUTO_FAIL"
        in row.get("quality_failures", [])
    ]
    watchlist_sector_counts = dict(
        sorted(Counter(row["sector"] for row in watchlist).items())
    )
    gross_margin_not_evaluable_watchlist = sum(
        "GROSS_MARGIN_NOT_EVALUABLE" in row.get("tags", [])
        for row in watchlist
    )
    dividend_market_by_issuer = {
        row["issuer_id"]: row["classification"]
        for row in dividend_status_manifest["issuers"]
    }
    dividend_assessment_counts = Counter()
    dividend_cross_counts = Counter()
    for row in evaluations:
        dividend = (row.get("red_flag_metrics") or {}).get(
            "dividend", {}
        )
        assessment = dividend.get(
            "status", "NOT_EVALUATED_UPSTREAM_DATA_UNAVAILABLE"
        )
        market = dividend_market_by_issuer[row["issuer_id"]]
        dividend_assessment_counts[assessment] += 1
        dividend_cross_counts[(assessment, market)] += 1
    funnel = {
        "constituent_securities": constituents["count"],
        "unique_issuers": len(included_issuers) + len(excluded_issuers),
        "sector_excluded_issuers": len(excluded_issuers),
        "sector_included_issuers": len(included_issuers),
        "data_complete_issuers": len(data_complete),
        "quality_gate_pass_issuers": len(quality_pass),
        "red_flag_pass_issuers": len(watchlist_issuers),
        "watchlist_issuers": len(watchlist_issuers),
        "watchlist_securities": len(watchlist),
    }
    return {
        "disclaimer": DISCLAIMER,
        "strategy_status": "FORWARD_TEST_ONLY_UNVALIDATED",
        "backtest_status": (
            "INVALID: evaluation financial coverage and legacy price "
            "coverage gates failed"
        ),
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "as_of_date": as_of.isoformat(),
        "thresholds": {
            "min_roe": MIN_ROE,
            "max_total_liabilities_to_equity": (
                MAX_TOTAL_LIABILITIES_TO_EQUITY
            ),
            "max_liabilities_yoy_growth": (
                MAX_LIABILITIES_YOY_GROWTH
            ),
            "max_gross_margin_drop": MAX_GROSS_MARGIN_DROP,
            "max_financial_period_age_days": (
                MAX_FINANCIAL_PERIOD_AGE_DAYS
            ),
            "excluded_sectors": sorted(EXCLUDED_SECTORS),
            "threshold_policy": (
                "preregistered; not adjusted for watchlist size"
            ),
        },
        "sources": {
            "constituents": {
                "source": constituents["source"],
                "generated_at_utc": constituents["generated_at_utc"],
                "load_status": constituents.get(
                    "load_status", "NETWORK"
                ),
                "path": str(CONSTITUENTS_PATH.relative_to(ROOT)),
            },
            "companyfacts": {
                "source": companyfacts_manifest["source"],
                "generated_at_utc": companyfacts_manifest[
                    "generated_at_utc"
                ],
                "path": str(
                    COMPANYFACTS_MANIFEST_PATH.relative_to(ROOT)
                ),
            },
            "dividend_payer_status": {
                "source": dividend_status_manifest["source"],
                "purpose": dividend_status_manifest["purpose"],
                "as_of_date": dividend_status_manifest["as_of_date"],
                "trailing_start": dividend_status_manifest[
                    "trailing_start"
                ],
                "path": str(DIVIDEND_STATUS_PATH.relative_to(ROOT)),
            },
            "current_balance_sheets": {
                "dataset_quarter": current_quarter,
                "path": str(current_fsds.relative_to(ROOT)),
            },
            "prior_balance_sheets": {
                "dataset_quarter": prior_quarter,
                "path": str(prior_fsds.relative_to(ROOT)),
            },
        },
        "financial_data_freshness": freshness_summary(
            evaluations, current_quarter
        ),
        "funnel": funnel,
        "reason_counts": {
            "sector_excluded": dict(
                sorted(Counter(row["sector"] for row in excluded_issuers).items())
            ),
            "data_insufficient": reason_counts(
                evaluations, "data_insufficient_reasons"
            ),
            "quality_gate_failures": reason_counts(
                evaluations, "quality_failures"
            ),
            "red_flag_exclusions": reason_counts(
                red_flag_exclusions, "red_flags"
            ),
            "red_flags_observed_all_data_complete": reason_counts(
                data_complete, "red_flags"
            ),
            "gross_margin_not_evaluable": sum(
                "GROSS_MARGIN_NOT_EVALUABLE" in row.get("tags", [])
                for row in evaluations
            ),
            "dividend_payer_status": dividend_status_manifest[
                "classification_counts"
            ],
            "dividend_assessment": dict(
                sorted(dividend_assessment_counts.items())
            ),
            "dividend_assessment_by_payer_status": [
                {
                    "dividend_assessment": key[0],
                    "payer_status": key[1],
                    "issuer_count": count,
                }
                for key, count in sorted(dividend_cross_counts.items())
            ],
        },
        "known_limitations": [
            {
                "code": "BUYBACK_INTENSIVE_COMPANY_EXCLUSION_RISK",
                "description": (
                    "총부채/자기자본 게이트와 자기자본 0 이하 자동 "
                    "미통과 규칙은 장기간 자사주 매입으로 장부 "
                    "자기자본이 낮아진 우량기업도 체계적으로 제외할 "
                    "수 있다. 사전등록 규칙이므로 임계값은 조정하지 "
                    "않는다."
                ),
                "nonpositive_equity_auto_fail_issuers": len(nonpositive),
            },
            {
                "code": "GROSS_MARGIN_RED_FLAG_PARTIAL_COVERAGE",
                "description": (
                    "매출총이익률 적신호는 평가 불가 종목에 적용되지 "
                    "않으므로 감시목록 전체에 동일하게 작동하지 않는다."
                ),
                "watchlist_not_evaluable_securities": (
                    gross_margin_not_evaluable_watchlist
                ),
                "watchlist_securities": len(watchlist),
                "share": (
                    gross_margin_not_evaluable_watchlist / len(watchlist)
                    if watchlist
                    else None
                ),
            },
            {
                "code": "SECTOR_CONCENTRATION",
                "description": (
                    "ROE 등 품질 게이트 때문에 감시목록이 고마진 "
                    "업종에 집중될 수 있다. 현재 분포를 기록하되 "
                    "조건은 조정하지 않는다."
                ),
                "watchlist_security_counts": watchlist_sector_counts,
            },
        ],
        "nonpositive_equity_auto_fail": nonpositive,
        "watchlist": watchlist,
        "audit": {
            "grain": "one row per issuer after share-class collapse",
            "issuer_results": evaluations,
            "excluded_sector_issuers": excluded_issuers,
        },
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="분기 품질 감시 목록 갱신"
    )
    parser.add_argument(
        "--as-of",
        type=date.fromisoformat,
        default=date.today(),
    )
    parser.add_argument(
        "--use-cached-constituents",
        action="store_true",
    )
    parser.add_argument(
        "--use-cached-companyfacts",
        action="store_true",
    )
    parser.add_argument(
        "--use-cached-dividends",
        action="store_true",
    )
    parser.add_argument(
        "--pause-seconds",
        type=float,
        default=0.25,
    )
    parser.add_argument(
        "--current-fsds",
        type=Path,
        default=ROOT / "raw" / "sec_fsds" / "2026q1.zip",
    )
    parser.add_argument(
        "--prior-fsds",
        type=Path,
        default=ROOT / "raw" / "sec_fsds" / "2025q1.zip",
    )
    parser.add_argument(
        "--current-fsds-quarter",
        default="2026 Q1",
    )
    parser.add_argument(
        "--prior-fsds-quarter",
        default="2025 Q1",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=WATCHLIST_PATH,
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    print(DISCLAIMER, flush=True)
    constituents = load_constituents(args.use_cached_constituents)
    included, excluded = build_issuers(constituents["constituents"])
    companyfacts, companyfacts_manifest = load_companyfacts(
        included,
        use_cache=args.use_cached_companyfacts,
        pause_seconds=args.pause_seconds,
    )
    dividend_statuses, dividend_status_manifest = (
        load_dividend_payment_status(
            included,
            args.as_of,
            use_cache=args.use_cached_dividends,
        )
    )
    current_balances = extract_balance_rows(
        args.current_fsds,
        args.current_fsds_quarter,
        included,
    )
    prior_balances = extract_balance_rows(
        args.prior_fsds,
        args.prior_fsds_quarter,
        included,
    )
    evaluations = [
        evaluate_issuer(
            issuer,
            companyfacts.get(issuer["issuer_id"]),
            current_balances.get(issuer["issuer_id"]),
            prior_balances.get(issuer["issuer_id"]),
            args.as_of,
            dividend_statuses.get(issuer["issuer_id"]),
        )
        for issuer in included
    ]
    payload = build_payload(
        as_of=args.as_of,
        constituents=constituents,
        included_issuers=included,
        excluded_issuers=excluded,
        evaluations=evaluations,
        companyfacts_manifest=companyfacts_manifest,
        dividend_status_manifest=dividend_status_manifest,
        current_fsds=args.current_fsds,
        prior_fsds=args.prior_fsds,
        current_quarter=args.current_fsds_quarter,
        prior_quarter=args.prior_fsds_quarter,
    )
    validate_payload(payload)
    atomic_write_json(args.output, payload)
    print(
        json.dumps(
            {
                "disclaimer": DISCLAIMER,
                "output": str(args.output),
                "funnel": payload["funnel"],
                "reason_counts": payload["reason_counts"],
                "financial_data_freshness": payload[
                    "financial_data_freshness"
                ],
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
