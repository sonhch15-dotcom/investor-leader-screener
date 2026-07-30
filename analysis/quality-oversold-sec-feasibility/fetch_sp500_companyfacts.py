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
WORKSPACE = ROOT.parents[1]
CONSTITUENTS_PATH = (
    WORKSPACE / "leader-stock-screener" / "data" / "sp500_constituents.json"
)
SEC_TICKERS_PATH = ROOT / "raw" / "company_tickers.json.gz"
EXCLUDED_SECTORS = {"Financials", "Real Estate", "Utilities"}
BASE_URL = "https://data.sec.gov/api/xbrl/companyfacts"


def load_gzip_json(path: Path) -> dict[str, Any]:
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        return json.load(handle)


def normalize_sec_ticker(symbol: str) -> str:
    return symbol.strip().upper().replace(".", "-")


def sec_ticker_map(payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        row["ticker"].upper(): row
        for row in payload.values()
        if isinstance(row, dict) and row.get("ticker")
    }


def predecessor_overrides() -> dict[str, str]:
    payload = json.loads(
        (ROOT / "cik_lineage.json").read_text(encoding="utf-8")
    )
    return {
        row["symbol"]: row["predecessor_cik"]
        for row in payload["lineages"]
    }


def build_issuer_targets() -> tuple[list[dict[str, Any]], dict[str, Any]]:
    constituents = json.loads(
        CONSTITUENTS_PATH.read_text(encoding="utf-8")
    )
    sec_tickers = sec_ticker_map(load_gzip_json(SEC_TICKERS_PATH))
    overrides = predecessor_overrides()
    missing_symbols = []
    by_cik: dict[str, dict[str, Any]] = {}

    for company in constituents["constituents"]:
        sec_symbol = normalize_sec_ticker(company["symbol"])
        mapping = sec_tickers.get(sec_symbol)
        if mapping is None:
            missing_symbols.append(company["symbol"])
            continue
        current_cik = f"{int(mapping['cik_str']):010d}"
        financial_cik = overrides.get(company["symbol"], current_cik)
        issuer = by_cik.setdefault(
            financial_cik,
            {
                "financial_cik": financial_cik,
                "current_cik": current_cik,
                "symbols": [],
                "names": [],
                "sector": company["sector"],
                "excluded_sector": company["sector"] in EXCLUDED_SECTORS,
                "lineage_override": financial_cik != current_cik,
            },
        )
        if issuer["sector"] != company["sector"]:
            raise RuntimeError(
                f"CIK {financial_cik} maps to multiple sectors: "
                f"{issuer['sector']} and {company['sector']}"
            )
        issuer["symbols"].append(company["symbol"])
        issuer["names"].append(company["name"])

    issuers = sorted(by_cik.values(), key=lambda row: row["financial_cik"])
    included = [row for row in issuers if not row["excluded_sector"]]
    profile = {
        "constituent_security_count": constituents["count"],
        "unique_issuer_count": len(issuers),
        "included_issuer_count": len(included),
        "excluded_issuer_count": len(issuers) - len(included),
        "missing_ticker_symbols": sorted(missing_symbols),
        "constituents_generated_at": constituents["generated_at"],
        "constituents_source": constituents["source"],
    }
    return included, profile


def fetch_bytes(url: str, user_agent: str) -> bytes:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": user_agent,
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def run(refresh: bool, pause_seconds: float) -> dict[str, Any]:
    name, email = git_identity()
    user_agent = f"{name} quality-oversold-sp500-debt-profile {email}"
    targets, universe_profile = build_issuer_targets()
    output_dir = ROOT / "raw" / "sp500_companyfacts"
    output_dir.mkdir(parents=True, exist_ok=True)
    rows = []

    for index, issuer in enumerate(targets, start=1):
        cik = issuer["financial_cik"]
        path = output_dir / f"CIK{cik}-companyfacts.json.gz"
        url = f"{BASE_URL}/CIK{cik}.json"
        if path.exists() and not refresh:
            with gzip.open(path, "rb") as handle:
                raw = handle.read()
            source = "cache"
        else:
            raw = fetch_bytes(url, user_agent)
            with gzip.open(path, "wb", compresslevel=9) as handle:
                handle.write(raw)
            source = "network"
            time.sleep(pause_seconds)
        payload = json.loads(raw.decode("utf-8"))
        rows.append(
            {
                **issuer,
                "entity_name": payload.get("entityName"),
                "taxonomies": sorted((payload.get("facts") or {}).keys()),
                "path": str(path),
                "url": url,
                "source": source,
                "sha256_uncompressed": hashlib.sha256(raw).hexdigest(),
                "bytes_uncompressed": len(raw),
            }
        )
        if index == 1 or index % 25 == 0 or index == len(targets):
            print(
                f"[sp500-companyfacts] {index}/{len(targets)} "
                f"CIK{cik} {','.join(issuer['symbols'])} ({source})",
                flush=True,
            )

    manifest = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "request_rate": (
            f"{1 / pause_seconds:.2f} requests/sec maximum"
            if pause_seconds > 0
            else "no pause"
        ),
        "excluded_sectors": sorted(EXCLUDED_SECTORS),
        "universe": universe_profile,
        "issuers": rows,
    }
    (ROOT / "sp500_companyfacts_manifest.json").write_text(
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
                "universe": manifest["universe"],
                "request_rate": manifest["request_rate"],
            },
            ensure_ascii=True,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
