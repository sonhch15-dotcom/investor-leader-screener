from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fetch_sec import git_identity


ROOT = Path(__file__).resolve().parent
BALANCE_SHEETS_PATH = ROOT / "fsds_balance_sheets_2026q1.json"
DEBT_RESULTS_PATH = ROOT / "fsds_debt_results_2026q1.json"
TARGET_STATUSES = {
    "reported_debt_only_finance_lease_unverified",
    "missing_debt",
    "missing_equity",
}


def targets() -> list[dict[str, Any]]:
    balance_sheets = json.loads(
        BALANCE_SHEETS_PATH.read_text(encoding="utf-8")
    )
    debt_results = json.loads(
        DEBT_RESULTS_PATH.read_text(encoding="utf-8")
    )
    status_by_cik = {
        row["cik"]: row["status"] for row in debt_results["rows"]
    }
    rows = []
    for issuer in balance_sheets["issuers"]:
        status = status_by_cik[issuer["cik"]]
        if status not in TARGET_STATUSES:
            continue
        accession_compact = issuer["accession"].replace("-", "")
        cik_compact = str(int(issuer["cik"]))
        instance = issuer["instance"]
        rows.append(
            {
                "symbols": issuer["symbols"],
                "name": issuer["name"],
                "sector": issuer["sector"],
                "cik": issuer["cik"],
                "accession": issuer["accession"],
                "form": issuer["form"],
                "filed": issuer["filed"],
                "period": issuer["period"],
                "instance": instance,
                "prior_status": status,
                "url": (
                    "https://www.sec.gov/Archives/edgar/data/"
                    f"{cik_compact}/{accession_compact}/{instance}"
                ),
            }
        )
    return sorted(rows, key=lambda row: row["cik"])


def fetch_bytes(url: str, user_agent: str) -> bytes:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": user_agent,
            "Accept": (
                "application/xml,text/xml,application/xhtml+xml,text/html"
            ),
        },
    )
    with urllib.request.urlopen(request, timeout=90) as response:
        return response.read()


def run(refresh: bool, pause_seconds: float) -> dict[str, Any]:
    name, email = git_identity()
    user_agent = f"{name} quality-oversold-xbrl-notes-fallback {email}"
    output_dir = ROOT / "raw" / "fsds_instances"
    output_dir.mkdir(parents=True, exist_ok=True)
    rows = []
    target_rows = targets()
    for index, target in enumerate(target_rows, start=1):
        filename = (
            f"CIK{target['cik']}-{target['accession'].replace('-', '')}-"
            f"{Path(target['instance']).name}.gz"
        )
        path = output_dir / filename
        if path.exists() and not refresh:
            with gzip.open(path, "rb") as handle:
                raw = handle.read()
            source = "cache"
        else:
            raw = fetch_bytes(target["url"], user_agent)
            with gzip.open(path, "wb", compresslevel=9) as handle:
                handle.write(raw)
            source = "network"
            time.sleep(pause_seconds)
        rows.append(
            {
                **target,
                "path": str(path),
                "source": source,
                "bytes_uncompressed": len(raw),
                "sha256_uncompressed": hashlib.sha256(raw).hexdigest(),
            }
        )
        if index == 1 or index % 20 == 0 or index == len(target_rows):
            print(
                f"[fsds-instance] {index}/{len(target_rows)} "
                f"{','.join(target['symbols'])} ({source})",
                flush=True,
            )
    manifest = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "preregistration": "PREREGISTRATION.v0.3.md",
        "source_dataset": "SEC Financial Statement Data Set 2026 Q1",
        "target_statuses": sorted(TARGET_STATUSES),
        "target_count": len(target_rows),
        "request_rate": (
            f"{1 / pause_seconds:.2f} requests/sec maximum"
            if pause_seconds > 0
            else "no pause"
        ),
        "filings": rows,
    }
    (ROOT / "fsds_instance_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--refresh", action="store_true")
    parser.add_argument("--pause-seconds", type=float, default=0.25)
    args = parser.parse_args()
    manifest = run(args.refresh, args.pause_seconds)
    print(
        json.dumps(
            {
                "target_count": manifest["target_count"],
                "request_rate": manifest["request_rate"],
                "preregistration": manifest["preregistration"],
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
