from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import subprocess
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SYMBOLS = ["AAPL", "MSFT", "GOOGL", "HD", "JNJ", "PG", "COST", "CAT", "XOM", "LIN"]
PREDECESSOR_CIKS = {"XOM": ["0000034088"]}
BASE_URL = "https://data.sec.gov"
TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"


def git_identity() -> tuple[str, str]:
    name = subprocess.check_output(
        ["git", "config", "--get", "user.name"], text=True
    ).strip()
    email = subprocess.check_output(
        ["git", "config", "--get", "user.email"], text=True
    ).strip()
    if not name or not email:
        raise RuntimeError(
            "SEC fair-access User-Agent requires configured git user.name and user.email"
        )
    return name, email


def fetch_json(url: str, user_agent: str, timeout: int = 30) -> tuple[dict[str, Any], bytes]:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": user_agent,
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        raw = response.read()
    return json.loads(raw.decode("utf-8")), raw


def save_gzip_json(path: Path, raw: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wb", compresslevel=9) as handle:
        handle.write(raw)


def load_gzip_bytes(path: Path) -> bytes:
    with gzip.open(path, "rb") as handle:
        return handle.read()


def cache_json(
    *,
    url: str,
    path: Path,
    user_agent: str,
    refresh: bool,
    pause_seconds: float,
) -> tuple[dict[str, Any], dict[str, Any]]:
    if path.exists() and not refresh:
        raw = load_gzip_bytes(path)
        data = json.loads(raw.decode("utf-8"))
        source = "cache"
    else:
        data, raw = fetch_json(url, user_agent)
        save_gzip_json(path, raw)
        source = "network"
        time.sleep(pause_seconds)
    return data, {
        "url": url,
        "path": str(path),
        "source": source,
        "sha256_uncompressed": hashlib.sha256(raw).hexdigest(),
        "bytes_uncompressed": len(raw),
    }


def ticker_map(payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        row["ticker"].upper(): row
        for row in payload.values()
        if isinstance(row, dict) and row.get("ticker")
    }


def run(
    output_dir: Path,
    refresh: bool,
    pause_seconds: float,
) -> dict[str, Any]:
    name, email = git_identity()
    user_agent = f"{name} quality-oversold-sec-feasibility {email}"
    raw_dir = output_dir / "raw"

    tickers, tickers_meta = cache_json(
        url=TICKERS_URL,
        path=raw_dir / "company_tickers.json.gz",
        user_agent=user_agent,
        refresh=refresh,
        pause_seconds=pause_seconds,
    )
    by_symbol = ticker_map(tickers)

    manifest_rows: list[dict[str, Any]] = [tickers_meta]
    companies: list[dict[str, Any]] = []
    for symbol in SYMBOLS:
        if symbol not in by_symbol:
            raise RuntimeError(f"SEC ticker mapping missing: {symbol}")
        mapping = by_symbol[symbol]
        cik = int(mapping["cik_str"])
        cik_padded = f"{cik:010d}"
        print(f"[sec] {symbol} CIK{cik_padded}", flush=True)
        registrants: list[dict[str, Any]] = []
        ciks = [cik_padded, *PREDECESSOR_CIKS.get(symbol, [])]
        for index, registrant_cik in enumerate(ciks):
            role = "current" if index == 0 else "predecessor"
            if role == "predecessor":
                print(
                    f"[sec] {symbol} predecessor CIK{registrant_cik}",
                    flush=True,
                )

            facts_url = (
                f"{BASE_URL}/api/xbrl/companyfacts/CIK{registrant_cik}.json"
            )
            facts_path = (
                raw_dir / f"CIK{registrant_cik}-companyfacts.json.gz"
            )
            facts, facts_meta = cache_json(
                url=facts_url,
                path=facts_path,
                user_agent=user_agent,
                refresh=refresh,
                pause_seconds=pause_seconds,
            )
            manifest_rows.append(facts_meta)

            submissions_url = (
                f"{BASE_URL}/submissions/CIK{registrant_cik}.json"
            )
            submissions_path = (
                raw_dir / f"CIK{registrant_cik}-submissions.json.gz"
            )
            submissions, submissions_meta = cache_json(
                url=submissions_url,
                path=submissions_path,
                user_agent=user_agent,
                refresh=refresh,
                pause_seconds=pause_seconds,
            )
            manifest_rows.append(submissions_meta)

            registrants.append(
                {
                    "role": role,
                    "cik": registrant_cik,
                    "entity_name": facts.get("entityName"),
                    "taxonomies": sorted((facts.get("facts") or {}).keys()),
                    "companyfacts_path": str(facts_path),
                    "submissions_path": str(submissions_path),
                    "recent_submission_count": len(
                        ((submissions.get("filings") or {}).get("recent") or {}).get(
                            "accessionNumber", []
                        )
                    ),
                }
            )

        companies.append(
            {
                "symbol": symbol,
                "current_cik": cik_padded,
                "sec_title": mapping.get("title"),
                "registrants": registrants,
            }
        )

    output_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "sec_api_docs": "https://www.sec.gov/search-filings/edgar-application-programming-interfaces",
        "fair_access_docs": "https://www.sec.gov/about/developer-resources",
        "request_rate_limit_observed": f"{1 / pause_seconds:.2f} requests/sec maximum"
        if pause_seconds > 0
        else "no pause",
        "symbols": SYMBOLS,
        "companies": companies,
        "files": manifest_rows,
    }
    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return payload


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("analysis/quality-oversold-sec-feasibility"),
    )
    parser.add_argument("--refresh", action="store_true")
    parser.add_argument("--pause-seconds", type=float, default=0.25)
    args = parser.parse_args()
    payload = run(args.output_dir, args.refresh, args.pause_seconds)
    print(
        json.dumps(
            {
                "generated_at_utc": payload["generated_at_utc"],
                "companies": payload["companies"],
                "request_rate_limit_observed": payload[
                    "request_rate_limit_observed"
                ],
            },
            ensure_ascii=True,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
