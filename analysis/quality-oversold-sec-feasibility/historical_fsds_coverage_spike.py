from __future__ import annotations

import argparse
import csv
import io
import json
import re
import zipfile
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable

from analyze_total_liabilities_equity_fsds import resolve_issuer


ROOT = Path(__file__).resolve().parent
FORMS = {"10-Q", "10-K", "10-Q/A", "10-K/A"}
RESOLVED_STATUSES = {"ratio_available", "nonpositive_equity_auto_fail"}


def text_rows(
    archive: zipfile.ZipFile, name: str
) -> Iterable[dict[str, str]]:
    with archive.open(name) as binary:
        text = io.TextIOWrapper(binary, encoding="utf-8", newline="")
        yield from csv.DictReader(text, delimiter="\t")


def ticker_key(value: str) -> str:
    return "".join(character for character in value.upper() if character.isalpha())


def instance_ticker(instance: str) -> str | None:
    stem = Path(instance).stem
    match = re.match(r"[A-Za-z._-]+", stem)
    if not match:
        return None
    key = ticker_key(match.group(0))
    return key or None


def snapshot_for_month(path: Path, month: str) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    return next(
        snapshot
        for snapshot in payload["snapshots"]
        if snapshot["month"] == month
    )


def analyze(
    snapshot: dict[str, Any],
    archive_path: Path,
) -> dict[str, Any]:
    included = [
        row
        for row in snapshot["constituents"]
        if row["included_in_quality_universe"]
    ]
    month_end = snapshot["month_end"].replace("-", "")

    with zipfile.ZipFile(archive_path) as archive:
        submissions = [
            row
            for row in text_rows(archive, "sub.txt")
            if row["form"] in FORMS and row["filed"] <= month_end
        ]
        prefix_to_ciks: dict[str, set[str]] = defaultdict(set)
        for row in submissions:
            prefix = instance_ticker(row.get("instance", ""))
            if prefix:
                prefix_to_ciks[prefix].add(f"{int(row['cik']):010d}")

        mapping_rows = []
        mapped_ciks: set[str] = set()
        for company in included:
            if company["cik"]:
                candidates = {company["cik"]}
                method = "wikipedia_numeric_cik"
            else:
                candidates = prefix_to_ciks[ticker_key(company["symbol"])]
                method = (
                    "unique_sec_instance_ticker"
                    if len(candidates) == 1
                    else (
                        "ambiguous_sec_instance_ticker"
                        if candidates
                        else "missing_sec_instance_ticker"
                    )
                )
            cik = next(iter(candidates)) if len(candidates) == 1 else None
            if cik:
                mapped_ciks.add(cik)
            mapping_rows.append(
                {
                    **company,
                    "mapped_cik": cik,
                    "mapping_method": method,
                    "mapping_candidates": sorted(candidates),
                }
            )

        latest_by_cik: dict[str, dict[str, str]] = {}
        for row in submissions:
            cik = f"{int(row['cik']):010d}"
            if cik not in mapped_ciks:
                continue
            current = latest_by_cik.get(cik)
            rank = (row["filed"], row["adsh"])
            current_rank = (
                (current["filed"], current["adsh"])
                if current
                else ("", "")
            )
            if current is None or rank > current_rank:
                latest_by_cik[cik] = row

        accession_to_cik = {
            row["adsh"]: cik for cik, row in latest_by_cik.items()
        }
        presentation: dict[str, list[dict[str, str]]] = defaultdict(list)
        needed_tags: dict[str, set[tuple[str, str]]] = defaultdict(set)
        for row in text_rows(archive, "pre.txt"):
            if (
                row["adsh"] not in accession_to_cik
                or row["stmt"] != "BS"
                or row.get("inpth", "0") != "0"
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

    filings_by_cik: dict[str, dict[str, Any]] = {}
    for cik, submission in latest_by_cik.items():
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
                            "segments": value.get("segments", ""),
                            "footnote": value.get("footnote", ""),
                        }
                        for value in values
                    ],
                }
            )
        filings_by_cik[cik] = {
            "cik": cik,
            "accession": accession,
            "form": submission["form"],
            "filed": submission["filed"],
            "period": period,
            "balance_sheet_lines": lines,
        }

    rows = []
    for mapping in mapping_rows:
        cik = mapping["mapped_cik"]
        filing = filings_by_cik.get(cik) if cik else None
        if not cik:
            resolution = {"status": "cik_mapping_unresolved"}
        elif not filing:
            resolution = {"status": "submission_unavailable_in_quarter"}
        else:
            resolution = resolve_issuer(filing)
        rows.append(
            {
                **mapping,
                "status": resolution["status"],
                "resolved": resolution["status"] in RESOLVED_STATUSES,
                "accession": filing["accession"] if filing else None,
                "filed": filing["filed"] if filing else None,
                "period": filing["period"] if filing else None,
                "ratio": resolution.get("ratio"),
            }
        )

    by_sector = []
    for sector in sorted({row["sector"] for row in rows}):
        sector_rows = [row for row in rows if row["sector"] == sector]
        resolved = sum(row["resolved"] for row in sector_rows)
        by_sector.append(
            {
                "sector": sector,
                "population": len(sector_rows),
                "resolved": resolved,
                "coverage": resolved / len(sector_rows),
            }
        )
    resolved = sum(row["resolved"] for row in rows)
    return {
        "scope": (
            "single-quarter spike only; older submissions are not carried "
            "forward, so this is not final monthly coverage"
        ),
        "source_archive": str(archive_path),
        "month": snapshot["month"],
        "month_end": snapshot["month_end"],
        "prices_accessed": False,
        "returns_calculated": False,
        "population": len(rows),
        "mapping_method_counts": dict(
            Counter(row["mapping_method"] for row in rows)
        ),
        "status_counts": dict(Counter(row["status"] for row in rows)),
        "coverage": {
            "resolved": resolved,
            "overall": resolved / len(rows),
            "minimum_sector": min(row["coverage"] for row in by_sector),
            "by_sector": by_sector,
        },
        "rows": rows,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--snapshot-json", type=Path, required=True)
    parser.add_argument("--month", required=True)
    parser.add_argument("--fsds-zip", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    result = analyze(
        snapshot_for_month(args.snapshot_json, args.month),
        args.fsds_zip,
    )
    args.output.write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                key: result[key]
                for key in (
                    "scope",
                    "month",
                    "prices_accessed",
                    "returns_calculated",
                    "population",
                    "mapping_method_counts",
                    "status_counts",
                    "coverage",
                )
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
