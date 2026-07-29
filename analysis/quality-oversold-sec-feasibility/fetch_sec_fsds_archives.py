from __future__ import annotations

import argparse
import hashlib
import json
import time
import urllib.request
from pathlib import Path


BASE_URL = (
    "https://www.sec.gov/files/dera/data/"
    "financial-statement-data-sets/{quarter}.zip"
)
USER_AGENT = (
    "quality-oversold-research "
    "github.com/sonhch15-dotcom/investor-leader-screener"
)


def parse_quarter(value: str) -> tuple[int, int]:
    if len(value) != 6 or value[4] != "q":
        raise ValueError(f"Invalid quarter: {value}")
    year = int(value[:4])
    quarter = int(value[5])
    if not 1 <= quarter <= 4:
        raise ValueError(f"Invalid quarter: {value}")
    return year, quarter


def quarter_range(start: str, end: str) -> list[str]:
    year, quarter = parse_quarter(start)
    end_value = parse_quarter(end)
    values = []
    while (year, quarter) <= end_value:
        values.append(f"{year:04d}q{quarter}")
        if quarter == 4:
            year += 1
            quarter = 1
        else:
            quarter += 1
    return values


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download(quarter: str, output_dir: Path) -> dict[str, object]:
    output_dir.mkdir(parents=True, exist_ok=True)
    destination = output_dir / f"{quarter}.zip"
    url = BASE_URL.format(quarter=quarter)
    if not destination.exists():
        temporary = destination.with_suffix(".zip.part")
        request = urllib.request.Request(
            url,
            headers={"User-Agent": USER_AGENT},
        )
        with urllib.request.urlopen(request, timeout=120) as response:
            with temporary.open("wb") as handle:
                while chunk := response.read(1024 * 1024):
                    handle.write(chunk)
        temporary.replace(destination)
    return {
        "quarter": quarter,
        "url": url,
        "path": str(destination),
        "bytes": destination.stat().st_size,
        "sha256": sha256(destination),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--start-quarter", required=True)
    parser.add_argument("--end-quarter", required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--pause-seconds", type=float, default=0.15)
    args = parser.parse_args()

    rows = []
    for index, quarter in enumerate(
        quarter_range(args.start_quarter, args.end_quarter)
    ):
        row = download(quarter, args.output_dir)
        rows.append(row)
        print(
            json.dumps(
                {
                    "quarter": quarter,
                    "bytes": row["bytes"],
                    "cached_or_downloaded": True,
                }
            ),
            flush=True,
        )
        if index + 1 < len(
            quarter_range(args.start_quarter, args.end_quarter)
        ):
            time.sleep(args.pause_seconds)

    args.manifest.write_text(
        json.dumps(
            {
                "source": "SEC Financial Statement Data Sets",
                "prices_accessed": False,
                "returns_calculated": False,
                "archives": rows,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()

