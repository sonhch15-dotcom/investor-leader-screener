from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import time
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from fetch_sec import git_identity


ROOT = Path(__file__).resolve().parent
AS_OF = date(2026, 7, 29)
DEFAULT_SYMBOLS = ["CAT"]


def load_gzip_json(path: Path) -> dict[str, Any]:
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        return json.load(handle)


def latest_periodic_filings(
    submissions: dict[str, Any],
    periods: int,
) -> list[dict[str, str]]:
    recent = submissions["filings"]["recent"]
    rows = []
    for index, form in enumerate(recent["form"]):
        filed = recent["filingDate"][index]
        if form not in {"10-Q", "10-K", "10-Q/A", "10-K/A"}:
            continue
        if date.fromisoformat(filed) > AS_OF:
            continue
        rows.append(
            {
                "form": form,
                "filed": filed,
                "report_date": recent["reportDate"][index],
                "accession": recent["accessionNumber"][index],
                "primary_document": recent["primaryDocument"][index],
            }
        )
    if not rows:
        raise RuntimeError("No periodic filing found before as-of date")
    by_report_date: dict[str, dict[str, str]] = {}
    for row in rows:
        current = by_report_date.get(row["report_date"])
        if current is None or (row["filed"], row["accession"]) > (
            current["filed"],
            current["accession"],
        ):
            by_report_date[row["report_date"]] = row
    return sorted(
        by_report_date.values(),
        key=lambda row: (row["report_date"], row["filed"]),
        reverse=True,
    )[:periods]


def financial_registrant(company: dict[str, Any]) -> dict[str, Any]:
    return next(
        (
            item
            for item in company["registrants"]
            if "us-gaap" in item["taxonomies"]
        ),
        company["registrants"][0],
    )


def fetch_bytes(url: str, user_agent: str) -> bytes:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": user_agent,
            "Accept": "text/html,application/xhtml+xml",
        },
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def run(
    symbols: list[str],
    periods: int,
    refresh: bool,
    pause_seconds: float,
) -> dict[str, Any]:
    name, email = git_identity()
    user_agent = f"{name} quality-oversold-inline-xbrl {email}"
    manifest = json.loads(
        (ROOT / "manifest.json").read_text(encoding="utf-8")
    )
    companies = {
        company["symbol"]: company for company in manifest["companies"]
    }
    output_dir = ROOT / "raw" / "filings"
    output_dir.mkdir(parents=True, exist_ok=True)
    rows = []

    for symbol in symbols:
        if symbol not in companies:
            raise RuntimeError(f"Unknown spike symbol: {symbol}")
        registrant = financial_registrant(companies[symbol])
        submissions = load_gzip_json(Path(registrant["submissions_path"]))
        for filing in latest_periodic_filings(submissions, periods):
            accession_compact = filing["accession"].replace("-", "")
            cik_unpadded = str(int(registrant["cik"]))
            url = (
                "https://www.sec.gov/Archives/edgar/data/"
                f"{cik_unpadded}/{accession_compact}/"
                f"{filing['primary_document']}"
            )
            output_path = output_dir / (
                f"CIK{registrant['cik']}-{filing['accession']}-"
                f"{filing['primary_document']}.gz"
            )
            if output_path.exists() and not refresh:
                with gzip.open(output_path, "rb") as handle:
                    raw = handle.read()
                source = "cache"
            else:
                raw = fetch_bytes(url, user_agent)
                with gzip.open(output_path, "wb", compresslevel=9) as handle:
                    handle.write(raw)
                source = "network"
                time.sleep(pause_seconds)
            print(
                f"[inline-xbrl] {symbol} {filing['form']} "
                f"{filing['accession']} ({source})",
                flush=True,
            )
            rows.append(
                {
                    "symbol": symbol,
                    "cik": registrant["cik"],
                    **filing,
                    "url": url,
                    "path": str(output_path),
                    "source": source,
                    "sha256_uncompressed": hashlib.sha256(raw).hexdigest(),
                    "bytes_uncompressed": len(raw),
                }
            )

    payload = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "as_of": AS_OF.isoformat(),
        "filings": rows,
    }
    (ROOT / "inline_filings_manifest.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return payload


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--symbols", nargs="+", default=DEFAULT_SYMBOLS)
    parser.add_argument("--periods", type=int, default=1)
    parser.add_argument("--refresh", action="store_true")
    parser.add_argument("--pause-seconds", type=float, default=0.25)
    args = parser.parse_args()
    payload = run(
        args.symbols,
        args.periods,
        args.refresh,
        args.pause_seconds,
    )
    print(json.dumps(payload, ensure_ascii=True, indent=2))


if __name__ == "__main__":
    main()
