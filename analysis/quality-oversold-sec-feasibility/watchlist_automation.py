from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from fetch_sec_fsds_archives import download


ROOT = Path(__file__).resolve().parent
RAW_FSDS_DIR = ROOT / "raw" / "sec_fsds"
WATCHLIST_PATH = ROOT / "data" / "watchlist.json"
DISCLAIMER = "검증된 성과 우위 없음 · 조사 후보 목록"


def prior_quarter(year: int, quarter: int) -> tuple[int, int]:
    if quarter == 1:
        return year - 1, 4
    return year, quarter - 1


def filing_archive_quarters(as_of: date) -> dict[str, str]:
    calendar_quarter = (as_of.month - 1) // 3 + 1
    current_year, current_quarter = prior_quarter(
        as_of.year,
        calendar_quarter,
    )
    prior_year = current_year - 1
    return {
        "current_archive": (
            f"{current_year:04d}q{current_quarter}"
        ),
        "current_label": (
            f"{current_year:04d} Q{current_quarter}"
        ),
        "prior_archive": f"{prior_year:04d}q{current_quarter}",
        "prior_label": f"{prior_year:04d} Q{current_quarter}",
    }


def refresh_watchlist(
    *,
    as_of: date,
    output: Path = WATCHLIST_PATH,
    pause_seconds: float = 0.25,
) -> dict[str, Any]:
    quarters = filing_archive_quarters(as_of)
    current = download(
        quarters["current_archive"],
        RAW_FSDS_DIR,
    )
    prior = download(
        quarters["prior_archive"],
        RAW_FSDS_DIR,
    )
    manifest = {
        "disclaimer": DISCLAIMER,
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "as_of_date": as_of.isoformat(),
        "quarter_rule": (
            "latest fully completed calendar filing quarter and "
            "the same quarter one year earlier"
        ),
        "archives": [current, prior],
    }
    manifest_path = RAW_FSDS_DIR / "watchlist_automation_manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    subprocess.run(
        [
            sys.executable,
            str(ROOT / "update_watchlist.py"),
            "--as-of",
            as_of.isoformat(),
            "--pause-seconds",
            str(pause_seconds),
            "--current-fsds",
            str(current["path"]),
            "--prior-fsds",
            str(prior["path"]),
            "--current-fsds-quarter",
            quarters["current_label"],
            "--prior-fsds-quarter",
            quarters["prior_label"],
            "--output",
            str(output),
        ],
        cwd=ROOT,
        check=True,
    )
    return {
        "as_of_date": as_of.isoformat(),
        **quarters,
        "output": str(output),
        "manifest": str(manifest_path),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="분기 감시목록 자동 갱신"
    )
    parser.add_argument(
        "--as-of",
        type=date.fromisoformat,
        default=date.today(),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=WATCHLIST_PATH,
    )
    parser.add_argument(
        "--pause-seconds",
        type=float,
        default=0.25,
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    print(DISCLAIMER, flush=True)
    result = refresh_watchlist(
        as_of=args.as_of,
        output=args.output,
        pause_seconds=args.pause_seconds,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
