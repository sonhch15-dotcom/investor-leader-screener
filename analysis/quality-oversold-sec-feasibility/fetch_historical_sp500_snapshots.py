from __future__ import annotations

import argparse
import calendar
import gzip
import hashlib
import json
import subprocess
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from io import StringIO
from pathlib import Path
from typing import Any

import pandas as pd


ROOT = Path(__file__).resolve().parent
API_URL = "https://en.wikipedia.org/w/api.php"
PAGE_TITLE = "List of S&P 500 companies"
FORBIDDEN_SECTORS = {"Financials", "Real Estate", "Utilities"}


def git_identity() -> tuple[str, str]:
    name = subprocess.check_output(
        ["git", "config", "--get", "user.name"], text=True
    ).strip()
    email = subprocess.check_output(
        ["git", "config", "--get", "user.email"], text=True
    ).strip()
    if not name or not email:
        raise RuntimeError("Configured git name and email are required")
    return name, email


def request_bytes(url: str, user_agent: str) -> bytes:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": user_agent,
            "Accept": "application/json,text/html",
        },
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def revision_before(month_end: str, user_agent: str) -> dict[str, Any]:
    query = urllib.parse.urlencode(
        {
            "action": "query",
            "format": "json",
            "formatversion": "2",
            "prop": "revisions",
            "titles": PAGE_TITLE,
            "rvprop": "ids|timestamp",
            "rvlimit": "1",
            "rvstart": f"{month_end}T23:59:59Z",
            "rvdir": "older",
        }
    )
    payload = json.loads(request_bytes(f"{API_URL}?{query}", user_agent))
    pages = payload["query"]["pages"]
    revisions = pages[0].get("revisions") or []
    if not revisions:
        raise RuntimeError(f"No Wikipedia revision found before {month_end}")
    return revisions[0]


def normalize_columns(frame: pd.DataFrame) -> pd.DataFrame:
    if isinstance(frame.columns, pd.MultiIndex):
        frame = frame.copy()
        frame.columns = [
            " ".join(
                str(value)
                for value in column
                if value and not str(value).startswith("Unnamed:")
            ).strip()
            for column in frame.columns
        ]
    return frame


def pick_column(columns: list[str], candidates: tuple[str, ...]) -> str:
    normalized = {
        column.lower().replace(" ", ""): column for column in columns
    }
    for candidate in candidates:
        key = candidate.lower().replace(" ", "")
        if key in normalized:
            return normalized[key]
    raise RuntimeError(
        f"Missing required column {candidates}; available={columns}"
    )


def parse_constituents(html: bytes) -> tuple[list[dict[str, Any]], list[str]]:
    frames = pd.read_html(StringIO(html.decode("utf-8")))
    frame: pd.DataFrame | None = None
    for candidate in frames:
        candidate = normalize_columns(candidate)
        columns = [str(column) for column in candidate.columns]
        compact = {column.lower().replace(" ", "") for column in columns}
        if (
            ("symbol" in compact or "tickersymbol" in compact)
            and ("security" in compact or "company" in compact)
            and "gicssector" in compact
        ):
            frame = candidate
            break
    if frame is None:
        raise RuntimeError("Historical constituent table not found")

    columns = [str(column) for column in frame.columns]
    symbol_column = pick_column(columns, ("Symbol", "Ticker symbol"))
    security_column = pick_column(columns, ("Security", "Company"))
    sector_column = pick_column(columns, ("GICS Sector",))
    cik_column = next(
        (
            column
            for column in columns
            if column.lower().replace(" ", "") == "cik"
        ),
        None,
    )

    rows: list[dict[str, Any]] = []
    for record in frame.to_dict(orient="records"):
        symbol = str(record[symbol_column]).strip()
        name = str(record[security_column]).strip()
        sector = str(record[sector_column]).strip()
        raw_cik = str(record[cik_column]).strip() if cik_column else ""
        digits = "".join(character for character in raw_cik if character.isdigit())
        cik = f"{int(digits):010d}" if digits else None
        if not symbol or not name or not sector:
            continue
        rows.append(
            {
                "symbol": symbol,
                "name": name,
                "sector": sector,
                "cik": cik,
                "included_in_quality_universe": (
                    sector not in FORBIDDEN_SECTORS
                ),
            }
        )
    return rows, columns


def fetch_month(
    month: str,
    output_dir: Path,
    user_agent: str,
    pause_seconds: float,
) -> dict[str, Any]:
    year, month_number = (int(value) for value in month.split("-"))
    last_day = calendar.monthrange(year, month_number)[1]
    month_end = f"{year:04d}-{month_number:02d}-{last_day:02d}"
    revision = revision_before(month_end, user_agent)
    time.sleep(pause_seconds)

    revision_id = int(revision["revid"])
    page_url = (
        "https://en.wikipedia.org/w/index.php?"
        + urllib.parse.urlencode(
            {"title": PAGE_TITLE, "oldid": str(revision_id)}
        )
    )
    cache_path = output_dir / "raw" / "wikipedia" / f"{month}-{revision_id}.html.gz"
    if cache_path.exists():
        with gzip.open(cache_path, "rb") as handle:
            html = handle.read()
        source = "cache"
    else:
        html = request_bytes(page_url, user_agent)
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        with gzip.open(cache_path, "wb", compresslevel=9) as handle:
            handle.write(html)
        source = "network"
        time.sleep(pause_seconds)

    constituents, columns = parse_constituents(html)
    ciks_present = sum(row["cik"] is not None for row in constituents)
    return {
        "month": month,
        "month_end": month_end,
        "revision_id": revision_id,
        "revision_timestamp": revision["timestamp"],
        "page_url": page_url,
        "cache_path": str(cache_path),
        "cache_source": source,
        "html_sha256": hashlib.sha256(html).hexdigest(),
        "table_columns": columns,
        "constituent_rows": len(constituents),
        "unique_symbols": len({row["symbol"] for row in constituents}),
        "ciks_present": ciks_present,
        "quality_universe_rows": sum(
            row["included_in_quality_universe"] for row in constituents
        ),
        "constituents": constituents,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    parser.add_argument("--month", action="append")
    parser.add_argument("--start-month")
    parser.add_argument("--end-month")
    parser.add_argument(
        "--output",
        type=Path,
        default=ROOT / "historical_sp500_snapshot_spike.json",
    )
    parser.add_argument("--pause-seconds", type=float, default=0.5)
    return parser


def month_range(start: str, end: str) -> list[str]:
    start_year, start_month = (int(value) for value in start.split("-"))
    end_year, end_month = (int(value) for value in end.split("-"))
    current = (start_year, start_month)
    final = (end_year, end_month)
    if current > final:
        raise ValueError("start-month must not be after end-month")
    months = []
    while current <= final:
        year, month = current
        if not 1 <= month <= 12:
            raise ValueError("Months must use YYYY-MM")
        months.append(f"{year:04d}-{month:02d}")
        current = (year + 1, 1) if month == 12 else (year, month + 1)
    return months


def main() -> None:
    args = build_parser().parse_args()
    if args.month and (args.start_month or args.end_month):
        raise ValueError("Use --month or --start-month/--end-month, not both")
    if args.month:
        months = args.month
    elif args.start_month and args.end_month:
        months = month_range(args.start_month, args.end_month)
    else:
        raise ValueError(
            "Provide --month or both --start-month and --end-month"
        )
    name, email = git_identity()
    user_agent = f"{name} quality-oversold-coverage {email}"
    snapshots = [
        fetch_month(
            month=month,
            output_dir=ROOT,
            user_agent=user_agent,
            pause_seconds=args.pause_seconds,
        )
        for month in months
    ]
    payload = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "source": "Wikipedia monthly historical revisions",
        "prices_accessed": False,
        "returns_calculated": False,
        "snapshots": snapshots,
    }
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "output": str(args.output),
                "snapshots": [
                    {
                        key: snapshot[key]
                        for key in (
                            "month",
                            "revision_id",
                            "revision_timestamp",
                            "constituent_rows",
                            "unique_symbols",
                            "ciks_present",
                            "quality_universe_rows",
                        )
                    }
                    for snapshot in snapshots
                ],
                "prices_accessed": False,
                "returns_calculated": False,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
